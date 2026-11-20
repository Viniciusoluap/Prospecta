// QA (Quinn) — testes de prova do portão de C4/C5 (EPIC-026). Os dois achados do portão (envio que falhou na hora escolhida
// nunca reenviado; perdedora da corrida refazendo a ronda) foram corrigidos e os testes abaixo foram invertidos.
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));

import { CAMINHOS_CRON_DOLORES, CRON_DOLORES_AGENDAS, horaDoRelatorio } from "../../shared/dolores/operacao.js";
import { ADMIN_MODULES } from "../../shared/admin-permissions.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { appRouter } from "../routers.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte } from "./ponte.js";
import { cronAutorizado, definirRelogioCron, tratarCronDolores } from "./rondas.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";
import { definirDependenciasWhatsapp } from "./whatsapp.js";

const SEGREDO_CRON = "segredo-do-cron-de-teste-qa-0123456789";
const DONO = "5599991234567";
const DIA = "2026-11-17";
const utc = (h: number, m = 5) => new Date(`${DIA}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);

let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviar: ReturnType<typeof vi.fn>;
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
// O relógio de parede (ms) anda junto com o simulado: a ronda gravada "envelhece" entre chamadas de horas diferentes.
// A base é a primeira hora simulada do teste (zerada a cada teste).
let baseMs: number | null = null;
const relogioEm = (quando: Date) => {
  baseMs ??= quando.getTime();
  const desvio = quando.getTime() - baseMs;
  return { agora: () => quando, ms: () => Date.now() + desvio };
};
const chamar = async (quando: Date, authorization = `Bearer ${SEGREDO_CRON}`) => {
  definirRelogioCron(relogioEm(quando));
  return tratarCronDolores({ headers: { authorization } } as never);
};
const diaInteiro = async () => {
  const out: Array<Record<string, unknown>> = [];
  for (const a of CRON_DOLORES_AGENDAS) out.push((await chamar(utc(Number(a.schedule.split(" ")[1])))).body);
  return out;
};
const config = (sql: string) => banco.pg.exec(`UPDATE dolores_operacao_config SET ${sql}`);

beforeEach(async () => {
  baseMs = null;
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}',
    limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;`);
  vi.stubEnv("CRON_SECRET", SEGREDO_CRON);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-qa-0123456789";
  esquecerUsuarioDolores();
  definirDependenciasPonte({ agora: () => AGORA });
  enviar = vi.fn(async () => true);
  definirDependenciasWhatsapp({ agora: () => utc(10), enviar: enviar as never });
});
afterEach(() => {
  vi.unstubAllEnvs();
  ENV.cookieSecret = segredoAntes;
  definirDependenciasPonte();
  definirDependenciasWhatsapp();
  definirRelogioCron();
  vi.clearAllMocks();
});

describe("QA C4 — segredo e caminhos", () => {
  it("sem segredo, segredo errado ou sem CRON_SECRET: 401 e nada gravado", async () => {
    await config("rondas_ligadas = true, relatorio_ligado = true, relatorio_hora = 7");
    expect((await chamar(utc(10), "")).status).toBe(401);
    expect((await chamar(utc(10), `Bearer ${SEGREDO_CRON}x`)).status).toBe(401);
    expect((await chamar(utc(10), SEGREDO_CRON)).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await chamar(utc(10), "Bearer ")).status).toBe(401);
    expect(cronAutorizado("Bearer undefined", undefined)).toBe(false);
    expect(await q("SELECT id FROM dolores_rondas")).toHaveLength(0);
    expect(enviar).not.toHaveBeenCalled();
  });

  it("Express: só os 8 caminhos fixos chegam à rotina; /99, /07, /08/x e caminhos com .. não", async () => {
    const app = express();
    const visto: string[] = [];
    app.get([...CAMINHOS_CRON_DOLORES], (req, res) => { visto.push(req.path); res.status(200).end(); });
    app.use((_req, res) => res.status(404).end());
    const srv = app.listen(0);
    try {
      const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      const st = async (p: string) => (await fetch(base + p)).status;
      for (const p of CAMINHOS_CRON_DOLORES) expect(await st(p)).toBe(200);
      for (const p of ["/api/cron/dolores/99", "/api/cron/dolores/07", "/api/cron/dolores/08/x", "/api/cron/dolores/%2e%2e/x", "/api/cron/doloresX"]) expect(await st(p)).toBe(404);
    } finally {
      srv.close();
    }
    expect(visto).toHaveLength(8);
  });
});

describe("QA C4 — idempotência e interruptores", () => {
  it("3 chamadas concorrentes na hora 7 → 1 relatório, 1 envio e a perdedora da corrida NÃO refaz a ronda (só diaria:)", async () => {
    await config("rondas_ligadas = true, relatorio_ligado = true, relatorio_hora = 7");
    definirRelogioCron(relogioEm(utc(10)));
    const auth = { headers: { authorization: `Bearer ${SEGREDO_CRON}` } } as never;
    await Promise.all([tratarCronDolores(auth), tratarCronDolores(auth), tratarCronDolores(auth)]);
    // a ronda diaria foi criada há menos de 5 min: serve ao relatório, nenhuma leitura completa a mais
    expect((await q<any>("SELECT janela FROM dolores_rondas ORDER BY id")).map(r => r.janela)).toEqual([`diaria:${DIA}`]);
    expect(await q("SELECT id FROM dolores_relatorios")).toHaveLength(1);
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it("3 chamadas concorrentes às 10h com hora 10 (ronda refeita): no máximo 1 ronda 'relatorio', 1 envio", async () => {
    await config("rondas_ligadas = true, relatorio_ligado = true, relatorio_hora = 10");
    await chamar(utc(10));
    definirRelogioCron(relogioEm(utc(13))); // 3 horas depois também no relógio de parede: a ronda da manhã não é "recente"
    const auth = { headers: { authorization: `Bearer ${SEGREDO_CRON}` } } as never;
    await Promise.all([tratarCronDolores(auth), tratarCronDolores(auth), tratarCronDolores(auth)]);
    expect((await q<any>("SELECT janela FROM dolores_rondas ORDER BY id")).map(r => r.janela)).toEqual([`diaria:${DIA}`, `relatorio:${DIA}`]);
    expect(await q("SELECT id FROM dolores_relatorios")).toHaveLength(1);
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it("envio falhou na hora escolhida → a chamada seguinte reenvia o MESMO texto (uma vez); depois 'ja_enviado'", async () => {
    await config("rondas_ligadas = true, relatorio_ligado = true, relatorio_hora = 8");
    enviar.mockImplementation(async () => false);
    await chamar(utc(10));
    expect((await chamar(utc(11))).body).toMatchObject({ relatorio: "nao_enviado" });
    enviar.mockImplementation(async () => true);
    const resto = [];
    for (const h of [12, 13, 14, 15, 16, 17]) resto.push((await chamar(utc(h))).body.relatorio);
    expect(resto).toEqual(["enviado", "ja_enviado", "ja_enviado", "ja_enviado", "ja_enviado", "ja_enviado"]);
    expect(enviar).toHaveBeenCalledTimes(2); // a que falhou + a única nova tentativa do cron
    const textos = enviar.mock.calls.map(c => (c[0] as { texto: string }).texto);
    expect(textos[1]).toBe(textos[0]); // o mesmo texto gravado, sem montar outro relatório
    expect(await q("SELECT id FROM dolores_relatorios")).toHaveLength(1);
    expect((await q<any>("SELECT janela FROM dolores_relatorio_reenvios")).map(r => r.janela)).toEqual([`cron:${DIA}`]);
    const canais = (await q<any>("SELECT canal, resultado FROM dolores_acoes WHERE funcao = 'relatorio_envio' ORDER BY id")).map(r => `${r.canal}:${r.resultado}`);
    expect(canais).toEqual(["cron:erro", "cron:ok"]);
  });

  it("a nova tentativa do cron também falha (ex.: tempo esgotado no provedor) → no máximo 2 envios no dia e 'nao_enviado_antes'", async () => {
    await config("rondas_ligadas = true, relatorio_ligado = true, relatorio_hora = 7");
    enviar.mockImplementation(async () => false);
    const r = await diaInteiro();
    expect(r.map(b => b.relatorio)).toEqual(["nao_enviado", "nao_enviado", ...Array(6).fill("nao_enviado_antes")]);
    expect(enviar).toHaveBeenCalledTimes(2);
    for (const c of enviar.mock.calls) expect((c[0] as { numero: string }).numero).toBe(DONO);
  });

  it("envio falhou e a pausa geral foi ligada → o cron não tenta de novo", async () => {
    await config("rondas_ligadas = true, relatorio_ligado = true, relatorio_hora = 7");
    enviar.mockImplementation(async () => false);
    await chamar(utc(10));
    await banco.pg.exec("UPDATE dolores_config SET pausada = true");
    enviar.mockImplementation(async () => true);
    expect((await chamar(utc(11))).body).toMatchObject({ r: "pausada" });
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(await q("SELECT id FROM dolores_relatorio_reenvios")).toHaveLength(0);
  });

  it("pausa geral: 8 chamadas, nada de ronda nem envio", async () => {
    await config("rondas_ligadas = true, relatorio_ligado = true, relatorio_hora = 7");
    await banco.pg.exec("UPDATE dolores_config SET pausada = true");
    await diaInteiro();
    expect(await q("SELECT id FROM dolores_rondas")).toHaveLength(0);
    expect(enviar).not.toHaveBeenCalled();
  });

  it("relatório desligado: 8 chamadas → 1 ronda, nenhum envio", async () => {
    await config("rondas_ligadas = true, relatorio_ligado = false, relatorio_hora = 7");
    await diaInteiro();
    expect(await q("SELECT id FROM dolores_rondas")).toHaveLength(1);
    expect(enviar).not.toHaveBeenCalled();
  });

  it("rondas desligadas (relatório ligado): 8 chamadas → nada (comportamento anterior ao C4)", async () => {
    await config("rondas_ligadas = false, relatorio_ligado = true");
    const r = await diaInteiro();
    expect(r.every(b => b.r === "rondas-desligadas")).toBe(true);
    expect(await q("SELECT id FROM dolores_rondas")).toHaveLength(0);
    expect(enviar).not.toHaveBeenCalled();
  });

  it("horas antigas/fora da lista no banco (0..6, 15..23) valem 7", async () => {
    for (const h of [0, 6, 15, 23]) expect(horaDoRelatorio(h)).toBe(7);
    expect(horaDoRelatorio(null as never)).toBe(7);
    await config("rondas_ligadas = true, relatorio_ligado = true, relatorio_hora = 20");
    expect((await chamar(utc(10))).body).toMatchObject({ relatorio: "enviado" });
  });
});

describe("QA C4/C5 — validação e permissões pelo appRouter", () => {
  const caller = (role: string, permissoes: string[] = [], active = true) =>
    appRouter.createCaller({ user: { id: 1, role, active, permissions: JSON.stringify(permissoes) }, req: {}, res: {} } as never);

  it("salvar aceita só 7..14 (6, 15, 7.5, '8' recusados)", async () => {
    const admin = caller("admin");
    for (const h of [6, 15, 0, 23, 7.5]) await expect(admin.dolores.operacao.salvar({ relatorioHora: h })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin.dolores.operacao.salvar({ relatorioHora: "8" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    for (const h of [7, 14]) expect((await admin.dolores.operacao.salvar({ relatorioHora: h })).config.relatorioHora).toBe(h);
  });

  it("colaborador com todos os módulos não usa o preço sugerido nem vê o status", async () => {
    const c = caller("colaborador", [...ADMIN_MODULES]);
    await expect(c.dolores.operacao.usarPrecoSugerido({ modelo: "claude-haiku-5-5" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await q("SELECT modelo FROM dolores_precos_modelo")).toHaveLength(0);
  });

  it("dolores.status: a previsão nova não traz número completo nem nada de chave", async () => {
    const s = await caller("admin").dolores.status();
    const txt = JSON.stringify({ previsao: s.previsao, limitesPadrao: s.limitesPadrao, teto: s.tetoDonoReais, cot: s.cotacaoSugerida });
    expect(txt).not.toContain(DONO);
    expect(txt).not.toMatch(/sk-ant|apiKey|chave|token/i);
  });

  it("a trava do limite (consumo.ts) e o teste da chave não estão no diff (conferência por arquivo)", () => {
    expect(readFileSync(new URL("./consumo.ts", import.meta.url), "utf8")).not.toContain("EPIC-026");
  });
});
