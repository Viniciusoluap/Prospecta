// EPIC-027 C7 (20/11/2026) — regras puras da integração com a YCloud (API oficial do WhatsApp), usadas pelo servidor e pela tela.
// Fontes (documentação oficial, conferida em 20/11/2026):
// - limites por tier e escopo de portfólio: https://docs.ycloud.com/en/documentation/whatsapp-business-platform/pricing-limits-and-quality/messaging-limits-and-throughput
// - campos do número (messagingLimit, whatsappBusinessManagerMessagingLimit, status, qualityRating): https://docs.ycloud.com/api-reference/whatsapp-phone-numbers/list-phone-numbers.md
// - 5 mensagens/s fixas em coexistência: https://docs.ycloud.com/en/documentation/channels/whatsapp-accounts-management/coexistence/onboard-whatsapp-business-app
// - situação convergente (não só "a mais alta vale"): https://docs.ycloud.com/en/api-reference/guides/whatsapp-platform/whatsapp-messages-api-best-practices.md

/**
 * EPIC-027 C7.1 (21/11/2026) — quem OPERA campanha pela API oficial (decisão do dono: "eu ou colaborador se estiver marcado WhatsApp
 * pra ele"): admin ativo OU colaborador ativo com o módulo WhatsApp. Corretor, cliente, empreiteiro e contas inativas, nunca.
 * ADMINISTRAR a integração (chave, interruptor, tetos, preço, avisos de entrega, auditoria) continua só do admin por papel.
 * Mesma regra no servidor (router `whatsappOficial`) e na tela (só esconde; quem decide é o servidor).
 */
export function podeOperarCampanhaOficial(u: { perfil: string | null | undefined; ativo: boolean; permissoes: readonly string[] }): boolean {
  if (!u.ativo) return false;
  if (u.perfil === "admin") return true;
  return u.perfil === "colaborador" && u.permissoes.includes("whatsapp");
}
export function podeAdministrarIntegracaoOficial(u: { perfil: string | null | undefined; ativo: boolean }): boolean {
  return u.ativo && u.perfil === "admin";
}

/** Coexistência (app + API no mesmo número): a YCloud documenta vazão fixa de 5 mensagens por segundo. */
export const MENSAGENS_POR_SEGUNDO_COEXISTENCIA = 5;
/** Intervalo mínimo entre dois envios (ms), para não passar de 5/s. */
export const INTERVALO_MINIMO_ENVIO_MS = Math.ceil(1000 / MENSAGENS_POR_SEGUNDO_COEXISTENCIA);
/** Quantos envios cabem numa chamada (a função da Vercel tem 60 s; folga para banco e rede). */
export const LOTE_ENVIO_YCLOUD = 120;
export const ORCAMENTO_LOTE_MS = 40_000;
/** Envio reservado e sem resposta há mais que isso (a função encerrou no meio): vira "incerto", nunca é reenviado sozinho. */
export const RESERVA_EXPIRADA_MS = 3 * 60_000;
/** Teto de destinatários numa campanha (independe do tier). */
export const MAX_DESTINATARIOS_CAMPANHA = 5_000;

/**
 * Tier de mensagens → destinatários únicos em 24 h móveis. Desconhecido / TIER_NOT_SET → 250 (o tier de um portfólio novo, segundo a
 * documentação): nunca supor mais do que a conta comprovadamente tem. TIER_UNLIMITED → sem teto da Meta (valem os tetos do painel).
 */
const TIERS: Record<string, number> = {
  TIER_50: 50, TIER_250: 250, TIER_1K: 1_000, TIER_2K: 2_000, TIER_10K: 10_000, TIER_100K: 100_000, TIER_UNLIMITED: Number.POSITIVE_INFINITY,
};
export const LIMITE_PADRAO_DESCONHECIDO = 250;

/** O limite que vale: o do portfólio (desde 07/10/2025 a Meta calcula por portfólio) e, sem ele, o do número. */
export function limiteDoTier(numero: { whatsappBusinessManagerMessagingLimit?: string | null; messagingLimit?: string | null }): { tier: string; limite: number } {
  for (const t of [numero.whatsappBusinessManagerMessagingLimit, numero.messagingLimit]) {
    if (t && t in TIERS) return { tier: t, limite: TIERS[t] };
  }
  return { tier: numero.whatsappBusinessManagerMessagingLimit || numero.messagingLimit || "TIER_NOT_SET", limite: LIMITE_PADRAO_DESCONHECIDO };
}

export const ROTULO_STATUS_NUMERO: Record<string, string> = {
  CONNECTED: "Conectado", PENDING: "Pendente", UNVERIFIED: "Não verificado", MANUAL_REVIEW: "Em análise manual", DISCONNECTED: "Desconectado",
  FLAGGED: "Sinalizado", WARNED: "Advertido", RATE_LIMITED: "Limitado por excesso", BANNED: "Banido", RESTRICTED: "Restrito", BLOCKED: "Bloqueado",
  MIGRATED: "Migrado", UNKNOWN: "Desconhecido",
};
export const ROTULO_QUALIDADE: Record<string, string> = { GREEN: "Alta (verde)", YELLOW: "Média (amarela)", RED: "Baixa (vermelha)", UNKNOWN: "Ainda sem avaliação" };
export const ROTULO_STATUS_MODELO: Record<string, string> = {
  APPROVED: "Aprovado", PENDING: "Em análise", REJECTED: "Recusado", PAUSED: "Pausado", DISABLED: "Desativado", ARCHIVED: "Arquivado",
  IN_APPEAL: "Em recurso", DELETED: "Apagado",
};
export const ROTULO_CATEGORIA_MODELO: Record<string, string> = { MARKETING: "Marketing", UTILITY: "Utilidade", AUTHENTICATION: "Autenticação" };

/**
 * Telefone do cadastro → E.164 com "+" (formato que a YCloud pede em `to`). Só Brasil: 10/11 dígitos ganham o 55; 12/13 com 55 ficam
 * como estão. O nono dígito NUNCA é inventado. Fora disso → null (o envio é pulado, com motivo).
 */
export function telefoneE164(bruto: string | null | undefined): string | null {
  const d = String(bruto ?? "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) return d[0] === "0" ? null : `+55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return `+${d}`;
  return null;
}

/**
 * Forma canônica do telefone para DEDUPLICAR e BLOQUEAR (opt-out): a mesma regra estrita do número do dono (shared/dolores/whatsapp.ts,
 * `ehNumeroDoDono`) — Brasil = 55 + DDD + 8 finais; o nono dígito só é normalizado (acrescentado) quando os 8 finais são de celular
 * (começam por 6–9); fixo fica como está. Outro país → só os dígitos. Inválido → null.
 */
export function chaveCanonicaTelefone(bruto: string | null | undefined): string | null {
  let d = String(bruto ?? "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  const m = /^55([1-9][1-9])(9?)(\d{8})$/.exec(d);
  if (m) return /^[6-9]/.test(m[3]) ? `55${m[1]}9${m[3]}` : `55${m[1]}${m[2]}${m[3]}`;
  return d.length >= 10 && d.length <= 15 && !d.startsWith("55") ? d : null;
}

/**
 * Nome do cadastro usado como variável (vem de fora: nome do WhatsApp, formulário do site). Só letras, espaços, hífen e apóstrofo,
 * até 50 caracteres; com link, "@", dígitos ou caracteres de controle → null (tratado como "sem nome" e o envio é pulado com motivo).
 */
export const MAX_NOME_VARIAVEL = 50;
export function nomeSeguroParaVariavel(bruto: string | null | undefined): string | null {
  const n = String(bruto ?? "").replace(/\s+/g, " ").trim();
  if (!n || n.length > MAX_NOME_VARIAVEL) return null;
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ' -]+$/.test(n)) return null;
  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(n)) return null;
  return n;
}

/** Texto para comparar (eco): espaços colapsados, sem diferença de caixa. */
export function textoComparavel(t: string | null | undefined): string {
  return String(t ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** "+5599…1234" → "+55 •••• 1234" (para tela e lista de falhas; nunca em log). */
export function telefoneMascarado(e164: string | null | undefined): string {
  const d = String(e164 ?? "").replace(/\D/g, "");
  return d.length >= 4 ? `+${d.slice(0, 2)} •••• ${d.slice(-4)}` : "••••";
}

// ── Modelos (templates) ──

export type ComponenteModelo = { type?: string; format?: string; text?: string; buttons?: Array<{ type?: string; text?: string; url?: string }> };
export type CampoModelo = { chave: string; local: "cabecalho" | "corpo"; indice: number; limite: number };
export type AnaliseModelo = { compativel: boolean; motivo: string | null; campos: CampoModelo[]; corpo: string; cabecalho: string | null };

const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

function placeholders(texto: string): string[] {
  return Array.from(texto.matchAll(PLACEHOLDER), m => m[1]);
}

/** Posicionais 1..n, em sequência. Nomeados ({{nome}}) ou fora de ordem → null (não suportado nesta versão). */
function posicionais(texto: string): number[] | null {
  const ps = placeholders(texto);
  if (!ps.every(p => /^\d+$/.test(p))) return null;
  const nums = Array.from(new Set(ps.map(Number))).sort((a, b) => a - b);
  return nums.every((n, i) => n === i + 1) ? nums : null;
}

/**
 * O que a tela consegue enviar: corpo com variáveis posicionais ({{1}}, {{2}}…), cabeçalho de TEXTO com até uma variável, rodapé e
 * botões sem variável. Cabeçalho de mídia, botão de link com variável, carrossel e oferta por tempo limitado → incompatível (o modelo
 * aparece na lista, mas não dá para disparar por aqui).
 */
export function analisarModelo(components: ComponenteModelo[] | null | undefined): AnaliseModelo {
  const cs = Array.isArray(components) ? components : [];
  const tipo = (c: ComponenteModelo) => String(c.type ?? "").toUpperCase();
  const corpoC = cs.find(c => tipo(c) === "BODY");
  const corpo = String(corpoC?.text ?? "");
  const falha = (motivo: string): AnaliseModelo => ({ compativel: false, motivo, campos: [], corpo, cabecalho: null });
  if (!corpoC || !corpo.trim()) return falha("Modelo sem corpo de texto.");
  for (const c of cs) {
    const t = tipo(c);
    if (!["HEADER", "BODY", "FOOTER", "BUTTONS"].includes(t)) return falha(`Componente "${t || "?"}" não suportado nesta tela.`);
  }
  const campos: CampoModelo[] = [];
  let cabecalho: string | null = null;
  const cab = cs.find(c => tipo(c) === "HEADER");
  if (cab) {
    const formato = String(cab.format ?? "TEXT").toUpperCase();
    if (formato !== "TEXT") return falha("Cabeçalho com imagem, vídeo ou documento ainda não é enviado por esta tela.");
    cabecalho = String(cab.text ?? "");
    const ns = posicionais(cabecalho);
    if (!ns || ns.length > 1) return falha("Cabeçalho com variáveis nomeadas ou mais de uma variável não é suportado.");
    if (ns.length === 1) campos.push({ chave: "cabecalho.1", local: "cabecalho", indice: 1, limite: 60 });
  }
  const ns = posicionais(corpo);
  if (!ns) return falha("Variáveis nomeadas ({{nome}}) ou fora de ordem não são suportadas: use {{1}}, {{2}}…");
  for (const n of ns) campos.push({ chave: `corpo.${n}`, local: "corpo", indice: n, limite: 1024 });
  const rodape = cs.find(c => tipo(c) === "FOOTER");
  if (rodape && placeholders(String(rodape.text ?? "")).length) return falha("Rodapé com variável não é suportado.");
  for (const b of cs.find(c => tipo(c) === "BUTTONS")?.buttons ?? []) {
    if (placeholders(`${b.url ?? ""} ${b.text ?? ""}`).length) return falha("Botão com variável não é suportado nesta tela.");
  }
  return { compativel: true, motivo: null, campos, corpo, cabecalho };
}

/**
 * De onde vem o valor de cada variável: do cadastro (nome) ou um texto fixo digitado por quem opera a campanha (admin ou colaborador
 * com o módulo WhatsApp; o do colaborador passa também por `problemaDoTextoFixoDaEquipe`).
 */
export type FonteVariavel = { fonte: "primeiro_nome" | "nome_completo" } | { fonte: "fixo"; texto: string };

/** A Meta recusa parâmetro com quebra de linha, tabulação ou 4+ espaços seguidos (regra da Cloud API). */
export function problemaDoParametro(valor: string, limite: number): string | null {
  if (!valor.trim()) return "vazio";
  if (/[\n\r\t]/.test(valor) || / {4,}/.test(valor)) return "tem quebra de linha, tabulação ou espaços seguidos";
  if (valor.length > limite) return `passa de ${limite} caracteres`;
  return null;
}

const TLD_COMUNS = "com|net|org|br|io|me|co|info|biz|app|site|online|store|shop|link|ly|xyz|gov|edu|tv|us|uk|pt|top|club|live|page|digital";
const DOMINIO_COM_TLD = new RegExp(`(?:^|[^a-z0-9@])[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:${TLD_COMUNS})(?![a-z0-9])`, "i");

/**
 * C7.1 (portão de QA, 21/11/2026): texto fixo de variável digitado por quem NÃO é admin (colaborador com o módulo WhatsApp) não leva
 * link (`http`, `https`, `www.`, domínio com terminação comum) nem telefone (8+ dígitos seguidos, aceitando espaço, ponto, hífen,
 * parênteses e "+"). O modelo foi aprovado pela Meta; a variável não pode virar um canal para mandar o cliente a outro lugar.
 */
export function problemaDoTextoFixoDaEquipe(valor: string): string | null {
  if (/https?:|www\./i.test(valor) || DOMINIO_COM_TLD.test(valor)) return "não pode ter link (só o administrador pode usar link em texto fixo)";
  const corridas = valor.match(/[+(]?\d[\d\s().+-]*\d/g) ?? [];
  if (corridas.some(c => c.replace(/\D/g, "").length >= 8)) return "não pode ter número de telefone (só o administrador pode usar telefone em texto fixo)";
  return null;
}

/** Substitui {{n}} pelos valores (prévia e texto guardado na Central). */
export function preencherPosicionais(texto: string, valores: Record<number, string>): string {
  return texto.replace(PLACEHOLDER, (m, p: string) => (/^\d+$/.test(p) && valores[Number(p)] !== undefined ? valores[Number(p)] : m));
}

// ── Situação do envio (convergente) ──

export type HorariosEnvio = { aceitoEm?: Date | null; enviadoEm?: Date | null; entregueEm?: Date | null; lidoEm?: Date | null; falhouEm?: Date | null };
/**
 * A situação atual sai das evidências (horários), não da ordem de chegada: "lida" prova entrega mesmo sem o aviso de entregue;
 * falha só vale se não houver prova de entrega/leitura.
 */
export function situacaoConvergente(h: HorariosEnvio): "aceita" | "enviada" | "entregue" | "lida" | "falhou" {
  if (h.lidoEm) return "lida";
  if (h.entregueEm) return "entregue";
  if (h.falhouEm) return "falhou";
  if (h.enviadoEm) return "enviada";
  return "aceita";
}

/** A situação do envio na Central (whatsapp_messages.status). */
export function statusNaCentral(s: string): string {
  return s === "lida" ? "lida" : s === "entregue" ? "entregue" : s === "falhou" ? "falhou" : "enviada";
}

export const ROTULO_STATUS_ENVIO: Record<string, string> = {
  na_fila: "Na fila", enviando: "Enviando", aceita: "Aceita pela YCloud", enviada: "Enviada", entregue: "Entregue", lida: "Lida",
  falhou: "Falhou", incerto: "Incerto (conferir)",
};

// ── C7.2 (21/11/2026): criar modelo pelo Prospecta (sem o painel da YCloud) ──
// Fonte do formato: https://docs.ycloud.com/api-reference/whatsapp-templates/create-a-template.md (POST /whatsapp/templates):
// wabaId, name (até 512, minúsculas e dígitos — o exemplo da própria documentação usa "_"), language, category (MARKETING / UTILITY /
// AUTHENTICATION), components: BODY obrigatório (até 1024 caracteres; com variável, `example.body_text` = [[um valor por variável]]),
// FOOTER opcional (até 60 caracteres, só texto).
// Regras da Meta para variáveis (guia de modelos da Meta, referido pela documentação da YCloud): posicionais {{1}}, {{2}}… em
// sequência, cada uma com exemplo; o corpo não começa nem termina com variável; duas variáveis não ficam coladas.

export const IDIOMA_MODELO = "pt_BR";
export const CATEGORIAS_NOVO_MODELO = ["MARKETING", "UTILITY"] as const;
export type CategoriaNovoModelo = (typeof CATEGORIAS_NOVO_MODELO)[number];
export const MAX_CORPO_MODELO = 1024;
export const MAX_RODAPE_MODELO = 60;
export const MAX_NOME_MODELO = 512;
export const MAX_VARIAVEIS_MODELO = 20;

export type NovoModelo = { nome: string; categoria: CategoriaNovoModelo; corpo: string; exemplos: string[]; rodape?: string | null };

/** O modelo padrão que o servidor envia sozinho, uma vez, quando a conta não tem modelo de marketing em pt_BR (pedido do dono, 21/11). */
export const MODELO_PADRAO: NovoModelo = {
  nome: "novidades_prospecta",
  categoria: "MARKETING",
  corpo: "Olá, {{1}}! Aqui é da Prospecta. Temos novidades em imóveis financiados e construção na sua região. Quer que um consultor te mande os detalhes? Responda SIM. Para não receber mais, responda SAIR.",
  exemplos: ["Maria"],
  rodape: null,
};

/** Problemas do modelo (vazio = pode enviar para aprovação). Mesma regra no servidor (quem decide) e na tela (só avisa antes). */
export function problemasDoNovoModelo(m: NovoModelo): string[] {
  const p: string[] = [];
  const nome = String(m.nome ?? "");
  if (!nome) p.push("Dê um nome ao modelo.");
  else if (nome.length > MAX_NOME_MODELO || !/^[a-z0-9_]+$/.test(nome)) p.push("Nome: só letras minúsculas sem acento, números e \"_\" (ex.: novidades_jardim).");
  if (!(CATEGORIAS_NOVO_MODELO as readonly string[]).includes(m.categoria)) p.push("Categoria: Marketing ou Utilidade.");
  const corpo = String(m.corpo ?? "");
  if (!corpo.trim()) p.push("Escreva o texto da mensagem.");
  if (corpo.length > MAX_CORPO_MODELO) p.push(`O texto passa de ${MAX_CORPO_MODELO} caracteres.`);
  const ps = placeholders(corpo);
  if (ps.some(x => !/^\d+$/.test(x))) p.push("Use só variáveis numeradas: {{1}}, {{2}}…");
  else {
    const nums = ps.map(Number);
    const distintos = Array.from(new Set(nums)).sort((a, b) => a - b);
    if (distintos.length > MAX_VARIAVEIS_MODELO) p.push(`No máximo ${MAX_VARIAVEIS_MODELO} variáveis.`);
    if (!distintos.every((n, i) => n === i + 1)) p.push("As variáveis precisam estar em sequência, começando em {{1}} ({{1}}, {{2}}, {{3}}…).");
    else if (nums.length !== distintos.length) p.push("Cada variável aparece uma vez só no texto.");
    else if (!nums.every((n, i) => n === i + 1)) p.push("As variáveis aparecem no texto na ordem: primeiro {{1}}, depois {{2}}…");
    if (ps.length) {
      const t = corpo.trim();
      if (/^\{\{[^{}]*\}\}/.test(t)) p.push("O texto não pode começar com uma variável.");
      if (/\{\{[^{}]*\}\}[\s.!?…]*$/.test(t)) p.push("O texto não pode terminar com uma variável.");
      if (/\}\}\s*\{\{/.test(corpo)) p.push("Duas variáveis não podem ficar coladas: ponha texto entre elas.");
    }
    // precaução nossa (a Meta recusa texto com espaçamento exagerado): no máximo uma linha em branco seguida
    if (/\n[ \t]*\n[ \t]*\n/.test(corpo)) p.push("Quebra de linha em excesso: deixe no máximo uma linha em branco seguida.");
    const exemplos = Array.isArray(m.exemplos) ? m.exemplos : [];
    if (exemplos.length !== distintos.length) p.push("Dê um exemplo para cada variável (a Meta exige para analisar).");
    exemplos.forEach((e, i) => {
      const prob = problemaDoParametro(String(e ?? ""), 200);
      if (prob) p.push(`Exemplo de {{${i + 1}}}: ${prob}.`);
    });
  }
  const rodape = String(m.rodape ?? "");
  if (rodape) {
    if (rodape.length > MAX_RODAPE_MODELO) p.push(`O rodapé passa de ${MAX_RODAPE_MODELO} caracteres.`);
    if (placeholders(rodape).length) p.push("O rodapé não pode ter variável.");
    if (/[\n\r]/.test(rodape)) p.push("O rodapé fica numa linha só.");
  }
  return p;
}

/** `components` de POST /whatsapp/templates (formato da documentação da YCloud). */
export function componentesDoNovoModelo(m: NovoModelo):
  Array<{ type: "BODY"; text: string; example?: { body_text: string[][] } } | { type: "FOOTER"; text: string }> {
  const exemplos = (m.exemplos ?? []).map(e => String(e).trim());
  const rodape = String(m.rodape ?? "").trim();
  return [
    { type: "BODY", text: m.corpo.trim(), ...(exemplos.length ? { example: { body_text: [exemplos] } } : {}) },
    ...(rodape ? [{ type: "FOOTER" as const, text: rodape }] : []),
  ];
}

/** "Já existe modelo de marketing em pt_BR" (qualquer situação, menos apagado) — com ele, o servidor não cria o padrão. */
export function temModeloDeMarketingPtBr(lista: Array<{ name?: string; language?: string; category?: string; status?: string }>): boolean {
  return lista.some(m => m.language === IDIOMA_MODELO && ((m.category === "MARKETING" && m.status !== "DELETED") || m.name === MODELO_PADRAO.nome));
}

// ── C7.2 (pedido do dono, 21/11): o template da Central vira modelo da API oficial, sem botão novo ──
// As variáveis nomeadas da Central ({{nome}}, {{corretor}}…) viram {{1}}, {{2}}… na ordem em que aparecem; o mapeamento
// (posição → nome) fica guardado para a campanha preencher depois. Os exemplos que a Meta exige saem sozinhos.

export const EXEMPLO_POR_VARIAVEL: Record<string, string> = {
  nome: "Maria", corretor: "João", dia: "25/11", horario: "14h", servicos: "financiamento", servico: "financiamento",
};
export const exemploDaVariavel = (v: string) => EXEMPLO_POR_VARIAVEL[v] ?? "exemplo";

/** Variáveis que a campanha pela API oficial preenche sozinha, a partir do cadastro do contato. */
export const FONTE_AUTOMATICA_DA_VARIAVEL: Record<string, "primeiro_nome"> = { nome: "primeiro_nome" };

const VARIAVEL_NOMEADA = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;
export const MAX_NOME_MODELO_DO_TEMPLATE = 60;

/** Nome do modelo na YCloud a partir do nome do template: minúsculas sem acento, dígitos e "_" (ex.: "Follow-up 48h" → "follow_up_48h"). */
export function nomeDoModeloDoTemplate(nomeTemplate: string, templateId: number, versao = 1): string {
  const base = String(nomeTemplate ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, MAX_NOME_MODELO_DO_TEMPLATE - 8).replace(/_+$/g, "") || `modelo_${templateId}`;
  return versao > 1 ? `${base}_v${versao}` : base;
}

export type ConversaoDoTemplate =
  | { ok: true; modelo: NovoModelo; variaveis: string[] }
  | { ok: false; problemas: string[] };

/** Converte o texto do template da Central no modelo da API oficial e confere as regras da Meta. */
export function converterTemplateParaModelo(p: { conteudo: string; nomeModelo: string; categoria: CategoriaNovoModelo }): ConversaoDoTemplate {
  const problemas: string[] = [];
  const conteudo = String(p.conteudo ?? "").replace(/\r\n?/g, "\n");
  if (placeholders(conteudo).some(x => !/^[a-zA-Z_]+$/.test(x))) {
    problemas.push("Use só as variáveis da Central ({{nome}}, {{corretor}}…); variáveis numeradas não são aceitas aqui.");
  }
  const variaveis: string[] = [];
  const corpo = conteudo.replace(VARIAVEL_NOMEADA, (_m, nome: string) => {
    const v = nome.toLowerCase();
    if (variaveis.includes(v)) {
      if (!problemas.some(x => x.includes(`{{${v}}}`))) problemas.push(`A variável {{${v}}} aparece mais de uma vez: na API oficial cada variável aparece uma vez só.`);
      return `{{${variaveis.indexOf(v) + 1}}}`;
    }
    variaveis.push(v);
    return `{{${variaveis.length}}}`;
  });
  if (problemas.length) return { ok: false, problemas };
  const modelo: NovoModelo = { nome: p.nomeModelo, categoria: p.categoria, corpo, exemplos: variaveis.map(exemploDaVariavel), rodape: null };
  const regras = problemasDoNovoModelo(modelo).map(x => x
    .replace("O texto não pode começar com uma variável.", "O texto não pode começar com uma variável (ex.: comece com \"Olá,\" antes de {{nome}}).")
    .replace("O texto não pode terminar com uma variável.", "O texto não pode terminar com uma variável: acrescente uma frase depois dela."));
  return regras.length ? { ok: false, problemas: regras } : { ok: true, modelo, variaveis };
}
