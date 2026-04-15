import { eq, and, desc, sql, or, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  draws,
  Draw,
  InsertDraw,
  tickets,
  Ticket,
  InsertTicket,
  utefBalances,
  UtefBalance,
  InsertUtefBalance,
  utefTransactions,
  UtefTransaction,
  InsertUtefTransaction,
  products,
  Product,
  InsertProduct,
  productConversions,
  ProductConversion,
  InsertProductConversion,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

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
      values.role = "admin";
      updateSet.role = "admin";
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

  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function updateUserProfile(
  userId: number,
  profile: {
    name?: string;
    email?: string;
    cpf?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    avatarUrl?: string;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateSet: Record<string, unknown> = {};

  if (profile.name !== undefined) updateSet.name = profile.name;
  if (profile.email !== undefined) updateSet.email = profile.email;
  if (profile.cpf !== undefined) updateSet.cpf = profile.cpf;
  if (profile.phone !== undefined) updateSet.phone = profile.phone;
  if (profile.address !== undefined) updateSet.address = profile.address;
  if (profile.city !== undefined) updateSet.city = profile.city;
  if (profile.state !== undefined) updateSet.state = profile.state;
  if (profile.zipCode !== undefined) updateSet.zipCode = profile.zipCode;
  if (profile.avatarUrl !== undefined) updateSet.avatarUrl = profile.avatarUrl;

  if (Object.keys(updateSet).length > 0) {
    await db.update(users).set(updateSet).where(eq(users.id, userId));
  }
}

// ========== DRAWS ==========

export async function getActiveDraws(): Promise<Draw[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(draws)
    .where(eq(draws.status, "active"))
    .orderBy(desc(draws.createdAt));
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

export async function updateDraw(
  id: number,
  updates: Partial<InsertDraw>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(draws).set(updates).where(eq(draws.id, id));
}

// ========== TICKETS ==========

export async function createTicket(ticket: InsertTicket): Promise<Ticket> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(tickets).values(ticket);
  const newTicket = await db
    .select()
    .from(tickets)
    .where(eq(tickets.id, Number(result[0].insertId)))
    .limit(1);
  return newTicket[0];
}

export async function getTicketsByUserId(userId: number): Promise<Ticket[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(tickets)
    .where(eq(tickets.userId, userId))
    .orderBy(desc(tickets.createdAt));
}

export async function getTicketByStripeSessionId(sessionId: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(tickets)
    .where(eq(tickets.stripeCheckoutSessionId, sessionId))
    .limit(1);
  return result[0] || null;
}

export async function getTicketByStripePaymentIntentId(
  paymentIntentId: string
) {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(tickets)
    .where(eq(tickets.stripePaymentIntentId, paymentIntentId))
    .limit(1);
  return result[0] || null;
}

export async function updateTicketPaymentStatus(
  ticketId: number,
  status: "pending" | "confirmed" | "failed"
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(tickets)
    .set({ paymentStatus: status })
    .where(eq(tickets.id, ticketId));
}

export async function incrementDrawStats(
  drawId: number,
  amount: number,
  ticketCount: number
) {
  const db = await getDb();
  if (!db) return;
  const draw = await getDrawById(drawId);
  if (!draw) return;

  await db
    .update(draws)
    .set({
      currentAmount: draw.currentAmount + amount,
      ticketsSold: draw.ticketsSold + ticketCount,
    })
    .where(eq(draws.id, drawId));
}

export async function getTicketsByDrawId(drawId: number): Promise<Ticket[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tickets).where(eq(tickets.drawId, drawId));
}

export async function updateTicket(
  id: number,
  updates: Partial<InsertTicket>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(tickets).set(updates).where(eq(tickets.id, id));
}

// ========== UTEF BALANCES ==========

export async function getUtefBalance(
  userId: number
): Promise<UtefBalance | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(utefBalances)
    .where(eq(utefBalances.userId, userId))
    .limit(1);
  return result[0];
}

export async function createOrUpdateUtefBalance(
  userId: number,
  amount: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await getUtefBalance(userId);
  if (existing) {
    await db
      .update(utefBalances)
      .set({ balance: existing.balance + amount })
      .where(eq(utefBalances.userId, userId));
  } else {
    await db.insert(utefBalances).values({ userId, balance: amount });
  }
}

// Alias para compatibilidade
export const addUtefBalance = createOrUpdateUtefBalance;

// ========== UTEF TRANSACTIONS ==========

export async function createUtefTransaction(
  transaction: InsertUtefTransaction
): Promise<UtefTransaction> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(utefTransactions).values(transaction);
  const newTransaction = await db
    .select()
    .from(utefTransactions)
    .where(eq(utefTransactions.id, Number(result[0].insertId)))
    .limit(1);
  return newTransaction[0];
}

export async function getUtefTransactionsByUserId(
  userId: number
): Promise<UtefTransaction[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(utefTransactions)
    .where(eq(utefTransactions.userId, userId))
    .orderBy(desc(utefTransactions.createdAt));
}

// ========== PRODUCTS ==========

export async function getProducts(category?: string): Promise<Product[]> {
  const db = await getDb();
  if (!db) return [];
  if (category) {
    return db
      .select()
      .from(products)
      .where(
        and(
          eq(products.category, category as any),
          eq(products.status, "available")
        )
      );
  }
  return db.select().from(products).where(eq(products.status, "available"));
}

export async function getProductById(id: number): Promise<Product | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(products)
    .where(eq(products.id, id))
    .limit(1);
  return result[0];
}

export async function createProduct(product: InsertProduct): Promise<Product> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(products).values(product);
  return getProductById(Number(result[0].insertId)) as Promise<Product>;
}

// ========== PRODUCT CONVERSIONS ==========

export async function createProductConversion(
  conversion: InsertProductConversion
): Promise<ProductConversion> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(productConversions).values(conversion);
  const newConversion = await db
    .select()
    .from(productConversions)
    .where(eq(productConversions.id, Number(result[0].insertId)))
    .limit(1);
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
  constructionProjects,
  ConstructionProject,
  InsertConstructionProject,
  constructionStages,
  ConstructionStage,
  InsertConstructionStage,
  constructionPhotos,
  ConstructionPhoto,
  InsertConstructionPhoto,
} from "../drizzle/schema";

export async function getProjectsByUserId(
  userId: number
): Promise<ConstructionProject[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(constructionProjects)
    .where(eq(constructionProjects.userId, userId))
    .orderBy(desc(constructionProjects.createdAt));
}

export async function getAllProjects(): Promise<ConstructionProject[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(constructionProjects)
    .orderBy(desc(constructionProjects.createdAt));
}

export async function getProjectById(
  id: number
): Promise<ConstructionProject | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(constructionProjects)
    .where(eq(constructionProjects.id, id))
    .limit(1);
  return result[0];
}

export async function createProject(
  project: InsertConstructionProject
): Promise<ConstructionProject> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(constructionProjects).values(project);
  return getProjectById(
    Number(result[0].insertId)
  ) as Promise<ConstructionProject>;
}

export async function updateProject(
  id: number,
  updates: Partial<InsertConstructionProject>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(constructionProjects)
    .set(updates)
    .where(eq(constructionProjects.id, id));
}

export async function deleteProject(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Deletar fotos relacionadas
  await db
    .delete(constructionPhotos)
    .where(eq(constructionPhotos.projectId, id));
  // Deletar etapas relacionadas
  await db
    .delete(constructionStages)
    .where(eq(constructionStages.projectId, id));
  // Deletar projeto
  await db.delete(constructionProjects).where(eq(constructionProjects.id, id));
}

// ========== CONSTRUCTION STAGES ==========

export async function getStagesByProjectId(
  projectId: number
): Promise<ConstructionStage[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(constructionStages)
    .where(eq(constructionStages.projectId, projectId))
    .orderBy(constructionStages.orderIndex);
}

export async function getStageById(
  id: number
): Promise<ConstructionStage | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(constructionStages)
    .where(eq(constructionStages.id, id))
    .limit(1);
  return result[0];
}

export async function createStage(
  stage: InsertConstructionStage
): Promise<ConstructionStage> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(constructionStages).values(stage);
  return getStageById(Number(result[0].insertId)) as Promise<ConstructionStage>;
}

export async function updateStage(
  id: number,
  updates: Partial<InsertConstructionStage>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(constructionStages)
    .set(updates)
    .where(eq(constructionStages.id, id));
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

export async function getPhotosByProjectId(
  projectId: number
): Promise<ConstructionPhoto[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(constructionPhotos)
    .where(eq(constructionPhotos.projectId, projectId))
    .orderBy(desc(constructionPhotos.takenAt));
}

export async function getPhotosByStageId(
  stageId: number
): Promise<ConstructionPhoto[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(constructionPhotos)
    .where(eq(constructionPhotos.stageId, stageId))
    .orderBy(desc(constructionPhotos.takenAt));
}

export async function createPhoto(
  photo: InsertConstructionPhoto
): Promise<ConstructionPhoto> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(constructionPhotos).values(photo);
  const newPhoto = await db
    .select()
    .from(constructionPhotos)
    .where(eq(constructionPhotos.id, Number(result[0].insertId)))
    .limit(1);
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

import {
  projectBudgetRequests,
  ProjectBudgetRequest,
  InsertProjectBudgetRequest,
} from "../drizzle/schema";

export async function createBudgetRequest(
  request: InsertProjectBudgetRequest
): Promise<ProjectBudgetRequest> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projectBudgetRequests).values(request);
  const newRequest = await db
    .select()
    .from(projectBudgetRequests)
    .where(eq(projectBudgetRequests.id, Number(result[0].insertId)))
    .limit(1);
  return newRequest[0];
}

export async function getAllBudgetRequests(): Promise<ProjectBudgetRequest[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(projectBudgetRequests)
    .orderBy(desc(projectBudgetRequests.createdAt));
}

export async function getBudgetRequestById(
  id: number
): Promise<ProjectBudgetRequest | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(projectBudgetRequests)
    .where(eq(projectBudgetRequests.id, id))
    .limit(1);
  return result[0];
}

export async function updateBudgetRequest(
  id: number,
  updates: Partial<InsertProjectBudgetRequest>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(projectBudgetRequests)
    .set(updates)
    .where(eq(projectBudgetRequests.id, id));
}

export async function deleteBudgetRequest(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .delete(projectBudgetRequests)
    .where(eq(projectBudgetRequests.id, id));
}

// ========== ANALYTICS & STATISTICS ==========

export async function getAnalyticsStats() {
  const db = await getDb();
  if (!db) return null;

  // Estatísticas de Orçamentos
  const totalBudgetRequests = await db
    .select({ count: sql<number>`count(*)` })
    .from(projectBudgetRequests);

  const pendingBudgetRequests = await db
    .select({ count: sql<number>`count(*)` })
    .from(projectBudgetRequests)
    .where(eq(projectBudgetRequests.status, "pending"));

  const convertedBudgetRequests = await db
    .select({ count: sql<number>`count(*)` })
    .from(projectBudgetRequests)
    .where(eq(projectBudgetRequests.status, "converted"));

  // Estatísticas de Obras
  const totalProjects = await db
    .select({ count: sql<number>`count(*)` })
    .from(constructionProjects);

  const activeProjects = await db
    .select({ count: sql<number>`count(*)` })
    .from(constructionProjects)
    .where(eq(constructionProjects.status, "in_progress"));

  const completedProjects = await db
    .select({ count: sql<number>`count(*)` })
    .from(constructionProjects)
    .where(eq(constructionProjects.status, "completed"));

  // Estatísticas de Sorteios
  const totalDraws = await db
    .select({ count: sql<number>`count(*)` })
    .from(draws);

  const activeDraws = await db
    .select({ count: sql<number>`count(*)` })
    .from(draws)
    .where(eq(draws.status, "active"));

  // Estatísticas de Bilhetes
  const totalTickets = await db
    .select({ count: sql<number>`count(*)` })
    .from(tickets);

  const totalTicketRevenue = await db
    .select({ sum: sql<number>`sum(price)` })
    .from(tickets)
    .where(eq(tickets.paymentStatus, "confirmed"));

  // Estatísticas de UTEFs
  const totalUtefBalance = await db
    .select({ sum: sql<number>`sum(balance)` })
    .from(utefBalances);

  const totalUtefTransactions = await db
    .select({ count: sql<number>`count(*)` })
    .from(utefTransactions);

  // Estatísticas de Usuários
  const totalUsers = await db
    .select({ count: sql<number>`count(*)` })
    .from(users);

  return {
    budgetRequests: {
      total: totalBudgetRequests[0]?.count || 0,
      pending: pendingBudgetRequests[0]?.count || 0,
      converted: convertedBudgetRequests[0]?.count || 0,
      conversionRate:
        totalBudgetRequests[0]?.count > 0
          ? (
              ((convertedBudgetRequests[0]?.count || 0) /
                totalBudgetRequests[0].count) *
              100
            ).toFixed(1)
          : "0.0",
    },
    projects: {
      total: totalProjects[0]?.count || 0,
      active: activeProjects[0]?.count || 0,
      completed: completedProjects[0]?.count || 0,
    },
    draws: {
      total: totalDraws[0]?.count || 0,
      active: activeDraws[0]?.count || 0,
    },
    tickets: {
      total: totalTickets[0]?.count || 0,
      revenue: totalTicketRevenue[0]?.sum || 0,
    },
    utef: {
      totalBalance: totalUtefBalance[0]?.sum || 0,
      totalTransactions: totalUtefTransactions[0]?.count || 0,
    },
    users: {
      total: totalUsers[0]?.count || 0,
    },
  };
}

export async function getBudgetRequestsByStatus() {
  const db = await getDb();
  if (!db) return [];

  const statusCounts = await db
    .select({
      status: projectBudgetRequests.status,
      count: sql<number>`count(*)`,
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
      count: sql<number>`count(*)`,
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

// ========== EMAIL LOGS ==========

import { emailLogs, EmailLog } from "../drizzle/schema";

export async function getAllEmailLogs(): Promise<EmailLog[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(emailLogs).orderBy(desc(emailLogs.createdAt));
}

export async function getRecentEmailLogs(
  limit: number = 20
): Promise<EmailLog[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(emailLogs)
    .orderBy(desc(emailLogs.createdAt))
    .limit(limit);
}

export async function getEmailLogById(
  id: number
): Promise<EmailLog | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(emailLogs)
    .where(eq(emailLogs.id, id))
    .limit(1);
  return result[0];
}

// ========== USER NOTIFICATIONS ==========

import {
  userNotifications,
  UserNotification,
  InsertUserNotification,
} from "../drizzle/schema";

export async function createNotification(
  notification: InsertUserNotification
): Promise<UserNotification> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(userNotifications).values(notification);
  const insertedId = result[0].insertId;

  const inserted = await db
    .select()
    .from(userNotifications)
    .where(eq(userNotifications.id, insertedId))
    .limit(1);

  return inserted[0];
}

export async function getUserNotifications(
  userId: number
): Promise<UserNotification[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(userNotifications)
    .where(eq(userNotifications.userId, userId))
    .orderBy(desc(userNotifications.createdAt));
}

export async function getUnreadNotifications(
  userId: number
): Promise<UserNotification[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(userNotifications)
    .where(
      and(eq(userNotifications.userId, userId), eq(userNotifications.isRead, 0))
    )
    .orderBy(desc(userNotifications.createdAt));
}

export async function getUnreadNotificationCount(
  userId: number
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(userNotifications)
    .where(
      and(eq(userNotifications.userId, userId), eq(userNotifications.isRead, 0))
    );

  return result[0]?.count || 0;
}

export async function markNotificationAsRead(
  notificationId: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(userNotifications)
    .set({
      isRead: 1,
      readAt: new Date(),
    })
    .where(eq(userNotifications.id, notificationId));
}

export async function markAllNotificationsAsRead(
  userId: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(userNotifications)
    .set({
      isRead: 1,
      readAt: new Date(),
    })
    .where(
      and(eq(userNotifications.userId, userId), eq(userNotifications.isRead, 0))
    );
}

// ========== EMPREITEIROS (CONTRACTORS) ==========

import { contractors, Contractor, InsertContractor } from "../drizzle/schema";

export async function getAllContractors(): Promise<Contractor[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(contractors).orderBy(contractors.name);
}

export async function getContractorById(
  id: number
): Promise<Contractor | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(contractors)
    .where(eq(contractors.id, id))
    .limit(1);
  return result[0];
}

export async function createContractor(
  data: InsertContractor
): Promise<Contractor> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(contractors).values(data);
  const inserted = await db
    .select()
    .from(contractors)
    .where(eq(contractors.id, result[0].insertId))
    .limit(1);
  return inserted[0];
}

export async function updateContractor(
  id: number,
  data: Partial<InsertContractor>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(contractors)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(contractors.id, id));
}

// ========== CRM — LEADS ==========

import {
  leads,
  Lead,
  InsertLead,
  leadActivities,
  LeadActivity,
  InsertLeadActivity,
  leadDocuments,
  LeadDocument,
  InsertLeadDocument,
  leadFollowUps,
  LeadFollowUp,
  InsertLeadFollowUp,
} from "../drizzle/schema";

export async function getAllLeads(filters?: {
  stage?: string;
  responsible?: string;
  temperature?: string;
  city?: string;
}): Promise<Lead[]> {
  const db = await getDb();
  if (!db) return [];

  let query = db.select().from(leads).$dynamic();

  const conditions = [];
  if (filters?.stage) conditions.push(eq(leads.stage, filters.stage as any));
  if (filters?.responsible)
    conditions.push(eq(leads.responsible, filters.responsible as any));
  if (filters?.temperature)
    conditions.push(eq(leads.temperature, filters.temperature as any));
  if (filters?.city) conditions.push(like(leads.city, `%${filters.city}%`));

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  return query.orderBy(desc(leads.createdAt));
}

export async function getLeadById(id: number): Promise<Lead | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  return result[0];
}

export async function createLead(data: InsertLead): Promise<Lead> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(leads).values(data);
  const inserted = await db
    .select()
    .from(leads)
    .where(eq(leads.id, result[0].insertId))
    .limit(1);
  return inserted[0];
}

export async function updateLead(
  id: number,
  data: Partial<InsertLead>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(leads)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(leads.id, id));
}

export async function getLeadActivities(
  leadId: number
): Promise<LeadActivity[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(leadActivities)
    .where(eq(leadActivities.leadId, leadId))
    .orderBy(desc(leadActivities.createdAt));
}

export async function addLeadActivity(data: InsertLeadActivity): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(leadActivities).values(data);
}

export async function getLeadDocuments(
  leadId: number
): Promise<LeadDocument[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(leadDocuments)
    .where(eq(leadDocuments.leadId, leadId))
    .orderBy(desc(leadDocuments.createdAt));
}

export async function addLeadDocument(data: InsertLeadDocument): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(leadDocuments).values(data);
}

export async function updateLeadDocument(
  id: number,
  data: Partial<InsertLeadDocument>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(leadDocuments).set(data).where(eq(leadDocuments.id, id));
}

export async function getLeadFollowUps(
  leadId: number
): Promise<LeadFollowUp[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(leadFollowUps)
    .where(eq(leadFollowUps.leadId, leadId))
    .orderBy(leadFollowUps.scheduledAt);
}

export async function createFollowUp(data: InsertLeadFollowUp): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(leadFollowUps).values(data);
}

export async function getPendingFollowUps(): Promise<LeadFollowUp[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(leadFollowUps)
    .where(eq(leadFollowUps.status, "pending"))
    .orderBy(leadFollowUps.scheduledAt);
}

export async function updateFollowUp(
  id: number,
  data: Partial<InsertLeadFollowUp>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(leadFollowUps).set(data).where(eq(leadFollowUps.id, id));
}

export async function getLeadStats() {
  const db = await getDb();
  if (!db) return null;

  const total = await db.select({ count: sql<number>`count(*)` }).from(leads);
  const hot = await db
    .select({ count: sql<number>`count(*)` })
    .from(leads)
    .where(eq(leads.temperature, "hot"));
  const approved = await db
    .select({ count: sql<number>`count(*)` })
    .from(leads)
    .where(eq(leads.stage, "approved"));
  const rejected = await db
    .select({ count: sql<number>`count(*)` })
    .from(leads)
    .where(eq(leads.stage, "rejected"));

  return {
    total: total[0]?.count || 0,
    hot: hot[0]?.count || 0,
    approved: approved[0]?.count || 0,
    rejected: rejected[0]?.count || 0,
  };
}

// ========== TAREFAS (TASKS) ==========

import { tasks, Task, InsertTask } from "../drizzle/schema";

export async function getAllTasks(assignedTo?: string): Promise<Task[]> {
  const db = await getDb();
  if (!db) return [];
  if (assignedTo) {
    return db
      .select()
      .from(tasks)
      .where(eq(tasks.assignedTo, assignedTo))
      .orderBy(desc(tasks.createdAt));
  }
  return db.select().from(tasks).orderBy(desc(tasks.createdAt));
}

export async function createTask(data: InsertTask): Promise<Task> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(tasks).values(data);
  const inserted = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, result[0].insertId))
    .limit(1);
  return inserted[0];
}

export async function updateTask(
  id: number,
  data: Partial<InsertTask>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(tasks)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(tasks.id, id));
}

// ========== INVESTIDORES ==========

import {
  investors,
  Investor,
  InsertInvestor,
  investorTransactions,
  InvestorTransaction,
  InsertInvestorTransaction,
} from "../drizzle/schema";

export async function getAllInvestors(): Promise<Investor[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(investors).orderBy(investors.name);
}

export async function createInvestor(data: InsertInvestor): Promise<Investor> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(investors).values(data);
  const inserted = await db
    .select()
    .from(investors)
    .where(eq(investors.id, result[0].insertId))
    .limit(1);
  return inserted[0];
}

export async function updateInvestor(
  id: number,
  data: Partial<InsertInvestor>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(investors)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(investors.id, id));
}

export async function getInvestorTransactions(
  investorId: number
): Promise<InvestorTransaction[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(investorTransactions)
    .where(eq(investorTransactions.investorId, investorId))
    .orderBy(desc(investorTransactions.date));
}

export async function addInvestorTransaction(
  data: InsertInvestorTransaction
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(investorTransactions).values(data);
}

// ========== CONTROLE DE CORRETORES ==========

import {
  brokerCommissions,
  BrokerCommission,
  InsertBrokerCommission,
} from "../drizzle/schema";

export async function getAllBrokerCommissions(): Promise<BrokerCommission[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(brokerCommissions)
    .orderBy(desc(brokerCommissions.createdAt));
}

export async function createBrokerCommission(
  data: InsertBrokerCommission
): Promise<BrokerCommission> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(brokerCommissions).values(data);
  const inserted = await db
    .select()
    .from(brokerCommissions)
    .where(eq(brokerCommissions.id, result[0].insertId))
    .limit(1);
  return inserted[0];
}

export async function updateBrokerCommission(
  id: number,
  data: Partial<InsertBrokerCommission>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(brokerCommissions)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(brokerCommissions.id, id));
}

// ========== CONTROLE DE LOTES ==========

import { lots, Lot, InsertLot } from "../drizzle/schema";

export async function getAllLots(): Promise<Lot[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(lots).orderBy(lots.development, lots.lotNumber);
}

export async function createLot(data: InsertLot): Promise<Lot> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(lots).values(data);
  const inserted = await db
    .select()
    .from(lots)
    .where(eq(lots.id, result[0].insertId))
    .limit(1);
  return inserted[0];
}

export async function updateLot(
  id: number,
  data: Partial<InsertLot>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(lots)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(lots.id, id));
}

// ========== DISTRIBUIÇÃO DE SÓCIOS ==========

import {
  partnerDistributions,
  PartnerDistribution,
  InsertPartnerDistribution,
} from "../drizzle/schema";

export async function getAllPartnerDistributions(): Promise<
  PartnerDistribution[]
> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(partnerDistributions)
    .orderBy(desc(partnerDistributions.createdAt));
}

export async function createPartnerDistribution(
  data: InsertPartnerDistribution
): Promise<PartnerDistribution> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(partnerDistributions).values(data);
  const inserted = await db
    .select()
    .from(partnerDistributions)
    .where(eq(partnerDistributions.id, result[0].insertId))
    .limit(1);
  return inserted[0];
}

export async function updatePartnerDistribution(
  id: number,
  data: Partial<InsertPartnerDistribution>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(partnerDistributions)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(partnerDistributions.id, id));
}

// ========== TRANSAÇÕES FINANCEIRAS ==========

import {
  financialTransactions,
  FinancialTransaction,
  InsertFinancialTransaction,
} from "../drizzle/schema";

export async function getAllFinancialTransactions(): Promise<
  FinancialTransaction[]
> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(financialTransactions)
    .orderBy(desc(financialTransactions.createdAt));
}

export async function createFinancialTransaction(
  data: InsertFinancialTransaction
): Promise<FinancialTransaction> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(financialTransactions).values(data);
  const inserted = await db
    .select()
    .from(financialTransactions)
    .where(eq(financialTransactions.id, result[0].insertId))
    .limit(1);
  return inserted[0];
}

// ========== TAXAS DE OBRA ==========

import { obraFees, ObraFee, InsertObraFee } from "../drizzle/schema";

export async function getObraFeesByProject(
  projectId: number
): Promise<ObraFee[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(obraFees).where(eq(obraFees.projectId, projectId));
}

export async function upsertObraFee(
  projectId: number,
  feeType: string,
  estimatedValue: string,
  paidValue: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await db
    .select()
    .from(obraFees)
    .where(
      and(eq(obraFees.projectId, projectId), eq(obraFees.feeType, feeType))
    )
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(obraFees)
      .set({ estimatedValue, paidValue, updatedAt: new Date() })
      .where(
        and(eq(obraFees.projectId, projectId), eq(obraFees.feeType, feeType))
      );
  } else {
    await db
      .insert(obraFees)
      .values({ projectId, feeType, estimatedValue, paidValue });
  }
}
