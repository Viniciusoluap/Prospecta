import { describe, expect, it } from "vitest";
import { BROKER_PROPERTY_TYPES, brokerLeadStage, isPropertyPhoto } from "../shared/broker-portal";

// Portal do corretor (pedido de 15/10).
describe("portal do corretor", () => {
  it("tipos de imóvel só pelas opções pedidas", () => {
    expect(BROKER_PROPERTY_TYPES.map(t => t.label)).toEqual(["Casa", "Apartamento", "Lote", "Sala comercial", "Galpão"]);
  });

  it("etapa do lead na régua do CRM", () => {
    expect(brokerLeadStage("lead_new")).toEqual({ stageLabel: "Lead Novo", stageIndex: 0, totalStages: 7 });
    expect(brokerLeadStage("contracts_registry")).toMatchObject({ stageLabel: "Contratos e Cartório", stageIndex: 4 });
    expect(brokerLeadStage("rejected")).toMatchObject({ stageLabel: "Reprovado", stageIndex: -1 });
  });

  it("foto aceita só imagem comprimida em data URL", () => {
    expect(isPropertyPhoto("data:image/jpeg;base64,/9j/4AAQ")).toBe(true);
    expect(isPropertyPhoto("https://exemplo.com/foto.jpg")).toBe(false);
    expect(isPropertyPhoto("data:text/html;base64,PGh0bWw+")).toBe(false);
    expect(isPropertyPhoto(`data:image/png;base64,${"A".repeat(5 * 1024 * 1024)}`)).toBe(false);
  });
});
