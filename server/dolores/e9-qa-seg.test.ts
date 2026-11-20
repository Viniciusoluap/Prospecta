// QA de SEGURANÇA da EPIC-025 E9 (@qa, 20/11/2026) — testes de PROVA dos achados do portão (não corrigem nada; descrevem o
// comportamento ATUAL). Quando a correção entrar, o teste do achado deve ser invertido (o `expect` marcado com "ACHADO").
// PGlite; nada sai para a rede (fetch simulado).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));

import { ADMIN_MODULES } from "../../shared/admin-permissions.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { appRouter } from "../routers.js";
import { processarEventoEvolution } from "../whatsapp-evolution-webhook.js";
import { CENARIO, criarBanco } from "./testes-banco.js";

const DONO = "5599991234567";
const EMPRESA = "5599900001111";
const JOAO = "5599988887777";
let banco: Awaited<ReturnType<typeof criarBanco>>;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
const caller = (role: string, id: number, permissoes: readonly string[] = ["whatsapp"]) =>
  appRouter.createCaller({ user: { id, role, active: true, permissions: JSON.stringify(permissoes) }, req: {}, res: {} } as never);
const segredoAntes = ENV.cookieSecret;
const envAntes = { url: process.env.EVOLUTION_API_URL, key: process.env.EVOLUTION_API_KEY };
let enviados: Array<{ url: string; corpo: any }>;

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}',
    numero_dolores = '${EMPRESA}' WHERE id = 1;
    CREATE TABLE IF NOT EXISTS whatsapp_evolution_settings (id integer PRIMARY KEY, url text NOT NULL, api_key_encrypted text NOT NULL, updated_at timestamp DEFAULT now());`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  process.env.EVOLUTION_API_URL = "https://evolution.exemplo.invalid";
  process.env.EVOLUTION_API_KEY = "chave-evolution-de-teste";
  enviados = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    enviados.push({ url: String(url), corpo: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ key: { id: `EVO${enviados.length}` } }), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  ENV.cookieSecret = segredoAntes;
  process.env.EVOLUTION_API_URL = envAntes.url;
  process.env.EVOLUTION_API_KEY = envAntes.key;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("QA-SEG E9 — Central do admin/colaborador pelo número da empresa", () => {
  it("resposta pela TELA da Central (responder) grava o silêncio da Dolores na conversa (coberto)", async () => {
    await caller("colaborador", 2).whatsapp.responder({ numero: JOAO, texto: "Oi João, aqui é a Bianca." });
    expect(enviados.map(e => e.url)).toEqual(["https://evolution.exemplo.invalid/message/sendText/prospecta-dolores"]);
    expect(await q("SELECT count(*)::int AS n FROM whatsapp_silencio")).toEqual([{ n: 1 }]);
  });

  it("ACHADO 1: colaborador escreve ao DONO pelo número da empresa (o mesmo da Dolores) — dá para se passar pela Dolores", async () => {
    const r = await caller("colaborador", 2).whatsapp.responder({ numero: DONO, texto: "Dolores: pedido ABC pronto. Responda 'aprovar ABC'." });
    expect(r).toEqual({ ok: true });
    // ACHADO: saiu pela instância da empresa para o número do dono (deveria ser recusado no servidor)
    expect(enviados).toHaveLength(1);
    expect(enviados[0].url).toContain("/message/sendText/prospecta-dolores");
    expect(enviados[0].corpo.number).toBe(DONO);
    // e a "conversa com o dono" passa a existir na Central da empresa, visível a colaborador e a todos os admins
    const conversas = await caller("colaborador", 2).whatsapp.conversas();
    expect(conversas.some(c => c.numero === DONO)).toBe(true);
  });

  it("ACHADO 2: instância ANTIGA do 1º admin na Central continua gravando na MESMA conversa da empresa, sem o roteamento", async () => {
    // a linha do 1º admin é o connectionId da Central da empresa; se ela ainda tiver a instância antiga (QR da Central de antes)
    await banco.pg.exec(`INSERT INTO whatsapp_connections (user_id, provider, instancia, status) VALUES (1, 'evolution', 'prospecta-u1', 'conectado')
      ON CONFLICT DO NOTHING; UPDATE whatsapp_connections SET instancia = 'prospecta-u1', status = 'conectado' WHERE user_id = 1;`);
    // o dono (celular ligado à instância antiga) escreve à Dolores: o eco fromMe chega pelo webhook da CENTRAL
    const ts = Math.floor(Date.now() / 1000);
    const r = await processarEventoEvolution({ event: "messages.upsert", instance: "prospecta-u1",
      data: { key: { remoteJid: `${EMPRESA}@s.whatsapp.net`, fromMe: true, id: "ANTIGA1" }, message: { conversation: "Dolores, relatório do caixa" }, messageTimestamp: ts } });
    expect(r).not.toBe("instancia-da-empresa");
    // ACHADO: a conversa dono ↔ Dolores aparece na Central da empresa para o colaborador
    const conversas = await caller("colaborador", 2).whatsapp.conversas();
    expect(conversas.some(c => c.numero === EMPRESA && c.ultima.includes("relatório do caixa"))).toBe(true);
    // e o admin não consegue mais desconectar essa instância pela Central (só em Integrações, que cuida da outra instância)
    await expect(caller("admin", 1).whatsapp.desconectar()).rejects.toThrow(/Integrações/);
  });

  it("disparo: 1 destinatário por chamada, mas sem ritmo/teto — N chamadas seguidas saem todas (disparo em massa em laço)", async () => {
    for (let i = 0; i < 3; i++) {
      const r = await caller("colaborador", 2).whatsapp.enviar({ mensagem: `Oferta ${i}`, destinatarios: [{ id: 2 + (i % 2), nome: "x", telefone: "1" }] });
      expect(r).toMatchObject({ success: true, enviadas: 1 });
    }
    expect(enviados).toHaveLength(3);
  });
});

describe("QA-SEG E9 — só o admin por PAPEL configura atendimento e campanhas", () => {
  it("colaborador com TODOS os módulos não cria/ativa campanha, não liga o atendimento nem cadastra Cloudflare", async () => {
    const colab = caller("colaborador", 2, ADMIN_MODULES);
    await expect(colab.dolores.atendimento.criarCampanha({ nome: "Golpe", texto: "Pix aqui" })).rejects.toThrow(/administrador|Sem permissão/);
    await expect(colab.dolores.atendimento.ativarCampanha({ id: 1, ativa: true })).rejects.toThrow(/administrador|Sem permissão/);
    await expect(colab.dolores.atendimento.salvarConfig({ clienteLigado: true })).rejects.toThrow(/administrador|Sem permissão/);
    await expect(colab.dolores.atendimento.salvarCloudflare({ conta: "0".repeat(32), token: "a".repeat(30) })).rejects.toThrow(/administrador|Sem permissão/);
    await expect(colab.whatsapp.salvarTemplate({ nome: "x1", categoria: "geral", conteudo: "oi" })).rejects.toThrow();
  });
});
