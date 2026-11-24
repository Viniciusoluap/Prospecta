import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import * as banco from "./db.js";

vi.mock("./usuario-documentos.js", () => ({
  listarEngenheiros: vi.fn(async () => [{ id: 7, name: "Eng. Ana", email: "ana@x.y", role: "colaborador", engenheiro: true, telefone: null, crea: "998877", creaUf: "PI", creasAdicionais: [] }]),
}));
// Não há .xlsb de teste: o "xlsb" é o próprio .xls lido como .xls (abas/células), sem listas — como no .xlsb real.
vi.mock("./caixa/pci-modelo-estrutura.js", async (orig) => {
  const o = await orig<typeof import("./caixa/pci-modelo-estrutura.js")>();
  return { ...o, lerEstruturaModeloPci: (bytes: Uint8Array, formato: "xls" | "xlsm" | "xlsb") => formato === "xlsb" ? { ...o.lerEstruturaModeloPci(bytes, "xls"), formato, listas: null } : o.lerEstruturaModeloPci(bytes, formato) };
});
vi.mock("./obra-localizacao.js", () => ({ obterLocalizacaoObra: vi.fn(async () => ({ coords: { lat: -5.5, lng: -47.5 }, pontoPci: null })) }));

import { gerarPciDaObra, gravarModeloPci, pciGeradorRouter, pciModelosRouter } from "./pci-gerador.js";
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
      lot_cost numeric, financed_amount numeric, start_date timestamp, estimated_end_date timestamp, lead_service_id integer, pci_lot_cost numeric);
    -- #339: o terreno da PCI vem de pci_lot_cost (coluna da migração 0174)
    INSERT INTO construction_projects VALUES (10, 'Obra Com PCI', 'Rua da Obra, 1', 'Imperatriz', 'MA', 80, null, 5, 60000, 150000, '2026-01-10', '2026-05-10'),
      (11, 'Obra Sem PCI', 'Rua B', 'Imperatriz', 'MA', 50, 180000, null, null, null, null, null);
    CREATE TABLE construction_pci (project_id integer primary key, data bytea);
  `);
  await pg.query("INSERT INTO construction_pci VALUES (10, $1)", [MODELO]);
  await pg.exec(readFileSync(new URL("../drizzle/0061_pci_upload_chunks.sql", import.meta.url), "utf8"));
  // Aplica duas vezes: migração idempotente.
  await pg.exec(readFileSync(new URL("../drizzle/0087_pci_gerador.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../drizzle/0087_pci_gerador.sql", import.meta.url), "utf8"));
  // Lote 03: exclusão lógica, relatório de compatibilidade e auditoria (idempotente).
  await pg.exec(readFileSync(new URL("../drizzle/0096_pci_lote3.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../drizzle/0096_pci_lote3.sql", import.meta.url), "utf8"));
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
  // EPIC-024 S-09: proponente da PCI ≠ cliente do CRM → a abertura pede a escolha (pessoa inteira), não mistura.
  expect(inicial.formulario.campos.proponenteNome).toBeNull();
  expect(inicial.preenchimento?.pessoas.find((p) => p.pessoa === "proponente")?.opcoes.map((o) => o.fonte)).toEqual(["PCI vinculada à obra", "Cliente do CRM (lead nº 5)"]);
  expect(inicial.formulario.campos.rtpRegistro).toBe("1000000001"); // RTP só da PCI: uma fonte, preenchido
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

it("revisão PR #180: modelo .xlsb atual com base .xls compatível libera a geração (e o servidor informa)", async () => {
  const caller = pciGeradorRouter.createCaller(ctx);
  expect(await caller.obter({ projectId: 11 })).toMatchObject({ baseCompativelDisponivel: true, baseXlsVersao: 1, avisoModelo: null });
  await pg.exec("UPDATE pci_models SET is_current = false");
  await pg.query("INSERT INTO pci_models (version, file_name, format, size_bytes, checksum, data, is_current) VALUES (9, 'pci-v9.xlsb', 'xlsb', $1, 'x', $2, true)", [MODELO.length, MODELO]);
  try {
    const d = await caller.obter({ projectId: 11 });
    expect(d).toMatchObject({ modelo: { versao: 9, formato: "xlsb" }, baseCompativelDisponivel: true, baseXlsVersao: 1 });
    expect(d.avisoModelo).toMatch(/a partir da versão v1/);
    const r = await caller.gerar({ projectId: 11, formulario: d.formulario });
    expect(r.avisos[0]).toMatch(/v9 \(\.xlsb\).*versão v1/);
    // Sem a base .xls (excluída): o servidor avisa e a tela bloqueia.
    await pg.exec("UPDATE pci_models SET deleted_at = now() WHERE version = 1");
    expect(await caller.obter({ projectId: 11 })).toMatchObject({ baseCompativelDisponivel: false, baseXlsVersao: null, avisoModelo: expect.stringMatching(/não há versão \.xls compatível/) });
  } finally {
    await pg.exec("DELETE FROM pci_generated WHERE model_version = 9; DELETE FROM pci_models WHERE version = 9; UPDATE pci_models SET deleted_at = NULL, is_current = true WHERE version = 1");
  }
});

it("EPIC-025 E3 (achado 2): gerar com regravarRascunho: false (Dolores) NÃO altera o rascunho da equipe; o padrão da tela continua regravando", async () => {
  await pg.exec("INSERT INTO users VALUES (2, 'Dolores', 'colaborador', true) ON CONFLICT DO NOTHING; UPDATE pci_generator_drafts SET updated_by = 1, updated_at = '2026-11-15 12:00' WHERE project_id = 10");
  const antes = (await pg.query<{ form_data: unknown; updated_by: number; updated_at: Date }>("SELECT form_data, updated_by, updated_at FROM pci_generator_drafts WHERE project_id = 10")).rows[0];
  const r = await gerarPciDaObra(10, antes.form_data, { id: 2, name: "Dolores" }, { regravarRascunho: false, prazoDriveMs: 5_000 });
  const depois = (await pg.query<{ form_data: unknown; updated_by: number; updated_at: Date }>("SELECT form_data, updated_by, updated_at FROM pci_generator_drafts WHERE project_id = 10")).rows[0];
  expect(depois).toEqual(antes);
  expect((await pg.query<{ created_by: number }>("SELECT created_by FROM pci_generated WHERE id = $1", [r.id])).rows[0].created_by).toBe(2);
  // tela (sem opções): comportamento de sempre — o rascunho é regravado por quem gerou
  await pciGeradorRouter.createCaller(ctx).gerar({ projectId: 10, formulario: antes.form_data });
  expect((await pg.query<{ updated_by: number }>("SELECT updated_by FROM pci_generator_drafts WHERE project_id = 10")).rows[0].updated_by).toBe(1);
  expect((await pg.query<{ updated_at: Date }>("SELECT updated_at FROM pci_generator_drafts WHERE project_id = 10")).rows[0].updated_at).not.toEqual(antes.updated_at);
});

it("correções de 24/11: local e data sai sozinho na geração (rascunho fica em branco); a tela recebe as empresas do fiscal e a área da obra", async () => {
  const caller = pciGeradorRouter.createCaller(ctx);
  // sem as tabelas do módulo fiscal, a lista vem vazia e nada quebra
  expect(await caller.obter({ projectId: 11 })).toMatchObject({ empresas: [], areaObra: 50 });
  await pg.exec(`
    CREATE TABLE tax_profiles (id serial primary key, cnpj varchar, company_name varchar, regime varchar, is_active boolean, effective_from date);
    INSERT INTO tax_profiles (cnpj, company_name, regime, is_active, effective_from) VALUES
      ('11.222.333/0001-81', 'Construtora Exemplo Um LTDA', 'simples', true, '2026-01-01'),
      ('11.222.333/0001-81', 'Nome antigo da Um', 'simples', false, '2025-01-01'),
      ('44.555.666/0001-81', 'Construtora Exemplo Dois LTDA', 'simples', true, '2026-01-01'),
      ('', 'Sem CNPJ', 'simples', true, '2026-01-01');
    CREATE TABLE fiscal_emissores (id serial primary key, cnpj varchar, ativo boolean);
    CREATE TABLE fiscal_emissores_certificado (id serial primary key, emissor_id integer, valido_ate timestamptz);
    INSERT INTO fiscal_emissores (cnpj, ativo) VALUES ('44555666000181', true), ('11222333000181', true);
    INSERT INTO fiscal_emissores_certificado (emissor_id, valido_ate) VALUES (1, now() + interval '90 days'), (2, now() - interval '1 day');`);
  const tela = await caller.obter({ projectId: 11 });
  // a com certificado VÁLIDO vem primeiro; certificado vencido não conta; um item por CNPJ, com o nome do perfil ativo
  expect(tela.empresas).toEqual([
    { nome: "Construtora Exemplo Dois LTDA", cnpj: "44555666000181", certificado: true },
    { nome: "Construtora Exemplo Um LTDA", cnpj: "11222333000181", certificado: false },
  ]);
  // "Dados automáticos": a ÚNICA empresa com certificado entra sozinha em Construtora e CNPJ
  const auto = await caller.preencherAutomatico({ projectId: 11 });
  expect(auto.campos).toMatchObject({ construtora: "Construtora Exemplo Dois LTDA", cnpjConstrutora: "44.555.666/0001-81", municipio: "Imperatriz", uf: "MA" });
  // geração com "Local e data" em branco: a cidade do imóvel + o dia da geração; o rascunho continua em branco
  const form = formularioPciVazio();
  Object.assign(form.campos, { proponenteNome: "Proponente de Teste", municipio: "Imperatriz", uf: "MA" });
  const r = await caller.gerar({ projectId: 11, formulario: form });
  const gerada = (await pg.query<{ form_data: { campos: Record<string, unknown> }; sheet_data: Uint8Array }>("SELECT form_data, sheet_data FROM pci_generated WHERE id = $1", [r.id])).rows[0];
  expect(String(gerada.form_data.campos.localData)).toMatch(/^Imperatriz - MA, \d{1,2} de [a-zç]+ de \d{4}$/);
  const rascunho = (await pg.query<{ form_data: { campos: Record<string, unknown> } }>("SELECT form_data FROM pci_generator_drafts WHERE project_id = 11")).rows[0];
  expect(rascunho.form_data.campos.localData ?? null).toBeNull();
  // quem digitou o local e a data continua mandando
  form.campos.localData = "Açailândia - MA, 1 de dezembro de 2026";
  const r2 = await caller.gerar({ projectId: 11, formulario: form });
  expect((await pg.query<{ v: string }>("SELECT form_data->'campos'->>'localData' AS v FROM pci_generated WHERE id = $1", [r2.id])).rows[0].v).toBe("Açailândia - MA, 1 de dezembro de 2026");
});

it("sem modelo .xls/.xlsm atual: gerar pede o modelo certo", async () => {
  await pg.exec("UPDATE pci_models SET format = 'xlsb'");
  const caller = pciGeradorRouter.createCaller(ctx);
  expect(await caller.obter({ projectId: 11 })).toMatchObject({ baseCompativelDisponivel: false, avisoModelo: expect.stringMatching(/\.xlsb/) });
  // Lote 03, correção 10: sem versão .xls compatível, bloqueia pedindo a .xls (nunca gera xlsm/renomeia).
  await expect(caller.gerar({ projectId: 11, formulario: {} })).rejects.toThrow(/Envie a versão \.xls do modelo oficial/);
  await pg.exec("UPDATE pci_models SET is_current = false");
  await expect(caller.gerar({ projectId: 11, formulario: {} })).rejects.toThrow(/PCI da CAIXA/);
});
