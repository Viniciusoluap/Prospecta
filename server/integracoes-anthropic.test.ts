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
const CHAVE_RESTRITA = "sk-ant-api03-chave-restrita-22222222hhhh";
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
          // a chave "restrita" só oferece o Haiku
          for (const m of apiKey === CHAVE_RESTRITA ? MODELOS.filter(x => x.id.includes("haiku")) : MODELOS) yield m;
        },
      }),
    },
  }));
  return { criarCliente, chamadas };
}

function setup(aceitas = [CHAVE, CHAVE_NOVA, CHAVE_RESTRITA], role: "admin" | "colaborador" | "user" = "admin") {
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
    expect(status).toEqual({ configurado: true, final: "…wxyz", modeloPreferencial: null, ativa: false, ilegivel: false, aviso: null });
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
    expect(await s.caller.statusAnthropic()).toEqual({ configurado: false, final: null, modeloPreferencial: null, ativa: false, ilegivel: false, aviso: null });
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

  it("nenhum código operacional usa a chave do painel (nem pelo módulo, nem pela chave do banco)", () => {
    const repo = path.resolve(import.meta.dirname, "..");
    const permitidos = new Set([path.join("server", "integracoes-router.ts"), path.join("server", "_core", "anthropic-painel.ts")]);
    // módulo, chave em dashboard_settings e a função exportada para uso futuro
    const marcas = ["anthropic-painel", "anthropic_painel", "configuracaoAnthropicPainel", "CHAVE_SEGREDO_ANTHROPIC_PAINEL", "CHAVE_MODELO_ANTHROPIC_PAINEL"];
    const usam: string[] = [];
    const varrer = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const p = path.join(dir, nome);
        if (statSync(p).isDirectory()) { if (!["node_modules", "dist", ".git"].includes(nome)) varrer(p); continue; }
        if (!/\.(ts|tsx|js|mjs|cjs|sql)$/.test(p) || /\.(test|spec)\.ts$/.test(p)) continue;
        const rel = path.relative(repo, p);
        if (permitidos.has(rel)) continue;
        const texto = readFileSync(p, "utf8");
        if (marcas.some(m => texto.includes(m))) usam.push(rel);
      }
    };
    for (const pasta of ["server", "api", "shared", "scripts", "client", "drizzle"]) {
      try { if (statSync(path.join(repo, pasta)).isDirectory()) varrer(path.join(repo, pasta)); } catch { /* pasta ausente */ }
    }
    expect(usam).toEqual([]);
  });

  it("no router, só as rotas do painel usam o acessor (e nenhuma usa a função para uso futuro)", () => {
    const fonte = readFileSync(path.resolve(import.meta.dirname, "integracoes-router.ts"), "utf8");
    expect(fonte).not.toContain("configuracaoAnthropicPainel");
    const importacao = /import \{([^}]*)\} from "\.\/_core\/anthropic-painel\.js";/.exec(fonte);
    expect(importacao).not.toBeNull();
    const funcoes = importacao![1].split(",").map(x => x.trim()).filter(x => x && !x.startsWith("type ") && x !== "anthropicPainelDepsPadrao");
    const corpo = fonte.slice(fonte.indexOf("return router({"));
    const inicios = Array.from(corpo.matchAll(/^ {4}(\w+): adminProcedure/gm)).map(m => ({ nome: m[1], em: m.index! }));
    const permitidas = new Set(["statusAnthropic", "testarAnthropic", "salvarAnthropic", "removerAnthropic", "modelosAnthropic", "salvarModeloAnthropic"]);
    const usos: string[] = [];
    for (const marca of [...funcoes, "anthropic()"]) {
      for (const m of corpo.matchAll(new RegExp(marca.replace(/[()]/g, "\\$&"), "g"))) {
        const dono = inicios.filter(i => i.em < m.index!).pop()?.nome ?? "(fora de rota)";
        usos.push(dono);
      }
    }
    expect(usos.length).toBeGreaterThan(0);
    expect(usos.filter(u => !permitidas.has(u))).toEqual([]);
    // e fora do corpo das rotas, o acessor só aparece no import, no tipo das dependências e no padrão
    const antes = fonte.slice(0, fonte.indexOf("return router({")).replace(importacao![0], "");
    for (const f of funcoes) expect(antes).not.toContain(f);
  });
});

describe("Anthropic — chave ilegível, texto puro e troca de chave", () => {
  it("chave salva que não decifra: status avisa para cadastrar de novo (não 'nenhuma chave')", async () => {
    const s = setup();
    await s.caller.salvarAnthropic({ apiKey: CHAVE });
    ENV.cookieSecret = "outro-segredo-depois-da-rotacao";
    const st = await s.caller.statusAnthropic();
    expect(st).toMatchObject({ configurado: false, ilegivel: true, aviso: expect.stringMatching(/não pode ser lida.*cadastre de novo/) });
    expect(await s.caller.testarAnthropic()).toEqual({ ok: false, mensagem: st.aviso });
    await expect(s.caller.modelosAnthropic()).rejects.toMatchObject({ message: expect.stringMatching(/cadastre de novo/) });
    expect(await configuracaoAnthropicPainel(s.anthropic)).toBeNull();
    expect(s.criarCliente).toHaveBeenCalledTimes(1); // só a validação do salvar; a chave ilegível não chega à Anthropic
  });

  it("valor gravado como plain: é recriptografado na primeira leitura", async () => {
    const s = setup();
    s.banco.set(CHAVE_SEGREDO_ANTHROPIC_PAINEL, `plain:${CHAVE}`);
    expect((await s.caller.statusAnthropic()).final).toBe("…wxyz");
    const gravado = s.banco.get(CHAVE_SEGREDO_ANTHROPIC_PAINEL)!;
    expect(gravado.startsWith("plain:")).toBe(false);
    expect(gravado).not.toContain("sk-ant");
    expect(decryptSecret(gravado)).toBe(CHAVE);
  });

  it("trocar a chave revalida o modelo preferencial: o que a chave nova não oferece é limpo, com aviso", async () => {
    const s = setup();
    await s.caller.salvarAnthropic({ apiKey: CHAVE });
    await s.caller.salvarModeloAnthropic({ modelo: "claude-opus-5-5" });
    const r = await s.caller.salvarAnthropic({ apiKey: CHAVE_RESTRITA });
    expect(r.modeloLimpo).toBe("claude-opus-5-5");
    expect(r.mensagem).toMatch(/claude-opus-5-5 não é oferecido.*foi limpo/);
    expect((await s.caller.statusAnthropic()).modeloPreferencial).toBeNull();
    await s.caller.salvarModeloAnthropic({ modelo: "claude-haiku-5" });
    const r2 = await s.caller.salvarAnthropic({ apiKey: CHAVE });
    expect(r2.modeloLimpo).toBeNull();
    expect((await s.caller.statusAnthropic()).modeloPreferencial).toBe("claude-haiku-5");
  });
});
