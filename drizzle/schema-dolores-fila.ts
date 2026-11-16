// 16/11/2026 — EPIC-025 (etapa 3): fila de aprovação, autoria e validade da fila (migração 0125_dolores_fila.sql).
// Tabelas novas, em arquivo próprio: nenhuma tabela anterior (nem as da Dolores) foi alterada.
import { index, integer, jsonb, pgTable, serial, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import type { SituacaoItem } from "../shared/dolores/fila.js";
import { users } from "./schema.js";

export const doloresAprovacoes = pgTable("dolores_aprovacoes", {
  id: serial("id").primaryKey(),
  codigo: varchar("codigo", { length: 8 }).notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  venceEm: timestamp("vence_em", { withTimezone: true }).notNull(),
  mensagemId: integer("mensagem_id"),
  pedidoId: varchar("pedido_id", { length: 120 }),
  autorUserId: integer("autor_user_id").references(() => users.id, { onDelete: "restrict" }),
  funcao: varchar("funcao", { length: 80 }).notNull(),
  alvo: varchar("alvo", { length: 80 }).notNull(),
  argumentos: jsonb("argumentos").notNull(),
  resumo: varchar("resumo", { length: 600 }).notNull(),
  situacao: varchar("situacao", { length: 12 }).$type<SituacaoItem>().default("aguardando").notNull(),
  decididoEm: timestamp("decidido_em", { withTimezone: true }),
  decididoVia: varchar("decidido_via", { length: 12 }).$type<"whatsapp" | "tela" | "sistema">(),
  decididoPorUserId: integer("decidido_por_user_id").references(() => users.id, { onDelete: "set null" }),
  motivo: varchar("motivo", { length: 300 }),
  executadoEm: timestamp("executado_em", { withTimezone: true }),
  resultado: jsonb("resultado"),
}, t => [
  uniqueIndex("dolores_aprovacoes_codigo_unico").on(t.codigo),
  index("dolores_aprovacoes_situacao_idx").on(t.situacao, t.criadoEm),
  index("dolores_aprovacoes_mensagem_idx").on(t.mensagemId),
]);

export const doloresAutoria = pgTable("dolores_autoria", {
  id: serial("id").primaryKey(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  autorUserId: integer("autor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  tabela: varchar("tabela", { length: 60 }).notNull(),
  registroId: integer("registro_id").notNull(),
  funcao: varchar("funcao", { length: 80 }).notNull(),
  mensagemId: integer("mensagem_id"),
  pedidoId: varchar("pedido_id", { length: 120 }),
  aprovacaoId: integer("aprovacao_id").references(() => doloresAprovacoes.id, { onDelete: "restrict" }),
  descricao: varchar("descricao", { length: 300 }),
}, t => [
  index("dolores_autoria_registro_idx").on(t.tabela, t.registroId),
  index("dolores_autoria_mensagem_idx").on(t.mensagemId),
]);

export const doloresFilaConfig = pgTable("dolores_fila_config", {
  id: integer("id").primaryKey().default(1),
  validadeHoras: integer("validade_horas").default(48).notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
  atualizadoPor: integer("atualizado_por").references(() => users.id, { onDelete: "set null" }),
});

export type DoloresAprovacao = typeof doloresAprovacoes.$inferSelect;
