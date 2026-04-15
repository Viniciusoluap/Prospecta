import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  longtext,
  decimal,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  cpf: varchar("cpf", { length: 14 }), // CPF do usuário (formato: 000.000.000-00)
  phone: varchar("phone", { length: 20 }), // Telefone do usuário
  address: text("address"), // Endereço completo
  city: varchar("city", { length: 100 }), // Cidade
  state: varchar("state", { length: 2 }), // Estado (UF)
  zipCode: varchar("zipCode", { length: 10 }), // CEP
  avatarUrl: text("avatarUrl"), // URL da foto de perfil
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Sorteios (campanhas de arrecadação)
 */
export const draws = mysqlTable("draws", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  prizeAmount: int("prize_amount").notNull(), // Quantidade de UTEFs premiados
  ticketPrice: int("ticket_price").notNull(), // Preço do bilhete em centavos (R$ 2,00 = 200)
  targetAmount: int("target_amount").notNull(), // Meta de arrecadação em centavos
  currentAmount: int("current_amount").default(0).notNull(), // Valor arrecadado em centavos
  ticketsSold: int("tickets_sold").default(0).notNull(),
  status: mysqlEnum("status", ["active", "closed", "drawn"])
    .default("active")
    .notNull(),
  drawDate: timestamp("draw_date"), // Data prevista do sorteio
  winnerUserId: int("winner_user_id"), // ID do usuário ganhador
  lotteryResult: varchar("lottery_result", { length: 10 }), // Resultado da Loteria Federal usado
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type Draw = typeof draws.$inferSelect;
export type InsertDraw = typeof draws.$inferInsert;

/**
 * Bilhetes de participação
 */
export const tickets = mysqlTable("tickets", {
  id: int("id").autoincrement().primaryKey(),
  drawId: int("draw_id").notNull(),
  userId: int("user_id").notNull(),
  ticketNumber: varchar("ticket_number", { length: 50 }).notNull().unique(), // Número único do bilhete
  quantity: int("quantity").default(1).notNull(), // Quantidade de bilhetes comprados
  totalPaid: int("total_paid").notNull(), // Valor pago em centavos
  paymentStatus: mysqlEnum("payment_status", ["pending", "confirmed", "failed"])
    .default("pending")
    .notNull(),
  paymentMethod: varchar("payment_method", { length: 50 }).default("pix"),
  pixQrCode: longtext("pix_qr_code"), // QR Code PIX gerado (base64 image)
  pixCopyPaste: longtext("pix_copy_paste"), // Código PIX copia e cola
  stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }), // ID do Asaas Payment
  stripeCheckoutSessionId: varchar("stripe_checkout_session_id", {
    length: 255,
  }), // Campo legado (não usado)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type Ticket = typeof tickets.$inferSelect;
export type InsertTicket = typeof tickets.$inferInsert;

/**
 * Saldo de UTEF (crédito interno) dos usuários
 */
export const utefBalances = mysqlTable("utef_balances", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull().unique(),
  balance: int("balance").default(0).notNull(), // Saldo em UTEFs (inteiro)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type UtefBalance = typeof utefBalances.$inferSelect;
export type InsertUtefBalance = typeof utefBalances.$inferInsert;

/**
 * Histórico de transações de UTEF
 */
export const utefTransactions = mysqlTable("utef_transactions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  amount: int("amount").notNull(), // Quantidade de UTEFs (positivo = crédito, negativo = débito)
  type: mysqlEnum("type", [
    "prize",
    "conversion",
    "adjustment",
    "purchase",
  ]).notNull(),
  description: text("description"),
  relatedId: int("related_id"), // ID relacionado (ex: drawId, productId)
  referenceId: varchar("reference_id", { length: 255 }), // ID de referência externa (ex: txId do PIX, session do Stripe)
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type UtefTransaction = typeof utefTransactions.$inferSelect;
export type InsertUtefTransaction = typeof utefTransactions.$inferInsert;

/**
 * Produtos do ecossistema (imóveis, serviços, embarcações)
 */
export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  category: mysqlEnum("category", [
    "real_estate",
    "financial",
    "nautical",
  ]).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  priceUtef: int("price_utef").notNull(), // Preço em UTEFs
  imageUrl: text("image_url"),
  details: text("details"), // JSON com detalhes específicos do produto
  status: mysqlEnum("status", ["available", "unavailable"])
    .default("available")
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

/**
 * Conversões de UTEF em produtos
 */
export const productConversions = mysqlTable("product_conversions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  productId: int("product_id").notNull(),
  utefAmount: int("utef_amount").notNull(), // Quantidade de UTEFs utilizados
  status: mysqlEnum("status", ["pending", "completed", "cancelled"])
    .default("pending")
    .notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type ProductConversion = typeof productConversions.$inferSelect;
export type InsertProductConversion = typeof productConversions.$inferInsert;

/**
 * Empreiteiros (Contractors) — dinâmicos por obra/região
 */
export const contractors = mysqlTable("contractors", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 20 }),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 2 }),
  specialties: text("specialties"), // JSON array
  contractType: varchar("contract_type", { length: 100 }), // "mao_de_obra" | "completo" | "material_mao_de_obra"
  status: mysqlEnum("status", ["active", "inactive"])
    .default("active")
    .notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type Contractor = typeof contractors.$inferSelect;
export type InsertContractor = typeof contractors.$inferInsert;

/**
 * Projetos de construção (obras) — Planilha PROSPECTA CONSTRUÇÕES
 */
export const constructionProjects = mysqlTable("construction_projects", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(), // Cliente proprietário
  contractorId: int("contractor_id"), // FK para contractors
  title: varchar("title", { length: 255 }).notNull(),
  address: text("address"),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 2 }),
  projectType: varchar("project_type", { length: 100 }),
  totalArea: int("total_area"),

  // Planilha: Status ampliado
  status: mysqlEnum("status", [
    "planning", // Planejamento
    "alvara", // Aguardando Alvará
    "art", // ART
    "assinatura_cef", // Assinatura CEF
    "vistoria_cef", // Vistoria CEF
    "laudo_ok", // Laudo OK
    "cartorio", // Cartório
    "in_progress", // Em andamento
    "casa_pronta", // Casa Pronta
    "disponivel", // Disponível (lote sem cliente)
    "reavaliar", // Reavaliar
    "distrato", // Distrato
    "paused",
    "completed",
    "cancelled",
  ])
    .default("planning")
    .notNull(),
  progress: int("progress").default(0).notNull(), // % concluído

  // Planilha: Financiamento CEF/MCMV
  vgv: decimal("vgv", { precision: 15, scale: 2 }), // Valor Geral de Vendas
  financedAmount: decimal("financed_amount", { precision: 15, scale: 2 }), // Vlr Financiado
  fgtsAmount: decimal("fgts_amount", { precision: 15, scale: 2 }), // FGTS
  subsidyAmount: decimal("subsidy_amount", { precision: 15, scale: 2 }), // Subsídio
  downPaymentTotal: decimal("down_payment_total", { precision: 15, scale: 2 }), // Entrada total
  downPaymentPaid: decimal("down_payment_paid", { precision: 15, scale: 2 }), // Entrada já paga
  plsPercentage: decimal("pls_percentage", { precision: 7, scale: 4 }), // % PLS CEF
  realReceivedPercentage: decimal("real_received_pct", {
    precision: 7,
    scale: 4,
  }), // % Real Recebida
  cefReceivedAmount: decimal("cef_received_amount", {
    precision: 15,
    scale: 2,
  }), // Vlr Recebido CEF
  constructionSpent: decimal("construction_spent", { precision: 15, scale: 2 }), // Vlr Gasto Obra
  lotCost: decimal("lot_cost", { precision: 15, scale: 2 }), // Custo do Lote

  // Planilha: Corretor
  brokerName: varchar("broker_name", { length: 255 }),
  brokerPaid: decimal("broker_paid", { precision: 15, scale: 2 }).default("0"),

  // Planilha: Custos e lucros
  constructionCost: decimal("construction_cost", { precision: 15, scale: 2 }), // Custo de Obra
  estimatedProfit: decimal("estimated_profit", { precision: 15, scale: 2 }), // Lucro Estimado
  investorProfit: decimal("investor_profit", { precision: 15, scale: 2 }), // Lucro Investidor
  prospectaProfit: decimal("prospecta_profit", { precision: 15, scale: 2 }), // Lucro Prospecta

  // Planilha: Pro Soluto / Parcelamento
  proSoluto: decimal("pro_soluto", { precision: 15, scale: 2 }).default("0"),
  installmentRate: decimal("installment_rate", { precision: 7, scale: 4 }), // Taxa %
  installmentQty: int("installment_qty"), // Qtd pcl
  installmentValue: decimal("installment_value", { precision: 15, scale: 2 }), // Vlr pcl

  // Planilha: Datas
  startDate: timestamp("start_date"),
  constructionDays: int("construction_days"),
  estimatedEndDate: timestamp("estimated_end_date"),
  actualEndDate: timestamp("actual_end_date"),

  // Campos legados mantidos
  contractValue: decimal("contract_value", { precision: 15, scale: 2 }),
  contractType: varchar("contract_type", { length: 100 }),
  notes: text("notes"),
  extraNotes: text("extra_notes"), // Observações extras (como "Ageu - Alessandra" na planilha)

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type ConstructionProject = typeof constructionProjects.$inferSelect;
export type InsertConstructionProject =
  typeof constructionProjects.$inferInsert;

/**
 * Etapas da obra (fundação, estrutura, acabamento, etc.)
 */
export const constructionStages = mysqlTable("construction_stages", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull(), // Referência ao projeto
  name: varchar("name", { length: 255 }).notNull(), // Ex: "Fundação", "Alvenaria", "Acabamento"
  description: text("description"), // Descrição da etapa
  orderIndex: int("order_index").notNull(), // Ordem de execução (1, 2, 3...)
  status: mysqlEnum("status", ["pending", "in_progress", "completed"])
    .default("pending")
    .notNull(),
  startDate: timestamp("start_date"), // Data de início da etapa
  endDate: timestamp("end_date"), // Data de conclusão da etapa
  estimatedCost: int("estimated_cost"), // Custo estimado em centavos
  actualCost: int("actual_cost"), // Custo real em centavos
  notes: text("notes"), // Observações da etapa
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type ConstructionStage = typeof constructionStages.$inferSelect;
export type InsertConstructionStage = typeof constructionStages.$inferInsert;

/**
 * Fotos do progresso da obra
 */
export const constructionPhotos = mysqlTable("construction_photos", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull(), // Referência ao projeto
  stageId: int("stage_id"), // Referência à etapa (opcional)
  imageUrl: text("image_url").notNull(), // URL da foto no S3
  caption: text("caption"), // Legenda da foto
  takenAt: timestamp("taken_at").notNull(), // Data em que a foto foi tirada
  uploadedBy: int("uploaded_by"), // ID do usuário que fez upload (admin ou proprietário)
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ConstructionPhoto = typeof constructionPhotos.$inferSelect;
export type InsertConstructionPhoto = typeof constructionPhotos.$inferInsert;

/**
 * Solicitações de orçamento de projetos
 */
export const projectBudgetRequests = mysqlTable("project_budget_requests", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id"), // ID do usuário (se logado)
  name: varchar("name", { length: 255 }).notNull(), // Nome do solicitante
  email: varchar("email", { length: 320 }).notNull(), // Email do solicitante
  phone: varchar("phone", { length: 20 }), // Telefone
  city: varchar("city", { length: 255 }), // Cidade
  projectType: varchar("project_type", { length: 100 }), // Ex: "Casa 47m²", "Casa 60m²"
  hasLot: mysqlEnum("has_lot", ["yes", "no", "not_sure"]), // Possui terreno?
  message: text("message"), // Mensagem adicional
  status: mysqlEnum("status", [
    "pending",
    "contacted",
    "in_negotiation",
    "converted",
    "cancelled",
  ])
    .default("pending")
    .notNull(),
  adminNotes: text("admin_notes"), // Observações do admin
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type ProjectBudgetRequest = typeof projectBudgetRequests.$inferSelect;
export type InsertProjectBudgetRequest =
  typeof projectBudgetRequests.$inferInsert;

/**
 * Log de emails enviados (ou agendados para envio)
 */
export const emailLogs = mysqlTable("email_logs", {
  id: int("id").autoincrement().primaryKey(),
  recipientEmail: varchar("recipient_email", { length: 320 }).notNull(),
  recipientName: varchar("recipient_name", { length: 255 }),
  subject: varchar("subject", { length: 500 }).notNull(),
  templateType: mysqlEnum("template_type", [
    "welcome",
    "budget_confirmation",
    "budget_update",
    "draw_winner",
    "promotional_campaign",
    "payment_confirmation",
  ]).notNull(),
  htmlContent: text("html_content").notNull(),
  status: mysqlEnum("status", ["pending", "sent", "failed"])
    .default("pending")
    .notNull(),
  sentAt: timestamp("sent_at"),
  errorMessage: text("error_message"),
  metadata: text("metadata"), // JSON com dados adicionais (ID do orçamento, sorteio, etc.)
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type EmailLog = typeof emailLogs.$inferSelect;
export type InsertEmailLog = typeof emailLogs.$inferInsert;

/**
 * Notificações in-app para usuários
 */
export const userNotifications = mysqlTable("user_notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(), // ID do usuário destinatário
  title: varchar("title", { length: 255 }).notNull(), // Título da notificação
  message: text("message").notNull(), // Mensagem da notificação
  type: mysqlEnum("type", [
    "draw_result", // Resultado de sorteio
    "utef_update", // Atualização de saldo UTEF
    "construction_update", // Atualização de obra
    "system", // Notificação do sistema
    "promotional", // Notificação promocional
  ]).notNull(),
  isRead: int("is_read").default(0).notNull(), // 0 = não lida, 1 = lida
  relatedId: int("related_id"), // ID relacionado (sorteio, obra, etc.)
  actionUrl: varchar("action_url", { length: 500 }), // URL para ação (opcional)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  readAt: timestamp("read_at"), // Data/hora de leitura
});

export type UserNotification = typeof userNotifications.$inferSelect;
export type InsertUserNotification = typeof userNotifications.$inferInsert;

// ============================================================
// NOVOS MÓDULOS — VFX CAPITAL / PROSPECTA
// ============================================================

/**
 * Taxas administrativas por obra — Planilha "Taxas de Obras"
 * Ex: Projetos, PCI, ART, Alvará, Vistoria CEF, ITBI, Registro Cartório...
 */
export const obraFees = mysqlTable("obra_fees", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull(),
  feeType: varchar("fee_type", { length: 100 }).notNull(), // "projetos" | "pci" | "art" | "alvara" | etc.
  estimatedValue: decimal("estimated_value", {
    precision: 15,
    scale: 2,
  }).default("0"),
  paidValue: decimal("paid_value", { precision: 15, scale: 2 }).default("0"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type ObraFee = typeof obraFees.$inferSelect;
export type InsertObraFee = typeof obraFees.$inferInsert;

/**
 * Medições por etapa/empreiteiro
 */
export const obraMeasurements = mysqlTable("obra_measurements", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull(),
  contractorId: int("contractor_id"),
  stageId: int("stage_id"),
  measurementDate: timestamp("measurement_date").notNull(),
  value: decimal("value", { precision: 15, scale: 2 }).notNull(),
  status: mysqlEnum("status", ["pending", "approved", "paid"])
    .default("pending")
    .notNull(),
  notes: text("notes"),
  approvedBy: int("approved_by"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ObraMeasurement = typeof obraMeasurements.$inferSelect;
export type InsertObraMeasurement = typeof obraMeasurements.$inferInsert;

/**
 * Controle de Lotes — Planilha "Compra de Lotes"
 * Residencial Aurora, Morada do Bosque, Jet Reginaldo, etc.
 */
export const lots = mysqlTable("lots", {
  id: int("id").autoincrement().primaryKey(),
  lotNumber: varchar("lot_number", { length: 50 }).notNull(), // Ex: "LOTE 20"
  development: varchar("development", { length: 255 }).notNull(), // Ex: "Residencial Aurora"
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 2 }),
  assessmentValue: decimal("assessment_value", { precision: 15, scale: 2 }), // Valor de Avaliação
  cefPaymentValue: decimal("cef_payment_value", { precision: 15, scale: 2 }), // Valor Pago pela CEF
  sellerCost: decimal("seller_cost", { precision: 15, scale: 2 }), // Valor pago ao vendedor
  sellerName: varchar("seller_name", { length: 255 }), // Ex: Edimar, Daniel, Exclusive
  prospectaMargin: decimal("prospecta_margin", { precision: 15, scale: 2 }), // Valor Prospecta (lucro)
  status: mysqlEnum("status", ["available", "reserved", "sold"])
    .default("available")
    .notNull(),
  assignedProjectId: int("assigned_project_id"), // FK para constructionProjects
  assignedClientName: varchar("assigned_client_name", { length: 255 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type Lot = typeof lots.$inferSelect;
export type InsertLot = typeof lots.$inferInsert;

/**
 * Investidores da Prospecta — Planilha "Investidores"
 */
export const investors = mysqlTable("investors", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  initialDate: timestamp("initial_date").notNull(),
  initialAmount: decimal("initial_amount", {
    precision: 15,
    scale: 2,
  }).notNull(),
  currentBalance: decimal("current_balance", {
    precision: 15,
    scale: 2,
  }).notNull(),
  monthlyRate: decimal("monthly_rate", { precision: 7, scale: 4 }).default("0"), // Taxa % ao mês
  status: mysqlEnum("status", ["active", "withdrawn", "extended"])
    .default("active")
    .notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type Investor = typeof investors.$inferSelect;
export type InsertInvestor = typeof investors.$inferInsert;

/**
 * Transações dos investidores (prorrogações, saques, juros)
 */
export const investorTransactions = mysqlTable("investor_transactions", {
  id: int("id").autoincrement().primaryKey(),
  investorId: int("investor_id").notNull(),
  type: mysqlEnum("type", [
    "deposit",
    "withdrawal",
    "interest",
    "extension",
  ]).notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  date: timestamp("date").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type InvestorTransaction = typeof investorTransactions.$inferSelect;
export type InsertInvestorTransaction =
  typeof investorTransactions.$inferInsert;

/**
 * Controle de Corretores — Planilha "Corretores"
 * Comissão paga em até 4 parcelas
 */
export const brokerCommissions = mysqlTable("broker_commissions", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id"),
  clientName: varchar("client_name", { length: 255 }).notNull(),
  brokerName: varchar("broker_name", { length: 255 }).notNull(),
  totalCommission: decimal("total_commission", {
    precision: 15,
    scale: 2,
  }).notNull(),
  // Parcelas (até 4)
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
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type BrokerCommission = typeof brokerCommissions.$inferSelect;
export type InsertBrokerCommission = typeof brokerCommissions.$inferInsert;

/**
 * CRM — Leads (substitui Trello)
 * Pipeline completo de atendimento da Prospecta
 */
export const leads = mysqlTable("leads", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 20 }).notNull(),
  email: varchar("email", { length: 320 }),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 2 }),

  // Classificação
  type: mysqlEnum("type", [
    "new_lead", // Lead novo (Fluxo A)
    "in_process", // Cliente em processo (Fluxo B)
    "broker", // Corretor (Fluxo C)
    "employee", // Funcionário interno (Fluxo D)
    "supplier", // Fornecedor/Empreiteiro (Fluxo E)
    "vip", // Cotista VIP (Fluxo F)
  ])
    .default("new_lead")
    .notNull(),
  temperature: mysqlEnum("temperature", ["cold", "warm", "hot"])
    .default("cold")
    .notNull(),

  // Pipeline — 11 estágios (substitui Trello)
  stage: mysqlEnum("stage", [
    "lead_new", // Lead Novo
    "attending", // Em Atendimento
    "waiting_docs", // Aguardando Documentação
    "analysis", // Em Análise / Simulação
    "caixa_register", // Em Cadastro (Caixa)
    "approval", // Em Aprovação
    "approved", // Aprovado
    "rejected", // Reprovado
    "followup", // Follow-up
    "in_process", // Cliente em Processo
    "done", // Concluído
  ])
    .default("lead_new")
    .notNull(),

  // Responsável (roteamento por cidade)
  responsible: mysqlEnum("responsible", ["sarah", "vinicius", "bianca"])
    .default("sarah")
    .notNull(),

  // Qualificação financeira
  income: decimal("income", { precision: 15, scale: 2 }),
  incomeType: mysqlEnum("income_type", ["formal", "informal", "irpf"]),
  fgtsAmount: decimal("fgts_amount", { precision: 15, scale: 2 }),
  pisFgts: varchar("pis_fgts", { length: 20 }),
  hasSpouse: int("has_spouse").default(0), // 0 = não, 1 = sim
  spouseName: varchar("spouse_name", { length: 255 }),
  incomeComposition: int("income_composition").default(0), // composição de renda

  // Resultado da análise
  cpfStatus: mysqlEnum("cpf_status", [
    "clean",
    "restricted",
    "unknown",
  ]).default("unknown"),
  simulationValue: decimal("simulation_value", { precision: 15, scale: 2 }), // Valor simulação
  approvedValue: decimal("approved_value", { precision: 15, scale: 2 }), // Valor aprovado
  contractType: mysqlEnum("contract_type", ["obra", "financing", "both"]),

  // Canais e origem
  sourceChannel: varchar("source_channel", { length: 100 }), // WhatsApp, site, indicação...
  sourceCity: varchar("source_city", { length: 100 }),

  // LGPD
  lgpdConsent: int("lgpd_consent").default(0),
  lgpdConsentAt: timestamp("lgpd_consent_at"),

  // Follow-up
  rejectionReason: text("rejection_reason"),
  followupDate: timestamp("followup_date"), // Data do próximo follow-up (6 meses para reprovados)

  notes: text("notes"),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;

/**
 * Atividades/histórico do lead (timeline)
 */
export const leadActivities = mysqlTable("lead_activities", {
  id: int("id").autoincrement().primaryKey(),
  leadId: int("lead_id").notNull(),
  type: mysqlEnum("type", [
    "message",
    "call",
    "document",
    "status_change",
    "note",
    "handoff",
    "follow_up",
    "simulation",
    "caixa_register",
  ]).notNull(),
  description: text("description").notNull(),
  performedBy: varchar("performed_by", { length: 100 }), // "sarah" | "vinicius" | "bianca" | "dolores"
  metadata: text("metadata"), // JSON extra
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type LeadActivity = typeof leadActivities.$inferSelect;
export type InsertLeadActivity = typeof leadActivities.$inferInsert;

/**
 * Documentos do lead (checklist MCMV)
 */
export const leadDocuments = mysqlTable("lead_documents", {
  id: int("id").autoincrement().primaryKey(),
  leadId: int("lead_id").notNull(),
  type: mysqlEnum("type", [
    "rg",
    "cnh",
    "address_proof",
    "income_proof_formal",
    "income_proof_irpf",
    "fgts",
    "spouse_docs",
    "pis",
    "other",
  ]).notNull(),
  fileName: varchar("file_name", { length: 255 }),
  fileUrl: text("file_url"),
  status: mysqlEnum("status", ["pending", "received", "approved", "rejected"])
    .default("pending")
    .notNull(),
  notes: text("notes"),
  uploadedAt: timestamp("uploaded_at"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type LeadDocument = typeof leadDocuments.$inferSelect;
export type InsertLeadDocument = typeof leadDocuments.$inferInsert;

/**
 * Follow-ups automáticos (10 tentativas × 3 sub-tentativas)
 */
export const leadFollowUps = mysqlTable("lead_follow_ups", {
  id: int("id").autoincrement().primaryKey(),
  leadId: int("lead_id").notNull(),
  attempt: int("attempt").notNull(), // 1 a 10
  subAttempt: int("sub_attempt").notNull(), // 1 a 3 (a cada 2h dentro do dia)
  scheduledAt: timestamp("scheduled_at").notNull(),
  executedAt: timestamp("executed_at"),
  status: mysqlEnum("status", [
    "pending",
    "sent",
    "responded",
    "failed",
    "cancelled",
  ])
    .default("pending")
    .notNull(),
  message: text("message"), // Mensagem enviada
  response: text("response"), // Resposta recebida (se houver)
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type LeadFollowUp = typeof leadFollowUps.$inferSelect;
export type InsertLeadFollowUp = typeof leadFollowUps.$inferInsert;

/**
 * Tarefas internas — SLA por nível (operacional 2h, técnico 6h, estratégico 24h)
 */
export const tasks = mysqlTable("tasks", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  assignedTo: varchar("assigned_to", { length: 100 }).notNull(), // "sarah" | "vinicius" | etc.
  relatedType: mysqlEnum("related_type", [
    "lead",
    "obra",
    "budget",
    "financial",
    "general",
  ]),
  relatedId: int("related_id"),
  priority: mysqlEnum("priority", ["low", "medium", "high", "critical"])
    .default("medium")
    .notNull(),
  status: mysqlEnum("status", ["pending", "in_progress", "done", "cancelled"])
    .default("pending")
    .notNull(),
  slaHours: int("sla_hours").default(24), // SLA em horas
  dueAt: timestamp("due_at"),
  completedAt: timestamp("completed_at"),
  escalatedToVinicius: int("escalated_to_vinicius").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type Task = typeof tasks.$inferSelect;
export type InsertTask = typeof tasks.$inferInsert;

/**
 * Distribuição de lucro para sócios
 * Cleidson: 33% financeiro local, 50% obras locais
 * Francisco: 33% financeiro local
 */
export const partnerDistributions = mysqlTable("partner_distributions", {
  id: int("id").autoincrement().primaryKey(),
  partnerName: varchar("partner_name", { length: 255 }).notNull(), // "Cleidson" | "Francisco"
  referenceType: mysqlEnum("reference_type", [
    "obra",
    "financial",
    "other",
  ]).notNull(),
  referenceId: int("reference_id"), // projectId, leadId, etc.
  referenceDescription: varchar("reference_description", { length: 255 }),
  percentage: decimal("percentage", { precision: 5, scale: 2 }).notNull(),
  grossAmount: decimal("gross_amount", { precision: 15, scale: 2 }).notNull(), // Base de cálculo
  distributionAmount: decimal("distribution_amount", {
    precision: 15,
    scale: 2,
  }).notNull(), // Valor a distribuir
  status: mysqlEnum("status", ["pending", "paid"]).default("pending").notNull(),
  paidAt: timestamp("paid_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type PartnerDistribution = typeof partnerDistributions.$inferSelect;
export type InsertPartnerDistribution =
  typeof partnerDistributions.$inferInsert;

/**
 * Transações financeiras gerais (receitas, despesas, comissões)
 */
export const financialTransactions = mysqlTable("financial_transactions", {
  id: int("id").autoincrement().primaryKey(),
  type: mysqlEnum("type", [
    "income",
    "expense",
    "commission",
    "salary",
    "contractor_payment",
  ]).notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  category: varchar("category", { length: 100 }),
  responsible: varchar("responsible", { length: 100 }),
  referenceId: int("reference_id"),
  referenceType: varchar("reference_type", { length: 50 }),
  paidAt: timestamp("paid_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type FinancialTransaction = typeof financialTransactions.$inferSelect;
export type InsertFinancialTransaction =
  typeof financialTransactions.$inferInsert;
