// EPIC-024 S-11: modelo da Anthropic por função (Integrações › Anthropic). Cliente da Anthropic simulado: nada externo é
// chamado. Permissões pelo appRouter com o caminho completo (createCaller do sub-router daria falso positivo).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_MODULES } from "../shared/admin-permissions";
import { FUNCOES_ANTHROPIC } from "../shared/funcoes-anthropic";
import { createIntegracoesRouter, type IntegracoesDeps } from "./integracoes-router";
import { CHAVE_MODELO_ANTHROPIC_PAINEL, CHAVE_SEGREDO_ANTHROPIC_PAINEL, type AnthropicPainelDeps, type ClienteModelos } from "./_core/anthropic-painel";
import { CHAVE_MODELO_PREFERENCIAL, chaveAvisoDaFuncao, chaveModeloDaFuncao, modeloDaFuncao } from "./_core/modelo-por-funcao";
import { decryptSecret, encryptSecret } from "./_core/secret-vault";
import { ENV } from "./_core/env";
import { modeloDaLeitura, resolverCredencialIA } from "./maquete-3d/base";
import { lerConfig } from "../shared/maquete-3d/regras";
import { appRouter } from "./routers";

const CHAVE = "sk-ant-api03-chave-de-teste-0000000000wxyz";
const CHAVE_RESTRITA = "sk-ant-api03-chave-restrita-22222222hhhh";
const MODELOS = [
  { id: "claude-opus-5-5", display_name: "Claude Opus 5.5", created_at: "2026-10-01T00:00:00Z" },
  { id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5", created_at: "2026-10-01T00:00:00Z" },
  { id: "claude-haiku-5", display_name: "Claude Haiku 5", created_at: "2026-09-01T00:00:00Z" },
];

function setup() {
  const banco = new Map<string, string>();
  const lidas: string[] = [];
  let oferecidos = MODELOS;
  const criarCliente = vi.fn((apiKey: string): ClienteModelos => ({
    models: {
      list: () => ({
        async *[Symbol.asyncIterator]() {
          if (![CHAVE, CHAVE_RESTRITA].includes(apiKey)) throw Object.assign(new Error("401"), { status: 401 });
          for (const m of apiKey === CHAVE_RESTRITA ? MODELOS.filter(x => x.id.includes("haiku")) : oferecidos) yield m;
        },
      }),
    },
  }));
  const decrypt = vi.fn(decryptSecret);
  const anthropic: AnthropicPainelDeps = {
    lerBanco: async k => { lidas.push(k); return banco.get(k); },
    gravarBanco: async (k, v) => { banco.set(k, v); },
    criarCliente, encrypt: encryptSecret, decrypt,
  };
  const antigo = { dolores: null as string | null };
  const modelosAntigos = {
    lerAnteriorDolores: vi.fn(async () => antigo.dolores),
    limparAnteriorDolores: vi.fn(async () => { antigo.dolores = null; }),
    padraoMaquete: vi.fn(async () => "claude-padrao-da-maquete"),
  };
  const deps = { fetchImpl: vi.fn(), anthropic, modelosAntigos } as unknown as IntegracoesDeps;
  const caller = createIntegracoesRouter(deps).createCaller({ user: { id: 7, role: "admin", active: true }, req: {}, res: {} } as never);
  return { banco, lidas, criarCliente, decrypt, anthropic, antigo, modelosAntigos, caller, ofertar: (m: typeof MODELOS) => { oferecidos = m; } };
}
const linha = (r: { funcoes: Array<{ id: string }> }, id: string) => r.funcoes.find(f => f.id === id) as any;

beforeEach(() => { ENV.cookieSecret = "segredo-de-teste-do-cofre"; });

describe("modeloDaFuncao — resolução (só nomes de modelo)", () => {
  const leitor = (dados: Record<string, string>) => {
    const lidas: string[] = [];
    return { lidas, deps: { lerBanco: async (k: string) => { lidas.push(k); return dados[k]; } } };
  };
  it("função → anterior → preferencial → padrão", async () => {
    const f = "maquete_leitura" as const;
    expect(await modeloDaFuncao(f, { padrao: "p" }, leitor({}).deps)).toEqual({ modelo: "p", origem: "padrao" });
    expect(await modeloDaFuncao(f, { padrao: "p" }, leitor({ [CHAVE_MODELO_PREFERENCIAL]: "pref" }).deps)).toEqual({ modelo: "pref", origem: "preferencial" });
    expect(await modeloDaFuncao(f, { padrao: "p", anterior: "ant" }, leitor({ [CHAVE_MODELO_PREFERENCIAL]: "pref" }).deps)).toEqual({ modelo: "ant", origem: "anterior" });
    expect(await modeloDaFuncao(f, { padrao: "p", anterior: "ant" }, leitor({ [CHAVE_MODELO_PREFERENCIAL]: "pref", [chaveModeloDaFuncao(f)]: " fun " }).deps)).toEqual({ modelo: "fun", origem: "funcao" });
    expect(await modeloDaFuncao(f, {}, leitor({ [chaveModeloDaFuncao(f)]: "" }).deps)).toEqual({ modelo: null, origem: null });
    // preferencial já lido (no ponto único da chave) é usado sem ler de novo
    const l = leitor({ [CHAVE_MODELO_PREFERENCIAL]: "do-banco" });
    expect(await modeloDaFuncao(f, { preferencial: "passado" }, l.deps)).toEqual({ modelo: "passado", origem: "preferencial" });
    expect(l.lidas).toEqual([chaveModeloDaFuncao(f)]);
  });
  it("cada função tem o seu modelo; banco fora do ar cai para o próximo, sem lançar", async () => {
    const l = leitor({ [chaveModeloDaFuncao("maquete_leitura")]: "claude-opus-5-5", [chaveModeloDaFuncao("dolores_whatsapp")]: "claude-haiku-5" });
    expect((await modeloDaFuncao("maquete_leitura", {}, l.deps)).modelo).toBe("claude-opus-5-5");
    expect((await modeloDaFuncao("dolores_whatsapp", {}, l.deps)).modelo).toBe("claude-haiku-5");
    const fora = { lerBanco: async () => { throw new Error("banco fora"); } };
    expect(await modeloDaFuncao("dolores_whatsapp", { preferencial: "pref" }, fora)).toEqual({ modelo: "pref", origem: "preferencial" });
    expect(await modeloDaFuncao("inventada" as never, {}, l.deps)).toEqual({ modelo: null, origem: null });
  });
  it("nunca lê a chave: só as chaves de modelo de dashboard_settings", async () => {
    const l = leitor({});
    for (const f of FUNCOES_ANTHROPIC) await modeloDaFuncao(f, { padrao: "x" }, l.deps);
    expect(l.lidas.every(k => k === CHAVE_MODELO_PREFERENCIAL || k.startsWith(`${CHAVE_MODELO_PREFERENCIAL}.`))).toBe(true);
    expect(l.lidas).not.toContain(CHAVE_SEGREDO_ANTHROPIC_PAINEL);
    expect(CHAVE_MODELO_ANTHROPIC_PAINEL).toBe(CHAVE_MODELO_PREFERENCIAL);
  });
});

describe("rotas do painel — modelo por função", () => {
  it("sem chave: lista as funções (rótulo, descrição, recomendação) com a seção desabilitada; salvar um id é recusado", async () => {
    const s = setup();
    const r = await s.caller.modelosPorFuncaoAnthropic();
    expect(r.configurado).toBe(false);
    expect(r.funcoes.map(f => [f.id, f.rotulo])).toEqual([
      ["maquete_leitura", "Leitura de plantas em PDF — Maquete 3D"], ["dolores_whatsapp", "Dolores — conversa pelo WhatsApp"]]);
    expect(linha(r, "dolores_whatsapp").recomendacao).toMatch(/mais barato/);
    expect(linha(r, "maquete_leitura").recomendacao).toMatch(/mais capaz/);
    expect(linha(r, "maquete_leitura").valendo).toEqual({ modelo: "claude-padrao-da-maquete", origem: "padrao" });
    await expect(s.caller.salvarModeloFuncaoAnthropic({ funcao: "maquete_leitura", modelo: "claude-opus-5-5" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(s.criarCliente).not.toHaveBeenCalled();
  });

  it("valida o id contra a lista da conta; vazio = preferencial; cada função guarda o seu e mostra o que vale agora", async () => {
    const s = setup();
    await s.caller.salvarAnthropic({ apiKey: CHAVE });
    await s.caller.salvarModeloAnthropic({ modelo: "claude-sonnet-5-5" });
    await expect(s.caller.salvarModeloFuncaoAnthropic({ funcao: "maquete_leitura", modelo: "claude-inventado-9" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(s.banco.has(chaveModeloDaFuncao("maquete_leitura"))).toBe(false);
    await expect(s.caller.salvarModeloFuncaoAnthropic({ funcao: "outra" as never, modelo: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const r1 = await s.caller.salvarModeloFuncaoAnthropic({ funcao: "maquete_leitura", modelo: "claude-opus-5-5" });
    expect(r1.modelo?.id).toBe("claude-opus-5-5");
    const r2 = await s.caller.salvarModeloFuncaoAnthropic({ funcao: "dolores_whatsapp", modelo: "claude-haiku-5" });
    expect(linha(r2, "maquete_leitura").valendo).toEqual({ modelo: "claude-opus-5-5", origem: "funcao" });
    expect(linha(r2, "dolores_whatsapp").valendo).toEqual({ modelo: "claude-haiku-5", origem: "funcao" });
    expect(r2.preferencial).toBe("claude-sonnet-5-5");

    const r3 = await s.caller.salvarModeloFuncaoAnthropic({ funcao: "maquete_leitura", modelo: "" });
    expect(r3.modelo).toBeNull();
    expect(linha(r3, "maquete_leitura").valendo).toEqual({ modelo: "claude-sonnet-5-5", origem: "preferencial" });
    expect(s.banco.get(chaveModeloDaFuncao("maquete_leitura"))).toBe("");
    for (const resp of [r1, r2, r3, await s.caller.modelosPorFuncaoAnthropic()]) expect(JSON.stringify(resp)).not.toContain("sk-ant");
  });

  it("escolher o modelo não liga nada: só lista modelos (sem consumir tokens) e não mexe no interruptor nem na confirmação", async () => {
    const s = setup();
    await s.caller.salvarAnthropic({ apiKey: CHAVE });
    s.criarCliente.mockClear();
    await s.caller.salvarModeloFuncaoAnthropic({ funcao: "dolores_whatsapp", modelo: "claude-haiku-5" });
    await s.caller.modelosPorFuncaoAnthropic();
    // um único cliente, criado só para listar os modelos na validação (o falso nem tem messages.create)
    expect(s.criarCliente).toHaveBeenCalledTimes(1);
    expect(Object.keys(s.criarCliente.mock.results[0].value as object)).toEqual(["models"]);
    expect(Array.from(s.banco.keys()).filter(k => !k.startsWith(CHAVE_MODELO_PREFERENCIAL) && k !== CHAVE_SEGREDO_ANTHROPIC_PAINEL)).toEqual([]);
  });

  it("Dolores: valor antigo do cartão é respeitado como queda; escolher no painel passa a ser a fonte e limpa o antigo", async () => {
    const s = setup();
    await s.caller.salvarAnthropic({ apiKey: CHAVE });
    await s.caller.salvarModeloAnthropic({ modelo: "claude-sonnet-5-5" });
    s.antigo.dolores = "claude-opus-5-5";
    expect(linha(await s.caller.modelosPorFuncaoAnthropic(), "dolores_whatsapp").valendo).toEqual({ modelo: "claude-opus-5-5", origem: "anterior" });
    await s.caller.salvarModeloFuncaoAnthropic({ funcao: "maquete_leitura", modelo: "claude-opus-5-5" });
    expect(s.modelosAntigos.limparAnteriorDolores).not.toHaveBeenCalled(); // outra função não mexe na Dolores
    const r = await s.caller.salvarModeloFuncaoAnthropic({ funcao: "dolores_whatsapp", modelo: "" });
    expect(s.modelosAntigos.limparAnteriorDolores).toHaveBeenCalledWith(7);
    expect(linha(r, "dolores_whatsapp").valendo).toEqual({ modelo: "claude-sonnet-5-5", origem: "preferencial" });
  });

  it("modelo que sumiu da conta: ao listar ou ao trocar a chave, a função cai para o preferencial e o painel avisa", async () => {
    const s = setup();
    await s.caller.salvarAnthropic({ apiKey: CHAVE });
    await s.caller.salvarModeloAnthropic({ modelo: "claude-haiku-5" });
    await s.caller.salvarModeloFuncaoAnthropic({ funcao: "maquete_leitura", modelo: "claude-opus-5-5" });
    await s.caller.salvarModeloFuncaoAnthropic({ funcao: "dolores_whatsapp", modelo: "claude-sonnet-5-5" });
    // a conta deixou de oferecer o Opus: percebido ao listar
    s.ofertar(MODELOS.filter(m => m.id !== "claude-opus-5-5"));
    await s.caller.modelosAnthropic();
    let r = await s.caller.modelosPorFuncaoAnthropic();
    expect(linha(r, "maquete_leitura")).toMatchObject({ modelo: null, sumiu: "claude-opus-5-5", valendo: { modelo: "claude-haiku-5", origem: "preferencial" } });
    expect(linha(r, "dolores_whatsapp")).toMatchObject({ modelo: "claude-sonnet-5-5", sumiu: null });
    // trocar para uma chave que só tem o Haiku: a Dolores perde o Sonnet, com aviso na mensagem
    const troca = await s.caller.salvarAnthropic({ apiKey: CHAVE_RESTRITA });
    expect(troca.mensagem).toMatch(/claude-sonnet-5-5 de "Dolores — conversa pelo WhatsApp" não é oferecido.*preferencial/);
    r = await s.caller.modelosPorFuncaoAnthropic();
    expect(linha(r, "dolores_whatsapp")).toMatchObject({ modelo: null, sumiu: "claude-sonnet-5-5", valendo: { modelo: "claude-haiku-5", origem: "preferencial" } });
    // escolher de novo apaga o aviso
    r = await s.caller.salvarModeloFuncaoAnthropic({ funcao: "maquete_leitura", modelo: "claude-haiku-5" });
    expect(linha(r, "maquete_leitura")).toMatchObject({ modelo: "claude-haiku-5", sumiu: null });
    expect(s.banco.get(chaveAvisoDaFuncao("maquete_leitura"))).toBe("");
  });

  it("remover a chave limpa também os modelos por função", async () => {
    const s = setup();
    await s.caller.salvarAnthropic({ apiKey: CHAVE });
    await s.caller.salvarModeloFuncaoAnthropic({ funcao: "dolores_whatsapp", modelo: "claude-haiku-5" });
    await s.caller.removerAnthropic();
    const r = await s.caller.modelosPorFuncaoAnthropic();
    expect(r.configurado).toBe(false);
    expect(r.funcoes.every(f => f.modelo === null)).toBe(true);
  });
});

describe("permissões (caminho completo pelo appRouter): só admin por papel", () => {
  const caller = (role: string, permissoes: string[] = [], active = true) =>
    appRouter.createCaller({ user: { id: 1, role, active, permissions: JSON.stringify(permissoes) }, req: {}, res: {} } as never);
  const rotas = [
    ["modelosPorFuncaoAnthropic", (c: ReturnType<typeof caller>) => c.integracoes.modelosPorFuncaoAnthropic()],
    ["salvarModeloFuncaoAnthropic", (c: ReturnType<typeof caller>) => c.integracoes.salvarModeloFuncaoAnthropic({ funcao: "dolores_whatsapp", modelo: "" })],
  ] as const;
  for (const [nome, chamar] of rotas) {
    it(`${nome}: colaborador com todos os módulos, corretor, cliente, user, empreiteiro e admin inativo → FORBIDDEN`, async () => {
      for (const c of [caller("colaborador", [...ADMIN_MODULES]), caller("corretor"), caller("cliente"), caller("user"), caller("empreiteiro"), caller("admin", [], false)]) {
        await expect(chamar(c)).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    });
  }
});

describe("ligações: a Maquete usa o modelo da função dela", () => {
  const config = lerConfig(JSON.stringify({ modeloIA: "claude-da-config" }));
  it("com a chave do painel: modelo da função; sem escolha: preferencial; com a chave do servidor: o da configuração", async () => {
    const painel = async () => ({ apiKey: "sk-ant-painel-1", modelo: "claude-pref" });
    const funcao = vi.fn(async (pref: string | null) => ({ modelo: "claude-opus-5-5", origem: "funcao" as const, pref }));
    const c = await resolverCredencialIA(painel, {}, funcao);
    expect(funcao).toHaveBeenCalledWith("claude-pref");
    expect(c).toEqual({ apiKey: "sk-ant-painel-1", modelo: "claude-opus-5-5", origem: "painel" });
    expect(modeloDaLeitura(c, config)).toBe("claude-opus-5-5");
    const semEscolha = await resolverCredencialIA(painel, {}, async pref => ({ modelo: pref, origem: "preferencial" }));
    expect(modeloDaLeitura(semEscolha, config)).toBe("claude-pref");
    const falhou = await resolverCredencialIA(painel, {}, async () => { throw new Error("banco fora"); });
    expect(modeloDaLeitura(falhou, config)).toBe("claude-pref");
    const nada = await resolverCredencialIA(async () => ({ apiKey: "sk-ant-painel-1", modelo: null }), {}, async () => ({ modelo: null, origem: null }));
    expect(modeloDaLeitura(nada, config)).toBe("claude-da-config");
    const amb = await resolverCredencialIA(async () => null, { anthropicApiKey: "sk-ant-env" }, funcao);
    expect(modeloDaLeitura(amb, config)).toBe("claude-da-config");
  });
});
