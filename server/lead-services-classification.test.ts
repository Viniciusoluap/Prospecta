import { describe, expect, it } from "vitest";
import { serviceTypeFromTrelloFields } from "../shared/lead-services";

describe("EPIC-015 S-02 - classificação dos serviços migrados", () => {
  it.each([
    ["PLANEJAMENTO SEMANAL DE OBRAS", "obra_cliente"],
    ["VISTORIAS E MEDIÇÕES", "vistoria_medicao"],
    ["PROJETOS", "projeto_tecnico"],
    ["SERVIÇOS DO DESPACHANTE - MA", "despachante"],
    ["Habitacional CCA - IMPERATRIZ", "financiamento_habitacional"],
    ["CONTRATOS DO MÊS", "financiamento_habitacional"],
    ["CONSÓRCIO MA", "consorcio"],
    ["Juridico", "juridico"],
    ["CONTAS A PAGAR", "bpo_financeiro"],
    ["ASSESSORIA VFX", "operacional_interno"],
  ])("mapeia a lista %s para %s", (originList, expected) => {
    expect(serviceTypeFromTrelloFields({ originList })).toBe(expected);
  });

  it("usa o título como fallback quando a lista não foi preservada", () => {
    expect(serviceTypeFromTrelloFields({ title: "REEMBOLSO RCPM HENRIQUE" })).toBe("reembolso");
  });

  it("não fabrica uma classificação sem evidência", () => {
    expect(serviceTypeFromTrelloFields({ title: "CLIENTE SEM CONTEXTO" })).toBe("outro");
  });
});
