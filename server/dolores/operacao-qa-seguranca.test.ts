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
import { definirRelogioCron, tratarCronDolores } from "./rondas.js";
import { MAX_NOME_TERCEIRO, limparNomeDeTerceiro, montarRelatorio } from "../../shared/dolores/operacao.js";
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
