// EPIC-029 S-7 (22/11/2026) — municípios da operação com o código IBGE (7). Fonte: Brasil API
// `GET /api/ibge/municipios/v1/{UF}` (PESQUISA.md §6, 2ª rodada, chamadas reais). Usado para achar o IBGE do município de
// incidência quando a nota só tem o NOME (obra/tomador) e como lista padrão da consulta de parâmetros municipais na Sefin.
// Município fora da lista sem IBGE na nota → a DPS é recusada com "código IBGE do município de incidência" (nada é presumido).
export const MUNICIPIOS_CONHECIDOS = [
  { ibge: "2105302", nome: "Imperatriz", uf: "MA" },
  { ibge: "1502152", nome: "Canaã dos Carajás", uf: "PA" },
  { ibge: "1505536", nome: "Parauapebas", uf: "PA" },
  { ibge: "2109908", nome: "Santa Inês", uf: "MA" },
] as const;

const normalizar = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** IBGE pelo nome e UF (sem acento/maiúsculas). Só da lista; fora dela → null. */
export function ibgeDoMunicipio(nome: string | null | undefined, uf: string | null | undefined): string | null {
  if (!nome || !uf) return null;
  const n = normalizar(nome), u = uf.trim().toUpperCase();
  return MUNICIPIOS_CONHECIDOS.find(m => m.uf === u && normalizar(m.nome) === n)?.ibge ?? null;
}
