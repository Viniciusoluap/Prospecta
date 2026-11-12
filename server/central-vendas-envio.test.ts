// Central de Vendas — etapa 8: proteções de envio (opt-out, janela, limite diário, modo de teste, intervalo),
// fila com reprocessamento sem duplicar, e sequências de follow-up, sem resposta e reativação.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste", anthropicApiKey: "" } }));

import { getDb } from "./db.js";
import { aviso, montarCenario, NUMERO_TESTE, OUTRO_NUMERO, type Cenario } from "./__fixtures__/central-vendas/cenario.js";
import { definirDependencias } from "./central-vendas/base.js";
import { enfileirarTemplate, marcarIncertos, processarFila } from "./central-vendas/envio.js";
import { agendarSequencias } from "./central-vendas/sequencias.js";
import { processarEventoEvolution } from "./whatsapp-evolution-webhook.js";
import { bloqueioEnvio, ehOptOut } from "../shared/central-vendas/regras.js";

let c: Cenario;
let n = 0;
beforeEach(async () => {
  c = await montarCenario(db => vi.mocked(getDb).mockReturnValue(db as never));
  await c.pg.exec(`INSERT INTO leads (name, phone) VALUES ('Ana Souza', '99988887777'), ('Bruno Fora', '99911112222');
    INSERT INTO central_vendas_leads (lead_id, operador_id) VALUES (1, 2), (2, 3);`);
});
afterEach(async () => { definirDependencias(); await c.pg.close(); });
const proativa = (leadId = 1, slug = "cv-reativacao") => enfileirarTemplate({ leadId, slug, chave: `t:${++n}`, proativa: true });
const fila = () => c.linhas<{ status: string; tentativas: number }>("SELECT status, tentativas FROM central_vendas_fila ORDER BY id");

describe("regras puras de envio", () => {
  const base = { ativo: true, optOut: false, modoTeste: false, numerosTeste: [], numero: NUMERO_TESTE, proativa: true, agora: new Date("2026-11-12T13:00:00Z"), janela: { inicio: "08:00", fim: "20:00" }, enviadosHoje: 0, limiteDiario: 20 };
  it("cada proteção bloqueia", () => {
    expect(bloqueioEnvio(base)).toBeNull();
    expect(bloqueioEnvio({ ...base, ativo: false })).toBe("desligado");
    expect(bloqueioEnvio({ ...base, optOut: true })).toBe("opt_out");
    expect(bloqueioEnvio({ ...base, optOut: true, ignorarOptOut: true })).toBeNull();
    expect(bloqueioEnvio({ ...base, modoTeste: true, numerosTeste: [OUTRO_NUMERO] })).toBe("modo_teste");
    expect(bloqueioEnvio({ ...base, agora: new Date("2026-11-12T23:00:00Z") })).toBe("fora_horario"); // 20h
    expect(bloqueioEnvio({ ...base, agora: new Date("2026-11-12T10:59:00Z") })).toBe("fora_horario"); // 7h59
    expect(bloqueioEnvio({ ...base, proativa: false, agora: new Date("2026-11-12T23:00:00Z") })).toBeNull();
    expect(bloqueioEnvio({ ...base, enviadosHoje: 20 })).toBe("limite_diario");
    expect(["SAIR", "parar", " Sair! ", "PARAR."].every(ehOptOut)).toBe(true);
    expect(ehOptOut("quero sair do aluguel")).toBe(false);
  });
});

describe("proteções na fila", () => {
  it("opt-out por SAIR: confirma uma vez, cancela pendentes e bloqueia os próximos", async () => {
    c.relogio.agora = new Date("2026-11-12T23:30:00Z"); // 20h30: a proativa fica pendente
    await proativa();
    await processarEventoEvolution(aviso("S1", NUMERO_TESTE, "SAIR"));
    await processarEventoEvolution(aviso("S2", NUMERO_TESTE, "SAIR"));
    expect(c.envios.map(e => e.texto)).toEqual(["Pronto, Ana. Você não receberá mais mensagens automáticas. Se precisar, é só chamar."]);
    expect(await c.linhas("SELECT opt_out FROM central_vendas_leads WHERE lead_id = 1")).toEqual([{ opt_out: true }]);
    expect((await fila())[0].status).toBe("descartado");
    c.relogio.agora = new Date("2026-11-13T13:00:00Z");
    await proativa();
    await processarFila();
    expect(c.envios).toHaveLength(1);
    expect(await c.linhas("SELECT count(*)::int AS n FROM central_vendas_eventos WHERE tipo = 'envio_bloqueado'")).toEqual([{ n: 1 }]);
  });

  it("fora da janela adia para 8h; modo de teste descarta número fora da lista", async () => {
    c.relogio.agora = new Date("2026-11-12T23:30:00Z");
    await proativa();
    await processarFila();
    expect(c.envios).toHaveLength(0);
    const [{ quando }] = await c.linhas<{ quando: string }>("SELECT proxima_tentativa_em::text AS quando FROM central_vendas_fila");
    expect(quando.startsWith("2026-11-13 11:")).toBe(true); // 8h–8h30 em Fortaleza
    c.relogio.agora = new Date("2026-11-13T11:40:00Z");
    await processarFila();
    expect(c.envios).toHaveLength(1);
    await proativa(2);
    await processarFila();
    expect(c.envios).toHaveLength(1);
    expect((await fila()).at(-1)!.status).toBe("descartado");
  });

  it("limite diário por número e intervalo aleatório entre envios", async () => {
    await c.salvarConfig({ limiteDiarioPorNumero: 2 });
    for (let i = 0; i < 3; i++) await proativa();
    await processarFila();
    expect(c.envios).toHaveLength(2);
    expect(c.dormidas).toEqual([15_000]); // só entre o 1º e o 2º envio (o 3º, bloqueado, não espera): 10 s + 0,5 × (20 − 10) s
    expect((await fila()).map(f => f.status)).toEqual(["concluido", "concluido", "pendente"]);
    c.avancar(24 * 60);
    await processarFila();
    expect(c.envios).toHaveLength(3);
  });

  it("falha de envio vai para a fila e é reprocessada sem duplicar", async () => {
    c.falharProximos(1);
    await proativa();
    await processarFila();
    expect(await fila()).toEqual([{ status: "pendente", tentativas: 1 }]);
    c.avancar(1);
    await processarFila();
    await processarFila();
    expect(c.envios).toHaveLength(1);
    expect(await fila()).toEqual([{ status: "concluido", tentativas: 2 }]);
    expect(await c.linhas("SELECT count(*)::int AS n FROM whatsapp_messages WHERE direcao = 'saida'")).toEqual([{ n: 1 }]);
  });

  it("após 5 falhas para, avisa o admin; queda no meio do envio vira 'incerto' e não reenvia", async () => {
    c.falharProximos(99);
    await proativa();
    for (let i = 0; i < 8; i++) { await processarFila(); c.avancar(20); }
    expect(await fila()).toEqual([{ status: "falhou", tentativas: 5 }]);
    expect(await c.linhas("SELECT user_id FROM user_notifications WHERE title LIKE '%falha%'")).toEqual([{ user_id: 1 }]);
    c.falharProximos(0);
    await proativa();
    await c.pg.exec(`UPDATE central_vendas_fila SET status = 'processando', updated_at = '${new Date(c.relogio.agora.getTime() - 11 * 60_000).toISOString()}' WHERE id = 2`);
    expect(await marcarIncertos()).toBe(1);
    await processarFila();
    expect(c.envios).toHaveLength(0);
    expect((await fila())[1].status).toBe("incerto");
  });
});

describe("sequências", () => {
  it("follow-up após aprovação: um passo por vez, sem repetir", async () => {
    await c.pg.exec(`INSERT INTO central_vendas_sequencias (tipo, nome, passos) VALUES ('followup_aprovado', 'Pós-aprovação', '[{"aposDias":1,"templateSlug":"cv-followup-aprovado"},{"aposDias":3,"templateSlug":"cv-followup-aprovado"}]');
      UPDATE central_vendas_leads SET status_analise = 'aprovado', decisao_por = 1, decisao_em = '${c.relogio.agora.toISOString()}' WHERE lead_id = 1;`);
    expect(await agendarSequencias()).toBe(0);
    c.avancar(24 * 60);
    expect(await agendarSequencias()).toBe(1);
    expect(await agendarSequencias()).toBe(0);
    c.avancar(2 * 24 * 60);
    expect(await agendarSequencias()).toBe(1);
    await processarFila();
    expect(c.envios.map(e => e.texto)).toEqual([expect.stringContaining("próximos passos"), expect.stringContaining("próximos passos")]);
  });

  it("sem resposta e reativação 30/60/90 dias; desligada, não agenda", async () => {
    const t0 = c.relogio.agora.toISOString();
    await c.pg.exec(`INSERT INTO central_vendas_sequencias (tipo, nome, passos) VALUES
        ('sem_resposta', 'Sem resposta', '[{"aposDias":1,"templateSlug":"cv-sem-resposta"}]'),
        ('reativacao', 'Reativação', '[{"aposDias":30,"templateSlug":"cv-reativacao"},{"aposDias":60,"templateSlug":"cv-reativacao"},{"aposDias":90,"templateSlug":"cv-reativacao"}]');
      UPDATE central_vendas_leads SET status_atendimento = 'aguardando_cliente', ultima_mensagem_cliente_em = '${t0}', ultima_mensagem_enviada_em = '${new Date(c.relogio.agora.getTime() + 60_000).toISOString()}' WHERE lead_id = 1;`);
    c.avancar(24 * 60 + 2);
    expect(await agendarSequencias()).toBe(1);
    expect(await c.linhas("SELECT status_atendimento FROM central_vendas_leads WHERE lead_id = 1")).toEqual([{ status_atendimento: "sem_resposta" }]);
    c.avancar(30 * 24 * 60);
    expect(await agendarSequencias()).toBe(2); // reativação D+30 da Ana e do Bruno (entrou há 31 dias, nunca escreveu)
    expect(await agendarSequencias()).toBe(0);
    await c.salvarConfig({ automacoes: { ia: true, documentos: true, lembretes: true, followup: true, reativacao: false } });
    c.avancar(30 * 24 * 60);
    expect(await agendarSequencias()).toBe(0);
  });
});
