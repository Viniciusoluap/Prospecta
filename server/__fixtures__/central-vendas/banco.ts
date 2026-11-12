// Banco em memória (PGlite) para os testes da Central de Vendas: as tabelas existentes que o módulo usa são
// geradas do próprio drizzle/schema.ts (sem cópia manual que envelhece) e a migração 0110 é aplicada por cima.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../../drizzle/schema.js";

const TABELAS = [
  "users", "leads", "leadServices", "leadDocuments", "leadActivities", "tasks", "userNotifications",
  "whatsappConnections", "whatsappMessages", "whatsappMidias", "whatsappConversationLinks", "whatsappTemplates",
  "whatsappEvolutionSettings",
];

let ddlBase: string | null = null;
async function gerarDdlBase(): Promise<string> {
  if (ddlBase) return ddlBase;
  const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)("drizzle-kit/api");
  const escolhidas: Record<string, unknown> = {};
  for (const [nome, valor] of Object.entries(schema)) if (TABELAS.includes(nome) || nome.endsWith("Enum")) escolhidas[nome] = valor;
  const passos: string[] = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(escolhidas));
  ddlBase = passos.join(";\n");
  return ddlBase;
}

export const sqlMigracao = (arquivo = "0110_central_vendas.sql") =>
  readFileSync(new URL(`../../../drizzle/${arquivo}`, import.meta.url), "utf8");

export async function criarBanco() {
  const pg = new PGlite();
  await pg.exec(await gerarDdlBase());
  await pg.exec(sqlMigracao());
  const db = drizzle(pg);
  const linhas = async <T = Record<string, unknown>>(q: string) => (await pg.query<T>(q)).rows;
  return { pg, db, linhas };
}
