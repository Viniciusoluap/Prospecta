// Pedido de 17/10/2026: o colaborador faz tudo o que o admin faz, só nos módulos
// que o admin liberou. Mesmo conteúdo em Grupo-Santa-Fe/web/src/lib/__tests__/colaborador-modulos.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as db from "./db.js";
import { appRouter } from "./routers.js";
import { podeUsarModulo } from "./_core/rbac.js";
import { excluirDefinitivo } from "./exclusao-definitiva.js";

const caller = (role: string, permissoes: string[], active = true) =>
  appRouter.createCaller({ user: { id: 7, role, active, permissions: JSON.stringify(permissoes) }, req: {}, res: {} } as never);

const sorteio = { title: "Sorteio teste", description: "Descrição do sorteio", prizeAmount: 200000, ticketPrice: 200, targetAmount: 200000000 };

afterEach(() => vi.restoreAllMocks());

describe("colaborador — mesmos poderes do admin nos módulos liberados", () => {
  it("cria sorteio com o Ecossistema de Sorteio; sem ele, é barrado antes do banco", async () => {
    const criar = vi.spyOn(db, "createDraw").mockResolvedValue({ id: 1 } as never);
    await expect(caller("colaborador", ["sorteios"]).draws.create(sorteio)).resolves.toEqual({ id: 1 });
    criar.mockClear();
    await expect(caller("colaborador", ["crm", "obras"]).draws.create(sorteio)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(criar).not.toHaveBeenCalled();
  });

  it("selecionou tudo menos Obras: Obras some para ele no servidor", async () => {
    const todos = ["crm", "agenda", "corretores", "regularizacao", "comissoes", "projetos", "mapa", "avaliacoes",
      "imoveis", "incorporacao", "whatsapp", "bpo", "financiamentos", "juridico", "sorteios"];
    const listar = vi.spyOn(db, "getAllProjects").mockResolvedValue([] as never);
    await expect(caller("colaborador", todos).construction.allProjects()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(listar).not.toHaveBeenCalled();
  });

  it("regra comum: admin sempre; colaborador inativo, corretor, cliente e empreiteiro nunca", () => {
    expect(podeUsarModulo({ role: "admin", permissions: "[]" }, "obras")).toBe(true);
    expect(podeUsarModulo({ role: "colaborador", permissions: '["obras"]' }, "obras")).toBe(true);
    expect(podeUsarModulo({ role: "colaborador", permissions: '["obras"]', active: false }, "obras")).toBe(false);
    expect(podeUsarModulo({ role: "colaborador", permissions: "[]" }, [])).toBe(true);
    for (const role of ["corretor", "cliente", "empreiteiro"])
      expect(podeUsarModulo({ role, permissions: '["obras"]' }, "obras")).toBe(false);
  });

  it("revisão do Codex (PR #130): serviço do CRM que mexe em outro módulo exige esse módulo", async () => {
    const banco = vi.spyOn(db, "getDb");
    const soCrm = caller("colaborador", ["crm"]);
    await expect(soCrm.leadServices.create({ leadId: 3, serviceType: "obra_cliente" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(soCrm.leadServices.linkProcess({ id: 1, operationalModule: "financiamentos", operationalRecordId: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(banco).not.toHaveBeenCalled();
  });

  it("revisão do Codex (PR #130): a fila de um módulo exige o próprio módulo", async () => {
    const banco = vi.spyOn(db, "getDb");
    const soAgenda = caller("colaborador", ["agenda"]);
    await expect(soAgenda.leadServices.listForModule({ module: "financiamentos" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(soAgenda.leadServices.materializePending({ module: "regularizacoes" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(banco).not.toHaveBeenCalled();
  });

  it("exclusão definitiva confere o módulo do registro, mesmo vinda de outro módulo", async () => {
    const banco = vi.spyOn(db, "getDb");
    await expect(excluirDefinitivo("obra", 10, { role: "colaborador", active: true, permissions: '["crm"]' }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(banco).not.toHaveBeenCalled();
  });

  it("cadastro de lead com serviço e operações em lote também exigem os módulos de destino", async () => {
    const banco = vi.spyOn(db, "getDb");
    const criar = vi.spyOn(db, "createLead");
    const soCrm = caller("colaborador", ["crm"]);
    await expect(soCrm.leads.create({ name: "Cliente", phone: "99999999", services: ["obra_cliente"] } as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(soCrm.leadServices.backfillFromTrello()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(soCrm.leadServices.reconcile({ dryRun: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(criar).not.toHaveBeenCalled();
    expect(banco).not.toHaveBeenCalled();
  });

  it("revisão do Codex (#131): importação em lote exige também Agenda, Jurídico e BPO", async () => {
    const banco = vi.spyOn(db, "getDb");
    const semJuridico = caller("colaborador", ["crm", "obras", "projetos", "regularizacao", "financiamentos", "avaliacoes", "comissoes", "agenda", "bpo", "incorporacao"]);
    await expect(semJuridico.leadServices.backfillFromTrello()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(banco).not.toHaveBeenCalled();
  });
});
