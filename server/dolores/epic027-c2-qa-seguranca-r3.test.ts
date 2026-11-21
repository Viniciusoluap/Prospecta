// Portão de QA de SEGURANÇA do EPIC-027 C2 — RODADA 3 (commit bbbfe3d: permissão "whatsappGrupos" removida; vê quem tem o módulo
// WhatsApp; corretor nunca; classificar só admin; "Exclusive" em NOMES_DA_EMPRESA). Sem banco: getDb e a conexão da empresa
// explodem se forem chamados — prova de que a recusa vem ANTES de qualquer consulta.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn(() => { throw new Error("CONSULTOU O BANCO"); }) }));
vi.mock("../whatsapp-conexao-empresa.js", async orig => ({
  ...(await orig<typeof import("../whatsapp-conexao-empresa.js")>()),
  conexaoDaEmpresa: vi.fn(async () => { throw new Error("CONSULTOU A CONEXAO"); }),
}));

import { ADMIN_MODULES, parsePermissions } from "../../shared/admin-permissions.js";
import { nomeImitaQuemNaoE, podeVerGruposNaCentral } from "../../shared/whatsapp/grupos-central.js";
import { getDb } from "../db.js";
import { appRouter } from "../routers.js";
import { conexaoDaEmpresa } from "../whatsapp-conexao-empresa.js";

type Papel = { role: string; permissoes?: string[]; id?: number; ativo?: boolean };
const caller = (p: Papel) => appRouter.createCaller({
  user: { id: p.id ?? 7, role: p.role, active: p.ativo ?? true, permissions: JSON.stringify(p.permissoes ?? []) }, req: {}, res: {},
} as never);
const rotas = (c: ReturnType<typeof caller>) => [
  c.whatsappGrupos.listar(), c.whatsappGrupos.mensagens({ grupoId: 1 }), c.whatsappGrupos.enviar({ grupoId: 1, texto: "x" }),
  c.whatsappGrupos.atendimento({ grupoId: 1 }), c.whatsappGrupos.mudarAtendimento({ grupoId: 1, acao: "assumir" }),
];
const subconjuntos = <T>(xs: readonly T[]): T[][] => xs.reduce<T[][]>((acc, x) => acc.concat(acc.map(s => [...s, x])), [[]]);

describe("QA-SEG C2 r3 — quem vê os grupos depois de remover 'whatsappGrupos'", () => {
  it("regra pura, TODAS as 2^16 combinações de módulos: corretor/engenheiro/cliente/empreiteiro nunca; colaborador só com 'whatsapp'", () => {
    for (const mods of subconjuntos(ADMIN_MODULES)) {
      const permissions = JSON.stringify([...mods, "whatsappGrupos"]);
      for (const role of ["corretor", "engenheiro", "cliente", "empreiteiro", "user"]) expect(podeVerGruposNaCentral({ role, permissions })).toBe(false);
      expect(podeVerGruposNaCentral({ role: "colaborador", permissions })).toBe(mods.includes("whatsapp"));
      expect(podeVerGruposNaCentral({ role: "colaborador", permissions, active: false })).toBe(false);
    }
    // resto da permissão antiga no JSON gravado não abre nada sozinho, nem o JSON quebrado
    expect(podeVerGruposNaCentral({ role: "colaborador", permissions: JSON.stringify(["whatsappGrupos"]) })).toBe(false);
    expect(podeVerGruposNaCentral({ role: "colaborador", permissions: "não-json" })).toBe(false);
    expect(podeVerGruposNaCentral({ role: "colaborador", permissions: JSON.stringify(["WhatsApp", " whatsapp"]) })).toBe(false);
    expect(parsePermissions(JSON.stringify(["whatsappGrupos"]))).toEqual([]);
  });

  it("appRouter: corretor (várias combinações), colaborador sem 'whatsapp', inativo e engenheiro: FORBIDDEN nas 5 rotas, sem tocar no banco", async () => {
    const outros = ADMIN_MODULES.filter(m => m !== "whatsapp");
    const papeis: Papel[] = [
      ...[[], ["whatsapp"], [...ADMIN_MODULES], ["whatsapp", "whatsappGrupos"], ["whatsappGrupos"]].map(p => ({ role: "corretor", permissoes: p })),
      { role: "colaborador", permissoes: outros }, { role: "colaborador", permissoes: [...outros, "whatsappGrupos"] }, { role: "colaborador", permissoes: [] },
      { role: "colaborador", permissoes: [...ADMIN_MODULES], ativo: false }, { role: "engenheiro", permissoes: [...ADMIN_MODULES] },
    ];
    for (const p of papeis) for (const r of await Promise.allSettled(rotas(caller(p)))) {
      expect(r.status, JSON.stringify(p)).toBe("rejected");
      expect((r as PromiseRejectedResult).reason.code, JSON.stringify(p)).toBe("FORBIDDEN");
    }
    expect(vi.mocked(getDb)).not.toHaveBeenCalled();
    expect(vi.mocked(conexaoDaEmpresa)).not.toHaveBeenCalled();
  });

  it("colaborador com o módulo WhatsApp PASSA do portão (chega à consulta) — o acesso decidido pelo dono existe", async () => {
    await expect(caller({ role: "colaborador", permissoes: ["whatsapp"] }).whatsappGrupos.listar()).rejects.toThrow(/CONSULTOU A CONEXAO/);
  });

  it("colaborador (com WhatsApp e todos os módulos) não classifica grupo: dolores.grupos.definirTipo FORBIDDEN, sem banco", async () => {
    vi.mocked(getDb).mockClear();
    for (const permissoes of [["whatsapp"], [...ADMIN_MODULES]]) for (const tipo of ["cliente", "administrativo", "ignorar", "aceitar"] as const) {
      await expect(caller({ role: "colaborador", permissoes }).dolores.grupos.definirTipo({ grupoId: 1, tipo, numero: tipo === "cliente" ? 1 : null }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(vi.mocked(getDb)).not.toHaveBeenCalled();
  });

  it("nenhum resto de 'whatsappGrupos' como permissão no código de produção (cliente e servidor), só o nome do router", () => {
    const arquivos = ["shared/admin-permissions.ts", "shared/whatsapp/grupos-central.ts", "server/whatsapp-grupos-central.ts", "server/configuracoes-router.ts",
      "server/_core/trpc.ts", "server/_core/rbac.ts", "client/src/pages/admin/AdminConfiguracoes.tsx", "client/src/components/whatsapp/ConversasWhatsApp.tsx"];
    for (const a of arquivos) {
      const t = readFileSync(new URL(`../../${a}`, import.meta.url), "utf8");
      expect(t, a).not.toMatch(/["'`]whatsappGrupos["'`]|AVISO_PERMISSAO_GRUPOS/);
    }
  });
});

describe("QA-SEG C2 r3 — 'Exclusive' em NOMES_DA_EMPRESA", () => {
  it("marca variações: homógrafos cirílico/grego, espaçado, pontuado, largura zero, largas, dígitos, maiúsculas", () => {
    for (const n of ["Exclusive", "EXCLUSIVE", "exclusive imóveis", "Ехсlusive", "Exclυsive", "Exclusiνe", "E x c l u s i v e", "E.x.c.l.u.s.i.v.e",
      "Ex​clusive", "Ｅｘｃｌｕｓｉｖｅ", "3xc1usive", "Éxclusivé", "Atendimento Exclusive"]) expect(nomeImitaQuemNaoE(n), n).toBe(true);
  });
  it("sem falso positivo absurdo em nomes comuns", () => {
    for (const n of ["Excelsior Lima", "Exclusão", "Luiz Clusivo", "Maria Exclusiva", "Alex Silva", "Eva Clarice", "Felipe Xavier", "Ana", ""])
      expect(nomeImitaQuemNaoE(n), n).toBe(false);
  });
});
