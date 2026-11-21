// 21/11/2026 — EPIC-027 C5 (E2): a proposta que espera o "pode"/"confirmo" do dono (migração 0145_dolores_pendencia.sql).
// Tabela nova, em arquivo próprio: nenhuma tabela anterior foi alterada. Quem grava e lê é server/dolores/pendencia.ts.
import { boolean, index, integer, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import type { NivelConfirmacao } from "../shared/dolores/confirmacao.js";
import { doloresMensagens } from "./schema-dolores-whatsapp.js";

export const SITUACOES_PENDENCIA = ["aberta", "confirmada", "recusada", "vencida", "substituida"] as const;
export type SituacaoPendencia = (typeof SITUACOES_PENDENCIA)[number];

export const doloresConversaPendencia = pgTable("dolores_conversa_pendencia", {
  id: serial("id").primaryKey(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  venceEm: timestamp("vence_em", { withTimezone: true }).notNull(),
  mensagemId: integer("mensagem_id").references(() => doloresMensagens.id, { onDelete: "set null" }),
  aprovacaoIds: integer("aprovacao_ids").array().notNull(),
  nivel: varchar("nivel", { length: 10 }).$type<NivelConfirmacao>().notNull(),
  situacao: varchar("situacao", { length: 12 }).$type<SituacaoPendencia>().default("aberta").notNull(),
  adjacente: boolean("adjacente").default(true).notNull(),
  decididaEm: timestamp("decidida_em", { withTimezone: true }),
  decididaMensagemId: integer("decidida_mensagem_id").references(() => doloresMensagens.id, { onDelete: "set null" }),
}, t => [index("dolores_conversa_pendencia_criado_em_idx").on(t.criadoEm)]);

export type DoloresConversaPendencia = typeof doloresConversaPendencia.$inferSelect;
