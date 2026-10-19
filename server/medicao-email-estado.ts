import { eq, sql } from "drizzle-orm";
import { constructionProgressHistory } from "../drizzle/schema.js";
import { getDb } from "./db.js";
export function invalidarAnexosMedicao(medicaoId: number) {
  return getDb().update(constructionProgressHistory).set({
    updatedAt: new Date(),
    requestEmailStatus: sql`CASE WHEN ${constructionProgressHistory.requestedAt} IS NOT NULL THEN 'pending' ELSE ${constructionProgressHistory.requestEmailStatus} END`,
  }).where(eq(constructionProgressHistory.id, medicaoId));
}
