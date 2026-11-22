// EPIC-027 C5-COM — só para os testes desta pasta: as tabelas da maquete por lote sobre o banco em memória da Dolores (testes-banco.ts).
// "maquetes_3d" mínima (as colunas que as migrações 0146/0147 e as leituras usam) + as migrações 0146 e 0147 de verdade, duas vezes
// (idempotência). Nada aqui toca banco real.
import { readFileSync } from "node:fs";

type Pg = { exec: (sql: string) => Promise<unknown> };

const MAQUETES_MINIMA = `
CREATE TABLE IF NOT EXISTS "maquetes_3d" (
  "id" serial PRIMARY KEY, "token" varchar(64) NOT NULL UNIQUE, "titulo" varchar(255) NOT NULL, "origem" varchar(20) NOT NULL,
  "project_id" integer, "study_id" integer, "lead_id" integer, "tipo" varchar(20) NOT NULL DEFAULT 'casa',
  "status" varchar(30) NOT NULL DEFAULT 'pronta', "deleted_at" timestamp
);`;

export async function criarTabelasDaMaquete(pg: Pg) {
  await pg.exec(MAQUETES_MINIMA);
  for (const m of ["0146_maquete_3d_itens_e_lotes.sql", "0147_maquete_3d_lote_link.sql"]) {
    const sql = readFileSync(new URL(`../../drizzle/${m}`, import.meta.url), "utf8");
    await pg.exec(sql);
    await pg.exec(sql);
  }
}
