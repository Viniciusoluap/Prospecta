// Portão de QA de SEGURANÇA (independente) — EPIC-027 C4 (@lid), C3 (classificar pela tela, resposta só com o número, 0139).
// Testes de PROVA: os que começam por "ACHADO" documentam comportamento atual que o QA considera risco (passam hoje de propósito,
// para provar o achado; quando a trava for feita, invertam a expectativa). PGlite; nada sai para a rede.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../whatsapp-router.js", async orig => ({ ...(await orig<typeof import("../whatsapp-router.js")>()), configEvolution: vi.fn(async () => null) }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { PERMITIDOS_POR_TIPO } from "../../shared/dolores/marcacao.js";
import { ligadoPorPadrao, perguntaDoTipo, textoDasOpcoes } from "../../shared/dolores/grupos-tipo.js";
import { sanitizarTexto } from "../../shared/dolores/sanitizar.js";
import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { appRouter } from "../routers.js";
import { configEvolution } from "../whatsapp-router.js";
import { definirClienteModelo } from "./cerebro.js";
import { definirDependenciasClassificacao } from "./classificacao.js";
import { FILTRO_DO_REGISTRO, filtroDaSaida } from "./dados-pessoais.js";
import { conferirLidDaDolores, definirDependenciasMarcacao, type RespostaGrupo } from "./marcacao.js";
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
const FORA = "120363888888888888@g.us";
const MANUAL = "120363444444444444@g.us";
const ESPERA = "120363333333333333@g.us";
const LID_DOLORES = "987654321012345@lid";
const LID_CLIENTE = "111111111111111@lid";
const LID_FALSO = "222222222222222@lid";
let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviarAoGrupo: ReturnType<typeof vi.fn>;
let enviarAoDono: ReturnType<typeof vi.fn>;
let fetchEvo: ReturnType<typeof vi.fn>;
let participantes: unknown[];
let relogio: number;
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
const lid = async () => (await q<{ lid_dolores: string | null; lid_do_numero: string | null }>("SELECT lid_dolores, lid_do_numero FROM dolores_marcacoes_config"))[0];
const desfechos = async () => Object.fromEntries((await q<{ motivo: string; total: number }>("SELECT motivo, sum(total)::int AS total FROM whatsapp_recebimento_contagem WHERE destino = 'marcacao' GROUP BY motivo")).map(l => [l.motivo, l.total]));
const grupoPorJid = async (jid: string) => (await q(`SELECT id, tipo, situacao_confirmacao, adicionado_por, prova_adicao, decidido_por, ativo FROM dolores_grupos WHERE grupo_jid = '${jid}'`))[0];

let seq = 0;
function item(p: { jid?: string; mencoes?: string[]; texto?: string; fromMe?: boolean; participant?: string; participantAlt?: string } = {}) {
  return {
    key: { remoteJid: p.jid ?? ENG, fromMe: p.fromMe ?? false, id: `QAD${++seq}`, participant: p.participant ?? LID_CLIENTE, ...(p.participantAlt ? { participantAlt: p.participantAlt } : {}) },
    message: { extendedTextMessage: { text: p.texto ?? "@987654321012345 como estão as obras?", contextInfo: { mentionedJid: p.mencoes ?? [LID_DOLORES] } } },
    messageTimestamp: Math.floor((AGORA.getTime() - 20_000) / 1000),
  };
}
const aviso = (it: unknown, instancia = "prospecta-dolores") => ({ event: "messages.upsert", instance: instancia, data: it });
const chamar = (body: unknown, token: string | null = segredoWebhookDolores()) =>
  tratarWebhookDolores({ headers: token === null ? {} : { "x-webhook-token": token }, body, ip: "203.0.113.9" } as never);
const doDono = (texto: string) => aviso({ key: { remoteJid: `${DONO}@s.whatsapp.net`, fromMe: false, id: `QADD${++seq}` }, message: { conversation: texto }, messageTimestamp: Math.floor((AGORA.getTime() - 10_000) / 1000) });
const caller = (role: string, permissoes: string[] = [], id = 1) =>
  appRouter.createCaller({ user: { id, role, active: true, permissions: JSON.stringify(permissoes) }, req: {}, res: {} } as never);
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
      ('prospecta-dolores', '${RECUSADO}', 'Jurídico', 'Jurídico', true, 'juridico', 'automatico', 'recusado', 'KRCD', 'outra_pessoa', 'evento_add', NULL, NULL);`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  esquecerUsuarioDolores();
  definirDependenciasPonte({ agora: () => AGORA });
  definirDependenciasRoteamento({ agora: () => AGORA });
  enviarAoDono = vi.fn(async () => true);
  definirDependenciasWhatsapp({ agora: () => AGORA, enviar: enviarAoDono as never });
  vi.mocked(configuracaoAnthropicPainel).mockResolvedValue({ apiKey: "sk-ant-chave-de-teste-nao-real-123456", modelo: "modelo-do-painel" });
  definirClienteModelo((async () => { throw new Error("o laço do DONO não deve ser chamado aqui"); }) as never);
  definirDependenciasClassificacao({ cliente: async () => { throw new Error("texto de grupo não classifica"); } });
  enviarAoGrupo = vi.fn(async () => true);
  relogio = 1_000_000;
  definirDependenciasMarcacao({ agora: () => AGORA, ms: () => relogio, enviar: enviarAoGrupo as never, contador: async () => 1_000, cliente: async () => texto("As obras seguem em andamento.") });
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

describe("QA C4 — aprendizado do @lid", () => {
  it("fromMe forjado SEM o segredo do webhook, ou de OUTRA instância: nada é aprendido nem respondido", async () => {
    participantes = [];
    const forjado = item({ fromMe: true, participant: LID_FALSO, participantAlt: `${DOLORES}@s.whatsapp.net`, mencoes: [] });
    const r1 = await chamar(aviso(forjado), null);
    expect(r1.status).toBeGreaterThanOrEqual(400);
    await chamar(aviso(forjado), "token-errado");
    await chamar(aviso(item({ fromMe: true, participant: LID_FALSO, mencoes: [] }), "outra-instancia"));
    await chamar({ event: "group-participants.update", instance: "outra-instancia", data: { id: ENG, action: "add", author: `${DONO}@s.whatsapp.net`,
      participants: [{ id: LID_FALSO, phoneNumber: `${DOLORES}@s.whatsapp.net` }] } });
    expect(await lid()).toEqual({ lid_dolores: null, lid_do_numero: null });
    expect(enviarAoGrupo).not.toHaveBeenCalled();
  });

  it("@lid já conferido não é trocado: aviso de grupo com outro par para o número da Dolores, nem mensagem própria com outro @lid", async () => {
    await banco.pg.exec(`UPDATE dolores_marcacoes_config SET lid_dolores = '${LID_DOLORES}', lid_do_numero = '${DOLORES}'`);
    await chamar({ event: "group-participants.update", instance: "prospecta-dolores", data: { id: ENG, action: "add", author: `${DONO}@s.whatsapp.net`,
      participants: [{ id: LID_FALSO, phoneNumber: `${DOLORES}@s.whatsapp.net` }] } });
    await chamar(aviso(item({ fromMe: true, participant: LID_FALSO, participantAlt: `${DOLORES}@s.whatsapp.net`, mencoes: [] })));
    expect(await lid()).toEqual({ lid_dolores: LID_DOLORES, lid_do_numero: DOLORES });
    // a menção com o @lid falso não faz a Dolores responder
    await chamar(aviso(item({ mencoes: [LID_FALSO], texto: "@222222222222222 oi" })));
    expect(enviarAoGrupo).not.toHaveBeenCalled();
  });

  it("Evolution devolvendo DOIS @lid para o número da Dolores: não grava (conferência pela tela e pela marcação)", async () => {
    participantes = [{ id: LID_DOLORES, phoneNumber: `${DOLORES}@s.whatsapp.net` }, { id: LID_FALSO, phoneNumber: `${DOLORES}@s.whatsapp.net` }];
    const r = await conferirLidDaDolores(1, { userId: 1, origem: "tela" });
    expect(r.conferido).toBe(false);
    await chamar(aviso(item()));
    expect(await lid()).toEqual({ lid_dolores: null, lid_do_numero: null });
    expect(enviarAoGrupo).not.toHaveBeenCalled();
  });

  it("um terceiro mencionando OUTRA pessoa por @lid não 'queima' nada: a consulta aprende o @lid CERTO e nada é respondido", async () => {
    await chamar(aviso(item({ mencoes: [LID_CLIENTE], texto: "@111111111111111 bom dia", participant: LID_FALSO })));
    expect(await lid()).toEqual({ lid_dolores: LID_DOLORES, lid_do_numero: DOLORES });
    expect(enviarAoGrupo).not.toHaveBeenCalled();
    expect(await q("SELECT * FROM dolores_marcacoes")).toEqual([]);
    // a marcação real a seguir é respondida sem nova consulta
    fetchEvo.mockClear();
    await chamar(aviso(item()));
    expect(fetchEvo).not.toHaveBeenCalled();
    expect(enviarAoGrupo).toHaveBeenCalledTimes(1);
  });

  it("grupo fora da lista e recusado: marcação pelo número da Dolores não responde, não grava linha nem consulta a Evolution", async () => {
    await chamar(aviso(item({ jid: FORA, mencoes: [`${DOLORES}@s.whatsapp.net`] })));
    await chamar(aviso(item({ jid: RECUSADO, mencoes: [`${DOLORES}@s.whatsapp.net`] })));
    await chamar(aviso(item({ jid: RECUSADO }))); // @lid desconhecido em grupo recusado
    expect(enviarAoGrupo).not.toHaveBeenCalled();
    // grupo desconhecido entra pela E7 (consulta findGroupInfos para o nome — comportamento anterior); a CONSULTA DO @lid
    // (/group/participants) não é feita para grupo recusado nem fora da lista
    expect(fetchEvo.mock.calls.filter(c => String(c[0]).includes("/group/participants/"))).toEqual([]);
    expect(await lid()).toEqual({ lid_dolores: null, lid_do_numero: null });
    const d = await desfechos();
    expect(d["marcacao-grupo-recusado"]).toBeGreaterThanOrEqual(2); // o grupo desconhecido entra pela E7 como recusado (sem prova do dono)
    expect(await q(`SELECT m.situacao FROM dolores_marcacoes m JOIN dolores_grupos g ON g.id = m.grupo_id WHERE g.situacao_confirmacao = 'recusado'`)).toEqual([]);
    const fora = await grupoPorJid(FORA);
    if (fora) expect(fora.situacao_confirmacao).not.toBe("confirmado"); // entrou pela E7 sem prova: só observa
    // o quadro: só chave e total (sem texto, número, jid ou @lid)
    expect(JSON.stringify(await q("SELECT * FROM whatsapp_recebimento_contagem WHERE destino = 'marcacao'"))).not.toMatch(/5599|1203636|222222|987654|obras/);
  });
});

describe("QA C4 — 'ligado por padrão' sem linha no interruptor do grupo", () => {
  it("não liga: recusado, aguardando o dono (com ou sem prova), indefinido, desativado, manual antigo; o interruptor GERAL vence", () => {
    const base = { ativo: true, origem: "automatico", tipo: "cliente", leadId: 1, obraId: null, situacaoConfirmacao: "confirmado", adicionadoPor: "dono", provaAdicao: "evento_add" };
    expect(ligadoPorPadrao(base)).toBe(true);
    for (const v of [
      { situacaoConfirmacao: "recusado" }, { situacaoConfirmacao: "aguardando_dono" }, { situacaoConfirmacao: "aguardando_dono", adicionadoPor: "desconhecido", provaAdicao: "sem_prova" },
      { tipo: "indefinido" }, { tipo: "valor-estranho" }, { ativo: false }, { origem: "manual", tipo: null },
    ]) expect(ligadoPorPadrao({ ...base, ...v } as never), JSON.stringify(v)).toBe(false);
  });

  it("interruptor geral desligado vence o padrão; linha do grupo desligada vence o padrão", async () => {
    await banco.pg.exec(`UPDATE dolores_marcacoes_config SET responder_ligado = false, lid_dolores = '${LID_DOLORES}', lid_do_numero = '${DOLORES}'`);
    await chamar(aviso(item()));
    expect(enviarAoGrupo).not.toHaveBeenCalled();
    await banco.pg.exec(`UPDATE dolores_marcacoes_config SET responder_ligado = true; INSERT INTO dolores_marcacoes_grupo (grupo_id, responder_ligado) VALUES (1, false)`);
    await chamar(aviso(item()));
    expect(enviarAoGrupo).not.toHaveBeenCalled();
    expect((await desfechos())["marcacao-desligada"]).toBe(2);
  });

  it("CORRIGIDO (achado baixo): grupo MANUAL cadastrado pela tela depois da E7 (tipo gravado, sem linha) continua calado até alguém ligar", async () => {
    await banco.pg.exec(`UPDATE dolores_marcacoes_config SET lid_dolores = '${LID_DOLORES}', lid_do_numero = '${DOLORES}';
      INSERT INTO dolores_grupos (instancia, grupo_jid, nome, ativo, lead_id, tipo, situacao_confirmacao, decidido_em, decidido_por) VALUES
        ('prospecta-dolores', '${MANUAL}', 'Cadastro manual', true, 1, 'cliente', 'confirmado', now(), 'tela:1');`);
    expect(await q(`SELECT * FROM dolores_marcacoes_grupo`)).toEqual([]);
    await chamar(aviso(item({ jid: MANUAL })));
    expect(Object.keys(await desfechos())).toContain("marcacao-desligada");
    expect(enviarAoGrupo).not.toHaveBeenCalled();
  });
});

describe("QA C3 — classificar pela tela", () => {
  it("CORRIGIDO (achado importante): colaborador com WhatsApp não põe nem tira administrativo/jurídico/parceiros; o admin pode, e o dono é avisado", async () => {
    expect(PERMITIDOS_POR_TIPO.interno).toEqual(expect.arrayContaining(["valores", "outro_cliente"]));
    const colab = caller("colaborador", ["whatsapp"], 2);
    for (const t of ["administrativo", "juridico", "parceiros"] as const) {
      await expect(colab.dolores.grupos.definirTipo({ grupoId: 1, tipo: t })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await grupoPorJid(ENG)).toMatchObject({ tipo: "engenharia" });
    // o gatilho (0139) também barra o UPDATE direto com 'tela:<colaborador>'
    await expect(banco.pg.exec(`UPDATE dolores_grupos SET tipo = 'administrativo', decidido_em = now() + interval '5 s', decidido_por = 'tela:2' WHERE id = 1`)).rejects.toThrow(/só o administrador/);
    // colaborador pode trocar engenharia → cliente; o dono recebe o aviso (tipo antes → depois, quem, quando)
    enviarAoDono.mockClear();
    await colab.dolores.grupos.definirTipo({ grupoId: 1, tipo: "cliente", numero: 1 });
    expect(enviarAoDono).toHaveBeenCalledTimes(1);
    expect((enviarAoDono.mock.calls[0][0] as { texto: string }).texto).toMatch(/«Engenharia» \(código KEGH\) foi classificado pela tela: de «engenharia» para «cliente», por Bianca Souza, em /);
    // e não tira o grupo de um tipo do admin
    await caller("admin").dolores.grupos.definirTipo({ grupoId: 1, tipo: "administrativo" });
    expect(await grupoPorJid(ENG)).toMatchObject({ tipo: "administrativo", decidido_por: "tela:1" });
    expect((enviarAoDono.mock.calls.at(-1)![0] as { texto: string }).texto).toMatch(/de «cliente» para «administrativo \(sócios\)», por Vinícius Admin/);
    await expect(colab.dolores.grupos.definirTipo({ grupoId: 1, tipo: "engenharia" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await grupoPorJid(ENG)).toMatchObject({ tipo: "administrativo" });
  });

  it("CORRIGIDO (achado importante, teto): sem vaga de aviso, a classificação vale e fica 'aviso pendente' (relatório diário)", async () => {
    await banco.pg.exec("UPDATE dolores_grupos_config SET teto_avisos_grupos_dia = 0");
    enviarAoDono.mockClear();
    const r = await caller("admin").dolores.grupos.definirTipo({ grupoId: 1, tipo: "juridico" });
    expect(r.aviso).toBe("pendente");
    expect(enviarAoDono).not.toHaveBeenCalled();
    expect(await grupoPorJid(ENG)).toMatchObject({ tipo: "juridico" });
    expect((await q("SELECT aviso_classificacao_pendente_em FROM dolores_grupos WHERE id = 1"))[0].aviso_classificacao_pendente_em).not.toBeNull();
  });

  it("gatilho 0139 (UPDATE direto): recusado → aguardando pela tela; tela sem decidido_em novo; tela em sem-prova trocando a prova — todos barrados", async () => {
    await banco.pg.exec(`INSERT INTO dolores_grupos (instancia, grupo_jid, nome, nome_whatsapp, ativo, tipo, origem, situacao_confirmacao, codigo, adicionado_por, prova_adicao) VALUES
      ('prospecta-dolores', '${ESPERA}', 'Espera', 'Espera', true, 'indefinido', 'automatico', 'aguardando_dono', 'KESP', 'dono', 'evento_add')`);
    const esp = (await grupoPorJid(ESPERA)).id;
    await expect(banco.pg.exec(`UPDATE dolores_grupos SET situacao_confirmacao = 'aguardando_dono', prova_adicao = 'aceito_pelo_dono', decidido_em = now() + interval '5 s', decidido_por = 'tela:1' WHERE id = 2`))
      .rejects.toThrow(/DOLORES_GRUPOS_DECISAO/);
    await expect(banco.pg.exec(`UPDATE dolores_grupos SET situacao_confirmacao = 'confirmado', decidido_por = 'tela:1' WHERE id = ${esp}`)).rejects.toThrow(/DOLORES_GRUPOS_DECISAO/);
    await expect(banco.pg.exec(`UPDATE dolores_grupos SET tipo = 'juridico', situacao_confirmacao = 'confirmado', prova_adicao = 'aceito_pelo_dono', decidido_em = now() + interval '5 s', decidido_por = 'tela:1' WHERE id = ${esp}`))
      .rejects.toThrow(/DOLORES_GRUPOS_DECISAO/);
    await expect(banco.pg.exec(`UPDATE dolores_grupos SET tipo = 'juridico', situacao_confirmacao = 'confirmado', decidido_em = now() + interval '5 s', decidido_por = 'TELA:1' WHERE id = ${esp}`))
      .rejects.toThrow(/DOLORES_GRUPOS_DECISAO/);
    await expect(banco.pg.exec(`UPDATE dolores_grupos SET tipo = 'juridico', situacao_confirmacao = 'confirmado', decidido_em = now() + interval '5 s', decidido_por = NULL WHERE id = ${esp}`))
      .rejects.toThrow(/DOLORES_GRUPOS_DECISAO/);
    expect(await grupoPorJid(ESPERA)).toMatchObject({ situacao_confirmacao: "aguardando_dono", tipo: "indefinido" });
    expect(await grupoPorJid(RECUSADO)).toMatchObject({ situacao_confirmacao: "recusado" });
    // anônimo (sem usuário) é barrado na rota
    const anon = appRouter.createCaller({ user: null, req: {}, res: {} } as never);
    await expect(anon.dolores.grupos.definirTipo({ grupoId: esp, tipo: "juridico" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // colaborador inativo com o módulo: barrado
    const inativo = appRouter.createCaller({ user: { id: 3, role: "colaborador", active: false, permissions: JSON.stringify(["whatsapp"]) }, req: {}, res: {} } as never);
    await expect(inativo.dolores.grupos.definirTipo({ grupoId: esp, tipo: "juridico" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("QA C3 — resposta só com o número", () => {
  beforeEach(async () => {
    await banco.pg.exec(`INSERT INTO dolores_grupos (instancia, grupo_jid, nome, nome_whatsapp, ativo, tipo, origem, situacao_confirmacao, codigo, adicionado_por, prova_adicao) VALUES
      ('prospecta-dolores', '${ESPERA}', 'Turma nova', 'Turma nova', true, 'indefinido', 'automatico', 'aguardando_dono', 'KESP', 'dono', 'evento_add')`);
  });

  it("CORRIGIDO (achado médio): sem pergunta recente, '4' segue o caminho normal; com pergunta, '4' pede confirmação e '4 sim' define", async () => {
    await chamar(doDono("4"));
    expect(await grupoPorJid(ESPERA)).toMatchObject({ tipo: "indefinido", situacao_confirmacao: "aguardando_dono" });
    // pergunta há 31 min: ainda caminho normal
    await banco.pg.exec(`UPDATE dolores_grupos SET pergunta_tipo_em = '${new Date(AGORA.getTime() - 31 * 60_000).toISOString()}' WHERE grupo_jid = '${ESPERA}'`);
    await chamar(doDono("4 sim"));
    expect(await grupoPorJid(ESPERA)).toMatchObject({ tipo: "indefinido" });
    // pergunta há 5 min: "4" só pede a confirmação; "1" sem nº não engole a mensagem (segue o caminho normal)
    await banco.pg.exec(`UPDATE dolores_grupos SET pergunta_tipo_em = '${new Date(AGORA.getTime() - 5 * 60_000).toISOString()}' WHERE grupo_jid = '${ESPERA}'`);
    enviarAoDono.mockClear();
    await chamar(doDono("4"));
    expect(await grupoPorJid(ESPERA)).toMatchObject({ tipo: "indefinido" });
    expect(JSON.stringify(enviarAoDono.mock.calls)).toMatch(/confirma\?.*libera.*4 sim/);
    await chamar(doDono("1"));
    expect(await grupoPorJid(ESPERA)).toMatchObject({ tipo: "indefinido" });
    await chamar(doDono("4 sim"));
    expect(await grupoPorJid(ESPERA)).toMatchObject({ tipo: "administrativo", situacao_confirmacao: "confirmado", decidido_por: "whatsapp:dono" });
  });

  it("'3' encaminhado, de terceiro que cita o número do dono, ou de grupo com o dono como participante: nada muda", async () => {
    await chamar(aviso({ key: { remoteJid: `${DONO}@s.whatsapp.net`, fromMe: false, id: `QADF${++seq}` },
      message: { extendedTextMessage: { text: "3", contextInfo: { isForwarded: true, forwardingScore: 1 } } }, messageTimestamp: Math.floor((AGORA.getTime() - 10_000) / 1000) }));
    await chamar(aviso({ key: { remoteJid: `${CLIENTE}@s.whatsapp.net`, fromMe: false, id: `QADT${++seq}`, participantAlt: `${DONO}@s.whatsapp.net` }, message: { conversation: "3" }, messageTimestamp: Math.floor((AGORA.getTime() - 10_000) / 1000) }));
    await chamar(aviso({ key: { remoteJid: ENG, fromMe: false, id: `QADG${++seq}`, participant: `${DONO}@s.whatsapp.net` }, message: { conversation: "3" }, messageTimestamp: Math.floor((AGORA.getTime() - 10_000) / 1000) }));
    // o dono mandando "3" de dentro da própria conta (fromMe, conversa direta com outra pessoa) também não conta
    await chamar(aviso({ key: { remoteJid: `${CLIENTE}@s.whatsapp.net`, fromMe: true, id: `QADM${++seq}` }, message: { conversation: "3" }, messageTimestamp: Math.floor((AGORA.getTime() - 10_000) / 1000) }));
    expect(await grupoPorJid(ESPERA)).toMatchObject({ tipo: "indefinido", situacao_confirmacao: "aguardando_dono" });
  });

  it("a pergunta e as opções passam intactas pelos filtros de saída e de registro, sem dado pessoal", () => {
    for (const t of [perguntaDoTipo("Turma nova", "KESP"), textoDasOpcoes("KESP"), textoDasOpcoes("KESP", { soComNumero: true })]) {
      expect(sanitizarTexto(t, filtroDaSaida("whatsapp"))).toBe(t);
      expect(sanitizarTexto(t, FILTRO_DO_REGISTRO)).toBe(t);
      expect(t).not.toMatch(/\d{5,}/);
    }
    // nome do grupo vindo de terceiro com segredo/telefone: limpo antes de entrar na pergunta
    const p = perguntaDoTipo("Turma 5599977776666 sk-ant-abc123def456ghi789", "KESP");
    expect(p).not.toMatch(/5599977776666|sk-ant-abc123/);
  });
});
