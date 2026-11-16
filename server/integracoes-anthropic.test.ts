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

/** QA S-11 achado 2: o que o módulo de modelos (server/_core/modelo-por-funcao.ts) não pode conter. */
function problemasDoModuloDeModelos(texto: string): string[] {
  const p: string[] = [];
  if (/anthropic-painel|secret-vault|decryptSecret|\bdecrypt\b|criarCliente|configuracaoAnthropicPainel|CHAVE_SEGREDO_ANTHROPIC_PAINEL|anthropic_painel_api_key|api_key|apiKey/.test(texto)) p.push("só nomes de modelo");
  // o único texto "…anthropic_painel_…" aceito é o do modelo: uma chave montada em pedaços falha
  if (/anthropic_painel_(?!modelo["'`])/.test(texto)) p.push("texto de chave montado em pedaços");
  return p;
}

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

  it("QA S-11 achado 2: a guarda do módulo de modelos pega decrypt, criarCliente, nome da chave e chave montada em pedaços", () => {
    const tentativas = [
      `const c = (deps as any).decrypt(await deps.lerBanco("segredo.anthropic_painel_" + "api_key"));`,
      `const k = await deps.lerBanco("segredo.anthropic_painel_" + parte);`,
      "const k = await deps.lerBanco(`segredo.anthropic_painel_${x}`);",
      `await (deps as any).criarCliente(k);`,
      `const apiKey = 1;`,
      `const nome = "anthropic_painel_" + "api_key";`,
    ];
    for (const t of tentativas) expect(problemasDoModuloDeModelos(t), t).not.toEqual([]);
    const fonte = readFileSync(path.resolve(import.meta.dirname, "_core", "modelo-por-funcao.ts"), "utf8");
    expect(problemasDoModuloDeModelos(fonte)).toEqual([]);
    // e o painel só passa o leitor do banco (sem decrypt/criarCliente) ao módulo de modelos
    const painel = readFileSync(path.resolve(import.meta.dirname, "_core", "anthropic-painel.ts"), "utf8");
    const chamadas = Array.from(painel.matchAll(/(?:modeloDaFuncao|modelosGravadosDasFuncoes)\(/g));
    expect(chamadas.length).toBeGreaterThan(0);
    for (const c of chamadas) {
      const resto = painel.slice(c.index!);
      let nivel = 0, fim = 0;
      for (let i = resto.indexOf("("); i < resto.length; i++) { if (resto[i] === "(") nivel++; if (resto[i] === ")" && --nivel === 0) { fim = i; break; } }
      expect(resto.slice(0, fim + 1)).toMatch(/soLeitor\(deps\)\)?$/);
    }
  });

  it("nenhum código operacional usa a chave do painel (nem pelo módulo, nem pela chave do banco), exceto a leitura da maquete e a Dolores, cada uma num ponto único", () => {
    const repo = path.resolve(import.meta.dirname, "..");
    // EPIC-024 S-03: a leitura por IA das pranchas da Maquete 3D (server/maquete-3d/base.ts, resolverCredencialIA) lê a
    // chave num único ponto, com confirmação do custo por execução.
    // EPIC-025 E2 (16/11) — exceção ESTREITA (QA achado 9): só estes arquivos importam o módulo do painel, cada um só
    // com as funções listadas. A chave em si (configuracaoAnthropicPainel) é lida num único ponto nomeado da Dolores.
    // EPIC-024 S-11: server/_core/modelo-por-funcao.ts guarda só NOMES de modelo (o da função e o preferencial) — "modelos":
    // não pode importar o módulo do painel nem o cofre, nem citar a chave; conferido abaixo e no teste de modeloDaFuncao.
    const importacoesPermitidas: Record<string, string[] | "painel" | "modelos"> = {
      [path.join("server", "_core", "anthropic-painel.ts")]: "painel",
      [path.join("server", "integracoes-router.ts")]: "painel", // conferido no teste do router, abaixo
      [path.join("server", "_core", "modelo-por-funcao.ts")]: "modelos",
      [path.join("server", "dolores", "router.ts")]: ["existeChaveAnthropicPainel"],
      [path.join("server", "dolores", "whatsapp.ts")]: ["configuracaoAnthropicPainel"],
      [path.join("server", "maquete-3d", "base.ts")]: ["configuracaoAnthropicPainel"],
    };
    const marcas = ["anthropic-painel", "anthropic_painel", "configuracaoAnthropicPainel", "CHAVE_SEGREDO_ANTHROPIC_PAINEL", "CHAVE_MODELO_ANTHROPIC_PAINEL"];
    const usam: string[] = [];
    const leemAChave: string[] = [];
    const importacoesErradas: string[] = [];
    const varrer = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const p = path.join(dir, nome);
        if (statSync(p).isDirectory()) { if (!["node_modules", "dist", ".git"].includes(nome)) varrer(p); continue; }
        if (!/\.(ts|tsx|js|mjs|cjs|sql)$/.test(p) || /\.(test|spec)\.ts$/.test(p)) continue;
        const rel = path.relative(repo, p);
        const texto = readFileSync(p, "utf8");
        const permitido = importacoesPermitidas[rel];
        if (!permitido) { if (marcas.some(m => texto.includes(m))) usam.push(rel); continue; }
        if (permitido === "painel") continue;
        if (permitido === "modelos") {
          leemAChave.push(...problemasDoModuloDeModelos(texto).map(p => `${rel} (${p})`));
          continue;
        }
        // só as funções listadas, num único import do módulo
        const imports = Array.from(texto.matchAll(/import \{([^}]*)\} from "[./]+_core\/anthropic-painel\.js";/g));
        const nomes = imports.flatMap(m => m[1].split(",").map(x => x.trim()).filter(Boolean));
        if (imports.length !== 1 || nomes.some(n => !permitido.includes(n))) importacoesErradas.push(`${rel}: ${nomes.join(", ")}`);
        if (texto.includes("CHAVE_SEGREDO_ANTHROPIC_PAINEL") || texto.includes("anthropic_painel_api_key")) leemAChave.push(rel);
        const chamadas = texto.split("configuracaoAnthropicPainel(").length - 1;
        const leChave = [path.join("server", "dolores", "whatsapp.ts"), path.join("server", "maquete-3d", "base.ts")].includes(rel);
        if (leChave ? chamadas !== 1 : chamadas > 0) leemAChave.push(`${rel} (${chamadas} chamadas)`);
      }
    };
    for (const pasta of ["server", "api", "shared", "scripts", "client", "drizzle"]) {
      try { if (statSync(path.join(repo, pasta)).isDirectory()) varrer(path.join(repo, pasta)); } catch { /* pasta ausente */ }
    }
    expect(usam).toEqual([]);
    expect(importacoesErradas).toEqual([]);
    expect(leemAChave).toEqual([]);
  });

  it("a Dolores só lê a chave do painel num ponto nomeado (bloqueioAtual), depois da pausa e do interruptor (desligado por padrão)", () => {
    const fonte = readFileSync(path.resolve(import.meta.dirname, "dolores", "whatsapp.ts"), "utf8");
    // QA r2 N6: o nome inteiro conta (import + UMA chamada direta, "await configuracaoAnthropicPainel()"), dentro do corpo
    // de bloqueioAtual. Apelido, reexportação, import dinâmico ou função declarada depois fazem o teste falhar.
    expect(problemasDaLeituraDaChave(fonte)).toEqual([]);
    expect(nomesDaChaveNaDolores()).toEqual({ [path.join("server", "dolores", "whatsapp.ts")]: 2 });
    const em = fonte.indexOf("await configuracaoAnthropicPainel()");
    const funcoes = Array.from(fonte.matchAll(/^(?:export )?(?:async )?function (\w+)/gm)).filter(m => m.index! < em);
    const corpo = fonte.slice(funcoes.at(-1)!.index!, em);
    expect(corpo).toMatch(/if \(pausa\.pausada\) return/);
    expect(corpo).toMatch(/if \(!cfg\.iaLigada\) return/);
    // o resultado não sai de bloqueioAtual a não ser como apiKey do pedido ao modelo (nunca para log/auditoria)
    expect(fonte).not.toMatch(/console\.\w+\([^)]*apiKey/);
    expect(fonte).not.toMatch(/registrarAcao\(\{[^}]*apiKey/);
    const sql = readFileSync(path.resolve(import.meta.dirname, "..", "drizzle", "0124_dolores_whatsapp.sql"), "utf8");
    expect(sql).toMatch(/"ia_ligada" boolean NOT NULL DEFAULT false/);
  });

  it("a tela da Dolores só pergunta SE há chave: existeChaveAnthropicPainel não devolve a chave", async () => {
    const { existeChaveAnthropicPainel } = await import("./_core/anthropic-painel");
    const s = setup();
    expect(await existeChaveAnthropicPainel(s.anthropic)).toEqual({ existe: false, modelo: null });
    await s.caller.salvarAnthropic({ apiKey: CHAVE });
    await s.caller.salvarModeloAnthropic({ modelo: "claude-haiku-5" });
    const r = await existeChaveAnthropicPainel(s.anthropic);
    expect(r).toEqual({ existe: true, modelo: "claude-haiku-5" });
    expect(JSON.stringify(r)).not.toContain("sk-ant");
    ENV.cookieSecret = "outro-segredo-depois-da-rotacao";
    expect((await existeChaveAnthropicPainel(s.anthropic)).existe).toBe(false); // ilegível = não há chave utilizável
  });

  it("na maquete, só a resolução da credencial da leitura usa o acessor do painel (sem tocar em ENV)", () => {
    const fonte = readFileSync(path.resolve(import.meta.dirname, "maquete-3d", "base.ts"), "utf8");
    expect(/import \{ configuracaoAnthropicPainel \} from "\.\.\/_core\/anthropic-painel\.js";/.test(fonte)).toBe(true);
    // Uma importação e um uso, dentro de resolverCredencialIA; nada de CHAVE_* nem escrita em ENV.
    expect(fonte.match(/configuracaoAnthropicPainel/g)).toHaveLength(2);
    const corpo = fonte.slice(fonte.indexOf("export async function resolverCredencialIA"), fonte.indexOf("export const modeloDaLeitura"));
    expect(corpo).toContain("configuracaoAnthropicPainel()");
    expect(fonte).not.toMatch(/CHAVE_(SEGREDO|MODELO)_ANTHROPIC_PAINEL/);
    expect(fonte).not.toMatch(/ENV\.\w+\s*=[^=]/);
  });

  it("no router, só as rotas do painel usam o acessor (e nenhuma usa a função para uso futuro)", () => {
    const fonte = readFileSync(path.resolve(import.meta.dirname, "integracoes-router.ts"), "utf8");
    expect(fonte).not.toContain("configuracaoAnthropicPainel");
    const importacao = /import \{([^}]*)\} from "\.\/_core\/anthropic-painel\.js";/.exec(fonte);
    expect(importacao).not.toBeNull();
    const funcoes = importacao![1].split(",").map(x => x.trim()).filter(x => x && !x.startsWith("type ") && x !== "anthropicPainelDepsPadrao");
    const corpo = fonte.slice(fonte.indexOf("return router({"));
    const inicios = Array.from(corpo.matchAll(/^ {4}(\w+): (?:adminProcedure|adminPorPapel)\b/gm)).map(m => ({ nome: m[1], em: m.index! }));
    const permitidas = new Set(["statusAnthropic", "testarAnthropic", "salvarAnthropic", "removerAnthropic", "modelosAnthropic", "salvarModeloAnthropic",
      "modelosPorFuncaoAnthropic", "salvarModeloFuncaoAnthropic"]); // S-11: modelo por função (só nomes de modelo)
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

/** Ocorrências do nome configuracaoAnthropicPainel em cada arquivo (não teste) da Dolores (server/dolores, shared/dolores). */
function nomesDaChaveNaDolores(): Record<string, number> {
  const repo = path.resolve(import.meta.dirname, "..");
  const r: Record<string, number> = {};
  const varrer = (dir: string) => {
    for (const nome of readdirSync(dir)) {
      const p = path.join(dir, nome);
      if (statSync(p).isDirectory()) { varrer(p); continue; }
      if (!/\.(ts|tsx|js)$/.test(p) || /\.(test|spec)\.ts$/.test(p)) continue;
      const n = (readFileSync(p, "utf8").match(/configuracaoAnthropicPainel/g) ?? []).length;
      if (n) r[path.relative(repo, p)] = n;
    }
  };
  for (const pasta of [path.join("server", "dolores"), path.join("shared", "dolores")]) varrer(path.join(repo, pasta));
  return r;
}

/**
 * QA r2 N6 — conferência da leitura da chave na fonte de whatsapp.ts. Devolve o que estiver errado (vazio = ok):
 * o nome aparece exatamente 2 vezes (o import nomeado e a chamada), o módulo do painel só é citado no import, nada é
 * reexportado, e a chamada é "await configuracaoAnthropicPainel()" dentro do corpo de bloqueioAtual (do início dela até a
 * próxima declaração de nível superior).
 */
function problemasDaLeituraDaChave(fonte: string): string[] {
  const p: string[] = [];
  const ocorrencias = Array.from(fonte.matchAll(/configuracaoAnthropicPainel/g)).map(m => m.index!);
  if (ocorrencias.length !== 2) p.push(`nome citado ${ocorrencias.length} vezes (esperado 2: import + chamada)`);
  const importacao = /^import \{ configuracaoAnthropicPainel \} from "\.\.\/_core\/anthropic-painel\.js";$/m.exec(fonte);
  if (!importacao) p.push("import nomeado ausente ou com apelido");
  if ((fonte.match(/anthropic-painel/g) ?? []).length !== 1) p.push("módulo do painel citado fora do import (import dinâmico/reexportação)");
  if (/^\s*export\s*(?:\*|\{[^}]*configuracaoAnthropicPainel)/m.test(fonte)) p.push("reexportação");
  const inicio = fonte.search(/^async function bloqueioAtual\(/m);
  if (inicio < 0) { p.push("bloqueioAtual ausente"); return p; }
  const depois = fonte.slice(inicio + 1).search(/^(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class|type|interface)\b/m);
  const fim = depois < 0 ? fonte.length : inicio + 1 + depois;
  const chamadas = ocorrencias.filter(i => !importacao || i < importacao.index || i > importacao.index + importacao[0].length);
  if (chamadas.length !== 1) p.push(`${chamadas.length} usos fora do import (esperado 1)`);
  for (const i of chamadas) {
    if (fonte.slice(i - 6, i + "configuracaoAnthropicPainel()".length) !== "await configuracaoAnthropicPainel()") p.push("uso que não é a chamada direta (apelido?)");
    if (i < inicio || i >= fim) p.push("chamada fora do corpo de bloqueioAtual");
  }
  return p;
}

describe("QA r2 N6 — a guarda da chave pega apelidos, reexportações e chamadas fora de bloqueioAtual", () => {
  const original = readFileSync(path.resolve(import.meta.dirname, "dolores", "whatsapp.ts"), "utf8");
  const chamada = "await configuracaoAnthropicPainel()";
  it("a fonte real passa", () => expect(problemasDaLeituraDaChave(original)).toEqual([]));
  const variantes: Array<[string, (f: string) => string]> = [
    ["apelido dentro de bloqueioAtual", f => f.replace(chamada, "await (() => { const ler = configuracaoAnthropicPainel; return ler(); })()")],
    ["apelido no import", f => f.replace("import { configuracaoAnthropicPainel }", "import { configuracaoAnthropicPainel as ler }").replace(chamada, "await ler()")],
    ["reexportação", f => `${f}\nexport { configuracaoAnthropicPainel };\n`],
    ["reexportação de tudo", f => `${f}\nexport * from "../_core/anthropic-painel.js";\n`],
    ["import dinâmico", f => `${f}\nconst outro = async () => (await import("../_core/anthropic-painel.js")).configuracaoAnthropicPainel;\n`],
    ["arrow declarada depois de bloqueioAtual", f => f.replace(chamada, "await lerChave()") + `\nconst lerChave = () => configuracaoAnthropicPainel();\n`],
    ["segunda chamada", f => `${f}\nasync function vazar() { return await configuracaoAnthropicPainel(); }\n`],
    ["chamada movida para outra função", f => f.replace(chamada, "await Promise.resolve(null)").replace("async function tratarComando(", `async function antes() { return ${chamada}; }\nasync function tratarComando(`)],
  ];
  for (const [nome, mudar] of variantes) {
    it(`falha: ${nome}`, () => {
      const mudada = mudar(original);
      expect(mudada).not.toBe(original);
      expect(problemasDaLeituraDaChave(mudada)).not.toEqual([]);
    });
  }
});
