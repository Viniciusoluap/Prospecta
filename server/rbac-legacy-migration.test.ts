import { describe, expect, it } from "vitest";
import { canAccessAdminProcedure } from "./_core/trpc";

/**
 * EPIC-012 S-08 (Etapa 6) - migracao dos endpoints legados de STAFF_ROLES para
 * permissao granular (bpo, bancario, avaliacoes, agregador, whatsapp).
 *
 * Antes desta migracao, `requireRole(ctx, STAFF_ROLES)` permitia acesso a
 * qualquer colaborador/corretor independente da permissao de modulo
 * concedida, ignorando o catalogo RBAC granular introduzido na Etapa 3.
 */
describe("EPIC-012 S-08 (Etapa 6) - RBAC granular em routers legados", () => {
  it("colaborador sem permissao 'bpo' nao acessa bpo.*", () => {
    const colaborador = { role: "colaborador", permissions: JSON.stringify(["crm"]) };
    expect(canAccessAdminProcedure(colaborador, "bpo.clientes.list")).toBe(false);
    expect(canAccessAdminProcedure(colaborador, "bpo.dre")).toBe(false);
  });

  it("colaborador com permissao 'bpo' acessa bpo.*", () => {
    const colaborador = { role: "colaborador", permissions: JSON.stringify(["bpo"]) };
    expect(canAccessAdminProcedure(colaborador, "bpo.clientes.list")).toBe(true);
    expect(canAccessAdminProcedure(colaborador, "bpo.lancamentos.create")).toBe(true);
    expect(canAccessAdminProcedure(colaborador, "bpo.dre")).toBe(true);
  });

  it("corretor sem permissao 'banco' nao acessa bancario.*", () => {
    const corretor = { role: "corretor", permissions: JSON.stringify(["imoveis"]) };
    expect(canAccessAdminProcedure(corretor, "bancario.contas.list")).toBe(false);
    expect(canAccessAdminProcedure(corretor, "bancario.sincronizar")).toBe(false);
  });

  it("colaborador com permissao 'banco' acessa bancario.*", () => {
    const colaborador = { role: "colaborador", permissions: JSON.stringify(["banco"]) };
    expect(canAccessAdminProcedure(colaborador, "bancario.contas.list")).toBe(true);
    expect(canAccessAdminProcedure(colaborador, "bancario.transacoes.listByConta")).toBe(true);
  });

  it("colaborador sem permissao 'avaliacoes' nao acessa avaliacoes.*", () => {
    const colaborador = { role: "colaborador", permissions: JSON.stringify(["crm"]) };
    expect(canAccessAdminProcedure(colaborador, "avaliacoes.list")).toBe(false);
    expect(canAccessAdminProcedure(colaborador, "avaliacoes.create")).toBe(false);
  });

  it("colaborador com permissao 'avaliacoes' acessa avaliacoes.*", () => {
    const colaborador = { role: "colaborador", permissions: JSON.stringify(["avaliacoes"]) };
    expect(canAccessAdminProcedure(colaborador, "avaliacoes.list")).toBe(true);
    expect(canAccessAdminProcedure(colaborador, "avaliacoes.update")).toBe(true);
    expect(canAccessAdminProcedure(colaborador, "avaliacoes.sugerirValor")).toBe(true);
  });

  it("corretor sem permissao 'agregador' nao acessa agregador.scrape/list", () => {
    const corretor = { role: "corretor", permissions: JSON.stringify(["crm"]) };
    expect(canAccessAdminProcedure(corretor, "agregador.scrape")).toBe(false);
    expect(canAccessAdminProcedure(corretor, "agregador.list")).toBe(false);
  });

  it("colaborador sem permissao 'whatsapp' nao acessa whatsapp.*", () => {
    const colaborador = { role: "colaborador", permissions: JSON.stringify(["crm"]) };
    expect(canAccessAdminProcedure(colaborador, "whatsapp.minhaConexao")).toBe(false);
    expect(canAccessAdminProcedure(colaborador, "whatsapp.historico")).toBe(false);
    expect(canAccessAdminProcedure(colaborador, "whatsapp.enviar")).toBe(false);
  });

  it("colaborador com permissao 'whatsapp' acessa whatsapp.minhaConexao/historico/enviar", () => {
    const colaborador = { role: "colaborador", permissions: JSON.stringify(["whatsapp"]) };
    expect(canAccessAdminProcedure(colaborador, "whatsapp.minhaConexao")).toBe(true);
    expect(canAccessAdminProcedure(colaborador, "whatsapp.leadsParaEnvio")).toBe(true);
    expect(canAccessAdminProcedure(colaborador, "whatsapp.historico")).toBe(true);
    expect(canAccessAdminProcedure(colaborador, "whatsapp.enviar")).toBe(true);
  });

  it("colaborador com permissao 'crm' acessa portal.admin.* (ja migrado na Etapa 3/4)", () => {
    const colaborador = { role: "colaborador", permissions: JSON.stringify(["crm"]) };
    expect(canAccessAdminProcedure(colaborador, "portal.admin.overview")).toBe(true);
  });

  it("admin sempre acessa todos os modulos legados migrados", () => {
    const admin = { role: "admin" };
    expect(canAccessAdminProcedure(admin, "bpo.dre")).toBe(true);
    expect(canAccessAdminProcedure(admin, "bancario.sincronizar")).toBe(true);
    expect(canAccessAdminProcedure(admin, "avaliacoes.delete")).toBe(true);
    expect(canAccessAdminProcedure(admin, "agregador.importarParaCatalogo")).toBe(true);
    expect(canAccessAdminProcedure(admin, "whatsapp.enviar")).toBe(true);
  });

  it("cliente nunca acessa modulos administrativos legados", () => {
    const cliente = { role: "cliente", permissions: null };
    expect(canAccessAdminProcedure(cliente, "bpo.dre")).toBe(false);
    expect(canAccessAdminProcedure(cliente, "whatsapp.historico")).toBe(false);
  });
});
