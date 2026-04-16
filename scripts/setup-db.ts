/**
 * Script de setup inicial do banco de dados.
 * Cria o usuário admin e um usuário padrão de teste.
 *
 * Uso: pnpm tsx scripts/setup-db.ts
 */
import "dotenv/config";
import { createHmac, randomBytes } from "crypto";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHmac("sha256", salt).update(password).digest("hex");
  return `${salt}:${hash}`;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌  DATABASE_URL não definida. Verifique o arquivo .env");
    process.exit(1);
  }

  console.log("🔗  Conectando ao Neon...");
  const sql = neon(connectionString);
  const db = drizzle(sql);

  // ── Admin principal ──────────────────────────────────────
  const adminEmail = "vinicius@vfxcapital.com.br";
  const adminPassword = "Prospecta@2025";

  const existing = await db.select().from(users).where(eq(users.email, adminEmail)).limit(1);

  if (existing.length > 0) {
    console.log(`ℹ️   Admin já existe: ${adminEmail}`);
  } else {
    await db.insert(users).values({
      openId: adminEmail,
      email: adminEmail,
      name: "Vinicius Admin",
      passwordHash: hashPassword(adminPassword),
      role: "admin",
      loginMethod: "email",
      lastSignedIn: new Date(),
    });
    console.log(`✅  Admin criado: ${adminEmail}  /  senha: ${adminPassword}`);
  }

  console.log("\n🎉  Setup concluído! Agora você pode fazer login em /login");
}

main().catch((err) => {
  console.error("❌  Erro:", err.message ?? err);
  process.exit(1);
});
