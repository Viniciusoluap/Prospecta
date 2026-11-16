// EPIC-025 (Dolores, etapa 3) — transação de ESCRITA das ações, separada e mínima. As leituras continuam na transação
// READ ONLY (somente-leitura.ts); uma ação direta roda aqui dentro: a gravação no sistema e a linha de autoria
// (dolores_autoria) entram juntas ou não entram. As ações pegam a conexão só por `bancoDaAcao()`; fora de uma transação
// de escrita ela LANÇA — nenhuma ação grava pela conexão comum por engano.
import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { getDb, type DrizzleDb } from "../db.js";

const atual = new AsyncLocalStorage<{ tx: DrizzleDb; limite: number | null }>();

/** A ação passou do prazo dentro da transação: ela é desfeita (nada gravado). */
export class PrazoDaAcaoEsgotado extends Error {
  constructor() { super("Ação da Dolores passou do prazo; a gravação foi desfeita."); this.name = "PrazoDaAcaoEsgotado"; }
}

/** A transação de escrita em curso. Passado o prazo dela, LANÇA: a transação é desfeita (a ação não termina tarde). */
export function bancoDaAcao(): DrizzleDb {
  const a = atual.getStore();
  if (!a) throw new Error("Ação da Dolores fora da transação de escrita.");
  if (a.limite !== null && Date.now() > a.limite) throw new PrazoDaAcaoEsgotado();
  return a.tx;
}

/** O erro é o prazo da transação (o nosso ou o `statement_timeout` do banco, código 57014)? Então ela foi desfeita. */
export function foiPrazoDaTransacao(e: unknown): boolean {
  for (let x: unknown = e, i = 0; x && i < 5; x = (x as { cause?: unknown }).cause, i++) {
    if (x instanceof PrazoDaAcaoEsgotado || (x as { code?: unknown }).code === "57014") return true;
  }
  return false;
}

/**
 * `prazoMs`: o próprio banco cancela a instrução que passar do prazo (SET LOCAL statement_timeout) — a transação desfaz
 * tudo, e a porta pode dizer a verdade ("tudo ou nada") mesmo quando o prazo dela estoura antes.
 */
export async function emTransacaoDeEscrita<T>(fn: () => Promise<T>, prazoMs?: number): Promise<T> {
  return getDb().transaction(async tx => {
    if (prazoMs && prazoMs > 0) await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${Math.max(1000, Math.floor(prazoMs))}`));
    return atual.run({ tx: tx as unknown as DrizzleDb, limite: prazoMs && prazoMs > 0 ? Date.now() + prazoMs : null }, fn);
  });
}
