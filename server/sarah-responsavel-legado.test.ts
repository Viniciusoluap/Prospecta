// Pedido de 25/10 (noite), item 5: a ex-funcionária (enum legado leads.responsible = 'sarah') some da
// interface e deixa de ser o padrão de novos leads. A corretora (usuário real) não é afetada.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { leads } from "../drizzle/schema.js";

const ler = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("responsável legado 'sarah'", () => {
  it("telas do lead não mostram mais '(antigo: …)' nem a lista fixa do enum", () => {
    for (const arquivo of ["../client/src/pages/admin/AdminLeadDetail.tsx", "../client/src/pages/admin/AdminCRM.tsx"]) {
      const fonte = ler(arquivo);
      expect(fonte).not.toContain("(antigo:");
      expect(fonte).not.toMatch(/sarah/i);
      expect(fonte).toContain("Sem usuário");
    }
  });

  it("novos leads não recebem 'sarah' (servidor) e a coluna fica sem padrão e opcional (0076)", () => {
    expect(ler("./routers.ts")).not.toMatch(/"sarah"/);
    const col = getTableConfig(leads).columns.find(c => c.name === "responsible")!;
    expect(col.hasDefault).toBe(false);
    expect(col.notNull).toBe(false);
    const migracao = ler("../drizzle/0076_whatsapp_midia.sql");
    expect(migracao).toContain(`ALTER TABLE "leads" ALTER COLUMN "responsible" DROP DEFAULT;`);
    expect(migracao).toContain(`ALTER TABLE "leads" ALTER COLUMN "responsible" DROP NOT NULL;`);
    expect(migracao).not.toMatch(/^\s*(UPDATE|DELETE FROM)\b/im); // dados só após prévia aprovada
  });
});
