// QA de SEGURANÇA da Etapa 7 (EPIC-025) — testes de PROVA dos achados do portão (@qa, 19/11/2026). Cada `it` documenta o
// comportamento ATUAL do código que o QA considera uma brecha; quando a correção entrar, inverta o `expect` marcado com "BRECHA".
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
const upsert = (jid: string, nome: string) => ({ event: "groups.upsert", instance: "prospecta-dolores", data: [{ id: jid, subject: nome, owner: `${DONO}@s.whatsapp.net`,
  participants: [{ id: `${DONO}@s.whatsapp.net`, admin: "superadmin" }, { id: `${OUTRO}@s.whatsapp.net`, admin: null }, { id: `${DOLORES}@s.whatsapp.net`, admin: null }] }] });

describe("QA-SEG E7 — autoria (só vale grupo em que o DONO colocou a Dolores)", () => {
  it("A1: aviso de 'add' com autor em @lid NÃO resolvido, em grupo onde o dono é admin: BRECHA — aceito pelo caminho de reserva", async () => {
    // o grupo foi criado pelo dono (admin) e um membro (@lid desconhecido) colocou a Dolores; o aviso existe, mas o autor não resolve
    nomes[NOVO] = "Administrativo";
    await chamar(eventoAdd(NOVO, "999888777666555@lid"));
    // BRECHA: deveria ficar recusado (ou aguardando o dono) — havia um autor e ele NÃO foi provado como o dono
    expect((await grupos())[0]).toMatchObject({ tipo: "administrativo", situacao_confirmacao: "avisado", adicionado_por: "dono", prova_adicao: "metadado" });
    expect(await q("SELECT responder_ligado FROM dolores_marcacoes_grupo")).toEqual([{ responder_ligado: true }]);
  });
  it("A1b: aviso de 'add' SEM campo author (Evolution não mandou): BRECHA — aceito pelo caminho de reserva", async () => {
    nomes[NOVO] = "Administrativo";
    await chamar(eventoAdd(NOVO, null));
    expect((await grupos())[0]).toMatchObject({ situacao_confirmacao: "avisado", adicionado_por: "dono", prova_adicao: "metadado" });
  });
  it("A2: corrida — a 1ª mensagem chega antes do aviso de 'add' feito por OUTRO: BRECHA — fica aceito (o aviso negativo não rebaixa)", async () => {
    nomes[NOVO] = "Administrativo";
    await chamar(aviso(item({ jid: NOVO, de: OUTRO })));
    await chamar(eventoAdd(NOVO, `${OUTRO}@s.whatsapp.net`));
    expect((await grupos())[0]).toMatchObject({ situacao_confirmacao: "avisado", adicionado_por: "dono", prova_adicao: "metadado" });
  });
  it("A3: grupo RECUSADO (OUTRO adicionou) é aceito sozinho por um groups.upsert com owner = dono: BRECHA — criador ≠ quem adicionou", async () => {
    nomes[NOVO] = "Administrativo";
    await chamar(eventoAdd(NOVO, `${OUTRO}@s.whatsapp.net`));
    expect((await grupos())[0]).toMatchObject({ situacao_confirmacao: "recusado" });
    const r = await chamar(upsert(NOVO, "Administrativo"));
    expect(r.body.r).toBe("grupo-evento-existente");
    // BRECHA: o dono não decidiu nada; o upsert só diz que ele CRIOU o grupo (há tempos), não que colocou a Dolores
    expect((await grupos())[0]).toMatchObject({ situacao_confirmacao: "avisado", adicionado_por: "dono", prova_adicao: "criador" });
    expect((await acoes("grupo_entrada")).map(a => a.motivo)).toContain("grupo recusado aceito: o dono adicionou a Dolores");
  });
  it("A4: 1ª mensagem sem aviso nenhum (o mesmo caminho do 'Atualizar grupos') aceita pelo caminho de reserva todo grupo em que o dono é admin", async () => {
    // na publicação, todos os grupos em que a Dolores JÁ está (inclusive os em que terceiros a puseram antes da etapa 7) passam por aqui
    nomes[NOVO] = "Parceiros";
    await chamar(aviso(item({ jid: NOVO, de: OUTRO })));
    expect((await grupos())[0]).toMatchObject({ tipo: "parceiros", situacao_confirmacao: "avisado", prova_adicao: "metadado" });
  });
});

describe("QA-SEG E7 — escopo por tipo", () => {
  it("B1: jurídico 'sem valores' — valor sem 'R$'/',00' passa pela saída se veio da consulta: BRECHA", () => {
    const fontes = [JSON.stringify({ financeiro: { moeda: "BRL", previsto: 18000, recebido: 5500, saldoAReceber: 12500 } })];
    const r = respostaSeguraInterna("O processo tem saldo a receber de 12500 e já entrou 5500.", null, { fontes, permiteValores: false });
    expect(r.foraDeEscopo).toBe(false); // BRECHA: o dinheiro do processo sai num grupo jurídico
    expect(r.texto).toContain("12500");
  });
  it("B2: parceiros — telefone estrangeiro (Geórgia +995) colide com o corretor A pela chave DDD+8 dígitos", async () => {
    const { parceiroDoRemetente } = await import("./marcacao.js");
    // corretor A: (99) 91111-2222 → chave 9911112222; +995 5 1111 2222 → "99" + "11112222"
    expect(await parceiroDoRemetente("995511112222")).toBe(3); // BRECHA (baixa): outro país vira o corretor A
    expect(await parceiroDoRemetente("5599911112222")).toBe(3);
  });
});

describe("QA-SEG E7 — custo/abuso", () => {
  it("C1: grupos RECUSADOS gastam o teto do dia e os avisos: 2 grupos de terceiros tiram o lugar do grupo do dono", async () => {
    await banco.pg.exec("UPDATE dolores_grupos_config SET teto_grupos_novos_dia = 2");
    nomes[NOVO] = "x"; nomes[NOVO2] = "y"; nomes[NOVO3] = "Jurídico";
    await chamar(eventoAdd(NOVO, `${OUTRO}@s.whatsapp.net`));
    await chamar(eventoAdd(NOVO2, `${OUTRO}@s.whatsapp.net`));
    const r = await chamar(eventoAdd(NOVO3, `${DONO}@s.whatsapp.net`));
    expect(r.body.r).toBe("grupo-evento-entrada-teto"); // o grupo que o DONO adicionou ficou de fora hoje
    expect((await grupos()).map(g => g.situacao_confirmacao)).toEqual(["recusado", "recusado"]);
  });
});
