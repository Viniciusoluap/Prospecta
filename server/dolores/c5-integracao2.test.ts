// EPIC-027 C5 — integração 2: avisos proativos (C5-E4) + criadora de mesas (C5-MESAS) + mesa comercial (C5-COM), juntas sobre o
// pacote que já tinha as correções do portão (alerta pendente, regra única de proposta aberta, M1 do total comprometido, memória longa).
// Testes CRUZADOS (o que nenhuma frente testava sozinha). Banco em memória (PGlite), modelo, IA dos avisos e envio falsos, sem rede.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { lerConfirmacao } from "../../shared/dolores/confirmacao.js";
import { ACOES } from "./acoes/registro.js";
import { ferramentasDoCliente } from "./atendimento.js";
import { definirSorteioCodigo } from "./aprovacoes.js";
import { definirDependenciasAvisos, executarAvisos, type PedidoAviso, type RespostaAviso } from "./avisos.js";
import { ACOES_DE_MESA, definirClienteModelo, type PedidoModelo, type RespostaModelo } from "./cerebro.js";
import { FUNCOES, LEITURAS_DO_DONO } from "./funcoes.js";
import { ACOES_DO_GRUPO } from "./grupo-pedido-dono.js";
import { hashDaPlanta } from "./maquete-lote.js";
import { LEITURAS_DO_GRUPO, LEITURAS_DO_PARCEIRO, LEITURAS_INTERNAS, executarLeituraInterna } from "./marcacao.js";
import { definirEnvioDosAlertas, enviarAlertasPendentes, registrarAlertasDevidos } from "./operacao-gasto.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte, executarFuncao, ferramentasDaConversa, ferramentasLiberadas } from "./ponte.js";
import { definirRelogioCron, tratarCronAvisos, tratarCronDolores } from "./rondas.js";
import { CENARIO, criarBanco } from "./testes-banco.js";
import { criarTabelasDaMaquete } from "./testes-maquete.js";
import { definirDependenciasWhatsapp, retomarTarefasDemoradas, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";
import { FECHO_DA_TAREFA } from "./tarefa-demorada.js";
import { AVISO_REURB, FUNCAO_REURB } from "../../shared/dolores/reurb-conhecimento.js";

const DONO = "5599991234567";
const SITE = "https://www.prospectaconstrucoes.com";
const SEGREDO_CRON = "segredo-do-cron-de-teste-int2-0123456789";
/** Segunda-feira, 16/11/2026, 09:00 de Brasília (12:00 UTC): dentro da janela dos avisos. */
const SEG_9H = new Date("2026-11-16T12:00:00Z");
const hora = (iso: string) => new Date(iso);
const SO_DO_DONO = ["analisar_regularizacao_reurb", "listar_mesas", "consultar_maquete_lote", "listar_maquetes_lotes", "rascunhar_mensagem_lote"];
const MEMORIA = "Margem alvo secreta de dezoito por cento";
const PROPOSTA = {
  titulo: "Obras paradas toda segunda", objetivo: "Avisar o dono toda segunda quais obras estão paradas há mais de 7 dias",
  quandoAge: "Toda segunda de manhã", le: ["listar_obras"], escreve: ["criar_tarefa"], funcoesNovas: ["ronda semanal das obras paradas"],
  quemAprova: "nao_precisa", exemplosBons: ["Lista as obras paradas"], exemplosRuins: ["Mandar mensagem ao empreiteiro"], riscos: ["Obra já retomada"], custo: "baixa",
};

let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviar: ReturnType<typeof vi.fn>;
let agora: Date;
let pedidosModelo: PedidoModelo[];
let roteiro: Array<(p: PedidoModelo) => RespostaModelo>;
const segredoAntes = ENV.cookieSecret;
const siteAntes = process.env.PUBLIC_SITE_URL;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
const ligarAvisos = (extra = "") => banco.pg.exec(`UPDATE dolores_avisos_config SET ligado = true${extra ? `, ${extra}` : ""} WHERE id = 1`);
const mensagens = () => enviar.mock.calls.map(c => c[0] as { numero: string; texto: string });
const avisosEnviados = () => mensagens().filter(m => m.texto.includes("Dolores — avisos de"));

let seq = 0;
const ts = (t: string) => Math.floor((agora.getTime() + (lerConfirmacao(t) ? 1_000 : -5_000)) / 1000);
const doDono = (texto: string) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, ip: "203.0.113.9",
  body: { event: "messages.upsert", instance: "prospecta-dolores", data: { key: { remoteJid: `${DONO}@s.whatsapp.net`, fromMe: false, id: `INT2M${++seq}` }, message: { conversation: texto }, messageTimestamp: ts(texto) } } } as never);
const uso = { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const ferramenta = (name: string, input: unknown): RespostaModelo => ({ stop_reason: "tool_use", usage: uso, content: [{ type: "tool_use", id: `tu_${name}_${++seq}`, name, input }] });
const textoModelo = (t: string): RespostaModelo => ({ stop_reason: "end_turn", usage: uso, content: [{ type: "text", text: t }] });
const iaDosAvisos = (resposta: (p: PedidoAviso) => Partial<RespostaAviso> | Promise<Partial<RespostaAviso>>) => {
  const pedidos: PedidoAviso[] = [];
  definirDependenciasAvisos({ cliente: async p => { pedidos.push(p); const r = await resposta(p); return { texto: "", parada: "end_turn", uso: { entrada: 900, saida: 120, cacheEscrita: 0, cacheLeitura: 0 }, ...r }; } });
  return pedidos;
};
const abrirPropostaNaMao = (venceIso = "2026-11-16 12:10:00+00") => banco.pg.exec(`INSERT INTO dolores_conversa_pendencia (vence_em, aprovacao_ids, nivel, situacao, adjacente, pergunta_enviada_em, criado_em)
  VALUES ('${venceIso}', '{1}', 'registro', 'aberta', true, '2026-11-16 11:58:00+00', '2026-11-16 11:58:00+00')`);

async function semearMaquete() {
  await criarTabelasDaMaquete(banco.pg);
  await banco.pg.exec(`
    INSERT INTO maquetes_3d (token, titulo, origem, fonte_slug, itens_versao_publicada) VALUES ('tok-planta-1', 'Lote 4 Qd 18', 'fonte', 'lote4-qd18', 1);
    INSERT INTO maquete_3d_itens (maquete_id, versao, itens, quantidade, modelo_versao, estrutura_hash, situacao, publicada_em)
      VALUES (1, 1, '[]', 0, 1, '${hashDaPlanta("lote4-qd18")}', 'publicada', now());
    INSERT INTO maquete_3d_lotes (empreendimento_slug, lote_slug, maquete_id, unit_id, codigo_link, empreendimento_nome, quadra, lote_numero, ativo) VALUES
      ('vila-esmeralda', 'qd18-lote4', 1, NULL, 'k3m9x2pq7a', 'Vila Esmeralda', '18', '4', true),
      ('vila-esmeralda', 'qd18-lote5', 1, NULL, NULL, 'Vila Esmeralda', '18', '5', true);`);
}

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}', ia_ligada = true,
    limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-int2-0123456789";
  process.env.PUBLIC_SITE_URL = SITE;
  vi.stubEnv("CRON_SECRET", SEGREDO_CRON);
  esquecerUsuarioDolores();
  agora = new Date(SEG_9H);
  definirDependenciasPonte({ agora: () => agora });
  enviar = vi.fn(async () => true);
  definirDependenciasWhatsapp({ agora: () => agora, enviar: enviar as never });
  let sorteio = 0;
  definirSorteioCodigo(() => ((sorteio++ * 5) % 22) / 22 + 0.001);
  vi.mocked(configuracaoAnthropicPainel).mockResolvedValue({ apiKey: "sk-ant-chave-de-teste-nao-real-123456", modelo: "modelo-do-painel" });
  pedidosModelo = [];
  roteiro = [];
  definirClienteModelo(async p => {
    pedidosModelo.push(JSON.parse(JSON.stringify(p)));
    const passo = roteiro.shift();
    if (!passo) throw new Error("roteiro do modelo acabou");
    return passo(p);
  });
});
afterEach(() => {
  ENV.cookieSecret = segredoAntes;
  if (siteAntes === undefined) delete process.env.PUBLIC_SITE_URL; else process.env.PUBLIC_SITE_URL = siteAntes;
  vi.unstubAllEnvs();
  definirDependenciasPonte(); definirDependenciasWhatsapp(); definirClienteModelo(); definirSorteioCodigo(); definirDependenciasAvisos(); definirEnvioDosAlertas(null); definirRelogioCron();
  vi.restoreAllMocks();
});

describe("integração 2 — aviso proativo × proposta de mesa ou de maquete aberta", () => {
  it("proposta de MESA esperando o \"pode\": o aviso espera; decidida, ele sai", async () => {
    await ligarAvisos();
    roteiro.push(() => ferramenta("propor_mesa", PROPOSTA), () => textoModelo("Vou registrar a proposta dessa mesa."));
    agora = hora("2026-11-16T11:59:00Z");
    await doDono("cria uma mesa para acompanhar as obras paradas toda segunda");
    expect((await q("SELECT situacao, adjacente FROM dolores_conversa_pendencia"))).toEqual([{ situacao: "aberta", adjacente: true }]);
    const antes = mensagens().length;
    agora = SEG_9H;
    expect((await executarAvisos({ agora })).r).toBe("proposta-aberta");
    expect(mensagens()).toHaveLength(antes);
    expect(await q("SELECT id FROM dolores_avisos_envios")).toEqual([]);
    // o "pode" do dono continua valendo (o aviso não tirou a proposta de ordem)
    agora = hora("2026-11-16T12:01:00Z");
    await doDono("pode");
    expect((await q<any>("SELECT situacao FROM dolores_mesas_propostas WHERE origem = 'conversa'")).map(r => r.situacao)).toEqual([expect.stringMatching(/rascunho|aguardando/)]);
    agora = hora("2026-11-16T12:02:00Z");
    expect((await executarAvisos({ agora })).r).toBe("enviado");
    expect(avisosEnviados()).toHaveLength(1);
  });

  it("proposta de LINK DA MAQUETE esperando o \"pode\": o aviso espera; depois do \"pode\", o link existe e o aviso sai", async () => {
    await semearMaquete();
    await ligarAvisos();
    roteiro.push(() => ferramenta("gerar_link_maquete_lote", { loteId: 2 }), () => textoModelo("Vou gerar o link da maquete do Lote 5."));
    agora = hora("2026-11-16T11:59:00Z");
    await doDono("gera o link da maquete do lote 5 da quadra 18");
    agora = SEG_9H;
    expect((await executarAvisos({ agora })).r).toBe("proposta-aberta");
    expect(avisosEnviados()).toHaveLength(0);
    agora = hora("2026-11-16T12:01:00Z");
    await doDono("pode");
    expect((await q<any>("SELECT codigo_link FROM maquete_3d_lotes WHERE id = 2"))[0].codigo_link).toMatch(/^[a-z0-9]{10}$/);
    agora = hora("2026-11-16T12:02:00Z");
    expect((await executarAvisos({ agora })).r).toBe("enviado");
  });

  it("proposta aberta NO MEIO (enquanto a IA redigia): o aviso não sai e a vaga é devolvida (não conta no teto do dia)", async () => {
    await ligarAvisos("ia_no_texto = true");
    iaDosAvisos(async () => { await abrirPropostaNaMao(); return { texto: "Bom dia. A obra Casa Ana está atrasada." }; });
    expect((await executarAvisos({ agora: SEG_9H })).r).toBe("proposta-aberta");
    expect(avisosEnviados()).toHaveLength(0);
    expect(mensagens()).toHaveLength(0);
    expect(await q("SELECT id FROM dolores_avisos_envios")).toEqual([]);
  });
});

describe("integração 2 — leituras só do dono (mesas e maquete): mecanismo único", () => {
  it("todas em LEITURAS_DO_DONO, com a marca, fora de FUNCOES e das ferramentas da ponte; presentes só na conversa do dono", () => {
    // EPIC-029 S-3: + as duas leituras fiscais (mesmo mecanismo; cobertas em s3-fiscal.test.ts — só vão ao modelo com o assunto fiscal)
    expect(LEITURAS_DO_DONO.map(f => f.nome).sort()).toEqual([...SO_DO_DONO, "listar_notas_fiscais", "ver_nota_fiscal"].sort());
    for (const f of LEITURAS_DO_DONO) {
      expect(f.soConversaDoDono, f.nome).toBe(true);
      expect(FUNCOES.some(x => x.nome === f.nome), f.nome).toBe(false);
    }
    expect(FUNCOES.some(f => f.soConversaDoDono)).toBe(false);
    const ponte = ferramentasLiberadas().map(f => f.name);
    for (const n of SO_DO_DONO) expect(ponte).not.toContain(n);
    expect(ferramentasDaConversa().map(f => f.name)).toEqual(expect.arrayContaining(SO_DO_DONO));
  });

  it("ponte HTTP e WhatsApp sem a mensagem do dono: 403 antes de olhar a etapa", async () => {
    await semearMaquete();
    for (const funcao of SO_DO_DONO) {
      for (const opcoes of [{ canal: "ponte" as const }, { canal: "whatsapp" as const }]) {
        const r = await executarFuncao({ funcao, argumentos: { busca: "lote 4 da quadra 18", loteId: 1 } }, opcoes);
        expect(r.status, `${funcao} ${opcoes.canal}`).toBe(403);
        expect(JSON.stringify(r.body)).toMatch(/só na conversa direta do dono/);
        expect(JSON.stringify(r.body)).not.toContain("k3m9x2pq7a");
      }
    }
  });

  it("grupos (internos, cliente, parceiros), atendimento ao cliente e o pedido do dono no grupo (E3) não as alcançam", async () => {
    await semearMaquete();
    for (const n of SO_DO_DONO) {
      for (const [tipo, lista] of Object.entries(LEITURAS_INTERNAS)) expect(lista, `${tipo} ${n}`).not.toContain(n);
      expect(LEITURAS_DO_GRUPO.map(f => f.nome)).not.toContain(n);
      expect(LEITURAS_DO_PARCEIRO.map(f => f.nome)).not.toContain(n);
      expect(ferramentasDoCliente().map(f => f.name)).not.toContain(n);
      expect(ACOES_DO_GRUPO as readonly string[]).not.toContain(n);
      for (const tipo of Object.keys(LEITURAS_INTERNAS) as Array<keyof typeof LEITURAS_INTERNAS>) {
        const r = await executarLeituraInterna(tipo, n, { busca: "lote 4 da quadra 18", loteId: 1 }, { agora, grupoId: 1, marcacaoId: 1, autor: null });
        expect(r.ok, `${tipo} ${n}`).toBe(false);
        expect(JSON.stringify(r.corpo)).not.toContain("k3m9x2pq7a");
      }
    }
    // E3 (pedido do dono feito no grupo): o fluxo não usa a porta das leituras nem a lista das só do dono
    const e3 = readFileSync(new URL("./grupo-pedido-dono.ts", import.meta.url), "utf8");
    expect(e3).not.toMatch(/executarFuncao|LEITURAS_DO_DONO|leituraPorNome|ferramentasDaConversa|ferramentasDoWhatsapp/);
    for (const n of [...SO_DO_DONO, ...ACOES_DE_MESA, "gerar_link_maquete_lote"]) expect(e3).not.toContain(n);
  });

  it("ações de mesa só são oferecidas com o pedido de mesa por código; a leitura listar_mesas fica sempre", async () => {
    roteiro.push(() => textoModelo("Certo."));
    await doDono("crie uma tarefa para a Bianca ligar para a Maria amanhã");
    const nomes = (pedidosModelo[0].ferramentas as Array<{ name: string }>).map(f => f.name);
    for (const n of ACOES_DE_MESA) expect(nomes).not.toContain(n);
    expect(nomes).toEqual(expect.arrayContaining(["criar_tarefa", "listar_mesas", "consultar_maquete_lote", "gerar_link_maquete_lote", "silenciar_aviso"]));
    roteiro.push(() => textoModelo("Vou registrar."));
    agora = hora("2026-11-16T12:05:00Z");
    await doDono("cria uma mesa para acompanhar as obras paradas toda segunda");
    const comMesa = (pedidosModelo.at(-1)!.ferramentas as Array<{ name: string }>).map(f => f.name);
    for (const n of ACOES_DE_MESA) expect(comMesa).toContain(n);
  });
});

describe("integração 2 — memória de longo prazo e custo por parte", () => {
  it("memória de longo prazo não entra no pedido à IA que redige o aviso proativo, nem no texto enviado", async () => {
    await banco.pg.exec(`INSERT INTO dolores_memoria_longa (texto, categoria, origem) VALUES ('${MEMORIA}', 'fato_negocio', 'tela')`);
    await ligarAvisos("ia_no_texto = true");
    const pedidos = iaDosAvisos(() => ({ texto: "Bom dia. A obra Casa Ana está com atraso e há documentos pendentes. Se não quiser mais um desses avisos, me diga." }));
    expect((await executarAvisos({ agora: SEG_9H }))).toMatchObject({ r: "enviado", comIa: true });
    expect(pedidos).toHaveLength(1);
    expect(JSON.stringify(pedidos[0])).not.toMatch(/Margem alvo|dezoito/);
    expect(JSON.stringify(mensagens())).not.toMatch(/Margem alvo|dezoito/);
  });

  it("custo: o texto dos avisos conta em \"avisos\"; mesas e maquete (conversa do dono) contam em \"conversa\"", async () => {
    await semearMaquete();
    await ligarAvisos("ia_no_texto = true");
    iaDosAvisos(() => ({ texto: "Bom dia. A obra Casa Ana está com atraso. Se não quiser mais um desses avisos, me diga." }));
    expect((await executarAvisos({ agora: SEG_9H })).r).toBe("enviado");
    roteiro.push(() => ferramenta("listar_mesas", {}), () => textoModelo("Você não pediu mesa nenhuma ainda."));
    agora = hora("2026-11-16T12:10:00Z");
    await doDono("quais mesas eu pedi?");
    roteiro.push(() => ferramenta("consultar_maquete_lote", { busca: "lote 4 da quadra 18" }), () => textoModelo("Segue o link."));
    agora = hora("2026-11-16T12:12:00Z");
    await doDono("me manda o link da maquete do lote 4 da quadra 18");
    const linhas = await q<{ funcao: string; n: number }>("SELECT funcao, count(*)::int AS n FROM dolores_consumo GROUP BY funcao ORDER BY funcao");
    expect(linhas).toEqual([{ funcao: "avisos", n: 1 }, { funcao: "conversa", n: 4 }]);
  });
});

describe("integração 2 — alerta de gasto único com as duas frentes ligadas", () => {
  const alertas: string[] = [];
  beforeEach(() => {
    alertas.length = 0;
    definirEnvioDosAlertas(async t => { alertas.push(t); return { ok: true, motivo: null, tentou: true }; });
  });
  const cron = (iso: string) => ({ headers: { authorization: `Bearer ${SEGREDO_CRON}` } }) as never;

  it("um alerta pendente sai UMA vez, por um caminho só, mesmo com o cron da tarde, o da manhã e o fim do aviso; o aviso proativo não repete o gasto", async () => {
    await ligarAvisos();
    // grupos a 85% da parte dela (10% de 1.000.000)
    await banco.pg.exec("INSERT INTO dolores_consumo (mes, modelo, volta, tokens_entrada, tokens_saida, funcao, parada) VALUES ('2026-11', 'm', 1, 85000, 0, 'grupos', 'grupo:end_turn')");
    expect(await registrarAlertasDevidos("2026-11")).toEqual([{ alvo: "grupos", nivel: 80 }]);
    expect(await registrarAlertasDevidos("2026-11")).toEqual([]);
    agora = hora("2026-11-16T18:05:00Z");
    definirRelogioCron({ agora: () => agora });
    expect((await tratarCronAvisos(cron("15h"))).body).toMatchObject({ ok: true, avisos: "enviado" });
    expect(alertas).toHaveLength(1);
    agora = hora("2026-11-16T19:05:00Z");
    await tratarCronAvisos(cron("16h"));
    agora = hora("2026-11-17T10:05:00Z");
    await tratarCronDolores(cron("07h"));
    await enviarAlertasPendentes({ prazoFinal: Date.now() + 20_000, canal: "whatsapp", agora, mes: "2026-11" });
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toMatch(/aviso de gasto/);
    for (const m of avisosEnviados()) expect(m.texto).not.toMatch(/aviso de gasto|gasto da IA/);
  });

  it("com proposta aberta o alerta espera junto com o aviso; vencida, cada um sai uma vez", async () => {
    await ligarAvisos();
    await banco.pg.exec("INSERT INTO dolores_consumo (mes, modelo, volta, tokens_entrada, tokens_saida, funcao, parada) VALUES ('2026-11', 'm', 1, 85000, 0, 'grupos', 'grupo:end_turn')");
    await registrarAlertasDevidos("2026-11");
    await abrirPropostaNaMao();
    agora = SEG_9H;
    definirRelogioCron({ agora: () => agora });
    expect((await tratarCronAvisos(cron("x"))).body).toMatchObject({ avisos: "proposta-aberta" });
    expect(alertas).toHaveLength(0);
    agora = hora("2026-11-16T12:15:00Z");
    expect((await tratarCronAvisos(cron("x"))).body).toMatchObject({ avisos: "enviado" });
    expect(alertas).toHaveLength(1);
    expect(avisosEnviados()).toHaveLength(1);
  });

  it("tipo \"gasto\" silenciado: o 80% (registrado antes do silêncio ou depois) não sai; o 100% sai uma vez", async () => {
    await banco.pg.exec("INSERT INTO dolores_consumo (mes, modelo, volta, tokens_entrada, tokens_saida, funcao, parada) VALUES ('2026-11', 'm', 1, 85000, 0, 'grupos', 'grupo:end_turn')");
    expect(await registrarAlertasDevidos("2026-11")).toEqual([{ alvo: "grupos", nivel: 80 }]); // antes do silêncio
    await banco.pg.exec("INSERT INTO dolores_avisos_tipos (tipo, silenciado) VALUES ('gasto', true)");
    expect(await enviarAlertasPendentes({ prazoFinal: Date.now() + 20_000, canal: "cron", agora: SEG_9H, mes: "2026-11" })).toEqual([]);
    expect(alertas).toHaveLength(0);
    await banco.pg.exec("INSERT INTO dolores_consumo (mes, modelo, volta, tokens_entrada, tokens_saida, funcao, parada) VALUES ('2026-11', 'm', 1, 20000, 0, 'grupos', 'grupo:end_turn')");
    expect(await registrarAlertasDevidos("2026-11")).toEqual([{ alvo: "grupos", nivel: 100 }]);
    expect(await enviarAlertasPendentes({ prazoFinal: Date.now() + 20_000, canal: "cron", agora: SEG_9H, mes: "2026-11" })).toEqual([{ alvo: "grupos", nivel: 100 }]);
    expect(await enviarAlertasPendentes({ prazoFinal: Date.now() + 20_000, canal: "cron", agora: SEG_9H, mes: "2026-11" })).toEqual([]);
    expect(alertas).toHaveLength(1);
    expect((await q<any>("SELECT count(*)::int AS n FROM dolores_gasto_alertas WHERE enviado_em IS NULL"))[0].n).toBe(0);
  });
});

it("ações novas das três frentes classificadas (nenhuma sem nível), registradas uma vez", () => {
  const nomes = ACOES.map(a => a.nome);
  for (const n of ["silenciar_aviso", "gerar_link_maquete_lote", "propor_mesa", "revisar_mesa", "propor_aprovacao_mesa", "recusar_mesa"]) expect(nomes.filter(x => x === n), n).toHaveLength(1);
});

// ── Tarefa demorada (epic027-c5longa) × mesas, maquete, avisos e REURB ──────────────────────────────────────────────────────────
describe("integração 2 — tarefa demorada (retomada em segundo plano, só leitura)", () => {
  /** Grava a mensagem do dono e a tarefa aguardando, como whatsapp.ts#tratarComando grava (o comando é o texto dele). */
  async function tarefaDoDono(comando: string) {
    const [m] = (await banco.pg.query<{ id: number }>(`INSERT INTO dolores_mensagens (instancia, external_id, remetente, do_dono, situacao) VALUES ('prospecta-dolores', 'TD-INT2-${++seq}', '${DONO}', true, 'respondida') RETURNING id`)).rows;
    await banco.pg.exec(`INSERT INTO dolores_tarefas_demoradas (mensagem_id, comando, dia, criado_em, expira_em) VALUES (${m.id}, '${comando.replace(/'/g, "''")}', '2026-11-16', '${agora.toISOString()}', '${new Date(agora.getTime() + 3_600_000).toISOString()}')`);
    return m.id;
  }
  const retomar = () => retomarTarefasDemoradas({ prazoFinal: Date.now() + 55_000, canal: "cron" });
  const NOMES_ACOES = new Set(ACOES.map(a => a.nome));
  const multi = (...chamadas: Array<[string, unknown]>): RespostaModelo => ({ stop_reason: "tool_use", usage: uso,
    content: chamadas.map(([name, input], i) => ({ type: "tool_use", id: `tu_${name}_${i}_${++seq}`, name, input })) });

  it("retomada só leitura: nenhuma ação é oferecida (nem mesa, maquete ou avisos), a porta as recusa; as leituras só do dono valem com a mensagem da tarefa", async () => {
    await semearMaquete();
    const mensagemId = await tarefaDoDono("aprova a mesa 1, gera o link da maquete do lote 5 da quadra 18, para de me avisar de obras e me manda o link do lote 4 da quadra 18");
    roteiro.push(p => {
      const nomes = (p.ferramentas as Array<{ name: string }>).map(f => f.name);
      for (const n of nomes) expect(NOMES_ACOES.has(n), n).toBe(false);
      for (const n of ["propor_aprovacao_mesa", "propor_mesa", "gerar_link_maquete_lote", "silenciar_aviso", "criar_tarefa"]) expect(nomes).not.toContain(n);
      expect(nomes).toEqual(expect.arrayContaining(SO_DO_DONO));
      return multi(["propor_aprovacao_mesa", { mesaId: 1 }], ["gerar_link_maquete_lote", { loteId: 2 }], ["silenciar_aviso", { tipo: "obra_atrasada", silenciar: true }],
        ["consultar_maquete_lote", { busca: "lote 4 da quadra 18" }]);
    }, () => textoModelo("Segue o que levantei sobre o lote 4."));
    expect(await retomar()).toBe("concluida");
    // os resultados das ferramentas que o modelo recebeu: ações recusadas, a leitura do dono executada com a mensagem da tarefa
    const resultados = (pedidosModelo[1].mensagens.at(-1)!.content as any[]).map(b => JSON.parse(b.content));
    expect(resultados.slice(0, 3).every(r => r.ok === false)).toBe(true);
    expect(resultados[3]).toMatchObject({ ok: true });
    expect(JSON.stringify(resultados[3])).toContain("k3m9x2pq7a");
    expect(await q<any>(`SELECT funcao, canal, resultado FROM dolores_acoes WHERE funcao = 'consultar_maquete_lote'`)).toEqual([{ funcao: "consultar_maquete_lote", canal: "whatsapp", resultado: "ok" }]);
    expect(mensagemId).toBeGreaterThan(0);
    // nada mudou: sem fila, sem proposta, sem link novo, sem silêncio
    expect(await q("SELECT id FROM dolores_aprovacoes")).toEqual([]);
    expect(await q("SELECT id FROM dolores_conversa_pendencia")).toEqual([]);
    expect((await q<any>("SELECT codigo_link FROM maquete_3d_lotes WHERE id = 2"))[0].codigo_link).toBeNull();
    expect(await q("SELECT tipo FROM dolores_avisos_tipos WHERE silenciado = true")).toEqual([]);
    // o resultado vai só ao dono, com o link (quadro do sistema) e o fecho fixo
    const ultima = mensagens().at(-1)!;
    expect(ultima.numero).toBe(DONO);
    expect(ultima.texto).toContain(`${SITE}/maquete/vila-esmeralda/qd18-lote4-k3m9x2pq7a`);
    expect(ultima.texto).toContain(FECHO_DA_TAREFA);
  });

  it("parecer de REURB vindo por tarefa leva o aviso da REURB E o fecho da tarefa", async () => {
    const [reurb] = (await banco.pg.query<{ id: number }>(`INSERT INTO regularizacoes (client_name, client_phone, type, status, address, responsible, created_at, updated_at) VALUES
      ('Associação Vila Esperança', '99955554444', 'REURB-S Vila Esperança', 'em_andamento', 'Vila Esperança', 'Bianca Souza', '2026-08-01 12:00', '2026-11-10 12:00') RETURNING id`)).rows;
    await tarefaDoDono("me faz um levantamento da REURB da Vila Esperança com o parecer");
    roteiro.push(p => { expect((p.ferramentas as Array<{ name: string }>).map(f => f.name)).toContain(FUNCAO_REURB); return ferramenta(FUNCAO_REURB, { id: reurb.id }); },
      () => textoModelo("*Enquadramento provável*: REURB-S [CONFERIR com o município]."));
    expect(await retomar()).toBe("concluida");
    const ultima = mensagens().at(-1)!.texto;
    expect(ultima).toContain(AVISO_REURB.slice(0, 40));
    expect(ultima).toContain(FECHO_DA_TAREFA);
  });

  it("resultado da tarefa e aviso proativo esperam proposta aberta; no cron: alertas → tarefa → avisos, cada um uma vez", async () => {
    const ordem: string[] = [];
    definirEnvioDosAlertas(async () => { ordem.push("alerta"); return { ok: true, motivo: null, tentou: true }; });
    enviar.mockImplementation(async (m: { texto: string }) => { ordem.push(m.texto.includes("levantamento") ? "tarefa" : m.texto.includes("Dolores — avisos de") ? "aviso" : "outro"); return true; });
    await ligarAvisos();
    await banco.pg.exec("INSERT INTO dolores_consumo (mes, modelo, volta, tokens_entrada, tokens_saida, funcao, parada) VALUES ('2026-11', 'm', 1, 85000, 0, 'grupos', 'grupo:end_turn')");
    await registrarAlertasDevidos("2026-11");
    await tarefaDoDono("me faz um relatório das obras");
    await abrirPropostaNaMao();
    expect(await retomar()).toBe("proposta-aberta");
    expect((await executarAvisos({ agora: SEG_9H })).r).toBe("proposta-aberta");
    expect(ordem).toEqual([]);
    agora = hora("2026-11-16T12:15:00Z"); // a proposta venceu
    definirRelogioCron({ agora: () => agora });
    roteiro.push(() => ferramenta("listar_obras", {}), () => textoModelo("Relatório: a obra Casa Ana está atrasada."));
    const r = await tratarCronDolores({ headers: { authorization: `Bearer ${SEGREDO_CRON}` } } as never);
    expect(r.body).toMatchObject({ avisos: "enviado" });
    expect(ordem).toEqual(["alerta", "tarefa", "aviso"]);
    expect(await q<any>("SELECT situacao FROM dolores_tarefas_demoradas")).toEqual([{ situacao: "concluida" }]);
  });
});
