import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import * as banco from "./db.js";

vi.mock("./usuario-documentos.js", () => ({
  listarEngenheiros: vi.fn(async () => [{ id: 7, name: "Eng. Ana", email: "ana@x.y", role: "colaborador", engenheiro: true, telefone: null, crea: "998877", creaUf: "PI", creasAdicionais: [] }]),
}));
vi.mock("./obra-localizacao.js", () => ({ obterLocalizacaoObra: vi.fn(async () => ({ coords: { lat: -5.5, lng: -47.5 }, pontoPci: null })) }));

import { gravarModeloPci, pciGeradorRouter, pciModelosRouter } from "./pci-gerador.js";
import { lerPci } from "./caixa/pci.js";
import { gerarPlanilhaPci } from "./caixa/pci-gerador.js";
import { formularioPciVazio } from "../shared/pci-gerador.js";

const MODELO = new Uint8Array(readFileSync(new URL("./caixa/__fixtures__/pci-modelo-anonimo.xls", import.meta.url)));
const pg = new PGlite();

beforeAll(async () => {
  await pg.exec(`
    CREATE TABLE users (id integer primary key, name text, role text, active boolean);
    INSERT INTO users VALUES (1, 'Admin', 'admin', true);
    CREATE TABLE leads (id integer primary key, name varchar, cpf varchar, email varchar, phone varchar, address text, neighborhood varchar, simulation_value numeric);
    INSERT INTO leads VALUES (5, 'Cliente do CRM', '123.456.789-09', 'cli@x.y', '(99) 98888-7777', 'Rua do Lead', 'Bairro Lead', 210000);
    CREATE TABLE construction_projects (id integer primary key, title varchar, address text, city varchar, state varchar, total_area integer, vgv numeric, lead_id integer,
      lot_cost numeric, financed_amount numeric, start_date timestamp, estimated_end_date timestamp);
    INSERT INTO construction_projects VALUES (10, 'Obra Com PCI', 'Rua da Obra, 1', 'Imperatriz', 'MA', 80, null, 5, 60000, 150000, '2026-01-10', '2026-05-10'),
      (11, 'Obra Sem PCI', 'Rua B', 'Imperatriz', 'MA', 50, 180000, null, null, null, null, null);
    CREATE TABLE construction_pci (project_id integer primary key, data bytea);
  `);
  await pg.query("INSERT INTO construction_pci VALUES (10, $1)", [MODELO]);
  await pg.exec(readFileSync(new URL("../drizzle/0061_pci_upload_chunks.sql", import.meta.url), "utf8"));
  // Aplica duas vezes: migração idempotente.
  await pg.exec(readFileSync(new URL("../drizzle/0082_pci_gerador.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../drizzle/0082_pci_gerador.sql", import.meta.url), "utf8"));
  vi.spyOn(banco, "getDb").mockReturnValue(drizzle(pg) as never);
});
afterAll(() => pg.close());

const ctx = { user: { id: 1, role: "admin", active: true, name: "Admin" }, req: {}, res: {} } as never;

it("modelos versionados: nova versão vira atual; arquivo repetido só volta a ser o atual", async () => {
  const caller = pciModelosRouter.createCaller(ctx);
  expect(await caller.listar()).toEqual([]);
  const v1 = await gravarModeloPci("pci-v1.xls", MODELO, 1, "primeira");
  expect(v1).toMatchObject({ versao: 1, formato: "xls", repetido: false });
  const repetido = await gravarModeloPci("pci-copia.xls", new Uint8Array(MODELO), 1, null);
  expect(repetido).toMatchObject({ versao: 1, repetido: true });
  await expect(gravarModeloPci("pci.xls", new Uint8Array([0x50, 0x4b, 3, 4]), 1, null)).rejects.toThrow(/não é um \.xls válido/);
  await expect(gravarModeloPci("pci.xlsx", MODELO, 1, null)).rejects.toThrow(/\.xls, \.xlsm ou \.xlsb/);
  // Nova versão (arquivo diferente) vira a atual; dá para voltar à anterior.
  const outro = gerarPlanilhaPci(MODELO, "xls", formularioPciVazio()).bytes;
  const v2 = await gravarModeloPci("pci-v2.xls", outro, 1, null);
  expect(v2).toMatchObject({ versao: 2, repetido: false });
  expect((await caller.listar()).map((m) => [m.versao, m.atual])).toEqual([[2, true], [1, false]]);
  await caller.definirAtual({ id: v1.id });
  await pg.exec("DELETE FROM pci_models WHERE version = 2");
  const lista = await caller.listar();
  expect(lista).toHaveLength(1);
  expect(lista[0]).toMatchObject({ versao: 1, atual: true, autor: "Admin", observacao: "primeira" });
});

it("formulário: pré-preenchimento (PCI vinculada > CRM), rascunho, geração e histórico", async () => {
  const caller = pciGeradorRouter.createCaller(ctx);
  const inicial = await caller.obter({ projectId: 10 });
  expect(inicial.origem).toBe("automatico");
  expect(inicial.modelo).toMatchObject({ versao: 1, formato: "xls" });
  expect(inicial.formulario.campos.proponenteNome).toBe("PROPONENTE DE TESTE"); // da PCI da obra
  expect(inicial.formulario.campos.valorFinanciado).toBe(150000); // da obra (não existe na PCI)
  expect(inicial.engenheiros[0]).toMatchObject({ id: "7", crea: "998877" });

  const semPci = await caller.obter({ projectId: 11 });
  expect(semPci.formulario.campos).toMatchObject({ proponenteNome: null, endereco: "Rua B", valorImovel: 180000, latitude: `05° 30' 00" S` });

  const form = { ...inicial.formulario, campos: { ...inicial.formulario.campos, proponenteNome: "NOME EDITADO" } };
  await caller.salvarRascunho({ projectId: 10, formulario: form });
  const salvo = await caller.obter({ projectId: 10 });
  expect(salvo.origem).toBe("rascunho");
  expect(salvo.formulario.campos.proponenteNome).toBe("NOME EDITADO");

  const r = await caller.gerar({ projectId: 10, formulario: form });
  expect(r.avisos).toEqual([]);
  const hist = await caller.historico({ projectId: 10 });
  expect(hist).toHaveLength(1);
  expect(hist[0]).toMatchObject({ modeloVersao: 1, formato: "xls", autor: "Admin" });
  expect(hist[0].planilha).toMatch(/^PCI_NOME_EDITADO_v1\.xls$/);
  const linha = (await pg.query<{ sheet_data: Uint8Array; pdf_data: Uint8Array }>("SELECT sheet_data, pdf_data FROM pci_generated WHERE id = $1", [r.id])).rows[0];
  expect(lerPci(new Uint8Array(linha.sheet_data)).identificacao.proponente).toBe("NOME EDITADO");
  expect(Buffer.from(linha.pdf_data).subarray(0, 4).toString()).toBe("%PDF");
  // O envio de PCI da obra não é tocado.
  const pci = (await pg.query<{ data: Uint8Array }>("SELECT data FROM construction_pci WHERE project_id = 10")).rows[0];
  expect(Buffer.compare(Buffer.from(pci.data), Buffer.from(MODELO))).toBe(0);
});

it("sem modelo .xls/.xlsm atual: gerar pede o modelo certo", async () => {
  await pg.exec("UPDATE pci_models SET format = 'xlsb'");
  const caller = pciGeradorRouter.createCaller(ctx);
  expect((await caller.obter({ projectId: 11 })).avisoModelo).toMatch(/\.xlsb/);
  await expect(caller.gerar({ projectId: 11, formulario: {} })).rejects.toThrow(/\.xls ou \.xlsm/);
  await pg.exec("UPDATE pci_models SET is_current = false");
  await expect(caller.gerar({ projectId: 11, formulario: {} })).rejects.toThrow(/Sub PCI atual/);
});
