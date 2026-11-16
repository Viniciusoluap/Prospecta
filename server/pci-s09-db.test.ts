// EPIC-024 S-09 (PGlite): CPF só do engenheiro escolhido, "Dados automáticos" com fonte, modelos de preenchimento
// versionados e sem dados pessoais, permissões. Migrações 0087/0088/0098/0118 aplicadas duas vezes (idempotentes).
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as banco from "./db.js";

vi.mock("./obra-localizacao.js", () => ({ obterLocalizacaoObra: vi.fn(async (id: number) => (id === 20 ? { coords: { lat: -5.5, lng: -47.5 }, pontoPci: null } : null)) }));

import { pciGeradorRouter } from "./pci-gerador.js";
import { router } from "./_core/trpc.js";
import { compararPreenchimentoPci, normalizarFormularioPci, sugestoesDoModeloPci } from "../shared/pci-gerador.js";

// Montado com o nome real ("pciGerador.*"): a checagem de módulo do colaborador usa o caminho completo.
const app = router({ pciGerador: pciGeradorRouter });
const chamador = (c: never) => app.createCaller(c).pciGerador;

const pg = new PGlite();
const migracao = (n: string) => readFileSync(new URL(`../drizzle/${n}`, import.meta.url), "utf8");
const CPF_RAFAEL = "529.982.247-25";
const CPF_ANA = "111.444.777-35";
const CPF_CLIENTE_1 = "123.456.789-09";

beforeAll(async () => {
  await pg.exec(`
    CREATE TABLE users (id integer primary key, name text, email varchar, phone varchar, role text, active boolean, permissions text DEFAULT '[]');
    INSERT INTO users VALUES (1, 'Admin', 'admin@x.y', null, 'admin', true, '[]'),
      (7, 'Rafael Claudino', 'rafael@x.y', null, 'colaborador', true, '["projetos"]'),
      (8, 'Eng. Ana', 'ana@x.y', '(86) 3222-1111', 'colaborador', true, '[]'),
      (9, 'Eng. Desativado', 'des@x.y', '(99) 3000-0000', 'colaborador', true, '[]'),
      (20, 'Colab Obras', 'co@x.y', null, 'colaborador', true, '["obras"]'),
      (21, 'Colab Sem Obras', 'cs@x.y', null, 'colaborador', true, '["crm"]'),
      (22, 'Corretor', 'cor@x.y', null, 'corretor', true, '[]');
    CREATE TABLE leads (id integer primary key, name varchar, cpf varchar, email varchar, phone varchar, address text, neighborhood varchar, simulation_value numeric);
    INSERT INTO leads VALUES (5, 'Cliente Um', '${CPF_CLIENTE_1}', 'um@x.y', '(99) 98888-7777', 'Rua do Lead', 'Bairro Um', 210000),
      (6, 'Cliente Dois', '987.654.321-00', 'dois@x.y', null, null, 'Bairro Dois', null);
    CREATE TABLE construction_projects (id integer primary key, title varchar, address text, city varchar, state varchar, total_area integer, vgv numeric, lead_id integer,
      lot_cost numeric, financed_amount numeric, start_date timestamp, estimated_end_date timestamp, lead_service_id integer);
    INSERT INTO construction_projects VALUES (20, 'Casa Lote 1', 'Rua Lote 1', 'Imperatriz', 'MA', 70, 200000, 5, 50000, 150000, '2026-01-10', '2026-07-05', 300),
      (21, 'Casa Lote 2', 'Rua Lote 2', 'Imperatriz', 'MA', 70, 190000, 6, 40000, null, null, null, null);
    CREATE TABLE construction_pci (project_id integer primary key, data bytea);
    INSERT INTO construction_pci VALUES (21, '\\x00010203');
    CREATE TABLE operational_projects (id integer primary key, name varchar, engineer_user_id integer, lead_service_id integer);
    INSERT INTO operational_projects VALUES (1, 'Projeto Casa Lote 1', 7, 300);
  `);
  for (const n of ["0087_pci_gerador.sql", "0096_pci_lote3.sql", "0088_perfil_engenheiro.sql", "0098_engineer_profile_cpf.sql", "0118_pci_modelos_preenchimento.sql"]) {
    await pg.exec(migracao(n));
    await pg.exec(migracao(n));
  }
  await pg.exec(`
    INSERT INTO engineer_profiles (user_id, active, cpf, phone, crea_number, crea_state) VALUES
      (7, true, '${CPF_RAFAEL}', '(99) 99111-2222', '1122334455', 'MA'),
      (8, true, '${CPF_ANA}', null, '998877', 'PI'),
      (9, false, '222.333.444-05', '(99) 98000-0000', '555', 'MA');
  `);
  vi.spyOn(banco, "getDb").mockReturnValue(drizzle(pg) as never);
});
afterAll(() => pg.close());

const ctx = (id: number, role: string, permissions = "[]") => ({ user: { id, role, active: true, name: `U${id}`, permissions }, req: {}, res: {} }) as never;
const admin = chamador(ctx(1, "admin"));
const colabObras = chamador(ctx(20, "colaborador", '["obras"]'));

describe("A — CPF do engenheiro", () => {
  it("a lista de engenheiros nunca leva CPF", async () => {
    const d = await admin.obter({ projectId: 21 });
    const json = JSON.stringify(d.engenheiros);
    expect(d.engenheiros.map((e) => e.nome)).toEqual(expect.arrayContaining(["Rafael Claudino", "Eng. Ana"]));
    for (const cpf of [CPF_RAFAEL, CPF_ANA, "222.333.444-05"]) expect(json).not.toContain(cpf);
    expect(json).not.toMatch(/"cpf"/);
  });
  it("o engenheiro escolhido vem com CPF, CREA e telefone do perfil", async () => {
    expect(await admin.engenheiro({ projectId: 20, userId: 7 })).toMatchObject({ id: "7", nome: "Rafael Claudino", cpf: CPF_RAFAEL, crea: "1122334455", creaUf: "MA", telefone: "(99) 99111-2222", perfilAtivo: true, avisos: [] });
    const ana = await colabObras.engenheiro({ projectId: 20, userId: 8 });
    expect(ana).toMatchObject({ cpf: CPF_ANA, telefone: "(86) 3222-1111" });
  });
  it("perfil desativado ou ausente: nada do perfil e aviso claro", async () => {
    const des = await admin.engenheiro({ projectId: 20, userId: 9 });
    expect(des).toMatchObject({ cpf: null, crea: null, perfilAtivo: false });
    expect(des.avisos[0]).toMatch(/está desativado/);
    expect((await admin.engenheiro({ projectId: 20, userId: 1 })).avisos[0]).toMatch(/não tem perfil de Engenheiro/);
    await expect(admin.engenheiro({ projectId: 20, userId: 22 })).rejects.toThrow(/não encontrado/);
  });
});

describe("B — Dados automáticos", () => {
  it("traz o engenheiro do projeto do mesmo serviço do CRM para o RTP (com CPF) e explica o RTE", async () => {
    const s = await admin.sugestoesAutomaticas({ projectId: 20 });
    const r = compararPreenchimentoPci(normalizarFormularioPci({}), s.sugestoes, s.ausencias);
    expect(r.formulario.campos).toMatchObject({ rtpNome: "Rafael Claudino", rtpCpf: CPF_RAFAEL, rtpRegistro: "1122334455", rtpUf: "MA", proponenteCpf: CPF_CLIENTE_1, latitude: `05° 30' 00" S` });
    expect(r.preenchidos.find((p) => p.chave === "rtpCpf")?.fonte).toMatch(/Projeto Casa Lote 1.*mesmo serviço do CRM.*perfil de Rafael Claudino/);
    expect(r.preenchidos.find((p) => p.chave === "proponenteCpf")?.fonte).toBe("Cliente do CRM (lead nº 5)");
    expect(r.naoEncontrados.find((a) => a.chave === "rteCpf")?.motivo).toMatch(/Nenhum engenheiro de execução/);
  });
  it("RTE escolhido no rascunho (o mesmo ou outro profissional) e conflito com o que já está preenchido", async () => {
    const rascunho = normalizarFormularioPci({ rteEngenheiroId: "8", campos: { rtpNome: "Digitado à mão", proponenteNome: "Cliente Um" } });
    await admin.salvarRascunho({ projectId: 20, formulario: rascunho });
    const s = await admin.sugestoesAutomaticas({ projectId: 20, rtpEngenheiroId: "7" });
    const r = compararPreenchimentoPci(rascunho, s.sugestoes, s.ausencias);
    expect(r.formulario.campos).toMatchObject({ rteNome: "Eng. Ana", rteCpf: CPF_ANA, rtpNome: "Digitado à mão", rtpCpf: null });
    expect(r.conflitos).toContainEqual(expect.objectContaining({ chave: "rtpNome", atual: "Digitado à mão", sugerido: "Rafael Claudino", fonte: expect.stringMatching(/escolhido nesta obra/) }));
    expect(r.conflitos.map((c) => c.chave)).toContain("rtpCpf");
    expect(r.iguais.map((i) => i.chave)).toContain("proponenteNome");
    // Mesmo profissional nos dois papéis.
    const mesmo = compararPreenchimentoPci(normalizarFormularioPci({}), (await admin.sugestoesAutomaticas({ projectId: 20, rtpEngenheiroId: "7", rteEngenheiroId: "7" })).sugestoes);
    expect([mesmo.formulario.campos.rtpCpf, mesmo.formulario.campos.rteCpf]).toEqual([CPF_RAFAEL, CPF_RAFAEL]);
  });
  it("PCI vinculada ilegível deixa de ser engolida: vira motivo", async () => {
    const s = await admin.sugestoesAutomaticas({ projectId: 21 });
    expect(s.ausencias.find((a) => a.chave === "custos")?.motivo).toMatch(/PCI vinculada não pôde ser lida/);
    expect(s.ausencias.find((a) => a.chave === "latitude")?.motivo).toMatch(/localização exata/);
  });
});

describe("C — modelos de preenchimento", () => {
  const formObra20 = () => normalizarFormularioPci({
    campos: { proponenteNome: "Cliente Um", proponenteCpf: CPF_CLIENTE_1, rtpNome: "Rafael Claudino", rtpCpf: CPF_RAFAEL, endereco: "Rua Lote 1", bairro: "Bairro Um",
      matricula: "4321", latitude: `05° 30' 00" S`, valorTerreno: 50000, valorImovel: 200000, areaCoberta: 70, divisaoInterna: "2 quartos, sala, cozinha", bdi: 18, prazoMeses: 6 },
    custos: [3000, 4000], cronograma: [10, 30, 50, 70, 90, 100], rtpEngenheiroId: "7", imagem: { tipo: "png", base64: "QUJD" },
  });

  it("salva só o técnico (o JSON gravado não tem CPF, nome nem endereço da obra de origem)", async () => {
    const r = await admin.salvarModeloPreenchimento({ projectId: 20, nome: "Casa padrão 70 m²", formulario: formObra20() });
    expect(r).toMatchObject({ nome: "Casa padrão 70 m²", versao: 1 });
    const gravado = JSON.stringify((await pg.query<{ form_data: unknown }>("SELECT form_data FROM pci_modelos_preenchimento WHERE id = $1", [r.id])).rows[0].form_data);
    for (const proibido of [CPF_CLIENTE_1, CPF_RAFAEL, "Cliente Um", "Rafael", "Rua Lote 1", "Bairro Um", "4321", "05°", "50000", "200000", "QUJD", "EngenheiroId"]) expect(gravado).not.toContain(proibido);
    expect(gravado).toContain("2 quartos, sala, cozinha");
    const lista = await colabObras.modelosPreenchimento();
    expect(lista).toEqual([expect.objectContaining({ nome: "Casa padrão 70 m²", versao: 1, obraOrigem: "Casa Lote 1", autor: "Admin", resumo: expect.stringMatching(/campo\(s\) técnico\(s\), custos, cronograma/) })]);
    await expect(admin.salvarModeloPreenchimento({ projectId: 20, nome: "casa PADRÃO 70 m²", formulario: formObra20() })).rejects.toThrow(/Já existe o modelo/);
    await expect(admin.salvarModeloPreenchimento({ projectId: 20, nome: "Vazio", formulario: normalizarFormularioPci({ campos: { proponenteCpf: CPF_CLIENTE_1 } }) })).rejects.toThrow(/Não há dados técnicos/);
  });

  it("aplicar em outra obra: técnico entra, dados pessoais da obra 21 ficam", async () => {
    const [m] = await admin.modelosPreenchimento();
    const modelo = await colabObras.modeloPreenchimento({ id: m.id });
    expect(JSON.stringify(modelo)).not.toContain(CPF_CLIENTE_1);
    const obra21 = normalizarFormularioPci({ campos: { proponenteNome: "Cliente Dois", proponenteCpf: "987.654.321-00", endereco: "Rua Lote 2", valorTerreno: 40000 } });
    const r = compararPreenchimentoPci(obra21, sugestoesDoModeloPci(modelo.dados, `Modelo "${modelo.nome}" v${modelo.versao}`));
    expect(r.formulario.campos).toMatchObject({ proponenteNome: "Cliente Dois", proponenteCpf: "987.654.321-00", endereco: "Rua Lote 2", valorTerreno: 40000, areaCoberta: 70, bdi: 18, prazoMeses: 6, rtpCpf: null });
    expect(r.formulario.custos.slice(0, 2)).toEqual([3000, 4000]);
    expect(r.formulario.cronograma).toEqual([10, 30, 50, 70, 90, 100]);
    expect(r.conflitos).toEqual([]);
  });

  it("nova versão guarda a anterior; histórico; não salva sobre versão antiga", async () => {
    const [v1] = await admin.modelosPreenchimento();
    const f = formObra20();
    f.campos.bdi = 15;
    const v2 = await colabObras.salvarModeloPreenchimento({ projectId: 20, nome: "ignorado", formulario: f, novaVersaoDe: v1.id });
    expect(v2).toMatchObject({ versao: 2 });
    const lista = await admin.modelosPreenchimento();
    expect(lista.map((m) => [m.id, m.versao])).toEqual([[v2.id, 2]]);
    const hist = await admin.historicoModeloPreenchimento({ id: v2.id });
    expect(hist.map((h) => h.versao)).toEqual([2, 1]);
    expect((await admin.modeloPreenchimento({ id: v1.id })).dados.campos.bdi).toBe(18);
    expect((await admin.modeloPreenchimento({ id: v2.id })).dados.campos.bdi).toBe(15);
    await expect(admin.salvarModeloPreenchimento({ projectId: 20, nome: "x", formulario: f, novaVersaoDe: v1.id })).rejects.toThrow(/versão mais nova/);
  });

  it("exclusão lógica: só o admin ou quem salvou; some da lista, linhas preservadas", async () => {
    const [m] = await admin.modelosPreenchimento();
    const outroColab = chamador(ctx(23, "colaborador", '["obras"]'));
    await expect(outroColab.excluirModeloPreenchimento({ id: m.id, confirmar: true })).rejects.toThrow(/Só o administrador ou quem salvou/);
    expect(await colabObras.excluirModeloPreenchimento({ id: m.id, confirmar: true })).toMatchObject({ versoes: 2 });
    expect(await admin.modelosPreenchimento()).toEqual([]);
    expect((await pg.query("SELECT id FROM pci_modelos_preenchimento WHERE deleted_at IS NOT NULL")).rows).toHaveLength(2);
  });
});

describe("permissões", () => {
  const procedimentos = (c: ReturnType<typeof chamador>) => [
    c.engenheiro({ projectId: 20, userId: 7 }),
    c.sugestoesAutomaticas({ projectId: 20 }),
    c.modelosPreenchimento(),
    c.salvarModeloPreenchimento({ projectId: 20, nome: "X", formulario: {} }),
  ];
  it("corretor, cliente e colaborador sem Obras não usam; colaborador com Obras usa", async () => {
    for (const c of [ctx(21, "colaborador", '["crm"]'), ctx(22, "corretor"), ctx(30, "cliente"), ctx(31, "empreiteiro")]) {
      for (const p of procedimentos(chamador(c))) await expect(p).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(colabObras.modelosPreenchimento()).resolves.toBeDefined();
  });
});
