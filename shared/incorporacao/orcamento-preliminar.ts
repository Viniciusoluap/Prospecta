// Orçamento Preliminar — orçamento de obra detalhado por categoria,
// reconciliado com o custo total já calculado no Orçamento Parametrizado.
// Função pura, portada do Grupo Santa Fé sem alteração de lógica.

export const CATEGORIAS_ORCAMENTO_PRELIMINAR = [
  "Fundação",
  "Estrutura",
  "Alvenaria/Vedação",
  "Cobertura",
  "Instalações Elétricas",
  "Instalações Hidrossanitárias",
  "Esquadrias",
  "Revestimentos",
  "Pintura",
  "Paisagismo/Áreas externas",
  "Administração da obra",
  "Projetos complementares",
  "Outros",
] as const;
export type CategoriaOrcamentoPreliminar = (typeof CATEGORIAS_ORCAMENTO_PRELIMINAR)[number];

export interface ItemOrcamentoPreliminar {
  id: string;
  categoria: CategoriaOrcamentoPreliminar;
  valorOrcado: number;
  observacoes?: string;
}

export interface ResumoOrcamentoPreliminar {
  totalOrcado: number;
  custoParametrizadoReferencia: number | null;
  variacaoPct: number | null; // (totalOrcado - referência) / referência × 100
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function resumoOrcamentoPreliminar(
  itens: ItemOrcamentoPreliminar[],
  custoParametrizadoReferencia?: number | null
): ResumoOrcamentoPreliminar {
  const totalOrcado = round2(itens.reduce((s, i) => s + i.valorOrcado, 0));
  const referencia = custoParametrizadoReferencia && custoParametrizadoReferencia > 0 ? custoParametrizadoReferencia : null;
  return {
    totalOrcado,
    custoParametrizadoReferencia: referencia,
    variacaoPct: referencia ? round1(((totalOrcado - referencia) / referencia) * 100) : null,
  };
}

/** Lê o JSON salvo e diz se o orçamento preliminar já tem itens com valor lançado. */
export function orcamentoPreliminarPreenchidoDoJson(json: string | null | undefined): boolean {
  if (!json) return false;
  try {
    const dados = JSON.parse(json) as { itens?: ItemOrcamentoPreliminar[] };
    return Array.isArray(dados.itens) && dados.itens.some((i) => i.valorOrcado > 0);
  } catch {
    return false;
  }
}
