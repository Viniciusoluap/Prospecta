// EPIC-025 (Dolores, etapa 2) — rotas tRPC `dolores.*`: só o administrador (papel), testado pelo appRouter com o caminho
// completo (createCaller do sub-router daria falso positivo). Banco em memória (PGlite); Evolution e Anthropic falsas.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../_core/anthropic-painel.js", async orig => ({
  ...(await orig<typeof import("../_core/anthropic-painel.js")>()), existeChaveAnthropicPainel: vi.fn(), modelosAnthropicPainel: vi.fn(),
}));
vi.mock("../_core/evolution.js", async orig => ({
  ...(await orig<typeof import("../_core/evolution.js")>()),
  gerarQrCode: vi.fn(async () => ({ qrCode: "data:image/png;base64,QR", estado: "connecting" })),
  estadoInstancia: vi.fn(async () => "open"), numeroConectado: vi.fn(async () => "5599900001111"),
  registrarWebhookEvolution: vi.fn(async () => undefined), removerInstancia: vi.fn(async () => undefined),
  rejeitarLigacoesEvolution: vi.fn(async () => true),
}));
vi.mock("../whatsapp-router.js", async orig => ({ ...(await orig<typeof import("../whatsapp-router.js")>()), configEvolution: vi.fn(async () => ({ url: "https://evo", apiKey: "k", fonte: "banco" })) }));

import { ADMIN_MODULES } from "../../shared/admin-permissions.js";
import { existeChaveAnthropicPainel, modelosAnthropicPainel } from "../_core/anthropic-painel.js";
import { chaveModeloDaFuncao } from "../_core/modelo-por-funcao.js";
import { ENV } from "../_core/env.js";
import { estadoInstancia, numeroConectado, registrarWebhookEvolution, removerInstancia } from "../_core/evolution.js";
import { getDb } from "../db.js";
import { appRouter } from "../routers.js";
import { criarBanco } from "./testes-banco.js";
import { URL_WEBHOOK_DOLORES, segredoWebhookDolores } from "./whatsapp.js";

let banco: Awaited<ReturnType<typeof criarBanco>>;
const segredoAntes = ENV.cookieSecret;
const caller = (role: string, permissoes: string[] = []) =>
  appRouter.createCaller({ user: { id: 1, role, active: true, permissions: JSON.stringify(permissoes) }, req: {}, res: {} } as never);
const admin = () => caller("admin");
const cfg = async () => (await banco.pg.query<any>("SELECT * FROM dolores_whatsapp_config WHERE id = 1")).rows[0];

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(`INSERT INTO users ("openId", name, role, active, "passwordHash") VALUES ('admin', 'Admin', 'admin', true, 'h')`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  vi.mocked(existeChaveAnthropicPainel).mockResolvedValue({ existe: true, modelo: "modelo-painel" });
  vi.mocked(modelosAnthropicPainel).mockResolvedValue([{ id: "modelo-x", nome: "Modelo X", familia: "outro", lancadoEm: null }]);
});
afterEach(() => { ENV.cookieSecret = segredoAntes; vi.clearAllMocks(); });

describe("permissões (caminho completo pelo appRouter)", () => {
  const procedimentos = [
    ["status", (c: ReturnType<typeof caller>) => c.dolores.status()],
    ["conectar", (c: ReturnType<typeof caller>) => c.dolores.conectar()],
    ["statusConexao", (c: ReturnType<typeof caller>) => c.dolores.statusConexao()],
    ["confirmarConexao", (c: ReturnType<typeof caller>) => c.dolores.confirmarConexao()],
    ["ativarAvisos", (c: ReturnType<typeof caller>) => c.dolores.ativarAvisos()],
    ["desconectar", (c: ReturnType<typeof caller>) => c.dolores.desconectar()],
    ["salvar", (c: ReturnType<typeof caller>) => c.dolores.salvar({ numeroDono: "99991234567" })],
    ["ligarIa", (c: ReturnType<typeof caller>) => c.dolores.ligarIa({ ligada: true })],
  ] as const;
  for (const [nome, chamar] of procedimentos) {
    it(`${nome}: colaborador com todos os módulos, corretor, cliente, user (a própria Dolores) e admin inativo são recusados`, async () => {
      for (const c of [caller("colaborador", [...ADMIN_MODULES]), caller("corretor"), caller("cliente"), caller("user"), caller("empreiteiro")]) {
        await expect(chamar(c)).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      const inativo = appRouter.createCaller({ user: { id: 1, role: "admin", active: false }, req: {}, res: {} } as never);
      await expect(chamar(inativo)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await cfg()).toMatchObject({ ia_ligada: false, numero_dono: null, instancia: null });
    });
  }
  it("admin lê a situação: IA desligada por padrão, pendências e nada de segredo", async () => {
    const s = await admin().dolores.status();
    expect(s).toMatchObject({ iaLigada: false, chaveAnthropic: true, modeloEmUso: "modelo-painel", limites: { entrada: 0, saida: 0 }, bloqueioDoLimite: "sem_limite", webhookUrl: URL_WEBHOOK_DOLORES() });
    expect(s.pendencias.join(" ")).toMatch(/Conectar o número.*número do dono.*limites mensais.*interruptor/);
    expect(JSON.stringify(s)).not.toContain("sk-ant-");
    expect(JSON.stringify(s)).not.toContain(segredoWebhookDolores());
  });
});

describe("configuração", () => {
  it("número do dono: normalizado e guardado; a tela só vê mascarado; inválido é recusado", async () => {
    await expect(admin().dolores.salvar({ numeroDono: "123" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const s = await admin().dolores.salvar({ numeroDono: "(99) 99123-4567" });
    expect((await cfg()).numero_dono).toBe("5599991234567");
    expect(s.numeroDono).toBe("(99) *****-4567");
    expect(JSON.stringify(s)).not.toContain("991234567");
  });
  it("EPIC-024 S-11: o modelo sai do cartão (vem de Integrações › Anthropic); valor antigo do cartão é respeitado como queda", async () => {
    await expect(admin().dolores.salvar({ modelo: "modelo-x" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await admin().dolores.status()).toMatchObject({ modeloEmUso: "modelo-painel", origemModelo: "preferencial" });
    await banco.pg.exec("UPDATE dolores_whatsapp_config SET modelo = 'modelo-antigo' WHERE id = 1");
    expect(await admin().dolores.status()).toMatchObject({ modeloEmUso: "modelo-antigo", origemModelo: "anterior" });
    // o modelo escolhido para a função no painel vence o antigo
    await banco.pg.exec(`CREATE TABLE IF NOT EXISTS dashboard_settings (id serial PRIMARY KEY, key varchar(100) NOT NULL UNIQUE, value varchar(500) NOT NULL, updated_at timestamp NOT NULL DEFAULT now());
      INSERT INTO dashboard_settings (key, value) VALUES ('${chaveModeloDaFuncao("dolores_whatsapp")}', 'modelo-da-funcao')`);
    expect(await admin().dolores.status()).toMatchObject({ modeloEmUso: "modelo-da-funcao", origemModelo: "funcao" });
  });
  it("ligar a IA continua exigindo um modelo resolvido", async () => {
    vi.mocked(existeChaveAnthropicPainel).mockResolvedValue({ existe: true, modelo: null });
    await admin().dolores.salvar({ numeroDono: "99991234567", limiteEntrada: 1000, limiteSaida: 100 });
    await expect(admin().dolores.ligarIa({ ligada: true })).rejects.toThrow(/Escolher o modelo da Dolores.*Integrações › Anthropic/);
    expect((await cfg()).ia_ligada).toBe(false);
  });
  it("ligar a IA exige número do dono, chave, modelo e limites; desligar vale sempre", async () => {
    await expect(admin().dolores.ligarIa({ ligada: true })).rejects.toThrow(/Antes de ligar: .*número do dono.*limites/);
    expect((await cfg()).ia_ligada).toBe(false);
    vi.mocked(existeChaveAnthropicPainel).mockResolvedValue({ existe: false, modelo: null });
    await admin().dolores.salvar({ numeroDono: "99991234567", limiteEntrada: 1000, limiteSaida: 100 });
    await expect(admin().dolores.ligarIa({ ligada: true })).rejects.toThrow(/chave da Anthropic/);
    vi.mocked(existeChaveAnthropicPainel).mockResolvedValue({ existe: true, modelo: "modelo-painel" });
    expect((await admin().dolores.ligarIa({ ligada: true })).iaLigada).toBe(true);
    expect(await cfg()).toMatchObject({ ia_ligada: true, atualizado_por: 1 });
    expect((await admin().dolores.ligarIa({ ligada: false })).iaLigada).toBe(false);
  });
});

describe("conexão própria (QR code)", () => {
  it("conectar usa a instância da Dolores; conectado, registra o aviso próprio dela (não o da Central)", async () => {
    const r = await admin().dolores.conectar();
    expect(r).toEqual({ qrCode: "data:image/png;base64,QR", status: "aguardando_qr" });
    expect((await cfg()).instancia).toBe("prospecta-dolores");
    expect(await admin().dolores.statusConexao()).toEqual({ status: "conectado", numeroDolores: null, precisaConfirmar: true });
    const s = await admin().dolores.confirmarConexao();
    expect(s).toEqual({ status: "conectado", numeroDolores: "(99) *****-1111" });
    // Etapa 7: a instância da Dolores assina também os avisos de grupo (quem a adicionou, criação do grupo)
    expect(vi.mocked(registrarWebhookEvolution)).toHaveBeenCalledWith(expect.anything(), "prospecta-dolores", URL_WEBHOOK_DOLORES(), segredoWebhookDolores(), fetch,
      ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "GROUP_PARTICIPANTS_UPDATE", "GROUPS_UPSERT", "CALL"]); // etapa 9: e as ligações
    expect((await cfg()).numero_dolores).toBe("5599900001111");
    // não vira conexão da Central (a Central de Vendas nunca envia pelo número dela)
    expect((await banco.pg.query("SELECT * FROM whatsapp_connections")).rows).toEqual([]);
  });
  it("número já usado por CORRETOR ou igual ao do dono: desconecta e recusa; o da instância ANTIGA do admin: recusa sem derrubar a da empresa", async () => {
    await admin().dolores.conectar();
    // QA-SEG E9 achado 2 (c): a linha antiga do ADMIN com instância e o mesmo número bloqueia (o mesmo número em duas instâncias),
    // mas a instância da EMPRESA não é removida — o admin remove a antiga pelo botão de Integrações
    await banco.pg.exec(`INSERT INTO whatsapp_connections (user_id, provider, numero, status, instancia) VALUES (1, 'evolution', '559900001111', 'desconectado', 'prospecta-u1')`);
    await expect(admin().dolores.confirmarConexao()).rejects.toThrow(/conexão antiga da Central/);
    expect(vi.mocked(removerInstancia)).not.toHaveBeenCalled();
    expect((await cfg()).status_conexao).not.toBe("conectado");
    // sem instância (só o connectionId da Central da empresa), a linha do admin não conta
    await banco.pg.exec(`UPDATE whatsapp_connections SET instancia = NULL WHERE user_id = 1`);
    expect(await admin().dolores.confirmarConexao()).toMatchObject({ status: "conectado" });
    expect(vi.mocked(removerInstancia)).not.toHaveBeenCalled();
    await banco.pg.exec(`DELETE FROM whatsapp_connections; UPDATE dolores_whatsapp_config SET status_conexao = 'aguardando_qr', numero_dolores = NULL;
      INSERT INTO users ("openId", name, role, active, "passwordHash") VALUES ('cor', 'Corretor', 'corretor', true, 'h');
      INSERT INTO whatsapp_connections (user_id, provider, numero, status, instancia) SELECT id, 'evolution', '559900001111', 'conectado', 'prospecta-u2' FROM users WHERE role = 'corretor'`);
    await expect(admin().dolores.confirmarConexao()).rejects.toThrow(/já é usado por uma conexão de corretor/);
    expect(vi.mocked(removerInstancia)).toHaveBeenCalledWith(expect.anything(), "prospecta-dolores");
    expect((await cfg()).status_conexao).toBe("desconectado");
    await banco.pg.exec("DELETE FROM whatsapp_connections; UPDATE dolores_whatsapp_config SET numero_dono = '5599900001111'");
    await expect(admin().dolores.confirmarConexao()).rejects.toThrow(/número do dono/);
  });
  it("QA achado 8: statusConexao é consulta pura — conectado e com conflito, não grava, não remove e não registra aviso", async () => {
    await admin().dolores.conectar();
    await banco.pg.exec(`INSERT INTO whatsapp_connections (user_id, provider, numero, status, instancia) VALUES (1, 'evolution', '559900001111', 'conectado', 'prospecta-u1');
      UPDATE dolores_whatsapp_config SET numero_dono = '5599900001111'`);
    const antes = await cfg();
    vi.mocked(registrarWebhookEvolution).mockClear(); vi.mocked(removerInstancia).mockClear();
    for (let i = 0; i < 3; i++) expect(await admin().dolores.statusConexao()).toMatchObject({ status: "conectado", precisaConfirmar: true });
    vi.mocked(estadoInstancia).mockResolvedValueOnce("close");
    expect(await admin().dolores.statusConexao()).toMatchObject({ status: "desconectado", precisaConfirmar: false });
    expect(await cfg()).toEqual(antes);
    expect(vi.mocked(registrarWebhookEvolution)).not.toHaveBeenCalled();
    expect(vi.mocked(removerInstancia)).not.toHaveBeenCalled();
    expect(vi.mocked(numeroConectado)).not.toHaveBeenCalled();
    const procs = (appRouter as any)._def.procedures;
    expect(procs["dolores.statusConexao"]._def.type).toBe("query");
    expect(procs["dolores.confirmarConexao"]._def.type).toBe("mutation");
  });
  it("QA achado 8: número conectado vazio falha fechado (não registra aviso nem marca conectado)", async () => {
    await admin().dolores.conectar();
    for (const vazio of [null, "", "   "]) {
      vi.mocked(numeroConectado).mockResolvedValueOnce(vazio as never);
      await expect(admin().dolores.confirmarConexao()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    }
    vi.mocked(numeroConectado).mockRejectedValueOnce(new Error("rede"));
    await expect(admin().dolores.confirmarConexao()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(vi.mocked(registrarWebhookEvolution)).not.toHaveBeenCalled();
    expect(await cfg()).toMatchObject({ status_conexao: "aguardando_qr", numero_dolores: null });
  });
  it("QA r2 N5: \"Reativar recebimento\" exige a conexão confirmada e repete as conferências (falha fechada)", async () => {
    await admin().dolores.conectar();
    vi.mocked(registrarWebhookEvolution).mockClear();
    const recusa = async (preparar?: () => void | Promise<void>) => {
      if (preparar) await preparar();
      await expect(admin().dolores.ativarAvisos()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(vi.mocked(registrarWebhookEvolution)).not.toHaveBeenCalled();
    };
    // 1. conexão nunca confirmada (confirmarConexao que falhou fechado): recusa, mesmo com a Evolution dizendo "open"
    await recusa();
    await recusa(() => banco.pg.exec("UPDATE dolores_whatsapp_config SET status_conexao = 'conectado', numero_dolores = NULL"));
    await recusa(() => banco.pg.exec("UPDATE dolores_whatsapp_config SET status_conexao = 'aguardando_qr', numero_dolores = '5599900001111'"));
    // 2. confirmada, mas a Evolution não está "open", não lê o número ou o número mudou
    await banco.pg.exec("UPDATE dolores_whatsapp_config SET status_conexao = 'conectado', numero_dolores = '5599900001111'");
    await recusa(() => { vi.mocked(estadoInstancia).mockResolvedValueOnce("close"); });
    await recusa(() => { vi.mocked(estadoInstancia).mockRejectedValueOnce(new Error("rede")); });
    await recusa(() => { vi.mocked(numeroConectado).mockResolvedValueOnce("" as never); });
    await recusa(() => { vi.mocked(numeroConectado).mockRejectedValueOnce(new Error("rede")); });
    await recusa(() => { vi.mocked(numeroConectado).mockResolvedValueOnce("5599900002222"); });
    // 3. número da empresa ou do dono
    // etapa 9: o número de uma conexão de CORRETOR (a do admin é a mesma conexão da empresa e não conta)
    await recusa(() => banco.pg.exec(`INSERT INTO users ("openId", name, role, active, "passwordHash") VALUES ('cor', 'Corretor', 'corretor', true, 'h');
      INSERT INTO whatsapp_connections (user_id, provider, numero, status, instancia) SELECT id, 'evolution', '559900001111', 'conectado', 'prospecta-u2' FROM users WHERE role = 'corretor'`));
    await banco.pg.exec("DELETE FROM whatsapp_connections");
    await recusa(() => banco.pg.exec("UPDATE dolores_whatsapp_config SET numero_dono = '5599900001111'"));
    await banco.pg.exec("UPDATE dolores_whatsapp_config SET numero_dono = NULL");
    // 4. tudo confere: registra
    expect(await admin().dolores.ativarAvisos()).toMatchObject({ ok: true });
    expect(vi.mocked(registrarWebhookEvolution)).toHaveBeenCalledTimes(1);
  });
});
