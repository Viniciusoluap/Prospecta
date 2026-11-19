// EPIC-025 (Dolores, etapa 8) — leitura dos preços por modelo e da cotação (migração 0134) e do consumo do mês por modelo e
// função, para a ESTIMATIVA de custo (tela e relatório). Nada aqui decide se a IA roda: o limite mensal (a trava, em tokens)
// continua em consumo.ts e não muda. Sem a migração 0134, a estimativa cai na reserva (os campos antigos) e a tela avisa.
import { eq, sql } from "drizzle-orm";
import { doloresConsumo } from "../../drizzle/schema-dolores-whatsapp.js";
import { doloresCotacao, doloresPrecosModelo } from "../../drizzle/schema-dolores-operacao.js";
import { custoDoMes, type CustoDoMes, type FuncaoDoConsumo, type PrecoModelo, type PrecoReserva, type UsoDetalhado } from "../../shared/dolores/custo.js";
import { getDb } from "../db.js";
import { erroParaLog } from "./erro-seguro.js";
import { PARADA_GRUPO } from "./consumo.js";

const numero = (v: string | null | undefined) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export type PrecosCadastrados = { disponivel: boolean; tabela: Map<string, PrecoModelo>; cotacao: number | null };

/** Preços por modelo e cotação. Sem a migração 0134 (ou erro de leitura) → `disponivel: false`, tabela vazia, sem cotação. */
export async function lerPrecos(): Promise<PrecosCadastrados> {
  try {
    const db = getDb();
    const [linhas, [c]] = await Promise.all([
      db.select().from(doloresPrecosModelo),
      db.select({ cotacao: doloresCotacao.cotacaoDolar }).from(doloresCotacao).where(eq(doloresCotacao.id, 1)).limit(1),
    ]);
    const tabela = new Map<string, PrecoModelo>(linhas.map(l => [l.modelo, {
      entrada: numero(l.entradaMilhaoUsd), saida: numero(l.saidaMilhaoUsd), cacheEscrita: numero(l.cacheEscritaMilhaoUsd), cacheLeitura: numero(l.cacheLeituraMilhaoUsd),
    }]));
    return { disponivel: true, tabela, cotacao: numero(c?.cotacao ?? null) };
  } catch (e) {
    console.error("[dolores/custo] preços indisponíveis (migração 0134?)", erroParaLog(e));
    return { disponivel: false, tabela: new Map(), cotacao: null };
  }
}

/**
 * Consumo do mês agrupado por modelo e função. A função sai do que `dolores_consumo` já grava: com mensagem do dono = conversa;
 * parada "grupo…" = resposta em grupo; o resto = classificação de documentos e leitura de notas (as duas gravam igual e não dá
 * para separar uma da outra).
 */
export async function consumoDoMesDetalhado(mes: string): Promise<Array<{ modelo: string; funcao: FuncaoDoConsumo; uso: UsoDetalhado }>> {
  const funcao = sql<string>`CASE WHEN ${doloresConsumo.mensagemId} IS NOT NULL THEN 'conversa' WHEN ${doloresConsumo.parada} LIKE ${PARADA_GRUPO + "%"} THEN 'grupos' ELSE 'documentos_e_notas' END`;
  const linhas = await getDb().select({
    modelo: doloresConsumo.modelo, funcao,
    entrada: sql<number>`coalesce(sum(${doloresConsumo.tokensEntrada}), 0)`.mapWith(Number),
    saida: sql<number>`coalesce(sum(${doloresConsumo.tokensSaida}), 0)`.mapWith(Number),
    cacheEscrita: sql<number>`coalesce(sum(${doloresConsumo.tokensCacheEscrita}), 0)`.mapWith(Number),
    cacheLeitura: sql<number>`coalesce(sum(${doloresConsumo.tokensCacheLeitura}), 0)`.mapWith(Number),
  }).from(doloresConsumo).where(eq(doloresConsumo.mes, mes)).groupBy(doloresConsumo.modelo, funcao);
  return linhas.map(l => ({
    modelo: l.modelo, funcao: (["conversa", "grupos"].includes(l.funcao) ? l.funcao : "documentos_e_notas") as FuncaoDoConsumo,
    uso: { entrada: Number(l.entrada), saida: Number(l.saida), cacheEscrita: Number(l.cacheEscrita), cacheLeitura: Number(l.cacheLeitura) },
  }));
}

/** Gasto estimado do mês (tela e relatório usam a MESMA conta). */
export async function custoEstimadoDoMes(mes: string, reserva: PrecoReserva, precos?: PrecosCadastrados): Promise<CustoDoMes & { precosDisponiveis: boolean }> {
  const [linhas, p] = await Promise.all([consumoDoMesDetalhado(mes), precos ? Promise.resolve(precos) : lerPrecos()]);
  return { ...custoDoMes(linhas, p.tabela, reserva, p.cotacao), precosDisponiveis: p.disponivel };
}
