// EPIC-025 (Dolores, etapa 1) — a ponte roda cada função de leitura dentro de uma transação READ ONLY: é o BANCO que
// recusa qualquer escrita, mesmo que o código mude depois. As leituras (server/dolores/leitura/) pegam a conexão só
// por `bancoDaLeitura()`, que devolve a transação em curso (AsyncLocalStorage). O teste estático da pasta é a segunda linha.
import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { getDb } from "../db.js";

type Banco = ReturnType<typeof getDb>;
const atual = new AsyncLocalStorage<Banco>();

/** Conexão das leituras: a transação somente leitura aberta pela ponte (fora dela, a conexão comum — só nos testes). */
export const bancoDaLeitura = (): Banco => atual.getStore() ?? getDb();

/**
 * `opcoes.tempoLimiteMs`: o próprio banco cancela a consulta que passar disso (SET LOCAL statement_timeout, só nesta
 * transação; erro 57014). Sem o parâmetro, vale o tempo padrão da conexão.
 */
export async function emTransacaoSomenteLeitura<T>(fn: () => Promise<T>, opcoes?: { tempoLimiteMs?: number }): Promise<T> {
  return getDb().transaction(async tx => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    const limite = opcoes?.tempoLimiteMs;
    if (limite !== undefined && Number.isFinite(limite) && limite > 0) await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(limite))}`));
    return atual.run(tx as unknown as Banco, fn);
  });
}
