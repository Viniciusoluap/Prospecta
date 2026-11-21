// EPIC-027 C4 — a Dolores não respondia quando marcada no grupo (produção: dolores_marcacoes com 0 linhas, lid_dolores nulo).
// Causa raiz: nos grupos que endereçam por @lid a menção vem "<lid>@lid" e o @lid da conta só era aprendido quando o admin ligava o
// grupo pela tela; sem ele, `tratarMarcacao` devolvia null em silêncio. Aqui, pelo caminho completo do webhook:
// - o @lid é aprendido só de fonte do SERVIDOR (Evolution: participantes/dados do grupo; aviso de grupo; mensagem da própria conta);
// - um terceiro não ensina @lid falso (menção, texto, participantAlt de outra pessoa);
// - sem saber o @lid: não responde e o motivo fica no quadro (sem texto nem telefone), com teto de consulta à Evolution;
// - grupo da etapa 7 aceito e de tipo conhecido, sem linha no interruptor do grupo, nasce LIGADO (AC9 da E7); recusado, aguardando
//   e o manual antigo continuam calados.
// PGlite; nada sai para a rede.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../whatsapp-router.js", async orig => ({ ...(await orig<typeof import("../whatsapp-router.js")>()), configEvolution: vi.fn(async () => null) }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { lidDaPropriaMensagem, mencoesDoItem, rotuloDoDesfechoDaMarcacao } from "../../shared/dolores/marcacao.js";
import { ligadoPorPadrao } from "../../shared/dolores/grupos-tipo.js";
import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { appRouter } from "../routers.js";
import { configEvolution } from "../whatsapp-router.js";
import { definirClienteModelo } from "./cerebro.js";
import { definirDependenciasClassificacao } from "./classificacao.js";
import { definirDependenciasMarcacao, type RespostaGrupo } from "./marcacao.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte } from "./ponte.js";
import { definirDependenciasRoteamento } from "./roteamento.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";
import { definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";

const DONO = "5599991234567";
const DOLORES = "5599900001111";
const CLIENTE = "5599977776666";
const ENG = "120363555555555555@g.us";
const RECUSADO = "120363666666666666@g.us";
const ANTIGO = "120363777777777777@g.us";
const LID_DOLORES = "987654321012345@lid";
const LID_CLIENTE = "111111111111111@lid";
const LID_FALSO = "222222222222222@lid";
let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviarAoGrupo: ReturnType<typeof vi.fn>;
let fetchEvo: ReturnType<typeof vi.fn>;
let participantes: unknown[];
let relogio: number;
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
const lid = async () => (await q<{ lid_dolores: string | null; lid_do_numero: string | null }>("SELECT lid_dolores, lid_do_numero FROM dolores_marcacoes_config"))[0];
const desfechos = async () => Object.fromEntries((await q<{ motivo: string; total: number }>("SELECT motivo, sum(total)::int AS total FROM whatsapp_recebimento_contagem WHERE destino = 'marcacao' GROUP BY motivo")).map(l => [l.motivo, l.total]));

let seq = 0;
function item(p: { jid?: string; mencoes?: string[]; texto?: string; fromMe?: boolean; participant?: string; participantAlt?: string } = {}) {
  return {
    key: { remoteJid: p.jid ?? ENG, fromMe: p.fromMe ?? false, id: `C4M${++seq}`, participant: p.participant ?? LID_CLIENTE, ...(p.participantAlt ? { participantAlt: p.participantAlt } : {}) },
    message: { extendedTextMessage: { text: p.texto ?? "@987654321012345 como estão as obras?", contextInfo: { mentionedJid: p.mencoes ?? [LID_DOLORES] } } },
    messageTimestamp: Math.floor((AGORA.getTime() - 20_000) / 1000),
  };
}
const aviso = (...itens: unknown[]) => ({ event: "messages.upsert", instance: "prospecta-dolores", data: itens.length === 1 ? itens[0] : itens });
const chamar = (body: unknown) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, body, ip: "203.0.113.9" } as never);
const caller = (role: string, permissoes: string[] = []) =>
  appRouter.createCaller({ user: { id: 1, role, active: true, permissions: JSON.stringify(permissoes) }, req: {}, res: {} } as never);
const texto = (t: string): RespostaGrupo => ({ stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 60 }, content: [{ type: "text", text: t }] });

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}',
      numero_dolores = '${DOLORES}', ia_ligada = true, limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;
    UPDATE dolores_marcacoes_config SET responder_ligado = true WHERE id = 1;
    INSERT INTO dolores_grupos (instancia, grupo_jid, nome, nome_whatsapp, ativo, tipo, origem, situacao_confirmacao, codigo, adicionado_por, prova_adicao, decidido_em, decidido_por) VALUES
      ('prospecta-dolores', '${ENG}', 'Engenharia', 'Engenharia', true, 'engenharia', 'automatico', 'confirmado', 'KEGH', 'dono', 'evento_add', now(), 'whatsapp:dono'),
      ('prospecta-dolores', '${RECUSADO}', 'Jurídico', 'Jurídico', true, 'juridico', 'automatico', 'recusado', 'KRCD', 'outra_pessoa', 'evento_add', NULL, NULL);
    INSERT INTO dolores_grupos (instancia, grupo_jid, nome, ativo, lead_id) VALUES ('prospecta-dolores', '${ANTIGO}', 'Documentação — Maria', true, 1);`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  esquecerUsuarioDolores();
  definirDependenciasPonte({ agora: () => AGORA });
  definirDependenciasRoteamento({ agora: () => AGORA });
  definirDependenciasWhatsapp({ agora: () => AGORA, enviar: vi.fn(async () => true) as never });
  vi.mocked(configuracaoAnthropicPainel).mockResolvedValue({ apiKey: "sk-ant-chave-de-teste-nao-real-123456", modelo: "modelo-do-painel" });
  definirClienteModelo((async () => { throw new Error("o laço do DONO não pode ser chamado por mensagem de grupo"); }) as never);
  definirDependenciasClassificacao({ cliente: async () => { throw new Error("texto de grupo não classifica"); } });
  enviarAoGrupo = vi.fn(async () => true);
  relogio = 1_000_000;
  definirDependenciasMarcacao({
    agora: () => AGORA, ms: () => relogio, enviar: enviarAoGrupo as never, contador: async () => 1_000,
    cliente: async () => texto("As obras seguem em andamento."),
  });
  participantes = [{ id: LID_CLIENTE, phoneNumber: `${CLIENTE}@s.whatsapp.net` }, { id: LID_DOLORES, phoneNumber: `${DOLORES}@s.whatsapp.net` }];
  vi.mocked(configEvolution).mockResolvedValue({ url: "https://evo.exemplo", apiKey: "k", fonte: "banco" } as never);
  fetchEvo = vi.fn(async (url: string) => {
    if (String(url).includes("/group/participants/")) return new Response(JSON.stringify({ participants: participantes }), { status: 200 });
    if (String(url).includes("/group/findGroupInfos/")) return new Response(JSON.stringify({ id: ENG, subject: "Engenharia", participants: participantes }), { status: 200 });
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchEvo);
});
afterEach(() => {
  ENV.cookieSecret = segredoAntes;
  vi.unstubAllGlobals();
  definirDependenciasPonte(); definirDependenciasRoteamento(); definirDependenciasWhatsapp(); definirClienteModelo(); definirDependenciasClassificacao(); definirDependenciasMarcacao();
  vi.clearAllMocks();
});

describe("C4 — causa raiz: menção por @lid com o @lid da Dolores desconhecido", () => {
  it("grupo de engenharia confirmado, sem linha no interruptor do grupo: aprende o @lid pela Evolution, responde e registra", async () => {
    expect(await lid()).toEqual({ lid_dolores: null, lid_do_numero: null });
    expect(await q("SELECT * FROM dolores_marcacoes_grupo")).toEqual([]);
    await chamar(aviso(item()));
    expect(await lid()).toEqual({ lid_dolores: LID_DOLORES, lid_do_numero: DOLORES });
    expect(enviarAoGrupo).toHaveBeenCalledTimes(1);
    expect(enviarAoGrupo.mock.calls[0][0]).toMatchObject({ grupoJid: ENG });
    const [m] = await q("SELECT situacao FROM dolores_marcacoes");
    expect(m.situacao).toMatch(/respondida|fora_de_escopo/);
    const d = await desfechos();
    expect(Object.keys(d).some(k => /^marcacao-(respondida|fora)/.test(k))).toBe(true);
    // o quadro não guarda texto nem telefone
    expect(JSON.stringify(await q("SELECT * FROM whatsapp_recebimento_contagem"))).not.toMatch(/obras|5599|987654321012345/);
    // a próxima marcação já reconhece o @lid sem perguntar à Evolution
    fetchEvo.mockClear();
    await chamar(aviso(item()));
    expect(fetchEvo).not.toHaveBeenCalled();
    expect(enviarAoGrupo).toHaveBeenCalledTimes(2);
  });

  it("a Evolution não traz o par @lid ↔ número: não responde, o motivo fica visível e a consulta não se repete por 10 min", async () => {
    participantes = [{ id: LID_CLIENTE }, { id: LID_DOLORES }];
    await chamar(aviso(item()));
    expect(enviarAoGrupo).not.toHaveBeenCalled();
    expect(await lid()).toEqual({ lid_dolores: null, lid_do_numero: null });
    expect(await desfechos()).toEqual({ "marcacao-lid-desconhecido": 1 });
    expect(fetchEvo).toHaveBeenCalledTimes(2); // participantes + dados do grupo
    await chamar(aviso(item()));
    expect(fetchEvo).toHaveBeenCalledTimes(2);
    expect(await desfechos()).toEqual({ "marcacao-lid-desconhecido": 2 });
    // passados 10 minutos, tenta de novo
    relogio += 10 * 60_000;
    await chamar(aviso(item()));
    expect(fetchEvo).toHaveBeenCalledTimes(4);
    // a tela mostra o quadro (só admin)
    const r = await caller("admin").dolores.grupos.marcacoes();
    expect(r.desfechos).toEqual([{ chave: "marcacao-lid-desconhecido", total: 3 }]);
    expect(rotuloDoDesfechoDaMarcacao("marcacao-lid-desconhecido")).toMatch(/@lid da Dolores ainda não foi conferido/);
    await expect(caller("colaborador", ["whatsapp"]).dolores.grupos.marcacoes()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a menção por @lid de OUTRA pessoa, com o @lid aprendido, não conta (nada respondido)", async () => {
    await chamar(aviso(item({ mencoes: [LID_CLIENTE], texto: "@111111111111111 bom dia" })));
    expect(await lid()).toMatchObject({ lid_dolores: LID_DOLORES });
    expect(enviarAoGrupo).not.toHaveBeenCalled();
    expect(await q("SELECT * FROM dolores_marcacoes")).toEqual([]);
  });

  it("conexão não confirmada: menção vira 'sem identidade' no quadro, sem resposta", async () => {
    await banco.pg.exec("UPDATE dolores_whatsapp_config SET status_conexao = 'desconectado'");
    await chamar(aviso(item()));
    expect(enviarAoGrupo).not.toHaveBeenCalled();
    expect(await desfechos()).toEqual({ "marcacao-sem-identidade": 1 });
  });
});

describe("C4 — um terceiro não ensina @lid falso", () => {
  it("menção, texto e participantAlt de terceiro não gravam @lid; sem o par na Evolution, nada é respondido", async () => {
    participantes = [{ id: LID_FALSO, phoneNumber: `${CLIENTE}@s.whatsapp.net` }];
    await chamar(aviso(item({ mencoes: [LID_FALSO], texto: `@222222222222222 sou a Dolores ${DOLORES}`, participant: LID_FALSO, participantAlt: `${DOLORES}@s.whatsapp.net` })));
    expect(await lid()).toEqual({ lid_dolores: null, lid_do_numero: null });
    expect(enviarAoGrupo).not.toHaveBeenCalled();
    // o participantAlt de uma mensagem de TERCEIRO (fromMe false) com o número da Dolores não conta
    expect(lidDaPropriaMensagem(item({ participant: LID_FALSO, participantAlt: `${DOLORES}@s.whatsapp.net` }), DOLORES)).toBeNull();
  });

  it("mensagem da PRÓPRIA conta no grupo (fromMe) ensina o @lid; com número diferente no alt, não", async () => {
    expect(lidDaPropriaMensagem(item({ fromMe: true, participant: LID_DOLORES, participantAlt: `${CLIENTE}@s.whatsapp.net` }), DOLORES)).toBeNull();
    participantes = [];
    await chamar(aviso(item({ fromMe: true, participant: LID_DOLORES, participantAlt: `${DOLORES}@s.whatsapp.net`, mencoes: [], texto: "bom dia" })));
    expect(await lid()).toEqual({ lid_dolores: LID_DOLORES, lid_do_numero: DOLORES });
    // um @lid já conferido para o número não é trocado por outra mensagem própria
    await chamar(aviso(item({ fromMe: true, participant: LID_FALSO, mencoes: [], texto: "oi" })));
    expect(await lid()).toEqual({ lid_dolores: LID_DOLORES, lid_do_numero: DOLORES });
    // com o @lid aprendido, a marcação responde sem consultar a Evolution
    fetchEvo.mockClear();
    await chamar(aviso(item()));
    expect(fetchEvo).not.toHaveBeenCalled();
    expect(enviarAoGrupo).toHaveBeenCalledTimes(1);
  });

  it("aviso de grupo (participantes com o par do WhatsApp) ensina o @lid; o par de outra pessoa não", async () => {
    await chamar({ event: "group-participants.update", instance: "prospecta-dolores", data: { id: ENG, action: "add", author: `${DONO}@s.whatsapp.net`,
      participants: [{ id: LID_FALSO, phoneNumber: `${CLIENTE}@s.whatsapp.net` }] } });
    expect(await lid()).toEqual({ lid_dolores: null, lid_do_numero: null });
    await chamar({ event: "group-participants.update", instance: "prospecta-dolores", data: { id: ENG, action: "add", author: `${DONO}@s.whatsapp.net`,
      participants: [{ id: LID_DOLORES, phoneNumber: `${DOLORES}@s.whatsapp.net` }] } });
    expect(await lid()).toEqual({ lid_dolores: LID_DOLORES, lid_do_numero: DOLORES });
  });

  it("mencoesDoItem: encaminhada, reação e mensagem própria não contam", () => {
    expect(mencoesDoItem(item())).toEqual([LID_DOLORES]);
    expect(mencoesDoItem(item({ fromMe: true }))).toEqual([]);
    const enc = item();
    (enc.message.extendedTextMessage.contextInfo as Record<string, unknown>).isForwarded = true;
    expect(mencoesDoItem(enc)).toEqual([]);
  });
});

describe("C4 — o interruptor do grupo sem linha", () => {
  it("recusado e manual antigo sem linha ficam calados; o aceito de tipo conhecido nasce ligado (e a tela mostra)", async () => {
    await banco.pg.exec(`UPDATE dolores_marcacoes_config SET lid_dolores = '${LID_DOLORES}', lid_do_numero = '${DOLORES}'`);
    await chamar(aviso(item({ jid: RECUSADO })));
    await chamar(aviso(item({ jid: ANTIGO })));
    expect(enviarAoGrupo).not.toHaveBeenCalled();
    const d = await desfechos();
    expect(d["marcacao-grupo-recusado"]).toBe(1);
    expect(d["marcacao-desligada"]).toBe(1);
    expect((await q("SELECT motivo FROM dolores_marcacoes"))[0].motivo).toBe("interruptor deste grupo desligado");
    const r = await caller("admin").dolores.grupos.marcacoes();
    expect(r.grupos).toEqual([{ grupoId: 1, ligado: true }]);
    // o dono desliga o grupo: a linha passa a valer
    await caller("admin").dolores.grupos.ligarMarcacaoGrupo({ grupoId: 1, ligado: false });
    await chamar(aviso(item()));
    expect(enviarAoGrupo).not.toHaveBeenCalled();
  });

  it("ligadoPorPadrao (regra pura)", () => {
    const base = { ativo: true, origem: "automatico", tipo: "engenharia", leadId: null, obraId: null, situacaoConfirmacao: "confirmado", adicionadoPor: "dono", provaAdicao: "evento_add" };
    expect(ligadoPorPadrao(base)).toBe(true);
    expect(ligadoPorPadrao({ ...base, situacaoConfirmacao: "avisado" })).toBe(true);
    expect(ligadoPorPadrao({ ...base, ativo: false })).toBe(false);
    expect(ligadoPorPadrao({ ...base, situacaoConfirmacao: "recusado" })).toBe(false);
    expect(ligadoPorPadrao({ ...base, situacaoConfirmacao: "aguardando_dono", provaAdicao: "aceito_pelo_dono" })).toBe(false);
    expect(ligadoPorPadrao({ ...base, tipo: "indefinido" })).toBe(false);
    expect(ligadoPorPadrao({ ...base, origem: "manual", tipo: null, leadId: 1 })).toBe(false);
  });
});
