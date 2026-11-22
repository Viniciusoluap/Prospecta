// 22/11/2026 — EPIC-027 C5-E4: avisos da Dolores ao dono (migração 0150_dolores_avisos.sql). Tabelas novas, em arquivo próprio:
// nenhuma tabela anterior foi alterada. Quem grava e lê é server/dolores/avisos.ts (e a tela, por server/dolores/avisos-router.ts).
import { boolean, index, integer, jsonb, pgTable, serial, smallint, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import type { DadosAchado, TipoAviso } from "../shared/dolores/avisos.js";
import { users } from "./schema.js";

export const doloresAvisosConfig = pgTable("dolores_avisos_config", {
  id: integer("id").primaryKey().default(1),
  ligado: boolean("ligado").default(false).notNull(),
  iaNoTexto: boolean("ia_no_texto").default(false).notNull(),
  maxPorDia: smallint("max_por_dia").default(6).notNull(),
  intervaloMinutos: smallint("intervalo_minutos").default(60).notNull(),
  reavisoDias: smallint("reaviso_dias").default(7).notNull(),
  obraAtrasoDias: smallint("obra_atraso_dias").default(3).notNull(),
  tarefaVencidaDias: smallint("tarefa_vencida_dias").default(2).notNull(),
  documentoPendenteDias: smallint("documento_pendente_dias").default(7).notNull(),
  notaConfirmacaoDias: smallint("nota_confirmacao_dias").default(3).notNull(),
  regularizacaoParadaDias: smallint("regularizacao_parada_dias").default(15).notNull(),
  grupoAguardandoHoras: smallint("grupo_aguardando_horas").default(24).notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
  atualizadoPor: integer("atualizado_por").references(() => users.id, { onDelete: "set null" }),
});
export type DoloresAvisosConfig = typeof doloresAvisosConfig.$inferSelect;

export const doloresAvisosTipos = pgTable("dolores_avisos_tipos", {
  tipo: varchar("tipo", { length: 30 }).$type<TipoAviso>().primaryKey(),
  silenciado: boolean("silenciado").default(false).notNull(),
  via: varchar("via", { length: 10 }).$type<"tela" | "whatsapp">().default("tela").notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
  atualizadoPor: integer("atualizado_por").references(() => users.id, { onDelete: "set null" }),
});

export const doloresAvisosAchados = pgTable("dolores_avisos_achados", {
  id: serial("id").primaryKey(),
  chave: varchar("chave", { length: 120 }).notNull(),
  tipo: varchar("tipo", { length: 30 }).$type<TipoAviso>().notNull(),
  faixa: integer("faixa").default(0).notNull(),
  dados: jsonb("dados").$type<DadosAchado>().default({ nome: "" }).notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  vistoEm: timestamp("visto_em", { withTimezone: true }).defaultNow().notNull(),
  resolvidoEm: timestamp("resolvido_em", { withTimezone: true }),
  faixaAvisada: integer("faixa_avisada"),
  avisadoEm: timestamp("avisado_em", { withTimezone: true }),
  envioId: integer("envio_id"),
}, t => [
  uniqueIndex("dolores_avisos_achados_chave_uidx").on(t.chave),
  index("dolores_avisos_achados_tipo_idx").on(t.tipo, t.resolvidoEm),
]);

export const doloresAvisosEnvios = pgTable("dolores_avisos_envios", {
  id: serial("id").primaryKey(),
  dia: varchar("dia", { length: 10 }).notNull(),
  ordem: smallint("ordem").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  situacao: varchar("situacao", { length: 10 }).$type<"enviando" | "enviado" | "falhou">().default("enviando").notNull(),
  texto: varchar("texto", { length: 4000 }),
  tipos: jsonb("tipos").$type<Partial<Record<TipoAviso, number>>>().default({}).notNull(),
  itens: smallint("itens").default(0).notNull(),
  comIa: boolean("com_ia").default(false).notNull(),
  motivo: varchar("motivo", { length: 200 }),
  terminadoEm: timestamp("terminado_em", { withTimezone: true }),
}, t => [
  uniqueIndex("dolores_avisos_envios_dia_ordem_uidx").on(t.dia, t.ordem),
  index("dolores_avisos_envios_criado_em_idx").on(t.criadoEm),
]);
export type DoloresAvisoEnvio = typeof doloresAvisosEnvios.$inferSelect;
