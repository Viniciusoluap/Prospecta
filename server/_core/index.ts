import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers.js";
import { createContext } from "./context.js";
import { serveStatic, setupVite } from "./vite.js";
import obraFotosRouter from "../routes/obra-fotos.js";
import projetoDocumentosRouter from "../routes/projeto-documentos.js";
import obraMedicaoCaixaRouter from "../routes/obra-medicao-caixa.js";
import imovelFotosRouter from "../routes/imovel-fotos.js";
import googleDriveRotas from "../routes/google-drive.js";
import { handleAsaasWebhook } from "../asaas-webhook.js";
import { handleWhatsappWebhook } from "../whatsapp-webhook.js";
import { startMcmvRulesReminder } from "../mcmv-rules-reminder.js";
import { getUserByEmail } from "../db.js";
import {
  hashPassword,
  verifyPassword,
  createSessionToken,
  SESSION_COOKIE_NAME,
} from "./auth-utils.js";
import { getSessionCookieOptions } from "./cookies.js";

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

  // WhatsApp Business webhook: same raw-body requirement, for HMAC verification
  app.post(
    "/api/whatsapp/webhook",
    express.raw({ type: "application/json" }),
    handleWhatsappWebhook
  );

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // ── Auth routes ──────────────────────────────
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body as {
        email?: string;
        password?: string;
      };
      if (!email || !password) {
        return res
          .status(400)
          .json({ error: "Email e senha são obrigatórios" });
      }

      const user = await getUserByEmail(email.toLowerCase().trim());
      if (!user || !user.passwordHash) {
        return res.status(401).json({ error: "Email ou senha incorretos" });
      }

      if (!user.active) {
        return res
          .status(403)
          .json({ error: "Usuário desativado. Procure o administrador." });
      }

      const valid = verifyPassword(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: "Email ou senha incorretos" });
      }

      // Item 02: login único — o perfil da conta decide o destino; nada a escolher.

      const token = await createSessionToken(
        user.id,
        user.name,
        user.sessionVersion
      );
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
        permissions: user.permissions,
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

  // Upload de fotos
  app.use("/api", obraFotosRouter);
  app.use("/api", obraMedicaoCaixaRouter);
  app.use("/api", projetoDocumentosRouter);
  app.use("/api", imovelFotosRouter);
  app.use("/api", googleDriveRotas);
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

  startMcmvRulesReminder();
}

startServer().catch(console.error);
