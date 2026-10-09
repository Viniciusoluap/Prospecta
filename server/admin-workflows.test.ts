import { afterEach, describe, expect, it, vi } from "vitest";
import * as db from "./db.js";
import { appRouter } from "./routers.js";

const admin = () => appRouter.createCaller({ user: { id: 99, role: "admin", active: true }, req: {}, res: {} } as never);
const client = () => appRouter.createCaller({ user: { id: 2, role: "cliente", active: true }, req: {}, res: {} } as never);

afterEach(() => vi.restoreAllMocks());

describe("cadastro administrativo de obras", () => {
  it("usa lead existente e não atribui a obra à conta administrativa", async () => {
    vi.spyOn(db, "getLeadById").mockResolvedValue({ id: 3 } as never);
    const create = vi.spyOn(db, "createProject").mockResolvedValue({ id: 17 } as never);
    await expect(admin().construction.createAdminProject({ title: "Casa", leadId: 3 })).resolves.toMatchObject({ id: 17 });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: "Casa", leadId: 3, userId: null, status: "planning" }));
  });

  it("recusa lead inexistente sem criar obra", async () => {
    vi.spyOn(db, "getLeadById").mockResolvedValue(undefined);
    const create = vi.spyOn(db, "createProject");
    await expect(admin().construction.createAdminProject({ title: "Casa", leadId: 3 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(create).not.toHaveBeenCalled();
  });

  it("não permite cadastro por cliente", async () => {
    await expect(client().construction.createAdminProject({ title: "Casa" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("tarefas", () => {
  it("cria tarefa independente sem referência a lead", async () => {
    const create = vi.spyOn(db, "createTask").mockResolvedValue({ id: 4 } as never);
    await expect(admin().tasks.create({ title: "Conferir contrato", assignedTo: "sarah" })).resolves.toMatchObject({ id: 4 });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ status: "pending", priority: "medium" }));
    expect(create.mock.calls[0][0].relatedId).toBeUndefined();
  });

  it("impede vínculo inválido e operações de cliente", async () => {
    vi.spyOn(db, "getLeadById").mockResolvedValue(undefined);
    const create = vi.spyOn(db, "createTask");
    await expect(admin().tasks.create({ title: "Conferir contrato", assignedTo: "sarah", relatedType: "lead", relatedId: 5 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(client().tasks.create({ title: "Conferir contrato", assignedTo: "sarah" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(create).not.toHaveBeenCalled();
  });

  it("edita e exclui tarefa apenas após verificar a existência", async () => {
    vi.spyOn(db, "getTaskById").mockResolvedValue({ id: 7 } as never);
    const update = vi.spyOn(db, "updateTask").mockResolvedValue(undefined);
    const remove = vi.spyOn(db, "deleteTask").mockResolvedValue(undefined);
    await admin().tasks.update({ id: 7, assignedTo: "bianca", status: "done" });
    expect(update).toHaveBeenCalledWith(7, expect.objectContaining({ assignedTo: "bianca", status: "done", completedAt: expect.any(Date) }));
    await admin().tasks.delete({ id: 7 });
    expect(remove).toHaveBeenCalledWith(7);
    await expect(client().tasks.delete({ id: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
