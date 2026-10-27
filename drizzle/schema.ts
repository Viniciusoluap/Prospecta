import {
  pgTable,
  pgEnum,
  text,
  varchar,
  integer,
  serial,
  boolean,
  timestamp,
  decimal,
  uniqueIndex,
  date,
  jsonb,
  primaryKey,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ──────────────────────────────────────────
// ENUMS
// ──────────────────────────────────────────
export const userRoleEnum = pgEnum("user_role", [
  "user",
  "admin",
  "corretor",
  "colaborador",
  "cliente",
  "empreiteiro",
]);
export const drawStatusEnum = pgEnum("draw_status", [
  "active",
  "closed",
  "drawn",
]);
export const ticketPaymentStatusEnum = pgEnum("ticket_payment_status", [
  "pending",
  "confirmed",
  "failed",
  "chargeback",
]);
export const utefTransactionTypeEnum = pgEnum("utef_transaction_type", [
  "prize",
  "conversion",
  "adjustment",
  "purchase",
  "chargeback",
]);
export const paymentOrderPurposeEnum = pgEnum("payment_order_purpose", [
  "ticket_purchase",
  "utef_purchase",
]);
export const paymentOrderStatusEnum = pgEnum("payment_order_status", [
  "pending",
  "settled",
  "refunded",
  "chargeback",
  "review_required",
  "failed",
]);
export const productCategoryEnum = pgEnum("product_category", [
  "real_estate",
  "financial",
  "nautical",
]);
export const productStatusEnum = pgEnum("product_status", [
  "available",
  "unavailable",
]);
export const productConversionStatusEnum = pgEnum("product_conversion_status", [
  "pending",
  "completed",
  "cancelled",
]);
export const constructionProjectStatusEnum = pgEnum(
  "construction_project_status",
  [
    "planning",
    "alvara",
    "art",
    "assinatura_cef",
    "vistoria_cef",
    "laudo_ok",
    "cartorio",
    "in_progress",
    "casa_pronta",
    "disponivel",
    "reavaliar",
    "distrato",
    "paused",
    "completed",
    "cancelled",
    "aprovacao",
    "contrato_prospecta",
    "laudo_cef",
    "conformidade_cef",
  ]
);
export const constructionStageStatusEnum = pgEnum("construction_stage_status", [
  "pending",
  "in_progress",
  "completed",
]);
export const budgetRequestHasLotEnum = pgEnum("budget_request_has_lot", [
  "yes",
  "no",
  "not_sure",
]);
export const budgetRequestStatusEnum = pgEnum("budget_request_status", [
  "pending",
  "contacted",
  "in_negotiation",
  "converted",
  "cancelled",
]);
export const emailTemplateTypeEnum = pgEnum("email_template_type", [
  "welcome",
  "budget_confirmation",
  "budget_update",
  "draw_winner",
  "promotional_campaign",
  "payment_confirmation",
  "admin_notification",
  "primeiro_acesso",
]);
export const emailStatusEnum = pgEnum("email_status", [
  "pending",
  "sent",
  "failed",
]);
export const notificationTypeEnum = pgEnum("notification_type", [
  "draw_result",
  "utef_update",
  "construction_update",
  "system",
  "promotional",
]);
export const obraMeasurementStatusEnum = pgEnum("obra_measurement_status", [
  "pending",
  "approved",
  "paid",
]);
export const leadTypeEnum = pgEnum("lead_type", [
  "new_lead",
  "in_process",
  "broker",
  "employee",
  "supplier",
  "vip",
]);
export const leadTemperatureEnum = pgEnum("lead_temperature", [
  "cold",
  "warm",
  "hot",
  "closed",
]);
export const leadStageEnum = pgEnum("lead_stage", [
  "lead_new",
  "attending",
  "waiting_docs",
  "analysis",
  "caixa_register",
  "approval",
  "approved",
  "rejected",
  "followup",
  "in_process",
  "done",
]);
export const leadResponsibleEnum = pgEnum("lead_responsible", [
  "sarah",
  "vinicius",
  "bianca",
]);
export const leadIncomeTypeEnum = pgEnum("lead_income_type", [
  "formal",
  "informal",
  "irpf",
]);
export const leadCpfStatusEnum = pgEnum("lead_cpf_status", [
  "clean",
  "restricted",
  "unknown",
]);
export const leadContractTypeEnum = pgEnum("lead_contract_type", [
  "obra",
  "financing",
  "both",
]);
export const leadActivityTypeEnum = pgEnum("lead_activity_type", [
  "message",
  "call",
  "document",
  "status_change",
  "note",
  "handoff",
  "follow_up",
  "simulation",
  "caixa_register",
]);
export const leadDocTypeEnum = pgEnum("lead_doc_type", [
  "rg",
  "cnh",
  "address_proof",
  "income_proof_formal",
  "income_proof_irpf",
  "fgts",
  "spouse_docs",
  "spouse_income_proof",
  "birth_marriage_certificate",
  "pis",
  "other",
]);
export const leadDocStatusEnum = pgEnum("lead_doc_status", [
  "pending",
  "received",
  "approved",
  "rejected",
]);
export const followUpStatusEnum = pgEnum("follow_up_status", [
  "pending",
  "sent",
  "responded",
  "failed",
  "cancelled",
]);
export const taskRelatedTypeEnum = pgEnum("task_related_type", [
  "lead",
  "obra",
  "budget",
  "financial",
  "general",
]);
export const taskPriorityEnum = pgEnum("task_priority", [
  "low",
  "medium",
  "high",
  "critical",
]);
export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "in_progress",
  "done",
  "cancelled",
]);
export const financialTransactionTypeEnum = pgEnum(
  "financial_transaction_type",
  ["income", "expense", "commission", "salary", "contractor_payment"]
);
export const bpoClientStatusEnum = pgEnum("bpo_client_status", [
  "ativo",
  "pausado",
  "encerrado",
]);
export const bpoLancamentoTipoEnum = pgEnum("bpo_lancamento_tipo", [
  "honorario",
  "despesa",
  "reembolso",
  // LOTE C (25/10): entradas do extrato bancário (crédito → receita, aba Cobranças).
  "receita",
]);
export const financialTransactionStatusEnum = pgEnum(
  "financial_transaction_status",
  ["pending", "paid", "cancelled"]
);
export const financiamentoTipoEnum = pgEnum("financiamento_tipo", [
  "mcmv",
  "sbpe",
  "pro_cotista",
  "construcao",
  "reforma",
]);
export const financiamentoBancoEnum = pgEnum("financiamento_banco", [
  "caixa",
  "bb",
  "bradesco",
  "itau",
  "santander",
  "outro",
]);
export const financiamentoStatusEnum = pgEnum("financiamento_status", [
  "pre_analise",
  "documentacao",
  "analise_banco",
  "aprovado",
  "contrato",
  "registro",
  "liberado",
  "cancelado",
]);

// ──────────────────────────────────────────
// TABLES
// ──────────────────────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  /** Used for Manus OAuth compat — set to email for new users */
  openId: varchar("openId", { length: 320 }).notNull().unique(),
  /** Hashed password (SHA-256 + salt). Null for legacy OAuth users. */
  passwordHash: varchar("passwordHash", { length: 128 }),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  cpf: varchar("cpf", { length: 14 }),
  phone: varchar("phone", { length: 20 }),
  address: text("address"),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 2 }),
  zipCode: varchar("zipCode", { length: 10 }),
  avatarUrl: text("avatarUrl"),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRoleEnum("role").default("cliente").notNull(),
  active: boolean("active").default(true).notNull(),
  sessionVersion: integer("sessionVersion").default(0).notNull(),
  permissions: text("permissions").default("[]").notNull(),
  /** Token de primeiro acesso / redefinição de senha (ver configuracoes-router.ts). */
  tokenPrimeiroAcesso: varchar("tokenPrimeiroAcesso", { length: 64 }).unique(),
  tokenPrimeiroAcessoExpiraEm: timestamp("tokenPrimeiroAcessoExpiraEm"),
  creci: varchar("creci", { length: 40 }),
  leadId: integer("lead_id")
    .unique()
    .references(() => leads.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const draws = pgTable("draws", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  prizeAmount: integer("prize_amount").notNull(),
  ticketPrice: integer("ticket_price").notNull(),
  targetAmount: integer("target_amount").notNull(),
  currentAmount: integer("current_amount").default(0).notNull(),
  ticketsSold: integer("tickets_sold").default(0).notNull(),
  status: drawStatusEnum("status").default("active").notNull(),
  drawDate: timestamp("draw_date"),
  winnerUserId: integer("winner_user_id"),
  lotteryResult: varchar("lottery_result", { length: 10 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Draw = typeof draws.$inferSelect;
export type InsertDraw = typeof draws.$inferInsert;

export const tickets = pgTable("tickets", {
  id: serial("id").primaryKey(),
  drawId: integer("draw_id").notNull(),
  userId: integer("user_id").notNull(),
  ticketNumber: varchar("ticket_number", { length: 50 }).notNull().unique(),
  quantity: integer("quantity").default(1).notNull(),
  totalPaid: integer("total_paid").notNull(),
  paymentStatus: ticketPaymentStatusEnum("payment_status")
    .default("pending")
    .notNull(),
  paymentMethod: varchar("payment_method", { length: 50 }).default("pix"),
  pixQrCode: text("pix_qr_code"),
  pixCopyPaste: text("pix_copy_paste"),
  // ID do pagamento no Asaas. A coluna mantém o nome legado do banco (sem migração).
  paymentProviderId: varchar("stripe_payment_intent_id", { length: 255 }),
  // Coluna legada sem uso (nome antigo mantido no banco, sem migração).
  legacyCheckoutSessionId: varchar("stripe_checkout_session_id", {
    length: 255,
  }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Ticket = typeof tickets.$inferSelect;
export type InsertTicket = typeof tickets.$inferInsert;

export const utefBalances = pgTable("utef_balances", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  balance: integer("balance").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type UtefBalance = typeof utefBalances.$inferSelect;
export type InsertUtefBalance = typeof utefBalances.$inferInsert;

export const utefTransactions = pgTable("utef_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  amount: integer("amount").notNull(),
  type: utefTransactionTypeEnum("type").notNull(),
  description: text("description"),
  relatedId: integer("related_id"),
  referenceId: varchar("reference_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type UtefTransaction = typeof utefTransactions.$inferSelect;
export type InsertUtefTransaction = typeof utefTransactions.$inferInsert;

// Ledger de intencao de pagamento: criado na hora da cobranca (Asaas), liquidado no
// webhook. Garante idempotencia (provider_payment_id e unico) e serve de base para
// reconciliacao manual de reembolso/chargeback.
export const paymentOrders = pgTable("payment_orders", {
  id: serial("id").primaryKey(),
  provider: varchar("provider", { length: 20 }).notNull().default("asaas"),
  providerPaymentId: varchar("provider_payment_id", { length: 255 })
    .notNull()
    .unique(),
  purpose: paymentOrderPurposeEnum("purpose").notNull(),
  userId: integer("user_id").notNull(),
  drawId: integer("draw_id"),
  ticketId: integer("ticket_id"),
  quantity: integer("quantity").default(1).notNull(),
  principalAmount: integer("principal_amount").notNull(),
  bonusAmount: integer("bonus_amount").default(0).notNull(),
  status: paymentOrderStatusEnum("status").default("pending").notNull(),
  reviewReason: text("review_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  settledAt: timestamp("settled_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type PaymentOrder = typeof paymentOrders.$inferSelect;
export type InsertPaymentOrder = typeof paymentOrders.$inferInsert;

// Numeros individuais de bilhete dentro de um sorteio (00000-99999). Cada unidade de
// `quantity` comprada gera uma linha aqui, permitindo chance proporcional real e a
// regra publica de "5 ultimos digitos da Loteria Federal" (busca exata ou anterior).
export const ticketNumbers = pgTable(
  "ticket_numbers",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id").notNull(),
    drawId: integer("draw_id").notNull(),
    number: integer("number").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => ({
    drawNumberUnique: uniqueIndex("ticket_numbers_draw_number_unique").on(
      table.drawId,
      table.number
    ),
  })
);

export type TicketNumber = typeof ticketNumbers.$inferSelect;
export type InsertTicketNumber = typeof ticketNumbers.$inferInsert;

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  category: productCategoryEnum("category").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  priceUtef: integer("price_utef").notNull(),
  imageUrl: text("image_url"),
  details: text("details"),
  status: productStatusEnum("status").default("available").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

export const productConversions = pgTable("product_conversions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  productId: integer("product_id").notNull(),
  utefAmount: integer("utef_amount").notNull(),
  status: productConversionStatusEnum("status").default("pending").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ProductConversion = typeof productConversions.$inferSelect;
export type InsertProductConversion = typeof productConversions.$inferInsert;

export const constructionProjects = pgTable("construction_projects", {
  id: serial("id").primaryKey(),
  // Obras internas podem nascer diretamente de um serviço do CRM, sem criar
  // um usuário/cliente fictício apenas para satisfazer a estrutura antiga.
  userId: integer("user_id"),
  leadId: integer("lead_id").references(() => leads.id, {
    onDelete: "set null",
  }),
  leadServiceId: integer("lead_service_id")
    .references(() => leadServices.id, { onDelete: "set null" })
    .unique(),
  title: varchar("title", { length: 255 }).notNull(),
  address: text("address"),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 2 }),
  projectType: varchar("project_type", { length: 100 }),
  totalArea: integer("total_area"),
  status: constructionProjectStatusEnum("status").default("planning").notNull(),
  progress: integer("progress").default(0).notNull(),
  // EPIC-020 Lote 4: Progresso Geral medido (soma incidência × execução), 6 casas.
  progressMeasuredPct: decimal("progress_measured_pct", { precision: 9, scale: 6 }),
  vgv: decimal("vgv", { precision: 15, scale: 2 }),
  financedAmount: decimal("financed_amount", { precision: 15, scale: 2 }),
  fgtsAmount: decimal("fgts_amount", { precision: 15, scale: 2 }),
  subsidyAmount: decimal("subsidy_amount", { precision: 15, scale: 2 }),
  downPaymentTotal: decimal("down_payment_total", { precision: 15, scale: 2 }),
  downPaymentPaid: decimal("down_payment_paid", { precision: 15, scale: 2 }),
  plsPercentage: decimal("pls_percentage", { precision: 7, scale: 4 }),
  realReceivedPercentage: decimal("real_received_pct", {
    precision: 7,
    scale: 4,
  }),
  cefReceivedAmount: decimal("cef_received_amount", {
    precision: 15,
    scale: 2,
  }),
  constructionSpent: decimal("construction_spent", { precision: 15, scale: 2 }),
  lotCost: decimal("lot_cost", { precision: 15, scale: 2 }),
  brokerName: varchar("broker_name", { length: 255 }),
  brokerPaid: decimal("broker_paid", { precision: 15, scale: 2 }).default("0"),
  constructionCost: decimal("construction_cost", { precision: 15, scale: 2 }),
  estimatedProfit: decimal("estimated_profit", { precision: 15, scale: 2 }),
  investorProfit: decimal("investor_profit", { precision: 15, scale: 2 }),
  prospectaProfit: decimal("prospecta_profit", { precision: 15, scale: 2 }),
  proSoluto: decimal("pro_soluto", { precision: 15, scale: 2 }).default("0"),
  installmentRate: decimal("installment_rate", { precision: 7, scale: 4 }),
  installmentQty: integer("installment_qty"),
  installmentValue: decimal("installment_value", { precision: 15, scale: 2 }),
  // Identificação CEF e dados legados antes serializados no sufixo de notes.
  cefTitle: varchar("cef_title", { length: 255 }),
  cefBranch: varchar("cef_branch", { length: 255 }),
  mcmvClientName: varchar("mcmv_client_name", { length: 255 }),
  brokerPaymentSettled: boolean("broker_payment_settled"),
  startDate: timestamp("start_date"),
  constructionDays: integer("construction_days"),
  estimatedEndDate: timestamp("estimated_end_date"),
  actualEndDate: timestamp("actual_end_date"),
  // Lote 2: "Valor Total do Contrato" passou a ser o Orçamento Previsto.
  contractValue: decimal("contract_value", { precision: 15, scale: 2 }),
  // Lote 2: "Tipo de Contrato" foi substituído pelo empreiteiro vinculado; valor antigo preservado.
  contractType: varchar("contract_type", { length: 100 }),
  commissionAmount: decimal("commission_amount", { precision: 15, scale: 2 }),
  // EPIC-020 Lote 3: percentual de comissão próprio da obra (prevalece sobre o do corretor).
  commissionPct: decimal("commission_pct", { precision: 7, scale: 4 }),
  contractorUserId: integer("contractor_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  contractorSharePct: decimal("contractor_share_pct", { precision: 9, scale: 6 }),
  contractorIncludeProSoluto: boolean("contractor_include_pro_soluto").default(false).notNull(),
  // Lote 23/10, etapa 3: imóvel vinculado que guarda a "Localização exata" da obra (Mapa Operacional).
  imovelId: integer("imovel_id").references((): AnyPgColumn => imoveis.id, { onDelete: "set null" }),
  notes: text("notes"),
  extraNotes: text("extra_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ConstructionProject = typeof constructionProjects.$inferSelect;
export type InsertConstructionProject =
  typeof constructionProjects.$inferInsert;

export const constructionStages = pgTable("construction_stages", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  orderIndex: integer("order_index").notNull(),
  status: constructionStageStatusEnum("status").default("pending").notNull(),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  estimatedCost: integer("estimated_cost"),
  actualCost: integer("actual_cost"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ConstructionStage = typeof constructionStages.$inferSelect;
export type InsertConstructionStage = typeof constructionStages.$inferInsert;

export const constructionPhotos = pgTable("construction_photos", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  stageId: integer("stage_id"),
  imageUrl: text("image_url").notNull(),
  caption: text("caption"),
  takenAt: timestamp("taken_at").notNull(),
  uploadedBy: integer("uploaded_by"),
  // EPIC-020 Lote 4: foto marcada para entrar no relatório executivo.
  includeInReport: boolean("include_in_report").default(true).notNull(),
  // Pedido de 18/10: foto enviada junto com uma medição (relatório fotográfico da CAIXA).
  progressHistoryId: integer("progress_history_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// EPIC-020 Lote 4 (item 28): bytes das fotos no próprio banco. A coluna
// "data" (bytea) é lida/gravada só por SQL explícito em server/routes/obra-fotos.ts.
export const constructionPhotoFiles = pgTable("construction_photo_files", {
  photoId: integer("photo_id").primaryKey().references(() => constructionPhotos.id, { onDelete: "cascade" }),
  mime: varchar("mime", { length: 40 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
});

// Pedido de 18/10: PCI (Proposta de Construção Individual da CAIXA) da obra.
// O arquivo (coluna "data", bytea) é lido/gravado só por SQL explícito em
// server/routes/obra-medicao-caixa.ts; "parsed" guarda o que foi lido dele.
export const constructionPciVersions = pgTable("construction_pci_versions", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => constructionProjects.id, { onDelete: "cascade" }),
  checksum: varchar("checksum", { length: 32 }).notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  uploadedBy: integer("uploaded_by"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  parsed: jsonb("parsed").notNull(),
});

export const constructionPci = pgTable("construction_pci", {
  projectId: integer("project_id").primaryKey().references(() => constructionProjects.id, { onDelete: "cascade" }),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  parsed: jsonb("parsed").notNull(),
  uploadedBy: integer("uploaded_by"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  linkedAt: timestamp("linked_at"),
  linkedBy: integer("linked_by"),
  versionId: integer("version_id").references(() => constructionPciVersions.id, { onDelete: "no action" }),
});

// EPIC-020 Lote 4 (item 27): progresso por incidência (20 serviços por obra).
export const constructionProgressItems = pgTable("construction_progress_items", {
  projectId: integer("project_id").notNull().references(() => constructionProjects.id, { onDelete: "cascade" }),
  serviceKey: varchar("service_key", { length: 40 }).notNull(),
  // Pedido de 18/10: 15 casas para guardar a incidência exata da PCI da CAIXA.
  incidencePct: decimal("incidence_pct", { precision: 20, scale: 15 }).notNull(),
  executionPct: decimal("execution_pct", { precision: 7, scale: 4 }).default("0").notNull(),
  updatedBy: integer("updated_by"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.projectId, t.serviceKey] }) }));

export const constructionProgressHistory = pgTable("construction_progress_history", {
  id: serial("id").primaryKey(),
  pciVersionId: integer("pci_version_id").references(() => constructionPciVersions.id, { onDelete: "no action" }),
  projectId: integer("project_id").notNull().references(() => constructionProjects.id, { onDelete: "cascade" }),
  progressPct: decimal("progress_pct", { precision: 9, scale: 6 }).notNull(),
  incidenceTotalPct: decimal("incidence_total_pct", { precision: 20, scale: 15 }).notNull(),
  items: jsonb("items").$type<{ chave: string; incidencia: string; execucao: string }[]>().notNull(),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Pedido de 18/10: ciclo da medição — solicitada ao banco e recebida (paga).
  requestedAt: timestamp("requested_at"),
  requestedBy: integer("requested_by"),
  requestEmailStatus: varchar("request_email_status", { length: 20 }),
  requestEmailAttemptAt: timestamp("request_email_attempt_at"),
  receivedAt: timestamp("received_at"),
  receivedBy: integer("received_by"),
  updatedAt: timestamp("updated_at"),
  updatedBy: integer("updated_by"),
  // Pedido de 18/10: tipo da medição na CAIXA (pls, repactuacao, alteracao) e
  // os campos de cada modelo (shared/medicao-caixa.ts).
  measurementType: varchar("measurement_type", { length: 20 }).default("pls").notNull(),
  caixaData: jsonb("caixa_data"),
}, (t) => ({ porObra: index("construction_progress_history_project_idx").on(t.projectId, t.createdAt) }));

export type ConstructionPhoto = typeof constructionPhotos.$inferSelect;
export type InsertConstructionPhoto = typeof constructionPhotos.$inferInsert;

export const projectBudgetRequests = pgTable("project_budget_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 20 }),
  city: varchar("city", { length: 255 }),
  projectType: varchar("project_type", { length: 100 }),
  hasLot: budgetRequestHasLotEnum("has_lot"),
  message: text("message"),
  status: budgetRequestStatusEnum("status").default("pending").notNull(),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ProjectBudgetRequest = typeof projectBudgetRequests.$inferSelect;
export type InsertProjectBudgetRequest =
  typeof projectBudgetRequests.$inferInsert;

export const emailLogs = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  recipientEmail: varchar("recipient_email", { length: 320 }).notNull(),
  recipientName: varchar("recipient_name", { length: 255 }),
  subject: varchar("subject", { length: 500 }).notNull(),
  templateType: emailTemplateTypeEnum("template_type").notNull(),
  htmlContent: text("html_content").notNull(),
  status: emailStatusEnum("status").default("pending").notNull(),
  sentAt: timestamp("sent_at"),
  errorMessage: text("error_message"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type EmailLog = typeof emailLogs.$inferSelect;
export type InsertEmailLog = typeof emailLogs.$inferInsert;

export const userNotifications = pgTable("user_notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  type: notificationTypeEnum("type").notNull(),
  isRead: boolean("is_read").default(false).notNull(),
  relatedId: integer("related_id"),
  actionUrl: varchar("action_url", { length: 500 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  readAt: timestamp("read_at"),
});

export type UserNotification = typeof userNotifications.$inferSelect;
export type InsertUserNotification = typeof userNotifications.$inferInsert;

export const obraFees = pgTable("obra_fees", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  feeType: varchar("fee_type", { length: 100 }).notNull(),
  estimatedValue: decimal("estimated_value", {
    precision: 15,
    scale: 2,
  }).default("0"),
  /** Legado: substituído pela tabela financeira (Lote 6); mantido sem edição. */
  paidValue: decimal("paid_value", { precision: 15, scale: 2 }).default("0"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ObraFee = typeof obraFees.$inferSelect;
export type InsertObraFee = typeof obraFees.$inferInsert;

export const obraMeasurements = pgTable("obra_measurements", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  stageId: integer("stage_id"),
  measurementDate: timestamp("measurement_date").notNull(),
  value: decimal("value", { precision: 15, scale: 2 }).notNull(),
  status: obraMeasurementStatusEnum("status").default("pending").notNull(),
  notes: text("notes"),
  approvedBy: integer("approved_by"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ObraMeasurement = typeof obraMeasurements.$inferSelect;
export type InsertObraMeasurement = typeof obraMeasurements.$inferInsert;

export const brokerCommissions = pgTable("broker_commissions", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id"),
  clientName: varchar("client_name", { length: 255 }).notNull(),
  brokerName: varchar("broker_name", { length: 255 }).notNull(),
  totalCommission: decimal("total_commission", {
    precision: 15,
    scale: 2,
  }).notNull(),
  installment1Value: decimal("installment1_value", {
    precision: 15,
    scale: 2,
  }).default("0"),
  installment1Paid: decimal("installment1_paid", {
    precision: 15,
    scale: 2,
  }).default("0"),
  installment2Value: decimal("installment2_value", {
    precision: 15,
    scale: 2,
  }).default("0"),
  installment2Paid: decimal("installment2_paid", {
    precision: 15,
    scale: 2,
  }).default("0"),
  installment3Value: decimal("installment3_value", {
    precision: 15,
    scale: 2,
  }).default("0"),
  installment3Paid: decimal("installment3_paid", {
    precision: 15,
    scale: 2,
  }).default("0"),
  installment4Value: decimal("installment4_value", {
    precision: 15,
    scale: 2,
  }).default("0"),
  installment4Paid: decimal("installment4_paid", {
    precision: 15,
    scale: 2,
  }).default("0"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type BrokerCommission = typeof brokerCommissions.$inferSelect;
export type InsertBrokerCommission = typeof brokerCommissions.$inferInsert;

export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 20 }).notNull(),
  email: varchar("email", { length: 320 }),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 2 }),
  type: leadTypeEnum("type").default("new_lead").notNull(),
  temperature: leadTemperatureEnum("temperature").default("cold").notNull(),
  stage: varchar("stage", { length: 40 }).default("lead_new").notNull(),
  legacyStage: varchar("legacy_stage", { length: 40 }),
  stageClassificationPending: boolean("stage_classification_pending").default(false).notNull(),
  deletedAt: timestamp("deleted_at"),
  deletedByUserId: integer("deleted_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  // Pedido de 25/10 (noite): enum legado sem padrão 'sarah' e opcional (migração 0076).
  responsible: leadResponsibleEnum("responsible"),
  // EPIC-017: responsável e corretor apontam para usuários reais do sistema.
  // O enum legado `responsible` é mantido só para leitura de registros antigos.
  responsibleUserId: integer("responsible_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  brokerId: integer("broker_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  // Dados cadastrais migrados automaticamente para os serviços vinculados.
  cpf: varchar("cpf", { length: 14 }),
  address: text("address"),
  neighborhood: varchar("neighborhood", { length: 100 }),
  income: decimal("income", { precision: 15, scale: 2 }),
  incomeType: leadIncomeTypeEnum("income_type"),
  fgtsAmount: decimal("fgts_amount", { precision: 15, scale: 2 }),
  pisFgts: varchar("pis_fgts", { length: 20 }),
  hasSpouse: boolean("has_spouse").default(false),
  spouseName: varchar("spouse_name", { length: 255 }),
  incomeComposition: boolean("income_composition").default(false),
  cpfStatus: leadCpfStatusEnum("cpf_status").default("unknown"),
  simulationValue: decimal("simulation_value", { precision: 15, scale: 2 }),
  approvedValue: decimal("approved_value", { precision: 15, scale: 2 }),
  contractType: leadContractTypeEnum("contract_type"),
  sourceChannel: varchar("source_channel", { length: 100 }),
  sourceCity: varchar("source_city", { length: 100 }),
  lgpdConsent: boolean("lgpd_consent").default(false),
  lgpdConsentAt: timestamp("lgpd_consent_at"),
  rejectionReason: text("rejection_reason"),
  followupDate: timestamp("followup_date"),
  // Prazo individual do card no pipeline; independente de tarefas, visitas e follow-up.
  cardDueDate: date("card_due_date", { mode: "string" }),
  // Lote 23/10, etapa 6: origem da duplicação ("Duplicar lead").
  duplicatedFromLeadId: integer("duplicated_from_lead_id").references((): AnyPgColumn => leads.id, { onDelete: "set null" }),
  duplicatedAt: timestamp("duplicated_at"),
  duplicatedByUserId: integer("duplicated_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  notes: text("notes"),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;

// Serviço é separado do cliente: um lead pode ter vários atendimentos sem duplicação.
export const leadServices = pgTable(
  "lead_services",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    serviceType: varchar("service_type", { length: 60 }).notNull(),
    title: varchar("title", { length: 255 }),
    status: varchar("status", { length: 40 })
      .default("awaiting_data")
      .notNull(),
    originList: varchar("origin_list", { length: 255 }),
    sourceCardUrl: text("source_card_url"),
    idempotencyKey: varchar("idempotency_key", { length: 120 }),
    dueAt: timestamp("due_at"),
    description: text("description").default("").notNull(),
    operationalModule: varchar("operational_module", { length: 80 }),
    operationalRecordId: integer("operational_record_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  table => ({
    sourceCardUrlUnique: uniqueIndex("lead_services_source_card_url_unique").on(
      table.sourceCardUrl
    ),
    idempotencyKeyUnique: uniqueIndex("lead_services_idempotency_key_unique").on(table.idempotencyKey),
  })
);

export type LeadService = typeof leadServices.$inferSelect;
export type InsertLeadService = typeof leadServices.$inferInsert;

export const regularizacoes = pgTable("regularizacoes", {
  id: serial("id").primaryKey(),
  clientName: varchar("client_name", { length: 255 }).notNull(),
  clientPhone: varchar("client_phone", { length: 30 }),
  type: varchar("type", { length: 120 }).notNull(),
  // EPIC-020 Lote 6: em_analise | em_andamento | concluido (| cancelado).
  status: varchar("status", { length: 40 }).default("em_analise").notNull(),
  /** Status anterior ao Lote 6 (preservado na migração 0046). */
  legacyStatus: varchar("legacy_status", { length: 40 }),
  address: text("address").notNull(),
  registration: varchar("registration", { length: 120 }),
  registryOffice: varchar("registry_office", { length: 255 }),
  responsible: varchar("responsible", { length: 120 }).notNull(),
  leadId: integer("lead_id"),
  leadServiceId: integer("lead_service_id").references(() => leadServices.id, {
    onDelete: "set null",
  }),
  serviceValue: decimal("service_value", { precision: 15, scale: 2 })
    .default("0")
    .notNull(),
  paidValue: decimal("paid_value", { precision: 15, scale: 2 })
    .default("0")
    .notNull(),
  expectedEndAt: timestamp("expected_end_at"),
  description: text("description").default("").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Regularizacao = typeof regularizacoes.$inferSelect;
export type InsertRegularizacao = typeof regularizacoes.$inferInsert;

export const regularizacaoDocuments = pgTable("regularizacao_documents", {
  id: serial("id").primaryKey(),
  regularizacaoId: integer("regularizacao_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  status: varchar("status", { length: 40 }).default("pending").notNull(),
  observation: text("observation").default("").notNull(),
  fileUrl: text("file_url"),
  driveFileId: text("drive_file_id"),
  uploadedFileName: varchar("uploaded_file_name", { length: 255 }),
  uploadedMimeType: varchar("uploaded_mime_type", { length: 120 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type RegularizacaoDocument = typeof regularizacaoDocuments.$inferSelect;
export type InsertRegularizacaoDocument =
  typeof regularizacaoDocuments.$inferInsert;

export const leadActivities = pgTable("lead_activities", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull(),
  type: leadActivityTypeEnum("type").notNull(),
  description: text("description").notNull(),
  performedBy: varchar("performed_by", { length: 100 }),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type LeadActivity = typeof leadActivities.$inferSelect;
export type InsertLeadActivity = typeof leadActivities.$inferInsert;

export const leadDocuments = pgTable("lead_documents", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull(),
  serviceId: integer("service_id").references(() => leadServices.id, { onDelete: "set null" }),
  type: leadDocTypeEnum("type").notNull(),
  fileName: varchar("file_name", { length: 255 }),
  fileUrl: text("file_url"),
  driveFileId: text("drive_file_id"),
  mimeType: varchar("mime_type", { length: 120 }),
  fileSize: integer("file_size"),
  sha256: varchar("sha256", { length: 64 }),
  /** "drive" (Google Drive) ou "banco" (lead_document_file_data), quando o Drive recusou a gravação. */
  storage: varchar("storage", { length: 10 }).default("drive").notNull(),
  storageNote: varchar("storage_note", { length: 400 }),
  // Etapa 6: cópia feita pelo "Duplicar lead" (mesmo arquivo do Drive do documento original).
  copiedFromDocumentId: integer("copied_from_document_id").references((): AnyPgColumn => leadDocuments.id, { onDelete: "set null" }),
  uploadedByUserId: integer("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  deletedByUserId: integer("deleted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  deletedAt: timestamp("deleted_at"),
  status: leadDocStatusEnum("status").default("pending").notNull(),
  notes: text("notes"),
  uploadedAt: timestamp("uploaded_at"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type LeadDocument = typeof leadDocuments.$inferSelect;
export type InsertLeadDocument = typeof leadDocuments.$inferInsert;

export const leadFollowUps = pgTable("lead_follow_ups", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull(),
  attempt: integer("attempt").notNull(),
  subAttempt: integer("sub_attempt").notNull(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  executedAt: timestamp("executed_at"),
  status: followUpStatusEnum("status").default("pending").notNull(),
  message: text("message"),
  response: text("response"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type LeadFollowUp = typeof leadFollowUps.$inferSelect;
export type InsertLeadFollowUp = typeof leadFollowUps.$inferInsert;

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  leadServiceId: integer("lead_service_id").unique().references(() => leadServices.id, { onDelete: "set null" }),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  assignedTo: varchar("assigned_to", { length: 100 }).notNull(),
  relatedType: taskRelatedTypeEnum("related_type"),
  relatedId: integer("related_id"),
  priority: taskPriorityEnum("priority").default("medium").notNull(),
  status: taskStatusEnum("status").default("pending").notNull(),
  slaHours: integer("sla_hours").default(24),
  dueAt: timestamp("due_at"),
  completedAt: timestamp("completed_at"),
  escalatedToVinicius: boolean("escalated_to_vinicius").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Task = typeof tasks.$inferSelect;
export type InsertTask = typeof tasks.$inferInsert;

export const financialTransactions = pgTable("financial_transactions", {
  id: serial("id").primaryKey(),
  type: financialTransactionTypeEnum("type").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  category: varchar("category", { length: 100 }),
  responsible: varchar("responsible", { length: 100 }),
  referenceId: integer("reference_id"),
  referenceType: varchar("reference_type", { length: 50 }),
  paidAt: timestamp("paid_at"),
  notes: text("notes"),
  status: financialTransactionStatusEnum("status").default("pending").notNull(),
  dueDate: timestamp("due_date"),
  paymentMethod: varchar("payment_method", { length: 40 }),
  externalReference: varchar("external_reference", { length: 120 }),
  competency: varchar("competency", { length: 7 }),
  vendor: varchar("vendor", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const dashboardSettings = pgTable("dashboard_settings", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  value: varchar("value", { length: 500 }).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type DashboardSetting = typeof dashboardSettings.$inferSelect;

export type FinancialTransaction = typeof financialTransactions.$inferSelect;
export type InsertFinancialTransaction =
  typeof financialTransactions.$inferInsert;

// ========== FINANCIAMENTOS ==========

export const financiamentos = pgTable("financiamentos", {
  id: serial("id").primaryKey(),
  clienteNome: varchar("cliente_nome", { length: 255 }).notNull(),
  clienteCpf: varchar("cliente_cpf", { length: 14 }),
  clienteTel: varchar("cliente_tel", { length: 30 }).notNull(),
  clienteEmail: varchar("cliente_email", { length: 320 }),
  // Nullable: um financiamento originado pelo vínculo do CRM nasce só com os
  // dados do lead. Imóvel, tipo e banco são dados técnicos preenchidos depois,
  // na edição operacional (EPIC Lote 3 — Financiamentos originados no CRM).
  imovel: varchar("imovel", { length: 500 }),
  tipo: financiamentoTipoEnum("tipo"),
  banco: financiamentoBancoEnum("banco"),
  bancoOutro: varchar("banco_outro", { length: 120 }),
  valorImovel: decimal("valor_imovel", { precision: 15, scale: 2 })
    .default("0")
    .notNull(),
  valorFinanciado: decimal("valor_financiado", { precision: 15, scale: 2 })
    .default("0")
    .notNull(),
  entrada: decimal("entrada", { precision: 15, scale: 2 })
    .default("0")
    .notNull(),
  taxa: decimal("taxa", { precision: 8, scale: 4 }).default("0").notNull(),
  prazo: integer("prazo").default(360).notNull(),
  parcela: decimal("parcela", { precision: 15, scale: 2 }),
  status: financiamentoStatusEnum("status").default("pre_analise").notNull(),
  protocolo: varchar("protocolo", { length: 120 }),
  leadId: integer("lead_id").references(() => leads.id, {
    onDelete: "set null",
  }),
  leadServiceId: integer("lead_service_id").references(() => leadServices.id, {
    onDelete: "set null",
  }),
  imovelVinculadoId: integer("imovel_vinculado_id").references(
    () => imoveis.id,
    { onDelete: "set null" }
  ),
  corretorId: integer("corretor_id").references(() => users.id, {
    onDelete: "set null",
  }),
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type Financiamento = typeof financiamentos.$inferSelect;
export type InsertFinanciamento = typeof financiamentos.$inferInsert;

export const financiamentoChecklistItems = pgTable(
  "financiamento_checklist_items",
  {
    id: serial("id").primaryKey(),
    financiamentoId: integer("financiamento_id")
      .notNull()
      .references(() => financiamentos.id, { onDelete: "cascade" }),
    grupo: varchar("grupo", { length: 80 }).notNull(),
    item: varchar("item", { length: 255 }).notNull(),
    concluido: boolean("concluido").default(false).notNull(),
    concluidoEm: timestamp("concluido_em"),
    notas: text("notas"),
    visivelCliente: boolean("visivel_cliente").default(true).notNull(),
    solicitarDocumento: boolean("solicitar_documento").default(false).notNull(),
    documentoUrl: text("documento_url"),
    documentoDriveFileId: text("documento_drive_file_id"),
    documentoNome: varchar("documento_nome", { length: 255 }),
    documentoMime: varchar("documento_mime", { length: 120 }),
    enviadoEm: timestamp("enviado_em"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  }
);
export type FinanciamentoChecklistItem =
  typeof financiamentoChecklistItems.$inferSelect;
export type InsertFinanciamentoChecklistItem =
  typeof financiamentoChecklistItems.$inferInsert;

export const paymentSettings = pgTable("payment_settings", {
  id: serial("id").primaryKey(),
  provider: varchar("provider", { length: 50 }).default("asaas").notNull(),
  asaasApiKeyEncrypted: text("asaas_api_key_encrypted").notNull(),
  asaasWebhookTokenEncrypted: text("asaas_webhook_token_encrypted"),
  asaasEnvironment: varchar("asaas_environment", { length: 20 })
    .default("sandbox")
    .notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type PaymentSetting = typeof paymentSettings.$inferSelect;
export type InsertPaymentSetting = typeof paymentSettings.$inferInsert;

export const bpoClients = pgTable("bpo_clients", {
  id: serial("id").primaryKey(),
  razaoSocial: varchar("razao_social", { length: 255 }).notNull(),
  cnpj: varchar("cnpj", { length: 20 }),
  cpf: varchar("cpf", { length: 14 }),
  responsavel: varchar("responsavel", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }),
  telefone: varchar("telefone", { length: 20 }).notNull(),
  servicos: text("servicos").default("[]").notNull(),
  status: bpoClientStatusEnum("status").default("ativo").notNull(),
  honorarios: decimal("honorarios", { precision: 15, scale: 2 }).notNull(),
  diaVencimento: integer("dia_vencimento").default(10).notNull(),
  dataInicio: timestamp("data_inicio").notNull(),
  observacoes: text("observacoes").default("").notNull(),
  // Pedido de 25/10 (noite), item 10: cliente BPO ligado ao lead do CRM (opcional; fornecedor/terceiro fica sem).
  leadId: integer("lead_id").references((): AnyPgColumn => leads.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type BpoClient = typeof bpoClients.$inferSelect;
export type InsertBpoClient = typeof bpoClients.$inferInsert;

export const bpoLancamentos = pgTable("bpo_lancamentos", {
  id: serial("id").primaryKey(),
  clienteId: integer("cliente_id").references(() => bpoClients.id, {
    onDelete: "set null",
  }),
  clienteNomeLivre: varchar("cliente_nome_livre", { length: 255 }),
  tipo: bpoLancamentoTipoEnum("tipo").notNull(),
  descricao: varchar("descricao", { length: 500 }).notNull(),
  valor: decimal("valor", { precision: 15, scale: 2 }).notNull(),
  vencimento: timestamp("vencimento").notNull(),
  pago: boolean("pago").default(false).notNull(),
  pagoEm: timestamp("pago_em"),
  competencia: varchar("competencia", { length: 7 }).notNull(),
  centroCustos: varchar("centro_custos", { length: 100 }),
  // LOTE C (25/10): categoria (shared/financeiro/bpo-extrato.ts) e vínculo 1:1 com a
  // movimentação bancária que gerou o lançamento (reimportar/reprocessar não duplica).
  categoria: varchar("categoria", { length: 60 }),
  // Categoria operacional e vínculo persistente com o módulo de origem. A
  // classificação contábil acima continua independente para DRE/tributação.
  categoriaOperacional: varchar("categoria_operacional", { length: 40 }),
  vinculoOperacionalId: varchar("vinculo_operacional_id", { length: 80 }),
  vinculoOperacionalRotulo: varchar("vinculo_operacional_rotulo", { length: 255 }),
  tipoDespesaObra: varchar("tipo_despesa_obra", { length: 30 }),
  etapaObra: varchar("etapa_obra", { length: 80 }),
  bankTransactionId: integer("bank_transaction_id")
    .unique()
    .references((): AnyPgColumn => bankTransactions.id, { onDelete: "cascade" }),
  // Pedido de 25/10 (noite), item 14: cobrança emitida no Asaas (id do pagamento, único).
  asaasPaymentId: varchar("asaas_payment_id", { length: 60 }).unique(),
  observacoes: text("observacoes"),
  origemEfetiva: varchar("origem_efetiva", { length: 30 }).default("manual").notNull(),
  requestKey: varchar("request_key", { length: 80 }).unique(),
  version: integer("version").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type BpoLancamento =typeof bpoLancamentos.$inferSelect;
export type InsertBpoLancamento = typeof bpoLancamentos.$inferInsert;

export const bpoLancamentoHistorico = pgTable("bpo_lancamento_historico", {
  id: serial("id").primaryKey(),
  lancamentoId: integer("lancamento_id").references(() => bpoLancamentos.id, { onDelete: "set null" }),
  lancamentoReferencia: integer("lancamento_referencia").notNull(),
  versaoAnterior: integer("versao_anterior").notNull(),
  alteradoPorUserId: integer("alterado_por_user_id").references(() => users.id, { onDelete: "set null" }),
  motivo: text("motivo").notNull(),
  antesJson: text("antes_json").notNull(),
  depoisJson: text("depois_json").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const bpoContaLimpezaBackups = pgTable("bpo_conta_limpeza_backups", {
  id: serial("id").primaryKey(),
  contaReferencia: integer("conta_referencia").notNull(),
  contaRotulo: varchar("conta_rotulo", { length: 255 }).notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  transacoes: integer("transacoes").notNull(),
  lancamentosRemovidos: integer("lancamentos_removidos").notNull(),
  lancamentosPreservados: integer("lancamentos_preservados").notNull(),
  criadoPorUserId: integer("criado_por_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Pedido de 25/10 (noite), item 9: regra por titular — classificou uma vez, as próximas
// movimentações do mesmo titular (nome normalizado) saem com a mesma categoria/cliente.
export const bpoRegrasTitular = pgTable("bpo_regras_titular", {
  id: serial("id").primaryKey(),
  titularNormalizado: varchar("titular_normalizado", { length: 255 }).notNull().unique(),
  categoria: varchar("categoria", { length: 60 }),
  bpoClienteId: integer("bpo_cliente_id").references(() => bpoClients.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type BpoRegraTitular = typeof bpoRegrasTitular.$inferSelect;

// ========== GESTÃO TRIBUTÁRIA ==========

export const taxProfiles = pgTable("tax_profiles", {
  id: serial("id").primaryKey(),
  companyName: varchar("company_name", { length: 255 }).notNull(),
  cnpj: varchar("cnpj", { length: 20 }),
  regime: varchar("regime", { length: 40 }).notNull(),
  estimatedRate: decimal("estimated_rate", { precision: 7, scale: 4 })
    .default("0")
    .notNull(),
  effectiveFrom: timestamp("effective_from").notNull(),
  effectiveTo: timestamp("effective_to"),
  notes: text("notes"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type TaxProfile = typeof taxProfiles.$inferSelect;
export type InsertTaxProfile = typeof taxProfiles.$inferInsert;

export const taxObligations = pgTable("tax_obligations", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").references(() => taxProfiles.id, {
    onDelete: "set null",
  }),
  name: varchar("name", { length: 255 }).notNull(),
  competency: varchar("competency", { length: 7 }).notNull(),
  dueDate: timestamp("due_date").notNull(),
  estimatedAmount: decimal("estimated_amount", { precision: 15, scale: 2 })
    .default("0")
    .notNull(),
  status: varchar("status", { length: 30 }).default("pending").notNull(),
  paidAt: timestamp("paid_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type TaxObligation = typeof taxObligations.$inferSelect;
export type InsertTaxObligation = typeof taxObligations.$inferInsert;

export const retProjects = pgTable("ret_projects", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").references(() => taxProfiles.id, {
    onDelete: "set null",
  }),
  name: varchar("name", { length: 255 }).notNull(),
  cnpj: varchar("cnpj", { length: 20 }),
  registrationNumber: varchar("registration_number", { length: 120 }),
  affectedAssets: boolean("affected_assets").default(false).notNull(),
  status: varchar("status", { length: 30 }).default("analysis").notNull(),
  retRate: decimal("ret_rate", { precision: 7, scale: 4 })
    .default("4")
    .notNull(),
  effectiveFrom: timestamp("effective_from"),
  effectiveTo: timestamp("effective_to"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type RetProject = typeof retProjects.$inferSelect;
export type InsertRetProject = typeof retProjects.$inferInsert;

export const bankAccountTipoEnum = pgEnum("bank_account_tipo", [
  "corrente",
  "poupanca",
  "pagamento",
  "investimento",
]);
export const bankTransactionTipoEnum = pgEnum("bank_transaction_tipo", [
  "credito",
  "debito",
]);
export const bankTransactionStatusEnum = pgEnum("bank_transaction_status", [
  "pendente",
  "conciliado",
  "ignorado",
]);

export const pluggySettings = pgTable("pluggy_settings", {
  id: serial("id").primaryKey(),
  clientIdEncrypted: text("client_id_encrypted").notNull(),
  clientSecretEncrypted: text("client_secret_encrypted").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type PluggySetting = typeof pluggySettings.$inferSelect;

/** Google Drive com a conta Google do dono (OAuth). Linha única (id = 1); segredos criptografados. */
export const googleDriveOauth = pgTable("google_drive_oauth", {
  id: integer("id").primaryKey().default(1),
  clientId: text("client_id").notNull(),
  clientSecretEncrypted: text("client_secret_encrypted").notNull(),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  accountEmail: varchar("account_email", { length: 320 }),
  rootFolderId: text("root_folder_id"),
  connectedAt: timestamp("connected_at"),
  updatedByUserId: integer("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type InsertPluggySetting = typeof pluggySettings.$inferInsert;

export const bankAccounts = pgTable("bank_accounts", {
  id: serial("id").primaryKey(),
  banco: varchar("banco", { length: 255 }).notNull(),
  agencia: varchar("agencia", { length: 20 }),
  conta: varchar("conta", { length: 30 }).notNull(),
  tipo: bankAccountTipoEnum("tipo").default("corrente").notNull(),
  descricao: varchar("descricao", { length: 255 }),
  saldoAtual: decimal("saldo_atual", { precision: 15, scale: 2 })
    .default("0")
    .notNull(),
  ativo: boolean("ativo").default(true).notNull(),
  pluggyItemId: varchar("pluggy_item_id", { length: 120 }),
  pluggyAccountId: varchar("pluggy_account_id", { length: 120 }),
  webhookUrl: varchar("webhook_url", { length: 500 }),
  ultimaSincronizacao: timestamp("ultima_sincronizacao"),
  // Pedido de 25/10: de onde vêm as movimentações (API do Asaas, Pluggy/Meu Pluggy ou só
  // importação de extrato), a chave da API da própria conta (criptografada) e a data a partir
  // da qual as movimentações pertencem a esta empresa (anteriores são ignoradas).
  provedor: varchar("provedor", { length: 20 }).default("manual").notNull(),
  credencialEncrypted: text("credencial_encrypted"),
  dataInicial: date("data_inicial", { mode: "string" }),
  ultimoErro: text("ultimo_erro"),
  // LOTE C (25/10): de onde veio o saldo atual — "extrato" (arquivo), "api" (Asaas/Pluggy)
  // ou "calculado" (créditos − débitos das movimentações).
  saldoFonte: varchar("saldo_fonte", { length: 20 }).$type<"extrato" | "api" | "calculado">(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type BankAccount =typeof bankAccounts.$inferSelect;
export type InsertBankAccount = typeof bankAccounts.$inferInsert;

export const bankTransactions = pgTable("bank_transactions", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id")
    .notNull()
    .references(() => bankAccounts.id, { onDelete: "cascade" }),
  data: timestamp("data").notNull(),
  descricao: varchar("descricao", { length: 500 }).notNull(),
  valor: decimal("valor", { precision: 15, scale: 2 }).notNull(),
  tipo: bankTransactionTipoEnum("tipo").notNull(),
  categoria: varchar("categoria", { length: 100 }),
  status: bankTransactionStatusEnum("status").default("pendente").notNull(),
  externalId: varchar("external_id", { length: 255 }).unique(),
  origem: varchar("origem", { length: 20 }).default("manual").notNull(),
  // LOTE C (25/10): Cliente BPO opcional; o lançamento vinculado acompanha.
  bpoClienteId: integer("bpo_cliente_id").references(() => bpoClients.id, { onDelete: "set null" }),
  // Pedido de 25/10 (noite), item 9: quem pagou/recebeu e o texto completo da linha do extrato.
  titular: varchar("titular", { length: 255 }),
  descricaoOriginal: text("descricao_original"),
  identificadorBancario: varchar("identificador_bancario", { length: 255 }),
  // Item 14: id do pagamento do Asaas que gerou o crédito (reconcilia com a cobrança).
  asaasPaymentId: varchar("asaas_payment_id", { length: 60 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type BankTransaction =typeof bankTransactions.$inferSelect;
export type InsertBankTransaction = typeof bankTransactions.$inferInsert;

export const imovelStatusEnum = pgEnum("imovel_status", [
  "disponivel",
  "reservado",
  "vendido",
  "alugado",
]);

export const imoveis = pgTable("imoveis", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  titulo: varchar("titulo", { length: 255 }).notNull(),
  descricao: text("descricao"),
  tipo: varchar("tipo", { length: 100 }).notNull(),
  status: imovelStatusEnum("status").default("disponivel").notNull(),
  preco: decimal("preco", { precision: 15, scale: 2 }).notNull(),
  quartos: integer("quartos"),
  banheiros: integer("banheiros"),
  vagas: integer("vagas"),
  areaM2: decimal("area_m2", { precision: 10, scale: 2 }),
  endereco: text("endereco"),
  bairro: varchar("bairro", { length: 100 }),
  cidade: varchar("cidade", { length: 100 }).notNull(),
  estado: varchar("estado", { length: 2 }),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  fotos: text("fotos"),
  destaque: boolean("destaque").default(false).notNull(),
  publicadoSite: boolean("publicado_site").default(true).notNull(),
  // Colunas legadas dos feeds XML (retirados em 24/10); mantidas no banco, sem uso.
  publicadoZap: boolean("publicado_zap").default(false).notNull(),
  publicadoOlx: boolean("publicado_olx").default(false).notNull(),
  publicadoViva: boolean("publicado_viva").default(false).notNull(),
  publicadoChavesNaMao: boolean("publicado_chaves_na_mao")
    .default(false)
    .notNull(),
  createdByUserId: integer("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  reviewStatus: varchar("review_status", { length: 30 })
    .default("approved")
    .notNull(),
  // Item 8 (18/10): quando a revisão foi decidida — o corretor vê "Recusado" por 3 dias.
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Item 8 (18/10): imóvel recusado e excluído pelo admin continua aparecendo como
// "Recusado" para o corretor que o cadastrou, até 3 dias depois da recusa.
export const imovelRecusadoAvisos = pgTable("imovel_recusado_avisos", {
  id: serial("id").primaryKey(),
  brokerUserId: integer("broker_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  titulo: varchar("titulo", { length: 255 }).notNull(),
  recusadoEm: timestamp("recusado_em").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Pedido de 15/10: fotos de imóveis gravadas no Google Drive. A coluna "data"
// (bytea, só quando o Drive falha) é lida/gravada por SQL explícito em
// server/imovel-fotos.ts.
export const imovelFotos = pgTable("imovel_fotos", {
  id: serial("id").primaryKey(),
  imovelId: integer("imovel_id").notNull().references(() => imoveis.id, { onDelete: "cascade" }),
  mime: varchar("mime", { length: 40 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  driveFileId: varchar("drive_file_id", { length: 255 }),
  uploadKey: varchar("upload_key", { length: 100 }),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type Imovel = typeof imoveis.$inferSelect;
export type InsertImovel = typeof imoveis.$inferInsert;

// EPIC-002 — Portal do Cliente (paridade com Visita/Contrato/ChatMensagem do Santa Fé)
export const portalVisits = pgTable("portal_visits", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => leads.id, {
    onDelete: "set null",
  }),
  clientName: varchar("client_name", { length: 255 }).default("").notNull(),
  clientPhone: varchar("client_phone", { length: 40 }).default("").notNull(),
  brokerId: integer("broker_id").references(() => users.id, {
    onDelete: "set null",
  }),
  propertyId: integer("property_id").references(() => imoveis.id, {
    onDelete: "set null",
  }),
  scheduledAt: timestamp("scheduled_at").notNull(),
  status: varchar("status", { length: 30 }).default("agendada").notNull(),
  visitType: varchar("visit_type", { length: 40 }).default("imovel").notNull(),
  responsibleName: varchar("responsible_name", { length: 255 }),
  notes: text("notes").default("").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type PortalVisit = typeof portalVisits.$inferSelect;

// Etapa 4: directory metadata is separate from authentication and permissions.
export const brokerProfiles = pgTable("broker_profiles", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  specialties: text("specialties").default("[]").notNull(),
  notes: text("notes").default("").notNull(),
  // EPIC-020 Lote 3: percentual padrão de comissão do corretor (0–100).
  defaultCommissionPct: decimal("default_commission_pct", { precision: 7, scale: 4 }),
});

export const operationalCommissions = pgTable("operational_commissions", {
  id: serial("id").primaryKey(),
  beneficiary: varchar("beneficiary", { length: 20 }).notNull(),
  businessType: varchar("business_type", { length: 60 }).notNull(),
  brokerId: integer("broker_id").references(() => users.id, {
    onDelete: "set null",
  }),
  // EPIC-018: o negócio aponta para um imóvel ou obra cadastrados; `property`
  // guarda o título no momento do cadastro (e o texto livre de registros antigos).
  propertyId: integer("property_id").references(() => imoveis.id, {
    onDelete: "set null",
  }),
  constructionProjectId: integer("construction_project_id").references(
    () => constructionProjects.id,
    { onDelete: "set null" }
  ),
  property: varchar("property", { length: 255 }).notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  percent: decimal("percent", { precision: 5, scale: 2 }).notNull(),
  status: varchar("status", { length: 30 }).default("pendente").notNull(),
  dueDate: timestamp("due_date").notNull(),
  paidAt: timestamp("paid_at"),
  notes: text("notes").default("").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const operationalProjects = pgTable("operational_projects", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  types: text("types").default("[]").notNull(),
  status: varchar("status", { length: 40 }).default("orcamento").notNull(),
  clientName: varchar("client_name", { length: 255 }).notNull(),
  clientPhone: varchar("client_phone", { length: 40 }).notNull(),
  engineer: varchar("engineer", { length: 255 }).notNull(),
  /** Item 07: colaborador (ou admin) ativo vinculado como engenheiro; `engineer` guarda o nome exibido. */
  engineerUserId: integer("engineer_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  /** CREA/CAU ou outra habilitação técnica, quando necessária. */
  engineerRegistration: varchar("engineer_registration", { length: 60 }),
  value: decimal("value", { precision: 15, scale: 2 }).notNull(),
  paidValue: decimal("paid_value", { precision: 15, scale: 2 })
    .default("0")
    .notNull(),
  deadline: timestamp("deadline"),
  leadId: integer("lead_id").references(() => leads.id, {
    onDelete: "set null",
  }),
  leadServiceId: integer("lead_service_id").references(() => leadServices.id, {
    onDelete: "set null",
  }),
  description: text("description").default("").notNull(),
  checklist: text("checklist").default("[]").notNull(),
  files: text("files").default("[]").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Lote 23/10, etapa 2C: pedidos de revisão de projeto (migração 0066).
export const projectRevisionRequests = pgTable("project_revision_requests", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => operationalProjects.id, { onDelete: "cascade" }),
  requestedByUserId: integer("requested_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  requestedByName: varchar("requested_by_name", { length: 255 }).notNull(),
  requestText: text("request_text").notNull(),
  status: varchar("status", { length: 20 }).default("pendente").notNull(),
  previousProjectStatus: varchar("previous_project_status", { length: 40 }),
  engineerUserId: integer("engineer_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  notificationStatus: varchar("notification_status", { length: 20 }).notNull(),
  emailStatus: varchar("email_status", { length: 20 }).notNull(),
  deliveries: text("deliveries").default("[]").notNull(),
  deliveredAt: timestamp("delivered_at"),
  deliveredByUserId: integer("delivered_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Arquivos normalizados do módulo Projetos; o JSON legado permanece como cache de compatibilidade. */
export const projectDocuments = pgTable("project_documents", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => operationalProjects.id, { onDelete: "cascade" }),
  revisionId: integer("revision_id").references(() => projectRevisionRequests.id, { onDelete: "set null" }),
  itemId: varchar("item_id", { length: 100 }).notNull(),
  kind: varchar("kind", { length: 20 }).notNull(),
  originalName: varchar("original_name", { length: 255 }).notNull(),
  canonicalName: varchar("canonical_name", { length: 255 }).notNull(),
  mime: varchar("mime", { length: 150 }).notNull(),
  size: integer("size").notNull(),
  version: integer("version").notNull(),
  driveFileId: varchar("drive_file_id", { length: 200 }),
  url: text("url"),
  status: varchar("status", { length: 20 }).default("uploading").notNull(),
  replacedById: integer("replaced_by_id").references((): AnyPgColumn => projectDocuments.id, { onDelete: "set null" }),
  uploadedByUserId: integer("uploaded_by_user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, table => ({
  projectItemKindVersionUnique: uniqueIndex("project_documents_project_item_kind_version_uq").on(table.projectId, table.itemId, table.kind, table.version),
  activeLookup: index("project_documents_active_idx").on(table.projectId, table.itemId, table.kind, table.status),
}));

export const portalContracts = pgTable("portal_contracts", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => leads.id, {
    onDelete: "set null",
  }),
  number: varchar("number", { length: 80 }).notNull().unique(),
  type: varchar("type", { length: 80 }).notNull(),
  status: varchar("status", { length: 30 }).default("rascunho").notNull(),
  partyA: varchar("party_a", { length: 255 }),
  partyADocument: varchar("party_a_document", { length: 40 }),
  partyB: varchar("party_b", { length: 255 }),
  partyBDocument: varchar("party_b_document", { length: 40 }),
  propertyId: integer("property_id").references(() => imoveis.id, {
    onDelete: "set null",
  }),
  value: decimal("value", { precision: 15, scale: 2 }).default("0").notNull(),
  dueAt: timestamp("due_at"),
  description: text("description"),
  clauses: text("clauses"),
  signatureStatus: varchar("signature_status", { length: 30 })
    .default("pendente")
    .notNull(),
  signatureGovId: varchar("signature_gov_id", { length: 255 }),
  signedDocumentUrl: text("signed_document_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type PortalContract = typeof portalContracts.$inferSelect;

export const portalContractDocuments = pgTable("portal_contract_documents", {
  id: serial("id").primaryKey(),
  contractId: integer("contract_id")
    .notNull()
    .references(() => portalContracts.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  url: text("url"),
  driveFileId: text("drive_file_id"),
  type: varchar("type", { length: 30 }).default("anexo").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type PortalContractDocument =
  typeof portalContractDocuments.$inferSelect;

export const portalChatMessages = pgTable("portal_chat_messages", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id")
    .notNull()
    .references(() => leads.id, { onDelete: "cascade" }),
  sender: varchar("sender", { length: 30 }).notNull(),
  text: text("text").notNull(),
  read: boolean("read").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type PortalChatMessage = typeof portalChatMessages.$inferSelect;

export const avaliacaoStatusEnum = pgEnum("avaliacao_status", [
  "solicitada",
  "vistoria",
  "elaboracao",
  "revisao",
  "entregue",
  "cancelada",
]);

export const avaliacoes = pgTable("avaliacoes", {
  id: serial("id").primaryKey(),
  numero: varchar("numero", { length: 30 }).notNull().unique(),
  tipo: varchar("tipo", { length: 50 }).notNull(),
  finalidade: varchar("finalidade", { length: 50 }).notNull(),
  status: avaliacaoStatusEnum("status").default("solicitada").notNull(),
  clienteNome: varchar("cliente_nome", { length: 255 }).notNull(),
  clienteCpf: varchar("cliente_cpf", { length: 20 }),
  clienteTel: varchar("cliente_tel", { length: 20 }).notNull(),
  clienteEmail: varchar("cliente_email", { length: 320 }),
  endereco: text("endereco").notNull(),
  bairro: varchar("bairro", { length: 100 }).notNull(),
  cidade: varchar("cidade", { length: 100 }).notNull(),
  estado: varchar("estado", { length: 2 }).notNull(),
  areaConstruida: decimal("area_construida", { precision: 10, scale: 2 }),
  areaTerreno: decimal("area_terreno", { precision: 10, scale: 2 }),
  quartos: integer("quartos"),
  banheiros: integer("banheiros"),
  vagas: integer("vagas"),
  caracteristicas: text("caracteristicas").default("").notNull(),
  metodologia: varchar("metodologia", { length: 50 })
    .default("comparativo")
    .notNull(),
  valorEstimado: decimal("valor_estimado", { precision: 15, scale: 2 }),
  avaliador: varchar("avaliador", { length: 255 }).notNull(),
  dataVistoria: timestamp("data_vistoria"),
  prazoEntrega: timestamp("prazo_entrega"),
  dataEntrega: timestamp("data_entrega"),
  observacoes: text("observacoes").default("").notNull(),
  laudo: text("laudo"),
  documentos: text("documentos").default("[]").notNull(),
  sugestaoJson: text("sugestao_json"),
  valorServico: decimal("valor_servico", { precision: 15, scale: 2 }),
  leadId: integer("lead_id").references(() => leads.id, {
    onDelete: "set null",
  }),
  leadServiceId: integer("lead_service_id").references(() => leadServices.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type Avaliacao = typeof avaliacoes.$inferSelect;
export type InsertAvaliacao = typeof avaliacoes.$inferInsert;

export const agregadorFonteEnum = pgEnum("agregador_fonte", [
  "olx",
  "zapimoveis",
  "vivareal",
  "facebook",
  "instagram",
  "google",
  "direto",
  "outro",
]);
export const agregadorStatusEnum = pgEnum("agregador_status", [
  "pendente",
  "verificado",
  "arquivado",
  "importado",
]);
export const agregadorDocumentoTipoEnum = pgEnum("agregador_documento_tipo", [
  "nenhum",
  "escritura",
  "contrato_gaveta",
  "inventario",
  "heranca",
  "financiado",
  "loteamento",
  "posse",
  "outros",
]);

export const agregadorImoveis = pgTable("agregador_imoveis", {
  id: serial("id").primaryKey(),
  titulo: varchar("titulo", { length: 255 }).notNull(),
  descricao: text("descricao"),
  preco: decimal("preco", { precision: 15, scale: 2 }),
  precoTexto: varchar("preco_texto", { length: 50 }),
  areaM2: decimal("area_m2", { precision: 10, scale: 2 }),
  tipo: varchar("tipo", { length: 100 }),
  bairro: varchar("bairro", { length: 100 }),
  cidade: varchar("cidade", { length: 100 }).notNull(),
  estado: varchar("estado", { length: 2 }).notNull(),
  fonte: agregadorFonteEnum("fonte").notNull(),
  urlFonte: text("url_fonte"),
  imagens: text("imagens").default("[]").notNull(),
  status: agregadorStatusEnum("status").default("pendente").notNull(),
  documentoTipo: agregadorDocumentoTipoEnum("documento_tipo")
    .default("nenhum")
    .notNull(),
  documentoObs: text("documento_obs"),
  contatoNome: varchar("contato_nome", { length: 255 }),
  contatoTel: varchar("contato_tel", { length: 20 }),
  notas: text("notas"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type AgregadorImovel = typeof agregadorImoveis.$inferSelect;
export type InsertAgregadorImovel = typeof agregadorImoveis.$inferInsert;

// Tabela órfã pré-existente em produção (criada antes desta trilha, nunca ligada
// a código) — declarada aqui espelhando exatamente as colunas já existentes
// (ver EPIC-008). Não gerar migration de CREATE TABLE para este bloco: a tabela
// já existe, só está sendo declarada no Drizzle.
export const incorporationStudies = pgTable("incorporation_studies", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  city: varchar("city", { length: 120 }).notNull(),
  state: varchar("state", { length: 2 }).default("MA").notNull(),
  address: text("address"),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  responsible: varchar("responsible", { length: 120 }),
  status: varchar("status", { length: 40 }).default("in_study").notNull(),
  incorporationType: varchar("incorporation_type", { length: 40 }),
  dueDiligenceJson: text("due_diligence_json"),
  propertyRef: varchar("property_ref", { length: 180 }),
  propertyRegistration: text("property_registration"),
  carRegistration: text("car_registration"),
  officialZoning: text("official_zoning"),
  zoningSource: text("zoning_source"),
  kmlUrl: text("kml_url"),
  geojson: text("geojson"),
  areaM2: decimal("area_m2", { precision: 15, scale: 2 })
    .default("0")
    .notNull(),
  perimeterM: decimal("perimeter_m", { precision: 15, scale: 2 })
    .default("0")
    .notNull(),
  appAreaM2: decimal("app_area_m2", { precision: 15, scale: 2 }),
  appWidthM: decimal("app_width_m", { precision: 15, scale: 2 }),
  appOrigin: varchar("app_origin", { length: 40 }),
  elevationJson: text("elevation_json"),
  surveyUrl: text("survey_url"),
  cutFillJson: text("cut_fill_json"),
  urbanParametersJson: text("urban_parameters_json"),
  potentialJson: text("potential_json"),
  urbanisticOpinion: text("urbanistic_opinion"),
  cityResearchJson: text("city_research_json"),
  marketStudyJson: text("market_study_json"),
  comparablePricingJson: text("comparable_pricing_json"),
  primaryResearchJson: text("primary_research_json"),
  massScenariosJson: text("mass_scenarios_json"),
  selectedScenarioId: varchar("selected_scenario_id", { length: 120 }),
  areasBoardJson: text("areas_board_json"),
  parameterizedBudgetJson: text("parameterized_budget_json"),
  landNegotiationJson: text("land_negotiation_json"),
  businessPlanJson: text("business_plan_json"),
  designersJson: text("designers_json"),
  projectApprovalJson: text("project_approval_json"),
  incorporationRegistrationJson: text("incorporation_registration_json"),
  preliminaryBudgetJson: text("preliminary_budget_json"),
  launchPlanJson: text("launch_plan_json"),
  launchSuppliersJson: text("launch_suppliers_json"),
  marketingMaterialJson: text("marketing_material_json"),
  realEstateLaunchJson: text("real_estate_launch_json"),
  executiveProjectsJson: text("executive_projects_json"),
  workBudgetJson: text("work_budget_json"),
  physicalFinancialScheduleJson: text("physical_financial_schedule_json"),
  customerServiceJson: text("customer_service_json"),
  productMixJson: text("product_mix_json"),
  feasibilityJson: text("feasibility_json"),
  scheduleJson: text("schedule_json"),
  aiOpinion: text("ai_opinion"),
  lottingJson: text("lotting_json"),
  reportsJson: text("reports_json").default("[]").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type IncorporationStudy = typeof incorporationStudies.$inferSelect;
export type InsertIncorporationStudy = typeof incorporationStudies.$inferInsert;

// Anexos do checklist: o último evento por estudo/item determina o anexo
// vigente. Arquivos antigos e desvinculações continuam auditáveis.
export const incorporationRegistrationDocuments = pgTable("incorporation_registration_documents", {
  id: serial("id").primaryKey(),
  studyId: integer("study_id").notNull().references(() => incorporationStudies.id, { onDelete: "restrict" }),
  itemId: varchar("item_id", { length: 120 }).notNull(),
  action: varchar("action", { length: 12 }).notNull(),
  driveFileId: text("drive_file_id"),
  fileName: varchar("file_name", { length: 255 }),
  mimeType: varchar("mime_type", { length: 40 }),
  fileSize: integer("file_size"),
  sha256: varchar("sha256", { length: 64 }),
  /** "drive" ou "banco" (incorporation_registration_file_data). */
  storage: varchar("storage", { length: 10 }).default("drive").notNull(),
  storageNote: varchar("storage_note", { length: 400 }),
  performedByUserId: integer("performed_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ porEstudoItem: index("incorporation_registration_documents_study_item_idx").on(t.studyId, t.itemId, t.id) }));

// Inventário comercial isolado do JSON histórico de lançamento. A transição
// de estado acontece no servidor com UPDATE condicional e evento na mesma TX.
export const incorporationUnits = pgTable("incorporation_units", {
  id: serial("id").primaryKey(),
  studyId: integer("study_id").notNull().references(() => incorporationStudies.id, { onDelete: "restrict" }),
  code: varchar("code", { length: 120 }).notNull(),
  codeKey: varchar("code_key", { length: 120 }).notNull(),
  kind: varchar("kind", { length: 40 }).notNull(),
  status: varchar("status", { length: 20 }).default("disponivel").notNull(),
  buyer: varchar("buyer", { length: 255 }),
  salePrice: decimal("sale_price", { precision: 15, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({ studyCode: uniqueIndex("incorporation_units_study_code_key_idx").on(t.studyId, t.codeKey) }));

export const incorporationUnitEvents = pgTable("incorporation_unit_events", {
  id: serial("id").primaryKey(),
  unitId: integer("unit_id").notNull().references(() => incorporationUnits.id, { onDelete: "restrict" }),
  previousStatus: varchar("previous_status", { length: 20 }),
  nextStatus: varchar("next_status", { length: 20 }).notNull(),
  buyer: varchar("buyer", { length: 255 }),
  salePrice: decimal("sale_price", { precision: 15, scale: 2 }),
  legacySaleId: varchar("legacy_sale_id", { length: 120 }),
  performedByUserId: integer("performed_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ byUnit: index("incorporation_unit_events_unit_idx").on(t.unitId, t.id) }));

// Histórico imutável do estudo. Snapshot guardado pelo trigger da migração 0038.
export const incorporationStudyVersions = pgTable("incorporation_study_versions", {
  id: serial("id").primaryKey(),
  studyId: integer("study_id").notNull(),
  revision: integer("revision").notNull(),
  snapshot: text("snapshot").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({ studyRevision: uniqueIndex("incorporation_study_versions_study_revision_idx").on(table.studyId, table.revision) }));

export const whatsappConnections = pgTable("whatsapp_connections", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  provider: varchar("provider", { length: 20 }).default("business").notNull(),
  tokenEncrypted: text("token_encrypted"),
  phoneNumberId: varchar("phone_number_id", { length: 60 }),
  numero: varchar("numero", { length: 30 }),
  status: varchar("status", { length: 20 }).default("desconectado").notNull(),
  // Pedido de 25/10: conexão por QR code (provider "evolution") usa uma instância na Evolution API.
  instancia: varchar("instancia", { length: 80 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type WhatsappConnection = typeof whatsappConnections.$inferSelect;
export type InsertWhatsappConnection = typeof whatsappConnections.$inferInsert;

export const whatsappMessages = pgTable("whatsapp_messages", {
  id: serial("id").primaryKey(),
  connectionId: integer("connection_id").notNull(),
  leadId: integer("lead_id"),
  destinatario: varchar("destinatario", { length: 30 }).notNull(),
  nomeDestinatario: varchar("nome_destinatario", { length: 255 }),
  mensagem: text("mensagem").notNull(),
  status: varchar("status", { length: 20 }).default("enviada").notNull(),
  externalId: varchar("external_id", { length: 120 }),
  erroMsg: text("erro_msg"),
  // Pedido de 25/10 (Conversas): mensagens recebidas pelo webhook da Evolution ficam aqui também.
  direcao: varchar("direcao", { length: 10 }).default("saida").notNull(),
  lida: boolean("lida").default(true).notNull(),
  // Pedido de 25/10 (noite): mídia recebida (imagem|audio|video|documento|figurinha); bytes em whatsapp_midias.
  midiaTipo: varchar("midia_tipo", { length: 20 }),
  midiaMime: varchar("midia_mime", { length: 120 }),
  midiaNome: varchar("midia_nome", { length: 255 }),
  midiaTamanho: integer("midia_tamanho"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type WhatsappMessage = typeof whatsappMessages.$inferSelect;

// Pedido de 25/10 (noite): arquivo da mídia no próprio banco (migração 0076). A coluna
// "conteudo" (bytea) é lida/gravada só por SQL explícito em server/whatsapp-midia.ts.
export const whatsappMidias = pgTable("whatsapp_midias", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull().unique().references(() => whatsappMessages.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Pedido de 25/10: servidor da Evolution API (QR code). Linha única (id = 1); chave criptografada. */
export const whatsappEvolutionSettings = pgTable("whatsapp_evolution_settings", {
  id: integer("id").primaryKey().default(1),
  url: varchar("url", { length: 500 }).notNull(),
  apiKeyEncrypted: text("api_key_encrypted").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const whatsappTemplates = pgTable("whatsapp_templates", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 80 }).notNull().unique(),
  nome: varchar("nome", { length: 120 }).notNull(),
  categoria: varchar("categoria", { length: 80 }).notNull(),
  conteudo: text("conteudo").notNull(),
  ativo: boolean("ativo").default(true).notNull(),
  criadoPorId: integer("criado_por_id"),
  atualizadoPorId: integer("atualizado_por_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type WhatsappTemplateRecord = typeof whatsappTemplates.$inferSelect;
export type InsertWhatsappMessage = typeof whatsappMessages.$inferInsert;


// ========== EPIC-020 Lote 2 — motor financeiro da Obra ==========

export const investidores = pgTable("investidores", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 255 }).notNull(),
  documento: varchar("documento", { length: 20 }),
  telefone: varchar("telefone", { length: 30 }),
  email: varchar("email", { length: 320 }),
  ativo: boolean("ativo").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const obraInvestidores = pgTable("obra_investidores", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => constructionProjects.id, { onDelete: "cascade" }),
  investidorId: integer("investidor_id").notNull().references(() => investidores.id, { onDelete: "restrict" }),
  percentual: decimal("percentual", { precision: 9, scale: 6 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Movimentos financeiros da obra. Garantias no banco (migração 0035): sem
// exclusão, histórico automático e alocação do BPO limitada ao valor pago.
export const obraMovimentos = pgTable("obra_movimentos", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => constructionProjects.id, { onDelete: "restrict" }),
  natureza: varchar("natureza", { length: 20 }).$type<"entrada" | "recebimento_cef" | "pagamento">().notNull(),
  categoria: varchar("categoria", { length: 30 }).$type<"terreno" | "comissao" | "empreiteiro" | "fornecedor" | "outros" | "nao_detalhado" | "mao_de_obra" | "material" | null>(),
  // Etapa da obra (chave de SERVICOS_PROGRESSO), só em pagamentos (migração 0050).
  etapa: varchar("etapa", { length: 40 }),
  descricao: varchar("descricao", { length: 255 }).notNull(),
  valor: decimal("valor", { precision: 15, scale: 2 }).notNull(),
  data: date("data", { mode: "string" }).notNull(),
  observacao: text("observacao"),
  origem: varchar("origem", { length: 12 }).$type<"manual" | "bpo" | "migracao">().notNull(),
  bpoLancamentoId: integer("bpo_lancamento_id").references(() => bpoLancamentos.id, { onDelete: "restrict" }),
  status: varchar("status", { length: 12 }).$type<"confirmado" | "cancelado">().default("confirmado").notNull(),
  motivoCancelamento: text("motivo_cancelamento"),
  criadoPor: integer("criado_por").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  atualizadoPor: integer("atualizado_por").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const obraMovimentosHistorico = pgTable("obra_movimentos_historico", {
  id: serial("id").primaryKey(),
  movimentoId: integer("movimento_id").notNull().references(() => obraMovimentos.id, { onDelete: "restrict" }),
  acao: varchar("acao", { length: 20 }).notNull(),
  antes: jsonb("antes"),
  depois: jsonb("depois").notNull(),
  usuarioId: integer("usuario_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ObraMovimento = typeof obraMovimentos.$inferSelect;
export type Investidor = typeof investidores.$inferSelect;

// EPIC-020 Lote 6 — Regularização: etapas livres (30) e tabela financeira (31).
// Garantias no banco (migração 0046): recebimento nunca é apagado, histórico
// automático, item com recebimento não é excluído e a alocação do BPO é somada
// com a das obras (uma transação nunca é usada duas vezes).
export const regularizacaoEtapas = pgTable("regularizacao_etapas", {
  id: serial("id").primaryKey(),
  regularizacaoId: integer("regularizacao_id").notNull().references(() => regularizacoes.id, { onDelete: "cascade" }),
  nome: varchar("nome", { length: 120 }).notNull(),
  ordem: integer("ordem").notNull(),
  progresso: integer("progresso").default(0).notNull(),
  observacoes: text("observacoes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const regularizacaoItensFinanceiros = pgTable("regularizacao_itens_financeiros", {
  id: serial("id").primaryKey(),
  regularizacaoId: integer("regularizacao_id").notNull().references(() => regularizacoes.id, { onDelete: "cascade" }),
  chavePadrao: varchar("chave_padrao", { length: 40 }),
  nome: varchar("nome", { length: 120 }).notNull(),
  grupo: varchar("grupo", { length: 20 }).$type<"durante_obra" | "casa_pronta">().notNull(),
  ordem: integer("ordem").notNull(),
  previsto: decimal("previsto", { precision: 15, scale: 2 }).default("0").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const regularizacaoRecebimentos = pgTable("regularizacao_recebimentos", {
  id: serial("id").primaryKey(),
  regularizacaoId: integer("regularizacao_id").notNull().references(() => regularizacoes.id, { onDelete: "restrict" }),
  itemId: integer("item_id").notNull(),
  valor: decimal("valor", { precision: 15, scale: 2 }).notNull(),
  data: date("data", { mode: "string" }).notNull(),
  observacao: text("observacao"),
  origem: varchar("origem", { length: 12 }).$type<"manual" | "bpo" | "migracao">().notNull(),
  bpoLancamentoId: integer("bpo_lancamento_id").references(() => bpoLancamentos.id, { onDelete: "restrict" }),
  status: varchar("status", { length: 12 }).$type<"confirmado" | "cancelado">().default("confirmado").notNull(),
  motivoCancelamento: text("motivo_cancelamento"),
  criadoPor: integer("criado_por").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  atualizadoPor: integer("atualizado_por").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const regularizacaoRecebimentosHistorico = pgTable("regularizacao_recebimentos_historico", {
  id: serial("id").primaryKey(),
  recebimentoId: integer("recebimento_id").notNull().references(() => regularizacaoRecebimentos.id, { onDelete: "restrict" }),
  acao: varchar("acao", { length: 20 }).notNull(),
  antes: jsonb("antes"),
  depois: jsonb("depois").notNull(),
  usuarioId: integer("usuario_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
