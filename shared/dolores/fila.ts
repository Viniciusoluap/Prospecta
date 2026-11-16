// EPIC-025 (Dolores, etapa 3) — regras puras das ações e da fila de aprovação: código curto do item, leitura
// DETERMINÍSTICA da decisão do dono ("aprovar CÓDIGO" / "recusar CÓDIGO"), prazo da tarefa, validade do item, texto da
// cobrança (montado pelo sistema, nunca pelo modelo) e o quadro de pendências que vai ao dono. Sem banco nem rede.

/** Alfabeto dos códigos: sem letras/números que se confundem no celular (0/O, 1/I/L, 2/Z, 5/S, 8/B, 6/G). */
export const ALFABETO_CODIGO = "ACDEFHJKMNPRTUVWXY3479";
export const TAMANHO_CODIGO = 5;
const CODIGO = new RegExp(`^[${ALFABETO_CODIGO}]{${TAMANHO_CODIGO}}$`);

/** Código curto de um item (sorteado por quem chama; `aleatorio` devolve números em [0, 1)). */
export function gerarCodigo(aleatorio: () => number): string {
  let c = "";
  for (let i = 0; i < TAMANHO_CODIGO; i++) c += ALFABETO_CODIGO[Math.floor(aleatorio() * ALFABETO_CODIGO.length) % ALFABETO_CODIGO.length];
  return c;
}
export const codigoValido = (c: string) => CODIGO.test(c);

export type SituacaoItem = "aguardando" | "executando" | "executada" | "recusada" | "vencida" | "erro";
export const ROTULO_SITUACAO: Record<SituacaoItem, string> = {
  aguardando: "aguardando aprovação", executando: "em execução", executada: "executada", recusada: "recusada", vencida: "vencida", erro: "com erro",
};

/** Validade do item na fila (horas): padrão, mínimo e máximo aceitos na configuração. */
export const VALIDADE_PADRAO_HORAS = 48;
export const VALIDADE_MINIMA_HORAS = 1;
export const VALIDADE_MAXIMA_HORAS = 24 * 14;
/** Linha "executando" mais velha que isto = a função morreu no meio: vira "erro" e NÃO é refeita. */
export const EXECUCAO_VENCIDA_MS = 3 * 60_000;
/** Teto de ações (diretas + itens na fila) que um único comando do dono pode gerar. */
export const MAX_ACOES_POR_COMANDO = 10;
/** Códigos por mensagem de decisão. */
export const MAX_CODIGOS_POR_DECISAO = 10;

export type Decisao = { decisao: "aprovar" | "recusar"; codigos: string[] };

/**
 * Decisão do dono, reconhecida por CÓDIGO (nunca pelo modelo): a mensagem INTEIRA precisa ser o verbo + um ou mais
 * códigos, e nada mais. "aprovar K7M2P", "Recusar K7M2P, AC3DE", "aprovo k7m2p." Qualquer outra coisa (frase, pedido
 * misturado, código que não existe no alfabeto) → null: a mensagem segue como comando comum, e o modelo não tem
 * ferramenta para aprovar nada.
 */
export function lerDecisaoDoDono(texto: string | null | undefined): Decisao | null {
  const t = String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().replace(/[.!]+$/, "").trim();
  if (!t || t.length > 120) return null;
  const m = /^(aprovar|aprovo|recusar|recuso)\s+(.+)$/i.exec(t);
  if (!m) return null;
  const partes = m[2].split(/\s*(?:,|\s+e\s+|\s+)\s*/i).map(p => p.trim().toUpperCase()).filter(Boolean);
  if (!partes.length || partes.length > MAX_CODIGOS_POR_DECISAO || !partes.every(codigoValido)) return null;
  return { decisao: /^aprov/i.test(m[1]) ? "aprovar" : "recusar", codigos: Array.from(new Set(partes)) };
}

/**
 * Intenção de AÇÃO na mensagem do dono, reconhecida por CÓDIGO (verbos de ação): sem ela, o laço do WhatsApp nem oferece
 * as ferramentas de ação ao modelo — o pedido é só de leitura. É reforço: a barreira principal é a contaminação
 * (server/dolores/cerebro.ts). Na dúvida (verbo de ação em qualquer lugar da frase), considera que há intenção.
 */
const VERBOS_DE_ACAO = new RegExp([
  "cri(?:e|ar|a|em)", "registr\\w*", "anot\\w*", "agend\\w*", "prepar\\w*", "ger(?:e|ar|a|em)", "lembr\\w*", "cobr\\w*",
  "marqu\\w*", "marc(?:ar|a)", "coloqu\\w*", "coloc(?:ar|a)", "lanc(?:e|ar|a)", "cadastr\\w*", "adicion\\w*",
  "inclu(?:a|ir)", "program\\w*",
].map(v => `\\b${v}\\b`).join("|"), "i");
export function intencaoDeAcao(texto: string | null | undefined): boolean {
  // QA R2 N1: o verbo de ação só vale no trecho do DONO (antes de qualquer marca de colagem/citação) — um e-mail colado
  // que diz "crie uma tarefa…" não é pedido dele.
  const t = trechoDoDono(texto).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return VERBOS_DE_ACAO.test(t);
}

/** Tamanho máximo do trecho do dono (o começo da mensagem) em que a intenção de ação é procurada. */
export const MAX_TRECHO_DO_DONO = 200;
/** Primeira marca de colagem/citação: quebra de linha, aspas, ">", "---"/"___"/"===", dois-pontos (que não seja de hora). */
const MARCA_DE_CORTE = /\r|\n|["“”«»]|>|-{3,}|_{3,}|={3,}|:(?!\d)/;

/**
 * O trecho que é do DONO: o começo da mensagem até a primeira marca de colagem ou citação (quebra de linha, aspas, ">",
 * "De:", "Assunto:", "Enviado:", "---", dois-pontos seguido de bloco), no máximo 200 caracteres. Cortar a mais só deixa
 * de oferecer as ações (lado seguro); nunca acrescenta pedido.
 */
export function trechoDoDono(texto: string | null | undefined): string {
  const s = String(texto ?? "");
  const m = MARCA_DE_CORTE.exec(s);
  return (m ? s.slice(0, m.index) : s).slice(0, MAX_TRECHO_DO_DONO);
}

/** Acima disto (caracteres ou linhas com texto), a mensagem é tratada como colagem. */
export const MAX_CARACTERES_PEDIDO_DIRETO = 300;
export const MAX_LINHAS_PEDIDO_DIRETO = 3;
const MARCAS_DE_COLAGEM: readonly RegExp[] = [
  /^\s*>/m, // citação de e-mail
  /(^|\n)\s*(de|from|para|to|cc|cco|bcc|assunto|subject|enviad[oa](?: em)?|sent|data|date)\s*:/i, // cabeçalho de e-mail
  /\b(assunto|subject|enviad[oa] em|mensagem original|original message|forwarded message|mensagem encaminhada)\b\s*:?/i,
  /-{3,}|_{3,}|={3,}/, // separador
  /["“«][^"“”«»]{40,}/, // aspas abrindo um bloco longo (título curto entre aspas não conta)
  /:(?!\d)[ \t]*\r?\n/, // dois-pontos seguido de bloco em outra linha
  /:(?!\d)[^\n]{120,}/, // dois-pontos seguido de bloco longo
  /\n[ \t]*\n/, // parágrafo novo
];

/**
 * A mensagem do dono tem cara de COLAGEM ou CITAÇÃO de texto de terceiro (QA R2 N1)? Mais de 3 linhas, mais de 300
 * caracteres ou qualquer marca de e-mail/citação. Se tiver, o comando nasce CONTAMINADO: nenhuma ação direta roda — toda
 * ação vai para a fila de aprovação, marcada. Mensagem curta e direta ("cria uma tarefa para a Bianca ligar para o João
 * amanhã") continua executando direto.
 */
export function pareceColagem(texto: string | null | undefined): boolean {
  const s = String(texto ?? "").trim();
  if (s.length > MAX_CARACTERES_PEDIDO_DIRETO) return true;
  if (s.split(/\r?\n/).filter(l => l.trim()).length > MAX_LINHAS_PEDIDO_DIRETO) return true;
  return MARCAS_DE_COLAGEM.some(r => r.test(s));
}

/** Início do resumo de um pedido de ação que surgiu DEPOIS de a Dolores ler dados do sistema neste comando. */
export const AVISO_PEDIDO_CONTAMINADO = "Pedido surgido durante a leitura de dados; confira antes de aprovar:";
/** Início do resumo de um pedido de ação feito numa mensagem com cara de texto colado ou citado (QA R2 N1). */
export const AVISO_PEDIDO_COLADO = "Pedido feito em mensagem com texto colado ou citado; confira antes de aprovar:";
export type MotivoContaminacao = "leitura" | "colagem";
export const avisoDaFila = (motivo: MotivoContaminacao | null | undefined) => (motivo === "colagem" ? AVISO_PEDIDO_COLADO : AVISO_PEDIDO_CONTAMINADO);

/**
 * Texto vindo de DADOS (nome de cliente, título, documento, resumo) antes de entrar num resumo, quadro ou frase que vai ao
 * dono: sem caracteres de controle nem de formatação invisível, toda quebra de linha/espaço vira um espaço só e
 * colchetes viram parênteses — um dado não consegue forjar uma linha "- [CÓDIGO] …" no quadro de pendências.
 */
export function textoDeDado(s: string | null | undefined, max = 600): string {
  return umaLinha(s, Number.MAX_SAFE_INTEGER).replace(/\[/g, "(").replace(/\]/g, ")").slice(0, max);
}

/** Uma linha só: sem caracteres de controle/invisíveis, espaços e quebras colapsados num espaço, cortada em `max`. */
export function umaLinha(s: string | null | undefined, max: number): string {
  return String(s ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Deslocamento fixo de Imperatriz (UTC−3, sem horário de verão). */
const FUSO_MS = 3 * 60 * 60_000;

/**
 * Prazo de tarefa vindo do pedido: "AAAA-MM-DD" (vale às 18:00, fim do expediente) ou "AAAA-MM-DDTHH:MM", no horário de
 * Imperatriz. Plausível = de hoje até 366 dias. Fora disso, ou data que não existe (31/02) → erro com o motivo.
 */
export function lerPrazo(texto: string, agora: Date): { ok: true; data: Date } | { ok: false; motivo: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(texto.trim());
  if (!m) return { ok: false, motivo: "prazo no formato AAAA-MM-DD ou AAAA-MM-DDTHH:MM" };
  const [a, mes, d, h = "18", min = "00"] = m.slice(1);
  const utc = Date.UTC(+a, +mes - 1, +d, +h, +min);
  const conferida = new Date(utc);
  if (conferida.getUTCFullYear() !== +a || conferida.getUTCMonth() !== +mes - 1 || conferida.getUTCDate() !== +d || +h > 23 || +min > 59)
    return { ok: false, motivo: "data que não existe" };
  const data = new Date(utc + FUSO_MS);
  // achado 9 do QA: hoje vale, mas só a partir de agora (09:00 → "hoje 08:00" é passado; "hoje" sem hora vale às 18:00)
  if (data.getTime() <= agora.getTime()) return { ok: false, motivo: "prazo no passado" };
  if (data.getTime() > agora.getTime() + 366 * 86_400_000) return { ok: false, motivo: "prazo a mais de um ano" };
  return { ok: true, data };
}

/** Primeiro nome para a saudação (sem sobrenome; nome vazio → sem nome). */
export function primeiroNome(nome: string | null | undefined): string {
  const p = String(nome ?? "").trim().split(/\s+/)[0] ?? "";
  return /^[A-Za-zÀ-ÖØ-öø-ÿ'-]{2,30}$/.test(p) ? p : "";
}

/**
 * Texto da cobrança de documentos — montado pelo SISTEMA com os documentos pendentes do cadastro (nunca pelo modelo,
 * para que nenhum texto vindo de dados entre na mensagem ao cliente). Fica como rascunho: a Dolores não envia.
 */
export function textoDaCobranca(p: { nome: string | null; documentos: readonly string[] }): string {
  const nome = primeiroNome(p.nome);
  const lista = p.documentos.slice(0, 15).map(d => `- ${textoDeDado(d, 120)}`).join("\n");
  const resto = p.documentos.length > 15 ? `\n- e mais ${p.documentos.length - 15} documento(s)` : "";
  return `Olá${nome ? `, ${nome}` : ""}! Aqui é da Prospecta Construções. Para darmos andamento ao seu processo, ainda precisamos dos documentos abaixo:\n${lista}${resto}\nPode nos enviar por aqui quando puder? Qualquer dúvida, estamos à disposição.`;
}

export type ItemQuadro = { codigo: string; resumo: string; venceEm: Date };

/**
 * Quadro determinístico que vai ao dono depois do comando: o que espera aprovação (o resumo é do sistema). Passa pelo
 * filtro de dados pessoais (sanitizarTexto) na saída: por isso o código vem ANTES do resumo em cada linha e a linha de
 * instrução não usa a palavra "código(s)" — o filtro trata "código …" como senha e apagaria o resto da oração.
 */
export function quadroDePendencias(itens: readonly ItemQuadro[], horaDe: (d: Date) => string): string {
  if (!itens.length) return "";
  // o resumo pode trazer dados (nome, documento): uma linha só e sem colchetes — só o sistema escreve "[CÓDIGO]"
  // o resumo vai INTEIRO (QA R2 N3: o dono lê tudo o que será gravado; o tamanho já foi limitado ao entrar na fila)
  const linhas = itens.slice(0, 10).map(i => `- [${i.codigo}] ${textoDeDado(i.resumo, Number.MAX_SAFE_INTEGER)} (vence ${horaDe(i.venceEm)})`);
  const mais = itens.length > 10 ? `\n- e mais ${itens.length - 10} item(ns) na tela Integrações › Dolores` : "";
  const exemplo = itens[0].codigo;
  return `*Aguardando a sua aprovação* (nada foi feito ainda):\n${linhas.join("\n")}${mais}\nResponda só "aprovar ${exemplo}" ou "recusar ${exemplo}" (pode pôr vários, separados por espaço).`;
}

/** Quadro do que ela já fez direto (tarefas, acompanhamentos), para o dono conferir. */
export function quadroDoQueFoiFeito(feitos: readonly string[]): string {
  if (!feitos.length) return "";
  return `*Registrado no sistema por mim* (em nome da usuária Dolores):\n${feitos.slice(0, 10).map(f => `- ${textoDeDado(f, 300)}`).join("\n")}${feitos.length > 10 ? `\n- e mais ${feitos.length - 10}` : ""}`;
}
