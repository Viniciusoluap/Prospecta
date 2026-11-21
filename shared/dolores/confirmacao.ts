// EPIC-027 C5 (E2, "a Dolores resolve") — confirmação em linguagem natural, regras PURAS (sem banco nem rede).
// Decisão do dono (21/11/2026): criar tarefa, anotação e registros simples → a Dolores propõe e faz quando ele responde "pode";
// ação séria (dinheiro, aceitar grupo que outra pessoa criou, tipos de grupo que liberam mais, cobrança) → só com a palavra
// "confirmo". Quem reconhece a resposta é o CÓDIGO (a mensagem inteira, curta, de uma lista fechada) e quem decide o nível é o
// CÓDIGO (função + argumentos guardados do item) — nunca a IA, nunca texto de consulta, de grupo ou de terceiro.

/** Nível de confirmação de um item proposto. */
export type NivelConfirmacao = "registro" | "serio";

/** Validade da proposta pendente: registro 15 min; séria 10 min (decisão de arquitetura do plano C5, 2.2.4). */
export const VALIDADE_PENDENCIA_MS: Readonly<Record<NivelConfirmacao, number>> = { registro: 15 * 60_000, serio: 10 * 60_000 };
/** Validade dos itens que nascem numa conversa com confirmação natural (o item não passa da pendência mais longa). */
export const VALIDADE_ITEM_CONFIRMAVEL_MS = VALIDADE_PENDENCIA_MS.registro;
/** Resposta curta: acima disto (ou com quebra de linha) não é confirmação — segue como pedido comum. */
export const MAX_CARACTERES_CONFIRMACAO = 40;
/** Itens por pendência (o mesmo teto de ações por comando). */
export const MAX_ITENS_PENDENCIA = 10;

export type Confirmacao = { tipo: "sim" | "confirmo" | "nao" };

/** Sem acento, minúsculo, pontuação vira espaço (vírgula, ponto, exclamação, emoji de positivo), espaços colapsados. */
export function normalizarResposta(texto: string | null | undefined): string {
  return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Lista FECHADA (mensagem inteira, depois de normalizar). "pode sim, e cria outra…" não está aqui: não é confirmação. */
const AFIRMATIVAS = new Set([
  "pode", "pode sim", "sim", "sim pode", "pode fazer", "pode sim fazer", "pode ir", "pode seguir", "pode mandar ver", "faz", "faca",
  "faz sim", "faca sim", "ok", "okay", "ok pode", "pode ok", "isso", "isso mesmo", "isso pode", "manda ver", "beleza", "beleza pode",
  "pode beleza", "certo pode", "sim por favor", "pode por favor", "por favor pode", "claro", "claro pode", "positivo",
]);
const CONFIRMO = new Set(["confirmo", "eu confirmo", "confirmo sim", "sim confirmo", "confirmo pode", "pode confirmo"]);
const NEGATIVAS = new Set([
  "nao", "nao pode", "nao precisa", "nao faz", "nao faca", "nao quero", "cancela", "cancelar", "cancela isso", "deixa", "deixa pra la",
  "deixa para la", "esquece isso", "nao obrigado", "agora nao", "melhor nao", "recuso", "nao confirmo",
]);

/**
 * A resposta do dono a uma proposta, reconhecida por CÓDIGO: a mensagem INTEIRA, até 40 caracteres, sem quebra de linha, de uma
 * lista fechada. Qualquer outra coisa → null (a mensagem segue como pedido comum, para a IA com a memória — que no máximo
 * PROPÕE de novo, nunca executa).
 */
export function lerConfirmacao(texto: string | null | undefined): Confirmacao | null {
  const bruto = String(texto ?? "");
  if (!bruto.trim() || bruto.length > MAX_CARACTERES_CONFIRMACAO || /[\r\n]/.test(bruto)) return null;
  const t = normalizarResposta(bruto);
  if (!t) return null;
  if (CONFIRMO.has(t)) return { tipo: "confirmo" };
  if (AFIRMATIVAS.has(t)) return { tipo: "sim" };
  if (NEGATIVAS.has(t)) return { tipo: "nao" };
  return null;
}

/** Tipos de grupo que liberam mais (sócios, jurídico, parceiros): definir/ligar a resposta neles é ação séria. */
export const TIPOS_DE_GRUPO_SERIOS = ["administrativo", "juridico", "parceiros"] as const;
const ehTipoSerio = (t: unknown) => typeof t === "string" && (TIPOS_DE_GRUPO_SERIOS as readonly string[]).includes(t);

/**
 * Nível de um item da fila, POR CÓDIGO, só pela função e pelos argumentos guardados (que o gatilho do banco não deixa mudar).
 * Sério: envolve dinheiro (conciliar nota com pagamento), leva mensagem a cliente (cobrança preparada), aceita grupo em que outra
 * pessoa colocou a Dolores, ou define/liga grupo de tipo que libera mais. Função desconhecida → sério (na dúvida, o mais forte).
 */
export function nivelDoItem(funcao: string, argumentos: unknown): NivelConfirmacao {
  const a = (argumentos && typeof argumentos === "object" ? argumentos : {}) as Record<string, unknown>;
  switch (funcao) {
    case "criar_tarefa": case "registrar_acompanhamento": case "gerar_documento": case "criar_card_cliente":
    case "salvar_documentos_grupo": case "salvar_nota_obra": case "ignorar_grupo":
      return "registro";
    case "classificar_grupo":
      return ehTipoSerio(a.tipo) ? "serio" : "registro";
    case "ligar_resposta_grupo":
      return a.ligado === true && ehTipoSerio(a.tipo) ? "serio" : "registro";
    case "preparar_cobranca": case "conciliar_nota_obra": case "aceitar_grupo":
    default:
      return "serio";
  }
}

/** Nível de um conjunto: basta um item sério para tudo pedir "confirmo". */
export const nivelDoConjunto = (niveis: readonly NivelConfirmacao[]): NivelConfirmacao => (niveis.includes("serio") ? "serio" : "registro");

/** Por que pede "confirmo" (uma frase curta, sem dado). */
export function motivoDoSerio(funcoes: readonly string[]): string {
  if (funcoes.includes("conciliar_nota_obra")) return "mexe com pagamento";
  if (funcoes.includes("preparar_cobranca")) return "é uma cobrança a cliente";
  if (funcoes.includes("aceitar_grupo")) return "é um grupo em que outra pessoa me colocou";
  return "libera mais coisa do que eu posso dizer no grupo";
}

/**
 * Pergunta do SISTEMA ao dono, logo abaixo da resposta da Dolores: o resumo exato de cada item (montado pelo sistema, conferido por
 * hash na execução), sem código. Não usa a palavra "código" (o filtro de saída trata "código …" como senha).
 */
export function perguntaDaPendencia(resumos: readonly string[], nivel: NivelConfirmacao, funcoes: readonly string[], restantes = 0): string {
  const itens = resumos.map(r => `- ${r}`).join("\n");
  const mais = restantes > 0 ? `\n(Há mais ${restantes} proposta(s) que não couberam aqui: confira em Integrações › Dolores.)` : "";
  if (nivel === "serio") {
    return `*Isto precisa da sua confirmação por escrito* (${motivoDoSerio(funcoes)}):\n${itens}${mais}\nSe é isso mesmo, responda: confirmo. Para deixar de lado, responda "não". Vale por 10 minutos.`;
  }
  return `*Posso fazer isto?*\n${itens}${mais}\nResponda "pode" para eu fazer, ou "não" para deixar de lado. Vale por 15 minutos.`;
}

export const FRASE_RECUSADA = "Certo, deixei de lado. Nada foi feito.";
export const FRASE_JA_FEITO = "Isso eu já fiz; não repeti.";
export const FRASE_JA_RECUSADA = "Essa proposta você já tinha recusado; nada foi feito.";
export const FRASE_VENCIDA = "Essa proposta venceu e nada foi feito. Se ainda quiser, me peça de novo.";
export const FRASE_SEM_TEMPO = "Não deu tempo de fazer agora; nada foi feito. Responda \"pode\" de novo.";
export const FRASE_ERRO_CONFIRMACAO = "Não consegui registrar a sua resposta agora; nada foi feito. Tente de novo em instantes.";

/** "sim"/"pode" numa proposta séria: repete a frase exata que ele precisa escrever. */
export const fraseFaltaConfirmo = (funcoes: readonly string[]) =>
  `Esse precisa da sua confirmação por escrito, porque ${motivoDoSerio(funcoes)}. Se é isso mesmo, responda: confirmo`;

/** "pode" depois de outra mensagem ter chegado a ele: mostra de novo o que está esperando, antes de fazer. */
export const fraseForaDeOrdem = (resumos: readonly string[], nivel: NivelConfirmacao) =>
  `Antes de fazer, confira o que ainda está esperando a sua resposta:\n${resumos.map(r => `- ${r}`).join("\n")}\nSe é isso mesmo, responda ${nivel === "serio" ? "confirmo" : "\"pode\""}.`;
