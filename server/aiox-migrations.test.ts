import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("migrações aditivas AIOX", () => {
  it("aplica 0073 e 0074 duas vezes e mantém a chave de upload única por imóvel", async () => {
    const db = new PGlite();
    await db.exec(`
      CREATE TABLE construction_projects (id serial PRIMARY KEY);
      CREATE TABLE imoveis (id serial PRIMARY KEY);
      CREATE TABLE imovel_fotos (
        id serial PRIMARY KEY,
        imovel_id integer NOT NULL REFERENCES imoveis(id)
      );
      INSERT INTO imoveis DEFAULT VALUES;
    `);
    const proSoluto = readFileSync(new URL("../drizzle/0073_empreiteiro_pro_soluto.sql", import.meta.url), "utf8");
    const fotos = readFileSync(new URL("../drizzle/0074_imovel_foto_upload_key.sql", import.meta.url), "utf8");
    await db.exec(proSoluto);
    await db.exec(fotos);
    await db.exec(proSoluto);
    await db.exec(fotos);
    await db.exec("INSERT INTO imovel_fotos (imovel_id, upload_key) VALUES (1, 'mesma-tentativa')");
    await expect(db.exec("INSERT INTO imovel_fotos (imovel_id, upload_key) VALUES (1, 'mesma-tentativa')")).rejects.toThrow();
    const result = await db.query<{ contractor_include_pro_soluto: boolean }>(
      "INSERT INTO construction_projects DEFAULT VALUES RETURNING contractor_include_pro_soluto",
    );
    expect(result.rows[0]?.contractor_include_pro_soluto).toBe(false);
    await db.close();
  });

  it("aplica 0076 duas vezes: mídia do WhatsApp no banco (10 MB, cascata) e responsável legado sem padrão", async () => {
    const db = new PGlite();
    await db.exec(`
      CREATE TYPE lead_responsible AS ENUM ('sarah', 'vinicius', 'bianca');
      CREATE TABLE leads (id serial PRIMARY KEY, responsible lead_responsible NOT NULL DEFAULT 'sarah');
      CREATE TABLE whatsapp_messages (id serial PRIMARY KEY, mensagem text NOT NULL);
      INSERT INTO leads DEFAULT VALUES;
      INSERT INTO whatsapp_messages (mensagem) VALUES ('[imagem]');
    `);
    const sql = readFileSync(new URL("../drizzle/0076_whatsapp_midia.sql", import.meta.url), "utf8");
    await db.exec(sql);
    await db.exec(sql);
    // Dado existente preservado; novo lead sem 'sarah'.
    expect((await db.query<{ responsible: string }>("SELECT responsible FROM leads WHERE id = 1")).rows[0]?.responsible).toBe("sarah");
    expect((await db.query<{ responsible: string | null }>("INSERT INTO leads DEFAULT VALUES RETURNING responsible")).rows[0]?.responsible).toBeNull();
    await db.exec("UPDATE whatsapp_messages SET midia_tipo = 'imagem', midia_mime = 'image/jpeg', midia_tamanho = 3 WHERE id = 1");
    await db.exec("INSERT INTO whatsapp_midias (message_id, conteudo) VALUES (1, '\\x010203')");
    await expect(db.exec("INSERT INTO whatsapp_midias (message_id, conteudo) VALUES (1, '\\x01')")).rejects.toThrow();
    await expect(db.exec("INSERT INTO whatsapp_midias (message_id, conteudo) VALUES (1, ''::bytea)")).rejects.toThrow();
    await db.exec("DELETE FROM whatsapp_messages WHERE id = 1");
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM whatsapp_midias")).rows[0]?.n).toBe(0);
    await db.close();
  });
});
