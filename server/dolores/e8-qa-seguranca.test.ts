// EPIC-025 (Dolores, etapa 8) — testes de PROVA do portão de QA de segurança (Quinn). Não mudam código de produção.
// Banco em memória (PGlite); modelo e envio falsos: nada sai para a rede.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { custoDoUso } from "../../shared/dolores/custo.js";
import { partesDaResposta } from "../../shared/dolores/whatsapp.js";
import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { definirClienteModelo, type PedidoModelo, type RespostaModelo } from "./cerebro.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte, executarFuncao } from "./ponte.js";
import { definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";

const DONO = "5599991234567";
const HAIKU = "claude-haiku-5-5";
const REAL = { entrada: 13_068, saida: 4_413, cacheEscrita: 37_860, cacheLeitura: 50_480 };

describe("QA item 9 — conta do custo com os preços reais do Haiku 5.5", () => {
  it("0,10 / 0,50 / 0,125 / 0,01 US$ por milhão → US$ 0,00875 (≈ 0,0088): a fórmula está certa", () => {
    const c = custoDoUso(REAL, { entrada: 0.1, saida: 0.5, cacheEscrita: 0.125, cacheLeitura: 0.01 })!;
    expect(c.valor).toBeCloseTo(0.0087506, 7);
    // os fatores padrão (1,25× e 0,1× da entrada) dão o mesmo número com só entrada/saída informadas
    expect(custoDoUso(REAL, { entrada: 0.1, saida: 0.5, cacheEscrita: null, cacheLeitura: null })!.valor).toBeCloseTo(0.0087506, 7);
    // o "0,0875" do teste do dev vem do PREÇO usado no teste (1 / 5), 10× o do Haiku 5.5 — não de erro de fórmula
    expect(custoDoUso(REAL, { entrada: 1, saida: 5, cacheEscrita: null, cacheLeitura: null })!.valor).toBeCloseTo(0.087506, 6);
  });
});

describe("QA item 1 — partes da resposta", () => {
  it("os quadros do sistema (feito/fila) vão SEMPRE na ÚLTIMA parte", () => {
    const texto = Array.from({ length: 200 }, (_, i) => `- ${i + 1}. Cliente ${i + 1} — ${i} d`).join("\n");
    const partes = partesDaResposta(texto, "*Feito por este pedido*\n- tarefa criada [QUADRO]");
    expect(partes.length).toBeGreaterThan(1);
    expect(partes.slice(0, -1).some(p => p.includes("[QUADRO]"))).toBe(false);
    expect(partes.at(-1)).toContain("[QUADRO]");
  });

  it("o texto do modelo pode forjar a numeração '(3/3)' no meio da 1ª mensagem (só cosmético)", () => {
    const texto = `Resumo curto.\n(3/3)\nFim da resposta.\n${"x ".repeat(2500)}`;
    const partes = partesDaResposta(texto);
    expect(partes[0].startsWith("(1/")).toBe(true);
    expect(partes[0]).toContain("\n(3/3)\n");
  });
});

// ── Banco em memória ─────────────────────────────────────────────────────────────────────────────────────────────────────
let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviar: ReturnType<typeof vi.fn>;
let pedidos: PedidoModelo[];
let roteiro: Array<(p: PedidoModelo) => RespostaModelo>;
let relogio = 0;
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
let seq = 0;
const aviso = (texto: string) => ({
  event: "messages.upsert", instance: "prospecta-dolores",
  data: { key: { remoteJid: `${DONO}@s.whatsapp.net`, fromMe: false, id: `QA8-${++seq}` }, message: { conversation: texto }, messageTimestamp: Math.floor((AGORA.getTime() - 30_000) / 1000) },
});
const chamar = (body: unknown) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, body, ip: "203.0.113.9" } as never);
const uso = { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}', ia_ligada = true,
    limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  esquecerUsuarioDolores();
  definirDependenciasPonte({ agora: () => AGORA });
  relogio = 1_000_000;
  enviar = vi.fn(async () => true);
  definirDependenciasWhatsapp({ agora: () => AGORA, enviar: enviar as never, ms: () => relogio });
  vi.mocked(configuracaoAnthropicPainel).mockResolvedValue({ apiKey: "sk-ant-teste-nao-real-123456", modelo: HAIKU });
  pedidos = [];
  roteiro = [];
  definirClienteModelo(async p => {
    pedidos.push(JSON.parse(JSON.stringify(p)));
    const passo = roteiro.shift();
    if (!passo) throw new Error("roteiro do modelo acabou");
    return passo(p);
  });
});
afterEach(() => {
  ENV.cookieSecret = segredoAntes;
  definirDependenciasPonte();
  definirDependenciasWhatsapp();
  definirClienteModelo();
  vi.restoreAllMocks();
});

describe("QA item 1 — envio em várias mensagens", () => {
  it("segredo PARTIDO na fronteira entre duas mensagens não escapa (o texto inteiro é filtrado antes de dividir)", async () => {
    // a linha da senha fica exatamente sobre o ponto de corte da 1ª parte (sem quebra de linha antes → corte em espaço/rígido)
    const texto = `${"a".repeat(3790)} senha: Zq9TopSecret77 ${"b ".repeat(1500)}`;
    roteiro = [() => ({ stop_reason: "end_turn", usage: uso, content: [{ type: "text", text: texto }] })];
    await chamar(aviso("Dolores, liste tudo"));
    const enviados = enviar.mock.calls.map(c => c[0].texto as string);
    expect(enviados.length).toBeGreaterThan(1);
    const tudo = enviados.join("");
    expect(tudo).not.toMatch(/Zq9TopSecret77|Zq9Top|Secret77/);
    expect(enviar.mock.calls.every(c => c[0].numero === DONO)).toBe(true);
  });

  it("reentrega do MESMO aviso do webhook não reenvia as mensagens", async () => {
    const longa = Array.from({ length: 160 }, (_, i) => `- ${i + 1}. Cliente ${i + 1} — ${i} d`).join("\n");
    roteiro = [() => ({ stop_reason: "end_turn", usage: uso, content: [{ type: "text", text: longa }] })];
    const a = aviso("Dolores, liste tudo");
    await chamar(a);
    const n = enviar.mock.calls.length;
    expect(n).toBeGreaterThan(1);
    await chamar(a);
    expect(enviar.mock.calls.length).toBe(n);
    expect(pedidos).toHaveLength(1);
  });

  it("ACHADO: sem tempo depois da 1ª mensagem, as seguintes (onde ficam os quadros do sistema) não saem", async () => {
    const longa = Array.from({ length: 160 }, (_, i) => `- ${i + 1}. Cliente ${i + 1} — ${i} d`).join("\n");
    roteiro = [() => ({ stop_reason: "end_turn", usage: uso, content: [{ type: "text", text: longa }] })];
    // o 1º envio demora até restar menos que MINIMO_PARA_ENVIAR_MS do prazo do aviso
    enviar.mockImplementationOnce(async () => { relogio += 44_000; return true; });
    const r = await chamar(aviso("Dolores, liste tudo"));
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar.mock.calls[0][0].texto).toMatch(/^\(1\/\d\)\n/);
    expect(r.body.r).toEqual({ "erro-envio": 1 });
    const erros = await q<any>("SELECT motivo FROM dolores_acoes WHERE funcao = 'whatsapp_resposta' AND resultado = 'erro'");
    expect(erros[0].motivo).toMatch(/sem tempo/);
  });
});

describe("QA item 2 — parcial em max_tokens", () => {
  it("ACHADO: texto parcial que AFIRMA a ação, com a ação cortada: nada é executado, mas o dono não lê 'nada foi alterado'", async () => {
    roteiro = [() => ({ stop_reason: "max_tokens", usage: { ...uso, output_tokens: 5000 }, content: [
      { type: "text", text: "Pronto, criei a tarefa para ligar para a Maria amanhã." },
      { type: "tool_use", id: "tu_cortado", name: "criar_tarefa", input: {} },
    ] })];
    await chamar(aviso("Dolores, crie uma tarefa para ligar para a Maria amanhã"));
    expect(pedidos).toHaveLength(1);
    expect(await q("SELECT id FROM dolores_acoes WHERE funcao = 'criar_tarefa'")).toEqual([]);
    expect(await q("SELECT id FROM dolores_autoria")).toEqual([]);
    const texto = enviar.mock.calls[0][0].texto as string;
    expect(texto).toContain("criei a tarefa");
    expect(texto).not.toMatch(/Nada foi alterado/);
    expect(texto).not.toMatch(/não foi executad/);
  });

  it("max_tokens sem texto na ÚLTIMA volta: no máximo 1 chamada extra (MAX_VOLTAS + 1), sem ferramentas", async () => {
    const ferr = (i: number): RespostaModelo => ({ stop_reason: "tool_use", usage: uso, content: [{ type: "tool_use", id: `tu_${i}`, name: "listar_atrasos", input: { modulo: "crm" } }] });
    roteiro = [0, 1, 2, 3, 4].map(i => () => ferr(i));
    roteiro.push(() => ({ stop_reason: "max_tokens", usage: uso, content: [{ type: "tool_use", id: "tu_x", name: "listar_atrasos", input: {} }] }));
    roteiro.push(() => ({ stop_reason: "max_tokens", usage: uso, content: [] }));
    roteiro.push(() => { throw new Error("chamada a mais"); });
    await chamar(aviso("Dolores, quais atrasos?"));
    expect(pedidos).toHaveLength(7);
    expect(pedidos[6].semFerramentas).toBe(true);
    expect(pedidos.every(p => p.maxTokens <= 5000)).toBe(true);
  });
});

describe("QA item 5 — plano_de_atrasos pela porta da ponte", () => {
  const exec = (argumentos: Record<string, unknown>, canal: "whatsapp" | "ponte" = "whatsapp") =>
    executarFuncao({ funcao: "plano_de_atrasos", argumentos, pedidoId: `qa8-${++seq}` }, { canal } as never);

  it("data-limite absurda, inexistente ou no passado é recusada; campo extra é recusado", async () => {
    for (const dataLimite of ["9999-12-31", "2026-02-30", "2020-01-01", "2026-13-01"]) {
      const r = await exec({ dataLimite });
      expect(JSON.stringify(r.body), dataLimite).toMatch(/inválid|anterior|passa de|erro/i);
      expect(JSON.stringify(r.body)).not.toMatch(/"dias":\[\{/);
    }
    const extra = await exec({ modulo: "crm", sql: "DROP TABLE users" });
    expect(extra.body.ok).toBe(false);
  });
});
