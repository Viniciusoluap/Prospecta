// Mix de Produtos — quantidade, área e preço/m² de cada produto do
// empreendimento (lotes, casas, apartamentos, comercial...), agregados em
// total de unidades, área vendida e VGV. Função pura, portada do trecho
// correspondente do motor de loteamento do Grupo Santa Fé
// (`lib/finance/loteamento.ts`) sem alteração de lógica — o restante desse
// arquivo (urbanístico + EVE completo) fica para a story de backlog S-13.

import { areaTerrenoItemMix } from "./ocupacao-mix.js";

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
  /** Apartamentos vendidos por unidade, agrupados em blocos no terreno. */
  apartamento?: boolean;
  apartamentosPorAndar?: number;
  andares?: number;
  /** Área total de terreno por bloco, JÁ incluindo estacionamento e circulação. */
  areaBlocoM2?: number;
  /** Vagas efetivamente previstas dentro da área de cada bloco. */
  vagasPorBloco?: number;
  /** Valor de venda por unidade (Casa pronta ou Apartamento). */
  precoUnidade?: number;
}

/** VGV de um item do mix (por unidade para casa/apartamento; por m² para os demais). */
export function vgvItemMix(it: ItemMixProduto): number {
  const qtd = Number.isFinite(it.quantidade) ? it.quantidade : 0;
  if (it.casaPronta || it.apartamento) return qtd * (Number.isFinite(it.precoUnidade) ? (it.precoUnidade as number) : 0);
  return qtd * it.areaUnidadeM2 * it.precoM2;
}

export interface ResultadoMixItem extends ItemMixProduto {
  areaTotalM2: number;
  vgv: number;
}

export interface ResultadoMix {
  itens: ResultadoMixItem[];
  totalUnidades: number;
  /** Terreno do mix: apartamentos contam a área integral de seus blocos, com estacionamento. */
  areaVendidaM2: number;
  vgv: number;
  precoMedioUnidade: number;
}

export function calcularMix(itens: ItemMixProduto[]): ResultadoMix {
  const resultado: ResultadoMixItem[] = itens.map((it) => ({
    ...it,
    areaTotalM2: areaTerrenoItemMix(it),
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
