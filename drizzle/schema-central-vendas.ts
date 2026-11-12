// 12/11/2026 — Central de Vendas (migração 0110_central_vendas.sql). Arquivo separado de schema.ts para não
// colidir com outras frentes; as chaves estrangeiras existem no SQL da migração.
import { boolean, decimal, integer, pgTable, primaryKey, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const centralVendasConfig = pgTable("central_vendas_config", {
  id: integer("id").primaryKey().default(1),
  dados: text("dados").default("{}").notNull(),
  updatedBy: integer("updated_by"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const centralVendasChecklists = pgTable("central_vendas_checklists", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 60 }).notNull().unique(),
  nome: varchar("nome", { length: 120 }).notNull(),
  documentos: text("documentos").default("[]").notNull(),
  ativo: boolean("ativo").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const centralVendasProdutos = pgTable("central_vendas_produtos", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 80 }).notNull().unique(),
  nome: varchar("nome", { length: 160 }).notNull(),
  tipo: varchar("tipo", { length: 20 }).default("empreendimento").notNull(),
  descricao: text("descricao").default("").notNull(),
  cidade: varchar("cidade", { length: 100 }),
  precoMin: decimal("preco_min", { precision: 15, scale: 2 }),
  precoMax: decimal("preco_max", { precision: 15, scale: 2 }),
  requisitos: text("requisitos").default("").notNull(),
  condicoes: text("condicoes").default("").notNull(),
  checklistId: integer("checklist_id"),
  ativo: boolean("ativo").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const centralVendasCampanhas = pgTable("central_vendas_campanhas", {
  id: serial("id").primaryKey(),
  codigo: varchar("codigo", { length: 80 }).notNull().unique(),
  canal: varchar("canal", { length: 60 }).notNull(),
  nome: varchar("nome", { length: 160 }).notNull(),
  produtoId: integer("produto_id"),
  ativo: boolean("ativo").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const centralVendasContatos = pgTable("central_vendas_contatos", {
  phoneKey: varchar("phone_key", { length: 20 }).primaryKey(),
  leadId: integer("lead_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const centralVendasLeads = pgTable("central_vendas_leads", {
  leadId: integer("lead_id").primaryKey(),
  statusAtendimento: varchar("status_atendimento", { length: 30 }).default("novo").notNull(),
  statusDocumental: varchar("status_documental", { length: 30 }).default("nao_iniciado").notNull(),
  statusAnalise: varchar("status_analise", { length: 20 }).default("nao_enviado").notNull(),
  origem: varchar("origem", { length: 20 }).default("whatsapp").notNull(),
  idExterno: varchar("id_externo", { length: 160 }),
  campanha: varchar("campanha", { length: 80 }),
  produtoId: integer("produto_id"),
  checklistId: integer("checklist_id"),
  connectionId: integer("connection_id"),
  estadoCivil: varchar("estado_civil", { length: 40 }),
  qualificacao: text("qualificacao").default("{}").notNull(),
  operadorId: integer("operador_id"),
  atribuidoEm: timestamp("atribuido_em"),
  aguardandoHumanoDesde: timestamp("aguardando_humano_desde"),
  primeiraMensagemEm: timestamp("primeira_mensagem_em"),
  primeiraRespostaEm: timestamp("primeira_resposta_em"),
  primeiraRespostaHumanaEm: timestamp("primeira_resposta_humana_em"),
  ultimaMensagemClienteEm: timestamp("ultima_mensagem_cliente_em"),
  ultimaMensagemEnviadaEm: timestamp("ultima_mensagem_enviada_em"),
  qualificadoEm: timestamp("qualificado_em"),
  docsSolicitadosEm: timestamp("docs_solicitados_em"),
  docsCompletosEm: timestamp("docs_completos_em"),
  enviadoAnaliseEm: timestamp("enviado_analise_em"),
  decisaoEm: timestamp("decisao_em"),
  decisaoPor: integer("decisao_por"),
  pendenciasAnalise: text("pendencias_analise"),
  motivoTransferencia: varchar("motivo_transferencia", { length: 60 }),
  resumoTransferencia: text("resumo_transferencia"),
  semProgresso: integer("sem_progresso").default(0).notNull(),
  mensagensIa: integer("mensagens_ia").default(0).notNull(),
  tokensConsumidos: integer("tokens_consumidos").default(0).notNull(),
  optOut: boolean("opt_out").default(false).notNull(),
  optOutEm: timestamp("opt_out_em"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type CentralVendasLead = typeof centralVendasLeads.$inferSelect;

export const centralVendasDocumentos = pgTable("central_vendas_documentos", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull(),
  leadDocumentId: integer("lead_document_id").notNull().unique(),
  messageId: integer("message_id").unique(),
  chave: varchar("chave", { length: 60 }),
  confianca: decimal("confianca", { precision: 4, scale: 3 }),
  aConferir: boolean("a_conferir").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const centralVendasEventos = pgTable("central_vendas_eventos", {
  id: serial("id").primaryKey(),
  tipo: varchar("tipo", { length: 60 }).notNull(),
  leadId: integer("lead_id"),
  origem: varchar("origem", { length: 30 }).default("sistema").notNull(),
  payload: text("payload"),
  resultado: varchar("resultado", { length: 30 }).default("ok").notNull(),
  erro: text("erro"),
  chave: varchar("chave", { length: 200 }).unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const centralVendasFila = pgTable("central_vendas_fila", {
  id: serial("id").primaryKey(),
  chave: varchar("chave", { length: 200 }).notNull().unique(),
  tipo: varchar("tipo", { length: 30 }).default("mensagem").notNull(),
  leadId: integer("lead_id"),
  numero: varchar("numero", { length: 30 }),
  proativa: boolean("proativa").default(false).notNull(),
  payload: text("payload").default("{}").notNull(),
  status: varchar("status", { length: 20 }).default("pendente").notNull(),
  tentativas: integer("tentativas").default(0).notNull(),
  proximaTentativaEm: timestamp("proxima_tentativa_em").defaultNow().notNull(),
  ultimoErro: text("ultimo_erro"),
  mensagemId: integer("mensagem_id"),
  concluidoEm: timestamp("concluido_em"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type CentralVendasJob = typeof centralVendasFila.$inferSelect;

export const centralVendasSequencias = pgTable("central_vendas_sequencias", {
  id: serial("id").primaryKey(),
  tipo: varchar("tipo", { length: 30 }).notNull(),
  nome: varchar("nome", { length: 120 }).notNull(),
  passos: text("passos").default("[]").notNull(),
  ativo: boolean("ativo").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const centralVendasLimites = pgTable("central_vendas_limites", {
  chave: varchar("chave", { length: 120 }).notNull(),
  janela: timestamp("janela").notNull(),
  total: integer("total").default(0).notNull(),
}, t => ({ pk: primaryKey({ columns: [t.chave, t.janela] }) }));

export const centralVendasTokensMes = pgTable("central_vendas_tokens_mes", {
  mes: varchar("mes", { length: 7 }).primaryKey(),
  tokens: integer("tokens").default(0).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
