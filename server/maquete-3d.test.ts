// Maquete 3D (EPIC-022, etapa 1): modelo, regras de preço, motor de leitura (IA simulada) e router com banco em
// memória. Nada aqui sai para a rede nem toca banco real.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste", anthropicApiKey: "" } }));

import * as schema from "../drizzle/schema.js";
import { areaPoligono, modeloSchema, podePublicar, resumoModelo, validarModelo, type ModeloMaquete } from "../shared/maquete-3d/modelo.js";
import { PRECOS_PADRAO, faixaPorArea, lerConfig } from "../shared/maquete-3d/regras.js";
import { normalizePermissions } from "../shared/admin-permissions.js";
import { getDb } from "./db.js";
import { definirDependencias, type PedidoIA } from "./maquete-3d/base.js";
import { montarModelo, passosDoInventario } from "./maquete-3d/leitura.js";
import { appRouter } from "./routers.js";

// ── Respostas simuladas da IA: sobrado 6 × 8 m, dois pavimentos, escada ──

const INVENTARIO = {
  pranchas: [{ doc: 0, pagina: 1, tipo: "planta_baixa", descricao: "Térreo" }, { doc: 0, pagina: 2, tipo: "planta_baixa", descricao: "Superior" }],
  edificacoes: [{
    nome: "Casa", cobertura: { tipo: "duas_aguas", inclinacao: 30, beiral: 0.6, confirmada: true },
    pavimentos: [
      { nome: "Térreo", nivel: 0, peDireito: 2.8, peDireitoConfirmado: true, repeticoes: 1, doc: 0, pagina: 1 },
      { nome: "Superior", nivel: 3, peDireito: 2.7, peDireitoConfirmado: false, repeticoes: 1, doc: 0, pagina: 2 },
    ],
  }],
  implantacao: null, pendencias: ["Não há corte do pavimento superior."],
};
const ESTRUTURA = {
  paredes: [
    { id: "p1", ax: 0, ay: 0, bx: 6, by: 0, espessura: 0.15, externa: true, confirmada: true },
    { id: "p2", ax: 6, ay: 0, bx: 6, by: 8, espessura: 0.15, externa: true, confirmada: true },
    { id: "p3", ax: 6, ay: 8, bx: 0, by: 8, espessura: 0.15, externa: true, confirmada: true },
    { id: "p4", ax: 0, ay: 8, bx: 0, by: 0, espessura: 0.15, externa: true, confirmada: true },
  ],
  aberturas: [{ id: "a1", paredeId: "p3", tipo: "porta", posicao: 3, largura: 0.9, altura: 2.1, peitoril: 0, entradaPrincipal: true, confirmada: true }],
  pendencias: [],
};
const retangulo = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 8 }, { x: 0, y: 8 }];
const AMBIENTES_TERREO = {
  comodos: [{ id: "c1", nome: "Sala", funcao: "sala", pontos: retangulo, areaInformada: 48, confirmada: true }],
  escadas: [{ id: "e1", tipo: "reta", pontos: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 3 }, { x: 0, y: 3 }], inicio: { x: 0.5, y: 3 }, fim: { x: 0.5, y: 0 }, largura: 0.9, degraus: 16, sobePara: "superior", confirmada: true }],
  pendencias: [],
};
const AMBIENTES_SUPERIOR = {
  comodos: [{ id: "c1", nome: "Suíte", funcao: "suite", pontos: retangulo, areaInformada: 48, confirmada: true }],
  escadas: [], pendencias: [],
};
const parciais = () => ({
  inventario: INVENTARIO, "estrutura:ed1-pv1": ESTRUTURA, "ambientes:ed1-pv1": AMBIENTES_TERREO,
  "estrutura:ed1-pv2": ESTRUTURA, "ambientes:ed1-pv2": AMBIENTES_SUPERIOR,
});

describe("modelo e regras", () => {
  it("preços padrão aprovados e faixa pela área/pavimentos", () => {
    expect(PRECOS_PADRAO).toEqual({ terrea_ate_70: 197, terrea_70_150: 297, acima_150_ou_sobrado: 497 });
    expect(lerConfig(null).precos).toEqual(PRECOS_PADRAO);
    expect(faixaPorArea(70, 1)).toBe("terrea_ate_70");
    expect(faixaPorArea(70.1, 1)).toBe("terrea_70_150");
    expect(faixaPorArea(150.1, 1)).toBe("acima_150_ou_sobrado");
    expect(faixaPorArea(60, 2)).toBe("acima_150_ou_sobrado");
  });

  it("módulo maquete3d entra nas permissões do colaborador", () => {
    expect(normalizePermissions(["maquete3d", "inexistente"])).toEqual(["maquete3d"]);
  });

  it("passos: dois por pavimento e a montagem no fim", () => {
    expect(passosDoInventario(INVENTARIO).map(p => p.chave)).toEqual([
      "estrutura:ed1-pv1", "ambientes:ed1-pv1", "estrutura:ed1-pv2", "ambientes:ed1-pv2", "montagem",
    ]);
  });

  it("monta o sobrado: níveis, escada ligada ao pavimento de cima e resumo comercial", () => {
    const m = montarModelo("casa", parciais());
    expect(m.edificacoes[0].pavimentos.map(p => [p.id, p.nivel, p.origemPeDireito])).toEqual([["ed1-pv1", 0, "confirmada"], ["ed1-pv2", 3, "estimada"]]);
    expect(m.edificacoes[0].pavimentos[0].escadas[0].destinoPavimentoId).toBe("ed1-pv2");
    expect(areaPoligono(m.edificacoes[0].pavimentos[0].comodos[0].poligono)).toBe(48);
    expect(resumoModelo(m)).toMatchObject({ areaTotal: 96, pavimentos: 2, quartos: 1, suites: 1, comodos: 2 });
    expect(m.pendencias.map(p => p.descricao)).toEqual(["Não há corte do pavimento superior."]);
  });

  it("não publica com pendência aberta; publica depois de resolvida; avisa medida estimada", () => {
    const m = montarModelo("casa", parciais());
    expect(podePublicar(m)).toBe(false);
    expect(validarModelo(m).filter(p => p.nivel === "erro").map(p => p.onde)).toEqual(["Pendência"]);
    expect(validarModelo(m).some(p => p.nivel === "aviso" && /Pé-direito estimado/.test(p.mensagem))).toBe(true);
    m.pendencias[0].resolvida = true;
    expect(podePublicar(m)).toBe(true);
  });

  it("acusa abertura fora da parede, área divergente e pavimentos sobrepostos", () => {
    const m = montarModelo("casa", parciais());
    m.pendencias = [];
    const [terreo, superior] = m.edificacoes[0].pavimentos;
    terreo.aberturas[0].posicao = 5.9;
    terreo.comodos[0].areaInformada = 30;
    superior.nivel = 2;
    const ps = validarModelo(m).map(p => `${p.nivel}: ${p.mensagem}`);
    expect(ps.some(t => /^erro: Não cabe na parede/.test(t))).toBe(true);
    expect(ps.some(t => /^aviso: Área da prancha 30 m², área do desenho lido 48 m²/.test(t))).toBe(true);
    expect(ps.some(t => /^erro: O pavimento "Superior" começa/.test(t))).toBe(true);
  });

  it("prédio: pavimento-tipo repetido conta área e quartos por andar", () => {
    const m: ModeloMaquete = modeloSchema.parse({
      tipo: "predio",
      edificacoes: [{ id: "ed1", nome: "Bloco A", pavimentos: [{
        id: "pv1", nome: "Tipo", repeticoes: 8, paredes: [], aberturas: [],
        comodos: [{ id: "c1", nome: "Quarto", funcao: "quarto", poligono: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }, { x: 0, y: 4 }] }],
      }] }],
    });
    expect(resumoModelo(m)).toMatchObject({ pavimentos: 8, quartos: 8, areaTotal: 96 });
  });

  it("loteamento exige implantação com lotes", () => {
    const sem = modeloSchema.parse({ tipo: "loteamento" });
    expect(validarModelo(sem).map(p => p.mensagem)).toContain("Falta a implantação (terreno, vias e lotes).");
    const com = modeloSchema.parse({ tipo: "loteamento", implantacao: { lotes: [{ id: "l1", nome: "01", quadra: "A", poligono: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 20 }], areaInformada: 200 }] } });
    expect(validarModelo(com)).toEqual([]);
    expect(resumoModelo(com).lotes).toBe(1);
  });
});

// ── Router com banco em memória ──

const TABELAS = ["users", "leads", "leadServices", "operationalProjects", "projectRevisionRequests", "projectDocuments", "incorporationStudies", "incorporationRegistrationDocuments", "paymentOrders", "draws", "products"];
let ddl: string | null = null;
async function criarBanco() {
  if (!ddl) {
    const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)("drizzle-kit/api");
    const escolhidas: Record<string, unknown> = {};
    for (const [nome, valor] of Object.entries(schema)) if (TABELAS.includes(nome) || nome.endsWith("Enum")) escolhidas[nome] = valor;
    ddl = (await generateMigration(generateDrizzleJson({}), generateDrizzleJson(escolhidas)) as string[]).join(";\n");
  }
  const pg = new PGlite();
  await pg.exec(ddl);
  await pg.exec(`CREATE TABLE incorporation_registration_file_data (document_id integer PRIMARY KEY, mime text, size_bytes integer, data bytea);`);
  const migracao = readFileSync(new URL("../drizzle/0111_maquete_3d.sql", import.meta.url), "utf8");
  await pg.exec(migracao);
  await pg.exec(migracao); // idempotente
  return { pg, db: drizzle(pg) };
}

let banco: Awaited<ReturnType<typeof criarBanco>>;
let pedidos: PedidoIA[];
let respostas: (unknown | Error)[];

const caller = (id: number, role: string, permissions = "[]") => appRouter.createCaller({ user: { id, role, permissions, active: true, name: "x" }, req: {}, res: {} } as never);
const admin = () => caller(1, "admin").maquete3d;
const colaborador = () => caller(2, "colaborador", JSON.stringify(["maquete3d"])).maquete3d;

const docProjeto = { fonte: "projeto" as const, id: 1, nome: "planta.pdf" };

describe("router maquete3d", () => {
  beforeEach(async () => {
    banco = await criarBanco();
    vi.mocked(getDb).mockReturnValue(banco.db as never);
    await banco.pg.exec(`
      INSERT INTO users ("openId", name, role, active) VALUES ('admin', 'Admin', 'admin', true), ('colab', 'Colaboradora', 'colaborador', true), ('outro', 'Sem módulo', 'colaborador', true);
      INSERT INTO operational_projects (name, client_name, client_phone, engineer, value) VALUES ('Casa Silva', 'Ana Silva', '99999', 'Eng', 1000);
      INSERT INTO project_documents (project_id, item_id, kind, original_name, canonical_name, mime, size, version, drive_file_id, status)
        VALUES (1, 'arq', 'pdf', 'planta.pdf', 'planta.pdf', 'application/pdf', 10, 1, 'drive-1', 'active'),
               (1, 'arq', 'editable', 'planta.dwg', 'planta.dwg', 'application/acad', 10, 1, 'drive-2', 'active'),
               (1, 'est', 'pdf', 'antigo.pdf', 'antigo.pdf', 'application/pdf', 10, 1, 'drive-3', 'replaced');
      INSERT INTO incorporation_studies (name, city) VALUES ('Residencial Sol', 'Imperatriz');
      INSERT INTO incorporation_registration_documents (study_id, item_id, action, drive_file_id, file_name, mime_type, file_size, performed_by_user_id)
        VALUES (1, 'projeto', 'uploaded', 'drive-9', 'implantacao.pdf', 'application/pdf', 10, 1),
               (1, 'memorial', 'uploaded', 'drive-8', 'memorial.pdf', 'application/pdf', 10, 1), (1, 'memorial', 'unlinked', null, null, null, null, 1);
    `);
    pedidos = [];
    respostas = [];
    definirDependencias({
      agora: () => new Date("2026-11-14T13:00:00Z"),
      lerPdf: async d => Buffer.from(`pdf:${d.nome}`),
      ia: async p => {
        pedidos.push(p);
        const r = respostas.shift();
        if (r instanceof Error) throw r;
        return { json: r, entrada: 1000, saida: 200 };
      },
    });
  });
  afterEach(async () => { definirDependencias(); await banco.pg.close(); });

  it("quem não tem o módulo não entra; colaborador com o módulo entra", async () => {
    await expect(caller(3, "colaborador", JSON.stringify(["crm"])).maquete3d.listar()).rejects.toThrow("Sem permissão");
    await expect(caller(4, "cliente").maquete3d.listar()).rejects.toThrow();
    expect(await colaborador().listar()).toEqual([]);
  });

  it("lista só PDFs ativos do projeto e o último envio de cada item do estudo", async () => {
    expect(await colaborador().documentosDisponiveis({ origem: "projeto", alvoId: 1 })).toEqual([docProjeto]);
    expect(await colaborador().documentosDisponiveis({ origem: "incorporacao", alvoId: 1 })).toEqual([{ fonte: "incorporacao", id: 1, nome: "implantacao.pdf" }]);
  });

  it("projeto: nasce aguardando pagamento com o preço padrão; preço diferente e liberação só com admin", async () => {
    const { id } = await colaborador().criar({ origem: "projeto", alvoId: 1, tipo: "casa", faixaPreco: "acima_150_ou_sobrado", documentos: [docProjeto] });
    expect(await colaborador().detalhe({ id })).toMatchObject({ status: "aguardando_pagamento", preco: 497, titulo: "Maquete 3D — Casa Silva", documentos: [docProjeto] });
    await expect(colaborador().criar({ origem: "projeto", alvoId: 1, tipo: "casa", faixaPreco: "terrea_ate_70", preco: 50, documentos: [] })).rejects.toThrow("Só o administrador");
    await expect(colaborador().criar({ origem: "projeto", alvoId: 1, tipo: "casa", documentos: [] })).rejects.toThrow("faixa de preço");
    await expect(colaborador().criar({ origem: "projeto", alvoId: 1, tipo: "casa", faixaPreco: "terrea_ate_70", documentos: [{ fonte: "projeto", id: 3, nome: "antigo.pdf" }] })).rejects.toThrow("não pertence");
    await expect(colaborador().iniciarLeitura({ id })).rejects.toThrow("não está liberada");
    await expect(colaborador().liberar({ id, nota: "PIX recebido" })).rejects.toThrow("Só o administrador");
    await expect(admin().liberar({ id })).rejects.toThrow("Informe como o pagamento");
    await admin().liberar({ id, nota: "PIX recebido em 14/11" });
    expect(await admin().detalhe({ id })).toMatchObject({ status: "liberada", liberadoPorNome: "Admin", liberacaoNota: "PIX recebido em 14/11" });
    await expect(admin().liberar({ id, nota: "de novo, mesmo PIX" })).rejects.toThrow("já foi liberada");
  });

  it("incorporação: sem preço e só roda depois da autorização do administrador", async () => {
    const { id } = await colaborador().criar({ origem: "incorporacao", alvoId: 1, tipo: "loteamento", documentos: [{ fonte: "incorporacao", id: 1, nome: "x" }] });
    expect(await colaborador().detalhe({ id })).toMatchObject({ status: "aguardando_autorizacao", preco: null, faixaPreco: null, pagoEm: null });
    await expect(colaborador().iniciarLeitura({ id })).rejects.toThrow("não está liberada");
    await expect(colaborador().liberar({ id })).rejects.toThrow("Só o administrador");
    await admin().liberar({ id });
    expect(await admin().detalhe({ id })).toMatchObject({ status: "liberada", pagoEm: null });
  });

  it("leitura em passos até a revisão; erro num passo só repete aquele passo", async () => {
    const m = colaborador();
    const { id } = await m.criar({ origem: "projeto", alvoId: 1, tipo: "casa", faixaPreco: "acima_150_ou_sobrado", documentos: [docProjeto] });
    await admin().liberar({ id, nota: "PIX recebido" });
    expect(await m.iniciarLeitura({ id })).toMatchObject({ total: 1, feitos: 0 });

    respostas.push(INVENTARIO, ESTRUTURA, new Error("fora do ar"), AMBIENTES_TERREO, ESTRUTURA, AMBIENTES_SUPERIOR);
    expect(await m.avancarLeitura({ id })).toMatchObject({ total: 6, feitos: 1, erro: null });
    expect(await m.avancarLeitura({ id })).toMatchObject({ feitos: 2, erro: null });
    expect(await m.avancarLeitura({ id })).toMatchObject({ feitos: 2, erro: "fora do ar", status: "em_leitura" });
    expect(await m.avancarLeitura({ id })).toMatchObject({ feitos: 3, erro: null });
    await m.avancarLeitura({ id });
    await m.avancarLeitura({ id });
    expect(await m.avancarLeitura({ id })).toMatchObject({ feitos: 6, proximo: null, status: "em_revisao" });

    // O PDF vai em todo passo; o passo dos ambientes recebe as paredes já lidas; a montagem não chama a IA.
    expect(pedidos).toHaveLength(6);
    expect(pedidos[0].pdfs).toEqual([{ nome: "planta.pdf", base64: Buffer.from("pdf:planta.pdf").toString("base64") }]);
    expect(pedidos[3].pedido).toContain('[["p1",0,0,6,0]');
    expect(pedidos[3].pedido).toContain('"Superior"');

    const d = await m.detalhe({ id });
    expect(d).toMatchObject({ status: "em_revisao", modeloVersao: 1, tokens: { entrada: 5000, saida: 1000 }, resumo: { areaTotal: 96, pavimentos: 2 } });
    expect(d.problemas.filter(p => p.nivel === "erro")).toHaveLength(1);

    // Revisão: validar é barrado pela pendência; salvar com versão antiga é barrado; depois de resolver, valida.
    await expect(m.validar({ id })).rejects.toThrow("erros ou pendências");
    const modelo = d.modelo!;
    modelo.pendencias[0].resolvida = true;
    await expect(m.salvarModelo({ id, versao: 0, modelo })).rejects.toThrow("alterada por outra pessoa");
    expect(await m.salvarModelo({ id, versao: 1, modelo })).toMatchObject({ versao: 2 });
    await m.validar({ id });
    expect((await m.detalhe({ id })).status).toBe("validada");
    await expect(m.definirDocumentos({ id, documentos: [docProjeto] })).resolves.toEqual({ ok: true });

    // Fundo da revisão: página de cada pavimento e o PDF original em partes.
    expect((await m.detalhe({ id })).pranchas).toEqual([{ pavimentoId: "ed1-pv1", doc: 0, pagina: 1 }, { pavimentoId: "ed1-pv2", doc: 0, pagina: 2 }]);
    expect(await m.pdfParte({ id, doc: 0, parte: 0 })).toEqual({ partes: 1, nome: "planta.pdf", base64: Buffer.from("pdf:planta.pdf").toString("base64") });
    await expect(m.pdfParte({ id, doc: 1, parte: 0 })).rejects.toThrow("Arquivo não encontrado");
  });

  it("inventário sem planta baixa para com mensagem clara", async () => {
    const { id } = await admin().criar({ origem: "projeto", alvoId: 1, tipo: "casa", faixaPreco: "terrea_ate_70", documentos: [docProjeto] });
    await admin().liberar({ id, nota: "PIX recebido" });
    await admin().iniciarLeitura({ id });
    respostas.push({ pranchas: [], edificacoes: [], implantacao: null, pendencias: [] });
    expect((await admin().avancarLeitura({ id })).erro).toMatch(/Nenhuma planta baixa/);
  });

  it("sem chave da IA o passo falha com aviso e nada é inventado", async () => {
    definirDependencias();
    definirDependencias({ lerPdf: async () => Buffer.from("x") });
    const { id } = await admin().criar({ origem: "projeto", alvoId: 1, tipo: "casa", faixaPreco: "terrea_ate_70", documentos: [docProjeto] });
    await admin().liberar({ id, nota: "PIX recebido" });
    await admin().iniciarLeitura({ id });
    expect((await admin().avancarLeitura({ id })).erro).toMatch(/Chave da IA não configurada/);
    expect((await admin().detalhe({ id })).modelo).toBeNull();
  });

  it("preços: só admin altera; recusar e excluir só admin", async () => {
    const config = await colaborador().config();
    await expect(colaborador().salvarConfig({ ...config, precos: { ...config.precos, terrea_ate_70: 1 } })).rejects.toThrow("Só o administrador");
    await admin().salvarConfig({ ...config, precos: { ...config.precos, terrea_ate_70: 250 } });
    const { id } = await colaborador().criar({ origem: "projeto", alvoId: 1, tipo: "casa", faixaPreco: "terrea_ate_70", documentos: [] });
    expect((await colaborador().detalhe({ id })).preco).toBe(250);
    await expect(colaborador().recusar({ id, motivo: "PDF ilegível" })).rejects.toThrow("Só o administrador");
    await admin().recusar({ id, motivo: "PDF ilegível" });
    await expect(admin().liberar({ id, nota: "PIX recebido" })).rejects.toThrow("já foi liberada ou recusada");
    await admin().excluir({ id });
    expect(await admin().listar()).toEqual([]);
  });
});
