// 21/11/2026 — EPIC-027 C5 (memória de longo prazo): fatos e preferências permanentes que o DONO pediu para a Dolores lembrar
// (migração 0149_dolores_memoria_longa.sql). Tabela nova, em arquivo próprio. Quem grava e lê é server/dolores/memoria-longa.ts
// (e as ações guardar/corrigir/esquecer_memoria e a tela, que passam por ele).
import { index, integer, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import { constructionProjects, leads, users } from "./schema.js";
import { doloresMensagens } from "./schema-dolores-whatsapp.js";
import type { CategoriaMemoria, OrigemMemoria, SituacaoMemoria } from "../shared/dolores/memoria-longa.js";

export const doloresMemoriaLonga = pgTable("dolores_memoria_longa", {
  id: serial("id").primaryKey(),
  texto: varchar("texto", { length: 300 }).notNull(),
  categoria: varchar("categoria", { length: 20 }).$type<CategoriaMemoria>().notNull(),
  leadId: integer("lead_id").references(() => leads.id, { onDelete: "set null" }),
  obraId: integer("obra_id").references(() => constructionProjects.id, { onDelete: "set null" }),
  origem: varchar("origem", { length: 10 }).$type<OrigemMemoria>().notNull(),
  situacao: varchar("situacao", { length: 10 }).$type<SituacaoMemoria>().default("ativa").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
  autorUserId: integer("autor_user_id").references(() => users.id, { onDelete: "set null" }),
  atualizadoPor: integer("atualizado_por").references(() => users.id, { onDelete: "set null" }),
  arquivadoEm: timestamp("arquivado_em", { withTimezone: true }),
  mensagemId: integer("mensagem_id").references(() => doloresMensagens.id, { onDelete: "set null" }),
}, t => [index("dolores_memoria_longa_situacao_idx").on(t.situacao, t.atualizadoEm)]);

export type DoloresMemoriaLonga = typeof doloresMemoriaLonga.$inferSelect;
