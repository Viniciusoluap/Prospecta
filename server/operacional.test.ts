import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  brokerInput,
  commissionBusinessTypeLabel,
  commissionInput,
  commissionPaidAt,
  projectInput,
  suggestedCommissionAmount,
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
  responsibleId: null,
  notes: "",
};
const commission = {
  beneficiary: "corretor",
  businessType: "venda_imovel",
  brokerId: 1,
  propertyId: 1,
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
      { responsibleId: -1 },
      { responsibleId: 0 },
    ])
      expect(visitInput.safeParse({ ...visit, ...change }).success).toBe(false);
  });
  it("responsável é uma seleção real (id), nunca texto livre", () => {
    expect(visitInput.safeParse({ ...visit, responsibleId: 5 }).success).toBe(true);
    expect(visitInput.safeParse({ ...visit, responsibleId: null }).success).toBe(true);
    expect(
      (visitInput.parse({ ...visit, responsibleId: null }) as never as {
        responsibleName?: unknown;
      }).responsibleName
    ).toBeUndefined();
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
  it("EPIC-018: comissão exige imóvel cadastrado ou, para obra, obra cadastrada", () => {
    expect(
      commissionInput.safeParse({ ...commission, propertyId: null }).success
    ).toBe(false);
    expect(
      commissionInput.safeParse({
        ...commission,
        businessType: "obra",
        propertyId: null,
      }).success
    ).toBe(false);
    expect(
      commissionInput.safeParse({
        ...commission,
        businessType: "obra",
        propertyId: null,
        constructionProjectId: 5,
      }).success
    ).toBe(true);
  });
  it("EPIC-018: valor legado 'construcao' é tratado como 'obra'", () => {
    const parsed = commissionInput.parse({
      ...commission,
      businessType: "construcao",
      propertyId: null,
      constructionProjectId: 5,
    });
    expect(parsed.businessType).toBe("obra");
    expect(commissionBusinessTypeLabel("construcao")).toBe("Obra");
    expect(commissionBusinessTypeLabel("obra")).toBe("Obra");
    expect(commissionBusinessTypeLabel("venda_imovel")).toBe("Venda de imóvel");
  });
  it.each([
    [300000, 6, 18000],
    ["250000.00", "5", 12500],
    [199999.99, 3, 6000],
    [null, 6, null],
    [0, 6, null],
    [100000, -1, null],
  ])(
    "EPIC-018: sugere comissão de %s com %s%%",
    (base, percent, expected) =>
      expect(
        suggestedCommissionAmount(base as number | string | null, percent)
      ).toBe(expected)
  );
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
  it("EPIC-018: cadastro de corretor não exige foto nem especialidades", () => {
    const data = brokerInput.parse({
      name: "Corretor",
      email: "broker@example.com",
      phone: "",
      creci: "123",
      active: true,
      notes: "",
    });
    expect(data.avatar).toBeUndefined();
    expect(data.specialties).toBeUndefined();
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
  it("colaborador sem o módulo Corretores não exclui corretor (com o módulo, faz como o admin)", async () => {
    await expect(
      app
        .createCaller(context("colaborador", ["mapa"]))
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
  it("Agenda resolve o responsável selecionado (admin/colaborador ativo) para o nome persistido", async () => {
    const limit = vi.fn().mockResolvedValue([{ name: "Ana Colaboradora" }]);
    const select = vi.fn().mockReturnValue({
      from: () => ({ where: () => ({ limit }) }),
    });
    const values = vi
      .fn()
      .mockReturnValue({ returning: async () => [{ id: 10 }] });
    vi.mocked(getDb).mockReturnValue({
      select,
      insert: () => ({ values }),
    } as unknown as ReturnType<typeof getDb>);
    await expect(
      app
        .createCaller(context("colaborador", ["agenda"]))
        .agenda.create(visitInput.parse({ ...visit, responsibleId: 5 }))
    ).resolves.toEqual({ id: 10 });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ responsibleName: "Ana Colaboradora" })
    );
    expect(values.mock.calls[0][0]).not.toHaveProperty("responsibleId");
  });
  it("Agenda rejeita responsável que não é administrador/colaborador ativo", async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const select = vi.fn().mockReturnValue({
      from: () => ({ where: () => ({ limit }) }),
    });
    const values = vi.fn();
    vi.mocked(getDb).mockReturnValue({
      select,
      // insert() é alcançado antes do await que rejeita (avaliação de argumentos
      // do `.values(...)`); values nunca deve ser chamado com dados reais.
      insert: () => ({ values }),
    } as unknown as ReturnType<typeof getDb>);
    await expect(
      app
        .createCaller(context("colaborador", ["agenda"]))
        .agenda.create(visitInput.parse({ ...visit, responsibleId: 999 }))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(values).not.toHaveBeenCalled();
  });
  it("Agenda não oferece lead excluído/rejeitado como vínculo (nem informado diretamente)", async () => {
    // A mesma query filtrada (deletedAt nulo e stage distinto de "rejected") usada
    // no seletor é aplicada aqui: um lead excluído ou rejeitado não é encontrado,
    // mesmo que o id seja enviado diretamente à API.
    const limit = vi.fn().mockResolvedValue([]);
    const select = vi.fn().mockReturnValue({
      from: () => ({ where: () => ({ limit }) }),
    });
    const values = vi.fn();
    vi.mocked(getDb).mockReturnValue({
      insert: () => ({ values }),
      select,
    } as unknown as ReturnType<typeof getDb>);
    await expect(
      app
        .createCaller(context("colaborador", ["agenda"]))
        .agenda.create(visitInput.parse({ ...visit, leadId: 3 }))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("Comissões grava moeda decimal e não associa corretor à empresa", async () => {
    const values = vi
      .fn()
      .mockReturnValue({ returning: async () => [{ id: 8 }] });
    const lookup = {
      from: () => ({
        where: () => ({ limit: async () => [{ id: 1, title: "Casa Centro" }] }),
      }),
    };
    vi.mocked(getDb).mockReturnValue({
      insert: () => ({ values }),
      select: () => lookup,
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
        // EPIC-018: o título vem do imóvel cadastrado, nunca de texto livre.
        propertyId: 1,
        constructionProjectId: null,
        property: "Casa Centro",
      })
    );
  });
  it("EPIC-018: comissão de obra vincula a obra cadastrada", async () => {
    const values = vi
      .fn()
      .mockReturnValue({ returning: async () => [{ id: 9 }] });
    const lookup = {
      from: () => ({
        where: () => ({ limit: async () => [{ id: 5, title: "Obra Jardim" }] }),
      }),
    };
    vi.mocked(getDb).mockReturnValue({
      insert: () => ({ values }),
      select: () => lookup,
    } as unknown as ReturnType<typeof getDb>);
    await app
      .createCaller(context("colaborador", ["comissoes"]))
      .comissoes.create(
        commissionInput.parse({
          ...commission,
          beneficiary: "empresa",
          businessType: "obra",
          propertyId: null,
          constructionProjectId: 5,
        })
      );
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        businessType: "obra",
        propertyId: null,
        constructionProjectId: 5,
        property: "Obra Jardim",
      })
    );
  });
  it("EPIC-018: recusa imóvel inexistente sem gravar comissão", async () => {
    const insert = vi.fn();
    vi.mocked(getDb).mockReturnValue({
      insert,
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [] }) }),
      }),
    } as unknown as ReturnType<typeof getDb>);
    await expect(
      app
        .createCaller(context("colaborador", ["comissoes"]))
        .comissoes.create(
          commissionInput.parse({ ...commission, beneficiary: "empresa" })
        )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(insert).not.toHaveBeenCalled();
  });
  it("Projetos serializa checklist e tipos", async () => {
    const values = vi
      .fn()
      .mockReturnValue({ returning: async () => [{ id: 9, leadId: null }] });
    // Item 07: o engenheiro é um colaborador ativo escolhido por ID.
    const engenheiro = [{ id: 3, name: "Eng. Ana", role: "colaborador", active: true }];
    vi.mocked(getDb).mockReturnValue({
      insert: () => ({ values }),
      select: () => ({ from: () => ({ where: () => ({ limit: async () => engenheiro }) }) }),
    } as unknown as ReturnType<typeof getDb>);
    await app
      .createCaller(context("colaborador", ["projetos"]))
      .projetos.create(projectInput.parse({ ...project, engineerUserId: 3 }));
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        types: '["arquitetura"]',
        checklist: '[{"id":"arquitetura","type":"arquitetura","text":"arquitetura","done":false}]',
        value: "100.00",
        engineerUserId: 3,
        engineer: "Eng. Ana",
      })
    );
  });

  it("Projetos recusa engenheiro inativo ou sem vínculo de colaborador", async () => {
    vi.mocked(getDb).mockReturnValue({
      insert: () => ({ values: vi.fn() }),
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 4, name: "Cliente", role: "cliente", active: true }] }) }) }),
    } as unknown as ReturnType<typeof getDb>);
    await expect(app.createCaller(context("colaborador", ["projetos"]))
      .projetos.create(projectInput.parse({ ...project, engineerUserId: 4 }))).rejects.toThrow(/colaborador ativo/);
    await expect(app.createCaller(context("colaborador", ["projetos"]))
      .projetos.create(projectInput.parse({ ...project, engineerUserId: null }))).rejects.toThrow(/Escolha o engenheiro/);
  });
});
