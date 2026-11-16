// EPIC-025 (Dolores, etapa 3) — transação de ESCRITA das ações, separada e mínima. As leituras continuam na transação
// READ ONLY (somente-leitura.ts); uma ação direta roda aqui dentro: a gravação no sistema e a linha de autoria
// (dolores_autoria) entram juntas ou não entram. As ações pegam a conexão só por `bancoDaAcao()`; fora de uma transação
// de escrita ela LANÇA — nenhuma ação grava pela conexão comum por engano.
import { AsyncLocalStorage } from "node:async_hooks";
import { getDb, type DrizzleDb } from "../db.js";

const atual = new AsyncLocalStorage<DrizzleDb>();

export function bancoDaAcao(): DrizzleDb {
  const tx = atual.getStore();
  if (!tx) throw new Error("Ação da Dolores fora da transação de escrita.");
  return tx;
}

export async function emTransacaoDeEscrita<T>(fn: () => Promise<T>): Promise<T> {
  return getDb().transaction(async tx => atual.run(tx as unknown as DrizzleDb, fn));
}
