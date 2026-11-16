import { describe, expect, it } from "vitest";
import {
  FILTROS_INCORPORACAO_VAZIOS,
  filtrarEstudosIncorporacao,
  filtrosIncorporacaoAtivos,
} from "../shared/incorporacao/filtro-listagem";

// EPIC-024 S-07 — filtros da listagem de Incorporação.
const estudos = [
  { id: 1, name: "Loteamento Jardim das Palmeiras", status: "in_study", incorporationType: "loteamento" },
  { id: 2, name: "Residencial São José", status: "in_progress", incorporationType: "vertical" },
  { id: 3, name: "Desmembramento Rua Ceará", status: "in_study", incorporationType: "desmembramento_simples" },
  { id: 4, name: "Condomínio Antigo", status: "completed", incorporationType: "residencial" },
  { id: 5, name: "Gleba sem tipo", status: "in_study", incorporationType: null },
  { id: 6, name: null, status: "unfeasible", incorporationType: null },
];
const ids = (r: { id: number }[]) => r.map((e) => e.id);
const f = (p: Partial<typeof FILTROS_INCORPORACAO_VAZIOS>) => ({ ...FILTROS_INCORPORACAO_VAZIOS, ...p });

describe("filtrarEstudosIncorporacao", () => {
  it("sem filtro devolve tudo, inclusive tipo legado e sem tipo", () => {
    expect(ids(filtrarEstudosIncorporacao(estudos, FILTROS_INCORPORACAO_VAZIOS))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(filtrosIncorporacaoAtivos(FILTROS_INCORPORACAO_VAZIOS)).toBe(false);
  });

  it("nome ignora maiúsculas e acentos, nos dois sentidos", () => {
    expect(ids(filtrarEstudosIncorporacao(estudos, f({ nome: "sao jose" })))).toEqual([2]);
    expect(ids(filtrarEstudosIncorporacao(estudos, f({ nome: "CEARÁ" })))).toEqual([3]);
    expect(ids(filtrarEstudosIncorporacao(estudos, f({ nome: "condominio" })))).toEqual([4]);
    expect(ids(filtrarEstudosIncorporacao(estudos, f({ nome: "  palmeiras " })))).toEqual([1]);
    expect(filtrosIncorporacaoAtivos(f({ nome: "x" }))).toBe(true);
  });

  it("tipo filtra só o tipo escolhido; legado e nulo ficam fora", () => {
    expect(ids(filtrarEstudosIncorporacao(estudos, f({ tipo: "vertical" })))).toEqual([2]);
    expect(ids(filtrarEstudosIncorporacao(estudos, f({ tipo: "loteamento" })))).toEqual([1]);
    expect(ids(filtrarEstudosIncorporacao(estudos, f({ tipo: "desmembramento_simples" })))).toEqual([3]);
  });

  it("os três filtros combinam", () => {
    expect(ids(filtrarEstudosIncorporacao(estudos, f({ status: "in_study", tipo: "loteamento", nome: "jardim" })))).toEqual([1]);
    expect(ids(filtrarEstudosIncorporacao(estudos, f({ status: "in_progress", tipo: "loteamento" })))).toEqual([]);
    expect(ids(filtrarEstudosIncorporacao(estudos, f({ status: "in_study", nome: "gleba" })))).toEqual([5]);
    expect(ids(filtrarEstudosIncorporacao(estudos, f({ status: "unfeasible" })))).toEqual([6]);
  });
});
