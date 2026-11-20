// QA de SEGURANÇA da Etapa 7 (EPIC-025) — testes de PROVA dos achados do portão (@qa, 19/11/2026). Escritos mostrando as
// brechas; depois da correção (@dev, 19/11/2026) os `expect` foram invertidos e cada achado ganhou o seu teste de regressão.
// Harness copiado de grupos-automaticos.test.ts (PGlite; nada sai para a rede).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../whatsapp-router.js", async orig => ({ ...(await orig<typeof import("../whatsapp-router.js")>()), configEvolution: vi.fn(async () => null) }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { ADMIN_MODULES } from "../../shared/admin-permissions.js";
import {
  descobrirTipoDoGrupo, lerDecisaoDeGrupo, normalizarNome, textoDoAvisoDeEntrada, tipoEfetivo,
} from "../../shared/dolores/grupos-tipo.js";
import { FRASE_FORA_DE_ESCOPO, FRASE_PARCEIRO_NAO_IDENTIFICADO, foraDeEscopo, respostaSeguraInterna } from "../../shared/dolores/marcacao.js";
import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { appRouter } from "../routers.js";
import { definirClienteModelo } from "./cerebro.js";
import { definirDependenciasClassificacao } from "./classificacao.js";
import { definirDependenciasEntrada } from "./grupos-entrada.js";
import { LEITURAS_INTERNAS, definirDependenciasMarcacao, escopoDoGrupo, type PedidoGrupo, type RespostaGrupo } from "./marcacao.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte } from "./ponte.js";
import { AGORA, CENARIO, MIGRACAO_0133, criarBanco } from "./testes-banco.js";
import { definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";

const DONO = "5599991234567";
const DOLORES = "5599900001111";
const CLIENTE = "5599977776666";
const OUTRO = "5599955554444";
const CORRETOR_A = "5599911112222";
const CORRETOR_B = "5599933334444";
const NOVO = "120363555555555555@g.us";
const NOVO2 = "120363666666666666@g.us";
const NOVO3 = "120363777777777777@g.us";

let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviarAoDono: ReturnType<typeof vi.fn>;
let enviarAoGrupo: ReturnType<typeof vi.fn>;
let nomes: Record<string, string | null>;
/** Grupos cujos dados na Evolution mostram OUTRA pessoa como criadora e o dono fora (ou sem ser admin). */
let deOutro: Set<string>;
let pedidos: PedidoGrupo[];
let respostas: RespostaGrupo[];
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
const grupos = () => q<{ id: number; grupo_jid: string; nome: string; nome_whatsapp: string | null; tipo: string | null; lead_id: number | null; obra_id: number | null;
  origem: string; situacao_confirmacao: string; codigo: string | null; ativo: boolean; decidido_em: Date | null; decidido_por: string | null;
  adicionado_por: string | null; prova_adicao: string | null }>("SELECT * FROM dolores_grupos ORDER BY id");
const acoes = (funcao?: string) => q<{ funcao: string; resultado: string; motivo: string | null; resumo: any; canal: string }>(`SELECT * FROM dolores_acoes ${funcao ? `WHERE funcao = '${funcao}'` : ""} ORDER BY id`);
const avisosAoDono = () => enviarAoDono.mock.calls.map(c => c[0] as { numero: string; texto: string });

let seq = 0;
function item(p: { jid: string; de?: string; texto?: string; mencionar?: boolean; id?: string }) {
  const texto = p.texto ?? "Bom dia a todos";
  return {
    key: { remoteJid: p.jid, fromMe: false, id: p.id ?? `E7${++seq}`, participant: `${p.de ?? CLIENTE}@s.whatsapp.net` },
    message: p.mencionar ? { extendedTextMessage: { text: `@${DOLORES} ${texto}`, contextInfo: { mentionedJid: [`${DOLORES}@s.whatsapp.net`] } } } : { conversation: texto },
    messageTimestamp: Math.floor((AGORA.getTime() - 20_000) / 1000),
  };
}
/** Mensagem direta (conversa com a Dolores). */
function direta(de: string, texto: string) {
  return { key: { remoteJid: `${de}@s.whatsapp.net`, fromMe: false, id: `DM${++seq}` }, message: { conversation: texto }, messageTimestamp: Math.floor((AGORA.getTime() - 10_000) / 1000) };
}
const aviso = (...itens: unknown[]) => ({ event: "messages.upsert", instance: "prospecta-dolores", data: itens.length === 1 ? itens[0] : itens });
const chamar = (body: unknown) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, body, ip: "203.0.113.9" } as never);
const caller = (role: string, permissoes: string[] = []) =>
  appRouter.createCaller({ user: { id: 1, role, active: true, permissions: JSON.stringify(permissoes) }, req: {}, res: {} } as never);
const texto = (t: string): RespostaGrupo => ({ stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 60 }, content: [{ type: "text", text: t }] });

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}',
      numero_dolores = '${DOLORES}', ia_ligada = true, limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;
    INSERT INTO users ("openId", name, role, active, phone, "passwordHash") VALUES
      ('corretor-a', 'Corretor A', 'corretor', true, '(99) 91111-2222', 'h'), ('corretor-b', 'Corretor B', 'corretor', true, '(99) 93333-4444', 'h');
    INSERT INTO leads (name, phone, city, stage, broker_id, created_at, updated_at) VALUES
      ('Cliente Do Corretor A', '99900000001', 'Imperatriz', 'attending', 3, '2026-10-01', '2026-11-10'),
      ('Cliente Do Corretor B', '99900000002', 'Imperatriz', 'attending', 4, '2026-10-01', '2026-11-10');`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  esquecerUsuarioDolores();
  definirDependenciasPonte({ agora: () => AGORA });
  enviarAoDono = vi.fn(async () => true);
  definirDependenciasWhatsapp({ agora: () => AGORA, enviar: enviarAoDono as never });
  vi.mocked(configuracaoAnthropicPainel).mockResolvedValue({ apiKey: "sk-ant-chave-de-teste-nao-real-123456", modelo: "modelo-do-painel" });
  definirClienteModelo((async () => { throw new Error("o laço do DONO não pode ser chamado por mensagem de grupo"); }) as never);
  definirDependenciasClassificacao({ cliente: async () => { throw new Error("nada aqui classifica"); } });
  nomes = {};
  deOutro = new Set();
  // dados do grupo na Evolution: por padrão, criado pelo dono (participante e admin) com a Dolores dentro
  definirDependenciasEntrada({ ms: () => Date.now(), metadado: async (_i, jid) => {
    if (!(jid in nomes)) return null;
    return deOutro.has(jid)
      ? { nome: nomes[jid], criador: [`${OUTRO}@s.whatsapp.net`], participantes: [{ numero: OUTRO, lid: null, admin: true }, { numero: DONO, lid: null, admin: false }, { numero: DOLORES, lid: null, admin: false }] }
      : { nome: nomes[jid], criador: [`${DONO}@s.whatsapp.net`], participantes: [{ numero: DONO, lid: "111222333444555@lid", admin: true }, { numero: DOLORES, lid: null, admin: false }] };
  } });
  pedidos = [];
  respostas = [];
  enviarAoGrupo = vi.fn(async () => true);
  definirDependenciasMarcacao({
    agora: () => AGORA, enviar: enviarAoGrupo as never, contador: async () => 1_000,
    cliente: async p => { pedidos.push(JSON.parse(JSON.stringify(p))); return respostas.shift() ?? texto("FORA_DO_ESCOPO"); },
  });
});

const eventoAdd = (jid: string, autor: string | null, extra: Record<string, unknown> = {}) =>
  ({ event: "group-participants.update", instance: "prospecta-dolores", data: { id: jid, action: "add", participants: [`${DOLORES}@s.whatsapp.net`], ...(autor ? { author: autor } : {}), ...extra } });
const upsert = (jid: string, nome: string, creation?: number) => ({ event: "groups.upsert", instance: "prospecta-dolores", data: [{ id: jid, subject: nome, owner: `${DONO}@s.whatsapp.net`, ...(creation !== undefined ? { creation } : {}),
  participants: [{ id: `${DONO}@s.whatsapp.net`, admin: "superadmin" }, { id: `${OUTRO}@s.whatsapp.net`, admin: null }, { id: `${DOLORES}@s.whatsapp.net`, admin: null }] }] });

describe("QA-SEG E7 — autoria (só vale grupo em que o DONO colocou a Dolores)", () => {
  it("A1 (corrigido): aviso de 'add' com autor em @lid NÃO resolvido, em grupo onde o dono é admin → recusado, nunca a reserva", async () => {
    // o grupo foi criado pelo dono (admin) e um membro (@lid desconhecido) colocou a Dolores; o aviso existe, mas o autor não resolve
    nomes[NOVO] = "Administrativo";
    await chamar(eventoAdd(NOVO, "999888777666555@lid"));
    expect((await grupos())[0]).toMatchObject({ tipo: "administrativo", situacao_confirmacao: "recusado", adicionado_por: "desconhecido", prova_adicao: "sem_prova" });
    expect(await q("SELECT responder_ligado FROM dolores_marcacoes_grupo")).toEqual([]);
    expect(avisosAoDono()[0].texto).toMatch(/não consegui confirmar que foi você; ignorei/);
  });
  it("A1b (corrigido): aviso de 'add' SEM campo author → recusado", async () => {
    nomes[NOVO] = "Administrativo";
    await chamar(eventoAdd(NOVO, null));
    expect((await grupos())[0]).toMatchObject({ situacao_confirmacao: "recusado", adicionado_por: "desconhecido", prova_adicao: "sem_prova" });
    await chamar(aviso(item({ jid: NOVO })));
    expect(await q("SELECT count(*)::int AS n FROM dolores_grupo_mensagens")).toEqual([{ n: 0 }]);
  });
  it("A2 (corrigido): corrida — a 1ª mensagem chega antes do aviso de 'add' feito por OUTRO → o aviso rebaixa para recusado", async () => {
    nomes[NOVO] = "Administrativo";
    await chamar(aviso(item({ jid: NOVO, de: OUTRO })));
    expect((await grupos())[0]).toMatchObject({ situacao_confirmacao: "aguardando_dono", adicionado_por: "desconhecido", prova_adicao: "metadado" });
    await chamar(eventoAdd(NOVO, `${OUTRO}@s.whatsapp.net`));
    expect((await grupos())[0]).toMatchObject({ situacao_confirmacao: "recusado", adicionado_por: "outra_pessoa", prova_adicao: "evento_add", decidido_em: null });
    expect(await q("SELECT responder_ligado FROM dolores_marcacoes_grupo")).toEqual([{ responder_ligado: false }]);
    expect((await acoes("grupo_entrada")).map(a => a.motivo)).toContain("grupo REBAIXADO para recusado: o aviso de quem colocou a Dolores não mostra o dono");
    // a mensagem seguinte já não é registrada (recusado = nada lido)
    await chamar(aviso(item({ jid: NOVO, texto: "depois do rebaixamento" })));
    expect(await q("SELECT count(*)::int AS n FROM dolores_grupo_mensagens")).toEqual([{ n: 1 }]);
    // o mesmo vale para grupo já "avisado" que o dono ainda não decidiu (aviso de outro chegando depois do do dono)
    nomes[NOVO2] = "Jurídico";
    await chamar(eventoAdd(NOVO2, `${DONO}@s.whatsapp.net`));
    await chamar(eventoAdd(NOVO2, "999888777666555@lid"));
    expect((await grupos())[1]).toMatchObject({ situacao_confirmacao: "recusado", adicionado_por: "desconhecido" });
    // já decidido pelo dono (aceitou pelo WhatsApp): o aviso de outro não desfaz a decisão
    const [, h] = await grupos();
    await chamar(aviso(direta(DONO, `grupo ${h.codigo} aceitar`)));
    await chamar(eventoAdd(NOVO2, `${OUTRO}@s.whatsapp.net`));
    expect((await grupos())[1]).toMatchObject({ situacao_confirmacao: "confirmado", prova_adicao: "aceito_pelo_dono" });
  });
  it("A3 (corrigido): groups.upsert com owner = dono NUNCA tira grupo de recusado nem de aguardando o dono", async () => {
    nomes[NOVO] = "Administrativo";
    await chamar(eventoAdd(NOVO, `${OUTRO}@s.whatsapp.net`));
    expect((await grupos())[0]).toMatchObject({ situacao_confirmacao: "recusado" });
    // sem campo de criação e com criação recente: em nenhum dos dois o upsert muda o grupo existente
    expect((await chamar(upsert(NOVO, "Administrativo"))).body.r).toBe("grupo-evento-sem-prova");
    expect((await chamar(upsert(NOVO, "Administrativo", Math.floor(AGORA.getTime() / 1000)))).body.r).toBe("grupo-evento-existente");
    expect((await grupos())[0]).toMatchObject({ situacao_confirmacao: "recusado", adicionado_por: "outra_pessoa", prova_adicao: "evento_add" });
    nomes[NOVO2] = "Parceiros";
    await chamar(aviso(item({ jid: NOVO2 })));
    await chamar(upsert(NOVO2, "Parceiros", Math.floor(AGORA.getTime() / 1000)));
    expect((await grupos())[1]).toMatchObject({ situacao_confirmacao: "aguardando_dono", adicionado_por: "desconhecido" });
    expect((await acoes("grupo_entrada")).map(a => a.motivo).join("\n")).not.toMatch(/aceito/);
  });
  it("A3b: upsert vale só para grupo NOVO criado AGORA pelo dono (criação de poucos minutos); grupo antigo do dono não prova nada", async () => {
    const antigo = Math.floor(AGORA.getTime() / 1000) - 30 * 86_400;
    expect((await chamar(upsert(NOVO, "Jurídico", antigo))).body.r).toBe("grupo-evento-sem-prova");
    expect((await chamar(upsert(NOVO2, "Jurídico", Math.floor(AGORA.getTime() / 1000) - 10 * 60))).body.r).toBe("grupo-evento-sem-prova");
    expect(await grupos()).toHaveLength(0);
    expect((await chamar(upsert(NOVO3, "Jurídico", AGORA.getTime() - 90_000))).body.r).toBe("grupo-evento-criado"); // em milissegundos também
    // QA-SEG E7 r2 (R2-1): nem assim aceita sozinho — fica aguardando o dono, com a pergunta
    expect((await grupos())[0]).toMatchObject({ grupo_jid: NOVO3, situacao_confirmacao: "aguardando_dono", adicionado_por: "desconhecido", prova_adicao: "criador" });
  });
  it("A4 (corrigido): 1ª mensagem ou 'Atualizar grupos' sem aviso nenhum → no máximo aguardando o dono, com a pergunta; só ele aceita", async () => {
    // na publicação, todos os grupos em que a Dolores JÁ está passam por aqui
    nomes[NOVO] = "Parceiros";
    await banco.pg.exec("UPDATE dolores_marcacoes_config SET responder_ligado = true");
    await chamar(aviso(item({ jid: NOVO, de: OUTRO })));
    const [g] = await grupos();
    expect(g).toMatchObject({ tipo: "parceiros", situacao_confirmacao: "aguardando_dono", adicionado_por: "desconhecido", prova_adicao: "metadado" });
    expect(await q("SELECT responder_ligado FROM dolores_marcacoes_grupo")).toEqual([]); // interruptor do grupo desligado
    expect(avisosAoDono()).toHaveLength(1);
    expect(avisosAoDono()[0].texto).toBe(`Dolores: estou no grupo «Parceiros» e não sei quem me colocou. Se foi você, responda: grupo ${g.codigo} aceitar. Até lá só observo — não falo nada lá, nem se me marcarem.`);
    // marcada: silêncio, sem IA
    await chamar(aviso(item({ jid: NOVO, de: CORRETOR_A, mencionar: true, texto: "como estão meus clientes?" })));
    expect(pedidos).toHaveLength(0);
    expect(enviarAoGrupo).not.toHaveBeenCalled();
    // a tela não aceita (achado 6c); o comando do dono no WhatsApp aceita e segue o fluxo normal do tipo
    await expect(caller("admin").dolores.grupos.definirTipo({ grupoId: g.id, tipo: "aceitar" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller("admin").dolores.grupos.ligarMarcacaoGrupo({ grupoId: g.id, ligado: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await chamar(aviso(direta(OUTRO, `grupo ${g.codigo} aceitar`)));
    expect((await grupos())[0].situacao_confirmacao).toBe("aguardando_dono");
    await chamar(aviso(direta(DONO, `grupo ${g.codigo} aceitar`)));
    expect((await grupos())[0]).toMatchObject({ situacao_confirmacao: "confirmado", prova_adicao: "aceito_pelo_dono", decidido_por: "whatsapp:dono" });
    expect(await q("SELECT responder_ligado FROM dolores_marcacoes_grupo")).toEqual([{ responder_ligado: true }]);
  });
  it("A5: o dono adicionando a Dolores (aviso de 'add' com autor = dono) aceita o grupo que aguardava, e o aviso do tipo segue", async () => {
    nomes[NOVO] = "Jurídico";
    await chamar(aviso(item({ jid: NOVO })));
    enviarAoDono.mockClear();
    await chamar(eventoAdd(NOVO, `${DONO}@s.whatsapp.net`));
    expect((await grupos())[0]).toMatchObject({ situacao_confirmacao: "avisado", adicionado_por: "dono", prova_adicao: "evento_add", decidido_por: "whatsapp:dono-adicionou" });
    expect(avisosAoDono().map(a => a.texto)).toEqual([expect.stringMatching(/entrei no grupo «Jurídico»\. Entendi: grupo jurídico/)]);
  });
  it("A6 (gatilho): sem a decisão do dono pelo WhatsApp, o banco não tira grupo de 'aguardando o dono' sem prova; rebaixar é livre", async () => {
    nomes[NOVO] = "Jurídico"; nomes[NOVO2] = "Engenharia";
    await chamar(aviso(item({ jid: NOVO }), item({ jid: NOVO2 })));
    await expect(banco.pg.exec(`UPDATE dolores_grupos SET situacao_confirmacao = 'avisado' WHERE grupo_jid = '${NOVO}'`)).rejects.toThrow(/DOLORES_GRUPOS_DECISAO/);
    await expect(banco.pg.exec(`UPDATE dolores_grupos SET adicionado_por = 'dono' WHERE grupo_jid = '${NOVO}'`)).rejects.toThrow(/DOLORES_GRUPOS_DECISAO/);
    await expect(banco.pg.exec(`UPDATE dolores_grupos SET situacao_confirmacao = 'confirmado', decidido_em = now(), decidido_por = 'tela:1' WHERE grupo_jid = '${NOVO}'`)).rejects.toThrow(/DOLORES_GRUPOS_DECISAO/);
    await expect(banco.pg.exec(`UPDATE dolores_grupos SET origem = 'manual' WHERE grupo_jid = '${NOVO}'`)).rejects.toThrow(/IMUTAVEL/);
    await banco.pg.exec(`UPDATE dolores_grupos SET situacao_confirmacao = 'recusado' WHERE grupo_jid = '${NOVO2}'`);
    await banco.pg.exec(`UPDATE dolores_grupos SET situacao_confirmacao = 'confirmado', prova_adicao = 'aceito_pelo_dono', decidido_em = now(), decidido_por = 'whatsapp:dono' WHERE grupo_jid = '${NOVO}'`);
    expect((await grupos()).map(g => g.situacao_confirmacao)).toEqual(["confirmado", "recusado"]);
  });
});

describe("QA-SEG E7 — escopo por tipo", () => {
  it("B1 (corrigido): jurídico 'sem valores' — palavra de dinheiro na saída vira a frase fixa, mesmo com o número vindo da consulta", () => {
    const fontes = [JSON.stringify({ financeiro: { moeda: "BRL", previsto: 18000, recebido: 5500, saldoAReceber: 12500 } })];
    const r = respostaSeguraInterna("O processo tem saldo a receber de 12500 e já entrou 5500.", null, { fontes, permiteValores: false });
    expect(r.foraDeEscopo).toBe(true);
    expect(r.texto).toBe(FRASE_FORA_DE_ESCOPO);
    for (const t of ["A parcela de 3 está em aberto.", "O orçamento da obra 2 é 350000.", "Faltam 2 pagamentos.", "O valor previsto é 18000."]) {
      expect(respostaSeguraInterna(t, null, { fontes: ["2 3 350000 18000"], permiteValores: false }).texto, t).toBe(FRASE_FORA_DE_ESCOPO);
    }
    // o administrativo (com valores) continua informando o que veio das consultas
    expect(respostaSeguraInterna("O saldo a receber é 12500.", null, { fontes, permiteValores: true }).foraDeEscopo).toBe(false);
    // o que não é dinheiro continua passando no jurídico
    expect(respostaSeguraInterna("Há 3 processos com documentos pendentes.", null, { fontes: ['{"total":3}'], permiteValores: false }).foraDeEscopo).toBe(false);
  });
  it("B1b: os campos de dinheiro saem NO SERVIDOR do que as consultas do jurídico e da engenharia devolvem ao modelo", async () => {
    nomes[NOVO] = "Jurídico"; nomes[NOVO2] = "Engenharia"; nomes[NOVO3] = "Administrativo";
    for (const j of [NOVO, NOVO2, NOVO3]) await chamar(eventoAdd(j, `${DONO}@s.whatsapp.net`));
    const [jur, eng, adm] = await getDb().select().from((await import("../../drizzle/schema-dolores-grupos.js")).doloresGrupos).orderBy((await import("../../drizzle/schema-dolores-grupos.js")).doloresGrupos.id);
    const executar = async (g: typeof jur, nome: string, args: Record<string, unknown> = {}) => {
      const e = await escopoDoGrupo(g, { participante: CLIENTE }, AGORA);
      if (!("escopo" in e)) throw new Error("esperava escopo");
      const r = await e.escopo.executar(nome, args, { marcacaoId: 1, autor: null });
      expect(r.ok, nome).toBe(true);
      return JSON.stringify(r.corpo);
    };
    const detalhe = await executar(jur, "detalhar_processo_regularizacao", { id: 1 });
    expect(detalhe).not.toMatch(/"financeiro"|saldoAReceber|"previsto"|"moeda"/);
    const obrasEng = await executar(eng, "listar_obras");
    expect(obrasEng).not.toMatch(/orcamentoPrevisto|"vgv"|"moeda"/);
    const medicoes = await executar(eng, "listar_medicoes");
    expect(medicoes).not.toMatch(/"valor"|"moeda"/);
    const notas = await executar(eng, "listar_notas_obra");
    expect(notas).not.toMatch(/valorBRL|textoSugeridoParaODonoEnviar/);
    // o administrativo (sócios) continua vendo os valores
    expect(await executar(adm, "listar_obras")).toMatch(/orcamentoPrevisto/);
  });
  it("B2 (corrigido): parceiros — telefone estrangeiro (Geórgia +995) com os mesmos finais NÃO vira o corretor A", async () => {
    const { parceiroDoRemetente } = await import("./marcacao.js");
    // corretor A: (99) 91111-2222 → +55 99 9 1111-2222; +995 5 1111 2222 tinha a mesma chave DDD + 8 dígitos
    expect(await parceiroDoRemetente("995511112222")).toBeNull();
    expect(await parceiroDoRemetente("99911112222")).toBeNull(); // sem o 55
    expect(await parceiroDoRemetente("5599911112222")).toBe(3);
    expect(await parceiroDoRemetente("5598911112222")).toBeNull(); // outro DDD
  });
});

describe("QA-SEG E7 — custo/abuso", () => {
  it("C1 (corrigido): grupos RECUSADOS têm teto próprio — terceiros não tiram o lugar do grupo que o DONO adicionou", async () => {
    await banco.pg.exec("UPDATE dolores_grupos_config SET teto_grupos_novos_dia = 2");
    nomes[NOVO] = "x"; nomes[NOVO2] = "y"; nomes[NOVO3] = "Jurídico";
    await chamar(eventoAdd(NOVO, `${OUTRO}@s.whatsapp.net`));
    await chamar(eventoAdd(NOVO2, `${OUTRO}@s.whatsapp.net`));
    const r = await chamar(eventoAdd(NOVO3, `${DONO}@s.whatsapp.net`));
    expect(r.body.r).toBe("grupo-evento-criado");
    expect((await grupos()).map(g => g.situacao_confirmacao)).toEqual(["recusado", "recusado", "avisado"]);
    // o 3º recusado do dia (teto 2) fica de fora, com UM aviso do teto próprio
    const quarto = "120363888888888888@g.us";
    expect((await chamar(eventoAdd(quarto, `${OUTRO}@s.whatsapp.net`))).body.r).toBe("grupo-evento-entrada-teto");
    expect((await chamar(eventoAdd("120363999999999999@g.us", `${OUTRO}@s.whatsapp.net`))).body.r).toBe("grupo-evento-entrada-teto");
    expect(avisosAoDono().filter(a => /não ficou provado que foi você quem me colocou \(o teto do dia\)/.test(a.texto))).toHaveLength(1);
  });
  it("C2: avisos de grupos sem prova agrupados — os 5 primeiros do dia, depois UM resumo; os avisos do dono não são gastos", async () => {
    await banco.pg.exec("UPDATE dolores_grupos_config SET teto_avisos_grupos_dia = 6");
    for (let i = 0; i < 9; i++) await chamar(eventoAdd(`12036340000000000${i}@g.us`, `${OUTRO}@s.whatsapp.net`));
    const textos = avisosAoDono().map(a => a.texto);
    expect(textos.filter(t => /por outra pessoa; ignorei/.test(t))).toHaveLength(5);
    expect(textos.filter(t => /Os próximos de hoje não vou avisar um a um/.test(t))).toHaveLength(1);
    expect(textos).toHaveLength(6);
    nomes[NOVO] = "Jurídico";
    await chamar(eventoAdd(NOVO, `${DONO}@s.whatsapp.net`));
    expect(avisosAoDono().map(a => a.texto).filter(t => /entrei no grupo «Jurídico»/.test(t))).toHaveLength(1);
  });
  it("C3: rajada paralela de mensagens do MESMO grupo novo → uma só consulta à Evolution, uma só vaga, um só grupo e um só aviso", async () => {
    let consultas = 0;
    definirDependenciasEntrada({ ms: () => Date.now(), metadado: async () => { consultas++; await new Promise(r => setTimeout(r, 30)); return { nome: "Jurídico", criador: [`${DONO}@s.whatsapp.net`], participantes: [{ numero: DONO, lid: null, admin: true }] }; } });
    await Promise.all(Array.from({ length: 6 }, (_, i) => chamar(aviso(item({ jid: NOVO, texto: `mensagem ${i}` })))));
    expect(consultas).toBe(1);
    expect(await grupos()).toHaveLength(1);
    expect(await q("SELECT chave, total FROM dolores_marcacoes_contagem WHERE chave LIKE 'entrada%'")).toEqual([{ chave: expect.stringMatching(/^entrada-sem-prova:/), total: 1 }]);
    expect(avisosAoDono()).toHaveLength(1);
    expect(await q("SELECT count(*)::int AS n FROM dolores_grupo_mensagens")).toEqual([{ n: 6 }]);
  });
});

describe("QA-SEG E7 — janela de migração (0133 aplicada com o código ANTIGO ainda no ar)", () => {
  it("J1: as operações do código anterior à etapa 7 sobre grupo manual continuam funcionando; as linhas da etapa 7 seguem travadas", async () => {
    const b = await criarBanco({ semEtapa7: true });
    await b.pg.exec(CENARIO);
    // cadastro como o código antigo faz (sem as colunas novas)
    await b.pg.exec(`INSERT INTO dolores_grupos (instancia, grupo_jid, nome, criado_por_user_id) VALUES ('prospecta-dolores', '120363111111111111@g.us', 'Grupo sem card', 1);
      INSERT INTO dolores_grupos (instancia, grupo_jid, nome, lead_id) VALUES ('prospecta-dolores', '120363222222222222@g.us', 'Grupo do lead', 1);`);
    await b.pg.exec(MIGRACAO_0133());
    // depois da 0133, cadastro antigo de novo
    await b.pg.exec(`INSERT INTO dolores_grupos (instancia, grupo_jid, nome) VALUES ('prospecta-dolores', '120363333333333333@g.us', 'Grupo novo pela tela antiga')`);
    // ligarGrupoAoCliente ANTIGO (fila aprovada): UPDATE de lead_id sem decidido_em
    await b.pg.exec(`UPDATE dolores_grupos SET lead_id = 2, atualizado_em = now(), atualizado_por_user_id = 1 WHERE id = 1 AND ativo AND lead_id IS NULL AND obra_id IS NULL`);
    await b.pg.exec(`UPDATE dolores_grupos SET lead_id = 3, atualizado_em = now(), atualizado_por_user_id = 1 WHERE id = 3 AND ativo AND lead_id IS NULL AND obra_id IS NULL`);
    // tela antiga grupos.atualizar: troca de vínculo (cliente → obra), rótulo e ativo, sempre regravando lead_id/obra_id
    await b.pg.exec(`UPDATE dolores_grupos SET nome = 'Rótulo novo', ativo = false, lead_id = NULL, obra_id = 1, atualizado_em = now(), atualizado_por_user_id = 1 WHERE id = 2`);
    await b.pg.exec(`UPDATE dolores_grupos SET ativo = true, lead_id = NULL, obra_id = 1, atualizado_em = now(), atualizado_por_user_id = 1 WHERE id = 2`);
    await b.pg.exec(`UPDATE dolores_grupos SET lead_id = 4, obra_id = NULL, atualizado_em = now(), atualizado_por_user_id = 1 WHERE id = 2`);
    expect((await b.pg.query<any>("SELECT id, lead_id, obra_id, tipo, origem FROM dolores_grupos ORDER BY id")).rows).toEqual([
      { id: 1, lead_id: 2, obra_id: null, tipo: null, origem: "manual" }, { id: 2, lead_id: 4, obra_id: null, tipo: null, origem: "manual" },
      { id: 3, lead_id: 3, obra_id: null, tipo: null, origem: "manual" }]);
    // as linhas da etapa 7 continuam exigindo a decisão do dono
    await b.pg.exec(`INSERT INTO dolores_grupos (instancia, grupo_jid, nome, origem, tipo, situacao_confirmacao, adicionado_por, prova_adicao)
      VALUES ('prospecta-dolores', '120363444444444444@g.us', 'Auto', 'automatico', 'indefinido', 'aguardando_dono', 'dono', 'evento_add')`);
    await expect(b.pg.exec(`UPDATE dolores_grupos SET tipo = 'cliente', lead_id = 2 WHERE id = 4`)).rejects.toThrow(/DOLORES_GRUPOS_DECISAO/);
    await expect(b.pg.exec(`UPDATE dolores_grupos SET tipo = 'juridico' WHERE id = 1`)).rejects.toThrow(/DOLORES_GRUPOS_DECISAO/);
    await b.pg.exec(`UPDATE dolores_grupos SET tipo = 'cliente', lead_id = 2, decidido_em = now(), decidido_por = 'whatsapp:dono' WHERE id = 4`);
  });
});

describe("QA-SEG E7 — só o dono aceita; aviso de quem entra no administrativo", () => {
  it("D1 (6c): pela tela, admin não aceita grupo recusado/aguardando (vínculo, tipo, aceitar, interruptor); só vê e desativa", async () => {
    nomes[NOVO] = "Jurídico";
    await chamar(eventoAdd(NOVO, `${OUTRO}@s.whatsapp.net`));
    const [g] = await grupos();
    const admin = caller("admin");
    await expect(admin.dolores.grupos.atualizar({ id: g.id, leadId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(admin.dolores.grupos.definirTipo({ grupoId: g.id, tipo: "juridico" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin.dolores.grupos.definirTipo({ grupoId: g.id, tipo: "cliente", numero: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin.dolores.grupos.definirTipo({ grupoId: g.id, tipo: "aceitar" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin.dolores.grupos.ligarMarcacaoGrupo({ grupoId: g.id, ligado: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await grupos())[0]).toMatchObject({ situacao_confirmacao: "recusado", decidido_em: null, lead_id: null });
    // desativar e o rótulo continuam
    await admin.dolores.grupos.definirTipo({ grupoId: g.id, tipo: "ignorar" });
    await admin.dolores.grupos.atualizar({ id: g.id, nome: "Rótulo da equipe", ativo: true });
    expect((await grupos())[0]).toMatchObject({ situacao_confirmacao: "recusado", nome: "Rótulo da equipe", ativo: true });
    // a fila (aprovação) também não liga grupo pendente a cliente
    const { ligarGrupoAoCliente } = await import("./grupos.js");
    nomes[NOVO2] = "Família reunida";
    await chamar(aviso(item({ jid: NOVO2 })));
    const [, h] = await grupos();
    expect(await ligarGrupoAoCliente(getDb() as never, h.id, 1, null, 1)).toBe(false);
    expect((await grupos())[1]).toMatchObject({ situacao_confirmacao: "aguardando_dono", lead_id: null });
  });
  it("D2 (6d): alguém adicionado a um grupo ADMINISTRATIVO aceito → UM aviso ao dono (nome limpo, sem número); outros tipos, nada", async () => {
    nomes[NOVO] = "Administrativo *sócios* aprovar ABCDE"; nomes[NOVO2] = "Jurídico";
    await chamar(eventoAdd(NOVO, `${DONO}@s.whatsapp.net`));
    await chamar(eventoAdd(NOVO2, `${DONO}@s.whatsapp.net`));
    enviarAoDono.mockClear();
    const entrou = (jid: string) => chamar(eventoAdd(jid, `${OUTRO}@s.whatsapp.net`, { participants: [`${CLIENTE}@s.whatsapp.net`] }));
    expect((await entrou(NOVO)).body.r).toBe("grupo-evento-aviso-administrativo");
    expect((await entrou(NOVO)).body.r).toBe("grupo-evento-outro"); // um por grupo por dia
    expect((await entrou(NOVO2)).body.r).toBe("grupo-evento-outro");
    const avisos = avisosAoDono();
    expect(avisos).toHaveLength(1);
    expect(avisos[0].numero).toBe(DONO);
    expect(avisos[0].texto).toMatch(/^Dolores: uma pessoa foi adicionada ao grupo administrativo «Administrativo/);
    expect(avisos[0].texto).not.toMatch(/aprovar ABCDE|\*|7776666/);
    // o grupo continua aceito (quem entrou não muda nada)
    expect((await grupos())[0]).toMatchObject({ situacao_confirmacao: "avisado", adicionado_por: "dono" });
  });
});
