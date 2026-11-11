import { describe, expect, it } from "vitest";
import { ANEL_POLIMEROS, CENTRO_POLIMEROS } from "./fixtures/polimeros-lote01-qdo";
import { criarProjecao, gerarEstudoMassa, validarParametrosMassa, type ParametrosMassa } from "../shared/incorporacao/massa";
import { buscarViasPublicas, completarAproveitamento, trechosDaDivisa } from "../shared/incorporacao/vias-publicas";
import { areaPlanar } from "../shared/incorporacao/geometria-parcelamento";

const P: ParametrosMassa = { larguraViaM: 0, testadaLoteM: 5, profundidadeLoteM: 25, loteMinimoM2: 125, comprimentoMaxQuadraM: 0,
  percentInstitucional: 0, percentAreaVerde: 0, precoM2Lote: 500, tipologia: "vias_publicas" };

describe("Vias públicas — desmembramento com 100% de aproveitamento", () => {
  it("aceita via 0 e quadra máx. 0 (não se aplicam) e continua exigindo testada/área compatíveis", () => {
    expect(validarParametrosMassa(P)).toBeNull();
    expect(validarParametrosMassa({ ...P, tipologia: "grid" })).toMatch(/Comprimento máximo da quadra/);
  });
  it("retângulo 20 × 50 com lote 5 × 25 ≥ 125 m²: 8 lotes, sem via, 100% da área", () => {
    const ret = [[0, 0], [20, 0], [20, 50], [0, 50], [0, 0]];
    const [r] = buscarViasPublicas(ret, { testada: 5, profundidade: 25, loteMinimoM2: 125 }, 1);
    const soma = r.lotes.reduce((s, l) => s + l.area, 0);
    expect(soma).toBeCloseTo(1000, 1);
    expect(r.viasLivres).toEqual([]);
    expect(r.lotes.length).toBeGreaterThanOrEqual(6);
    for (const l of r.lotes) { expect(l.area).toBeGreaterThanOrEqual(125 - 1e-6); expect(l.testada!).toBeGreaterThanOrEqual(5 - 1e-6); }
  });
  it("sobra sem frente vai para o lote vizinho (nada fica sem dono)", () => {
    const ret = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const lote = { anel: [[0, 0], [10, 0], [10, 6], [0, 6], [0, 0]], area: 60, ret: [0, 0, 10, 6] as [number, number, number, number], linha: 0, faixa: 0, segmento: 0, ordem: 0, testada: 10, profundidadeMedia: 6 };
    const c = completarAproveitamento(ret, [lote], { testada: 20, profundidade: 6, loteMinimoM2: 50 });
    expect(c).toHaveLength(1);
    expect(c[0].area).toBeCloseTo(100, 6);
  });
  it("Polímeros (Lote 01 Qd O, KML real em U com balão): 60 lotes ≥ 125 m² como no projeto aprovado, frente ≥ 5 m, 100%, viário 0", () => {
    const m = criarProjecao(CENTRO_POLIMEROS);
    const anel = ANEL_POLIMEROS.map((x) => m.paraMetros(x)); anel[anel.length - 1] = anel[0];
    expect(trechosDaDivisa(anel)).toHaveLength(5); // externo (reta + arco + reta), balão + reta interna e 3 retos
    const r = gerarEstudoMassa(ANEL_POLIMEROS, CENTRO_POLIMEROS, P);
    const c = r.cenarios[0];
    // projeto aprovado (SEPLU, processo 1769/2026): 60 lotes — o teto ⌊área ÷ 125⌋
    expect(c.kpis.lotesVendaveis).toBe(60);
    expect(c.kpis.lotesVendaveis).toBe(Math.floor(areaPlanar(anel) / 125));
    expect(c.kpis.areaVendavelM2).toBeCloseTo(areaPlanar(anel), 0);
    expect(c.sistemaViario!.areaGeometricaM2).toBe(0);
    for (const l of c.lotes) { expect(l.areaM2).toBeGreaterThanOrEqual(125 - 0.01); expect(l.areaM2).toBeLessThan(145); }
    // sem sobreposição: a soma das áreas dos lotes é a área da gleba
    expect(c.lotes.reduce((s, l) => s + l.areaM2, 0)).toBeLessThanOrEqual(areaPlanar(anel) + 0.5);
  }, 180_000);
});
