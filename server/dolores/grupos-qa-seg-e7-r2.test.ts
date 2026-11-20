// QA de SEGURANÇA da Etapa 7 (EPIC-025) — 2ª RODADA (@qa, 20/11/2026). Testes de PROVA do que a 2ª rodada encontrou ou confirmou.
// Cada `it` descreve o comportamento ATUAL do código (os que mostram uma brecha/risco dizem isso no nome). Harness copiado de
// grupos-qa-seg-e7.test.ts (PGlite; nada sai para a rede).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../whatsapp-router.js", async orig => ({ ...(await orig<typeof import("../whatsapp-router.js")>()), configEvolution: vi.fn(async () => null) }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { respostaSeguraDoGrupo, respostaSeguraInterna, semCamposDeValor } from "../../shared/dolores/marcacao.js";
import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { appRouter } from "../routers.js";
import { definirClienteModelo } from "./cerebro.js";
import { definirDependenciasClassificacao } from "./classificacao.js";
import { definirDependenciasEntrada } from "./grupos-entrada.js";
import { definirDependenciasMarcacao } from "./marcacao.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte } from "./ponte.js";
import { AGORA, CENARIO, MIGRACAO_0133, criarBanco } from "./testes-banco.js";
import { definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";

const DONO = "5599991234567";
const DOLORES = "5599900001111";
const OUTRO = "5599955554444";
const NOVO = "120363555555555555@g.us";
const NOVO2 = "120363666666666666@g.us";

let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviarAoDono: ReturnType<typeof vi.fn>;
let nomes: Record<string, string | null>;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
const grupos = () => q<any>("SELECT * FROM dolores_grupos ORDER BY id");
const chamar = (body: unknown) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, body, ip: "203.0.113.9" } as never);
const caller = (role: string) => appRouter.createCaller({ user: { id: 1, role, active: true, permissions: "[]" }, req: {}, res: {} } as never);
const eventoAdd = (jid: string, autor: string) =>
  ({ event: "group-participants.update", instance: "prospecta-dolores", data: { id: jid, action: "add", participants: [`${DOLORES}@s.whatsapp.net`], author: autor } });
const eventoRemove = (jid: string, autor: string) =>
  ({ event: "group-participants.update", instance: "prospecta-dolores", data: { id: jid, action: "remove", participants: [`${DOLORES}@s.whatsapp.net`], author: autor } });
/** groups.upsert com o DONO como criador e criação AGORA (o grupo do dono, criado há instantes, com OUTRO como membro). */
const upsertDoDono = (jid: string, nome: string) => ({ event: "groups.upsert", instance: "prospecta-dolores", data: [{ id: jid, subject: nome, owner: `${DONO}@s.whatsapp.net`,
  creation: Math.floor(AGORA.getTime() / 1000) - 120,
  participants: [{ id: `${DONO}@s.whatsapp.net`, admin: "superadmin" }, { id: `${OUTRO}@s.whatsapp.net`, admin: "admin" }, { id: `${DOLORES}@s.whatsapp.net`, admin: null }] }] });

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}',
      numero_dolores = '${DOLORES}', ia_ligada = true, limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  esquecerUsuarioDolores();
  definirDependenciasPonte({ agora: () => AGORA });
  enviarAoDono = vi.fn(async () => true);
  definirDependenciasWhatsapp({ agora: () => AGORA, enviar: enviarAoDono as never });
  vi.mocked(configuracaoAnthropicPainel).mockResolvedValue({ apiKey: "sk-ant-chave-de-teste-nao-real-123456", modelo: "modelo-do-painel" });
  definirClienteModelo((async () => { throw new Error("o laço do DONO não pode ser chamado por evento de grupo"); }) as never);
  definirDependenciasClassificacao({ cliente: async () => { throw new Error("nada aqui classifica"); } });
  nomes = {};
  definirDependenciasEntrada({ ms: () => Date.now(), metadado: async (_i, jid) => (jid in nomes
    ? { nome: nomes[jid], criador: [`${DONO}@s.whatsapp.net`], participantes: [{ numero: DONO, lid: null, admin: true }, { numero: DOLORES, lid: null, admin: false }] } : null) });
  definirDependenciasMarcacao({ agora: () => AGORA, enviar: vi.fn(async () => true) as never, contador: async () => 1_000, cliente: async () => { throw new Error("sem IA aqui"); } });
});

describe("QA-SEG E7 r2 — autoria", () => {
  it("R2-1 (corrigido): upsert de grupo criado pelo DONO há 2 min NÃO aceita sozinho (não prova quem estava desde o início): aguardando o dono, com a pergunta", async () => {
    expect((await chamar(upsertDoDono(NOVO, "Administrativo"))).body.r).toBe("grupo-evento-criado");
    expect((await grupos())[0]).toMatchObject({ situacao_confirmacao: "aguardando_dono", adicionado_por: "desconhecido", prova_adicao: "criador" });
    expect(await q("SELECT responder_ligado FROM dolores_marcacoes_grupo")).toEqual([]);
    expect(enviarAoDono.mock.calls.map(c => String(c[1] ?? c[0])).join("\n") + JSON.stringify(enviarAoDono.mock.calls)).toMatch(/não sei quem me colocou/);
    // o aviso de "add" feito por OUTRO rebaixa; o do DONO (outro grupo) aceita
    await chamar(eventoAdd(NOVO, `${OUTRO}@s.whatsapp.net`));
    expect((await grupos())[0]).toMatchObject({ situacao_confirmacao: "recusado", adicionado_por: "outra_pessoa" });
    expect(await q("SELECT responder_ligado FROM dolores_marcacoes_grupo")).toEqual([{ responder_ligado: false }]);
    await chamar(upsertDoDono(NOVO2, "Jurídico"));
    await chamar(eventoAdd(NOVO2, `${DONO}@s.whatsapp.net`));
    expect((await grupos())[1]).toMatchObject({ situacao_confirmacao: "avisado", adicionado_por: "dono", prova_adicao: "evento_add" });
  });

  it("R2-2: grupo que o DONO adicionou (aceito sozinho, sem decidido_em) é REBAIXADO se outro admin do grupo a remove e readiciona; aceito pelo COMANDO, não", async () => {
    nomes[NOVO] = "Jurídico"; nomes[NOVO2] = "Engenharia";
    await chamar(eventoAdd(NOVO, `${DONO}@s.whatsapp.net`));
    await chamar(eventoAdd(NOVO2, `${DONO}@s.whatsapp.net`));
    const [, b] = await grupos();
    await chamar({ event: "messages.upsert", instance: "prospecta-dolores", data: { key: { remoteJid: `${DONO}@s.whatsapp.net`, fromMe: false, id: "DM-R2" },
      message: { conversation: `grupo ${b.codigo} engenharia` }, messageTimestamp: Math.floor((AGORA.getTime() - 10_000) / 1000) } });
    for (const j of [NOVO, NOVO2]) { await chamar(eventoRemove(j, `${OUTRO}@s.whatsapp.net`)); await chamar(eventoAdd(j, `${OUTRO}@s.whatsapp.net`)); }
    const [g1, g2] = await grupos();
    expect(g1).toMatchObject({ situacao_confirmacao: "recusado", adicionado_por: "outra_pessoa" }); // falha fechada (negação de serviço possível)
    expect(g2).toMatchObject({ situacao_confirmacao: "confirmado", decidido_por: "whatsapp:dono" }); // decisão do dono vale
  });

  it("R2-3 (interpretação): grupo 'aguardando_dono' que o DONO provadamente adicionou (tipo indefinido) pode ter o tipo definido por QUALQUER admin pela tela", async () => {
    nomes[NOVO] = "Turma do churrasco";
    await chamar(eventoAdd(NOVO, `${DONO}@s.whatsapp.net`));
    const [g] = await grupos();
    expect(g).toMatchObject({ tipo: "indefinido", situacao_confirmacao: "aguardando_dono", adicionado_por: "dono" });
    await caller("admin").dolores.grupos.definirTipo({ grupoId: g.id, tipo: "administrativo" });
    expect((await grupos())[0]).toMatchObject({ tipo: "administrativo", situacao_confirmacao: "confirmado", decidido_por: "tela:1" });
    expect(await q("SELECT responder_ligado FROM dolores_marcacoes_grupo")).toEqual([{ responder_ligado: true }]);
  });

  it("R2-4: a tela, a fila e o atualizarGrupos nunca gravam decidido_por 'whatsapp:'; o gatilho barra 'tela:' para tirar de recusado", async () => {
    nomes[NOVO] = "Jurídico";
    await chamar(eventoAdd(NOVO, `${OUTRO}@s.whatsapp.net`));
    const [g] = await grupos();
    await caller("admin").dolores.grupos.definirTipo({ grupoId: g.id, tipo: "ignorar" });
    expect((await grupos())[0]).toMatchObject({ situacao_confirmacao: "recusado", ativo: false, decidido_por: "tela:1" });
    await expect(banco.pg.exec(`UPDATE dolores_grupos SET situacao_confirmacao = 'confirmado', decidido_em = now() + interval '1 s', decidido_por = 'tela:1' WHERE id = ${g.id}`)).rejects.toThrow(/DOLORES_GRUPOS_DECISAO/);
  });
});

describe("QA-SEG E7 r2 — sem valores no jurídico/engenharia", () => {
  it("R2-5 (corrigido): alertas e conciliacao saem das leituras; em TODO texto que sobrar, valores em dinheiro viram [valor omitido]", () => {
    const nota = { notaId: 1, alertas: ["a soma dos itens (R$ 1.234,56) não bate com o total lido (R$ 1.500,00): confira"],
      conciliacao: { situacao: "provável", detalhe: "pagamento encontrado no BPO: lançamento #9 (R$ 1.500,00, 10/11/2026)" }, valorBRL: 1500,
      observacoes: "saldo a receber de 12500; preço: 3.200 por m²; 12 mil de entrada; custou 1.500 reais", descricao: "Medição 3 da obra 12 (R$1500)",
      ultimasAtividadesDoCliente: [{ textoLivre: "cliente pagou 2.300,00 de sinal" }] };
    const limpo = semCamposDeValor({ itens: [nota] }) as { itens: Array<Record<string, any>> };
    const s = JSON.stringify(limpo);
    expect(s).not.toMatch(/valorBRL|alertas|conciliacao/);
    expect(s).not.toMatch(/R\$|1\.500|1\.234|12500|3\.200|2\.300|12 mil|1500/);
    expect(limpo.itens[0].observacoes).toBe("saldo a receber de [valor omitido]; preço: [valor omitido] por m²; [valor omitido] de entrada; custou [valor omitido] reais");
    expect(limpo.itens[0].descricao).toBe("Medição 3 da obra 12 ([valor omitido])");
    expect(limpo.itens[0].ultimasAtividadesDoCliente[0].textoLivre).toBe("cliente pagou [valor omitido] de sinal");
    // o modelo reescrevendo um valor que não está nas leituras: o número sem fonte barra a saída
    const r = respostaSeguraInterna("Na nota 1 a soma dos itens deu 1.234 e o total lido 1.500; confira.", null, { fontes: [s], permiteValores: false });
    expect(r.foraDeEscopo).toBe(true);
  });

  it("R2-6 (ajustado): palavras de SITUAÇÃO passam sem número de dinheiro; as de QUANTIA continuam barradas; cliente/parceiros não mudam", () => {
    for (const t of ["A medição 3 da obra 1 já foi paga.", "O pagamento da medição está aguardando o banco.", "A nota 1 está aguardando pagamento."]) {
      expect(respostaSeguraInterna(t, null, { fontes: ["1 3"], permiteValores: false }).foraDeEscopo, t).toBe(false);
    }
    for (const t of ["A etapa de fundação teve custo acima do previsto?", "O valor da medição 3 ainda não saiu.", "O saldo da obra 1 está em dia.", "O orçamento da obra 1 foi revisto.",
      "A medição 3 foi paga: 1500.", "A medição 3 foi paga: 1.500.", "Pagamento de 2500 da obra 1 feito.", "A medição 3 foi paga, 12 mil.", "Foi pago R$ 3", "A parcela 3 foi paga."]) {
      expect(respostaSeguraInterna(t, null, { fontes: ["1 3 1500 2500 12"], permiteValores: false }).foraDeEscopo, t).toBe(true);
    }
    // grupo de cliente/parceiros (respostaSeguraDoGrupo): nada afrouxou
    expect(respostaSeguraDoGrupo("O valor da parcela foi pago.", null).foraDeEscopo).toBe(true);
    expect(respostaSeguraDoGrupo("A medição 3 foi paga: R$ 1.500,00.", null).foraDeEscopo).toBe(true);
  });
});

describe("QA-SEG E7 r2 — migração 0133", () => {
  it("R2-7: ON DELETE SET NULL (cliente, obra, usuário) passa pelo gatilho em linhas da etapa 7; 0133 aplicada 2x + 3ª vez sem erro", async () => {
    await banco.pg.exec(MIGRACAO_0133()); // terceira aplicação
    await banco.pg.exec(`INSERT INTO leads (name, phone, city, stage, created_at, updated_at) VALUES ('Lead Para Excluir', '99900009999', 'Imperatriz', 'attending', '2026-10-01', '2026-11-10');
      INSERT INTO users ("openId", name, role, active, "passwordHash") VALUES ('admin-sai', 'Admin Que Sai', 'admin', true, 'h');`);
    const [{ id: lead }] = await q<{ id: number }>("SELECT id FROM leads WHERE name = 'Lead Para Excluir'");
    const [{ id: user }] = await q<{ id: number }>(`SELECT id FROM users WHERE "openId" = 'admin-sai'`);
    const [{ id: obra }] = await q<{ id: number }>("SELECT id FROM construction_projects ORDER BY id LIMIT 1");
    await banco.pg.exec(`INSERT INTO dolores_grupos (instancia, grupo_jid, nome, origem, tipo, lead_id, situacao_confirmacao, adicionado_por, prova_adicao, criado_por_user_id, atualizado_por_user_id)
      VALUES ('prospecta-dolores', '120363101010101010@g.us', 'Cli', 'automatico', 'cliente', ${lead}, 'recusado', 'outra_pessoa', 'evento_add', ${user}, ${user});
      INSERT INTO dolores_grupos (instancia, grupo_jid, nome, origem, tipo, obra_id, situacao_confirmacao, adicionado_por, prova_adicao)
      VALUES ('prospecta-dolores', '120363202020202020@g.us', 'Obra', 'automatico', 'engenharia', ${obra}, 'avisado', 'dono', 'evento_add');`);
    await banco.pg.exec(`DELETE FROM leads WHERE id = ${lead}`);
    await banco.pg.exec(`DELETE FROM users WHERE id = ${user}`);
    const r = await q<any>("SELECT lead_id, obra_id, tipo, criado_por_user_id, situacao_confirmacao FROM dolores_grupos WHERE grupo_jid IN ('120363101010101010@g.us') ");
    expect(r).toEqual([{ lead_id: null, obra_id: null, tipo: "cliente", criado_por_user_id: null, situacao_confirmacao: "recusado" }]);
    // o CHECK aceita 'desconhecido'
    await banco.pg.exec(`INSERT INTO dolores_grupos (instancia, grupo_jid, nome, origem, tipo, situacao_confirmacao, adicionado_por, prova_adicao)
      VALUES ('prospecta-dolores', '120363303030303030@g.us', 'X', 'automatico', 'indefinido', 'recusado', 'desconhecido', 'sem_prova')`);
  });
});
