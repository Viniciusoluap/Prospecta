// EPIC-029 S-3b — portão de QA (@qa Quinn, 23/11/2026). Tentativas de quebrar a S-3b e a correção de produção da conta da Dolores
// (PGlite, modelo e envio falsos, rede proibida). Os achados ficam como `it.fails` (passam enquanto o problema existir; quando a correção
// entrar, viram `it` normal):
//  - IMPORTANTE: depois da edição de produção (colaborador + 16 módulos), não há caminho no produto para restaurar a conta — a frase manda
//    "pedir para restaurar", mas `updateUser` recusa a conta do sistema e `managedRole` nem aceita o perfil "user";
//  - MÉDIO/BAIXO: a porta `tratarFerramentas` (GET da ponte) ainda responde "Ponte indisponível" para conta alterada;
//  - BAIXO: o relatório sob demanda (`relatorioSobDemanda`) ainda devolve "não consegui fazer a ronda agora" para conta alterada;
//  - BAIXO: a isenção do filtro do PDF é pelo NOME da chave em qualquer nível (uma chave "fonte"/"tipo"/"status" com texto livre num
//    objeto aninhado novo escaparia do filtro).
// 23/11/2026 — @dev (Dex): os 4 achados corrigidos; os `it.fails` viraram `it`.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../whatsapp-router.js", async orig => ({ ...(await orig<typeof import("../whatsapp-router.js")>()), configEvolution: vi.fn(async () => null) }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { appRouter } from "../routers.js";
import { FRASE_CONTA_ALTERADA } from "../../shared/dolores/whatsapp.js";
import { definirClienteModelo, type PedidoModelo, type RespostaModelo } from "./cerebro.js";
import { campoPessoal } from "./dados-pessoais.js";
import { DOLORES_OPEN_ID, DoloresContaAlterada, esquecerUsuarioDolores, usuarioDolores } from "./perfil.js";
import { definirDependenciasPonte, tratarFerramentas } from "./ponte.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";
import { definirDependenciasWhatsapp, notaParaPreviaDaDolores, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";

const DONO = "5599991234567";
const TOKEN = "token-de-teste-da-ponte-1234567890";
const MODULOS = '["crm","obras","financeiro","juridico","bpo","incorporacao","regularizacao","avaliacoes","maquete","documentos","agenda","relatorios","usuarios","integracoes","sorteios","site"]';
let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviar: ReturnType<typeof vi.fn>;
let roteiro: Array<(p: PedidoModelo) => RespostaModelo>;
let fetchVigia: ReturnType<typeof vi.spyOn>;
let logs: string[];
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
let seq = 0;
const dono = (texto: string) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, ip: "203.0.113.9",
  body: { event: "messages.upsert", instance: "prospecta-dolores", data: { key: { remoteJid: `${DONO}@s.whatsapp.net`, fromMe: false, id: `QA3B${++seq}` },
    message: { conversation: texto }, messageTimestamp: Math.floor(AGORA.getTime() / 1000) - 5 } } } as never);
const enviados = () => enviar.mock.calls.map(c => (c[0] as { texto: string }).texto);
const admin = () => appRouter.createCaller({ user: { id: 1, role: "admin", active: true }, req: {}, res: {} } as never);
const colaboradorComUsuarios = () => appRouter.createCaller({ user: { id: 2, role: "colaborador", active: true, permissions: MODULOS }, req: {}, res: {} } as never);
const alterarComoEmProducao = () => banco.pg.exec(`UPDATE users SET role = 'colaborador', permissions = '${MODULOS}' WHERE "openId" = '${DOLORES_OPEN_ID}'`);
const idDaDolores = async () => (await q<{ id: number }>(`SELECT id FROM users WHERE "openId" = '${DOLORES_OPEN_ID}'`))[0]!.id;
const contaDaDolores = async () => (await q(`SELECT role, permissions, "passwordHash", active, name, email FROM users WHERE "openId" = '${DOLORES_OPEN_ID}'`))[0];

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}', ia_ligada = true,
      limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  process.env.DOLORES_PONTE_TOKEN = TOKEN;
  esquecerUsuarioDolores();
  await usuarioDolores();
  esquecerUsuarioDolores();
  definirDependenciasPonte({ agora: () => AGORA });
  enviar = vi.fn(async () => true);
  definirDependenciasWhatsapp({ agora: () => AGORA, enviar: enviar as never });
  vi.mocked(configuracaoAnthropicPainel).mockResolvedValue({ apiKey: "sk-ant-chave-de-teste-nao-real-123456", modelo: "modelo-de-teste" });
  roteiro = [];
  definirClienteModelo(async p => { const passo = roteiro.shift(); if (!passo) throw new Error("roteiro do modelo acabou"); return passo(p); });
  fetchVigia = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("rede proibida no teste"); });
  logs = [];
  for (const m of ["log", "warn", "error", "info"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(x => (x instanceof Error ? x.message : String(x))).join(" ")); });
});
afterEach(() => {
  expect(fetchVigia).not.toHaveBeenCalled();
  ENV.cookieSecret = segredoAntes;
  delete process.env.DOLORES_PONTE_TOKEN;
  definirDependenciasPonte(); definirDependenciasWhatsapp(); definirClienteModelo(); esquecerUsuarioDolores();
  vi.restoreAllMocks();
});

describe("QA S-3b — conta do sistema: nenhum caminho de admin/colaborador altera a Dolores", () => {
  it("colaborador com o módulo 'usuarios' não usa updateUser, resetPassword, deleteUser nem o botão de ativar/desativar", async () => {
    const id = await idDaDolores();
    const antes = await contaDaDolores();
    const c = colaboradorComUsuarios();
    await expect(c.configuracoes.definirContaDoSistemaAtiva({ id, active: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(c.configuracoes.updateUser({ id, name: "X", role: "admin", active: true, permissions: [] } as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(c.configuracoes.resetPassword({ id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(c.configuracoes.deleteUser({ id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await contaDaDolores()).toEqual(antes);
  });

  it("admin: updateUser com qualquer combinação (inclusive 'engenheiro', leadId, ativo=false) é recusado e nada muda", async () => {
    const id = await idDaDolores();
    const antes = await contaDaDolores();
    for (const extra of [{ role: "colaborador", permissions: ["crm"] }, { role: "cliente", permissions: [], leadId: 1 }, { role: "colaborador", permissions: [], engenheiro: true },
      { role: "admin", permissions: [], active: false }]) {
      await expect(admin().configuracoes.updateUser({ id, name: "Dolores (funcionária digital)", active: true, ...extra } as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await contaDaDolores()).toEqual(antes);
    expect((await q(`SELECT count(*)::int AS n FROM engineer_profiles WHERE user_id = ${id}`).catch(() => [{ n: 0 }]))[0]!.n).toBe(0);
  });

  it("definirContaDoSistemaAtiva só muda 'active' (nem perfil, nem módulos, nem senha) e não restaura uma conta alterada sozinha", async () => {
    const id = await idDaDolores();
    await admin().configuracoes.definirContaDoSistemaAtiva({ id, active: false });
    expect(await contaDaDolores()).toMatchObject({ role: "user", permissions: "[]", passwordHash: null, active: false });
    await admin().configuracoes.definirContaDoSistemaAtiva({ id, active: true });
    expect(await contaDaDolores()).toMatchObject({ role: "user", permissions: "[]", passwordHash: null, active: true });
  });

  it("log da conta alterada: linha curta, sem openId, sem a lista de módulos e sem o número do dono", async () => {
    await alterarComoEmProducao();
    expect((await dono("oi")).status).toBe(200);
    expect(enviados()).toContain(FRASE_CONTA_ALTERADA);
    const tudo = logs.join("\n");
    expect(tudo).toMatch(/conta da Dolores fora do padrão/);
    expect(tudo).not.toContain(DOLORES_OPEN_ID);
    expect(tudo).not.toContain('"integracoes"');
    expect(tudo).not.toContain(DONO);
  });

  // ACHADO IMPORTANTE — sem caminho de restauração no produto. A frase ao dono diz "Peça para restaurar (perfil padrão, sem módulos)", mas
  // a tela só mostra o interruptor, o servidor recusa updateUser na conta do sistema e o enum `managedRole` não tem "user". A conta de
  // produção que já foi editada continua parada depois do deploy até alguém rodar SQL à mão (alteração de dado existente: pede o dono).
  // corrigido: configuracoes.restaurarContaDoSistema (botão "Restaurar conta padrão" no diálogo da conta do sistema)
  it("depois da edição de produção, algum caminho do produto (admin) devolve a conta ao padrão e a Dolores volta", async () => {
    await alterarComoEmProducao();
    const id = await idDaDolores();
    await admin().configuracoes.updateUser({ id, name: "Dolores (funcionária digital)", role: "user", active: true, permissions: [] } as never).catch(() => null);
    await admin().configuracoes.definirContaDoSistemaAtiva({ id, active: false }).catch(() => null);
    await admin().configuracoes.definirContaDoSistemaAtiva({ id, active: true }).catch(() => null);
    await admin().configuracoes.restaurarContaDoSistema({ id });
    esquecerUsuarioDolores();
    await expect(usuarioDolores()).resolves.toBe(id);
  });
});

describe("QA S-3b — o motivo novo em todas as portas", () => {
  // ACHADO MÉDIO/BAIXO — ponte.ts tratarFerramentas (GET das ferramentas) cai no catch genérico: "Ponte indisponível; nada foi executado."
  it("ponte, GET das ferramentas: conta alterada responde com a frase de conta alterada (não 'indisponível')", async () => {
    await alterarComoEmProducao();
    const r = await tratarFerramentas({ headers: { authorization: `Bearer ${TOKEN}` }, body: {}, ip: "203.0.113.7" } as never);
    expect(r.status).toBe(503);
    expect(String(r.body.erro)).toMatch(/foi alterada em Usuários e acesso/);
  });

  it("ponte, GET das ferramentas: mesmo assim falha fechada (503, nenhuma ferramenta)", async () => {
    await alterarComoEmProducao();
    const r = await tratarFerramentas({ headers: { authorization: `Bearer ${TOKEN}` }, body: {}, ip: "203.0.113.7" } as never);
    expect(r.status).toBe(503);
    expect(r.body.ferramentas).toBeUndefined();
  });

  // ACHADO BAIXO — rondas.ts relatorioSobDemanda: `r.motivo === "pausada" ? … : "não consegui fazer a ronda agora"` — conta alterada (e
  // usuária desativada) chegam ao dono/à tela sem a frase própria, embora `motivoDoBloqueio` já saiba dizer.
  it("relatório sob demanda usa motivoDoBloqueio para conta alterada (não a frase genérica)", () => {
    const fonte = readFileSync(new URL("./rondas.ts", import.meta.url), "utf8");
    expect(fonte).not.toContain(`r.motivo === "pausada" ? "Dolores pausada (pausa geral)" : "não consegui fazer a ronda agora"`);
  });

  it("classe própria: DoloresContaAlterada é lançada (e não um Error genérico) para senha, perfil ou módulos", async () => {
    for (const sql of [`role = 'admin'`, `"passwordHash" = 'x'`, `permissions = '["crm"]'`]) {
      await banco.pg.exec(`UPDATE users SET role = 'user', permissions = '[]', "passwordHash" = NULL WHERE "openId" = '${DOLORES_OPEN_ID}'`);
      await banco.pg.exec(`UPDATE users SET ${sql} WHERE "openId" = '${DOLORES_OPEN_ID}'`);
      esquecerUsuarioDolores();
      await expect(usuarioDolores()).rejects.toBeInstanceOf(DoloresContaAlterada);
    }
  });
});

describe("QA S-3b — filtro do PDF", () => {
  const base = () => ({
    status: "A_DECIDIR", dataEvento: "2026-11-10", descricao: "senha: Qz1Kw7RtLmPx",
    tomador: { tipo: "bpo", nome: "senha: Qz2Kw7RtLmPx", documento: null, cidade: "senha: Qz3Kw7RtLmPx", uf: "MA" },
    lista: ["senha: Qz4Kw7RtLmPx"],
  });

  it("texto em qualquer nível (inclusive dentro de array) sai filtrado; os campos fechados ficam intactos", () => {
    const s = JSON.stringify(notaParaPreviaDaDolores(base() as never, campoPessoal));
    for (const m of ["Qz1Kw7RtLmPx", "Qz2Kw7RtLmPx", "Qz3Kw7RtLmPx", "Qz4Kw7RtLmPx"]) expect(s).not.toContain(m);
    expect(s).toContain('"status":"A_DECIDIR"');
    expect(s).toContain('"dataEvento":"2026-11-10"');
  });

  // ACHADO BAIXO (fragilidade) — a isenção é pelo NOME da chave em qualquer nível. Hoje nenhum texto livre impresso tem chave
  // "fonte"/"tipo"/"status"/…, mas um objeto aninhado novo com essa chave (ex.: origem.tipo com texto do banco) escaparia do filtro.
  it("a isenção dos campos fechados vale só no caminho certo (origem.fonte com texto livre é filtrado)", () => {
    const nota = { ...base(), origem: { descricao: "x", fonte: "senha: Qz9Kw7RtLmPx" } };
    expect(JSON.stringify(notaParaPreviaDaDolores(nota as never, campoPessoal))).not.toContain("Qz9Kw7RtLmPx");
  });
});
