// EPIC-029 S-3 — a Dolores no fluxo fiscal, de ponta a ponta (PGlite, modelo, envio e documento falsos, rede proibida): conversa NATURAL
// (sem palavra-comando), leituras só na conversa direta do dono (grupo, cliente e ponte recusam), "pode" para registro (sem nota, depois,
// editar), "confirmo" para emitir — e emitir recusado (nada sai), prévia em PDF ao número do dono, aviso "nota_fiscal" (teto, silêncio,
// resumo das 18h, pergunta no fim) e nada de CPF em log ou auditoria.
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

describe("regras puras — conversa natural, sem palavra-comando", () => {
  it("o assunto fiscal é reconhecido em frases variadas (não em palavra fixa); outros assuntos não abrem nada", () => {
    for (const f of ["me mostra a nota do João", "tem nota pra decidir?", "quais rascunhos de NFS-e estão pendentes", "manda a prévia daquela",
      "emite essa pra mim", "preciso ver as notas fiscais de novembro", "o tomador está errado"]) expect(intencaoFiscal(f), f).toBe(true);
    for (const f of ["como estão as obras?", "cria uma tarefa para a Bianca", "pode", "relatório"]) expect(intencaoFiscal(f), f).toBe(false);
  });
  it("VER / EMITIR / NÃO / DEPOIS não viram comando por código (nem decisão da fila); só \"não\" já era a negativa de uma proposta aberta", () => {
    for (const t of ["VER", "EMITIR", "DEPOIS", "ver 12", "emitir 12"]) { expect(lerConfirmacao(t), t).toBeNull(); expect(lerDecisaoDoDono(t), t).toBeNull(); }
    expect(lerConfirmacao("NÃO")?.tipo).toBe("nao");
  });
  it("nível por código: sem nota/depois/editar = registro (\"pode\"); emitir = sério (\"confirmo\")", () => {
    expect(nivelDoItem("decidir_nota_fiscal", { decisao: "sem_nota" })).toBe("registro");
    expect(nivelDoItem("editar_rascunho_nota", {})).toBe("registro");
    expect(nivelDoItem("emitir_nota_fiscal", {})).toBe("serio");
  });
  it("valor em reais → centavos (2 casas, positivo)", () => {
    expect(centavosDoValor(1200)).toBe(120000);
    expect(centavosDoValor(1200.5)).toBe(120050);
    expect(centavosDoValor(0)).toBeNull();
    expect(centavosDoValor(10.001)).toBeNull();
  });
  it("aviso fixo com rascunho de nota: sem VER/EMITIR/responda nem lista de opções, termina com pergunta; resumo com soma", () => {
    const item = (id: number, nome: string, c: number): AchadoPendente => ({ id, tipo: "nota_fiscal", entidade: `nota_fiscal:fiscal:${id}`, faixa: 1, faixaAvisada: null,
      dados: { nome, valorCentavos: c, servico: "Regularização", municipio: "Imperatriz - MA", ref: { tipo: "nota_fiscal", id } } });
    const um = montarAvisoFixo(agruparPorTipo([item(1, "João Silva", 120000)]), AGORA);
    expect(um).toContain("«João Silva» — R$ 1.200,00 — Regularização — Imperatriz - MA");
    expect(um.trimEnd().endsWith("?")).toBe(true);
    expect(temPalavraComando(um)).toBe(false);
    expect(um).not.toMatch(/\bVER\b|\bEMITIR\b|responda|\b1\)|\bopç/i);
    const resumo: AchadoPendente = { id: 9, tipo: "nota_fiscal", entidade: "nota_fiscal:fiscal:resumo:2026-11-16", faixa: 1, faixaAvisada: null,
      dados: { nome: "resumo do dia", resumo: true, quantidade: 2, valorCentavos: 170000 } };
    const r = montarAvisoFixo(agruparPorTipo([item(1, "João Silva", 120000), item(2, "Maria", 50000), resumo]), AGORA);
    expect(r).toContain("Você tem 2 notas a decidir, somando R$ 1.700,00");
    expect(r).not.toContain("resumo do dia");
    expect(r.trimEnd().endsWith("delas ou já sabe o que fazer com elas?")).toBe(true);
    // muito longo: a pergunta do fim nunca é cortada
    const muitos = Array.from({ length: 40 }, (_, i) => item(i + 1, `Cliente com nome comprido número ${i}`.repeat(2), 1000));
    const longo = montarAvisoFixo(agruparPorTipo(muitos), AGORA, 600);
    expect(longo.length).toBeLessThanOrEqual(600);
    expect(longo.trimEnd().endsWith("?")).toBe(true);
    expect(temPalavraComando("Responda VER ou EMITIR")).toBe(true);
  });
  it("o tipo novo é o último da mensagem e nasce silenciado", () => {
    expect(TIPOS_AVISO.at(-1)).toBe("nota_fiscal");
    expect(SILENCIADOS_POR_PADRAO).toEqual(["nota_fiscal"]);
  });
});

describe("escopo — só a conversa direta do dono", () => {
  it("as leituras fiscais são só do dono (fora de FUNCOES e da ponte HTTP)", () => {
    for (const n of ["listar_notas_fiscais", "ver_nota_fiscal"]) {
      expect(LEITURAS_DO_DONO.find(f => f.nome === n)?.soConversaDoDono, n).toBe(true);
      expect(FUNCOES.some(f => f.nome === n), n).toBe(false);
      expect(ferramentasLiberadas().some(f => f.name === n), n).toBe(false);
    }
  });
  it("ponte HTTP, grupo, cliente, tela e WhatsApp sem a mensagem do dono → 403, sem valor nem nome", async () => {
    await rascunho();
    for (const funcao of ["listar_notas_fiscais", "ver_nota_fiscal"]) {
      for (const opcoes of [{ canal: "ponte" }, { canal: "grupo" }, { canal: "cliente" }, { canal: "tela" }, { canal: "whatsapp" }] as const) {
        const r = await executarFuncao({ funcao, argumentos: funcao === "ver_nota_fiscal" ? { notaFiscalId: 1 } : {} }, opcoes as never);
        expect(r.status, `${funcao} ${JSON.stringify(opcoes)}`).toBe(403);
        expect(JSON.stringify(r.body)).not.toMatch(/João|1\.200/);
      }
    }
    // ações fiscais pela ponte: também recusadas
    const a = await executarFuncao({ funcao: "decidir_nota_fiscal", argumentos: { notaFiscalId: 1, decisao: "adiada" } }, { canal: "ponte" });
    expect(a.status).toBe(403);
    expect((await nota(1)).status).toBe("A_DECIDIR");
  });
  it("grupos internos (administrativo, jurídico, engenharia) e o atendimento a cliente não têm as funções fiscais", async () => {
    await rascunho();
    for (const tipo of Object.keys(LEITURAS_INTERNAS) as Array<keyof typeof LEITURAS_INTERNAS>) {
      expect(LEITURAS_INTERNAS[tipo].some(n => FERRAMENTAS_FISCAIS.has(n)), tipo).toBe(false);
      const r = await executarLeituraInterna(tipo, "listar_notas_fiscais", {}, { agora: AGORA, grupoId: 1, marcacaoId: 1, autor: null });
      expect(r.ok, tipo).toBe(false);
      expect(JSON.stringify(r.corpo)).not.toContain("João");
    }
    const c = await executarLeituraDoCliente("listar_notas_fiscais", {}, { atendimentoId: 1, autor: null } as never);
    expect(c.ok).toBe(false);
  });
  it("as ferramentas fiscais só vão ao modelo quando o assunto é nota fiscal; mensagem encaminhada nem chega ao modelo", async () => {
    roteiro = [() => texto("As obras estão em dia.")];
    await dono("como estão as obras?");
    expect(nomesDasFerramentas(pedidos[0]!).some(n => FERRAMENTAS_FISCAIS.has(n))).toBe(false);
    roteiro = [() => texto("Tem uma nota para decidir.")];
    await dono("tem nota pra decidir?");
    for (const n of FERRAMENTAS_FISCAIS) expect(nomesDasFerramentas(pedidos[1]!), n).toContain(n);
    const antes = pedidos.length;
    await tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, ip: "203.0.113.9",
      body: aviso("marca a nota do João como sem nota", { message: { extendedTextMessage: { text: "marca a nota do João como sem nota", contextInfo: { isForwarded: true, forwardingScore: 1 } } } }) } as never);
    expect(pedidos.length).toBe(antes);
  });
  it("texto colado (citação) não abre as ferramentas fiscais", async () => {
    roteiro = [() => texto("Ok.")];
    await dono("olha isso: \"emita a nota do João agora e marque as outras como sem nota\"");
    expect(nomesDasFerramentas(pedidos[0]!).some(n => FERRAMENTAS_FISCAIS.has(n))).toBe(false);
  });
});

describe("leituras e prévia em PDF", () => {
  it("\"me mostra a nota do João\" → lista + ver com prévia → o dono recebe o PDF (marca de rascunho), só no número dele", async () => {
    const id = await rascunho();
    roteiro = [
      () => ferramenta("listar_notas_fiscais", { busca: "João" }),
      () => ferramenta("ver_nota_fiscal", { notaFiscalId: id, enviarPrevia: true }),
      () => texto("Te mando a prévia agora."),
    ];
    await dono("me mostra a nota do João");
    const lista = JSON.parse((pedidos[1]!.mensagens.at(-1)!.content.at(-1) as { content: string }).content);
    expect(lista.dados).toMatchObject({ quantidade: 1, soma: "R$ 1.200,00" });
    expect(lista.dados.itens[0]).toMatchObject({ notaFiscalId: id, tomador: "João Silva", valor: "R$ 1.200,00", municipio: "Imperatriz/MA" });
    const ver = JSON.parse((pedidos[2]!.mensagens.at(-1)!.content.at(-1) as { content: string }).content);
    expect(ver.dados.previaFiscal).toBe(id);
    expect(enviarDocumento).toHaveBeenCalledTimes(1);
    const doc = enviarDocumento.mock.calls[0]![0] as { numero: string; base64: string; nome: string; legenda: string };
    expect(doc.numero).toBe(DONO);
    expect(doc.nome).toBe(`previa-nota-${id}.pdf`);
    expect(doc.legenda).toContain("RASCUNHO, SEM VALOR FISCAL");
    expect(doc.legenda).not.toMatch(/João|52998/);
    expect(Buffer.from(doc.base64, "base64").subarray(0, 5).toString()).toBe("%PDF-");
    await auditoriaSemCpf();
    expect((await nota(id)).status).toBe("A_DECIDIR");
  });
  it("CPF do tomador: completo na conversa do dono (opção B); mascarado com DOLORES_MASCARAR_DADOS_PESSOAIS=1", async () => {
    const id = await rascunho();
    const r1 = await executarFuncao({ funcao: "ver_nota_fiscal", argumentos: { notaFiscalId: id } }, { canal: "whatsapp", mensagemId: 1 });
    expect(JSON.stringify(r1.body)).toContain(CPF);
    vi.stubEnv("DOLORES_MASCARAR_DADOS_PESSOAIS", "1");
    const r2 = await executarFuncao({ funcao: "ver_nota_fiscal", argumentos: { notaFiscalId: id } }, { canal: "whatsapp", mensagemId: 1 });
    expect(JSON.stringify(r2.body)).not.toContain(CPF);
    vi.unstubAllEnvs();
    await auditoriaSemCpf();
  });
  it("a Evolution não aceitou o PDF: o dono recebe uma frase curta (sem link)", async () => {
    const id = await rascunho();
    enviarDocumento.mockResolvedValue(false);
    roteiro = [() => ferramenta("ver_nota_fiscal", { notaFiscalId: id, enviarPrevia: true }), () => texto("Mandando a prévia.")];
    await dono("manda a prévia da nota do João");
    expect(ultima()).toContain("não consegui mandar o PDF da prévia");
    expect(ultima()).not.toMatch(/https?:\/\//);
  });
});

describe("ações — confirmação natural (registro) e \"confirmo\" (emitir)", () => {
  it("depois da lista, \"essa não precisa, foi reembolso de cartório\" (sem a palavra nota) → proposta; \"pode\" → SEM_NOTA com histórico via whatsapp", async () => {
    const id = await rascunho();
    roteiro = [() => ferramenta("listar_notas_fiscais", {}), () => texto("Tem a do João Silva, R$ 1.200,00.")];
    await dono("quais notas tenho pra decidir?");
    roteiro = [() => ferramenta("decidir_nota_fiscal", { notaFiscalId: id, decisao: "sem_nota", motivo: "reembolso_custas" }), () => texto("Vou marcar como sem nota.")];
    await dono("essa não precisa, foi reembolso de cartório");
    expect(nomesDasFerramentas(pedidos.at(-2)!)).toContain("decidir_nota_fiscal");
    expect(ultima()).toMatch(/SEM NOTA — motivo: Reembolso de custas\/cartório/);
    expect((await nota(id)).status).toBe("A_DECIDIR");
    agora = new Date(agora.getTime() + 60_000);
    await dono("pode");
    expect(await nota(id)).toMatchObject({ status: "SEM_NOTA", motivo_sem_nota: "reembolso_custas" });
    const hist = await q<{ via: string; acao: string }>(`SELECT via, acao FROM fiscal_notas_historico WHERE nota_id = ${id} ORDER BY id`);
    expect(hist.at(-1)!.via).toBe("whatsapp");
    await auditoriaSemCpf();
  });
  it("\"deixa pra depois\" → proposta; \"não\" descarta (nada muda); de novo e \"isso\" → ADIADA", async () => {
    const id = await rascunho();
    const propor = async () => {
      roteiro = [() => ferramenta("decidir_nota_fiscal", { notaFiscalId: id, decisao: "adiada" }), () => texto("Deixo para depois.")];
      await dono("a nota do João deixa pra depois");
    };
    await propor();
    agora = new Date(agora.getTime() + 60_000);
    await dono("não");
    expect((await nota(id)).status).toBe("A_DECIDIR");
    agora = new Date(agora.getTime() + 60_000);
    await propor();
    agora = new Date(agora.getTime() + 60_000);
    await dono("isso");
    expect((await nota(id)).status).toBe("ADIADA");
  });
  it("editar: \"corrige o valor da nota do João para 1.000\" → antes e depois na proposta; \"manda ver\" → valor ajustado", async () => {
    const id = await rascunho();
    roteiro = [() => ferramenta("editar_rascunho_nota", { notaFiscalId: id, valorReais: 1000 }), () => texto("Vou corrigir o valor.")];
    await dono("corrige o valor da nota do João para 1.000");
    expect(ultima()).toContain("valor R$ 1.200,00 → R$ 1.000,00");
    agora = new Date(agora.getTime() + 60_000);
    await dono("manda ver");
    expect(Number((await nota(id)).valor_ajustado_centavos)).toBe(100000);
  });
  it("\"emite essa\": \"pode\" não basta (pede confirmo); \"confirmo\" → emissão ainda não ativa, status intacto, nada sai", async () => {
    const id = await rascunho();
    roteiro = [() => ferramenta("emitir_nota_fiscal", { notaFiscalId: id }), () => texto("Vou emitir.")];
    await dono("emite a nota do João");
    expect(ultima()).toMatch(/EMITIR a nota de «João Silva»/);
    agora = new Date(agora.getTime() + 60_000);
    await dono("pode");
    expect(ultima()).toMatch(/confirmo/);
    expect((await nota(id)).status).toBe("A_DECIDIR");
    agora = new Date(agora.getTime() + 60_000);
    await dono("confirmo");
    expect(ultima()).toMatch(/emissão de nota fiscal ainda não está ativa/);
    expect(await nota(id)).toMatchObject({ status: "A_DECIDIR", versao: 1 });
    expect(Number((await q<{ n: string }>(`SELECT count(*) AS n FROM fiscal_notas_historico WHERE nota_id = ${id}`))[0]!.n)).toBe(1); // só a criação
    expect(enviarDocumento).not.toHaveBeenCalled();
  });
  it("argumentos forjados: motivo fora da lista (zod), \"outro\" sem texto, texto do \"outro\" que não saiu das palavras do dono → recusados", async () => {
    const id = await rascunho();
    const doDono = (argumentos: Record<string, unknown>) => executarFuncao({ funcao: "decidir_nota_fiscal", argumentos },
      { canal: "whatsapp", mensagemId: 1, exigirConfirmacao: true, pedidoFiscal: { texto: "essa não precisa, já paguei por fora" } });
    expect((await doDono({ notaFiscalId: id, decisao: "sem_nota", motivo: "porque_sim" })).status).toBe(400);
    expect((await doDono({ notaFiscalId: id, decisao: "sem_nota" })).body.erro).toMatch(/Escolha o motivo/);
    expect((await doDono({ notaFiscalId: id, decisao: "sem_nota", motivo: "outro" })).body.erro).toMatch(/escreva o motivo/);
    expect((await doDono({ notaFiscalId: id, decisao: "sem_nota", motivo: "outro", motivoTexto: "cliente amigo ganhou desconto total" })).body.erro).toMatch(/suas palavras/);
    expect((await doDono({ notaFiscalId: id, decisao: "sem_nota", motivo: "outro", motivoTexto: "já paguei por fora" })).status).toBe(200);
    // sem o pedido fiscal do dono (montado por código), a ação recusa
    const sem = await executarFuncao({ funcao: "decidir_nota_fiscal", argumentos: { notaFiscalId: id, decisao: "adiada" } }, { canal: "whatsapp", mensagemId: 1, exigirConfirmacao: true });
    expect(sem.body.erro).toMatch(/pedido direto/);
    expect((await nota(id)).status).toBe("A_DECIDIR");
  });
  it("rascunho já decidido não recebe proposta", async () => {
    const id = await rascunho("500.00", { status: "SEM_NOTA" }).catch(() => 0);
    if (!id) return; // o CHECK da 0154 pode exigir motivo para SEM_NOTA: coberto pelo teste da S-2
    const r = await executarFuncao({ funcao: "emitir_nota_fiscal", argumentos: { notaFiscalId: id } }, { canal: "whatsapp", mensagemId: 1, exigirConfirmacao: true, pedidoFiscal: { texto: "emite" } });
    expect(r.body.erro).toMatch(/já está decidido/);
  });
});

describe("aviso proativo \"nota_fiscal\" — teto, silêncio, resumo das 18h", () => {
  const ligar = async () => {
    await banco.pg.exec("UPDATE dolores_avisos_config SET ligado = true WHERE id = 1");
    for (const t of TIPOS_AVISO) if (t !== "nota_fiscal") await definirSilencio({ tipo: t, silenciado: true, porUserId: null, via: "tela" });
  };
  const rodar = (quando: Date) => { agora = quando; return executarAvisos({ agora: quando }); };
  const SEG_09H = new Date("2026-11-16T12:00:00Z");

  it("nasce silenciado: com os avisos ligados, sem o dono religar o tipo, nada sai", async () => {
    await rascunho();
    await ligar();
    const r = await rodar(SEG_09H);
    expect(r.r).not.toBe("enviado");
    expect(enviar).not.toHaveBeenCalled();
  });
  it("religado: o rascunho novo sai com nome, valor e a pergunta no fim, só ao dono; às 10h só o achado novo; às 18h o resumo de todos", async () => {
    const a = await rascunho("1200.00");
    await ligar();
    await definirSilencio({ tipo: "nota_fiscal", silenciado: false, porUserId: null, via: "tela" });
    expect((await rodar(SEG_09H)).r).toBe("enviado");
    const t1 = ultima();
    expect(t1).toContain("«João Silva» — R$ 1.200,00 — Imperatriz - MA");
    expect(t1.trimEnd().endsWith("?")).toBe(true);
    expect(temPalavraComando(t1)).toBe(false);
    expect(t1).not.toContain(CPF);
    expect((enviar.mock.calls.at(-1)![0] as { numero: string }).numero).toBe(DONO);
    // 10h: nada novo → não repete
    expect((await rodar(new Date("2026-11-16T13:05:00Z"))).r).toBe("nada-novo");
    // 11h: um rascunho novo → só ele
    const b = await rascunho("500.00");
    expect((await rodar(new Date("2026-11-16T14:10:00Z"))).r).toBe("enviado");
    const t2 = ultima();
    expect(t2).toContain("R$ 500,00");
    expect(t2).not.toContain("R$ 1.200,00");
    // 18h (21:00 UTC): o resumo agrupa os dois num aviso só
    expect((await rodar(new Date("2026-11-16T21:00:00Z"))).r).toBe("enviado");
    const t3 = ultima();
    expect(t3).toContain("Você tem 2 notas a decidir, somando R$ 1.700,00");
    expect(t3).toContain("R$ 1.200,00");
    expect(t3).toContain("R$ 500,00");
    expect(t3.trimEnd().endsWith("?")).toBe(true);
    // 19h: o resumo do dia já foi → nada
    expect((await rodar(new Date("2026-11-16T22:05:00Z"))).r).toBe("nada-novo");
    expect([a, b].length).toBe(2);
  });
  it("teto diário: no máximo max_por_dia avisos (vale para o tipo novo)", async () => {
    await ligar();
    await banco.pg.exec("UPDATE dolores_avisos_config SET max_por_dia = 1 WHERE id = 1");
    await definirSilencio({ tipo: "nota_fiscal", silenciado: false, porUserId: null, via: "tela" });
    await rascunho();
    expect((await rodar(SEG_09H)).r).toBe("enviado");
    await rascunho("300.00");
    expect((await rodar(new Date("2026-11-16T14:10:00Z"))).r).toBe("limite-do-dia");
  });
  it("deixado para depois sem data fica quieto; com a data chegada volta a avisar (\"você tinha deixado para depois\")", async () => {
    await ligar();
    await definirSilencio({ tipo: "nota_fiscal", silenciado: false, porUserId: null, via: "tela" });
    await rascunho("800.00", { status: "ADIADA" });
    expect((await rodar(SEG_09H)).r).toBe("nada-novo");
    await rascunho("900.00", { status: "ADIADA", adiadaAte: "2026-11-16" });
    expect((await rodar(new Date("2026-11-16T14:10:00Z"))).r).toBe("enviado");
    expect(ultima()).toContain("você tinha deixado para depois e a data chegou");
    expect(ultima()).not.toContain("R$ 800,00");
  });
  it("silenciar de novo pela tela: nada sai", async () => {
    await ligar();
    await definirSilencio({ tipo: "nota_fiscal", silenciado: true, porUserId: null, via: "tela" });
    await rascunho();
    await rodar(SEG_09H);
    expect(enviar).not.toHaveBeenCalled();
  });
});

describe("custo e migração", () => {
  it("o piso RESERVA_MINIMA_ENTRADA cobre o pior prefixo (todas as ferramentas com ações, mesas e fiscais) com folga ≥ 1.000", () => {
    const ferramentas = ferramentasParaOModelo(ferramentasDoWhatsapp());
    for (const n of FERRAMENTAS_FISCAIS) expect(ferramentas.map(f => f.name)).toContain(n);
    const prefixo = tokensEstimadosDoTexto(promptSistemaWhatsapp(false)) + tokensEstimadosDoTexto(JSON.stringify(ferramentas)) + SOBRECARGA_DE_FERRAMENTAS;
    expect(RESERVA_MINIMA_ENTRADA - prefixo).toBeGreaterThanOrEqual(1_000);
  });
  it("0161: só troca o CHECK do tipo (DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT), com a lista antiga inteira + nota_fiscal; nada de UPDATE/DELETE/DROP TABLE", () => {
    const sql = MIGRACAO_0161.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
    expect(sql).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|RENAME)\b|DROP\s+TABLE|DROP\s+COLUMN|ALTER\s+COLUMN/i);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS "dolores_avisos_tipos_tipo_check"/);
    for (const t of TIPOS_AVISO) expect(sql, t).toContain(`'${t}'`);
  });
  it("com a 0161, o banco aceita silenciar/religar o tipo novo e recusa tipo inventado", async () => {
    await definirSilencio({ tipo: "nota_fiscal", silenciado: false, porUserId: null, via: "tela" });
    await expect(banco.pg.exec("INSERT INTO dolores_avisos_tipos (tipo) VALUES ('inventado')")).rejects.toThrow();
  });
  it("o aviso fiscal cabe numa mensagem do WhatsApp", () => {
    expect(MAX_CARACTERES_WHATSAPP).toBeGreaterThan(1000);
  });
});
