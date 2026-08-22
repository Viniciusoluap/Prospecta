import {
  pgTable, pgEnum,
  text, varchar, integer, serial, boolean,
  timestamp, decimal,
} from "drizzle-orm/pg-core";

// ──────────────────────────────────────────
// ENUMS
// ──────────────────────────────────────────
export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const drawStatusEnum = pgEnum("draw_status", ["active", "closed", "drawn"]);
export const ticketPaymentStatusEnum = pgEnum("ticket_payment_status", ["pending", "confirmed", "failed"]);
export const utefTransactionTypeEnum = pgEnum("utef_transaction_type", ["prize", "conversion", "adjustment", "purchase"]);
export const productCategoryEnum = pgEnum("product_category", ["real_estate", "financial", "nautical"]);
export const productStatusEnum = pgEnum("product_status", ["available", "unavailable"]);
export const productConversionStatusEnum = pgEnum("product_conversion_status", ["pending", "completed", "cancelled"]);
export const contractorStatusEnum = pgEnum("contractor_status", ["active", "inactive"]);
export const constructionProjectStatusEnum = pgEnum("construction_project_status", [
  "planning", "alvara", "art", "assinatura_cef", "vistoria_cef",
  "laudo_ok", "cartorio", "in_progress", "casa_pronta", "disponivel",
  "reavaliar", "distrato", "paused", "completed", "cancelled",
]);
export const constructionStageStatusEnum = pgEnum("construction_stage_status", ["pending", "in_progress", "completed"]);
export const budgetRequestHasLotEnum = pgEnum("budget_request_has_lot", ["yes", "no", "not_sure"]);
export const budgetRequestStatusEnum = pgEnum("budget_request_status", ["pending", "contacted", "in_negotiation", "converted", "cancelled"]);
export const emailTemplateTypeEnum = pgEnum("email_template_type", [
  "welcome", "budget_confirmation", "budget_update",
  "draw_winner", "promotional_campaign", "payment_confirmation",
]);
export const emailStatusEnum = pgEnum("email_status", ["pending", "sent", "failed"]);
export const notificationTypeEnum = pgEnum("notification_type", [
  "draw_result", "utef_update", "construction_update", "system", "promotional",
]);
export const obraMeasurementStatusEnum = pgEnum("obra_measurement_status", ["pending", "approved", "paid"]);
export const lotStatusEnum = pgEnum("lot_status", ["available", "reserved", "sold"]);
export const investorStatusEnum = pgEnum("investor_status", ["active", "withdrawn", "extended"]);
export const investorTransactionTypeEnum = pgEnum("investor_transaction_type", ["deposit", "withdrawal", "interest", "extension"]);
export const leadTypeEnum = pgEnum("lead_type", ["new_lead", "in_process", "broker", "employee", "supplier", "vip"]);
export const leadTemperatureEnum = pgEnum("lead_temperature", ["cold", "warm", "hot"]);
export const leadStageEnum = pgEnum("lead_stage", [
  "lead_new", "attending", "waiting_docs", "analysis",
  "caixa_register", "approval", "approved", "rejected",
  "followup", "in_process", "done",
]);
export const leadResponsibleEnum = pgEnum("lead_responsible", ["sarah", "vinicius", "bianca"]);
export const leadIncomeTypeEnum = pgEnum("lead_income_type", ["formal", "informal", "irpf"]);
export const leadCpfStatusEnum = pgEnum("lead_cpf_status", ["clean", "restricted", "unknown"]);
export const leadContractTypeEnum = pgEnum("lead_contract_type", ["obra", "financing", "both"]);
export const leadActivityTypeEnum = pgEnum("lead_activity_type", [
  "message", "call", "document", "status_change",
  "note", "handoff", "follow_up", "simulation", "caixa_register",
]);
export const leadDocTypeEnum = pgEnum("lead_doc_type", [
  "rg", "cnh", "address_proof", "income_proof_formal",
  "income_proof_irpf", "fgts", "spouse_docs", "pis", "other",
]);
export const leadDocStatusEnum = pgEnum("lead_doc_status", ["pending", "received", "approved", "rejected"]);
export const followUpStatusEnum = pgEnum("follow_up_status", ["pending", "sent", "responded", "failed", "cancelled"]);
export const taskRelatedTypeEnum = pgEnum("task_related_type", ["lead", "obra", "budget", "financial", "general"]);
export const taskPriorityEnum = pgEnum("task_priority", ["low", "medium", "high", "critical"]);
export const taskStatusEnum = pgEnum("task_status", ["pending", "in_progress", "done", "cancelled"]);
export const partnerReferenceTypeEnum = pgEnum("partner_reference_type", ["obra", "financial", "other"]);
export const partnerDistributionStatusEnum = pgEnum("partner_distribution_status", ["pending", "paid"]);
export const financialTransactionTypeEnum = pgEnum("financial_transaction_type", [
  "income", "expense", "commission", "salary", "contractor_payment",
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
  role: userRoleEnum("role").default("user").notNull(),
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
  paymentStatus: ticketPaymentStatusEnum("payment_status").default("pending").notNull(),
  paymentMethod: varchar("payment_method", { length: 50 }).default("pix"),
  pixQrCode: text("pix_qr_code"),
  pixCopyPaste: text("pix_copy_paste"),
  stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
  stripeCheckoutSessionId: varchar("stripe_checkout_session_id", { length: 255 }),
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

export const contractors = pgTable("contractors", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 20 }),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 2 }),
  specialties: text("specialties"),
  contractType: varchar("contract_type", { length: 100 }),
  status: contractorStatusEnum("status").default("active").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Contractor = typeof contractors.$inferSelect;
export type InsertContractor = typeof contractors.$inferInsert;

export const constructionProjects = pgTable("construction_projects", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  contractorId: integer("contractor_id"),
  title: varchar("title", { length: 255 }).notNull(),
  address: text("address"),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 2 }),
  projectType: varchar("project_type", { length: 100 }),
  totalArea: integer("total_area"),
  status: constructionProjectStatusEnum("status").default("planning").notNull(),
  progress: integer("progress").default(0).notNull(),
  vgv: decimal("vgv", { precision: 15, scale: 2 }),
  financedAmount: decimal("financed_amount", { precision: 15, scale: 2 }),
  fgtsAmount: decimal("fgts_amount", { precision: 15, scale: 2 }),
  subsidyAmount: decimal("subsidy_amount", { precision: 15, scale: 2 }),
  downPaymentTotal: decimal("down_payment_total", { precision: 15, scale: 2 }),
  downPaymentPaid: decimal("down_payment_paid", { precision: 15, scale: 2 }),
  plsPercentage: decimal("pls_percentage", { precision: 7, scale: 4 }),
  realReceivedPercentage: decimal("real_received_pct", { precision: 7, scale: 4 }),
  cefReceivedAmount: decimal("cef_received_amount", { precision: 15, scale: 2 }),
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
  startDate: timestamp("start_date"),
  constructionDays: integer("construction_days"),
  estimatedEndDate: timestamp("estimated_end_date"),
  actualEndDate: timestamp("actual_end_date"),
  contractValue: decimal("contract_value", { precision: 15, scale: 2 }),
  contractType: varchar("contract_type", { length: 100 }),
  notes: text("notes"),
  extraNotes: text("extra_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ConstructionProject = typeof constructionProjects.$inferSelect;
export type InsertConstructionProject = typeof constructionProjects.$inferInsert;

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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
export type InsertProjectBudgetRequest = typeof projectBudgetRequests.$inferInsert;

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
  estimatedValue: decimal("estimated_value", { precision: 15, scale: 2 }).default("0"),
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
  contractorId: integer("contractor_id"),
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

export const lots = pgTable("lots", {
  id: serial("id").primaryKey(),
  lotNumber: varchar("lot_number", { length: 50 }).notNull(),
  development: varchar("development", { length: 255 }).notNull(),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 2 }),
  assessmentValue: decimal("assessment_value", { precision: 15, scale: 2 }),
  cefPaymentValue: decimal("cef_payment_value", { precision: 15, scale: 2 }),
  sellerCost: decimal("seller_cost", { precision: 15, scale: 2 }),
  sellerName: varchar("seller_name", { length: 255 }),
  prospectaMargin: decimal("prospecta_margin", { precision: 15, scale: 2 }),
  status: lotStatusEnum("status").default("available").notNull(),
  assignedProjectId: integer("assigned_project_id"),
  assignedClientName: varchar("assigned_client_name", { length: 255 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Lot = typeof lots.$inferSelect;
export type InsertLot = typeof lots.$inferInsert;

export const investors = pgTable("investors", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  initialDate: timestamp("initial_date").notNull(),
  initialAmount: decimal("initial_amount", { precision: 15, scale: 2 }).notNull(),
  currentBalance: decimal("current_balance", { precision: 15, scale: 2 }).notNull(),
  monthlyRate: decimal("monthly_rate", { precision: 7, scale: 4 }).default("0"),
  status: investorStatusEnum("status").default("active").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Investor = typeof investors.$inferSelect;
export type InsertInvestor = typeof investors.$inferInsert;

export const investorTransactions = pgTable("investor_transactions", {
  id: serial("id").primaryKey(),
  investorId: integer("investor_id").notNull(),
  type: investorTransactionTypeEnum("type").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  date: timestamp("date").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type InvestorTransaction = typeof investorTransactions.$inferSelect;
export type InsertInvestorTransaction = typeof investorTransactions.$inferInsert;

export const brokerCommissions = pgTable("broker_commissions", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id"),
  clientName: varchar("client_name", { length: 255 }).notNull(),
  brokerName: varchar("broker_name", { length: 255 }).notNull(),
  totalCommission: decimal("total_commission", { precision: 15, scale: 2 }).notNull(),
  installment1Value: decimal("installment1_value", { precision: 15, scale: 2 }).default("0"),
  installment1Paid: decimal("installment1_paid", { precision: 15, scale: 2 }).default("0"),
  installment2Value: decimal("installment2_value", { precision: 15, scale: 2 }).default("0"),
  installment2Paid: decimal("installment2_paid", { precision: 15, scale: 2 }).default("0"),
  installment3Value: decimal("installment3_value", { precision: 15, scale: 2 }).default("0"),
  installment3Paid: decimal("installment3_paid", { precision: 15, scale: 2 }).default("0"),
  installment4Value: decimal("installment4_value", { precision: 15, scale: 2 }).default("0"),
  installment4Paid: decimal("installment4_paid", { precision: 15, scale: 2 }).default("0"),
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
  stage: leadStageEnum("stage").default("lead_new").notNull(),
  responsible: leadResponsibleEnum("responsible").default("sarah").notNull(),
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
  notes: text("notes"),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;

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
  type: leadDocTypeEnum("type").notNull(),
  fileName: varchar("file_name", { length: 255 }),
  fileUrl: text("file_url"),
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

export const partnerDistributions = pgTable("partner_distributions", {
  id: serial("id").primaryKey(),
  partnerName: varchar("partner_name", { length: 255 }).notNull(),
  referenceType: partnerReferenceTypeEnum("reference_type").notNull(),
  referenceId: integer("reference_id"),
  referenceDescription: varchar("reference_description", { length: 255 }),
  percentage: decimal("percentage", { precision: 5, scale: 2 }).notNull(),
  grossAmount: decimal("gross_amount", { precision: 15, scale: 2 }).notNull(),
  distributionAmount: decimal("distribution_amount", { precision: 15, scale: 2 }).notNull(),
  status: partnerDistributionStatusEnum("status").default("pending").notNull(),
  paidAt: timestamp("paid_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type PartnerDistribution = typeof partnerDistributions.$inferSelect;
export type InsertPartnerDistribution = typeof partnerDistributions.$inferInsert;

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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type FinancialTransaction = typeof financialTransactions.$inferSelect;
export type InsertFinancialTransaction = typeof financialTransactions.$inferInsert;

// ========== REGULARIZAÇÃO IMOBILIÁRIA ==========

export const regularizacoes = pgTable("regularizacoes", {
  id: serial("id").primaryKey(),
  clientName: varchar("client_name", { length: 255 }).notNull(),
  clientPhone: varchar("client_phone", { length: 30 }),
  type: varchar("type", { length: 120 }).notNull(),
  status: varchar("status", { length: 40 }).default("analysis").notNull(),
  address: text("address").notNull(),
  registration: varchar("registration", { length: 120 }),
  registryOffice: varchar("registry_office", { length: 255 }),
  responsible: varchar("responsible", { length: 120 }).notNull(),
  leadId: integer("lead_id"),
  serviceValue: decimal("service_value", { precision: 15, scale: 2 }).default("0").notNull(),
  paidValue: decimal("paid_value", { precision: 15, scale: 2 }).default("0").notNull(),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type RegularizacaoDocument = typeof regularizacaoDocuments.$inferSelect;
export type InsertRegularizacaoDocument = typeof regularizacaoDocuments.$inferInsert;

// ========== INCORPORAÇÃO ==========

export const incorporationStudies = pgTable("incorporation_studies", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  city: varchar("city", { length: 120 }).notNull(),
  state: varchar("state", { length: 2 }).default("MA").notNull(),
  address: text("address"),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  responsible: varchar("responsible", { length: 120 }),
  status: varchar("status", { length: 40 }).default("draft").notNull(),
  propertyRef: varchar("property_ref", { length: 180 }),
  kmlUrl: text("kml_url"),
  geojson: text("geojson"),
  areaM2: decimal("area_m2", { precision: 15, scale: 2 }).default("0").notNull(),
  perimeterM: decimal("perimeter_m", { precision: 15, scale: 2 }).default("0").notNull(),
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
