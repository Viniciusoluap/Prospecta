import { describe, expect, it } from "vitest";
import { dadosMedicaoPadrao, dadosPlsPadrao, datasAlvaraDasMedicoes } from "../shared/medicao-caixa";

describe("alvará nas medições PLS da mesma obra", () => {
  it("herda separadamente a última data preenchida de cada campo, antes da PCI", () => {
    const pci = { alvaraEmissao: "2020-01-01", alvaraVigencia: "2030-01-01" };
    const historico = [
      { pls: { alvaraEmissao: null, alvaraVigencia: "2028-08-17" } },
      { pls: { alvaraEmissao: "2026-01-31", alvaraVigencia: null } },
      { pls: { alvaraEmissao: "2025-05-05", alvaraVigencia: "2027-05-05" } },
    ];
    const datas = datasAlvaraDasMedicoes(historico, pci);
    expect(datas).toEqual({ alvaraEmissao: "2026-01-31", alvaraVigencia: "2028-08-17" });
    const nova = dadosMedicaoPadrao("pls", dadosPlsPadrao(datas));
    expect(nova.pls.alvaraEmissao).toBe("2026-01-31");
    expect(nova.pls.alvaraVigencia).toBe("2028-08-17");
    expect(historico[0].pls.alvaraEmissao).toBeNull();
  });

  it("usa PCI somente para campo nunca salvo e deixa editável a cópia nova", () => {
    const historico = [{ pls: { alvaraEmissao: "2026-02-02", alvaraVigencia: null } }];
    const datas = datasAlvaraDasMedicoes(historico, { alvaraVigencia: "2029-10-10" });
    expect(datas).toEqual({ alvaraEmissao: "2026-02-02", alvaraVigencia: "2029-10-10" });
    const nova = dadosMedicaoPadrao("pls", dadosPlsPadrao(datas));
    nova.pls.alvaraVigencia = "2031-06-01";
    expect(historico[0].pls.alvaraVigencia).toBeNull();
    expect(datasAlvaraDasMedicoes([], {})).toEqual({ alvaraEmissao: null, alvaraVigencia: null });
  });

  it("ignora datas antigas malformadas sem impedir uma data válida anterior", () => {
    expect(datasAlvaraDasMedicoes([
      { pls: { alvaraEmissao: "dia desconhecido", alvaraVigencia: "" } },
      { pls: { alvaraEmissao: "2025-12-01", alvaraVigencia: null } },
    ], { alvaraEmissao: "2024-01-01", alvaraVigencia: "2027-12-01" })).toEqual({
      alvaraEmissao: "2025-12-01",
      alvaraVigencia: "2027-12-01",
    });
  });
});
