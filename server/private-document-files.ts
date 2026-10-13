import { sql } from "drizzle-orm";
import { getDb } from "./db.js";

/** Somente os routers autenticados devem chamar esta função, após validar a posse. */
export async function readPrivateDbFile(kind: "checklist" | "contract", id: number): Promise<Buffer | null> {
  const db = getDb();
  const result = kind === "checklist"
    ? await db.execute(sql`SELECT encode(data, 'base64') AS b64 FROM financiamento_checklist_file_data WHERE checklist_item_id = ${id}`)
    : await db.execute(sql`SELECT encode(data, 'base64') AS b64 FROM portal_contract_file_data WHERE document_id = ${id}`);
  const row = (result as unknown as { rows: { b64: string }[] }).rows[0];
  return row ? Buffer.from(row.b64, "base64") : null;
}
