import { describe, expect, it } from "vitest";
import { ADMIN_MODULE_LABELS, ADMIN_MODULES, normalizePermissions, parsePermissions } from "../shared/admin-permissions";
import { canAccessAdminProcedure } from "./_core/trpc";

describe("Permissões administrativas", () => {
  it("normaliza, remove duplicadas e ignora módulos desconhecidos", () => {
    expect(normalizePermissions(["crm", "crm", "juridico", "invalido"])).toEqual(["crm", "juridico"]);
  });

  it("não quebra com JSON inválido", () => {
    expect(parsePermissions("não-json")).toEqual([]);
  });

  it("são exatamente os 16 módulos do pedido de 17/10/2026, na ordem do painel", () => {
    expect([...ADMIN_MODULES]).toEqual([
      "crm", "obras", "agenda", "corretores", "regularizacao", "comissoes", "projetos", "mapa",
      "avaliacoes", "imoveis", "incorporacao", "whatsapp", "bpo", "financiamentos", "juridico", "sorteios",
    ]);
    expect(ADMIN_MODULE_LABELS.sorteios).toBe("Ecossistema de Sorteio");
  });

  it("converte as chaves antigas sem perder acesso e descarta as que viraram só do admin", () => {
    expect(parsePermissions(JSON.stringify(["contabilidade", "relatorios", "agregador", "dashboard", "banco", "configuracoes", "juridico"])))
      .toEqual(["imoveis", "bpo", "juridico"]);
  });

  it("colaborador: home e telas comuns abertas; API Contas, usuários e Drive só do admin", () => {
    const tudo = { role: "colaborador", permissions: JSON.stringify(ADMIN_MODULES) };
    expect(canAccessAdminProcedure({ role: "colaborador", permissions: "[]" }, "analytics.getStats")).toBe(true);
    for (const p of ["paymentSettings.get", "configuracoes.listUsers", "pluggySettings.status", "bancario.sincronizar", "googleDrive.status"])
      expect(canAccessAdminProcedure(tudo, p), p).toBe(false);
    for (const p of ["draws.create", "products.create", "obraFinanceiro.resumo", "incorporacao.list", "leadDocuments.request"])
      expect(canAccessAdminProcedure(tudo, p), p).toBe(true);
    const semObras = { role: "colaborador", permissions: JSON.stringify(ADMIN_MODULES.filter(m => m !== "obras")) };
    expect(canAccessAdminProcedure(semObras, "construction.allProjects")).toBe(false);
    expect(canAccessAdminProcedure(semObras, "obraProgresso.obter")).toBe(false);
    expect(canAccessAdminProcedure({ ...tudo, active: false }, "leads.list")).toBe(false);
  });

  it("fila de serviços do CRM abre no módulo operacional", () => {
    const reg = { role: "colaborador", permissions: '["regularizacao"]' };
    expect(canAccessAdminProcedure(reg, "leadServices.listForModule")).toBe(true);
    expect(canAccessAdminProcedure(reg, "leadServices.remove")).toBe(false);
  });

  it("aplica a permissão no procedimento tRPC sem limitar o administrador", () => {
    expect(canAccessAdminProcedure({ role: "admin", permissions: "[]" }, "juridico.list")).toBe(true);
    expect(canAccessAdminProcedure({ role: "colaborador", permissions: '["juridico"]' }, "juridico.list")).toBe(true);
    expect(canAccessAdminProcedure({ role: "colaborador", permissions: '["crm"]' }, "juridico.list")).toBe(false);
    expect(canAccessAdminProcedure({ role: "cliente", permissions: '["juridico"]' }, "juridico.list")).toBe(false);
  });
});
