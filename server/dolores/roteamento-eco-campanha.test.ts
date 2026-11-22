// EPIC-027 C7.1 — eco de campanha pela API oficial (YCloud) no roteamento da empresa: em coexistência, o envio da campanha volta pela
// Evolution como "da empresa" (fromMe). `tratarPropria` liga `ehEcoDeCampanhaOficial`: o eco não cala a Dolores nem vira atendimento
// humano; mensagem da equipe (texto diferente, fora da janela, outro número) segue a regra de sempre. PGlite; nada sai para a rede.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn(), getDashboardSetting: vi.fn(), saveDashboardSetting: vi.fn() }));
vi.mock("../whatsapp-router.js", async orig => ({ ...(await orig<typeof import("../whatsapp-router.js")>()), configEvolution: vi.fn(async () => null) }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { decidirRota, formaCanonicaDoNumero, lerParaRoteamento, textoFixoInvalido } from "../../shared/dolores/roteamento.js";
import { chaveCanonicaTelefone } from "../../shared/whatsapp/ycloud.js";
import { FRASE_SO_TEXTO } from "../../shared/dolores/whatsapp.js";
import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDashboardSetting, getDb, saveDashboardSetting } from "../db.js";
import { appRouter } from "../routers.js";
import { canalDeDisparo, AVISO_DISPARO_BLOQUEADO } from "../whatsapp-canais.js";
import { processarEventoEvolution } from "../whatsapp-evolution-webhook.js";
import { FRASE_CLIENTE_EQUIPE, limparPausaDoAtendimento } from "./atendimento.js";
import { definirClienteModelo } from "./cerebro.js";
import { definirDependenciasClassificacao } from "./classificacao.js";
import { definirDependenciasMarcacao, type PedidoGrupo, type RespostaGrupo } from "./marcacao.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte } from "./ponte.js";
import { definirDependenciasRoteamento } from "./roteamento.js";
import { AGORA, CENARIO, MIGRACAO_0135, criarBanco } from "./testes-banco.js";
import { definirDependenciasTranscricao } from "./transcricao.js";
import { definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";

const DONO = "5599991234567";
const EMPRESA = "5599900001111";
const JOAO = "5599988887777"; // lead 2 (CRM) + financiamento ligado ao mesmo lead → UM cliente
const ANA = "5599977776666"; // lead 3 + regularização ligada → UM cliente
const ESTRANHO = "5511955554444";
const GRUPO = "120363111111111111@g.us";
const CONTA_CF = "0123456789abcdef0123456789abcdef";
const TOKEN_CF = "cf-token-de-teste-NAO-REAL-abcdefghij123456";
let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviarAoDono: ReturnType<typeof vi.fn>;
let enviarAoContato: ReturnType<typeof vi.fn>;
let pedidos: PedidoGrupo[];
let respostas: RespostaGrupo[];
let painel: Map<string, string>;
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
let seq = 0;

type Item = { key: Record<string, unknown>; message: Record<string, unknown>; messageTimestamp: number; pushName?: string };
function direta(p: { de?: string; texto?: string; id?: string; fromMe?: boolean; quando?: Date; message?: Record<string, unknown> } = {}): Item {
  return {
    key: { remoteJid: `${p.de ?? ESTRANHO}@s.whatsapp.net`, fromMe: p.fromMe ?? false, id: p.id ?? `E9${++seq}` },
    message: p.message ?? { conversation: p.texto ?? "Oi, quero saber do lançamento" },
    messageTimestamp: Math.floor((p.quando ?? new Date(AGORA.getTime() - 20_000)).getTime() / 1000), pushName: "Contato",
  };
}
const audio = (de: string, segundos = 20) => direta({ de, message: { audioMessage: { seconds: segundos, fileLength: 30_000, mimetype: "audio/ogg; codecs=opus" } } });
const aviso = (...itens: unknown[]) => ({ event: "messages.upsert", instance: "prospecta-dolores", data: itens.length === 1 ? itens[0] : itens });
const chamar = (body: unknown) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, body, ip: "203.0.113.9" } as never);
const caller = (role: string, id = 1, permissoes: string[] = ["whatsapp"]) =>
  appRouter.createCaller({ user: { id, role, active: true, permissions: JSON.stringify(permissoes) }, req: {}, res: {} } as never);
const texto = (t: string): RespostaGrupo => ({ stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 60 }, content: [{ type: "text", text: t }] });
const usar = (name: string): RespostaGrupo => ({ stop_reason: "tool_use", usage: { input_tokens: 800, output_tokens: 20 }, content: [{ type: "tool_use", id: `tu${++seq}`, name, input: {} }] });
const central = (numero: string) => q<{ direcao: string; mensagem: string; automatica: boolean; external_id: string | null; status: string; connection_id: number }>(
  `SELECT direcao, mensagem, automatica, external_id, status, connection_id FROM whatsapp_messages WHERE destinatario = '${numero}' ORDER BY id`);
const ligarAtendimento = (extra = "") => banco.pg.exec(`UPDATE whatsapp_atendimento_config SET cliente_ligado = true ${extra} WHERE id = 1`);
const enviadosPara = (n: string) => enviarAoContato.mock.calls.filter(c => c[0].numero === n).map(c => c[0].texto as string);

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  // corretor com conexão própria (Central de sempre)
  await banco.pg.exec(`INSERT INTO users ("openId", name, role, active, "passwordHash", phone) VALUES ('cor', 'Carlos Corretor', 'corretor', true, 'hash', '99944443333');
    UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}',
      numero_dolores = '${EMPRESA}', ia_ligada = true, limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  esquecerUsuarioDolores();
  limparPausaDoAtendimento();
  definirDependenciasPonte({ agora: () => AGORA });
  enviarAoDono = vi.fn(async () => true);
  definirDependenciasWhatsapp({ agora: () => AGORA, enviar: enviarAoDono as never });
  enviarAoContato = vi.fn(async () => `EVO${++seq}`);
  definirDependenciasRoteamento({ agora: () => AGORA, enviar: enviarAoContato as never });
  vi.mocked(configuracaoAnthropicPainel).mockResolvedValue({ apiKey: "sk-ant-chave-de-teste-nao-real-123456", modelo: "modelo-do-painel" });
  definirClienteModelo((async () => { throw new Error("o laço do DONO não pode ser chamado por mensagem de terceiro"); }) as never);
  definirDependenciasClassificacao({ cliente: async () => { throw new Error("não classifica"); } });
  pedidos = [];
  respostas = [];
  definirDependenciasMarcacao({
    agora: () => AGORA, enviar: (async () => { throw new Error("nada vai a grupo aqui"); }) as never, contador: async () => 1_000,
    cliente: async p => { pedidos.push(JSON.parse(JSON.stringify(p))); return respostas.shift() ?? texto("Seu financiamento está em andamento."); },
  });
  painel = new Map();
  vi.mocked(getDashboardSetting).mockImplementation(async k => painel.get(k));
  vi.mocked(saveDashboardSetting).mockImplementation(async (k, v) => { painel.set(k, v); });
  definirDependenciasTranscricao({ baixar: async () => { throw new Error("download não configurado no teste"); }, cliente: async () => { throw new Error("cliente não configurado no teste"); } });
});
afterEach(() => {
  ENV.cookieSecret = segredoAntes;
  definirDependenciasPonte(); definirDependenciasWhatsapp(); definirClienteModelo(); definirDependenciasClassificacao(); definirDependenciasMarcacao();
  definirDependenciasRoteamento(); definirDependenciasTranscricao();
  vi.clearAllMocks();
});

const MIGRACAO_0141 = () => readFileSync(new URL("../../drizzle/0141_ycloud.sql", import.meta.url), "utf8");
const CORPO = "Olá João, conheça o Residencial Jardim das Flores.";
async function envioDeCampanha(p: { numero?: string; aceitoHaMin?: number; texto?: string; parametros?: Record<string, unknown> } = {}) {
  await banco.pg.exec(MIGRACAO_0141());
  await banco.pg.exec(`INSERT INTO ycloud_campanhas (chave_confirmacao, nome, modelo_nome, modelo_idioma, corpo, status, total)
    VALUES ('chave-eco-${++seq}', 'Lançamento', 'lancamento_jardim', 'pt_BR', 'Olá {{1}}', 'enviando', 1)`);
  const quando = new Date(AGORA.getTime() - (p.aceitoHaMin ?? 1) * 60_000).toISOString();
  const numero = p.numero ?? JOAO;
  await banco.pg.exec(`INSERT INTO ycloud_envios (campanha_id, telefone, chave_telefone, texto, external_id, status, aceito_em, parametros)
    SELECT max(id), '+${numero}', '${chaveCanonicaTelefone(`+${numero}`)}', '${(p.texto ?? CORPO).replace(/'/g, "''")}', 'prospecta-eco-${seq}', 'aceita', '${quando}',
      '${JSON.stringify(p.parametros ?? {}).replace(/'/g, "''")}'::jsonb FROM ycloud_campanhas`);
}

describe("C7.1 — eco de campanha pela API oficial no roteamento (tratarPropria)", () => {
  it("o eco (mesmo número, aceito há pouco, texto contém o corpo) não cala a Dolores nem entra como atendimento humano", async () => {
    await envioDeCampanha();
    const r = await chamar(aviso(direta({ de: JOAO, fromMe: true, texto: `Novidade, João\n${CORPO}\nProspecta` })));
    expect(r.body.rota).toMatchObject({ "propria-campanha-oficial": 1 });
    expect(r.body.rota).not.toHaveProperty("propria-equipe");
    expect(await q("SELECT * FROM whatsapp_silencio")).toEqual([]);
    expect((await central(JOAO)).filter(x => x.direcao === "saida" && !x.automatica)).toEqual([]);
  });

  it("mensagem da equipe pelo celular (texto diferente) continua calando a Dolores e entrando na conversa", async () => {
    await envioDeCampanha();
    const r = await chamar(aviso(direta({ de: JOAO, fromMe: true, texto: "Oi João, aqui é a Bianca." })));
    expect(r.body.rota).toMatchObject({ "propria-equipe": 1 });
    expect((await q("SELECT * FROM whatsapp_silencio")).length).toBe(1);
    expect((await central(JOAO)).filter(x => x.direcao === "saida" && !x.automatica).map(x => x.mensagem)).toEqual(["Oi João, aqui é a Bianca."]);
  });

  it("fora da janela de 10 min, para outro número ou sem a tabela da API: na dúvida é da EQUIPE", async () => {
    await envioDeCampanha({ aceitoHaMin: 11 });
    expect((await chamar(aviso(direta({ de: JOAO, fromMe: true, texto: CORPO })))).body.rota).toMatchObject({ "propria-equipe": 1 });
    await envioDeCampanha({ numero: ANA });
    expect((await chamar(aviso(direta({ de: JOAO, fromMe: true, texto: `${CORPO} ` })))).body.rota).toMatchObject({ "propria-equipe": 1 });
  });

  it("C7.3: corpo da campanha + acréscimo da equipe pelo celular, dentro dos 10 min, NÃO é eco: cala a Dolores e entra na Central", async () => {
    await envioDeCampanha({ parametros: { textoCompleto: `Novidade, João\n${CORPO}`, cabecalho: ["João"], corpo: ["João"], rodape: "Prospecta" } });
    // o eco exato (cabeçalho + corpo + rodapé) continua reconhecido
    expect((await chamar(aviso(direta({ de: JOAO, fromMe: true, texto: `Novidade, João\n${CORPO}\nProspecta` })))).body.rota).toMatchObject({ "propria-campanha-oficial": 1 });
    const comAcrescimo = `${CORPO}\nPosso te ligar amanhã às 10h?`;
    const r = await chamar(aviso(direta({ de: JOAO, fromMe: true, texto: comAcrescimo })));
    expect(r.body.rota).toMatchObject({ "propria-equipe": 1 });
    expect((await q("SELECT * FROM whatsapp_silencio")).length).toBe(1);
    expect((await central(JOAO)).filter(x => x.direcao === "saida" && !x.automatica).map(x => x.mensagem)).toEqual([comAcrescimo]);
  });

  it("sem as tabelas da API oficial (migração 0141 ausente): a consulta falha fechada e vale a regra de sempre", async () => {
    const r = await chamar(aviso(direta({ de: JOAO, fromMe: true, texto: CORPO })));
    expect(r.body.rota).toMatchObject({ "propria-equipe": 1 });
  });
});
