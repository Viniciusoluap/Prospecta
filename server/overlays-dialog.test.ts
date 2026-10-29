// Lote 3, correção 11 (L9): paridade com o modal compartilhado do Santa Fé. Nenhuma
// tela do painel usa overlay próprio `fixed inset-0`; todas usam o `Dialog`
// compartilhado (client/src/components/ui/dialog.tsx), que limita a altura à tela
// visível (dvh) com rolagem interna e largura máxima responsiva.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const raiz = join(__dirname, "..", "client", "src");

function arquivos(dir: string, saida: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) arquivos(p, saida);
    else if (p.endsWith(".tsx")) saida.push(p);
  }
  return saida;
}

describe("Dialog compartilhado — telas sem overlay próprio", () => {
  it("`fixed inset-0` só aparece nos componentes de UI compartilhados", () => {
    const fora = arquivos(raiz)
      .filter(p => !relative(raiz, p).startsWith(join("components", "ui")))
      .filter(p => readFileSync(p, "utf8").includes("fixed inset-0"))
      .map(p => relative(raiz, p));
    expect(fora).toEqual([]);
  });

  it("o DialogContent compartilhado limita a altura à tela visível e rola por dentro", () => {
    const dialog = readFileSync(join(raiz, "components", "ui", "dialog.tsx"), "utf8");
    for (const classe of ["max-h-[calc(100dvh-2rem)]", "overflow-y-auto", "overscroll-contain", "max-w-[calc(100%-2rem)]"]) {
      expect(dialog).toContain(classe);
    }
  });
});
