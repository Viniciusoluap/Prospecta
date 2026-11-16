// EPIC-025 (Dolores, etapa 3) — QA R2 M1 (versão invertida): a cópia da PCI gerada que chegou ao Google e foi cancelada pelo
// prazo fica pendente; o organizador do Drive ADOTA o arquivo já enviado (mesmo nome e mesmo MD5) em vez de reenviar.
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const linha = { id: 7, project_id: 3, sheet_format: "xlsx", sheet_file_name: "pci.xlsx", pdf_file_name: "pci.pdf", created_at: new Date("2026-11-16T12:00:00Z"), titulo: "Casa Ana" };
const bytes = Buffer.from("conteudo da planilha");
vi.mock("./db.js", () => ({ getDb: vi.fn(() => ({ execute: vi.fn(async (q: unknown) => (JSON.stringify(q).includes("encode(") ? { rows: [{ b64: bytes.toString("base64") }] } : { rows: [linha] })) })) }));

import { FONTES_ARQUIVOS } from "./drive-arquivos.js";
import { organizarDrive, type CursorOrganizacao, type DependenciasOrganizador } from "./drive-organizacao.js";

describe("M1 — PCI gerada: organizador adota a cópia já enviada (sem duplicar)", () => {
  for (const tipo of ["pci_gerada_planilha", "pci_gerada_pdf"]) {
    it(`${tipo}: tem adotarPrefixo = nome do arquivo sem a extensão`, async () => {
      const fonte = FONTES_ARQUIVOS.find(f => f.tipo === tipo)!;
      const [item] = await fonte.pendentes!({ aposId: 0, limite: 1 });
      const destino = await item.destino();
      expect(item.adotarPrefixo).toBe("PCI gerada — 16-11-2026");
      expect(destino.nome.startsWith(item.adotarPrefixo!)).toBe(true);
    });
  }
  it("com o mesmo conteúdo já na pasta: grava a referência do arquivo existente e NÃO envia de novo", async () => {
    const fonte = FONTES_ARQUIVOS.find(f => f.tipo === "pci_gerada_pdf")!;
    const gravados: string[] = [];
    const comGravacao = { ...fonte, noDrive: async () => [], pendentes: async (f: { aposId: number; limite: number; id?: number }) =>
      (await fonte.pendentes!(f)).filter(() => !gravados.length).map(i => ({ ...i, gravar: async (id: string) => { gravados.push(id); } })) };
    const upload = vi.fn(async () => "novo");
    const adotar = vi.fn(async (_pasta: string, prefixo: string, md5: string) => (prefixo === "PCI gerada — 16-11-2026" && md5 === createHash("md5").update(bytes).digest("hex") ? "ja-enviado" : null));
    let estado: CursorOrganizacao = {};
    const deps = {
      configurado: async () => true, fontes: [comGravacao], upload, mover: vi.fn(async () => "no_lugar" as const), adotar,
      subpastas: async () => ({ pastas: [], proximaPagina: null }), arquivosNaPasta: async () => [], pastaPorChave: async () => null,
      emUso: async () => new Set<string>(), existentes: async (_e: unknown, ids: string[]) => new Set(ids), lixeira: vi.fn(async () => undefined),
      fila: { listar: async () => [], remover: async () => undefined, falhou: async () => undefined },
      estado: { ler: async () => estado, gravar: async (c: CursorOrganizacao) => { estado = c; } }, agora: () => 0,
    } as unknown as DependenciasOrganizador;
    const r = await organizarDrive(deps, { prazoMs: 10_000 });
    expect(upload).not.toHaveBeenCalled();
    expect(gravados).toEqual(["ja-enviado"]);
    expect(r).toMatchObject({ reconhecidos: 1, enviados: 0 });
  });
});
