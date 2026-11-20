// 20/11/2026 — EPIC-025 (etapa 9): conexão única do WhatsApp, roteamento, saudação de campanha, atendimento a cliente cadastrado,
// avisos de ligação/áudio e transcrição (migração 0135_whatsapp_conexao_unica.sql). Tabelas novas, em arquivo próprio; a única
// mudança em tabela existente é a coluna nova `whatsapp_messages.automatica` (em schema.ts), com padrão false.
import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, primaryKey, serial, smallint, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { leads, users } from "./schema.js";

export const AVISO_LIGACAO_PADRAO = "Olá! Sou a Dolores, da Prospecta. Não atendo ligações por aqui, mas pode me escrever que a gente responde.";
export const AVISO_AUDIO_PADRAO = "Olá! Não consegui ouvir o áudio. Pode escrever a sua mensagem, por favor?";

export const whatsappAtendimentoConfig = pgTable("whatsapp_atendimento_config", {
  id: integer("id").primaryKey().default(1),
  clienteLigado: boolean("cliente_ligado").default(false).notNull(),
  clienteTetoDia: integer("cliente_teto_dia").default(10).notNull(),
  clienteTetoGlobalDia: integer("cliente_teto_global_dia").default(100).notNull(),
  silencioHoras: integer("silencio_horas").default(6).notNull(),
  saudacaoTetoDia: integer("saudacao_teto_dia").default(50).notNull(),
  transcricaoLigada: boolean("transcricao_ligada").default(false).notNull(),
  transcricaoDuracaoMaxS: integer("transcricao_duracao_max_s").default(120).notNull(),
  transcricaoTetoNumeroDia: integer("transcricao_teto_numero_dia").default(10).notNull(),
  transcricaoTetoGlobalDia: integer("transcricao_teto_global_dia").default(100).notNull(),
  avisoIntervaloHoras: integer("aviso_intervalo_horas").default(3).notNull(),
  avisoLigacao: varchar("aviso_ligacao", { length: 500 }).default(AVISO_LIGACAO_PADRAO).notNull(),
  avisoAudio: varchar("aviso_audio", { length: 500 }).default(AVISO_AUDIO_PADRAO).notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
  atualizadoPor: integer("atualizado_por").references(() => users.id, { onDelete: "set null" }),
});
export type WhatsappAtendimentoConfig = typeof whatsappAtendimentoConfig.$inferSelect;

export const whatsappCampanhas = pgTable("whatsapp_campanhas", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 120 }).notNull(),
  empreendimento: varchar("empreendimento", { length: 160 }),
  texto: varchar("texto", { length: 1000 }).notNull(),
  ativa: boolean("ativa").default(false).notNull(),
  criadoPor: integer("criado_por").references(() => users.id, { onDelete: "set null" }),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
  atualizadoPor: integer("atualizado_por").references(() => users.id, { onDelete: "set null" }),
}, t => [uniqueIndex("whatsapp_campanhas_uma_ativa").on(sql`(true)`).where(sql`${t.ativa}`)]);
export type WhatsappCampanha = typeof whatsappCampanhas.$inferSelect;

export const whatsappSaudacoes = pgTable("whatsapp_saudacoes", {
  id: serial("id").primaryKey(),
  campanhaId: integer("campanha_id").notNull().references(() => whatsappCampanhas.id, { onDelete: "cascade" }),
  chaveNumero: varchar("chave_numero", { length: 32 }).notNull(),
  remetente: varchar("remetente", { length: 30 }),
  situacao: varchar("situacao", { length: 12 }).$type<"enviando" | "enviada" | "erro">().default("enviando").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  enviadaEm: timestamp("enviada_em", { withTimezone: true }),
}, t => [uniqueIndex("whatsapp_saudacoes_uma_por_numero").on(t.campanhaId, t.chaveNumero)]);

export const whatsappAvisosNumero = pgTable("whatsapp_avisos_numero", {
  chaveNumero: varchar("chave_numero", { length: 32 }).notNull(),
  tipo: varchar("tipo", { length: 10 }).$type<"ligacao" | "audio">().notNull(),
  ultimoEm: timestamp("ultimo_em", { withTimezone: true }).defaultNow().notNull(),
  total: integer("total").default(1).notNull(),
}, t => [primaryKey({ columns: [t.chaveNumero, t.tipo] })]);

export const whatsappSilencio = pgTable("whatsapp_silencio", {
  chaveNumero: varchar("chave_numero", { length: 32 }).primaryKey(),
  ate: timestamp("ate", { withTimezone: true }).notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
});

export const whatsappRoteamentoVistos = pgTable("whatsapp_roteamento_vistos", {
  instancia: varchar("instancia", { length: 80 }).notNull(),
  externalId: varchar("external_id", { length: 160 }).notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
}, t => [primaryKey({ columns: [t.instancia, t.externalId] }), index("whatsapp_roteamento_vistos_criado_idx").on(t.criadoEm)]);

export const whatsappAtendimentoContagem = pgTable("whatsapp_atendimento_contagem", {
  chave: varchar("chave", { length: 80 }).primaryKey(),
  total: integer("total").default(0).notNull(),
  primeiraEm: timestamp("primeira_em", { withTimezone: true }).defaultNow().notNull(),
  ultimaEm: timestamp("ultima_em", { withTimezone: true }).defaultNow().notNull(),
});

export const SITUACOES_ATENDIMENTO = ["processando", "respondida", "fora_de_escopo", "silencio", "erro"] as const;
export type SituacaoAtendimento = (typeof SITUACOES_ATENDIMENTO)[number];

export const doloresAtendimentos = pgTable("dolores_atendimentos", {
  id: serial("id").primaryKey(),
  instancia: varchar("instancia", { length: 80 }).notNull(),
  externalId: varchar("external_id", { length: 160 }).notNull(),
  chaveNumero: varchar("chave_numero", { length: 32 }).notNull(),
  remetente: varchar("remetente", { length: 30 }),
  leadId: integer("lead_id").references(() => leads.id, { onDelete: "set null" }),
  origem: varchar("origem", { length: 8 }).$type<"texto" | "audio">().default("texto").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  enviadaEm: timestamp("enviada_em", { withTimezone: true }),
  pergunta: varchar("pergunta", { length: 500 }),
  situacao: varchar("situacao", { length: 16 }).$type<SituacaoAtendimento>().default("processando").notNull(),
  motivo: varchar("motivo", { length: 200 }),
  resposta: varchar("resposta", { length: 800 }),
  respondidaEm: timestamp("respondida_em", { withTimezone: true }),
  voltas: smallint("voltas").default(0).notNull(),
  tokensEntrada: integer("tokens_entrada").default(0).notNull(),
  tokensSaida: integer("tokens_saida").default(0).notNull(),
  reservaEntrada: integer("reserva_entrada").default(0).notNull(),
  reservaSaida: integer("reserva_saida").default(0).notNull(),
  reservaAte: timestamp("reserva_ate", { withTimezone: true }),
}, t => [
  uniqueIndex("dolores_atendimentos_externa_uidx").on(t.instancia, t.externalId),
  uniqueIndex("dolores_atendimentos_um_por_numero").on(t.chaveNumero).where(sql`${t.situacao} = 'processando'`),
  index("dolores_atendimentos_reserva_idx").on(t.reservaAte).where(sql`${t.reservaAte} IS NOT NULL`),
  index("dolores_atendimentos_criado_idx").on(t.criadoEm),
]);
export type DoloresAtendimento = typeof doloresAtendimentos.$inferSelect;
