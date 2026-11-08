// Mix de Produtos — quantidade, área e preço/m² de cada produto do
// empreendimento (lotes, casas, apartamentos, comercial...), agregados em
// total de unidades, área vendida e VGV. Função pura, portada do trecho
// correspondente do motor de loteamento do Grupo Santa Fé
// (`lib/finance/loteamento.ts`) sem alteração de lógica — o restante desse
// arquivo (urbanístico + EVE completo) fica para a story de backlog S-13.

export interface ItemMixProduto {
  nome: string;
  quantidade: number;
  areaUnidadeM2: number;
  precoM2: number;
  /**
   * Correção 12 — "CASA PRONTA": o produto é vendido por UNIDADE (casa + lote), não por m².
   * Marcado → VGV = quantidade × precoUnidade. Desmarcado → VGV = quantidade × área × preço/m²
   * (cálculo original). `areaUnidadeM2`/`precoM2` são preservados ao alternar; a área continua
   * sendo a do LOTE (base do custo de infraestrutura), nunca a área construída.
   */
  casaPronta?: boolean;
  /** Valor de venda por unidade (só usado quando `casaPronta`). */
  precoUnidade?: number;
}

/** VGV de um item do mix (por unidade quando Casa Pronta; por m² caso contrário). */
export function vgvItemMix(it: ItemMixProduto): number {
  const qtd = Number.isFinite(it.quantidade) ? it.quantidade : 0;
  if (it.casaPronta) return qtd * (Number.isFinite(it.precoUnidade) ? (it.precoUnidade as number) : 0);
  return qtd * it.areaUnidadeM2 * it.precoM2;
}

export interface ResultadoMixItem extends ItemMixProduto {
  areaTotalM2: number;
  vgv: number;
}

export interface ResultadoMix {
  itens: ResultadoMixItem[];
  totalUnidades: number;
  areaVendidaM2: number;
  vgv: number;
  precoMedioUnidade: number;
}

export function calcularMix(itens: ItemMixProduto[]): ResultadoMix {
  const resultado: ResultadoMixItem[] = itens.map((it) => ({
    ...it,
    areaTotalM2: it.quantidade * it.areaUnidadeM2,
    vgv: vgvItemMix(it),
  }));
  const totalUnidades = resultado.reduce((s, i) => s + i.quantidade, 0);
  const areaVendidaM2 = resultado.reduce((s, i) => s + i.areaTotalM2, 0);
  const vgvTotal = resultado.reduce((s, i) => s + i.vgv, 0);
  const precoMedioUnidade = totalUnidades > 0 ? vgvTotal / totalUnidades : 0;
  return { itens: resultado, totalUnidades, areaVendidaM2, vgv: vgvTotal, precoMedioUnidade };
}

/** Lê o JSON salvo e diz se o mix já tem ao menos um item com quantidade. */
export function mixProdutosPreenchidoDoJson(json: string | null | undefined): boolean {
  if (!json) return false;
  try {
    const itens = JSON.parse(json) as ItemMixProduto[];
    return Array.isArray(itens) && itens.some((i) => i.quantidade > 0);
  } catch {
    return false;
  }
}
