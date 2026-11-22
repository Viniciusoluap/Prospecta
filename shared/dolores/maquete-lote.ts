// EPIC-027 C5-COM (mesa comercial ligada à maquete, aprovada pelo dono em 21/11) — regras PURAS que a Dolores usa para achar o lote
// com maquete 3D, dizer se a página pública abre (e, se não, por quê), montar o link completo e o rascunho de mensagem ao cliente.
// Nada aqui lê banco nem envia nada: a leitura (server/dolores/leitura/maquete-lotes.ts) e a ação de gerar o link
// (server/dolores/acoes/maquete-lote.ts) usam estas funções. A página pública e o código do link são da maquete
// (server/maquete-3d/lotes.ts, shared/maquete-3d/lote-publico.ts): aqui só se reaproveita o mesmo endereço e o mesmo status.
import { CODIGO_RE, ROTULO_STATUS, SLUG_RE, caminhoDoLote, nomeDoLote, type StatusLote } from "../maquete-3d/lote-publico.js";
import { textoDeDado } from "./fila.js";
import { tratarLinksDaResposta } from "./links.js";

// ── Busca tolerante ("lote 4 da quadra 18", "qd18 lt4", "Vila Esmeralda") ──

export type BuscaDeLote = { quadra: string | null; lote: string | null; palavras: string[] };

const PALAVRAS_QUADRA = new Set(["quadra", "quadras", "qd", "qda", "qdr", "q", "quad"]);
const PALAVRAS_LOTE = new Set(["lote", "lotes", "lt", "l", "lot"]);
/** Palavras que não identificam o empreendimento (artigos, verbos comuns do pedido, "maquete", "link"…). */
const PALAVRAS_VAZIAS = new Set((
  "a o as os e da do das dos de no na nos nas em um uma uns umas pra pro para por com que qual quais me te se ai aqui ele ela "
  + "maquete maquetes 3d link links status situacao pagina publica numero n nº no. manda mande mandar envia envie enviar passa "
  + "passe passar gera gere gerar cria crie criar faz faca fazer texto mensagem rascunho cliente sobre tem esta esse essa este "
  + "dolores ver mostra mostre mostrar quero queria preciso"
).split(" "));

/** Minúsculas, sem acento; letras e números separados ("qd18" → "qd 18"); o resto vira espaço. */
export function normalizarBusca(s: string | null | undefined): string {
  return String(s ?? "").slice(0, 200).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\b3\s*d\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/([a-z])(\d)/g, "$1 $2").replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/\s+/g, " ").trim();
}

/** Número sem zeros à esquerda ("04" → "4"). */
const numero = (s: string) => s.replace(/^0+(?=\d)/, "");

/** Lê quadra, lote e as palavras do empreendimento. Número solto (sem "quadra"/"lote" antes) não é adivinhado. */
export function lerBuscaDeLote(texto: string | null | undefined): BuscaDeLote {
  const t = normalizarBusca(texto).split(" ").filter(Boolean);
  let quadra: string | null = null;
  let lote: string | null = null;
  const palavras: string[] = [];
  for (let i = 0; i < t.length; i++) {
    const p = t[i];
    const prox = t[i + 1];
    if (prox && /^\d{1,4}$/.test(prox) && (PALAVRAS_QUADRA.has(p) || PALAVRAS_LOTE.has(p))) {
      if (PALAVRAS_QUADRA.has(p)) quadra = numero(prox); else lote = numero(prox);
      i++;
      continue;
    }
    if (/^\d+$/.test(p) || PALAVRAS_QUADRA.has(p) || PALAVRAS_LOTE.has(p) || PALAVRAS_VAZIAS.has(p) || p.length < 3) continue;
    palavras.push(p);
  }
  return { quadra, lote, palavras: Array.from(new Set(palavras)).slice(0, 6) };
}

export type LoteParaBusca = { empreendimentoSlug: string; loteSlug: string; empreendimentoNome: string | null; quadra: string | null; loteNumero: string | null };

/** Quadra e lote do cadastro (texto do lote; sem ele, o endereço "qd18-lote4"). */
export function quadraELote(l: LoteParaBusca): { quadra: string | null; lote: string | null } {
  const doTexto = (s: string | null) => { const m = /\d{1,4}/.exec(normalizarBusca(s)); return m ? numero(m[0]) : null; };
  const slug = normalizarBusca(l.loteSlug);
  const q = doTexto(l.quadra) ?? (/\b(?:qd|qda|quadra|q)\s(\d{1,4})\b/.exec(slug)?.[1] ?? null);
  const lt = doTexto(l.loteNumero) ?? (/\b(?:lote|lt|l)\s(\d{1,4})\b/.exec(slug)?.[1] ?? null);
  return { quadra: q ? numero(q) : null, lote: lt ? numero(lt) : null };
}

/** O lote combina com a busca? Quadra e lote, quando ditos, iguais; cada palavra no nome ou no endereço do empreendimento. */
export function loteCombina(l: LoteParaBusca, b: BuscaDeLote): boolean {
  if (!b.quadra && !b.lote && !b.palavras.length) return false;
  const ql = quadraELote(l);
  if (b.quadra && ql.quadra !== b.quadra) return false;
  if (b.lote && ql.lote !== b.lote) return false;
  const onde = ` ${normalizarBusca(`${l.empreendimentoNome ?? ""} ${l.empreendimentoSlug}`)} `;
  return b.palavras.every(p => onde.includes(` ${p}`));
}

// ── Textos do lote (dado do cadastro: uma linha, sem link) ──

/** Nome do cadastro para mostrar: uma linha, curto e sem nada que a saída trocaria por "[link removido]"; senão, o reserva. */
export function textoDoCadastro(s: string | null | undefined, max: number, reserva: string): string {
  const t = textoDeDado(s, max).replace(/[*_~`]/g, "").trim();
  return t && tratarLinksDaResposta(t, null) === t ? t : reserva;
}

export type TextosDoLoteDolores = { empreendimento: string; quadra: string | null; lote: string | null };

/** "Lote 4, Quadra 18 (Vila Esmeralda)". */
export const nomeCompletoDoLote = (t: TextosDoLoteDolores) => `${nomeDoLote(t)} (${t.empreendimento})`;

/** Quadra/lote do cadastro: só letras, números, espaço e hífen (flag `u` via `new RegExp`: o literal não passa no tsc daqui). */
const CURTO = new RegExp("^[\\p{L}\\p{N} -]{1,20}$", "u");

/** Textos limpos do lote (empreendimento do cadastro ou o endereço; quadra/lote só número/letras curtos). */
export function textosDoLote(l: LoteParaBusca): TextosDoLoteDolores {
  const ql = quadraELote(l);
  const curto = (s: string | null, n: string | null) => { const t = textoDoCadastro(s, 20, ""); return CURTO.test(t) ? t : n; };
  return {
    empreendimento: textoDoCadastro(l.empreendimentoNome, 80, l.empreendimentoSlug.replace(/-/g, " ")),
    quadra: curto(l.quadra, ql.quadra),
    lote: curto(l.loteNumero, ql.lote),
  };
}

// ── Página pública e link ──

export type MotivoPagina = "desligada" | "sem_link" | "maquete_indisponivel" | "sem_publicacao" | "versao_nao_publicada" | "planta_mudou";
/** O motivo em linguagem simples (vai ao dono). */
export const MOTIVO_PAGINA: Record<MotivoPagina, string> = {
  desligada: "a página deste lote está desligada na tela da maquete",
  sem_link: "o lote ainda não tem link (posso gerar, se você quiser)",
  maquete_indisponivel: "a maquete ligada a este lote não está disponível",
  sem_publicacao: "a maquete ainda não tem nenhuma versão publicada",
  versao_nao_publicada: "a versão escolhida para este lote não foi publicada",
  planta_mudou: "a versão publicada foi feita para uma planta anterior; é preciso escolher outra versão na tela da maquete",
};
export const MOTIVO_SEM_ENDERECO = "o endereço público do sistema não está configurado no servidor; o link aparece na tela da maquete";

export type SituacaoParaPagina = {
  ativo: boolean; codigoLink: string | null; maqueteOk: boolean;
  /** Versão que o lote mostra (a fixada ou a publicada da maquete). */
  versaoEfetiva: number | null;
  /** A versão efetiva existe e foi publicada (situação publicada/arquivada). */
  versaoPublicada: boolean;
  /** O hash da versão confere com a planta atual. */
  versaoValeParaPlanta: boolean;
};

/** Por que a página pública NÃO abre (as mesmas condições de server/maquete-3d/lotes.ts#lotePublico); null = abre. */
export function motivoDaPagina(s: SituacaoParaPagina): MotivoPagina | null {
  if (!s.ativo) return "desligada";
  if (!s.codigoLink || !CODIGO_RE.test(s.codigoLink)) return "sem_link";
  if (!s.maqueteOk) return "maquete_indisponivel";
  if (!s.versaoEfetiva) return "sem_publicacao";
  if (!s.versaoPublicada) return "versao_nao_publicada";
  if (!s.versaoValeParaPlanta) return "planta_mudou";
  return null;
}

/**
 * Origem dos links públicos: a MESMA variável que o sistema usa para montar os seus endereços públicos e que a saída ao dono
 * deixa passar (PUBLIC_SITE_URL; shared/dolores/links.ts). Sai como a saída a mostra (https, só o host): o link chega intacto.
 * Sem a variável (ou inválida): null — nunca um domínio inventado.
 */
export function origemPublica(urlDoSistema: string | null | undefined): string | null {
  const bruto = String(urlDoSistema ?? "").trim();
  if (!bruto) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(bruto) ? bruto : `https://${bruto}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.hostname ? `https://${u.hostname.toLowerCase()}` : null;
  } catch { return null; }
}

/** Link completo da página pública do lote; null se faltar a origem ou se o endereço não for válido. */
export function linkDoLote(origem: string | null, empreendimentoSlug: string, loteSlug: string, codigo: string | null): string | null {
  if (!origem || !codigo || !SLUG_RE.test(empreendimentoSlug) || !SLUG_RE.test(loteSlug) || !CODIGO_RE.test(codigo)) return null;
  return `${origem}${caminhoDoLote(empreendimentoSlug, loteSlug, codigo)}`;
}

export const rotuloDoStatus = (s: StatusLote | null) => (s ? ROTULO_STATUS[s].toLowerCase() : null);

// ── Rascunho de mensagem ao cliente (modelo fixo; nada é enviado) ──

export type TomDoRascunho = "proximo" | "formal";
export type PedidoDeRascunho = TextosDoLoteDolores & { link: string; tom?: TomDoRascunho; nome?: string | null; valor?: string | null };

/**
 * Texto curto, pronto para o DONO copiar e encaminhar: modelo fixo + nome do lote + link (por código, intactos). Sem preço —
 * só entra o valor que o dono ditou no mesmo pedido (conferido antes, por quem chama).
 */
export function rascunhoDoLote(p: PedidoDeRascunho): string {
  const nome = p.nome ? `, ${p.nome}` : "";
  const lote = nomeCompletoDoLote(p);
  const valor = p.valor ? `\nValor: ${p.valor}.` : "";
  return p.tom === "formal"
    ? `Olá${nome}. Segue a maquete 3D do ${lote}, para visualizar pelo celular ou pelo computador:\n${p.link}${valor}\nFico à disposição para qualquer dúvida.`
    : `Olá${nome}! Separei para você a maquete 3D do ${lote}. Dá para ver o lote por dentro e por fora pelo celular:\n${p.link}${valor}\nQualquer dúvida, é só me chamar por aqui.`;
}

/** O trecho (nome do cliente, valor) saiu das palavras do dono nesta mensagem? Comparação sem acento, caixa e espaços extras. */
export function ditoPeloDono(trecho: string, pedidoDoDono: string | null | undefined): boolean {
  const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const t = n(trecho);
  return !!t && !!pedidoDoDono && n(pedidoDoDono).includes(t);
}

/** Cabeçalho do quadro do sistema com o rascunho (vai ao dono abaixo da resposta; nada foi enviado). */
export const TITULO_RASCUNHO = "*Texto pronto para você encaminhar* (não enviei a ninguém):";
