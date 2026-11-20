// QA-SEG C6 (Quinn, 20/11/2026) — provas do portão de segurança independente do "Assumir (humano)" / "Devolver para a Dolores".
// Mesmo cenário do c6-assumir-devolver.test.ts (PGlite; nada sai para a rede).
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

const em = (ms: number) => new Date(AGORA.getTime() + ms);
const comRelogio = (d: Date) => definirDependenciasRoteamento({ agora: () => d, enviar: enviarAoContato as never });

describe("QA-SEG C6 — permissão e vazamento", () => {
  it("anônimo é barrado nas duas rotas; corretor COM o módulo e colaborador sem o módulo não veem nada", async () => {
    await conversaDoJoao();
    const anon = appRouter.createCaller({ user: null, req: {}, res: {} } as never);
    await expect(anon.whatsapp.atendimentoDaConversa({ numero: JOAO })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anon.whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "assumir" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await caller("corretor", 3, ["whatsapp"]).whatsapp.atendimentoDaConversa({ numero: JOAO })).toEqual({ mostrar: false });
    await expect(caller("corretor", 3, ["whatsapp"]).whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "devolver" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("colaborador", 2, []).whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "devolver" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await modos()).toEqual([]);
  });
  it("a consulta não é oráculo: número inexistente, dono e empresa dão a MESMA resposta ({ mostrar: false })", async () => {
    await conversaDoJoao();
    for (const numero of ["5599911112222", DONO, EMPRESA]) expect(await admin().whatsapp.atendimentoDaConversa({ numero })).toEqual({ mostrar: false });
  });
  it("[baixo] a MUTAÇÃO distingue o número do dono (FORBIDDEN) de um número sem conversa (BAD_REQUEST) — só para admin/colaborador", async () => {
    await conversaDoJoao();
    await expect(admin().whatsapp.mudarAtendimentoDaConversa({ numero: DONO, acao: "assumir" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(admin().whatsapp.mudarAtendimentoDaConversa({ numero: "5599911112222", acao: "assumir" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("QA-SEG C6 — variações de formato do número", () => {
  it("assumir por um formato cala o webhook que chega em outro; uma linha só", async () => {
    await conversaDoJoao();
    await admin().whatsapp.mudarAtendimentoDaConversa({ numero: "+55 (99) 98888-7777", acao: "assumir" });
    for (const v of ["99988887777", "9988887777", "559988887777", "5599988887777"]) {
      expect((await admin().whatsapp.atendimentoDaConversa({ numero: v }))).toMatchObject({ estado: "assumida" });
      await expect(admin().whatsapp.mudarAtendimentoDaConversa({ numero: v, acao: "assumir" })).resolves.toMatchObject({ estado: "assumida" });
    }
    expect((await modos()).length).toBe(1);
    expect(await chamar(direta({ de: "559988887777", texto: "Sem o 9" }))).toMatchObject({ "cliente-assumida": 1 });
    expect(enviarAoContato).not.toHaveBeenCalled();
  });
  it("sufixo de aparelho / @s.whatsapp.net / número inventado com os mesmos 8 finais: recusa ou não elegível, nada gravado", async () => {
    await conversaDoJoao();
    for (const numero of [`${JOAO}:12@s.whatsapp.net`, `${JOAO}@s.whatsapp.net`]) await expect(admin().whatsapp.mudarAtendimentoDaConversa({ numero, acao: "devolver" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // dígitos extras no meio: mesmos DDD + 8 finais (casa com a conversa), forma canônica diferente
    await expect(admin().whatsapp.mudarAtendimentoDaConversa({ numero: "55991188887777", acao: "assumir" })).rejects.toThrow();
    expect(await modos()).toEqual([]);
  });
});

describe("QA-SEG C6 — falha segura e migração", () => {
  it("erro de leitura que NÃO é 42P01 (coluna sumida) → calada", async () => {
    await conversaDoJoao();
    await banco.pg.exec(`ALTER TABLE whatsapp_atendimento_modo RENAME COLUMN modo TO modo_x`);
    expect(await situacaoDoSilencio(JOAO, AGORA, "prospecta-dolores")).toEqual({ estado: "silencio", ate: null });
    expect(await chamar(direta({ texto: "Oi?" }))).not.toMatchObject({ "cliente-respondida": 1 });
    expect(enviarAoContato).not.toHaveBeenCalled();
  });
  it("código antes da migração (tabela inexistente): regra antiga; a mutação falha sem expor o telefone", async () => {
    await conversaDoJoao();
    await banco.pg.exec(`DROP TABLE whatsapp_atendimento_modo`);
    expect(await situacaoDoSilencio(JOAO, AGORA, "prospecta-dolores")).toEqual({ estado: "dolores", ate: null });
    await chamar(direta({ fromMe: true, texto: "Equipe aqui", quando: AGORA }));
    expect((await situacaoDoSilencio(JOAO, AGORA, "prospecta-dolores")).estado).toBe("silencio");
    const erro = await admin().whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "assumir" }).catch(e => e as Error);
    expect(erro).toBeInstanceOf(Error);
    expect(String((erro as Error).message)).not.toMatch(/88887777/);
  });
  it("0138 aplicada 3× e ON DELETE SET NULL do usuário: a linha continua (assumida), só perde o autor", async () => {
    await conversaDoJoao();
    await banco.pg.exec(MIGRACAO_0138());
    const [{ id: qa }] = await q<{ id: number }>(`INSERT INTO users ("openId", name, role, active, "passwordHash") VALUES ('qa', 'QA Temp', 'colaborador', true, 'hash') RETURNING id`);
    await caller("colaborador", qa).whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "assumir" });
    await banco.pg.exec(`DELETE FROM dolores_acoes WHERE autor_user_id = ${qa}; DELETE FROM users WHERE id = ${qa}`);
    expect(await modos()).toEqual([{ modo: "humano", alterado_por: null, lead_id: 2 }]);
    expect((await situacaoDoSilencio(JOAO, AGORA, "prospecta-dolores")).estado).toBe("assumida");
    await expect(banco.pg.exec(`INSERT INTO whatsapp_atendimento_modo (instancia, chave_numero, modo) VALUES ('x', 'y', 'outro')`)).rejects.toThrow();
  });
});

describe("QA-SEG C6 — Devolver não fura o silêncio", () => {
  it("devolver em laço não dispara IA nem mensagem e não responde nada antigo", async () => {
    await conversaDoJoao();
    await admin().whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "assumir" });
    expect(await chamar(direta({ texto: "pergunta sem resposta" }))).toMatchObject({ "cliente-assumida": 1 });
    enviarAoContato.mockClear(); pedidos = []; vi.mocked(configuracaoAnthropicPainel).mockClear();
    for (let i = 0; i < 5; i++) {
      await admin().whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "assumir" });
      await admin().whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "devolver" });
    }
    expect(enviarAoContato).not.toHaveBeenCalled();
    expect(pedidos).toEqual([]);
    expect(vi.mocked(configuracaoAnthropicPainel)).not.toHaveBeenCalled();
  });
  it("[médio] resposta da equipe pelo CELULAR no MESMO segundo, logo depois do Devolver, não recala (timestamp do WhatsApp em segundos) → Dolores responde enquanto o humano conversa", async () => {
    await conversaDoJoao();
    comRelogio(em(700));
    await admin().whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "devolver" });
    // a equipe responde pelo celular 200 ms DEPOIS do Devolver; o WhatsApp informa o envio em segundos (12:00:00)
    comRelogio(em(1_500));
    await chamar(direta({ fromMe: true, texto: "Oi João, deixa comigo.", quando: em(900) }));
    expect(await conversaEmSilencio(JOAO, em(1_500), "prospecta-dolores")).toBe(false); // ACHADO: deveria estar calada
  });
  it("resposta da equipe pela Central depois do Devolver recala (relógio do servidor, ms)", async () => {
    await conversaDoJoao();
    comRelogio(em(700));
    await admin().whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "devolver" });
    await silenciarConversa(JOAO, 6, em(701));
    expect(await conversaEmSilencio(JOAO, em(800), "prospecta-dolores")).toBe(true);
  });
  it("devolver com atendimento desligado, pausa geral ou telefone em dois cadastros: nada liga, ela não responde", async () => {
    await conversaDoJoao();
    await banco.pg.exec(`INSERT INTO leads (name, phone, stage, created_at, updated_at) VALUES ('Outro João', '(99) 98888-7777', 'attending', now(), now())`);
    expect(await admin().whatsapp.atendimentoDaConversa({ numero: JOAO })).toMatchObject({ elegivel: false, motivo: MOTIVO_NAO_ELEGIVEL.varios });
    await expect(admin().whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "devolver" })).rejects.toThrow(/mais de um cadastro/);
    expect(await chamar(direta({ texto: "E agora?" }))).not.toMatchObject({ "cliente-respondida": 1 });
    expect(enviarAoContato).not.toHaveBeenCalled();
  });
});

describe("QA-SEG C6 — Assumir sobrevive", () => {
  it("eco do celular, resposta pela Central e reentrega do mesmo eco não desfazem a assunção", async () => {
    await conversaDoJoao();
    await admin().whatsapp.mudarAtendimentoDaConversa({ numero: JOAO, acao: "assumir" });
    const eco = direta({ fromMe: true, texto: "Equipe", quando: AGORA });
    await chamar(eco); await chamar(eco);
    await silenciarConversa(JOAO, 6, em(10));
    expect((await situacaoDoSilencio(JOAO, em(30 * 24 * 3600_000), "prospecta-dolores")).estado).toBe("assumida");
    expect(await chamar(direta({ texto: "?" }))).toMatchObject({ "cliente-assumida": 1 });
    expect(enviarAoContato).not.toHaveBeenCalled();
  });
});
