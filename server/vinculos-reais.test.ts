import { afterEach, describe, expect, it, vi } from "vitest";
import * as db from "./db.js";
import { appRouter } from "./routers.js";
import { linkRecordToLead } from "./lead-services-router.js";
import { leadContact, leadFullAddress, missingLeadAddressFields } from "../shared/lead-snapshot.js";
import { financiamentoFromLeadSchema } from "../shared/financiamento.js";

vi.mock("./lead-services-router.js", async importOriginal => ({
  ...(await importOriginal<typeof import("./lead-services-router.js")>()),
  linkRecordToLead: vi.fn().mockResolvedValue("linked"),
}));

const caller = (role: "admin" | "cliente") =>
  appRouter.createCaller({ user: { id: role === "admin" ? 99 : 4, role, active: true }, req: {}, res: {} } as never);

const lead = {
  id: 12, name: " Maria Souza ", phone: "(99) 98888-7777", email: "maria@example.com", cpf: "123.456.789-09",
  address: "Rua das Flores, 100", neighborhood: "Centro", city: "Imperatriz", state: "ma", deletedAt: null,
};

afterEach(() => vi.clearAllMocks());

describe("EPIC-017 — dados do lead migrados para os serviços", () => {
  it("normaliza o contato do lead como fonte única", () => {
    expect(leadContact(lead)).toEqual({
      name: "Maria Souza", phone: "(99) 98888-7777", email: "maria@example.com", cpf: "123.456.789-09",
      address: "Rua das Flores, 100", neighborhood: "Centro", city: "Imperatriz", state: "MA",
    });
    expect(leadFullAddress(lead)).toBe("Rua das Flores, 100, Centro, Imperatriz/MA");
    expect(missingLeadAddressFields(lead)).toEqual([]);
    expect(missingLeadAddressFields({ name: "A", phone: "", email: null, city: null, state: null }))
      .toEqual(["endereço", "bairro", "cidade", "UF"]);
  });

  it("avaliação usa os dados do lead e entra nos serviços do cliente", async () => {
    vi.spyOn(db, "getLeadById").mockResolvedValue(lead as never);
    const create = vi.spyOn(db, "createAvaliacao").mockResolvedValue({ id: 31 } as never);
    await expect(caller("admin").avaliacoes.create({
      tipo: "mercado", finalidade: "compra_venda", leadId: 12, avaliador: "Eng. João", areaTerreno: 300,
    })).resolves.toMatchObject({ id: 31 });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 12, clienteNome: "Maria Souza", clienteCpf: "123.456.789-09", clienteTel: "(99) 98888-7777",
      clienteEmail: "maria@example.com", endereco: "Rua das Flores, 100", bairro: "Centro", cidade: "Imperatriz", estado: "MA",
      avaliador: "Eng. João", areaTerreno: "300",
    }));
    expect(linkRecordToLead).toHaveBeenCalledWith("avaliacoes", 12, 31);
  });

  it("não cria avaliação sem lead existente nem com cliente digitado", async () => {
    vi.spyOn(db, "getLeadById").mockResolvedValue(undefined);
    const create = vi.spyOn(db, "createAvaliacao");
    await expect(caller("admin").avaliacoes.create({
      tipo: "mercado", finalidade: "compra_venda", leadId: 12, avaliador: "Eng. João",
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller("admin").avaliacoes.create({
      tipo: "mercado", finalidade: "compra_venda", avaliador: "Eng. João", clienteNome: "Digitado",
    } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(create).not.toHaveBeenCalled();
  });

  it("não troca o lead de uma avaliação já vinculada (Codex #87)", async () => {
    vi.spyOn(db, "getAvaliacaoById").mockResolvedValue({ id: 31, leadId: 12, leadServiceId: 50 } as never);
    vi.spyOn(db, "getLeadById").mockResolvedValue({ ...lead, id: 13 } as never);
    const update = vi.spyOn(db, "updateAvaliacao").mockResolvedValue(undefined as never);
    await expect(caller("admin").avaliacoes.update({ id: 31, leadId: 13 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(update).not.toHaveBeenCalled();
    expect(linkRecordToLead).not.toHaveBeenCalled();
  });

  it("editar avaliação vinculada mantém o lead e sincroniza os dados do CRM", async () => {
    vi.spyOn(db, "getAvaliacaoById").mockResolvedValue({ id: 31, leadId: 12, leadServiceId: 50 } as never);
    vi.spyOn(db, "getLeadById").mockResolvedValue(lead as never);
    const update = vi.spyOn(db, "updateAvaliacao").mockResolvedValue(undefined as never);
    await caller("admin").avaliacoes.update({ id: 31, leadId: 12, avaliador: "Eng. Ana", clienteNome: "Outro" });
    expect(update).toHaveBeenCalledWith(31, expect.objectContaining({ leadId: 12, clienteNome: "Maria Souza", avaliador: "Eng. Ana" }));
    expect(linkRecordToLead).not.toHaveBeenCalled();
  });

  it("avaliação antiga sem lead ganha o lead e entra nos serviços do cliente", async () => {
    vi.spyOn(db, "getAvaliacaoById").mockResolvedValue({ id: 31, leadId: null, leadServiceId: null } as never);
    vi.spyOn(db, "getLeadById").mockResolvedValue(lead as never);
    const update = vi.spyOn(db, "updateAvaliacao").mockResolvedValue(undefined as never);
    await caller("admin").avaliacoes.update({ id: 31, leadId: 12 });
    expect(update).toHaveBeenCalledWith(31, expect.objectContaining({ leadId: 12, clienteNome: "Maria Souza" }));
    expect(linkRecordToLead).toHaveBeenCalledWith("avaliacoes", 12, 31);
  });

  it("novo financiamento exige lead e ignora dados de cliente digitados", () => {
    const base = {
      imovel: "Casa Centro", tipo: "mcmv", banco: "caixa", valorImovel: 200000, valorFinanciado: 150000,
      entrada: 50000, taxa: 8, prazo: 360,
    };
    expect(financiamentoFromLeadSchema.safeParse(base).success).toBe(false);
    const parsed = financiamentoFromLeadSchema.parse({ ...base, leadId: 12, clienteNome: "Digitado" });
    expect(parsed).not.toHaveProperty("clienteNome");
    expect(parsed.leadId).toBe(12);
  });
});

describe("EPIC-017 — responsável e corretor reais no lead", () => {
  it("lista responsáveis e corretores apenas para administradores", async () => {
    vi.spyOn(db, "getLeadAssignmentOptions").mockResolvedValue({
      responsibles: [{ id: 1, name: "Ana", email: "ana@x.com", role: "colaborador" }],
      brokers: [{ id: 2, name: "Beto", email: "beto@x.com", role: "corretor" }],
    } as never);
    await expect(caller("admin").leads.assignmentOptions()).resolves.toMatchObject({
      responsibles: [{ id: 1 }], brokers: [{ id: 2 }],
    });
    await expect(caller("cliente").leads.assignmentOptions()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("recusa responsável ou corretor que não sejam usuários com o papel correto", async () => {
    vi.spyOn(db, "getLeadById").mockResolvedValue({ id: 7, stage: "lead_new", deletedAt: null } as never);
    const update = vi.spyOn(db, "updateLead").mockResolvedValue(undefined);
    vi.spyOn(db, "validateLeadAssignment").mockResolvedValueOnce({ responsibleOk: false, brokerOk: true });
    await expect(caller("admin").leads.update({ id: 7, responsibleUserId: 50 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    vi.spyOn(db, "validateLeadAssignment").mockResolvedValueOnce({ responsibleOk: true, brokerOk: false });
    await expect(caller("admin").leads.update({ id: 7, brokerId: 51 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(update).not.toHaveBeenCalled();
  });

  it("grava responsável, corretor e dados cadastrais do lead", async () => {
    vi.spyOn(db, "getLeadById").mockResolvedValue({ id: 7, stage: "lead_new", deletedAt: null } as never);
    vi.spyOn(db, "validateLeadAssignment").mockResolvedValue({ responsibleOk: true, brokerOk: true });
    const update = vi.spyOn(db, "updateLead").mockResolvedValue(undefined);
    await caller("admin").leads.update({
      id: 7, responsibleUserId: 1, brokerId: 2, cpf: "123", address: "Rua A", neighborhood: "Centro",
    });
    expect(update).toHaveBeenCalledWith(7, expect.objectContaining({
      responsibleUserId: 1, brokerId: 2, cpf: "123", address: "Rua A", neighborhood: "Centro",
    }));
  });
});
