// Lote 02, correção 02 — galeria por medição em Detalhes da Obra: liberada só a
// quem já abre Detalhes (proprietário, admin/colaborador com Obras, empreiteiro
// vinculado). Gêmeo em Grupo-Santa-Fe/web/src/lib/__tests__/galeria-detalhes.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as db from "./db.js";
import { appRouter } from "./routers.js";
import { podeVerDetalhesObra } from "./obra-acesso.js";

afterEach(() => vi.restoreAllMocks());

const obra = { userId: 1, contractorUserId: 5 };

describe("podeVerDetalhesObra", () => {
  it("libera proprietário, admin, colaborador com Obras e o empreiteiro vinculado", () => {
    expect(podeVerDetalhesObra({ id: 1, role: "user" }, obra)).toBe(true);
    expect(podeVerDetalhesObra({ id: 9, role: "admin" }, obra)).toBe(true);
    expect(podeVerDetalhesObra({ id: 9, role: "colaborador", permissions: JSON.stringify(["obras"]) }, obra)).toBe(true);
    expect(podeVerDetalhesObra({ id: 5, role: "empreiteiro" }, obra)).toBe(true);
  });
  it("nega outro cliente, colaborador sem Obras, outro empreiteiro e admin inativo", () => {
    expect(podeVerDetalhesObra({ id: 2, role: "user" }, obra)).toBe(false);
    expect(podeVerDetalhesObra({ id: 9, role: "colaborador", permissions: JSON.stringify(["crm"]) }, obra)).toBe(false);
    expect(podeVerDetalhesObra({ id: 6, role: "empreiteiro" }, obra)).toBe(false);
    expect(podeVerDetalhesObra({ id: 9, role: "admin", active: false }, obra)).toBe(false);
  });
});

describe("obraProgresso.galeriaDetalhes", () => {
  function banco(obraEncontrada: unknown[], fotos: unknown[] = [], medicoes: unknown[] = []) {
    const fila = [obraEncontrada];
    const consulta: Record<string, unknown> = {};
    let chamadas = 0;
    Object.assign(consulta, {
      from: () => consulta,
      where: () => { chamadas++; return chamadas === 3 ? Promise.resolve(medicoes) : consulta; },
      limit: async () => fila.shift() ?? [],
      orderBy: async () => fotos,
    });
    vi.spyOn(db, "getDb").mockReturnValue({ select: () => consulta } as never);
  }
  const chamador = (user: Record<string, unknown>) => appRouter.createCaller({ user: { active: true, ...user }, req: {}, res: {} } as never);

  it("nega quem não abre Detalhes da obra", async () => {
    banco([obra]);
    await expect(chamador({ id: 2, role: "user" }).obraProgresso.galeriaDetalhes({ projectId: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("obra inexistente responde NOT_FOUND", async () => {
    banco([]);
    await expect(chamador({ id: 1, role: "user" }).obraProgresso.galeriaDetalhes({ projectId: 10 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("proprietário recebe as mesmas fotos e medições da galeria do Editar Obra", async () => {
    const fotos = [{ id: 3, medicaoId: 7, url: "/api/obras/fotos/3", legenda: "Laje" }];
    banco([obra], fotos, [{ id: 7, progresso: "12.5", criadoEm: new Date("2026-10-01T12:00:00Z") }]);
    const r = await chamador({ id: 1, role: "user" }).obraProgresso.galeriaDetalhes({ projectId: 10 });
    expect(r).toEqual({ fotos, medicoes: [{ id: 7, progresso: 12.5, criadoEm: new Date("2026-10-01T12:00:00Z") }] });
  });
});
