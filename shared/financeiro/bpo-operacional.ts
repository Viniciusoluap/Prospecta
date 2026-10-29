import { SERVICOS_PROGRESSO } from "./progresso.js";

/**
 * Lote 3, item 12 (29/10): categorias operacionais que NÃO têm registro vinculado
 * (não existe cadastro de "imposto" ou "tarifa" para apontar). Valem para cobrança e despesa.
 * Decisão: "projetos" (cobrança) continua sendo o vínculo com um projeto cadastrado; "projetos_taxas"
 * é a classificação sem vínculo para taxas, ART/RRT, alvarás e projetos avulsos — significados distintos.
 */
export const CATEGORIAS_SEM_VINCULO = [
  "projetos_taxas", "impostos", "tarifas_bancarias", "pro_labore", "administrativo", "outros",
] as const;

export const CATEGORIAS_RECEITA_OPERACIONAL = [
  "obras", "regularizacoes", "comissoes", "projetos", "avaliacoes",
  "imoveis", "incorporacao", "financiamentos",
  ...CATEGORIAS_SEM_VINCULO,
] as const;

export const CATEGORIAS_DESPESA_OPERACIONAL = [
  "obras", "tarefas_agenda", "regularizacoes", "comissoes", "incorporacao",
  ...CATEGORIAS_SEM_VINCULO,
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
  projetos_taxas: "Projetos e taxas",
  impostos: "Impostos",
  tarifas_bancarias: "Tarifas bancárias",
  pro_labore: "Pró-labore",
  administrativo: "Administrativo",
  outros: "Outros",
};

export function categoriaSemVinculo(categoria: string | null | undefined) {
  return (CATEGORIAS_SEM_VINCULO as readonly string[]).includes(categoria ?? "");
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[\s-]+/g, "_");

/**
 * Item 12: a "Classificação contábil" saiu da tela; o campo interno `categoria` (DRE por categoria,
 * contabilidade/impostos, extrato) passa a ser derivado da Categoria Operacional por esta regra.
 * Cobrança: financiamentos → "Financiamento/CAIXA"; demais → "Recebimento de cliente" (mesmo padrão
 * do extrato para créditos). Despesa de obra: material → "Material"; mão de obra/empreiteiro →
 * "Mão de obra"; demais → "Outros". Sem regra específica → "Outros".
 */
export function categoriaContabilDaOperacional(
  tipo: "cobranca" | "despesa",
  operacional: string | null | undefined,
  tipoDespesaObra?: string | null,
): string {
  switch (operacional) {
    case "impostos": return "Impostos";
    case "tarifas_bancarias": return "Tarifas bancárias";
    case "pro_labore": return "Pró-labore";
    case "administrativo": return "Administrativo";
    case "projetos_taxas": return "Projetos e taxas";
    case "outros": return "Outros";
  }
  if (tipo === "cobranca") return operacional === "financiamentos" ? "Financiamento/CAIXA" : "Recebimento de cliente";
  if (operacional === "obras") {
    const t = semAcento(tipoDespesaObra ?? "");
    if (t === "material") return "Material";
    if (t === "mao_de_obra" || t === "empreiteiro") return "Mão de obra";
  }
  return "Outros";
}

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
  if (categoriaSemVinculo(input.categoriaOperacional)) {
    if (input.vinculoOperacionalId?.trim()) throw new Error("Esta categoria não tem registro vinculado.");
  } else if (!input.vinculoOperacionalId?.trim()) throw new Error("Selecione o registro operacional vinculado.");
  if (input.tipo === "despesa" && input.categoriaOperacional === "obras") {
    if (!(TIPOS_DESPESA_OBRA as readonly string[]).includes(input.tipoDespesaObra ?? "")) throw new Error("Selecione o tipo da despesa da obra.");
    if (input.etapaObra && !etapas.has(input.etapaObra)) throw new Error("Etapa da obra inválida.");
  } else if (input.tipoDespesaObra || input.etapaObra) {
    throw new Error("Tipo de despesa e etapa são exclusivos de Obras.");
  }
}
