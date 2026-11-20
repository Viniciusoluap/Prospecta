// EPIC-026 C5 — valores padrão da Dolores e previsão do limite mensal em reais. Regras puras, sem banco nem rede.
// - Preços SUGERIDOS por modelo (US$ por milhão de tokens), com data e fonte: são só SUGESTÃO. A conta do gasto nunca usa
//   um preço sugerido sozinho: a tela mostra o sugerido e o admin grava com um clique ("usar o sugerido"). Só entram aqui
//   os modelos com preço confirmado; os outros ficam sem sugestão (o sistema não inventa preço).
// - Limites padrão (15.000.000 de entrada e 1.000.000 de saída por mês) e cotação sugerida (R$ 6,00), definidos pelo dono
//   em 20/11/2026.
// - Previsão do limite em reais: o que os limites (a trava, em tokens) custariam no pior caso. Não muda a trava nem a forma
//   de contar o limite: é só referência para a tela.
import { custoDoModelo, type PrecoModelo, type PrecoReserva } from "./custo.js";

export const FONTE_PRECOS_SUGERIDOS = "tabela oficial da Anthropic em 20/11/2026";
export const DATA_PRECOS_SUGERIDOS = "2026-11-20";

/** Preços sugeridos (US$ por milhão): entrada, saída, escrita de cache e leitura de cache. Só id exato do modelo. */
export const PRECOS_SUGERIDOS: Readonly<Record<string, Readonly<PrecoModelo>>> = Object.freeze({
  "claude-haiku-5-5": Object.freeze({ entrada: 0.1, saida: 0.5, cacheEscrita: 0.125, cacheLeitura: 0.01 }),
  "claude-opus-5-5": Object.freeze({ entrada: 4, saida: 20, cacheEscrita: 5, cacheLeitura: 0.2 }),
});

/** Preço sugerido de um modelo (id exato) ou null — nunca "parecido". */
export function precoSugerido(modelo: string | null | undefined): PrecoModelo | null {
  if (typeof modelo !== "string" || !Object.prototype.hasOwnProperty.call(PRECOS_SUGERIDOS, modelo)) return null;
  return { ...PRECOS_SUGERIDOS[modelo] };
}

/** Limites mensais padrão da Dolores (tokens), definidos pelo dono em 20/11/2026. */
export const LIMITES_PADRAO = Object.freeze({ entrada: 15_000_000, saida: 1_000_000 });
/** Cotação do dólar sugerida (R$ por US$), definida pelo dono em 20/11/2026. */
export const COTACAO_SUGERIDA = 6;
/** Acima de quantas vezes o teto do dono a previsão parece erro de digitação. */
export const FATOR_ABSURDO_DO_TETO = 5;

export type PrevisaoModelo = { modelo: string; reais: number | null; fonte: "tabela" | "reserva" | "sem_preco" };
export type PrevisaoDoLimite = {
  /** Pior caso: todo o limite gasto no modelo mais caro em uso (entrada sem cache, a preço cheio). */
  piorCaso: PrevisaoModelo | null;
  /** Se for só o modelo da conversa com o dono. */
  daConversa: PrevisaoModelo | null;
  porModelo: PrevisaoModelo[];
  /** Modelos em uso sem preço (nem cadastrado, nem reserva): a previsão pode estar abaixo do real. */
  semPreco: string[];
  semCotacao: boolean;
  /** Vermelho: o pior caso passa do teto do dono. */
  acimaDoTeto: boolean;
  /** Amarelo: os campos parecem trocados ou absurdos (texto simples) — null quando está tudo certo. */
  suspeita: string | null;
};

/**
 * Quanto os limites mensais custariam, em reais, com os preços CADASTRADOS (ou a reserva) — preço sugerido não entra. Conta a
 * entrada inteira a preço cheio de entrada (o limite conta o cache como entrada cheia; é o pior caso).
 */
export function previsaoDoLimite(p: {
  limites: { entrada: number; saida: number };
  modelosEmUso: readonly string[];
  modeloDaConversa: string | null;
  tabela: ReadonlyMap<string, PrecoModelo>;
  reserva: PrecoReserva;
  cotacao: number | null;
  tetoReais: number;
}): PrevisaoDoLimite {
  const entrada = Math.max(0, Number(p.limites.entrada) || 0);
  const saida = Math.max(0, Number(p.limites.saida) || 0);
  const uso = { entrada, saida, cacheEscrita: 0, cacheLeitura: 0 };
  const modelos = Array.from(new Set([...p.modelosEmUso, ...(p.modeloDaConversa ? [p.modeloDaConversa] : [])].filter(m => typeof m === "string" && m.trim())));
  const porModelo: PrevisaoModelo[] = modelos.map(m => {
    const c = custoDoModelo(m, uso, p.tabela, p.reserva, p.cotacao);
    return { modelo: m, reais: c.reais, fonte: c.fonte };
  });
  const comReais = porModelo.filter((m): m is PrevisaoModelo & { reais: number } => m.reais != null);
  const piorCaso = comReais.length ? comReais.reduce((a, b) => (b.reais > a.reais ? b : a)) : null;
  const daConversa = p.modeloDaConversa ? porModelo.find(m => m.modelo === p.modeloDaConversa) ?? null : null;
  const acimaDoTeto = piorCaso != null && piorCaso.reais > p.tetoReais;
  let suspeita: string | null = null;
  if (entrada > 0 && saida > entrada) suspeita = "O limite de saída está maior que o de entrada: os dois campos parecem trocados (o normal é a entrada ser bem maior).";
  else if (piorCaso != null && piorCaso.reais > FATOR_ABSURDO_DO_TETO * p.tetoReais) suspeita = `O pior caso passa de ${FATOR_ABSURDO_DO_TETO} vezes o teto do dono: confira se não sobrou ou faltou um zero.`;
  const semCotacao = !(typeof p.cotacao === "number" && Number.isFinite(p.cotacao) && p.cotacao > 0);
  return { piorCaso, daConversa, porModelo, semPreco: porModelo.filter(m => m.fonte === "sem_preco").map(m => m.modelo), semCotacao, acimaDoTeto, suspeita };
}

/**
 * Previsão do gasto até o fim do mês pelo ritmo atual: gasto até agora ÷ dias corridos (contando hoje) × dias do mês.
 * `mes` = "AAAA-MM", `dia` = dia de hoje (1 a 31), ambos no horário de Brasília.
 */
export function projecaoDoMes(gastoReais: number | null, mes: string, dia: number): number | null {
  if (gastoReais == null || !Number.isFinite(gastoReais) || gastoReais < 0) return null;
  const [ano, m] = mes.split("-").map(Number);
  if (!Number.isInteger(ano) || !Number.isInteger(m) || m < 1 || m > 12) return null;
  const diasNoMes = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  const d = Math.min(diasNoMes, Math.max(1, Math.trunc(dia)));
  return Math.round((gastoReais / d) * diasNoMes * 100) / 100;
}
