// EPIC-027 C5-E5 — gasto da Dolores separado por função (decisão do dono: "cada função com seu gasto") e os alertas ao dono em 80%
// e 100%. Regras puras + reservas e alertas no banco em memória (PGlite, migração 0148 aplicada duas vezes) + rotas (appRouter).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));

import { ADMIN_MODULES } from "../../shared/admin-permissions.js";
import {
  FUNCOES_DO_GASTO, PARTES_PADRAO, alertasDevidos, custoDoMes, erroDasPartes, funcaoDaChamada, limiteDaParte, linhaDoGastoPorFuncao, situacaoDoGasto,
  textoDoAlerta, type FuncaoDoConsumo, type UsoDetalhado,
} from "../../shared/dolores/custo.js";
import { FRASE_LIMITE_DA_CONVERSA, fraseDeBloqueio } from "../../shared/dolores/whatsapp.js";
import { montarRelatorio } from "../../shared/dolores/operacao.js";
import { getDb } from "../db.js";
import { appRouter } from "../routers.js";
import {
  esquecerColunaFuncao, liberarReserva, lerPartesDoGasto, parteDaFuncaoEsgotada, registrarConsumo, reservarAtendimento, reservarChamada, reservarClassificacao,
  reservarMarcacao, usoPorFuncaoNoMes,
} from "./consumo.js";
import { consumoDoMesDetalhado } from "./custo.js";
import { conferirAlertasDoGasto, definirEnvioDosAlertas, gastoPorFuncaoDoMes, type EnvioDoAlerta } from "./operacao-gasto.js";
import { CENARIO, criarBanco } from "./testes-banco.js";

const MES = "2026-11";
const LIMITES = { entrada: 1_000_000, saida: 100_000 };
const VALIDADE = 60_000;
const uso = (entrada: number, saida = 0): UsoDetalhado => ({ entrada, saida, cacheEscrita: 0, cacheLeitura: 0 });

describe("C5-E5 — regras puras", () => {
  it("divisão padrão do dono: 55 · 20 · 10 · 10 · 5 (soma 100) e a parte em tokens nunca passa do limite", () => {
    expect(PARTES_PADRAO).toEqual({ conversa: 55, documentos_e_notas: 20, grupos: 10, clientes: 10, avisos: 5 });
    expect(erroDasPartes(PARTES_PADRAO)).toBeNull();
    const soma = FUNCOES_DO_GASTO.reduce((s, f) => ({ e: s.e + limiteDaParte({ entrada: 999_999, saida: 99_999 }, PARTES_PADRAO[f]).entrada, s: s.s + limiteDaParte({ entrada: 999_999, saida: 99_999 }, PARTES_PADRAO[f]).saida }), { e: 0, s: 0 });
    expect(soma.e).toBeLessThanOrEqual(999_999);
    expect(soma.s).toBeLessThanOrEqual(99_999);
  });

  it("percentuais inválidos são recusados: soma ≠ 100, zero, negativo, fracionário, acima do máximo, faltando ou sobrando função", () => {
    expect(erroDasPartes({ ...PARTES_PADRAO, avisos: 4 })).toMatch(/somam 99%/);
    expect(erroDasPartes({ ...PARTES_PADRAO, avisos: 0, conversa: 60 })).toMatch(/0%/);
    expect(erroDasPartes({ ...PARTES_PADRAO, avisos: -5, conversa: 65 })).toMatch(/0%/);
    expect(erroDasPartes({ ...PARTES_PADRAO, avisos: 4.5, conversa: 55.5 })).toMatch(/inteiro/);
    expect(erroDasPartes({ conversa: 97, documentos_e_notas: 1, grupos: 1, clientes: 1, avisos: 0 })).toMatch(/0%/);
    expect(erroDasPartes({ conversa: 97, documentos_e_notas: 1, grupos: 1, clientes: 1, avisos: 1 })).toMatch(/no máximo 96%/);
    const { avisos: _a, ...semAvisos } = PARTES_PADRAO;
    expect(erroDasPartes(semAvisos)).toMatch(/inteiro/);
    expect(erroDasPartes({ ...PARTES_PADRAO, extra: 0 })).toMatch(/desconhecida/);
  });

  it("linha antiga (sem função gravada) sai pela origem: mensagem do dono = conversa, 'grupo…', 'cliente…', o resto = documentos", () => {
    expect(funcaoDaChamada({ mensagemId: 7, parada: "end_turn" })).toBe("conversa");
    expect(funcaoDaChamada({ mensagemId: null, parada: "grupo:end_turn" })).toBe("grupos");
    expect(funcaoDaChamada({ mensagemId: null, parada: "cliente:tool_use" })).toBe("clientes");
    expect(funcaoDaChamada({ mensagemId: null, parada: "end_turn" })).toBe("documentos_e_notas");
    expect(funcaoDaChamada({ mensagemId: null, parada: null })).toBe("documentos_e_notas");
    expect(funcaoDaChamada({ funcao: "avisos", mensagemId: null, parada: null })).toBe("avisos");
    expect(funcaoDaChamada({ funcao: "invalida" as never, mensagemId: 3, parada: null })).toBe("conversa");
  });

  it("situação e alertas: 80% da parte, 100% da parte, total; o cache conta pelo peso do preço", () => {
    const linhas = [
      { modelo: "m", funcao: "grupos" as FuncaoDoConsumo, uso: { entrada: 40_000, saida: 0, cacheEscrita: 0, cacheLeitura: 400_000 } }, // 40k + 40k = 80k = 80%
      { modelo: "m", funcao: "conversa" as FuncaoDoConsumo, uso: uso(100_000) },
    ];
    const custo = custoDoMes(linhas, new Map(), { entradaMilhao: null, saidaMilhao: null }, null);
    const s = situacaoDoGasto({ linhas, custo, limites: LIMITES, partes: { ...PARTES_PADRAO }, tetoReais: 1621 });
    const grupos = s.funcoes.find(f => f.funcao === "grupos")!;
    expect(grupos).toMatchObject({ parte: 10, tokens: { entrada: 80_000, saida: 0 }, limiteTokens: { entrada: 100_000, saida: 10_000 }, tokensPct: 80, reais: null });
    expect(alertasDevidos(s)).toEqual([{ alvo: "grupos", nivel: 80 }]);
    expect(alertasDevidos(s, { bloqueadas: ["grupos"] })).toEqual([{ alvo: "grupos", nivel: 100 }]);
    expect(alertasDevidos(s, { totalBloqueado: true })).toEqual([{ alvo: "total", nivel: 100 }, { alvo: "grupos", nivel: 80 }]);
    // sem limite definido não há alerta (a IA nem roda)
    expect(alertasDevidos(situacaoDoGasto({ linhas, custo, limites: { entrada: 0, saida: 0 }, partes: { ...PARTES_PADRAO }, tetoReais: 1621 }))).toEqual([]);
    expect(linhaDoGastoPorFuncao(s)).toMatch(/^Por função: a conversa com você 18% da parte de 55%; .*as respostas em grupo 80% da parte de 10%/);
  });

  it("texto do alerta: fixo, com quanto gastou, quanto resta e em qual função; nada de dado pessoal", () => {
    const linhas = [{ modelo: "m", funcao: "grupos" as FuncaoDoConsumo, uso: uso(85_000, 1_000) }];
    const custo = custoDoMes(linhas, new Map([["m", { entrada: 3, saida: 15, cacheEscrita: null, cacheLeitura: null }]]), { entradaMilhao: null, saidaMilhao: null }, 6);
    const s = situacaoDoGasto({ linhas, custo, limites: LIMITES, partes: { ...PARTES_PADRAO }, tetoReais: 1621 });
    expect(textoDoAlerta({ alvo: "grupos", nivel: 80 }, s, MES).replace(/\u00a0/g, " ")).toBe([
      "Dolores: aviso de gasto da IA (mês 2026-11). As respostas em grupo chegaram a 85% da parte dela (10% do limite do mês).",
      "Gasto: R$ 1,62 de R$ 162,10 (resta R$ 160,48).",
      "Tokens contados no limite: 85.000 de 100.000 de entrada e 1.000 de 10.000 de saída (resta 15%).",
      "Ao chegar a 100% da parte, só essa função para de usar a IA; as outras continuam.",
      "Nada foi alterado no sistema.",
    ].join("\n"));
    const t100 = textoDoAlerta({ alvo: "total", nivel: 100 }, s, MES);
    expect(t100).toMatch(/O gasto total com a IA chegou a 8% do limite do mês — não cabe mais uma chamada à IA\./);
    expect(t100).toMatch(/Entrei em modo sem IA: não uso mais a IA neste mês/);
    expect(t100).toMatch(/Por função: as respostas em grupo R\$\s1,62\./);
    for (const t of [t100, textoDoAlerta({ alvo: "conversa", nivel: 100 }, s, MES)]) {
      expect(t).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}|\d{10,}|@|\(\d{2}\)/); // CPF, telefone, e-mail
    }
    expect(textoDoAlerta({ alvo: "conversa", nivel: 100 }, s, MES)).toMatch(/Entrei em modo sem IA só nessa função .* As outras funções continuam funcionando\./);
  });

  it("frase da conversa no limite da parte dela (texto fixo, sem IA)", () => {
    expect(fraseDeBloqueio("limite_da_funcao")).toBe(FRASE_LIMITE_DA_CONVERSA);
    expect(FRASE_LIMITE_DA_CONVERSA).toMatch(/^Dolores: bati o limite do mês da nossa conversa; os grupos e os documentos continuam funcionando\./);
  });

  it("relatório diário: o gasto por função em uma linha (a mesma conta da tela)", () => {
    const texto = montarRelatorio({ tipo: "diario", geradoEm: new Date("2026-11-21T12:00:00Z"), destaques: {}, falhas: [], precos: { entradaMilhao: null, saidaMilhao: null },
      totais: { consumo: { mes: MES, entrada: 120_000, saida: 0, limiteEntrada: LIMITES.entrada, limiteSaida: LIMITES.saida, partes: { ...PARTES_PADRAO },
        linhas: [{ modelo: "m", funcao: "conversa", uso: uso(110_000) }, { modelo: "m", funcao: "grupos", uso: uso(10_000) }] } } });
    const linha = texto.split("\n").find(l => l.startsWith("Por função:"));
    expect(linha).toBe("Por função: a conversa com você 20% da parte de 55%; a leitura de documentos e notas de obra 0% da parte de 20%; as respostas em grupo 10% da parte de 10%; o atendimento a clientes 0% da parte de 10%; os avisos automáticos 0% da parte de 5%.");
  });
});

describe("C5-E5 — banco (PGlite)", () => {
  let banco: Awaited<ReturnType<typeof criarBanco>>;
  const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
  let enviados: Array<{ texto: string; ctx: Parameters<EnvioDoAlerta>[1] }> = [];
  let envioOk = true;
  const consumir = (f: { funcao?: FuncaoDoConsumo | null; mensagemId?: number | null; parada?: string | null; entrada: number; saida?: number }) =>
    banco.pg.exec(`INSERT INTO dolores_consumo (mes, mensagem_id, modelo, volta, tokens_entrada, tokens_saida, parada, funcao)
      VALUES ('${MES}', ${f.mensagemId ?? "NULL"}, 'm', 1, ${f.entrada}, ${f.saida ?? 0}, ${f.parada ? `'${f.parada}'` : "NULL"}, ${f.funcao ? `'${f.funcao}'` : "NULL"})`);
  const novaMensagem = async (ext: string) => (await q<{ id: number }>(`INSERT INTO dolores_mensagens (instancia, external_id, do_dono) VALUES ('prospecta-dolores', '${ext}', true) RETURNING id`))[0].id;

  beforeEach(async () => {
    esquecerColunaFuncao();
    banco = await criarBanco();
    vi.mocked(getDb).mockReturnValue(banco.db as never);
    await banco.pg.exec(CENARIO);
    await banco.pg.exec(readFileSync(new URL("../../drizzle/0018_dashboard_settings.sql", import.meta.url), "utf8"));
    await banco.pg.exec(`UPDATE dolores_whatsapp_config SET limite_mensal_tokens_entrada = ${LIMITES.entrada}, limite_mensal_tokens_saida = ${LIMITES.saida} WHERE id = 1`);
    enviados = [];
    envioOk = true;
    definirEnvioDosAlertas(async (texto, ctx) => { enviados.push({ texto, ctx }); return { ok: envioOk, motivo: envioOk ? null : "Dolores desconectada" }; });
  });
  afterEach(() => { definirEnvioDosAlertas(null); vi.clearAllMocks(); });

  it("migração 0148: idempotente, divisão padrão na linha única; o banco recusa soma ≠ 100 e função inválida na coluna", async () => {
    expect(await q("SELECT conversa_pct, documentos_pct, grupos_pct, clientes_pct, avisos_pct FROM dolores_gasto_partes"))
      .toEqual([{ conversa_pct: 55, documentos_pct: 20, grupos_pct: 10, clientes_pct: 10, avisos_pct: 5 }]);
    await expect(banco.pg.exec("UPDATE dolores_gasto_partes SET avisos_pct = 6")).rejects.toThrow();
    await expect(banco.pg.exec("UPDATE dolores_gasto_partes SET avisos_pct = 0, conversa_pct = 60")).rejects.toThrow();
    await expect(consumir({ funcao: "qualquer" as never, entrada: 1 })).rejects.toThrow();
    expect(await lerPartesDoGasto()).toEqual({ partes: { ...PARTES_PADRAO }, disponivel: true });
  });

  it("contabilização por função: cada chamada grava a sua função; linhas antigas sem função contam pela origem", async () => {
    const m = await novaMensagem("CONTA-1");
    // linhas ANTIGAS (antes da 0148): sem função
    await consumir({ mensagemId: m, parada: "end_turn", entrada: 1_000 });
    await consumir({ parada: "grupo:end_turn", entrada: 2_000 });
    await consumir({ parada: "cliente:end_turn", entrada: 3_000 });
    await consumir({ parada: "end_turn", entrada: 4_000 });
    // linhas novas: a função vai na coluna
    expect(await registrarConsumo({ mes: MES, mensagemId: m, modelo: "m", volta: 1, parada: "end_turn", uso: { entrada: 10, saida: 1, cacheEscrita: 100, cacheLeitura: 1_000 } })).toBe(true);
    expect(await registrarConsumo({ mes: MES, mensagemId: null, modelo: "m", volta: 1, parada: "grupo:end_turn", uso: uso(20) })).toBe(true);
    expect(await registrarConsumo({ mes: MES, mensagemId: null, modelo: "m", volta: 1, parada: "cliente:end_turn", uso: uso(30) })).toBe(true);
    expect(await registrarConsumo({ mes: MES, mensagemId: null, modelo: "m", volta: 1, parada: "end_turn", uso: uso(40) })).toBe(true);
    expect(await registrarConsumo({ mes: MES, mensagemId: null, modelo: "m", volta: 1, parada: "end_turn", uso: uso(50), funcao: "avisos" })).toBe(true);
    expect((await q<{ funcao: string | null }>("SELECT funcao FROM dolores_consumo ORDER BY id")).map(r => r.funcao))
      .toEqual([null, null, null, null, "conversa", "grupos", "clientes", "documentos_e_notas", "avisos"]);
    const porFuncao = await usoPorFuncaoNoMes(MES);
    // conversa: 1.000 + 10 + 125 (escrita × 1,25) + 100 (leitura × 0,1)
    expect(porFuncao).toEqual({ conversa: { entrada: 1_235, saida: 1 }, grupos: { entrada: 2_020, saida: 0 }, clientes: { entrada: 3_030, saida: 0 },
      documentos_e_notas: { entrada: 4_040, saida: 0 }, avisos: { entrada: 50, saida: 0 } });
    const detalhe = await consumoDoMesDetalhado(MES);
    expect(Object.fromEntries(detalhe.map(l => [l.funcao, l.uso.entrada]))).toEqual({ conversa: 1_010, grupos: 2_020, clientes: 3_030, documentos_e_notas: 4_040, avisos: 50 });
  });

  it("estouro de 'grupos' não bloqueia a conversa nem os documentos; só as respostas em grupo param", async () => {
    await consumir({ funcao: "grupos", entrada: 100_000 }); // a parte inteira dos grupos (10%)
    expect(await reservarMarcacao({ mes: MES, marcacaoId: 1, limites: LIMITES, reserva: { entrada: 1_000, saida: 100 }, validadeMs: VALIDADE })).toBe("orcamento_marcacao");
    expect(await parteDaFuncaoEsgotada(MES, "grupos", LIMITES)).toBe(true);
    expect(await parteDaFuncaoEsgotada(MES, "conversa", LIMITES)).toBe(false);
    const m = await novaMensagem("CONV-1");
    expect(await reservarChamada({ mes: MES, mensagemId: m, limites: LIMITES, reserva: { entrada: 30_000, saida: 3_000 }, validadeMs: VALIDADE })).toBeNull();
    await liberarReserva(m);
    expect(await reservarClassificacao({ mes: MES, mensagemGrupoId: 1, limites: LIMITES, reserva: { entrada: 28_000, saida: 300 }, validadeMs: VALIDADE })).toBeNull();
    // e o alerta de 100% saiu SÓ para os grupos
    expect(enviados.map(e => e.ctx.resumo)).toEqual([{ mes: MES, alvo: "grupos", nivel: 100 }]);
  });

  it("a conversa no limite da parte dela para ('orcamento_conversa') e grupos, clientes e documentos continuam", async () => {
    const m = await novaMensagem("CONV-2");
    await consumir({ funcao: "conversa", mensagemId: m, entrada: 550_000 }); // 55% = 550.000
    expect(await reservarChamada({ mes: MES, mensagemId: m, limites: LIMITES, reserva: { entrada: 14_000, saida: 3_000 }, validadeMs: VALIDADE })).toBe("orcamento_conversa");
    expect((await q("SELECT reserva_entrada FROM dolores_mensagens WHERE id = " + m))[0]).toEqual({ reserva_entrada: 0 });
    expect(await reservarMarcacao({ mes: MES, marcacaoId: 1, limites: LIMITES, reserva: { entrada: 6_000, saida: 400 }, validadeMs: VALIDADE })).toBeNull();
    await banco.pg.exec("UPDATE dolores_marcacoes SET reserva_ate = NULL");
    expect(await reservarAtendimento({ mes: MES, atendimentoId: 1, limites: LIMITES, reserva: { entrada: 6_000, saida: 400 }, validadeMs: VALIDADE })).toBeNull();
    expect(await reservarClassificacao({ mes: MES, mensagemGrupoId: 1, limites: LIMITES, reserva: { entrada: 28_000, saida: 300 }, validadeMs: VALIDADE })).toBeNull();
    // antes da 0148 a conversa podia usar até 100%: agora ela fica nos 55% dela, mesmo com o resto do limite livre
    expect(enviados.map(e => e.ctx.resumo)).toEqual([{ mes: MES, alvo: "conversa", nivel: 100 }]);
    expect(enviados[0].texto).toMatch(/Entrei em modo sem IA só nessa função/);
  });

  it("total nunca passa do limite: cada função gasta até ser barrada pela parte dela, e a soma fica dentro do limite", async () => {
    const m = await novaMensagem("CONV-3");
    const reserva = { entrada: 37_000, saida: 3_100 };
    const rodar = async (funcao: FuncaoDoConsumo) => {
      for (let i = 0; i < 100; i++) {
        let b: string | null;
        if (funcao === "conversa") b = await reservarChamada({ mes: MES, mensagemId: m, limites: LIMITES, reserva, validadeMs: VALIDADE });
        else if (funcao === "grupos") b = await reservarMarcacao({ mes: MES, marcacaoId: 1, limites: LIMITES, reserva, validadeMs: VALIDADE });
        else if (funcao === "clientes") b = await reservarAtendimento({ mes: MES, atendimentoId: 1, limites: LIMITES, reserva, validadeMs: VALIDADE });
        else b = await reservarClassificacao({ mes: MES, mensagemGrupoId: 1, limites: LIMITES, reserva, validadeMs: VALIDADE });
        if (b) return b;
        await registrarConsumo({ mes: MES, mensagemId: funcao === "conversa" ? m : null, modelo: "m", volta: 1, uso: uso(reserva.entrada, reserva.saida),
          parada: funcao === "grupos" ? "grupo:end_turn" : funcao === "clientes" ? "cliente:end_turn" : "end_turn" });
        await liberarReserva(m);
      }
      return "nunca parou";
    };
    expect(await rodar("documentos_e_notas")).toBe("orcamento_classificacao");
    expect(await rodar("grupos")).toBe("orcamento_marcacao");
    expect(await rodar("clientes")).toBe("orcamento_atendimento");
    expect(await rodar("conversa")).toBe("orcamento_conversa");
    const porFuncao = await usoPorFuncaoNoMes(MES);
    for (const f of FUNCOES_DO_GASTO) {
      const parte = limiteDaParte(LIMITES, PARTES_PADRAO[f]);
      // terceiros contam a própria reserva; a conversa segue a regra do limite inteiro (a 1ª chamada passa no máximo uma reserva)
      const folga = f === "conversa" ? reserva : { entrada: 0, saida: 0 };
      expect(porFuncao[f].entrada).toBeLessThanOrEqual(parte.entrada + folga.entrada);
      expect(porFuncao[f].saida).toBeLessThanOrEqual(parte.saida + folga.saida);
    }
    const total = FUNCOES_DO_GASTO.reduce((s, f) => ({ e: s.e + porFuncao[f].entrada, s: s.s + porFuncao[f].saida }), { e: 0, s: 0 });
    expect(total.e).toBeLessThanOrEqual(LIMITES.entrada);
    expect(total.s).toBeLessThanOrEqual(LIMITES.saida);
    // cada limite cruzado avisou UMA vez (80% junto com 100% quando os dois chegaram ao mesmo tempo)
    const chaves = enviados.map(e => `${e.ctx.resumo.alvo}:${e.ctx.resumo.nivel}`);
    expect(new Set(chaves).size).toBe(chaves.length);
    expect(chaves).toEqual(expect.arrayContaining(["documentos_e_notas:100", "grupos:100", "clientes:100", "conversa:100"]));
  });

  it("concorrência nas reservas: duas mensagens do dono ao mesmo tempo no fim da parte da conversa — só uma reserva", async () => {
    const [a, b] = [await novaMensagem("CONC-A"), await novaMensagem("CONC-B")];
    await consumir({ funcao: "conversa", mensagemId: a, entrada: 515_000 }); // 515 mil + 40 mil da outra reserva passa dos 550 mil
    const r = await Promise.all([a, b].map(id => reservarChamada({ mes: MES, mensagemId: id, limites: LIMITES, reserva: { entrada: 40_000, saida: 3_000 }, validadeMs: VALIDADE })));
    expect(r.filter(x => x === null)).toHaveLength(1);
    expect(r.filter(x => x === "outro_pedido")).toHaveLength(1);
    expect((await q<{ n: number }>("SELECT count(*)::int AS n FROM dolores_mensagens WHERE reserva_entrada > 0"))[0].n).toBe(1);
  });

  it("alerta de 80%: por função e no total, UMA vez por mês por limite, mesmo com várias conferências ao mesmo tempo", async () => {
    await consumir({ funcao: "conversa", entrada: 450_000 }); // 81,8% da parte da conversa; 45% do total
    await Promise.all(Array.from({ length: 5 }, () => conferirAlertasDoGasto(MES)));
    expect(enviados.map(e => e.ctx.resumo)).toEqual([{ mes: MES, alvo: "conversa", nivel: 80 }]);
    expect(enviados[0].texto).toMatch(/^Dolores: aviso de gasto da IA \(mês 2026-11\)\. A conversa com você chegou a 81% da parte dela \(55% do limite do mês\)\./);
    expect(enviados[0].ctx).toMatchObject({ funcao: "gasto_alerta", pedidoId: "gasto:2026-11:conversa:80", canal: "whatsapp" });
    await consumir({ funcao: "documentos_e_notas", entrada: 180_000 });
    await consumir({ funcao: "grupos", entrada: 90_000 });
    await consumir({ funcao: "clientes", entrada: 90_000 }); // total 810.000 = 81%
    await Promise.all(Array.from({ length: 3 }, () => conferirAlertasDoGasto(MES)));
    expect(enviados.slice(1).map(e => `${e.ctx.resumo.alvo}:${e.ctx.resumo.nivel}`).sort()).toEqual(["clientes:80", "documentos_e_notas:80", "grupos:80", "total:80"]);
    const total = enviados.find(e => e.ctx.resumo.alvo === "total")!.texto;
    expect(total).toMatch(/O gasto total com a IA chegou a 81% do limite do mês\./);
    expect(total).toMatch(/Tokens contados no limite: 810\.000 de 1\.000\.000 de entrada/);
    expect(total).toMatch(/Ao chegar a 100%, eu paro de usar a IA até o mês que vem\./);
    // de novo: nada sai
    await conferirAlertasDoGasto(MES);
    expect(enviados).toHaveLength(5);
    expect(await q("SELECT alvo, nivel, enviado_em IS NOT NULL AS enviado FROM dolores_gasto_alertas ORDER BY alvo")).toHaveLength(5);
  });

  it("alerta de 100%: modo sem IA (total e função); o de 80% que não saiu vai junto, numa mensagem só", async () => {
    await consumir({ funcao: "avisos", entrada: 50_000 }); // 100% da parte dos avisos, sem ter passado pelos 80% antes
    await conferirAlertasDoGasto(MES);
    expect(enviados.map(e => e.ctx.resumo)).toEqual([{ mes: MES, alvo: "avisos", nivel: 100 }]);
    expect(enviados[0].texto).toMatch(/Os avisos automáticos chegaram a 100% da parte dela \(5% do limite do mês\)\./);
    expect(await q("SELECT alvo, nivel, enviado_em IS NOT NULL AS enviado FROM dolores_gasto_alertas ORDER BY nivel"))
      .toEqual([{ alvo: "avisos", nivel: 80, enviado: true }, { alvo: "avisos", nivel: 100, enviado: true }]);
    // limite inteiro: a reserva barrada pelo limite manda o 100% do total
    await consumir({ parada: "end_turn", entrada: 950_000 });
    const m = await novaMensagem("TOTAL");
    expect(await reservarChamada({ mes: MES, mensagemId: m, limites: LIMITES, reserva: { entrada: 14_000, saida: 100 }, validadeMs: VALIDADE })).toBe("limite_mensal");
    const t = enviados.find(e => e.ctx.resumo.alvo === "total" && e.ctx.resumo.nivel === 100);
    expect(t?.texto).toMatch(/Entrei em modo sem IA: não uso mais a IA neste mês/);
  });

  it("envio que falhou devolve a vaga: o alerta sai na próxima conferência (e só uma vez)", async () => {
    envioOk = false;
    await consumir({ funcao: "grupos", entrada: 85_000 });
    await conferirAlertasDoGasto(MES);
    expect(enviados).toHaveLength(1);
    expect(await q("SELECT * FROM dolores_gasto_alertas")).toEqual([]);
    envioOk = true;
    await conferirAlertasDoGasto(MES);
    await conferirAlertasDoGasto(MES);
    expect(enviados.map(e => e.ctx.resumo)).toEqual([{ mes: MES, alvo: "grupos", nivel: 80 }, { mes: MES, alvo: "grupos", nivel: 80 }]);
  });

  it("em reais, pela mesma conta da tela: com preço completo, o alerta sai quando o R$ chega a 80% da parte, mesmo com poucos tokens", async () => {
    await banco.pg.exec(`UPDATE dolores_whatsapp_config SET limite_mensal_tokens_entrada = 1000000000, limite_mensal_tokens_saida = 100000000 WHERE id = 1;
      UPDATE dolores_cotacao SET cotacao_dolar = 6 WHERE id = 1;
      INSERT INTO dolores_precos_modelo (modelo, entrada_milhao_usd, saida_milhao_usd) VALUES ('m', 1000, 1000);`);
    await consumir({ funcao: "conversa", entrada: 130_000 }); // R$ 780 de R$ 891,55 (55% de R$ 1.621)
    const g = await gastoPorFuncaoDoMes(MES);
    expect(g.situacao.funcoes.find(f => f.funcao === "conversa")).toMatchObject({ reais: 780, limiteReais: 891.55, reaisPct: 87.4 });
    await conferirAlertasDoGasto(MES);
    expect(enviados.map(e => e.ctx.resumo)).toEqual([{ mes: MES, alvo: "conversa", nivel: 80 }]);
    expect(enviados[0].texto.replace(/\u00a0/g, " ")).toMatch(/Gasto: R\$ 780,00 de R\$ 891,55 \(resta R\$ 111,55\)\./);
    // nada de dado pessoal do cenário no texto
    const nomes = (await q<{ name: string }>("SELECT name FROM leads WHERE name IS NOT NULL LIMIT 20")).map(r => r.name);
    for (const nome of nomes) expect(enviados[0].texto).not.toContain(nome);
    expect(enviados[0].texto).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}|\d{10,}|@/);
  });
});

describe("C5-E5 — rotas (appRouter, PGlite)", () => {
  let banco: Awaited<ReturnType<typeof criarBanco>>;
  const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
  const caller = (role: string, permissoes: string[] = [], active = true) =>
    appRouter.createCaller({ user: { id: 1, role, active, permissions: JSON.stringify(permissoes) }, req: {}, res: {} } as never);
  beforeEach(async () => {
    esquecerColunaFuncao();
    banco = await criarBanco();
    vi.mocked(getDb).mockReturnValue(banco.db as never);
    await banco.pg.exec(CENARIO);
    await banco.pg.exec(readFileSync(new URL("../../drizzle/0018_dashboard_settings.sql", import.meta.url), "utf8"));
    await banco.pg.exec(`UPDATE dolores_whatsapp_config SET limite_mensal_tokens_entrada = ${LIMITES.entrada}, limite_mensal_tokens_saida = ${LIMITES.saida} WHERE id = 1`);
    definirEnvioDosAlertas(async () => ({ ok: true, motivo: null }));
  });
  afterEach(() => { definirEnvioDosAlertas(null); vi.clearAllMocks(); });

  it("só o admin edita a divisão; percentuais inválidos são recusados no servidor; o válido fica gravado e auditado", async () => {
    const valido = { conversa: 50, documentos_e_notas: 25, grupos: 10, clientes: 10, avisos: 5 };
    for (const c of [caller("colaborador", [...ADMIN_MODULES]), caller("corretor"), caller("user"), caller("admin", [], false)]) {
      await expect(c.dolores.operacao.salvarPartes(valido)).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|UNAUTHORIZED/) });
    }
    const admin = caller("admin");
    for (const invalido of [{ ...valido, avisos: 4 }, { ...valido, avisos: 0, conversa: 55 }, { ...valido, avisos: 5.5, conversa: 49.5 }, { ...valido, extra: 1 },
      { conversa: 50, documentos_e_notas: 25, grupos: 10, clientes: 15 }, { conversa: 97, documentos_e_notas: 1, grupos: 1, clientes: 1, avisos: 0 }]) {
      await expect(admin.dolores.operacao.salvarPartes(invalido as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(await q("SELECT conversa_pct FROM dolores_gasto_partes")).toEqual([{ conversa_pct: 55 }]);
    const s = await admin.dolores.operacao.salvarPartes(valido);
    expect(s.gastoPorFuncao?.partes).toEqual(valido);
    expect(await q("SELECT conversa_pct, documentos_pct, grupos_pct, clientes_pct, avisos_pct, atualizado_por FROM dolores_gasto_partes"))
      .toEqual([{ conversa_pct: 50, documentos_pct: 25, grupos_pct: 10, clientes_pct: 10, avisos_pct: 5, atualizado_por: 1 }]);
    expect(await q<any>("SELECT count(*)::int AS n FROM dolores_acoes WHERE funcao = 'operacao_config' AND motivo = 'divisão do gasto por função alterada pela tela'")).toEqual([{ n: 1 }]);
  });

  it("a tela recebe as 5 funções (gasto × parte), o total e os alertas do mês; nada de chave", async () => {
    await banco.pg.exec(`INSERT INTO dolores_consumo (mes, modelo, volta, tokens_entrada, tokens_saida, parada, funcao) VALUES ('${new Date().toISOString().slice(0, 7)}', 'm', 1, 90000, 0, 'grupo:end_turn', 'grupos')`);
    const s = await caller("admin").dolores.operacao.situacao();
    expect(s.gastoPorFuncao?.funcoes.map(f => [f.funcao, f.parte])).toEqual([["conversa", 55], ["documentos_e_notas", 20], ["grupos", 10], ["clientes", 10], ["avisos", 5]]);
    expect(s.gastoPorFuncao?.padrao).toEqual(PARTES_PADRAO);
    expect(s.gastoPorFuncao?.alertas.disponivel).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/sk-ant/);
  });
});
