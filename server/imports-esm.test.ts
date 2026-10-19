// Na Vercel, api/index.ts roda como ESM sem empacotamento: todo import relativo
// do servidor precisa terminar em ".js". Sem isso a função inteira cai com
// ERR_MODULE_NOT_FOUND (incidente de 19/10, server/caixa/*). O build local
// (esbuild) não acusa, por isso este teste.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return nome === "node_modules" || nome === "__fixtures__" ? [] : arquivos(caminho);
    return /\.ts$/.test(nome) && !/\.test\.ts$/.test(nome) ? [caminho] : [];
  });
}

describe("imports ESM do servidor", () => {
  it("todo import relativo em server/, shared/ e api/ termina em .js", () => {
    const raiz = join(__dirname, "..");
    const faltando = ["server", "shared", "api"].flatMap((d) => arquivos(join(raiz, d))).flatMap((arquivo) =>
      [...readFileSync(arquivo, "utf8").matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)]
        .map((m) => m[1])
        .filter((caminho) => !/\.(js|json)$/.test(caminho))
        .map((caminho) => `${arquivo.slice(raiz.length + 1)} → ${caminho}`));
    expect(faltando).toEqual([]);
  });
});
