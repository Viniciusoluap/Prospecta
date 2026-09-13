import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  brokerInput,
  commissionInput,
  commissionPaidAt,
  projectInput,
  validCoordinates,
  visitInput,
} from "../shared/operacional";
import { canAccessAdminProcedure, router } from "./_core/trpc";
import type { TrpcContext } from "./_core/context";
import {
  agendaRouter,
  comissoesRouter,
  corretoresRouter,
  mapaRouter,
  projetosRouter,
} from "./operacional-router";
import { getDb } from "./db";

vi.mock("./db", () => ({ getDb: vi.fn() }));
const app = router({
  agenda: agendaRouter,
  comissoes: comissoesRouter,
  corretores: corretoresRouter,
  mapa: mapaRouter,
  projetos: projetosRouter,
});
const context = (role: string, permissions: string[] = []) =>
  ({
    user: {
      id: 123,
      role,
      permissions: JSON.stringify(permissions),
      active: true,
    },
    req: {},
    res: {},
  }) as TrpcContext;
const visit = {
  leadId: null,
  propertyId: null,
  brokerId: null,
  clientName: "Cliente",
  clientPhone: "",
  scheduledAt: new Date(),
  status: "agendada",
  visitType: "imovel",
  responsibleName: "",
  notes: "",
};
const commission = {
  beneficiary: "corretor",
  businessType: "venda_imovel",
  brokerId: 1,
  property: "Imóvel teste",
  amount: 100,
  percent: 6,
  status: "pendente",
  dueDate: new Date(),
  notes: "",
};
const project = {
  name: "Projeto",
  types: ["arquitetura"],
  status: "orcamento",
  clientName: "Cliente",
  clientPhone: "",
  engineer: "Engenheiro",
  value: 100,
  paidValue: 0,
  deadline: null,
  leadId: null,
  description: "",
  checklist: [],
  files: [],
};

describe("Etapa 4 — validação de negócio", () => {
  it("visita permite cliente avulso ou lead, nunca ambos vazios", () => {
    expect(visitInput.safeParse(visit).success).toBe(true);
    expect(
      visitInput.safeParse({ ...visit, clientName: "", leadId: 1 }).success
    ).toBe(true);
    expect(visitInput.safeParse({ ...visit, clientName: "" }).success).toBe(
      false
    );
  });
  it("recusa data/status/vínculo inválidos", () => {
    for (const change of [
      { scheduledAt: "invalid" },
      { status: "inventado" },
      { brokerId: -1 },
    ])
      expect(visitInput.safeParse({ ...visit, ...change }).success).toBe(false);
  });
  it("comissão exige corretor apenas para beneficiário corretor", () => {
    expect(commissionInput.safeParse(commission).success).toBe(true);
    expect(
      commissionInput.safeParse({ ...commission, brokerId: null }).success
    ).toBe(false);
    expect(
      commissionInput.safeParse({
        ...commission,
        beneficiary: "empresa",
        brokerId: null,
      }).success
    ).toBe(true);
  });
  it.each([
    { amount: -1 },
    { amount: Infinity },
    { percent: 101 },
    { status: "fake" },
  ])("recusa comissão inválida %j", change =>
    expect(
      commissionInput.safeParse({ ...commission, ...change }).success
    ).toBe(false)
  );
  it("pagar preserva data anterior e estornar limpa data", () => {
    const previous = new Date("2026-01-01");
    expect(commissionPaidAt("paga", previous)).toBe(previous);
    expect(commissionPaidAt("pendente", previous)).toBeNull();
    expect(commissionPaidAt("cancelada", previous)).toBeNull();
    expect(commissionPaidAt("paga")).toBeInstanceOf(Date);
  });
  it("projeto suporta checklist e links seguros", () => {
    expect(
      projectInput.safeParse({
        ...project,
        checklist: [{ text: "ART", done: true }],
        files: [{ name: "Planta", url: "https://example.com/planta.pdf" }],
      }).success
    ).toBe(true);
  });
  it("recusa pagamento excedente e links executáveis", () => {
    expect(projectInput.safeParse({ ...project, paidValue: 101 }).success).toBe(
      false
    );
    expect(
      projectInput.safeParse({
        ...project,
        files: [{ name: "Teste", url: "javascript:alert(1)" }],
      }).success
    ).toBe(false);
  });
  it("perfil de corretor não aceita permissões ou senha no payload resultante", () => {
    const data = brokerInput.parse({
      name: "Corretor",
      email: "broker@example.com",
      phone: "",
      creci: "123",
      avatar: "",
      active: true,
      specialties: [],
      role: "admin",
      permissions: ["configuracoes"],
      password: "malicious",
    });
    expect(data).not.toHaveProperty("role");
    expect(data).not.toHaveProperty("permissions");
    expect(data).not.toHaveProperty("password");
  });
  it.each([
    [null, "0", false],
    ["", "0", false],
    ["0", "0", true],
    ["-6.48", "-49.89", true],
    ["91", "0", false],
    ["0", "181", false],
    ["NaN", "0", false],
  ])("valida coordenadas %s %s", (lat, lng, expected) =>
    expect(validCoordinates(lat as string | null, lng as string)).toBe(expected)
  );
});

describe("Etapa 4 — autorização aplicada antes do banco", () => {
  beforeEach(() => vi.clearAllMocks());
  const modules = [
    "agenda",
    "corretores",
    "comissoes",
    "projetos",
    "mapa",
  ] as const;
  it.each(modules)(
    "bloqueia cliente e funcionário sem permissão em %s",
    async module => {
      for (const ctx of [
        context("cliente", [module]),
        context("colaborador"),
        { ...context("cliente"), user: null },
      ]) {
        const caller = app.createCaller(ctx);
        await expect(caller[module].list()).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      }
      expect(getDb).not.toHaveBeenCalled();
    }
  );
  it.each(modules)("mapeia %s sem conceder outros módulos", module => {
    expect(
      canAccessAdminProcedure(
        context("colaborador", [module]).user!,
        `${module}.list`
      )
    ).toBe(true);
    expect(
      canAccessAdminProcedure(
        context("colaborador", [module]).user!,
        "configuracoes.listUsers"
      )
    ).toBe(false);
  });
  it("funcionário não pode excluir conta mesmo com acesso a Corretores", async () => {
    await expect(
      app
        .createCaller(context("colaborador", ["corretores"]))
        .corretores.delete({ id: 4 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getDb).not.toHaveBeenCalled();
  });
  it("recusa mutações de outro módulo", async () => {
    await expect(
      app
        .createCaller(context("colaborador", ["mapa"]))
        .agenda.create(visitInput.parse(visit))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe("Etapa 4 — persistência via procedures", () => {
  beforeEach(() => vi.clearAllMocks());
  it("Agenda persiste cliente avulso sem fabricar lead", async () => {
    const values = vi
      .fn()
      .mockReturnValue({ returning: async () => [{ id: 7 }] });
    vi.mocked(getDb).mockReturnValue({
      insert: () => ({ values }),
    } as unknown as ReturnType<typeof getDb>);
    await expect(
      app
        .createCaller(context("colaborador", ["agenda"]))
        .agenda.create(visitInput.parse(visit))
    ).resolves.toEqual({ id: 7 });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: null, clientName: "Cliente" })
    );
  });
  it("Comissões grava moeda decimal e não associa corretor à empresa", async () => {
    const values = vi
      .fn()
      .mockReturnValue({ returning: async () => [{ id: 8 }] });
    vi.mocked(getDb).mockReturnValue({
      insert: () => ({ values }),
    } as unknown as ReturnType<typeof getDb>);
    await app
      .createCaller(context("colaborador", ["comissoes"]))
      .comissoes.create(
        commissionInput.parse({
          ...commission,
          beneficiary: "empresa",
          status: "paga",
        })
      );
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        brokerId: null,
        amount: "100.00",
        percent: "6.00",
        paidAt: expect.any(Date),
      })
    );
  });
  it("Projetos serializa checklist e tipos", async () => {
    const values = vi
      .fn()
      .mockReturnValue({ returning: async () => [{ id: 9 }] });
    vi.mocked(getDb).mockReturnValue({
      insert: () => ({ values }),
    } as unknown as ReturnType<typeof getDb>);
    await app
      .createCaller(context("colaborador", ["projetos"]))
      .projetos.create(projectInput.parse(project));
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        types: '["arquitetura"]',
        checklist: "[]",
        value: "100.00",
      })
    );
  });
});
