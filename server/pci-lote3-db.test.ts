// Lote 03, correções 09b e 10 — exclusão lógica de versão do modelo e
// confirmação de mudança crítica (banco em memória). Mesma regra testada em
// Grupo-Santa-Fe/web/src/lib/__tests__/pci-modelos-lote3.test.ts.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import * as banco from "./db.js";

vi.mock("./usuario-documentos.js", () => ({ listarEngenheiros: vi.fn(async () => []) }));
vi.mock("./obra-localizacao.js", () => ({ obterLocalizacaoObra: vi.fn(async () => null) }));

import { gravarModeloPci, pciModelosRouter } from "./pci-gerador.js";
import { gerarPlanilhaPci } from "./caixa/pci-gerador.js";
import { formularioPciVazio } from "../shared/pci-gerador.js";

const MODELO = new Uint8Array(readFileSync(new URL("./caixa/__fixtures__/pci-modelo-anonimo.xls", import.meta.url)));
const pg = new PGlite();
const ctx = { user: { id: 1, role: "admin", active: true, name: "Admin" }, req: {}, res: {} } as never;

beforeAll(async () => {
  await pg.exec(`
    CREATE TABLE users (id integer primary key, name text, role text, active boolean);
    INSERT INTO users VALUES (1, 'Admin', 'admin', true);
    CREATE TABLE construction_projects (id integer primary key, title varchar);
    INSERT INTO construction_projects VALUES (10, 'Obra');
  `);
  await pg.exec(readFileSync(new URL("../drizzle/0087_pci_gerador.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../drizzle/0096_pci_lote3.sql", import.meta.url), "utf8"));
  vi.spyOn(banco, "getDb").mockReturnValue(drizzle(pg) as never);
});
afterAll(() => pg.close());

/** .xlsm só com a aba da proposta (sem a PLS): mudança crítica. */
function xlsmSemPls(): Uint8Array {
  return zipSync({
    "xl/workbook.xml": strToU8(`<workbook xmlns:r="r"><sheets><sheet name="Proposta_Constr_Individual" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData/></worksheet>`),
  });
}

it("relatório guardado; mudança crítica só vira atual com confirmação explícita", async () => {
  const caller = pciModelosRouter.createCaller(ctx);
  const v1 = await gravarModeloPci("pci-v1.xls", MODELO, 1, null);
  expect(v1).toMatchObject({ versao: 1, aguardandoConfirmacao: false });
  expect(v1.relatorio?.critico).toBe(false);
  const v2 = await gravarModeloPci("pci-v2.xlsm", xlsmSemPls(), 1, null);
  expect(v2.aguardandoConfirmacao).toBe(true);
  expect(v2.relatorio?.criticas.join(" ")).toMatch(/PLS/);
  let lista = await caller.listar();
  expect(lista.map((m) => [m.versao, m.atual, m.aguardandoConfirmacao])).toEqual([[2, false, true], [1, true, false]]);
  expect(lista[0].relatorio?.critico).toBe(true);
  await expect(caller.definirAtual({ id: v2.id })).rejects.toThrow(/mudanças críticas/);
  await caller.definirAtual({ id: v2.id, confirmarCritica: true });
  lista = await caller.listar();
  expect(lista.map((m) => [m.versao, m.atual, m.aguardandoConfirmacao])).toEqual([[2, true, false], [1, false, false]]);
  const auditoria = (await pg.query<{ action: string }>("SELECT action FROM pci_model_audit ORDER BY id")).rows.map((r) => r.action);
  expect(auditoria).toEqual(["enviar", "enviar", "confirmar_critica"]);
  await caller.definirAtual({ id: v1.id });
});

it("exclusão lógica: não exclui a atual; prévia mostra uso; arquivo preservado e PCI gerada intacta", async () => {
  const caller = pciModelosRouter.createCaller(ctx);
  const [v2, v1] = await caller.listar();
  await expect(caller.excluir({ id: v1.id, confirmar: true })).rejects.toThrow(/versão atual não pode ser excluída/);
  const planilha = gerarPlanilhaPci(MODELO, "xls", formularioPciVazio()).bytes;
  await pg.query(`INSERT INTO pci_generated (project_id, model_id, model_version, form_data, sheet_file_name, sheet_format, sheet_data, pdf_file_name, pdf_data)
    VALUES (10, $1, 2, '{}'::jsonb, 'p.xls', 'xls', $2, 'p.pdf', $2)`, [v2.id, planilha]);
  expect(await caller.previaExclusao({ id: v2.id })).toMatchObject({ versao: 2, atual: false, pcisGeradas: 1 });
  expect(await caller.excluir({ id: v2.id, confirmar: true })).toMatchObject({ ok: true, versao: 2, pcisGeradas: 1 });
  expect((await caller.listar()).map((m) => m.versao)).toEqual([1]);
  const linha = (await pg.query<{ deleted_at: Date | null; deleted_by: number; tem: boolean }>("SELECT deleted_at, deleted_by, octet_length(data) > 0 AS tem FROM pci_models WHERE id = $1", [v2.id])).rows[0];
  expect(linha.deleted_at).not.toBeNull();
  expect(linha).toMatchObject({ deleted_by: 1, tem: true });
  const gerada = (await pg.query<{ model_id: number }>("SELECT model_id FROM pci_generated")).rows[0];
  expect(gerada.model_id).toBe(v2.id);
  await expect(caller.excluir({ id: v2.id, confirmar: true })).rejects.toThrow(/não encontrado/);
  await expect(caller.definirAtual({ id: v2.id })).rejects.toThrow(/não encontrado/);
  const auditoria = (await pg.query<{ action: string; user_id: number }>("SELECT action, user_id FROM pci_model_audit WHERE action = 'excluir'")).rows;
  expect(auditoria).toEqual([{ action: "excluir", user_id: 1 }]);
});
