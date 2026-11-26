/**
 * Validador estrutural de .xls (BIFF8 + desenhos Escher) — S-2 do EPIC-030 (25/11/2026).
 *
 * Nasceu do arquivo que o Excel abria "reparando" e que o sistema da CAIXA recusava ("essa planilha está com erro,
 * não está anexando"). Confere as amarrações internas que o gerador precisa manter ao mexer no fluxo Workbook:
 * deslocamentos absolutos (BOUNDSHEET, INDEX, EXTSST), deslocamentos relativos (DBCELL), tamanhos dos contêineres de
 * desenho, ids das formas (cada um no grupo de ids da própria aba) e ids dos objetos. Devolve a lista de problemas
 * (vazia = estrutura coerente). Não substitui o Excel: só pega as inconsistências que já foram vistas.
 */
import * as CFB from "cfb";

const MAX_REGISTRO = 8224;
const T = {
  BOF: 0x0809, EOF: 0x000a, BOUNDSHEET: 0x0085, SST: 0x00fc, EXTSST: 0x00ff, CONTINUE: 0x003c, ROW: 0x0208, INDEX: 0x020b,
  DBCELL: 0x00d7, DEFCOLWIDTH: 0x0055, MSODRAWINGGROUP: 0x00eb, MSODRAWING: 0x00ec, OBJ: 0x005d, TXO: 0x01b6,
} as const;
/** Registros de célula (os que o DBCELL aponta). STRING/SHRFMLA/ARRAY/TABLE vêm depois da fórmula e nunca abrem a linha. */
export const REGISTROS_DE_CELULA = new Set([0x0203, 0x027e, 0x00bd, 0x00fd, 0x0204, 0x0201, 0x00be, 0x0205, 0x0006]);

interface Reg { pos: number; tipo: number; dados: Uint8Array }

const u16 = (d: Uint8Array, o: number) => d[o] | (d[o + 1] << 8);
const u32 = (d: Uint8Array, o: number) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16)) + d[o + 3] * 0x1000000;
function esc(d: Uint8Array, o: number) {
  const vi = u16(d, o);
  return { ver: vi & 0xf, inst: vi >> 4, tipo: u16(d, o + 2), tam: u32(d, o + 4) };
}
const hex = (n: number) => `0x${n.toString(16).padStart(4, "0")}`;

function lerRegistros(wb: Uint8Array, erros: string[]): Reg[] {
  const regs: Reg[] = [];
  let p = 0;
  while (p + 4 <= wb.length) {
    const tipo = u16(wb, p);
    const tam = u16(wb, p + 2);
    if (tam > MAX_REGISTRO) erros.push(`registro ${hex(tipo)} em ${p} com ${tam} bytes (máximo ${MAX_REGISTRO})`);
    if (p + 4 + tam > wb.length) {
      erros.push(`registro ${hex(tipo)} em ${p} passa do fim do fluxo`);
      break;
    }
    regs.push({ pos: p, tipo, dados: wb.subarray(p + 4, p + 4 + tam) });
    p += 4 + tam;
  }
  return regs;
}

/** Valida o arquivo .xls inteiro. */
export function validarXls(arquivo: Uint8Array): string[] {
  const erros: string[] = [];
  let wb: Uint8Array;
  try {
    const c = CFB.read(arquivo, { type: "buffer" });
    const f = CFB.find(c, "Workbook") ?? CFB.find(c, "Book");
    if (!f?.content) return ["sem fluxo Workbook"];
    wb = Uint8Array.from(f.content as ArrayLike<number>);
    if (f.size !== wb.length) erros.push(`fluxo Workbook com tamanho declarado ${f.size} e ${wb.length} bytes`);
  } catch (e) {
    return [`contêiner OLE ilegível: ${e instanceof Error ? e.message : String(e)}`];
  }
  return [...erros, ...validarFluxoWorkbook(wb)];
}

/** Valida só o fluxo Workbook (registros BIFF8). */
export function validarFluxoWorkbook(wb: Uint8Array): string[] {
  const erros: string[] = [];
  const regs = lerRegistros(wb, erros);
  const porPos = new Map<number, number>();
  regs.forEach((r, i) => porPos.set(r.pos, i));
  const tipoEm = (pos: number) => (porPos.has(pos) ? regs[porPos.get(pos)!].tipo : -1);

  // BOF/EOF
  let nivel = 0;
  for (const r of regs) {
    if (r.tipo === T.BOF) nivel++;
    if (r.tipo === T.EOF && --nivel < 0) {
      erros.push(`EOF sem BOF em ${r.pos}`);
      nivel = 0;
    }
  }
  if (nivel !== 0) erros.push(`BOF/EOF desbalanceados (${nivel} aberto(s))`);

  for (const r of regs) {
    if (r.tipo === T.BOUNDSHEET && tipoEm(u32(r.dados, 0)) !== T.BOF) erros.push(`BOUNDSHEET aponta para ${u32(r.dados, 0)}, que não é BOF`);
    if (r.tipo === T.INDEX) {
      const ibXF = u32(r.dados, 12);
      if (ibXF && tipoEm(ibXF) !== T.DEFCOLWIDTH) erros.push(`INDEX em ${r.pos}: ponteiro do DEFCOLWIDTH (${ibXF}) inválido`);
      for (let k = 0; 16 + 4 * k + 4 <= r.dados.length; k++) {
        const alvo = u32(r.dados, 16 + 4 * k);
        if (tipoEm(alvo) !== T.DBCELL) erros.push(`INDEX em ${r.pos}: DBCELL nº ${k} aponta para ${alvo}, que não é DBCELL`);
      }
    }
    if (r.tipo === T.EXTSST) {
      for (let k = 0; 2 + 8 * k + 8 <= r.dados.length; k++) {
        const ib = u32(r.dados, 2 + 8 * k);
        const cb = u16(r.dados, 6 + 8 * k);
        const t = tipoEm(ib - cb);
        if (t !== T.SST && t !== T.CONTINUE) erros.push(`EXTSST: balde ${k} aponta para fora do SST`);
      }
    }
  }
  erros.push(...validarDbcells(regs));

  const iGrupo = regs.findIndex((r) => r.tipo === T.MSODRAWINGGROUP);
  let clusters: { dgid: number; csp: number }[] = [];
  let refsBlip: number[] = [];
  if (iGrupo >= 0) {
    let k = iGrupo + 1;
    while (regs[k]?.tipo === T.CONTINUE) k++;
    const g = juntar(regs.slice(iGrupo, k).map((r) => r.dados));
    const v = validarGrupo(g);
    erros.push(...v.erros);
    clusters = v.clusters;
    refsBlip = v.cRef;
  }
  erros.push(...validarDesenhosDasAbas(regs, clusters, refsBlip));
  return erros;
}

function juntar(partes: Uint8Array[]) {
  const total = partes.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of partes) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * DBCELL: `dbRtrw` = distância do DBCELL até o 1º ROW do bloco; `rgdb[0]` = distância do 2º ROW (fim do 1º) até a
 * 1ª célula da 1ª linha com células; os seguintes = distância entre as primeiras células de linhas consecutivas.
 * (Convenção conferida no modelo oficial: todos os blocos que o gerador não mexeu batem exatamente com ela.)
 */
export function dbcellEsperado(regs: { pos: number; tipo: number; dados: Uint8Array }[], iDbcell: number): { dbRtrw: number; rgdb: number[] } | null {
  let fimRows = iDbcell - 1;
  while (fimRows >= 0 && regs[fimRows].tipo !== T.ROW) {
    if (regs[fimRows].tipo === T.DBCELL || regs[fimRows].tipo === T.BOF) return null;
    fimRows--;
  }
  if (fimRows < 0) return null;
  let iniRows = fimRows;
  while (iniRows > 0 && regs[iniRows - 1].tipo === T.ROW) iniRows--;
  const linhas = regs.slice(iniRows, fimRows + 1).map((r) => u16(r.dados, 0));
  const primeira = new Map<number, number>();
  for (let k = fimRows + 1; k < iDbcell; k++) {
    const r = regs[k];
    if (!REGISTROS_DE_CELULA.has(r.tipo)) continue;
    const linha = u16(r.dados, 0);
    if (!primeira.has(linha)) primeira.set(linha, r.pos);
  }
  const rgdb: number[] = [];
  let ref = regs[iniRows].pos + 20;
  for (const l of linhas) {
    const p = primeira.get(l);
    if (p === undefined) continue;
    rgdb.push(p - ref);
    ref = p;
  }
  return { dbRtrw: regs[iDbcell].pos - regs[iniRows].pos, rgdb };
}

function validarDbcells(regs: Reg[]): string[] {
  const erros: string[] = [];
  regs.forEach((r, i) => {
    if (r.tipo !== T.DBCELL) return;
    const e = dbcellEsperado(regs, i);
    if (!e) return erros.push(`DBCELL em ${r.pos} sem bloco de linhas antes`);
    if (u32(r.dados, 0) !== e.dbRtrw) erros.push(`DBCELL em ${r.pos}: distância até o ROW ${u32(r.dados, 0)}, esperado ${e.dbRtrw}`);
    const rgdb: number[] = [];
    for (let o = 4; o + 2 <= r.dados.length; o += 2) rgdb.push(u16(r.dados, o));
    if (rgdb.join() !== e.rgdb.join()) erros.push(`DBCELL em ${r.pos}: deslocamentos das células não batem com as linhas do bloco`);
  });
  return erros;
}

function validarGrupo(g: Uint8Array) {
  const erros: string[] = [];
  const clusters: { dgid: number; csp: number }[] = [];
  const cRef: number[] = [];
  const raiz = esc(g, 0);
  if (raiz.tipo !== 0xf000) return { erros: ["grupo de desenhos sem dggContainer"], clusters, cRef };
  if (8 + raiz.tam !== g.length) erros.push(`dggContainer declara ${raiz.tam} bytes e o grupo tem ${g.length - 8}`);
  let o = 8;
  while (o + 8 <= Math.min(g.length, 8 + raiz.tam)) {
    const h = esc(g, o);
    if (h.tipo === 0xf006) {
      const cidcl = u32(g, o + 12);
      if (16 + (cidcl - 1) * 8 !== h.tam) erros.push(`FDGG: ${cidcl - 1} grupos de ids declarados e ${(h.tam - 16) / 8} gravados`);
      for (let k = 0; k < cidcl - 1; k++) clusters.push({ dgid: u32(g, o + 24 + 8 * k), csp: u32(g, o + 28 + 8 * k) });
    }
    if (h.tipo === 0xf001) {
      let q = o + 8;
      let n = 0;
      while (q < o + 8 + h.tam) {
        const f = esc(g, q);
        if (f.tipo !== 0xf007) erros.push(`BStore: item ${n + 1} não é FBSE`);
        const size = u32(g, q + 8 + 20);
        const cbName = g[q + 8 + 33];
        cRef.push(u32(g, q + 8 + 24));
        if (size) {
          if (36 + cbName + size !== f.tam) erros.push(`FBSE ${n + 1}: tamanho ${f.tam} e 36 + nome + imagem = ${36 + cbName + size}`);
          const b = esc(g, q + 8 + 36 + cbName);
          if (8 + b.tam !== size) erros.push(`FBSE ${n + 1}: imagem declara ${8 + b.tam} bytes e o FBSE diz ${size}`);
          if (b.tipo < 0xf018 || b.tipo > 0xf117) erros.push(`FBSE ${n + 1}: imagem de tipo ${hex(b.tipo)}`);
        }
        q += 8 + f.tam;
        n++;
      }
      if (q !== o + 8 + h.tam) erros.push("BStore: itens não fecham com o tamanho declarado");
      if (h.inst !== n) erros.push(`BStore declara ${h.inst} imagens e tem ${n}`);
    }
    o += 8 + h.tam;
  }
  if (o !== 8 + raiz.tam) erros.push("dggContainer: itens não fecham com o tamanho declarado");
  return { erros, clusters, cRef };
}

function validarDesenhosDasAbas(regs: Reg[], clusters: { dgid: number; csp: number }[], cRef: number[]): string[] {
  const erros: string[] = [];
  const usoBlip = new Map<number, number>();
  let nivel = 0;
  let aba = -1;
  let desenhos: number[] = [];
  let objs: number[] = [];
  const fecharAba = () => {
    if (desenhos.length) erros.push(...validarDesenhoDaAba(regs, desenhos, objs, clusters, usoBlip, aba));
  };
  regs.forEach((r, i) => {
    if (r.tipo === T.BOF && ++nivel === 1) {
      aba++;
      desenhos = [];
      objs = [];
    }
    if (nivel === 1 && r.tipo === T.MSODRAWING) desenhos.push(i);
    if (nivel === 1 && r.tipo === T.OBJ && u16(r.dados, 0) === 0x15) objs.push(u16(r.dados, 6));
    if (r.tipo === T.EOF && nivel-- === 1) fecharAba();
  });
  usoBlip.forEach((n, pib) => {
    if (pib < 1 || pib > cRef.length) erros.push(`forma aponta para a imagem ${pib}, que não existe`);
    else if (cRef[pib - 1] < n) erros.push(`imagem ${pib}: ${n} forma(s) usam e a contagem de referências diz ${cRef[pib - 1]}`);
  });
  return erros;
}

function validarDesenhoDaAba(regs: Reg[], idx: number[], objs: number[], clusters: { dgid: number; csp: number }[], usoBlip: Map<number, number>, aba: number): string[] {
  const erros: string[] = [];
  const pre = `aba ${aba}:`;
  const s = juntar(idx.map((k) => regs[k].dados));
  const dg = esc(s, 0);
  if (dg.tipo !== 0xf002) return [`${pre} 1º desenho não é dgContainer`];
  if (8 + dg.tam !== s.length) erros.push(`${pre} dgContainer declara ${dg.tam} bytes e os desenhos somam ${s.length - 8}`);
  const dgid = esc(s, 8).inst;
  const spids: number[] = [];
  const andar = (o: number, fim: number) => {
    while (o < fim) {
      if (o + 8 > s.length) return void erros.push(`${pre} cabeçalho de desenho fora do fluxo`);
      const h = esc(s, o);
      if (o + 8 + h.tam > fim) return void erros.push(`${pre} item ${hex(h.tipo)} passa do contêiner`);
      if (h.tipo === 0xf00a) spids.push(u32(s, o + 8));
      if (h.tipo === 0xf00b) {
        for (let j = 0; j < h.inst; j++) {
          if ((u16(s, o + 8 + 6 * j) & 0x3fff) === 0x0104) {
            const pib = u32(s, o + 8 + 6 * j + 2);
            usoBlip.set(pib, (usoBlip.get(pib) ?? 0) + 1);
          }
        }
      }
      if (h.ver === 0xf) andar(o + 8, o + 8 + h.tam);
      o += 8 + h.tam;
    }
  };
  andar(8, Math.min(s.length, 8 + dg.tam));
  if (new Set(spids).size !== spids.length) erros.push(`${pre} id de forma repetido`);
  // A lista suspensa da validação de dados (OBJ do tipo 0x14) é desenhada pelo próprio Excel com o id "spidCur", fora dos grupos:
  // o modelo oficial já vem assim. Qualquer outra forma (foto, ícone, caixa) tem de estar num grupo de ids deste desenho.
  const listasSuspensas = new Set<number>();
  for (const k of idx) {
    const prox = regs[k + 1];
    if (prox?.tipo !== T.OBJ || u16(prox.dados, 0) !== 0x15 || u16(prox.dados, 4) !== 0x14) continue;
    const meus: number[] = [];
    const d = regs[k].dados;
    const varrer = (o: number, fim: number) => {
      while (o + 8 <= fim) {
        const h = esc(d, o);
        if (h.tipo === 0xf00a && o + 12 <= d.length) meus.push(u32(d, o + 8));
        if (h.ver === 0xf) varrer(o + 8, Math.min(fim, o + 8 + h.tam));
        o += 8 + h.tam;
      }
    };
    varrer(0, d.length);
    if (meus.length) listasSuspensas.add(meus[meus.length - 1]);
  }
  for (const spid of spids) {
    const c = clusters[(spid >> 10) - 1];
    if (listasSuspensas.has(spid)) continue;
    if (!c || c.dgid !== dgid) erros.push(`${pre} forma ${spid} fora dos grupos de ids do desenho ${dgid}`);
    else if ((spid & 0x3ff) >= c.csp) erros.push(`${pre} forma ${spid} além do último id registrado no grupo (${c.csp})`);
  }
  if (new Set(objs).size !== objs.length) erros.push(`${pre} id de objeto (OBJ) repetido`);
  for (const k of idx.slice(1)) {
    const t = esc(regs[k].dados, 0).tipo;
    const prox = regs[k + 1]?.tipo;
    if (t === 0xf004 && prox !== T.OBJ) erros.push(`${pre} forma em ${regs[k].pos} sem OBJ logo depois`);
    if (t === 0xf00d && prox !== T.TXO) erros.push(`${pre} caixa de texto em ${regs[k].pos} sem TXO logo depois`);
  }
  return erros;
}
