import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { eq } from "drizzle-orm";

import { users } from "../drizzle/schema.js";
import { handleAsaasWebhook } from "../server/asaas-webhook.js";
import {
  createSessionToken,
  hashPassword,
  SESSION_COOKIE_NAME,
  verifyPassword,
} from "../server/_core/auth-utils.js";
import { getSessionCookieOptions } from "../server/_core/cookies.js";
import { createContext } from "../server/_core/context.js";
import { getDb, getUserByEmail } from "../server/db.js";
import { appRouter } from "../server/routers.js";
import obraFotosRouter from "../server/routes/obra-fotos.js";
import obraMedicaoCaixaRouter from "../server/routes/obra-medicao-caixa.js";
import projetoDocumentosRouter from "../server/routes/projeto-documentos.js";
import { handleWhatsappWebhook } from "../server/whatsapp-webhook.js";
import imovelFotosRouter from "../server/routes/imovel-fotos.js";
import googleDriveRotas from "../server/routes/google-drive.js";
import { checkAndSendReminder } from "../server/mcmv-rules-reminder.js";
import { ensureLeadCardDeadlineSchema } from "../server/lead-card-deadline-schema.js";
import { sendLeadCardDueDigests } from "../server/lead-card-due-digest.js";

const app = express();
// Pedido de 24/10: webhook do WhatsApp publicado na Vercel. Precisa do corpo bruto (assinatura),
// por isso ficam antes do express.json() — igual ao servidor local (server/_core/index.ts).
app.post("/api/whatsapp/webhook", express.raw({ type: "application/json" }), handleWhatsappWebhook);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use("/api", async (_req, res, next) => {
  try { await ensureLeadCardDeadlineSchema(); next(); }
  catch (error) { console.error("[lead-card-deadline-schema]", error); res.status(503).json({ error: "CRM temporariamente indisponível" }); }
});

// ── Health ────────────────────────────────────
app.get("/api/health", async (_req, res) => {
  try {
    const db = getDb();
    await db.execute("SELECT 1" as any);
    return res.json({ ok: true, db: "connected" });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});

// ── Auth ──────────────────────────────────────
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      return res.status(400).json({ error: "Email e senha são obrigatórios" });
    }
    const user = await getUserByEmail(email.toLowerCase().trim());
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: "Email ou senha incorretos" });
    }
    const valid = verifyPassword(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Email ou senha incorretos" });
    }
    const token = await createSessionToken(user.id, user.name, user.sessionVersion);
    const cookieOpts = getSessionCookieOptions(req);
    res.cookie(SESSION_COOKIE_NAME, token, {
      ...cookieOpts,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    return res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  } catch (err: any) {
    console.error("[auth/login]", err);
    return res.status(500).json({ error: "Erro interno", detail: err?.message });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    res.clearCookie(SESSION_COOKIE_NAME, getSessionCookieOptions(req));
  } catch {
    // ignore
  }
  return res.json({ ok: true });
});

// ── Admin setup (create/reset admin user) ─────
app.post("/api/auth/setup-admin", async (req, res) => {
  try {
    const setupToken = process.env.ADMIN_SETUP_TOKEN;
    if (!setupToken) {
      return res.status(403).json({ error: "Setup não configurado" });
    }
    const { token, email, password, name } = req.body as {
      token?: string; email?: string; password?: string; name?: string;
    };
    if (token !== setupToken) {
      return res.status(403).json({ error: "Token inválido" });
    }
    if (!email || !password) {
      return res.status(400).json({ error: "Email e senha são obrigatórios" });
    }
    const db = getDb();
    const passwordHash = hashPassword(password);
    const existing = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);

    if (existing.length > 0) {
      await db.update(users)
        .set({ passwordHash, role: "admin", name: name ?? existing[0].name })
        .where(eq(users.email, email.toLowerCase()));
      return res.json({ ok: true, action: "updated", email });
    } else {
      await db.insert(users).values({
        email: email.toLowerCase(),
        name: name ?? "Admin",
        passwordHash,
        role: "admin",
        openId: `admin_${Date.now()}`,
      });
      return res.json({ ok: true, action: "created", email });
    }
  } catch (err: any) {
    console.error("[auth/setup-admin]", err);
    return res.status(500).json({ error: "Erro interno", detail: err?.message });
  }
});

// ── Cron: lembrete de 30 dias p/ revisar as regras do MCMV ─
// Vercel não roda um processo persistente (server/_core/index.ts), então o
// setInterval de startMcmvRulesReminder() nunca dispara em produção aqui.
// Esta rota é chamada periodicamente pelo Vercel Cron (ver vercel.json).
app.get("/api/cron/mcmv-reminder", async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Não autorizado" });
  }
  try {
    await checkAndSendReminder();
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[cron/mcmv-reminder]", err);
    return res.status(500).json({ error: "Erro interno", detail: err?.message });
  }
});

app.get("/api/cron/lead-card-due", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: "Não autorizado" });
  try { return res.json({ ok: true, ...(await sendLeadCardDueDigests()) }); }
  catch (error) { console.error("[cron/lead-card-due]", error); return res.status(500).json({ error: "Falha ao processar avisos" }); }
});

// ── All other routes (tRPC, uploads, webhooks) ─
app.use("/api", async (req, res, next) => {
  try {
    const router = express.Router();
    router.use(obraFotosRouter);
    router.use(obraMedicaoCaixaRouter);
    // Pedido de 24/10: envio de arquivos de Projetos (e da revisão) só existia no servidor local.
    router.use(projetoDocumentosRouter);
    router.use(imovelFotosRouter);
    router.use(googleDriveRotas);
    router.post("/asaas/webhook", handleAsaasWebhook);
    router.use("/trpc", createExpressMiddleware({ router: appRouter, createContext }));
    router(req, res, next);
  } catch (err: any) {
    console.error("[api] router load error:", err);
    res.status(500).json({ error: "Erro interno", detail: err?.message });
  }
});

export default app;
