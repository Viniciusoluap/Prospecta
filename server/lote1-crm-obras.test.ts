import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers.js";
import * as db from "./db.js";
import { constructionProjectStatusEnum, leadTemperatureEnum } from "../drizzle/schema.js";
import {
  OBRA_STATUS_SELECIONAVEIS,
  OBRA_STATUS_TODOS,
  obraStatusLabel,
  validarMudancaStatusObra,
} from "../shared/obra-status.js";
import { LEAD_TEMPERATURAS, leadTemperaturaRotulo } from "../shared/lead-temperature.js";
import { montarDadosCrmObra, tipoProjetoDoServico } from "../shared/obra-crm.js";

const caller = (role: "admin" | "cliente") =>
  appRouter.createCaller({ user: { id: role === "admin" ? 99 : 4, role, active: true }, req: {}, res: {} } as never);

afterEach(() => vi.restoreAllMocks());

describe("item 05 — temperatura do lead", () => {
  it("acrescenta Negócio fechado sem remover Frio/Morno/Quente e espelha o enum do banco", () => {
    expect(LEAD_TEMPERATURAS).toEqual(["cold", "warm", "hot", "closed"]);
    expect([...leadTemperatureEnum.enumValues]).toEqual([...LEAD_TEMPERATURAS]);
    expect(leadTemperaturaRotulo("closed")).toBe("🤝 Negócio fechado");
    expect(leadTemperaturaRotulo(null)).toBe("❄️ Frio");
  });

  it("aceita persistir a temperatura 'closed' pela API de edição do lead", async () => {
    vi.spyOn(db, "getLeadById").mockResolvedValue({ id: 7, stage: "lead_new", stageClassificationPending: false, deletedAt: null } as never);
    const update = vi.spyOn(db, "updateLead").mockResolvedValue(undefined);
    await caller("admin").leads.update({ id: 7, temperature: "closed" });
    expect(update).toHaveBeenCalledWith(7, expect.objectContaining({ temperature: "closed" }));
  });
});

describe("itens 06 e 07 — classificações de Obra alinhadas entre tela, API e banco", () => {
  it("pedido A1: o seletor oferece as mesmas 19 situações do filtro da lista, na mesma ordem", () => {
    expect(OBRA_STATUS_SELECIONAVEIS.map(obraStatusLabel)).toEqual([
      "Planejamento", "Aprovação", "Contrato Prospecta", "Laudo CEF", "Conformidade CEF",
      "Alvará", "ART", "Assinatura CEF", "Vistoria CEF", "Laudo OK", "Cartório", "Em Andamento",
      "Casa Pronta", "Disponível", "Reavaliar", "Distrato", "Pausada", "Concluída", "Cancelada",
    ]);
    expect(OBRA_STATUS_SELECIONAVEIS).toEqual(OBRA_STATUS_TODOS);
  });

  it("todo valor aceito pela API existe no enum do banco e vice-versa", () => {
    expect([...OBRA_STATUS_TODOS].sort()).toEqual([...constructionProjectStatusEnum.enumValues].sort());
  });

  it("qualquer uma das 19 situações pode ser escolhida; valor desconhecido é recusado", () => {
    expect(validarMudancaStatusObra("in_progress", "in_progress")).toBeNull();
    expect(validarMudancaStatusObra("planning", "paused")).toBeNull();
    expect(validarMudancaStatusObra("planning", "cancelled")).toBeNull();
    expect(validarMudancaStatusObra("planning", "inexistente")).toMatch(/não está disponível/);
  });

  it("API salva obra nova e antiga em qualquer uma das 19 situações", async () => {
    const update = vi.spyOn(db, "updateProject").mockResolvedValue(undefined);
    vi.spyOn(db, "getProjectById").mockResolvedValue({ id: 1, status: "in_progress", userId: null } as never);
    await expect(caller("admin").construction.updateProject({ projectId: 1, status: "in_progress", title: "Obra antiga" })).resolves.toEqual({ success: true });
    await expect(caller("admin").construction.updateProject({ projectId: 1, status: "contrato_prospecta" })).resolves.toEqual({ success: true });
    await expect(caller("admin").construction.updateProject({ projectId: 1, status: "cancelled" })).resolves.toEqual({ success: true });
    expect(update).toHaveBeenCalledTimes(3);
  });

  it("somente administradores alteram a obra (cliente do portal recebe FORBIDDEN)", async () => {
    const update = vi.spyOn(db, "updateProject").mockResolvedValue(undefined);
    vi.spyOn(db, "getProjectById").mockResolvedValue({ id: 1, status: "planning", userId: 4 } as never);
    await expect(caller("cliente").construction.updateProject({ projectId: 1, title: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("itens 08, 09 e 24 — dados da obra vindos do CRM", () => {
  it("tipo de projeto vem do serviço do CRM; obra sem serviço preserva o valor antigo", () => {
    expect(tipoProjetoDoServico("vistoria_medicao")).toBe("Vistoria e medição");
    expect(tipoProjetoDoServico("obra_cliente")).toBe("Obra / reforma");
    expect(tipoProjetoDoServico(null)).toBeNull();

    expect(montarDadosCrmObra({ leadName: "Maria", brokerName: "Chaleilson", serviceType: "obra_cliente", projectTypeGravado: "Vistoria e medição" }))
      .toEqual({ vinculada: true, clientName: "Maria", brokerName: "Chaleilson", projectType: "Obra / reforma", projectTypeOrigem: "crm" });
    expect(montarDadosCrmObra({ leadName: null, brokerName: null, serviceType: null, projectTypeGravado: "Casa 47m²" }))
      .toEqual({ vinculada: false, clientName: null, brokerName: null, projectType: "Casa 47m²", projectTypeOrigem: "legado" });
  });

  it("corretor ausente fica nulo (campo oculto na tela)", () => {
    expect(montarDadosCrmObra({ leadName: "João", brokerName: "  ", serviceType: "obra_cliente", projectTypeGravado: null }).brokerName).toBeNull();
  });

  it("a API de obra não aceita tipo de projeto: tentar alterá-lo não muda a fonte oficial", async () => {
    const update = vi.spyOn(db, "updateProject").mockResolvedValue(undefined);
    vi.spyOn(db, "getProjectById").mockResolvedValue({ id: 1, status: "planning", userId: null } as never);
    await caller("admin").construction.updateProject({ projectId: 1, title: "Obra", projectType: "Mansão" } as never);
    expect(update).toHaveBeenCalledWith(1, expect.not.objectContaining({ projectType: expect.anything() }));
  });
});
