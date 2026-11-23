// EPIC-029 S-8 — módulo puro do Simples (shared/fiscal/simples.ts). Os casos de "exemplos" são os do ALIQUOTAS.md §3.5,
// calculados à mão; os números aqui são em u (0,0001 ponto percentual) e centavos.
import { describe, expect, it } from "vitest";
import {
  ErroSimples, TABELAS_SIMPLES, TABELA_LC155, U_TOTAL, aliquotaEfetiva, anexoDoServico, calcularSimples, centavosDaAliquota, faixaDoRbt12, fatorR,
  aliquotaTextoParaDps, issNaSextaFaixa, mesAntes, mesesDeAtividadeAntes, parteDoIss, percentualDecimal, percentualDps, percentualTexto, sublimiteDoIss, rbt12Proporcional, reparticao, tabelaDoPeriodo, ultimoDiaDoMes,
  type Anexo,
} from "../../shared/fiscal/simples.js";

const R$ = (v: number) => Math.round(v * 100);

describe("ALIQUOTAS.md §3.5 — exemplos calculados à mão", () => {
  it("Obra, Anexo IV, RBT12 R$ 500.000 → efetiva 7,7160%, ISS 3,0864%", () => {
    const e = aliquotaEfetiva(R$(500_000), "IV");
    expect(e).toMatchObject({ faixa: 3, efetiva: 77_160 });
    expect(percentualTexto(e.efetiva)).toBe("7,7160%");
    expect(parteDoIss(R$(500_000), "IV")).toEqual({ iss: 30_864, tetoAplicado: false });
  });
  it("Serviço, Anexo III, RBT12 R$ 500.000 → efetiva 9,9720%, ISS 3,2409%", () => {
    expect(aliquotaEfetiva(R$(500_000), "III").efetiva).toBe(99_720);
    expect(parteDoIss(R$(500_000), "III").iss).toBe(32_409);
  });
  it("Serviço, Anexo V, RBT12 R$ 500.000 → efetiva 17,5200%, ISS 3,3288%", () => {
    expect(aliquotaEfetiva(R$(500_000), "V").efetiva).toBe(175_200);
    expect(parteDoIss(R$(500_000), "V").iss).toBe(33_288);
  });
  it("Anexo III, 5ª faixa, RBT12 R$ 3.000.000 → efetiva 16,8120%, ISS no teto de 5%, IRPJ 0,7111%", () => {
    const e = aliquotaEfetiva(R$(3_000_000), "III");
    expect(e).toMatchObject({ faixa: 5, efetiva: 168_120 });
    const r = reparticao(R$(3_000_000), "III");
    expect(r.tetoAplicado).toBe(true);
    expect(r.partes.iss).toBe(50_000);
    expect(r.partes.irpj).toBe(7_111); // 11,812% × 6,02% = 0,7110824% → 0,7111%
  });
  it("Anexo IV, 5ª faixa, RBT12 R$ 2.000.000 → efetiva 12,8110%, ISS no teto de 5%, IRPJ 2,4472%", () => {
    expect(aliquotaEfetiva(R$(2_000_000), "IV").efetiva).toBe(128_110);
    const r = reparticao(R$(2_000_000), "IV");
    expect(r).toMatchObject({ tetoAplicado: true, partes: { iss: 50_000, irpj: 24_472 } }); // 7,811% × 31,33% = 2,4471863%
    expect(r.partes.cpp).toBeUndefined(); // Anexo IV: CPP fora do DAS
  });
  it("Fator r: folha R$ 150.000 ÷ RBT12 R$ 500.000 = 30% → Anexo III", () => {
    const r = fatorR(R$(150_000), R$(500_000));
    expect(r).toEqual({ r: 300_000, atinge: true, motivo: "r ≥ 28%" });
    expect(anexoDoServico("9", r)).toMatchObject({ anexo: "III", fatorR: "anexo_iii" });
  });
});

describe("faixas, limites e teto", () => {
  it("limite da faixa é inclusivo (R$ 180.000,00 na 1ª; R$ 180.000,01 na 2ª)", () => {
    expect(faixaDoRbt12(R$(180_000), "III").numero).toBe(1);
    expect(faixaDoRbt12(R$(180_000) + 1, "III").numero).toBe(2);
    expect(faixaDoRbt12(R$(4_800_000), "V").numero).toBe(6);
  });
  it("acima de R$ 4,8 milhões: fora do Simples (erro, nada de número)", () => {
    expect(() => aliquotaEfetiva(R$(4_800_000) + 1, "III")).toThrow(ErroSimples);
  });
  it("RBT12 zero → nominal da 1ª faixa", () => {
    expect(aliquotaEfetiva(0, "III").efetiva).toBe(60_000);
    expect(aliquotaEfetiva(0, "IV").efetiva).toBe(45_000);
    expect(parteDoIss(0, "III").iss).toBe(20_100); // 6% × 33,5%
  });
  it("5ª faixa abaixo do limiar do teto (Anexo III, R$ 2.000.000): ISS pela repartição normal", () => {
    // efetiva = 21% − 125.640/2.000.000 = 14,718% (< 14,92537%) → ISS 14,718% × 33,5% = 4,93053% → 4,9305%
    expect(reparticao(R$(2_000_000), "III")).toMatchObject({ tetoAplicado: false, partes: { iss: 49_305 } });
  });
  it("6ª faixa: ISS fora do DAS (sublimite)", () => {
    const r = parteDoIss(R$(4_000_000), "III");
    expect(r.iss).toBeNull();
    expect(reparticao(R$(4_000_000), "IV").issDentroDoDas).toBe(false);
  });
  it("Anexo V não tem teto: a maior efetiva da 5ª faixa dá 4,9996% de ISS", () => {
    const r = reparticao(R$(3_600_000), "V");
    expect(r.tetoAplicado).toBe(false);
    expect(aliquotaEfetiva(R$(3_600_000), "V").efetiva).toBe(212_750);
    expect(r.partes.iss).toBe(49_996);
  });
  it("toda linha de repartição (e do excedente do teto) soma 100%", () => {
    for (const anexo of ["III", "IV", "V"] as Anexo[]) {
      for (const f of TABELA_LC155.anexos![anexo]) {
        expect(Object.values(f.reparticao).reduce((a, b) => a + (b ?? 0), 0)).toBe(U_TOTAL);
        if (f.teto) expect(Object.values(f.teto.excedente).reduce((a, b) => a + (b ?? 0), 0)).toBe(U_TOTAL);
      }
    }
  });
  it("RBT12 inválido (negativo ou com fração de centavo) é recusado", () => {
    expect(() => aliquotaEfetiva(-1, "III")).toThrow(ErroSimples);
    expect(() => aliquotaEfetiva(1.5, "III")).toThrow(ErroSimples);
  });
});

describe("tabelas por período de vigência", () => {
  it("2018 a 2026 → LC 123/LC 155; 2027 → lacuna (sem números inventados)", () => {
    expect(tabelaDoPeriodo("2026-12")?.id).toBe("lc123-lc155-2018");
    expect(tabelaDoPeriodo("2026-12-31")?.id).toBe("lc123-lc155-2018");
    const t27 = tabelaDoPeriodo("2027-01-01");
    expect(t27?.id).toBe("lc214-2027-2028");
    expect(t27?.anexos).toBeNull();
    expect(tabelaDoPeriodo("2017-12")).toBeNull();
    expect(TABELAS_SIMPLES.filter(t => t.anexos).length).toBe(1);
  });
  it("calcularSimples em 2027 recusa com a lacuna", () => {
    expect(() => calcularSimples({ competencia: "2027-02", cAtvSN: "13", rbt12: R$(500_000), fatorR: null })).toThrow(/2027/);
  });
  it("calcularSimples junta anexo, faixa, efetiva e ISS", () => {
    const c = calcularSimples({ competencia: "2026-11-20", cAtvSN: "13", rbt12: R$(500_000), fatorR: null });
    expect(c).toMatchObject({ tabela: { id: "lc123-lc155-2018" }, anexo: { anexo: "IV" }, faixa: 3, nominal: 102_000, deduzirCentavos: R$(12_420), efetiva: 77_160, iss: 30_864 });
  });
});

describe("anexo por cAtvSN e Fator R", () => {
  it("7/8/12 → III; 13/14 → IV", () => {
    expect(["7", "8", "12"].map(c => anexoDoServico(c, null).anexo)).toEqual(["III", "III", "III"]);
    expect(["13", "14"].map(c => anexoDoServico(c, null).anexo)).toEqual(["IV", "IV"]);
  });
  it("9 sem folha → Anexo V (o lado de pagar mais), marcado a informar", () => {
    expect(anexoDoServico("9", null)).toMatchObject({ anexo: "V", fatorR: "a_informar" });
    expect(anexoDoServico("9", fatorR(null, R$(500_000)))).toMatchObject({ anexo: "V", fatorR: "a_informar" });
    expect(anexoDoServico("9", fatorR(R$(10_000), 0))).toMatchObject({ anexo: "V", fatorR: "a_informar" });
  });
  it("9 com r < 28% → V; exatamente 28% → III", () => {
    expect(anexoDoServico("9", fatorR(R$(139_999.99), R$(500_000)))).toMatchObject({ anexo: "V", fatorR: "anexo_v" });
    expect(anexoDoServico("9", fatorR(R$(140_000), R$(500_000)))).toMatchObject({ anexo: "III", fatorR: "anexo_iii" });
  });
  it("sem cAtvSN ou impeditiva → erro", () => {
    expect(() => anexoDoServico(null, null)).toThrow(ErroSimples);
    expect(() => anexoDoServico("IMP", null)).toThrow(ErroSimples);
  });
});

describe("RBT12 proporcional (menos de 12 meses de atividade)", () => {
  it("1º mês: receita do mês × 12", () => {
    expect(rbt12Proporcional([], R$(10_000))).toEqual({ rbt12: R$(120_000), regra: "primeiro_mes", meses: 0 });
  });
  it("5º mês: média dos 4 anteriores × 12", () => {
    expect(rbt12Proporcional([R$(10_000), R$(20_000), R$(30_000), R$(40_000)], R$(99_999))).toEqual({ rbt12: R$(300_000), regra: "media_dos_meses", meses: 4 });
  });
  it("média com fração de centavo arredonda meio para cima", () => {
    expect(rbt12Proporcional([1, 0, 0, 0, 0, 0, 0], 0).rbt12).toBe(2); // 12/7 = 1,71 → 2
  });
  it("12 meses ou mais: soma só os 12 últimos", () => {
    const meses = Array.from({ length: 14 }, (_, i) => (i + 1) * 100);
    expect(rbt12Proporcional(meses, 0)).toEqual({ rbt12: meses.slice(-12).reduce((a, b) => a + b, 0), regra: "doze_meses", meses: 12 });
  });
  it("meses de atividade antes da competência", () => {
    expect(mesesDeAtividadeAntes("2026-07-15", "2026-11-20")).toBe(4);
    expect(mesesDeAtividadeAntes("2026-11-02", "2026-11")).toBe(0);
    expect(mesesDeAtividadeAntes("2021-05-07", "2026-11")).toBe(66);
    expect(mesesDeAtividadeAntes(null, "2026-11")).toBeNull();
  });
});

describe("formatos e datas", () => {
  it("percentuais e centavos", () => {
    expect(percentualDecimal(30_864)).toBe("3.0864");
    expect(percentualTexto(50_000)).toBe("5,0000%");
    expect(centavosDaAliquota(R$(1_000), 30_864)).toBe(3_086); // R$ 30,864 → R$ 30,86
    expect(centavosDaAliquota(50, 10_000)).toBe(1); // R$ 0,005 → R$ 0,01 (meio para cima)
  });
  it("meses anteriores e último dia", () => {
    expect(mesAntes("2026-01", 1)).toBe("2025-12");
    expect(mesAntes("2026-11-20", 12)).toBe("2025-11");
    expect(ultimoDiaDoMes("2024-02")).toBe("2024-02-29");
    expect(ultimoDiaDoMes("2026-12")).toBe("2026-12-31");
  });
});

describe("QA S-8 — sublimite (M3) e pAliq com 2 casas", () => {
  it("ano anterior acima de R$ 3,6 mi → ISS fora no ano todo; igual ao limite → no DAS", () => {
    expect(sublimiteDoIss({ competencia: "2026-01", rbaAnoAnterior: R$(3_600_000) + 1, rbaAnoAtualAteMesAnterior: 0 }).issNoDas).toBe(false);
    expect(sublimiteDoIss({ competencia: "2026-01", rbaAnoAnterior: R$(3_600_000), rbaAnoAtualAteMesAnterior: 0 }).issNoDas).toBe(true);
  });
  it("ano em curso: até 20% acima → no DAS com aviso; mais de 20% → fora", () => {
    const ate20 = sublimiteDoIss({ competencia: "2026-08", rbaAnoAnterior: 0, rbaAnoAtualAteMesAnterior: R$(4_320_000) });
    expect(ate20).toMatchObject({ issNoDas: true, aviso: expect.stringMatching(/janeiro de 2027/) });
    expect(sublimiteDoIss({ competencia: "2026-08", rbaAnoAnterior: 0, rbaAnoAtualAteMesAnterior: R$(4_320_000) + 1 }).issNoDas).toBe(false);
  });
  it("ano de início de atividade: sublimite proporcional (R$ 300 mil × meses até dezembro)", () => {
    // Início em julho/2026: 6 meses → R$ 1,8 mi; 20% acima = R$ 2,16 mi.
    const s = sublimiteDoIss({ competencia: "2026-11", rbaAnoAnterior: 0, rbaAnoAtualAteMesAnterior: R$(2_160_000) + 1, inicioAtividade: "2026-07-10" });
    expect(s).toMatchObject({ issNoDas: false, limiteAnoAtual: R$(1_800_000) });
    // Início em outubro/2025: limite de 2025 = R$ 900 mil.
    expect(sublimiteDoIss({ competencia: "2026-03", rbaAnoAnterior: R$(900_000) + 1, rbaAnoAtualAteMesAnterior: 0, inicioAtividade: "2025-10-01" }).issNoDas).toBe(false);
  });
  it("6ª faixa sem excesso: ISS pela 5ª faixa com teto de 5% (III, IV e V)", () => {
    expect(issNaSextaFaixa(R$(3_700_000), "III")).toEqual({ iss: 50_000, tetoAplicado: true });
    expect(issNaSextaFaixa(R$(3_700_000), "IV")).toEqual({ iss: 50_000, tetoAplicado: true });
    expect(issNaSextaFaixa(R$(3_700_000), "V")).toEqual({ iss: 50_000, tetoAplicado: true }); // 21,3216% × 23,5% = 5,0106% → 5%
    const c = calcularSimples({ competencia: "2026-02", cAtvSN: "13", rbt12: R$(3_700_000), fatorR: null });
    expect(c).toMatchObject({ faixa: 6, iss: 50_000 });
    expect(calcularSimples({ competencia: "2026-02", cAtvSN: "13", rbt12: R$(500_000), fatorR: null, issForaDoDas: true }).iss).toBeNull();
  });
  it("pAliq com 2 casas, meio para cima", () => {
    expect(percentualDps(30_864)).toBe("3.09");
    expect(percentualDps(32_450)).toBe("3.25");
    expect(percentualDps(32_449)).toBe("3.24");
    expect(percentualDps(50_000)).toBe("5.00");
    expect(aliquotaTextoParaDps("5.0000")).toBe("5.00");
    expect(aliquotaTextoParaDps(null)).toBeNull();
  });
});
