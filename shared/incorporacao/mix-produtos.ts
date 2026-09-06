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
    vgv: it.quantidade * it.areaUnidadeM2 * it.precoM2,
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
