// EPIC-024 S-07 — filtros combinados da listagem de Incorporação (situação, nome e tipo).
// Todos valem ao mesmo tempo (E lógico); o nome ignora maiúsculas e acentos.
import { normalizarTexto } from "../obras-filtro.js";

export const TIPOS_INCORPORACAO = [
  { value: "desmembramento_simples", label: "Desmembramento Simples" },
  { value: "vertical", label: "Vertical" },
  { value: "loteamento", label: "Loteamento" },
] as const;

export type TipoIncorporacao = (typeof TIPOS_INCORPORACAO)[number]["value"];

export interface EstudoFiltravel {
  name: string | null;
  status: string | null;
  /** Inclui o legado `residencial` e estudos sem tipo (null) — só aparecem em "Todos os tipos". */
  incorporationType: string | null;
}

export interface FiltrosIncorporacao {
  /** "todos" = todas as situações. */
  status: string;
  nome: string;
  /** "todos" = todos os tipos (inclusive legado e sem tipo). */
  tipo: string;
}

export const FILTROS_INCORPORACAO_VAZIOS: FiltrosIncorporacao = { status: "todos", nome: "", tipo: "todos" };

export function filtrarEstudosIncorporacao<T extends EstudoFiltravel>(estudos: T[], f: FiltrosIncorporacao): T[] {
  const busca = normalizarTexto(f.nome);
  return estudos.filter((e) => {
    if (f.status !== "todos" && e.status !== f.status) return false;
    if (f.tipo !== "todos" && e.incorporationType !== f.tipo) return false;
    return !busca || normalizarTexto(e.name).includes(busca);
  });
}

export function filtrosIncorporacaoAtivos(f: FiltrosIncorporacao): boolean {
  return f.status !== "todos" || f.tipo !== "todos" || f.nome.trim() !== "";
}
