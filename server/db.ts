import { eq, and, desc, sql } from "drizzle-orm";
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

// Alias para compatibilidade
export const addUtefBalance = createOrUpdateUtefBalance;

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


// ========== CONSTRUCTION PROJECTS ==========

import {
  constructionProjects, ConstructionProject, InsertConstructionProject,
  constructionStages, ConstructionStage, InsertConstructionStage,
  constructionPhotos, ConstructionPhoto, InsertConstructionPhoto
} from "../drizzle/schema";

export async function getProjectsByUserId(userId: number): Promise<ConstructionProject[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(constructionProjects).where(eq(constructionProjects.userId, userId)).orderBy(desc(constructionProjects.createdAt));
}

export async function getAllProjects(): Promise<ConstructionProject[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(constructionProjects).orderBy(desc(constructionProjects.createdAt));
}

export async function getProjectById(id: number): Promise<ConstructionProject | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(constructionProjects).where(eq(constructionProjects.id, id)).limit(1);
  return result[0];
}

export async function createProject(project: InsertConstructionProject): Promise<ConstructionProject> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(constructionProjects).values(project);
  return getProjectById(Number(result[0].insertId)) as Promise<ConstructionProject>;
}

export async function updateProject(id: number, updates: Partial<InsertConstructionProject>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(constructionProjects).set(updates).where(eq(constructionProjects.id, id));
}

export async function deleteProject(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Deletar fotos relacionadas
  await db.delete(constructionPhotos).where(eq(constructionPhotos.projectId, id));
  // Deletar etapas relacionadas
  await db.delete(constructionStages).where(eq(constructionStages.projectId, id));
  // Deletar projeto
  await db.delete(constructionProjects).where(eq(constructionProjects.id, id));
}

// ========== CONSTRUCTION STAGES ==========

export async function getStagesByProjectId(projectId: number): Promise<ConstructionStage[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(constructionStages).where(eq(constructionStages.projectId, projectId)).orderBy(constructionStages.orderIndex);
}

export async function getStageById(id: number): Promise<ConstructionStage | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(constructionStages).where(eq(constructionStages.id, id)).limit(1);
  return result[0];
}

export async function createStage(stage: InsertConstructionStage): Promise<ConstructionStage> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(constructionStages).values(stage);
  return getStageById(Number(result[0].insertId)) as Promise<ConstructionStage>;
}

export async function updateStage(id: number, updates: Partial<InsertConstructionStage>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(constructionStages).set(updates).where(eq(constructionStages.id, id));
}

export async function deleteStage(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Deletar fotos relacionadas à etapa
  await db.delete(constructionPhotos).where(eq(constructionPhotos.stageId, id));
  // Deletar etapa
  await db.delete(constructionStages).where(eq(constructionStages.id, id));
}

// ========== CONSTRUCTION PHOTOS ==========

export async function getPhotosByProjectId(projectId: number): Promise<ConstructionPhoto[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(constructionPhotos).where(eq(constructionPhotos.projectId, projectId)).orderBy(desc(constructionPhotos.takenAt));
}

export async function getPhotosByStageId(stageId: number): Promise<ConstructionPhoto[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(constructionPhotos).where(eq(constructionPhotos.stageId, stageId)).orderBy(desc(constructionPhotos.takenAt));
}

export async function createPhoto(photo: InsertConstructionPhoto): Promise<ConstructionPhoto> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(constructionPhotos).values(photo);
  const newPhoto = await db.select().from(constructionPhotos).where(eq(constructionPhotos.id, Number(result[0].insertId))).limit(1);
  return newPhoto[0];
}

export async function deletePhoto(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(constructionPhotos).where(eq(constructionPhotos.id, id));
}

// ========== HELPER: Get Project with Stages and Photos ==========

export async function getProjectWithDetails(projectId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const project = await getProjectById(projectId);
  if (!project) return null;
  
  const stages = await getStagesByProjectId(projectId);
  const photos = await getPhotosByProjectId(projectId);
  
  return {
    ...project,
    stages,
    photos,
  };
}


// ========== PROJECT BUDGET REQUESTS ==========

import { projectBudgetRequests, ProjectBudgetRequest, InsertProjectBudgetRequest } from "../drizzle/schema";

export async function createBudgetRequest(request: InsertProjectBudgetRequest): Promise<ProjectBudgetRequest> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projectBudgetRequests).values(request);
  const newRequest = await db.select().from(projectBudgetRequests).where(eq(projectBudgetRequests.id, Number(result[0].insertId))).limit(1);
  return newRequest[0];
}

export async function getAllBudgetRequests(): Promise<ProjectBudgetRequest[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projectBudgetRequests).orderBy(desc(projectBudgetRequests.createdAt));
}

export async function getBudgetRequestById(id: number): Promise<ProjectBudgetRequest | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(projectBudgetRequests).where(eq(projectBudgetRequests.id, id)).limit(1);
  return result[0];
}

export async function updateBudgetRequest(id: number, updates: Partial<InsertProjectBudgetRequest>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projectBudgetRequests).set(updates).where(eq(projectBudgetRequests.id, id));
}

export async function deleteBudgetRequest(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(projectBudgetRequests).where(eq(projectBudgetRequests.id, id));
}


// ========== ANALYTICS & STATISTICS ==========

export async function getAnalyticsStats() {
  const db = await getDb();
  if (!db) return null;

  // Estatísticas de Orçamentos
  const totalBudgetRequests = await db.select({ count: sql<number>`count(*)` })
    .from(projectBudgetRequests);
  
  const pendingBudgetRequests = await db.select({ count: sql<number>`count(*)` })
    .from(projectBudgetRequests)
    .where(eq(projectBudgetRequests.status, "pending"));
  
  const convertedBudgetRequests = await db.select({ count: sql<number>`count(*)` })
    .from(projectBudgetRequests)
    .where(eq(projectBudgetRequests.status, "converted"));

  // Estatísticas de Obras
  const totalProjects = await db.select({ count: sql<number>`count(*)` })
    .from(constructionProjects);
  
  const activeProjects = await db.select({ count: sql<number>`count(*)` })
    .from(constructionProjects)
    .where(eq(constructionProjects.status, "in_progress"));
  
  const completedProjects = await db.select({ count: sql<number>`count(*)` })
    .from(constructionProjects)
    .where(eq(constructionProjects.status, "completed"));

  // Estatísticas de Sorteios
  const totalDraws = await db.select({ count: sql<number>`count(*)` })
    .from(draws);
  
  const activeDraws = await db.select({ count: sql<number>`count(*)` })
    .from(draws)
    .where(eq(draws.status, "active"));

  // Estatísticas de Bilhetes
  const totalTickets = await db.select({ count: sql<number>`count(*)` })
    .from(tickets);
  
  const totalTicketRevenue = await db.select({ sum: sql<number>`sum(price)` })
    .from(tickets)
    .where(eq(tickets.paymentStatus, "confirmed"));

  // Estatísticas de UTEFs
  const totalUtefBalance = await db.select({ sum: sql<number>`sum(balance)` })
    .from(utefBalances);
  
  const totalUtefTransactions = await db.select({ count: sql<number>`count(*)` })
    .from(utefTransactions);

  // Estatísticas de Usuários
  const totalUsers = await db.select({ count: sql<number>`count(*)` })
    .from(users);

  return {
    budgetRequests: {
      total: totalBudgetRequests[0]?.count || 0,
      pending: pendingBudgetRequests[0]?.count || 0,
      converted: convertedBudgetRequests[0]?.count || 0,
      conversionRate: totalBudgetRequests[0]?.count > 0 
        ? ((convertedBudgetRequests[0]?.count || 0) / totalBudgetRequests[0].count * 100).toFixed(1)
        : "0.0"
    },
    projects: {
      total: totalProjects[0]?.count || 0,
      active: activeProjects[0]?.count || 0,
      completed: completedProjects[0]?.count || 0
    },
    draws: {
      total: totalDraws[0]?.count || 0,
      active: activeDraws[0]?.count || 0
    },
    tickets: {
      total: totalTickets[0]?.count || 0,
      revenue: totalTicketRevenue[0]?.sum || 0
    },
    utef: {
      totalBalance: totalUtefBalance[0]?.sum || 0,
      totalTransactions: totalUtefTransactions[0]?.count || 0
    },
    users: {
      total: totalUsers[0]?.count || 0
    }
  };
}

export async function getBudgetRequestsByStatus() {
  const db = await getDb();
  if (!db) return [];

  const statusCounts = await db
    .select({
      status: projectBudgetRequests.status,
      count: sql<number>`count(*)`
    })
    .from(projectBudgetRequests)
    .groupBy(projectBudgetRequests.status);

  return statusCounts;
}

export async function getProjectsByStatus() {
  const db = await getDb();
  if (!db) return [];

  const statusCounts = await db
    .select({
      status: constructionProjects.status,
      count: sql<number>`count(*)`
    })
    .from(constructionProjects)
    .groupBy(constructionProjects.status);

  return statusCounts;
}

export async function getRecentBudgetRequests(limit: number = 5) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(projectBudgetRequests)
    .orderBy(desc(projectBudgetRequests.createdAt))
    .limit(limit);
}
