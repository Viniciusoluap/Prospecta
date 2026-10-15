// Portal do Empreiteiro (pedido de 15/10/2026): permissões por obra, somas da aba
// Relatórios e fotos. Mesmo conteúdo em
// Grupo-Santa-Fe/web/src/lib/__tests__/portal-empreiteiro.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as db from "./db.js";
import { appRouter } from "./routers.js";
import { autorizarEmpreiteiro } from "./obra-acesso.js";
import { totaisDoEmpreiteiro } from "../shared/portal-empreiteiro.js";
import { podeGerenciarFotos, podeVerFotosDaObra } from "../shared/obra-fotos.js";

/** Banco falso: cada `select…limit()` devolve a próxima resposta da fila. */
function bancoComRespostas(...respostas: unknown[][]) {
  const fila = [...respostas];
  const consulta = { from: () => consulta, where: () => consulta, limit: async () => fila.shift() ?? [] };
  vi.spyOn(db, "getDb").mockReturnValue({ select: () => consulta } as never);
}

const empreiteiro = (id = 5) =>
  appRouter.createCaller({ user: { id, role: "empreiteiro", active: true }, req: {}, res: {} } as never);

afterEach(() => vi.restoreAllMocks());

describe("portal do empreiteiro — acesso por obra", () => {
  it("libera progresso, fotos, relatórios e pagamentos só na obra vinculada a ele", async () => {
    bancoComRespostas([{ id: 5 }]);
    await expect(autorizarEmpreiteiro(5, "obraProgresso.salvar", { projectId: 10 })).resolves.toBe(true);
    bancoComRespostas([{ id: 6 }]);
    await expect(autorizarEmpreiteiro(5, "obraProgresso.relatorio", { projectId: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("acha a obra pela foto e pelo movimento", async () => {
    bancoComRespostas([{ projectId: 10 }], [{ id: 5 }]);
    await expect(autorizarEmpreiteiro(5, "obraProgresso.excluirFoto", { photoId: 3 })).resolves.toBe(true);
    bancoComRespostas([{ projectId: 10, natureza: "pagamento" }], [{ id: 5 }]);
    await expect(autorizarEmpreiteiro(5, "obraFinanceiro.excluirMovimento", { id: 8 })).resolves.toBe(true);
  });

  it("nos Custos só lança e exclui pagamentos, sem vincular o BPO da empresa", async () => {
    await expect(autorizarEmpreiteiro(5, "obraFinanceiro.adicionarMovimento", { projectId: 10, natureza: "recebimento" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(autorizarEmpreiteiro(5, "obraFinanceiro.adicionarMovimento", { projectId: 10, natureza: "pagamento", bpoLancamentoId: 2 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    bancoComRespostas([{ projectId: 10, natureza: "recebimento" }]);
    await expect(autorizarEmpreiteiro(5, "obraFinanceiro.excluirMovimento", { id: 8 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("procedimentos que não são do portal continuam fechados", async () => {
    await expect(autorizarEmpreiteiro(5, "obraFinanceiro.salvarValores", { projectId: 10 })).resolves.toBe(false);
    await expect(empreiteiro().obraFinanceiro.salvarValores({
      projectId: 10, vgv: null, financiamento: null, fgts: null, subsidio: null, custoTerreno: null, comissao: null,
      orcamentoPrevisto: null, taxaMensalPct: null, parcelas: null, empreiteiroId: null, percentualEmpreiteiro: null,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(empreiteiro().obraFinanceiro.bpoDisponiveis({ natureza: "pagamento" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(empreiteiro().construction.deleteProject({ projectId: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a API recusa a obra de outro empreiteiro antes de executar", async () => {
    bancoComRespostas([{ id: 6 }]);
    await expect(empreiteiro().obraProgresso.obter({ projectId: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("portal do empreiteiro — aba Relatórios", () => {
  it("soma o lucro dele, o VGV e o valor a receber do banco, contando as obras sem dados", () => {
    const t = totaisDoEmpreiteiro([
      { id: 1, title: "Casa A", vgvCentavos: 20000000, receberBanco: { ok: true, centavos: 15000000 }, lucroEmpreiteiro: { ok: true, centavos: 1200000 } },
      { id: 2, title: "Casa B", vgvCentavos: 18000000, receberBanco: { ok: false, motivo: "Informe: Financiamento CEF" }, lucroEmpreiteiro: { ok: true, centavos: 800000 } },
      { id: 3, title: "Casa C", vgvCentavos: null, receberBanco: { ok: true, centavos: 5000000 }, lucroEmpreiteiro: { ok: false, motivo: "Informe: VGV" } },
    ]);
    expect(t.quantidade).toBe(3);
    expect(t.lucro).toEqual({ centavos: 2000000, pendentes: 1 });
    expect(t.vgv).toEqual({ centavos: 38000000, pendentes: 1 });
    expect(t.receberBanco).toEqual({ centavos: 20000000, pendentes: 1 });
    expect(t.porObra[0]).toEqual({ id: 1, nome: "Casa A", vgv: 200000, receberBanco: 150000, lucro: 12000 });
  });

  it("sem obras, tudo zero", () => {
    expect(totaisDoEmpreiteiro([])).toMatchObject({ quantidade: 0, lucro: { centavos: 0, pendentes: 0 } });
  });
});

describe("portal do empreiteiro — fotos da obra", () => {
  it("o empreiteiro vinculado vê e gerencia; outro empreiteiro não", () => {
    const obra = { usuarioId: null, leadId: null, empreiteiroId: 5 };
    expect(podeVerFotosDaObra({ id: 5, papel: "empreiteiro" }, obra)).toBe(true);
    expect(podeGerenciarFotos({ id: 5, papel: "empreiteiro" }, obra)).toBe(true);
    expect(podeVerFotosDaObra({ id: 6, papel: "empreiteiro" }, obra)).toBe(false);
    expect(podeGerenciarFotos({ id: 6, papel: "empreiteiro" }, obra)).toBe(false);
    expect(podeGerenciarFotos({ id: 5, papel: "empreiteiro" })).toBe(false);
  });
});
