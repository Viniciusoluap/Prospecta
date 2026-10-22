import { sql } from "drizzle-orm";
import { getDb } from "./db.js";

let initialized: Promise<void> | undefined;

/** The deployment does not run Drizzle migrations automatically. */
export function ensureLeadCardDeadlineSchema(): Promise<void> {
  if (!initialized) initialized = (async () => {
    const database = getDb();
    await database.execute(sql`ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "card_due_date" date`);
    await database.execute(sql`CREATE INDEX IF NOT EXISTS "leads_card_due_date_idx" ON "leads" ("card_due_date") WHERE "deleted_at" IS NULL`);
    await database.execute(sql`CREATE TABLE IF NOT EXISTS "lead_card_due_alerts" (
      "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "lead_id" integer NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
      "due_date" date NOT NULL,
      "channel" varchar(12) NOT NULL,
      "sent_at" timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY ("user_id", "lead_id", "due_date", "channel")
    )`);
    await database.execute(sql`CREATE TABLE IF NOT EXISTS "lead_card_due_digest_claims" (
      "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "digest_date" date NOT NULL,
      "claimed_at" timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY ("user_id", "digest_date")
    )`);
  })().catch(error => { initialized = undefined; throw error; });
  return initialized;
}

export function validateCardDueDate(value: string | null): string | null {
  if (value === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(`${value}T12:00:00Z`)) ||
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value)
    throw new Error("Data de vencimento inválida");
  return value;
}

export function todayInImperatriz(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export function compareCardDueDates(a: { cardDueDate: string | null; id: number }, b: { cardDueDate: string | null; id: number }) {
  return (a.cardDueDate ?? "9999-12-31").localeCompare(b.cardDueDate ?? "9999-12-31") || a.id - b.id;
}
