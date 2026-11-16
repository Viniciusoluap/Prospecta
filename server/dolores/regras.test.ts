// EPIC-025 (Dolores, etapa 1) — regras puras de shared/dolores (formato, máscaras, limites, responsável, prazos).
import { describe, expect, it } from "vitest";
import {
  diaDoPrazo, diaFortaleza, diasEntre, isoFortaleza, limitarResposta, mascararCpf, mascararTelefone, paginar, reais, truncar,
} from "../../shared/dolores/formato.js";
import { etapaAtual, proximaProvidencia, responsavelDaTarefa, responsavelDoProcesso, situacaoDoPrazo } from "../../shared/dolores/regras.js";

describe("formato", () => {
  it("datas no fuso de Imperatriz; prazo pelo dia gravado", () => {
    expect(isoFortaleza(new Date("2026-11-16T02:30:00Z"))).toBe("2026-11-15T23:30:00-03:00");
    expect(diaFortaleza(new Date("2026-11-16T02:30:00Z"))).toBe("2026-11-15");
    expect(diaDoPrazo(new Date("2026-11-10T00:00:00Z"))).toBe("2026-11-10");
    expect(diaDoPrazo("2026-11-10")).toBe("2026-11-10");
    expect(isoFortaleza(null)).toBeNull();
    expect(isoFortaleza("lixo")).toBeNull();
    expect(diasEntre("2026-11-10", "2026-11-16")).toBe(6);
  });

  it("CPF só com os 2 últimos dígitos; telefone com DDD e 4 últimos", () => {
    expect(mascararCpf("123.456.789-01")).toBe("***.***.***-01");
    expect(mascararCpf("1234")).toBe("***");
    expect(mascararCpf(null)).toBeNull();
    expect(mascararTelefone("5599991234567")).toBe("(99) *****-4567");
    expect(mascararTelefone("12")).toBe("***");
  });

  it("dinheiro, texto, página e corte da resposta", () => {
    expect(reais("1234.567")).toBe(1234.57);
    expect(reais("abc")).toBeNull();
    expect(truncar("  a   b  ")).toBe("a b");
    expect(truncar("x".repeat(10), 5)).toBe("xxxx…");
    expect(paginar([1, 2, 3, 4, 5], 2, 2)).toEqual({ itens: [3, 4], total: 5, pagina: 2, limite: 2, temMais: true });
    const grande = { itens: Array.from({ length: 1000 }, (_, i) => ({ i, t: "y".repeat(50) })), totais: { n: 1000 } };
    const r = limitarResposta(grande, 5000);
    expect(r.truncado).toBe(true);
    expect(JSON.stringify(r.valor).length).toBeLessThanOrEqual(5000);
    expect((r.valor as typeof grande).totais).toEqual({ n: 1000 });
    expect(limitarResposta({ a: 1 }).truncado).toBe(false);
  });
});

describe("regras", () => {
  it("responsável: vazio/marcador → a confirmar (com o motivo); nome real fica", () => {
    expect(responsavelDoProcesso("", true)).toEqual({ nome: "a confirmar", aConfirmar: true, motivo: "padrão da migração do Trello (responsável não informado)" });
    expect(responsavelDoProcesso("  Sem Responsável ", false)).toMatchObject({ nome: "a confirmar", motivo: "responsável não registrado no processo" });
    expect(responsavelDoProcesso("Bianca", true)).toEqual({ nome: "Bianca", aConfirmar: false, motivo: null });
    expect(responsavelDaTarefa("Sem responsável")).toBe("sem responsável");
  });

  it("etapa atual e situação do prazo", () => {
    expect(etapaAtual([{ nome: "B", ordem: 2, progresso: 0 }, { nome: "A", ordem: 1, progresso: 100 }])).toMatchObject({ nome: "B", todasConcluidas: false });
    expect(etapaAtual([{ nome: "A", ordem: 1, progresso: 100 }])).toMatchObject({ nome: "A", todasConcluidas: true });
    expect(etapaAtual([])).toBeNull();
    const agora = new Date("2026-11-16T12:00:00Z");
    expect(situacaoDoPrazo({ encerrado: false, prazo: "2026-11-15", ultimaMovimentacao: "2026-11-01T12:00:00Z", agora }))
      .toEqual({ atrasado: true, diasDeAtraso: 1, diasSemMovimentacao: 15, parado: true });
    expect(situacaoDoPrazo({ encerrado: false, prazo: "2026-11-16", ultimaMovimentacao: null, agora })).toMatchObject({ atrasado: false, parado: false });
    expect(situacaoDoPrazo({ encerrado: true, prazo: "2026-01-01", ultimaMovimentacao: "2025-01-01", agora })).toMatchObject({ atrasado: false, parado: false });
  });

  it("próxima providência: tarefa aberta mais cedo, depois follow-up; nada → null", () => {
    const tarefas = [
      { title: "sem prazo", status: "pending", dueAt: null, assignedTo: "A" },
      { title: "cedo", status: "in_progress", dueAt: "2026-11-17T12:00:00Z", assignedTo: "B" },
      { title: "feita", status: "done", dueAt: "2026-11-01T12:00:00Z", assignedTo: "C" },
    ];
    expect(proximaProvidencia({ tarefas })).toEqual({ fonte: "tarefa", descricao: "cedo", prazo: "2026-11-17", responsavel: "B" });
    expect(proximaProvidencia({ tarefas: [], followupDate: "2026-11-20T12:00:00Z" })).toMatchObject({ fonte: "follow_up_crm", prazo: "2026-11-20" });
    expect(proximaProvidencia({ tarefas: [] })).toBeNull();
  });
});
