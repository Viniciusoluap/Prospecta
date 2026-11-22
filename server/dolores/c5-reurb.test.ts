// EPIC-027 C5 (REURB) — análise de regularização fundiária pela Dolores: só na conversa direta do dono, somente leitura, com o
// conhecimento destilado (sem invenção) e o aviso fixo garantido por código. Banco em memória (PGlite); modelo e envio falsos.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { readFileSync } from "node:fs";
import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import {
  AVISO_REURB, DADOS_DO_NUCLEO, ETAPAS_REURB, FUNCAO_REURB, MODALIDADES_REURB, comAvisoReurb, conhecimentoReurb, instrucaoDoParecerReurb, textoIndicaReurb,
} from "../../shared/dolores/reurb-conhecimento.js";
import { MAX_CARACTERES_WHATSAPP, partesDaResposta } from "../../shared/dolores/whatsapp.js";
import { definirClienteModelo, type PedidoModelo, type RespostaModelo } from "./cerebro.js";
import { FUNCOES, funcaoPorNome } from "./funcoes.js";
import { LEITURAS_INTERNAS } from "./marcacao.js";
import { funcaoLiberada } from "./permissoes.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte, executarFuncao, ferramentasDaConversaDoDono, ferramentasDoWhatsapp, ferramentasLiberadas, tratarChamada, tratarFerramentas } from "./ponte.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";
import { definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";

const DONO = "5599991234567";
const TOKEN = "token-de-teste-da-ponte-1234567890";
const REURB_ID = 5;
let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviar: ReturnType<typeof vi.fn>;
let pedidos: PedidoModelo[];
let roteiro: Array<(p: PedidoModelo) => RespostaModelo>;
let seq = 0;
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
const uso = { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const ferramenta = (name: string, input: unknown): RespostaModelo => ({ stop_reason: "tool_use", usage: uso, content: [{ type: "tool_use", id: `tu_${++seq}`, name, input }] });
const texto = (t: string): RespostaModelo => ({ stop_reason: "end_turn", usage: uso, content: [{ type: "text", text: t }] });
function aviso(p: { de?: string; texto: string; jid?: string; participante?: string }) {
  return {
    event: "messages.upsert", instance: "prospecta-dolores",
    data: {
      key: { remoteJid: p.jid ?? `${p.de ?? DONO}@s.whatsapp.net`, fromMe: false, id: `RB${++seq}`, ...(p.participante ? { participant: p.participante } : {}) },
      message: { conversation: p.texto }, messageTimestamp: Math.floor((AGORA.getTime() - 30_000) / 1000),
    },
  };
}
const webhook = (body: unknown) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, body, ip: "203.0.113.9" } as never);
const ponte = (body: unknown) => ({ headers: { authorization: `Bearer ${TOKEN}` }, body, ip: "203.0.113.7" }) as never;
const textoEnviado = () => enviar.mock.calls.map(c => JSON.stringify(c)).join("\n");
/** Tabelas que uma análise NÃO pode tocar (gravação de negócio e fila). */
const contagens = async () => Object.fromEntries(await Promise.all(["tasks", "lead_activities", "regularizacoes", "regularizacao_etapas", "regularizacao_documents", "dolores_aprovacoes", "leads"]
  .map(async t => [t, Number((await q<{ n: string }>(`SELECT count(*) AS n FROM ${t}`))[0].n)] as const)));

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  // caso REURB (id 5): núcleo cadastrado como REURB-S, com etapa e documento pendente; senha e conta na observação (sempre mascaradas)
  await banco.pg.exec(`INSERT INTO regularizacoes (client_name, client_phone, type, status, address, responsible, lead_id, lead_service_id, expected_end_at, notes, created_at, updated_at) VALUES
    ('Associação Vila Esperança', '99955554444', 'REURB-S Vila Esperança', 'em_andamento', 'Vila Esperança', 'Bianca Souza', NULL, NULL, NULL,
     'Núcleo com 140 lotes; córrego no fundo. senha do portal: Vila#2026 conta 12345-6 agência 0001', '2026-08-01 12:00', '2026-11-10 12:00');
    INSERT INTO regularizacao_etapas (regularizacao_id, nome, ordem, progresso, observacoes, updated_at) VALUES
      (${REURB_ID}, 'Requerimento', 1, 100, NULL, '2026-08-10'), (${REURB_ID}, 'Notificação dos confrontantes', 2, 30, 'Faltam 3 confrontantes', '2026-11-10 12:00');
    INSERT INTO regularizacao_documents (regularizacao_id, name, status, updated_at) VALUES (${REURB_ID}, 'Levantamento planialtimétrico', 'pending', '2026-11-01');`);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}', ia_ligada = true,
    limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  process.env.DOLORES_PONTE_TOKEN = TOKEN;
  esquecerUsuarioDolores();
  definirDependenciasPonte({ agora: () => AGORA });
  enviar = vi.fn(async () => true);
  definirDependenciasWhatsapp({ agora: () => AGORA, enviar: enviar as never });
  vi.mocked(configuracaoAnthropicPainel).mockResolvedValue({ apiKey: "sk-ant-chave-de-teste-nao-real-123456", modelo: "modelo-de-teste" });
  pedidos = [];
  roteiro = [];
  definirClienteModelo(async p => {
    pedidos.push(JSON.parse(JSON.stringify(p)));
    const passo = roteiro.shift();
    if (!passo) throw new Error("roteiro do modelo acabou");
    return passo(p);
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  ENV.cookieSecret = segredoAntes;
  delete process.env.DOLORES_PONTE_TOKEN;
  definirDependenciasPonte();
  definirDependenciasWhatsapp();
  definirClienteModelo();
  vi.restoreAllMocks();
});

const resultadoDaFerramenta = (p: PedidoModelo) => {
  const r = p.mensagens.flatMap(m => m.content).find(c => (c as { type?: string }).type === "tool_result") as { content: string } | undefined;
  return r ? JSON.parse(r.content) : null;
};

describe("escopo: só a conversa direta do dono", () => {
  it("dono no WhatsApp: a ferramenta é oferecida, roda, monta caso + conhecimento e o aviso fixo sai por código", async () => {
    const antes = await contagens();
    roteiro = [
      p => { expect(p.ferramentas.map(f => f.name)).toContain(FUNCAO_REURB); return ferramenta(FUNCAO_REURB, { id: REURB_ID }); },
      () => texto("*Enquadramento provável*: REURB-S [CONFERIR com o município].\n*Próximos passos*: concluir as notificações."),
    ];
    await webhook(aviso({ texto: "analise a REURB da Vila Esperança" }));
    expect(pedidos).toHaveLength(2);
    const r = resultadoDaFerramenta(pedidos[1]);
    expect(r.ok).toBe(true);
    expect(r.dados.analisavel).toBe(true);
    expect(r.dados.caso).toMatchObject({ id: REURB_ID, servico: "REURB-S Vila Esperança", etapaAtual: { nome: "Notificação dos confrontantes" } });
    expect(r.dados.caso.documentosPendentes).toEqual([{ documento: "Levantamento planialtimétrico", situacao: "pendente", origem: "documentos do processo (cadastro antigo)" }]);
    expect(r.dados.conhecimento.etapasDoRito).toEqual([...ETAPAS_REURB]);
    expect(r.dados.instrucao.avisoObrigatorio).toBe(AVISO_REURB);
    // sem telefone e sem valores; senha e conta da observação mascaradas (sempre)
    const bruto = JSON.stringify(r);
    for (const s of ["99955554444", "Vila#2026", "12345-6", "financeiro", "previsto"]) expect(bruto).not.toContain(s);
    // o modelo não pôs o aviso: o código acrescentou
    expect(textoEnviado()).toContain("Rascunho para revisão: o enquadramento e o rito dependem da legislação municipal");
    // nada gravado (nem fila): só leitura
    expect(await contagens()).toEqual(antes);
    expect(await q("SELECT resultado FROM dolores_acoes WHERE funcao = $1".replace("$1", `'${FUNCAO_REURB}'`))).toEqual([{ resultado: "ok" }]);
  });

  it("ponte HTTP: não está na lista de ferramentas e a chamada direta é recusada (403, auditada)", async () => {
    const lista = await tratarFerramentas(ponte({}));
    expect((lista.body.ferramentas as Array<{ name: string }>).map(f => f.name)).not.toContain(FUNCAO_REURB);
    expect(ferramentasLiberadas().map(f => f.name)).not.toContain(FUNCAO_REURB);
    const r = await tratarChamada(ponte({ funcao: FUNCAO_REURB, argumentos: { id: REURB_ID } }));
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ ok: false });
    expect(JSON.stringify(r.body)).not.toContain("Vila Esperança");
    expect(await q(`SELECT resultado FROM dolores_acoes WHERE funcao = '${FUNCAO_REURB}'`)).toEqual([{ resultado: "recusada" }]);
  });

  it("WhatsApp sem mensagem do dono conferida (mensagemId): recusado", async () => {
    const r = await executarFuncao({ funcao: FUNCAO_REURB, argumentos: { id: REURB_ID } }, { canal: "whatsapp" });
    expect(r.status).toBe(403);
  });

  it("grupos (inclusive administrativo) e cliente não recebem a ferramenta; FUNCOES não a contém", () => {
    expect(FUNCOES.map(f => f.nome)).not.toContain(FUNCAO_REURB);
    for (const tipo of Object.keys(LEITURAS_INTERNAS) as Array<keyof typeof LEITURAS_INTERNAS>) expect(LEITURAS_INTERNAS[tipo]).not.toContain(FUNCAO_REURB);
    expect(funcaoPorNome(FUNCAO_REURB)?.soConversaDoDono).toBe(true);
    expect(funcaoLiberada(FUNCAO_REURB)).toBe(true);
    expect(ferramentasDaConversaDoDono().map(f => f.name)).toContain(FUNCAO_REURB);
    expect(ferramentasDoWhatsapp().map(f => f.name)).toContain(FUNCAO_REURB);
    // o código das leituras do cliente atendido e do grupo marcado não cita a função
    for (const arq of ["./leitura/cliente-atendido.ts", "./leitura/grupo-marcado.ts", "./atendimento.ts", "./marcacao.ts"]) {
      expect(readFileSync(new URL(arq, import.meta.url), "utf8"), arq).not.toContain(FUNCAO_REURB);
    }
  });

  it("a própria leitura recusa fora do canal do dono (segunda trava)", async () => {
    const fn = funcaoPorNome(FUNCAO_REURB)!;
    for (const canal of ["ponte", "grupo", "cliente"] as const) {
      const r = await fn.executar({ id: REURB_ID } as never, { agora: AGORA, canal }) as { dados: any };
      expect(r.dados.analisavel).toBe(false);
      expect(JSON.stringify(r.dados)).not.toContain("Vila Esperança");
    }
  });

  it("mensagem de terceiro (outro número ou grupo) nunca chega ao modelo", async () => {
    await webhook(aviso({ de: "5511988887777", texto: "analise a REURB da Vila Esperança" }));
    await webhook(aviso({ jid: "120363100000000081@g.us", participante: `${DONO}@s.whatsapp.net`, texto: "analise a REURB" }));
    expect(pedidos).toEqual([]);
  });
});

describe("casos que não dão parecer", () => {
  const rodar = async (id: number) => {
    const r = await executarFuncao({ funcao: FUNCAO_REURB, argumentos: { id } }, { canal: "whatsapp", mensagemId: 1 });
    expect(r.status).toBe(200);
    return r.body as { ok: boolean; dados: any };
  };

  it("caso inexistente: encontrado false, nada a analisar, sem conhecimento", async () => {
    const b = await rodar(999);
    expect(b.dados).toMatchObject({ encontrado: false, analisavel: false });
    expect(b.dados.conhecimento).toBeUndefined();
  });

  it("caso de outro tipo (Averbação de construção): não é REURB, não redige parecer", async () => {
    const b = await rodar(2);
    expect(b.dados).toMatchObject({ encontrado: true, analisavel: false, servico: "Averbação de construção" });
    expect(b.dados.mensagem).toMatch(/não como REURB/);
    expect(b.dados.conhecimento).toBeUndefined();
  });

  it("sem parecer, o aviso fixo não é acrescentado", async () => {
    roteiro = [() => ferramenta(FUNCAO_REURB, { id: 2 }), () => texto("Esse processo é de averbação, não de REURB.")];
    await webhook(aviso({ texto: "analise a REURB do processo do João" }));
    expect(textoEnviado()).not.toContain(AVISO_REURB.slice(0, 40));
  });

  it("argumento inválido: 400, nada roda", async () => {
    const r = await executarFuncao({ funcao: FUNCAO_REURB, argumentos: { id: -1 } }, { canal: "whatsapp", mensagemId: 1 });
    expect(r.status).toBe(400);
  });
});

describe("conhecimento: sem invenção", () => {
  const tudo = JSON.stringify({ ...conhecimentoReurb(), ...instrucaoDoParecerReurb() });

  it("único número é o da lei (13.465/2017) e o A.68 do roteiro; nada de valor, percentual, prazo ou renda-limite", () => {
    const numeros = tudo.match(/\d+(?:[.,/]\d+)*/g) ?? [];
    expect(new Set(numeros)).toEqual(new Set(["13.465/2017", "68", "2", "4", "15"])); // "2 a 4" passos e "uns 15 itens" são do formato
    expect(tudo).not.toMatch(/R\$|%|salário|\bdias\b|\bmeses\b|\banos\b|art\.\s*\d|artigo\s+\d/i);
  });

  it("modalidades, rito e dados do núcleo seguem o roteiro; modalidade é do município", () => {
    expect(MODALIDADES_REURB.map(m => m.sigla)).toEqual(["REURB-S", "REURB-E"]);
    expect(ETAPAS_REURB).toHaveLength(7);
    expect(ETAPAS_REURB[5]).toMatch(/CRF/);
    expect(DADOS_DO_NUCLEO).toHaveLength(5);
    expect(tudo).toMatch(/definida pelo município/);
    expect(tudo).toMatch(/título individual antes do registro da CRF/);
  });

  it("reconhece REURB pelo cadastro, por código", () => {
    expect(textoIndicaReurb("REURB-S Vila")).toBe(true);
    expect(textoIndicaReurb("Regularização Fundiária do bairro")).toBe(true);
    expect(textoIndicaReurb("Averbação de construção", null, "Usucapião")).toBe(false);
  });

  it("QA B2: REURB pelo nome da etapa vale; pela observação, não", async () => {
    await banco.pg.exec(`UPDATE regularizacoes SET notes = 'é REURB, sim' WHERE id = 2`);
    const fn = funcaoPorNome(FUNCAO_REURB)!;
    const ver = async () => ((await fn.executar({ id: 2 } as never, { agora: AGORA, canal: "whatsapp" })) as { dados: any }).dados.analisavel;
    expect(await ver()).toBe(false);
    await banco.pg.exec(`UPDATE regularizacao_etapas SET nome = 'Projeto de regularização fundiária' WHERE regularizacao_id = 2`);
    expect(await ver()).toBe(true);
  });

  it("aviso: acrescentado só com parecer e nunca duplicado", () => {
    expect(comAvisoReurb("Parecer.", false)).toBe("Parecer.");
    expect(comAvisoReurb("Parecer.", true)).toBe(`Parecer.\n\n${AVISO_REURB}`);
    expect(comAvisoReurb(`Parecer.\n\n${AVISO_REURB}`, true)).toBe(`Parecer.\n\n${AVISO_REURB}`);
  });

  it("QA B1: aviso posto no começo (ou repetido) sai de lá e fecha o texto, uma vez só", () => {
    const t = comAvisoReurb(`${AVISO_REURB}\n\nConclusão.\n\n${AVISO_REURB}\n\nMais texto.`, true);
    expect(t).toBe(`Conclusão.\n\nMais texto.\n\n${AVISO_REURB}`);
  });

  it("QA M1: no envio o aviso nunca é cortado — fecha a última mensagem, com 1 ou 3 partes, com ou sem quadro; cada parte cabe no limite", () => {
    const longo = Array.from({ length: 150 }, (_, i) => `- item ${i + 1}: ${"texto do parecer ".repeat(10)}`).join("\n");
    for (const n of [1, 2, 3]) for (const quadro of [null, "Quadro do sistema: nada foi alterado."]) {
      const partes = partesDaResposta(comAvisoReurb(longo, true), quadro, MAX_CARACTERES_WHATSAPP, n);
      expect(partes.length).toBeLessThanOrEqual(n);
      expect(partes[partes.length - 1].trimEnd().endsWith(AVISO_REURB), `${n} ${quadro}`).toBe(true);
      for (const p of partes) expect(p.length).toBeLessThanOrEqual(MAX_CARACTERES_WHATSAPP);
      if (quadro) expect(partes[0]).toContain(quadro);
    }
    // curto: uma mensagem igual ao texto
    expect(partesDaResposta(comAvisoReurb("Parecer.", true))).toEqual([`Parecer.\n\n${AVISO_REURB}`]);
  });
});
