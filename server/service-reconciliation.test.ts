import { describe, expect, it } from "vitest";
import { selectProcessReference } from "../shared/service-reconciliation";
import { LEAD_SERVICE_LABELS, LEAD_SERVICE_MODULE, LEAD_SERVICE_PRIMARY_TYPES } from "../shared/lead-services";

describe("entrada de serviços do CRM", () => {
  it("oferece exatamente os sete módulos sem perder o identificador legado despachante", () => {
    expect(LEAD_SERVICE_PRIMARY_TYPES.map(type => LEAD_SERVICE_MODULE[type])).toEqual([
      "obras", "tarefas", "regularizacoes", "comissoes", "projetos", "avaliacoes", "financiamentos",
    ]);
    expect(LEAD_SERVICE_MODULE.despachante).toBe("regularizacoes");
    expect(LEAD_SERVICE_LABELS.despachante).toBe("Regularizações");
  });
});

describe("reconciliação por chaves", () => {
  const row = { id: 50, lead_id: 7, lead_service_id: null };

  it("reutiliza processo com lead único e serviço único", () => {
    expect(selectProcessReference([row], 7, 9, null, 1)).toEqual({ state: "relinked", selected: row });
  });

  it("não adivinha qual processo associar quando há ambiguidade", () => {
    expect(selectProcessReference([row, { ...row, id: 51 }], 7, 9, null, 1).state).toBe("ambiguous");
    expect(selectProcessReference([row], 7, 9, null, 2).state).toBe("ambiguous");
  });

  it("recusa ID explícito de outro lead ou serviço", () => {
    expect(selectProcessReference([{ ...row, lead_id: 8 }], 7, 9, 50, 1).state).toBe("conflict");
    expect(selectProcessReference([{ ...row, lead_service_id: 10 }], 7, 9, 50, 1).state).toBe("conflict");
  });

  it("não cria uma segunda associação para processo já vinculado", () => {
    const linked = { ...row, lead_service_id: 9 };
    expect(selectProcessReference([linked], 7, 9, 50, 1)).toEqual({ state: "already_linked", selected: linked });
  });
});
