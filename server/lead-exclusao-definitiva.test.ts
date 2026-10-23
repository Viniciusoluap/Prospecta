// Pedido de 23/10 (H3): exclusão definitiva de lead arquivado. Mesma regra em
// Grupo-Santa-Fe/web/src/lib/__tests__/lead-exclusao-definitiva.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as db from "./db.js";
import { appRouter } from "./routers.js";
import { mensagemBloqueioExclusao, resumoVinculosLead, type VinculosLead } from "../shared/lead-exclusao-definitiva";

const caller = (role: string, permissoes: string[] = []) =>
  appRouter.createCaller({ user: { id: 7, role, active: true, permissions: JSON.stringify(permissoes) }, req: {}, res: {} } as never);
const SEM: VinculosLead = { obras: 0, financiamentos: 0, regularizacoes: 0, projetos: 0, avaliacoes: 0, contratos: 0, documentos: 0, contas: 0 };
const arquivado = { id: 5, name: "LEAD", deletedAt: new Date("2026-10-20") };

afterEach(() => vi.restoreAllMocks());

describe("resumo dos vínculos", () => {
  it("sem vínculos → null; com vínculos → frase legível no singular/plural", () => {
    expect(resumoVinculosLead(SEM)).toBeNull();
    expect(mensagemBloqueioExclusao(SEM)).toBeNull();
    expect(resumoVinculosLead({ ...SEM, obras: 1 })).toBe("1 obra");
    expect(resumoVinculosLead({ ...SEM, obras: 1, documentos: 2, financiamentos: 1 })).toBe("1 obra, 1 financiamento e 2 documentos");
    expect(mensagemBloqueioExclusao({ ...SEM, contas: 1 })).toContain("1 conta de acesso");
  });
});

describe("leads.permanentDelete", () => {
  it("só o administrador: colaborador com CRM é barrado antes do banco", async () => {
    const apagar = vi.spyOn(db, "excluirLeadArquivadoDefinitivamente").mockResolvedValue(true);
    await expect(caller("colaborador", ["crm"]).leads.permanentDelete({ id: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("colaborador", ["crm"]).leads.permanentDeletionContext({ id: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(apagar).not.toHaveBeenCalled();
  });

  it("lead ativo (não arquivado) é recusado", async () => {
    vi.spyOn(db, "getLeadById").mockResolvedValue({ ...arquivado, deletedAt: null } as never);
    const apagar = vi.spyOn(db, "excluirLeadArquivadoDefinitivamente").mockResolvedValue(true);
    await expect(caller("admin").leads.permanentDelete({ id: 5 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(apagar).not.toHaveBeenCalled();
  });

  it("com vínculos avisa o que está vinculado e não apaga", async () => {
    vi.spyOn(db, "getLeadById").mockResolvedValue(arquivado as never);
    vi.spyOn(db, "getLeadVinculosExclusao").mockResolvedValue({ ...SEM, obras: 1, documentos: 3 });
    const apagar = vi.spyOn(db, "excluirLeadArquivadoDefinitivamente").mockResolvedValue(true);
    await expect(caller("admin").leads.permanentDelete({ id: 5 })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("1 obra e 3 documentos") });
    expect(apagar).not.toHaveBeenCalled();
    await expect(caller("admin").leads.permanentDeletionContext({ id: 5 })).resolves.toMatchObject({ arquivado: true, bloqueio: expect.stringContaining("1 obra") });
  });

  it("arquivado e sem vínculos: apaga; se mudou no meio (recuperado), avisa", async () => {
    vi.spyOn(db, "getLeadById").mockResolvedValue(arquivado as never);
    vi.spyOn(db, "getLeadVinculosExclusao").mockResolvedValue(SEM);
    const apagar = vi.spyOn(db, "excluirLeadArquivadoDefinitivamente").mockResolvedValue(true);
    await expect(caller("admin").leads.permanentDelete({ id: 5 })).resolves.toEqual({ success: true });
    expect(apagar).toHaveBeenCalledWith(5);
    apagar.mockResolvedValue(false);
    await expect(caller("admin").leads.permanentDelete({ id: 5 })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
