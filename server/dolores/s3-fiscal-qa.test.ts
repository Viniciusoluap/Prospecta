// EPIC-029 S-3 — PORTÃO DE QA DE SEGURANÇA (Quinn, 22/11/2026). Tenta quebrar o fluxo fiscal da Dolores: escopo (só o dono, só direto),
// confirmação, argumentos forjados, prévia em PDF (destino, teto, filtro de segredos), dados pessoais em log/auditoria, aviso nota_fiscal,
// reservas de gasto e a migração 0161. Achados M1 e B1 corrigidos pelo @dev (eram `it.fails`); B2 coberto em s3-fiscal.test.ts.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../whatsapp-router.js", async orig => ({ ...(await orig<typeof import("../whatsapp-router.js")>()), configEvolution: vi.fn(async () => null) }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { lerConfirmacao, nivelDoItem } from "../../shared/dolores/confirmacao.js";
import { lerDecisaoDoDono } from "../../shared/dolores/fila.js";
import { FERRAMENTAS_FISCAIS, centavosDoValor, intencaoFiscal, temPalavraComando } from "../../shared/dolores/fiscal.js";
import { SILENCIADOS_POR_PADRAO, TIPOS_AVISO, agruparPorTipo, montarAvisoFixo, type AchadoPendente } from "../../shared/dolores/avisos.js";
import { MAX_CARACTERES_WHATSAPP } from "../../shared/dolores/whatsapp.js";
import { definirSorteioCodigo } from "./aprovacoes.js";
import { executarLeituraDoCliente } from "./atendimento.js";
import { definirSilencio, executarAvisos } from "./avisos.js";
import { RESERVA_MINIMA_ENTRADA, SOBRECARGA_DE_FERRAMENTAS, definirClienteModelo, ferramentasParaOModelo, type PedidoModelo, type RespostaModelo } from "./cerebro.js";
import { LEITURAS_DO_DONO, FUNCOES } from "./funcoes.js";
import { executarLeituraInterna, LEITURAS_INTERNAS } from "./marcacao.js";
import { tokensEstimadosDoTexto } from "./memoria.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte, executarFuncao, ferramentasDoWhatsapp, ferramentasLiberadas } from "./ponte.js";
import { promptSistemaWhatsapp } from "./prompt.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";
import { definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";

const DONO = "5599991234567";
const CPF = "52998224725";
const MIGRACAO_0154 = readFileSync(new URL("../../drizzle/0154_fiscal_notas.sql", import.meta.url), "utf8");
const MIGRACAO_0161 = readFileSync(new URL("../../drizzle/0161_dolores_aviso_fiscal.sql", import.meta.url), "utf8");

let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviar: ReturnType<typeof vi.fn>;
let enviarDocumento: ReturnType<typeof vi.fn>;
let pedidos: PedidoModelo[];
let roteiro: Array<(p: PedidoModelo) => RespostaModelo>;
let agora: Date;
let fetchVigia: ReturnType<typeof vi.spyOn>;
let logs: string[];
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
let seq = 0;
const ts = (t: string) => Math.floor((agora.getTime() + (lerConfirmacao(t) ? 1_000 : -5_000)) / 1000);
const aviso = (texto: string, extra: Record<string, unknown> = {}) => ({ event: "messages.upsert", instance: "prospecta-dolores",
  data: { key: { remoteJid: `${DONO}@s.whatsapp.net`, fromMe: false, id: `FS${++seq}` }, message: { conversation: texto }, messageTimestamp: ts(texto), ...extra } });
const dono = (texto: string) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, body: aviso(texto), ip: "203.0.113.9" } as never);
const uso = { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const ferramenta = (name: string, input: unknown): RespostaModelo => ({ stop_reason: "tool_use", usage: uso, content: [{ type: "tool_use", id: `tu_${++seq}`, name, input }] });
const texto = (t: string): RespostaModelo => ({ stop_reason: "end_turn", usage: uso, content: [{ type: "text", text: t }] });
const enviados = () => enviar.mock.calls.map(c => (c[0] as { texto: string }).texto);
const ultima = () => enviados().at(-1) ?? "";
const nomesDasFerramentas = (p: PedidoModelo) => p.ferramentas.map(f => f.name);
const nota = (id: number) => q<{ status: string; versao: number; motivo_sem_nota: string | null; motivo_texto: string | null; adiada_ate: string | null; valor_ajustado_centavos: string | null; descricao_ajustada: string | null }>(
  `SELECT status, versao, motivo_sem_nota, motivo_texto, adiada_ate::text, valor_ajustado_centavos, descricao_ajustada FROM fiscal_notas WHERE id = ${id}`).then(r => r[0]!);

/** Um rascunho de nota (origem: um lançamento NOVO do BPO do cliente João Silva, CPF no cadastro). */
async function rascunho(valor = "1200.00", extra: { status?: string; adiadaAte?: string | null; descricao?: string } = {}): Promise<number> {
  const [l] = await q<{ id: number }>(`INSERT INTO bpo_lancamentos (cliente_id, tipo, descricao, valor, valor_recebido, vencimento, pago, competencia, a_classificar)
    VALUES (2, 'honorario', 'Regularização do imóvel', '${valor}', '${valor}', '2026-11-10', true, '2026-11', false) RETURNING id`);
  const [n] = await q<{ id: number }>(`INSERT INTO fiscal_notas (emissor_id, origem_tipo, origem_id, data_evento, bpo_client_id, status, adiada_ate, descricao_ajustada, municipio_incidencia_nome, municipio_incidencia_uf)
    VALUES (1, 'bpo_lancamento', ${l!.id}, '2026-11-10', 2, '${extra.status ?? "A_DECIDIR"}', ${extra.adiadaAte ? `'${extra.adiadaAte}'` : "NULL"}, ${extra.descricao ? `'${extra.descricao}'` : "NULL"}, 'Imperatriz', 'MA') RETURNING id`);
  return n!.id;
}

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`
    CREATE TABLE IF NOT EXISTS tax_profiles (id serial PRIMARY KEY, cnpj text, company_name text, regime text, is_active boolean DEFAULT true, effective_from date DEFAULT '2026-01-01');
    CREATE TABLE IF NOT EXISTS operational_commissions (id serial PRIMARY KEY, construction_project_id integer, amount numeric, business_type text, property text);`);
  await banco.pg.exec(MIGRACAO_0154);
  await banco.pg.exec(MIGRACAO_0161);
  await banco.pg.exec(MIGRACAO_0161); // idempotente
  await banco.pg.exec(`
    INSERT INTO tax_profiles (cnpj, company_name, regime) VALUES ('11222333000181', 'Prospecta Construções', 'simples_nacional');
    INSERT INTO fiscal_emissores (cnpj, municipio_nome, municipio_uf) VALUES ('11222333000181', 'Imperatriz', 'MA');
    INSERT INTO bpo_clients (razao_social, cpf, responsavel, telefone, honorarios, data_inicio) VALUES ('João Silva', '${CPF}', 'João', '9999', '0', '2026-01-01');
    UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}', ia_ligada = true,
      limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  esquecerUsuarioDolores();
  agora = new Date(AGORA);
  definirDependenciasPonte({ agora: () => agora });
  enviar = vi.fn(async () => true);
  enviarDocumento = vi.fn(async () => true);
  definirDependenciasWhatsapp({ agora: () => agora, enviar: enviar as never, enviarDocumento: enviarDocumento as never });
  let sorteio = 0;
  definirSorteioCodigo(() => ((sorteio++ * 5) % 22) / 22 + 0.001);
  vi.mocked(configuracaoAnthropicPainel).mockResolvedValue({ apiKey: "sk-ant-chave-de-teste-nao-real-123456", modelo: "modelo-de-teste" });
  pedidos = [];
  roteiro = [];
  definirClienteModelo(async p => {
    pedidos.push(JSON.parse(JSON.stringify(p)));
    const passo = roteiro.shift();
    if (!passo) throw new Error("roteiro do modelo acabou");
    return passo(p);
  });
  fetchVigia = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("rede proibida no teste"); });
  logs = [];
  for (const m of ["log", "warn", "error", "info"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(x => (x instanceof Error ? x.message : typeof x === "string" ? x : JSON.stringify(x))).join(" ")); });
});
afterEach(() => {
  expect(fetchVigia).not.toHaveBeenCalled();
  // nada de CPF do tomador em log nem na auditoria da Dolores
  expect(logs.join("\n")).not.toContain(CPF);
  ENV.cookieSecret = segredoAntes;
  definirDependenciasPonte(); definirDependenciasWhatsapp(); definirClienteModelo(); definirSorteioCodigo();
  vi.restoreAllMocks();
});
const auditoriaSemCpf = async () => expect(JSON.stringify(await q("SELECT argumentos, resumo, motivo FROM dolores_acoes"))).not.toContain(CPF);
import { ACOES } from "./acoes/registro.js";
import { MAX_PREVIAS_POR_PEDIDO } from "./cerebro.js";
import { RESERVA_ENTRADA_AVISO } from "./avisos.js";
import { SISTEMA_AVISOS, TIPOS_COLETADOS, dadosParaIA } from "../../shared/dolores/avisos.js";
import { emitir } from "../fiscal/notas.js";

const MIGRACAO_0150 = readFileSync(new URL("../../drizzle/0150_dolores_avisos.sql", import.meta.url), "utf8");
const pdfDoEnvio = (i = 0) => Buffer.from((enviarDocumento.mock.calls[i]![0] as { base64: string }).base64, "base64").toString("latin1");

describe("QA S-3 — escopo", () => {
  it("depois de um aviso/consulta fiscal, uma fala qualquer do dono abre SÓ as ações fiscais (nenhuma outra ação)", async () => {
    const id = await rascunho();
    roteiro = [() => ferramenta("listar_notas_fiscais", {}), () => texto("Tem a do João.")];
    await dono("quais notas tenho pra decidir?");
    roteiro = [() => texto("Certo.")];
    await dono("valeu, obrigado");
    const nomes = nomesDasFerramentas(pedidos.at(-1)!);
    expect(nomes).toContain("decidir_nota_fiscal");
    const outras = ACOES.map(a => a.nome).filter(n => !FERRAMENTAS_FISCAIS.has(n));
    for (const n of outras) expect(nomes, n).not.toContain(n);
    expect((await nota(id)).status).toBe("A_DECIDIR");
  });
  it("o modelo pedindo uma ação NÃO fiscal num turno aberto só pelo assunto fiscal → a porta recusa", async () => {
    await rascunho();
    const tarefas = async () => Number((await q<{ n: string }>("SELECT count(*) AS n FROM tasks"))[0]!.n);
    const antes = await tarefas();
    roteiro = [() => ferramenta("criar_tarefa", { titulo: "x", responsavel: "Bianca" }), () => texto("Ok.")];
    await dono("tem nota pra decidir?");
    const resp = JSON.stringify(pedidos.at(-1)!.mensagens.at(-1));
    expect(resp).toMatch(/não pede ação|só consultas|não disponível|recus/i);
    expect(await tarefas()).toBe(antes);
  });
  it("ações fiscais pela ponte com pedidoFiscal forjado mas sem mensagemId → 403", async () => {
    const id = await rascunho();
    const r = await executarFuncao({ funcao: "decidir_nota_fiscal", argumentos: { notaFiscalId: id, decisao: "adiada" } },
      { canal: "ponte", pedidoFiscal: { texto: "deixa pra depois" }, exigirConfirmacao: true } as never);
    expect(r.status).toBe(403);
    expect((await nota(id)).status).toBe("A_DECIDIR");
  });
});

describe("QA S-3 — argumentos forjados", () => {
  it("ver_nota_fiscal não aceita destino/numero vindo do modelo (zod estrito)", async () => {
    const id = await rascunho();
    const r = await executarFuncao({ funcao: "ver_nota_fiscal", argumentos: { notaFiscalId: id, enviarPrevia: true, numero: "5511988887777" } }, { canal: "whatsapp", mensagemId: 1 });
    expect(r.status).toBe(400);
  });
  it("descrição copiada do cadastro/BPO (não dita pelo dono) → recusada; rascunho intacto", async () => {
    const id = await rascunho();
    const r = await executarFuncao({ funcao: "editar_rascunho_nota", argumentos: { notaFiscalId: id, descricao: "Honorários de regularização pagos por transferência urgente ao fornecedor" } },
      { canal: "whatsapp", mensagemId: 1, exigirConfirmacao: true, pedidoFiscal: { texto: "corrige a descrição da nota do João" } });
    expect(String(r.body.erro)).toMatch(/suas palavras/);
    expect((await nota(id)).descricao_ajustada).toBeNull();
  });
  it("id de rascunho inexistente → recusa explicada, nada gravado", async () => {
    const r = await executarFuncao({ funcao: "emitir_nota_fiscal", argumentos: { notaFiscalId: 999 } },
      { canal: "whatsapp", mensagemId: 1, exigirConfirmacao: true, pedidoFiscal: { texto: "emite a nota 999" } });
    expect(String(r.body.erro)).toMatch(/Não achei/);
  });
  it("emitir: a função da tela recusa e o gatilho da 0154 recusa EMITIDA direto no banco", async () => {
    const id = await rascunho();
    expect(() => emitir()).toThrow();
    await expect(banco.pg.exec(`UPDATE fiscal_notas SET status = 'EMITIDA' WHERE id = ${id}`)).rejects.toThrow();
    expect((await nota(id)).status).toBe("A_DECIDIR");
  });
});

describe("QA S-3 — prévia em PDF", () => {
  it(`no máximo ${MAX_PREVIAS_POR_PEDIDO} prévias por pedido, mesmo com o modelo pedindo mais`, async () => {
    const ids = [await rascunho("100.00"), await rascunho("200.00"), await rascunho("300.00")];
    roteiro = [...ids.map(id => () => ferramenta("ver_nota_fiscal", { notaFiscalId: id, enviarPrevia: true })), () => texto("Mandando.")];
    await dono("manda a prévia das notas do João");
    expect(enviarDocumento.mock.calls.length).toBeLessThanOrEqual(MAX_PREVIAS_POR_PEDIDO);
    for (const c of enviarDocumento.mock.calls) expect((c[0] as { numero: string }).numero).toBe(DONO);
  });
  it("falha que traz o CPF na mensagem de erro não vaza para log nem auditoria", async () => {
    const id = await rascunho();
    enviarDocumento.mockRejectedValue(new Error(`Evolution recusou o arquivo do tomador ${CPF}`));
    roteiro = [() => ferramenta("ver_nota_fiscal", { notaFiscalId: id, enviarPrevia: true }), () => texto("Mandando.")];
    await dono("manda a prévia da nota do João");
    expect(ultima()).toContain("não consegui mandar o PDF da prévia");
    await auditoriaSemCpf();
  });
  it("na conversa (texto), senha/dado bancário da descrição do rascunho é mascarado pelo filtro da porta", async () => {
    const id = await rascunho("1200.00", { descricao: "Honorarios - senha do portal: Abc12345xyz" });
    const r = await executarFuncao({ funcao: "ver_nota_fiscal", argumentos: { notaFiscalId: id } }, { canal: "whatsapp", mensagemId: 1 });
    expect(JSON.stringify(r.body)).not.toContain("Abc12345xyz");
  });
  // ACHADO M1: o PDF da prévia NÃO passa pelo filtro de segredos/dados bancários da Dolores (CLAUDE.md 16/11, opção B: "continuam
  // sempre mascarados: senhas, tokens, chaves de API, códigos de acesso e dados bancários"). A descrição vem de texto livre do BPO.
  it("ACHADO M1 (corrigido): senha na descrição do rascunho sai em claro no PDF mandado pelo WhatsApp", async () => {
    const id = await rascunho("1200.00", { descricao: "Honorarios - senha do portal: Abc12345xyz" });
    roteiro = [() => ferramenta("ver_nota_fiscal", { notaFiscalId: id, enviarPrevia: true }), () => texto("Mandando.")];
    await dono("manda a prévia da nota do João");
    expect(enviarDocumento).toHaveBeenCalledTimes(1);
    expect(pdfDoEnvio()).not.toContain("Abc12345xyz");
  });
});

describe("QA S-3 — aviso nota_fiscal", () => {
  // ACHADO B1: a trava de palavra-comando do texto da IA só pega maiúsculas (VER/EMITIR…) e "responda/digite/escreva".
  it("ACHADO B1 (corrigido): texto da IA que ensina a resposta em minúsculas (\"me diga emite ou depois\") passa pela trava", () => {
    expect(temPalavraComando("Se quiser, é só me dizer \"emite\" ou \"depois\" que eu cuido.")).toBe(true);
  });
  it(`RESERVA_ENTRADA_AVISO (${RESERVA_ENTRADA_AVISO}) cobre o pior caso: todos os tipos × 5 itens com nomes longos + resumo`, () => {
    const longo = "Nome Bem Comprido de Cliente Para Medir o Pior Caso ".repeat(4);
    const achados: AchadoPendente[] = [];
    let id = 0;
    for (const tipo of TIPOS_COLETADOS) for (let i = 0; i < 25; i++) achados.push({ id: ++id, tipo, entidade: `${tipo}:${i}`, faixa: 3, faixaAvisada: 1,
      dados: { nome: longo, dias: 999, quantidade: 99, marca: tipo === "nota_fiscal" ? "adiada_vencida" : "sem_dono", valorCentavos: 99_999_999_99, servico: longo, municipio: longo, ref: { tipo: "obra", id } } });
    achados.push({ id: ++id, tipo: "nota_fiscal", entidade: "resumo", faixa: 1, faixaAvisada: null, dados: { nome: "resumo do dia", resumo: true, quantidade: 25, valorCentavos: 99_999_999_99 } });
    const entrada = tokensEstimadosDoTexto(SISTEMA_AVISOS) + tokensEstimadosDoTexto(dadosParaIA(agruparPorTipo(achados), AGORA));
    expect(entrada).toBeLessThanOrEqual(RESERVA_ENTRADA_AVISO);
  });
  it("vercel.json continua com 15 crons (nenhum novo)", () => {
    const v = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as { crons?: unknown[] };
    expect(v.crons?.length).toBe(15);
  });
});

describe("QA S-3 — migração 0161", () => {
  it("a lista nova = exatamente a lista do CHECK da 0150 + 'nota_fiscal'; um único ALTER TABLE, só na restrição do tipo", () => {
    const lista = (s: string) => /CHECK \("tipo" IN \(([^)]*)\)\)/.exec(s)![1]!.split(",").map(x => x.trim());
    const antiga = lista(MIGRACAO_0150);
    const nova = lista(MIGRACAO_0161);
    expect(nova).toEqual([...antiga, "'nota_fiscal'"]);
    const sql = MIGRACAO_0161.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
    expect(sql.match(/ALTER TABLE/g)?.length).toBe(2);
    expect(sql.match(/ALTER TABLE "(\w+)"/g)!.every(m => m.includes("dolores_avisos_tipos"))).toBe(true);
    expect(sql.match(/CONSTRAINT "(\w+)"/g)!.every(m => m.includes("dolores_avisos_tipos_tipo_check"))).toBe(true);
  });
  it("aplicada sobre linhas existentes: nenhuma é recusada e o nome da restrição continua o padrão do Postgres", async () => {
    const r = await q<{ conname: string; def: string }>(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'dolores_avisos_tipos'::regclass AND contype = 'c'`);
    // só a restrição do tipo mudou; a da via (0150) continua lá, intacta
    expect(r.map(x => x.conname).sort()).toEqual(["dolores_avisos_tipos_tipo_check", "dolores_avisos_tipos_via_check"]);
    expect(r.find(x => x.conname.endsWith("tipo_check"))!.def).toContain("nota_fiscal");
    expect(r.find(x => x.conname.endsWith("via_check"))!.def).not.toContain("nota_fiscal");
    for (const t of TIPOS_AVISO) await banco.pg.exec(`INSERT INTO dolores_avisos_tipos (tipo, silenciado) VALUES ('${t}', true) ON CONFLICT (tipo) DO NOTHING`);
    await banco.pg.exec(MIGRACAO_0161); // de novo, com todas as linhas
    expect(Number((await q<{ n: string }>("SELECT count(*) AS n FROM dolores_avisos_tipos"))[0]!.n)).toBe(TIPOS_AVISO.length);
  });
});
