import { afterEach, describe, expect, it, vi } from "vitest";
import * as db from "./db.js";
import { appRouter } from "./routers.js";
import { linkRecordToLead } from "./lead-services-router.js";

vi.mock("./lead-services-router.js", async importOriginal => ({
  ...(await importOriginal<typeof import("./lead-services-router.js")>()),
  linkRecordToLead: vi.fn().mockResolvedValue("linked"),
}));

const admin = () => appRouter.createCaller({ user: { id: 99, role: "admin", active: true }, req: {}, res: {} } as never);
const client = () => appRouter.createCaller({ user: { id: 2, role: "cliente", active: true }, req: {}, res: {} } as never);

afterEach(() => vi.restoreAllMocks());

describe("cadastro administrativo de obras", () => {
  it("usa lead existente e não atribui a obra à conta administrativa", async () => {
    vi.spyOn(db, "getLeadById").mockResolvedValue({ id: 3 } as never);
    const create = vi.spyOn(db, "createProject").mockResolvedValue({ id: 17 } as never);
    await expect(admin().construction.createAdminProject({ title: "Casa", leadId: 3 })).resolves.toMatchObject({ id: 17 });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: "Casa", leadId: 3, userId: null, status: "planning" }));
    // EPIC-017: a obra entra nos "Serviços do cliente" do lead.
    expect(linkRecordToLead).toHaveBeenCalledWith("obras", 3, 17);
  });

  it("EPIC-017: migra endereço, cidade e UF do lead quando a obra não informa", async () => {
    vi.spyOn(db, "getLeadById").mockResolvedValue({
      id: 3, name: "Ana", phone: "99", email: null, address: "Rua A, 10", neighborhood: "Centro", city: "Imperatriz", state: "MA",
    } as never);
    const create = vi.spyOn(db, "createProject").mockResolvedValue({ id: 18 } as never);
    await admin().construction.createAdminProject({ title: "Casa", leadId: 3 });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      address: "Rua A, 10, Centro, Imperatriz/MA", city: "Imperatriz", state: "MA",
    }));
    await admin().construction.createAdminProject({ title: "Casa 2", leadId: 3, address: "Lote 5, Qd 2" });
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ address: "Lote 5, Qd 2" }));
  });

  it("EPIC-017: recusa obra avulsa, sem lead do CRM", async () => {
    const create = vi.spyOn(db, "createProject");
    await expect(admin().construction.createAdminProject({ title: "Casa" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(create).not.toHaveBeenCalled();
  });

  it("recusa lead inexistente sem criar obra", async () => {
    vi.spyOn(db, "getLeadById").mockResolvedValue(undefined);
    const create = vi.spyOn(db, "createProject");
    await expect(admin().construction.createAdminProject({ title: "Casa", leadId: 3 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(create).not.toHaveBeenCalled();
  });

  it("não permite cadastro por cliente", async () => {
    await expect(client().construction.createAdminProject({ title: "Casa", leadId: 3 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("tarefas", () => {
  it("cria tarefa independente sem referência a lead, resolvendo o responsável selecionado", async () => {
    vi.spyOn(db, "getAssignableUserById").mockResolvedValue({ id: 12, name: "Sarah" } as never);
    const create = vi.spyOn(db, "createTask").mockResolvedValue({ id: 4 } as never);
    await expect(admin().tasks.create({ title: "Conferir contrato", assignedTo: 12 })).resolves.toMatchObject({ id: 4 });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ assignedTo: "Sarah", status: "pending", priority: "medium" }));
    expect(create.mock.calls[0][0].relatedId).toBeUndefined();
  });

  it("recusa responsável que não é administrador ou colaborador ativo", async () => {
    vi.spyOn(db, "getAssignableUserById").mockResolvedValue(undefined);
    const create = vi.spyOn(db, "createTask");
    await expect(admin().tasks.create({ title: "Conferir contrato", assignedTo: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(create).not.toHaveBeenCalled();
  });

  it("impede vínculo com lead excluído/rejeitado/inexistente e operações de cliente", async () => {
    vi.spyOn(db, "getAssignableUserById").mockResolvedValue({ id: 12, name: "Sarah" } as never);
    vi.spyOn(db, "getAssignableLeadById").mockResolvedValue(undefined);
    const create = vi.spyOn(db, "createTask");
    await expect(admin().tasks.create({ title: "Conferir contrato", assignedTo: 12, relatedType: "lead", relatedId: 5 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(client().tasks.create({ title: "Conferir contrato", assignedTo: 12 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(create).not.toHaveBeenCalled();
  });

  it("edita tarefa resolvendo o novo responsável e exclui apenas após verificar a existência", async () => {
    vi.spyOn(db, "getTaskById").mockResolvedValue({ id: 7 } as never);
    vi.spyOn(db, "getAssignableUserById").mockResolvedValue({ id: 20, name: "Bianca" } as never);
    const update = vi.spyOn(db, "updateTask").mockResolvedValue(undefined);
    const remove = vi.spyOn(db, "deleteTask").mockResolvedValue(undefined);
    await admin().tasks.update({ id: 7, assignedTo: 20, status: "done" });
    expect(update).toHaveBeenCalledWith(7, expect.objectContaining({ assignedTo: "Bianca", status: "done", completedAt: expect.any(Date) }));
    await admin().tasks.delete({ id: 7 });
    expect(remove).toHaveBeenCalledWith(7);
    await expect(client().tasks.delete({ id: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("recusa editar tarefa para um responsável inválido sem persistir a mudança", async () => {
    vi.spyOn(db, "getTaskById").mockResolvedValue({ id: 7 } as never);
    vi.spyOn(db, "getAssignableUserById").mockResolvedValue(undefined);
    const update = vi.spyOn(db, "updateTask");
    await expect(admin().tasks.update({ id: 7, assignedTo: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(update).not.toHaveBeenCalled();
  });

  it("carrega responsáveis e leads elegíveis do banco (sem nomes fixos)", async () => {
    vi.spyOn(db, "getAssignableUsers").mockResolvedValue([
      { id: 1, name: "Admin Ativo" },
    ] as never);
    vi.spyOn(db, "getAssignableLeadOptions").mockResolvedValue([
      { id: 2, name: "Lead Ativo" },
    ] as never);
    await expect(admin().tasks.assignableUsers()).resolves.toEqual([{ id: 1, name: "Admin Ativo" }]);
    await expect(admin().tasks.leadOptions()).resolves.toEqual([{ id: 2, name: "Lead Ativo" }]);
    await expect(client().tasks.assignableUsers()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
