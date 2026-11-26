/**
 * S-2 do EPIC-030 — planilha que o Excel abria "reparando" e que a CAIXA recusava ("essa planilha está com erro, não está
 * anexando"). O modelo oficial com macros tem INDEX/DBCELL e um spidCur fora do grupo de ids da aba; o modelo anonimizado
 * do repositório não tem nada disso, por isso os testes antigos passavam. Aqui o modelo anonimizado ganha essas duas
 * características (sem dado de cliente) e a planilha gerada passa pelo validador estrutural.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ABA_PROPOSTA_PCI, formularioPciVazio, normalizarFormularioPci, type FormularioPci } from "../../shared/pci-gerador.js";
import { PastaBiff8, R, type Registro } from "./biff8.js";
import { validarFluxoWorkbook, validarXls } from "./biff8-validador.js";
import { gerarPlanilhaPci } from "./pci-gerador.js";

const MODELO = new Uint8Array(readFileSync(new URL("./__fixtures__/pci-modelo-anonimo.xls", import.meta.url)));
const u16 = (d: Uint8Array, o: number) => d[o] | (d[o + 1] << 8);
const u32 = (d: Uint8Array, o: number) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16)) + d[o + 3] * 0x1000000;
const w32 = (d: Uint8Array, o: number, v: number) => new DataView(d.buffer, d.byteOffset + o, 4).setUint32(0, v >>> 0, true);

/** JPEG sintético (cabeçalho SOF0 4×3 + bytes de enchimento): tamanho à vontade, nenhum dado real. */
function jpegSintetico(n: number): Uint8Array {
  const b = new Uint8Array(n);
  b.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0x03, 0x00, 0x04, 0x00, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
  for (let i = 21; i < n - 2; i++) b[i] = (i * 7919) & 0x7f;
  b[n - 2] = 0xff;
  b[n - 1] = 0xd9;
  return b;
}

const AUXILIARES_DE_CELULA = new Set([0x0203, 0x027e, 0x00bd, 0x00fd, 0x0204, 0x0201, 0x00be, 0x0205, 0x0006, 0x0207, 0x04bc, 0x0221, 0x0236]);

/** Põe INDEX (logo depois do BOF) e um DBCELL no fim de cada bloco de linhas, como o Excel grava. O salvar() preenche os valores. */
function modeloComIndicesDeLinhas(modelo: Uint8Array, spidCurDaProposta?: number): Uint8Array {
  const p = PastaBiff8.abrir(modelo);
  for (const aba of p.abas) {
    const [ini, fim] = p.intervaloDaAba(aba);
    const regs = p.registros;
    const inserir: { em: number; reg: Registro }[] = [];
    let blocos = 0;
    let nivel = 0;
    for (let k = ini; k < fim; k++) {
      if (regs[k].tipo === R.BOF) nivel++;
      if (regs[k].tipo === R.EOF) nivel--;
      if (nivel !== 1 || regs[k].tipo !== R.ROW || regs[k - 1].tipo === R.ROW) continue;
      let j = k;
      while (regs[j].tipo === R.ROW) j++;
      while (AUXILIARES_DE_CELULA.has(regs[j].tipo)) j++;
      inserir.push({ em: j, reg: { tipo: R.DBCELL, dados: new Uint8Array(4) } });
      blocos++;
    }
    if (!blocos) continue;
    for (const { em, reg } of inserir.reverse()) regs.splice(em, 0, reg);
    const index = new Uint8Array(16 + 4 * blocos);
    w32(index, 12, 1); // pede o ponteiro do DEFCOLWIDTH
    regs.splice(ini + 1, 0, { tipo: R.INDEX, dados: index });
  }
  if (spidCurDaProposta !== undefined) {
    const [ini, fim] = p.intervaloDaAba(p.aba(ABA_PROPOSTA_PCI));
    const desenho = p.registros.slice(ini, fim).find((r) => r.tipo === R.MSODRAWING)!;
    w32(desenho.dados, 20, spidCurDaProposta); // FDG.spidCur
  }
  return p.salvar();
}

function contar(arquivo: Uint8Array, tipo: number) {
  return PastaBiff8.abrir(arquivo).registros.filter((r) => r.tipo === tipo).length;
}

function formulario(foto?: Uint8Array): FormularioPci {
  const f = formularioPciVazio();
  Object.assign(f.campos, {
    proponenteNome: "FULANA SINTETICA DE TESTE", endereco: "RUA SINTETICA, 1", bairro: "CENTRO", municipio: "IMPERATRIZ", uf: "MA",
    areaCoberta: 61.25, areaTerreno: 250, valorTerreno: 60000, valorImovel: 199000, observacoes: `TEXTO NOVO NO SST ${"X".repeat(300)}`,
  });
  f.custos = f.custos.map((_, i) => 1000 + i * 10);
  const base = normalizarFormularioPci(f);
  return foto ? normalizarFormularioPci({ ...base, imagem: { tipo: "jpeg", base64: Buffer.from(foto).toString("base64") } }) : base;
}

/** Ids (spid) das formas com imagem da aba da proposta. */
function spidsDasFotos(arquivo: Uint8Array): number[] {
  const p = PastaBiff8.abrir(arquivo);
  const out: number[] = [];
  for (const { reg } of p.celulasDaAba(p.aba(ABA_PROPOSTA_PCI))) {
    if (reg.tipo !== R.MSODRAWING || u16(reg.dados, 2) !== 0xf004) continue;
    const d = reg.dados;
    let o = 8;
    let spid = 0;
    let temFoto = false;
    while (o + 8 <= d.length) {
      const tipo = u16(d, o + 2);
      const tam = u32(d, o + 4);
      if (tipo === 0xf00a) spid = u32(d, o + 8);
      if (tipo === 0xf00b) for (let j = 0; j < u16(d, o) >> 4; j++) if ((u16(d, o + 8 + 6 * j) & 0x3fff) === 0x0104) temFoto = true;
      o += 8 + tam;
    }
    if (temFoto) out.push(spid);
  }
  return out;
}

describe("PCI .xls — estrutura que o Excel e a CAIXA exigem (S-2 do EPIC-030)", () => {
  const modeloOficial = modeloComIndicesDeLinhas(MODELO, 143934);

  it("o validador aceita o modelo do repositório e o modelo com INDEX/DBCELL", () => {
    expect(validarXls(MODELO)).toEqual([]);
    expect(contar(modeloOficial, R.INDEX)).toBeGreaterThan(5);
    expect(contar(modeloOficial, R.DBCELL)).toBeGreaterThan(40);
    expect(validarXls(modeloOficial)).toEqual([]);
  });

  it("o validador acusa INDEX velho, DBCELL velho e forma fora do grupo de ids", () => {
    const pasta = PastaBiff8.abrir(modeloOficial);
    const regs = pasta.registros;
    // sem passar pelo salvar() (que recalcula tudo): é o fluxo como o gerador antigo deixava
    const fluxoCru = () => {
      const wb = new Uint8Array(regs.reduce((s, r) => s + 4 + r.dados.length, 0));
      let o = 0;
      for (const r of regs) {
        wb.set([r.tipo & 0xff, r.tipo >> 8, r.dados.length & 0xff, r.dados.length >> 8], o);
        wb.set(r.dados, o + 4);
        o += 4 + r.dados.length;
      }
      return wb;
    };
    expect(validarFluxoWorkbook(fluxoCru())).toEqual([]);

    const index = regs.find((r) => r.tipo === R.INDEX)!;
    w32(index.dados, 16, u32(index.dados, 16) + 3);
    const dbcell = regs.find((r) => r.tipo === R.DBCELL)!;
    w32(dbcell.dados, 0, u32(dbcell.dados, 0) + 4);
    const [ini, fim] = pasta.intervaloDaAba(pasta.aba(ABA_PROPOSTA_PCI));
    const forma = regs.slice(ini, fim).filter((r) => r.tipo === R.MSODRAWING && u16(r.dados, 2) === 0xf004).pop()!;
    w32(forma.dados, 16, 143935); // FSP (logo depois do cabeçalho do spContainer) da última forma: id fora do grupo da aba
    const erros = validarFluxoWorkbook(fluxoCru());
    expect(erros.some((e) => /INDEX .*não é DBCELL/.test(e))).toBe(true);
    expect(erros.some((e) => /DBCELL .*distância até o ROW/.test(e))).toBe(true);
    expect(erros.some((e) => /forma 143935 fora dos grupos de ids/.test(e))).toBe(true);
  });

  it.each([
    ["sem foto", undefined],
    ["foto pequena (20 KB)", jpegSintetico(20_000)],
    ["foto grande (1,4 MB)", jpegSintetico(1_400_000)],
  ] as const)("gerada a partir do modelo com macros — %s — sai sem nenhuma inconsistência", (_, foto) => {
    const r = gerarPlanilhaPci(modeloOficial, "xls", formulario(foto));
    expect(r.avisos).toEqual([]);
    expect(validarXls(r.bytes)).toEqual([]);
    if (foto) {
      const spids = spidsDasFotos(r.bytes);
      const nova = Math.max(...spids);
      // a foto nova fica no grupo de ids da própria aba (1024–2047), e não em spidCur + 1 (143935)
      expect(nova).toBeGreaterThanOrEqual(1024);
      expect(nova).toBeLessThan(2048);
    }
  });

  it("gerar de novo a partir de uma PCI já gerada (com foto grande) continua coerente", () => {
    const primeira = gerarPlanilhaPci(modeloOficial, "xls", formulario(jpegSintetico(1_400_000))).bytes;
    const segunda = gerarPlanilhaPci(primeira, "xls", formulario(jpegSintetico(300_000)));
    expect(segunda.avisos).toEqual([]);
    expect(validarXls(segunda.bytes)).toEqual([]);
  });
});
