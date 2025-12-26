import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, longtext } from "drizzle-orm/mysql-core";

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
  status: mysqlEnum("status", ["active", "closed", "drawn"]).default("active").notNull(),
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
  paymentStatus: mysqlEnum("payment_status", ["pending", "confirmed", "failed"]).default("pending").notNull(),
  paymentMethod: varchar("payment_method", { length: 50 }).default("pix"),
  pixQrCode: longtext("pix_qr_code"), // QR Code PIX gerado (base64 image)
  pixCopyPaste: longtext("pix_copy_paste"), // Código PIX copia e cola
  stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }), // ID do Asaas Payment
  stripeCheckoutSessionId: varchar("stripe_checkout_session_id", { length: 255 }), // Campo legado (não usado)
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
  type: mysqlEnum("type", ["prize", "conversion", "adjustment", "purchase"]).notNull(),
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
  category: mysqlEnum("category", ["real_estate", "financial", "nautical"]).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  priceUtef: int("price_utef").notNull(), // Preço em UTEFs
  imageUrl: text("image_url"),
  details: text("details"), // JSON com detalhes específicos do produto
  status: mysqlEnum("status", ["available", "unavailable"]).default("available").notNull(),
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
  status: mysqlEnum("status", ["pending", "completed", "cancelled"]).default("pending").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type ProductConversion = typeof productConversions.$inferSelect;
export type InsertProductConversion = typeof productConversions.$inferInsert;

/**
 * Projetos de construção (obras)
 */
export const constructionProjects = mysqlTable("construction_projects", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(), // Proprietário da obra
  title: varchar("title", { length: 255 }).notNull(), // Ex: "Minha Casa 47m²"
  address: text("address"), // Endereço da obra
  projectType: varchar("project_type", { length: 100 }), // Ex: "Casa 47m²", "Casa 60m²"
  totalArea: int("total_area"), // Área total em m²
  estimatedCost: int("estimated_cost"), // Custo estimado em centavos
  actualCost: int("actual_cost").default(0), // Custo real em centavos
  
  // Campos financeiros detalhados (Aba 2: Valores e Custos)
  contractValue: int("contract_value"), // Valor total do contrato em centavos
  contractType: varchar("contract_type", { length: 100 }), // Ex: "Empreitada Global", "Administração"
  contractorPayment: int("contractor_payment"), // Pagamento do empreiteiro em centavos
  materialCost: int("material_cost"), // Custo de material em centavos
  lotCost: int("lot_cost"), // Custo do lote/terreno em centavos
  commissionCost: int("commission_cost"), // Comissão em centavos
  extrasCost: int("extras_cost"), // Custos extras em centavos
  maintenanceCost: int("maintenance_cost"), // Custo de manutenção em centavos
  insuranceCost: int("insurance_cost"), // Custo de seguro em centavos
  balanceAmount: int("balance_amount"), // Saldo restante em centavos
  
  startDate: timestamp("start_date"), // Data de início da obra
  estimatedEndDate: timestamp("estimated_end_date"), // Data prevista de conclusão
  actualEndDate: timestamp("actual_end_date"), // Data real de conclusão
  status: mysqlEnum("status", ["planning", "in_progress", "paused", "completed", "cancelled"]).default("planning").notNull(),
  progress: int("progress").default(0).notNull(), // Progresso em % (0-100)
  notes: text("notes"), // Observações gerais
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type ConstructionProject = typeof constructionProjects.$inferSelect;
export type InsertConstructionProject = typeof constructionProjects.$inferInsert;

/**
 * Etapas da obra (fundação, estrutura, acabamento, etc.)
 */
export const constructionStages = mysqlTable("construction_stages", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull(), // Referência ao projeto
  name: varchar("name", { length: 255 }).notNull(), // Ex: "Fundação", "Alvenaria", "Acabamento"
  description: text("description"), // Descrição da etapa
  orderIndex: int("order_index").notNull(), // Ordem de execução (1, 2, 3...)
  status: mysqlEnum("status", ["pending", "in_progress", "completed"]).default("pending").notNull(),
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
  status: mysqlEnum("status", ["pending", "contacted", "in_negotiation", "converted", "cancelled"]).default("pending").notNull(),
  adminNotes: text("admin_notes"), // Observações do admin
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type ProjectBudgetRequest = typeof projectBudgetRequests.$inferSelect;
export type InsertProjectBudgetRequest = typeof projectBudgetRequests.$inferInsert;


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
    "payment_confirmation"
  ]).notNull(),
  htmlContent: text("html_content").notNull(),
  status: mysqlEnum("status", ["pending", "sent", "failed"]).default("pending").notNull(),
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
    "promotional" // Notificação promocional
  ]).notNull(),
  isRead: int("is_read").default(0).notNull(), // 0 = não lida, 1 = lida
  relatedId: int("related_id"), // ID relacionado (sorteio, obra, etc.)
  actionUrl: varchar("action_url", { length: 500 }), // URL para ação (opcional)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  readAt: timestamp("read_at"), // Data/hora de leitura
});

export type UserNotification = typeof userNotifications.$inferSelect;
export type InsertUserNotification = typeof userNotifications.$inferInsert;
