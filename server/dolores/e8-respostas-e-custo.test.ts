// EPIC-025 (Dolores, etapa 8) — regressões dos dois problemas reais de produção:
// 1) pedido longo do dono: a 2ª volta parou em max_tokens e o texto parcial foi DESCARTADO ("não consegui concluir") — agora o
//    parcial vai ao dono (pelos filtros de saída), a resposta pode ir em até 3 mensagens só para o dono, e a conta de "dividir os
//    atrasos por dia" é do código (plano_de_atrasos);
// 2) custo mostrado ~2 dólares para 3 perguntas no Haiku (cache somado como entrada cheia, preço único do modelo mais caro) —
//    agora a estimativa é por modelo e por tipo de token, com a reserva só para modelo sem preço.
// Banco em memória (PGlite); o modelo e o envio pela Evolution são falsos: nada sai para a rede.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { ADMIN_MODULES } from "../../shared/admin-permissions.js";
import { custoDoMes, custoDoUso, entradaNoLimite, linhaDoCustoParaRelatorio } from "../../shared/dolores/custo.js";
import { estimarReais, montarRelatorio } from "../../shared/dolores/operacao.js";
import { diasDoPlano, distribuirIgualmente, fimDoMes, montarPlano } from "../../shared/dolores/plano-atrasos.js";
import { MAX_CARACTERES_WHATSAPP, partesDaResposta } from "../../shared/dolores/whatsapp.js";
import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { appRouter } from "../routers.js";
import {
  AVISO_RESPOSTA_CORTADA, MAX_TOKENS_SAIDA, TETO_ENTRADA_POR_PEDIDO, cortarNaUltimaLinhaCompleta, definirClienteModelo, ferramentasParaOModelo,
  tokensDeSaidaNoPrazo, type PedidoModelo, type RespostaModelo,
} from "./cerebro.js";
import { AVISO_DADOS, funcaoPorNome } from "./funcoes.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte, executarFuncao, ferramentasLiberadas } from "./ponte.js";
import { PRAZO_TOTAL_MS, definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";

const DONO = "5599991234567";
const SEGREDO_SERVIDOR = "segredo-do-servidor-de-teste-0123456789";
const HAIKU = "claude-haiku-5-5";
/** Os números reais de dolores_consumo das 3 perguntas do dono (Haiku 5.5). */
const REAL = { entrada: 13_068, saida: 4_413, cacheEscrita: 37_860, cacheLeitura: 50_480 };

// ── Regras puras ────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("plano_de_atrasos — a conta (regra pura)", () => {
  const itens = (k: number) => Array.from({ length: k }, (_, i) => ({ modulo: "CRM (prazo do card)", cliente: `Cliente ${i + 1}`, diasDeAtraso: 100 - i, diasSemMovimentacao: null }));
  const soma = (p: ReturnType<typeof montarPlano>) => p.dias.reduce((s, d) => s + d.quantidade, 0);

  it("11 processos em 11 dias restantes = 1 por dia, do mais atrasado para o menos", () => {
    // 20/11/2026 (sex) a 30/11 (seg) corridos = 11 dias
    const p = montarPlano(itens(11), { inicio: "2026-11-20", dataLimite: "2026-11-30", soDiasUteis: false });
    expect(p.diasDisponiveis).toBe(11);
    expect(p.dias.map(d => d.quantidade)).toEqual(Array(11).fill(1));
    expect(p.dias[0]).toEqual({ dia: "20/11 (sex)", quantidade: 1, itens: ["1. Cliente 1 — 100 d de atraso"] });
    expect(p.dias[10].itens).toEqual(["11. Cliente 11 — 90 d de atraso"]);
    expect(p.conferencia).toEqual({ somaDosDias: 11, confere: true });
  });

  it("25 itens em 10 dias: 3 nos 5 primeiros e 2 nos outros 5 (o resto vai para os primeiros); soma confere", () => {
    const p = montarPlano(itens(25), { inicio: "2026-11-21", dataLimite: "2026-11-30", soDiasUteis: false });
    expect(p.dias.map(d => d.quantidade)).toEqual([3, 3, 3, 3, 3, 2, 2, 2, 2, 2]);
    expect(p.porDia).toEqual({ minimo: 2, maximo: 3 });
    expect(soma(p)).toBe(25);
    expect(p.total).toBe(25);
    // nenhum item some nem se repete, na ordem
    expect(p.dias.flatMap(d => d.itens).map(l => Number(l.split(".")[0]))).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it("3 itens em 10 dias: um por dia nos 3 primeiros dias; os outros dias não aparecem", () => {
    const p = montarPlano(itens(3), { inicio: "2026-11-21", dataLimite: "2026-11-30", soDiasUteis: false });
    expect(p.diasDisponiveis).toBe(10);
    expect(p.dias.map(d => [d.dia, d.quantidade])).toEqual([["21/11 (sáb)", 1], ["22/11 (dom)", 1], ["23/11 (seg)", 1]]);
    expect(p.conferencia.confere).toBe(true);
  });

  it("só dias úteis (seg–sex): fim de semana fica fora", () => {
    expect(diasDoPlano("2026-11-19", "2026-11-30", true)).toEqual(["2026-11-19", "2026-11-20", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-30"]);
    const p = montarPlano(itens(16), { inicio: "2026-11-19", dataLimite: "2026-11-30", soDiasUteis: true });
    expect(p.diasDisponiveis).toBe(8);
    expect(p.dias.map(d => d.quantidade)).toEqual(Array(8).fill(2));
    expect(p.dias.some(d => /\((sáb|dom)\)/.test(d.dia))).toBe(false);
    // só o fim de semana sobrando: nenhum dia disponível, nada se perde em silêncio
    const fds = montarPlano(itens(2), { inicio: "2026-11-21", dataLimite: "2026-11-22", soDiasUteis: true });
    expect(fds).toMatchObject({ diasDisponiveis: 0, dias: [], total: 2, conferencia: { confere: false } });
  });

  it("fim de mês (inclusive fevereiro e virada de ano) e distribuição genérica", () => {
    expect(fimDoMes("2026-11-19")).toBe("2026-11-30");
    expect(fimDoMes("2028-02-10")).toBe("2028-02-29");
    expect(fimDoMes("2026-12-31")).toBe("2026-12-31");
    expect(distribuirIgualmente([1, 2, 3, 4, 5, 6, 7], ["a", "b", "c"]).map(g => g.itens)).toEqual([[1, 2, 3], [4, 5], [6, 7]]);
    expect(distribuirIgualmente([1], [])).toEqual([]);
  });

  it("formato compacto: módulo só quando a lista mistura módulos; parado sem prazo diz 'parado há'", () => {
    const p = montarPlano([
      { modulo: "Regularização", cliente: "Ana", diasDeAtraso: 6, diasSemMovimentacao: null },
      { modulo: "Financiamento", cliente: "Um nome de cliente muito comprido para caber na linha", diasDeAtraso: null, diasSemMovimentacao: 40 },
    ], { inicio: "2026-11-23", dataLimite: "2026-11-24", soDiasUteis: true });
    expect(p.dias.flatMap(d => d.itens)).toEqual(["1. Ana — 6 d de atraso [reg]", "2. Um nome de cliente muito compri… — parado há 40 d [fin]"]);
  });
});

describe("respostas longas — até 3 mensagens (regra pura)", () => {
  const linhas = (k: number) => Array.from({ length: k }, (_, i) => `- ${i + 1}. Cliente número ${i + 1} — ${i} d de atraso [plano_de_atrasos]`).join("\n");

  it("curta: uma mensagem, sem numeração", () => {
    expect(partesDaResposta("oi")).toEqual(["oi"]);
  });

  it("~9.000 caracteres: 3 mensagens numeradas, cada uma dentro do limite, cortadas em quebra de linha, nada perdido", () => {
    const t = linhas(150);
    const partes = partesDaResposta(t);
    expect(partes).toHaveLength(3);
    partes.forEach((p, i) => { expect(p.length).toBeLessThanOrEqual(MAX_CARACTERES_WHATSAPP); expect(p.startsWith(`(${i + 1}/3)\n`)).toBe(true); });
    const juntas = partes.map(p => p.replace(/^\(\d\/3\)\n/, "")).join("\n");
    expect(juntas).toBe(t);
  });

  it("maior que 3 mensagens: a 3ª é cortada com o aviso de sempre", () => {
    const partes = partesDaResposta(linhas(400));
    expect(partes).toHaveLength(3);
    expect(partes[2]).toMatch(/Resposta cortada por tamanho/);
    partes.forEach(p => expect(p.length).toBeLessThanOrEqual(MAX_CARACTERES_WHATSAPP));
  });

  it("os quadros do sistema (fila, feito) nunca são cortados: vão no começo da PRIMEIRA mensagem (QA E8 A1)", () => {
    const quadros = `*Na fila*\n${"- [ABCDE] item da fila ".repeat(100)}FIM-DO-QUADRO`;
    const partes = partesDaResposta(linhas(300), quadros);
    expect(partes.length).toBeLessThanOrEqual(3);
    expect(partes[0].startsWith(`(1/${partes.length})\n${quadros}`)).toBe(true);
    expect(partes.slice(1).some(p => p.includes("FIM-DO-QUADRO"))).toBe(false);
    partes.forEach(p => expect(p.length).toBeLessThanOrEqual(MAX_CARACTERES_WHATSAPP));
  });

  it("parcial em max_tokens: corta no fim da última linha completa", () => {
    expect(cortarNaUltimaLinhaCompleta("Total: 11\n- 20/11: Ana\n- 21/11: Jo")).toBe("Total: 11\n- 20/11: Ana");
    expect(cortarNaUltimaLinhaCompleta("Primeira frase. Segunda pela met")).toBe("Primeira frase.");
  });

  it("saída por chamada: até 5.000, limitada ao que cabe no prazo, com o teto de entrada do pedido inalterado", () => {
    expect(MAX_TOKENS_SAIDA).toBe(5000);
    expect(TETO_ENTRADA_POR_PEDIDO).toBe(150_000);
    expect(tokensDeSaidaNoPrazo(PRAZO_TOTAL_MS)).toBeLessThanOrEqual(MAX_TOKENS_SAIDA);
    expect(tokensDeSaidaNoPrazo(60_000)).toBe(MAX_TOKENS_SAIDA);
    expect(tokensDeSaidaNoPrazo(20_000)).toBe(1700);
    expect(tokensDeSaidaNoPrazo(5_000)).toBe(1000);
  });
});

describe("custo — por modelo e por tipo de token (regra pura)", () => {
  /** Preços reais do Haiku 5.5 (US$ por milhão): entrada 0,10; saída 0,50; escrita de cache 0,125; leitura 0,01. */
  const precoHaiku = { entrada: 0.1, saida: 0.5, cacheEscrita: 0.125, cacheLeitura: 0.01 };
  const tabela = new Map([[HAIKU, precoHaiku]]);

  it("os números reais no Haiku dão CENTAVOS de dólar (não ~2 dólares como a conta antiga)", () => {
    const c = custoDoUso(REAL, precoHaiku)!;
    // 13.068×0,10 + 4.413×0,50 + 37.860×0,125 + 50.480×0,01 = 8.750,6 → US$ 0,00875
    expect(c.valor).toBeCloseTo(0.0087506, 7);
    expect(c.valor).toBeLessThan(0.01);
    expect(c.cacheAssumido).toBe(false);
    // só entrada/saída informadas: os fatores padrão (1,25× e 0,1× da entrada) dão o mesmo valor
    const assumido = custoDoUso(REAL, { entrada: 0.1, saida: 0.5, cacheEscrita: null, cacheLeitura: null })!;
    expect(assumido.valor).toBeCloseTo(0.0087506, 7);
    expect(assumido.cacheAssumido).toBe(true);
    // a conta antiga: cache como entrada cheia e o preço do Opus (15/75) num campo único → perto de 2
    const antiga = estimarReais({ entrada: entradaNoLimite(REAL), saida: REAL.saida }, { entradaMilhao: 15, saidaMilhao: 75 })!;
    expect(antiga).toBeGreaterThan(1.8);
    expect(antiga / c.valor).toBeGreaterThan(20);
  });

  it("preços de cache informados são usados no lugar do 1,25×/0,1×", () => {
    const c = custoDoUso(REAL, { entrada: 0.1, saida: 0.5, cacheEscrita: 0.2, cacheLeitura: 0 })!;
    expect(c.valor).toBeCloseTo((13_068 * 0.1 + 4_413 * 0.5 + 37_860 * 0.2) / 1e6, 8);
    expect(c.cacheAssumido).toBe(false);
  });

  it("modelo sem preço usa a reserva (R$) e avisa; sem reserva, fica 'sem preço'; totais em US$ e R$ com a cotação", () => {
    const linhas = [
      { modelo: HAIKU, funcao: "conversa" as const, uso: REAL },
      { modelo: "modelo-novo", funcao: "documentos_e_notas" as const, uso: { entrada: 1_000_000, saida: 0, cacheEscrita: 0, cacheLeitura: 0 } },
    ];
    const c = custoDoMes(linhas, tabela, { entradaMilhao: 2, saidaMilhao: 10 }, 5);
    expect(c.porModelo.find(m => m.modelo === HAIKU)).toMatchObject({ fonte: "tabela", dolares: 0.0088, reais: 0.04 });
    expect(c.porModelo.find(m => m.modelo === "modelo-novo")).toMatchObject({ fonte: "reserva", reais: 2, dolares: 0.4 });
    expect(c.usouReserva).toEqual(["modelo-novo"]);
    expect(c.total).toMatchObject({ completo: true, dolares: 0.4088, reais: 2.04 });
    expect(c.porFuncao.map(f => f.funcao)).toEqual(["conversa", "documentos_e_notas"]);
    expect(c.tokensNoLimite).toEqual({ entrada: 13_068 + 37_860 + 50_480 + 1_000_000, saida: 4_413 });
    expect(linhaDoCustoParaRelatorio(c, 1621)).toMatch(/Pelo preço de reserva: modelo-novo/);
    const sem = custoDoMes(linhas, tabela, { entradaMilhao: null, saidaMilhao: null }, null);
    expect(sem.semPreco).toEqual(["modelo-novo"]);
    expect(sem.total.completo).toBe(false);
    expect(sem.total.reais).toBeNull(); // sem cotação, o Haiku (US$) não vira reais
    expect(linhaDoCustoParaRelatorio(sem, 1621)).toMatch(/Sem preço cadastrado: modelo-novo/);
  });

  it("o relatório do dono usa a MESMA conta (centavos no Haiku), e diz quanto da entrada é cache", () => {
    const texto = montarRelatorio({
      tipo: "sob_demanda", geradoEm: AGORA, destaques: {}, falhas: [], precos: { entradaMilhao: 15, saidaMilhao: 75 },
      totais: { consumo: { mes: "2026-11", entrada: entradaNoLimite(REAL), saida: REAL.saida, limiteEntrada: 1_000_000, limiteSaida: 100_000,
        linhas: [{ modelo: HAIKU, funcao: "conversa", uso: REAL }] } },
      precosPorModelo: { tabela, cotacao: 5.5 },
    });
    expect(texto).toMatch(/Estimativa: US\$ 0,0088 \(R\$\s0,05/);
    expect(texto).toContain("A entrada inclui 88.340 de cache");
    expect(texto).not.toMatch(/R\$ 1,8/);
  });

  it("ferramentas do laço do WhatsApp: o aviso do filtro sai das descrições (vai uma vez no texto do sistema); a ponte continua igual", () => {
    const lista = ferramentasLiberadas();
    expect(lista.every(f => f.description.endsWith(AVISO_DADOS))).toBe(true);
    const enxuta = ferramentasParaOModelo(lista);
    expect(enxuta.every(f => !f.description.includes("filtro da ponte"))).toBe(true);
    const antes = JSON.stringify(lista).length, depois = JSON.stringify(enxuta).length;
    expect(antes - depois).toBeGreaterThan(lista.length * AVISO_DADOS.length * 0.9);
  });
});

// ── Banco em memória ───────────────────────────────────────────────────────────────────────────────────────────────────────

let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviar: ReturnType<typeof vi.fn>;
let pedidos: PedidoModelo[];
let roteiro: Array<(p: PedidoModelo) => RespostaModelo>;
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
let seq = 0;
const aviso = (texto: string) => ({
  event: "messages.upsert", instance: "prospecta-dolores",
  data: { key: { remoteJid: `${DONO}@s.whatsapp.net`, fromMe: false, id: `E8-${++seq}` }, message: { conversation: texto }, messageTimestamp: Math.floor((AGORA.getTime() - 30_000) / 1000) },
});
const chamar = (body: unknown) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, body, ip: "203.0.113.9" } as never);
const uso = { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const ferramenta = (name: string, input: unknown): RespostaModelo => ({ stop_reason: "tool_use", usage: uso, content: [{ type: "tool_use", id: `tu_${name}`, name, input }] });
const caller = (role: string, permissoes: string[] = [], id = 1) =>
  appRouter.createCaller({ user: { id, role, active: true, permissions: JSON.stringify(permissoes) }, req: {}, res: {} } as never);
const PEDIDO_REAL = "Divida todos esses clientes do crm em atraso para resolvermos todos até o fim do mês, igualmente por dia. Exemplo: 11 processos em 11 dias restantes dá um por dia";

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}', ia_ligada = true,
    limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;`);
  ENV.cookieSecret = SEGREDO_SERVIDOR;
  esquecerUsuarioDolores();
  definirDependenciasPonte({ agora: () => AGORA });
  enviar = vi.fn(async () => true);
  definirDependenciasWhatsapp({ agora: () => AGORA, enviar: enviar as never });
  vi.mocked(configuracaoAnthropicPainel).mockResolvedValue({ apiKey: "sk-ant-teste-nao-real-123456", modelo: HAIKU });
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
  ENV.cookieSecret = segredoAntes;
  definirDependenciasPonte();
  definirDependenciasWhatsapp();
  definirClienteModelo();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("caso real — 2ª volta parou em max_tokens", () => {
  it("o dono recebe o texto parcial (cortado na última linha completa, com o aviso), nada descartado e só para o número dele", async () => {
    const parcial = "*Plano até 30/11* — total 2 [plano_de_atrasos]\n- 16/11 (seg): 1. Maria Trello — 6 d\n- 17/11 (ter): 2. João Atr";
    roteiro = [
      () => ferramenta("plano_de_atrasos", { modulo: "crm" }),
      () => ({ stop_reason: "max_tokens", usage: { ...uso, output_tokens: 2000 }, content: [{ type: "text", text: parcial }] }),
    ];
    const r = await chamar(aviso(PEDIDO_REAL));
    expect(r.body.r).toEqual({ respondida: 1 });
    expect(enviar).toHaveBeenCalledTimes(1);
    const { texto, numero } = enviar.mock.calls[0][0];
    expect(numero).toBe(DONO);
    expect(texto).not.toMatch(/não consegui concluir/);
    expect(texto).toContain("*Plano até 30/11* — total 2 [plano_de_atrasos]\n- 16/11 (seg): 1. Maria Trello — 6 d");
    expect(texto).not.toContain("João Atr"); // a linha cortada no meio sai
    expect(texto).toContain(AVISO_RESPOSTA_CORTADA);
    // a ferramenta da conta foi oferecida e o pedido de saída respeita o novo teto (e o prazo)
    expect(pedidos[0].ferramentas.map(f => f.name)).toContain("plano_de_atrasos");
    expect(pedidos.every(p => p.maxTokens <= MAX_TOKENS_SAIDA && p.maxTokens >= 1000)).toBe(true);
    const [m] = await q<any>("SELECT situacao, motivo FROM dolores_mensagens");
    expect(m).toMatchObject({ situacao: "respondida", motivo: "max_tokens" });
  });

  it("max_tokens SEM texto (consulta cortada no meio): não executa a consulta cortada e pede uma resposta curta sem ferramentas", async () => {
    roteiro = [
      () => ferramenta("plano_de_atrasos", { modulo: "crm" }),
      () => ({ stop_reason: "max_tokens", usage: uso, content: [{ type: "tool_use", id: "tu_cortado", name: "listar_atrasos", input: {} }] }),
      () => ({ stop_reason: "end_turn", usage: uso, content: [{ type: "text", text: "Total 2: 16/11 Maria; 17/11 João [plano_de_atrasos]." }] }),
    ];
    await chamar(aviso(PEDIDO_REAL));
    expect(pedidos).toHaveLength(3);
    expect(pedidos[2].semFerramentas).toBe(true);
    expect(JSON.stringify(pedidos[2].mensagens.at(-1))).toMatch(/passou do tamanho máximo/);
    expect(JSON.stringify(pedidos[2].mensagens)).not.toContain("tu_cortado");
    const a = await q<any>("SELECT funcao FROM dolores_acoes WHERE funcao = 'listar_atrasos'");
    expect(a).toEqual([]);
    // QA E8 A2: o resumo veio sem a consulta cortada — o dono fica sabendo (e que nada foi alterado: só houve leitura)
    expect(enviar.mock.calls[0][0].texto).toBe("Total 2: 16/11 Maria; 17/11 João [plano_de_atrasos].\n\n(A consulta/ação que eu ia fazer foi cortada e NÃO foi executada. Nada foi alterado no sistema.)");
  });
});

describe("resposta longa em 2–3 mensagens", () => {
  it("vai em sequência, numerada, cada uma dentro do limite, todas pelos filtros e só para o número do dono", async () => {
    const longa = Array.from({ length: 160 }, (_, i) => `- ${i + 1}. Cliente ${i + 1} — senha: Abc${i}xyz9 — ${i} d`).join("\n");
    roteiro = [() => ({ stop_reason: "end_turn", usage: uso, content: [{ type: "text", text: `Total 160.\n${longa}\nveja http://golpe.example/x` }] })];
    await chamar(aviso("Dolores, liste tudo"));
    const enviados = enviar.mock.calls.map(c => c[0]);
    expect(enviados.length).toBeGreaterThanOrEqual(2);
    expect(enviados.length).toBeLessThanOrEqual(3);
    enviados.forEach((e, i) => {
      expect(e.numero).toBe(DONO);
      expect(e.instancia).toBe("prospecta-dolores");
      expect(e.texto.length).toBeLessThanOrEqual(MAX_CARACTERES_WHATSAPP);
      expect(e.texto.startsWith(`(${i + 1}/${enviados.length})\n`)).toBe(true);
      expect(e.texto).not.toMatch(/Abc\d+xyz9/); // o filtro de segredos vale em todas as partes
      expect(e.texto).not.toContain("golpe.example");
    });
    const respostas = await q<any>("SELECT resultado, resumo FROM dolores_acoes WHERE funcao = 'whatsapp_resposta' ORDER BY id");
    expect(respostas.map(r => r.resumo.parte)).toEqual(enviados.map((_, i) => `${i + 1}/${enviados.length}`));
    expect(JSON.stringify(respostas)).not.toContain(DONO);
  });

  it("a primeira parte falhou: as seguintes não saem e a mensagem fica com erro de envio", async () => {
    enviar.mockResolvedValueOnce(false);
    roteiro = [() => ({ stop_reason: "end_turn", usage: uso, content: [{ type: "text", text: "x\n".repeat(3000) }] })];
    const r = await chamar(aviso("Dolores, liste tudo"));
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(r.body.r).toEqual({ "erro-envio": 1 });
  });
});

describe("plano_de_atrasos pela porta da ponte (cenário de aceite)", () => {
  it("só leitura, contamina, entrada estrita, conta conferida e itens do CRM do mais atrasado para o menos", async () => {
    const f = funcaoPorNome("plano_de_atrasos")!;
    expect(f.contamina).toBe(true);
    expect(() => f.entrada.parse({ modulo: "crm", destino: "5511988887777" })).toThrow();
    expect(() => f.entrada.parse({ dataLimite: "30/11/2026" })).toThrow();
    const r = await executarFuncao({ funcao: "plano_de_atrasos", argumentos: { modulo: "crm", soDiasUteis: false } }, { canal: "whatsapp" });
    expect(r.body.ok).toBe(true);
    const d = (r.body as any).dados;
    expect(d).toMatchObject({ hoje: "2026-11-16", dataLimite: "2026-11-30", diasDisponiveis: 15, conferencia: { confere: true } });
    expect(d.total).toBeGreaterThan(0);
    const dias = d.dias.flatMap((x: any) => x.itens.map((l: string) => Number(/ — (\d+) d/.exec(l)?.[1] ?? -1)));
    expect(dias).toEqual([...dias].sort((a, b) => b - a));
    // dataLimite no passado: recusa explicada, nada lido
    const passado = await executarFuncao({ funcao: "plano_de_atrasos", argumentos: { dataLimite: "2026-11-01" } }, { canal: "whatsapp" });
    expect((passado.body as any).dados.erro).toMatch(/anterior/);
  });

  it("listar_atrasos enxuto: sem campos vazios (null/false) e com o mesmo conteúdo", async () => {
    const r = await executarFuncao({ funcao: "listar_atrasos", argumentos: {} }, { canal: "whatsapp" });
    const itens = (r.body as any).dados.itens as Array<Record<string, unknown>>;
    expect(itens.length).toBeGreaterThan(0);
    for (const i of itens) for (const v of Object.values(i)) { expect(v).not.toBeNull(); expect(v).not.toBe(false); }
    expect(itens.find(i => i.modulo === "Regularização" && i.id === 1)?.motivoRegistrado).toBe("Aguardando certidão do cartório");
  });
});

describe("tela — preços por modelo e cotação (só admin, pelo appRouter)", () => {
  it("colaborador com todos os módulos, corretor e inativo: FORBIDDEN em situacao, salvarPrecoModelo e salvarCotacao; nada muda", async () => {
    const inativo = appRouter.createCaller({ user: { id: 1, role: "admin", active: false, permissions: "[]" }, req: {}, res: {} } as never);
    const rotas = [
      (c: ReturnType<typeof caller>) => c.dolores.operacao.salvarPrecoModelo({ modelo: HAIKU, entrada: 1, saida: 5, cacheEscrita: null, cacheLeitura: null }),
      (c: ReturnType<typeof caller>) => c.dolores.operacao.salvarCotacao({ cotacao: 5.5 }),
      (c: ReturnType<typeof caller>) => c.dolores.operacao.situacao(),
    ];
    for (const rota of rotas) for (const c of [caller("colaborador", [...ADMIN_MODULES]), caller("corretor"), caller("user"), inativo]) {
      await expect(rota(c)).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|UNAUTHORIZED/) });
    }
    expect(await q("SELECT * FROM dolores_precos_modelo")).toEqual([]);
    expect((await q<any>("SELECT cotacao_dolar FROM dolores_cotacao"))[0].cotacao_dolar).toBeNull();
  });

  it("admin: salva preço e cotação; a tela mostra centavos no Haiku com os números reais, a reserva para o modelo sem preço e a diferença do limite", async () => {
    const admin = caller("admin");
    await banco.pg.exec(`UPDATE dolores_operacao_config SET preco_entrada_milhao = 15, preco_saida_milhao = 75;
      INSERT INTO dolores_consumo (mes, mensagem_id, modelo, volta, tokens_entrada, tokens_saida, tokens_cache_escrita, tokens_cache_leitura, parada)
        VALUES ('2026-11', NULL, '${HAIKU}', 1, ${REAL.entrada}, ${REAL.saida}, ${REAL.cacheEscrita}, ${REAL.cacheLeitura}, 'end_turn');`);
    // antes do preço do Haiku: usa a reserva (o preço antigo) e avisa
    const antes = await admin.dolores.operacao.situacao();
    expect(antes.gasto.custo!.usouReserva).toEqual([HAIKU]);
    expect(antes.gasto.custo!.porModelo[0].reais!).toBeGreaterThan(0.5); // reserva com o preço do Opus: caro, e a tela diz que é reserva
    expect(antes.gasto.precosPorModelo.map(m => m.modelo)).toContain(HAIKU);
    expect(antes.gasto.precosPorModelo.find(m => m.modelo === HAIKU)!.preco).toBeNull();
    await expect(admin.dolores.operacao.salvarPrecoModelo({ modelo: "x y", entrada: 1, saida: 5, cacheEscrita: null, cacheLeitura: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin.dolores.operacao.salvarPrecoModelo({ modelo: HAIKU, entrada: -1, saida: 5, cacheEscrita: null, cacheLeitura: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin.dolores.operacao.salvarPrecoModelo({ modelo: HAIKU, entrada: 1, saida: 5, cacheEscrita: null, cacheLeitura: null, porUserId: 9 } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin.dolores.operacao.salvarCotacao({ cotacao: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await admin.dolores.operacao.salvarPrecoModelo({ modelo: HAIKU, entrada: 0.1, saida: 0.5, cacheEscrita: 0.125, cacheLeitura: 0.01 });
    const s = await admin.dolores.operacao.salvarCotacao({ cotacao: 5.5 });
    const haiku = s.gasto.custo!.porModelo.find(m => m.modelo === HAIKU)!;
    expect(haiku).toMatchObject({ fonte: "tabela", dolares: 0.0088, reais: 0.05, cacheAssumido: false });
    expect(s.gasto.custo!.usouReserva).toEqual([]);
    expect(s.gasto.reaisEstimados).toBe(0.05);
    expect(s.gasto.cotacao).toBe(5.5);
    // o limite (a trava) conta o cache como entrada cheia — e a tela mostra os dois números
    expect(s.gasto.uso.entrada).toBe(REAL.entrada + REAL.cacheEscrita + REAL.cacheLeitura);
    expect(s.gasto.custo!.tokensNoLimite.entrada).toBe(s.gasto.uso.entrada);
    const aud = await q<any>("SELECT funcao, canal, resumo FROM dolores_acoes WHERE funcao = 'operacao_config' ORDER BY id");
    expect(aud.map(a => a.resumo.porUserId)).toEqual([1, 1]);
    expect(JSON.stringify(s)).not.toMatch(/sk-ant/);
  });
});

describe("migração 0134 (preços por modelo e cotação)", () => {
  const SQL = readFileSync(new URL("../../drizzle/0134_dolores_precos.sql", import.meta.url), "utf8");

  it("aplicada duas vezes (já foi no criarBanco) e mais uma: sem erro, uma linha de cotação, CHECKs valendo", async () => {
    await banco.pg.exec(SQL);
    expect(await q("SELECT id, cotacao_dolar FROM dolores_cotacao")).toEqual([{ id: 1, cotacao_dolar: null }]);
    await expect(banco.pg.exec("INSERT INTO dolores_cotacao (id) VALUES (2)")).rejects.toThrow();
    await expect(banco.pg.exec("UPDATE dolores_cotacao SET cotacao_dolar = 0")).rejects.toThrow();
    await expect(banco.pg.exec("INSERT INTO dolores_precos_modelo (modelo, entrada_milhao_usd) VALUES ('m', -1)")).rejects.toThrow();
    await expect(banco.pg.exec("INSERT INTO dolores_precos_modelo (modelo) VALUES ('  ')")).rejects.toThrow();
  });

  it("só aditiva: nenhum ALTER, DROP, DELETE, TRUNCATE nem UPDATE; os campos antigos de preço continuam", async () => {
    const semComentarios = SQL.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
    expect(semComentarios).not.toMatch(/\b(ALTER|DROP|DELETE\s+FROM|TRUNCATE|UPDATE\s+")\b/i);
    expect((await q<any>("SELECT preco_entrada_milhao, preco_saida_milhao FROM dolores_operacao_config"))).toHaveLength(1);
  });

  it("excluir o usuário que mexeu nos preços continua funcionando (ON DELETE SET NULL)", async () => {
    const [{ id }] = await q<{ id: number }>(`INSERT INTO users ("openId", name, role, active, "passwordHash") VALUES ('adm-precos', 'Adm', 'admin', true, 'h') RETURNING id`);
    await banco.pg.exec(`INSERT INTO dolores_precos_modelo (modelo, entrada_milhao_usd, atualizado_por) VALUES ('m', 1, ${id});
      UPDATE dolores_cotacao SET atualizado_por = ${id}; DELETE FROM users WHERE id = ${id};`);
    expect((await q<any>("SELECT atualizado_por FROM dolores_precos_modelo"))[0].atualizado_por).toBeNull();
    expect((await q<any>("SELECT atualizado_por FROM dolores_cotacao"))[0].atualizado_por).toBeNull();
  });
});
