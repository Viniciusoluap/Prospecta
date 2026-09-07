// Business Plan e Investidores — simulação de captação com fundos/
// investidores: capital aportado, remuneração (mensal ou anual) e prazo de
// resgate, comparando o custo da captação com o investimento total do
// empreendimento. Função pura, portada do Grupo Santa Fé sem alteração de
// lógica.
//
// Adaptação deliberada (mesma da S-05/negociação): no Santa Fé o
// investimento total vem automaticamente da aba de Viabilidade Econômica,
// que ainda não existe no Prospecta — por isso `calcularBusinessPlan`
// recebe o investimento total como parâmetro explícito (opcional), e a UI
// desta story pede esse valor manualmente.

export type PeriodoRemuneracao = "mensal" | "anual";

export interface FonteCaptacao {
  id: string;
  nome: string;
  capitalAportado: number;
  remuneracaoPct: number; // % ao período definido abaixo
  periodoRemuneracao: PeriodoRemuneracao;
  prazoResgateMeses: number;
}

export interface ResultadoFonteCaptacao extends FonteCaptacao {
  taxaMensalEquivalentePct: number;
  valorResgate: number; // capital + juros compostos até o resgate
  custoTotal: number; // valorResgate - capitalAportado
}

export interface ResultadoBusinessPlan {
  fontes: ResultadoFonteCaptacao[];
  capitalTotalCaptado: number;
  custoTotalCaptacao: number;
  custoMedioPonderadoMensalPct: number;
  pctDoInvestimentoTotal: number | null;
  capitalProprioNecessario: number | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Converte a taxa de remuneração (mensal ou anual) para sua equivalente mensal composta. */
export function taxaMensalEquivalente(remuneracaoPct: number, periodo: PeriodoRemuneracao): number {
  const taxa = remuneracaoPct / 100;
  return periodo === "mensal" ? taxa : Math.pow(1 + taxa, 1 / 12) - 1;
}

export function calcularFonteCaptacao(f: FonteCaptacao): ResultadoFonteCaptacao {
  const taxaMensal = taxaMensalEquivalente(f.remuneracaoPct, f.periodoRemuneracao);
  const valorResgate = f.capitalAportado * Math.pow(1 + taxaMensal, Math.max(0, f.prazoResgateMeses));
  return {
    ...f,
    taxaMensalEquivalentePct: round2(taxaMensal * 100),
    valorResgate: round2(valorResgate),
    custoTotal: round2(valorResgate - f.capitalAportado),
  };
}

export function calcularBusinessPlan(
  fontes: FonteCaptacao[],
  investimentoTotal?: number | null
): ResultadoBusinessPlan {
  const resultadoFontes = fontes.map(calcularFonteCaptacao);
  const capitalTotalCaptado = round2(resultadoFontes.reduce((s, f) => s + f.capitalAportado, 0));
  const custoTotalCaptacao = round2(resultadoFontes.reduce((s, f) => s + f.custoTotal, 0));
  const custoMedioPonderadoMensalPct = capitalTotalCaptado > 0
    ? round2(resultadoFontes.reduce((s, f) => s + f.taxaMensalEquivalentePct * f.capitalAportado, 0) / capitalTotalCaptado)
    : 0;
  const investimento = investimentoTotal && investimentoTotal > 0 ? investimentoTotal : null;
  return {
    fontes: resultadoFontes,
    capitalTotalCaptado,
    custoTotalCaptacao,
    custoMedioPonderadoMensalPct,
    pctDoInvestimentoTotal: investimento ? round2((capitalTotalCaptado / investimento) * 100) : null,
    capitalProprioNecessario: investimento ? round2(investimento - capitalTotalCaptado) : null,
  };
}

/** Lê o JSON salvo e diz se já existe alguma fonte de captação definida — usado no progresso automático. */
export function businessPlanPreenchidoDoJson(json: string | null | undefined): boolean {
  if (!json) return false;
  try {
    const dados = JSON.parse(json) as { fontes?: FonteCaptacao[] };
    return Array.isArray(dados.fontes) && dados.fontes.some((f) => f.capitalAportado > 0);
  } catch {
    return false;
  }
}
