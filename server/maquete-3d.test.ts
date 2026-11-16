// Maquete 3D (EPIC-022, etapa 1): modelo, regras de preço, motor de leitura (IA simulada) e router com banco em
// memória. Nada aqui sai para a rede nem toca banco real.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// As funções de payment_orders de db.ts usam a conexão interna do módulo; aqui elas são refeitas sobre o banco em
// memória (mesmas regras: uma linha por cobrança, mudança de situação por UPDATE condicional).
vi.mock("./db.js", async orig => {
  const real = await orig<typeof import("./db.js")>();
  const { and, eq } = await import("drizzle-orm");
  const { paymentOrders } = await import("../drizzle/schema.js");
  const getDb = vi.fn();
  const porId = async (id: string) => (await getDb().select().from(paymentOrders).where(eq(paymentOrders.providerPaymentId, id)).limit(1))[0];
  const mudar = async (id: string, de: string, set: Record<string, unknown>) =>
    (await getDb().update(paymentOrders).set({ ...set, updatedAt: new Date() }).where(and(eq(paymentOrders.providerPaymentId, id), eq(paymentOrders.status, de as never))).returning())[0] ?? null;
  return {
    ...real, getDb,
    getPaymentOrderByProviderId: porId,
    createPaymentOrder: async (o: Record<string, unknown>) => (await getDb().insert(paymentOrders).values(o).onConflictDoNothing().returning())[0] ?? porId(String(o.providerPaymentId)),
    claimPendingPaymentOrder: (id: string) => mudar(id, "pending", { status: "settled", settledAt: new Date() }),
    demoteSettledOrderToReview: (id: string, reviewReason: string) => mudar(id, "settled", { status: "review_required", reviewReason }),
    claimSettledPaymentOrderForChargeback: (id: string) => mudar(id, "settled", { status: "chargeback" }),
    markPaymentOrderReview: (id: string, reviewReason: string) => mudar(id, "chargeback", { status: "review_required", reviewReason }),
  };
});
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste", anthropicApiKey: "" } }));

import * as schema from "../drizzle/schema.js";
import { alturaDoRelevo, areaPoligono, assinaturaDoContorno, modeloSchema, muroDaMaquete, podePublicar, publicadoSemMuro, resumoModelo, validarModelo, type ModeloMaquete } from "../shared/maquete-3d/modelo.js";
import { geometriaDoMuro, pontosDosPortoes, portoesAutomaticos } from "../shared/maquete-3d/muro.js";
import { maquetes3d } from "../drizzle/schema-maquete-3d.js";
import { eq } from "drizzle-orm";
import { PRECOS_PADRAO, faixaPorArea, lerConfig } from "../shared/maquete-3d/regras.js";
import { normalizePermissions } from "../shared/admin-permissions.js";
import { getDb } from "./db.js";
import { definirDependencias, type PedidoIA } from "./maquete-3d/base.js";
import { montarModelo, passosDoInventario } from "./maquete-3d/leitura.js";
import { appRouter } from "./routers.js";
import { comModeloDaTela } from "./fixtures/maquete-3d/confirmacao-da-tela.js";

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

/** Um passo da leitura; se ele parar na confirmação do custo da IA, o admin confirma e o passo é repetido. */
async function avancarIA(id: number) {
  const m = comModeloDaTela(appRouter.createCaller({ user: { id: 1, role: "admin", permissions: "[]", active: true, name: "x" }, req: {}, res: {} } as never).maquete3d);
  const r = await m.avancarLeitura({ id });
  if (r.aguardando?.motivo !== "confirmacao") return r;
  await m.confirmarIA({ id });
  return m.avancarLeitura({ id });
}

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

const TABELAS = ["users", "leads", "leadServices", "operationalProjects", "projectRevisionRequests", "projectDocuments", "incorporationStudies", "incorporationRegistrationDocuments", "incorporationUnits", "paymentOrders", "draws", "products"];
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
  for (const arquivo of ["0111_maquete_3d.sql", "0112_maquete_3d_comercial.sql", "0113_maquete_3d_pagamento.sql", "0114_maquete_3d_email.sql", "0115_maquete_3d_lead_arquivos.sql", "0121_maquete_3d_revisoes.sql"]) {
    const migracao = readFileSync(new URL(`../drizzle/${arquivo}`, import.meta.url), "utf8");
    await pg.exec(migracao);
    await pg.exec(migracao); // idempotente
  }
  return { pg, db: drizzle(pg) };
}

let banco: Awaited<ReturnType<typeof criarBanco>>;
let pedidos: PedidoIA[];
let respostas: (unknown | Error)[];

const caller = (id: number, role: string, permissions = "[]") => appRouter.createCaller({ user: { id, role, permissions, active: true, name: "x" }, req: {}, res: {} } as never);
const admin = () => comModeloDaTela(caller(1, "admin").maquete3d); // a confirmação leva o modelo que a tela mostrou
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
    // Os testes deste arquivo cobrem a leitura pela IA (simulada); o leitor próprio, que é o padrão, tem os seus abaixo.
    await banco.pg.exec(`INSERT INTO maquete_3d_config (id, dados) VALUES (1, '{"motor":"ia"}') ON CONFLICT (id) DO UPDATE SET dados = EXCLUDED.dados`);
    pedidos = [];
    respostas = [];
    definirDependencias({
      agora: () => new Date("2026-11-14T13:00:00Z"),
      lerPdf: async d => Buffer.from(`pdf:${d.nome}`),
      // Chave falsa, injetada: o motor "IA em tudo" também espera a confirmação do admin antes de cada lote de chamadas.
      credencialIA: async () => ({ apiKey: "sk-ant-teste-0000", modelo: null, origem: "painel" as const }),
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
    // Motor "IA em tudo": a primeira chamada já espera a confirmação do admin (cadastrar a chave não liga gasto).
    expect(await m.avancarLeitura({ id })).toMatchObject({ feitos: 0, aguardando: { motivo: "confirmacao", pendentes: 1 } });
    expect(pedidos).toHaveLength(0);
    expect(await avancarIA(id)).toMatchObject({ total: 6, feitos: 1, erro: null });
    expect(await avancarIA(id)).toMatchObject({ feitos: 2, erro: null });
    expect(await avancarIA(id)).toMatchObject({ feitos: 2, erro: "fora do ar", status: "em_leitura" });
    expect(await avancarIA(id)).toMatchObject({ feitos: 3, erro: null });
    await avancarIA(id);
    await avancarIA(id);
    expect(await avancarIA(id)).toMatchObject({ feitos: 6, proximo: null, status: "em_revisao" });

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
    expect((await m.detalhe({ id })).pranchas).toEqual([{ pavimentoId: "ed1-pv1", doc: 0, pagina: 1, alinhamento: null }, { pavimentoId: "ed1-pv2", doc: 0, pagina: 2, alinhamento: null }]);
    expect(await m.pdfParte({ id, doc: 0, parte: 0 })).toEqual({ partes: 1, nome: "planta.pdf", base64: Buffer.from("pdf:planta.pdf").toString("base64") });
    await expect(m.pdfParte({ id, doc: 1, parte: 0 })).rejects.toThrow("Arquivo não encontrado");
  });

  it("publicação: só admin, só planta validada; o link público só abre maquete publicada", async () => {
    const m = colaborador();
    const { id } = await m.criar({ origem: "projeto", alvoId: 1, tipo: "casa", faixaPreco: "acima_150_ou_sobrado", documentos: [docProjeto] });
    await admin().liberar({ id, nota: "PIX recebido" });
    await m.iniciarLeitura({ id });
    respostas.push(INVENTARIO, ESTRUTURA, AMBIENTES_TERREO, ESTRUTURA, AMBIENTES_SUPERIOR);
    for (let i = 0; i < 6; i++) await avancarIA(id);
    const d = await m.detalhe({ id });
    const publico = appRouter.createCaller({ user: null, req: {}, res: {} } as never).maquetePublica;
    await expect(publico.porToken({ token: d.token })).rejects.toThrow("não encontrada");
    await expect(admin().publicar({ id })).rejects.toThrow("precisa estar validada");
    d.modelo!.pendencias[0].resolvida = true;
    await m.salvarModelo({ id, versao: d.modeloVersao, modelo: d.modelo! });
    await expect(admin().publicar({ id })).rejects.toThrow("Só uma planta validada");
    await m.validar({ id });
    await expect(m.publicar({ id })).rejects.toThrow("Só o administrador");
    await m.salvarComercial({ id, comercial: { nome: "Residencial Jardim", localizacao: "Imperatriz — MA", preco: null, whatsapp: "5599988887777" } });
    await expect(m.salvarComercial({ id, comercial: { nome: "x", localizacao: "", preco: null, whatsapp: "(99) 9" } })).rejects.toThrow();
    expect(await admin().publicar({ id })).toEqual({ token: d.token, email: { enviado: false, para: null, motivo: "O cliente não tem e-mail no cadastro." } });
    const aberto = await publico.porToken({ token: d.token });
    expect(aberto).toMatchObject({ titulo: "Residencial Jardim", tipo: "casa", comercial: { localizacao: "Imperatriz — MA", preco: null, whatsapp: "5599988887777" } });
    expect(aberto.modelo.edificacoes[0].pavimentos).toHaveLength(2);
    expect(Object.keys(aberto).sort()).toEqual(["comercial", "modelo", "tipo", "titulo", "unidades"]); // nada de preço do pedido, cliente ou documentos
    // Publicada não é mais editável na revisão; tirar do ar devolve para validada e fecha o link.
    await expect(m.salvarModelo({ id, versao: d.modeloVersao + 1, modelo: d.modelo! })).rejects.toThrow("não está em revisão");
    await expect(m.despublicar({ id })).rejects.toThrow("Só o administrador");
    await admin().despublicar({ id });
    await expect(publico.porToken({ token: d.token })).rejects.toThrow("não encontrada");
    expect((await m.detalhe({ id })).status).toBe("validada");
  });

  it("venda pelo portal: cliente pede, admin aprova, cliente paga pelo Asaas e o webhook libera (uma vez só)", async () => {
    await banco.pg.exec(`INSERT INTO leads (name, phone, email) VALUES ('Ana Silva', '99999', 'lead@exemplo.com'), ('Outro', '88888', null);
      UPDATE operational_projects SET lead_id = 1 WHERE id = 1;
      INSERT INTO users ("openId", name, role, active, lead_id, cpf, email) VALUES ('cli', 'Ana Silva', 'cliente', true, 1, '12345678909', 'ana@exemplo.com'), ('cli2', 'Outro', 'cliente', true, 2, null, null);`);
    const cobrancas: { valor: number; referencia: string; metodo: string }[] = [];
    const emails: { para: string; assunto: string; html: string; motivo: string }[] = [];
    definirDependencias({
      cobrador: {
        criar: async p => { cobrancas.push(p); return { id: `pay_${cobrancas.length}`, link: "https://asaas.test/i/1", pixImagem: "img", pixCopiaCola: "000201" }; },
        consultar: async id => ({ id, link: "https://asaas.test/i/1", pixImagem: "img", pixCopiaCola: "000201" }),
      },
      carteiro: async e => { emails.push(e); return true; },
    });
    const cliente = (id: number, leadId: number) => appRouter.createCaller({ user: { id, role: "cliente", permissions: "[]", active: true, name: "Ana Silva", leadId, cpf: "12345678909", email: "ana@exemplo.com" }, req: {}, res: {} } as never).portalMaquete;
    const ana = cliente(4, 1);

    // Só vê os próprios projetos; o colaborador não entra no portal do cliente.
    expect((await ana.resumo()).projetos).toMatchObject([{ id: 1, nome: "Casa Silva", temPdf: true, maquete: null }]);
    expect((await ana.resumo()).precos.map(p => p.preco)).toEqual([197, 297, 497]);
    expect((await cliente(5, 2).resumo()).projetos).toEqual([]);
    await expect(cliente(5, 2).solicitar({ projectId: 1, faixaPreco: "terrea_ate_70" })).rejects.toThrow("Projeto não encontrado");
    await expect(caller(2, "colaborador", JSON.stringify(["maquete3d"])).portalMaquete.resumo()).rejects.toThrow("Acesso negado");

    // 1. Pedido: vai para aprovação, sem cobrança. Pedir de novo não duplica.
    const pedido = await ana.solicitar({ projectId: 1, faixaPreco: "terrea_ate_70" });
    const id = pedido.maquete.id;
    expect(pedido.maquete).toMatchObject({ status: "aguardando_aprovacao", preco: 197, link: null });
    expect((await ana.solicitar({ projectId: 1, faixaPreco: "acima_150_ou_sobrado" })).maquete.id).toBe(id);
    await expect(ana.pagar({ id })).rejects.toThrow("ainda está em aprovação");
    await expect(cliente(5, 2).pagar({ id })).rejects.toThrow("Pedido não encontrado");
    expect(cobrancas).toHaveLength(0);

    // 2. Aprovação: só admin; ele corrige a faixa (a casa é maior) e o cliente é avisado por e-mail.
    await expect(colaborador().aprovarPedido({ id, faixaPreco: "terrea_70_150" })).rejects.toThrow("Só o administrador");
    expect(await admin().aprovarPedido({ id, faixaPreco: "terrea_70_150" })).toEqual({ preco: 297, email: { enviado: true, para: "ana@exemplo.com" } });
    await expect(admin().aprovarPedido({ id, faixaPreco: "terrea_70_150" })).rejects.toThrow("não está aguardando aprovação");
    expect(emails[0]).toMatchObject({ para: "ana@exemplo.com", motivo: "aprovado" });
    expect(emails[0].html).toContain("R$&nbsp;297,00".replace("&nbsp;", "\u00a0"));
    expect(emails[0].html).toContain("https://prospectaconstrucoes.com/portal/maquete-3d");
    expect((await admin().detalhe({ id })).emailCliente).toBe("ana@exemplo.com");

    // 3. Pagamento: a cobrança sai no valor aprovado; reabrir não cria outra.
    expect((await ana.pagar({ id })).cobranca).toMatchObject({ id: "pay_1", pixCopiaCola: "000201" });
    await ana.pagar({ id, metodo: "boleto" });
    expect(cobrancas).toMatchObject([{ valor: 297, referencia: `maquete_3d_${id}`, metodo: "pix" }]);
    expect(await banco.pg.query(`SELECT purpose, principal_amount, status FROM payment_orders`).then(r => r.rows)).toEqual([{ purpose: "maquete_3d", principal_amount: 29700, status: "pending" }]);

    // 4. Webhook do Asaas: libera; reentrega não repete; o admin vê pago e com o PDF já escolhido.
    const { settlePaymentOrder, chargebackPaymentOrder } = await import("./payment-settlement.js");
    expect(await settlePaymentOrder("pay_1")).toMatchObject({ outcome: "maquete_liberada" });
    expect(await settlePaymentOrder("pay_1")).toEqual({ outcome: "already_processed" });
    expect(await admin().detalhe({ id })).toMatchObject({ status: "liberada", liberacaoNota: "Pagamento confirmado pelo Asaas", documentos: [docProjeto] });
    expect((await ana.resumo()).projetos[0].maquete).toMatchObject({ status: "liberada", link: null });
    await expect(ana.pagar({ id })).rejects.toThrow("não está aguardando pagamento");

    // 5. Produção, validação e publicação: o link segue por e-mail na hora e só então aparece no portal.
    await admin().iniciarLeitura({ id });
    respostas.push(INVENTARIO, ESTRUTURA, AMBIENTES_TERREO, ESTRUTURA, AMBIENTES_SUPERIOR);
    for (let i = 0; i < 6; i++) await avancarIA(id);
    const d = await admin().detalhe({ id });
    d.modelo!.pendencias[0].resolvida = true;
    await admin().salvarModelo({ id, versao: d.modeloVersao, modelo: d.modelo! });
    await admin().validar({ id });
    expect((await admin().publicar({ id })).email).toEqual({ enviado: true, para: "ana@exemplo.com" });
    expect(emails[1]).toMatchObject({ para: "ana@exemplo.com", motivo: "pronta" });
    expect(emails[1].html).toContain(`https://prospectaconstrucoes.com/maquete/${d.token}`);
    expect((await ana.resumo()).projetos[0].maquete!.link).toBe(`/maquete/${d.token}`);
    expect(await admin().reenviarEmail({ id })).toEqual({ enviado: true, para: "ana@exemplo.com" });
    expect(emails).toHaveLength(3);

    expect(await chargebackPaymentOrder("pay_1")).toMatchObject({ outcome: "review_required" });
    expect(await banco.pg.query(`SELECT status, review_reason FROM payment_orders`).then(r => r.rows[0])).toMatchObject({ status: "review_required", review_reason: expect.stringContaining("chargeback de maquete 3D") });
  });

  it("venda: sem PDF não há pedido; recusado antes de pagar não gera cobrança; e-mail: cai no cadastro do projeto, avisa quando falta ou falha", async () => {
    await banco.pg.exec(`INSERT INTO leads (name, phone, email) VALUES ('Ana', '9', 'lead@exemplo.com'); UPDATE operational_projects SET lead_id = 1; UPDATE project_documents SET status = 'replaced';
      INSERT INTO users ("openId", name, role, active, lead_id) VALUES ('cli', 'Ana', 'cliente', true, 1);`);
    let criadas = 0; const emails: string[] = []; let aceitar = true;
    definirDependencias({
      cobrador: { criar: async () => ({ id: `pay_${++criadas}`, link: null, pixImagem: null, pixCopiaCola: null }), consultar: async id => ({ id, link: null, pixImagem: null, pixCopiaCola: null }) },
      carteiro: async e => { emails.push(e.para); return aceitar; },
    });
    const ana = appRouter.createCaller({ user: { id: 4, role: "cliente", permissions: "[]", active: true, name: "Ana", leadId: 1 }, req: {}, res: {} } as never).portalMaquete;
    await expect(ana.solicitar({ projectId: 1, faixaPreco: "terrea_ate_70" })).rejects.toThrow("ainda não tem o PDF");
    await banco.pg.exec(`UPDATE project_documents SET status = 'active' WHERE id = 1`);
    const { maquete } = await ana.solicitar({ projectId: 1, faixaPreco: "terrea_ate_70" });
    // A cliente não tem e-mail no usuário: o aviso vai para o e-mail do cadastro (lead) do projeto.
    expect((await admin().aprovarPedido({ id: maquete.id, faixaPreco: "terrea_ate_70" })).email).toEqual({ enviado: true, para: "lead@exemplo.com" });
    await admin().recusar({ id: maquete.id, motivo: "PDF ilegível" });
    await expect(ana.pagar({ id: maquete.id })).rejects.toThrow("não está aguardando pagamento");
    expect(criadas).toBe(0);
    expect((await ana.resumo()).projetos[0].maquete).toMatchObject({ status: "recusada", recusaMotivo: "PDF ilegível" });

    // Servidor de e-mail recusando e cadastro sem e-mail: a aprovação acontece e a tela fica sabendo.
    const outro = await ana.solicitar({ projectId: 1, faixaPreco: "terrea_ate_70" });
    aceitar = false;
    expect((await admin().aprovarPedido({ id: outro.maquete.id, faixaPreco: "terrea_ate_70" })).email).toMatchObject({ enviado: false, para: "lead@exemplo.com" });
    await banco.pg.exec(`UPDATE leads SET email = NULL`);
    expect((await admin().detalhe({ id: outro.maquete.id })).emailCliente).toBeNull();
    // Pagamento de pedido recusado depois de gerada a cobrança vai para conferência.
    await ana.pagar({ id: outro.maquete.id });
    await admin().recusar({ id: outro.maquete.id, motivo: "Cliente desistiu" });
    const { settlePaymentOrder } = await import("./payment-settlement.js");
    expect(await settlePaymentOrder("pay_1")).toMatchObject({ outcome: "review_required" });
  });

  it("incorporação: implantação montada do estudo (terreno, ruas, lotes) com a situação das unidades", async () => {
    // Terreno de ~111 × 110 m perto do equador; dois lotes vendáveis, uma área pública e uma rua.
    const g = 0.001, anel = (x0: number, y0: number, x1: number, y1: number) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
    const cenario = { id: "c1", lotes: [
      { anel: anel(0, 0, g / 2, g / 2), areaM2: 3000, tipo: "vendavel", quadra: "1", numero: "1" },
      { anel: anel(g / 2, 0, g, g / 2), areaM2: 3000, tipo: "vendavel", quadra: "1", numero: "2" },
      { anel: anel(0, g / 2, g / 4, g), areaM2: 1500, tipo: "area_publica", uso: "verde" },
      { anel: [[0, 0], [0, 0]], areaM2: 1, tipo: "vendavel", quadra: "9", numero: "9" },
    ], ruas: [anel(g / 4, g / 2, g, g * 0.6)], vias: [] };
    await banco.pg.query(`UPDATE incorporation_studies SET geojson = $1, latitude = 0.0005, longitude = 0.0005, mass_scenarios_json = $2, selected_scenario_id = 'c1' WHERE id = 1`,
      [JSON.stringify({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [anel(0, 0, g, g)] } }), JSON.stringify({ params: {}, cenarios: [cenario] })]);
    await banco.pg.exec(`INSERT INTO incorporation_units (study_id, code, code_key, kind, status) VALUES (1, 'Q1 / L1', 'Q1 / L1', 'lote', 'vendida'), (1, 'Q1 / L2', 'Q1 / L2', 'lote', 'disponivel')`);

    const { id } = await colaborador().criar({ origem: "incorporacao", alvoId: 1, tipo: "loteamento", documentos: [] });
    await expect(colaborador().implantacaoDoEstudo({ id })).rejects.toThrow("precisa estar autorizada");
    await admin().liberar({ id });
    expect(await colaborador().implantacaoDoEstudo({ id })).toEqual({ lotes: 3, ruas: 1, temTerreno: true, temRelevo: false, descartados: 1, semCenario: false, areas: 1, portoesReposicionados: false });

    const d = await colaborador().detalhe({ id });
    const imp = d.modelo!.implantacao!;
    expect(d.status).toBe("em_revisao");
    expect(imp.lotes.map(l => [l.quadra, l.nome, l.tipo, l.unidade])).toEqual([["1", "1", "vendavel", "Q1 / L1"], ["1", "2", "vendavel", "Q1 / L2"], ["", "", "area_publica", null]]);
    // Norte para cima: o lote 1 (sul-oeste no mapa) fica embaixo à esquerda na planta; medidas em metros.
    expect(imp.terreno).toHaveLength(4);
    expect(Math.max(...imp.terreno.map(p => p.x))).toBeCloseTo(111.32, 0);
    expect(Math.max(...imp.terreno.map(p => p.y))).toBeCloseTo(110.54, 0);
    expect(Math.min(...imp.lotes[0].poligono.map(p => p.y))).toBeCloseTo(55.27, 0);
    expect(d.unidades).toEqual(expect.arrayContaining([{ codigo: "Q1 / L1", status: "vendida" }, { codigo: "Q1 / L2", status: "disponivel" }]));
    expect(d.problemas.filter(p => p.nivel === "erro")).toEqual([]);

    // Topografia do estudo: rampa de 10 m subindo de oeste (100 m) para leste (110 m); a maquete acompanha.
    await banco.pg.query(`UPDATE incorporation_studies SET elevation_json = $1 WHERE id = 1`, [JSON.stringify({
      ncols: 3, nrows: 3, cellsizeX: g / 2, cellsizeY: g / 2, west: 0, south: 0, min: 100, max: 110, z: [[100, 105, 110], [100, 105, 110], [100, 105, 110]] })]);
    // Uma construção posicionada à mão é mantida ao atualizar a implantação pelo estudo.
    const comCasa = (await colaborador().detalhe({ id })).modelo!;
    comCasa.edificacoes = [{ id: "ed1", nome: "Casa-tipo", pavimentos: [], cobertura: { tipo: "laje", inclinacao: 0, beiral: 0, origem: "estimada" } }];
    comCasa.implantacao!.posicoes = [{ id: "i1", edificacaoId: "ed1", nome: "Casa 1", x: 10, y: 60, rotacao: 90, unidade: null }];
    await colaborador().salvarModelo({ id, versao: d.modeloVersao, modelo: comCasa });
    expect(await colaborador().implantacaoDoEstudo({ id })).toMatchObject({ temRelevo: true });
    const relevado = (await colaborador().detalhe({ id })).modelo!;
    const rel = relevado.implantacao!.relevo!;
    expect(relevado.implantacao!.posicoes).toHaveLength(1);
    expect(rel.altitudeBase).toBeCloseTo(100, 0);
    expect(alturaDoRelevo(rel, 0, 50)).toBeCloseTo(0, 0);
    expect(alturaDoRelevo(rel, 55.66, 50)).toBeCloseTo(5, 0);
    expect(alturaDoRelevo(rel, 111.32, 50)).toBeCloseTo(10, 0);
    expect(alturaDoRelevo(rel, 55.66, 10)).toBeCloseTo(alturaDoRelevo(rel, 55.66, 100), 1); // não varia de norte a sul
    expect(alturaDoRelevo(null, 1, 1)).toBe(0);
    relevado.edificacoes = []; relevado.implantacao!.posicoes = [];
    await colaborador().salvarModelo({ id, versao: (await colaborador().detalhe({ id })).modeloVersao, modelo: relevado });

    // Loteamento não precisa de PDF: valida, publica e o link público leva a situação das unidades (sem comprador nem preço).
    await colaborador().validar({ id });
    await admin().publicar({ id });
    const aberto = await appRouter.createCaller({ user: null, req: {}, res: {} } as never).maquetePublica.porToken({ token: d.token });
    expect(aberto.modelo.implantacao!.lotes).toHaveLength(3);
    expect(aberto.unidades).toHaveLength(2);
    expect(Object.keys(aberto.unidades[0]).sort()).toEqual(["codigo", "status"]);
  });

  it("muro do condomínio (S-04): KML com duas áreas, portões editados reposicionados, e o link publicado antes do muro não muda sem revisão", async () => {
    const g = 0.001, anel = (x0: number, y0: number, x1: number, y1: number) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
    // Duas áreas separadas no KML: a maior (A, ~111 × 111 m) e outra menor a leste (B), cada uma com um lote.
    const kml = (b: number[][]) => JSON.stringify({ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: [[anel(0, 0, g, g)], [b]] } });
    const cenario = { id: "c1", lotes: [
      { anel: anel(g * 0.1, g * 0.1, g * 0.4, g * 0.4), areaM2: 1100, tipo: "vendavel", quadra: "1", numero: "1" },
      { anel: anel(g * 1.6, g * 0.1, g * 1.9, g * 0.4), areaM2: 1100, tipo: "vendavel", quadra: "2", numero: "1" },
    ], ruas: [], vias: [] };
    await banco.pg.query(`UPDATE incorporation_studies SET geojson = $1, latitude = 0.0005, longitude = 0.0005, mass_scenarios_json = $2, selected_scenario_id = 'c1' WHERE id = 1`,
      [kml(anel(g * 1.5, 0, g * 2, g / 2)), JSON.stringify({ params: {}, cenarios: [cenario] })]);
    const { id } = await admin().criar({ origem: "incorporacao", alvoId: 1, tipo: "condominio", documentos: [] });
    await admin().liberar({ id });
    expect(await admin().implantacaoDoEstudo({ id })).toMatchObject({ areas: 2, portoesReposicionados: false });
    let d = await admin().detalhe({ id });
    const imp = d.modelo!.implantacao!;
    expect(imp.terrenosExtras).toHaveLength(1);
    expect(imp.muro?.ativo).toBe(true);
    const geo = geometriaDoMuro(imp, imp.muro!)!;
    // Um muro em cada área, cada uma com o seu portão (sem ruas: no ponto da divisa mais perto do lote dela).
    expect(geo.resumo.areas.map(a => a.indice)).toEqual([0, 1]);
    expect(geo.resumo.aberturas.map(a => [a.area, a.principal])).toEqual([[0, true], [1, true]]);

    // A pessoa edita os portões; depois o KML muda (a área B anda 20 m para leste) e a implantação é atualizada.
    const pontosAntes = pontosDosPortoes(imp, portoesAutomaticos(imp).portoes);
    const editado = { ...d.modelo!, implantacao: { ...imp, muro: { ...imp.muro!, editado: true, portoesEditados: true, portoes: portoesAutomaticos(imp).portoes, contorno: assinaturaDoContorno(imp) } } };
    await admin().salvarModelo({ id, versao: d.modeloVersao, modelo: editado });
    await banco.pg.query(`UPDATE incorporation_studies SET geojson = $1 WHERE id = 1`, [kml(anel(g * 1.68, 0, g * 2.18, g / 2))]);
    expect(await admin().implantacaoDoEstudo({ id })).toMatchObject({ areas: 2, portoesReposicionados: true });
    d = await admin().detalhe({ id });
    const novo = d.modelo!.implantacao!;
    expect(novo.muro?.reancorado).toBe(true);
    expect(novo.muro?.contorno).toBe(assinaturaDoContorno(novo));
    const pontosDepois = pontosDosPortoes(novo, novo.muro!.portoes);
    expect(novo.muro!.portoes.map(p => p.area ?? 0)).toEqual([0, 1]);
    // O portão da área A não andou; o da área B foi para o ponto da nova divisa mais perto de onde estava.
    expect(Math.hypot(pontosDepois[0]!.x - pontosAntes[0]!.x, pontosDepois[0]!.y - pontosAntes[0]!.y)).toBeLessThan(0.05);
    expect(Math.hypot(pontosDepois[1]!.x - pontosAntes[1]!.x, pontosDepois[1]!.y - pontosAntes[1]!.y)).toBeLessThan(21);
    expect(d.problemas.some(p => p.onde === "Muro" && /foram levados ao ponto da nova divisa/.test(p.mensagem))).toBe(true);

    // Condomínio publicado ANTES do muro (modelo salvo sem `muro`): o link continua sem muro; a tela avisa.
    const antigo = { ...d.modelo!, implantacao: { ...novo, muro: undefined, terrenosExtras: undefined } };
    await banco.db.update(maquetes3d).set({ modelo: JSON.stringify(antigo), status: "publicada", publicadoEm: new Date() }).where(eq(maquetes3d.id, id));
    const publico = appRouter.createCaller({ user: null, req: {}, res: {} } as never).maquetePublica;
    const aberto = await publico.porToken({ token: d.token });
    expect(aberto.modelo.implantacao!.muro?.ativo).toBe(false);
    expect(muroDaMaquete(aberto.modelo)).toBeNull();
    const naTela = (await admin().detalhe({ id })).modelo!;
    expect(publicadoSemMuro(naTela)).toBe(true);
    expect(muroDaMaquete(naTela)?.ativo).toBe(true); // na revisão o padrão automático aparece
    // Lote da área B fora do único contorno salvo: aviso para atualizar a implantação.
    expect(validarModelo(naTela).some(p => /fora do contorno do terreno/.test(p.mensagem))).toBe(true);

    // Revisto e salvo: o muro passa a ser gravado no modelo.
    await admin().despublicar({ id });
    await banco.db.update(maquetes3d).set({ status: "em_revisao" }).where(eq(maquetes3d.id, id));
    const v = (await admin().detalhe({ id })).modeloVersao;
    await admin().salvarModelo({ id, versao: v, modelo: naTela });
    const salvo = (await admin().detalhe({ id })).modelo!;
    expect(salvo.implantacao!.muro?.ativo).toBe(true);
    expect(publicadoSemMuro(salvo)).toBe(false);
  });

  it("incorporação: sem terreno nem estudo de massa, avisa em vez de criar implantação vazia; projeto não aceita", async () => {
    const { id } = await admin().criar({ origem: "incorporacao", alvoId: 1, tipo: "loteamento", documentos: [] });
    await admin().liberar({ id });
    await expect(admin().implantacaoDoEstudo({ id })).rejects.toThrow("ainda não tem o terreno");
    const p = await admin().criar({ origem: "projeto", alvoId: 1, tipo: "casa", faixaPreco: "terrea_ate_70", documentos: [] });
    await expect(admin().implantacaoDoEstudo({ id: p.id })).rejects.toThrow("Só maquetes de Incorporação");
  });

  it("inventário sem planta baixa para com mensagem clara", async () => {
    const { id } = await admin().criar({ origem: "projeto", alvoId: 1, tipo: "casa", faixaPreco: "terrea_ate_70", documentos: [docProjeto] });
    await admin().liberar({ id, nota: "PIX recebido" });
    await admin().iniciarLeitura({ id });
    respostas.push({ pranchas: [], edificacoes: [], implantacao: null, pendencias: [] });
    expect((await avancarIA(id)).erro).toMatch(/Nenhuma planta baixa/);
  });

  it("sem chave da IA o passo para (aguardando a chave) com aviso e nada é inventado", async () => {
    definirDependencias();
    definirDependencias({ lerPdf: async () => Buffer.from("x") });
    const { id } = await admin().criar({ origem: "projeto", alvoId: 1, tipo: "casa", faixaPreco: "terrea_ate_70", documentos: [docProjeto] });
    await admin().liberar({ id, nota: "PIX recebido" });
    await admin().iniciarLeitura({ id });
    const r = await admin().avancarLeitura({ id });
    expect(r).toMatchObject({ erro: null, aguardando: { motivo: "chave" } });
    expect(r.aguardando!.mensagem).toMatch(/precisa da chave da IA: cadastre-a em Integrações → Anthropic/);
    expect((await admin().detalhe({ id })).modelo).toBeNull();
  });

  it("EPIC-023: pedido ligado a cliente do CRM (ou projeto, nunca os dois), com PDF avulso, portal e e-mail pelo cadastro", async () => {
    await banco.pg.exec(`INSERT INTO leads (name, phone, email) VALUES ('Bruno Costa', '99888', 'bruno@exemplo.com')`);
    await expect(colaborador().criar({ origem: "projeto", alvoId: 1, leadId: 1, tipo: "casa", faixaPreco: "terrea_ate_70", documentos: [] })).rejects.toThrow("não aos dois");
    await expect(colaborador().criar({ origem: "projeto", tipo: "casa", faixaPreco: "terrea_ate_70", documentos: [] })).rejects.toThrow("projeto ou o cliente");
    await expect(colaborador().criar({ origem: "incorporacao", alvoId: 1, leadId: 1, tipo: "casa", documentos: [] })).rejects.toThrow("ligada ao estudo");
    await expect(colaborador().criar({ origem: "projeto", leadId: 99, tipo: "casa", faixaPreco: "terrea_ate_70", documentos: [] })).rejects.toThrow("Cliente do CRM não encontrado");
    expect((await colaborador().clientes({ busca: "bruno" })).map(c => c.nome)).toEqual(["Bruno Costa"]);

    const { id } = await colaborador().criar({ origem: "projeto", leadId: 1, tipo: "casa", faixaPreco: "terrea_ate_70", documentos: [] });
    expect(await colaborador().detalhe({ id })).toMatchObject({ titulo: "Maquete 3D — Bruno Costa", projectId: null, leadId: 1, status: "aguardando_pagamento", preco: 197, clienteTelefone: "99888", emailCliente: "bruno@exemplo.com", documentos: [], disponiveis: [] });
    expect((await colaborador().listar()).find(m => m.id === id)).toMatchObject({ alvo: "Bruno Costa", porCliente: true, cliente: null });
    // A regra do banco recusa pedido de projeto sem projeto e sem cliente, e com os dois.
    await expect(banco.pg.exec(`UPDATE maquetes_3d SET lead_id = NULL WHERE id = ${id}`)).rejects.toThrow();
    await expect(banco.pg.exec(`UPDATE maquetes_3d SET project_id = 1 WHERE id = ${id}`)).rejects.toThrow();

    // PDF avulso: sobe em partes e é anexado; arquivo que não é PDF é recusado.
    const enviar = async (uploadId: string, nome: string, conteudo: string) => {
      await caller(2, "colaborador", JSON.stringify(["maquete3d"])).documentChunks.part({ uploadId, part: 0, total: 1, scope: `maquete3d:${id}`, fileName: nome, base64: Buffer.from(conteudo).toString("base64") });
      return colaborador().anexarPdf({ id, uploadId, nome });
    };
    await expect(enviar("11111111-1111-4111-8111-111111111111", "planta.pdf", "isto não é pdf")).rejects.toThrow("não é um PDF válido");
    await expect(enviar("22222222-2222-4222-8222-222222222222", "planta.dwg", "%PDF-1.7 x")).rejects.toThrow("Envie um arquivo PDF");
    const anexo = await enviar("33333333-3333-4333-8333-333333333333", "casa-bruno.pdf", "%PDF-1.7 conteúdo");
    expect(anexo.documentos).toEqual([{ fonte: "avulso", id: anexo.id, nome: "casa-bruno.pdf" }]);
    const d = await colaborador().detalhe({ id });
    expect(d.documentos).toEqual(d.disponiveis);
    const { rows } = await banco.pg.query<{ texto: string; tamanho: number }>(`SELECT convert_from(dados, 'UTF8') AS texto, tamanho FROM maquete_3d_arquivos WHERE maquete_id = $1`, [id]);
    expect(rows).toEqual([{ texto: "%PDF-1.7 conteúdo", tamanho: Buffer.byteLength("%PDF-1.7 conteúdo") }]);
    // PDF avulso de outro pedido não entra neste.
    const outro = await colaborador().criar({ origem: "projeto", alvoId: 1, tipo: "casa", faixaPreco: "terrea_ate_70", documentos: [] });
    await expect(colaborador().definirDocumentos({ id: outro.id, documentos: [{ fonte: "avulso", id: anexo.id, nome: "casa-bruno.pdf" }] })).rejects.toThrow("não pertence");
    // Projeto com PDF próprio e avulso com o mesmo número não se confundem.
    await colaborador().definirDocumentos({ id: outro.id, documentos: [docProjeto] });

    // Incorporação também aceita PDF avulso (pedido do dono).
    const inc = await colaborador().criar({ origem: "incorporacao", alvoId: 1, tipo: "casa", documentos: [] });
    await caller(2, "colaborador", JSON.stringify(["maquete3d"])).documentChunks.part({ uploadId: "44444444-4444-4444-8444-444444444444", part: 0, total: 1, scope: `maquete3d:${inc.id}`, fileName: "casa-tipo.pdf", base64: Buffer.from("%PDF-1.4 y").toString("base64") });
    expect((await colaborador().anexarPdf({ id: inc.id, uploadId: "44444444-4444-4444-8444-444444444444", nome: "casa-tipo.pdf" })).documentos).toHaveLength(1);
    expect((await colaborador().detalhe({ id: inc.id })).disponiveis.map(x => x.fonte)).toEqual(["avulso", "incorporacao"]);

    // Portal: o cliente do cadastro vê o pedido sem projeto, paga, e o e-mail de "pronta" vai para o cadastro dele.
    await banco.pg.exec(`INSERT INTO users ("openId", name, role, active, lead_id, email) VALUES ('cli', 'Bruno Costa', 'cliente', true, 1, 'bruno@exemplo.com')`);
    const bruno = appRouter.createCaller({ user: { id: 4, role: "cliente", permissions: "[]", active: true, name: "Bruno Costa", leadId: 1, cpf: "12345678909", email: "bruno@exemplo.com" }, req: {}, res: {} } as never).portalMaquete;
    const resumo = await bruno.resumo();
    expect(resumo.projetos).toEqual([]);
    expect(resumo.avulsas).toMatchObject([{ id, status: "aguardando_pagamento", preco: 197, link: null }]);
    const outroCliente = appRouter.createCaller({ user: { id: 5, role: "cliente", permissions: "[]", active: true, name: "Outro", leadId: 77 }, req: {}, res: {} } as never).portalMaquete;
    expect((await outroCliente.resumo()).avulsas).toEqual([]);
    await expect(outroCliente.pagar({ id, metodo: "pix" })).rejects.toThrow("Pedido não encontrado");
  });

  it("EPIC-023: trocar o tipo redesenha — casa ou prédio padrão em cada lote do estudo, sem PDF e sem IA; loteamento tira as construções", async () => {
    // Terreno de ~111 × 110 m; dois lotes vendáveis de ~55 × 55 m, uma área pública e uma rua entre eles e a área pública.
    const g = 0.001, anel = (x0: number, y0: number, x1: number, y1: number) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
    const cenario = { id: "c1", lotes: [
      { anel: anel(0, 0, g / 2, g / 2), areaM2: 3000, tipo: "vendavel", quadra: "1", numero: "1" },
      { anel: anel(g / 2, 0, g, g / 2), areaM2: 3000, tipo: "vendavel", quadra: "1", numero: "2" },
      { anel: anel(0, g * 0.6, g, g), areaM2: 4000, tipo: "area_publica", uso: "verde" },
    ], ruas: [anel(0, g / 2, g, g * 0.6)], vias: [] };
    await banco.pg.query(`UPDATE incorporation_studies SET geojson = $1, latitude = 0.0005, longitude = 0.0005, mass_scenarios_json = $2, selected_scenario_id = 'c1' WHERE id = 1`,
      [JSON.stringify({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [anel(0, 0, g, g)] } }), JSON.stringify({ params: {}, cenarios: [cenario] })]);
    const { id } = await colaborador().criar({ origem: "incorporacao", alvoId: 1, tipo: "loteamento", documentos: [] });
    const casa = { frente: 8, fundo: 12, quartos: 2, pavimentos: 1 as const, garagem: true };
    await expect(colaborador().aplicarTipo({ id, tipo: "casa", casa })).rejects.toThrow("precisa estar liberada");
    await admin().liberar({ id });
    await expect(colaborador().aplicarTipo({ id, tipo: "casa" })).rejects.toThrow("Informe o tamanho da casa");
    await expect(colaborador().aplicarTipo({ id, tipo: "predio" })).rejects.toThrow("Informe as medidas do prédio");

    // Casa: a implantação é montada do estudo na mesma chamada e cada lote vendável recebe uma casa.
    expect(await colaborador().aplicarTipo({ id, tipo: "casa", casa })).toMatchObject({ construcoes: 2, lotes: 2, semConstrucaoTotal: 0, padrao: "Casa padrão" });
    let d = await colaborador().detalhe({ id });
    expect(d).toMatchObject({ tipo: "casa", status: "em_revisao" });
    expect(d.problemas.filter(p => p.nivel === "erro")).toEqual([]);
    expect(d.modelo!.edificacoes.map(e => e.id)).toEqual(["padrao"]);
    expect(d.modelo!.implantacao!.posicoes.map(p => [p.nome, p.edificacaoId, p.unidade])).toEqual([["Q1 L1", "padrao", "Q1 / L1"], ["Q1 L2", "padrao", "Q1 / L2"]]);
    expect(pedidos).toHaveLength(0); // nenhuma chamada à IA

    // Prédio: troca a construção padrão (não acumula) e redistribui. O estacionamento é calculado com a área do
    // lote (~3.080 m² cada): com 1 vaga por apartamento e pilotis cabem os 6 andares pedidos.
    const comFolga = await colaborador().aplicarTipo({ id, tipo: "predio", predio: { largura: 24, profundidade: 14, andares: 6, aptosPorAndar: 4 } });
    expect(comFolga).toMatchObject({ construcoes: 2, padrao: "Prédio padrão", estacionamento: { andaresPedidos: 6, andares: 6, apartamentos: 24, vagasNecessarias: 24, reduzido: false, vagasPorApto: 1 } });
    expect(comFolga.estacionamento!.vagas.total).toBeGreaterThanOrEqual(24);
    d = await colaborador().detalhe({ id });
    expect(d.tipo).toBe("predio");
    expect(d.modelo!.edificacoes.map(e => e.nome)).toEqual(["Prédio padrão"]);
    expect(d.resumo).toMatchObject({ pavimentos: 7, construcoes: 2 });
    expect(d.modelo!.edificacoes[0].pavimentos[0].comodos.map(c => c.funcao)).toEqual(["garagem", "hall", "garagem"]);

    // Regra do dono: nunca mais apartamentos do que o estacionamento comporta. 40 andares × 12 apartamentos com
    // 3 vagas cada não cabem no lote: o prédio sai com menos andares, e a conta volta para a tela.
    const apertado = await colaborador().aplicarTipo({ id, tipo: "predio", predio: { largura: 30, profundidade: 16, andares: 40, aptosPorAndar: 12, vagasPorApto: 3, pilotis: true, subsolos: 0 } });
    const e = apertado.estacionamento!;
    expect(e).toMatchObject({ andaresPedidos: 40, reduzido: true, inviavel: false, vagasPorApto: 3 });
    expect(e.andares).toBeLessThan(40);
    expect(e.vagasNecessarias).toBeLessThanOrEqual(e.vagas.total);
    expect(e.apartamentos).toBe(e.andares * e.aptosPorAndar);
    expect((await colaborador().detalhe({ id })).modelo!.edificacoes[0].pavimentos[1].repeticoes).toBe(e.andares);

    // Construção grande demais para os lotes: nem chega a gerar.
    await expect(colaborador().aplicarTipo({ id, tipo: "predio", predio: { largura: 60, profundidade: 30, andares: 2, aptosPorAndar: 4 } })).rejects.toThrow("não cabe em nenhum lote");

    // Loteamento: ficam só os lotes; a maquete continua válida e pode ser validada e publicada.
    expect(await colaborador().aplicarTipo({ id, tipo: "loteamento" })).toMatchObject({ construcoes: 0, padrao: null });
    d = await colaborador().detalhe({ id });
    expect(d.modelo!.implantacao!.posicoes).toEqual([]);
    expect(d.modelo!.implantacao!.lotes).toHaveLength(3);
    expect(d.problemas.filter(p => p.nivel === "erro")).toEqual([]);

    // Publicada não troca de tipo.
    await colaborador().aplicarTipo({ id, tipo: "casa", casa });
    await colaborador().validar({ id });
    await admin().publicar({ id });
    await expect(colaborador().aplicarTipo({ id, tipo: "loteamento" })).rejects.toThrow("precisa estar liberada");
  });

  it("EPIC-023: leitor próprio (padrão) lê o sobrado em PDF vetorial sem IA — uma prancha por passo, dois pavimentos e a escada ligada", async () => {
    await banco.pg.exec(`DELETE FROM maquete_3d_config`); // sem configuração gravada e sem chave vale o padrão: leitor próprio
    definirDependencias({ credencialIA: async () => null });
    expect((await admin().config()).motor).toBe("geometrico");
    const pdf = readFileSync(new URL("./fixtures/maquete-3d/sobrado.pdf", import.meta.url));
    definirDependencias({ agora: () => new Date("2026-11-15T13:00:00Z"), lerPdf: async () => pdf, ia: async () => { throw new Error("a IA não pode ser chamada"); } });
    const { id } = await colaborador().criar({ origem: "projeto", alvoId: 1, tipo: "casa", faixaPreco: "acima_150_ou_sobrado", documentos: [docProjeto] });
    await admin().liberar({ id, nota: "PIX recebido em 15/11" });
    expect(await colaborador().iniciarLeitura({ id })).toMatchObject({ total: 1, feitos: 0 });
    // Inventário: um passo por página do PDF, mais a montagem.
    expect(await colaborador().avancarLeitura({ id })).toMatchObject({ total: 4, feitos: 1, erro: null, status: "em_leitura" });
    expect((await colaborador().detalhe({ id })).passos.map(p => p.rotulo)).toEqual(["Inventário das pranchas e dos pavimentos", "Leitura de planta.pdf — página 1", "Leitura de planta.pdf — página 2", "Montagem e conferência do modelo"]);
    await colaborador().avancarLeitura({ id });
    await colaborador().avancarLeitura({ id });
    expect(await colaborador().avancarLeitura({ id })).toMatchObject({ total: 4, feitos: 4, proximo: null, status: "em_revisao", erro: null });

    const d = await colaborador().detalhe({ id });
    expect(d.tokens).toEqual({ entrada: 0, saida: 0 });
    expect(d.escalas).toEqual([{ titulo: "PLANTA BAIXA - TÉRREO", escala: 75, origem: "texto", lidaPor: "geometrico" }, { titulo: "PLANTA BAIXA - PAVIMENTO SUPERIOR", escala: 75, origem: "texto", lidaPor: "geometrico" }]);
    const [e] = d.modelo!.edificacoes;
    expect(e.pavimentos.map(p => [p.nome, p.nivel, p.origemPeDireito])).toEqual([["Térreo", 0, "estimada"], ["Pavimento superior", 2.85, "estimada"]]);
    expect(e.pavimentos[0].escadas).toMatchObject([{ destinoPavimentoId: e.pavimentos[1].id }]);
    expect(e.pavimentos[1].escadas).toEqual([]);
    expect(d.resumo).toMatchObject({ pavimentos: 2, quartos: 3, suites: 1, vagas: 1 });
    expect(d.resumo!.areaTotal).toBeGreaterThan(270);
    expect(d.resumo!.areaTotal).toBeLessThan(290);
    // O que a planta baixa não traz fica como aviso ou pendência para a revisão — nunca é dado como certo.
    expect(d.problemas.filter(p => p.nivel === "erro").map(p => p.mensagem)).toEqual(["Térreo: Escada lida pelos degraus: confira na revisão de que lado ela começa a subir."]);
    expect(d.problemas.some(p => p.nivel === "aviso" && p.mensagem.includes("Pé-direito estimado"))).toBe(true);
    expect(d.problemas.some(p => p.nivel === "aviso" && p.mensagem.includes("Cobertura estimada"))).toBe(true);
    // A prancha entra ao fundo da revisão já alinhada com a planta lida.
    expect(d.pranchas.map(p => [p.pavimentoId, p.doc, p.pagina])).toEqual([[e.pavimentos[0].id, 0, 1], [e.pavimentos[1].id, 0, 2]]);
    expect(d.pranchas[0].alinhamento!.larguraM).toBeGreaterThan(30);
    expect(d.pranchas[0].alinhamento!.x).toBeLessThan(0);
  });

  it("EPIC-023: leitor próprio diz por que não leu (arquivo que não é PDF; prancha sem planta) e a leitura pode ser refeita", async () => {
    await banco.pg.exec(`DELETE FROM maquete_3d_config`);
    const { id } = await colaborador().criar({ origem: "projeto", alvoId: 1, tipo: "casa", faixaPreco: "terrea_ate_70", documentos: [docProjeto] });
    await admin().liberar({ id, nota: "PIX recebido em 15/11" });
    await colaborador().iniciarLeitura({ id });
    // O leitor de teste devolve um texto qualquer: não é PDF.
    expect((await colaborador().avancarLeitura({ id })).erro).toContain("não é um PDF válido");
    // PDF de verdade, mas sem planta baixa (uma página só com uma moldura e um texto).
    const semPlanta = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 842 595]/Contents 4 0 R>>endobj\n4 0 obj<</Length 44>>stream\n10 10 m 800 10 l 800 500 l 10 500 l h S\nendstream\nendobj\ntrailer<</Root 1 0 R>>\n%%EOF");
    definirDependencias({ agora: () => new Date("2026-11-15T13:00:00Z"), lerPdf: async () => semPlanta });
    expect(await colaborador().avancarLeitura({ id })).toMatchObject({ total: 3, feitos: 1, erro: null });
    await colaborador().avancarLeitura({ id });
    const fim = await colaborador().avancarLeitura({ id });
    expect(fim.status).toBe("em_leitura");
    expect(fim.erro).toContain("Nenhuma planta baixa foi reconhecida");
    expect(fim.erro).toContain("não tem desenho vetorial");
    expect((await colaborador().detalhe({ id })).modelo).toBeNull();
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
