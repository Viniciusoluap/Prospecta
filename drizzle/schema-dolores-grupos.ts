// 16/11/2026 — EPIC-025 (etapa 4): grupos de WhatsApp cadastrados, mensagens desses grupos, contagens diárias e configuração
// da classificação (migração 0126_dolores_grupos.sql). Tabelas novas, em arquivo próprio: nenhuma tabela anterior foi alterada.
import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, numeric, pgTable, primaryKey, serial, smallint, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import type { SituacaoDocumentoGrupo, TipoDocumentoGrupo, TipoMensagemGrupo } from "../shared/dolores/grupos.js";
import type { OrigemGrupo, SituacaoConfirmacao, TipoGrupo } from "../shared/dolores/grupos-tipo.js";
import { constructionProjects, leadDocuments, leads, users } from "./schema.js";

export const doloresGrupos = pgTable("dolores_grupos", {
  id: serial("id").primaryKey(),
  instancia: varchar("instancia", { length: 80 }).notNull(),
  grupoJid: varchar("grupo_jid", { length: 80 }).notNull(),
  nome: varchar("nome", { length: 120 }).notNull(),
  leadId: integer("lead_id").references(() => leads.id, { onDelete: "set null" }),
  obraId: integer("obra_id").references(() => constructionProjects.id, { onDelete: "set null" }),
  ativo: boolean("ativo").default(true).notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  criadoPorUserId: integer("criado_por_user_id").references(() => users.id, { onDelete: "set null" }),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
  atualizadoPorUserId: integer("atualizado_por_user_id").references(() => users.id, { onDelete: "set null" }),
  // Etapa 7 (migração 0133): grupo automático, por tipo. "tipo" vazio = grupo anterior à etapa 7 (ver tipoEfetivo).
  tipo: varchar("tipo", { length: 20 }).$type<TipoGrupo>(),
  origem: varchar("origem", { length: 12 }).$type<OrigemGrupo>().default("manual").notNull(),
  situacaoConfirmacao: varchar("situacao_confirmacao", { length: 16 }).$type<SituacaoConfirmacao>().default("confirmado").notNull(),
  /** Nome do grupo no WhatsApp visto na ENTRADA (texto de terceiro, filtrado). Não muda depois (gatilho). */
  nomeWhatsapp: varchar("nome_whatsapp", { length: 120 }),
  /** Código curto do comando do dono "grupo <código> <tipo> [nº]". Não muda depois (gatilho). */
  codigo: varchar("codigo", { length: 8 }),
  /** Decisão do dono sobre tipo/vínculo (o gatilho só deixa tipo e vínculo mudarem com este campo mudando junto). */
  decididoEm: timestamp("decidido_em", { withTimezone: true }),
  decididoPor: varchar("decidido_por", { length: 40 }),
}, t => [
  uniqueIndex("dolores_grupos_jid_unico").on(t.instancia, t.grupoJid),
  index("dolores_grupos_lead_idx").on(t.leadId),
  uniqueIndex("dolores_grupos_codigo_unico").on(t.codigo).where(sql`${t.codigo} IS NOT NULL`),
  index("dolores_grupos_aguardando_idx").on(t.situacaoConfirmacao).where(sql`${t.situacaoConfirmacao} = 'aguardando_dono'`),
]);

export const doloresGrupoMensagens = pgTable("dolores_grupo_mensagens", {
  id: serial("id").primaryKey(),
  grupoId: integer("grupo_id").notNull().references(() => doloresGrupos.id, { onDelete: "restrict" }),
  instancia: varchar("instancia", { length: 80 }).notNull(),
  externalId: varchar("external_id", { length: 160 }).notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  enviadaEm: timestamp("enviada_em", { withTimezone: true }),
  remetente: varchar("remetente", { length: 30 }),
  doDono: boolean("do_dono").default(false).notNull(),
  encaminhada: boolean("encaminhada").default(false).notNull(),
  tipo: varchar("tipo", { length: 12 }).$type<TipoMensagemGrupo>().notNull(),
  texto: varchar("texto", { length: 2000 }),
  midiaMime: varchar("midia_mime", { length: 120 }),
  midiaNome: varchar("midia_nome", { length: 160 }),
  midiaTamanho: integer("midia_tamanho"),
  situacao: varchar("situacao", { length: 16 }).$type<SituacaoDocumentoGrupo>().default("sem_documento").notNull(),
  classificacao: varchar("classificacao", { length: 30 }).$type<TipoDocumentoGrupo>(),
  confianca: numeric("confianca", { precision: 4, scale: 3 }),
  motivo: varchar("motivo", { length: 200 }),
  classificadoEm: timestamp("classificado_em", { withTimezone: true }),
  modelo: varchar("modelo", { length: 120 }),
  tentativas: smallint("tentativas").default(0).notNull(),
  reservaEntrada: integer("reserva_entrada").default(0).notNull(),
  reservaSaida: integer("reserva_saida").default(0).notNull(),
  reservaAte: timestamp("reserva_ate", { withTimezone: true }),
  leadDocumentId: integer("lead_document_id").references(() => leadDocuments.id, { onDelete: "set null" }),
  salvoEm: timestamp("salvo_em", { withTimezone: true }),
}, t => [
  uniqueIndex("dolores_grupo_mensagens_externa_uidx").on(t.instancia, t.externalId),
  index("dolores_grupo_mensagens_grupo_idx").on(t.grupoId, t.criadoEm),
  index("dolores_grupo_mensagens_pendentes_idx").on(t.situacao, t.criadoEm).where(sql`${t.situacao} IN ('a_classificar', 'classificando', 'confira', 'classificado')`),
  index("dolores_grupo_mensagens_reserva_idx").on(t.reservaAte).where(sql`${t.reservaAte} IS NOT NULL`),
]);

export const doloresGruposContagem = pgTable("dolores_grupos_contagem", {
  grupoId: integer("grupo_id").notNull(),
  dia: varchar("dia", { length: 10 }).notNull(),
  mensagens: integer("mensagens").default(0).notNull(),
  ignoradas: integer("ignoradas").default(0).notNull(),
  classificacoes: integer("classificacoes").default(0).notNull(),
  /** Linha do GRUPO: tokens de entrada usados ACIMA da reserva no dia; > 0 pausa a classificação desse grupo até o dia seguinte. */
  excessoEntrada: integer("excesso_entrada").default(0).notNull(),
  ultimaEm: timestamp("ultima_em", { withTimezone: true }).defaultNow().notNull(),
}, t => [primaryKey({ columns: [t.grupoId, t.dia] })]);

export const doloresGruposConfig = pgTable("dolores_grupos_config", {
  id: integer("id").primaryKey().default(1),
  classificacaoLigada: boolean("classificacao_ligada").default(false).notNull(),
  tetoClassificacoesDia: integer("teto_classificacoes_dia").default(30).notNull(),
  tetoClassificacoesGrupoDia: integer("teto_classificacoes_grupo_dia").default(10).notNull(),
  maxMensagensGrupoDia: integer("max_mensagens_grupo_dia").default(300).notNull(),
  tamanhoMaximoBytes: integer("tamanho_maximo_bytes").default(10_485_760).notNull(),
  retencaoDias: integer("retencao_dias").default(30).notNull(),
  /** Orçamento próprio da classificação: % do limite mensal (uso real da classificação + reservas). QA E4 r2, N0. */
  orcamentoClassificacaoPct: integer("orcamento_classificacao_pct").default(20).notNull(),
  /** Etapa 7 (0133): entrada automática de grupos (nasce LIGADA; nada fala com o interruptor geral da resposta desligado). */
  entradaAutomaticaLigada: boolean("entrada_automatica_ligada").default(true).notNull(),
  tetoGruposNovosDia: integer("teto_grupos_novos_dia").default(20).notNull(),
  tetoAvisosGruposDia: integer("teto_avisos_grupos_dia").default(25).notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
  atualizadoPor: integer("atualizado_por").references(() => users.id, { onDelete: "set null" }),
});

/** Consumo da classificação por mês (AAAA-MM), base do orçamento próprio da classificação (QA E4 r2, N0). */
export const doloresGruposConsumoMes = pgTable("dolores_grupos_consumo_mes", {
  mes: varchar("mes", { length: 7 }).primaryKey(),
  tokensEntrada: bigint("tokens_entrada", { mode: "number" }).default(0).notNull(),
  tokensSaida: bigint("tokens_saida", { mode: "number" }).default(0).notNull(),
  chamadas: integer("chamadas").default(0).notNull(),
  ultimaEm: timestamp("ultima_em", { withTimezone: true }).defaultNow().notNull(),
});

export type DoloresGrupo = typeof doloresGrupos.$inferSelect;
export type DoloresGrupoMensagem = typeof doloresGrupoMensagens.$inferSelect;
export type DoloresGruposConfig = typeof doloresGruposConfig.$inferSelect;
