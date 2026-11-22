// 22/11/2026 — EPIC-027 C5 (criadora de mesas): propostas de função nova que o DONO pediu à Dolores (migração 0151_dolores_mesas.sql).
// Tabelas novas, em arquivo próprio. Quem grava e lê é server/dolores/mesas.ts (e as ações propor/revisar/aprovar/recusar_mesa, a leitura
// listar_mesas e a tela, que passam por ele). Versões imutáveis; sem exclusão (gatilhos da 0151).
import { index, integer, jsonb, pgTable, serial, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { users } from "./schema.js";
import { doloresMensagens } from "./schema-dolores-whatsapp.js";
import type { PropostaMesa, SituacaoMesa } from "../shared/dolores/mesas.js";

export const doloresMesasPropostas = pgTable("dolores_mesas_propostas", {
  id: serial("id").primaryKey(),
  titulo: varchar("titulo", { length: 80 }).notNull(),
  pedidoOriginal: varchar("pedido_original", { length: 600 }).default("").notNull(),
  situacao: varchar("situacao", { length: 20 }).$type<SituacaoMesa>().default("rascunho").notNull(),
  versaoAtual: integer("versao_atual").default(1).notNull(),
  origem: varchar("origem", { length: 10 }).$type<"conversa" | "semente">().notNull(),
  chaveSemente: varchar("chave_semente", { length: 40 }),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
  autorUserId: integer("autor_user_id").references(() => users.id, { onDelete: "set null" }),
  atualizadoPor: integer("atualizado_por").references(() => users.id, { onDelete: "set null" }),
  mensagemId: integer("mensagem_id").references(() => doloresMensagens.id, { onDelete: "set null" }),
  aprovadaEm: timestamp("aprovada_em", { withTimezone: true }),
  aprovadaVersao: integer("aprovada_versao"),
  aprovadaMensagemId: integer("aprovada_mensagem_id").references(() => doloresMensagens.id, { onDelete: "set null" }),
  encerradaEm: timestamp("encerrada_em", { withTimezone: true }),
}, t => [index("dolores_mesas_situacao_idx").on(t.situacao, t.atualizadoEm)]);

export const doloresMesasVersoes = pgTable("dolores_mesas_versoes", {
  id: serial("id").primaryKey(),
  mesaId: integer("mesa_id").notNull().references(() => doloresMesasPropostas.id, { onDelete: "restrict" }),
  versao: integer("versao").notNull(),
  proposta: jsonb("proposta").$type<PropostaMesa>().notNull(),
  origem: varchar("origem", { length: 10 }).$type<"conversa" | "semente">().notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  autorUserId: integer("autor_user_id"),
  mensagemId: integer("mensagem_id"),
}, t => [unique("dolores_mesas_versoes_uma_por_numero").on(t.mesaId, t.versao)]);

export type DoloresMesa = typeof doloresMesasPropostas.$inferSelect;
export type DoloresMesaVersao = typeof doloresMesasVersoes.$inferSelect;
