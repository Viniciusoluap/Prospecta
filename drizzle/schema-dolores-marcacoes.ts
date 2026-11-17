// 17/11/2026 — EPIC-025 (etapa 4b): a Dolores responde no grupo quando é marcada — configuração, interruptor por grupo, registro
// de cada marcação e contadores (migração 0129_dolores_marcacoes.sql). Tabelas novas, em arquivo próprio: nenhuma tabela
// anterior foi alterada.
import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, serial, smallint, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { doloresGrupos } from "./schema-dolores-grupos.js";
import { users } from "./schema.js";

export const doloresMarcacoesConfig = pgTable("dolores_marcacoes_config", {
  id: integer("id").primaryKey().default(1),
  responderLigado: boolean("responder_ligado").default(false).notNull(),
  tetoGrupoDia: integer("teto_grupo_dia").default(20).notNull(),
  tetoRemetenteHora: integer("teto_remetente_hora").default(5).notNull(),
  janelaFrescorSegundos: integer("janela_frescor_segundos").default(120).notNull(),
  lidDolores: varchar("lid_dolores", { length: 40 }),
  lidDoNumero: varchar("lid_do_numero", { length: 20 }),
  lidConferidoEm: timestamp("lid_conferido_em", { withTimezone: true }),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
  atualizadoPor: integer("atualizado_por").references(() => users.id, { onDelete: "set null" }),
});

export const doloresMarcacoesGrupo = pgTable("dolores_marcacoes_grupo", {
  grupoId: integer("grupo_id").primaryKey().references(() => doloresGrupos.id, { onDelete: "restrict" }),
  responderLigado: boolean("responder_ligado").default(false).notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
  atualizadoPor: integer("atualizado_por").references(() => users.id, { onDelete: "set null" }),
});

export const SITUACOES_MARCACAO = ["processando", "respondida", "fora_de_escopo", "silencio", "erro"] as const;
export type SituacaoMarcacao = (typeof SITUACOES_MARCACAO)[number];

export const doloresMarcacoes = pgTable("dolores_marcacoes", {
  id: serial("id").primaryKey(),
  grupoId: integer("grupo_id").notNull().references(() => doloresGrupos.id, { onDelete: "restrict" }),
  instancia: varchar("instancia", { length: 80 }).notNull(),
  externalId: varchar("external_id", { length: 160 }).notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  enviadaEm: timestamp("enviada_em", { withTimezone: true }),
  remetente: varchar("remetente", { length: 30 }),
  pergunta: varchar("pergunta", { length: 500 }),
  situacao: varchar("situacao", { length: 16 }).$type<SituacaoMarcacao>().default("processando").notNull(),
  motivo: varchar("motivo", { length: 200 }),
  foraDeEscopo: boolean("fora_de_escopo").default(false).notNull(),
  resposta: varchar("resposta", { length: 800 }),
  respondidaEm: timestamp("respondida_em", { withTimezone: true }),
  voltas: smallint("voltas").default(0).notNull(),
  tokensEntrada: integer("tokens_entrada").default(0).notNull(),
  tokensSaida: integer("tokens_saida").default(0).notNull(),
  reservaEntrada: integer("reserva_entrada").default(0).notNull(),
  reservaSaida: integer("reserva_saida").default(0).notNull(),
  reservaAte: timestamp("reserva_ate", { withTimezone: true }),
}, t => [
  uniqueIndex("dolores_marcacoes_externa_uidx").on(t.instancia, t.externalId),
  uniqueIndex("dolores_marcacoes_uma_por_grupo").on(t.grupoId).where(sql`${t.situacao} = 'processando'`),
  index("dolores_marcacoes_grupo_idx").on(t.grupoId, t.criadoEm),
  index("dolores_marcacoes_reserva_idx").on(t.reservaAte).where(sql`${t.reservaAte} IS NOT NULL`),
]);

export const doloresMarcacoesContagem = pgTable("dolores_marcacoes_contagem", {
  chave: varchar("chave", { length: 80 }).primaryKey(),
  total: integer("total").default(0).notNull(),
  primeiraEm: timestamp("primeira_em", { withTimezone: true }).defaultNow().notNull(),
  ultimaEm: timestamp("ultima_em", { withTimezone: true }).defaultNow().notNull(),
});

export type DoloresMarcacoesConfig = typeof doloresMarcacoesConfig.$inferSelect;
export type DoloresMarcacao = typeof doloresMarcacoes.$inferSelect;
