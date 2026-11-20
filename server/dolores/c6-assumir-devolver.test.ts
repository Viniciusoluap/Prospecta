// EPIC-026 C6 — "Assumir (humano)" / "Devolver para a Dolores" na conversa da Central WhatsApp. Transições, precedência (assumida >
// silêncio automático; devolver encerra o automático daquele momento; resposta nova da equipe recala), permissões por papel pelo
// appRouter, proteção da conversa do dono/empresa/grupo/"@lid" e o roteamento real respeitando o estado. PGlite; nada sai para a rede.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn(), getDashboardSetting: vi.fn(), saveDashboardSetting: vi.fn() }));
vi.mock("../whatsapp-router.js", async orig => ({ ...(await orig<typeof import("../whatsapp-router.js")>()), configEvolution: vi.fn(async () => null) }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { estadoDoAtendimento, silencioValeDepoisDeDevolver } from "../../shared/dolores/modo-conversa.js";
import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDashboardSetting, getDb, saveDashboardSetting } from "../db.js";
import { appRouter } from "../routers.js";
import { limparPausaDoAtendimento } from "./atendimento.js";
import { definirClienteModelo } from "./cerebro.js";
import { definirDependenciasClassificacao } from "./classificacao.js";
import { definirDependenciasMarcacao, type PedidoGrupo, type RespostaGrupo } from "./marcacao.js";
import { MOTIVO_NAO_ELEGIVEL } from "./modo-conversa.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte } from "./ponte.js";
import { conversaEmSilencio, definirDependenciasRoteamento, silenciarConversa, situacaoDoSilencio } from "./roteamento.js";
import { AGORA, CENARIO, MIGRACAO_0138, criarBanco } from "./testes-banco.js";
import { definirDependenciasTranscricao } from "./transcricao.js";
import { definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";

const DONO = "5599991234567";
const EMPRESA = "5599900001111";
const JOAO = "5599988887777"; // lead 2 → UM cliente
const ESTRANHO = "5511955554444";
const GRUPO = "120363111111111111@g.us";
const LID = "201234567890123@lid";
const HORA = 60 * 60_000;
let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviarAoContato: ReturnType<typeof vi.fn>;
let enviarAoDono: ReturnType<typeof vi.fn>;
let pedidos: PedidoGrupo[];
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
let seq = 0;

function direta(p: { de?: string; texto?: string; fromMe?: boolean; quando?: Date } = {}) {
  return {
    key: { remoteJid: `${p.de ?? JOAO}@s.whatsapp.net`, fromMe: p.fromMe ?? false, id: `C6${++seq}` },
    message: { conversation: p.texto ?? "Como está a minha obra?" },
    messageTimestamp: Math.floor((p.quando ?? new Date(AGORA.getTime() - 20_000)).getTime() / 1000), pushName: "Contato",
  };
}
const aviso = (item: unknown) => ({ event: "messages.upsert", instance: "prospecta-dolores", data: item });
const chamar = async (item: unknown) => (await tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, body: aviso(item), ip: "203.0.113.9" } as never)).body.rota as Record<string, number>;
const caller = (role: string, id: number, permissoes: string[] = ["whatsapp"], active = true) =>
  appRouter.createCaller({ user: { id, role, active, permissions: JSON.stringify(permissoes) }, req: {}, res: {} } as never);
const admin = () => caller("admin", 1);
const colaborador = () => caller("colaborador", 2);
const texto = (t: string): RespostaGrupo => ({ stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 60 }, content: [{ type: "text", text: t }] });
const ligarAtendimento = () => banco.pg.exec("UPDATE whatsapp_atendimento_config SET cliente_ligado = true WHERE id = 1");
const enviadosPara = (n: string) => enviarAoContato.mock.calls.filter(c => c[0].numero === n).length;
const modos = () => q<{ modo: string; alterado_por: number | null; lead_id: number | null }>("SELECT modo, alterado_por, lead_id FROM whatsapp_atendimento_modo ORDER BY id");

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
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
  definirClienteModelo((async () => { throw new Error("o laço do DONO não pode ser chamado"); }) as never);
  definirDependenciasClassificacao({ cliente: async () => { throw new Error("não classifica"); } });
  pedidos = [];
  definirDependenciasMarcacao({
    agora: () => AGORA, enviar: (async () => { throw new Error("nada vai a grupo aqui"); }) as never, contador: async () => 1_000,
    cliente: async p => { pedidos.push(p); return texto("A sua obra está em andamento."); },
  });
  const painel = new Map<string, string>();
  vi.mocked(getDashboardSetting).mockImplementation(async k => painel.get(k));
  vi.mocked(saveDashboardSetting).mockImplementation(async (k, v) => { painel.set(k, v); });
  definirDependenciasTranscricao({ baixar: async () => { throw new Error("sem download"); }, cliente: async () => { throw new Error("sem cliente"); } });
});
afterEach(() => {
  ENV.cookieSecret = segredoAntes;
  definirDependenciasPonte(); definirDependenciasWhatsapp(); definirClienteModelo(); definirDependenciasClassificacao(); definirDependenciasMarcacao();
  definirDependenciasRoteamento(); definirDependenciasTranscricao();
  vi.clearAllMocks();
});

/** Conversa do João na Central, com o atendimento ligado e uma resposta da Dolores já dada. */
async function conversaDoJoao() {
  await ligarAtendimento();
  expect(await chamar(direta({ texto: "Oi, como está a obra?" }))).toMatchObject({ "cliente-respondida": 1 });
  expect(enviadosPara(JOAO)).toBe(1);
  enviarAoContato.mockClear();
  vi.mocked(configuracaoAnthropicPainel).mockClear();
  pedidos = [];
}

describe("regra pura — precedência", () => {
  it("assumida > silêncio automático > Dolores", () => {
    const depois = new Date(AGORA.getTime() + HORA);
    expect(estadoDoAtendimento({ modo: "humano", silencioAte: null, agora: AGORA })).toBe("assumida");
    expect(estadoDoAtendimento({ modo: "humano", silencioAte: depois, agora: AGORA })).toBe("assumida");
    expect(estadoDoAtendimento({ modo: "dolores", silencioAte: depois, agora: AGORA })).toBe("silencio");
    expect(estadoDoAtendimento({ modo: null, silencioAte: depois, agora: AGORA })).toBe("silencio");
    expect(estadoDoAtendimento({ modo: "dolores", silencioAte: AGORA, agora: AGORA })).toBe("dolores");
    expect(estadoDoAtendimento({ modo: null, silencioAte: null, agora: AGORA })).toBe("dolores");
  });
  it("só mensagem da equipe do mesmo instante ou depois do Devolver recala", () => {
    expect(silencioValeDepoisDeDevolver(AGORA, null)).toBe(true);
    expect(silencioValeDepoisDeDevolver(AGORA, AGORA)).toBe(true);
    expect(silencioValeDepoisDeDevolver(new Date(AGORA.getTime() - 1), AGORA)).toBe(false);
  });
  it("a migração 0138 é aditiva e idempotente (aplicada de novo sobre o banco de teste, que já a tem duas vezes)", async () => {
    const sql = MIGRACAO_0138();
    const comandos = sql.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
    expect(comandos).not.toMatch(/^\s*(DROP|DELETE|TRUNCATE|UPDATE|ALTER)\b/im);
    expect(comandos.match(/CREATE (UNIQUE )?(TABLE|INDEX)(?! IF NOT EXISTS)/g)).toBeNull();
    await banco.pg.exec(sql);
    expect(await modos()).toEqual([]);
  });
});

describe("Assumir (humano)", () => {
  it("a Dolores fica calada sem prazo; responder manualmente não muda nada; nada é enviado e a IA não roda pelo botão", async () => {
    await conversaDoJoao();
    expect(await admin().whatsapp.atendimentoDaConversa({ numero: JOAO })).toMatchObject({ mostrar: true, elegivel: true, estado: "dolores" });
    const r = await admin().whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "assumir" });
    expect(r).toMatchObject({ mostrar: true, estado: "assumida", alteradoPor: "Vinícius Admin" });
    expect(enviarAoContato).not.toHaveBeenCalled();
    expect(pedidos).toEqual([]);
    expect(vi.mocked(configuracaoAnthropicPainel)).not.toHaveBeenCalled();
    expect(await modos()).toEqual([{ modo: "humano", alterado_por: 1, lead_id: 2 }]);
    // cliente escreve: calada, registrado com o motivo próprio
    expect(await chamar(direta({ texto: "E a obra?" }))).toMatchObject({ "cliente-assumida": 1 });
    expect(enviarAoContato).not.toHaveBeenCalled();
    expect(pedidos).toEqual([]);
    expect((await q("SELECT situacao, motivo FROM dolores_atendimentos ORDER BY id DESC LIMIT 1"))[0]).toEqual({ situacao: "silencio", motivo: "a equipe assumiu esta conversa: Dolores calada até devolverem" });
    // a equipe responde pelo celular: continua assumida (sem prazo), mesmo muito depois do silêncio automático
    await chamar(direta({ fromMe: true, texto: "Oi João, aqui é a Bianca.", quando: AGORA }));
    const muitoDepois = new Date(AGORA.getTime() + 30 * 24 * HORA);
    expect((await situacaoDoSilencio(JOAO, muitoDepois, "prospecta-dolores")).estado).toBe("assumida");
    expect(await conversaEmSilencio(JOAO, muitoDepois)).toBe(true);
    expect((await admin().whatsapp.atendimentoDaConversa({ numero: JOAO }))).toMatchObject({ estado: "assumida" });
  });
});

describe("Devolver para a Dolores", () => {
  it("depois de assumida: a próxima mensagem do cliente já é respondida; as antigas não", async () => {
    await conversaDoJoao();
    await colaborador().whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "assumir" });
    await chamar(direta({ texto: "Ficou sem resposta" }));
    const r = await colaborador().whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "devolver" });
    expect(r).toMatchObject({ estado: "dolores" });
    // devolver não responde nada antigo nem chama a IA
    expect(enviarAoContato).not.toHaveBeenCalled();
    expect(pedidos).toEqual([]);
    expect(await modos()).toEqual([{ modo: "dolores", alterado_por: 2, lead_id: 2 }]);
    expect(await chamar(direta({ texto: "E agora?" }))).toMatchObject({ "cliente-respondida": 1 });
    expect(enviadosPara(JOAO)).toBe(1);
  });
  it("encerra o silêncio automático na hora; eco atrasado de mensagem anterior não recala; resposta nova da equipe recala pelo prazo normal", async () => {
    await conversaDoJoao();
    await chamar(direta({ fromMe: true, texto: "Oi João, a equipe aqui." }));
    const s = await admin().whatsapp.atendimentoDaConversa({ numero: JOAO });
    expect(s).toMatchObject({ elegivel: true, estado: "silencio" });
    expect(s.mostrar && new Date(s.ate!).getTime()).toBe(Math.floor((AGORA.getTime() - 20_000) / 1000) * 1000 + 6 * HORA);
    expect(await chamar(direta({ texto: "Oi?" }))).toMatchObject({ "cliente-equipe-respondeu": 1 });
    await admin().whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "devolver" });
    expect(await q("SELECT ate FROM whatsapp_silencio")).toEqual([{ ate: AGORA }]);
    // eco atrasado (mensagem da equipe de antes do Devolver) e o mesmo eco reentregue: não cala de novo
    await chamar(direta({ fromMe: true, texto: "Mensagem antiga da equipe", quando: new Date(AGORA.getTime() - 60_000) }));
    expect(await conversaEmSilencio(JOAO, AGORA, "prospecta-dolores")).toBe(false);
    expect(await chamar(direta({ texto: "E a obra?" }))).toMatchObject({ "cliente-respondida": 1 });
    // resposta nova da equipe (depois do Devolver) cala de novo pelo prazo normal
    await silenciarConversa(JOAO, 6, AGORA);
    expect(await situacaoDoSilencio(JOAO, AGORA, "prospecta-dolores")).toEqual({ estado: "silencio", ate: new Date(AGORA.getTime() + 6 * HORA) });
    expect(await chamar(direta({ texto: "Mais uma" }))).toMatchObject({ "cliente-equipe-respondeu": 1 });
  });
  it("a assunção vale só para a conexão (instância) atual; sem instância informada, qualquer uma cala (falha fechada)", async () => {
    await conversaDoJoao();
    await admin().whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "assumir" });
    expect(await conversaEmSilencio(JOAO, AGORA, "outra-instancia")).toBe(false);
    expect(await conversaEmSilencio(JOAO, AGORA)).toBe(true);
  });
  it("tetos e pausa geral continuam valendo depois de devolver", async () => {
    await conversaDoJoao();
    await admin().whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "assumir" });
    await admin().whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "devolver" });
    await banco.pg.exec("UPDATE dolores_config SET pausada = true, motivo_pausa = 'teste' WHERE id = 1");
    expect(await chamar(direta({ texto: "E a obra?" }))).toMatchObject({ "cliente-pausada": 1 });
    expect(enviarAoContato).not.toHaveBeenCalled();
  });
});

describe("quando o botão não aparece / a rota recusa", () => {
  it("atendimento a cliente desligado: frase curta, sem botão; a rota recusa e nada é ligado", async () => {
    await chamar(direta({ texto: "Oi" }));
    expect(await admin().whatsapp.atendimentoDaConversa({ numero: JOAO })).toMatchObject({ mostrar: true, elegivel: false, motivo: MOTIVO_NAO_ELEGIVEL.desligado });
    for (const acao of ["assumir", "devolver"] as const) await expect(admin().whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao })).rejects.toThrow(/desligado/);
    expect(await q("SELECT cliente_ligado FROM whatsapp_atendimento_config")).toEqual([{ cliente_ligado: false }]);
    expect(await modos()).toEqual([]);
  });
  it("número que não é de cliente cadastrado: frase curta, a rota recusa", async () => {
    await ligarAtendimento();
    await chamar(direta({ de: ESTRANHO, texto: "Oi" }));
    expect(await admin().whatsapp.atendimentoDaConversa({ numero: ESTRANHO })).toMatchObject({ mostrar: true, elegivel: false, motivo: MOTIVO_NAO_ELEGIVEL.desconhecido });
    await expect(admin().whatsapp.mudarAtendimentoDaConversa({ numero: ESTRANHO, acao: "assumir" })).rejects.toThrow(/cliente cadastrado/);
    expect(await modos()).toEqual([]);
  });
  it("conversa que não existe na Central da empresa: recusa", async () => {
    await ligarAtendimento();
    await expect(admin().whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "assumir" })).rejects.toThrow(/não encontrada/);
  });
  it("conversa do dono, do próprio número da empresa, grupo e número não identificado: nunca", async () => {
    await conversaDoJoao();
    for (const numero of [DONO, "99991234567", EMPRESA]) {
      expect(await admin().whatsapp.atendimentoDaConversa({ numero })).toEqual({ mostrar: false });
      await expect(admin().whatsapp.mudarAtendimentoDaConversa({ numero, acao: "assumir" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    for (const numero of [GRUPO, LID, `${JOAO}@s.whatsapp.net`]) {
      expect(await admin().whatsapp.atendimentoDaConversa({ numero })).toEqual({ mostrar: false });
      await expect(admin().whatsapp.mudarAtendimentoDaConversa({ numero, acao: "devolver" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(await modos()).toEqual([]);
  });
});

describe("permissão por papel (pelo appRouter)", () => {
  it("admin e colaborador com o módulo WhatsApp podem; corretor, colaborador sem o módulo e usuário inativo não", async () => {
    await conversaDoJoao();
    expect(await caller("corretor", 3, []).whatsapp.atendimentoDaConversa({ numero: JOAO })).toEqual({ mostrar: false });
    await expect(caller("corretor", 3, ["whatsapp"]).whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "assumir" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("colaborador", 2, ["crm"]).whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "assumir" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await caller("colaborador", 2, ["crm"]).whatsapp.atendimentoDaConversa({ numero: JOAO })).toEqual({ mostrar: false });
    await expect(caller("colaborador", 2, ["whatsapp"], false).whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "assumir" })).rejects.toThrow();
    expect(await modos()).toEqual([]);
    await expect(colaborador().whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "assumir" })).resolves.toMatchObject({ estado: "assumida" });
    await expect(admin().whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "devolver" })).resolves.toMatchObject({ estado: "dolores" });
  });
  it("a entrada é estrita (só número e ação)", async () => {
    await conversaDoJoao();
    await expect(admin().whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "ligar" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin().whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "assumir", clienteLigado: true } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("auditoria", () => {
  it("registra quem, quando, id da conversa e do lead — sem telefone", async () => {
    await conversaDoJoao();
    await admin().whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "assumir" });
    await colaborador().whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "devolver" });
    const linhas = await q<{ resultado: string; autor_user_id: number; canal: string; pedido_id: string; resumo: Record<string, unknown>; motivo: string }>(
      "SELECT resultado, autor_user_id, canal, pedido_id, resumo, motivo FROM dolores_acoes WHERE funcao = 'atendimento_conversa' ORDER BY id");
    const [{ id }] = await q<{ id: number }>("SELECT id FROM whatsapp_atendimento_modo");
    expect(linhas).toMatchObject([
      { resultado: "ok", autor_user_id: 1, canal: "tela", pedido_id: `conversa:${id}`, resumo: { conversaId: id, leadId: 2, acao: "assumir", antes: "dolores" } },
      { resultado: "ok", autor_user_id: 2, canal: "tela", pedido_id: `conversa:${id}`, resumo: { conversaId: id, leadId: 2, acao: "devolver", antes: "assumida" } },
    ]);
    expect(JSON.stringify(linhas)).not.toMatch(/88887777|9988887777/);
    expect(JSON.stringify(await q("SELECT * FROM whatsapp_atendimento_modo"))).not.toMatch(/88887777/);
  });
});
