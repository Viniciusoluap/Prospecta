// 21/11/2026 — EPIC-027 C5 (E1): memória curta da conversa direta do dono com a Dolores (migração 0143_dolores_conversa.sql).
// Tabela nova, em arquivo próprio: nenhuma tabela anterior foi alterada. Quem grava e lê é server/dolores/memoria.ts.
import { index, integer, jsonb, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import { doloresMensagens } from "./schema-dolores-whatsapp.js";

export const PAPEIS_CONVERSA = ["dono", "dolores", "sistema"] as const;
export type PapelConversa = (typeof PAPEIS_CONVERSA)[number];
export const ORIGENS_CONVERSA = ["mensagem", "encaminhada", "com_midia", "resposta", "aviso"] as const;
export type OrigemConversa = (typeof ORIGENS_CONVERSA)[number];

/** Entidade citada por uma consulta do sistema (id conferido no banco pela própria consulta; rótulo curto e limpo). */
export type ReferenciaConversa = { tipo: "cliente" | "grupo" | "obra" | "processo" | "tarefa" | "nota" | "financiamento"; id: number; rotulo: string };

export const doloresConversa = pgTable("dolores_conversa", {
  id: serial("id").primaryKey(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  papel: varchar("papel", { length: 10 }).$type<PapelConversa>().notNull(),
  origem: varchar("origem", { length: 12 }).$type<OrigemConversa>().notNull(),
  mensagemId: integer("mensagem_id").references(() => doloresMensagens.id, { onDelete: "set null" }),
  funcao: varchar("funcao", { length: 40 }),
  texto: varchar("texto", { length: 4000 }).notNull(),
  referencias: jsonb("referencias").$type<ReferenciaConversa[]>().default([]).notNull(),
}, t => [index("dolores_conversa_criado_em_idx").on(t.criadoEm)]);
