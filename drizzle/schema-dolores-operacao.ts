// 17/11/2026 — EPIC-025 (etapa 6): operação contínua — configuração, rondas, relatórios e eventos (migração
// 0131_dolores_operacao.sql). Tabelas novas, em arquivo próprio: nenhuma tabela anterior foi alterada. Rondas, relatórios e
// eventos são só inserção (gatilho no banco) e não têm chave estrangeira para "users".
import { boolean, foreignKey, index, integer, jsonb, numeric, pgTable, serial, smallint, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { users } from "./schema.js";

export const doloresOperacaoConfig = pgTable("dolores_operacao_config", {
  id: integer("id").primaryKey().default(1),
  rondasLigadas: boolean("rondas_ligadas").default(false).notNull(),
  relatorioLigado: boolean("relatorio_ligado").default(false).notNull(),
  relatorioHora: smallint("relatorio_hora").default(7).notNull(),
  eventosLigados: boolean("eventos_ligados").default(false).notNull(),
  precoEntradaMilhao: numeric("preco_entrada_milhao", { precision: 10, scale: 2 }),
  precoSaidaMilhao: numeric("preco_saida_milhao", { precision: 10, scale: 2 }),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
  atualizadoPor: integer("atualizado_por").references(() => users.id, { onDelete: "set null" }),
});
export type DoloresOperacaoConfig = typeof doloresOperacaoConfig.$inferSelect;

export type OrigemOperacao = "cron" | "tela" | "whatsapp";

export const doloresRondas = pgTable("dolores_rondas", {
  id: serial("id").primaryKey(),
  janela: varchar("janela", { length: 60 }).notNull(),
  origem: varchar("origem", { length: 12 }).$type<OrigemOperacao>().notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  duracaoMs: integer("duracao_ms"),
  totais: jsonb("totais").$type<Record<string, unknown>>().default({}).notNull(),
  destaques: jsonb("destaques").$type<Record<string, unknown>>().default({}).notNull(),
  falhas: jsonb("falhas").$type<string[]>().default([]).notNull(),
}, t => [
  uniqueIndex("dolores_rondas_janela_uidx").on(t.janela),
  index("dolores_rondas_criado_em_idx").on(t.criadoEm),
]);
export type DoloresRonda = typeof doloresRondas.$inferSelect;

export const doloresRelatorios = pgTable("dolores_relatorios", {
  id: serial("id").primaryKey(),
  janela: varchar("janela", { length: 60 }).notNull(),
  tipo: varchar("tipo", { length: 12 }).$type<"diario" | "sob_demanda">().notNull(),
  origem: varchar("origem", { length: 12 }).$type<OrigemOperacao>().notNull(),
  rondaId: integer("ronda_id").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  texto: varchar("texto", { length: 4000 }).notNull(),
  caracteres: integer("caracteres").default(0).notNull(),
  pedidoPorUserId: integer("pedido_por_user_id"),
}, t => [
  foreignKey({ name: "dolores_relatorios_ronda_fk", columns: [t.rondaId], foreignColumns: [doloresRondas.id] }).onDelete("restrict"),
  uniqueIndex("dolores_relatorios_janela_uidx").on(t.janela),
  index("dolores_relatorios_criado_em_idx").on(t.criadoEm),
]);
export type DoloresRelatorio = typeof doloresRelatorios.$inferSelect;

/** Reenvio pela tela do MESMO texto do relatório diário (envio falhou). Janela única por minuto; só inserção. */
export const doloresRelatorioReenvios = pgTable("dolores_relatorio_reenvios", {
  id: serial("id").primaryKey(),
  relatorioId: integer("relatorio_id").notNull(),
  janela: varchar("janela", { length: 60 }).notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  pedidoPorUserId: integer("pedido_por_user_id"),
}, t => [
  foreignKey({ name: "dolores_relatorio_reenvios_relatorio_fk", columns: [t.relatorioId], foreignColumns: [doloresRelatorios.id] }).onDelete("restrict"),
  uniqueIndex("dolores_relatorio_reenvios_janela_uidx").on(t.janela),
  index("dolores_relatorio_reenvios_relatorio_idx").on(t.relatorioId),
]);

export type TipoEventoDolores = "documento_grupo" | "nota_lida" | "prazo_vencido" | "pagamento_banco";

export const doloresEventos = pgTable("dolores_eventos", {
  id: serial("id").primaryKey(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  tipo: varchar("tipo", { length: 30 }).$type<TipoEventoDolores>().notNull(),
  origemTabela: varchar("origem_tabela", { length: 60 }),
  origemId: integer("origem_id"),
  chave: varchar("chave", { length: 160 }).notNull(),
  resumo: jsonb("resumo").$type<Record<string, unknown>>().default({}).notNull(),
}, t => [
  uniqueIndex("dolores_eventos_chave_uidx").on(t.chave),
  index("dolores_eventos_tipo_idx").on(t.tipo, t.criadoEm),
]);
