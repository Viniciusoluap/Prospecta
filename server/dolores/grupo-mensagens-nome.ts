// EPIC-027 C2 — o nome do participante (pushName) das mensagens de grupo, coluna "dolores_grupo_mensagens.nome_remetente" (0142).
// Portão de QA (achado 2): a coluna fica fora da definição principal da tabela (drizzle/schema-dolores-grupos.ts) para o código
// funcionar com o banco antes ou depois da migração. Aqui: gravar (uma vez, logo depois do registro) e ler, tolerando a coluna
// ausente (42703) — sem ela, a mensagem continua registrada e a Central mostra o número mascarado.
import { and, eq, inArray, isNull } from "drizzle-orm";
import { pgTable, serial, varchar } from "drizzle-orm/pg-core";
import { getDb } from "../db.js";
import { ehColunaInexistente } from "./erro-de-banco.js";
import { erroParaLog } from "./erro-seguro.js";

/** Visão só das duas colunas (não é tabela nova; não entra no drizzle.config). */
const nomes = pgTable("dolores_grupo_mensagens", {
  id: serial("id").primaryKey(),
  nomeRemetente: varchar("nome_remetente", { length: 80 }),
});

/** Preenche o nome (de vazio para o valor; a guarda da 0142 não deixa trocar depois). Nunca lança. */
export async function gravarNomeDoRemetente(mensagemId: number, nome: string | null): Promise<boolean> {
  if (!nome) return false;
  try {
    const r = await getDb().update(nomes).set({ nomeRemetente: nome }).where(and(eq(nomes.id, mensagemId), isNull(nomes.nomeRemetente))).returning({ id: nomes.id });
    return r.length === 1;
  } catch (e) {
    if (!ehColunaInexistente(e)) console.error("[dolores/grupo-mensagens-nome] não consegui gravar o nome do participante", erroParaLog(e));
    return false;
  }
}

/** Nomes das mensagens pedidas (id → nome). Coluna ausente → vazio (a Central mostra o número mascarado). */
export async function nomesDosRemetentes(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  try {
    const rows = await getDb().select().from(nomes).where(inArray(nomes.id, ids));
    return new Map(rows.filter(r => r.nomeRemetente).map(r => [r.id, r.nomeRemetente as string]));
  } catch (e) {
    if (!ehColunaInexistente(e)) throw e;
    return new Map();
  }
}
