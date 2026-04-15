import "dotenv/config";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../server/routers";
import { createContext } from "../server/_core/context";
import uploadPhotoRouter from "../server/routes/upload-photo";
import { handleAsaasWebhook } from "../server/asaas-webhook";
import { getUserByEmail } from "../server/db";
import {
  verifyPassword,
  createSessionToken,
  SESSION_COOKIE_NAME,
} from "../server/_core/auth-utils";
import { getSessionCookieOptions } from "../server/_core/cookies";

const app = express();

// Raw body needed for Asaas/Stripe webhooks — register before json()
app.use((req, res, next) => {
  if (req.path === "/api/asaas/webhook") {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => {
      (req as any).rawBody = data;
      next();
    });
  } else {
    next();
  }
});

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

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

// ── Uploads & Webhooks ────────────────────────
app.use("/api", uploadPhotoRouter);
app.post("/api/asaas/webhook", handleAsaasWebhook);

// ── tRPC ──────────────────────────────────────
app.use(
  "/api/trpc",
  createExpressMiddleware({ router: appRouter, createContext })
);

export default app;
