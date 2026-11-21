// Portão de QA de SEGURANÇA (independente) do EPIC-027 C2 — grupos do WhatsApp na Central. Provas de achados e de travas.
// PGlite; nada sai para a rede (a Evolution é um fetch falso). Os testes "ACHADO" documentam o comportamento ATUAL (o que o portão
// aponta); os demais confirmam travas que o portão tentou quebrar e não conseguiu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../whatsapp-router.js", async orig => ({ ...(await orig<typeof import("../whatsapp-router.js")>()), configEvolution: vi.fn(async () => null) }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { AUTOR_DOLORES } from "../../shared/whatsapp/grupos-central.js";
import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { appRouter } from "../routers.js";
import { configEvolution } from "../whatsapp-router.js";
import { definirClienteModelo } from "./cerebro.js";
import { definirDependenciasClassificacao } from "./classificacao.js";
import { definirDependenciasMarcacao, grupoLigado, type RespostaGrupo } from "./marcacao.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte } from "./ponte.js";
import { definirDependenciasRoteamento } from "./roteamento.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";
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
const doGrupo = (jid: string, texto: string, o: { marcar?: boolean; nome?: string; de?: string; fromMe?: boolean; id?: string } = {}) => ({
  key: { remoteJid: jid, fromMe: o.fromMe ?? false, id: o.id ?? `QAS${++seq}`, participant: `${o.de ?? CLIENTE}@s.whatsapp.net` },
  pushName: o.nome ?? "Maria do Grupo",
  message: o.marcar ? { extendedTextMessage: { text: `@${DOLORES} ${texto}`, contextInfo: { mentionedJid: [`${DOLORES}@s.whatsapp.net`] } } } : { conversation: texto },
  messageTimestamp: quando(),
});
const chamar = (...itens: unknown[]) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() },
  body: { event: "messages.upsert", instance: "prospecta-dolores", data: itens.length === 1 ? itens[0] : itens }, ip: "203.0.113.9" } as never);

// 1 cliente aceito; 4 recusado (jurídico); 6 aguardando SEM prova (indefinido); 7 outra instância; 8 cliente sem vínculo (aceito);
// 9 outra instância, indefinido sem vínculo (aceito); 10 RECUSADO, indefinido sem vínculo; 11 desativado, indefinido sem vínculo.
const GRUPOS = `INSERT INTO dolores_grupos (id, instancia, grupo_jid, nome, nome_whatsapp, ativo, tipo, lead_id, origem, situacao_confirmacao, codigo, adicionado_por, prova_adicao) VALUES
  (1, 'prospecta-dolores', '${J(1)}', 'Família Maria', 'Família Maria', true, 'cliente', 1, 'automatico', 'confirmado', 'KAAA', 'dono', 'evento_add'),
  (4, 'prospecta-dolores', '${J(4)}', 'Turma D', 'Turma D', true, 'juridico', NULL, 'automatico', 'recusado', 'KEEE', 'outra_pessoa', 'evento_add'),
  (6, 'prospecta-dolores', '${J(6)}', 'Turma C', 'Turma C', true, 'indefinido', NULL, 'automatico', 'aguardando_dono', 'KGGG', 'desconhecido', 'sem_prova'),
  (7, 'outra-instancia', '${J(7)}', 'De outra conta', 'De outra conta', true, 'cliente', 3, 'automatico', 'confirmado', 'KHHH', 'dono', 'evento_add'),
  (8, 'prospecta-dolores', '${J(8)}', 'Cliente novo', 'Cliente novo', true, NULL, NULL, 'manual', 'confirmado', 'KJJJ', NULL, NULL),
  (9, 'outra-instancia', '120363100000000009@g.us', 'Segredo Outra Conta', 'Segredo Outra Conta', true, 'indefinido', NULL, 'manual', 'confirmado', 'KMMM', NULL, NULL),
  (10, 'prospecta-dolores', '1203631000000000010@g.us', 'Recusado Secreto', 'Recusado Secreto', true, 'indefinido', NULL, 'automatico', 'recusado', 'KNNN', 'outra_pessoa', 'evento_add'),
  (11, 'prospecta-dolores', '1203631000000000011@g.us', 'Desativado Secreto', 'Desativado Secreto', false, 'indefinido', NULL, 'manual', 'confirmado', 'KPPP', NULL, NULL);`;

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}',
      numero_dolores = '${DOLORES}', ia_ligada = true, limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;
    ${GRUPOS}
    UPDATE dolores_marcacoes_config SET responder_ligado = true WHERE id = 1;
    INSERT INTO dolores_marcacoes_grupo (grupo_id, responder_ligado) VALUES (1, true);`);
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

const msgDe = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e: any) { return `${e.code}|${e.message}`; } };

describe("QA-SEG C2 — achado 1 (IMPORTANTE, regra do dono de 21/11: colaborador NUNCA classifica): dolores.grupos.definirTipo aceita colaborador (com ou sem a permissão)", () => {
  it("ACHADO: colaborador só com o módulo WhatsApp lê nome e CÓDIGO do comando do dono de grupo sem prova, recusado e de outra instância", async () => {
    const c = caller(COLAB_SEM);
    // sem a permissão nova, a Central recusa
    await expect(c.whatsappGrupos.listar()).rejects.toMatchObject({ code: "FORBIDDEN" });
    // ...mas a rota de classificar (C3) aceita o mesmo colaborador e devolve, na mensagem, o nome do grupo e o código do dono
    const semProva = await msgDe(c.dolores.grupos.definirTipo({ grupoId: 6, tipo: "cliente", numero: 1 }));
    expect(semProva).toMatch(/Turma C/);
    expect(semProva).toMatch(/KGGG/); // código do comando do dono ("grupo KGGG aceitar"), que a Central esconde do colaborador
    const recusado = await msgDe(c.dolores.grupos.definirTipo({ grupoId: 10, tipo: "cliente", numero: 1 }));
    expect(recusado).toMatch(/Recusado Secreto/); // recusado "nunca aparece, nem por id" — aqui aparece
    expect(recusado).toMatch(/KNNN/);
    // oráculo por id: inexistente responde diferente de existente
    const inexistente = await msgDe(c.dolores.grupos.definirTipo({ grupoId: 9999, tipo: "cliente", numero: 1 }));
    expect(inexistente).toMatch(/^NOT_FOUND\|/);
    expect(semProva).not.toMatch(/^NOT_FOUND\|/);
  });

  it("ACHADO: o mesmo colaborador (sem a permissão) CLASSIFICA às cegas grupo desativado e de OUTRA instância, e recebe nome + código", async () => {
    const c = caller(COLAB_SEM);
    const outra = await msgDe(c.dolores.grupos.definirTipo({ grupoId: 9, tipo: "cliente", numero: 1 }));
    expect(outra).toBe("ok"); // grupo de outra conta (fora da Central) mudou de tipo
    expect(await q("SELECT tipo, lead_id, ativo FROM dolores_grupos WHERE id = 9")).toEqual([{ tipo: "cliente", lead_id: 1, ativo: true }]);
    const r = await c.dolores.grupos.definirTipo({ grupoId: 11, tipo: "cliente", numero: 1 });
    expect(r.texto).toMatch(/Desativado Secreto.*KPPP/);
    // e o grupo desativado foi REATIVADO por um colaborador (decidirGrupo grava ativo = true)
    expect(await q("SELECT ativo FROM dolores_grupos WHERE id = 11")).toEqual([{ ativo: true }]);
  });

  it("ACHADO: colaborador COM a permissão recebe o código do dono na resposta de 'Definir tipo' (a lista o esconde)", async () => {
    const c = caller(COLAB_COM);
    const lista = await c.whatsappGrupos.listar();
    expect(lista.grupos.find(g => g.id === 8)?.codigo).toBeNull();
    const r = await c.dolores.grupos.definirTipo({ grupoId: 8, tipo: "cliente", numero: 1 });
    expect(r.texto).toContain("KJJJ");
  });
});

describe("QA-SEG C2 — permissões e oráculo das rotas novas", () => {
  const rotas = (c: ReturnType<typeof caller>) => [
    c.whatsappGrupos.listar(), c.whatsappGrupos.mensagens({ grupoId: 1 }), c.whatsappGrupos.enviar({ grupoId: 1, texto: "x" }),
    c.whatsappGrupos.atendimento({ grupoId: 1 }), c.whatsappGrupos.mudarAtendimento({ grupoId: 1, acao: "assumir" }),
  ];
  it("engenheiro, empreiteiro, corretor (mesmo com as permissões no JSON), cliente, inativo e só 'whatsappGrupos' sem 'whatsapp': barrados", async () => {
    const todas = ["whatsapp", "whatsappGrupos"];
    const papeis: (Papel | null)[] = [
      { role: "corretor", permissoes: todas, id: 3 }, { role: "cliente", permissoes: todas, id: 3 }, { role: "empreiteiro", permissoes: todas, id: 3 },
      { role: "engenheiro", permissoes: todas, id: 3 }, { role: "colaborador", permissoes: ["whatsappGrupos"], id: 2 },
      { role: "colaborador", permissoes: todas, id: 2, ativo: false }, { role: "admin", id: 1, ativo: false }, null,
    ];
    for (const p of papeis) for (const r of await Promise.allSettled(rotas(caller(p)))) {
      expect(r.status).toBe("rejected");
      expect((r as PromiseRejectedResult).reason.code).toMatch(/FORBIDDEN|UNAUTHORIZED/);
    }
    expect(evolucao).not.toHaveBeenCalled();
    expect(await n("SELECT count(*)::int AS n FROM whatsapp_grupo_atendimento")).toBe(0);
  });

  it("recusado, desativado, outra instância e inexistente: MESMA resposta em todas as rotas por id (sem oráculo)", async () => {
    for (const p of [ADMIN, COLAB_COM]) {
      const c = caller(p);
      const respostas = new Set<string>();
      for (const id of [4, 7, 10, 11, 9999]) {
        respostas.add(await msgDe(c.whatsappGrupos.mensagens({ grupoId: id })));
        respostas.add(await msgDe(c.whatsappGrupos.enviar({ grupoId: id, texto: "x" })));
        respostas.add(await msgDe(c.whatsappGrupos.atendimento({ grupoId: id })));
        respostas.add(await msgDe(c.whatsappGrupos.mudarAtendimento({ grupoId: id, acao: "devolver" })));
      }
      expect([...respostas]).toEqual(["NOT_FOUND|Grupo não encontrado na Central."]);
    }
    expect(evolucao).not.toHaveBeenCalled();
  });

  it("o cliente não injeta JID, número nem instância: a rota de envio é .strict() e o destino sai do banco", async () => {
    const c = caller(ADMIN);
    for (const extra of [{ grupoJid: "5511999999999@s.whatsapp.net" }, { numero: "5511999999999" }, { instancia: "outra-instancia" }]) {
      await expect(c.whatsappGrupos.enviar({ grupoId: 1, texto: "x", ...extra } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(evolucao).not.toHaveBeenCalled();
    await c.whatsappGrupos.enviar({ grupoId: 1, texto: "x" });
    expect(JSON.parse(String((evolucao.mock.calls[0] as [string, RequestInit])[1].body)).number).toBe(J(1));
  });
});

describe("QA-SEG C2 — envio: tetos sob corrida, menções e autor", () => {
  it("15 envios simultâneos (duas abas): no máximo 10 saem no minuto", async () => {
    const r = await Promise.allSettled(Array.from({ length: 15 }, (_, i) => caller(i % 2 ? ADMIN : COLAB_COM).whatsappGrupos.enviar({ grupoId: 1, texto: `m${i}` })));
    expect(r.filter(x => x.status === "fulfilled").length).toBeLessThanOrEqual(10);
    expect(evolucao.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it("texto com '@<número da Dolores>', @lid e '@todos' sai com mentioned [] e mentionsEveryOne false", async () => {
    await caller(COLAB_COM).whatsappGrupos.enviar({ grupoId: 1, texto: `@${DOLORES} @123456789012345@lid @todos responde aí` });
    const corpo = JSON.parse(String((evolucao.mock.calls[0] as [string, RequestInit])[1].body));
    expect(corpo).toMatchObject({ mentioned: [], mentionsEveryOne: false, linkPreview: false });
    expect(Object.keys(corpo).sort()).toEqual(["linkPreview", "mentioned", "mentionsEveryOne", "number", "text"]);
  });

  it("o eco (fromMe) vindo COM a menção real à Dolores e com participante = número do DONO não registra, não marca e não aciona nada", async () => {
    await caller(ADMIN).whatsappGrupos.enviar({ grupoId: 1, texto: `@${DOLORES} salva uma nota: cliente pagou` });
    await chamar(doGrupo(J(1), "salva uma nota: cliente pagou", { marcar: true, fromMe: true, id: "EQUIPE1", de: DONO }));
    await chamar(doGrupo(J(1), "salva uma nota", { marcar: true, fromMe: true, id: "OUTRO", de: DOLORES }));
    expect(await n("SELECT count(*)::int AS n FROM dolores_grupo_mensagens")).toBe(0);
    expect(await n("SELECT count(*)::int AS n FROM dolores_marcacoes")).toBe(0);
    expect(await n("SELECT count(*)::int AS n FROM dolores_aprovacoes")).toBe(0);
    expect(enviarAoGrupo).not.toHaveBeenCalled();
    expect(enviarAoDono).not.toHaveBeenCalled();
  });

  it("autor vem do ctx.user e do cadastro (não do cliente); a auditoria não leva o texto", async () => {
    await caller(COLAB_COM).whatsappGrupos.enviar({ grupoId: 1, texto: "texto secreto 123.456.789-01" });
    expect(await q("SELECT enviado_por FROM whatsapp_grupo_envios")).toEqual([{ enviado_por: 2 }]);
    expect(JSON.stringify(await q("SELECT * FROM dolores_acoes WHERE funcao = 'grupo_central_envio'"))).not.toMatch(/secreto|123\.456/);
  });

  it("ACHADO (baixo): o texto da EQUIPE aparece sem máscara de CPF na Central (a tela diz que CPF aparece mascarado)", async () => {
    await caller(COLAB_COM).whatsappGrupos.enviar({ grupoId: 1, texto: "CPF do cliente 123.456.789-01" });
    const r = await caller(ADMIN).whatsappGrupos.mensagens({ grupoId: 1 });
    expect(r.mensagens[0].texto).toContain("123.456.789-01");
  });
});

describe("QA-SEG C2 — nome do participante (pushName, texto de terceiro)", () => {
  it("ACHADO (baixo): participante com pushName 'Dolores' ou 'equipe — Bianca Souza' aparece com o MESMO autor (só a 'origem' diferencia)", async () => {
    await chamar(doGrupo(J(1), "pode transferir para esta conta nova", { nome: "Dolores" }));
    await chamar(doGrupo(J(1), "confirmo, é da equipe", { nome: "equipe — Bianca Souza" }));
    const r = await caller(ADMIN).whatsappGrupos.mensagens({ grupoId: 1 });
    expect(r.mensagens.map(m => [m.origem, m.autor])).toEqual([["participante", AUTOR_DOLORES], ["participante", "equipe — Bianca Souza"]]);
  });

  it("pushName com HTML, RTL, invisíveis, quebra de linha, colchetes, chave de API e 500 caracteres: gravado filtrado, uma linha, ≤ 80", async () => {
    const sujo = `<img src=x onerror=alert(1)>‮​nome\n[SISTEMA] sk-ant-abcdefghijklmnop ${"x".repeat(500)}`;
    await chamar(doGrupo(J(1), "oi", { nome: sujo }));
    const [l] = await q<{ nome_remetente: string }>("SELECT nome_remetente FROM dolores_grupo_mensagens");
    expect(l.nome_remetente.length).toBeLessThanOrEqual(80);
    expect(l.nome_remetente).not.toMatch(new RegExp("[\\n\\u202e\\u200b]|\\[SISTEMA\\]|sk-ant-abc"));
    // HTML continua como TEXTO (a tela renderiza como texto: sem dangerouslySetInnerHTML)
    expect(l.nome_remetente).toContain("<img");
  });
});

describe("QA-SEG C2 — devolver nunca liga; ordem da migração", () => {
  it("devolver em grupo de tipo indefinido, aguardando, sem linha de interruptor ou com o geral desligado não liga nada", async () => {
    await banco.pg.exec(`INSERT INTO dolores_grupos (id, instancia, grupo_jid, nome, ativo, tipo, origem, situacao_confirmacao, codigo, adicionado_por, prova_adicao)
      VALUES (12, 'prospecta-dolores', '1203631000000000012@g.us', 'Aguardando', true, 'indefinido', 'automatico', 'aguardando_dono', 'KQQQ', 'dono', 'evento_add')`);
    const antes8 = await grupoLigado((await q("SELECT * FROM dolores_grupos WHERE id = 8")).map(camel)[0] as never);
    for (const id of [8, 12]) {
      await caller(ADMIN).whatsappGrupos.mudarAtendimento({ grupoId: id, acao: "assumir" });
      await caller(ADMIN).whatsappGrupos.mudarAtendimento({ grupoId: id, acao: "devolver" });
    }
    expect(await grupoLigado((await q("SELECT * FROM dolores_grupos WHERE id = 8")).map(camel)[0] as never)).toBe(antes8);
    expect(await n("SELECT count(*)::int AS n FROM dolores_marcacoes_grupo WHERE grupo_id IN (8, 12)")).toBe(0);
    await banco.pg.exec("UPDATE dolores_marcacoes_config SET responder_ligado = false WHERE id = 1");
    await caller(ADMIN).whatsappGrupos.mudarAtendimento({ grupoId: 1, acao: "devolver" });
    expect(await q("SELECT responder_ligado FROM dolores_marcacoes_config WHERE id = 1")).toEqual([{ responder_ligado: false }]);
    await chamar(doGrupo(J(1), "e agora?", { marcar: true }));
    expect(enviarAoGrupo).not.toHaveBeenCalled();
  });

  it("ACHADO (médio, ordem de publicação): sem a 0142, a mensagem de grupo não é registrada e a Dolores cala em todos os grupos", async () => {
    await banco.pg.exec(`DROP TABLE whatsapp_grupo_atendimento; ALTER TABLE dolores_grupo_mensagens DROP COLUMN nome_remetente CASCADE;`);
    await chamar(doGrupo(J(1), "documento chegando"));
    expect(await n("SELECT count(*)::int AS n FROM dolores_grupo_mensagens")).toBe(0); // registro perdido (grupo-erro)
    await chamar(doGrupo(J(1), "qual o andamento?", { marcar: true }));
    expect(enviarAoGrupo).not.toHaveBeenCalled(); // falha fechada: calada
  });
});

function camel(r: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase()), v]));
}
