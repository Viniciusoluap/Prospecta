// EPIC-027 C7 (20/11/2026) — regras puras da integração com a YCloud (API oficial do WhatsApp), usadas pelo servidor e pela tela.
// Fontes (documentação oficial, conferida em 20/11/2026):
// - limites por tier e escopo de portfólio: https://docs.ycloud.com/en/documentation/whatsapp-business-platform/pricing-limits-and-quality/messaging-limits-and-throughput
// - campos do número (messagingLimit, whatsappBusinessManagerMessagingLimit, status, qualityRating): https://docs.ycloud.com/api-reference/whatsapp-phone-numbers/list-phone-numbers.md
// - 5 mensagens/s fixas em coexistência: https://docs.ycloud.com/en/documentation/channels/whatsapp-accounts-management/coexistence/onboard-whatsapp-business-app
// - situação convergente (não só "a mais alta vale"): https://docs.ycloud.com/en/api-reference/guides/whatsapp-platform/whatsapp-messages-api-best-practices.md

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

/** De onde vem o valor de cada variável: do cadastro (nome) ou um texto fixo digitado pelo administrador. */
export type FonteVariavel = { fonte: "primeiro_nome" | "nome_completo" } | { fonte: "fixo"; texto: string };

/** A Meta recusa parâmetro com quebra de linha, tabulação ou 4+ espaços seguidos (regra da Cloud API). */
export function problemaDoParametro(valor: string, limite: number): string | null {
  if (!valor.trim()) return "vazio";
  if (/[\n\r\t]/.test(valor) || / {4,}/.test(valor)) return "tem quebra de linha, tabulação ou espaços seguidos";
  if (valor.length > limite) return `passa de ${limite} caracteres`;
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
