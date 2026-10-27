import { SERVICOS_PROGRESSO } from "./progresso.js";

export const CATEGORIAS_RECEITA_OPERACIONAL = [
  "obras", "regularizacoes", "comissoes", "projetos", "avaliacoes",
  "imoveis", "incorporacao", "financiamentos",
] as const;

export const CATEGORIAS_DESPESA_OPERACIONAL = [
  "obras", "tarefas_agenda", "regularizacoes", "comissoes", "incorporacao",
] as const;

export const TIPOS_DESPESA_OBRA = [
  "empreiteiro", "terreno", "comissao", "fornecedor", "outros", "mao_de_obra", "material",
] as const;

export type CategoriaOperacional =
  | (typeof CATEGORIAS_RECEITA_OPERACIONAL)[number]
  | (typeof CATEGORIAS_DESPESA_OPERACIONAL)[number];

export const ROTULOS_CATEGORIA_OPERACIONAL: Record<CategoriaOperacional, string> = {
  obras: "Obras",
  tarefas_agenda: "Tarefas e Agenda",
  regularizacoes: "Regularizações",
  comissoes: "Comissões",
  projetos: "Projetos",
  avaliacoes: "Avaliações",
  imoveis: "Imóveis",
  incorporacao: "Incorporação",
  financiamentos: "Financiamentos",
};

const etapas = new Set(SERVICOS_PROGRESSO.map((servico) => servico.chave));

export function categoriaOperacionalValida(tipo: "cobranca" | "despesa", categoria: string) {
  const permitidas = tipo === "cobranca" ? CATEGORIAS_RECEITA_OPERACIONAL : CATEGORIAS_DESPESA_OPERACIONAL;
  return (permitidas as readonly string[]).includes(categoria);
}

export function catalogoDaCategoria(tipo: "cobranca" | "despesa", categoria: string) {
  return tipo === "despesa" && categoria === "comissoes" ? "imoveis" : categoria;
}

export function validarDetalhesOperacionais(input: {
  tipo: "cobranca" | "despesa";
  categoriaOperacional: string;
  vinculoOperacionalId?: string | null;
  tipoDespesaObra?: string | null;
  etapaObra?: string | null;
}) {
  if (!categoriaOperacionalValida(input.tipo, input.categoriaOperacional)) throw new Error("Categoria operacional inválida.");
  if (!input.vinculoOperacionalId?.trim()) throw new Error("Selecione o registro operacional vinculado.");
  if (input.tipo === "despesa" && input.categoriaOperacional === "obras") {
    if (!(TIPOS_DESPESA_OBRA as readonly string[]).includes(input.tipoDespesaObra ?? "")) throw new Error("Selecione o tipo da despesa da obra.");
    if (input.etapaObra && !etapas.has(input.etapaObra)) throw new Error("Etapa da obra inválida.");
  } else if (input.tipoDespesaObra || input.etapaObra) {
    throw new Error("Tipo de despesa e etapa são exclusivos de Obras.");
  }
}
