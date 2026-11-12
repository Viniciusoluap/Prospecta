// Central de Vendas — etapa 5: agente de IA (respostas simuladas; nenhuma chamada à Anthropic). Regras
// proibidas verificadas na saída, transferência para humano em cada gatilho, LGPD e limite de tokens.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste", anthropicApiKey: "" } }));

import { getDb } from "./db.js";
import { aviso, montarCenario, NUMERO_TESTE, type Cenario } from "./__fixtures__/central-vendas/cenario.js";
import { definirDependencias } from "./central-vendas/base.js";
import { processarFila } from "./central-vendas/envio.js";
import { lerSaidaIA } from "./central-vendas/ia.js";
import { processarEventoEvolution } from "./whatsapp-evolution-webhook.js";
import { gatilhoNoTexto, valorCanonico, violacoesResposta } from "../shared/central-vendas/regras.js";

let c: Cenario;
let seq = 0;
const montar = async (config = {}) => { c = await montarCenario(db => vi.mocked(getDb).mockReturnValue(db as never), { config }); };
afterEach(async () => { definirDependencias(); await c?.pg.close(); c = undefined as never; });
const cliente = (texto: string) => processarEventoEvolution(aviso(`M${++seq}`, NUMERO_TESTE, texto));
const estado = async () => (await c.linhas<Record<string, unknown>>("SELECT status_atendimento, status_analise, motivo_transferencia, sem_progresso FROM central_vendas_leads"))[0];

describe("regras proibidas (saída da IA)", () => {
  const base = "Colina Park: casas a partir de R$ 180.000,00. Parcelas a partir de R$ 650,00 conforme análise. Entrada facilitada em 10x.";
  it.each([
    ["Sim! Seu financiamento está aprovado.", ["promessa_aprovacao"]],
    ["Com certeza você vai ser aprovado, pode ficar tranquilo.", ["promessa_aprovacao"]],
    ["Garantimos a aprovação do seu crédito.", ["promessa_aprovacao"]],
    ["Você já está pré-aprovado!", ["promessa_aprovacao"]],
    ["A taxa de juros é de 7,5% ao ano.", ["condicao_nao_cadastrada"]],
    ["As parcelas ficam em R$ 499,00.", ["condicao_nao_cadastrada"]],
    ["Dá para fazer em 360 parcelas.", ["condicao_nao_cadastrada"]],
    ["Infelizmente seu cadastro foi reprovado.", ["decisao_financeira"]],
  ])("bloqueia: %s", (resposta, esperado) => {
    expect(violacoesResposta(resposta, base)).toEqual(esperado);
  });
  it.each([
    "As casas do Colina Park começam em R$ 180 mil.",
    "As parcelas começam em R$ 650,00, conforme a análise da equipe.",
    "A entrada pode ser em 10x.",
    "A aprovação depende da análise do banco; nossa equipe vai avaliar seu cadastro.",
    "Qual é a sua renda mensal?",
  ])("permite o que está cadastrado ou neutro: %s", resposta => {
    expect(violacoesResposta(resposta, base)).toEqual([]);
  });
  it("normaliza números e detecta gatilhos no texto do cliente", () => {
    expect(valorCanonico("R$ 1.234,56")).toBe("1234.56");
    expect(valorCanonico("180 mil")).toBe("180000");
    expect(valorCanonico("650,00")).toBe("650");
    expect(gatilhoNoTexto("Quero falar com um atendente")).toBe("pedido_cliente");
    expect(gatilhoNoTexto("Isso é um absurdo!")).toBe("reclamacao");
    expect(gatilhoNoTexto("Vou procurar meu advogado")).toBe("juridico");
    expect(gatilhoNoTexto("Tem desconto à vista?")).toBe("negociacao_valor");
    expect(gatilhoNoTexto("Minha renda é 3 mil")).toBeNull();
  });
  it("campo fora da lista fechada é descartado (a IA não consegue marcar aprovado)", () => {
    const s = lerSaidaIA(JSON.stringify({ resposta: "ok", confianca: 0.9, statusAnalise: "aprovado", campos: { aprovado: true, nome: "Ana" } }));
    expect(s).toEqual({ resposta: "ok", confianca: 0.9, transferir: false, campos: { nome: "Ana" } });
  });
});

describe("atendimento pela IA", () => {
  beforeEach(async () => {
    await montar();
    await c.pg.exec("INSERT INTO central_vendas_produtos (slug, nome, cidade, preco_min, condicoes) VALUES ('teste', 'Residencial Teste', 'Imperatriz', 180000, 'Parcelas a partir de R$ 650,00 conforme análise.')");
    c.ia("Olá! Sou a assistente da Prospecta. Posso usar seus dados só neste atendimento (LGPD)? Responda SIM.");
    await cliente("Olá [ref:teste]");
  });

  it("saúda e pede o consentimento; sem consentimento não grava dados; com ele, grava LGPD e os campos", async () => {
    expect(c.envios.map(e => e.texto)).toEqual([expect.stringContaining("LGPD")]);
    c.ia("Antes preciso do seu consentimento.", { nome: "Ana Souza", cidade: "Imperatriz" });
    await cliente("Sou Ana, de Imperatriz");
    expect(await c.linhas("SELECT name, city, lgpd_consent FROM leads")).toEqual([{ name: "Cliente Teste", city: null, lgpd_consent: false }]);
    c.ia("Obrigada, Ana! Qual a sua renda mensal?", { lgpdConsentimento: true, nome: "Ana Souza", cidade: "Imperatriz" });
    await cliente("SIM, autorizo. Sou Ana Souza de Imperatriz");
    const [l] = await c.linhas<{ name: string; city: string; lgpd_consent: boolean; lgpd_consent_at: unknown }>("SELECT name, city, lgpd_consent, lgpd_consent_at FROM leads");
    expect(l).toMatchObject({ name: "Ana Souza", city: "Imperatriz", lgpd_consent: true });
    expect(l.lgpd_consent_at).not.toBeNull();
    expect(await c.linhas("SELECT stage FROM leads")).toEqual([{ stage: "attending" }]);
    expect(c.chamadasIA[0].sistema).toContain("Residencial Teste");
    expect(c.chamadasIA[0].sistema).toContain("Nunca prometa");
  });

  it("cliente pede aprovação e taxa; a IA simulada promete → nada disso sai, vai para humano", async () => {
    c.ia("Sim, seu financiamento está aprovado! A taxa é de 7% ao ano.");
    await cliente("Eu vou ser aprovado? Qual a taxa?");
    expect(c.envios.some(e => /aprovad|7%/i.test(e.texto))).toBe(false);
    expect(await estado()).toMatchObject({ status_atendimento: "em_atendimento_humano", status_analise: "nao_enviado", motivo_transferencia: "resposta_bloqueada" });
    expect(await c.linhas("SELECT tipo FROM central_vendas_eventos WHERE tipo = 'resposta_ia_bloqueada'")).toHaveLength(1);
    expect(c.envios.at(-1)!.texto).toMatch(/vou passar seu atendimento/i);
  });

  it("condição cadastrada pode ser citada; inventada, não", async () => {
    c.ia("As parcelas do Residencial Teste começam em R$ 650,00, conforme análise.");
    await cliente("Quanto fica a parcela?");
    expect(c.envios.at(-1)!.texto).toContain("R$ 650,00");
    expect((await estado()).status_atendimento).toBe("em_atendimento_ia");
  });

  it.each([
    ["Quero falar com um atendente", "pedido_cliente"],
    ["Que absurdo esse atendimento, péssimo", "reclamacao"],
    ["Vou entrar com processo judicial", "juridico"],
    ["Consegue baixar o preço? Quero negociar", "negociacao_valor"],
  ])("gatilho no texto do cliente (%s) → humano sem chamar a IA", async (texto, motivo) => {
    const chamadas = c.chamadasIA.length;
    await cliente(texto);
    // A IA não é chamada para responder; só para gerar o resumo ao atendente.
    expect(c.chamadasIA.slice(chamadas).map(p => p.sistema.slice(0, 7))).toEqual(["Resuma "]);
    expect(await estado()).toMatchObject({ status_atendimento: "em_atendimento_humano", motivo_transferencia: motivo });
    const [cv] = await c.linhas<{ resumo_transferencia: string; operador_id: number }>("SELECT resumo_transferencia, operador_id FROM central_vendas_leads");
    expect(cv.resumo_transferencia).toBeTruthy();
    expect(await c.linhas("SELECT user_id FROM user_notifications WHERE title LIKE '%precisa de você%'")).toEqual([{ user_id: cv.operador_id }]);
    // Já em atendimento humano: a IA não responde mais.
    await cliente("Alô?");
    expect(c.chamadasIA.length).toBe(chamadas + 1); // só o resumo da transferência usou a IA
  });

  it("confiança abaixo do limiar → humano", async () => {
    c.respostasIA.push(JSON.stringify({ resposta: "Não sei bem.", confianca: 0.3, transferir: false, campos: {} }));
    await cliente("Quero saber de um terreno na praia");
    expect(await estado()).toMatchObject({ motivo_transferencia: "baixa_confianca" });
  });

  it("três mensagens seguidas sem progresso → humano", async () => {
    for (let i = 0; i < 2; i++) { c.ia("Pode me dizer sua cidade?"); await cliente("hum"); }
    expect((await estado()).status_atendimento).toBe("em_atendimento_ia");
    c.ia("Pode me dizer sua cidade?");
    await cliente("hum");
    expect(await estado()).toMatchObject({ status_atendimento: "em_atendimento_humano", motivo_transferencia: "sem_progresso" });
  });

  it("a IA pede transferência no JSON → humano", async () => {
    c.ia("Vou chamar um consultor.", {}, { transferir: true });
    await cliente("É uma situação complicada com meu nome no SPC");
    expect(await estado()).toMatchObject({ motivo_transferencia: "modelo" });
  });
});

describe("custo e falhas da IA", () => {
  it("limite mensal de tokens: a IA para, tudo vai para humano e o admin é avisado uma vez", async () => {
    await montar({ limiteMensalTokens: 100 });
    c.ia("Olá! Posso usar seus dados (LGPD)?");
    await cliente("Olá [ref:teste]"); // consome 150 tokens (simulado)
    expect(await c.linhas("SELECT tokens FROM central_vendas_tokens_mes")).toEqual([{ tokens: 150 }]);
    expect(await c.linhas("SELECT tokens_consumidos FROM central_vendas_leads")).toEqual([{ tokens_consumidos: 150 }]);
    const chamadas = c.chamadasIA.length;
    await cliente("SIM");
    expect(c.chamadasIA.length).toBe(chamadas);
    expect(await estado()).toMatchObject({ status_atendimento: "em_atendimento_humano", motivo_transferencia: "limite_tokens" });
    expect(await c.linhas("SELECT user_id FROM user_notifications WHERE title LIKE '%limite de tokens%'")).toEqual([{ user_id: 1 }]);
  });

  it("falha da IA fica na fila e é reprocessada com backoff, sem responder duas vezes", async () => {
    await montar();
    c.respostasIA.push(new Error("Anthropic fora do ar (simulado)"));
    await cliente("Olá [ref:teste]");
    expect(await c.linhas("SELECT tipo, status, tentativas FROM central_vendas_fila")).toEqual([{ tipo: "ia", status: "pendente", tentativas: 1 }]);
    expect(c.envios).toHaveLength(0);
    await processarFila(); // ainda no prazo do backoff: nada acontece
    expect(c.envios).toHaveLength(0);
    c.avancar(2);
    c.ia("Olá! Posso usar seus dados (LGPD)?");
    await processarFila();
    await processarFila();
    expect(c.envios).toHaveLength(1);
    expect(await c.linhas("SELECT tipo, status FROM central_vendas_fila ORDER BY id")).toEqual([{ tipo: "ia", status: "concluido" }, { tipo: "mensagem", status: "concluido" }]);
  });
});
