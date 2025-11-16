import { eq, and, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { 
  InsertUser, users,
  draws, Draw, InsertDraw,
  tickets, Ticket, InsertTicket,
  utefBalances, UtefBalance, InsertUtefBalance,
  utefTransactions, UtefTransaction, InsertUtefTransaction,
  products, Product, InsertProduct,
  productConversions, ProductConversion, InsertProductConversion
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ========== DRAWS ==========

export async function getActiveDraws(): Promise<Draw[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(draws).where(eq(draws.status, "active")).orderBy(desc(draws.createdAt));
}

export async function getDrawById(id: number): Promise<Draw | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(draws).where(eq(draws.id, id)).limit(1);
  return result[0];
}

export async function createDraw(draw: InsertDraw): Promise<Draw> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(draws).values(draw);
  return getDrawById(Number(result[0].insertId)) as Promise<Draw>;
}

export async function updateDraw(id: number, updates: Partial<InsertDraw>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(draws).set(updates).where(eq(draws.id, id));
}

// ========== TICKETS ==========

export async function createTicket(ticket: InsertTicket): Promise<Ticket> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(tickets).values(ticket);
  const newTicket = await db.select().from(tickets).where(eq(tickets.id, Number(result[0].insertId))).limit(1);
  return newTicket[0];
}

export async function getTicketsByUserId(userId: number): Promise<Ticket[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tickets).where(eq(tickets.userId, userId)).orderBy(desc(tickets.createdAt));
}

export async function getTicketByStripeSessionId(sessionId: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(tickets).where(eq(tickets.stripeCheckoutSessionId, sessionId)).limit(1);
  return result[0] || null;
}

export async function getTicketByStripePaymentIntentId(paymentIntentId: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(tickets).where(eq(tickets.stripePaymentIntentId, paymentIntentId)).limit(1);
  return result[0] || null;
}

export async function updateTicketPaymentStatus(ticketId: number, status: 'pending' | 'confirmed' | 'failed') {
  const db = await getDb();
  if (!db) return;
  await db.update(tickets).set({ paymentStatus: status }).where(eq(tickets.id, ticketId));
}

export async function incrementDrawStats(drawId: number, amount: number, ticketCount: number) {
  const db = await getDb();
  if (!db) return;
  const draw = await getDrawById(drawId);
  if (!draw) return;
  
  await db.update(draws).set({
    currentAmount: draw.currentAmount + amount,
    ticketsSold: draw.ticketsSold + ticketCount,
  }).where(eq(draws.id, drawId));
}

export async function getTicketsByDrawId(drawId: number): Promise<Ticket[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tickets).where(eq(tickets.drawId, drawId));
}

export async function updateTicket(id: number, updates: Partial<InsertTicket>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(tickets).set(updates).where(eq(tickets.id, id));
}

// ========== UTEF BALANCES ==========

export async function getUtefBalance(userId: number): Promise<UtefBalance | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(utefBalances).where(eq(utefBalances.userId, userId)).limit(1);
  return result[0];
}

export async function createOrUpdateUtefBalance(userId: number, amount: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const existing = await getUtefBalance(userId);
  if (existing) {
    await db.update(utefBalances).set({ balance: existing.balance + amount }).where(eq(utefBalances.userId, userId));
  } else {
    await db.insert(utefBalances).values({ userId, balance: amount });
  }
}

// ========== UTEF TRANSACTIONS ==========

export async function createUtefTransaction(transaction: InsertUtefTransaction): Promise<UtefTransaction> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(utefTransactions).values(transaction);
  const newTransaction = await db.select().from(utefTransactions).where(eq(utefTransactions.id, Number(result[0].insertId))).limit(1);
  return newTransaction[0];
}

export async function getUtefTransactionsByUserId(userId: number): Promise<UtefTransaction[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(utefTransactions).where(eq(utefTransactions.userId, userId)).orderBy(desc(utefTransactions.createdAt));
}

// ========== PRODUCTS ==========

export async function getProducts(category?: string): Promise<Product[]> {
  const db = await getDb();
  if (!db) return [];
  if (category) {
    return db.select().from(products).where(and(eq(products.category, category as any), eq(products.status, "available")));
  }
  return db.select().from(products).where(eq(products.status, "available"));
}

export async function getProductById(id: number): Promise<Product | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return result[0];
}

export async function createProduct(product: InsertProduct): Promise<Product> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(products).values(product);
  return getProductById(Number(result[0].insertId)) as Promise<Product>;
}

// ========== PRODUCT CONVERSIONS ==========

export async function createProductConversion(conversion: InsertProductConversion): Promise<ProductConversion> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(productConversions).values(conversion);
  const newConversion = await db.select().from(productConversions).where(eq(productConversions.id, Number(result[0].insertId))).limit(1);
  return newConversion[0];
}

export async function getConversionsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const conversions = await db
    .select({
      id: productConversions.id,
      userId: productConversions.userId,
      productId: productConversions.productId,
      utefAmount: productConversions.utefAmount,
      status: productConversions.status,
      notes: productConversions.notes,
      createdAt: productConversions.createdAt,
      updatedAt: productConversions.updatedAt,
      product: products,
    })
    .from(productConversions)
    .leftJoin(products, eq(productConversions.productId, products.id))
    .where(eq(productConversions.userId, userId))
    .orderBy(desc(productConversions.createdAt));
  
  return conversions;
}
