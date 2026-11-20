// QA de SEGURANÇA da EPIC-025 E9 (20/11/2026) — regressão das CORREÇÕES dos achados do portão (um bloco por achado).
// PGlite; nada sai para a rede (fetch da Evolution simulado). Tudo pelo `appRouter` (colaborador e admin) ou pelos avisos reais.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));

import { ADMIN_MODULES } from "../../shared/admin-permissions.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { appRouter } from "../routers.js";
import { gravarItemNaCentral, processarEventoEvolution } from "../whatsapp-evolution-webhook.js";
import { identificarRemetente } from "./roteamento.js";
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
const envios = () => enviados.filter(e => e.url.includes("/message/sendText/"));

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}',
    numero_dolores = '${EMPRESA}' WHERE id = 1;
    CREATE TABLE IF NOT EXISTS whatsapp_evolution_settings (id integer PRIMARY KEY, url text NOT NULL, api_key_encrypted text NOT NULL, updated_at timestamp DEFAULT now());
    INSERT INTO users ("openId", name, role, active, "passwordHash", phone) VALUES ('cor', 'Carlos Corretor', 'corretor', true, 'hash', '99944443333');`);
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

/** A linha do 1º admin (connectionId da Central da empresa) com o histórico já gravado: dono, empresa e um cliente. */
async function historicoComDonoEEmpresa() {
  await caller("admin", 1).whatsapp.minhaConexao(); // cria a linha do 1º admin (sem instância), como em produção
  const [{ id }] = await q<{ id: number }>("SELECT id FROM whatsapp_connections WHERE user_id = 1");
  await banco.pg.exec(`INSERT INTO whatsapp_messages (connection_id, lead_id, destinatario, mensagem, status, direcao, lida, external_id) VALUES
    (${id}, 1, '${DONO}', 'Dolores, relatório do caixa', 'enviada', 'saida', true, 'H1'),
    (${id}, NULL, '${EMPRESA}', 'Resumo do dia: caixa 12.000', 'recebida', 'entrada', false, 'H2'),
    (${id}, NULL, '99991234567', 'Dono sem o 55', 'recebida', 'entrada', false, 'H3'),
    (${id}, 2, '${JOAO}', 'Oi, aqui é o João', 'recebida', 'entrada', false, 'H4');`);
  return id;
}

describe("achado 1 — a Central da empresa nunca escreve, lista nem abre a conversa do dono ou do próprio número", () => {
  for (const [papel, id] of [["colaborador", 2], ["admin", 1]] as const) {
    it(`${papel}: responder ao dono (com e sem 55, formatado) e ao número da empresa é recusado; nada sai nem é gravado`, async () => {
      for (const numero of [DONO, "99991234567", "(99) 99123-4567", "559991234567", EMPRESA]) {
        await expect(caller(papel, id).whatsapp.responder({ numero, texto: "Dolores: responda 'aprovar ABC'." })).rejects.toThrow(/número do dono/);
      }
      expect(envios()).toHaveLength(0);
      expect(await q("SELECT count(*)::int AS n FROM whatsapp_messages WHERE mensagem LIKE '%aprovar ABC%'")).toEqual([{ n: 0 }]);
      // cliente comum continua normal
      await caller(papel, id).whatsapp.responder({ numero: JOAO, texto: "Oi João" });
      expect(envios().map(e => e.corpo.number)).toEqual([JOAO]);
    });

    it(`${papel}: Enviar mensagem/Templates para lead cujo telefone é o do dono é recusado no servidor`, async () => {
      // lead 1 (Maria) tem o telefone do dono no cenário
      const r = await caller(papel, id).whatsapp.enviar({ mensagem: "Oferta", destinatarios: [{ id: 1, nome: "x", telefone: "1" }] });
      expect(r).toMatchObject({ success: false, enviadas: 0 });
      expect(String(r.error)).toMatch(/número do dono/);
      expect(envios()).toHaveLength(0);
    });

    it(`${papel}: o histórico já gravado com o dono/a empresa some de Conversas, da conversa, do Histórico e das ações`, async () => {
      await historicoComDonoEEmpresa();
      const conversas = await caller(papel, id).whatsapp.conversas();
      expect(conversas.map(c => c.numero)).toEqual([JOAO]);
      for (const numero of [DONO, "99991234567", EMPRESA]) {
        expect(await caller(papel, id).whatsapp.mensagensConversa({ numero })).toEqual([]);
        await expect(caller(papel, id).whatsapp.excluirConversa({ numero })).rejects.toThrow(/número do dono/);
        await expect(caller(papel, id).whatsapp.vincularLead({ numero, leadId: 2 })).rejects.toThrow(/número do dono/);
        await expect(caller(papel, id).whatsapp.criarLeadDaConversa({ numero, forcar: true })).rejects.toThrow(/número do dono/);
      }
      // nada marcado como lido nem apagado
      expect(await q("SELECT count(*)::int AS n FROM whatsapp_messages WHERE external_id IN ('H1','H2','H3')")).toEqual([{ n: 3 }]);
      expect(await q("SELECT count(*)::int AS n FROM whatsapp_messages WHERE external_id IN ('H2','H3') AND lida")).toEqual([{ n: 0 }]);
      expect(await caller(papel, id).whatsapp.previaExclusaoConversas({ numeros: [DONO, EMPRESA, JOAO] })).toEqual({ conversas: 1, mensagens: 1 });
      const historico = await caller(papel, id).whatsapp.historico();
      expect(historico.some(m => m.mensagem.includes("relatório do caixa"))).toBe(false);
      // a mídia/mensagem do dono também não abre pela rota de acesso
      const [{ id: msgDono }] = await q<{ id: number }>("SELECT id FROM whatsapp_messages WHERE external_id = 'H1'");
      await expect(caller(papel, id).whatsapp.baixarMidiaDeNovo({ id: msgDono })).rejects.toThrow(/sem arquivo/);
      // a do cliente continua
      expect((await caller(papel, id).whatsapp.mensagensConversa({ numero: JOAO })).map(m => m.mensagem)).toEqual(["Oi, aqui é o João"]);
    });
  }

  it("falha ao conferir o número do dono → fecha: não envia e não lista", async () => {
    await historicoComDonoEEmpresa();
    await banco.pg.exec("ALTER TABLE dolores_whatsapp_config RENAME TO dolores_whatsapp_config_x");
    await expect(caller("colaborador", 2).whatsapp.responder({ numero: JOAO, texto: "Oi" })).rejects.toThrow();
    expect(await caller("colaborador", 2).whatsapp.conversas()).toEqual([]);
    expect(envios()).toHaveLength(0);
  });

  it("corretor pela conexão PRÓPRIA não é afetado (o número do dono só é reservado na conexão da empresa)", async () => {
    await banco.pg.exec(`INSERT INTO whatsapp_connections (user_id, provider, instancia, status) VALUES (3, 'evolution', 'prospecta-u3', 'conectado');
      UPDATE leads SET broker_id = 3 WHERE id = 1;`);
    // o telefone do dono é um lead do corretor: pelo celular do próprio corretor ele fala com o dono como sempre
    await caller("corretor", 3, []).whatsapp.responder({ numero: DONO, texto: "Oi, Carlos aqui" });
    expect(envios().map(e => e.url)).toEqual(["https://evolution.exemplo.invalid/message/sendText/prospecta-u3"]);
  });
});

describe("achado 2 — a instância antiga da Central do admin/colaborador", () => {
  const antiga = (instancia = "prospecta-u1", numero: string | null = null) => banco.pg.exec(`INSERT INTO whatsapp_connections (user_id, provider, instancia, status, numero)
    VALUES (1, 'evolution', '${instancia}', 'desconectado', ${numero ? `'${numero}'` : "NULL"})`);
  const eco = (instance: string, id: string, fromMe = false) => processarEventoEvolution({ event: "messages.upsert", instance,
    data: { key: { remoteJid: `${JOAO}@s.whatsapp.net`, fromMe, id }, message: { conversation: `mensagem ${id}` }, messageTimestamp: Math.floor(Date.now() / 1000) } });

  it("(a) aviso da instância gravada na linha de admin OU colaborador não grava mensagem nem situação; a do corretor grava", async () => {
    await antiga();
    await banco.pg.exec(`INSERT INTO whatsapp_connections (user_id, provider, instancia, status) VALUES (2, 'evolution', 'prospecta-u2', 'conectado'),
      (3, 'evolution', 'prospecta-u3', 'conectado')`);
    expect(await eco("prospecta-u1", "A1")).toBe("instancia-antiga-da-empresa");
    expect(await eco("prospecta-u2", "A2", true)).toBe("instancia-antiga-da-empresa");
    expect(await processarEventoEvolution({ event: "connection.update", instance: "prospecta-u1", data: { state: "open" } })).toBe("instancia-antiga-da-empresa");
    expect(await q("SELECT status FROM whatsapp_connections WHERE user_id = 1")).toEqual([{ status: "desconectado" }]);
    expect(await q("SELECT count(*)::int AS n FROM whatsapp_messages WHERE external_id IN ('A1','A2')")).toEqual([{ n: 0 }]);
    expect(await q("SELECT count(*)::int AS n FROM user_notifications WHERE message LIKE 'mensagem A%'")).toEqual([{ n: 0 }]);
    // corretor (conecta pela própria aba) continua como sempre
    expect(await eco("prospecta-u3", "A3")).toBe("mensagens:1");
  });

  it("(b) só o ADMIN por papel vê e remove; remove a instância antiga sem seguir redirecionamento e limpa só instância/situação", async () => {
    await antiga("prospecta-u1", DONO);
    await expect(caller("colaborador", 2, ADMIN_MODULES).dolores.conexaoAntiga()).rejects.toThrow();
    await expect(caller("colaborador", 2, ADMIN_MODULES).dolores.removerConexaoAntiga()).rejects.toThrow();
    expect(await q("SELECT instancia FROM whatsapp_connections WHERE user_id = 1")).toEqual([{ instancia: "prospecta-u1" }]);
    const vista = await caller("admin", 1).dolores.conexaoAntiga();
    expect(vista.existe).toBe(true);
    expect(JSON.stringify(vista)).not.toContain(DONO);
    expect(await caller("admin", 1).dolores.removerConexaoAntiga()).toEqual({ ok: true, removidas: 1 });
    expect(enviados.map(e => e.url)).toEqual(["https://evolution.exemplo.invalid/instance/logout/prospecta-u1", "https://evolution.exemplo.invalid/instance/delete/prospecta-u1"]);
    // a linha continua (é o connectionId do histórico); a configuração da empresa não muda
    expect(await q("SELECT instancia, status, numero FROM whatsapp_connections WHERE user_id = 1")).toEqual([{ instancia: null, status: "desconectado", numero: DONO }]);
    expect(await q("SELECT instancia, status_conexao FROM dolores_whatsapp_config")).toEqual([{ instancia: "prospecta-dolores", status_conexao: "conectado" }]);
    expect(await caller("admin", 1).dolores.conexaoAntiga()).toMatchObject({ existe: false });
    expect(await q("SELECT funcao, resultado FROM dolores_acoes WHERE funcao = 'remover_conexao_antiga_central'")).toEqual([{ funcao: "remover_conexao_antiga_central", resultado: "ok" }]);
  });

  it("(b) a instância da empresa nunca é removida por esse botão (nem se aparecer gravada na linha do admin)", async () => {
    await antiga("prospecta-dolores");
    expect(await caller("admin", 1).dolores.conexaoAntiga()).toMatchObject({ existe: false });
    expect(await caller("admin", 1).dolores.removerConexaoAntiga()).toEqual({ ok: true, removidas: 0 });
    expect(enviados).toHaveLength(0);
  });

  it("(c) confirmar/reativar com o número que está na instância antiga: recusado, nada ativado e a instância da empresa NÃO é removida", async () => {
    await antiga("prospecta-u1", EMPRESA);
    await banco.pg.exec("UPDATE dolores_whatsapp_config SET status_conexao = 'aguardando_qr', numero_dolores = NULL");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      enviados.push({ url: String(url), corpo: null });
      const corpo = String(url).includes("connectionState") ? { instance: { state: "open" } } : String(url).includes("fetchInstances") ? [{ ownerJid: `${EMPRESA}@s.whatsapp.net`, name: "prospecta-dolores", number: EMPRESA }] : {};
      return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
    }));
    await expect(caller("admin", 1).dolores.confirmarConexao()).rejects.toThrow(/conexão antiga da Central/);
    expect(enviados.some(e => e.url.includes("/instance/logout/") || e.url.includes("/instance/delete/") || e.url.includes("/webhook/set"))).toBe(false);
    expect(await q("SELECT instancia, status_conexao FROM dolores_whatsapp_config")).toEqual([{ instancia: "prospecta-dolores", status_conexao: "aguardando_qr" }]);
    // depois de remover a antiga, confirma normalmente
    await caller("admin", 1).dolores.removerConexaoAntiga();
    expect(await caller("admin", 1).dolores.confirmarConexao()).toMatchObject({ status: "conectado" });
  });
});

describe("achado 4 — quem escreveu é procurado no banco pelos 8 finais, sem tabela inteira e sem corte silencioso", () => {
  it("com mais de 20.000 leads, o cliente cadastrado por último é achado; homônimo vira 'varios'; a Central reaproveita os candidatos", async () => {
    await banco.pg.exec(`INSERT INTO leads (name, phone, city, stage, created_at, updated_at)
      SELECT 'Lead ' || i, '119' || lpad(i::text, 8, '0'), 'São Paulo', 'attending', now(), now() FROM generate_series(1, 20050) AS i;
      INSERT INTO leads (name, phone, city, stage, created_at, updated_at) VALUES ('Rita Nova', '(99) 95555-1234', 'Imperatriz', 'attending', now(), now()),
        ('Outro DDD', '(11) 95555-1234', 'São Paulo', 'attending', now(), now());`);
    const [{ id: rita }] = await q<{ id: number }>("SELECT id FROM leads WHERE name = 'Rita Nova'");
    expect(rita).toBeGreaterThan(20_000);
    const quem = await identificarRemetente("5599955551234");
    expect(quem).toMatchObject({ categoria: "cliente", leadId: rita, cadastros: 1 });
    // só vieram os candidatos com os mesmos 8 finais (Rita e o de outro DDD), não a tabela
    expect(quem.candidatos?.map(c => c.nome)).toEqual(expect.arrayContaining(["Rita Nova", "Outro DDD"]));
    expect(quem.candidatos).toHaveLength(2);
    // gravar na Central com os candidatos do roteamento (reaproveitados): o lead certo (o DDD confere; o de outro DDD não)
    await caller("admin", 1).whatsapp.minhaConexao();
    const [conn] = await q<{ id: number; user_id: number }>("SELECT id, user_id FROM whatsapp_connections WHERE user_id = 1");
    const item = { key: { remoteJid: "5599955551234@s.whatsapp.net", fromMe: false, id: "R1" }, message: { conversation: "oi" }, pushName: "Rita" };
    const g = await gravarItemNaCentral({ id: conn.id, userId: 1, instancia: null }, item, { notificar: false, leadsCandidatos: quem.candidatos });
    expect(g.leadId).toBe(rita);
    // sem candidatos: a própria gravação filtra no banco e acha o mesmo
    const g2 = await gravarItemNaCentral({ id: conn.id, userId: 1, instancia: null }, { ...item, key: { ...item.key, id: "R2" } }, { notificar: false });
    expect(g2.leadId).toBe(rita);
    // outro cadastro (financiamento de outro lead) com o mesmo telefone → vários (nunca adivinha)
    await banco.pg.exec(`UPDATE financiamentos SET cliente_tel = '99955551234' WHERE lead_id = 2`);
    expect(await identificarRemetente("5599955551234")).toMatchObject({ categoria: "varios", cadastros: 2 });
    // número curto demais: ninguém
    expect((await identificarRemetente("1234")).categoria).toBe("desconhecido");
  });

  it("a 0135 cria os índices de expressão (os 8 finais) nas seis tabelas consultadas", async () => {
    const idx = await q<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE indexname LIKE '%telefone_final8_idx' ORDER BY indexname");
    expect(idx.map(i => i.indexname)).toEqual(["avaliacoes_telefone_final8_idx", "financiamentos_telefone_final8_idx", "leads_telefone_final8_idx",
      "operational_projects_telefone_final8_idx", "regularizacoes_telefone_final8_idx", "users_telefone_final8_idx"]);
  });
});
