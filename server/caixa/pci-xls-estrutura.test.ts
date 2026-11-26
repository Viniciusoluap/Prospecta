/**
 * S-2 do EPIC-030 — planilha que o Excel abria "reparando" e que a CAIXA recusava ("essa planilha está com erro, não está
 * anexando"). O modelo oficial com macros tem INDEX/DBCELL e um spidCur fora do grupo de ids da aba; o modelo anonimizado
 * do repositório não tem nada disso, por isso os testes antigos passavam. Aqui o modelo anonimizado ganha essas duas
 * características (sem dado de cliente) e a planilha gerada passa pelo validador estrutural.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ABA_PROPOSTA_PCI, AVISO_TAMANHO_PCI_KB, avisoTamanhoPci, formularioPciVazio, LIMITE_ANEXO_CAIXA_KB, normalizarFormularioPci, type FormularioPci } from "../../shared/pci-gerador.js";
import { PastaBiff8, R, type Registro } from "./biff8.js";
import { PNG_MINIMO, substituirFotos, trocarImagensSemUso } from "./biff8-imagens.js";
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

/** Entradas do armazenamento de imagens (FBSE inteiro) e se a imagem é o PNG 1×1 de substituição. */
function imagensDoArmazenamento(arquivo: Uint8Array): { fbse: Uint8Array; png1x1: boolean }[] {
  const regs = PastaBiff8.abrir(arquivo).registros;
  const i = regs.findIndex((r) => r.tipo === R.MSODRAWINGGROUP);
  let k = i + 1;
  while (regs[k].tipo === R.CONTINUE) k++;
  const g = new Uint8Array(regs.slice(i, k).reduce((s, r) => s + r.dados.length, 0));
  let o = 0;
  for (const r of regs.slice(i, k)) {
    g.set(r.dados, o);
    o += r.dados.length;
  }
  const out: { fbse: Uint8Array; png1x1: boolean }[] = [];
  let q = 8;
  while (q < g.length) {
    const tipo = u16(g, q + 2);
    const tam = u32(g, q + 4);
    if (tipo === 0xf001) {
      let f = q + 8;
      while (f < q + 8 + tam) {
        const t = u32(g, f + 4);
        const fbse = g.slice(f, f + 8 + t);
        const dados = fbse.subarray(8 + 36 + 8 + 17);
        out.push({ fbse, png1x1: Buffer.compare(Buffer.from(dados), Buffer.from(PNG_MINIMO)) === 0 });
        f += 8 + t;
      }
    }
    q += 8 + tam;
  }
  return out;
}

/** pib usados por alguma forma (propriedades com o bit fBid), em qualquer aba. */
function referenciadas(arquivo: Uint8Array): Set<number> {
  const usadas = new Set<number>();
  for (const r of PastaBiff8.abrir(arquivo).registros) {
    if (r.tipo !== R.MSODRAWING) continue;
    const d = r.dados;
    const andar = (o: number, fim: number) => {
      while (o + 8 <= fim) {
        const vi = u16(d, o);
        const tipo = u16(d, o + 2);
        const tam = u32(d, o + 4);
        if (tipo === 0xf00b || tipo === 0xf121 || tipo === 0xf122) {
          for (let j = 0; j < vi >> 4 && o + 14 + 6 * j <= d.length; j++) {
            const pid = u16(d, o + 8 + 6 * j);
            if (pid & 0x4000 && !(pid & 0x8000)) usadas.add(u32(d, o + 10 + 6 * j));
          }
        }
        if ((vi & 0xf) === 0xf) andar(o + 8, Math.min(fim, o + 8 + tam));
        o += 8 + tam;
      }
    };
    andar(0, d.length);
  }
  return usadas;
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

  it("gerar 3 vezes em cadeia com foto de ~1 MB não faz o arquivo crescer e fica abaixo do limite da CAIXA", () => {
    const tamanhos: number[] = [];
    let atual = modeloOficial;
    for (let i = 0; i < 3; i++) {
      const r = gerarPlanilhaPci(atual, "xls", formulario(jpegSintetico(1_000_000 + i)));
      expect(r.avisos).toEqual([]);
      expect(validarXls(r.bytes)).toEqual([]);
      expect(r.bytes.length / 1024).toBeLessThan(AVISO_TAMANHO_PCI_KB);
      tamanhos.push(r.bytes.length);
      atual = r.bytes;
    }
    expect(Math.abs(tamanhos[2] - tamanhos[0])).toBeLessThan(16 * 1024);
    // as fotos antigas viraram o PNG 1×1 válido, na mesma posição da tabela
    const imagens = imagensDoArmazenamento(atual);
    expect(imagens.filter((x) => x.png1x1).length).toBeGreaterThanOrEqual(2);
  });

  it("imagem sem uso deixa de pesar; imagem em uso fica intacta byte a byte", () => {
    // o modelo tem imagens que nenhuma forma usa (cRef 0) e as usadas (logos, ícones)
    const antes = imagensDoArmazenamento(modeloOficial);
    const usadasAntes = referenciadas(modeloOficial);
    const r = gerarPlanilhaPci(modeloOficial, "xls", formulario());
    const depois = imagensDoArmazenamento(r.bytes);
    expect(depois.length).toBe(antes.length); // mesmas posições: nenhum pib muda
    let liberado = 0;
    antes.forEach((img, i) => {
      if (usadasAntes.has(i + 1)) expect(Buffer.compare(Buffer.from(depois[i].fbse), Buffer.from(img.fbse))).toBe(0);
      else {
        expect(depois[i].png1x1).toBe(true);
        liberado += img.fbse.length - depois[i].fbse.length;
      }
    });
    expect(liberado).toBeGreaterThan(100_000);
    expect(validarXls(r.bytes)).toEqual([]);
  });

  it("Codex #345: desenho partido em MSODRAWING + CONTINUE — imagem em uso continua intacta", () => {
    const inteira = PastaBiff8.abrir(modeloOficial);
    const esperado = trocarImagensSemUso(inteira).trocadas;
    expect(esperado).toBeGreaterThan(0);
    const partida = PastaBiff8.abrir(modeloOficial);
    const regs = partida.registros;
    let partidos = 0;
    for (let k = regs.length - 1; k >= 0; k--) {
      const d = regs[k].dados;
      if (regs[k].tipo !== R.MSODRAWING || d.length < 40) continue;
      const meio = d.length >> 1; // corta no meio, sem respeitar limite de registro do desenho
      regs.splice(k, 1, { tipo: R.MSODRAWING, dados: d.slice(0, meio) }, { tipo: R.CONTINUE, dados: d.slice(meio) });
      partidos++;
    }
    expect(partidos).toBeGreaterThan(0);
    expect(trocarImagensSemUso(partida).trocadas).toBe(esperado);
  });

  it("Codex #345: desenho que não dá para ler inteiro — nenhuma imagem é trocada", () => {
    const p = PastaBiff8.abrir(modeloOficial);
    const desenho = p.registros.find((r) => r.tipo === R.MSODRAWING)!;
    desenho.dados = desenho.dados.slice(0, desenho.dados.length - 3); // fluxo truncado
    expect(trocarImagensSemUso(p)).toEqual({ trocadas: 0, bytesLiberados: 0 });
  });

  it("avisa (nunca em silêncio) quando a planilha passa do limite de anexo da CAIXA", () => {
    expect(avisoTamanhoPci(4_900 * 1024)).toBeNull();
    expect(avisoTamanhoPci(5_342 * 1024)).toMatch(/5\.342 KB.*até 5\.120 KB/);
    expect(LIMITE_ANEXO_CAIXA_KB).toBe(5120);
  });

  it("foto com id fora do grupo (PCI salva pelo gerador antigo) é corrigida quando outra aba recebe foto", () => {
    const pci = gerarPlanilhaPci(modeloOficial, "xls", formulario(jpegSintetico(50_000))).bytes;
    // imita o gerador antigo: foto da proposta com o id 143935
    const p = PastaBiff8.abrir(pci);
    const [ini, fim] = p.intervaloDaAba(p.aba(ABA_PROPOSTA_PCI));
    const novoSpid = Math.max(...spidsDasFotos(pci));
    const forma = p.registros.slice(ini, fim).find((r) => r.tipo === R.MSODRAWING && u16(r.dados, 2) === 0xf004 && u32(r.dados, 16) === novoSpid)!;
    w32(forma.dados, 16, 143935);
    const antiga = p.salvar();
    expect(validarXls(antiga).some((e) => /forma 143935 fora dos grupos/.test(e))).toBe(true);
    // medição/PLS: a foto entra em outra aba; a da proposta é normalizada junto
    const m = PastaBiff8.abrir(antiga);
    substituirFotos(m, "PLS", [{ coluna1: 1, linha1: 300, coluna2: 8, linha2: 320 }], [{ dados: jpegSintetico(30_000), tipo: "jpeg" }]);
    const saida = m.salvar();
    expect(validarXls(saida)).toEqual([]);
    expect(spidsDasFotos(saida).every((s) => s >= 1024 && s < 2048)).toBe(true);
  });
});
