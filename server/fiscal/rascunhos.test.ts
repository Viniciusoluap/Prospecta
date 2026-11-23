// EPIC-029 S-2 (22/11/2026) — rascunhos de nota: gerador idempotente, data de corte, status e transições, motivo obrigatório,
// histórico imutável, permissões, relatório fechando com a "Receita realizada", PDF com marca d'água e "Emitir" recusado.
// Banco em memória (PGlite): tabelas de origem geradas do schema Drizzle + migração 0154 aplicada DUAS vezes.
// Nenhum teste chama serviço externo (vigia de fetch).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste" } }));

import * as schema from "../../drizzle/schema.js";
import { getDb } from "../db.js";
import { router } from "../_core/trpc.js";
import { taxRouter } from "../tax-router.js";
import { fiscalRouter } from "./router.js";
import { gerarRascunhos, gerarRascunhosNoCron, ALERTA_ORIGEM_CANCELADA } from "./gerador.js";
import { carregarNota } from "./notas.js";
import { gerarPreviaPdf, MARCA_DAGUA } from "./previa-pdf.js";
import { montarRelatorio, relatorioEmCsv } from "./relatorio-mensal.js";
import { transicaoValida, STATUS_NOTA } from "../../shared/fiscal/status.js";
import { problemaDoMotivo } from "../../shared/fiscal/motivos.js";
import { motivoSugerido, primeiroDiaDoMesEmBrasilia } from "../../shared/fiscal/origens.js";

const TABELAS = [
  "users", "leads", "leadServices", "imoveis", "bpoClients", "bpoLancamentos", "bankAccounts", "bankTransactions", "constructionProjects",
  "obraMovimentos", "regularizacoes", "regularizacaoItensFinanceiros", "regularizacaoRecebimentos", "avaliacoes", "operationalCommissions",
  "financialTransactions", "taxProfiles", "taxObligations", "retProjects",
];
const MIGRACAO = readFileSync(new URL("../../drizzle/0154_fiscal_notas.sql", import.meta.url), "utf8");
// S-4: a 0162 acrescenta a coluna opcional codigo_atividade_simples ao tipo de serviço (lida pelo schema Drizzle).
const MIGRACAO_S7 = readFileSync(new URL("../../drizzle/0167_fiscal_emissao.sql", import.meta.url), "utf8");
const MIGRACAO_S4 = readFileSync(new URL("../../drizzle/0162_fiscal_certificados.sql", import.meta.url), "utf8");
let ddl = "";

beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)("drizzle-kit/api");
  const escolhidas: Record<string, unknown> = {};
  for (const [nome, valor] of Object.entries(schema)) if (TABELAS.includes(nome) || nome.endsWith("Enum")) escolhidas[nome] = valor;
  ddl = (await generateMigration(generateDrizzleJson({}), generateDrizzleJson(escolhidas)) as string[]).join(";\n");
}, 60_000);

let pg: PGlite;
let fetchVigia: ReturnType<typeof vi.spyOn>;
const AGORA = new Date("2026-11-20T15:00:00.000Z");

async function q<T = Record<string, unknown>>(texto: string, params: unknown[] = []): Promise<T[]> {
  return (await pg.query<T>(texto, params)).rows;
}

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(ddl);
  await pg.exec(MIGRACAO);
  await pg.exec(MIGRACAO); // idempotente
  await pg.exec(MIGRACAO_S4);
  await pg.exec(MIGRACAO_S7); // S-7: colunas novas lidas pelo schema Drizzle
  vi.mocked(getDb).mockReturnValue(drizzle(pg) as never);
  fetchVigia = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("rede proibida no teste"); });
  await pg.exec(`
    INSERT INTO users (id, "openId", name, role) VALUES (1, 'admin', 'Dono', 'admin'), (2, 'colab', 'Colaboradora', 'colaborador');
    INSERT INTO fiscal_config (id, ligado, inicio_em) VALUES (true, false, '2026-11-01');
  `);
});

afterEach(async () => {
  expect(fetchVigia).not.toHaveBeenCalled();
  fetchVigia.mockRestore();
  await pg.close();
});

const app = router({ fiscal: fiscalRouter, tax: taxRouter });
const caller = (role: string, permissoes: string[] = [], active = true) =>
  app.createCaller({ user: { id: role === "admin" ? 1 : 2, role, active, permissions: JSON.stringify(permissoes) }, req: { headers: {} }, res: {} } as never);
const admin = () => caller("admin");

let seq = 100;
async function cliente(razao = "Cliente BPO Ltda", cnpj: string | null = "11222333000181", leadId: number | null = null) {
  const [r] = await q<{ id: number }>(`INSERT INTO bpo_clients (razao_social, cnpj, responsavel, telefone, honorarios, data_inicio, lead_id)
    VALUES ($1, $2, 'Resp', '99999999', 100, now(), $3) RETURNING id`, [razao, cnpj, leadId]);
  return r!.id;
}
async function lancamento(o: { tipo?: string; valor?: number; pago?: boolean; pagoEm?: string; clienteId?: number | null; descricao?: string } = {}) {
  const [r] = await q<{ id: number }>(`INSERT INTO bpo_lancamentos (cliente_id, tipo, descricao, valor, vencimento, pago, pago_em, competencia)
    VALUES ($1, $2, $3, $4, now(), $5, $6, '2026-11') RETURNING id`,
  [o.clienteId ?? null, o.tipo ?? "honorario", o.descricao ?? "Honorário mensal", o.valor ?? 1500, o.pago ?? true, o.pagoEm ?? "2026-11-10T12:00:00Z"]);
  return r!.id;
}
async function lead(nome = "Maria Souza", cidade = "Imperatriz", uf = "MA") {
  const [r] = await q<{ id: number }>(`INSERT INTO leads (name, phone, cpf, city, state) VALUES ($1, '99988887777', '12345678909', $2, $3) RETURNING id`, [nome, cidade, uf]);
  return r!.id;
}
async function obra(cidade: string, uf: string, leadId: number | null = null) {
  const [r] = await q<{ id: number }>(`INSERT INTO construction_projects (title, city, state, lead_id) VALUES ('Casa ' || $1::text, $1, $2, $3) RETURNING id`, [cidade, uf, leadId]);
  return r!.id;
}
async function regularizacao(chave: string, valor: number, bpoLancamentoId: number | null = null, leadId: number | null = null) {
  const [g] = await q<{ id: number }>(`INSERT INTO regularizacoes (client_name, type, address, responsible, lead_id) VALUES ('Cliente Reg', 'Averbação', 'Rua 1', 'Equipe', $1) RETURNING id`, [leadId]);
  const [i] = await q<{ id: number }>(`INSERT INTO regularizacao_itens_financeiros (regularizacao_id, chave_padrao, nome, grupo, ordem) VALUES ($1, $2, $3, 'durante_obra', 1) RETURNING id`, [g!.id, chave, chave.toUpperCase()]);
  const [r] = await q<{ id: number }>(`INSERT INTO regularizacao_recebimentos (regularizacao_id, item_id, valor, data, origem, bpo_lancamento_id) VALUES ($1, $2, $3, '2026-11-12', $4, $5) RETURNING id`,
    [g!.id, i!.id, valor, bpoLancamentoId ? "bpo" : "manual", bpoLancamentoId]);
  return r!.id;
}
const notas = () => q<{ id: number; origem_tipo: string; origem_id: number; status: string; motivo_sugerido: string | null; versao: number; alerta: string | null; emissor_id: number | null }>(
  "SELECT * FROM fiscal_notas ORDER BY id");
const total = (r: Awaited<ReturnType<typeof gerarRascunhos>>) => Object.values(r.criados).reduce((a, b) => a + b, 0);

describe("gerador — varredura idempotente", () => {
  it("honorário pago vira UM rascunho A_DECIDIR; rodar 3× não cria outro", async () => {
    const c = await cliente();
    const l = await lancamento({ clienteId: c });
    const db = getDb();
    expect(total(await gerarRascunhos(db, { origem: "botao", agora: AGORA }))).toBe(1);
    expect(total(await gerarRascunhos(db, { origem: "botao", agora: AGORA }))).toBe(0);
    expect(total(await gerarRascunhos(db, { origem: "botao", agora: AGORA }))).toBe(0);
    const n = await notas();
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ origem_tipo: "bpo_lancamento", origem_id: l, status: "A_DECIDIR" });
    // a chave única do banco também segura uma inserção repetida feita por fora do gerador
    await expect(pg.query(`INSERT INTO fiscal_notas (origem_tipo, origem_id, data_evento) VALUES ('bpo_lancamento', $1, '2026-11-10')`, [l])).rejects.toThrow();
  });

  it("não gera de lançamento não pago, de despesa, nem de antes da data de corte; a data de corte é configurável", async () => {
    await lancamento({ pago: false });
    await lancamento({ tipo: "despesa" });
    const antigo = await lancamento({ pagoEm: "2026-10-15T12:00:00Z" });
    const db = getDb();
    expect(total(await gerarRascunhos(db, { origem: "botao", agora: AGORA }))).toBe(0);
    await admin().fiscal.config.salvar({ ligado: false, inicioEm: "2026-10-01" });
    expect(total(await gerarRascunhos(db, { origem: "botao", agora: AGORA }))).toBe(1);
    expect((await notas())[0]!.origem_id).toBe(antigo);
  });

  it("padrão da data de corte = 1º dia do mês corrente em Brasília (gravado na primeira vez)", async () => {
    await pg.exec("TRUNCATE fiscal_config");
    expect(primeiroDiaDoMesEmBrasilia(new Date("2026-12-01T02:00:00Z"))).toBe("2026-11-01"); // ainda 30/11 em Brasília
    const r = await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    expect(r.inicioEm).toBe("2026-11-01");
  });

  it("no cron só roda com o gerador LIGADO; o botão roda sempre", async () => {
    await lancamento();
    expect(await gerarRascunhosNoCron(getDb, 30_000)).toEqual({ desligado: true });
    expect(await notas()).toHaveLength(0);
    await pg.exec("UPDATE fiscal_config SET ligado = true");
    expect(await gerarRascunhosNoCron(getDb, 30_000)).toEqual({ criados: 1, parcial: false });
    expect(await gerarRascunhosNoCron(getDb, 30_000)).toEqual({ criados: 0, parcial: false });
  });

  it("recebimento de regularização ligado a lançamento do BPO gera UMA nota (origem = regularização) — R8", async () => {
    const l = await lancamento({ tipo: "receita", valor: 800 });
    const rr = await regularizacao("despachante", 800, l);
    await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    const n = await notas();
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ origem_tipo: "regularizacao_recebimento", origem_id: rr });
  });

  it("lançamento que já tinha rascunho não ganha outro quando o recebimento do módulo é ligado depois", async () => {
    const l = await lancamento({ tipo: "receita", valor: 500 });
    await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    await regularizacao("despachante", 500, l);
    await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    expect(await notas()).toHaveLength(1);
  });

  it("item ITBI nasce com motivo SUGERIDO 'ITBI repassado' e continua A_DECIDIR", async () => {
    await regularizacao("itbi", 1200);
    await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    const [n] = await notas();
    expect(n).toMatchObject({ status: "A_DECIDIR", motivo_sugerido: "itbi_repassado" });
    expect(motivoSugerido("bpo_lancamento", "reembolso")).toBe("reembolso_custas");
    expect(motivoSugerido("regularizacao_recebimento", "despachante")).toBeNull();
  });

  it("recebimento da Caixa de obra em Parauapebas → município de incidência Parauapebas (não Imperatriz)", async () => {
    const ld = await lead("João", "Imperatriz", "MA");
    const ob = await obra("Parauapebas", "PA", ld);
    await q(`INSERT INTO obra_movimentos (project_id, natureza, descricao, valor, data, origem) VALUES ($1, 'recebimento_cef', 'Parcela 2', 30000, '2026-11-05', 'manual')`, [ob]);
    await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    const [n] = await notas();
    const d = await carregarNota(getDb(), n!.id);
    expect(d.municipio).toMatchObject({ nome: "Parauapebas", uf: "PA", fonte: "obra" });
    expect(d.tomador).toMatchObject({ tipo: "crm", nome: "João" });
    expect(d.valorCentavos).toBe(3_000_000);
  });

  it("avaliação entregue com valor e comissão da EMPRESA paga geram; comissão de corretor não", async () => {
    await q(`INSERT INTO avaliacoes (numero, tipo, finalidade, status, cliente_nome, cliente_tel, endereco, bairro, cidade, estado, avaliador, valor_servico, data_entrega)
      VALUES ('AV-1', 'casa', 'financiamento', 'entregue', 'Fulano', '999', 'Rua', 'Centro', 'Imperatriz', 'MA', 'Eng', 900, '2026-11-08T12:00:00Z')`);
    await q(`INSERT INTO operational_commissions (beneficiary, business_type, property, amount, percent, status, due_date, paid_at)
      VALUES ('empresa', 'correspondente', 'Casa X', 2000, 1, 'paga', now(), '2026-11-09T12:00:00Z'),
             ('corretor', 'venda', 'Casa Y', 900, 1, 'paga', now(), '2026-11-09T12:00:00Z')`);
    await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    expect((await notas()).map(n => n.origem_tipo).sort()).toEqual(["avaliacao", "comissao_empresa"]);
  });

  it("tipo de serviço 'nunca_gerar' não cria; nenhum tipo nasce ativável como 'automático'", async () => {
    await pg.exec(`UPDATE fiscal_tipos_servico SET regra = 'nunca_gerar' WHERE origens ? 'bpo_lancamento:honorario'`);
    await lancamento();
    const r = await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    expect(total(r)).toBe(0);
    expect((await q<{ regra: string }>("SELECT DISTINCT regra FROM fiscal_tipos_servico WHERE regra <> 'nunca_gerar'")).map(x => x.regra)).toEqual(["sempre_perguntar"]);
    await expect(pg.query("UPDATE fiscal_tipos_servico SET regra = 'automatico'")).rejects.toThrow();
    await expect(admin().fiscal.tipos.salvar({ nome: "X", regra: "automatico" as never, origens: [] })).rejects.toThrow();
  });

  it("origem cancelada depois → rascunho volta a A_DECIDIR com alerta (nunca apaga)", async () => {
    const l = await lancamento();
    await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    const [n] = await notas();
    await admin().fiscal.notas.naoEmitir({ id: n!.id, versao: n!.versao, motivo: "servico_nao_faturavel" });
    await pg.query("UPDATE bpo_lancamentos SET pago = false, pago_em = NULL WHERE id = $1", [l]);
    const r = await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    expect(r.alertados).toBe(1);
    const [depois] = await notas();
    expect(depois).toMatchObject({ status: "A_DECIDIR", alerta: ALERTA_ORIGEM_CANCELADA });
    expect((await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA })).alertados).toBe(0);
  });
});

describe("status, motivo e histórico", () => {
  async function umaNota() {
    const c = await cliente();
    await lancamento({ clienteId: c });
    await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    return (await notas())[0]!;
  }

  it("transições: regra pura", () => {
    expect(transicaoValida("A_DECIDIR", "SEM_NOTA")).toBe(true);
    expect(transicaoValida("A_DECIDIR", "ADIADA")).toBe(true);
    expect(transicaoValida("ADIADA", "SEM_NOTA")).toBe(true);
    expect(transicaoValida("SEM_NOTA", "ADIADA")).toBe(false);
    expect(transicaoValida("SEM_NOTA", "A_DECIDIR")).toBe(true);
    expect(transicaoValida("EMITIDA", "CANCELADA")).toBe(true);
    expect(transicaoValida("A_DECIDIR", "CANCELADA")).toBe(false);
    expect(transicaoValida("CANCELADA", "A_DECIDIR")).toBe(false);
    expect(STATUS_NOTA).toHaveLength(7);
  });

  it("'Não emitir' sem motivo é recusado no servidor; 'outro' exige texto", async () => {
    const n = await umaNota();
    const a = admin();
    await expect(a.fiscal.notas.naoEmitir({ id: n.id, versao: n.versao } as never)).rejects.toThrow();
    await expect(a.fiscal.notas.naoEmitir({ id: n.id, versao: n.versao, motivo: "inventado" as never })).rejects.toThrow();
    await expect(a.fiscal.notas.naoEmitir({ id: n.id, versao: n.versao, motivo: "outro" })).rejects.toThrow(/escreva o motivo/);
    await expect(a.fiscal.notas.naoEmitir({ id: n.id, versao: n.versao, motivo: "outro", texto: "  " })).rejects.toThrow(/escreva o motivo/);
    expect(problemaDoMotivo(undefined)).toMatch(/Escolha/);
    const salva = await a.fiscal.notas.naoEmitir({ id: n.id, versao: n.versao, motivo: "outro", texto: "Cortesia ao cliente" });
    expect(salva).toMatchObject({ status: "SEM_NOTA", motivoSemNota: "outro", motivoTexto: "Cortesia ao cliente", decididaPor: 1 });
    // o banco também segura: SEM_NOTA sem motivo, e "outro" sem texto
    await expect(pg.query("UPDATE fiscal_notas SET motivo_sem_nota = NULL WHERE id = $1", [n.id])).rejects.toThrow();
    await expect(pg.query("UPDATE fiscal_notas SET motivo_texto = NULL WHERE id = $1", [n.id])).rejects.toThrow();
  });

  it("transição inválida é recusada; reabrir e decidir de novo funciona; Depois aceita data opcional", async () => {
    const n = await umaNota();
    const a = admin();
    const sem = await a.fiscal.notas.naoEmitir({ id: n.id, versao: n.versao, motivo: "emitida_fora" });
    await expect(a.fiscal.notas.adiar({ id: n.id, versao: sem.versao })).rejects.toThrow(/Não é possível/);
    await expect(a.fiscal.notas.editar({ id: n.id, versao: sem.versao, descricao: "x" })).rejects.toThrow(/Reabra/);
    const aberta = await a.fiscal.notas.reabrir({ id: n.id, versao: sem.versao });
    expect(aberta).toMatchObject({ status: "A_DECIDIR", motivoSemNota: null });
    const adiada = await a.fiscal.notas.adiar({ id: n.id, versao: aberta.versao, ate: "2026-12-05" });
    expect(adiada).toMatchObject({ status: "ADIADA", adiadaAte: "2026-12-05" });
  });

  it("edição concorrente com versão antiga é recusada", async () => {
    const n = await umaNota();
    const a = admin();
    await a.fiscal.notas.editar({ id: n.id, versao: n.versao, descricao: "Primeira" });
    await expect(a.fiscal.notas.editar({ id: n.id, versao: n.versao, descricao: "Segunda" })).rejects.toThrow(/outra pessoa/);
  });

  it("toda mudança grava histórico (quem, o quê, quando); histórico e nota não se apagam", async () => {
    const n = await umaNota();
    const a = admin();
    const e = await a.fiscal.notas.editar({ id: n.id, versao: n.versao, valorCentavos: 120_000, descricao: "Honorário de novembro" });
    await a.fiscal.notas.naoEmitir({ id: n.id, versao: e.versao, motivo: "reembolso_custas" });
    const h = await a.fiscal.notas.historico({ id: n.id });
    expect(h.map(x => x.acao)).toEqual(["criada", "editada", "sem_nota"]);
    expect(h[0]).toMatchObject({ via: "sistema", usuarioId: null });
    expect(h[1]).toMatchObject({ via: "tela", usuarioId: 1, usuarioNome: "Dono" });
    expect(h[1]!.mudancas).toEqual(expect.arrayContaining([
      { campo: "valor_ajustado_centavos", antes: null, depois: 120000 },
      { campo: "descricao_ajustada", antes: null, depois: "Honorário de novembro" },
    ]));
    expect(h[2]!.mudancas).toEqual(expect.arrayContaining([{ campo: "status", antes: "A_DECIDIR", depois: "SEM_NOTA" }]));
    await expect(pg.query("UPDATE fiscal_notas_historico SET acao = 'x'")).rejects.toThrow(/FISCAL_IMUTAVEL/);
    await expect(pg.query("DELETE FROM fiscal_notas_historico")).rejects.toThrow(/FISCAL_IMUTAVEL/);
    await expect(pg.query("TRUNCATE fiscal_notas_historico")).rejects.toThrow(/FISCAL_IMUTAVEL/);
    await expect(pg.query("DELETE FROM fiscal_notas")).rejects.toThrow(/FISCAL_NOTA_SEM_EXCLUSAO/);
    await expect(pg.query("UPDATE fiscal_notas SET origem_id = 999")).rejects.toThrow(/ORIGEM_IMUTAVEL/);
  });

  it("Emitir é recusado no servidor (rota e banco) e nada vai à rede", async () => {
    const n = await umaNota();
    await expect(admin().fiscal.notas.emitir({ id: n.id, versao: n.versao })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(pg.query("UPDATE fiscal_notas SET status = 'EMITIDA' WHERE id = $1", [n.id])).rejects.toThrow(/FISCAL_EMISSAO_INDISPONIVEL/);
    expect((await notas())[0]!.status).toBe("A_DECIDIR");
  });

  it("sem redundância: trocar o CNPJ do cliente no BPO aparece no rascunho sem editar a nota", async () => {
    const n = await umaNota();
    const antes = await admin().fiscal.notas.ver({ id: n.id });
    expect(antes.tomador).toMatchObject({ tipo: "bpo", nome: "Cliente BPO Ltda", documento: "11222333000181" });
    await pg.exec("UPDATE bpo_clients SET cnpj = '45723174000110', razao_social = 'Cliente Novo SA'");
    const depois = await admin().fiscal.notas.ver({ id: n.id });
    expect(depois.tomador).toMatchObject({ nome: "Cliente Novo SA", documento: "45723174000110" });
    expect(depois.versao).toBe(antes.versao);
  });

  it("sem redundância: os formulários do fiscal não pedem razão social, CNPJ, regime, tomador, competência nem centro de custo", () => {
    const procs = fiscalRouter._def.procedures as Record<string, { _def: { inputs: { shape?: Record<string, unknown> }[] } }>;
    const campos = (p: string) => Object.keys(procs[p]!._def.inputs[0]!.shape ?? {});
    const proibidos = /razao|company|regime|tomador|cpf|competencia|centro|nome_?tomador|documento/i;
    for (const p of ["notas.editar", "notas.naoEmitir", "notas.adiar", "emissores.salvar", "tipos.salvar"]) {
      expect(campos(p).filter(c => proibidos.test(c)), p).toEqual([]);
    }
    // emissores.salvar recebe o CNPJ só para APONTAR o perfil já cadastrado (recusa CNPJ sem perfil — teste abaixo).
    expect(campos("notas.editar").sort()).toEqual(["descricao", "emissorId", "id", "municipioNome", "municipioUf", "tipoServicoId", "valorCentavos", "versao"]);
    const telas = ["NotasADecidir.tsx", "DadosFiscaisDoPerfil.tsx", "TiposServico.tsx", "NotasReceitaMes.tsx"].map(f =>
      readFileSync(new URL(`../../client/src/components/fiscal/${f}`, import.meta.url), "utf8"));
    for (const tela of telas) expect(tela).not.toMatch(/<Label[^>]*>\s*(Razão social|CNPJ|Regime|Competência|Centro de custo|CPF)/i);
  });
});

describe("permissões", () => {
  it("colaborador com BPO só vê; sem BPO, nada; corretor e inativo, nada; decidir é do admin", async () => {
    await lancamento();
    await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    const [n] = await notas();
    const colab = caller("colaborador", ["bpo"]);
    expect((await colab.fiscal.notas.listar()).itens).toHaveLength(1);
    await expect(colab.fiscal.notas.naoEmitir({ id: n!.id, versao: n!.versao, motivo: "emitida_fora" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(colab.fiscal.notas.editar({ id: n!.id, versao: n!.versao, descricao: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(colab.fiscal.notas.atualizar()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(colab.fiscal.config.salvar({ ligado: true, inicioEm: "2026-11-01" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(colab.fiscal.notas.emitir({ id: n!.id, versao: n!.versao })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("colaborador", ["obras"]).fiscal.notas.listar()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("corretor").fiscal.notas.listar()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("colaborador", ["bpo"], false).fiscal.notas.listar()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("cliente").fiscal.notas.previa({ id: n!.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await notas())[0]!.status).toBe("A_DECIDIR");
  });
});

describe("prévia em PDF", () => {
  it("tem a marca d'água 'RASCUNHO — SEM VALOR FISCAL' em todas as páginas", async () => {
    const c = await cliente();
    await lancamento({ clienteId: c });
    await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    const [n] = await notas();
    await admin().fiscal.notas.editar({ id: n!.id, versao: n!.versao, descricao: "Serviço de assessoria financeira e contábil. ".repeat(44) });
    // descrição bem longa (montada em memória) força mais de uma página
    const nota = { ...(await carregarNota(getDb(), n!.id)), descricao: "Serviço de assessoria financeira e contábil. ".repeat(150) };
    // O drizzle-kit (usado para gerar o DDL do teste) deixa "random" enumerável no Array.prototype, e o pdf.js recusa isso.
    const descritor = Object.getOwnPropertyDescriptor(Array.prototype, "random");
    if (descritor?.enumerable) Object.defineProperty(Array.prototype, "random", { ...descritor, enumerable: false });
    const { extractText, getDocumentProxy } = await import("unpdf");
    const curta = await getDocumentProxy(gerarPreviaPdf({ ...nota, descricao: "curta" }));
    expect(curta.numPages).toBe(1);
    const pdf = await getDocumentProxy(gerarPreviaPdf(nota));
    expect(pdf.numPages).toBeGreaterThan(1);
    const { text } = await extractText(pdf, { mergePages: false });
    expect(text).toHaveLength(pdf.numPages);
    for (const pagina of text as string[]) expect(pagina.replace(/\s+/g, " ")).toContain(MARCA_DAGUA);
    // pela rota (base64) também
    const viaRota = await admin().fiscal.notas.previa({ id: n!.id });
    const { text: t2 } = await extractText(new Uint8Array(Buffer.from(viaRota.base64, "base64")), { mergePages: true });
    expect(String(t2).replace(/\s+/g, " ")).toContain(MARCA_DAGUA);
  });
});

describe("relatório notas × receita do mês", () => {
  it("com nota + sem nota + a decidir + diferença = 'Receita realizada' do mesmo período (cartão da aba)", async () => {
    const c = await cliente();
    const l1 = await lancamento({ clienteId: c, valor: 1000 });
    await lancamento({ tipo: "reembolso", valor: 250.5, descricao: "Reembolso cartório" });
    await lancamento({ tipo: "receita", valor: 700, descricao: "Antes do corte", pagoEm: "2026-10-31T12:00:00Z" });
    await lancamento({ tipo: "despesa", valor: 9999 });
    await q(`INSERT INTO financial_transactions (type, amount, description, status, paid_at) VALUES ('income', 300, 'Venda antiga', 'paid', '2026-11-03T12:00:00Z')`);
    await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    const n = await notas();
    const reemb = n.find(x => x.origem_id !== l1)!;
    expect(reemb.motivo_sugerido).toBe("reembolso_custas");
    await admin().fiscal.notas.naoEmitir({ id: reemb.id, versao: reemb.versao, motivo: "reembolso_custas" });

    const r = await admin().fiscal.relatorio.mensal({ competencia: "2026-11" });
    const cartao = await admin().tax.overview({ from: r.de, to: r.ate });
    expect(r.receitaRealizadaCentavos).toBe(Math.round(cartao.revenue * 100));
    expect(r.receitaRealizadaCentavos).toBe(155_050);
    expect(r.aDecidirCentavos).toBe(100_000);
    expect(r.semNotaPorMotivo).toEqual([{ motivo: "reembolso_custas", rotulo: "Reembolso de custas/cartório", centavos: 25_050 }]);
    expect(r.diferencaCentavos).toBe(30_000);
    expect(r.diferencas).toEqual([expect.objectContaining({ fonte: "financeiro", descricao: "Venda antiga", centavos: 30_000 })]);
    expect(r.comNotaCentavos + r.semNotaCentavos + r.aDecidirCentavos + r.outraEmpresaCentavos + r.diferencaCentavos).toBe(r.receitaRealizadaCentavos);
    expect(r.fecha).toBe(true);
    const { csv } = await admin().fiscal.relatorio.csv({ competencia: "2026-11" });
    expect(csv).toContain("Sem nota — Reembolso de custas/cartório");
    expect(csv).toContain("1550,50");
    expect(csv).not.toMatch(/11222333000181|12345678909/);
  });

  it("lançamento repartido entre recebimentos do módulo fecha linha a linha (regra pura)", () => {
    const r = montarRelatorio({
      competencia: "2026-11", de: new Date("2026-11-01T03:00:00Z"), ate: new Date("2026-12-01T02:59:59Z"),
      movimentos: [], lancamentosBpo: [{ id: 1, tipo: "receita", valor: "1000.00" }],
      notas: [
        { id: 10, status: "A_DECIDIR", motivoSemNota: null, emissorId: null, origemTipo: "obra_movimento", origemId: 5, dataEvento: "2026-11-02", lancamentoBpoId: 1, valorOrigemCentavos: 60_000 },
        { id: 11, status: "SEM_NOTA", motivoSemNota: "itbi_repassado", emissorId: null, origemTipo: "obra_movimento", origemId: 6, dataEvento: "2026-11-02", lancamentoBpoId: 1, valorOrigemCentavos: 30_000 },
      ],
    });
    expect([r.aDecidirCentavos, r.semNotaCentavos, r.diferencaCentavos]).toEqual([60_000, 30_000, 10_000]);
    expect(r.fecha).toBe(true);
    expect(relatorioEmCsv(r).startsWith("﻿")).toBe(true);
  });
});

describe("multi-CNPJ (emissor por CNPJ, lido do perfil tributário)", () => {
  it("dois perfis: cada um com o seu vigente; o filtro 'Empresa' separa cartões, notas e relatório", async () => {
    const a = admin();
    await a.tax.profiles.create({ companyName: "Prospecta Construções", cnpj: "11.222.333/0001-81", regime: "simples_nacional", estimatedRate: 6, effectiveFrom: new Date("2026-01-01") });
    await a.tax.profiles.create({ companyName: "Efficaz Correspondente", cnpj: "45.723.174/0001-10", regime: "lucro_presumido", estimatedRate: 11, effectiveFrom: new Date("2026-02-01") });
    const perfis = await a.tax.profiles.list();
    expect(perfis.filter(p => p.isActive)).toHaveLength(2);
    expect((await a.tax.overview({ cnpj: "11222333000181" })).profile?.regime).toBe("simples_nacional");
    expect((await a.tax.overview({ cnpj: "45723174000110" })).profile?.regime).toBe("lucro_presumido");

    await expect(a.fiscal.emissores.salvar({ cnpj: "00000000000191", municipioNome: "Imperatriz", municipioUf: "MA" })).rejects.toThrow(/perfil tributário/);
    const p = await a.fiscal.emissores.salvar({ cnpj: "11.222.333/0001-81", municipioNome: "Imperatriz", municipioUf: "ma" });
    const e = await a.fiscal.emissores.salvar({ cnpj: "45723174000110", municipioNome: "Imperatriz", municipioUf: "MA" });
    expect(p!.ambiente).toBe("desligado");
    const lista = await a.fiscal.emissores.listar();
    expect(lista.map(x => [x.razaoSocial, x.regime, Boolean(x.emissor)])).toEqual([
      ["Prospecta Construções", "simples_nacional", true], ["Efficaz Correspondente", "lucro_presumido", true],
    ]);

    const l1 = await lancamento({ valor: 100 });
    await lancamento({ valor: 200 });
    await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    const [n1, n2] = await notas();
    expect(n1!.emissor_id).toBeNull(); // dois emissores: a empresa é escolhida pelo dono (ou pelo tipo de serviço)
    await a.fiscal.notas.editar({ id: n1!.id, versao: n1!.versao, emissorId: p!.id });
    await a.fiscal.notas.editar({ id: n2!.id, versao: n2!.versao, emissorId: e!.id });
    const daProspecta = (await a.fiscal.notas.listar({ emissorId: p!.id })).itens;
    expect(daProspecta.map(x => x.origemId)).toEqual([l1]);
    expect(daProspecta[0]!.emissor).toMatchObject({ razaoSocial: "Prospecta Construções", regime: "simples_nacional" });
    expect((await a.fiscal.resumo({ emissorId: e!.id })).aDecidir).toBe(1);

    const rel = await a.fiscal.relatorio.mensal({ competencia: "2026-11", emissorId: p!.id });
    expect([rel.aDecidirCentavos, rel.outraEmpresaCentavos, rel.receitaRealizadaCentavos]).toEqual([10_000, 20_000, 30_000]);
    expect(rel.fecha).toBe(true);
  });
});

describe("correções do portão de QA (M1–M5, B6, B8)", () => {
  it("M1: 'nunca gerar' sai na consulta respeitando a precedência (subtipo próprio vence a origem inteira)", async () => {
    await pg.exec(`UPDATE fiscal_tipos_servico SET regra = 'nunca_gerar' WHERE nome = 'Regularização e despachante'`);
    await pg.exec(`INSERT INTO fiscal_tipos_servico (nome, origens) VALUES ('Despachante', '["regularizacao_recebimento:despachante"]'::jsonb)`);
    await regularizacao("itbi", 100);
    const desp = await regularizacao("despachante", 300);
    await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    expect((await notas()).map(n => n.origem_id)).toEqual([desp]);
  });

  it("M5: no cron, com menos de 5 s sobrando, nem começa; com o prazo vencido no meio, para e a próxima passada continua", async () => {
    await pg.exec("UPDATE fiscal_config SET ligado = true");
    await lancamento();
    await lancamento({ valor: 20 });
    expect(await gerarRascunhosNoCron(getDb, 4_999)).toEqual({ pulado: true });
    expect(await gerarRascunhosNoCron(getDb, -10)).toEqual({ pulado: true });
    expect(await notas()).toHaveLength(0);
    const r = await gerarRascunhos(getDb(), { origem: "cron", agora: AGORA, prazoEm: Date.now() - 1 });
    expect(r).toMatchObject({ executou: true, parcial: true });
    expect(await notas()).toHaveLength(0);
    expect(await gerarRascunhosNoCron(getDb, 30_000)).toEqual({ criados: 2, parcial: false });
  });

  it("M4: perfil novo com CNPJ desativa o antigo sem CNPJ; 'Desativar perfil' só do admin, com histórico imutável", async () => {
    const a = admin();
    const antigo = await a.tax.profiles.create({ companyName: "Prospecta", regime: "simples_nacional", estimatedRate: 6, effectiveFrom: new Date("2026-01-01") });
    const novo = await a.tax.profiles.create({ companyName: "Prospecta", cnpj: "11222333000181", regime: "lucro_presumido", estimatedRate: 11, effectiveFrom: new Date("2026-06-01") });
    expect((await a.tax.profiles.list()).filter(p => p.isActive).map(p => p.id)).toEqual([novo!.id]);
    await expect(caller("colaborador", ["bpo"]).tax.profiles.desativar({ id: novo!.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await a.tax.profiles.desativar({ id: novo!.id }))!.isActive).toBe(false);
    expect((await a.tax.profiles.list())).toHaveLength(2); // nada apagado
    expect((await a.tax.profiles.historico({ id: antigo!.id })).map(h => h.acao)).toEqual(["criado", "desativado_por_nova_versao"]);
    expect((await a.tax.profiles.historico({ id: novo!.id })).map(h => [h.acao, h.usuarioNome])).toEqual([["criado", "Dono"], ["desativado", "Dono"]]);
    await expect(pg.query("UPDATE tax_profiles_historico SET acao = 'criado'")).rejects.toThrow(/FISCAL_IMUTAVEL/);
    await expect(pg.query("DELETE FROM tax_profiles_historico")).rejects.toThrow(/FISCAL_IMUTAVEL/);
  });

  it("M3: com filtro 'Empresa', obrigações vencidas só da empresa e sem estimativa sobre a receita de todas", async () => {
    const a = admin();
    const p1 = await a.tax.profiles.create({ companyName: "Prospecta", cnpj: "11222333000181", regime: "simples_nacional", estimatedRate: 6, effectiveFrom: new Date("2026-01-01") });
    const p2 = await a.tax.profiles.create({ companyName: "Efficaz", cnpj: "45723174000110", regime: "lucro_presumido", estimatedRate: 11, effectiveFrom: new Date("2026-02-01") });
    await a.tax.obligations.create({ profileId: p1!.id, name: "DAS", competency: "2026-10", dueDate: new Date("2026-11-01"), estimatedAmount: 10 });
    await a.tax.obligations.create({ profileId: p2!.id, name: "ISS", competency: "2026-10", dueDate: new Date("2026-11-01"), estimatedAmount: 10 });
    expect((await a.tax.overview()).overdue).toBe(2);
    const so = await a.tax.overview({ cnpj: "45723174000110" });
    expect([so.overdue, so.obligations.map(o => o.name)]).toEqual([1, ["ISS"]]);
  });

  it("M2: CSV neutraliza fórmula (= + - @ tab) e mantém número negativo como número", () => {
    const r = montarRelatorio({
      competencia: "2026-11", de: new Date("2026-11-01T03:00:00Z"), ate: new Date("2026-12-01T02:59:59Z"),
      movimentos: [],
      lancamentosBpo: ["=1+1", "+cmd", "-2+3", "@SUM(A1)", "\tx"].map((d, i) => ({ id: i + 1, tipo: "receita", valor: "1.00", descricao: d })),
      notas: [],
    });
    const csv = relatorioEmCsv(r);
    for (const perigo of ['"=1+1"', '"+cmd"', '"-2+3"', '"@SUM(A1)"', '"\tx"']) expect(csv).not.toContain(perigo);
    expect(csv).toContain(`"'=1+1"`);
    expect(csv).toContain('"5,00"');
  });

  it("B6: UF fora das 27 e data inexistente são BAD_REQUEST; erro do banco chega sem SQL", async () => {
    await lancamento();
    await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    const [n] = await notas();
    await expect(admin().fiscal.notas.editar({ id: n!.id, versao: n!.versao, municipioNome: "X", municipioUf: "XX" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin().fiscal.config.salvar({ ligado: false, inicioEm: "2026-02-30" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // força um erro do banco (CHECK) por baixo da rota
    await pg.exec("ALTER TABLE fiscal_notas ADD CONSTRAINT teste_sem_descricao CHECK (descricao_ajustada IS NULL)");
    const espiao = vi.spyOn(console, "error").mockImplementation(() => {});
    const erro = await admin().fiscal.notas.editar({ id: n!.id, versao: n!.versao, descricao: "texto" }).catch(e => e);
    espiao.mockRestore();
    expect(erro).toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível concluir agora. Tente de novo em instantes." });
    expect(String(erro.message)).not.toMatch(/fiscal_notas|CHECK|constraint|update/i);
  });

  it("B8: CPF do tomador só inteiro para o admin; colaborador com BPO vê mascarado (lista, detalhe e prévia)", async () => {
    const ld = await lead("Maria Souza");
    const ob = await obra("Imperatriz", "MA", ld);
    await q(`INSERT INTO obra_movimentos (project_id, natureza, descricao, valor, data, origem) VALUES ($1, 'entrada', 'Entrada', 1000, '2026-11-05', 'manual')`, [ob]);
    await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    const [n] = await notas();
    expect((await admin().fiscal.notas.ver({ id: n!.id })).tomador.documento).toBe("12345678909");
    const colab = caller("colaborador", ["bpo"]);
    expect((await colab.fiscal.notas.ver({ id: n!.id })).tomador.documento).toBe("***.456.789-**");
    expect((await colab.fiscal.notas.listar()).itens[0]!.tomador.documento).toBe("***.456.789-**");
    const descritor = Object.getOwnPropertyDescriptor(Array.prototype, "random");
    if (descritor?.enumerable) Object.defineProperty(Array.prototype, "random", { ...descritor, enumerable: false });
    const { extractText } = await import("unpdf");
    const { base64 } = await colab.fiscal.notas.previa({ id: n!.id });
    const { text } = await extractText(new Uint8Array(Buffer.from(base64, "base64")), { mergePages: true });
    expect(String(text)).not.toMatch(/123\.456\.789-09|12345678909/);
  });
});

describe("revisão do PR #302", () => {
  it("(1) município e demais filtros valem no SQL antes do limite; paginação por cursor sem repetir; opções sobre todos", async () => {
    const imp = await obra("Imperatriz", "MA");
    const par = await obra("Parauapebas", "PA");
    await q(`INSERT INTO obra_movimentos (project_id, natureza, descricao, valor, data, origem)
      SELECT $1, 'entrada', 'Entrada ' || g, 100, DATE '2026-11-20' - (g % 15), 'manual' FROM generate_series(1, 230) g`, [imp]);
    await q(`INSERT INTO obra_movimentos (project_id, natureza, descricao, valor, data, origem) VALUES ($1, 'recebimento_cef', 'Parcela', 500, '2026-11-01', 'manual')`, [par]);
    await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    const a = admin();
    const so = await a.fiscal.notas.listar({ municipio: "parauapebas" });
    expect(so.itens.map(n => n.municipio.nome)).toEqual(["Parauapebas"]);
    expect(so.proximoCursor).toBeNull();
    expect((await a.fiscal.notas.listar({ obraId: par })).itens).toHaveLength(1);
    const vistos: number[] = [];
    let cursor: string | undefined;
    let paginas = 0;
    do {
      const p = await a.fiscal.notas.listar({ limite: 100, cursor });
      vistos.push(...p.itens.map(n => n.id));
      cursor = p.proximoCursor ?? undefined;
      paginas++;
    } while (cursor);
    expect(paginas).toBe(3);
    expect(new Set(vistos).size).toBe(231);
    const datas = (await a.fiscal.notas.listar({ limite: 200 })).itens.map(n => n.dataEvento);
    expect([...datas].sort().reverse()).toEqual(datas);
    const opcoes = await a.fiscal.notas.opcoesFiltro();
    expect(opcoes.obras.map(o => o.nome).sort()).toEqual(["Casa Imperatriz", "Casa Parauapebas"]);
    await expect(a.fiscal.notas.listar({ cursor: "x'; DROP" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("(2) lançamento alocado em PARTE a um só recebimento: só a parte ligada leva o status; o resto é diferença", async () => {
    const r = montarRelatorio({
      competencia: "2026-11", de: new Date("2026-11-01T03:00:00Z"), ate: new Date("2026-12-01T02:59:59Z"),
      movimentos: [], lancamentosBpo: [{ id: 1, tipo: "receita", valor: "1000.00" }],
      notas: [{ id: 10, status: "SEM_NOTA", motivoSemNota: "itbi_repassado", emissorId: null, origemTipo: "regularizacao_recebimento", origemId: 5,
        dataEvento: "2026-11-02", lancamentoBpoId: 1, valorOrigemCentavos: 40_000 }],
    });
    expect([r.semNotaCentavos, r.diferencaCentavos, r.aDecidirCentavos]).toEqual([40_000, 60_000, 0]);
    expect(r.diferencas).toEqual([expect.objectContaining({ centavos: 60_000, explicacao: expect.stringMatching(/sem recebimento ligado/) })]);
    expect(r.fecha).toBe(true);
    // no banco: R$ 1.000 no BPO com R$ 400 ligados a uma regularização decidida "sem nota"
    const l = await lancamento({ tipo: "receita", valor: 1000 });
    await regularizacao("itbi", 400, l);
    await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    const [n] = await notas();
    await admin().fiscal.notas.naoEmitir({ id: n!.id, versao: n!.versao, motivo: "itbi_repassado" });
    const rel = await admin().fiscal.relatorio.mensal({ competencia: "2026-11" });
    expect([rel.receitaRealizadaCentavos, rel.semNotaCentavos, rel.diferencaCentavos]).toEqual([100_000, 40_000, 60_000]);
    expect(rel.fecha).toBe(true);
  });

  it("(3) lançamento que troca de cliente depois: o rascunho usa o cliente ATUAL e avisa 'tomador mudou'", async () => {
    const antigo = await cliente("Cliente Antigo Ltda", "11222333000181");
    const novo = await cliente("Cliente Novo SA", "45723174000110");
    const l = await lancamento({ clienteId: antigo });
    await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    const [n] = await notas();
    const a = admin();
    expect((await a.fiscal.notas.ver({ id: n!.id })).tomadorMudouNaOrigem).toBe(false);
    await pg.query("UPDATE bpo_lancamentos SET cliente_id = $1 WHERE id = $2", [novo, l]);
    const ver = await a.fiscal.notas.ver({ id: n!.id });
    expect(ver.tomador).toMatchObject({ nome: "Cliente Novo SA", documento: "45723174000110" });
    expect(ver.tomadorMudouNaOrigem).toBe(true);
    expect(ver.bpoClientId).toBe(novo);
    expect((await a.fiscal.notas.listar({ bpoClientId: novo })).itens.map(x => x.id)).toEqual([n!.id]);
    expect((await a.fiscal.notas.listar({ bpoClientId: antigo })).itens).toEqual([]);
    expect((await a.fiscal.notas.opcoesFiltro()).clientesBpo.map(c => c.nome)).toEqual(["Cliente Novo SA"]);
    const descritor = Object.getOwnPropertyDescriptor(Array.prototype, "random");
    if (descritor?.enumerable) Object.defineProperty(Array.prototype, "random", { ...descritor, enumerable: false });
    const { extractText } = await import("unpdf");
    const { base64 } = await a.fiscal.notas.previa({ id: n!.id });
    const { text } = await extractText(new Uint8Array(Buffer.from(base64, "base64")), { mergePages: true });
    const t = String(text).replace(/\s+/g, " ");
    expect(t).toContain("Cliente Novo SA");
    expect(t).not.toContain("Cliente Antigo");
    expect(t).toContain("O tomador mudou na origem");
  });
});
