// EPIC-026 C2 — mensagem recebida de outro número não aparecia na Central e não deixava registro nenhum. Regra nova do dono
// (20/11/2026): nenhuma mensagem é descartada sem registro visível. Cada hipótese da investigação tem um teste com o envelope mais
// próximo do real da Evolution v2; todos FALHAVAM antes desta correção (ver a story C2). PGlite; nada sai para a rede.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn(), getDashboardSetting: vi.fn(), saveDashboardSetting: vi.fn() }));
vi.mock("../whatsapp-router.js", async orig => ({ ...(await orig<typeof import("../whatsapp-router.js")>()), configEvolution: vi.fn(async () => null) }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { decidirRota, lerParaRoteamento } from "../../shared/dolores/roteamento.js";
import { itensDoAviso, lerMensagemEvolution, normalizarEvento } from "../../shared/dolores/whatsapp.js";
import { chaveDaConversa, chaveTelefone } from "../../shared/whatsapp/conversas.js";
import { mesmoTelefone, numeroDoLidEvolution } from "../_core/evolution.js";
import { ENV } from "../_core/env.js";
import { getDashboardSetting, getDb, saveDashboardSetting } from "../db.js";
import { appRouter } from "../routers.js";
import { ehNumeroReservado } from "../whatsapp-conexao-empresa.js";
import { MENSAGEM_SEM_NUMERO } from "../whatsapp-router.js";
import { esquecerLimpezaDoRecebimento } from "../whatsapp-recebimento.js";
import { definirClienteModelo } from "./cerebro.js";
import { definirDependenciasClassificacao } from "./classificacao.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte } from "./ponte.js";
import { definirDependenciasRoteamento } from "./roteamento.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";
import { definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";
import { limparPausaDoAtendimento } from "./atendimento.js";

const DONO = "5599991234567";
const EMPRESA = "5599900001111";
const ESTRANHO = "5511955554444";
const LID = "201234567890123@lid";
const TEXTO = "Oi, vi o anúncio do residencial e quero saber o preço";
let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviarAoDono: ReturnType<typeof vi.fn>;
let enviarAoContato: ReturnType<typeof vi.fn>;
let resolverLid: ReturnType<typeof vi.fn>;
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
let seq = 0;

/** Envelope da Evolution v2 (messages.upsert, `data` objeto), com a `key` como a v2.3 manda em conversa "@lid". */
function item(p: { key: Record<string, unknown>; message?: Record<string, unknown>; quando?: Date }) {
  return {
    key: { fromMe: false, id: `3EB0C2${++seq}`, ...p.key },
    pushName: "Fulano de Tal", status: "DELIVERY_ACK", message: p.message ?? { conversation: TEXTO }, messageType: "conversation",
    messageTimestamp: Math.floor((p.quando ?? new Date(AGORA.getTime() - 15_000)).getTime() / 1000), instanceId: "abc-123", source: "android",
  };
}
const aviso = (data: unknown, event = "messages.upsert") => ({
  event, instance: "prospecta-dolores", data, destination: "https://exemplo/api/dolores/whatsapp", date_time: AGORA.toISOString(), sender: `${EMPRESA}@s.whatsapp.net`,
});
const chamar = (body: unknown) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, body, ip: "203.0.113.9" } as never);
const caller = (role: string, id = 1, permissoes: string[] = ["whatsapp", "dolores", "integracoes"]) =>
  appRouter.createCaller({ user: { id, role, active: true, permissions: JSON.stringify(permissoes) }, req: {}, res: {} } as never);
const entradas = () => q<{ destinatario: string; mensagem: string; direcao: string; lead_id: number | null }>(
  `SELECT destinatario, mensagem, direcao, lead_id FROM whatsapp_messages WHERE direcao = 'entrada' AND destinatario <> '5599991234567' ORDER BY id`);
const registro = () => q<{ evento: string; destino: string; motivo: string; endereco: string; total: number }>(
  "SELECT evento, destino, motivo, endereco, total FROM whatsapp_recebimento_contagem ORDER BY destino, motivo, endereco");
const destinos = async () => Object.fromEntries((await registro()).filter(r => r.destino !== "chegou").map(r => [`${r.destino}:${r.motivo}:${r.endereco}`, r.total]));

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}',
      numero_dolores = '${EMPRESA}', ia_ligada = true, limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;
    INSERT INTO whatsapp_campanhas (nome, texto, ativa) VALUES ('Lançamento', 'Olá! Sou da Prospecta. Em breve um consultor te responde.', true);`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  esquecerUsuarioDolores();
  limparPausaDoAtendimento();
  esquecerLimpezaDoRecebimento();
  definirDependenciasPonte({ agora: () => AGORA });
  enviarAoDono = vi.fn(async () => true);
  definirDependenciasWhatsapp({ agora: () => AGORA, enviar: enviarAoDono as never });
  enviarAoContato = vi.fn(async () => `EVO${++seq}`);
  resolverLid = vi.fn(async () => null);
  definirDependenciasRoteamento({ agora: () => AGORA, enviar: enviarAoContato as never, resolverLid: resolverLid as never });
  definirClienteModelo((async () => { throw new Error("o laço do DONO não pode ser chamado por mensagem de terceiro"); }) as never);
  definirDependenciasClassificacao({ cliente: async () => { throw new Error("não classifica"); } });
  const painel = new Map<string, string>();
  vi.mocked(getDashboardSetting).mockImplementation(async k => painel.get(k));
  vi.mocked(saveDashboardSetting).mockImplementation(async (k, v) => { painel.set(k, v); });
});
afterEach(() => {
  ENV.cookieSecret = segredoAntes;
  definirDependenciasPonte(); definirDependenciasWhatsapp(); definirClienteModelo(); definirDependenciasClassificacao(); definirDependenciasRoteamento();
  vi.clearAllMocks();
});

/** Nada do que o terceiro mandou virou comando, resposta da Dolores ou saudação. */
async function nadaAutomatico() {
  expect(enviarAoDono).not.toHaveBeenCalled();
  expect(enviarAoContato).not.toHaveBeenCalled();
  expect(await q("SELECT id FROM dolores_mensagens")).toEqual([]);
  expect(await q("SELECT id FROM whatsapp_saudacoes")).toEqual([]);
  expect(await q("SELECT id FROM dolores_atendimentos")).toEqual([]);
}

describe("hipótese (a) — remetente em @lid sem número resolvível", () => {
  it("aparece na Central como número não identificado (antes: auditado e descartado); não é comando nem recebe saudação/resposta", async () => {
    const r = await chamar(aviso(item({ key: { remoteJid: LID, addressingMode: "lid" } })));
    expect(r.status).toBe(200);
    expect(await entradas()).toEqual([{ destinatario: LID, mensagem: TEXTO, direcao: "entrada", lead_id: null }]);
    await nadaAutomatico();
    expect(await q("SELECT external_id FROM whatsapp_roteamento_vistos")).toHaveLength(1);
    expect(await destinos()).toEqual({ "central_sem_numero::lid": 1 });
    // a tela da Central mostra a conversa, marcada como sem número
    const conversas = await caller("admin").whatsapp.conversas();
    expect(conversas.find(c => c.numero === LID)).toMatchObject({ semNumero: true, nome: "Fulano de Tal", leadId: null });
  });
  it("reentrega do mesmo aviso não duplica a conversa nem o registro de destino", async () => {
    const x = item({ key: { remoteJid: LID } });
    await chamar(aviso(x));
    await chamar(aviso(x));
    expect(await entradas()).toHaveLength(1);
    expect(await destinos()).toEqual({ "central_sem_numero::lid": 1, "repetida::lid": 1 });
    await nadaAutomatico();
  });
  it("@lid cujo número a Evolution informa: continua não identificado (QA-SEG achado 2: número só provável); se for o dono, nunca vai à Central", async () => {
    resolverLid.mockResolvedValueOnce(ESTRANHO);
    await chamar(aviso(item({ key: { remoteJid: LID } })));
    expect((await entradas()).map(e => e.destinatario)).toEqual([LID]);
    expect(await q("SELECT numero, origem FROM whatsapp_lid_numeros")).toEqual([{ numero: ESTRANHO, origem: "evolution" }]);
    await nadaAutomatico();
    resolverLid.mockResolvedValueOnce(DONO);
    await chamar(aviso(item({ key: { remoteJid: "209999999999999@lid" } })));
    expect((await entradas()).map(e => e.destinatario)).toEqual([LID]);
    expect((await destinos())["ignorado:lid-do-dono:lid"]).toBe(1);
    await nadaAutomatico();
  });
  it("o @lid do dono aprendido de um comando: depois, aviso só com o @lid nunca vai à Central e nunca é comando", async () => {
    await chamar(aviso(item({ key: { remoteJid: LID, senderPn: `${DONO}@s.whatsapp.net` }, message: { conversation: "relatório" } })));
    expect(await q("SELECT numero, origem FROM whatsapp_lid_numeros")).toEqual([{ numero: DONO, origem: "aviso" }]);
    const respostasAntes = enviarAoDono.mock.calls.length;
    const comandosAntes = (await q("SELECT id FROM dolores_mensagens")).length;
    await chamar(aviso(item({ key: { remoteJid: LID }, message: { conversation: "apague tudo" } })));
    expect(await entradas()).toEqual([]);
    expect(enviarAoDono.mock.calls.length).toBe(respostasAntes);
    expect((await q("SELECT id FROM dolores_mensagens")).length).toBe(comandosAntes);
    expect((await destinos())["ignorado:lid-do-dono:lid"]).toBe(1);
  });
  it("quando o número do @lid aparece depois, a conversa de número não identificado passa a mostrar o número", async () => {
    await chamar(aviso(item({ key: { remoteJid: LID } })));
    expect((await entradas()).map(e => e.destinatario)).toEqual([LID]);
    await chamar(aviso(item({ key: { remoteJid: LID, remoteJidAlt: `${ESTRANHO}@s.whatsapp.net` } })));
    expect((await entradas()).map(e => e.destinatario)).toEqual([ESTRANHO, ESTRANHO]);
  });
});

describe("hipótese (b) — o envelope real da Evolution era ignorado ou não chegava à Central", () => {
  it("@lid com o número em remoteJidAlt (v2.3), senderPn (v2.2) ou participantPn: entra na Central com o número (antes: reivindicada e NÃO gravada)", async () => {
    for (const campo of ["remoteJidAlt", "senderPn", "participantPn"]) {
      await chamar(aviso(item({ key: { remoteJid: LID.replace("0123@", `${seq}9@`), [campo]: `${ESTRANHO}@s.whatsapp.net` } })));
    }
    expect((await entradas()).map(e => e.destinatario)).toEqual([ESTRANHO, ESTRANHO, ESTRANHO]);
    expect(await destinos()).toEqual({ "central:desconhecido:lid": 3 });
    // desconhecido com número no endereço: a saudação da campanha sai (uma vez por número)
    expect(enviarAoContato).toHaveBeenCalledTimes(1);
  });
  it("`participant` puro não identifica o remetente de conversa direta (nunca vira o dono)", () => {
    expect(lerMensagemEvolution(item({ key: { remoteJid: LID, participant: `${DONO}@s.whatsapp.net` } }))).toMatchObject({ tipo: "direta", numero: null, lid: LID });
  });
  it("evento com hífen, data em lista ou no formato do Baileys e endereço com sufixo de aparelho: tudo chega à Central", async () => {
    await chamar(aviso(item({ key: { remoteJid: "5511955550001@s.whatsapp.net" } }), "messages-upsert"));
    await chamar(aviso([item({ key: { remoteJid: "5511955550002@s.whatsapp.net" } })], "MESSAGES_UPSERT"));
    await chamar(aviso({ messages: [item({ key: { remoteJid: "5511955550003@s.whatsapp.net" } })], type: "notify" }));
    await chamar(aviso(item({ key: { remoteJid: "5511955550004:12@s.whatsapp.net" } })));
    expect((await entradas()).map(e => e.destinatario)).toEqual(["5511955550001", "5511955550002", "5511955550003", "5511955550004"]);
  });
  it("texto em extendedTextMessage, embrulhado em mensagem temporária ou de visualização única: entra com o texto", async () => {
    const embrulhos = [
      { extendedTextMessage: { text: TEXTO, contextInfo: { expiration: 604800 } } },
      { ephemeralMessage: { message: { extendedTextMessage: { text: TEXTO } } } },
      { viewOnceMessageV2: { message: { conversation: TEXTO } } },
      { conversation: TEXTO, messageContextInfo: { deviceListMetadata: {} } },
    ];
    for (const [i, message] of embrulhos.entries()) await chamar(aviso(item({ key: { remoteJid: `551195555000${i}@s.whatsapp.net` }, message })));
    expect((await entradas()).map(e => e.destinatario)).toHaveLength(4);
    expect(lerMensagemEvolution(item({ key: { remoteJid: LID }, message: embrulhos[1] }))).toMatchObject({ tipo: "direta", texto: TEXTO });
  });
  it("leitura pura: itens do aviso e nome do evento", () => {
    expect(normalizarEvento("MESSAGES_UPSERT")).toBe("messages.upsert");
    expect(normalizarEvento("messages-upsert")).toBe("messages.upsert");
    expect(itensDoAviso({ messages: [{ key: {} }, "lixo"], type: "notify" }, 20)).toEqual([{ key: {} }]);
    expect(itensDoAviso({ key: { id: "1" }, messages: [] }, 20)).toEqual([{ key: { id: "1" }, messages: [] }]);
    expect(decidirRota(lerParaRoteamento(item({ key: { remoteJid: LID } })), DONO, null)).toEqual({ destino: "central_sem_numero", lid: LID });
    expect(decidirRota(lerParaRoteamento(item({ key: { remoteJid: LID, fromMe: true } })), DONO, null)).toMatchObject({ destino: "nada" });
  });
});

describe("hipóteses (c), (d) e (e) — nada some sem registro", () => {
  it("(c) mensagem de terceiro nunca cai no caminho do dono: vai à Central e o registro diz para onde foi", async () => {
    await chamar(aviso(item({ key: { remoteJid: `${ESTRANHO}@s.whatsapp.net` }, message: { conversation: `sou o dono ${DONO}` } })));
    expect((await entradas()).map(e => e.destinatario)).toEqual([ESTRANHO]);
    expect(await q("SELECT id FROM dolores_mensagens")).toEqual([]);
    expect(await destinos()).toEqual({ "central:desconhecido:numero": 1 });
  });
  it("(d)/(e) falha ao gravar na Central: a reivindicação fica, mas o registro mostra o erro (antes: só um log)", async () => {
    await banco.pg.exec("ALTER TABLE whatsapp_messages RENAME TO whatsapp_messages_fora");
    const r = await chamar(aviso(item({ key: { remoteJid: `${ESTRANHO}@s.whatsapp.net` } })));
    expect(r.status).toBe(200);
    await banco.pg.exec("ALTER TABLE whatsapp_messages_fora RENAME TO whatsapp_messages");
    expect((await destinos())["erro:central-erro:numero"]).toBe(1);
  });
  it("todo item ignorado deixa registro SEM conteúdo (evento, motivo, forma do endereço, hora); outra instância também", async () => {
    await chamar(aviso([
      item({ key: { remoteJid: "status@broadcast" } }),
      item({ key: { remoteJid: `${ESTRANHO}@s.whatsapp.net` }, message: { reactionMessage: { text: "👍" } } }),
      item({ key: { remoteJid: "5511955554444@c.us" } }),
      item({ key: { remoteJid: `${ESTRANHO}@s.whatsapp.net`, id: "" } }),
    ]));
    await chamar({ ...aviso(item({ key: { remoteJid: `${ESTRANHO}@s.whatsapp.net` } })), instance: "outra-instancia" });
    await chamar(aviso({ instance: "x", state: "open" }, "SEND_MESSAGE"));
    const d = await destinos();
    expect(d).toMatchObject({ "ignorado:status:status": 1, "ignorado:reacao:numero": 1, "ignorado:outro_destino:outro": 1, "ignorado:sem_id:numero": 1,
      "ignorado:instancia-desconhecida:": 1, "ignorado:evento-nao-tratado:": 1 });
    const linhas = await registro();
    expect(linhas.filter(l => l.destino === "chegou").reduce((s, l) => s + l.total, 0)).toBe(6);
    const tudo = JSON.stringify(await q("SELECT * FROM whatsapp_recebimento_contagem"));
    expect(tudo).not.toMatch(/955554444|Fulano|anúncio|👍/);
    expect((await q<{ hora: string }>("SELECT DISTINCT hora FROM whatsapp_recebimento_contagem")).map(h => h.hora)).toEqual([AGORA.toISOString().slice(0, 13)]);
  });
  it("limpeza: horas com mais de 7 dias saem; as recentes ficam", async () => {
    await banco.pg.exec(`INSERT INTO whatsapp_recebimento_contagem (hora, evento, destino, total) VALUES ('2026-11-01T10', 'messages.upsert', 'central', 5), ('2026-11-15T10', 'messages.upsert', 'central', 2)`);
    await chamar(aviso(item({ key: { remoteJid: `${ESTRANHO}@s.whatsapp.net` } })));
    expect((await q<{ hora: string }>("SELECT DISTINCT hora FROM whatsapp_recebimento_contagem ORDER BY hora")).map(h => h.hora)).toEqual(["2026-11-15T10", AGORA.toISOString().slice(0, 13)]);
  });
});

describe("tela \"Recebimento nas últimas 24 h\" e a Central", () => {
  it("só o ADMIN por papel lê o resumo (colaborador com todos os módulos: recusado); o resumo é só contagem", async () => {
    await chamar(aviso([item({ key: { remoteJid: LID } }), item({ key: { remoteJid: `${ESTRANHO}@s.whatsapp.net` } }), item({ key: { remoteJid: "status@broadcast" } })]));
    await chamar(aviso(item({ key: { remoteJid: `${DONO}@s.whatsapp.net` }, message: { conversation: "relatório" } })));
    // `adminProcedure` só confere o módulo; o papel é conferido por `soAdmin` — colaborador e corretor: FORBIDDEN
    await expect(caller("colaborador", 2).dolores.recebimento()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("corretor", 2).dolores.recebimento()).rejects.toMatchObject({ code: "FORBIDDEN" });
    const r = await caller("admin").dolores.recebimento();
    expect(r).toMatchObject({ chegaram: 4, mensagens: { total: 4, porEndereco: { lid: 1, numero: 2, status: 1 } }, central: 1, centralSemNumero: 1, dolores: 1, semDesfecho: 0 });
    expect(r.ignoradas).toEqual([{ motivo: "status", endereco: "status", evento: "messages.upsert", total: 1 }]);
    expect(JSON.stringify(r)).not.toMatch(/955554444|991234567|201234567890123|Fulano|relatório/);
  });
  it("a Central não responde, não cria lead nem vincula pela conversa sem número; o envio nunca sai para os dígitos do @lid", async () => {
    await chamar(aviso(item({ key: { remoteJid: LID } })));
    const admin = caller("admin");
    await expect(admin.whatsapp.responder({ numero: LID, texto: "Olá" })).rejects.toThrow(MENSAGEM_SEM_NUMERO);
    await expect(admin.whatsapp.criarLeadDaConversa({ numero: LID })).rejects.toThrow(MENSAGEM_SEM_NUMERO);
    await expect(admin.whatsapp.vincularLead({ numero: LID, leadId: 1 })).rejects.toThrow(MENSAGEM_SEM_NUMERO);
    expect(await q("SELECT id FROM whatsapp_messages WHERE direcao = 'saida' AND destinatario LIKE '%201234567890123%'")).toEqual([]);
    expect(await q("SELECT id FROM leads WHERE phone LIKE '%34567890123%'")).toEqual([]);
    // abre só a própria conversa (e a do telefone com os mesmos dígitos finais não se mistura)
    expect((await admin.whatsapp.mensagensConversa({ numero: LID })).map(m => m.mensagem)).toEqual([TEXTO]);
  });
  it("@lid nunca casa com telefone (nem pelos 8 finais) e nunca é número reservado pelos dígitos", () => {
    const lidComFinais = "551299991234567@lid"; // dígitos que, como telefone, cairiam no dono
    expect(chaveTelefone(lidComFinais)).toBe("");
    expect(chaveDaConversa(lidComFinais)).toBe(lidComFinais);
    expect(mesmoTelefone(lidComFinais, DONO)).toBe(false);
    expect(mesmoTelefone(lidComFinais, lidComFinais)).toBe(true);
    expect(mesmoTelefone(LID, lidComFinais)).toBe(false);
    expect(ehNumeroReservado(lidComFinais, { dono: DONO, empresa: EMPRESA })).toBe(false);
  });
});

describe("consulta do número do @lid na Evolution (só leitura, estrita)", () => {
  const resposta = (data: unknown) => (async () => new Response(JSON.stringify(data), { status: 200 })) as unknown as typeof fetch;
  const c = { url: "https://evo.exemplo", apiKey: "chave-de-teste" };
  it("só vale o contato que cita o MESMO @lid e traz um número; contatos de outros e ambiguidade → null", async () => {
    expect(await numeroDoLidEvolution(c, "prospecta-dolores", LID, resposta([{ remoteJid: LID, remoteJidAlt: `${ESTRANHO}@s.whatsapp.net` }]))).toBe(ESTRANHO);
    expect(await numeroDoLidEvolution(c, "prospecta-dolores", LID, resposta([{ lid: LID, remoteJid: `${ESTRANHO}@s.whatsapp.net` }]))).toBe(ESTRANHO);
    // a Evolution ignorou o filtro e devolveu outros contatos: nenhum cita o @lid
    expect(await numeroDoLidEvolution(c, "prospecta-dolores", LID, resposta([{ remoteJid: `${DONO}@s.whatsapp.net` }, { remoteJid: "1@lid", remoteJidAlt: `${DONO}@s.whatsapp.net` }]))).toBeNull();
    expect(await numeroDoLidEvolution(c, "prospecta-dolores", LID, resposta([{ remoteJid: LID, remoteJidAlt: `${ESTRANHO}@s.whatsapp.net` }, { lid: LID, remoteJid: `${DONO}@s.whatsapp.net` }]))).toBeNull();
    expect(await numeroDoLidEvolution(c, "prospecta-dolores", LID, (async () => { throw new Error("rede"); }) as never)).toBeNull();
    expect(await numeroDoLidEvolution(c, "prospecta-dolores", "nao-e-lid", resposta([]))).toBeNull();
  });
});
