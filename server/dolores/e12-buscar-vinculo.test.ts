// E12 (EPIC-025) — escolher o cliente do CRM / a obra PELO NOME ao classificar um grupo (pedido do dono de 26/11/2026).
// Rota `dolores.grupos.buscarVinculo`: só admin; só id + nome; sem leads excluídos; sem diferenciar acento/maiúscula; até 20. PGlite.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));

import { ADMIN_MODULES } from "../../shared/admin-permissions.js";
import { getDb } from "../db.js";
import { appRouter } from "../routers.js";
import { CENARIO, criarBanco } from "./testes-banco.js";

let banco: Awaited<ReturnType<typeof criarBanco>>;
const caller = (role: string, permissoes: string[] = [], id = 1) =>
  appRouter.createCaller({ user: { id, role, active: true, permissions: JSON.stringify(permissoes) }, req: {}, res: {} } as never);

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
});
afterEach(() => { vi.clearAllMocks(); });

describe("E12 — buscar cliente/obra pelo nome", () => {
  it("acha cliente por parte do nome, sem acento nem maiúscula, e devolve só id + nome", async () => {
    const r = await caller("admin").dolores.grupos.buscarVinculo({ tipo: "cliente", termo: "joao atra" });
    expect(r).toEqual([{ id: 2, nome: "João Atrasado" }]);
    const r2 = await caller("admin").dolores.grupos.buscarVinculo({ tipo: "cliente", termo: "ANA" });
    expect(r2.map(x => x.nome)).toContain("Ana Em Dia");
    for (const linha of r2) expect(Object.keys(linha).sort()).toEqual(["id", "nome"]);
  });

  it("não devolve cliente excluído", async () => {
    await banco.pg.exec(`UPDATE leads SET deleted_at = now() WHERE id = 2`);
    expect(await caller("admin").dolores.grupos.buscarVinculo({ tipo: "cliente", termo: "joão" })).toEqual([]);
  });

  it("acha obra pelo título", async () => {
    expect(await caller("admin").dolores.grupos.buscarVinculo({ tipo: "obra", termo: "casa" })).toEqual([{ id: 1, nome: "Casa Ana" }]);
  });

  it("% e _ do termo valem como letra, não como curinga", async () => {
    expect(await caller("admin").dolores.grupos.buscarVinculo({ tipo: "cliente", termo: "%%" })).toEqual([]);
  });

  it("limita a 20 resultados", async () => {
    const valores = Array.from({ length: 25 }, (_, i) => `('Cliente Repetido ${i}', '9999000${String(i).padStart(4, "0")}', 'new')`).join(", ");
    await banco.pg.exec(`INSERT INTO leads (name, phone, stage) VALUES ${valores}`);
    expect(await caller("admin").dolores.grupos.buscarVinculo({ tipo: "cliente", termo: "repetido" })).toHaveLength(20);
  });

  it("exige o administrador (colaborador com WhatsApp, corretor e cliente não buscam)", async () => {
    await expect(caller("colaborador", ["whatsapp"], 2).dolores.grupos.buscarVinculo({ tipo: "cliente", termo: "maria" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("colaborador", [...ADMIN_MODULES], 2).dolores.grupos.buscarVinculo({ tipo: "cliente", termo: "maria" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("corretor", [...ADMIN_MODULES]).dolores.grupos.buscarVinculo({ tipo: "obra", termo: "casa" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("cliente", [...ADMIN_MODULES]).dolores.grupos.buscarVinculo({ tipo: "obra", termo: "casa" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("termo de 1 letra é recusado", async () => {
    await expect(caller("admin").dolores.grupos.buscarVinculo({ tipo: "cliente", termo: "m" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
