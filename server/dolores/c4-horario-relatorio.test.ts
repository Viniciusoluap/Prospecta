// EPIC-026 C4 — hora do relatório diário entre 07:00 e 14:00 (Brasília). O cron chama a rotina de hora em hora (uma entrada
// diária por hora no vercel.json); a ronda do dia sai uma vez, o relatório sai UMA vez, na primeira chamada na hora escolhida
// ou depois; hora antiga (0 a 6) vale 07. PGlite; o envio pela Evolution é falso.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));

import {
  CAMINHOS_CRON_DOLORES, CRON_DOLORES_AGENDAS, HORAS_DO_RELATORIO, HORA_PADRAO_RELATORIO, horaDoRelatorio, relatorioDiarioNaHora, relogioBrasilia,
} from "../../shared/dolores/operacao.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { appRouter } from "../routers.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte } from "./ponte.js";
import { definirRelogioCron, tratarCronDolores } from "./rondas.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";
import { definirDependenciasWhatsapp } from "./whatsapp.js";

const SEGREDO_CRON = "segredo-do-cron-de-teste-c4-0123456789";
const DONO = "5599991234567";
const DIA = "2026-11-17";
/** Instante de uma chamada do cron: hora UTC do dia de teste, 5 min depois (no Hobby a Vercel chama dentro da hora). */
const utc = (horaUtc: number, minuto = 5, dia = DIA) => new Date(`${dia}T${String(horaUtc).padStart(2, "0")}:${String(minuto).padStart(2, "0")}:00Z`);

let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviar: ReturnType<typeof vi.fn>;
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
// O relógio de parede (ms) anda junto com o relógio simulado: a ronda gravada (criado_em = hora real do banco) "envelhece"
// entre chamadas de horas diferentes, como em produção (regra dos 5 min da ronda recente).
// A base é a primeira hora simulada do teste (zerada a cada teste).
let baseMs: number | null = null;
const chamar = async (quando: Date) => {
  baseMs ??= quando.getTime();
  const desvio = quando.getTime() - baseMs;
  definirRelogioCron({ agora: () => quando, ms: () => Date.now() + desvio });
  return tratarCronDolores({ headers: { authorization: `Bearer ${SEGREDO_CRON}` }, query: { hora: "03" }, params: { hora: "03" } } as never);
};
const ligar = (hora: number) => banco.pg.exec(`UPDATE dolores_operacao_config SET rondas_ligadas = true, relatorio_ligado = true, relatorio_hora = ${hora}`);

beforeEach(async () => {
  baseMs = null;
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}',
    limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;`);
  vi.stubEnv("CRON_SECRET", SEGREDO_CRON);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-c4-0123456789";
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

describe("C4 — lista única de horas e agendamento", () => {
  it("horas 07 a 14; valor antigo (0 a 6), fora da lista ou inválido vale 07", () => {
    expect([...HORAS_DO_RELATORIO]).toEqual([7, 8, 9, 10, 11, 12, 13, 14]);
    expect(HORA_PADRAO_RELATORIO).toBe(7);
    for (const h of HORAS_DO_RELATORIO) expect(horaDoRelatorio(h)).toBe(h);
    for (const h of [0, 1, 2, 3, 4, 5, 6, 15, 23, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(horaDoRelatorio(h)).toBe(7);
    expect(horaDoRelatorio(9.7)).toBe(9);
  });

  it("o vercel.json tem exatamente as 8 entradas da constante, cada uma UMA vez por dia (sem faixa de horas), em caminhos distintos", () => {
    const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as { crons: Array<{ path: string; schedule: string }> };
    const daDolores = vercel.crons.filter(c => c.path === "/api/cron/dolores" || c.path.startsWith("/api/cron/dolores/"));
    expect(daDolores).toEqual(CRON_DOLORES_AGENDAS.map(a => ({ path: a.path, schedule: a.schedule })));
    expect(daDolores.map(c => c.schedule)).toEqual(["0 10 * * *", "0 11 * * *", "0 12 * * *", "0 13 * * *", "0 14 * * *", "0 15 * * *", "0 16 * * *", "0 17 * * *"]);
    for (const c of vercel.crons) expect(c.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/); // diário: minuto e hora fixos
    expect(new Set(vercel.crons.map(c => c.path)).size).toBe(vercel.crons.length);
    // cada agenda (UTC) cai na hora de Brasília da sua entrada
    for (const a of CRON_DOLORES_AGENDAS) expect(relogioBrasilia(utc(Number(a.schedule.split(" ")[1]))).hora).toBe(a.horaBrasilia);
  });

  it("a rota da Vercel atende todos os caminhos com a mesma rotina (o fim do caminho não é lido)", () => {
    const api = readFileSync(new URL("../../api/index.ts", import.meta.url), "utf8");
    expect(api).toContain("app.get([...CAMINHOS_CRON_DOLORES]");
    expect(CAMINHOS_CRON_DOLORES).toHaveLength(8);
    const rondas = readFileSync(new URL("./rondas.ts", import.meta.url), "utf8");
    const corpo = rondas.slice(rondas.indexOf("export async function tratarCronDolores"), rondas.indexOf("export async function historicoParaTela"));
    expect(corpo).not.toMatch(/req\.(query|params|body|path|url|originalUrl)/);
  });

  it("fuso: Brasília é UTC−3 e o dia vira às 03:00 UTC", () => {
    expect(relogioBrasilia(new Date("2026-11-18T02:59:00Z"))).toMatchObject({ dia: "2026-11-17", hora: 23 });
    expect(relogioBrasilia(new Date("2026-11-18T03:00:00Z"))).toMatchObject({ dia: "2026-11-18", hora: 0 });
    expect(relatorioDiarioNaHora(utc(12, 59), 10)).toBe(false); // 09:59 em Brasília
    expect(relatorioDiarioNaHora(utc(13, 0), 10)).toBe(true); // 10:00 em Brasília
  });
});

describe("C4 — cada hora de 07 a 14 envia UMA vez (o dia inteiro de chamadas, com reentrega)", () => {
  it.each([7, 8, 9, 10, 11, 12, 13, 14])("hora escolhida %i:00", async hora => {
    await ligar(hora);
    const resultados: Array<{ horaBrasilia: number; relatorio: unknown; ronda: unknown }> = [];
    for (const a of CRON_DOLORES_AGENDAS) {
      const h = Number(a.schedule.split(" ")[1]);
      for (const minuto of [5, 6]) { // a Vercel pode reentregar a mesma chamada
        const r = await chamar(utc(h, minuto));
        expect(r.status).toBe(200);
        resultados.push({ horaBrasilia: a.horaBrasilia, relatorio: r.body.relatorio, ronda: r.body.ronda });
      }
    }
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar.mock.calls[0][0]).toMatchObject({ numero: DONO });
    const enviados = resultados.filter(r => r.relatorio === "enviado");
    expect(enviados).toEqual([{ horaBrasilia: hora, relatorio: "enviado", ronda: hora === 7 ? "feita" : "ja-feita" }]);
    expect(resultados.filter(r => r.horaBrasilia < hora).every(r => r.relatorio === "fora-da-hora")).toBe(true);
    expect(resultados.filter(r => r.ronda === "feita")).toHaveLength(1); // a ronda diária, uma vez
    const relatorios = await q<any>("SELECT janela, ronda_id FROM dolores_relatorios");
    expect(relatorios).toEqual([expect.objectContaining({ janela: `diario:${DIA}` })]);
    const rondas = await q<any>("SELECT id, janela FROM dolores_rondas ORDER BY id");
    // hora depois da ronda da manhã: a ronda é refeita UMA vez na hora do relatório, e o relatório usa a refeita
    expect(rondas.map(r => r.janela)).toEqual(hora === 7 ? [`diaria:${DIA}`] : [`diaria:${DIA}`, `relatorio:${DIA}`]);
    expect(relatorios[0].ronda_id).toBe(rondas[rondas.length - 1].id);
    expect(enviar.mock.calls[0][0].texto).toContain(`às ${String(hora).padStart(2, "0")}:`);
  });
});

describe("C4 — falhas, hora antiga e virada do dia", () => {
  it("a chamada da hora escolhida não chegou: a seguinte envia (uma vez só)", async () => {
    await ligar(10);
    expect((await chamar(utc(10))).body).toMatchObject({ ronda: "feita", relatorio: "fora-da-hora" });
    // a das 10:00 de Brasília (13 UTC) não aconteceu
    expect((await chamar(utc(14))).body).toMatchObject({ ronda: "ja-feita", relatorio: "enviado" });
    expect((await chamar(utc(15))).body).toMatchObject({ relatorio: "ja_enviado" });
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it("nenhuma chamada antes da hora: a primeira do dia faz a ronda e já usa ela no relatório (sem segunda ronda)", async () => {
    await ligar(8);
    expect((await chamar(utc(12))).body).toMatchObject({ ronda: "feita", relatorio: "enviado" });
    expect((await q<any>("SELECT janela FROM dolores_rondas")).map(r => r.janela)).toEqual([`diaria:${DIA}`]);
  });

  it("hora antiga gravada no banco (03:00) vale 07:00: sai na chamada das 07:00", async () => {
    await ligar(3);
    expect((await chamar(utc(10))).body).toMatchObject({ relatorio: "enviado" });
    expect((await appRouter.createCaller({ user: { id: 1, role: "admin", active: true, permissions: "[]" }, req: {}, res: {} } as never)
      .dolores.operacao.situacao()).config.relatorioHora).toBe(7);
  });

  it("virada do dia: chamada às 23:30 de Brasília não repete; no dia seguinte sai um relatório novo", async () => {
    await ligar(14);
    await chamar(utc(17));
    expect((await chamar(new Date("2026-11-18T02:30:00Z"))).body).toMatchObject({ ronda: "ja-feita", relatorio: "ja_enviado" });
    expect((await chamar(utc(10, 5, "2026-11-18"))).body).toMatchObject({ ronda: "feita", relatorio: "fora-da-hora" });
    expect((await chamar(utc(17, 5, "2026-11-18"))).body).toMatchObject({ relatorio: "enviado" });
    expect((await q<any>("SELECT janela FROM dolores_relatorios ORDER BY id")).map(r => r.janela)).toEqual(["diario:2026-11-17", "diario:2026-11-18"]);
    expect(enviar).toHaveBeenCalledTimes(2);
  });
});
