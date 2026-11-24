/**
 * Formatos numéricos do Excel ("#,##0.00", "dd/mm/yyyy", "000\"."000", contábil…) aplicados
 * no padrão brasileiro: ponto separa milhar e vírgula separa decimal.
 *
 * Usado pelo PDF fiel da PCI (pci-pdf-fiel.ts). Cobre o que aparece nos modelos da CAIXA:
 * dígitos (0 # ?), milhar, decimais, porcentagem, notação científica simples, textos entre
 * aspas e escapados, "_x" (espaço), "*x" (preenchimento), seções (positivo;negativo;zero;texto),
 * cores/condições entre colchetes (ignoradas) e datas/horas.
 */

export interface TextoFormatado {
  texto: string;
  /** Formato com preenchimento ("* "): parte presa à esquerda e parte presa à direita. */
  preenchimento?: { esquerda: string; direita: string };
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

type Token =
  | { t: "lit"; v: string }
  | { t: "fill"; v: string }
  | { t: "dig"; v: "0" | "#" | "?" }
  | { t: "ponto" }
  | { t: "virgula" }
  | { t: "pct" }
  | { t: "exp"; v: string }
  | { t: "data"; v: string }
  | { t: "arroba" }
  | { t: "geral" };

function secoes(fmt: string): string[] {
  const out: string[] = [];
  let atual = "";
  let aspas = false;
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i];
    if (ch === '"') aspas = !aspas;
    if (ch === "\\" && !aspas && i + 1 < fmt.length) {
      atual += ch + fmt[++i];
      continue;
    }
    if (ch === ";" && !aspas) {
      out.push(atual);
      atual = "";
      continue;
    }
    atual += ch;
  }
  out.push(atual);
  return out;
}

function tokenizar(sec: string): { tokens: Token[]; condicao: string | null } {
  const tokens: Token[] = [];
  let condicao: string | null = null;
  let i = 0;
  const lower = sec.toLowerCase();
  while (i < sec.length) {
    const ch = sec[i];
    if (ch === '"') {
      const fim = sec.indexOf('"', i + 1);
      tokens.push({ t: "lit", v: sec.slice(i + 1, fim < 0 ? sec.length : fim) });
      i = fim < 0 ? sec.length : fim + 1;
      continue;
    }
    if (ch === "\\") {
      tokens.push({ t: "lit", v: sec[i + 1] ?? "" });
      i += 2;
      continue;
    }
    if (ch === "_") {
      tokens.push({ t: "lit", v: " " });
      i += 2;
      continue;
    }
    if (ch === "*") {
      tokens.push({ t: "fill", v: sec[i + 1] ?? " " });
      i += 2;
      continue;
    }
    if (ch === "[") {
      const fim = sec.indexOf("]", i);
      const dentro = sec.slice(i + 1, fim < 0 ? sec.length : fim);
      if (/^[<>=]/.test(dentro)) condicao = dentro;
      else if (/^(h+|m+|s+)$/i.test(dentro)) tokens.push({ t: "data", v: `[${dentro.toLowerCase()}]` });
      i = fim < 0 ? sec.length : fim + 1;
      continue;
    }
    if (lower.startsWith("general", i) || lower.startsWith("geral", i)) {
      tokens.push({ t: "geral" });
      i += lower.startsWith("general", i) ? 7 : 5;
      continue;
    }
    if (ch === "0" || ch === "#" || ch === "?") {
      tokens.push({ t: "dig", v: ch });
      i++;
      continue;
    }
    if (ch === ".") {
      tokens.push({ t: "ponto" });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ t: "virgula" });
      i++;
      continue;
    }
    if (ch === "%") {
      tokens.push({ t: "pct" });
      i++;
      continue;
    }
    if (ch === "@") {
      tokens.push({ t: "arroba" });
      i++;
      continue;
    }
    if ((ch === "E" || ch === "e") && (sec[i + 1] === "+" || sec[i + 1] === "-")) {
      tokens.push({ t: "exp", v: sec[i + 1] });
      i += 2;
      continue;
    }
    if (lower.startsWith("am/pm", i) || lower.startsWith("a/p", i)) {
      const n = lower.startsWith("am/pm", i) ? 5 : 3;
      tokens.push({ t: "data", v: "ampm" });
      i += n;
      continue;
    }
    const m = /^(y+|m+|d+|h+|s+)/i.exec(sec.slice(i));
    if (m && "ymdhsYMDHS".includes(ch)) {
      tokens.push({ t: "data", v: m[1].toLowerCase() });
      i += m[1].length;
      continue;
    }
    tokens.push({ t: "lit", v: ch });
    i++;
  }
  return { tokens, condicao };
}

function testaCondicao(cond: string, v: number): boolean {
  const m = /^(<=|>=|<>|<|>|=)(-?[\d.]+)$/.exec(cond.replace(/\s/g, ""));
  if (!m) return true;
  const n = Number(m[2]);
  switch (m[1]) {
    case "<": return v < n;
    case "<=": return v <= n;
    case ">": return v > n;
    case ">=": return v >= n;
    case "<>": return v !== n;
    default: return v === n;
  }
}

/** Número no formato "Geral" (até 10 dígitos significativos, vírgula decimal). */
export function formatoGeral(v: number): string {
  if (!Number.isFinite(v)) return "#NÚM!";
  if (Number.isInteger(v) && Math.abs(v) < 1e11) return String(v);
  const abs = Math.abs(v);
  if (abs !== 0 && (abs >= 1e11 || abs < 1e-9)) {
    const [m, e] = v.toExponential(5).split("e");
    const mant = String(Number(m)).replace(".", ",");
    const exp = Number(e);
    return `${mant}E${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  return String(Number(v.toPrecision(10))).replace(".", ",");
}

function montar(tokens: Token[], partes: string[]): TextoFormatado {
  const i = tokens.findIndex((t) => t.t === "fill");
  const junta = (ini: number, fim: number) => partes.slice(ini, fim).join("");
  if (i < 0) return { texto: partes.join("") };
  const esquerda = junta(0, i);
  const direita = junta(i + 1, partes.length);
  return { texto: esquerda + direita, preenchimento: { esquerda, direita } };
}

function formatarData(tokens: Token[], serial: number): TextoFormatado {
  const dias = Math.floor(serial);
  let frac = serial - dias;
  let segTotal = Math.round(frac * 86400);
  if (segTotal >= 86400) segTotal = 86399;
  frac = segTotal;
  const d = new Date(Date.UTC(1899, 11, 30) + dias * 86400000);
  const temAmPm = tokens.some((t) => t.t === "data" && t.v === "ampm");
  const h = Math.floor(frac / 3600);
  const mi = Math.floor((frac % 3600) / 60);
  const s = frac % 60;
  const partes: string[] = [];
  tokens.forEach((t, k) => {
    if (t.t === "lit") partes.push(t.v);
    else if (t.t === "fill") partes.push("");
    else if (t.t === "dig") partes.push(t.v === "0" ? "0" : "");
    else if (t.t === "ponto") partes.push(",");
    else if (t.t === "virgula") partes.push(",");
    else if (t.t === "data") {
      const v = t.v;
      if (v.startsWith("y")) partes.push(v.length <= 2 ? String(d.getUTCFullYear() % 100).padStart(2, "0") : String(d.getUTCFullYear()));
      else if (v.startsWith("d")) {
        if (v.length === 1) partes.push(String(d.getUTCDate()));
        else if (v.length === 2) partes.push(String(d.getUTCDate()).padStart(2, "0"));
        else if (v.length === 3) partes.push(DIAS[d.getUTCDay()].slice(0, 3));
        else partes.push(DIAS[d.getUTCDay()]);
      } else if (v.startsWith("m")) {
        // minuto quando vem depois de hora ou antes de segundo
        const ant = tokens.slice(0, k).reverse().find((x) => x.t === "data");
        const dep = tokens.slice(k + 1).find((x) => x.t === "data");
        const minuto = v.length <= 2 && ((ant && ant.t === "data" && ant.v.startsWith("h")) || (dep && dep.t === "data" && dep.v.startsWith("s")));
        if (minuto) partes.push(v.length === 1 ? String(mi) : String(mi).padStart(2, "0"));
        else if (v.length === 1) partes.push(String(d.getUTCMonth() + 1));
        else if (v.length === 2) partes.push(String(d.getUTCMonth() + 1).padStart(2, "0"));
        else if (v.length === 3) partes.push(MESES[d.getUTCMonth()].slice(0, 3));
        else if (v.length === 5) partes.push(MESES[d.getUTCMonth()][0]);
        else partes.push(MESES[d.getUTCMonth()]);
      } else if (v.startsWith("h")) {
        const hh = temAmPm ? ((h + 11) % 12) + 1 : h;
        partes.push(v.length === 1 ? String(hh) : String(hh).padStart(2, "0"));
      } else if (v.startsWith("s")) partes.push(v.length === 1 ? String(s) : String(s).padStart(2, "0"));
      else if (v === "[h]") partes.push(String(dias * 24 + h));
      else if (v === "[mm]" || v === "[m]") partes.push(String((dias * 24 + h) * 60 + mi));
      else if (v === "ampm") partes.push(h < 12 ? "AM" : "PM");
    } else partes.push("");
  });
  return montar(tokens, partes);
}

/** Agrupa os dígitos de `inteiro` nas posições de placeholder (da direita para a esquerda). */
function preencherInteiro(tokens: Token[], inteiro: string, milhar: boolean): string[] {
  const posicoes: number[] = [];
  tokens.forEach((t, k) => {
    if (t.t === "dig") posicoes.push(k);
  });
  const saida = tokens.map((t) => (t.t === "lit" ? t.v : t.t === "fill" ? "" : t.t === "pct" ? "%" : ""));
  let digitos = inteiro === "0" ? "" : inteiro;
  // da direita para a esquerda
  for (let p = posicoes.length - 1; p >= 0; p--) {
    const tok = tokens[posicoes[p]] as Extract<Token, { t: "dig" }>;
    if (p === 0) {
      // o primeiro placeholder recebe todos os dígitos restantes
      if (digitos.length) saida[posicoes[p]] = digitos;
      else saida[posicoes[p]] = tok.v === "0" ? "0" : tok.v === "?" ? " " : "";
      digitos = "";
    } else if (digitos.length) {
      saida[posicoes[p]] = digitos[digitos.length - 1];
      digitos = digitos.slice(0, -1);
    } else {
      saida[posicoes[p]] = tok.v === "0" ? "0" : tok.v === "?" ? " " : "";
    }
  }
  if (milhar) {
    // insere pontos de milhar no bloco contíguo de dígitos
    const ini = posicoes[0];
    const fim = posicoes[posicoes.length - 1];
    if (ini !== undefined) {
      const bloco = saida.slice(ini, fim + 1).join("");
      const soDig = bloco.replace(/[^\d]/g, "");
      const lead = bloco.match(/^\s*/)?.[0] ?? "";
      if (/^\s*\d+$/.test(bloco) && soDig.length > 3) {
        const com = soDig.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
        for (let k = ini; k <= fim; k++) saida[k] = "";
        saida[ini] = lead + com;
      }
    }
  }
  return saida;
}

function formatarNumeroSecao(tokens: Token[], v: number): TextoFormatado {
  if (tokens.some((t) => t.t === "geral")) {
    const partes = tokens.map((t) => (t.t === "geral" ? formatoGeral(v) : t.t === "lit" ? t.v : ""));
    return montar(tokens, partes);
  }
  if (tokens.some((t) => t.t === "data")) return formatarData(tokens, v);
  const iPonto = tokens.findIndex((t) => t.t === "ponto");
  const iExp = tokens.findIndex((t) => t.t === "exp");
  const pct = tokens.filter((t) => t.t === "pct").length;
  let x = v * Math.pow(100, pct);
  // vírgulas finais (após o último dígito do inteiro) dividem por mil
  const fimInteiro = iPonto >= 0 ? iPonto : iExp >= 0 ? iExp : tokens.length;
  let ultimaDig = -1;
  for (let k = 0; k < fimInteiro; k++) if (tokens[k].t === "dig") ultimaDig = k;
  let escala = 0;
  for (let k = ultimaDig + 1; k < fimInteiro && tokens[k].t === "virgula"; k++) escala++;
  x /= Math.pow(1000, escala);
  const milhar = tokens.slice(0, ultimaDig + 1).some((t, k) => t.t === "virgula" && k < ultimaDig && tokens.slice(0, k).some((q) => q.t === "dig"));
  const semVirgula = tokens.map((t) => (t.t === "virgula" ? ({ t: "lit", v: "" } as Token) : t));
  const decTokens = iPonto >= 0 ? semVirgula.slice(iPonto + 1, iExp >= 0 ? iExp : undefined).filter((t) => t.t === "dig") : [];
  const nDec = decTokens.length;
  let expoente = 0;
  if (iExp >= 0 && x !== 0) {
    const nInt = semVirgula.slice(0, iPonto >= 0 ? iPonto : iExp).filter((t) => t.t === "dig").length || 1;
    expoente = Math.floor(Math.log10(Math.abs(x))) - (nInt - 1);
    x /= Math.pow(10, expoente);
  }
  const arred = Math.abs(x).toFixed(nDec);
  let [inteiro, frac = ""] = arred.split(".");
  if (Number(arred) === 0 && x !== 0 && nDec === 0) inteiro = "0";
  // inteiro
  const intTokens = semVirgula.slice(0, iPonto >= 0 ? iPonto : iExp >= 0 ? iExp : semVirgula.length);
  const partesInt = preencherInteiro(intTokens, inteiro, milhar);
  // decimais: zeros à direita somem nos "#"
  const partesDec: string[] = [];
  if (iPonto >= 0) {
    const fimDec = iExp >= 0 ? iExp : semVirgula.length;
    const tk = semVirgula.slice(iPonto + 1, fimDec);
    let j = 0;
    const digs = frac.split("");
    // remove zeros finais correspondentes a "#"/"?"
    for (let k = decTokens.length - 1; k >= 0; k--) {
      const d = decTokens[k] as Extract<Token, { t: "dig" }>;
      if (d.v === "0") break;
      if (digs[k] === "0") digs[k] = d.v === "?" ? " " : "";
      else break;
    }
    const temDecimal = digs.some((d) => d !== "" && d !== " ") || decTokens.some((d) => (d as { v: string }).v === "0");
    partesDec.push(temDecimal ? "," : "");
    for (const t of tk) {
      if (t.t === "dig") partesDec.push(digs[j++] ?? "");
      else if (t.t === "lit") partesDec.push(t.v);
      else if (t.t === "pct") partesDec.push("%");
      else partesDec.push("");
    }
  }
  const partesExp: string[] = [];
  if (iExp >= 0) {
    const sinal = (tokens[iExp] as Extract<Token, { t: "exp" }>).v;
    const tk = semVirgula.slice(iExp + 1);
    const nE = tk.filter((t) => t.t === "dig").length;
    partesExp.push("E" + (expoente < 0 ? "-" : sinal === "+" ? "+" : ""));
    partesExp.push(String(Math.abs(expoente)).padStart(nE, "0"));
    for (const t of tk) if (t.t === "lit") partesExp.push(t.v);
  }
  const partes = [...partesInt, ...partesDec, ...partesExp];
  // reconstitui com a posição do preenchimento
  const iFill = tokens.findIndex((t) => t.t === "fill");
  if (iFill >= 0) {
    const esquerda = partesInt.slice(0, iFill).join("");
    const direita = [...partesInt.slice(iFill + 1), ...partesDec, ...partesExp].join("");
    return { texto: esquerda + direita, preenchimento: { esquerda, direita } };
  }
  return { texto: partes.join("") };
}

/** Aplica o formato do Excel a um valor. Datas usam o sistema 1900. */
export function formatarValorXls(valor: number | string | boolean | null, formato: string): TextoFormatado {
  if (valor === null) return { texto: "" };
  if (typeof valor === "boolean") return { texto: valor ? "VERDADEIRO" : "FALSO" };
  const secs = secoes(formato || "General");
  if (typeof valor === "string") {
    const sec = secs.length >= 4 ? secs[3] : secs.find((s) => s.includes("@"));
    if (!sec) return { texto: valor };
    const { tokens } = tokenizar(sec);
    if (!tokens.some((t) => t.t === "arroba")) return { texto: valor };
    return montar(tokens, tokens.map((t) => (t.t === "arroba" ? valor : t.t === "lit" ? t.v : "")));
  }
  if (!Number.isFinite(valor)) return { texto: "#NÚM!" };
  const tok = secs.map((s) => tokenizar(s));
  let escolhida = tok[0];
  let v = valor;
  const temCond = tok.some((t) => t.condicao);
  if (temCond) {
    if (tok[0].condicao && testaCondicao(tok[0].condicao, valor)) escolhida = tok[0];
    else if (tok[1]?.condicao && testaCondicao(tok[1].condicao, valor)) escolhida = tok[1];
    else escolhida = tok[2] ?? tok[1] ?? tok[0];
  } else if (valor < 0 && tok.length >= 2) {
    escolhida = tok[1];
    v = -valor;
  } else if (valor === 0 && tok.length >= 3) {
    escolhida = tok[2];
  }
  const ehTexto = escolhida.tokens.every((t) => t.t === "lit" || t.t === "fill" || t.t === "arroba");
  if (escolhida.tokens.some((t) => t.t === "arroba") && !escolhida.tokens.some((t) => t.t === "dig")) {
    return { texto: formatoGeral(valor) };
  }
  if (ehTexto && escolhida.tokens.length) return montar(escolhida.tokens, escolhida.tokens.map((t) => (t.t === "lit" ? t.v : "")));
  if (!escolhida.tokens.length) return { texto: "" };
  // número negativo numa seção única (ou em condição sem seção própria) ganha o sinal
  const ganhaSinal = valor < 0 && (tok.length < 2 || temCond) && !(temCond && escolhida === tok[1]) && !escolhida.tokens.some((t) => t.t === "data");
  if (ganhaSinal) v = -valor;
  const r = formatarNumeroSecao(escolhida.tokens, v);
  if (ganhaSinal) {
    if (/[1-9]/.test(r.texto)) {
      if (r.preenchimento) return { texto: "-" + r.texto, preenchimento: { esquerda: r.preenchimento.esquerda, direita: "-" + r.preenchimento.direita.trimStart() } };
      return { texto: "-" + r.texto };
    }
  }
  return r;
}
