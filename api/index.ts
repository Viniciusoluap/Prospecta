import express from "express";
import { getUserByEmail } from "../server/db";
import {
  verifyPassword,
  createSessionToken,
  SESSION_COOKIE_NAME,
} from "../server/_core/auth-utils";
import { getSessionCookieOptions } from "../server/_core/cookies";

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// ── Health ────────────────────────────────────
app.get("/api/health", async (_req, res) => {
  try {
    const { getDb } = await import("../server/db");
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
    const token = await createSessionToken(user.id, user.name);
    const cookieOpts = getSessionCookieOptions(req);
    res.cookie(SESSION_COOKIE_NAME, token, {
      ...cookieOpts,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    return res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  } catch (err) {
    console.error("[auth/login]", err);
    return res.status(500).json({ error: "Erro interno" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME, getSessionCookieOptions(req));
  return res.json({ ok: true });
});

// ── All other routes (tRPC, uploads, webhooks) ─
app.use("/api", async (req, res, next) => {
  try {
    const { createExpressMiddleware } = await import("@trpc/server/adapters/express");
    const { appRouter } = await import("../server/routers");
    const { createContext } = await import("../server/_core/context");
    const uploadPhotoRouter = (await import("../server/routes/upload-photo")).default;
    const { handleAsaasWebhook } = await import("../server/asaas-webhook");

    const router = express.Router();
    router.use(uploadPhotoRouter);
    router.post("/asaas/webhook", handleAsaasWebhook);
    router.use("/trpc", createExpressMiddleware({ router: appRouter, createContext }));
    router(req, res, next);
  } catch (err: any) {
    console.error("[api] router load error:", err);
    res.status(500).json({ error: "Erro interno", detail: err?.message });
  }
});

export default app;
