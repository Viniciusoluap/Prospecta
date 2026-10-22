import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";

export const DOCUMENT_LIMIT = 20 * 1024 * 1024;
export const DOCUMENT_CHUNK = 1024 * 1024;
const idSchema = z.string().regex(/^[a-zA-Z0-9-]{20,64}$/);
let ready: Promise<void> | undefined;
async function ensureTable() {
  ready ??= getDb().execute(sql`CREATE TABLE IF NOT EXISTS document_upload_chunks (
    upload_id varchar(64) NOT NULL, part integer NOT NULL CHECK (part BETWEEN 0 AND 19),
    total integer NOT NULL CHECK (total BETWEEN 1 AND 20), user_id integer NOT NULL,
    scope varchar(150) NOT NULL, file_name varchar(255) NOT NULL,
    data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 1048576),
    created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (upload_id, part)
  )`).then(() => undefined).catch(error => { ready = undefined; throw error; });
  await ready;
}

export const documentChunksRouter = router({
  part: protectedProcedure.input(z.object({ uploadId: idSchema, part: z.number().int().min(0).max(19), total: z.number().int().min(1).max(20), scope: z.string().min(1).max(150), fileName: z.string().min(1).max(255), base64: z.string().min(4).max(1_400_000) }))
    .mutation(async ({ ctx, input }) => {
      if (input.part >= input.total) throw new TRPCError({ code: "BAD_REQUEST" });
      const data = Buffer.from(input.base64, "base64");
      if (!data.length || data.length > DOCUMENT_CHUNK) throw new TRPCError({ code: "BAD_REQUEST", message: "Parte inválida" });
      await ensureTable();
      const db = getDb();
      await db.execute(sql`DELETE FROM document_upload_chunks WHERE created_at < now() - interval '30 minutes'`);
      const result = await db.execute(sql`INSERT INTO document_upload_chunks (upload_id,part,total,user_id,scope,file_name,data)
        VALUES (${input.uploadId},${input.part},${input.total},${ctx.user.id},${input.scope},${input.fileName},decode(${input.base64},'base64'))
        ON CONFLICT (upload_id,part) DO UPDATE SET data=EXCLUDED.data
        WHERE document_upload_chunks.user_id=EXCLUDED.user_id AND document_upload_chunks.scope=EXCLUDED.scope
          AND document_upload_chunks.file_name=EXCLUDED.file_name AND document_upload_chunks.total=EXCLUDED.total RETURNING part`);
      if (!(result as { rows: unknown[] }).rows.length) throw new TRPCError({ code: "FORBIDDEN" });
      return { success: true };
    }),
});

export async function readUpload(uploadId: string, userId: number, scope: string, fileName: string) {
  idSchema.parse(uploadId);
  await ensureTable();
  const result = await getDb().execute(sql`SELECT part,total,data FROM document_upload_chunks
    WHERE upload_id=${uploadId} AND user_id=${userId} AND scope=${scope} AND file_name=${fileName}
      AND created_at > now() - interval '30 minutes' ORDER BY part`);
  const rows = (result as unknown as { rows: { part: number; total: number; data: Buffer }[] }).rows;
  if (!rows.length || rows.length !== rows[0].total || rows.some((row, i) => row.part !== i || row.total !== rows.length))
    throw new TRPCError({ code: "BAD_REQUEST", message: "Envio incompleto" });
  const data = Buffer.concat(rows.map(row => row.data));
  if (!data.length || data.length > DOCUMENT_LIMIT) throw new TRPCError({ code: "BAD_REQUEST", message: "Arquivo excede 20 MiB" });
  return data;
}

export async function clearUpload(uploadId: string, userId: number) {
  await getDb().execute(sql`DELETE FROM document_upload_chunks WHERE upload_id=${uploadId} AND user_id=${userId}`);
}
