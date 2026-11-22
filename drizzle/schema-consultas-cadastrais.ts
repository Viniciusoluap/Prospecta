// 22/11/2026 — EPIC-029 S-1 (cadastro automático por CNPJ e CEP): cache de 30 dias das consultas gratuitas
// (migração 0152_consultas_cadastrais_cache.sql). Tabela nova, em arquivo próprio. Quem grava e lê é server/consulta-cadastral.ts.
import { index, jsonb, pgTable, serial, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import type { FonteConsulta, TipoConsultaCadastral } from "../shared/consulta-cadastral.js";

export const consultasCadastraisCache = pgTable("consultas_cadastrais_cache", {
  id: serial("id").primaryKey(),
  tipo: varchar("tipo", { length: 10 }).$type<TipoConsultaCadastral>().notNull(),
  chave: varchar("chave", { length: 14 }).notNull(),
  resposta: jsonb("resposta").notNull(),
  fonte: varchar("fonte", { length: 10 }).$type<FonteConsulta>().default("brasilapi").notNull(),
  consultadoEm: timestamp("consultado_em", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  uniqueIndex("consultas_cadastrais_cache_tipo_chave_uq").on(t.tipo, t.chave),
  index("consultas_cadastrais_cache_consultado_em_idx").on(t.consultadoEm),
]);

export type ConsultaCadastralCache = typeof consultasCadastraisCache.$inferSelect;
