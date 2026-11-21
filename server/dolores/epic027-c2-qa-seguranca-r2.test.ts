// Portão de QA de SEGURANÇA do EPIC-027 C2 — RODADA 2 (depois do merge 42e55fd). Os "ACHADO" de B1/B2 viraram "CORRIGIDO".
// Mesmo cenário do epic027-c2-qa-seguranca.test.ts (copiado, para este arquivo rodar sozinho).
import { readFileSync } from "node:fs";
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
const COLAB_COM: Papel = { role: "colaborador", id: 2, permissoes: ["whatsapp"] };
const COLAB_SEM: Papel = { role: "colaborador", id: 2, permissoes: ["crm", "obras", "agenda"] }; // sem o módulo WhatsApp

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

import { NOMES_DA_EMPRESA, autorDoParticipante, nomeImitaQuemNaoE } from "../../shared/whatsapp/grupos-central.js";
import { nomeDoRemetenteParaGravar } from "./grupos.js";
import { MIGRACAO_0142, MIGRACAO_0144 } from "./testes-banco.js";
import { grupoAssumidoPelaEquipe } from "./grupo-assumido.js";

const exibido = (pushName: string) => autorDoParticipante({ nome: nomeDoRemetenteParaGravar(pushName), remetente: "5599****6666", doDono: false });

describe("QA-SEG C2 r2 — nome que imita (contornos)", () => {
  it("marcados: maiúsculas, acento, dígitos, largura zero (vira espaço visível) e 'Prospecta' em qualquer lugar", () => {
    for (const n of ["DOLORES", "Dolorés", "D0l0res", "Dolores​", "equipe-Bianca", "Atendimento Prospecta", "Dolores da Prospecta"]) expect(nomeImitaQuemNaoE(nomeDoRemetenteParaGravar(n)), n).toBe(true);
  });
  it("CORRIGIDO (B1): homógrafo cirílico/grego, letras espaçadas ou com pontos, largura zero, nomes da empresa e nome de usuário da equipe são marcados", () => {
    const EQUIPE = ["Vinícius Admin", "Bianca Souza"];
    for (const n of ["Dоlores", "Dοlores", "D o l o r e s", "D.o.l.o.r.e.s", "D-o_l*o r e s", "Do​lores", "Ｄｏｌｏｒｅｓ", "Fulano, da equipe",
      "Central Efficaz", "Eficaz Atendimento", "VFX Capital", "P r o s p e c t a", "Exclusive", "Exclusive Imóveis", "E.x.c.l.u.s.i.v.e"]) {
      expect(nomeImitaQuemNaoE(nomeDoRemetenteParaGravar(n), EQUIPE), n).toBe(true);
    }
    expect(autorDoParticipante({ nome: nomeDoRemetenteParaGravar("Bianca Souza"), remetente: null, doDono: false }, EQUIPE)).toBe("Bianca Souza (participante)");
    expect(autorDoParticipante({ nome: nomeDoRemetenteParaGravar("BIANCA  souza"), remetente: null, doDono: false }, EQUIPE)).toBe("BIANCA souza (participante)");
    // nomes comuns continuam como estão (igualdade com o usuário, não "contém": "Ana" não marca "Ana Paula")
    for (const n of ["Maria Silva", "Bianca", "Dolorosa Lima", "Ana"]) expect(exibido(n), n).toBe(n);
    expect(autorDoParticipante({ nome: "Ana Paula", remetente: null, doDono: false }, ["Ana"])).toBe("Ana Paula");
  });

  it("lista confirmada pelo dono em 21/11: os 6 nomes da empresa, sem 'a confirmar'", () => {
    expect([...NOMES_DA_EMPRESA]).toEqual(["Prospecta", "Central Efficaz", "Efficaz", "Eficaz", "VFX Capital", "Exclusive"]);
    expect(readFileSync(new URL("../../shared/whatsapp/grupos-central.ts", import.meta.url), "utf8")).not.toMatch(/a confirmar/);
    expect(exibido("Exclusive")).toBe("Exclusive (participante)");
  });

  it("B1: tempo linear — 10 mil nomes patológicos de 400 caracteres em menos de 2 s", () => {
    const sujos = ["D o ".repeat(100), "a.".repeat(200), "́".repeat(400), "ｄ".repeat(400), "dolore".repeat(66)];
    const inicio = Date.now();
    for (let i = 0; i < 2000; i++) for (const n of sujos) nomeImitaQuemNaoE(n, ["Vinícius Admin", "Bianca Souza"]);
    expect(Date.now() - inicio).toBeLessThan(2000);
  });

  it("B1 pela rota: participante com o nome de uma usuária ativa da equipe aparece marcado (o cadastro é lido no servidor)", async () => {
    await chamar(doGrupo(J(1), "pode mandar o boleto", { nome: "Bianca Souza" }));
    const r = await caller(ADMIN).whatsappGrupos.mensagens({ grupoId: 1 });
    expect(r.mensagens.map(m => [m.origem, m.autor])).toEqual([["participante", "Bianca Souza (participante)"]]);
  });
});

describe("QA-SEG C2 r2 — ordem e janelas", () => {
  it("migrações aplicadas em qualquer ordem e repetidas (0144 → 0142 → 0144 → 0142) sem atrito", async () => {
    for (const m of [MIGRACAO_0144(), MIGRACAO_0142(), MIGRACAO_0144(), MIGRACAO_0142()]) await banco.pg.exec(m);
    expect(await n("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname LIKE 'whatsapp_grupo_envios_%'")).toBe(2);
  });

  it("CORRIGIDO (B2): a gravação do envio falha depois da Evolution aceitar — tenta de novo e, sem conseguir, o autor fica na auditoria e a tela é avisada", async () => {
    await banco.pg.exec(`CREATE FUNCTION qa_falha() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'falha simulada'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER qa_falha BEFORE INSERT ON whatsapp_grupo_envios FOR EACH ROW EXECUTE FUNCTION qa_falha();`);
    const r = await caller(COLAB_COM).whatsappGrupos.enviar({ grupoId: 1, texto: "saiu sem registro" });
    expect(r).toMatchObject({ ok: true, id: null, aviso: expect.stringMatching(/saiu para o grupo, mas o registro .* falhou/) });
    expect(evolucao).toHaveBeenCalledTimes(1); // saiu uma vez só (as novas tentativas são só da gravação)
    expect(await n("SELECT count(*)::int AS n FROM whatsapp_grupo_envios")).toBe(0);
    const acoes = await q<{ resultado: string; resumo: any; motivo: string }>("SELECT resultado, resumo, motivo FROM dolores_acoes WHERE funcao = 'grupo_central_envio'");
    expect(acoes).toEqual([expect.objectContaining({ resultado: "ok", resumo: expect.objectContaining({ registroFalhou: true, porUserId: 2, porNome: "Bianca Souza", externalId: "EQUIPE1", grupoId: 1 }) })]);
    expect(JSON.stringify(acoes)).not.toContain("saiu sem registro");
  });

  it("B2: falha só na primeira gravação — a nova tentativa grava e não há aviso", async () => {
    // a sequência não volta atrás com a falha (o contador numa tabela voltaria junto com o INSERT recusado)
    await banco.pg.exec(`CREATE SEQUENCE qa_cont;
      CREATE FUNCTION qa_falha1() RETURNS trigger AS $$ BEGIN IF nextval('qa_cont') = 1 THEN RAISE EXCEPTION 'falha uma vez'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER qa_falha1 BEFORE INSERT ON whatsapp_grupo_envios FOR EACH ROW EXECUTE FUNCTION qa_falha1();`);
    await expect(caller(ADMIN).whatsappGrupos.enviar({ grupoId: 1, texto: "oi" })).resolves.toMatchObject({ ok: true, aviso: null });
    expect(await q("SELECT enviado_por, external_id FROM whatsapp_grupo_envios")).toEqual([{ enviado_por: 1, external_id: "EQUIPE1" }]);
  });

  it("assumido: só 'tabela inexistente' (42P01) libera; coluna faltando, permissão negada ou erro qualquer → continua calada", async () => {
    await caller(ADMIN).whatsappGrupos.mudarAtendimento({ grupoId: 1, acao: "assumir" });
    expect(await grupoAssumidoPelaEquipe(1)).toBe(true);
    await banco.pg.exec(`ALTER TABLE whatsapp_grupo_atendimento RENAME COLUMN modo TO modo_x`);
    expect(await grupoAssumidoPelaEquipe(1)).toBe(true); // 42703 → falha fechada
    await banco.pg.exec(`ALTER TABLE whatsapp_grupo_atendimento RENAME COLUMN modo_x TO modo; ALTER TABLE whatsapp_grupo_atendimento RENAME TO wga_x`);
    expect(await grupoAssumidoPelaEquipe(1)).toBe(false); // 42P01 → "ninguém assumiu" (só se a tabela sumir/for renomeada)
    void msgDe;
  });
});
