import { afterEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import * as db from "./db.js";
import { appRouter } from "./routers.js";

const admin = () => appRouter.createCaller({ user: { id: 99, role: "admin", active: true }, req: {}, res: {} } as never);

afterEach(() => vi.restoreAllMocks());

/**
 * Achado do Codex no PR #88 (server/lead-services-router.ts:81): unlinkProcess
 * só limpava lead_service_id do lado operacional para "obras", deixando
 * projetos/regularizacoes presos no índice único adicionado neste mesmo PR —
 * impedindo vincular um registro substituto depois de desvincular.
 */
describe("EPIC-017 (round 2) — unlinkProcess limpa o vínculo dos dois lados", () => {
  it("limpa lead_service_id de um projeto ao desvincular, não só de obras", async () => {
    const service = {
      id: 40, operationalModule: "projetos", operationalRecordId: 17,
    };
    const executed: unknown[] = [];
    const updated: Record<string, unknown>[] = [];
    vi.spyOn(db, "getDb").mockReturnValue({
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [service] }) }) }),
      execute: async (query: unknown) => { executed.push(query); return { rows: [] }; },
      update: () => ({ set: (v: Record<string, unknown>) => { updated.push(v); return { where: () => ({ returning: async () => [{ ...service, ...v }] }) }; } }),
    } as unknown as ReturnType<typeof db.getDb>);

    await admin().leadServices.unlinkProcess({ id: 40 });

    const sqlTexts = executed.map(q => JSON.stringify(q));
    expect(sqlTexts.some(text => text.includes("operational_projects"))).toBe(true);
    expect(updated[0]).toMatchObject({ operationalRecordId: null, status: "active" });
  });
});

/**
 * Achado do Codex no PR #88 (server/routers.ts:2550): ao dar um lead a uma
 * avaliação antiga, se o lead já tiver mais de uma demanda de avaliação
 * pendente, linkRecordToLead retorna "ambiguous" — mas o update já tinha
 * persistido os dados do cliente e a mutation reportava sucesso total mesmo
 * assim, sem a avaliação aparecer em nenhum "Serviços do cliente".
 */
describe("EPIC-017 (round 2) — avaliacoes.update avisa quando o vínculo fica ambíguo", () => {
  it("lança CONFLICT quando linkRecordToLead retorna ambiguous, mas já salvou os dados do cliente", async () => {
    vi.spyOn(db, "getAvaliacaoById").mockResolvedValue({ id: 5, leadId: null, leadServiceId: null } as never);
    vi.spyOn(db, "getLeadById").mockResolvedValue({
      id: 9, name: "João", phone: "99", email: null, cpf: null, address: null, neighborhood: null, city: null, state: null, deletedAt: null,
    } as never);
    const updateAvaliacao = vi.spyOn(db, "updateAvaliacao").mockResolvedValue(undefined as never);
    const linkModule = await import("./lead-services-router.js");
    vi.spyOn(linkModule, "linkRecordToLead").mockResolvedValue("ambiguous");

    await expect(
      admin().avaliacoes.update({ id: 5, leadId: 9 })
    ).rejects.toMatchObject({ code: "CONFLICT" } satisfies Partial<TRPCError>);

    // Os dados do cliente já foram salvos antes do aviso — não é descartado.
    expect(updateAvaliacao).toHaveBeenCalled();
  });
});
