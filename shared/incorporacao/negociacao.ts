// Negociação do Terreno — registro e acompanhamento das propostas trocadas
// com o proprietário/terreneiro até o fechamento (compra à vista/parcelada
// ou permuta física/financeira). Função pura, portada do Grupo Santa Fé sem
// alteração de lógica.
//
// Adaptação deliberada (ver story S-05): no Santa Fé, o valor da permuta
// financeira é estimado a partir do VGV bruto calculado automaticamente na
// aba de Viabilidade Econômica — módulo que ainda não existe no Prospecta.
// Por isso `resumoNegociacao`/`valorEstimadoProposta` recebem `vgvGross`
// como parâmetro explícito em vez de o calcularem internamente; a UI desta
// story pede esse valor manualmente enquanto a Viabilidade não existe.

export type TipoProposta =
  | "compra_avista"
  | "compra_parcelada"
  | "permuta_fisica"
  | "permuta_financeira"
  | "misto";

export type StatusProposta = "enviada" | "em_analise" | "contraproposta" | "aceita" | "recusada";

export interface Proposta {
  id: string;
  data: string; // ISO yyyy-mm-dd
  autor: "grupo" | "proprietario";
  tipo: TipoProposta;
  valorTotal?: number;
  entradaPct?: number;
  prazoParcelamentoMeses?: number;
  permutaPctVgv?: number;
  unidadesPermuta?: number;
  condicoes?: string;
  status: StatusProposta;
}

export interface DadosNegociacao {
  proprietarioNome: string;
  proprietarioContato: string;
  vgvGrossManual: number;
  propostas: Proposta[];
}

export interface ResumoNegociacao {
  totalPropostas: number;
  propostaAtual: Proposta | null;
  fechada: boolean;
  valorEstimadoAtual: number;
}

export function valorEstimadoProposta(p: Proposta, vgvGross: number): number {
  switch (p.tipo) {
    case "permuta_financeira":
      return vgvGross > 0 && p.permutaPctVgv ? vgvGross * (p.permutaPctVgv / 100) : 0;
    case "compra_avista":
    case "compra_parcelada":
    case "permuta_fisica":
    case "misto":
      return p.valorTotal ?? 0;
    default:
      return 0;
  }
}

export function resumoNegociacao(dados: DadosNegociacao, vgvGross = 0): ResumoNegociacao {
  const propostas = [...dados.propostas].sort((a, b) => a.data.localeCompare(b.data));
  const propostaAtual = propostas.length > 0 ? propostas[propostas.length - 1] : null;
  const fechada = propostas.some((p) => p.status === "aceita");
  return {
    totalPropostas: propostas.length,
    propostaAtual,
    fechada,
    valorEstimadoAtual: propostaAtual ? valorEstimadoProposta(propostaAtual, vgvGross) : 0,
  };
}

export function negociacaoFechadaDoJson(json: string | null | undefined): boolean {
  if (!json) return false;
  try {
    const dados = JSON.parse(json) as Partial<DadosNegociacao>;
    return Array.isArray(dados.propostas) && dados.propostas.some((p) => p.status === "aceita");
  } catch {
    return false;
  }
}
