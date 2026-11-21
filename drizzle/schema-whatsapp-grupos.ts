// 21/11/2026 — EPIC-027 C2: grupos do WhatsApp na Central (migração 0142_grupos_na_central.sql). Tabelas novas, em arquivo próprio;
// a única mudança em tabela existente é a coluna nova, anulável, `dolores_grupo_mensagens.nome_remetente` (em schema-dolores-grupos.ts).
import { index, integer, pgTable, serial, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { doloresGrupos } from "./schema-dolores-grupos.js";
import { users } from "./schema.js";

/**
 * O que a EQUIPE escreveu no grupo pela Central (sai pelo número da empresa). Guarda quem enviou (id e o nome daquele momento, para
 * a conversa mostrar "equipe — Fulano" mesmo se o usuário for removido) e o id da mensagem na Evolution (o eco não duplica).
 */
export const whatsappGrupoEnvios = pgTable("whatsapp_grupo_envios", {
  id: serial("id").primaryKey(),
  grupoId: integer("grupo_id").notNull().references(() => doloresGrupos.id, { onDelete: "restrict" }),
  instancia: varchar("instancia", { length: 80 }).notNull(),
  externalId: varchar("external_id", { length: 160 }),
  texto: varchar("texto", { length: 4096 }).notNull(),
  situacao: varchar("situacao", { length: 8 }).$type<"enviada" | "falhou">().notNull(),
  enviadoPor: integer("enviado_por").references(() => users.id, { onDelete: "set null" }),
  enviadoPorNome: varchar("enviado_por_nome", { length: 120 }),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  index("whatsapp_grupo_envios_grupo_idx").on(t.grupoId, t.criadoEm),
  uniqueIndex("whatsapp_grupo_envios_externa_uidx").on(t.instancia, t.externalId).where(sql`${t.externalId} IS NOT NULL`),
]);
export type WhatsappGrupoEnvio = typeof whatsappGrupoEnvios.$inferSelect;

/**
 * "Assumir (humano)" / "Devolver para a Dolores" por GRUPO. "humano" = a Dolores não responde no grupo nem quando é marcada, até
 * alguém devolver; "dolores" = devolvido (volta a valer o interruptor do grupo e o geral, que esta tabela nunca liga). Sem linha =
 * regra de sempre.
 */
export const whatsappGrupoAtendimento = pgTable("whatsapp_grupo_atendimento", {
  grupoId: integer("grupo_id").primaryKey().references(() => doloresGrupos.id, { onDelete: "restrict" }),
  modo: varchar("modo", { length: 8 }).$type<"humano" | "dolores">().notNull(),
  alteradoEm: timestamp("alterado_em", { withTimezone: true }).defaultNow().notNull(),
  alteradoPor: integer("alterado_por").references(() => users.id, { onDelete: "set null" }),
});
