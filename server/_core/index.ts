import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { registerStripeWebhook } from "./stripeWebhook";
import uploadPhotoRouter from "../routes/upload-photo";
import { handleAsaasWebhook } from "../asaas-webhook";
import { getUserByEmail } from "../db";
import { getProspectaDoloresSnapshot } from "../dolores/read-model";
import { getTecnoSpeedStatus } from "../dolores/tecnospeed";
import {
  hashPassword,
  verifyPassword,
  createSessionToken,
  SESSION_COOKIE_NAME,
} from "./auth-utils";
import { getSessionCookieOptions } from "./cookies";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Stripe webhook MUST be registered BEFORE express.json() for raw body
  registerStripeWebhook(app);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // ── Auth routes ──────────────────────────────
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
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      return res.json({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      });
    } catch (err) {
      console.error("[auth/login]", err);
      return res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    const cookieOpts = getSessionCookieOptions(req);
    res.clearCookie(SESSION_COOKIE_NAME, cookieOpts);
    return res.json({ ok: true });
  });

  function authorizeDoloresRequest(req: express.Request) {
    const expected = process.env.DOLORES_READ_TOKEN;
    if (!expected) return process.env.NODE_ENV !== "production";
    return req.header("x-dolores-token") === expected;
  }

  // Endpoints somente leitura da Dolores 9A. Não expõem mutações nem dados pessoais.
  app.get("/api/dolores/health", (req, res) => {
    if (!authorizeDoloresRequest(req)) return res.status(401).json({ error: "Não autorizado" });
    return res.json({
      center: "Centro de Operações da Dolores 9A",
      sourceSystem: "prospecta",
      companyCode: "PRS",
      canonicalDatabase: "Neon: SiteProspecta",
      mode: "read_only",
      sourceWriteBack: false,
      providers: { tecnospeed: getTecnoSpeedStatus() },
    });
  });

  app.get("/api/dolores/snapshot", async (req, res) => {
    if (!authorizeDoloresRequest(req)) return res.status(401).json({ error: "Não autorizado" });
    try {
      return res.json(await getProspectaDoloresSnapshot());
    } catch {
      return res.status(503).json({ error: "Snapshot temporariamente indisponível" });
    }
  });

  // Upload de fotos
  app.use("/api", uploadPhotoRouter);
  // Asaas webhook
  app.post("/api/asaas/webhook", handleAsaasWebhook);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
