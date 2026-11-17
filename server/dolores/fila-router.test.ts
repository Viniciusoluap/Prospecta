// EPIC-025 (Dolores, etapa 3) — rotas `dolores.fila.*`: só o administrador (PAPEL), testado pelo appRouter com o caminho
// completo (createCaller do sub-router daria falso positivo, porque o adminProcedure só confere o módulo).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));

import { ADMIN_MODULES } from "../../shared/admin-permissions.js";
import { getDb } from "../db.js";
import { appRouter } from "../routers.js";
import { definirDependenciasPonte, executarFuncao } from "./ponte.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";

let banco: Awaited<ReturnType<typeof criarBanco>>;
const caller = (role: string, permissoes: string[] = []) =>
  appRouter.createCaller({ user: { id: 1, role, active: true, permissions: JSON.stringify(permissoes) }, req: {}, res: {} } as never);
const fila = async () => (await banco.pg.query<any>("SELECT * FROM dolores_aprovacoes ORDER BY id")).rows;

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  esquecerUsuarioDolores();
  // relógio real: a tela decide com new Date(); o item vence 48 h depois do relógio dos testes da ponte
  definirDependenciasPonte({ agora: () => new Date() });
  await executarFuncao({ funcao: "preparar_cobranca", argumentos: { leadIds: [1, 2] }, pedidoId: "wa:5:1:0" }, { canal: "whatsapp", mensagemId: 5 });
});
afterEach(() => { definirDependenciasPonte(); vi.clearAllMocks(); });

describe("permissões (caminho completo pelo appRouter)", () => {
  it("colaborador com todos os módulos, corretor, cliente, empreiteiro, user (a própria Dolores) e admin inativo são recusados em todas as rotas da fila", async () => {
    const [item] = await fila();
    const rotas = [
      (c: ReturnType<typeof caller>) => c.dolores.fila.listar(),
      (c: ReturnType<typeof caller>) => c.dolores.fila.aprovar({ codigo: item.codigo }),
      (c: ReturnType<typeof caller>) => c.dolores.fila.recusar({ codigo: item.codigo }),
      (c: ReturnType<typeof caller>) => c.dolores.fila.salvarValidade({ horas: 24 }),
    ];
    const inativo = appRouter.createCaller({ user: { id: 1, role: "admin", active: false }, req: {}, res: {} } as never);
    for (const rota of rotas) {
      for (const c of [caller("colaborador", [...ADMIN_MODULES]), caller("corretor"), caller("cliente"), caller("empreiteiro"), caller("user"), inativo]) {
        await expect(rota(c)).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    }
    expect((await fila()).map(i => i.situacao)).toEqual(["aguardando", "aguardando"]);
    expect((await banco.pg.query<any>("SELECT validade_horas FROM dolores_fila_config")).rows[0].validade_horas).toBe(48);
  });
});

describe("admin", () => {
  it("lista (sem argumentos crus), aprova (executa uma vez, com o id de quem decidiu), recusa e muda a validade", async () => {
    await banco.pg.exec(`INSERT INTO users ("openId", name, role, active, "passwordHash") VALUES ('adm2', 'Admin 2', 'admin', true, 'h')`);
    const admin = caller("admin");
    const l = await admin.dolores.fila.listar();
    expect(l.validadeHoras).toBe(48);
    expect(l.itens).toHaveLength(2);
    expect(JSON.stringify(l)).not.toMatch(/"argumentos"|Olá, /);
    const [i1, i2] = await fila();
    expect(await admin.dolores.fila.aprovar({ codigo: i1.codigo.toLowerCase() })).toMatchObject({ ok: true, situacao: "executada" });
    expect(await admin.dolores.fila.aprovar({ codigo: i1.codigo })).toMatchObject({ ok: false, situacao: "executada" });
    expect(await admin.dolores.fila.recusar({ codigo: i2.codigo, motivo: "agora não" })).toMatchObject({ ok: true, situacao: "recusada" });
    const [f1, f2] = await fila();
    expect(f1).toMatchObject({ situacao: "executada", decidido_via: "tela", decidido_por_user_id: 1 });
    expect(f2).toMatchObject({ situacao: "recusada", motivo: "agora não" });
    await expect(admin.dolores.fila.aprovar({ codigo: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin.dolores.fila.salvarValidade({ horas: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await admin.dolores.fila.salvarValidade({ horas: 24 })).toEqual({ validadeHoras: 24 });
    expect((await banco.pg.query<any>("SELECT count(*)::int AS n FROM dolores_acoes WHERE canal = 'tela'")).rows[0].n).toBe(2);
  });
});
