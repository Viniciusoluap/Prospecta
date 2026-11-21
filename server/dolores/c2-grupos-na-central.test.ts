// EPIC-027 C2 — grupos do WhatsApp na Central: permissão própria por colaborador ("Grupos do WhatsApp", desmarcada por padrão),
// conferida no SERVIDOR em todas as rotas (appRouter); recusado nunca aparece; "aguardando o dono" só para o admin; a conversa do
// dono nunca aparece; escrever no grupo registra quem enviou e respeita os tetos; o envio pela Central não é comando, não marca a
// Dolores e o eco não duplica; "Assumir (humano)" cala a Dolores no grupo; classificar pela Central segue as travas do C3.
// PGlite; nada sai para a rede (a Evolution é um fetch falso).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../whatsapp-router.js", async orig => ({ ...(await orig<typeof import("../whatsapp-router.js")>()), configEvolution: vi.fn(async () => null) }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { ADMIN_MODULES, ADMIN_MODULE_LABELS, AVISO_PERMISSAO_GRUPOS_WHATSAPP, parsePermissions } from "../../shared/admin-permissions.js";
import { podeVerGruposNaCentral, textoDaMensagemDeGrupo } from "../../shared/whatsapp/grupos-central.js";
import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { appRouter } from "../routers.js";
import { configEvolution } from "../whatsapp-router.js";
import { definirClienteModelo } from "./cerebro.js";
import { definirDependenciasClassificacao } from "./classificacao.js";
import { definirDependenciasMarcacao, type RespostaGrupo } from "./marcacao.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte } from "./ponte.js";
import { definirDependenciasRoteamento } from "./roteamento.js";
import { AGORA, CENARIO, MIGRACAO_0142, criarBanco } from "./testes-banco.js";
import { definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";

const DONO = "5599991234567";
const DOLORES = "5599900001111";
const CLIENTE = "5599977776666";
const J = (n: number) => `12036310000000000${n}@g.us`;
let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviarAoDono: ReturnType<typeof vi.fn>;
let enviarAoGrupo: ReturnType<typeof vi.fn>;
let evolucao: ReturnType<typeof vi.fn>;
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
const n = async (sql: string) => Number((await q<{ n: number }>(sql))[0].n);

type Papel = { role: string; permissoes?: string[]; id?: number; ativo?: boolean };
const caller = (p: Papel | null) => appRouter.createCaller({
  user: p ? { id: p.id ?? 1, role: p.role, active: p.ativo ?? true, permissions: JSON.stringify(p.permissoes ?? []) } : null, req: {}, res: {},
} as never);
const ADMIN: Papel = { role: "admin", id: 1 };
const COLAB_COM: Papel = { role: "colaborador", id: 2, permissoes: ["whatsapp", "whatsappGrupos"] };
const COLAB_SEM: Papel = { role: "colaborador", id: 2, permissoes: ["whatsapp"] };

let seq = 0;
const quando = (s = 20) => Math.floor((AGORA.getTime() - s * 1000) / 1000);
/** Mensagem de participante num grupo (com a menção REAL à Dolores, se `marcar`). */
const doGrupo = (jid: string, texto: string, o: { marcar?: boolean; nome?: string; de?: string; fromMe?: boolean; id?: string } = {}) => ({
  key: { remoteJid: jid, fromMe: o.fromMe ?? false, id: o.id ?? `C2G${++seq}`, participant: `${o.de ?? CLIENTE}@s.whatsapp.net` },
  pushName: o.nome ?? "Maria do Grupo",
  message: o.marcar ? { extendedTextMessage: { text: `@${DOLORES} ${texto}`, contextInfo: { mentionedJid: [`${DOLORES}@s.whatsapp.net`] } } } : { conversation: texto },
  messageTimestamp: quando(),
});
const chamar = (...itens: unknown[]) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() },
  body: { event: "messages.upsert", instance: "prospecta-dolores", data: itens.length === 1 ? itens[0] : itens }, ip: "203.0.113.9" } as never);

// 1 cliente (aceito), 2 administrativo (sócios), 3 aguardando o dono (o dono a pôs; falta o tipo), 4 RECUSADO, 5 desativado,
// 6 aguardando o dono SEM prova de quem a pôs, 7 outra instância, 8 grupo de cliente sem vínculo (aceito, tipo vazio).
const GRUPOS = `INSERT INTO dolores_grupos (instancia, grupo_jid, nome, nome_whatsapp, ativo, tipo, lead_id, origem, situacao_confirmacao, codigo, adicionado_por, prova_adicao) VALUES
  ('prospecta-dolores', '${J(1)}', 'Família Maria', 'Família Maria', true, 'cliente', 1, 'automatico', 'confirmado', 'KAAA', 'dono', 'evento_add'),
  ('prospecta-dolores', '${J(2)}', 'Sócios', 'Sócios Administrativo', true, 'administrativo', NULL, 'automatico', 'confirmado', 'KCCC', 'dono', 'evento_add'),
  ('prospecta-dolores', '${J(3)}', 'Turma B', 'Turma B', true, 'indefinido', NULL, 'automatico', 'aguardando_dono', 'KDDD', 'dono', 'evento_add'),
  ('prospecta-dolores', '${J(4)}', 'Turma D', 'Turma D', true, 'juridico', NULL, 'automatico', 'recusado', 'KEEE', 'outra_pessoa', 'evento_add'),
  ('prospecta-dolores', '${J(5)}', 'Antigo', 'Antigo', false, 'cliente', 2, 'manual', 'confirmado', 'KFFF', NULL, NULL),
  ('prospecta-dolores', '${J(6)}', 'Turma C', 'Turma C', true, 'indefinido', NULL, 'automatico', 'aguardando_dono', 'KGGG', 'desconhecido', 'sem_prova'),
  ('outra-instancia', '${J(7)}', 'De outra conta', 'De outra conta', true, 'cliente', 3, 'automatico', 'confirmado', 'KHHH', 'dono', 'evento_add'),
  ('prospecta-dolores', '${J(8)}', 'Cliente novo', 'Cliente novo', true, NULL, NULL, 'manual', 'confirmado', 'KJJJ', NULL, NULL);`;

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}',
      numero_dolores = '${DOLORES}', ia_ligada = true, limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;
    ${GRUPOS}
    -- a Dolores responde quando marcada nos grupos 1 e 2 (interruptores ligados): o teste prova que o envio da equipe não a aciona
    UPDATE dolores_marcacoes_config SET responder_ligado = true WHERE id = 1;
    INSERT INTO dolores_marcacoes_grupo (grupo_id, responder_ligado) VALUES (1, true), (2, true);`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  esquecerUsuarioDolores();
  definirDependenciasPonte({ agora: () => AGORA });
  definirDependenciasRoteamento({ agora: () => AGORA });
  enviarAoDono = vi.fn(async () => true);
  definirDependenciasWhatsapp({ agora: () => AGORA, enviar: enviarAoDono as never });
  vi.mocked(configuracaoAnthropicPainel).mockResolvedValue({ apiKey: "sk-ant-chave-de-teste-nao-real-123456", modelo: "modelo-do-painel" });
  definirClienteModelo((async () => { throw new Error("o laço do dono não roda por mensagem de grupo"); }) as never);
  definirDependenciasClassificacao({ cliente: async () => { throw new Error("nada aqui classifica"); } });
  enviarAoGrupo = vi.fn(async () => true);
  const resposta: RespostaGrupo = { stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 60 }, content: [{ type: "text", text: "Seu processo está na etapa Protocolo na prefeitura." }] };
  definirDependenciasMarcacao({ agora: () => AGORA, enviar: enviarAoGrupo as never, contador: async () => 1_000, cliente: async () => resposta });
  vi.mocked(configEvolution).mockResolvedValue({ url: "https://evolution.teste", apiKey: "chave-evolution-teste", fonte: "banco" });
  let id = 0;
  evolucao = vi.fn(async () => new Response(JSON.stringify({ key: { id: `EQUIPE${++id}` } }), { status: 201, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", evolucao);
});
afterEach(() => {
  ENV.cookieSecret = segredoAntes;
  definirDependenciasPonte(); definirDependenciasWhatsapp(); definirClienteModelo(); definirDependenciasClassificacao(); definirDependenciasMarcacao(); definirDependenciasRoteamento();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const ROTAS = {
  listar: (c: ReturnType<typeof caller>) => c.whatsappGrupos.listar(),
  mensagens: (c: ReturnType<typeof caller>) => c.whatsappGrupos.mensagens({ grupoId: 1 }),
  enviar: (c: ReturnType<typeof caller>) => c.whatsappGrupos.enviar({ grupoId: 1, texto: "Bom dia, pessoal" }),
  atendimento: (c: ReturnType<typeof caller>) => c.whatsappGrupos.atendimento({ grupoId: 1 }),
  mudarAtendimento: (c: ReturnType<typeof caller>) => c.whatsappGrupos.mudarAtendimento({ grupoId: 1, acao: "assumir" }),
};

describe("C2 — permissão 'Grupos do WhatsApp' (cadastro e servidor)", () => {
  it("é um campo do cadastro (mesmo mecanismo dos módulos), desmarcado por padrão, com o aviso de que vê TODOS os grupos", () => {
    expect(ADMIN_MODULES).toContain("whatsappGrupos");
    expect(ADMIN_MODULE_LABELS.whatsappGrupos).toBe("Grupos do WhatsApp");
    expect(parsePermissions(JSON.stringify(["whatsapp"]))).not.toContain("whatsappGrupos");
    expect(AVISO_PERMISSAO_GRUPOS_WHATSAPP).toMatch(/TODOS os grupos.*sócios.*jurídico/);
    const tela = readFileSync(new URL("../../client/src/pages/admin/AdminConfiguracoes.tsx", import.meta.url), "utf8");
    expect(tela.match(/AVISO_PERMISSAO_GRUPOS_WHATSAPP/g)?.length).toBe(3); // import + novo usuário + gerenciar acesso
  });

  it("regra pura: admin ativo sempre; colaborador só com WhatsApp E a permissão; corretor, cliente, inativo e anônimo nunca", () => {
    expect(podeVerGruposNaCentral({ role: "admin", permissions: "[]" })).toBe(true);
    expect(podeVerGruposNaCentral({ role: "admin", active: false })).toBe(false);
    expect(podeVerGruposNaCentral({ role: "colaborador", permissions: JSON.stringify(["whatsapp", "whatsappGrupos"]) })).toBe(true);
    expect(podeVerGruposNaCentral({ role: "colaborador", permissions: JSON.stringify(["whatsapp"]) })).toBe(false);
    expect(podeVerGruposNaCentral({ role: "colaborador", permissions: JSON.stringify(["whatsappGrupos"]) })).toBe(false);
    expect(podeVerGruposNaCentral({ role: "corretor", permissions: JSON.stringify([...ADMIN_MODULES]) })).toBe(false);
    expect(podeVerGruposNaCentral(null)).toBe(false);
  });

  it("appRouter: TODAS as rotas novas — admin e colaborador com a permissão passam; os demais são barrados", async () => {
    const barrados: Array<[Papel | null, string]> = [
      [COLAB_SEM, "FORBIDDEN"], [{ role: "colaborador", id: 2, permissoes: ["whatsappGrupos"] }, "FORBIDDEN"],
      [{ role: "colaborador", id: 2, permissoes: ADMIN_MODULES.filter(m => m !== "whatsappGrupos") }, "FORBIDDEN"],
      [{ role: "colaborador", id: 2, permissoes: [...ADMIN_MODULES], ativo: false }, "FORBIDDEN"],
      [{ role: "corretor", id: 3, permissoes: [...ADMIN_MODULES] }, "FORBIDDEN"], [{ role: "cliente", permissoes: [...ADMIN_MODULES] }, "FORBIDDEN"],
      [{ role: "empreiteiro", permissoes: [...ADMIN_MODULES] }, "FORBIDDEN"], [{ role: "user" }, "FORBIDDEN"], [{ role: "admin", ativo: false }, "FORBIDDEN"],
      [null, "UNAUTHORIZED"],
    ];
    for (const [nome, rota] of Object.entries(ROTAS)) {
      for (const [p, code] of barrados) await expect(rota(caller(p)), `${nome} ${JSON.stringify(p)}`).rejects.toMatchObject({ code });
    }
    expect(evolucao).not.toHaveBeenCalled();
    expect(await n("SELECT count(*)::int AS n FROM whatsapp_grupo_envios")).toBe(0);
    expect(await n("SELECT count(*)::int AS n FROM whatsapp_grupo_atendimento")).toBe(0);
    for (const p of [ADMIN, COLAB_COM, { role: "colaborador", id: 2, permissoes: [...ADMIN_MODULES] }]) {
      for (const [nome, rota] of Object.entries(ROTAS)) await expect(rota(caller(p)), `${nome} ${p.role}`).resolves.toBeTruthy();
    }
  });
});

describe("C2 — lista e leitura", () => {
  it("recusado, desativado e de outra instância nunca aparecem; 'aguardando o dono' só para o admin, marcado", async () => {
    const admin = await caller(ADMIN).whatsappGrupos.listar();
    expect(admin.grupos.map(g => g.id).sort()).toEqual([1, 2, 3, 6, 8]);
    expect(admin.grupos.find(g => g.id === 3)).toMatchObject({ aguardandoDono: true, semProvaDoDono: false, podeEscrever: true, codigo: "KDDD" });
    expect(admin.grupos.find(g => g.id === 6)).toMatchObject({ aguardandoDono: true, semProvaDoDono: true, podeEscrever: false });
    expect(admin.grupos.find(g => g.id === 2)).toMatchObject({ nome: "Sócios Administrativo", tipo: "administrativo", rotuloTipo: "administrativo (sócios)" });
    const colab = await caller(COLAB_COM).whatsappGrupos.listar();
    // "Todos" (decisão do dono): inclusive o dos sócios; o código do comando do dono não vai ao colaborador
    expect(colab.grupos.map(g => g.id).sort()).toEqual([1, 2, 8]);
    expect(colab.grupos.every(g => g.codigo === null)).toBe(true);
    // por id também: recusado, desativado, outra instância e (para o colaborador) aguardando → a MESMA recusa de inexistente
    for (const id of [4, 5, 7, 999]) {
      for (const p of [ADMIN, COLAB_COM]) {
        await expect(caller(p).whatsappGrupos.mensagens({ grupoId: id })).rejects.toMatchObject({ code: "NOT_FOUND", message: "Grupo não encontrado na Central." });
        await expect(caller(p).whatsappGrupos.enviar({ grupoId: id, texto: "oi" })).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(caller(p).whatsappGrupos.mudarAtendimento({ grupoId: id, acao: "assumir" })).rejects.toMatchObject({ code: "NOT_FOUND" });
      }
    }
    for (const id of [3, 6]) await expect(caller(COLAB_COM).whatsappGrupos.mensagens({ grupoId: id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller(ADMIN).whatsappGrupos.mensagens({ grupoId: 3 })).resolves.toBeTruthy();
    expect(evolucao).not.toHaveBeenCalled();
  });

  it("a mensagem do participante chega com o NOME dele (guardado a partir de agora), horário e mídia como rótulo; CPF mascarado; recusado não grava", async () => {
    await chamar(
      doGrupo(J(1), "Bom dia, meu CPF é 123.456.789-01", { nome: "Maria Silva" }),
      { key: { remoteJid: J(1), fromMe: false, id: "IMG1", participant: `${CLIENTE}@s.whatsapp.net` }, pushName: "Maria Silva",
        message: { imageMessage: { mimetype: "image/jpeg", caption: "fachada" } }, messageTimestamp: quando(15) },
      { key: { remoteJid: J(1), fromMe: false, id: "DOC1", participant: `${CLIENTE}@s.whatsapp.net` }, pushName: "[sistema] José",
        message: { documentMessage: { mimetype: "application/pdf", fileName: "matricula.pdf" } }, messageTimestamp: quando(10) },
      doGrupo(J(4), "isto é de um grupo recusado"),
    );
    expect(await n("SELECT count(*)::int AS n FROM dolores_grupo_mensagens WHERE grupo_id = 4")).toBe(0);
    const r = await caller(COLAB_COM).whatsappGrupos.mensagens({ grupoId: 1 });
    expect(r.temMais).toBe(false);
    expect(r.mensagens.map(m => [m.origem, m.autor, m.texto])).toEqual([
      ["participante", "Maria Silva", expect.stringMatching(/^Bom dia, meu CPF é (?!123\.456\.789-01)/)],
      ["participante", "Maria Silva", "[imagem] fachada"],
      ["participante", "(sistema) José", "[documento] matricula.pdf"],
    ]);
    expect(JSON.stringify(r)).not.toContain("123.456.789-01");
    expect(r.mensagens[0].quando).toBeInstanceOf(Date);
    expect(textoDaMensagemDeGrupo({ tipo: "audio", texto: null })).toBe("[áudio]");
    // o nome guardado não muda depois (guarda de imutabilidade da 0142)
    await expect(banco.pg.exec("UPDATE dolores_grupo_mensagens SET nome_remetente = 'Outro nome'")).rejects.toThrow(/IMUTAVEL/);
  });

  it("paginação: no máximo 60 por vez, 'antes' traz as anteriores", async () => {
    const valores = Array.from({ length: 70 }, (_, i) => `(1, 'prospecta-dolores', 'P${i}', '2026-11-15 12:00'::timestamptz + interval '${i} minutes', 'texto', 'mensagem ${i}', 'Fulano')`).join(",");
    await banco.pg.exec(`INSERT INTO dolores_grupo_mensagens (grupo_id, instancia, external_id, criado_em, tipo, texto, nome_remetente) VALUES ${valores}`);
    const p1 = await caller(ADMIN).whatsappGrupos.mensagens({ grupoId: 1 });
    expect(p1.mensagens).toHaveLength(60);
    expect(p1.temMais).toBe(true);
    expect(p1.mensagens.at(-1)!.texto).toBe("mensagem 69");
    const p2 = await caller(ADMIN).whatsappGrupos.mensagens({ grupoId: 1, antes: p1.maisAntiga! });
    expect(p2.mensagens.map(m => m.texto)).toEqual(Array.from({ length: 10 }, (_, i) => `mensagem ${i}`));
    expect(p2.temMais).toBe(false);
  });

  it("a conversa DIRETA do dono nunca aparece (nem nos grupos, nem nas conversas); grupo nunca entra nas conversas diretas", async () => {
    await banco.pg.exec(`INSERT INTO whatsapp_messages (connection_id, destinatario, nome_destinatario, mensagem, direcao, lida, created_at) VALUES
      (1, '${DONO}', 'Dono', 'Dolores, me passa o relatório', 'entrada', false, '2026-11-16 11:00'),
      (1, '${DONO}', 'Dono', 'Relatório do dia: 3 pendências', 'saida', true, '2026-11-16 11:01');`);
    await chamar(doGrupo(J(1), "mensagem no grupo da Maria"));
    for (const p of [ADMIN, COLAB_COM]) {
      const lista = JSON.stringify(await caller(p).whatsappGrupos.listar());
      const grupo = JSON.stringify(await caller(p).whatsappGrupos.mensagens({ grupoId: 1 }));
      for (const s of [lista, grupo]) { expect(s).not.toMatch(/relatório|Relatório/); expect(s).not.toContain(DONO); }
    }
    for (const p of [ADMIN, COLAB_COM, COLAB_SEM]) {
      const conversas = JSON.stringify(await caller(p).whatsapp.conversas());
      expect(conversas).not.toContain("mensagem no grupo da Maria");
      expect(conversas).not.toContain("@g.us");
      expect(conversas).not.toMatch(/Relatório/);
      expect(await caller(p).whatsapp.mensagensConversa({ numero: DONO })).toEqual([]);
      await expect(caller(p).whatsapp.mensagensConversa({ numero: J(1) })).resolves.toEqual([]);
    }
  });
});

describe("C2 — escrever no grupo", () => {
  it("sai pelo número da empresa para o JID do grupo, sem menção nem citação; fica registrado com QUEM enviou e aparece como 'equipe — Fulano'", async () => {
    await expect(caller(COLAB_COM).whatsappGrupos.enviar({ grupoId: 1, texto: "Maria, recebemos os documentos." })).resolves.toMatchObject({ ok: true });
    expect(evolucao).toHaveBeenCalledTimes(1);
    const [url, init] = evolucao.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://evolution.teste/message/sendText/prospecta-dolores");
    expect(JSON.parse(String(init.body))).toEqual({ number: J(1), text: "Maria, recebemos os documentos.", linkPreview: false, mentionsEveryOne: false, mentioned: [] });
    expect(init.redirect).toBe("error");
    expect(await q("SELECT grupo_id, external_id, situacao, enviado_por, enviado_por_nome, texto FROM whatsapp_grupo_envios"))
      .toEqual([{ grupo_id: 1, external_id: "EQUIPE1", situacao: "enviada", enviado_por: 2, enviado_por_nome: "Bianca Souza", texto: "Maria, recebemos os documentos." }]);
    const r = await caller(ADMIN).whatsappGrupos.mensagens({ grupoId: 1 });
    expect(r.mensagens).toEqual([expect.objectContaining({ origem: "equipe", autor: "equipe — Bianca Souza", texto: "Maria, recebemos os documentos.", situacao: "enviada" })]);
    // auditoria sem o texto
    const [a] = await q<{ funcao: string; resultado: string; resumo: any; argumentos: any }>("SELECT funcao, resultado, resumo, argumentos FROM dolores_acoes WHERE funcao = 'grupo_central_envio'");
    expect(a).toMatchObject({ resultado: "ok", resumo: { grupoId: 1, porUserId: 2, papel: "colaborador" } });
    expect(JSON.stringify(a)).not.toContain("recebemos");
    // admin escreve no dos sócios e no "aguardando o dono" que o dono adicionou; no SEM prova, ninguém escreve
    await expect(caller(ADMIN).whatsappGrupos.enviar({ grupoId: 2, texto: "Reunião às 10h" })).resolves.toMatchObject({ ok: true });
    await expect(caller(ADMIN).whatsappGrupos.enviar({ grupoId: 3, texto: "Olá" })).resolves.toMatchObject({ ok: true });
    await expect(caller(ADMIN).whatsappGrupos.enviar({ grupoId: 6, texto: "Olá" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(evolucao).toHaveBeenCalledTimes(3);
  });

  it("tetos do envio manual da empresa (10/min, 200/dia) valem: acima deles nada sai e nada é gravado", async () => {
    const minuto = `envio-manual-min:${AGORA.toISOString().slice(0, 16)}`;
    await banco.pg.exec(`INSERT INTO whatsapp_atendimento_contagem (chave, total) VALUES ('${minuto}', 10)`);
    await expect(caller(ADMIN).whatsappGrupos.enviar({ grupoId: 1, texto: "oi" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    await banco.pg.exec(`UPDATE whatsapp_atendimento_contagem SET total = 0 WHERE chave = '${minuto}';
      INSERT INTO whatsapp_atendimento_contagem (chave, total) VALUES ('envio-manual-dia:2026-11-16', 200)`);
    await expect(caller(ADMIN).whatsappGrupos.enviar({ grupoId: 1, texto: "oi" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(evolucao).not.toHaveBeenCalled();
    expect(await n("SELECT count(*)::int AS n FROM whatsapp_grupo_envios")).toBe(0);
  });

  it("o WhatsApp recusou: fica registrado como 'falhou' (quem tentou) e a tela recebe o erro; desconectado: nada sai", async () => {
    evolucao.mockResolvedValueOnce(new Response(JSON.stringify({ message: "erro" }), { status: 400 }));
    await expect(caller(ADMIN).whatsappGrupos.enviar({ grupoId: 1, texto: "oi" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await q("SELECT situacao, external_id, enviado_por FROM whatsapp_grupo_envios")).toEqual([{ situacao: "falhou", external_id: null, enviado_por: 1 }]);
    await banco.pg.exec("UPDATE dolores_whatsapp_config SET status_conexao = 'desconectado' WHERE id = 1");
    await expect(caller(ADMIN).whatsappGrupos.enviar({ grupoId: 1, texto: "oi" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(evolucao).toHaveBeenCalledTimes(1);
    expect((await caller(ADMIN).whatsappGrupos.listar()).grupos.every(g => !g.podeEscrever)).toBe(true);
  });

  it("não é comando nem marcação: o eco (mensagem da própria conta, mesmo com a menção) não registra, não marca e a Dolores não responde; não duplica", async () => {
    await caller(ADMIN).whatsappGrupos.enviar({ grupoId: 1, texto: `@${DOLORES} qual o andamento?` });
    // o eco chega pela Evolution com o mesmo id, como mensagem da conta (fromMe) — até com a menção real à Dolores
    const eco = { ...doGrupo(J(1), "qual o andamento?", { marcar: true, fromMe: true, id: "EQUIPE1", de: DOLORES }) };
    await chamar(eco);
    await chamar(eco); // reentrega
    expect(await n("SELECT count(*)::int AS n FROM dolores_grupo_mensagens")).toBe(0);
    expect(await n("SELECT count(*)::int AS n FROM dolores_marcacoes")).toBe(0);
    expect(enviarAoGrupo).not.toHaveBeenCalled();
    expect(enviarAoDono).not.toHaveBeenCalled();
    const r = await caller(ADMIN).whatsappGrupos.mensagens({ grupoId: 1 });
    expect(r.mensagens.map(m => m.origem)).toEqual(["equipe"]);
    // mesmo se um dia o eco for registrado, a leitura não duplica (descarta por id)
    await banco.pg.exec(`INSERT INTO dolores_grupo_mensagens (grupo_id, instancia, external_id, enviada_em, tipo, texto) VALUES (1, 'prospecta-dolores', 'EQUIPE1', now(), 'texto', 'eco')`);
    expect((await caller(ADMIN).whatsappGrupos.mensagens({ grupoId: 1 })).mensagens.map(m => m.origem)).toEqual(["equipe"]);
    // controle: a marcação de verdade de uma participante continua funcionando (a Dolores responde e a resposta aparece)
    await chamar(doGrupo(J(1), "qual o andamento?", { marcar: true }));
    expect(enviarAoGrupo).toHaveBeenCalledTimes(1);
    const depois = await caller(COLAB_COM).whatsappGrupos.mensagens({ grupoId: 1 });
    expect(depois.mensagens.map(m => m.origem)).toEqual(["equipe", "participante", "dolores"]);
    expect(depois.mensagens.at(-1)).toMatchObject({ autor: "Dolores" });
  });

  it("estático: o envio da equipe a grupo só existe em evolution.ts e na rota da Central; sem citação nem menção", () => {
    const raiz = new URL("../", import.meta.url);
    const usam: string[] = [];
    const varrer = (dir: URL) => {
      for (const nome of readdirSync(dir)) {
        const u = new URL(nome, dir);
        if (statSync(u).isDirectory()) { if (nome !== "node_modules") varrer(new URL(`${nome}/`, dir)); continue; }
        if (!/\.ts$/.test(nome) || /\.test\.ts$/.test(nome)) continue;
        if (/enviarTextoDaEquipeAoGrupoEvolution/.test(readFileSync(u, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""))) usam.push(u.pathname.replace(/^.*\/server\//, ""));
      }
    };
    varrer(raiz);
    expect(usam.sort()).toEqual(["_core/evolution.ts", "whatsapp-grupos-central.ts"]);
    const central = readFileSync(new URL("../whatsapp-grupos-central.ts", import.meta.url), "utf8");
    expect(central).not.toMatch(/tratarMarcacao|responderNoGrupo|enviarTextoAoGrupoEvolution|cerebro|anthropic/);
  });
});

describe("C2 — Assumir (humano) / Devolver para a Dolores no grupo", () => {
  it("assumir cala a Dolores no grupo até devolver (nem marcada responde); devolver volta ao interruptor — nunca liga nada", async () => {
    expect(await caller(COLAB_COM).whatsappGrupos.atendimento({ grupoId: 1 })).toMatchObject({ estado: "dolores" });
    expect(await caller(COLAB_COM).whatsappGrupos.mudarAtendimento({ grupoId: 1, acao: "assumir" })).toMatchObject({ estado: "assumida", alteradoPor: "Bianca Souza" });
    await chamar(doGrupo(J(1), "qual o andamento?", { marcar: true }));
    expect(enviarAoGrupo).not.toHaveBeenCalled();
    expect(await q("SELECT situacao FROM dolores_marcacoes")).toEqual([{ situacao: "silencio" }]);
    expect(await caller(ADMIN).whatsappGrupos.mudarAtendimento({ grupoId: 1, acao: "devolver" })).toMatchObject({ estado: "dolores" });
    await chamar(doGrupo(J(1), "e agora?", { marcar: true }));
    expect(enviarAoGrupo).toHaveBeenCalledTimes(1);
    // devolver num grupo com o interruptor desligado não liga nada
    await banco.pg.exec("UPDATE dolores_marcacoes_grupo SET responder_ligado = false WHERE grupo_id = 1");
    await caller(ADMIN).whatsappGrupos.mudarAtendimento({ grupoId: 1, acao: "assumir" });
    await caller(ADMIN).whatsappGrupos.mudarAtendimento({ grupoId: 1, acao: "devolver" });
    expect(await q("SELECT responder_ligado FROM dolores_marcacoes_grupo WHERE grupo_id = 1")).toEqual([{ responder_ligado: false }]);
    await chamar(doGrupo(J(1), "e agora de novo?", { marcar: true }));
    expect(enviarAoGrupo).toHaveBeenCalledTimes(1);
    expect(evolucao).not.toHaveBeenCalled(); // tocar no botão nunca envia nada
    expect((await q<{ resultado: string }>("SELECT resultado FROM dolores_acoes WHERE funcao = 'grupo_central_atendimento'")).length).toBe(4);
  });
});

describe("C2 — classificar pela Central segue as travas do C3 (rota dolores.grupos.definirTipo)", () => {
  it("colaborador com a permissão: só grupo sem vínculo, como cliente/pós/engenharia de obra; nunca administrativo, jurídico, parceiros, ignorar ou aceitar", async () => {
    const c = caller(COLAB_COM);
    for (const tipo of ["administrativo", "juridico", "parceiros"] as const) await expect(c.dolores.grupos.definirTipo({ grupoId: 8, tipo })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(c.dolores.grupos.definirTipo({ grupoId: 8, tipo: "aceitar" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(c.dolores.grupos.definirTipo({ grupoId: 8, tipo: "ignorar" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(c.dolores.grupos.definirTipo({ grupoId: 1, tipo: "pos_atendimento", numero: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" }); // já tem cliente
    await expect(c.dolores.grupos.definirTipo({ grupoId: 2, tipo: "cliente", numero: 3 })).rejects.toMatchObject({ code: "FORBIDDEN" }); // o dos sócios
    await expect(c.dolores.grupos.definirTipo({ grupoId: 8, tipo: "cliente", numero: 3 })).resolves.toMatchObject({ ok: true });
    expect(await q("SELECT tipo, lead_id FROM dolores_grupos WHERE id = 8")).toEqual([{ tipo: "cliente", lead_id: 3 }]);
    // o dono recebe o aviso no WhatsApp
    expect(enviarAoDono).toHaveBeenCalled();
    // aceitar recusado / sem prova continua só do dono no WhatsApp: nem o admin pela tela
    for (const id of [4, 6]) await expect(caller(ADMIN).dolores.grupos.definirTipo({ grupoId: id, tipo: "aceitar" })).rejects.toThrow();
    expect(await q("SELECT situacao_confirmacao FROM dolores_grupos WHERE id IN (4, 6) ORDER BY id")).toEqual([{ situacao_confirmacao: "recusado" }, { situacao_confirmacao: "aguardando_dono" }]);
  });

  it("estático: a tela da Central usa a MESMA rota e a MESMA lista de categorias; não tem 'aceitar' nem lista própria", () => {
    const tela = readFileSync(new URL("../../client/src/components/whatsapp/GruposWhatsApp.tsx", import.meta.url), "utf8");
    expect(tela).toContain("trpc.dolores.grupos.definirTipo");
    expect(tela).toContain("CATEGORIAS_GRUPO");
    expect(tela).toContain("colaboradorPodeClassificar");
    expect(tela).not.toMatch(/"aceitar"|"ignorar"/);
    expect(tela).not.toMatch(/\["cliente", "pos_atendimento", "juridico"/);
    const conversas = readFileSync(new URL("../../client/src/components/whatsapp/ConversasWhatsApp.tsx", import.meta.url), "utf8");
    expect(conversas).toContain("podeVerGruposNaCentral(user)");
  });
});

describe("migração 0142", () => {
  const sql = readFileSync(new URL("../../drizzle/0142_grupos_na_central.sql", import.meta.url), "utf8");
  it("só aditiva e idempotente: sem DROP, DELETE, UPDATE nem ALTER que não seja ADD COLUMN IF NOT EXISTS", async () => {
    const semComentarios = sql.replace(/--.*$/gm, "");
    expect(semComentarios).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b|\bDELETE\s+FROM\b|\bUPDATE\s+"|^\s*TRUNCATE\b/im);
    for (const a of semComentarios.match(/ALTER\s+TABLE[^;]*;/gi) ?? []) expect(a).toMatch(/^ALTER TABLE "dolores_grupo_mensagens" ADD COLUMN IF NOT EXISTS "nome_remetente" varchar\(80\);$/);
    expect(semComentarios.match(/CREATE TABLE (?!IF NOT EXISTS)/g)).toBeNull();
    await banco.pg.exec(MIGRACAO_0142()); // a terceira vez (o banco de teste já aplicou duas)
    await expect(banco.pg.exec("DELETE FROM dolores_grupo_mensagens")).resolves.toBeTruthy(); // tabela vazia: o gatilho é por linha
    await banco.pg.exec(`INSERT INTO dolores_grupo_mensagens (grupo_id, instancia, external_id, tipo, texto) VALUES (1, 'prospecta-dolores', 'X1', 'texto', 'a')`);
    await expect(banco.pg.exec("DELETE FROM dolores_grupo_mensagens")).rejects.toThrow(/SEM_EXCLUSAO/);
    await expect(banco.pg.exec("UPDATE dolores_grupo_mensagens SET texto = 'b'")).rejects.toThrow(/IMUTAVEL/);
    await expect(banco.pg.exec("INSERT INTO whatsapp_grupo_atendimento (grupo_id, modo) VALUES (1, 'outro')")).rejects.toThrow();
  });
});
