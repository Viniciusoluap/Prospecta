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
});
