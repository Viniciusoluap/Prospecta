import { sql } from "drizzle-orm";
import { getDb } from "./db.js";

type PrivateFileKind = "checklist" | "contract" | "lead" | "incorporacao";

/** Somente os routers autenticados devem chamar esta função, após validar a posse. */
export async function readPrivateDbFile(kind: PrivateFileKind, id: number): Promise<Buffer | null> {
  const db = getDb();
  const result = kind === "checklist"
    ? await db.execute(sql`SELECT encode(data, 'base64') AS b64 FROM financiamento_checklist_file_data WHERE checklist_item_id = ${id}`)
    : kind === "contract"
      ? await db.execute(sql`SELECT encode(data, 'base64') AS b64 FROM portal_contract_file_data WHERE document_id = ${id}`)
      : kind === "lead"
        ? await db.execute(sql`SELECT encode(data, 'base64') AS b64 FROM lead_document_file_data WHERE document_id = ${id}`)
        : await db.execute(sql`SELECT encode(data, 'base64') AS b64 FROM incorporation_registration_file_data WHERE document_id = ${id}`);
  const row = (result as unknown as { rows: { b64: string }[] }).rows[0];
  return row ? Buffer.from(row.b64, "base64") : null;
}

/** Grava o arquivo de um documento do CRM ou do registro da incorporação no banco (fallback do Google Drive). */
export async function writePrivateDbFile(kind: "lead" | "incorporacao", id: number, mime: string, data: Buffer): Promise<void> {
  const b64 = data.toString("base64");
  const db = getDb();
  if (kind === "lead")
    await db.execute(sql`INSERT INTO lead_document_file_data (document_id, mime, size_bytes, data) VALUES (${id}, ${mime}, ${data.length}, decode(${b64}, 'base64'))`);
  else
    await db.execute(sql`INSERT INTO incorporation_registration_file_data (document_id, mime, size_bytes, data) VALUES (${id}, ${mime}, ${data.length}, decode(${b64}, 'base64'))`);
}
