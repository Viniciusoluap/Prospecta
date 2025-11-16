import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

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
  drawId: int("drawId").notNull(),
  userId: int("userId").notNull(),
  ticketNumber: varchar("ticketNumber", { length: 20 }).notNull().unique(), // Número único do bilhete
  quantity: int("quantity").default(1).notNull(), // Quantidade de bilhetes comprados
  totalPaid: int("totalPaid").notNull(), // Valor pago em centavos
  paymentStatus: mysqlEnum("paymentStatus", ["pending", "confirmed", "failed"]).default("pending").notNull(),
  paymentMethod: varchar("paymentMethod", { length: 50 }).default("pix"),
  pixQrCode: text("pixQrCode"), // QR Code PIX gerado
  pixCopyPaste: text("pixCopyPaste"), // Código PIX copia e cola
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }), // ID do Payment Intent do Stripe
  stripeCheckoutSessionId: varchar("stripeCheckoutSessionId", { length: 255 }), // ID da sessão de checkout do Stripe
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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