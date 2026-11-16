// 16/11/2026 — EPIC-025 (etapa 2): WhatsApp da Dolores e consumo da IA (migração 0124_dolores_whatsapp.sql).
// Tabelas novas, em arquivo próprio: nada de `dolores_config` (etapa 1) foi alterado.
import { boolean, index, integer, pgTable, serial, smallint, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { users } from "./schema.js";

export const doloresWhatsappConfig = pgTable("dolores_whatsapp_config", {
  id: integer("id").primaryKey().default(1),
  iaLigada: boolean("ia_ligada").default(false).notNull(),
  modelo: varchar("modelo", { length: 120 }),
  instancia: varchar("instancia", { length: 80 }),
  statusConexao: varchar("status_conexao", { length: 20 }).default("desconectado").notNull(),
  numeroDolores: varchar("numero_dolores", { length: 20 }),
  numeroDono: varchar("numero_dono", { length: 20 }),
  limiteMensalTokensEntrada: integer("limite_mensal_tokens_entrada").default(0).notNull(),
  limiteMensalTokensSaida: integer("limite_mensal_tokens_saida").default(0).notNull(),
  avisoLimiteMes: varchar("aviso_limite_mes", { length: 7 }),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
  atualizadoPor: integer("atualizado_por").references(() => users.id, { onDelete: "set null" }),
});

export type SituacaoMensagem = "recebida" | "ignorada" | "processando" | "respondida" | "bloqueada" | "erro";

export const doloresMensagens = pgTable("dolores_mensagens", {
  id: serial("id").primaryKey(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  instancia: varchar("instancia", { length: 80 }).notNull(),
  externalId: varchar("external_id", { length: 160 }).notNull(),
  remetente: varchar("remetente", { length: 30 }),
  doDono: boolean("do_dono").default(false).notNull(),
  situacao: varchar("situacao", { length: 20 }).$type<SituacaoMensagem>().default("recebida").notNull(),
  motivo: varchar("motivo", { length: 300 }),
  texto: varchar("texto", { length: 2000 }),
  enviadaEm: timestamp("enviada_em", { withTimezone: true }),
  respondidaEm: timestamp("respondida_em", { withTimezone: true }),
  voltas: smallint("voltas").default(0).notNull(),
  tokensEntrada: integer("tokens_entrada").default(0).notNull(),
  tokensSaida: integer("tokens_saida").default(0).notNull(),
  /** Reserva do limite mensal da chamada ao modelo em andamento (vence em `reservaAte`). */
  reservaEntrada: integer("reserva_entrada").default(0).notNull(),
  reservaSaida: integer("reserva_saida").default(0).notNull(),
  reservaAte: timestamp("reserva_ate", { withTimezone: true }),
}, t => [
  uniqueIndex("dolores_mensagens_externa_uidx").on(t.instancia, t.externalId),
  index("dolores_mensagens_criado_em_idx").on(t.criadoEm),
]);

export const doloresConsumo = pgTable("dolores_consumo", {
  id: serial("id").primaryKey(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  mes: varchar("mes", { length: 7 }).notNull(),
  mensagemId: integer("mensagem_id").references(() => doloresMensagens.id, { onDelete: "set null" }),
  modelo: varchar("modelo", { length: 120 }).notNull(),
  volta: smallint("volta").notNull(),
  tokensEntrada: integer("tokens_entrada").default(0).notNull(),
  tokensSaida: integer("tokens_saida").default(0).notNull(),
  tokensCacheEscrita: integer("tokens_cache_escrita").default(0).notNull(),
  tokensCacheLeitura: integer("tokens_cache_leitura").default(0).notNull(),
  parada: varchar("parada", { length: 30 }),
}, t => [index("dolores_consumo_mes_idx").on(t.mes)]);

export type DoloresWhatsappConfig = typeof doloresWhatsappConfig.$inferSelect;
