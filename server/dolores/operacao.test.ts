// EPIC-025 (Dolores, etapa 6) — operação contínua de ponta a ponta (PGlite): cron autenticado, idempotência da ronda e do
// relatório, pausa geral barrando cada porta, relatório só para o dono, comando "relatório" sem IA, eventos e permissões pelo
// appRouter completo. O envio pela Evolution e o modelo são falsos: nada sai para a rede.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { ADMIN_MODULES } from "../../shared/admin-permissions.js";
import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { appRouter } from "../routers.js";
import { definirClienteModelo } from "./cerebro.js";
import { podeFalarNoGrupo, registrarEvento } from "./operacao.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte, executarFuncao } from "./ponte.js";
import { cronAutorizado, definirRelogioCron, tratarCronDolores } from "./rondas.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";
import { definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";

const SEGREDO_CRON = "segredo-do-cron-de-teste-0123456789";
const SEGREDO_SERVIDOR = "segredo-do-servidor-de-teste-0123456789";
const DONO = "5599991234567";
/** 17/11/2026 07:30 em Brasília (10:30 UTC): depois da hora padrão do relatório (07:00). */
const MANHA = new Date("2026-11-17T10:30:00Z");

let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviar: ReturnType<typeof vi.fn>;
let modelo: ReturnType<typeof vi.fn>;
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
const n = async (tabela: string, onde = "true") => (await q<{ n: number }>(`SELECT count(*)::int AS n FROM ${tabela} WHERE ${onde}`))[0].n;
const cron = (auth?: string, extra: Record<string, unknown> = {}) => tratarCronDolores({ headers: auth === undefined ? {} : { authorization: auth }, ...extra } as never);
const caller = (role: string, permissoes: string[] = [], id = 1) =>
  appRouter.createCaller({ user: { id, role, active: true, permissions: JSON.stringify(permissoes) }, req: {}, res: {} } as never);
const ligarTudo = () => banco.pg.exec(`UPDATE dolores_operacao_config SET rondas_ligadas = true, relatorio_ligado = true, eventos_ligados = true`);
const pausar = (sim = true) => banco.pg.exec(`UPDATE dolores_config SET pausada = ${sim}, motivo_pausa = ${sim ? "'teste'" : "NULL"}`);

let seq = 0;
const avisoDoDono = (texto: string) => ({
  event: "messages.upsert", instance: "prospecta-dolores",
  data: { key: { remoteJid: `${DONO}@s.whatsapp.net`, fromMe: false, id: `OP${++seq}` }, message: { conversation: texto }, messageTimestamp: Math.floor((MANHA.getTime() - 20_000) / 1000) },
});
const webhook = (body: unknown) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, body, ip: "203.0.113.9" } as never);

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}',
    limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;`);
  vi.stubEnv("CRON_SECRET", SEGREDO_CRON);
  ENV.cookieSecret = SEGREDO_SERVIDOR;
  esquecerUsuarioDolores();
  definirDependenciasPonte({ agora: () => AGORA });
  enviar = vi.fn(async () => true);
  definirDependenciasWhatsapp({ agora: () => MANHA, enviar: enviar as never });
  definirRelogioCron({ agora: () => MANHA });
  vi.mocked(configuracaoAnthropicPainel).mockResolvedValue({ apiKey: "sk-ant-teste-nao-real", modelo: "modelo-teste" });
  modelo = vi.fn(async () => { throw new Error("a IA não deveria ser chamada"); });
  definirClienteModelo(modelo as never);
});
afterEach(() => {
  vi.unstubAllEnvs();
  ENV.cookieSecret = segredoAntes;
  definirDependenciasPonte();
  definirDependenciasWhatsapp();
  definirRelogioCron();
  definirClienteModelo();
  vi.clearAllMocks();
});

describe("cron /api/cron/dolores — autenticação", () => {
  it("sem segredo, com segredo errado ou sem CRON_SECRET configurado: 401, nada roda", async () => {
    await ligarTudo();
    expect((await cron()).status).toBe(401);
    expect((await cron("Bearer errado")).status).toBe(401);
    expect((await cron(SEGREDO_CRON)).status).toBe(401); // sem "Bearer "
    vi.stubEnv("CRON_SECRET", "");
    expect((await cron(`Bearer ${SEGREDO_CRON}`)).status).toBe(401);
    expect(cronAutorizado("Bearer ", "")).toBe(false);
    expect(await n("dolores_rondas")).toBe(0);
    expect(enviar).not.toHaveBeenCalled();
  });

  it("desligado por padrão: com o segredo certo responde, mas não faz ronda nem envia", async () => {
    const r = await cron(`Bearer ${SEGREDO_CRON}`);
    expect(r).toMatchObject({ status: 200, body: { ok: true, r: "desligada" } });
    expect(await n("dolores_rondas")).toBe(0);
    expect(enviar).not.toHaveBeenCalled();
  });
});

describe("ronda e relatório diário — idempotência", () => {
  it("o cron entregue duas vezes faz UMA ronda, UM relatório e UM envio (só ao dono); query/corpo do chamador não mudam nada", async () => {
    await ligarTudo();
    const r1 = await cron(`Bearer ${SEGREDO_CRON}`, { query: { janela: "diaria:2020-01-01", numero: "5511988887777" }, body: { destino: "5511988887777" } });
    expect(r1).toMatchObject({ status: 200, body: { ok: true, ronda: "feita", relatorio: "enviado" } });
    const r2 = await cron(`Bearer ${SEGREDO_CRON}`);
    expect(r2).toMatchObject({ status: 200, body: { ok: true, ronda: "ja-feita", relatorio: "ja_enviado" } });
    const rondas = await q<any>("SELECT * FROM dolores_rondas");
    expect(rondas).toHaveLength(1);
    expect(rondas[0]).toMatchObject({ janela: "diaria:2026-11-17", origem: "cron" });
    expect(rondas[0].totais.tarefas).toMatchObject({ atrasadas: 2 });
    expect(rondas[0].totais.atrasos.total).toBeGreaterThan(0);
    expect(await n("dolores_relatorios")).toBe(1);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar.mock.calls[0][0]).toMatchObject({ instancia: "prospecta-dolores", numero: DONO });
    expect(enviar.mock.calls[0][0].texto).toContain("relatório diário de 17/11");
    expect(modelo).not.toHaveBeenCalled();
    expect(await n("dolores_acoes", "funcao = 'relatorio_envio' AND resultado = 'ok' AND canal = 'cron'")).toBe(1);
  });

  it("antes da hora configurada: faz a ronda, não manda o relatório", async () => {
    await ligarTudo();
    // a hora vai até a do cron diário (07h, achado 4 do QA); antes dela (execução às 06:30 de Brasília) não manda
    await banco.pg.exec("UPDATE dolores_operacao_config SET relatorio_hora = 7");
    definirRelogioCron({ agora: () => new Date("2026-11-17T09:30:00Z") });
    expect((await cron(`Bearer ${SEGREDO_CRON}`)).body).toMatchObject({ ronda: "feita", relatorio: "fora-da-hora" });
    expect(enviar).not.toHaveBeenCalled();
  });

  it("só rondas ligadas: ronda sem relatório", async () => {
    await banco.pg.exec("UPDATE dolores_operacao_config SET rondas_ligadas = true");
    expect((await cron(`Bearer ${SEGREDO_CRON}`)).body).toMatchObject({ ronda: "feita", relatorio: "desligado" });
    expect(enviar).not.toHaveBeenCalled();
  });
});

describe("relatório só para o dono", () => {
  it("sem número do dono: o relatório é montado, mas nada é enviado (auditado)", async () => {
    await ligarTudo();
    await banco.pg.exec("UPDATE dolores_whatsapp_config SET numero_dono = NULL");
    expect((await cron(`Bearer ${SEGREDO_CRON}`)).body).toMatchObject({ relatorio: "nao_enviado" });
    expect(enviar).not.toHaveBeenCalled();
    expect((await q<any>("SELECT motivo FROM dolores_acoes WHERE funcao = 'relatorio_envio'"))[0].motivo).toMatch(/número do dono não cadastrado/);
  });
  it("Dolores desconectada: nada é enviado", async () => {
    await ligarTudo();
    await banco.pg.exec("UPDATE dolores_whatsapp_config SET status_conexao = 'desconectado'");
    expect((await cron(`Bearer ${SEGREDO_CRON}`)).body).toMatchObject({ relatorio: "nao_enviado" });
    expect(enviar).not.toHaveBeenCalled();
  });
  it("o texto passa pelos filtros de saída (segredo e link de fora saem) e o registro fica mascarado", async () => {
    await ligarTudo();
    // um nome de cliente com segredo e link: chega aos destaques da ronda (documentos pendentes)
    await banco.pg.exec(`UPDATE leads SET name = 'Maria senha: hunter2 https://malicioso.example/x' WHERE id = 1`);
    await cron(`Bearer ${SEGREDO_CRON}`);
    const enviado = enviar.mock.calls[0][0].texto as string;
    expect(enviado).not.toContain("hunter2");
    expect(enviado).not.toContain("malicioso.example");
    const [registro] = await q<any>("SELECT texto FROM dolores_relatorios");
    expect(registro.texto).not.toContain("hunter2");
  });
});

describe("pausa geral barra cada porta", () => {
  beforeEach(async () => { await ligarTudo(); await pausar(); });

  it("cron: nem ronda nem relatório (auditado)", async () => {
    expect((await cron(`Bearer ${SEGREDO_CRON}`)).body).toMatchObject({ ok: true, r: "pausada" });
    expect(await n("dolores_rondas")).toBe(0);
    expect(enviar).not.toHaveBeenCalled();
    expect(await n("dolores_acoes", "funcao = 'ronda' AND resultado = 'recusada'")).toBe(1);
  });
  it("tela: ronda e relatório recusados", async () => {
    const admin = caller("admin");
    await expect(admin.dolores.operacao.rodarRonda()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await admin.dolores.operacao.enviarRelatorio()).toMatchObject({ ok: false, situacao: "bloqueado" });
    expect(await n("dolores_rondas")).toBe(0);
    expect(enviar).not.toHaveBeenCalled();
  });
  it("WhatsApp: o comando \"relatório\" não faz ronda (responde a frase fixa) e a IA não roda", async () => {
    await banco.pg.exec("UPDATE dolores_whatsapp_config SET ia_ligada = true");
    await webhook(avisoDoDono("relatório"));
    await webhook(avisoDoDono("Dolores, quais obras estão atrasadas?"));
    expect(await n("dolores_rondas")).toBe(0);
    expect(modelo).not.toHaveBeenCalled();
    expect(enviar.mock.calls.map(c => c[0].texto)).toEqual([expect.stringMatching(/não enviei o relatório.*pausada/), expect.stringMatching(/estou pausada/)]);
  });
  it("eventos não entram e a resposta no grupo (gancho da 4b) fica calada", async () => {
    expect(await registrarEvento({ tipo: "nota_lida", chave: "nota:1" })).toBe(false);
    expect(await podeFalarNoGrupo()).toBe(false);
    expect(await n("dolores_eventos")).toBe(0);
  });
  it("ponte e aprovação da fila continuam barradas pela mesma pausa", async () => {
    const r = await executarFuncao({ funcao: "listar_tarefas", argumentos: {}, pedidoId: "p1" }, { canal: "whatsapp", mensagemId: 9 });
    expect(JSON.stringify(r)).toMatch(/pausada/i);
  });
  it("retomar pela tela libera de novo", async () => {
    const admin = caller("admin");
    expect((await admin.dolores.operacao.pausar({ pausada: false })).pausa).toMatchObject({ pausada: false });
    expect(await podeFalarNoGrupo()).toBe(true);
    expect(await admin.dolores.operacao.rodarRonda()).toMatchObject({ nova: true });
  });
});

describe("conta da Dolores desativada (botão de parada do administrador)", () => {
  it("cron e eventos param; nada é enviado", async () => {
    await ligarTudo();
    await banco.pg.exec(`INSERT INTO users ("openId", name, role, active) VALUES ('sistema:dolores', 'Dolores', 'user', false)`);
    expect((await cron(`Bearer ${SEGREDO_CRON}`)).body).toMatchObject({ r: "usuaria_desativada" });
    expect(await registrarEvento({ tipo: "nota_lida", chave: "nota:9" })).toBe(false);
    expect(await n("dolores_rondas")).toBe(0);
    expect(enviar).not.toHaveBeenCalled();
  });
});

describe("comando \"relatório\" pelo WhatsApp (por código, sem IA)", () => {
  it("com o relatório ligado: ronda sob demanda + relatório só ao dono, sem chamar o modelo; repetido no mesmo minuto não duplica", async () => {
    await ligarTudo();
    await webhook(avisoDoDono("Relatório"));
    await webhook(avisoDoDono("relatório agora"));
    expect(modelo).not.toHaveBeenCalled();
    expect(await n("dolores_rondas")).toBe(1);
    expect((await q<any>("SELECT janela, origem FROM dolores_rondas"))[0]).toMatchObject({ janela: "sob-demanda:2026-11-17T07:30", origem: "whatsapp" });
    expect(await n("dolores_relatorios")).toBe(1);
    const textos = enviar.mock.calls.map(c => c[0]);
    expect(textos.every(t => t.numero === DONO)).toBe(true);
    expect(textos[0].texto).toContain("Dolores — relatório de 17/11");
    expect(textos[1].texto).toMatch(/não enviei o relatório/);
  });
  it("com o relatório desligado: frase fixa, sem ronda", async () => {
    await webhook(avisoDoDono("relatório"));
    expect(await n("dolores_rondas")).toBe(0);
    expect(enviar.mock.calls[0][0].texto).toMatch(/relatório está desligado/);
  });
  it("de outro número não vale como comando (nada responde)", async () => {
    await ligarTudo();
    await webhook({ ...avisoDoDono("relatório"), data: { ...avisoDoDono("relatório").data, key: { remoteJid: "5511988887777@s.whatsapp.net", fromMe: false, id: "X1" } } });
    expect(await n("dolores_rondas")).toBe(0);
    expect(enviar).not.toHaveBeenCalled();
  });
});

describe("eventos", () => {
  it("desligados por padrão; ligados, entram uma vez só (chave única)", async () => {
    expect(await registrarEvento({ tipo: "nota_lida", chave: "nota:7" })).toBe(false);
    await banco.pg.exec("UPDATE dolores_operacao_config SET eventos_ligados = true");
    expect(await registrarEvento({ tipo: "nota_lida", chave: "nota:7", origemTabela: "obra_notas", origemId: 7 })).toBe(true);
    expect(await registrarEvento({ tipo: "nota_lida", chave: "nota:7" })).toBe(false);
    expect(await n("dolores_eventos")).toBe(1);
  });
  it("a ronda registra os prazos vencidos uma vez e conta só os novos", async () => {
    await ligarTudo();
    await cron(`Bearer ${SEGREDO_CRON}`);
    const prazos = await n("dolores_eventos", "tipo = 'prazo_vencido'");
    expect(prazos).toBeGreaterThan(0);
    expect((await q<any>("SELECT totais FROM dolores_rondas"))[0].totais.eventos.prazosNovos).toBe(prazos);
    definirRelogioCron({ agora: () => new Date(MANHA.getTime() + 86_400_000) });
    await cron(`Bearer ${SEGREDO_CRON}`);
    expect(await n("dolores_eventos", "tipo = 'prazo_vencido'")).toBeGreaterThanOrEqual(prazos);
    const [, segunda] = await q<any>("SELECT totais FROM dolores_rondas ORDER BY id");
    expect(segunda.totais.eventos.prazosNovos).toBe(await n("dolores_eventos", "tipo = 'prazo_vencido'") - prazos);
  });
});

describe("permissões (caminho completo pelo appRouter)", () => {
  it("colaborador com todos os módulos, corretor, cliente, empreiteiro, user (a própria Dolores) e admin inativo são recusados em todas as rotas", async () => {
    const rotas = [
      (c: ReturnType<typeof caller>) => c.dolores.operacao.situacao(),
      (c: ReturnType<typeof caller>) => c.dolores.operacao.pausar({ pausada: true }),
      (c: ReturnType<typeof caller>) => c.dolores.operacao.salvar({ rondasLigadas: true }),
      (c: ReturnType<typeof caller>) => c.dolores.operacao.rodarRonda(),
      (c: ReturnType<typeof caller>) => c.dolores.operacao.enviarRelatorio(),
    ];
    const inativo = appRouter.createCaller({ user: { id: 1, role: "admin", active: false }, req: {}, res: {} } as never);
    for (const rota of rotas) {
      for (const c of [caller("colaborador", [...ADMIN_MODULES]), caller("corretor"), caller("cliente"), caller("empreiteiro"), caller("user"), inativo]) {
        await expect(rota(c)).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    }
    expect((await q<any>("SELECT pausada FROM dolores_config"))[0].pausada).toBe(false);
    expect((await q<any>("SELECT rondas_ligadas FROM dolores_operacao_config"))[0].rondas_ligadas).toBe(false);
    expect(await n("dolores_rondas")).toBe(0);
  });

  it("admin: vê a situação (sem número completo nem chave), liga, valida as dependências e pausa", async () => {
    const admin = caller("admin");
    const s = await admin.dolores.operacao.situacao();
    expect(s.config).toEqual({ rondasLigadas: false, relatorioLigado: false, relatorioHora: 7, eventosLigados: false });
    expect(s.gasto).toMatchObject({ tetoDonoReais: 1621, reaisEstimados: null });
    // a resposta nos grupos (geral, etapa 4b) aparece só para leitura; nasce desligada e acompanha o cartão dos grupos
    expect(s.interruptores.respostaGruposLigada).toBe(false);
    await banco.pg.exec("UPDATE dolores_marcacoes_config SET responder_ligado = true WHERE id = 1");
    expect((await admin.dolores.operacao.situacao()).interruptores.respostaGruposLigada).toBe(true);
    expect(JSON.stringify(s)).not.toContain(DONO);
    expect(JSON.stringify(s)).not.toMatch(/sk-ant/);
    await expect(admin.dolores.operacao.salvar({ relatorioLigado: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const ligado = await admin.dolores.operacao.salvar({ rondasLigadas: true, relatorioLigado: true, relatorioHora: 6, precoEntradaMilhao: 15, precoSaidaMilhao: 75 });
    expect(ligado.config).toMatchObject({ rondasLigadas: true, relatorioLigado: true, relatorioHora: 6 });
    expect(ligado.gasto.reaisEstimados).toBe(0);
    await expect(admin.dolores.operacao.salvar({ relatorioHora: 24 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin.dolores.operacao.salvar({ relatorioHora: 8 })).rejects.toMatchObject({ code: "BAD_REQUEST" }); // depois do cron diário
    expect((await admin.dolores.operacao.pausar({ pausada: true, motivo: "viagem" })).pausa).toEqual({ pausada: true, motivo: "viagem" });
    expect(await n("dolores_acoes", "funcao IN ('pausa_geral', 'operacao_config') AND canal = 'tela'")).toBe(2);
  });

  it("admin: enviar relatório pela tela vai só ao número do dono", async () => {
    const admin = caller("admin");
    await ligarTudo();
    expect(await admin.dolores.operacao.enviarRelatorio()).toMatchObject({ ok: true, situacao: "enviado" });
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar.mock.calls[0][0].numero).toBe(DONO);
    const s = await admin.dolores.operacao.situacao();
    expect(s.ultimoRelatorio).toMatchObject({ tipo: "sob_demanda", origem: "tela", envio: { resultado: "ok" } });
    expect(s.rondas).toHaveLength(1);
  });
});
