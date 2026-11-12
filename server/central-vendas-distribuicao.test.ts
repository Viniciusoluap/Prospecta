// Central de Vendas — etapa 4: rodízio entre operadores e SLA de primeira resposta humana (reatribuição).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste", anthropicApiKey: "" } }));

import { getDb } from "./db.js";
import { montarCenario, NUMERO_TESTE, type Cenario } from "./__fixtures__/central-vendas/cenario.js";
import { definirDependencias } from "./central-vendas/base.js";
import { verificarSla } from "./central-vendas/distribuicao.js";
import { receberContato } from "./central-vendas/entrada.js";
import { transferirParaHumano } from "./central-vendas/ia.js";
import { minutosUteisEntre, proximoOperador } from "../shared/central-vendas/regras.js";

let c: Cenario;
const montar = async (config = {}) => { c = await montarCenario(db => vi.mocked(getDb).mockReturnValue(db as never), { config }); };
afterEach(async () => { definirDependencias(); await c?.pg.close(); c = undefined as never; });

describe("regras puras", () => {
  it("rodízio volta ao primeiro e pula o atual na reatribuição", () => {
    expect(proximoOperador([3, 2], null)).toBe(2);
    expect(proximoOperador([2, 3], 2)).toBe(3);
    expect(proximoOperador([2, 3], 3)).toBe(2);
    expect(proximoOperador([2, 3], 3, 3)).toBe(2);
    expect(proximoOperador([2], 2, 2)).toBeNull();
    expect(proximoOperador([], null)).toBeNull();
  });
  it("SLA só conta minutos em horário de atendimento (Fortaleza, seg–sex 8h–18h)", () => {
    const h = { dias: [1, 2, 3, 4, 5], inicio: "08:00", fim: "18:00" };
    // Quinta 17:55 → sexta 08:05 (horário local) = 5 + 5 minutos úteis.
    expect(minutosUteisEntre(new Date("2026-11-12T20:55:00Z"), new Date("2026-11-13T11:05:00Z"), h)).toBe(10);
    // Sábado e domingo não contam: sexta 17:50 → segunda 08:10 = 20.
    expect(minutosUteisEntre(new Date("2026-11-13T20:50:00Z"), new Date("2026-11-16T11:10:00Z"), h)).toBe(20);
    expect(minutosUteisEntre(new Date("2026-11-12T13:00:00Z"), new Date("2026-11-12T13:16:00Z"), h)).toBe(16);
  });
});

describe("distribuição automática", () => {
  beforeEach(() => montar({ operadores: [2, 3, 5], numerosTeste: [NUMERO_TESTE, "5599911110001", "5599911110002"] }));

  it("rodízio entre operadores ativos (inativo fica de fora) e responsável do CRM preenchido", async () => {
    for (const t of [NUMERO_TESTE, "5599911110001", "5599911110002"]) await receberContato({ origem: "whatsapp", telefone: t });
    expect(await c.linhas("SELECT lead_id, operador_id FROM central_vendas_leads ORDER BY lead_id")).toEqual([
      { lead_id: 1, operador_id: 2 }, { lead_id: 2, operador_id: 3 }, { lead_id: 3, operador_id: 2 },
    ]);
    expect(await c.linhas("SELECT responsible_user_id AS r FROM leads ORDER BY id")).toEqual([{ r: 2 }, { r: 3 }, { r: 2 }]);
  });
});

describe("SLA de primeira resposta humana", () => {
  beforeEach(() => montar());
  const transferido = async () => {
    await receberContato({ origem: "whatsapp", telefone: NUMERO_TESTE });
    await transferirParaHumano(1, "pedido_cliente");
  };

  it("estourado (15 min em horário comercial) → reatribui automaticamente, avisa e registra", async () => {
    await transferido();
    c.avancar(10);
    expect(await verificarSla()).toMatchObject({ reatribuidos: 0 });
    c.avancar(6);
    expect(await verificarSla()).toMatchObject({ reatribuidos: 1 });
    expect(await c.linhas("SELECT operador_id FROM central_vendas_leads")).toEqual([{ operador_id: 3 }]);
    expect(await c.linhas("SELECT payload FROM central_vendas_eventos WHERE tipo = 'sla_reatribuido'")).toEqual([{ payload: JSON.stringify({ de: 2, para: 3, slaMinutos: 15 }) }]);
    expect(await c.linhas("SELECT user_id FROM user_notifications WHERE title LIKE '%reatribuído%'")).toEqual([{ user_id: 3 }]);
    // O relógio do SLA recomeça com o novo operador.
    expect(await verificarSla()).toMatchObject({ reatribuidos: 0 });
  });

  it("resposta humana dentro do prazo é registrada e não reatribui (mensagem automática não conta)", async () => {
    await transferido(); // a própria transferência manda uma mensagem automática ao cliente
    c.avancar(5);
    await c.pg.exec(`INSERT INTO whatsapp_messages (connection_id, lead_id, destinatario, mensagem, direcao, created_at) VALUES (1, 1, '99988887777', 'Oi, aqui é a Olga', 'saida', '${c.relogio.agora.toISOString()}')`);
    c.avancar(20);
    expect(await verificarSla()).toMatchObject({ respondidos: 1, reatribuidos: 0 });
    expect((await c.linhas<{ p: string | null }>("SELECT primeira_resposta_humana_em::text AS p FROM central_vendas_leads"))[0].p).not.toBeNull();
  });

  it("sem outro operador: registra o estouro e avisa o admin uma vez", async () => {
    await c.salvarConfig({ operadores: [2] });
    await transferido();
    c.avancar(30);
    await verificarSla();
    await verificarSla();
    expect(await c.linhas("SELECT count(*)::int AS n FROM central_vendas_eventos WHERE tipo = 'sla_estourado'")).toEqual([{ n: 1 }]);
    expect(await c.linhas("SELECT user_id FROM user_notifications WHERE title LIKE '%SLA estourado%'")).toEqual([{ user_id: 1 }]);
  });
});
