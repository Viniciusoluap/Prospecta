// Orçamento Parametrizado — custo de obra por m² equivalente, discriminado
// por pavimento, com coeficientes de equivalência (estilo NBR 12721: um
// pavimento de garagem custa menos por m² que um pavimento tipo, por
// exemplo). Antecede o orçamento preliminar formal de uma story futura.
// Função pura, portada do Grupo Santa Fé sem alteração de lógica.

export interface ItemOrcamentoParametrizado {
  pavimento: string;
  areaM2: number;
  coeficienteEquivalencia: number; // 1.0 = padrão; 0.5 = metade do custo/m² (garagem, área externa...)
}

export interface PremissasOrcamentoParametrizado {
  itens: ItemOrcamentoParametrizado[];
  custoM2Equivalente: number;
  passivoAmbiental: number;
  decoracaoEquipamentos: number;
  projetos: number;
  previsaoInfra: number;
  outros: number;
}

export interface ResultadoOrcamentoParametrizado {
  itens: (ItemOrcamentoParametrizado & { areaEquivalenteM2: number })[];
  areaTotalM2: number;
  areaEquivalenteTotalM2: number;
  custoObraBase: number;
  custoTotal: number;
  custoM2Real: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function calcularOrcamentoParametrizado(
  p: PremissasOrcamentoParametrizado
): ResultadoOrcamentoParametrizado {
  const itens = p.itens.map((it) => ({
    ...it,
    areaEquivalenteM2: it.areaM2 * it.coeficienteEquivalencia,
  }));
  const areaTotalM2 = p.itens.reduce((s, it) => s + it.areaM2, 0);
  const areaEquivalenteTotalM2 = itens.reduce((s, it) => s + it.areaEquivalenteM2, 0);
  const custoObraBase = p.custoM2Equivalente * areaEquivalenteTotalM2;
  const custoTotal =
    custoObraBase + p.passivoAmbiental + p.decoracaoEquipamentos + p.projetos + p.previsaoInfra + p.outros;
  const custoM2Real = areaTotalM2 > 0 ? custoTotal / areaTotalM2 : 0;

  return {
    itens: itens.map((it) => ({ ...it, areaEquivalenteM2: round2(it.areaEquivalenteM2) })),
    areaTotalM2: round2(areaTotalM2),
    areaEquivalenteTotalM2: round2(areaEquivalenteTotalM2),
    custoObraBase: round2(custoObraBase),
    custoTotal: round2(custoTotal),
    custoM2Real: round2(custoM2Real),
  };
}
