// EPIC-029 S-3b — pendências da revisão independente do S-3 (Dolores no fluxo fiscal), pelo webhook de verdade (PGlite, modelo, relógio,
// envio e documento falsos, rede proibida):
//  1. a mensagem do dono fica "respondida" ANTES da prévia em PDF e a leitura do rascunho tem teto (tempoLimiteMs), com banco lento simulado —
//     e o "mande de novo" de pedido interrompido nunca sai depois que a resposta já saiu;
//  2. TODO campo impresso no PDF passa pelo filtro de saída (teste que percorre os campos impressos, inclusive a cidade do tomador);
//  3. a retomada da tarefa demorada não manda prévia e não promete o PDF (aviso ao modelo + frase fixa por código);
//  4. a prévia e a FRASE_PREVIA_NAO_FOI entram na memória da conversa, sem conteúdo sensível.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../whatsapp-router.js", async orig => ({ ...(await orig<typeof import("../whatsapp-router.js")>()), configEvolution: vi.fn(async () => null) }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));
// banco lento simulado: a leitura do rascunho para a prévia (carregarNota) pode "demorar" (avança o relógio) e ser cancelada pelo banco
vi.mock("../fiscal/notas.js", async orig => {
  const o = await orig<typeof import("../fiscal/notas.js")>();
  return { ...o, carregarNota: vi.fn(o.carregarNota) };
});
// o teto que a prévia passa à transação de leitura e a situação da mensagem do dono NO INSTANTE em que a leitura começa
vi.mock("./somente-leitura.js", async orig => {
  const o = await orig<typeof import("./somente-leitura.js")>();
  return { ...o, emTransacaoSomenteLeitura: vi.fn(o.emTransacaoSomenteLeitura) };
});

import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { carregarNota, type NotaDetalhada } from "../fiscal/notas.js";
import { gerarPreviaPdf } from "../fiscal/previa-pdf.js";
import { lerConfirmacao } from "../../shared/dolores/confirmacao.js";
import { definirSorteioCodigo } from "./aprovacoes.js";
import { AVISO_PREVIA_ACIMA_DO_TETO, AVISO_PREVIA_NA_RETOMADA, FRASE_PREVIA_NA_RETOMADA, MAX_PREVIAS_POR_PEDIDO, definirClienteModelo, type PedidoModelo, type RespostaModelo } from "./cerebro.js";
import { campoPessoal } from "./dados-pessoais.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte } from "./ponte.js";
import { emTransacaoSomenteLeitura } from "./somente-leitura.js";
import { AGORA, CENARIO, MIGRACAO_0153, criarBanco } from "./testes-banco.js";
import { CAMPOS_ESTRUTURADOS_DA_PREVIA, FRASE_PREVIA_NAO_FOI, definirDependenciasWhatsapp, memoriaDaPrevia, notaParaPreviaDaDolores, retomarTarefasDemoradas,
  segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";

const DONO = "5599991234567";
const CPF = "52998224725";
const MIGRACAO_0154 = readFileSync(new URL("../../drizzle/0154_fiscal_notas.sql", import.meta.url), "utf8");
const MIGRACAO_0165 = readFileSync(new URL("../../drizzle/0165_dolores_aviso_fiscal.sql", import.meta.url), "utf8");

let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviar: ReturnType<typeof vi.fn>;
let enviarDocumento: ReturnType<typeof vi.fn>;
let pedidos: PedidoModelo[];
let roteiro: Array<(p: PedidoModelo) => RespostaModelo>;
let agora: Date;
let relogioMs: number;
let fetchVigia: ReturnType<typeof vi.spyOn>;
let logs: string[];
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
let seq = 0;
const ts = (t: string) => Math.floor((agora.getTime() + (lerConfirmacao(t) ? 1_000 : -5_000)) / 1000);
const aviso = (texto: string) => ({ event: "messages.upsert", instance: "prospecta-dolores",
  data: { key: { remoteJid: `${DONO}@s.whatsapp.net`, fromMe: false, id: `S3B${++seq}` }, message: { conversation: texto }, messageTimestamp: ts(texto) } });
const dono = (texto: string) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, body: aviso(texto), ip: "203.0.113.9" } as never);
const uso = { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const ferramenta = (name: string, input: unknown): RespostaModelo => ({ stop_reason: "tool_use", usage: uso, content: [{ type: "tool_use", id: `tu_${++seq}`, name, input }] });
const texto = (t: string): RespostaModelo => ({ stop_reason: "end_turn", usage: uso, content: [{ type: "text", text: t }] });
const enviados = () => enviar.mock.calls.map(c => (c[0] as { texto: string }).texto);
const conversa = () => q<{ papel: string; origem: string; funcao: string | null; texto: string; referencias: unknown }>("SELECT papel, origem, funcao, texto, referencias FROM dolores_conversa ORDER BY id");

/** Um rascunho de nota (origem: um lançamento do BPO do cliente João Silva, CPF no cadastro). */
async function rascunho(): Promise<number> {
  const [l] = await q<{ id: number }>(`INSERT INTO bpo_lancamentos (cliente_id, tipo, descricao, valor, valor_recebido, vencimento, pago, competencia, a_classificar)
    VALUES (2, 'honorario', 'Regularização do imóvel', '1200.00', '1200.00', '2026-11-10', true, '2026-11', false) RETURNING id`);
  const [n] = await q<{ id: number }>(`INSERT INTO fiscal_notas (emissor_id, origem_tipo, origem_id, data_evento, bpo_client_id, status, municipio_incidencia_nome, municipio_incidencia_uf)
    VALUES (1, 'bpo_lancamento', ${l!.id}, '2026-11-10', 2, 'A_DECIDIR', 'Imperatriz', 'MA') RETURNING id`);
  return n!.id;
}

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`
    CREATE TABLE IF NOT EXISTS tax_profiles (id serial PRIMARY KEY, cnpj text, company_name text, regime text, is_active boolean DEFAULT true, effective_from date DEFAULT '2026-01-01', effective_to timestamp); -- S-6: o leitor de perfis (teto.ts#lerPerfis) usa effective_to (coluna real da 0022)
    CREATE TABLE IF NOT EXISTS operational_commissions (id serial PRIMARY KEY, construction_project_id integer, amount numeric, business_type text, property text);`);
  await banco.pg.exec(MIGRACAO_0154);
  await banco.pg.exec(MIGRACAO_0165);
  await banco.pg.exec(MIGRACAO_0153());
  await banco.pg.exec(`
    INSERT INTO tax_profiles (cnpj, company_name, regime) VALUES ('11222333000181', 'Prospecta Construções', 'simples_nacional');
    INSERT INTO fiscal_emissores (cnpj, municipio_nome, municipio_uf) VALUES ('11222333000181', 'Imperatriz', 'MA');
    INSERT INTO bpo_clients (razao_social, cpf, responsavel, telefone, honorarios, data_inicio) VALUES ('João Silva', '${CPF}', 'João', '9999', '0', '2026-01-01');
    UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}', ia_ligada = true,
      limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  esquecerUsuarioDolores();
  agora = new Date(AGORA);
  relogioMs = 1_000_000;
  definirDependenciasPonte({ agora: () => agora });
  enviar = vi.fn(async () => true);
  enviarDocumento = vi.fn(async () => true);
  definirDependenciasWhatsapp({ agora: () => agora, enviar: enviar as never, enviarDocumento: enviarDocumento as never, ms: () => relogioMs });
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
  expect(logs.join("\n")).not.toContain(CPF);
  ENV.cookieSecret = segredoAntes;
  definirDependenciasPonte(); definirDependenciasWhatsapp(); definirClienteModelo(); definirSorteioCodigo();
  vi.mocked(carregarNota).mockReset();
  vi.restoreAllMocks();
});

describe("S-3b item 1 — a resposta é marcada antes da prévia; leitura com teto (banco lento simulado)", () => {
  it("banco lento: a mensagem já está 'respondida' quando a leitura começa, a leitura leva tempoLimiteMs e nunca sai \"mande de novo\"", async () => {
    const id = await rascunho();
    const { carregarNota: real } = await vi.importActual<typeof import("../fiscal/notas.js")>("../fiscal/notas.js");
    const { emTransacaoSomenteLeitura: realTx } = await vi.importActual<typeof import("./somente-leitura.js")>("./somente-leitura.js");
    // registra o teto e a situação da mensagem do dono no instante em que cada transação de leitura começa (fora da transação)
    const leituras: Array<{ tempoLimiteMs: number | undefined; situacao: string; resta: number }> = [];
    vi.mocked(emTransacaoSomenteLeitura).mockImplementation(async (fn, op) => {
      const [m] = await q<{ situacao: string }>("SELECT situacao FROM dolores_mensagens WHERE do_dono ORDER BY id DESC LIMIT 1");
      leituras.push({ tempoLimiteMs: op?.tempoLimiteMs, situacao: m?.situacao ?? "?", resta: prazoDoAviso - relogioMs });
      return realTx(fn, op);
    });
    // o banco "demora" mais que o teto: o relógio passa do prazo do aviso e o próprio banco cancela a consulta
    vi.mocked(carregarNota).mockImplementation(async () => { relogioMs += 60_000; throw new Error("canceling statement due to statement timeout"); });
    const prazoDoAviso = relogioMs + 45_000;
    roteiro = [() => ferramenta("ver_nota_fiscal", { notaFiscalId: id, enviarPrevia: true }), () => texto("Te mando a prévia agora.")];
    await dono("me manda a prévia da nota do João");
    expect(carregarNota).toHaveBeenCalledTimes(1);
    const daPrevia = leituras.at(-1)!;
    // a resposta já saiu e a mensagem já estava marcada quando a leitura lenta começou
    expect(daPrevia.situacao).toBe("respondida");
    expect(daPrevia.tempoLimiteMs).toBeGreaterThanOrEqual(1_000);
    expect(daPrevia.tempoLimiteMs).toBeLessThanOrEqual(5_000);
    expect(daPrevia.tempoLimiteMs!).toBeLessThan(daPrevia.resta);
    expect(enviarDocumento).not.toHaveBeenCalled();
    const [acao] = await q<{ resultado: string; motivo: string }>("SELECT resultado, motivo FROM dolores_acoes WHERE funcao = 'whatsapp_previa_fiscal'");
    expect(acao).toMatchObject({ resultado: "erro" });
    expect(acao!.motivo).toContain("statement timeout");
    // a próxima entrada (qualquer aviso) não reivindica o pedido: nada de "não consegui terminar… mande de novo"
    vi.mocked(carregarNota).mockImplementation(real);
    agora = new Date(agora.getTime() + 10 * 60_000);
    relogioMs += 1_000;
    roteiro = [() => texto("Bom dia!")];
    await dono("bom dia");
    expect(enviados().some(t => /não consegui terminar o pedido|mande de novo/i.test(t))).toBe(false);
    const msgs = await q<{ situacao: string }>("SELECT situacao FROM dolores_mensagens WHERE do_dono ORDER BY id");
    expect(msgs.map(m => m.situacao)).toEqual(["respondida", "respondida"]);
  });

  it("por código: atualizarMensagem(respondida) vem ANTES de enviarPreviasFiscais e a leitura da prévia passa tempoLimiteMs", () => {
    const fonte = readFileSync(new URL("./whatsapp.ts", import.meta.url), "utf8");
    const chamada = fonte.indexOf("await enviarPreviasFiscais(");
    const marca = fonte.lastIndexOf("await atualizarMensagem(msg.id, { situacao: ok ? \"respondida\"", chamada);
    expect(chamada).toBeGreaterThan(0);
    expect(marca).toBeGreaterThan(0);
    expect(fonte.slice(marca, chamada)).not.toContain("return ");
    expect(fonte).toMatch(/emTransacaoSomenteLeitura\(\(\) => carregarNota\(bancoDaLeitura\(\), id\), \{ tempoLimiteMs \}\)/);
  });
});

/** Todo texto da nota (fora dos campos fechados) vira um marcador de segredo único, para achar no PDF o que foi impresso. */
function marcarTextos(nota: NotaDetalhada) {
  const marcadores = new Map<string, string>();
  let n = 0;
  const andar = (v: unknown, caminho: string, chave: string | null): unknown => {
    if (typeof v === "string") {
      if (CAMPOS_ESTRUTURADOS_DA_PREVIA.has(caminho)) return v;
      const m = `Qz${++n}Kw7RtLmPx`; // longo o bastante para nunca virar um CPF/CNPJ formatado no PDF
      marcadores.set(m, caminho);
      return `senha: ${m}`;
    }
    if (Array.isArray(v)) return v.map((x, i) => andar(x, `${caminho}[${i}]`, null));
    if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, andar(x, caminho ? `${caminho}.${k}` : k, k)]));
    }
    return v;
  };
  return { nota: andar(nota, "", null) as NotaDetalhada, marcadores };
}
const textoDoPdf = (b: Uint8Array) => Buffer.from(b).toString("latin1");

describe("S-3b item 2 — todo campo impresso no PDF passa pelo filtro de saída", () => {
  it("percorre os campos impressos: com os marcadores, o PDF cru mostra cada um; o da Dolores, nenhum (inclusive tomador.cidade)", async () => {
    const id = await rascunho();
    const real = await (await vi.importActual<typeof import("../fiscal/notas.js")>("../fiscal/notas.js")).carregarNota(banco.db as never, id);
    // tudo o que o PDF pode imprimir, preenchido (cidade do tomador, obra, códigos, decisão "não emitir", ajuste de valor)
    const cheia: NotaDetalhada = {
      ...real, status: "SEM_NOTA", motivoSemNota: "reembolso_custas", motivoTexto: "texto", valorAjustadoCentavos: 100_000, tomadorMudouNaOrigem: true,
      tomador: { ...real.tomador, nome: "nome", documento: "doc", cidade: "cidade", uf: "uf" },
      obra: { id: 1, titulo: "titulo", cidade: "cidade", uf: "uf" },
      emissor: { id: 1, cnpj: "cnpj", razaoSocial: "razao", regime: "regime", municipioNome: "municipio", municipioUf: "uf", ambiente: "homologacao" },
      tipoServico: { id: 1, nome: "nome", codigoTributacaoNacional: "ctn", codigoNbs: "nbs", itemLc116: "lc", codigoAtividadeSimples: "cas", aliquotaIss: "ali", descricaoPadrao: "dp" },
      municipio: { nome: "municipio", uf: "uf", fonte: "ajuste" },
      origem: { ...real.origem!, descricao: "desc", competencia: "comp", centroCustos: "cc", tomadorNomeOrigem: "tno" },
      descricao: "descricao", origemRotulo: "rotulo",
    };
    const { nota: marcada, marcadores } = marcarTextos(cheia);
    const cru = textoDoPdf(gerarPreviaPdf(marcada, AGORA));
    const impressos = [...marcadores].filter(([m]) => cru.includes(m)).map(([, caminho]) => caminho);
    // o teste é sensível: os campos que a revisão apontou (e os demais impressos) aparecem no PDF cru
    for (const c of ["tomador.cidade", "tomador.uf", "tomador.nome", "tomador.documento", "emissor.razaoSocial", "emissor.cnpj", "emissor.regime",
      "emissor.municipioNome", "tipoServico.nome", "tipoServico.codigoTributacaoNacional", "tipoServico.itemLc116", "tipoServico.codigoNbs",
      "municipio.nome", "obra.titulo", "obra.cidade", "origem.competencia", "origem.centroCustos", "descricao", "motivoTexto", "origemRotulo"]) {
      expect(impressos, c).toContain(c);
    }
    const daDolores = textoDoPdf(gerarPreviaPdf(notaParaPreviaDaDolores(marcada, campoPessoal), AGORA));
    const vazados = [...marcadores].filter(([m]) => daDolores.includes(m)).map(([, caminho]) => caminho);
    expect(vazados).toEqual([]);
    // e nenhum texto da nota fica fora do filtro (nem o que hoje não é impresso)
    const saida = JSON.stringify(notaParaPreviaDaDolores(marcada, campoPessoal));
    expect([...marcadores.keys()].filter(m => saida.includes(m))).toEqual([]);
  });

  it("os campos fechados continuam intactos e o CPF do tomador segue o interruptor (opção B: completo; =1: mascarado)", async () => {
    const id = await rascunho();
    const real = await (await vi.importActual<typeof import("../fiscal/notas.js")>("../fiscal/notas.js")).carregarNota(banco.db as never, id);
    const filtrada = notaParaPreviaDaDolores(real, campoPessoal);
    expect(filtrada.status).toBe(real.status);
    expect(filtrada.dataEvento).toBe(real.dataEvento);
    expect(filtrada.municipio.fonte).toBe(real.municipio.fonte);
    expect(filtrada.tomador.documento).toBe(CPF);
    expect(textoDoPdf(gerarPreviaPdf(filtrada, AGORA))).toContain("529.982.247-25");
    vi.stubEnv("DOLORES_MASCARAR_DADOS_PESSOAIS", "1");
    try {
      const mascarada = notaParaPreviaDaDolores(real, campoPessoal);
      expect(mascarada.tomador.documento).not.toContain(CPF);
      expect(textoDoPdf(gerarPreviaPdf(mascarada, AGORA))).not.toContain("529.982.247-25");
    } finally { vi.unstubAllEnvs(); }
  });
});

describe("S-3b item 3 — retomada da tarefa demorada: a prévia não vai e a Dolores não promete o PDF", () => {
  it("o modelo pede enviarPrevia na retomada: nenhum documento, o resultado diz que não vai e a resposta leva a frase fixa", async () => {
    const id = await rascunho();
    await banco.pg.exec(`INSERT INTO dolores_mensagens (instancia, external_id, remetente, do_dono, situacao, texto) VALUES ('prospecta-dolores', 'td1', '(sem número)', true, 'respondida', 'pedido')`).catch(async () =>
      banco.pg.exec(`INSERT INTO dolores_mensagens (instancia, external_id, remetente, do_dono, situacao) VALUES ('prospecta-dolores', 'td1', '(sem número)', true, 'respondida')`));
    const [m] = await q<{ id: number }>("SELECT id FROM dolores_mensagens WHERE external_id = 'td1'");
    const iso = (ms: number) => new Date(AGORA.getTime() + ms).toISOString();
    await banco.pg.exec(`INSERT INTO dolores_tarefas_demoradas (dia, expira_em, mensagem_id, comando, criado_em) VALUES ('2026-11-16', '${iso(30 * 60_000)}', ${m!.id}, 'me faz um levantamento das obras', '${iso(-60_000)}')`);
    // a conversa recente citou o rascunho (abre as leituras fiscais na retomada)
    await banco.pg.exec(`INSERT INTO dolores_conversa (papel, origem, texto, criado_em, referencias) VALUES ('sistema', 'aviso', 'Aviso de notas a decidir.', '${iso(-30_000)}',
      '[{"tipo":"nota_fiscal","id":${id},"rotulo":"rascunho de nota nº ${id}"}]'::jsonb)`);
    roteiro = [() => ferramenta("ver_nota_fiscal", { notaFiscalId: id, enviarPrevia: true }), () => texto("Levantamento pronto. Estou mandando a prévia da nota.")];
    const r = await retomarTarefasDemoradas({ prazoFinal: relogioMs + 60_000, canal: "cron" });
    expect(r).toBe("concluida");
    expect(pedidos[0]!.ferramentas.map(f => f.name)).toContain("ver_nota_fiscal");
    const resultado = JSON.parse((pedidos[1]!.mensagens.at(-1)!.content.at(-1) as { content: string }).content);
    expect(resultado.dados.previaFiscal).toBeUndefined();
    expect(resultado.dados.aviso).toBe(AVISO_PREVIA_NA_RETOMADA);
    expect(enviarDocumento).not.toHaveBeenCalled();
    const resposta = enviados().join("\n");
    expect(resposta).toContain(FRASE_PREVIA_NA_RETOMADA);
    expect(await q("SELECT 1 FROM dolores_acoes WHERE funcao = 'whatsapp_previa_fiscal'")).toHaveLength(0);
  });
});

describe("QA S-3b — teto de prévias por pedido", () => {
  it("passado o MAX_PREVIAS_POR_PEDIDO, o modelo não lê \"o sistema manda o PDF\" e só as prévias dentro do teto vão", async () => {
    const ids = [await rascunho(), await rascunho(), await rascunho()];
    expect(MAX_PREVIAS_POR_PEDIDO).toBe(2);
    roteiro = [...ids.map(id => () => ferramenta("ver_nota_fiscal", { notaFiscalId: id, enviarPrevia: true })), () => texto("Mando as prévias que couberem.")];
    await dono("me manda a prévia das notas do João");
    const resultado = (i: number) => JSON.parse((pedidos[i + 1]!.mensagens.at(-1)!.content.at(-1) as { content: string }).content);
    expect(resultado(0).dados.previaFiscal).toBe(ids[0]);
    expect(resultado(1).dados.previaFiscal).toBe(ids[1]);
    expect(resultado(2).dados.previaFiscal).toBeUndefined();
    expect(resultado(2).dados.aviso).toBe(AVISO_PREVIA_ACIMA_DO_TETO);
    expect(enviarDocumento.mock.calls.map(c => (c[0] as { nome: string }).nome)).toEqual([`previa-nota-${ids[0]}.pdf`, `previa-nota-${ids[1]}.pdf`]);
  });
});

describe("S-3b item 4 — a prévia e a frase de que não foi entram na memória, sem conteúdo sensível", () => {
  it("prévia enviada: uma linha do sistema com só o número do rascunho (sem nome, CPF ou valor) e a referência nota_fiscal", async () => {
    const id = await rascunho();
    roteiro = [() => ferramenta("ver_nota_fiscal", { notaFiscalId: id, enviarPrevia: true }), () => texto("Te mando a prévia agora.")];
    await dono("me manda a prévia da nota do João");
    expect(enviarDocumento).toHaveBeenCalledTimes(1);
    const linhas = (await conversa()).filter(l => l.funcao === "whatsapp_previa_fiscal");
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ papel: "sistema", origem: "aviso", texto: memoriaDaPrevia([id]) });
    expect(linhas[0]!.texto).not.toMatch(/João|52998|1\.200|R\$/);
    expect(linhas[0]!.referencias).toEqual([{ tipo: "nota_fiscal", id, rotulo: "rascunho de nota fiscal" }]);
  });

  it("a Evolution não aceitou o PDF: a FRASE_PREVIA_NAO_FOI vai ao dono e entra na memória (a prévia não)", async () => {
    const id = await rascunho();
    enviarDocumento.mockResolvedValue(false);
    roteiro = [() => ferramenta("ver_nota_fiscal", { notaFiscalId: id, enviarPrevia: true }), () => texto("Mandando a prévia.")];
    await dono("manda a prévia da nota do João");
    expect(enviados().at(-1)).toBe(FRASE_PREVIA_NAO_FOI);
    const linhas = (await conversa()).filter(l => l.funcao === "whatsapp_previa_fiscal");
    expect(linhas.map(l => l.texto)).toEqual([FRASE_PREVIA_NAO_FOI]);
    expect(JSON.stringify(await conversa())).not.toContain(CPF);
  });
});
