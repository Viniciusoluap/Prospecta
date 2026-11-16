// EPIC-025 (Dolores) — filtro de dados pessoais em TEXTO LIVRE (anotações, mensagens, títulos, observações), aplicado
// pela ponte a TODA string que sai para o agente, aos argumentos guardados na auditoria e à resposta ao dono no WhatsApp.
// Melhor esforço: pega os formatos comuns; não garante achar tudo o que alguém escreveu à mão. Campos estruturados já
// mascarados ("***.***.***-01", "(99) *****-4567") passam intactos (não têm a sequência de dígitos).
//
// Como decide (QA r2, N1 e N7):
//  1. Normaliza só o que serve para disfarçar: dígitos e sinais de largura total (１２３, ＠, ＋), caracteres invisíveis
//     (zero-width, U+FEFF, hífen suave) e hífens tipográficos entre dígitos (U+2010–2015, U+2212). O resto do texto
//     (acentos, "m²", "nº", travessão na prosa) não muda.
//  2. Junta grupos de dígitos separados por até 3 caracteres de [espaço . - _ / ( )] numa "cadeia" e procura, dentro
//     dela, CPF ou CNPJ com dígito verificador válido (em qualquer separação comum) e telefone brasileiro plausível
//     (com ou sem 55, DDD colado, pontuado ou entre parênteses; celular com 9; fixo começando por 2–9).
//  3. Celular, CPF e CNPJ válidos saem SEMPRE. Fixo (8 ou 10 dígitos) e sequência de 11 dígitos sem forma conhecida
//     ficam quando o rótulo logo antes diz o que é (processo, protocolo, nota fiscal, área, valor, lote, quadra…) ou
//     quando vem unidade de medida depois; intervalos de anos (2024-2026) ficam. Na dúvida real, sai: o marcador é
//     visível, e a Dolores nunca apresenta número alterado como dado.
import { isValidCPF } from "../cpf.js";

export const OMITIDO = "[dado pessoal omitido]";
export const SENHA_OMITIDA = "[senha omitida]";
export const BANCARIO_OMITIDO = "[dado bancário omitido]";

function cnpjValido(d: string): boolean {
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const dv = (base: string, pesos: number[]) => {
    const s = pesos.reduce((t, p, i) => t + Number(base[i]) * p, 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return dv(d, p1) === Number(d[12]) && dv(d, [6, ...p1]) === Number(d[13]);
}

// ── 1. Normalização ──
// Invisíveis: o ZWJ (U+200D) só fica quando junta emojis (família, profissões); nos outros lugares sai.
const INVISIVEIS = /[​‌⁠-⁤﻿­᠎͏]|(?<!\p{Extended_Pictographic}️?)‍/gu;
const LARGURA_TOTAL = /[！-～]/g;
const DIGITOS_MATEMATICOS = /[\u{1D7CE}-\u{1D7FF}]/gu;
const HIFEN_ENTRE_DIGITOS = /(?<=\d\s?)[‐-―−﹘﹣](?=\s?\d)/g;

/** Tira os disfarces mais comuns de números e e-mails (ver o cabeçalho). Exportada para os testes. */
export function normalizarParaFiltro(texto: string): string {
  return texto
    .replace(INVISIVEIS, "")
    .replace(LARGURA_TOTAL, c => c.normalize("NFKC"))
    .replace(DIGITOS_MATEMATICOS, c => c.normalize("NFKC"))
    .replace(HIFEN_ENTRE_DIGITOS, "-");
}

// ── Senha, banco, e-mail e os formatos canônicos (sempre saem) ──
// Palavra de senha/código: tudo até o fim da oração (ponto, ponto e vírgula, vírgula, quebra de linha).
const SENHA = /\b(senhas?|password|passwd|c[oó]digos?|token|pin)\b.*?(?=[;\n]|[.,!?](?:\s|$)|$)/gi;
// Agência, conta, PIX: o rótulo fica, o número/chave sai.
const BANCARIO = /\b(ag[eê]ncia|ag\.?|conta(?:\s+corrente|\s+poupan[cç]a)?|c\/c|cc|chave\s+pix|pix)\b(\s*(?:n[ºo°.]?|:|#|-)?\s*)((?=[^\s]*[\d@])[\w.@+\-/]+)/gi;
// E-mail: "a@b.com", "a @ b.com", "a[at]b.com", "a (arroba) b.com" e, colado, sem domínio de topo ("a@b").
const EMAIL = /[\w.+-]+(?:\s?@\s?|\s?[[(]\s?(?:at|arroba)\s?[\])]\s?)[\w-]+(?:\.[\w-]+)+|[\w.+-]+@[\w-]+/gi;
const CPF_FORMATADO = /(?<!\d)\d{3}[.,]\d{3}[.,]\d{3}[-.]?\d{2}(?!\d)/g;
const CNPJ_FORMATADO = /(?<!\d)\d{2}\.\d{3}\.\d{3}\/\d{4}-?\d{2}(?!\d)/g;

// ── 2. Cadeias de dígitos ──
const GRUPO = /\d+/g;
/** O que pode ficar entre dois grupos da mesma cadeia. Vírgula não entra: é o decimal ("R$ 1.234,56"). */
const LIGACAO = /^[\s._\-/()]{1,3}$/;
/**
 * Rótulo logo antes que diz o que o número é: fixo e sequência sem forma conhecida ficam (celular, CPF e CNPJ válidos
 * saem mesmo assim).
 */
const CONTEXTO_NAO_PESSOAL = new RegExp(
  "\\b(protocolos?|processos?|autos|matr[ií]culas?|requerimentos?|inscri[cç](?:[aã]o|[oõ]es)(?:\\s+imobili[aá]rias?)?|guias?|boletos?|"
  + "notas?\\s+fisca(?:l|is)|nf-?e?|nfs-?e|cupom|pedidos?|contratos?|[aá]reas?|valor(?:es)?|totais?|total|r\\$|lotes?|quadras?|unidades?|"
  + "casas?|apartamentos?|anos?|per[ií]odos?|c[oó]digo\\s+de\\s+barras|cep)\\s*(?:n[º°o.]*\\s*)?[:#-]?\\s*$",
  "i",
);
/** Unidade logo depois: é medida, não documento nem telefone. */
const UNIDADE_DEPOIS = /^\s?(?:m²|m2|cm²|cm2|km²|km2|m³|m3|ha|metros|km|kg|toneladas|litros|un\b|unidades|reais|centavos)/i;
const ANO = /^(?:19|20)\d\d$/;

type Grupo = { inicio: number; fim: number; digitos: string };
type Achado = { tipo: "cpf" | "cnpj" | "celular" | "fixo" | "duvida"; };

const formaDe = (gs: Grupo[]) => gs.map(g => g.digitos.length).join(",");
const FORMAS_CPF = new Set(["11", "9,2", "3,3,3,2", "3,3,5", "3,8"]);
const FORMAS_CNPJ = new Set(["14", "12,2", "8,6", "8,4,2", "2,3,3,4,2", "2,3,3,6", "2,6,4,2", "2,3,3,4,1,1"]);

/** Telefone brasileiro plausível nos grupos (já sem barra entre eles). */
function telefone(gs: Grupo[], ligacoes: string[], maisAntes: boolean): "celular" | "fixo" | null {
  if (ligacoes.some(l => l.includes("/"))) return null;
  let g = gs.map(x => x.digitos);
  let ddi = maisAntes;
  // DDI: grupo "55" separado, ou colado num grupo único de 12/13 dígitos
  if (g.length > 1 && g[0] === "55") { g = g.slice(1); ddi = true; }
  else if (g.length === 1 && /^55\d{10,11}$/.test(g[0])) { g = [g[0].slice(2)]; ddi = true; }
  else if (maisAntes) return null; // "+" com outro código de país
  // Grupos curtos só onde o telefone os tem: DDD (2) no começo, "9" sozinho; o último grupo tem 4+ (ou 3-3-3).
  const tamanhos = g.map(x => x.length);
  const n = g.length;
  for (let i = 0; i < n; i++) {
    const t = tamanhos[i];
    if (t === 1 && g[i] !== "9") return null;
    if (t === 2 && i !== 0) return null;
  }
  const tresTresTres = n >= 3 && tamanhos.slice(-3).join(",") === "3,3,3";
  if (n > 1 && tamanhos[n - 1] < 4 && !tresTresTres) return null;
  const d = g.join("");
  const dddValido = /^[1-9][1-9]/.test(d);
  if (d.length === 11 && dddValido && d[2] === "9") return "celular";
  if (d.length === 10 && dddValido && /[2-9]/.test(d[2])) return /[6-9]/.test(d[2]) ? "celular" : "fixo";
  if (ddi) return null;
  if (d.length === 9 && d[0] === "9") return "celular";
  if (d.length === 8 && n > 1 && /[2-9]/.test(d[0])) {
    if (g.every(x => ANO.test(x))) return null; // "2024-2026", "anos 2024 2025"
    return tamanhos.join(",") === "4,4" || tamanhos.join(",") === "1,3,4" ? "fixo" : null;
  }
  return null;
}

/** O que a sub-cadeia [i..j] é, considerando o contexto antes e depois. null = fica. */
function classificar(gs: Grupo[], ligacoes: string[], texto: string, cadeiaInteira: boolean): Achado | null {
  const forma = formaDe(gs);
  const d = gs.map(g => g.digitos).join("");
  if (d.length === 11 && FORMAS_CPF.has(forma) && isValidCPF(d)) return { tipo: "cpf" };
  if (d.length === 14 && FORMAS_CNPJ.has(forma) && cnpjValido(d)) return { tipo: "cnpj" };
  const inicio = gs[0].inicio, fim = gs[gs.length - 1].fim;
  const depois = texto.slice(fim, fim + 12);
  if (/^,\d/.test(depois)) return null; // número com decimais ("999.123.456,00"): é valor
  const antes = texto.slice(Math.max(0, inicio - 50), inicio);
  const maisAntes = /\+\s?\(?\s?$/.test(antes);
  const tel = telefone(gs, ligacoes, maisAntes);
  const rotulado = CONTEXTO_NAO_PESSOAL.test(antes.replace(/[(+\s]+$/, " ")) || UNIDADE_DEPOIS.test(depois);
  if (tel === "celular") return { tipo: "celular" };
  if (tel === "fixo") return rotulado ? null : { tipo: "fixo" };
  // Sequência única, sem forma conhecida (só quando é a cadeia inteira: um pedaço de número maior não conta)
  if (cadeiaInteira && gs.length === 1) {
    if (d.length === 11 && !rotulado) return { tipo: "duvida" }; // CPF digitado errado ou celular: na dúvida, sai
    if ((d.length === 12 || d.length === 13) && d.startsWith("55") && !rotulado) return { tipo: "duvida" }; // telefone com DDI
  }
  return null;
}

/** Procura e mascara CPF, CNPJ e telefone dentro de cada cadeia de grupos de dígitos. */
function mascararCadeias(texto: string): string {
  const grupos: Grupo[] = Array.from(texto.matchAll(GRUPO), m => ({ inicio: m.index!, fim: m.index! + m[0].length, digitos: m[0] }));
  if (!grupos.length) return texto;
  // cadeias: grupos consecutivos ligados por separador curto
  const cadeias: Grupo[][] = [];
  for (const g of grupos) {
    const ultima = cadeias[cadeias.length - 1];
    const anterior = ultima?.[ultima.length - 1];
    if (anterior && LIGACAO.test(texto.slice(anterior.fim, g.inicio)) && ultima.length < 16) ultima.push(g);
    else cadeias.push([g]);
  }
  const trocas: Array<{ inicio: number; fim: number }> = [];
  for (const c of cadeias) {
    const ligacoes = c.slice(1).map((g, k) => texto.slice(c[k].fim, g.inicio));
    let i = 0;
    while (i < c.length) {
      let achou = -1;
      for (let j = c.length - 1; j >= i; j--) {
        if (classificar(c.slice(i, j + 1), ligacoes.slice(i, j), texto, i === 0 && j === c.length - 1)) { achou = j; break; }
      }
      if (achou < 0) { i++; continue; }
      let inicio = c[i].inicio, fim = c[achou].fim;
      // leva junto "+55 (" antes e o ")" de um DDD entre parênteses
      const antes = /(?:\+\s?)?\(\s?$|\+\s?$/.exec(texto.slice(Math.max(0, inicio - 3), inicio));
      if (antes) inicio -= antes[0].length;
      const trecho = texto.slice(inicio, fim);
      if ((trecho.match(/\(/g)?.length ?? 0) > (trecho.match(/\)/g)?.length ?? 0) && texto[fim] === ")") fim++;
      trocas.push({ inicio, fim });
      i = achou + 1;
    }
  }
  let saida = texto;
  for (const t of trocas.reverse()) saida = saida.slice(0, t.inicio) + OMITIDO + saida.slice(t.fim);
  return saida;
}

/** Texto livre com CPF/CNPJ, e-mail, telefone, dados bancários e senhas trocados por marcadores visíveis. */
export function sanitizarTexto(texto: string): string {
  if (!texto) return texto;
  const t = normalizarParaFiltro(texto);
  if (!/[\d@]|senha|password|passwd|c[oó]digo|token|\bpin\b|\bat\b|arroba/i.test(t)) return texto;
  const r = mascararCadeias(t
    .replace(SENHA, (_m, palavra: string) => `${palavra} ${SENHA_OMITIDA}`)
    .replace(BANCARIO, (_m, rotulo: string, sep: string) => `${rotulo}${sep}${BANCARIO_OMITIDO}`)
    .replace(EMAIL, OMITIDO)
    .replace(CNPJ_FORMATADO, OMITIDO)
    .replace(CPF_FORMATADO, OMITIDO));
  return r === t ? texto : r; // nada mascarado: devolve o texto original, sem a normalização
}

/** Percorre a resposta e filtra toda string (chaves ficam como estão). */
export function sanitizarResposta<T>(valor: T): T {
  if (typeof valor === "string") return sanitizarTexto(valor) as T;
  if (Array.isArray(valor)) return valor.map(v => sanitizarResposta(v)) as T;
  if (valor && typeof valor === "object" && !(valor instanceof Date)) {
    const r: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) r[k] = sanitizarResposta(v);
    return r as T;
  }
  return valor;
}
