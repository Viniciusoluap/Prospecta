// EPIC-024 S-10: Anthropic em Admin › Integrações — só cadastro. Cliente da Anthropic simulado: nada externo é chamado.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createIntegracoesRouter, type IntegracoesDeps } from "./integracoes-router";
import {
  CHAVE_MODELO_ANTHROPIC_PAINEL, CHAVE_SEGREDO_ANTHROPIC_PAINEL, configuracaoAnthropicPainel, familiaDoModelo,
  mascararChaveAnthropic, type AnthropicPainelDeps, type ClienteModelos,
} from "./_core/anthropic-painel";
import { decryptSecret, encryptSecret } from "./_core/secret-vault";
import { ENV } from "./_core/env";

const CHAVE = "sk-ant-api03-chave-de-teste-0000000000wxyz";
const CHAVE_NOVA = "sk-ant-api03-outra-chave-1111111111abcd";
const MODELOS = [
  { id: "claude-opus-5-5", display_name: "Claude Opus 5.5", created_at: "2026-10-01T00:00:00Z" },
  { id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5", created_at: "2026-10-01T00:00:00Z" },
  { id: "claude-haiku-5", display_name: "Claude Haiku 5", created_at: "2026-09-01T00:00:00Z" },
  { id: "claude-fable-1", display_name: "Claude Fable 1", created_at: "2026-08-01T00:00:00Z" },
];

const ctx = (role: "admin" | "colaborador" | "user") =>
  ({ user: { id: 1, role, active: true, permissions: JSON.stringify(["bpo", "whatsapp"]) }, req: {}, res: {} }) as never;

function clienteFalso(aceitas: string[]) {
  const chamadas: string[] = [];
  const criarCliente = vi.fn((apiKey: string): ClienteModelos => ({
    models: {
      list: () => ({
        async *[Symbol.asyncIterator]() {
          chamadas.push(apiKey);
          if (!aceitas.includes(apiKey)) throw Object.assign(new Error(`401 invalid x-api-key ${apiKey}`), { status: 401 });
          for (const m of MODELOS) yield m;
        },
      }),
    },
  }));
  return { criarCliente, chamadas };
}

function setup(aceitas = [CHAVE, CHAVE_NOVA], role: "admin" | "colaborador" | "user" = "admin") {
  const banco = new Map<string, string>();
  const { criarCliente, chamadas } = clienteFalso(aceitas);
  const anthropic: AnthropicPainelDeps = {
    lerBanco: async k => banco.get(k),
    gravarBanco: async (k, v) => { banco.set(k, v); },
    criarCliente, encrypt: encryptSecret, decrypt: decryptSecret,
  };
  const deps = { fetchImpl: vi.fn(), anthropic } as unknown as IntegracoesDeps;
  return { banco, anthropic, criarCliente, chamadas, caller: createIntegracoesRouter(deps).createCaller(ctx(role)) };
}

beforeEach(() => { ENV.cookieSecret = "segredo-de-teste-do-cofre"; });

describe("Anthropic — chave protegida", () => {
  it("testa antes de salvar, grava criptografada e nenhuma rota devolve a chave (só os 4 últimos)", async () => {
    const s = setup();
    const r = await s.caller.salvarAnthropic({ apiKey: `  ${CHAVE}  ` });
    expect(r.modelos).toBe(4);
    expect(s.chamadas).toEqual([CHAVE]);
    const gravado = s.banco.get(CHAVE_SEGREDO_ANTHROPIC_PAINEL)!;
    expect(gravado).not.toContain("sk-ant");
    expect(decryptSecret(gravado)).toBe(CHAVE);

    const status = await s.caller.statusAnthropic();
    expect(status).toEqual({ configurado: true, final: "…wxyz", modeloPreferencial: null, ativa: false });
    const respostas = [r, status, await s.caller.testarAnthropic(), await s.caller.modelosAnthropic(),
      await s.caller.salvarModeloAnthropic({ modelo: "claude-opus-5-5" })];
    for (const resp of respostas) expect(JSON.stringify(resp)).not.toContain(CHAVE);
  });

  it("chave recusada não é salva e a mensagem não mostra a chave", async () => {
    const s = setup([]);
    const erro = await s.caller.salvarAnthropic({ apiKey: CHAVE }).catch(e => e);
    expect(erro).toMatchObject({ code: "BAD_REQUEST" });
    expect(erro.message).toContain("HTTP 401");
    expect(erro.message).not.toContain(CHAVE);
    expect(s.banco.has(CHAVE_SEGREDO_ANTHROPIC_PAINEL)).toBe(false);
  });

  it("formato inválido nem chega à Anthropic", async () => {
    const s = setup();
    await expect(s.caller.salvarAnthropic({ apiKey: "sk-ant curta" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(s.criarCliente).not.toHaveBeenCalled();
  });

  it("trocar substitui a chave; remover apaga chave e preferência", async () => {
    const s = setup();
    await s.caller.salvarAnthropic({ apiKey: CHAVE });
    await s.caller.salvarModeloAnthropic({ modelo: "claude-sonnet-5-5" });
    await s.caller.salvarAnthropic({ apiKey: CHAVE_NOVA });
    expect(decryptSecret(s.banco.get(CHAVE_SEGREDO_ANTHROPIC_PAINEL)!)).toBe(CHAVE_NOVA);
    expect((await s.caller.statusAnthropic()).final).toBe("…abcd");
    await s.caller.removerAnthropic();
    expect(await s.caller.statusAnthropic()).toEqual({ configurado: false, final: null, modeloPreferencial: null, ativa: false });
    expect(await configuracaoAnthropicPainel(s.anthropic)).toBeNull();
  });

  it("testar sem chave salva não chama a Anthropic", async () => {
    const s = setup();
    expect(await s.caller.testarAnthropic()).toEqual({ ok: false, mensagem: "Nenhuma chave da Anthropic salva." });
    expect(s.criarCliente).not.toHaveBeenCalled();
  });

  it("teste de conexão com a chave salva e revogada mostra o erro mascarado", async () => {
    const s = setup();
    await s.caller.salvarAnthropic({ apiKey: CHAVE });
    const s2 = setup([]);
    s2.banco.set(CHAVE_SEGREDO_ANTHROPIC_PAINEL, s.banco.get(CHAVE_SEGREDO_ANTHROPIC_PAINEL)!);
    const r = await s2.caller.testarAnthropic();
    expect(r.ok).toBe(false);
    expect(r.mensagem).not.toContain(CHAVE);
  });

  it("mascararChaveAnthropic", () => {
    expect(mascararChaveAnthropic(`falhou com ${CHAVE}.`)).toBe("falhou com sk-ant-….");
  });
});

describe("Anthropic — modelos e preferência", () => {
  it("lista os modelos devolvidos pela API, com nome e id oficiais e a família", async () => {
    const s = setup();
    await s.caller.salvarAnthropic({ apiKey: CHAVE });
    const modelos = await s.caller.modelosAnthropic();
    expect(modelos.map(m => [m.id, m.nome, m.familia])).toEqual([
      ["claude-opus-5-5", "Claude Opus 5.5", "opus"],
      ["claude-sonnet-5-5", "Claude Sonnet 5.5", "sonnet"],
      ["claude-haiku-5", "Claude Haiku 5", "haiku"],
      ["claude-fable-1", "Claude Fable 1", "fable"],
    ]);
    expect(familiaDoModelo("claude-x-1")).toBe("outro");
  });

  it("preferência validada contra os ids listados e trocável depois", async () => {
    const s = setup();
    await expect(s.caller.salvarModeloAnthropic({ modelo: "claude-opus-5-5" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await s.caller.salvarAnthropic({ apiKey: CHAVE });
    await expect(s.caller.salvarModeloAnthropic({ modelo: "claude-inexistente" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(s.banco.get(CHAVE_MODELO_ANTHROPIC_PAINEL)).toBeUndefined();
    await s.caller.salvarModeloAnthropic({ modelo: "claude-opus-5-5" });
    await s.caller.salvarModeloAnthropic({ modelo: "claude-haiku-5" });
    expect((await s.caller.statusAnthropic()).modeloPreferencial).toBe("claude-haiku-5");
    expect(await configuracaoAnthropicPainel(s.anthropic)).toEqual({ apiKey: CHAVE, modelo: "claude-haiku-5" });
  });
});

describe("Anthropic — acesso e isolamento", () => {
  it("só o admin acessa", async () => {
    for (const role of ["colaborador", "user"] as const) {
      const s = setup(undefined, role);
      await expect(s.caller.statusAnthropic()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(s.caller.salvarAnthropic({ apiKey: CHAVE })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(s.caller.testarAnthropic()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(s.caller.modelosAnthropic()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(s.caller.salvarModeloAnthropic({ modelo: "claude-opus-5-5" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(s.caller.removerAnthropic()).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(s.criarCliente).not.toHaveBeenCalled();
    }
  });

  it("salvar a chave do painel NÃO muda ENV.anthropicApiKey nem os modelos das funções", async () => {
    const antes = { chave: ENV.anthropicApiKey, modelo: ENV.incorporacaoIaModelo };
    const s = setup();
    await s.caller.salvarAnthropic({ apiKey: CHAVE });
    await s.caller.salvarModeloAnthropic({ modelo: "claude-haiku-5" });
    await s.caller.testarAnthropic();
    expect(ENV.anthropicApiKey).toBe(antes.chave);
    expect(ENV.anthropicApiKey).not.toBe(CHAVE);
    expect(ENV.incorporacaoIaModelo).toBe(antes.modelo);
  });

  it("nenhum código operacional importa a chave do painel (ainda não é usada por nenhuma função)", () => {
    const raiz = path.resolve(import.meta.dirname);
    const permitidos = new Set(["integracoes-router.ts", path.join("_core", "anthropic-painel.ts")]);
    const usam: string[] = [];
    const varrer = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const p = path.join(dir, nome);
        if (statSync(p).isDirectory()) { if (nome !== "node_modules") varrer(p); continue; }
        if (!p.endsWith(".ts") || p.endsWith(".test.ts")) continue;
        const rel = path.relative(raiz, p);
        if (!permitidos.has(rel) && readFileSync(p, "utf8").includes("anthropic-painel")) usam.push(rel);
      }
    };
    varrer(raiz);
    expect(usam).toEqual([]);
  });
});
