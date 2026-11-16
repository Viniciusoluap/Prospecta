// EPIC-025 (Dolores, etapa 2) — rotas tRPC `dolores.*`: só o administrador (papel), testado pelo appRouter com o caminho
// completo (createCaller do sub-router daria falso positivo). Banco em memória (PGlite); Evolution e Anthropic falsas.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../_core/anthropic-painel.js", async orig => ({
  ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn(), modelosAnthropicPainel: vi.fn(),
}));
vi.mock("../_core/evolution.js", async orig => ({
  ...(await orig<typeof import("../_core/evolution.js")>()),
  gerarQrCode: vi.fn(async () => ({ qrCode: "data:image/png;base64,QR", estado: "connecting" })),
  estadoInstancia: vi.fn(async () => "open"), numeroConectado: vi.fn(async () => "5599900001111"),
  registrarWebhookEvolution: vi.fn(async () => undefined), removerInstancia: vi.fn(async () => undefined),
}));
vi.mock("../whatsapp-router.js", async orig => ({ ...(await orig<typeof import("../whatsapp-router.js")>()), configEvolution: vi.fn(async () => ({ url: "https://evo", apiKey: "k", fonte: "banco" })) }));

import { ADMIN_MODULES } from "../../shared/admin-permissions.js";
import { configuracaoAnthropicPainel, modelosAnthropicPainel } from "../_core/anthropic-painel.js";
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
  vi.mocked(configuracaoAnthropicPainel).mockResolvedValue({ apiKey: "sk-ant-teste-123456789012345", modelo: "modelo-painel" });
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
  it("modelo próprio só se a chave do painel o oferece; vazio volta ao preferencial", async () => {
    await expect(admin().dolores.salvar({ modelo: "inventado" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await admin().dolores.salvar({ modelo: "modelo-x" })).modeloEmUso).toBe("modelo-x");
    expect((await admin().dolores.salvar({ modelo: null })).modeloEmUso).toBe("modelo-painel");
  });
  it("ligar a IA exige número do dono, chave, modelo e limites; desligar vale sempre", async () => {
    await expect(admin().dolores.ligarIa({ ligada: true })).rejects.toThrow(/Antes de ligar: .*número do dono.*limites/);
    expect((await cfg()).ia_ligada).toBe(false);
    vi.mocked(configuracaoAnthropicPainel).mockResolvedValue(null);
    await admin().dolores.salvar({ numeroDono: "99991234567", limiteEntrada: 1000, limiteSaida: 100 });
    await expect(admin().dolores.ligarIa({ ligada: true })).rejects.toThrow(/chave da Anthropic/);
    vi.mocked(configuracaoAnthropicPainel).mockResolvedValue({ apiKey: "sk-ant-teste-123456789012345", modelo: "modelo-painel" });
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
    expect(vi.mocked(registrarWebhookEvolution)).toHaveBeenCalledWith(expect.anything(), "prospecta-dolores", URL_WEBHOOK_DOLORES(), segredoWebhookDolores());
    expect((await cfg()).numero_dolores).toBe("5599900001111");
    // não vira conexão da Central (a Central de Vendas nunca envia pelo número dela)
    expect((await banco.pg.query("SELECT * FROM whatsapp_connections")).rows).toEqual([]);
  });
  it("número já usado pela empresa ou igual ao do dono: desconecta e recusa", async () => {
    await admin().dolores.conectar();
    await banco.pg.exec(`INSERT INTO whatsapp_connections (user_id, provider, numero, status, instancia) VALUES (1, 'evolution', '559900001111', 'conectado', 'prospecta-u1')`);
    await expect(admin().dolores.confirmarConexao()).rejects.toThrow(/já é usado por uma conexão da empresa/);
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
});
