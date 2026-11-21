import type { ItemMixProduto } from "./mix-produtos.js";
import { APROVEITAMENTO_VAGAS, M2_POR_VAGA } from "../maquete-3d/padrao.js";

const inteiro = (n: number) => Number.isFinite(n) && n > 0 && Number.isInteger(n) ? n : 0;

/** Ausência usa o padrão; zero digitado permanece inválido, nunca vira padrão silenciosamente. */
export function blocoApartamento(item: ItemMixProduto) {
  const apartamentosPorAndar = inteiro(item.apartamentosPorAndar ?? 6);
  const andares = inteiro(item.andares ?? 4);
  const area = item.areaBlocoM2 ?? 1000;
  const areaBlocoM2 = Number.isFinite(area) && area > 0 ? area : 0;
  const vagasPorBloco = inteiro(item.vagasPorBloco ?? 24);
  const unidadesPorBloco = apartamentosPorAndar * andares;
  const projecao = item.areaProjecaoBlocoM2 ?? apartamentosPorAndar * 50;
  const areaProjecaoBlocoM2 = Number.isFinite(projecao) && projecao > 0 ? projecao : 0;
  const valido = unidadesPorBloco > 0 && areaBlocoM2 > 0 && vagasPorBloco > 0 && areaProjecaoBlocoM2 > 0 && areaProjecaoBlocoM2 <= areaBlocoM2;
  // Mesma regra do pátio da Maquete 3D: desconta projeção, recuos/jardim/acessos e manobra.
  const areaPatioM2 = Math.max(0, areaBlocoM2 - areaProjecaoBlocoM2) * APROVEITAMENTO_VAGAS.patio;
  const vagasFisicas = Math.floor(areaPatioM2 / M2_POR_VAGA);
  const vagasUtilizaveis = Math.min(vagasPorBloco, vagasFisicas);
  const quantidade = Number.isFinite(item.quantidade) ? Math.max(0, item.quantidade) : 0;
  const blocos = valido ? Math.ceil(quantidade / unidadesPorBloco) : 0;
  return { apartamentosPorAndar, andares, areaBlocoM2, areaProjecaoBlocoM2, areaPatioM2, vagasPorBloco, vagasFisicas, vagasUtilizaveis, unidadesPorBloco,
    valido, blocos, areaTotalM2: blocos * areaBlocoM2,
    estacionamentoSuficiente: valido && vagasUtilizaveis >= unidadesPorBloco,
    capacidadePorBloco: valido ? Math.min(unidadesPorBloco, vagasUtilizaveis) : 0 };
}

/** Blocos incompletos também reservam o terreno completo, inclusive suas vagas. */
export function areaTerrenoItemMix(item: ItemMixProduto): number {
  return item.apartamento ? blocoApartamento(item).areaTotalM2 : item.quantidade * item.areaUnidadeM2;
}

/** Um bloco ocupa um lote; uma casa ou lote vendido ocupa um lote. */
export function lotesItemMix(item: ItemMixProduto): number {
  return item.apartamento ? blocoApartamento(item).blocos : Math.max(0, item.quantidade || 0);
}

/** Confere blocos/casas juntos, reservando primeiro os maiores lotes necessários. */
export function conferirTerrenoMix(itens: ItemMixProduto[], areaDisponivelM2: number, lotes?: { areaM2: number }[]) {
  const areaTotalM2 = itens.reduce((s, i) => s + areaTerrenoItemMix(i), 0);
  const lotesNecessarios = itens.reduce((s, i) => s + lotesItemMix(i), 0);
  let lotesIncompativeis = false;
  if (lotes?.length) {
    const areas = lotes.map(l => l.areaM2).sort((a, b) => b - a);
    const grupos = itens.filter(i => i.quantidade > 0).map(i => ({
      area: i.apartamento ? blocoApartamento(i).areaBlocoM2 : i.areaUnidadeM2,
      quantidade: lotesItemMix(i),
    })).sort((a, b) => b.area - a.area);
    let pos = 0;
    for (const g of grupos) {
      const ultimo = pos + Math.ceil(g.quantidade) - 1;
      if (ultimo >= areas.length || areas[ultimo] + 0.01 < g.area) lotesIncompativeis = true;
      pos = ultimo + 1;
    }
  }
  return { areaTotalM2, lotesNecessarios, lotesIncompativeis,
    excedeArea: areaTotalM2 > areaDisponivelM2 + 0.01,
    excedeLotes: !!lotes?.length && lotesNecessarios > lotes.length };
}

export function capacidadeTerrenoMix(itens: ItemMixProduto[], areaDisponivelM2: number): number {
  const ativos = itens.filter(i => i.quantidade > 0);
  if (!ativos.length) return 0;
  // Mesma tipologia vertical: conta blocos inteiros, jamais uma fração de bloco.
  if (ativos.every(i => i.apartamento)) {
    const blocos = ativos.map(blocoApartamento);
    const b = blocos[0];
    if (blocos.some(x => !x.valido)) return 0;
    if (blocos.every(x => x.areaBlocoM2 === b.areaBlocoM2 && x.capacidadePorBloco === b.capacidadePorBloco)) {
      return Math.max(0, Math.floor(areaDisponivelM2 / b.areaBlocoM2)) * b.capacidadePorBloco;
    }
  }
  if (ativos.some(i => i.apartamento)) {
    if (ativos.some(i => i.apartamento && !blocoApartamento(i).valido)) return 0;
    // Estimativa por uma implantação possível: aloca blocos inteiros por densidade,
    // depois usa a sobra com outras tipologias. Nunca fraciona um bloco vertical.
    const opcoes = ativos.map(i => i.apartamento
      ? { area: blocoApartamento(i).areaBlocoM2, unidades: blocoApartamento(i).capacidadePorBloco }
      : { area: i.areaUnidadeM2, unidades: 1 })
      .filter(i => Number.isFinite(i.area) && i.area > 0 && i.unidades > 0)
      .sort((a, b) => b.unidades / b.area - a.unidades / a.area || a.area - b.area);
    let restante = Math.max(0, areaDisponivelM2), capacidade = 0;
    for (const o of opcoes) {
      const quantidade = Math.floor(restante / o.area);
      capacidade += quantidade * o.unidades;
      restante = Math.max(0, restante - quantidade * o.area);
    }
    return capacidade;
  }
  const quantidade = ativos.reduce((s, i) => s + i.quantidade, 0);
  const area = ativos.reduce((s, i) => s + areaTerrenoItemMix(i), 0);
  return area > 0 ? Math.max(0, Math.floor(areaDisponivelM2 / (area / quantidade))) : 0;
}
