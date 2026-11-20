// EPIC-026 C5 — valores padrão (limites 15.000.000 / 1.000.000, preços sugeridos com fonte e data, cotação 6,00) e o limite
// mensal mostrado em reais (pior caso e só a conversa), com os avisos. A sugestão de preço nunca entra na conta sem o clique.
// Permissões pelo appRouter completo (PGlite).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));

import { ADMIN_MODULES } from "../../shared/admin-permissions.js";
import {
  COTACAO_SUGERIDA, FONTE_PRECOS_SUGERIDOS, LIMITES_PADRAO, PRECOS_SUGERIDOS, precoSugerido, previsaoDoLimite, projecaoDoMes,
} from "../../shared/dolores/precos-padrao.js";
import { TETO_DONO_REAIS } from "../../shared/dolores/operacao.js";
import type { PrecoModelo } from "../../shared/dolores/custo.js";
import { chaveModeloDaFuncao } from "../_core/modelo-por-funcao.js";
import { getDb } from "../db.js";
import { appRouter } from "../routers.js";
import { CENARIO, criarBanco } from "./testes-banco.js";

const HAIKU = "claude-haiku-5-5";
const OPUS = "claude-opus-5-5";
const SEM_RESERVA = { entradaMilhao: null, saidaMilhao: null };
const tabela = (...ms: string[]) => new Map<string, PrecoModelo>(ms.map(m => [m, PRECOS_SUGERIDOS[m]]));
const prever = (o: Partial<Parameters<typeof previsaoDoLimite>[0]> = {}) => previsaoDoLimite({
  limites: { ...LIMITES_PADRAO }, modelosEmUso: [HAIKU, OPUS], modeloDaConversa: HAIKU, tabela: tabela(HAIKU, OPUS), reserva: SEM_RESERVA,
  cotacao: 6, tetoReais: TETO_DONO_REAIS, ...o,
});

describe("C5 — padrões do sistema", () => {
  it("limites padrão, cotação sugerida e preços sugeridos com fonte e data (só id exato; o que não foi confirmado fica sem)", () => {
    expect(LIMITES_PADRAO).toEqual({ entrada: 15_000_000, saida: 1_000_000 });
    expect(COTACAO_SUGERIDA).toBe(6);
    expect(FONTE_PRECOS_SUGERIDOS).toBe("tabela oficial da Anthropic em 20/11/2026");
    expect(precoSugerido(HAIKU)).toEqual({ entrada: 0.1, saida: 0.5, cacheEscrita: 0.125, cacheLeitura: 0.01 });
    expect(precoSugerido(OPUS)).toEqual({ entrada: 4, saida: 20, cacheEscrita: 5, cacheLeitura: 0.2 });
    for (const m of ["claude-sonnet-5-5", "claude-haiku-5-5-20261120", "CLAUDE-HAIKU-5-5", "toString", "__proto__", "", null, undefined]) expect(precoSugerido(m as never)).toBeNull();
    const copia = precoSugerido(HAIKU)!;
    copia.entrada = 99;
    expect(precoSugerido(HAIKU)!.entrada).toBe(0.1); // a tabela do código não muda por quem a lê
  });
});

describe("C5 — limite em reais (números reais do dono)", () => {
  it("15.000.000 / 1.000.000 com dólar a 6: Opus = R$ 480; Haiku = R$ 12; pior caso = o mais caro; abaixo do teto, sem aviso", () => {
    const p = prever();
    expect(p.porModelo).toEqual([{ modelo: HAIKU, reais: 12, fonte: "tabela" }, { modelo: OPUS, reais: 480, fonte: "tabela" }]);
    expect(p.piorCaso).toEqual({ modelo: OPUS, reais: 480, fonte: "tabela" });
    expect(p.daConversa).toEqual({ modelo: HAIKU, reais: 12, fonte: "tabela" });
    expect(p).toMatchObject({ acimaDoTeto: false, suspeita: null, semPreco: [], semCotacao: false });
  });

  it("aviso vermelho quando o pior caso passa do teto (R$ 1.621)", () => {
    const p = prever({ limites: { entrada: 60_000_000, saida: 5_000_000 } }); // (240 + 100) × 6 = R$ 2.040
    expect(p.piorCaso?.reais).toBe(2040);
    expect(p.acimaDoTeto).toBe(true);
    expect(p.suspeita).toBeNull();
    expect(prever({ modelosEmUso: [HAIKU], modeloDaConversa: HAIKU, limites: { entrada: 60_000_000, saida: 5_000_000 } }).acimaDoTeto).toBe(false);
  });

  it("aviso amarelo: campos trocados (saída maior que entrada) ou pior caso acima de 5× o teto", () => {
    expect(prever({ limites: { entrada: 1_000_000, saida: 15_000_000 } }).suspeita).toMatch(/trocados/);
    const absurdo = prever({ limites: { entrada: 300_000_000, saida: 10_000_000 } }); // (1.200 + 200) × 6 = R$ 8.400 > 5 × 1.621
    expect(absurdo).toMatchObject({ acimaDoTeto: true });
    expect(absurdo.suspeita).toMatch(/5 vezes o teto/);
    expect(prever({ limites: { entrada: 0, saida: 0 } })).toMatchObject({ acimaDoTeto: false, suspeita: null }); // 0 = bloqueada, não é erro
  });

  it("sem preço cadastrado a sugestão NÃO entra na conta: fica sem reais e a tela lista o que falta; reserva é dita como reserva", () => {
    const sem = prever({ tabela: new Map() });
    expect(sem).toMatchObject({ piorCaso: null, semPreco: [HAIKU, OPUS] });
    expect(sem.daConversa).toEqual({ modelo: HAIKU, reais: null, fonte: "sem_preco" });
    const reserva = prever({ tabela: tabela(HAIKU), reserva: { entradaMilhao: 10, saidaMilhao: 50 } }); // Opus pela reserva: 150 + 50
    expect(reserva.porModelo.find(m => m.modelo === OPUS)).toEqual({ modelo: OPUS, reais: 200, fonte: "reserva" });
    expect(prever({ cotacao: null })).toMatchObject({ piorCaso: null, semCotacao: true });
  });

  it("projeção até o fim do mês pelo ritmo atual", () => {
    expect(projecaoDoMes(100, "2026-11", 10)).toBe(300);
    expect(projecaoDoMes(31, "2026-12", 31)).toBe(31);
    expect(projecaoDoMes(10, "2026-02", 1)).toBe(280);
    expect(projecaoDoMes(null, "2026-11", 10)).toBeNull();
    expect(projecaoDoMes(5, "lixo", 10)).toBeNull();
  });
});

describe("C5 — rotas (appRouter, PGlite)", () => {
  let banco: Awaited<ReturnType<typeof criarBanco>>;
  const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
  const caller = (role: string, permissoes: string[] = [], active = true) =>
    appRouter.createCaller({ user: { id: 1, role, active, permissions: JSON.stringify(permissoes) }, req: {}, res: {} } as never);
  beforeEach(async () => {
    banco = await criarBanco();
    vi.mocked(getDb).mockReturnValue(banco.db as never);
    await banco.pg.exec(CENARIO);
    // o banco de teste da Dolores não traz a tabela de configurações do painel (modelo por função): a mesma da migração 0018
    await banco.pg.exec(readFileSync(new URL("../../drizzle/0018_dashboard_settings.sql", import.meta.url), "utf8"));
    await banco.pg.exec(`UPDATE dolores_whatsapp_config SET limite_mensal_tokens_entrada = 15000000, limite_mensal_tokens_saida = 1000000, modelo = '${HAIKU}' WHERE id = 1;
      UPDATE dolores_cotacao SET cotacao_dolar = 6 WHERE id = 1;`);
  });
  afterEach(() => vi.clearAllMocks());

  it("cartão da Dolores: R$ 12 só com o Haiku; com o Opus numa função da Dolores, pior caso R$ 480 — só com preço gravado", async () => {
    const admin = caller("admin");
    let s = await admin.dolores.status();
    expect(s.limitesPadrao).toEqual({ entrada: 15_000_000, saida: 1_000_000 });
    expect(s.tetoDonoReais).toBe(1621);
    expect(s.previsao).toMatchObject({ piorCaso: null, semPreco: [HAIKU] }); // sem preço gravado, a sugestão não conta
    await admin.dolores.operacao.usarPrecoSugerido({ modelo: HAIKU });
    s = await admin.dolores.status();
    expect(s.previsao).toMatchObject({ piorCaso: { modelo: HAIKU, reais: 12 }, daConversa: { modelo: HAIKU, reais: 12 }, acimaDoTeto: false });
    await banco.pg.exec(`INSERT INTO dashboard_settings (key, value) VALUES ('${chaveModeloDaFuncao("dolores_documentos")}', '${OPUS}')`);
    s = await admin.dolores.status();
    expect(s.previsao?.modelos.emUso).toEqual([HAIKU, OPUS]);
    // o Opus ainda sem preço: o pior caso mostrado é só o do que tem preço, e a tela avisa que pode ficar abaixo do real
    expect(s.previsao).toMatchObject({ piorCaso: { modelo: HAIKU, reais: 12 }, semPreco: [OPUS] });
    await admin.dolores.operacao.usarPrecoSugerido({ modelo: OPUS });
    s = await admin.dolores.status();
    expect(s.previsao).toMatchObject({ piorCaso: { modelo: OPUS, reais: 480 }, daConversa: { modelo: HAIKU, reais: 12 }, acimaDoTeto: false, suspeita: null });
    expect(JSON.stringify(s)).not.toMatch(/sk-ant/);
  });

  it("operação: o sugerido aparece, não entra no gasto; \"usar o sugerido\" grava os valores do código; modelo sem sugestão é recusado", async () => {
    const admin = caller("admin");
    await banco.pg.exec(`INSERT INTO dashboard_settings (key, value) VALUES ('${chaveModeloDaFuncao("dolores_whatsapp")}', '${HAIKU}')`);
    let s = await admin.dolores.operacao.situacao();
    expect(s.gasto.precosPorModelo.find(p => p.modelo === HAIKU)).toEqual({ modelo: HAIKU, preco: null, sugerido: PRECOS_SUGERIDOS[HAIKU] });
    expect(s.gasto.sugestao).toEqual({ fonte: FONTE_PRECOS_SUGERIDOS, data: "2026-11-20", cotacao: 6 });
    expect(s.gasto.previsao.limite).toMatchObject({ piorCaso: null, semPreco: [HAIKU] });
    expect(await q("SELECT * FROM dolores_precos_modelo")).toEqual([]);
    s = await admin.dolores.operacao.usarPrecoSugerido({ modelo: HAIKU });
    expect((await q<any>("SELECT modelo, entrada_milhao_usd, saida_milhao_usd, cache_escrita_milhao_usd, cache_leitura_milhao_usd FROM dolores_precos_modelo")))
      .toEqual([{ modelo: HAIKU, entrada_milhao_usd: "0.1000", saida_milhao_usd: "0.5000", cache_escrita_milhao_usd: "0.1250", cache_leitura_milhao_usd: "0.0100" }]);
    expect(s.gasto.previsao.limite).toMatchObject({ piorCaso: { modelo: HAIKU, reais: 12 } });
    expect(s.gasto.previsao).toMatchObject({ gastoMesReais: 0, projecaoFimDoMesReais: 0 });
    await expect(admin.dolores.operacao.usarPrecoSugerido({ modelo: "claude-sonnet-5-5" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin.dolores.operacao.usarPrecoSugerido({ modelo: HAIKU, entrada: 0 } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await q<any>("SELECT count(*)::int AS n FROM dolores_acoes WHERE funcao = 'operacao_config' AND motivo = 'preço sugerido gravado pela tela'")).toEqual([{ n: 1 }]);
  });

  it("\"usar o padrão\" dos limites passa pela rota de sempre e grava 15.000.000 / 1.000.000", async () => {
    await banco.pg.exec("UPDATE dolores_whatsapp_config SET limite_mensal_tokens_entrada = 0, limite_mensal_tokens_saida = 0");
    const s = await caller("admin").dolores.salvar({ limiteEntrada: LIMITES_PADRAO.entrada, limiteSaida: LIMITES_PADRAO.saida });
    expect(s.limites).toEqual({ entrada: 15_000_000, saida: 1_000_000 });
  });

  it("permissões por PAPEL: colaborador com todos os módulos, corretor, user e admin inativo são recusados; nada é gravado", async () => {
    for (const c of [caller("colaborador", [...ADMIN_MODULES]), caller("corretor"), caller("user"), caller("admin", [], false)]) {
      await expect(c.dolores.operacao.usarPrecoSugerido({ modelo: HAIKU })).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|UNAUTHORIZED/) });
      await expect(c.dolores.status()).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|UNAUTHORIZED/) });
      await expect(c.dolores.operacao.situacao()).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|UNAUTHORIZED/) });
    }
    expect(await q("SELECT * FROM dolores_precos_modelo")).toEqual([]);
  });
});
