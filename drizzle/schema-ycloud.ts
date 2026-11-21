// 20/11/2026 — EPIC-027 (C7): integração com a YCloud (API oficial do WhatsApp) para disparos de campanha por modelo aprovado
// (migração 0141_ycloud.sql). Tabelas novas, em arquivo próprio; nenhuma tabela existente muda.
// A chave de API e o segredo do aviso de entrega ficam cifrados em dashboard_settings (server/ycloud/config.ts), nunca aqui.
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { leads, users, whatsappMessages } from "./schema.js";

export const ycloudConfig = pgTable("ycloud_config", {
  id: integer("id").primaryKey().default(1),
  ligado: boolean("ligado").default(false).notNull(),
  tetoDia: integer("teto_dia").default(200).notNull(),
  tetoCampanha: integer("teto_campanha").default(250).notNull(),
  janelaRepeticaoDias: integer("janela_repeticao_dias").default(7).notNull(),
  precoEstimado: numeric("preco_estimado", { precision: 10, scale: 4 }),
  moeda: varchar("moeda", { length: 3 }).default("USD").notNull(),
  numeroApi: varchar("numero_api", { length: 20 }),
  wabaId: varchar("waba_id", { length: 64 }),
  nomeVerificado: varchar("nome_verificado", { length: 255 }),
  statusNumero: varchar("status_numero", { length: 30 }),
  qualidade: varchar("qualidade", { length: 20 }),
  limiteTier: varchar("limite_tier", { length: 30 }),
  limiteDiario: integer("limite_diario"),
  numeroConfere: boolean("numero_confere").default(false).notNull(),
  conferidoEm: timestamp("conferido_em", { withTimezone: true }),
  webhookEndpointId: varchar("webhook_endpoint_id", { length: 80 }),
  webhookStatus: varchar("webhook_status", { length: 20 }),
  loteAte: timestamp("lote_ate", { withTimezone: true }),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
  atualizadoPor: integer("atualizado_por").references(() => users.id, { onDelete: "set null" }),
});
export type YcloudConfig = typeof ycloudConfig.$inferSelect;

export const STATUS_CAMPANHA_YCLOUD = ["enviando", "pausada", "concluida", "cancelada"] as const;
export type StatusCampanhaYcloud = (typeof STATUS_CAMPANHA_YCLOUD)[number];

export const ycloudCampanhas = pgTable("ycloud_campanhas", {
  id: serial("id").primaryKey(),
  chaveConfirmacao: varchar("chave_confirmacao", { length: 64 }).notNull(),
  nome: varchar("nome", { length: 120 }).notNull(),
  modeloNome: varchar("modelo_nome", { length: 512 }).notNull(),
  modeloIdioma: varchar("modelo_idioma", { length: 20 }).notNull(),
  modeloCategoria: varchar("modelo_categoria", { length: 30 }),
  corpo: text("corpo").notNull(),
  variaveis: jsonb("variaveis").default(sql`'{}'::jsonb`).notNull(),
  status: varchar("status", { length: 20 }).$type<StatusCampanhaYcloud>().default("enviando").notNull(),
  motivoPausa: varchar("motivo_pausa", { length: 300 }),
  total: integer("total").default(0).notNull(),
  custoEstimado: numeric("custo_estimado", { precision: 12, scale: 4 }),
  moeda: varchar("moeda", { length: 3 }),
  criadaPor: integer("criada_por").references(() => users.id, { onDelete: "set null" }),
  criadaEm: timestamp("criada_em", { withTimezone: true }).defaultNow().notNull(),
  concluidaEm: timestamp("concluida_em", { withTimezone: true }),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
}, t => ({
  chaveConfirmacaoUidx: uniqueIndex("ycloud_campanhas_chave_confirmacao_uidx").on(t.chaveConfirmacao),
  modeloIdx: index("ycloud_campanhas_modelo_idx").on(t.modeloNome, t.modeloIdioma),
  statusIdx: index("ycloud_campanhas_status_idx").on(t.status),
}));

export const STATUS_ENVIO_YCLOUD = ["na_fila", "enviando", "aceita", "enviada", "entregue", "lida", "falhou", "incerto"] as const;
export type StatusEnvioYcloud = (typeof STATUS_ENVIO_YCLOUD)[number];

export const ycloudEnvios = pgTable("ycloud_envios", {
  id: serial("id").primaryKey(),
  campanhaId: integer("campanha_id").notNull().references(() => ycloudCampanhas.id, { onDelete: "cascade" }),
  leadId: integer("lead_id").references(() => leads.id, { onDelete: "set null" }),
  telefone: varchar("telefone", { length: 20 }).notNull(),
  chaveTelefone: varchar("chave_telefone", { length: 20 }).notNull(),
  nome: varchar("nome", { length: 255 }),
  parametros: jsonb("parametros").default(sql`'{}'::jsonb`).notNull(),
  texto: text("texto").notNull(),
  externalId: varchar("external_id", { length: 80 }).notNull(),
  status: varchar("status", { length: 20 }).$type<StatusEnvioYcloud>().default("na_fila").notNull(),
  motivo: varchar("motivo", { length: 300 }),
  erroCodigo: varchar("erro_codigo", { length: 60 }),
  ycloudId: varchar("ycloud_id", { length: 80 }),
  wamid: varchar("wamid", { length: 255 }),
  preco: numeric("preco", { precision: 12, scale: 6 }),
  moeda: varchar("moeda", { length: 3 }),
  precoFinal: boolean("preco_final").default(false).notNull(),
  tentativas: integer("tentativas").default(0).notNull(),
  reservadoEm: timestamp("reservado_em", { withTimezone: true }),
  aceitoEm: timestamp("aceito_em", { withTimezone: true }),
  enviadoEm: timestamp("enviado_em", { withTimezone: true }),
  entregueEm: timestamp("entregue_em", { withTimezone: true }),
  lidoEm: timestamp("lido_em", { withTimezone: true }),
  falhouEm: timestamp("falhou_em", { withTimezone: true }),
  mensagemCentralId: integer("mensagem_central_id").references(() => whatsappMessages.id, { onDelete: "set null" }),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow().notNull(),
}, t => ({
  externalIdUidx: uniqueIndex("ycloud_envios_external_id_uidx").on(t.externalId),
  campanhaTelefoneUidx: uniqueIndex("ycloud_envios_campanha_telefone_uidx").on(t.campanhaId, t.chaveTelefone),
  chaveTelefoneIdx: index("ycloud_envios_chave_telefone_idx").on(t.chaveTelefone),
  mensagemCentralIdx: index("ycloud_envios_mensagem_central_idx").on(t.mensagemCentralId),
  ycloudIdUidx: uniqueIndex("ycloud_envios_ycloud_id_uidx").on(t.ycloudId),
  campanhaStatusIdx: index("ycloud_envios_campanha_status_idx").on(t.campanhaId, t.status),
  aceitoIdx: index("ycloud_envios_aceito_idx").on(t.aceitoEm),
}));
export type YcloudEnvio = typeof ycloudEnvios.$inferSelect;

export const ycloudEventos = pgTable("ycloud_eventos", {
  id: varchar("id", { length: 128 }).primaryKey(),
  tipo: varchar("tipo", { length: 80 }).notNull(),
  recebidoEm: timestamp("recebido_em", { withTimezone: true }).defaultNow().notNull(),
});

export const ORIGENS_OPTOUT_YCLOUD = ["painel", "whatsapp_preferencia", "ycloud_descadastro"] as const;
export type OrigemOptoutYcloud = (typeof ORIGENS_OPTOUT_YCLOUD)[number];

export const ycloudOptout = pgTable("ycloud_optout", {
  id: serial("id").primaryKey(),
  telefone: varchar("telefone", { length: 20 }).notNull(),
  chaveTelefone: varchar("chave_telefone", { length: 20 }).notNull(),
  origem: varchar("origem", { length: 30 }).$type<OrigemOptoutYcloud>().notNull(),
  leadId: integer("lead_id").references(() => leads.id, { onDelete: "set null" }),
  registradoPor: integer("registrado_por").references(() => users.id, { onDelete: "set null" }),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
}, t => ({ chaveTelefoneUidx: uniqueIndex("ycloud_optout_chave_telefone_uidx").on(t.chaveTelefone) }));

export const ycloudAuditoria = pgTable("ycloud_auditoria", {
  id: serial("id").primaryKey(),
  acao: varchar("acao", { length: 60 }).notNull(),
  usuarioId: integer("usuario_id").references(() => users.id, { onDelete: "set null" }),
  campanhaId: integer("campanha_id").references(() => ycloudCampanhas.id, { onDelete: "set null" }),
  modelo: varchar("modelo", { length: 600 }),
  quantidade: integer("quantidade"),
  detalhe: varchar("detalhe", { length: 300 }),
  criadoEm: timestamp("criado_em", { withTimezone: true }).defaultNow().notNull(),
}, t => ({ criadoIdx: index("ycloud_auditoria_criado_idx").on(t.criadoEm) }));
