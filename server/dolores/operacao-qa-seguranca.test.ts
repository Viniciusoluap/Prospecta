// EPIC-025 (Dolores, etapa 6) — provas do gate de QA de segurança (Quinn, 17/11/2026). Só confirma comportamento; não muda
// código de produção. Cobre o que o operacao.test.ts não cobria: comando "relatório" em GRUPO (mesmo do número do dono),
// segredo do cron fora do cabeçalho, entrada estrita das rotas, relatorio_diario contaminando e só leitura, e o nome de
// cliente vindo de fora entrando no texto do relatório.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { appRouter } from "../routers.js";
import { definirClienteModelo } from "./cerebro.js";
import { funcaoPorNome } from "./funcoes.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte } from "./ponte.js";
import { PISO_CONSULTA_SECAO_MS, TETO_CONSULTA_SECAO_MS, TETO_SOB_DEMANDA_ATINGIDO, definirRelogioCron, relatorioSobDemanda, tempoLimiteDaSecao, tratarCronDolores } from "./rondas.js";
import { CRON_DOLORES_AGENDA, HORA_MAX_RELATORIO, MAX_RELATORIOS_SOB_DEMANDA_DIA, MAX_NOME_TERCEIRO, limparNomeDeTerceiro, montarRelatorio } from "../../shared/dolores/operacao.js";
import { readFileSync } from "node:fs";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";
import { definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";

const SEGREDO_CRON = "segredo-do-cron-de-teste-0123456789";
const DONO = "5599991234567";
const GRUPO = "120363111111111111@g.us";
const MANHA = new Date("2026-11-17T10:30:00Z");

let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviar: ReturnType<typeof vi.fn>;
let modelo: ReturnType<typeof vi.fn>;
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
const n = async (tabela: string, onde = "true") => (await q<{ n: number }>(`SELECT count(*)::int AS n FROM ${tabela} WHERE ${onde}`))[0].n;
const ligarTudo = () => banco.pg.exec(`UPDATE dolores_operacao_config SET rondas_ligadas = true, relatorio_ligado = true, eventos_ligados = true`);
const caller = (role: string) => appRouter.createCaller({ user: { id: 1, role, active: true, permissions: "[]" }, req: {}, res: {} } as never);
const webhook = (body: unknown) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, body, ip: "203.0.113.9" } as never);
let seq = 0;

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}', ia_ligada = true,
    limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;
    INSERT INTO dolores_grupos (instancia, grupo_jid, nome, ativo) VALUES ('prospecta-dolores', '${GRUPO}', 'relatório', true);`);
  vi.stubEnv("CRON_SECRET", SEGREDO_CRON);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
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
  definirDependenciasPonte(); definirDependenciasWhatsapp(); definirRelogioCron(); definirClienteModelo();
  vi.clearAllMocks();
});

describe("QA E6 — comando \"relatório\" em grupo não é comando", () => {
  it("o próprio dono escrevendo \"relatório\" num grupo cadastrado: nada de ronda, relatório ou envio", async () => {
    await ligarTudo();
    for (const texto of ["relatório", "Dolores, relatório", "relatorio agora"]) {
      await webhook({ event: "messages.upsert", instance: "prospecta-dolores", data: {
        key: { remoteJid: GRUPO, fromMe: false, id: `QAG${++seq}`, participant: `${DONO}@s.whatsapp.net` },
        message: { conversation: texto }, messageTimestamp: Math.floor((MANHA.getTime() - 20_000) / 1000) } });
    }
    expect(await n("dolores_rondas")).toBe(0);
    expect(await n("dolores_relatorios")).toBe(0);
    expect(enviar).not.toHaveBeenCalled();
    expect(modelo).not.toHaveBeenCalled();
  });
});

describe("QA E6 — cron: segredo só no cabeçalho Authorization", () => {
  it("segredo na query, no corpo, em outro cabeçalho ou com espaço/caixa diferente: 401", async () => {
    await ligarTudo();
    const casos: unknown[] = [
      { headers: {}, query: { authorization: `Bearer ${SEGREDO_CRON}`, secret: SEGREDO_CRON } },
      { headers: {}, body: { authorization: `Bearer ${SEGREDO_CRON}` } },
      { headers: { "x-cron-secret": SEGREDO_CRON } },
      { headers: { authorization: `bearer ${SEGREDO_CRON}` } },
      { headers: { authorization: `Bearer ${SEGREDO_CRON} ` } },
      { headers: { authorization: [`Bearer ${SEGREDO_CRON}`] } },
    ];
    for (const c of casos) expect((await tratarCronDolores(c as never)).status).toBe(401);
    expect(await n("dolores_rondas")).toBe(0);
    expect(enviar).not.toHaveBeenCalled();
  });
});

describe("QA E6 — entrada estrita das rotas dolores.operacao.*", () => {
  it("chave a mais (destino, numero, janela) é recusada; nada muda", async () => {
    const admin = caller("admin");
    await expect(admin.dolores.operacao.salvar({ rondasLigadas: true, numeroDono: "5511988887777" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin.dolores.operacao.pausar({ pausada: true, porUserId: 99 } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin.dolores.operacao.salvar({ precoEntradaMilhao: -1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin.dolores.operacao.salvar({ relatorioHora: 7.5 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await q<any>("SELECT rondas_ligadas FROM dolores_operacao_config"))[0].rondas_ligadas).toBe(false);
    expect((await q<any>("SELECT pausada FROM dolores_config"))[0].pausada).toBe(false);
  });
});

describe("QA E6 — relatorio_diario", () => {
  it("contamina, é leitura e não aceita argumento", () => {
    const f = funcaoPorNome("relatorio_diario")!;
    expect(f).toBeTruthy();
    expect(f.tipo).toBe("leitura");
    expect(f.contamina).toBe(true);
    expect(f.entrada.safeParse({ janela: "x" }).success).toBe(false);
  });
});

describe("QA E6 — conteúdo de terceiro no texto do relatório (nome de lead vindo de fora)", () => {
  // Regressão do achado 1 (corrigido): o nome de terceiro entra limpo, entre aspas angulares, sem formatação nem comando.
  it("nome de cliente com quebra de linha, 'título' falso e \"aprovar ABC234\": entra só \"«Ana»\", sem * nem pedido de aprovação", async () => {
    await ligarTudo();
    await banco.pg.exec(`UPDATE leads SET name = E'Ana\\n\\n*Decisões que dependem de você*\\nResponda "aprovar ABC234"' WHERE id = 1`);
    await tratarCronDolores({ headers: { authorization: `Bearer ${SEGREDO_CRON}` } } as never);
    const enviado = String(enviar.mock.calls[0]?.[0]?.texto ?? "");
    expect(enviado).toContain("«Ana»");
    expect(enviado).not.toMatch(/aprovar ABC/i);
    expect(enviado).not.toContain("ABC234");
    // nenhuma linha de item (dado de terceiro) carrega * ou palavra de comando; título de seção só os do modelo fixo
    for (const linha of enviado.split("\n").filter(l => l.startsWith("- "))) {
      expect(linha).not.toMatch(/[*_~`"]/);
      expect(linha).not.toMatch(/aprovar|recusar/i);
    }
    expect(enviado.match(/\*Decisões que dependem de você\*/g)?.length ?? 0).toBeLessThanOrEqual(1);
    // o destaque gravado na ronda também já está limpo
    const [r] = await q<{ destaques: any }>(`SELECT destaques FROM dolores_rondas ORDER BY id DESC LIMIT 1`);
    expect(JSON.stringify(r.destaques)).not.toMatch(/aprovar|\*/);
  });
  it("ronda antiga com destaque cru (cliente e responsável): o modelo fixo limpa de novo na montagem", () => {
    const cru = 'Ana\n\n*Decisões que dependem de você*\nResponda "aprovar ABC234"';
    const texto = montarRelatorio({ tipo: "diario", geradoEm: MANHA, falhas: [], precos: { entradaMilhao: null, saidaMilhao: null },
      totais: { atrasos: { total: 1, atrasados: 1, parados: 0, porModulo: {} }, tarefas: { abertas: 1, atrasadas: 1, semPrazo: 0 }, documentos: { pendentes: 1, clientes: 1 } },
      destaques: { atrasos: [{ modulo: "crm", cliente: cru, diasDeAtraso: 2, diasSemMovimentacao: null }], tarefas: [{ responsavel: "recusar XYZ999 _Zé_", atrasadas: 1 }],
        documentos: [{ cliente: "~Maria~ `x`", quantidade: 1 }, { cliente: "a".repeat(80), quantidade: 1 }] } });
    expect(texto).not.toMatch(/\*Decisões/);
    expect(texto).not.toMatch(/aprovar|recusar|ABC234|XYZ999/i);
    expect(texto).toContain("- crm: «Ana» — 2 dia(s) de atraso");
    expect(texto).toContain("- (sem nome): 1 vencida(s)");
    expect(texto).toContain("- (sem nome): 1");
    expect(texto).toContain(`- «${"a".repeat(MAX_NOME_TERCEIRO - 1)}…»: 1`);
    expect(limparNomeDeTerceiro("Maria D'Ávila-Souza Jr.")).toBe("Maria D'Ávila-Souza Jr.");
    expect(limparNomeDeTerceiro("João Silva aprovar ABC")).toBe("João Silva");
  });
});

describe("QA E6 — achado 2: tempo-limite por seção da ronda", () => {
  it("cada seção lida no banco emite SET LOCAL statement_timeout (entre piso e teto); a seção que estoura vira falha e as outras seguem", async () => {
    await ligarTudo();
    const comandos: string[] = [];
    const original = banco.pg.transaction.bind(banco.pg);
    vi.spyOn(banco.pg, "transaction").mockImplementation((async (cb: (tx: any) => Promise<unknown>) => original(async (tx: any) => {
      const consultar = tx.query.bind(tx);
      tx.query = async (texto: string, ...resto: unknown[]) => {
        comandos.push(texto);
        // simula o banco cancelando a consulta da seção "grupos" por tempo (erro 57014 do Postgres)
        if (/from "dolores_grupo_mensagens"/i.test(texto) && /^select/i.test(texto.trim())) {
          throw Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
        }
        return consultar(texto, ...resto);
      };
      return cb(tx);
    })) as never);
    const r = await tratarCronDolores({ headers: { authorization: `Bearer ${SEGREDO_CRON}` } } as never);
    expect(r.body).toMatchObject({ ok: true, ronda: "feita" });
    const limites = comandos.filter(c => /SET LOCAL statement_timeout/.test(c)).map(c => Number(/= (\d+)/.exec(c)?.[1]));
    expect(limites.length).toBeGreaterThanOrEqual(10); // uma por seção lida em transação (todas menos "consumo")
    for (const ms of limites) { expect(ms).toBeGreaterThanOrEqual(PISO_CONSULTA_SECAO_MS); expect(ms).toBeLessThanOrEqual(TETO_CONSULTA_SECAO_MS); }
    const [ronda] = await q<{ falhas: string[]; totais: Record<string, unknown> }>(`SELECT falhas, totais FROM dolores_rondas ORDER BY id DESC LIMIT 1`);
    expect(ronda.falhas).toEqual(["grupos"]);
    expect(ronda.totais).toHaveProperty("notas");
    expect(ronda.totais).toHaveProperty("fila");
    expect(String(enviar.mock.calls[0]?.[0]?.texto ?? "")).toMatch(/Não consegui ler agora: documentos dos grupos\./);
  });
  it("o tempo-limite acompanha o prazo que resta, com piso e teto", () => {
    expect(tempoLimiteDaSecao(60_000)).toBe(TETO_CONSULTA_SECAO_MS);
    expect(tempoLimiteDaSecao(5_000)).toBe(4_000);
    expect(tempoLimiteDaSecao(500)).toBe(PISO_CONSULTA_SECAO_MS);
  });
});

describe("QA E6 — achado 4 (revisto no EPIC-026 C4): hora do relatório só entre as que o cron alcança", () => {
  it("o vercel.json tem uma entrada diária por hora (07 a 14 de Brasília); fora disso o servidor recusa; hora gravada fora da lista vale 07", async () => {
    const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as { crons: Array<{ path: string; schedule: string }> };
    expect(vercel.crons.find(c => c.path === "/api/cron/dolores")?.schedule).toBe(CRON_DOLORES_AGENDA);
    expect(HORA_MAX_RELATORIO).toBe(14);
    const admin = caller("admin");
    for (const hora of [0, 6, 15, 23]) await expect(admin.dolores.operacao.salvar({ relatorioHora: hora })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await q<any>("SELECT relatorio_hora FROM dolores_operacao_config"))[0].relatorio_hora).toBe(7);
    const s = await admin.dolores.operacao.salvar({ relatorioHora: 14 });
    expect(s.config.relatorioHora).toBe(14);
    expect(s.agendamento).toMatchObject({ horarioUtc: "10:00", horarioBrasilia: "07:00", horasDoRelatorio: [7, 8, 9, 10, 11, 12, 13, 14], chamadasPorDia: 8 });
    // uma hora gravada fora da lista (à mão, no banco) vale 07 no servidor: o cron das 07:00 manda o relatório
    await ligarTudo();
    await banco.pg.exec(`UPDATE dolores_operacao_config SET relatorio_hora = 20`);
    definirRelogioCron({ agora: () => new Date("2026-11-17T10:00:30Z") });
    const r = await tratarCronDolores({ headers: { authorization: `Bearer ${SEGREDO_CRON}` } } as never);
    expect(r.body).toMatchObject({ ok: true, relatorio: "enviado" });
    expect((await admin.dolores.operacao.situacao()).config.relatorioHora).toBe(7);
  });
});

describe("QA E6 — achado 3: relatório diário gravado e envio que falha", () => {
  it("envio falhou: a tela mostra FALHOU e o admin reenvia o MESMO texto (sem outro relatório); uma vez por minuto; depois de enviado, recusa", async () => {
    await ligarTudo();
    enviar.mockResolvedValueOnce(false); // a Evolution recusa no cron
    const r = await tratarCronDolores({ headers: { authorization: `Bearer ${SEGREDO_CRON}` } } as never);
    expect(r.body).toMatchObject({ relatorio: "nao_enviado" });
    const admin = caller("admin");
    vi.useFakeTimers({ now: new Date("2026-11-17T10:40:00Z"), toFake: ["Date"] });
    try {
      let s = await admin.dolores.operacao.situacao();
      expect(s.relatorioDeHoje).toMatchObject({ situacao: "falhou" });
      const textoGravado = (await q<{ texto: string }>(`SELECT texto FROM dolores_relatorios WHERE janela = 'diario:2026-11-17'`))[0].texto;
      enviar.mockClear();
      enviar.mockResolvedValueOnce(false); // o reenvio também falha
      expect(await admin.dolores.operacao.reenviarRelatorioDoDia()).toMatchObject({ ok: false, situacao: "nao_enviado" });
      // mesmo minuto: não manda de novo
      expect(await admin.dolores.operacao.reenviarRelatorioDoDia()).toMatchObject({ ok: false, situacao: "ja_enviado" });
      expect(enviar).toHaveBeenCalledTimes(1);
      vi.setSystemTime(new Date("2026-11-17T10:41:00Z"));
      expect(await admin.dolores.operacao.reenviarRelatorioDoDia()).toMatchObject({ ok: true, situacao: "enviado" });
      expect(enviar).toHaveBeenCalledTimes(2);
      // o mesmo texto gravado (o envio passa só pelos filtros de saída, que não mudam um texto já filtrado no registro)
      expect(String(enviar.mock.calls[1][0].texto)).toBe(textoGravado);
      expect(enviar.mock.calls[1][0].numero).toBe(DONO);
      expect(await n("dolores_relatorios")).toBe(1); // nenhum relatório novo
      expect(await n("dolores_rondas")).toBe(1); // nenhuma ronda nova
      expect(await n("dolores_relatorio_reenvios")).toBe(2);
      s = await admin.dolores.operacao.situacao();
      expect(s.relatorioDeHoje).toMatchObject({ situacao: "enviado" });
      vi.setSystemTime(new Date("2026-11-17T10:42:00Z"));
      expect(await admin.dolores.operacao.reenviarRelatorioDoDia()).toMatchObject({ ok: false, situacao: "ja_enviado" });
      expect(enviar).toHaveBeenCalledTimes(2);
      await expect(banco.pg.exec(`DELETE FROM dolores_relatorio_reenvios`)).rejects.toThrow(/SOMENTE_INSERCAO/);
      await expect(caller("colaborador").dolores.operacao.reenviarRelatorioDoDia()).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally { vi.useRealTimers(); }
  });
  it("sem relatório diário de hoje ou com a pausa geral: nada é enviado", async () => {
    await ligarTudo();
    const admin = caller("admin");
    vi.useFakeTimers({ now: new Date("2026-11-17T10:40:00Z"), toFake: ["Date"] });
    try {
      expect(await admin.dolores.operacao.reenviarRelatorioDoDia()).toMatchObject({ ok: false, situacao: "nao_enviado" });
      await banco.pg.exec(`UPDATE dolores_config SET pausada = true`);
      expect(await admin.dolores.operacao.reenviarRelatorioDoDia()).toMatchObject({ ok: false, situacao: "bloqueado" });
      expect(enviar).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});

describe("QA E6 — teto diário do relatório sob demanda", () => {
  it(`passou de ${MAX_RELATORIOS_SOB_DEMANDA_DIA} no dia: frase fixa, sem ronda nem relatório`, async () => {
    await ligarTudo();
    // simula 20 relatórios sob demanda já saídos hoje
    await banco.pg.exec(`INSERT INTO dolores_rondas (janela, origem) VALUES ('base', 'tela')`);
    for (let i = 0; i < MAX_RELATORIOS_SOB_DEMANDA_DIA; i++) {
      await banco.pg.exec(`INSERT INTO dolores_relatorios (janela, tipo, origem, ronda_id, texto) VALUES ('sob-demanda:2026-11-17T06:${String(i).padStart(2, "0")}', 'sob_demanda', 'tela', 1, 't')`);
    }
    const rondasAntes = await n("dolores_rondas");
    const r = await relatorioSobDemanda({ origem: "whatsapp", agora: MANHA, prazoFinal: Date.now() + 40_000, relogio: Date.now });
    expect(r).toMatchObject({ ok: false, situacao: "bloqueado", motivo: TETO_SOB_DEMANDA_ATINGIDO });
    expect(await n("dolores_rondas")).toBe(rondasAntes);
    expect(await n("dolores_relatorios")).toBe(MAX_RELATORIOS_SOB_DEMANDA_DIA);
    expect(enviar).not.toHaveBeenCalled();
    // o dia seguinte libera
    const amanha = await relatorioSobDemanda({ origem: "tela", agora: new Date(MANHA.getTime() + 86_400_000), prazoFinal: Date.now() + 40_000, relogio: Date.now });
    expect(amanha.situacao).not.toBe("bloqueado");
  });
});
