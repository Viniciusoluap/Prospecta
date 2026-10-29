import { TRPCError } from "@trpc/server";
import { eq, and, desc, sql, like, isNull, inArray, asc, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzleSession } from "drizzle-orm/neon-serverless";
import { alias } from "drizzle-orm/pg-core";
import { neon, Pool, neonConfig } from "@neondatabase/serverless";
import { LEAD_PIPELINE_STAGES, LEGACY_STAGE_LABELS } from "../shared/lead-pipeline.js";
import { rotulo } from "../shared/rotulos.js";
import { VINCULOS_LEAD, type VinculosLead } from "../shared/lead-exclusao-definitiva.js";

import {
  InsertUser, users, User,
  draws, Draw, InsertDraw,
  tickets, Ticket, InsertTicket,
  utefBalances, UtefBalance, InsertUtefBalance,
  utefTransactions, UtefTransaction, InsertUtefTransaction,
  paymentOrders, PaymentOrder, InsertPaymentOrder,
  ticketNumbers, TicketNumber, InsertTicketNumber,
  products, Product, InsertProduct,
  productConversions, ProductConversion, InsertProductConversion,
  constructionProjects, ConstructionProject, InsertConstructionProject,
  constructionStages, ConstructionStage, InsertConstructionStage,
  constructionPhotos, constructionProgressHistory, constructionPci, ConstructionPhoto, InsertConstructionPhoto,
  projectBudgetRequests, ProjectBudgetRequest, InsertProjectBudgetRequest,
  emailLogs, EmailLog,
  userNotifications, UserNotification, InsertUserNotification,
  leads, Lead, InsertLead, leadServices,
  leadActivities, LeadActivity, InsertLeadActivity,
  leadDocuments, LeadDocument, InsertLeadDocument,
  leadFollowUps, LeadFollowUp, InsertLeadFollowUp,
  tasks, Task, InsertTask,
  financialTransactions, FinancialTransaction, InsertFinancialTransaction,
  obraFees, ObraFee, InsertObraFee,
  obraMeasurements, ObraMeasurement, InsertObraMeasurement,
  paymentSettings, PaymentSetting, InsertPaymentSetting,
  imoveis, Imovel, InsertImovel,
  avaliacoes, Avaliacao, InsertAvaliacao,
  agregadorImoveis, AgregadorImovel, InsertAgregadorImovel,
  incorporationStudies, IncorporationStudy, InsertIncorporationStudy, engineerProfiles,
  incorporationStudyVersions,
  bpoClients, BpoClient, InsertBpoClient,
  bpoLancamentos, BpoLancamento, InsertBpoLancamento,
  pluggySettings, PluggySetting, InsertPluggySetting,
  bankAccounts, BankAccount, InsertBankAccount,
  bankTransactions, BankTransaction, InsertBankTransaction,
  dashboardSettings, operationalCommissions, operationalProjects,
} from "../drizzle/schema.js";
import { montarDadosCrmObra, tipoProjetoDoServico, type ObraDadosCrm } from "../shared/obra-crm.js";

type DrizzleDb = ReturnType<typeof drizzle>;
let _db: DrizzleDb | null = null;

export function getDb(): DrizzleDb {
  if (!_db) {
    // Vercel + Neon integration may use any of these names
    const connectionString =
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.NEON_DATABASE_URL ||
      process.env.DATABASE_URL_UNPOOLED ||
      process.env.POSTGRES_URL_NON_POOLING;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    // Node 24 supplies WebSocket natively. Interactive transactions need a session;
    // the HTTP driver cannot run the callbacks used by CRM, reviews and uploads.
    neonConfig.webSocketConstructor = globalThis.WebSocket;
    const pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 });
    const httpDb = drizzle(neon(connectionString));
    const sessionDb = drizzleSession(pool);
    // Keep the existing HTTP batch API; route only interactive transactions to WebSocket.
    httpDb.transaction = sessionDb.transaction.bind(sessionDb) as unknown as typeof httpDb.transaction;
    _db = httpDb;
  }
  return _db;
}

// ========== USERS ==========

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = getDb();

  const existing = await db.select().from(users).where(eq(users.openId, user.openId)).limit(1);

  if (existing.length > 0) {
    const updateSet: Partial<InsertUser> = { lastSignedIn: new Date() };
    if (user.name !== undefined) updateSet.name = user.name;
    if (user.email !== undefined) updateSet.email = user.email;
    if (user.loginMethod !== undefined) updateSet.loginMethod = user.loginMethod;
    if (user.role !== undefined) updateSet.role = user.role;
    await db.update(users).set(updateSet).where(eq(users.openId, user.openId));
  } else {
    await db.insert(users).values({
      ...user,
      lastSignedIn: user.lastSignedIn ?? new Date(),
    });
  }
}

export async function getUserByOpenId(openId: string): Promise<User | undefined> {
  const db = getDb();
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getUserById(id: number): Promise<User | null> {
  const db = getDb();
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0] ?? null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const db = getDb();
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result[0] ?? null;
}

export async function setUserPassword(userId: number, passwordHash: string): Promise<void> {
  const db = getDb();
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

export async function updateUserProfile(userId: number, profile: {
  name?: string;
  email?: string;
  cpf?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  avatarUrl?: string;
}): Promise<void> {
  const db = getDb();
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
  const db = getDb();
  return db.select().from(draws).where(eq(draws.status, "active")).orderBy(desc(draws.createdAt));
}

export async function getDrawById(id: number): Promise<Draw | undefined> {
  const db = getDb();
  const result = await db.select().from(draws).where(eq(draws.id, id)).limit(1);
  return result[0];
}

// Reserva atomicamente `quantity` numeros de capacidade de um sorteio (guarda de
// concorrencia: so avanca se ticketsSold + quantity <= capacity, num unico UPDATE
// condicional - sem read-then-write). Retorna o valor de ticketsSold ANTES da reserva
// (para atribuir numeros sequenciais) ou null se excederia a capacidade/sorteio nao
// existe.
export async function reserveDrawCapacity(
  drawId: number,
  quantity: number,
  amountPaidCents: number,
  capacity: number,
): Promise<{ ticketsSoldBefore: number } | null> {
  const db = getDb();
  const result = await db
    .update(draws)
    .set({
      ticketsSold: sql`${draws.ticketsSold} + ${quantity}`,
      currentAmount: sql`${draws.currentAmount} + ${amountPaidCents}`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(draws.id, drawId),
      sql`${draws.ticketsSold} + ${quantity} <= ${capacity}`,
    ))
    .returning({ ticketsSold: draws.ticketsSold });
  if (result.length === 0) return null;
  return { ticketsSoldBefore: result[0].ticketsSold - quantity };
}

// Reverso de reserveDrawCapacity: libera a capacidade reservada por um bilhete
// cancelado (chargeback), para que os numeros liberados possam ser vendidos de novo.
// Incondicional (a reserva que esta revertendo e conhecida por ja existir).
export async function releaseDrawCapacity(
  drawId: number,
  quantity: number,
  amountPaidCents: number,
): Promise<void> {
  const db = getDb();
  await db
    .update(draws)
    .set({
      ticketsSold: sql`greatest(${draws.ticketsSold} - ${quantity}, 0)`,
      currentAmount: sql`greatest(${draws.currentAmount} - ${amountPaidCents}, 0)`,
      updatedAt: new Date(),
    })
    .where(eq(draws.id, drawId));
}

export async function insertTicketNumbers(rows: InsertTicketNumber[]): Promise<void> {
  if (rows.length === 0) return;
  const db = getDb();
  await db.insert(ticketNumbers).values(rows);
}

export async function getTicketNumbersByDrawId(drawId: number): Promise<TicketNumber[]> {
  const db = getDb();
  return db.select().from(ticketNumbers).where(eq(ticketNumbers.drawId, drawId));
}

// Libera os numeros individuais atribuidos a um bilhete cancelado (chargeback), para
// que nao fiquem elegiveis ao sorteio nem colidam com a unicidade (draw_id, number)
// quando a capacidade liberada for vendida de novo.
export async function deleteTicketNumbersByTicketId(ticketId: number): Promise<void> {
  const db = getDb();
  await db.delete(ticketNumbers).where(eq(ticketNumbers.ticketId, ticketId));
}

export async function getTicketById(id: number): Promise<Ticket | undefined> {
  const db = getDb();
  const result = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  return result[0];
}

// ========== PAYMENT ORDERS (ledger de idempotencia) ==========

export async function createPaymentOrder(order: InsertPaymentOrder): Promise<PaymentOrder> {
  const db = getDb();
  const result = await db
    .insert(paymentOrders)
    .values(order)
    .onConflictDoNothing({ target: paymentOrders.providerPaymentId })
    .returning();
  if (result[0]) return result[0];
  // Ja existia (reentrancia na criacao da cobranca) - retorna o registro existente.
  const existing = await getPaymentOrderByProviderId(order.providerPaymentId);
  if (!existing) throw new Error(`Falha ao criar/recuperar payment_order para ${order.providerPaymentId}`);
  return existing;
}

export async function getPaymentOrderByProviderId(providerPaymentId: string): Promise<PaymentOrder | undefined> {
  const db = getDb();
  const result = await db.select().from(paymentOrders).where(eq(paymentOrders.providerPaymentId, providerPaymentId)).limit(1);
  return result[0];
}

// Guarda de idempotencia: so liquida uma vez. Retorna o pedido reivindicado (e passa a
// responsabilidade de credito ao chamador) ou null se ja tinha sido liquidado/nao esta
// mais pendente (reentrega do webhook, ou estado final ja alcancado).
export async function claimPendingPaymentOrder(providerPaymentId: string): Promise<PaymentOrder | null> {
  const db = getDb();
  const result = await db
    .update(paymentOrders)
    .set({ status: "settled", settledAt: new Date(), updatedAt: new Date() })
    .where(and(eq(paymentOrders.providerPaymentId, providerPaymentId), eq(paymentOrders.status, "pending")))
    .returning();
  return result[0] ?? null;
}

export async function markPaymentOrderReview(providerPaymentId: string, reason: string): Promise<PaymentOrder | null> {
  const db = getDb();
  const result = await db
    .update(paymentOrders)
    .set({ status: "review_required", reviewReason: reason, updatedAt: new Date() })
    .where(eq(paymentOrders.providerPaymentId, providerPaymentId))
    .returning();
  return result[0] ?? null;
}

// Usado quando um pedido ja foi reivindicado (status='settled') mas uma etapa
// posterior da liquidacao falha (sorteio encerrado, capacidade esgotada) - move o
// pedido, que ja e propriedade exclusiva desta chamada, para conciliacao manual.
export async function demoteSettledOrderToReview(providerPaymentId: string, reason: string): Promise<PaymentOrder | null> {
  const db = getDb();
  const result = await db
    .update(paymentOrders)
    .set({ status: "review_required", reviewReason: reason, updatedAt: new Date() })
    .where(and(eq(paymentOrders.providerPaymentId, providerPaymentId), eq(paymentOrders.status, "settled")))
    .returning();
  return result[0] ?? null;
}

export async function markPaymentOrderRefunded(providerPaymentId: string): Promise<PaymentOrder | null> {
  const db = getDb();
  const result = await db
    .update(paymentOrders)
    .set({ status: "refunded", updatedAt: new Date() })
    .where(and(eq(paymentOrders.providerPaymentId, providerPaymentId), eq(paymentOrders.status, "pending")))
    .returning();
  return result[0] ?? null;
}

// Chargeback de um pedido que nunca chegou a ser liquidado: nada a reverter, so
// marca o estado terminal.
export async function markPaymentOrderChargeback(providerPaymentId: string): Promise<PaymentOrder | null> {
  const db = getDb();
  const result = await db
    .update(paymentOrders)
    .set({ status: "chargeback", updatedAt: new Date() })
    .where(and(eq(paymentOrders.providerPaymentId, providerPaymentId), eq(paymentOrders.status, "pending")))
    .returning();
  return result[0] ?? null;
}

// Guarda de idempotencia para chargeback de um pedido ja liquidado: so uma chamada
// reivindica o pedido (status 'settled' -> 'chargeback'), passando a responsabilidade
// de reverter o efeito (UTEF/bilhete) a quem reivindicou. Mesmo padrao de
// claimPendingPaymentOrder, aplicado ao estado 'settled'.
export async function claimSettledPaymentOrderForChargeback(providerPaymentId: string): Promise<PaymentOrder | null> {
  const db = getDb();
  const result = await db
    .update(paymentOrders)
    .set({ status: "chargeback", updatedAt: new Date() })
    .where(and(eq(paymentOrders.providerPaymentId, providerPaymentId), eq(paymentOrders.status, "settled")))
    .returning();
  return result[0] ?? null;
}

// Credito atomico de UTEF: UPSERT com incremento no proprio SQL (nunca le o saldo
// antes de escrever), elimina a corrida de leitura-e-escrita do createOrUpdateUtefBalance.
export async function incrementUtefBalanceAtomic(userId: number, amount: number): Promise<void> {
  const db = getDb();
  await db
    .insert(utefBalances)
    .values({ userId, balance: amount })
    .onConflictDoUpdate({
      target: utefBalances.userId,
      set: { balance: sql`${utefBalances.balance} + ${amount}`, updatedAt: new Date() },
    });
}

// Debito atomico e condicional: so decrementa se o saldo atual for suficiente, em um
// unico UPDATE...WHERE (sem read-then-write). Impede gasto duplicado quando duas
// conversoes concorrentes leem o mesmo saldo "suficiente" antes de qualquer escrita.
// Retorna true se o debito foi aplicado, false se o saldo era insuficiente.
export async function decrementUtefBalanceAtomic(userId: number, amount: number): Promise<boolean> {
  const db = getDb();
  const result = await db
    .update(utefBalances)
    .set({ balance: sql`${utefBalances.balance} - ${amount}`, updatedAt: new Date() })
    .where(and(eq(utefBalances.userId, userId), sql`${utefBalances.balance} >= ${amount}`))
    .returning({ id: utefBalances.id });
  return result.length > 0;
}

export async function createDraw(draw: InsertDraw): Promise<Draw> {
  const db = getDb();
  const result = await db.insert(draws).values(draw).returning();
  return result[0];
}

export async function updateDraw(id: number, updates: Partial<InsertDraw>): Promise<void> {
  const db = getDb();
  await db.update(draws).set(updates).where(eq(draws.id, id));
}

// ========== TICKETS ==========

export async function createTicket(ticket: InsertTicket): Promise<Ticket> {
  const db = getDb();
  const result = await db.insert(tickets).values(ticket).returning();
  return result[0];
}

export async function getTicketsByUserId(userId: number): Promise<Ticket[]> {
  const db = getDb();
  return db.select().from(tickets).where(eq(tickets.userId, userId)).orderBy(desc(tickets.createdAt));
}

export async function updateTicketPaymentStatus(ticketId: number, status: 'pending' | 'confirmed' | 'failed') {
  const db = getDb();
  await db.update(tickets).set({ paymentStatus: status }).where(eq(tickets.id, ticketId));
}

export async function incrementDrawStats(drawId: number, amount: number, ticketCount: number) {
  const db = getDb();
  const draw = await getDrawById(drawId);
  if (!draw) return;
  await db.update(draws).set({
    currentAmount: draw.currentAmount + amount,
    ticketsSold: draw.ticketsSold + ticketCount,
  }).where(eq(draws.id, drawId));
}

export async function getTicketsByDrawId(drawId: number): Promise<Ticket[]> {
  const db = getDb();
  return db.select().from(tickets).where(eq(tickets.drawId, drawId));
}

export async function updateTicket(id: number, updates: Partial<InsertTicket>): Promise<void> {
  const db = getDb();
  await db.update(tickets).set(updates).where(eq(tickets.id, id));
}

// ========== UTEF BALANCES ==========

export async function getUtefBalance(userId: number): Promise<UtefBalance | undefined> {
  const db = getDb();
  const result = await db.select().from(utefBalances).where(eq(utefBalances.userId, userId)).limit(1);
  return result[0];
}

export async function createOrUpdateUtefBalance(userId: number, amount: number): Promise<void> {
  const db = getDb();
  const existing = await getUtefBalance(userId);
  if (existing) {
    await db.update(utefBalances).set({ balance: existing.balance + amount }).where(eq(utefBalances.userId, userId));
  } else {
    await db.insert(utefBalances).values({ userId, balance: amount });
  }
}

export const addUtefBalance = createOrUpdateUtefBalance;

// ========== UTEF TRANSACTIONS ==========

export async function createUtefTransaction(transaction: InsertUtefTransaction): Promise<UtefTransaction> {
  const db = getDb();
  const result = await db.insert(utefTransactions).values(transaction).returning();
  return result[0];
}

export async function getUtefTransactionsByUserId(userId: number): Promise<UtefTransaction[]> {
  const db = getDb();
  return db.select().from(utefTransactions).where(eq(utefTransactions.userId, userId)).orderBy(desc(utefTransactions.createdAt));
}

// ========== PRODUCTS ==========

export async function getProducts(category?: string): Promise<Product[]> {
  const db = getDb();
  if (category) {
    return db.select().from(products).where(and(eq(products.category, category as any), eq(products.status, "available")));
  }
  return db.select().from(products).where(eq(products.status, "available"));
}

export async function getProductById(id: number): Promise<Product | undefined> {
  const db = getDb();
  const result = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return result[0];
}

export async function createProduct(product: InsertProduct): Promise<Product> {
  const db = getDb();
  const result = await db.insert(products).values(product).returning();
  return result[0];
}

// ========== PRODUCT CONVERSIONS ==========

export async function createProductConversion(conversion: InsertProductConversion): Promise<ProductConversion> {
  const db = getDb();
  const result = await db.insert(productConversions).values(conversion).returning();
  return result[0];
}

export async function getConversionsByUserId(userId: number) {
  const db = getDb();
  return db
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
}

// ========== CONSTRUCTION PROJECTS ==========

// O tipo de projeto exibido vem do serviço do CRM; o valor gravado só vale
// para obras antigas sem serviço vinculado.
function aplicarTipoProjetoOficial(row: { project: ConstructionProject; serviceType: string | null }): ConstructionProject {
  return { ...row.project, projectType: tipoProjetoDoServico(row.serviceType) ?? row.project.projectType };
}

export async function getProjectsByUserId(userId: number): Promise<ConstructionProject[]> {
  const db = getDb();
  const rows = await db.select({ project: constructionProjects, serviceType: leadServices.serviceType })
    .from(constructionProjects)
    .leftJoin(leadServices, eq(leadServices.id, constructionProjects.leadServiceId))
    .where(eq(constructionProjects.userId, userId))
    .orderBy(desc(constructionProjects.createdAt));
  return rows.map(aplicarTipoProjetoOficial);
}

export type ProjetoDaLista = ConstructionProject & {
  clientName: string | null;
  contractorName: string | null;
  crmResponsibleName: string | null;
  /** Pedido de 18/10: medições aguardando o banco e medições já recebidas (filtro da lista). */
  medicoesSolicitadas: number;
  medicoesRecebidas: number;
  /** Pedido de 23/10 (H5): a obra tem PCI da CAIXA vinculada (selo no card da lista). */
  pciVinculada: boolean;
};

/**
 * Lista administrativa de obras, com os nomes usados nos filtros (item 01).
 * Com `somenteEmpreiteiroId`, só as obras desse empreiteiro (portal, 15/10).
 */
export async function getAllProjects(somenteEmpreiteiroId?: number): Promise<ProjetoDaLista[]> {
  const db = getDb();
  const contractor = alias(users, "contractor");
  const crmResponsible = alias(users, "crm_responsible");
  const rows = await db.select({
    project: constructionProjects, serviceType: leadServices.serviceType,
    clientName: leads.name, contractorName: contractor.name, crmResponsibleName: crmResponsible.name,
  })
    .from(constructionProjects)
    .leftJoin(leadServices, eq(leadServices.id, constructionProjects.leadServiceId))
    .leftJoin(leads, eq(leads.id, constructionProjects.leadId))
    .leftJoin(contractor, eq(contractor.id, constructionProjects.contractorUserId))
    .leftJoin(crmResponsible, eq(crmResponsible.id, leads.responsibleUserId))
    .where(somenteEmpreiteiroId === undefined ? undefined : eq(constructionProjects.contractorUserId, somenteEmpreiteiroId))
    .orderBy(desc(constructionProjects.createdAt));
  const medicoes = await db.select({
    projectId: constructionProgressHistory.projectId,
    solicitadas: sql<number>`count(*) filter (where ${constructionProgressHistory.requestedAt} is not null and ${constructionProgressHistory.receivedAt} is null)::int`,
    recebidas: sql<number>`count(*) filter (where ${constructionProgressHistory.receivedAt} is not null)::int`,
  }).from(constructionProgressHistory).groupBy(constructionProgressHistory.projectId);
  const porObra = new Map(medicoes.map((m) => [m.projectId, m]));
  const pcis = await db.select({ projectId: constructionPci.projectId }).from(constructionPci)
    .where(sql`${constructionPci.linkedAt} is not null`);
  const comPci = new Set(pcis.map((p) => p.projectId));
  return rows.map((row) => ({
    pciVinculada: comPci.has(row.project.id),
    medicoesSolicitadas: Number(porObra.get(row.project.id)?.solicitadas ?? 0),
    medicoesRecebidas: Number(porObra.get(row.project.id)?.recebidas ?? 0),
    ...aplicarTipoProjetoOficial(row),
    clientName: row.clientName ?? row.project.mcmvClientName ?? null,
    contractorName: row.contractorName ?? null,
    crmResponsibleName: row.crmResponsibleName ?? null,
  }));
}

export async function getProjectById(id: number): Promise<ConstructionProject | undefined> {
  const db = getDb();
  const result = await db.select().from(constructionProjects).where(eq(constructionProjects.id, id)).limit(1);
  return result[0];
}

export async function createProject(project: InsertConstructionProject): Promise<ConstructionProject> {
  const db = getDb();
  const result = await db.insert(constructionProjects).values(project).returning();
  return result[0];
}

export async function updateProject(id: number, updates: Partial<InsertConstructionProject>): Promise<void> {
  const db = getDb();
  await db.update(constructionProjects).set(updates).where(eq(constructionProjects.id, id));
}

export async function deleteProject(id: number): Promise<void> {
  const db = getDb();
  await db.delete(constructionPhotos).where(eq(constructionPhotos.projectId, id));
  await db.delete(constructionStages).where(eq(constructionStages.projectId, id));
  await db.delete(constructionProjects).where(eq(constructionProjects.id, id));
}

// ========== CONSTRUCTION STAGES ==========

export async function getStagesByProjectId(projectId: number): Promise<ConstructionStage[]> {
  const db = getDb();
  return db.select().from(constructionStages).where(eq(constructionStages.projectId, projectId)).orderBy(constructionStages.orderIndex);
}

export async function getStageById(id: number): Promise<ConstructionStage | undefined> {
  const db = getDb();
  const result = await db.select().from(constructionStages).where(eq(constructionStages.id, id)).limit(1);
  return result[0];
}

export async function createStage(stage: InsertConstructionStage): Promise<ConstructionStage> {
  const db = getDb();
  const result = await db.insert(constructionStages).values(stage).returning();
  return result[0];
}

export async function updateStage(id: number, updates: Partial<InsertConstructionStage>): Promise<void> {
  const db = getDb();
  await db.update(constructionStages).set(updates).where(eq(constructionStages.id, id));
}

export async function deleteStage(id: number): Promise<void> {
  const db = getDb();
  await db.delete(constructionPhotos).where(eq(constructionPhotos.stageId, id));
  await db.delete(constructionStages).where(eq(constructionStages.id, id));
}

// ========== CONSTRUCTION PHOTOS ==========

export async function getPhotosByProjectId(projectId: number): Promise<ConstructionPhoto[]> {
  const db = getDb();
  return db.select().from(constructionPhotos).where(eq(constructionPhotos.projectId, projectId)).orderBy(desc(constructionPhotos.takenAt));
}

export async function getPhotosByStageId(stageId: number): Promise<ConstructionPhoto[]> {
  const db = getDb();
  return db.select().from(constructionPhotos).where(eq(constructionPhotos.stageId, stageId)).orderBy(desc(constructionPhotos.takenAt));
}

export async function createPhoto(photo: InsertConstructionPhoto): Promise<ConstructionPhoto> {
  const db = getDb();
  const result = await db.insert(constructionPhotos).values(photo).returning();
  return result[0];
}

export async function deletePhoto(id: number): Promise<void> {
  const db = getDb();
  await db.delete(constructionPhotos).where(eq(constructionPhotos.id, id));
}

export async function getProjectWithDetails(projectId: number) {
  const project = await getProjectById(projectId);
  if (!project) return null;
  const [stages, photos, crm] = await Promise.all([
    getStagesByProjectId(projectId),
    getPhotosByProjectId(projectId),
    getObraDadosCrm(project),
  ]);
  return { ...project, projectType: crm.projectType, stages, photos, crm };
}

export async function getObraDadosCrm(project: Pick<ConstructionProject, "leadId" | "leadServiceId" | "projectType">): Promise<ObraDadosCrm> {
  const db = getDb();
  const [lead] = project.leadId
    ? await db.select({ name: leads.name, brokerName: users.name })
        .from(leads)
        .leftJoin(users, eq(users.id, leads.brokerId))
        .where(eq(leads.id, project.leadId))
        .limit(1)
    : [];
  const [service] = project.leadServiceId
    ? await db.select({ serviceType: leadServices.serviceType })
        .from(leadServices)
        .where(eq(leadServices.id, project.leadServiceId))
        .limit(1)
    : [];
  return montarDadosCrmObra({
    leadName: lead?.name,
    brokerName: lead?.brokerName,
    serviceType: service?.serviceType,
    projectTypeGravado: project.projectType,
  });
}

// ========== PROJECT BUDGET REQUESTS ==========

export async function createBudgetRequest(request: InsertProjectBudgetRequest): Promise<ProjectBudgetRequest> {
  const db = getDb();
  const result = await db.insert(projectBudgetRequests).values(request).returning();
  return result[0];
}

export async function getAllBudgetRequests(): Promise<ProjectBudgetRequest[]> {
  const db = getDb();
  return db.select().from(projectBudgetRequests).orderBy(desc(projectBudgetRequests.createdAt));
}

export async function getBudgetRequestById(id: number): Promise<ProjectBudgetRequest | undefined> {
  const db = getDb();
  const result = await db.select().from(projectBudgetRequests).where(eq(projectBudgetRequests.id, id)).limit(1);
  return result[0];
}

export async function updateBudgetRequest(id: number, updates: Partial<InsertProjectBudgetRequest>): Promise<void> {
  const db = getDb();
  await db.update(projectBudgetRequests).set(updates).where(eq(projectBudgetRequests.id, id));
}

export async function deleteBudgetRequest(id: number): Promise<void> {
  const db = getDb();
  await db.delete(projectBudgetRequests).where(eq(projectBudgetRequests.id, id));
}

// ========== ANALYTICS & STATISTICS ==========

export async function getAnalyticsStats() {
  const db = getDb();

  const [
    totalBudgetRequests, pendingBudgetRequests, convertedBudgetRequests,
    totalProjects, activeProjects, completedProjects,
    totalDraws, activeDraws, totalTickets, totalUtefBalance,
    totalUtefTransactions, totalUsers,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(projectBudgetRequests),
    db.select({ count: sql<number>`count(*)` }).from(projectBudgetRequests).where(eq(projectBudgetRequests.status, "pending")),
    db.select({ count: sql<number>`count(*)` }).from(projectBudgetRequests).where(eq(projectBudgetRequests.status, "converted")),
    db.select({ count: sql<number>`count(*)` }).from(constructionProjects),
    db.select({ count: sql<number>`count(*)` }).from(constructionProjects).where(eq(constructionProjects.status, "in_progress")),
    db.select({ count: sql<number>`count(*)` }).from(constructionProjects).where(eq(constructionProjects.status, "completed")),
    db.select({ count: sql<number>`count(*)` }).from(draws),
    db.select({ count: sql<number>`count(*)` }).from(draws).where(eq(draws.status, "active")),
    db.select({ count: sql<number>`count(*)` }).from(tickets),
    db.select({ sum: sql<number>`sum(balance)` }).from(utefBalances),
    db.select({ count: sql<number>`count(*)` }).from(utefTransactions),
    db.select({ count: sql<number>`count(*)` }).from(users),
  ]);

  return {
    budgetRequests: {
      total: totalBudgetRequests[0]?.count || 0,
      pending: pendingBudgetRequests[0]?.count || 0,
      converted: convertedBudgetRequests[0]?.count || 0,
      conversionRate: totalBudgetRequests[0]?.count > 0
        ? ((convertedBudgetRequests[0]?.count || 0) / totalBudgetRequests[0].count * 100).toFixed(1)
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
    tickets: { total: totalTickets[0]?.count || 0, revenue: 0 },
    utef: {
      totalBalance: totalUtefBalance[0]?.sum || 0,
      totalTransactions: totalUtefTransactions[0]?.count || 0,
    },
    users: { total: totalUsers[0]?.count || 0 },
  };
}

export async function getBudgetRequestsByStatus() {
  const db = getDb();
  return db
    .select({ status: projectBudgetRequests.status, count: sql<number>`count(*)` })
    .from(projectBudgetRequests)
    .groupBy(projectBudgetRequests.status);
}

export async function getProjectsByStatus() {
  const db = getDb();
  return db
    .select({ status: constructionProjects.status, count: sql<number>`count(*)` })
    .from(constructionProjects)
    .groupBy(constructionProjects.status);
}

export async function getRecentBudgetRequests(limit: number = 5) {
  const db = getDb();
  return db.select().from(projectBudgetRequests).orderBy(desc(projectBudgetRequests.createdAt)).limit(limit);
}

// ========== EMAIL LOGS ==========

export async function getAllEmailLogs(): Promise<EmailLog[]> {
  const db = getDb();
  return db.select().from(emailLogs).orderBy(desc(emailLogs.createdAt));
}

export async function getRecentEmailLogs(limit: number = 20): Promise<EmailLog[]> {
  const db = getDb();
  return db.select().from(emailLogs).orderBy(desc(emailLogs.createdAt)).limit(limit);
}

export async function getEmailLogById(id: number): Promise<EmailLog | undefined> {
  const db = getDb();
  const result = await db.select().from(emailLogs).where(eq(emailLogs.id, id)).limit(1);
  return result[0];
}

// ========== USER NOTIFICATIONS ==========

export async function createNotification(notification: InsertUserNotification): Promise<UserNotification> {
  const db = getDb();
  const result = await db.insert(userNotifications).values(notification).returning();
  return result[0];
}

export async function getUserNotifications(userId: number): Promise<UserNotification[]> {
  const db = getDb();
  return db.select().from(userNotifications)
    .where(eq(userNotifications.userId, userId))
    .orderBy(desc(userNotifications.createdAt));
}

export async function getUnreadNotifications(userId: number): Promise<UserNotification[]> {
  const db = getDb();
  return db.select().from(userNotifications)
    .where(and(eq(userNotifications.userId, userId), eq(userNotifications.isRead, false)))
    .orderBy(desc(userNotifications.createdAt));
}

export async function getUnreadNotificationCount(userId: number): Promise<number> {
  const db = getDb();
  const result = await db.select({ count: sql<number>`count(*)` })
    .from(userNotifications)
    .where(and(eq(userNotifications.userId, userId), eq(userNotifications.isRead, false)));
  return result[0]?.count || 0;
}

export async function markNotificationAsRead(notificationId: number): Promise<void> {
  const db = getDb();
  await db.update(userNotifications)
    .set({ isRead: true, readAt: new Date() })
    .where(eq(userNotifications.id, notificationId));
}

export async function markAllNotificationsAsRead(userId: number): Promise<void> {
  const db = getDb();
  await db.update(userNotifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(userNotifications.userId, userId), eq(userNotifications.isRead, false)));
}

// ========== CRM — LEADS ==========

export async function getAllLeads(filters?: {
  stage?: string;
  responsible?: string;
  temperature?: string;
  city?: string;
  includeDeleted?: boolean;
}): Promise<Lead[]> {
  const db = getDb();
  let query = db.select().from(leads).$dynamic();
  const conditions = [];
  if (!filters?.includeDeleted) conditions.push(isNull(leads.deletedAt));
  if (filters?.stage) conditions.push(eq(leads.stage, filters.stage as any));
  if (filters?.responsible) {
    // EPIC-017: o filtro usa o usuário responsável; nomes legados ainda são aceitos.
    const userId = Number(filters.responsible);
    conditions.push(Number.isInteger(userId) && userId > 0
      ? eq(leads.responsibleUserId, userId)
      : eq(leads.responsible, filters.responsible as any));
  }
  if (filters?.temperature) conditions.push(eq(leads.temperature, filters.temperature as any));
  if (filters?.city) conditions.push(like(leads.city, `%${filters.city}%`));
  if (conditions.length > 0) query = query.where(and(...conditions));
  return query.orderBy(desc(leads.createdAt));
}

export async function getLeadById(id: number): Promise<Lead | undefined> {
  const db = getDb();
  const result = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  return result[0];
}

export async function getLeadOptions(): Promise<{ id: number; name: string }[]> {
  const db = getDb();
  return db.select({ id: leads.id, name: leads.name }).from(leads).where(isNull(leads.deletedAt)).orderBy(leads.name);
}

/**
 * EPIC-017 — leads ativos com os dados cadastrais que migram para os serviços
 * (Avaliações, Financiamentos, Obras). Usado pelos seletores de lead dos módulos.
 */
export async function getLeadContactOptions() {
  const db = getDb();
  return db.select({
    id: leads.id, name: leads.name, phone: leads.phone, email: leads.email, cpf: leads.cpf,
    address: leads.address, neighborhood: leads.neighborhood, city: leads.city, state: leads.state,
  }).from(leads).where(isNull(leads.deletedAt)).orderBy(leads.name);
}

/** Responsáveis (admin/colaborador) e corretores reais, ativos, para o cadastro de lead. */
export async function getLeadAssignmentOptions() {
  const db = getDb();
  const rows = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(and(eq(users.active, true), inArray(users.role, ["admin", "colaborador", "corretor"])))
    .orderBy(asc(users.name));
  return {
    responsibles: rows.filter(row => row.role === "admin" || row.role === "colaborador"),
    brokers: rows.filter(row => row.role === "corretor"),
  };
}

/** Confere se o responsável/corretor informados existem com o papel correto. */
export async function validateLeadAssignment(input: { responsibleUserId?: number | null; brokerId?: number | null }) {
  const ids = [input.responsibleUserId, input.brokerId].filter((id): id is number => typeof id === "number");
  if (!ids.length) return { responsibleOk: true, brokerOk: true };
  const db = getDb();
  const rows = await db.select({ id: users.id, role: users.role }).from(users).where(inArray(users.id, ids));
  const roleOf = (id: number | null | undefined) => rows.find(row => row.id === id)?.role;
  return {
    responsibleOk: input.responsibleUserId == null || ["admin", "colaborador"].includes(roleOf(input.responsibleUserId) ?? ""),
    brokerOk: input.brokerId == null || roleOf(input.brokerId) === "corretor",
  };
}

/**
 * Leads elegíveis para vínculo em seletores de Tarefas/Agenda: exclui leads
 * excluídos (soft delete) e leads rejeitados (equivalente a "arquivado/inativo"
 * no modelo atual — não existe um campo "active"/"archived" dedicado em `leads`).
 */
export async function getAssignableLeadOptions(): Promise<{ id: number; name: string }[]> {
  const db = getDb();
  return db
    .select({ id: leads.id, name: leads.name })
    .from(leads)
    .where(and(isNull(leads.deletedAt), ne(leads.stage, "rejected")))
    .orderBy(leads.name);
}

/** Mesma regra de getAssignableLeadOptions, mas para validar um vínculo pontual no servidor. */
export async function getAssignableLeadById(id: number): Promise<Lead | undefined> {
  const db = getDb();
  const result = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, id), isNull(leads.deletedAt), ne(leads.stage, "rejected")))
    .limit(1);
  return result[0];
}

export async function createLead(data: InsertLead): Promise<Lead> {
  const db = getDb();
  const result = await db.insert(leads).values(data).returning();
  return result[0];
}

export async function updateLead(id: number, data: Partial<InsertLead>): Promise<void> {
  const db = getDb();
  await db.update(leads).set({ ...data, updatedAt: new Date() }).where(eq(leads.id, id));
}

// Item 16 (18/10): o histórico mostra o nome da etapa, nunca o código interno.
const ROTULOS_ESTAGIO: Record<string, string> = {
  ...LEGACY_STAGE_LABELS,
  ...Object.fromEntries(LEAD_PIPELINE_STAGES.map(s => [s.key, s.label])),
};

export async function updateLeadPipelineStage(id: number, stage: string, actorId: number): Promise<boolean> {
  const db = getDb();
  const result = await db.execute(sql`
    WITH previous AS (
      SELECT id, stage AS old_stage FROM leads
      WHERE id = ${id} AND deleted_at IS NULL AND (stage <> ${stage} OR stage_classification_pending)
      FOR UPDATE
    ), changed AS (
      UPDATE leads AS lead
      SET stage = ${stage}, stage_classification_pending = false, updated_at = now()
      FROM previous WHERE lead.id = previous.id
      RETURNING lead.id, previous.old_stage
    ), audit AS (
      INSERT INTO lead_activities (lead_id, type, description, performed_by, metadata)
      SELECT id, 'status_change'::lead_activity_type,
             'Estágio alterado de "' || COALESCE(${JSON.stringify(ROTULOS_ESTAGIO)}::jsonb ->> old_stage, old_stage) || '" para "' || ${rotulo(stage)} || '"', ${String(actorId)},
             ${JSON.stringify({ operation: "pipeline_stage_change", stage })}
      FROM changed RETURNING id
    )
    SELECT count(*)::integer AS count FROM audit
  `);
  return Number(result.rows[0]?.count ?? 0) === 1;
}

export async function getLeadDeletionContext(id: number) {
  const db = getDb();
  const [services, accounts, projects] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(leadServices).where(eq(leadServices.leadId, id)),
    db.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.leadId, id)),
    db.select({ count: sql<number>`count(*)` }).from(constructionProjects).where(eq(constructionProjects.leadId, id)),
  ]);
  return { services: Number(services[0]?.count || 0), accounts: Number(accounts[0]?.count || 0), projects: Number(projects[0]?.count || 0) };
}

/** One SQL statement makes the state change and audit entry atomic. */
export function leadDeletionStatement(id: number, actorId: number, deleted: boolean) {
  return sql`
    WITH changed AS (
      UPDATE leads
      SET deleted_at = ${deleted ? new Date() : null},
          deleted_by_user_id = ${deleted ? actorId : null},
          updated_at = now()
      WHERE id = ${id} AND ${deleted ? sql`deleted_at IS NULL` : sql`deleted_at IS NOT NULL`}
      RETURNING id
    ), audit AS (
      INSERT INTO lead_activities (lead_id, type, description, performed_by, metadata)
      SELECT id, 'note'::lead_activity_type,
             ${deleted ? "Lead excluído logicamente pelo administrador" : "Lead recuperado pelo administrador"},
             ${String(actorId)},
             ${JSON.stringify({ operation: deleted ? "soft_delete" : "restore", actorId })}
      FROM changed
      RETURNING id
    )
    SELECT count(*)::integer AS count FROM audit
  `;
}

export async function setLeadDeleted(id: number, actorId: number, deleted: boolean): Promise<boolean> {
  const updated = await getDb().execute(leadDeletionStatement(id, actorId, deleted));
  return Number(updated.rows[0]?.count ?? 0) === 1;
}

/** Pedido de 23/10 (H3): o que impede a exclusão definitiva de um lead. */
export async function getLeadVinculosExclusao(id: number): Promise<VinculosLead> {
  const r = await getDb().execute(sql`
    SELECT
      (SELECT count(*) FROM construction_projects WHERE lead_id = ${id})::int AS obras,
      (SELECT count(*) FROM financiamentos WHERE lead_id = ${id})::int AS financiamentos,
      (SELECT count(*) FROM regularizacoes WHERE lead_id = ${id})::int AS regularizacoes,
      (SELECT count(*) FROM operational_projects WHERE lead_id = ${id})::int AS projetos,
      (SELECT count(*) FROM avaliacoes WHERE lead_id = ${id})::int AS avaliacoes,
      (SELECT count(*) FROM portal_contracts WHERE lead_id = ${id})::int AS contratos,
      -- Pedido de 29/10 (paridade com o Santa Fé): documento com cópia no Drive não bloqueia
      -- (a pasta vai para a lixeira do Drive); só documento guardado apenas no banco bloqueia.
      (SELECT count(*) FROM lead_documents WHERE lead_id = ${id} AND deleted_at IS NULL AND drive_file_id IS NULL)::int AS documentos,
      (SELECT count(*) FROM users WHERE lead_id = ${id})::int AS contas`);
  const row = (r.rows[0] ?? {}) as Record<string, unknown>;
  return Object.fromEntries(VINCULOS_LEAD.map(([chave]) => [chave, Number(row[chave] ?? 0)])) as VinculosLead;
}

/**
 * Exclusão definitiva (H3), numa única instrução: só apaga lead ARQUIVADO e sem
 * nenhum vínculo (mesmas condições de getLeadVinculosExclusao, rechecadas aqui).
 * Leva junto histórico, follow-ups, tarefas, documentos já excluídos (a pasta do cliente no Drive vai
 * para a lixeira depois, em leads.permanentDelete — pedido de 29/10), serviços,
 * preferências, alertas e chat do lead; mensagens de WhatsApp ficam na caixa,
 * apenas sem o vínculo. Devolve true se o lead foi apagado.
 */
export async function excluirLeadArquivadoDefinitivamente(id: number): Promise<boolean> {
  const r = await getDb().execute(sql`
    WITH alvo AS (
      SELECT l.id FROM leads l
      WHERE l.id = ${id} AND l.deleted_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM construction_projects WHERE lead_id = l.id)
        AND NOT EXISTS (SELECT 1 FROM financiamentos WHERE lead_id = l.id)
        AND NOT EXISTS (SELECT 1 FROM regularizacoes WHERE lead_id = l.id)
        AND NOT EXISTS (SELECT 1 FROM operational_projects WHERE lead_id = l.id)
        AND NOT EXISTS (SELECT 1 FROM avaliacoes WHERE lead_id = l.id)
        AND NOT EXISTS (SELECT 1 FROM portal_contracts WHERE lead_id = l.id)
        AND NOT EXISTS (SELECT 1 FROM lead_documents WHERE lead_id = l.id AND deleted_at IS NULL AND drive_file_id IS NULL)
        AND NOT EXISTS (SELECT 1 FROM users WHERE lead_id = l.id)
      FOR UPDATE
    ), atividades AS (
      DELETE FROM lead_activities WHERE lead_id IN (SELECT id FROM alvo)
    ), followups AS (
      DELETE FROM lead_follow_ups WHERE lead_id IN (SELECT id FROM alvo)
    ), tarefas AS (
      DELETE FROM tasks WHERE related_type = 'lead' AND related_id IN (SELECT id FROM alvo)
    ), documentos_excluidos AS (
      -- Pedido de 29/10: todos os documentos do lead (os ativos já estão no Drive); a pasta do
      -- cliente vai para a lixeira do Drive logo depois; cópias usadas por outro lead são movidas antes.
      DELETE FROM lead_documents WHERE lead_id IN (SELECT id FROM alvo)
    ), whatsapp AS (
      UPDATE whatsapp_messages SET lead_id = NULL WHERE lead_id IN (SELECT id FROM alvo)
    ), apagado AS (
      DELETE FROM leads WHERE id IN (SELECT id FROM alvo) RETURNING id
    )
    SELECT count(*)::int AS count FROM apagado`);
  return Number(r.rows[0]?.count ?? 0) === 1;
}

export async function getLeadActivities(leadId: number): Promise<LeadActivity[]> {
  const db = getDb();
  return db.select().from(leadActivities).where(eq(leadActivities.leadId, leadId)).orderBy(desc(leadActivities.createdAt));
}

export async function addLeadActivity(data: InsertLeadActivity): Promise<void> {
  const db = getDb();
  await db.insert(leadActivities).values(data);
}

export async function getLeadDocuments(leadId: number): Promise<LeadDocument[]> {
  const db = getDb();
  return db.select().from(leadDocuments).where(eq(leadDocuments.leadId, leadId)).orderBy(desc(leadDocuments.createdAt));
}

export async function addLeadDocument(data: InsertLeadDocument): Promise<void> {
  const db = getDb();
  await db.insert(leadDocuments).values(data);
}

export async function updateLeadDocument(id: number, data: Partial<InsertLeadDocument>): Promise<void> {
  const db = getDb();
  await db.update(leadDocuments).set(data).where(eq(leadDocuments.id, id));
}

export async function getLeadFollowUps(leadId: number): Promise<LeadFollowUp[]> {
  const db = getDb();
  return db.select().from(leadFollowUps).where(eq(leadFollowUps.leadId, leadId)).orderBy(leadFollowUps.scheduledAt);
}

export async function createFollowUp(data: InsertLeadFollowUp): Promise<void> {
  const db = getDb();
  await db.insert(leadFollowUps).values(data);
}

export async function getPendingFollowUps(): Promise<LeadFollowUp[]> {
  const db = getDb();
  return db.select().from(leadFollowUps)
    .where(eq(leadFollowUps.status, "pending"))
    .orderBy(leadFollowUps.scheduledAt);
}

export async function updateFollowUp(id: number, data: Partial<InsertLeadFollowUp>): Promise<void> {
  const db = getDb();
  await db.update(leadFollowUps).set(data).where(eq(leadFollowUps.id, id));
}

export async function getLeadStats() {
  const db = getDb();
  const [total, hot, approved, rejected] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(leads).where(isNull(leads.deletedAt)),
    db.select({ count: sql<number>`count(*)` }).from(leads).where(and(isNull(leads.deletedAt), eq(leads.temperature, "hot"))),
    db.select({ count: sql<number>`count(*)` }).from(leads).where(and(isNull(leads.deletedAt), eq(leads.stage, "approved_projects"))),
    db.select({ count: sql<number>`count(*)` }).from(leads).where(and(isNull(leads.deletedAt), eq(leads.stage, "rejected"))),
  ]);
  return {
    total: total[0]?.count || 0,
    hot: hot[0]?.count || 0,
    approved: approved[0]?.count || 0,
    rejected: rejected[0]?.count || 0,
  };
}

// ========== RESPONSÁVEIS (ADMIN/COLABORADOR ATIVOS) ==========
// Fonte única de "quem pode ser responsável" por uma Tarefa ou por um
// compromisso de Agenda: carregado do banco, nunca uma lista fixa de nomes.
// Critério: role in (admin, colaborador) e active = true.
const ASSIGNABLE_ROLES = ["admin", "colaborador"] as const;

export async function getAssignableUsers(): Promise<{ id: number; name: string | null }[]> {
  const db = getDb();
  return db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(inArray(users.role, ASSIGNABLE_ROLES), eq(users.active, true)))
    .orderBy(users.name);
}

export async function getAssignableUserById(
  id: number
): Promise<{ id: number; name: string | null } | undefined> {
  const db = getDb();
  const result = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.id, id), inArray(users.role, ASSIGNABLE_ROLES), eq(users.active, true)))
    .limit(1);
  return result[0];
}

// ========== TAREFAS (TASKS) ==========

export async function getAllTasks(assignedTo?: string): Promise<Task[]> {
  const db = getDb();
  if (assignedTo) {
    return db.select().from(tasks).where(eq(tasks.assignedTo, assignedTo)).orderBy(desc(tasks.createdAt));
  }
  return db.select().from(tasks).orderBy(desc(tasks.createdAt));
}

export async function createTask(data: InsertTask): Promise<Task> {
  const db = getDb();
  const result = await db.insert(tasks).values(data).returning();
  return result[0];
}

export async function getTaskById(id: number): Promise<Task | undefined> {
  const db = getDb();
  return (await db.select().from(tasks).where(eq(tasks.id, id)).limit(1))[0];
}

export async function deleteTask(id: number): Promise<void> {
  const db = getDb();
  await db.delete(tasks).where(eq(tasks.id, id));
}

export async function updateTask(id: number, data: Partial<InsertTask>): Promise<void> {
  const db = getDb();
  await db.update(tasks).set({ ...data, updatedAt: new Date() }).where(eq(tasks.id, id));
}

// ========== CONTROLE DE CORRETORES ==========

// ========== TRANSAÇÕES FINANCEIRAS ==========

export async function getAllFinancialTransactions(): Promise<FinancialTransaction[]> {
  const db = getDb();
  return db.select().from(financialTransactions).orderBy(desc(financialTransactions.createdAt));
}

export async function getManagementDashboardData() {
  const database = getDb();
  const [transactions, accounts, bankTx, leadRows, userRows, commissions, projects, settings] = await Promise.all([
    database.select({ status: financialTransactions.status, paidAt: financialTransactions.paidAt, createdAt: financialTransactions.createdAt, type: financialTransactions.type, amount: financialTransactions.amount, dueDate: financialTransactions.dueDate, vendor: financialTransactions.vendor, responsible: financialTransactions.responsible, description: financialTransactions.description, category: financialTransactions.category }).from(financialTransactions).orderBy(desc(financialTransactions.createdAt)),
    database.select({ saldoAtual: bankAccounts.saldoAtual }).from(bankAccounts).where(eq(bankAccounts.ativo, true)),
    database.select({ data: bankTransactions.data, status: bankTransactions.status, tipo: bankTransactions.tipo, valor: bankTransactions.valor }).from(bankTransactions).orderBy(desc(bankTransactions.data)),
    database.select({ stage: leads.stage }).from(leads),
    database.select({ id: users.id, name: users.name, role: users.role, active: users.active, createdAt: users.createdAt }).from(users),
    database.select({ amount: operationalCommissions.amount, paidAt: operationalCommissions.paidAt, brokerId: operationalCommissions.brokerId, businessType: operationalCommissions.businessType, property: operationalCommissions.property }).from(operationalCommissions).orderBy(desc(operationalCommissions.createdAt)),
    database.select({ createdAt: operationalProjects.createdAt, status: operationalProjects.status, value: operationalProjects.value }).from(operationalProjects).orderBy(desc(operationalProjects.createdAt)),
    database.select({ key: dashboardSettings.key, value: dashboardSettings.value }).from(dashboardSettings),
  ]);
  return { transactions, accounts, bankTx, leads: leadRows, users: userRows, commissions, projects, settings };
}

export async function saveDashboardSetting(key: string, value: string): Promise<void> {
  const database = getDb();
  await database.insert(dashboardSettings).values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: dashboardSettings.key, set: { value, updatedAt: new Date() } });
}

export async function getDashboardSetting(key: string): Promise<string | undefined> {
  const database = getDb();
  const rows = await database.select({ value: dashboardSettings.value }).from(dashboardSettings).where(eq(dashboardSettings.key, key)).limit(1);
  return rows[0]?.value;
}

export async function createFinancialTransaction(data: InsertFinancialTransaction): Promise<FinancialTransaction> {
  const db = getDb();
  const result = await db.insert(financialTransactions).values(data).returning();
  return result[0];
}

export async function updateFinancialTransactionStatus(id: number, status: "pending" | "paid" | "cancelled"): Promise<void> {
  const db = getDb();
  await db.update(financialTransactions)
    .set({ status, paidAt: status === "paid" ? new Date() : null, updatedAt: new Date() })
    .where(eq(financialTransactions.id, id));
}

// ========== TAXAS DE OBRA ==========

export async function getObraFeesByProject(projectId: number): Promise<ObraFee[]> {
  const db = getDb();
  return db.select().from(obraFees).where(eq(obraFees.projectId, projectId));
}

export async function upsertObraFee(projectId: number, feeType: string, estimatedValue: string, paidValue: string): Promise<void> {
  const db = getDb();
  const existing = await db.select().from(obraFees)
    .where(and(eq(obraFees.projectId, projectId), eq(obraFees.feeType, feeType)))
    .limit(1);
  if (existing.length > 0) {
    await db.update(obraFees).set({ estimatedValue, paidValue, updatedAt: new Date() })
      .where(and(eq(obraFees.projectId, projectId), eq(obraFees.feeType, feeType)));
  } else {
    await db.insert(obraFees).values({ projectId, feeType, estimatedValue, paidValue });
  }
}

// ========== MEDIÇÕES ==========

export async function getMeasurementsByProject(projectId: number): Promise<ObraMeasurement[]> {
  const db = getDb();
  return db.select().from(obraMeasurements).where(eq(obraMeasurements.projectId, projectId)).orderBy(desc(obraMeasurements.measurementDate));
}

export async function createMeasurement(data: InsertObraMeasurement): Promise<ObraMeasurement> {
  const db = getDb();
  const result = await db.insert(obraMeasurements).values(data).returning();
  return result[0];
}

export async function updateMeasurement(id: number, data: Partial<InsertObraMeasurement>): Promise<void> {
  const db = getDb();
  await db.update(obraMeasurements).set(data).where(eq(obraMeasurements.id, id));
}


// Payment secrets are encrypted before reaching this isolated persistence boundary.
export async function getPaymentSetting(): Promise<PaymentSetting | undefined> {
  return (await getDb().select().from(paymentSettings).limit(1))[0];
}

export async function savePaymentSetting(input: InsertPaymentSetting): Promise<void> {
  const database = getDb();
  const current = await database.select().from(paymentSettings).limit(1);
  if (current[0]) {
    await database.update(paymentSettings).set({ ...input, updatedAt: new Date() }).where(eq(paymentSettings.id, current[0].id));
  } else {
    await database.insert(paymentSettings).values(input);
  }
}

// ========== IMÓVEIS ==========

export async function getAllImoveis(filters?: { status?: string; tipo?: string; cidade?: string; publicadoOnly?: boolean }): Promise<Imovel[]> {
  const db = getDb();
  let query = db.select().from(imoveis).$dynamic();
  const conditions = [];
  if (filters?.status) conditions.push(eq(imoveis.status, filters.status as any));
  if (filters?.tipo) conditions.push(eq(imoveis.tipo, filters.tipo));
  if (filters?.cidade) conditions.push(eq(imoveis.cidade, filters.cidade));
  if (filters?.publicadoOnly) conditions.push(eq(imoveis.publicadoSite, true));
  if (conditions.length > 0) query = query.where(and(...conditions));
  return query.orderBy(desc(imoveis.createdAt));
}

/** Vista administrativa das obras com endereço que ainda não têm imóvel vinculado.
 * Nenhum dado é publicado no catálogo público nem alterado por esta leitura. */
export async function getObrasSemImovelCatalogo() {
  return getDb().select({
    id: constructionProjects.id,
    titulo: constructionProjects.title,
    endereco: constructionProjects.address,
    cidade: constructionProjects.city,
    estado: constructionProjects.state,
    status: constructionProjects.status,
  }).from(constructionProjects)
    .where(and(isNull(constructionProjects.imovelId), sql`trim(coalesce(${constructionProjects.address}, '')) <> ''`))
    .orderBy(desc(constructionProjects.createdAt));
}

export async function getImovelById(id: number): Promise<Imovel | undefined> {
  const db = getDb();
  const result = await db.select().from(imoveis).where(eq(imoveis.id, id)).limit(1);
  return result[0];
}

export async function getImovelBySlug(slug: string): Promise<Imovel | undefined> {
  const db = getDb();
  const result = await db.select().from(imoveis).where(eq(imoveis.slug, slug)).limit(1);
  return result[0];
}

export async function createImovel(data: InsertImovel): Promise<Imovel> {
  const db = getDb();
  const result = await db.insert(imoveis).values(data).returning();
  return result[0];
}

export async function updateImovel(id: number, data: Partial<InsertImovel>): Promise<void> {
  const db = getDb();
  await db.update(imoveis).set({ ...data, updatedAt: new Date() }).where(eq(imoveis.id, id));
}

// ========== AVALIAÇÕES (LAUDOS) ==========

function gerarNumeroAvaliacao(): string {
  const now = new Date();
  return `AVL-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}-${Math.floor(1000 + Math.random() * 9000)}`;
}

export async function getAllAvaliacoes(filters?: { status?: string; tipo?: string; cidade?: string }): Promise<Avaliacao[]> {
  const db = getDb();
  let query = db.select().from(avaliacoes).$dynamic();
  const conditions = [];
  if (filters?.status) conditions.push(eq(avaliacoes.status, filters.status as any));
  if (filters?.tipo) conditions.push(eq(avaliacoes.tipo, filters.tipo));
  if (filters?.cidade) conditions.push(eq(avaliacoes.cidade, filters.cidade));
  if (conditions.length > 0) query = query.where(and(...conditions));
  return query.orderBy(desc(avaliacoes.createdAt));
}

export async function getAvaliacaoById(id: number): Promise<Avaliacao | undefined> {
  const db = getDb();
  const result = await db.select().from(avaliacoes).where(eq(avaliacoes.id, id)).limit(1);
  return result[0];
}

export async function createAvaliacao(data: Omit<InsertAvaliacao, "numero" | "status">): Promise<Avaliacao> {
  const db = getDb();
  const result = await db.insert(avaliacoes).values({
    ...data,
    numero: gerarNumeroAvaliacao(),
    status: "solicitada",
  }).returning();
  return result[0];
}

export async function updateAvaliacao(id: number, data: Partial<InsertAvaliacao>): Promise<void> {
  const db = getDb();
  await db.update(avaliacoes).set({ ...data, updatedAt: new Date() }).where(eq(avaliacoes.id, id));
}

export async function deleteAvaliacao(id: number): Promise<void> {
  const db = getDb();
  await db.delete(avaliacoes).where(eq(avaliacoes.id, id));
}

// ========== AGREGADOR (SCRAPER DE IMÓVEIS EXTERNOS) ==========

export async function getAllAgregadorImoveis(filters?: { status?: string; fonte?: string }): Promise<AgregadorImovel[]> {
  const db = getDb();
  let query = db.select().from(agregadorImoveis).$dynamic();
  const conditions = [];
  if (filters?.status) conditions.push(eq(agregadorImoveis.status, filters.status as any));
  if (filters?.fonte) conditions.push(eq(agregadorImoveis.fonte, filters.fonte as any));
  if (conditions.length > 0) query = query.where(and(...conditions));
  return query.orderBy(desc(agregadorImoveis.createdAt));
}

export async function getAgregadorImovelById(id: number): Promise<AgregadorImovel | undefined> {
  const db = getDb();
  const result = await db.select().from(agregadorImoveis).where(eq(agregadorImoveis.id, id)).limit(1);
  return result[0];
}

export async function createAgregadorImovel(data: Omit<InsertAgregadorImovel, "status">): Promise<AgregadorImovel> {
  const db = getDb();
  const result = await db.insert(agregadorImoveis).values({ ...data, status: "pendente" }).returning();
  return result[0];
}

export async function updateAgregadorImovel(id: number, data: Partial<InsertAgregadorImovel>): Promise<void> {
  const db = getDb();
  await db.update(agregadorImoveis).set({ ...data, updatedAt: new Date() }).where(eq(agregadorImoveis.id, id));
}

export async function importarAgregadorParaCatalogo(id: number): Promise<Imovel | undefined> {
  const db = getDb();
  const ag = await getAgregadorImovelById(id);
  if (!ag) return undefined;

  const slug = ag.titulo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 80)
    + "-" + Date.now();

  const novoImovel = await createImovel({
    slug,
    titulo: ag.titulo,
    descricao: ag.descricao,
    tipo: ag.tipo ?? "outro",
    preco: ag.preco ?? "0",
    areaM2: ag.areaM2 ?? undefined,
    bairro: ag.bairro,
    cidade: ag.cidade,
    estado: ag.estado,
    fotos: ag.imagens,
    publicadoSite: false,
  } as InsertImovel);

  await updateAgregadorImovel(id, { status: "importado" });
  return novoImovel;
}

export async function getAllIncorporationStudies(filters?: { status?: string }): Promise<IncorporationStudy[]> {
  const db = getDb();
  let query = db.select().from(incorporationStudies).$dynamic();
  if (filters?.status) query = query.where(eq(incorporationStudies.status, filters.status));
  return query.orderBy(desc(incorporationStudies.updatedAt));
}

export async function getIncorporationStudyById(id: number): Promise<IncorporationStudy | undefined> {
  const db = getDb();
  const result = await db.select().from(incorporationStudies).where(eq(incorporationStudies.id, id)).limit(1);
  return result[0];
}

export async function createIncorporationStudy(data: InsertIncorporationStudy): Promise<IncorporationStudy> {
  const db = getDb();
  const result = await db.insert(incorporationStudies).values(data).returning();
  return result[0];
}

export async function updateIncorporationStudy(id: number, data: Partial<InsertIncorporationStudy>): Promise<void> {
  const db = getDb();
  await db.update(incorporationStudies).set({ ...data, updatedAt: new Date() }).where(eq(incorporationStudies.id, id));
}

export async function getIncorporationStudyVersions(studyId: number) {
  const db = getDb();
  return db.select({ revision: incorporationStudyVersions.revision, createdAt: incorporationStudyVersions.createdAt })
    .from(incorporationStudyVersions).where(eq(incorporationStudyVersions.studyId, studyId))
    .orderBy(desc(incorporationStudyVersions.revision)).limit(50);
}

export async function getIncorporationStudyVersion(studyId: number, revision: number) {
  const db = getDb();
  const [result] = await db.select({ snapshot: incorporationStudyVersions.snapshot,
    createdAt: incorporationStudyVersions.createdAt })
    .from(incorporationStudyVersions)
    .where(and(eq(incorporationStudyVersions.studyId, studyId), eq(incorporationStudyVersions.revision, revision)))
    .limit(1);
  return result;
}

export async function getIncorporationStaff() {
  const db = getDb();
  // Lote 2 (AD-02/08): engenheiro = colaborador com perfil de engenheiro ativo.
  const rows = await db.select({ id: users.id, name: users.name, active: users.active, role: users.role, engineerActive: engineerProfiles.active })
    .from(users)
    .leftJoin(engineerProfiles, eq(engineerProfiles.userId, users.id))
    .where(inArray(users.role, ["admin", "colaborador"]))
    .orderBy(users.name);
  return rows.map(({ engineerActive, ...u }) => ({ ...u, engenheiro: engineerActive === true }));
}

/**
 * Correção 08: responsável do estudo por ID (usuário ativo, admin ou colaborador).
 * O texto legado `responsible` recebe o nome para exibição e estudos antigos.
 */
export async function resolveIncorporationResponsible(userId: number | null | undefined): Promise<{ responsibleUserId?: number | null; responsible?: string | null }> {
  if (userId === undefined) return {};
  if (userId === null) return { responsibleUserId: null, responsible: null };
  const db = getDb();
  const [u] = await db.select({ id: users.id, name: users.name, active: users.active, role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u || !u.active || !["admin", "colaborador"].includes(u.role)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Responsável inválido ou inativo." });
  }
  return { responsibleUserId: u.id, responsible: (u.name ?? "").slice(0, 120) || null };
}

// ========== BPO (financeiro — clientes de terceirização contábil) ==========

export async function getAllBpoClients(): Promise<BpoClient[]> {
  const db = getDb();
  return db.select().from(bpoClients).orderBy(bpoClients.razaoSocial);
}

export async function createBpoClient(data: InsertBpoClient): Promise<BpoClient> {
  const db = getDb();
  const result = await db.insert(bpoClients).values(data).returning();
  return result[0];
}

export async function updateBpoClientStatus(id: number, status: "ativo" | "pausado" | "encerrado"): Promise<void> {
  const db = getDb();
  await db.update(bpoClients).set({ status, updatedAt: new Date() }).where(eq(bpoClients.id, id));
}

export async function getAllBpoLancamentos(): Promise<BpoLancamento[]> {
  const db = getDb();
  // Lote 3, item 16: cobranças combinadas em outra ficam fora (a nova cobrança já soma os valores).
  return db.select().from(bpoLancamentos).where(isNull(bpoLancamentos.combinadaEmId)).orderBy(desc(bpoLancamentos.vencimento));
}

export async function createBpoLancamento(data: InsertBpoLancamento): Promise<BpoLancamento> {
  const db = getDb();
  const result = await db.insert(bpoLancamentos).values(data).returning();
  return result[0];
}

export async function marcarBpoLancamentoPago(id: number): Promise<void> {
  const db = getDb();
  await db.update(bpoLancamentos).set({ pago: true, pagoEm: new Date(), valorRecebido: sql`${bpoLancamentos.valor}` }).where(eq(bpoLancamentos.id, id));
}

// ========== Pluggy (integração bancária — credenciais) ==========

export async function getPluggySetting(): Promise<PluggySetting | undefined> {
  return (await getDb().select().from(pluggySettings).limit(1))[0];
}

export async function savePluggySetting(input: InsertPluggySetting): Promise<void> {
  const database = getDb();
  const current = await database.select().from(pluggySettings).limit(1);
  if (current[0]) {
    await database.update(pluggySettings).set({ ...input, updatedAt: new Date() }).where(eq(pluggySettings.id, current[0].id));
  } else {
    await database.insert(pluggySettings).values(input);
  }
}

// ========== Contas e transações bancárias ==========

export async function getAllBankAccounts(): Promise<BankAccount[]> {
  const db = getDb();
  return db.select().from(bankAccounts).where(eq(bankAccounts.ativo, true)).orderBy(desc(bankAccounts.createdAt));
}

export async function getBankAccountById(id: number): Promise<BankAccount | undefined> {
  return (await getDb().select().from(bankAccounts).where(eq(bankAccounts.id, id)).limit(1))[0];
}

export async function createBankAccount(data: InsertBankAccount): Promise<BankAccount> {
  const db = getDb();
  const result = await db.insert(bankAccounts).values(data).returning();
  return result[0];
}

export async function deleteBankAccount(id: number): Promise<void> {
  const db = getDb();
  await db.update(bankAccounts).set({ ativo: false }).where(eq(bankAccounts.id, id));
}

export async function updateBankAccountSaldo(id: number, saldo: number): Promise<void> {
  const db = getDb();
  await db.update(bankAccounts).set({ saldoAtual: saldo.toString(), ultimaSincronizacao: new Date() }).where(eq(bankAccounts.id, id));
}

export async function getBankTransactionsByAccount(accountId: number): Promise<BankTransaction[]> {
  const db = getDb();
  return db.select().from(bankTransactions).where(eq(bankTransactions.accountId, accountId)).orderBy(desc(bankTransactions.data));
}

export async function upsertBankTransactions(accountId: number, transacoes: InsertBankTransaction[]): Promise<number> {
  const db = getDb();
  let count = 0;
  for (const t of transacoes) {
    const result = await db
      .insert(bankTransactions)
      .values({ ...t, accountId })
      .onConflictDoNothing({ target: bankTransactions.externalId })
      .returning();
    if (result.length > 0) count++;
  }
  return count;
}

export async function updateBankTransactionStatus(id: number, status: "pendente" | "conciliado" | "ignorado"): Promise<void> {
  const db = getDb();
  await db.update(bankTransactions).set({ status }).where(eq(bankTransactions.id, id));
}
