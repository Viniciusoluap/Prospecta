// Pedido de 24/10: o envio de arquivos de Projetos falhava só em produção porque a rota
// estava registrada no servidor local (server/_core/index.ts) e não em api/index.ts (Vercel).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rotas = (arquivo: string) =>
  [...readFileSync(new URL(arquivo, import.meta.url), "utf8").matchAll(/from "(?:\.\.\/server)?\/?\.{0,2}\/?routes\/([\w-]+)\.js"/g)].map(m => m[1]);

// Rotas só do servidor local, ainda não publicadas na Vercel (registradas no handoff de 24/10).
const SO_LOCAL = ["imovel-feeds"];

describe("rotas Express publicadas na Vercel", () => {
  it("toda rota do servidor local também está em api/index.ts", () => {
    const local = rotas("./_core/index.ts");
    const producao = rotas("../api/index.ts");
    expect(local.length).toBeGreaterThan(0);
    expect(producao).toContain("projeto-documentos");
    expect(local.filter(r => !producao.includes(r) && !SO_LOCAL.includes(r))).toEqual([]);
  });
});
