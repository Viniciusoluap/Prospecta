// 23/11/2026 — EPIC-025 E10: a Dolores cobra o colaborador e pede documentos ao cliente (migração 0169_dolores_cobrancas.sql).
// Tabelas novas, em arquivo próprio: nenhuma tabela anterior foi alterada. Quem grava e lê é server/dolores/cobrancas-automaticas.ts
// (e a tela, por server/dolores/cobrancas-router.ts).
import { boolean, index, integer, pgTable, serial, smallint, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { leads, users } from "./schema.js";

export const doloresCobrancasConfig = pgTable("dolores_cobrancas_config", {
  id: integer("id").primaryKey().default(1),
  colaboradorLigado: boolean("colaborador_ligado").default(false).notNull(),
  documentosLigado: boolean("documentos_ligado").default(false).notNull(),
  colaboradorTetoDia: smallint("colaborador_teto_dia").default(30).notNull(),
  documentosTetoDia: smallint("documentos_teto_dia").default(30).notNull(),
  maxItens: smallint("max_itens").default(10).notNull(),
  documentosIntervaloDias: smallint("documentos_intervalo_dias").default(3).notNull(),
  respostasTetoDia: smallint("respostas_teto_dia").default(5).notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
  atualizadoPor: integer("atualizado_por").references(() => users.id, { onDelete: "set null" }),
});
export type DoloresCobrancasConfig = typeof doloresCobrancasConfig.$inferSelect;

export type SituacaoCobranca = "enviando" | "enviada" | "falhou" | "sem_confirmacao" | "sem_telefone";

export const doloresCobrancasColaborador = pgTable("dolores_cobrancas_colaborador", {
  id: serial("id").primaryKey(),
  dia: varchar("dia", { length: 10 }).notNull(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  situacao: varchar("situacao", { length: 16 }).$type<SituacaoCobranca>().default("enviando").notNull(),
  itens: smallint("itens").default(0).notNull(),
  listados: smallint("listados").default(0).notNull(),
  texto: varchar("texto", { length: 2000 }),
  motivo: varchar("motivo", { length: 200 }),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  terminadoEm: timestamp("terminado_em", { withTimezone: true }),
}, t => [
  uniqueIndex("dolores_cobrancas_colaborador_dia_user_uidx").on(t.dia, t.userId),
  index("dolores_cobrancas_colaborador_criado_em_idx").on(t.criadoEm),
]);

export const doloresPedidosDocumentosVaga = pgTable("dolores_pedidos_documentos_vaga", {
  leadId: integer("lead_id").primaryKey().references(() => leads.id, { onDelete: "cascade" }),
  ultimoEm: timestamp("ultimo_em", { withTimezone: true }).notNull(),
  total: integer("total").default(1).notNull(),
});

export const doloresPedidosDocumentos = pgTable("dolores_pedidos_documentos", {
  id: serial("id").primaryKey(),
  dia: varchar("dia", { length: 10 }).notNull(),
  leadId: integer("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  situacao: varchar("situacao", { length: 16 }).$type<Exclude<SituacaoCobranca, "sem_telefone">>().default("enviando").notNull(),
  documentos: smallint("documentos").default(0).notNull(),
  texto: varchar("texto", { length: 2000 }),
  motivo: varchar("motivo", { length: 200 }),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  terminadoEm: timestamp("terminado_em", { withTimezone: true }),
}, t => [
  uniqueIndex("dolores_pedidos_documentos_dia_lead_uidx").on(t.dia, t.leadId),
  index("dolores_pedidos_documentos_criado_em_idx").on(t.criadoEm),
]);

export const doloresCobrancasRespostas = pgTable("dolores_cobrancas_respostas", {
  id: serial("id").primaryKey(),
  cobrancaId: integer("cobranca_id").references(() => doloresCobrancasColaborador.id, { onDelete: "set null" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  dia: varchar("dia", { length: 10 }).notNull(),
  externalId: varchar("external_id", { length: 160 }).notNull(),
  texto: varchar("texto", { length: 1000 }),
  encaminhada: boolean("encaminhada").default(false).notNull(),
  motivo: varchar("motivo", { length: 200 }),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
}, t => [uniqueIndex("dolores_cobrancas_respostas_external_uidx").on(t.externalId)]);

export const doloresCobrancasResumos = pgTable("dolores_cobrancas_resumos", {
  id: serial("id").primaryKey(),
  dia: varchar("dia", { length: 10 }).notNull(),
  situacao: varchar("situacao", { length: 10 }).$type<"enviando" | "enviado" | "falhou">().default("enviando").notNull(),
  texto: varchar("texto", { length: 4000 }),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
}, t => [uniqueIndex("dolores_cobrancas_resumos_dia_uidx").on(t.dia)]);
