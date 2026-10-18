import { describe, expect, it } from "vitest";
import { FILTROS_OBRAS_VAZIOS, filtrarObras, filtrosAtivos, type ObraFiltravel } from "../shared/obras-filtro";

const obras: ObraFiltravel[] = [
  { id: 1, codigo: "#1", nome: "Casa Ipê", cliente: "João Pereira", status: "in_progress", responsaveis: ["Carlos Empreiteiro"], criadoEm: "2026-01-10T12:00:00Z", inicio: "2026-02-01", fim: "2026-08-01" },
  { id: 2, codigo: "#2", nome: "Reforma Açaí", cliente: "Maria Souza", status: "completed", responsaveis: ["Ana Engenheira"], criadoEm: "2026-03-05T12:00:00Z", inicio: "2026-03-10", fim: "2026-04-10" },
  { id: 3, codigo: "#3", nome: "ampliação Beta", cliente: "João Silva", status: "in_progress", responsaveis: [null, "Carlos Empreiteiro"], criadoEm: "2026-05-20T12:00:00Z", inicio: null, fim: null },
];
const f = (p: Partial<typeof FILTROS_OBRAS_VAZIOS>) => ({ ...FILTROS_OBRAS_VAZIOS, ...p });
const ids = (r: ObraFiltravel[]) => r.map((o) => o.id);

describe("filtros combinados de Obras (item 01)", () => {
  it("sem filtro: todas, mais recentes primeiro", () => expect(ids(filtrarObras(obras, f({})))).toEqual([3, 2, 1]));
  it("nome e cliente ignoram acento e maiúsculas", () => {
    expect(ids(filtrarObras(obras, f({ nome: "acai" })))).toEqual([2]);
    expect(ids(filtrarObras(obras, f({ cliente: "JOAO" })))).toEqual([3, 1]);
  });
  it("código aceita com ou sem #", () => {
    expect(ids(filtrarObras(obras, f({ codigo: "#2" })))).toEqual([2]);
    expect(ids(filtrarObras(obras, f({ codigo: "3" })))).toEqual([3]);
  });
  it("filtros funcionam em conjunto", () => {
    expect(ids(filtrarObras(obras, f({ cliente: "joão", status: "in_progress", responsavel: "carlos" })))).toEqual([3, 1]);
    expect(ids(filtrarObras(obras, f({ cliente: "joão", status: "completed" })))).toEqual([]);
  });
  it("período de execução por sobreposição; obra sem datas fica de fora", () => {
    expect(ids(filtrarObras(obras, f({ periodoDe: "2026-04-01", periodoAte: "2026-04-30" })))).toEqual([2, 1]);
    expect(ids(filtrarObras(obras, f({ periodoDe: "2026-09-01" })))).toEqual([]);
  });
  it("data de criação inclusiva", () => {
    expect(ids(filtrarObras(obras, f({ criadoDe: "2026-03-05", criadoAte: "2026-05-20" })))).toEqual([3, 2]);
  });
  it("ordenações alfabética e cronológica", () => {
    expect(ids(filtrarObras(obras, f({ ordem: "az" })))).toEqual([3, 1, 2]);
    expect(ids(filtrarObras(obras, f({ ordem: "za" })))).toEqual([2, 1, 3]);
    expect(ids(filtrarObras(obras, f({ ordem: "antigas" })))).toEqual([1, 2, 3]);
  });
  it("conta filtros ativos (limpar = voltar ao vazio)", () => {
    expect(filtrosAtivos(FILTROS_OBRAS_VAZIOS)).toBe(0);
    expect(filtrosAtivos(f({ nome: "x", status: "in_progress", ordem: "az" }))).toBe(2);
  });
});

describe("pedido de 18/10 — filtro de medições", () => {
  const base = { codigo: "#1", nome: "A", cliente: "", status: "planning", responsaveis: [], criadoEm: "2026-10-01" };
  const obras = [
    { ...base, id: 1, medicoesSolicitadas: 1, medicoesRecebidas: 0 },
    { ...base, id: 2, medicoesSolicitadas: 0, medicoesRecebidas: 2 },
    { ...base, id: 3, medicoesSolicitadas: 0, medicoesRecebidas: 0 },
  ];
  it("separa obras com medição solicitada e com medição recebida", () => {
    expect(filtrarObras(obras, f({ medicao: "solicitada" })).map((o) => o.id)).toEqual([1]);
    expect(filtrarObras(obras, f({ medicao: "recebida" })).map((o) => o.id)).toEqual([2]);
    expect(filtrarObras(obras, f({})).length).toBe(3);
    expect(filtrosAtivos(f({ medicao: "recebida" }))).toBe(1);
  });
});
