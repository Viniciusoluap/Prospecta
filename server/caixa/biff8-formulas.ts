/**
 * Avaliador das fórmulas de uma pasta .xls (BIFF8), a partir dos tokens gravados no arquivo.
 *
 * Pedido de 24/11/2026: o PDF da PCI não pode mostrar resultado velho guardado no modelo
 * (o .xls gerado só atualiza o cache de algumas fórmulas). Os tokens (RPN) viram uma árvore
 * e a árvore é avaliada sob demanda, com memória e detecção de ciclo. IF/IFERROR/IFS/AND/OR
 * só avaliam o ramo necessário, como o Excel.
 *
 * Função que o avaliador não conhece não vira um número inventado: lança `NaoSuportado`, e
 * quem chamou usa o valor em cache da célula com um aviso.
 */
import { chaveCelula, ErroXls, type AbaXls, type PlanilhaBiff8, type RegraCondicional, type ValorBruto } from "./biff8-planilha.js";

export class NaoSuportado extends Error {}

export interface Intervalo {
  tipo: "intervalo";
  aba: AbaXls;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

type Valor = ValorBruto | Intervalo;

type No =
  | { k: "v"; v: ValorBruto }
  | { k: "faltando" }
  | { k: "ref"; aba: number; r: number; c: number }
  | { k: "area"; aba: number; r1: number; c1: number; r2: number; c2: number }
  | { k: "nome"; indice: number }
  | { k: "nomex"; nome: string }
  | { k: "op"; op: string; a: No; b: No }
  | { k: "un"; op: string; a: No }
  | { k: "fn"; nome: string; args: No[] };

const ERRO_VALOR = () => new ErroXls("#VALUE!");
const ERRO_NA = () => new ErroXls("#N/A");
const ERRO_DIV = () => new ErroXls("#DIV/0!");
const ERRO_REF = () => new ErroXls("#REF!");
const ERRO_NUM = () => new ErroXls("#NUM!");

/** Nome e número fixo de argumentos (ptgFunc) das funções conhecidas (índice iftab do BIFF8). */
const FUNCOES: Record<number, [string, number]> = {
  0: ["COUNT", -1], 1: ["IF", -1], 2: ["ISNA", 1], 3: ["ISERROR", 1], 4: ["SUM", -1], 5: ["AVERAGE", -1],
  6: ["MIN", -1], 7: ["MAX", -1], 8: ["ROW", -1], 9: ["COLUMN", -1], 10: ["NA", 0], 15: ["SIN", 1], 16: ["COS", 1],
  19: ["PI", 0], 20: ["SQRT", 1], 24: ["ABS", 1], 25: ["INT", 1], 26: ["SIGN", 1], 27: ["ROUND", 2], 28: ["LOOKUP", -1],
  29: ["INDEX", -1], 30: ["REPT", 2], 31: ["MID", 3], 32: ["LEN", 1], 33: ["VALUE", 1], 34: ["TRUE", 0], 35: ["FALSE", 0],
  36: ["AND", -1], 37: ["OR", -1], 38: ["NOT", 1], 39: ["MOD", 2], 48: ["TEXT", 2], 63: ["RAND", 0], 64: ["MATCH", -1],
  65: ["DATE", 3], 66: ["TIME", 3], 67: ["DAY", 1], 68: ["MONTH", 1], 69: ["YEAR", 1], 74: ["NOW", 0], 82: ["SEARCH", -1],
  100: ["CHOOSE", -1], 101: ["HLOOKUP", -1], 102: ["VLOOKUP", -1], 112: ["LOWER", 1], 113: ["UPPER", 1],
  115: ["LEFT", -1], 116: ["RIGHT", -1], 117: ["EXACT", 2], 118: ["TRIM", 1], 120: ["SUBSTITUTE", -1], 124: ["FIND", -1],
  126: ["ISERR", 1], 127: ["ISTEXT", 1], 128: ["ISNUMBER", 1], 129: ["ISBLANK", 1], 130: ["T", 1], 131: ["N", 1],
  169: ["COUNTA", -1], 183: ["PRODUCT", -1], 190: ["ISNONTEXT", 1], 197: ["TRUNC", -1], 198: ["ISLOGICAL", 1],
  212: ["ROUNDUP", 2], 213: ["ROUNDDOWN", 2], 221: ["TODAY", 0], 228: ["SUMPRODUCT", -1], 336: ["CONCATENATE", -1],
  337: ["POWER", 2], 342: ["RADIANS", 1], 343: ["DEGREES", 1], 344: ["SUBTOTAL", -1], 345: ["SUMIF", -1], 346: ["COUNTIF", -1],
  347: ["COUNTBLANK", 1], 255: ["(suplemento)", -1],
};

const OPERADORES: Record<number, string> = {
  0x03: "+", 0x04: "-", 0x05: "*", 0x06: "/", 0x07: "^", 0x08: "&", 0x09: "<", 0x0a: "<=", 0x0b: "=", 0x0c: ">=", 0x0d: ">", 0x0e: "<>",
};

function u16(d: Uint8Array, o: number) {
  return d[o] | (d[o + 1] << 8);
}
function i8(v: number) {
  return v & 0x80 ? v - 0x100 : v;
}
function i16(v: number) {
  return v & 0x8000 ? v - 0x10000 : v;
}

/** Resultado da avaliação de uma célula. */
export interface ResultadoCelula {
  valor: ValorBruto;
  /** A fórmula usa algo que o avaliador não sabe calcular: `valor` é o cache do arquivo. */
  cache: boolean;
  motivo?: string;
}

export class AvaliadorBiff8 {
  private memo = new Map<string, ValorBruto>();
  private falhas = new Map<string, string>();
  private emCurso = new Set<string>();
  private arvores = new Map<string, No | null>();
  private nomesAval = new Map<number, Valor>();
  /** Data de "hoje" para TODAY/NOW (fixa, para o resultado ser reprodutível). */
  hoje = new Date();

  constructor(private pasta: PlanilhaBiff8) {}

  /** Valor de uma célula (fórmulas recalculadas). Não lança: se não der, devolve o cache com o motivo. */
  resultado(aba: AbaXls, linha: number, coluna: number): ResultadoCelula {
    const cel = aba.celulas.get(chaveCelula(linha, coluna));
    if (!cel) return { valor: null, cache: false };
    if (!cel.formula) return { valor: cel.valor, cache: false };
    try {
      return { valor: this.valorCelula(aba, linha, coluna), cache: false };
    } catch (e) {
      return { valor: cel.valor, cache: true, motivo: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Valor de uma célula; fórmula com resultado vazio aparece como 0 (como no Excel). Pode lançar `NaoSuportado`. */
  valorCelula(aba: AbaXls, linha: number, coluna: number): ValorBruto {
    const cel = aba.celulas.get(chaveCelula(linha, coluna));
    if (!cel) return null;
    if (!cel.formula) return cel.valor;
    const chave = `${aba.indice}:${linha}:${coluna}`;
    if (this.memo.has(chave)) return this.memo.get(chave)!;
    const falha = this.falhas.get(chave);
    if (falha !== undefined) throw new NaoSuportado(falha);
    if (this.emCurso.has(chave)) {
      // referência circular: o Excel mostra o último valor calculado (cache)
      return cel.valor;
    }
    this.emCurso.add(chave);
    try {
      const arv = this.arvore(aba, linha, coluna, cel.formula, !!cel.compartilhada);
      if (!arv) throw new NaoSuportado("fórmula com elemento não reconhecido");
      let v = this.escalar(this.avaliar(arv, aba, linha, coluna));
      if (v === null) v = 0;
      this.memo.set(chave, v);
      return v;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.falhas.set(chave, msg);
      throw e instanceof NaoSuportado ? e : new NaoSuportado(msg);
    } finally {
      this.emCurso.delete(chave);
    }
  }

  /**
   * A regra de formatação condicional vale para a célula? `null` se não der para avaliar
   * (a regra é ignorada). Só é usada para o fundo da célula.
   */
  condicao(aba: AbaXls, regra: RegraCondicional, base: { linha: number; coluna: number }, linha: number, coluna: number): boolean | null {
    try {
      const desloc = { linhas: linha - base.linha, colunas: coluna - base.coluna };
      const f1 = regra.formula1.length ? this.montar(regra.formula1, aba.indice, { linha, coluna }, desloc) : null;
      if (!f1) return null;
      const v1 = this.escalar(this.avaliar(f1, aba, linha, coluna));
      if (regra.tipo === 2) {
        const l = this.logicoPublico(v1);
        return l === null ? null : l;
      }
      if (regra.tipo !== 1) return null;
      let atual = this.valorCelula(aba, linha, coluna);
      if (atual instanceof ErroXls || v1 instanceof ErroXls) return false;
      const celula = aba.celulas.get(chaveCelula(linha, coluna));
      if (atual === null && !celula?.formula) atual = null;
      const c1 = comparar(atual, v1);
      if (regra.operador === 1 || regra.operador === 2) {
        const f2 = regra.formula2.length ? this.montar(regra.formula2, aba.indice, { linha, coluna }, desloc) : null;
        if (!f2) return null;
        const v2 = this.escalar(this.avaliar(f2, aba, linha, coluna));
        if (v2 instanceof ErroXls) return false;
        const c2 = comparar(atual, v2);
        const dentro = (c1 >= 0 && c2 <= 0) || (c1 <= 0 && c2 >= 0);
        return regra.operador === 1 ? dentro : !dentro;
      }
      switch (regra.operador) {
        case 3: return c1 === 0;
        case 4: return c1 !== 0;
        case 5: return c1 > 0;
        case 6: return c1 < 0;
        case 7: return c1 >= 0;
        case 8: return c1 <= 0;
        default: return null;
      }
    } catch {
      return null;
    }
  }

  private logicoPublico(v: ValorBruto): boolean | null {
    const l = this.logico(v);
    return l instanceof ErroXls ? null : l;
  }

  // ─── tokens → árvore ──────────────────────────────────────────────────────

  private arvore(aba: AbaXls, linha: number, coluna: number, rgce: Uint8Array, relativa: boolean): No | null {
    const chave = `${aba.indice}:${linha}:${coluna}`;
    if (this.arvores.has(chave)) return this.arvores.get(chave)!;
    const arv = this.montar(rgce, aba.indice, relativa ? { linha, coluna } : null);
    this.arvores.set(chave, arv);
    return arv;
  }

  /** Converte os tokens (RPN) numa árvore. `base` = célula de referência das fórmulas compartilhadas. */
  montar(rgce: Uint8Array, abaAtual: number, base: { linha: number; coluna: number } | null, desloc?: { linhas: number; colunas: number }): No | null {
    const pilha: No[] = [];
    let o = 0;
    const pop = () => {
      const x = pilha.pop();
      if (!x) throw new NaoSuportado("fórmula malformada");
      return x;
    };
    const lerRef = (rw: number, col: number, relN: boolean) => {
      const colRel = (col & 0x4000) !== 0;
      const rwRel = (col & 0x8000) !== 0;
      let c = col & 0x3fff;
      let r = rw;
      if (relN && base) {
        if (rwRel) r = (base.linha + i16(rw)) & 0xffff;
        if (colRel) c = (base.coluna + i8(c & 0xff)) & 0xff;
      } else if (desloc) {
        // formatação condicional: referência relativa à primeira célula do intervalo
        if (rwRel) r = (r + desloc.linhas) & 0xffff;
        if (colRel) c = (c + desloc.colunas) & 0xff;
      }
      return { r, c };
    };
    const abaDoIxti = (ixti: number): number => {
      const x = this.pasta.externSheets[ixti];
      if (!x) return -1;
      const sb = this.pasta.supbooks[x.supbook];
      if (!sb || !sb.interno) return -1;
      return x.primeira;
    };
    while (o < rgce.length) {
      const ptg = rgce[o++];
      const base5 = ptg & 0x1f;
      if (ptg >= 0x20 || ptg === 0x18 || ptg === 0x19) {
        // tokens de operando/função (com classe) ou especiais
        const t = ptg < 0x20 ? ptg : (ptg & 0x1f) | 0x20;
        switch (t) {
          case 0x19: {
            // ptgAttr
            const grbit = rgce[o];
            const w = u16(rgce, o + 1);
            o += 3;
            if (grbit & 0x04) o += (w + 1) * 2; // attrChoose: tabela de saltos
            if (grbit & 0x10) pilha.push({ k: "fn", nome: "SUM", args: [pop()] }); // attrSum
            break;
          }
          case 0x18:
            throw new NaoSuportado("token estendido (0x18) não suportado");
          case 0x20: // ptgArray
            throw new NaoSuportado("constante matricial não suportada");
          case 0x21: {
            const id = u16(rgce, o);
            o += 2;
            const f = FUNCOES[id];
            if (!f || f[1] < 0) throw new NaoSuportado(`função nº ${id} não suportada`);
            const args: No[] = [];
            for (let j = 0; j < f[1]; j++) args.unshift(pop());
            pilha.push({ k: "fn", nome: f[0], args });
            break;
          }
          case 0x22: {
            const n = rgce[o] & 0x7f;
            const id = u16(rgce, o + 1) & 0x7fff;
            o += 3;
            const args: No[] = [];
            for (let j = 0; j < n; j++) args.unshift(pop());
            if (id === 255) {
              // Funções novas (Excel 2007+) vêm como nome definido "_xlfn.X" ou nome externo de suplemento.
              const primeiro = args.shift();
              const nomeFn = primeiro?.k === "nomex" ? primeiro.nome : primeiro?.k === "nome" ? this.pasta.nomes[primeiro.indice - 1]?.nome : undefined;
              if (!nomeFn) throw new NaoSuportado("função de suplemento sem nome");
              pilha.push({ k: "fn", nome: nomeFn.replace(/^_xlfn\./i, "").toUpperCase(), args });
            } else {
              const f = FUNCOES[id];
              if (!f) throw new NaoSuportado(`função nº ${id} não suportada`);
              pilha.push({ k: "fn", nome: f[0], args });
            }
            break;
          }
          case 0x23: {
            pilha.push({ k: "nome", indice: u16(rgce, o) });
            o += 4;
            break;
          }
          case 0x24:
          case 0x2c: {
            const { r, c } = lerRef(u16(rgce, o), u16(rgce, o + 2), t === 0x2c);
            o += 4;
            pilha.push({ k: "ref", aba: abaAtual, r, c });
            break;
          }
          case 0x25:
          case 0x2d: {
            const a = lerRef(u16(rgce, o), u16(rgce, o + 4), t === 0x2d);
            const b = lerRef(u16(rgce, o + 2), u16(rgce, o + 6), t === 0x2d);
            o += 8;
            pilha.push({ k: "area", aba: abaAtual, r1: a.r, c1: a.c, r2: b.r, c2: b.c });
            break;
          }
          case 0x26: // ptgMemArea: a subexpressão vem a seguir
          case 0x27: // ptgMemErr
          case 0x28: // ptgMemNoMem
            o += 6;
            break;
          case 0x29: // ptgMemFunc
            o += 2;
            break;
          case 0x2a:
            o += 4;
            pilha.push({ k: "v", v: ERRO_REF() });
            break;
          case 0x2b:
            o += 8;
            pilha.push({ k: "v", v: ERRO_REF() });
            break;
          case 0x39: {
            const ixti = u16(rgce, o);
            const iname = u16(rgce, o + 2);
            o += 6;
            const x = this.pasta.externSheets[ixti];
            const sb = x ? this.pasta.supbooks[x.supbook] : undefined;
            const nome = sb?.nomes[iname - 1];
            if (!nome) throw new NaoSuportado("nome externo não encontrado");
            pilha.push({ k: "nomex", nome });
            break;
          }
          case 0x3a: {
            const aba = abaDoIxti(u16(rgce, o));
            const { r, c } = lerRef(u16(rgce, o + 2), u16(rgce, o + 4), !!base);
            o += 6;
            pilha.push(aba < 0 ? { k: "v", v: ERRO_REF() } : { k: "ref", aba, r, c });
            break;
          }
          case 0x3b: {
            const aba = abaDoIxti(u16(rgce, o));
            const a = lerRef(u16(rgce, o + 2), u16(rgce, o + 6), !!base);
            const b = lerRef(u16(rgce, o + 4), u16(rgce, o + 8), !!base);
            o += 10;
            pilha.push(aba < 0 ? { k: "v", v: ERRO_REF() } : { k: "area", aba, r1: a.r, c1: a.c, r2: b.r, c2: b.c });
            break;
          }
          case 0x3c:
            o += 6;
            pilha.push({ k: "v", v: ERRO_REF() });
            break;
          case 0x3d:
            o += 10;
            pilha.push({ k: "v", v: ERRO_REF() });
            break;
          default:
            throw new NaoSuportado(`token 0x${ptg.toString(16)} não suportado`);
        }
        continue;
      }
      switch (base5) {
        case 0x01:
          throw new NaoSuportado("fórmula compartilhada sem célula-mãe");
        case 0x02:
          throw new NaoSuportado("tabela de dados não suportada");
        case 0x03: case 0x04: case 0x05: case 0x06: case 0x07: case 0x08: case 0x09:
        case 0x0a: case 0x0b: case 0x0c: case 0x0d: case 0x0e: {
          const b = pop();
          const a = pop();
          pilha.push({ k: "op", op: OPERADORES[base5], a, b });
          break;
        }
        case 0x0f: case 0x10: case 0x11: {
          const b = pop();
          const a = pop();
          pilha.push({ k: "op", op: base5 === 0x11 ? ":" : base5 === 0x10 ? "," : " ", a, b });
          break;
        }
        case 0x12:
          pilha.push({ k: "un", op: "+", a: pop() });
          break;
        case 0x13:
          pilha.push({ k: "un", op: "-", a: pop() });
          break;
        case 0x14:
          pilha.push({ k: "un", op: "%", a: pop() });
          break;
        case 0x15:
          break; // parênteses: só de exibição
        case 0x16:
          pilha.push({ k: "faltando" });
          break;
        case 0x17: {
          const cch = rgce[o];
          const largo = (rgce[o + 1] & 1) === 1;
          let s = "";
          for (let j = 0; j < cch; j++) s += String.fromCharCode(largo ? u16(rgce, o + 2 + j * 2) : rgce[o + 2 + j]);
          o += 2 + cch * (largo ? 2 : 1);
          pilha.push({ k: "v", v: s });
          break;
        }
        case 0x1c:
          pilha.push({ k: "v", v: new ErroXls({ 0x00: "#NULL!", 0x07: "#DIV/0!", 0x0f: "#VALUE!", 0x17: "#REF!", 0x1d: "#NAME?", 0x24: "#NUM!", 0x2a: "#N/A" }[rgce[o]] ?? "#N/A") });
          o += 1;
          break;
        case 0x1d:
          pilha.push({ k: "v", v: rgce[o] === 1 });
          o += 1;
          break;
        case 0x1e:
          pilha.push({ k: "v", v: u16(rgce, o) });
          o += 2;
          break;
        case 0x1f:
          pilha.push({ k: "v", v: new DataView(rgce.buffer, rgce.byteOffset + o, 8).getFloat64(0, true) });
          o += 8;
          break;
        default:
          throw new NaoSuportado(`token 0x${ptg.toString(16)} não suportado`);
      }
    }
    if (pilha.length !== 1) return pilha.length ? pilha[pilha.length - 1] : null;
    return pilha[0];
  }

  // ─── avaliação ────────────────────────────────────────────────────────────

  private nome(indice: number): Valor {
    if (this.nomesAval.has(indice)) return this.nomesAval.get(indice)!;
    const n = this.pasta.nomes[indice - 1];
    if (!n) throw new NaoSuportado("nome definido não encontrado");
    const abaEscopo = n.escopo > 0 ? n.escopo - 1 : 0;
    const arv = this.montar(n.formula, abaEscopo, null);
    if (!arv) throw new NaoSuportado(`nome "${n.nome}" vazio`);
    const aba = this.pasta.abas[abaEscopo];
    const v = this.avaliar(arv, aba, 0, 0);
    this.nomesAval.set(indice, v);
    return v;
  }

  private avaliar(no: No, aba: AbaXls, linha: number, coluna: number): Valor {
    switch (no.k) {
      case "v":
        return no.v;
      case "faltando":
        return null;
      case "ref": {
        const a = this.pasta.abas[no.aba];
        if (!a) return ERRO_REF();
        return { tipo: "intervalo", aba: a, r1: no.r, c1: no.c, r2: no.r, c2: no.c };
      }
      case "area": {
        const a = this.pasta.abas[no.aba];
        if (!a) return ERRO_REF();
        return { tipo: "intervalo", aba: a, r1: Math.min(no.r1, no.r2), c1: Math.min(no.c1, no.c2), r2: Math.max(no.r1, no.r2), c2: Math.max(no.c1, no.c2) };
      }
      case "nome":
        return this.nome(no.indice);
      case "nomex":
        throw new NaoSuportado(`nome externo "${no.nome}" usado como valor`);
      case "un": {
        const v = this.numero(this.escalar(this.avaliar(no.a, aba, linha, coluna)));
        if (v instanceof ErroXls) return v;
        if (no.op === "-") return -v;
        if (no.op === "%") return v / 100;
        return v;
      }
      case "op":
        return this.operar(no, aba, linha, coluna);
      case "fn":
        return this.funcao(no.nome, no.args, aba, linha, coluna);
    }
  }

  /** Valor simples a partir de um intervalo (célula única ou interseção implícita). */
  escalar(v: Valor): ValorBruto {
    if (v && typeof v === "object" && !(v instanceof ErroXls)) {
      if (v.r1 === v.r2 && v.c1 === v.c2) return this.valorCelula(v.aba, v.r1, v.c1);
      return ERRO_VALOR();
    }
    return v as ValorBruto;
  }

  private numero(v: ValorBruto): number | ErroXls {
    if (v instanceof ErroXls) return v;
    if (v === null) return 0;
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    const t = v.trim();
    if (t === "") return ERRO_VALOR();
    const n = Number(t.replace(/\s/g, ""));
    return Number.isFinite(n) ? n : ERRO_VALOR();
  }

  private texto(v: ValorBruto): string | ErroXls {
    if (v instanceof ErroXls) return v;
    if (v === null) return "";
    if (typeof v === "boolean") return v ? "VERDADEIRO" : "FALSO";
    if (typeof v === "number") return numeroGeral(v);
    return v;
  }

  private logico(v: ValorBruto): boolean | ErroXls {
    if (v instanceof ErroXls) return v;
    if (v === null) return false;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    const t = v.trim().toUpperCase();
    if (t === "TRUE" || t === "VERDADEIRO") return true;
    if (t === "FALSE" || t === "FALSO") return false;
    return ERRO_VALOR();
  }

  private operar(no: Extract<No, { k: "op" }>, aba: AbaXls, linha: number, coluna: number): Valor {
    if (no.op === ":" || no.op === "," || no.op === " ") throw new NaoSuportado("operador de intervalo não suportado");
    const a = this.escalar(this.avaliar(no.a, aba, linha, coluna));
    const b = this.escalar(this.avaliar(no.b, aba, linha, coluna));
    if (a instanceof ErroXls) return a;
    if (b instanceof ErroXls) return b;
    if (no.op === "&") {
      return (this.texto(a) as string) + (this.texto(b) as string);
    }
    if (["=", "<>", "<", "<=", ">", ">="].includes(no.op)) {
      const c = comparar(a, b);
      switch (no.op) {
        case "=": return c === 0;
        case "<>": return c !== 0;
        case "<": return c < 0;
        case "<=": return c <= 0;
        case ">": return c > 0;
        default: return c >= 0;
      }
    }
    const x = this.numero(a);
    const y = this.numero(b);
    if (x instanceof ErroXls) return x;
    if (y instanceof ErroXls) return y;
    switch (no.op) {
      case "+": return x + y;
      case "-": return x - y;
      case "*": return x * y;
      case "/": return y === 0 ? ERRO_DIV() : x / y;
      case "^": {
        const r = Math.pow(x, y);
        return Number.isFinite(r) ? r : ERRO_NUM();
      }
    }
    throw new NaoSuportado(`operador ${no.op}`);
  }

  /** Percorre os valores (intervalos célula a célula) dos argumentos. */
  private valores(args: No[], aba: AbaXls, linha: number, coluna: number): { v: ValorBruto; deIntervalo: boolean }[] {
    const out: { v: ValorBruto; deIntervalo: boolean }[] = [];
    for (const arg of args) {
      const v = this.avaliar(arg, aba, linha, coluna);
      if (v && typeof v === "object" && !(v instanceof ErroXls)) {
        for (let r = v.r1; r <= v.r2; r++) {
          for (let c = v.c1; c <= v.c2; c++) {
            if (!v.aba.celulas.has(chaveCelula(r, c))) continue;
            out.push({ v: this.valorCelula(v.aba, r, c), deIntervalo: true });
          }
        }
      } else {
        out.push({ v: v as ValorBruto, deIntervalo: false });
      }
    }
    return out;
  }

  private arg(args: No[], i: number, aba: AbaXls, linha: number, coluna: number): ValorBruto {
    const a = args[i];
    if (!a || a.k === "faltando") return null;
    return this.escalar(this.avaliar(a, aba, linha, coluna));
  }

  private funcao(nome: string, args: No[], aba: AbaXls, linha: number, coluna: number): Valor {
    const A = (i: number) => this.arg(args, i, aba, linha, coluna);
    const temArg = (i: number) => !!args[i] && args[i].k !== "faltando";
    switch (nome) {
      case "IF": {
        const c = this.logico(A(0));
        if (c instanceof ErroXls) return c;
        if (c) return temArg(1) ? this.avaliar(args[1], aba, linha, coluna) : args.length > 1 ? 0 : true;
        if (args.length < 3) return false;
        return temArg(2) ? this.avaliar(args[2], aba, linha, coluna) : 0;
      }
      case "IFERROR": {
        const v = A(0);
        return v instanceof ErroXls ? A(1) : v;
      }
      case "IFNA": {
        const v = A(0);
        return v instanceof ErroXls && v.codigo === "#N/A" ? A(1) : v;
      }
      case "IFS": {
        for (let i = 0; i + 1 < args.length; i += 2) {
          const c = this.logico(A(i));
          if (c instanceof ErroXls) return c;
          if (c) return this.avaliar(args[i + 1], aba, linha, coluna);
        }
        return ERRO_NA();
      }
      case "AND":
      case "OR": {
        let algum = false;
        let res = nome === "AND";
        for (const { v, deIntervalo } of this.valores(args, aba, linha, coluna)) {
          if (v instanceof ErroXls) return v;
          if (deIntervalo && (v === null || typeof v === "string")) continue;
          const l = this.logico(v);
          if (l instanceof ErroXls) return l;
          algum = true;
          if (nome === "AND" && !l) res = false;
          if (nome === "OR" && l) res = true;
        }
        return algum ? res : ERRO_VALOR();
      }
      case "NOT": {
        const l = this.logico(A(0));
        return l instanceof ErroXls ? l : !l;
      }
      case "TRUE":
        return true;
      case "FALSE":
        return false;
      case "ISERROR":
        return A(0) instanceof ErroXls;
      case "ISERR": {
        const v = A(0);
        return v instanceof ErroXls && v.codigo !== "#N/A";
      }
      case "ISNA": {
        const v = A(0);
        return v instanceof ErroXls && v.codigo === "#N/A";
      }
      case "ISBLANK": {
        const a = args[0] ? this.avaliar(args[0], aba, linha, coluna) : null;
        if (a && typeof a === "object" && !(a instanceof ErroXls)) {
          const cel = a.aba.celulas.get(chaveCelula(a.r1, a.c1));
          return !cel || (cel.valor === null && !cel.formula);
        }
        return false;
      }
      case "ISNUMBER":
        return typeof A(0) === "number";
      case "ISTEXT":
        return typeof A(0) === "string";
      case "ISNONTEXT":
        return typeof A(0) !== "string";
      case "ISLOGICAL":
        return typeof A(0) === "boolean";
      case "NA":
        return ERRO_NA();
      case "SUM":
      case "PRODUCT":
      case "AVERAGE":
      case "MIN":
      case "MAX":
      case "COUNT":
      case "COUNTA": {
        const nums: number[] = [];
        let conta = 0;
        for (const { v, deIntervalo } of this.valores(args, aba, linha, coluna)) {
          if (nome === "COUNTA") {
            if (v !== null && !(deIntervalo && v === "" && false)) conta++;
            continue;
          }
          if (v instanceof ErroXls) {
            if (nome === "COUNT") continue;
            return v;
          }
          if (deIntervalo) {
            if (typeof v === "number") nums.push(v);
            continue;
          }
          if (nome === "COUNT") {
            if (typeof v === "number") nums.push(v);
            continue;
          }
          const n = this.numero(v);
          if (n instanceof ErroXls) return n;
          nums.push(n);
        }
        switch (nome) {
          case "SUM": return nums.reduce((s, x) => s + x, 0);
          case "PRODUCT": return nums.length ? nums.reduce((s, x) => s * x, 1) : 0;
          case "AVERAGE": return nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : ERRO_DIV();
          case "MIN": return nums.length ? Math.min(...nums) : 0;
          case "MAX": return nums.length ? Math.max(...nums) : 0;
          case "COUNT": return nums.length;
          default: return conta;
        }
      }
      case "ABS": case "INT": case "SQRT": case "SIGN": case "SIN": case "COS": case "RADIANS": case "DEGREES": {
        const x = this.numero(A(0));
        if (x instanceof ErroXls) return x;
        switch (nome) {
          case "ABS": return Math.abs(x);
          case "INT": return Math.floor(x);
          case "SIGN": return Math.sign(x);
          case "SIN": return Math.sin(x);
          case "COS": return Math.cos(x);
          case "RADIANS": return (x * Math.PI) / 180;
          case "DEGREES": return (x * 180) / Math.PI;
          default: return x < 0 ? ERRO_NUM() : Math.sqrt(x);
        }
      }
      case "PI":
        return Math.PI;
      case "ROUND": case "ROUNDUP": case "ROUNDDOWN": case "TRUNC": {
        const x = this.numero(A(0));
        const d = temArg(1) ? this.numero(A(1)) : 0;
        if (x instanceof ErroXls) return x;
        if (d instanceof ErroXls) return d;
        return arredondar(x, Math.trunc(d), nome);
      }
      case "MOD": {
        const x = this.numero(A(0));
        const y = this.numero(A(1));
        if (x instanceof ErroXls) return x;
        if (y instanceof ErroXls) return y;
        if (y === 0) return ERRO_DIV();
        return x - y * Math.floor(x / y);
      }
      case "POWER": {
        const x = this.numero(A(0));
        const y = this.numero(A(1));
        if (x instanceof ErroXls) return x;
        if (y instanceof ErroXls) return y;
        const r = Math.pow(x, y);
        return Number.isFinite(r) ? r : ERRO_NUM();
      }
      case "LEFT": case "RIGHT": {
        const t = this.texto(A(0));
        if (t instanceof ErroXls) return t;
        const n = temArg(1) ? this.numero(A(1)) : 1;
        if (n instanceof ErroXls) return n;
        if (n < 0) return ERRO_VALOR();
        return nome === "LEFT" ? t.slice(0, Math.trunc(n)) : Math.trunc(n) === 0 ? "" : t.slice(-Math.trunc(n));
      }
      case "MID": {
        const t = this.texto(A(0));
        const i = this.numero(A(1));
        const n = this.numero(A(2));
        if (t instanceof ErroXls) return t;
        if (i instanceof ErroXls) return i;
        if (n instanceof ErroXls) return n;
        if (i < 1 || n < 0) return ERRO_VALOR();
        return t.substr(Math.trunc(i) - 1, Math.trunc(n));
      }
      case "LEN": {
        const t = this.texto(A(0));
        return t instanceof ErroXls ? t : t.length;
      }
      case "UPPER": case "LOWER": case "TRIM": case "T": {
        const v = A(0);
        if (nome === "T") return typeof v === "string" ? v : v instanceof ErroXls ? v : "";
        const t = this.texto(v);
        if (t instanceof ErroXls) return t;
        if (nome === "UPPER") return t.toUpperCase();
        if (nome === "LOWER") return t.toLowerCase();
        return t.trim().replace(/ {2,}/g, " ");
      }
      case "N": {
        const v = A(0);
        return typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : v instanceof ErroXls ? v : 0;
      }
      case "VALUE":
        return this.numero(A(0));
      case "EXACT": {
        const a = this.texto(A(0));
        const b = this.texto(A(1));
        if (a instanceof ErroXls) return a;
        if (b instanceof ErroXls) return b;
        return a === b;
      }
      case "REPT": {
        const t = this.texto(A(0));
        const n = this.numero(A(1));
        if (t instanceof ErroXls) return t;
        if (n instanceof ErroXls) return n;
        return t.repeat(Math.max(0, Math.trunc(n)));
      }
      case "CONCATENATE": {
        let s = "";
        for (let i = 0; i < args.length; i++) {
          const t = this.texto(A(i));
          if (t instanceof ErroXls) return t;
          s += t;
        }
        return s;
      }
      case "SUBSTITUTE": {
        const t = this.texto(A(0));
        const de = this.texto(A(1));
        const para = this.texto(A(2));
        if (t instanceof ErroXls) return t;
        if (de instanceof ErroXls) return de;
        if (para instanceof ErroXls) return para;
        if (!de) return t;
        if (temArg(3)) {
          const n = this.numero(A(3));
          if (n instanceof ErroXls) return n;
          let pos = -1;
          for (let k = 0; k < n; k++) {
            pos = t.indexOf(de, pos + 1);
            if (pos < 0) return t;
          }
          return t.slice(0, pos) + para + t.slice(pos + de.length);
        }
        return t.split(de).join(para);
      }
      case "FIND": case "SEARCH": {
        const q = this.texto(A(0));
        const t = this.texto(A(1));
        const ini = temArg(2) ? this.numero(A(2)) : 1;
        if (q instanceof ErroXls) return q;
        if (t instanceof ErroXls) return t;
        if (ini instanceof ErroXls) return ini;
        const pos = nome === "FIND" ? t.indexOf(q, ini - 1) : t.toUpperCase().indexOf(q.toUpperCase(), ini - 1);
        return pos < 0 ? new ErroXls("#VALUE!") : pos + 1;
      }
      case "CHOOSE": {
        const i = this.numero(A(0));
        if (i instanceof ErroXls) return i;
        const k = Math.trunc(i);
        if (k < 1 || k >= args.length) return ERRO_VALOR();
        return this.avaliar(args[k], aba, linha, coluna);
      }
      case "VLOOKUP":
      case "HLOOKUP": {
        const chave = A(0);
        if (chave instanceof ErroXls) return chave;
        const tab = args[1] ? this.avaliar(args[1], aba, linha, coluna) : null;
        if (!tab || typeof tab !== "object" || tab instanceof ErroXls) return tab instanceof ErroXls ? tab : ERRO_NA();
        const idx = this.numero(A(2));
        if (idx instanceof ErroXls) return idx;
        const aprox = temArg(3) ? this.logico(A(3)) : true;
        if (aprox instanceof ErroXls) return aprox;
        const vert = nome === "VLOOKUP";
        const n = Math.trunc(idx);
        const largura = vert ? tab.c2 - tab.c1 + 1 : tab.r2 - tab.r1 + 1;
        if (n < 1) return ERRO_VALOR();
        if (n > largura) return ERRO_REF();
        const total = vert ? tab.r2 - tab.r1 + 1 : tab.c2 - tab.c1 + 1;
        const chaveEm = (k: number) => (vert ? this.valorCelula(tab.aba, tab.r1 + k, tab.c1) : this.valorCelula(tab.aba, tab.r1, tab.c1 + k));
        const resultadoEm = (k: number) => {
          const v = vert ? this.valorCelula(tab.aba, tab.r1 + k, tab.c1 + n - 1) : this.valorCelula(tab.aba, tab.r1 + n - 1, tab.c1 + k);
          return v === null ? 0 : v;
        };
        if (!aprox) {
          for (let k = 0; k < total; k++) {
            const v = chaveEm(k);
            if (v !== null && mesmoTipo(v, chave) && comparar(v, chave) === 0) return resultadoEm(k);
          }
          return ERRO_NA();
        }
        let achou = -1;
        for (let k = 0; k < total; k++) {
          const v = chaveEm(k);
          if (v === null || !mesmoTipo(v, chave)) continue;
          if (comparar(v, chave) <= 0) achou = k;
          else break;
        }
        return achou < 0 ? ERRO_NA() : resultadoEm(achou);
      }
      case "MATCH": {
        const chave = A(0);
        if (chave instanceof ErroXls) return chave;
        const tab = args[1] ? this.avaliar(args[1], aba, linha, coluna) : null;
        if (!tab || typeof tab !== "object" || tab instanceof ErroXls) return ERRO_NA();
        const tipo = temArg(2) ? this.numero(A(2)) : 1;
        if (tipo instanceof ErroXls) return tipo;
        const lista: ValorBruto[] = [];
        for (let r = tab.r1; r <= tab.r2; r++) for (let c = tab.c1; c <= tab.c2; c++) lista.push(this.valorCelula(tab.aba, r, c));
        if (tipo === 0) {
          const k = lista.findIndex((v) => v !== null && mesmoTipo(v, chave) && comparar(v, chave) === 0);
          return k < 0 ? ERRO_NA() : k + 1;
        }
        let achou = -1;
        for (let k = 0; k < lista.length; k++) {
          const v = lista[k];
          if (v === null || !mesmoTipo(v, chave)) continue;
          const c = comparar(v, chave);
          if (tipo > 0 ? c <= 0 : c >= 0) achou = k;
          else break;
        }
        return achou < 0 ? ERRO_NA() : achou + 1;
      }
      case "INDEX": {
        const tab = args[0] ? this.avaliar(args[0], aba, linha, coluna) : null;
        if (!tab || typeof tab !== "object" || tab instanceof ErroXls) return tab instanceof ErroXls ? tab : ERRO_REF();
        const lin = temArg(1) ? this.numero(A(1)) : 0;
        const col = temArg(2) ? this.numero(A(2)) : 0;
        if (lin instanceof ErroXls) return lin;
        if (col instanceof ErroXls) return col;
        let r = lin;
        let c = col;
        if (tab.r1 === tab.r2 && !temArg(2)) {
          c = r;
          r = 1;
        }
        if (r < 1 || c < 1) {
          if (r === 0 && c === 0) return tab;
          if (r < 0 || c < 0) return ERRO_VALOR();
        }
        const rr = tab.r1 + Math.max(1, Math.trunc(r)) - 1;
        const cc = tab.c1 + Math.max(1, Math.trunc(c)) - 1;
        if (rr > tab.r2 || cc > tab.c2) return ERRO_REF();
        return { tipo: "intervalo", aba: tab.aba, r1: rr, c1: cc, r2: rr, c2: cc };
      }
      case "SUMIF": case "COUNTIF": {
        const tab = args[0] ? this.avaliar(args[0], aba, linha, coluna) : null;
        if (!tab || typeof tab !== "object" || tab instanceof ErroXls) return ERRO_VALOR();
        const crit = A(1);
        const soma = nome === "SUMIF" && temArg(2) ? this.avaliar(args[2], aba, linha, coluna) : tab;
        if (!soma || typeof soma !== "object" || soma instanceof ErroXls) return ERRO_VALOR();
        const teste = criterio(crit);
        let total = 0;
        for (let r = tab.r1; r <= tab.r2; r++) {
          for (let c = tab.c1; c <= tab.c2; c++) {
            if (!teste(this.valorCelula(tab.aba, r, c))) continue;
            if (nome === "COUNTIF") total++;
            else {
              const v = this.valorCelula(soma.aba, soma.r1 + (r - tab.r1), soma.c1 + (c - tab.c1));
              if (typeof v === "number") total += v;
            }
          }
        }
        return total;
      }
      case "COUNTBLANK": {
        const tab = args[0] ? this.avaliar(args[0], aba, linha, coluna) : null;
        if (!tab || typeof tab !== "object" || tab instanceof ErroXls) return ERRO_VALOR();
        let n = 0;
        for (let r = tab.r1; r <= tab.r2; r++) for (let c = tab.c1; c <= tab.c2; c++) {
          const v = this.valorCelula(tab.aba, r, c);
          if (v === null || v === "") n++;
        }
        return n;
      }
      case "SUMPRODUCT": {
        const tabs = args.map((a) => this.avaliar(a, aba, linha, coluna));
        if (!tabs.length || tabs.some((t) => !t || typeof t !== "object" || t instanceof ErroXls)) throw new NaoSuportado("SUMPRODUCT com argumento não suportado");
        const ts = tabs as Intervalo[];
        const h = ts[0].r2 - ts[0].r1;
        const w = ts[0].c2 - ts[0].c1;
        if (ts.some((t) => t.r2 - t.r1 !== h || t.c2 - t.c1 !== w)) return ERRO_VALOR();
        let total = 0;
        for (let r = 0; r <= h; r++) for (let c = 0; c <= w; c++) {
          let p = 1;
          for (const t of ts) {
            const v = this.valorCelula(t.aba, t.r1 + r, t.c1 + c);
            p *= typeof v === "number" ? v : 0;
          }
          total += p;
        }
        return total;
      }
      case "ROW":
      case "COLUMN": {
        if (!args.length) return nome === "ROW" ? linha + 1 : coluna + 1;
        const t = this.avaliar(args[0], aba, linha, coluna);
        if (!t || typeof t !== "object" || t instanceof ErroXls) return ERRO_VALOR();
        return nome === "ROW" ? t.r1 + 1 : t.c1 + 1;
      }
      case "DATE": {
        const y = this.numero(A(0));
        const m = this.numero(A(1));
        const d = this.numero(A(2));
        if (y instanceof ErroXls) return y;
        if (m instanceof ErroXls) return m;
        if (d instanceof ErroXls) return d;
        const ano = y < 1900 ? y + 1900 : y;
        return dataParaSerial(new Date(Date.UTC(ano, m - 1, d)));
      }
      case "TIME": {
        const h = this.numero(A(0));
        const m = this.numero(A(1));
        const s = this.numero(A(2));
        if (h instanceof ErroXls) return h;
        if (m instanceof ErroXls) return m;
        if (s instanceof ErroXls) return s;
        return ((h * 3600 + m * 60 + s) / 86400) % 1;
      }
      case "DAY": case "MONTH": case "YEAR": {
        const n = this.numero(A(0));
        if (n instanceof ErroXls) return n;
        const d = serialParaData(n);
        return nome === "DAY" ? d.getUTCDate() : nome === "MONTH" ? d.getUTCMonth() + 1 : d.getUTCFullYear();
      }
      case "TODAY":
      case "NOW": {
        const h = this.hoje;
        const base = dataParaSerial(new Date(Date.UTC(h.getFullYear(), h.getMonth(), h.getDate())));
        return nome === "TODAY" ? base : base + (h.getHours() * 3600 + h.getMinutes() * 60 + h.getSeconds()) / 86400;
      }
      default:
        throw new NaoSuportado(`função ${nome} não suportada`);
    }
  }
}

function mesmoTipo(a: ValorBruto, b: ValorBruto): boolean {
  if (typeof a === "number" || typeof b === "number") return typeof a === typeof b;
  if (typeof a === "boolean" || typeof b === "boolean") return typeof a === typeof b;
  return true;
}

/** Comparação do Excel: números < textos < lógicos; texto sem diferenciar maiúsculas. Vazio vale 0/""/FALSO. */
export function comparar(a: ValorBruto, b: ValorBruto): number {
  if (a === null) a = typeof b === "string" ? "" : typeof b === "boolean" ? false : 0;
  if (b === null) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
  const ordem = (v: ValorBruto) => (typeof v === "number" ? 0 : typeof v === "string" ? 1 : 2);
  const oa = ordem(a);
  const ob = ordem(b);
  if (oa !== ob) return oa - ob;
  if (typeof a === "number" && typeof b === "number") {
    const x = Number(a.toPrecision(15));
    const y = Number(b.toPrecision(15));
    return x === y ? 0 : x < y ? -1 : 1;
  }
  if (typeof a === "string" && typeof b === "string") {
    const x = a.toUpperCase();
    const y = b.toUpperCase();
    return x === y ? 0 : x < y ? -1 : 1;
  }
  return Number(a) - Number(b);
}

function criterio(c: ValorBruto): (v: ValorBruto) => boolean {
  if (typeof c === "string") {
    const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(c)!;
    const op = m[1] ?? "=";
    const alvoTxt = m[2];
    const n = Number(alvoTxt);
    const alvo: ValorBruto = alvoTxt !== "" && Number.isFinite(n) ? n : alvoTxt;
    return (v) => {
      if (op === "=" && alvo === "") return v === null || v === "";
      if (v === null) return false;
      if (!mesmoTipo(v, alvo)) return op === "<>";
      const k = comparar(v, alvo);
      switch (op) {
        case "<": return k < 0;
        case "<=": return k <= 0;
        case ">": return k > 0;
        case ">=": return k >= 0;
        case "<>": return k !== 0;
        default: return k === 0;
      }
    };
  }
  return (v) => v !== null && mesmoTipo(v, c) && comparar(v, c) === 0;
}

function arredondar(x: number, d: number, modo: string): number {
  const f = Math.pow(10, d);
  const y = Number((x * f).toPrecision(15));
  let r: number;
  if (modo === "ROUND") r = Math.sign(y) * Math.round(Math.abs(y));
  else if (modo === "ROUNDUP") r = Math.sign(y) * Math.ceil(Math.abs(y));
  else r = Math.trunc(y);
  return r / f;
}

const EPOCA = Date.UTC(1899, 11, 30);
export function dataParaSerial(d: Date): number {
  return Math.round((d.getTime() - EPOCA) / 86400000);
}
export function serialParaData(n: number): Date {
  return new Date(EPOCA + Math.floor(n) * 86400000);
}

/** Número no formato "Geral" (até 10 dígitos significativos, vírgula decimal). */
export function numeroGeral(v: number): string {
  if (!Number.isFinite(v)) return "#NUM!";
  if (Number.isInteger(v) && Math.abs(v) < 1e11) return String(v);
  const abs = Math.abs(v);
  let s: string;
  if (abs !== 0 && (abs >= 1e11 || abs < 1e-9)) {
    s = v.toExponential(5).replace(/\.?0+e/, "e").replace("e", "E").replace(/E\+?(-?)(\d)$/, "E$10$2");
  } else {
    s = String(Number(v.toPrecision(10)));
  }
  return s.replace(".", ",");
}
