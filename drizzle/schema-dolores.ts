// 16/11/2026 — EPIC-025 (etapa 1): auditoria da Dolores e chave de pausa da ponte (migração 0123_dolores_acoes.sql).
// Arquivo separado de schema.ts para não colidir com outras frentes. `dolores_acoes` é só inserção (gatilho no banco).
import { boolean, foreignKey, index, integer, jsonb, pgTable, serial, smallint, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { users } from "./schema.js";

export const doloresAcoes = pgTable("dolores_acoes", {
  id: serial("id").primaryKey(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  autorUserId: integer("autor_user_id"),
  canal: varchar("canal", { length: 30 }).default("ponte").notNull(),
  etapa: smallint("etapa").default(1).notNull(),
  funcao: varchar("funcao", { length: 80 }).notNull(),
  argumentos: jsonb("argumentos"),
  resultado: varchar("resultado", { length: 12 }).$type<"ok" | "recusada" | "erro">().notNull(),
  motivo: varchar("motivo", { length: 300 }),
  resumo: jsonb("resumo"),
  duracaoMs: integer("duracao_ms"),
  pedidoId: varchar("pedido_id", { length: 120 }),
}, t => [
  // RESTRICT: a usuária Dolores com ações registradas não pode ser apagada (desativar a conta para a ponte)
  foreignKey({ name: "dolores_acoes_usuaria_nao_pode_ser_apagada", columns: [t.autorUserId], foreignColumns: [users.id] }).onDelete("restrict"),
  index("dolores_acoes_criado_em_idx").on(t.criadoEm),
  index("dolores_acoes_funcao_idx").on(t.funcao, t.criadoEm),
]);

export const doloresConfig = pgTable("dolores_config", {
  id: integer("id").primaryKey().default(1),
  pausada: boolean("pausada").default(false).notNull(),
  motivoPausa: text("motivo_pausa"),
  limitePorMinuto: integer("limite_por_minuto").default(60).notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
  atualizadoPor: integer("atualizado_por").references(() => users.id, { onDelete: "set null" }),
});

/** Contador do limite por minuto (uma linha por minuto do dia). */
export const doloresLimite = pgTable("dolores_limite", {
  minuto: smallint("minuto").primaryKey(),
  janela: timestamp("janela", { withTimezone: true }).notNull(),
  total: integer("total").default(0).notNull(),
});

export type DoloresAcao = typeof doloresAcoes.$inferSelect;
export type DoloresConfig = typeof doloresConfig.$inferSelect;
