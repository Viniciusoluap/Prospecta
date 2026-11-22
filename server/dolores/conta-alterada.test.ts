// 22/11/2026 — achado em produção: a conta da Dolores ("sistema:dolores") foi editada em "Usuários e acesso" (perfil virou colaborador,
// ganhou 16 módulos) e toda conversa do dono saía "indisponível" ("não consegui ler a minha configuração"), sem log. Aqui (PGlite, modelo e
// envio falsos, rede proibida):
//  1. erro próprio (DoloresContaAlterada) → motivo "conta_alterada" em todas as portas (conversa do dono, operação/grupos/cliente/rondas,
//     ponte, fila), frase clara ao dono e uma linha curta no log, sem dados;
//  2. "Usuários e acesso": o servidor recusa perfil, módulos, nome, senha e exclusão da conta do sistema; só ativar/desativar.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../whatsapp-router.js", async orig => ({ ...(await orig<typeof import("../whatsapp-router.js")>()), configEvolution: vi.fn(async () => null) }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { FRASE_CONTA_DO_SISTEMA } from "../configuracoes-router.js";
import { appRouter } from "../routers.js";
import { FRASE_CONTA_ALTERADA, fraseDeBloqueio } from "../../shared/dolores/whatsapp.js";
import { definirClienteModelo, type PedidoModelo, type RespostaModelo } from "./cerebro.js";
import { bloqueioDaOperacao, podeFalarNoGrupo } from "./operacao.js";
import { DOLORES_OPEN_ID, DoloresContaAlterada, DoloresDesativada, contaDaDoloresForaDoPadrao, esquecerUsuarioDolores, usuarioDolores } from "./perfil.js";
import { definirDependenciasPonte, executarFuncao } from "./ponte.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";
import { definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";

const DONO = "5599991234567";
let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviar: ReturnType<typeof vi.fn>;
let pedidos: PedidoModelo[];
let roteiro: Array<(p: PedidoModelo) => RespostaModelo>;
let fetchVigia: ReturnType<typeof vi.spyOn>;
let logs: string[];
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
let seq = 0;
const dono = (texto: string) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, ip: "203.0.113.9",
  body: { event: "messages.upsert", instance: "prospecta-dolores", data: { key: { remoteJid: `${DONO}@s.whatsapp.net`, fromMe: false, id: `CA${++seq}` },
    message: { conversation: texto }, messageTimestamp: Math.floor(AGORA.getTime() / 1000) - 5 } } } as never);
const enviados = () => enviar.mock.calls.map(c => (c[0] as { texto: string }).texto);
const admin = () => appRouter.createCaller({ user: { id: 1, role: "admin", active: true }, req: {}, res: {} } as never);
/** A edição de produção: perfil colaborador + 16 módulos. */
const alterarComoEmProducao = () => banco.pg.exec(`UPDATE users SET role = 'colaborador', permissions = '["crm","obras","financeiro","juridico","bpo","incorporacao","regularizacao","avaliacoes","maquete","documentos","agenda","relatorios","usuarios","integracoes","sorteios","site"]' WHERE "openId" = '${DOLORES_OPEN_ID}'`);
const idDaDolores = async () => (await q<{ id: number }>(`SELECT id FROM users WHERE "openId" = '${DOLORES_OPEN_ID}'`))[0]!.id;

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}', ia_ligada = true,
      limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  esquecerUsuarioDolores();
  await usuarioDolores(); // cria a linha da conta do sistema
  esquecerUsuarioDolores();
  definirDependenciasPonte({ agora: () => AGORA });
  enviar = vi.fn(async () => true);
  definirDependenciasWhatsapp({ agora: () => AGORA, enviar: enviar as never });
  vi.mocked(configuracaoAnthropicPainel).mockResolvedValue({ apiKey: "sk-ant-chave-de-teste-nao-real-123456", modelo: "modelo-de-teste" });
  pedidos = [];
  roteiro = [];
  definirClienteModelo(async p => { pedidos.push(p); const passo = roteiro.shift(); if (!passo) throw new Error("roteiro do modelo acabou"); return passo(p); });
  fetchVigia = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("rede proibida no teste"); });
  logs = [];
  for (const m of ["log", "warn", "error", "info"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(x => (x instanceof Error ? x.message : String(x))).join(" ")); });
});
afterEach(() => {
  expect(fetchVigia).not.toHaveBeenCalled();
  ENV.cookieSecret = segredoAntes;
  definirDependenciasPonte(); definirDependenciasWhatsapp(); definirClienteModelo(); esquecerUsuarioDolores();
  vi.restoreAllMocks();
});

describe("1 — conta alterada: erro próprio, motivo \"conta_alterada\", frase clara e log curto", () => {
  it("regra pura: perfil, senha ou módulos fora do padrão", () => {
    expect(contaDaDoloresForaDoPadrao({ role: "user", passwordHash: null, permissions: "[]" })).toBe(false);
    expect(contaDaDoloresForaDoPadrao({ role: "user", passwordHash: null, permissions: null })).toBe(false);
    expect(contaDaDoloresForaDoPadrao({ role: "colaborador", passwordHash: null, permissions: "[]" })).toBe(true);
    expect(contaDaDoloresForaDoPadrao({ role: "user", passwordHash: "x", permissions: "[]" })).toBe(true);
    expect(contaDaDoloresForaDoPadrao({ role: "user", passwordHash: null, permissions: "[\"crm\"]" })).toBe(true);
    expect(fraseDeBloqueio("conta_alterada")).toBe(FRASE_CONTA_ALTERADA);
    expect(FRASE_CONTA_ALTERADA).toBe("Dolores: minha conta foi alterada em Usuários e acesso (perfil ou módulos), e por segurança eu parei. Peça para restaurar (perfil padrão, sem módulos).");
  });

  it("usuarioDolores lança DoloresContaAlterada (e não um Error genérico); desativada continua DoloresDesativada", async () => {
    await alterarComoEmProducao();
    await expect(usuarioDolores()).rejects.toBeInstanceOf(DoloresContaAlterada);
    await banco.pg.exec(`UPDATE users SET active = false WHERE "openId" = '${DOLORES_OPEN_ID}'`);
    await expect(usuarioDolores()).rejects.toBeInstanceOf(DoloresDesativada);
  });

  it("conversa do dono: responde a frase clara (não \"não consegui ler a minha configuração\"), sem chamar a IA, e loga curto", async () => {
    await alterarComoEmProducao();
    expect(await dono("tem obra atrasada?")).toMatchObject({ status: 200 });
    expect(pedidos).toHaveLength(0);
    expect(enviados()).toEqual([FRASE_CONTA_ALTERADA]);
    expect(enviados().join("\n")).not.toContain("não consegui ler a minha configuração");
    const [m] = await q<{ situacao: string; motivo: string }>("SELECT situacao, motivo FROM dolores_mensagens WHERE do_dono ORDER BY id DESC LIMIT 1");
    expect(m).toEqual({ situacao: "bloqueada", motivo: "conta_alterada" });
    const linha = logs.find(l => l.includes("conta da Dolores fora do padrão"));
    expect(linha).toBeTruthy();
    expect(linha!.length).toBeLessThan(200);
    expect(logs.join("\n")).not.toMatch(/sk-ant|5599991234567|crm","obras/);
  });

  it("restaurada (perfil 'user', '[]'): a conversa volta a funcionar", async () => {
    await alterarComoEmProducao();
    await banco.pg.exec(`UPDATE users SET role = 'user', permissions = '[]' WHERE "openId" = '${DOLORES_OPEN_ID}'`);
    roteiro = [() => ({ stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [{ type: "text", text: "Bom dia!" }] })];
    await dono("bom dia");
    expect(pedidos).toHaveLength(1);
    expect(enviados().at(-1)).toContain("Bom dia!");
  });

  it("operação (grupos, cliente, rondas, avisos): bloqueioDaOperacao → conta_alterada; podeFalarNoGrupo → false", async () => {
    expect(await bloqueioDaOperacao()).toBeNull();
    await alterarComoEmProducao();
    expect(await bloqueioDaOperacao()).toEqual({ motivo: "conta_alterada" });
    expect(await podeFalarNoGrupo()).toBe(false);
    expect(logs.some(l => l.includes("[dolores/operacao] conta da Dolores fora do padrão"))).toBe(true);
  });

  it("ponte: recusa com a frase de conta alterada (não \"indisponível\") e registra recusada", async () => {
    await alterarComoEmProducao();
    const r = await executarFuncao({ funcao: "listar_obras", argumentos: {} }, { canal: "whatsapp", mensagemId: 1 });
    expect(r.status).toBe(503);
    expect(String(r.body.erro)).toContain("foi alterada em Usuários e acesso");
    const [a] = await q<{ resultado: string; motivo: string }>("SELECT resultado, motivo FROM dolores_acoes ORDER BY id DESC LIMIT 1");
    expect(a).toEqual({ resultado: "recusada", motivo: "conta da Dolores alterada em Usuários e acesso" });
  });

  it("indisponível vindo de exceção também deixa uma linha curta no log", () => {
    const fonte = readFileSync(new URL("./whatsapp.ts", import.meta.url), "utf8");
    expect(fonte).toContain('console.error("[dolores/whatsapp] usuária Dolores indisponível", erroCurto(e));');
    expect(fonte).toContain('catch (e) { console.error("[dolores/whatsapp] falha ao ler a configuração", erroCurto(e)); return { motivo: "indisponivel" }; }');
    expect(fonte).not.toContain('try { cfg = await lerConfigWhatsapp(); } catch { return { motivo: "indisponivel" }; }');
  });
});

describe("2 — Usuários e acesso: a conta do sistema não é editável (só ativar/desativar)", () => {
  it("listUsers marca a conta do sistema; os demais, não", async () => {
    await banco.pg.exec(`CREATE TABLE IF NOT EXISTS broker_profiles (user_id integer, notes text, default_commission_pct numeric);
      CREATE TABLE IF NOT EXISTS engineer_profiles (user_id integer, active boolean);`);
    const lista = await admin().configuracoes.listUsers();
    const id = await idDaDolores();
    expect(lista.find(u => u.id === id)?.contaDoSistema).toBe(true);
    expect(lista.filter(u => u.id !== id).every(u => u.contaDoSistema === false)).toBe(true);
  });

  it("updateUser (perfil/módulos/nome), resetPassword e deleteUser são recusados no servidor com a frase clara; nada muda", async () => {
    const id = await idDaDolores();
    const antes = await q(`SELECT role, permissions, name, "passwordHash", active FROM users WHERE id = ${id}`);
    await expect(admin().configuracoes.updateUser({ id, name: "Dolores", role: "colaborador", active: true, permissions: ["crm"] })).rejects.toThrow(FRASE_CONTA_DO_SISTEMA);
    await expect(admin().configuracoes.updateUser({ id, name: "Outro nome", role: "cliente", active: false, permissions: [] })).rejects.toThrow(FRASE_CONTA_DO_SISTEMA);
    await expect(admin().configuracoes.resetPassword({ id })).rejects.toThrow(FRASE_CONTA_DO_SISTEMA);
    await expect(admin().configuracoes.deleteUser({ id })).rejects.toThrow(FRASE_CONTA_DO_SISTEMA);
    expect(await q(`SELECT role, permissions, name, "passwordHash", active FROM users WHERE id = ${id}`)).toEqual(antes);
    await expect(usuarioDolores()).resolves.toBe(id);
  });

  it("definirContaDoSistemaAtiva: desativa e reativa a Dolores (o botão de parada) e só vale para a conta do sistema", async () => {
    const id = await idDaDolores();
    expect(await admin().configuracoes.definirContaDoSistemaAtiva({ id, active: false })).toEqual({ id, active: false });
    await expect(usuarioDolores()).rejects.toBeInstanceOf(DoloresDesativada);
    expect(await bloqueioDaOperacao()).toEqual({ motivo: "usuaria_desativada" });
    expect(await admin().configuracoes.definirContaDoSistemaAtiva({ id, active: true })).toEqual({ id, active: true });
    await expect(usuarioDolores()).resolves.toBe(id);
    const [outro] = await q<{ id: number }>(`SELECT id FROM users WHERE "openId" <> '${DOLORES_OPEN_ID}' ORDER BY id LIMIT 1`);
    await expect(admin().configuracoes.definirContaDoSistemaAtiva({ id: outro!.id, active: false })).rejects.toThrow("Só a conta do sistema");
  });

  it("não-admin não usa o botão", async () => {
    const id = await idDaDolores();
    const colaborador = appRouter.createCaller({ user: { id: 2, role: "colaborador", active: true, permissions: "[]" }, req: {}, res: {} } as never);
    await expect(colaborador.configuracoes.definirContaDoSistemaAtiva({ id, active: false })).rejects.toThrow();
    expect((await q<{ active: boolean }>(`SELECT active FROM users WHERE id = ${id}`))[0]!.active).toBe(true);
  });

  it("a tela mostra a conta como \"Conta do sistema — não editável\" e, nela, só o interruptor de ativar", () => {
    const tela = readFileSync(new URL("../../client/src/pages/admin/AdminConfiguracoes.tsx", import.meta.url), "utf8");
    expect(tela).toContain("Conta do sistema — não editável");
    expect(tela).toContain("definirContaDoSistemaAtiva.useMutation");
    // o diálogo da conta do sistema vem antes (ramo próprio) do formulário de "Gerenciar acesso"
    const ramo = tela.indexOf("usuario?.contaDoSistema ?");
    expect(ramo).toBeGreaterThan(0);
    expect(ramo).toBeLessThan(tela.indexOf("Gerenciar acesso — {usuario.name}"));
  });
});
