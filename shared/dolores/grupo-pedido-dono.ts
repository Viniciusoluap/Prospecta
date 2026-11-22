// EPIC-027 C5 (E3, "registrar a partir do grupo") — regras PURAS do pedido do DONO feito dentro de um grupo (sem banco nem rede).
// Decisão do dono (CLAUDE.md, 21/11/2026, itens 4 e 5): "A partir de grupo: só quando o número do dono pede, e só para REGISTRAR;
// o grupo vê uma frase curta ('Anotado.')". Nunca dinheiro, nunca mensagem a terceiro, nunca ação séria (essas, na conversa direta).
// - Quem pede é reconhecido por CÓDIGO, só pelo `key.participant` da mensagem (posto pelo WhatsApp/Evolution): número igual ao do
//   dono, ou um @lid que o SERVIDOR do WhatsApp (lista de participantes da Evolution) liga ao número do dono — isso é conferido em
//   server/dolores/grupo-pedido-dono.ts. Nunca `participantPn`/`participantAlt`, nome exibido ou texto da mensagem.
// - O que ele pede é reconhecido por CÓDIGO (lista fechada de verbos, no começo da mensagem): anotar/registrar um texto, ou salvar
//   uma nota/documento/orçamento do próprio grupo. O resto não é pedido de registro (segue o caminho comum da marcação).
// - Pedido de ação séria (cobrar, pagar, mandar mensagem, aceitar/classificar grupo, apagar…) é reconhecido para ser RECUSADO com
//   orientação no privado; nada é feito.
import { umaLinha } from "./fila.js";

/** O grupo vê só isto quando o pedido de registro do dono virou proposta (o detalhe vai a ele no privado). */
export const FRASE_ANOTADO = "Anotado.";
/** O grupo vê só isto quando o dono pede no grupo algo que ela só faz na conversa direta. */
export const FRASE_SO_NO_PRIVADO = "Isso eu vejo com você no privado.";
/** Pedidos de registro do dono a partir de grupos, por dia (todos os grupos somados). */
export const MAX_PEDIDOS_DONO_DIA = 20;
/** Sem mensagem citada: vale a última mídia do grupo dentro desta janela. */
export const JANELA_MIDIA_MS = 2 * 60 * 60_000;
/** Consultas à Evolution para provar um @lid do dono, por grupo e por hora. */
export const MAX_CONSULTAS_LID_DONO_HORA = 6;

export type PedidoDoDono =
  /** Anotação no cliente do grupo. `texto` null = usa o texto da mensagem citada. */
  | { tipo: "anotar"; texto: string | null }
  /** Salvar a nota/documento/orçamento (mensagem citada, a própria mensagem ou a última mídia do grupo). */
  | { tipo: "salvar"; objeto: "nota" | "documento" | "orcamento" }
  /** Pedido que não se faz a partir de grupo: recusado, com orientação no privado. */
  | { tipo: "serio"; motivo: string }
  /** Verbo de registro, mas sem saber o que registrar: nada é feito; o dono é avisado no privado. */
  | { tipo: "nao_entendi" };

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Começo comum descartado: "Dolores,", "por favor", "aí". */
const ABERTURA = /^(?:\s*(?:dolores|dona dolores|oi|ola|por favor|pfv|pf|ai|ei)\b[\s,.:;!-]*)+/;

/** Pedidos sérios, pelo verbo no começo (imperativo ou infinitivo). Na dúvida, recusa (nada é feito). */
const SERIOS: ReadonlyArray<[RegExp, string]> = [
  [/^(?:cobr|pag[auo]|pague|pix\b|transfir|transfer|deposit|reembols|estorn|concili|baix[ae]r? (?:o )?pagamento)/, "mexe com dinheiro"],
  [/^(?:mand[ae]r?|envi[ae]r?|encaminh|respond[ae]r?|fal[ae]r? com|avis[ae]r?|lig[ae]r? (?:pr[oa]|para)|chama|notific|dispar)/, "é mensagem para outra pessoa"],
  [/^(?:aceit|classific|vincul|desvincul|lig[ae]r? (?:a )?resposta|deslig|ignor[ae]|sai[ar]? (?:do|deste) grupo)/, "muda a configuração de um grupo"],
  [/^(?:apag|exclu|remov|delet|cancel|desfaz|arquiv[ae]r? (?:o )?(?:cliente|card|processo))/, "apaga ou desfaz algo"],
  [/^(?:mud[ae]r?|alter|troc|atualiz|edit|corrig|move|mova|aprov|confirm[ae]r? (?:o|a) )/, "altera um cadastro"],
  [/^(?:cri[ae]r?|abr[ae]r?|agend|marc[ae]r? (?:uma )?(?:reuniao|visita))/, "é tarefa ou agenda, que eu crio pela nossa conversa"],
];

/** Objeto de "salvar": o que a mensagem diz que é. */
const OBJ_NOTA = /\b(?:nota|notas|nf|nfe|nfs|cupom|recibo)\b/;
const OBJ_ORCAMENTO = /\b(?:orcamento|orcamentos|proposta)\b/;
const OBJ_DOC = /\b(?:documento|documentos|doc|docs|arquivo|arquivos|foto|fotos|imagem|pdf|comprovante|contrato|planta|isso|isto|esse|essa|este|esta|ai|aqui)\b/;
/** Sobra permitida depois do objeto ("salva essa nota aí na pasta da obra, por favor"). */
const SOBRA_SALVAR = /^(?:\s|[,.!]|\b(?:a|o|as|os|essa|esse|esta|este|isso|isto|ai|aqui|ali|pra|para|mim|por favor|pfv|no|na|nos|nas|pasta|card|cadastro|cliente|obra|drive|sistema|ficha|do|da|de|dele|dela|que|eu|mandei|enviei|ele|ela|mandou|enviou|acima|anterior|ultima|ultimo|nota|notas|nf|nfe|nfs|cupom|recibo|orcamento|orcamentos|proposta|documento|documentos|doc|docs|arquivo|arquivos|foto|fotos|imagem|pdf|comprovante|contrato|planta|fiscal|fiscais)\b)*$/;
/** "anota isso", "registra essa mensagem": usa a mensagem citada. */
const SO_REFERENCIA = /^(?:isso|isto|essa|esse|esta|este|aquilo|essa mensagem|esta mensagem|a mensagem|o que ele disse|o que ela disse|o que foi dito)(?:\s+(?:ai|aqui|ali|por favor|pfv|no cliente|no historico|na ficha))*$/;

/**
 * O pedido do dono (texto da marcação, já sem as menções). Só a forma, por código; quem pediu é conferido no servidor.
 * null = não é pedido de registro nem pedido sério (segue a marcação comum, que responde como a qualquer participante).
 */
export function lerPedidoDoDono(pergunta: string | null | undefined): PedidoDoDono | null {
  const original = umaLinha(String(pergunta ?? ""), 1200);
  const n = sem(original);
  const abertura = ABERTURA.exec(n)?.[0].length ?? 0;
  const corpo = n.slice(abertura).trim();
  if (!corpo) return null;
  // um sufixo de `n` volta às letras originais (acentos, maiúsculas) pela mesma posição: tirar os acentos de um texto NFC não muda
  // o número de caracteres. Se mudou (texto em outra forma), fica o texto sem acento — nunca um pedaço errado.
  const original_ = (sufixo: string) => (n.length === original.length ? original.slice(n.length - sufixo.length) : sufixo).trim();

  // 1) anotar / registrar (o conteúdo é DADO: entra como texto da anotação, nunca vira instrução)
  const an = /^(?:anot[ae]r?|anota ai|registr[ae]r?|regist[ae])\b/.exec(corpo);
  if (an) {
    const resto = corpo.slice(an[0].length).replace(/^\s*(?:ai|aqui)\b/, "").replace(/^\s*(?:n[oa] (?:historico|cliente|card|ficha|cadastro)(?: d[oa] cliente)?)\b/, "").replace(/^\s*que\b/, "").replace(/^[\s:,;.\-–—]+/, "").trim();
    // "registra essa nota", "anota esse documento": é salvar
    if (/^(?:ess[ae]|est[ae]|a|o)\s/.test(resto) && SOBRA_SALVAR.test(resto) && (OBJ_NOTA.test(resto) || OBJ_ORCAMENTO.test(resto) || /\b(?:documento|doc|arquivo|foto|imagem|pdf|comprovante|contrato|planta)\b/.test(resto))) {
      return { tipo: "salvar", objeto: OBJ_NOTA.test(resto) ? "nota" : OBJ_ORCAMENTO.test(resto) ? "orcamento" : "documento" };
    }
    if (!resto || SO_REFERENCIA.test(resto)) return { tipo: "anotar", texto: null };
    // "anota e cobra o João": a 2ª parte seria uma ação; na dúvida, nada (pede na conversa direta)
    for (const [re, motivo] of SERIOS) if (/^e\s/.test(resto) && re.test(resto.replace(/^e\s+/, ""))) return { tipo: "serio", motivo };
    // o texto da anotação, com as letras originais (acentos, maiúsculas)
    return { tipo: "anotar", texto: original_(resto) || null };
  }
  // 2) salvar / guardar / arquivar (só objeto do próprio grupo)
  const sv = /^(?:salv[ae]r?|guard[ae]r?|arquiv[ae]r?|anex[ae]r?)\b/.exec(corpo);
  if (sv) {
    const resto = corpo.slice(sv[0].length).trim();
    for (const [re, motivo] of SERIOS.slice(3, 4)) if (re.test(corpo)) return { tipo: "serio", motivo }; // "arquiva o cliente"
    if (!resto || !SOBRA_SALVAR.test(resto)) return resto ? { tipo: "nao_entendi" } : { tipo: "salvar", objeto: "documento" };
    if (OBJ_NOTA.test(resto)) return { tipo: "salvar", objeto: "nota" };
    if (OBJ_ORCAMENTO.test(resto)) return { tipo: "salvar", objeto: "orcamento" };
    if (OBJ_DOC.test(resto) || !resto) return { tipo: "salvar", objeto: "documento" };
    return { tipo: "nao_entendi" };
  }
  // 3) pedido sério: recusado com orientação no privado
  for (const [re, motivo] of SERIOS) if (re.test(corpo)) return { tipo: "serio", motivo };
  return null;
}

const JID_NUMERO = /^(\d{10,15})@s\.whatsapp\.net$/;
const JID_LID = /^(\d{5,25})@lid$/;

/**
 * Quem mandou a mensagem de grupo, SÓ pelo `key.participant` (posto pelo WhatsApp): número (`…@s.whatsapp.net`) ou @lid. Mensagem
 * da própria conta, sem participante ou em outra forma (device ":12@", @c.us) → null (não dá para provar nada).
 */
export function remetenteDoGrupo(item: unknown): { numero: string; lid: null } | { numero: null; lid: string } | null {
  const key = ((item ?? {}) as { key?: Record<string, unknown> }).key ?? {};
  if (key.fromMe === true || typeof key.remoteJid !== "string" || !key.remoteJid.endsWith("@g.us")) return null;
  const p = typeof key.participant === "string" ? key.participant.trim() : "";
  const n = JID_NUMERO.exec(p);
  if (n) return { numero: n[1], lid: null };
  if (JID_LID.test(p)) return { numero: null, lid: p };
  return null;
}

/** Id da mensagem CITADA (`contextInfo.stanzaId` do conteúdo de topo; temporária desembrulhada). Sem citação → null. */
export function idDaMensagemCitada(item: unknown): string | null {
  const d = (item ?? {}) as { message?: Record<string, any> | null; contextInfo?: Record<string, any> | null };
  let m: Record<string, any> = d.message ?? {};
  for (let i = 0; i < 4 && m?.ephemeralMessage?.message; i++) m = m.ephemeralMessage.message;
  const cis = ["extendedTextMessage", "imageMessage", "videoMessage", "documentMessage", "audioMessage"].map(k => m?.[k]?.contextInfo)
    .concat([m?.documentWithCaptionMessage?.message?.documentMessage?.contextInfo, d.contextInfo]);
  for (const ci of cis) {
    const id = ci && typeof ci === "object" ? (ci as Record<string, unknown>).stanzaId : null;
    if (typeof id === "string" && /^[A-Za-z0-9_-]{6,160}$/.test(id.trim())) return id.trim();
  }
  return null;
}
