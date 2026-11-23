// EPIC-025 (Dolores, etapa 8) — testes de PROVA do portão de QA de segurança (Quinn). Os marcados "ACHADO" foram invertidos
// depois da correção (A1 quadros na 1ª mensagem e partes no tempo; A2 aviso da ação cortada; A3 numeração; A4 teto no resumo).
// Banco em memória (PGlite); modelo e envio falsos: nada sai para a rede.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lerConfirmacao } from "../../shared/dolores/confirmacao.js";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { custoDoUso } from "../../shared/dolores/custo.js";
import { partesDaResposta } from "../../shared/dolores/whatsapp.js";
import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { AVISO_FERRAMENTA_CORTADA, FOLGA_DO_LACO_MS, TETO_ENTRADA_POR_PEDIDO, definirClienteModelo, type PedidoModelo, type RespostaModelo } from "./cerebro.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte, executarFuncao } from "./ponte.js";
import { AVISO_FALTOU_PARTE, MARCA_ENTREGA_INCOMPLETA, MINIMO_PARA_ENVIAR_MS, PRAZO_TOTAL_MS, definirDependenciasWhatsapp, textoEntregue, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";

const DONO = "5599991234567";
const HAIKU = "claude-haiku-5-5";
const REAL = { entrada: 13_068, saida: 4_413, cacheEscrita: 37_860, cacheLeitura: 50_480 };

describe("QA item 9 — conta do custo com os preços reais do Haiku 5.5", () => {
  it("0,10 / 0,50 / 0,125 / 0,01 US$ por milhão → US$ 0,00875 (≈ 0,0088): a fórmula está certa", () => {
    const c = custoDoUso(REAL, { entrada: 0.1, saida: 0.5, cacheEscrita: 0.125, cacheLeitura: 0.01 })!;
    expect(c.valor).toBeCloseTo(0.0087506, 7);
    // os fatores padrão (1,25× e 0,1× da entrada) dão o mesmo número com só entrada/saída informadas
    expect(custoDoUso(REAL, { entrada: 0.1, saida: 0.5, cacheEscrita: null, cacheLeitura: null })!.valor).toBeCloseTo(0.0087506, 7);
    // o "0,0875" do teste do dev vem do PREÇO usado no teste (1 / 5), 10× o do Haiku 5.5 — não de erro de fórmula
    expect(custoDoUso(REAL, { entrada: 1, saida: 5, cacheEscrita: null, cacheLeitura: null })!.valor).toBeCloseTo(0.087506, 6);
  });
});

describe("QA item 1 — partes da resposta", () => {
  it("A1 (era ACHADO): os quadros do sistema (feito/fila) vão SEMPRE na PRIMEIRA parte, inteiros; com menos partes, corta o texto", () => {
    const texto = Array.from({ length: 200 }, (_, i) => `- ${i + 1}. Cliente ${i + 1} — ${i} d`).join("\n");
    const quadro = "*Feito por este pedido*\n- tarefa criada [QUADRO]";
    const partes = partesDaResposta(texto, quadro);
    expect(partes.length).toBeGreaterThan(1);
    expect(partes[0]).toMatch(/^\(1\/\d\)\n\*Feito por este pedido\*\n- tarefa criada \[QUADRO\]\n\n- 1\. Cliente 1/);
    expect(partes.slice(1).some(p => p.includes("[QUADRO]"))).toBe(false);
    // pouco tempo (uma parte só): o quadro continua inteiro (fecha a mensagem), o texto do modelo é que é cortado
    const uma = partesDaResposta(texto, quadro, undefined, 1);
    expect(uma).toHaveLength(1);
    expect(uma[0].endsWith(`\n\n${quadro}`)).toBe(true);
    expect(uma[0].length).toBeLessThanOrEqual(3800);
    expect(uma[0]).toMatch(/Resposta cortada por tamanho/);
    // quadro grande (fila cheia): vai sozinho na 1ª, sem corte
    const grande = `*Na fila*\n${"- [ABCDE] item da fila ".repeat(160)}FIM`;
    const p2 = partesDaResposta(texto, grande, undefined, 2);
    expect(p2).toHaveLength(2);
    expect(p2[0]).toBe(`(1/2)\n${grande}`);
  });

  it("A3 (era ACHADO): a numeração '(3/3)' escrita pelo modelo no começo de linha sai; só a do sistema fica", () => {
    const texto = `(1/1) Resumo curto.\n(3/3)\n ( 2 / 3 ) Fim da resposta.\n${"x ".repeat(2500)}`;
    const partes = partesDaResposta(texto);
    expect(partes[0].startsWith("(1/2)\nResumo curto.\n\nFim da resposta.")).toBe(true);
    expect(partes.join("\n").match(/^\(\d\/\d\)/gm)).toEqual(["(1/2)", "(2/2)"]);
    expect(partesDaResposta("(2/3) oi")).toEqual(["oi"]);
    // no meio da frase não é numeração e fica
    expect(partesDaResposta("faltam (2/3) das parcelas")).toEqual(["faltam (2/3) das parcelas"]);
  });
});

// ── Banco em memória ─────────────────────────────────────────────────────────────────────────────────────────────────────
let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviar: ReturnType<typeof vi.fn>;
let pedidos: PedidoModelo[];
let roteiro: Array<(p: PedidoModelo) => RespostaModelo>;
let relogio = 0;
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
let seq = 0;
const aviso = (texto: string) => ({
  event: "messages.upsert", instance: "prospecta-dolores",
  data: { key: { remoteJid: `${DONO}@s.whatsapp.net`, fromMe: false, id: `QA8-${++seq}` }, message: { conversation: texto }, messageTimestamp: Math.floor((AGORA.getTime() + (lerConfirmacao(texto) ? 1_000 : -30_000)) / 1000) },
});
const chamar = (body: unknown) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, body, ip: "203.0.113.9" } as never);
const uso = { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}', ia_ligada = true,
    limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  esquecerUsuarioDolores();
  definirDependenciasPonte({ agora: () => AGORA });
  relogio = 1_000_000;
  enviar = vi.fn(async () => true);
  definirDependenciasWhatsapp({ agora: () => AGORA, enviar: enviar as never, ms: () => relogio });
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
  vi.restoreAllMocks();
});

describe("QA item 1 — envio em várias mensagens", () => {
  it("segredo PARTIDO na fronteira entre duas mensagens não escapa (o texto inteiro é filtrado antes de dividir)", async () => {
    // a linha da senha fica exatamente sobre o ponto de corte da 1ª parte (sem quebra de linha antes → corte em espaço/rígido)
    const texto = `${"a".repeat(3790)} senha: Zq9TopSecret77 ${"b ".repeat(1500)}`;
    roteiro = [() => ({ stop_reason: "end_turn", usage: uso, content: [{ type: "text", text: texto }] })];
    await chamar(aviso("Dolores, liste tudo"));
    const enviados = enviar.mock.calls.map(c => c[0].texto as string);
    expect(enviados.length).toBeGreaterThan(1);
    const tudo = enviados.join("");
    expect(tudo).not.toMatch(/Zq9TopSecret77|Zq9Top|Secret77/);
    expect(enviar.mock.calls.every(c => c[0].numero === DONO)).toBe(true);
  });

  it("reentrega do MESMO aviso do webhook não reenvia as mensagens", async () => {
    const longa = Array.from({ length: 160 }, (_, i) => `- ${i + 1}. Cliente ${i + 1} — ${i} d`).join("\n");
    roteiro = [() => ({ stop_reason: "end_turn", usage: uso, content: [{ type: "text", text: longa }] })];
    const a = aviso("Dolores, liste tudo");
    await chamar(a);
    const n = enviar.mock.calls.length;
    expect(n).toBeGreaterThan(1);
    await chamar(a);
    expect(enviar.mock.calls.length).toBe(n);
    expect(pedidos).toHaveLength(1);
  });

  const longa = Array.from({ length: 160 }, (_, i) => `- ${i + 1}. Cliente ${i + 1} — ${i} d`).join("\n");
  const muito = Array.from({ length: 300 }, (_, i) => `- ${i + 1}. Cliente ${i + 1} — ${i} d`).join("\n");
  const TAREFA = { titulo: "Cobrar certidão no cartório", responsavel: "Bianca Souza", prazo: "2026-11-20", vinculo: { tipo: "cliente", id: 2 } };
  const comTarefa = () => {
    roteiro = [
      () => ({ stop_reason: "tool_use", usage: uso, content: [{ type: "tool_use", id: "tu_t", name: "criar_tarefa", input: TAREFA }] }),
      () => ({ stop_reason: "end_turn", usage: uso, content: [{ type: "text", text: muito }] }),
    ];
  };
  const respostas = () => q<any>("SELECT resultado, motivo, resumo FROM dolores_acoes WHERE funcao = 'whatsapp_resposta' ORDER BY id");

  it("A1 (era ACHADO): sem tempo depois da 1ª mensagem, o quadro do que foi gravado JÁ saiu nela; a auditoria diz quais partes saíram", async () => {
    comTarefa();
    // o 1º envio demora até restar menos que MINIMO_PARA_ENVIAR_MS do prazo do aviso
    enviar.mockImplementationOnce(async () => { relogio += 44_000; return true; });
    const r = await chamar(aviso("Dolores, crie aquela tarefa para a Bianca e liste tudo."));
    expect(enviar).toHaveBeenCalledTimes(1);
    const primeira = enviar.mock.calls[0][0].texto as string;
    // EPIC-027 C5 (E2): o quadro do sistema agora é a pergunta "pode" (a tarefa espera o dono) — e ela continua indo na 1ª mensagem
    expect(primeira).toMatch(/^\(1\/\d\)\n\*Posso fazer isto\?\*\n- criar a tarefa "Cobrar certidão no cartório"/);
    expect(r.body.r).toEqual({ "erro-envio": 1 });
    const rs = await respostas();
    expect(rs.find(x => x.resultado === "erro" && /sem tempo/.test(x.motivo))).toBeTruthy();
    const resumo = rs.find(x => x.motivo === "resposta incompleta: faltou parte")!.resumo;
    expect(resumo).toMatchObject({ partesEnviadas: [1], avisoDeFalta: false });
    expect(resumo.partesPrevistas).toBeGreaterThan(1);
  });

  it("A1: quando só cabe esta parte e não as seguintes, ela vira a última e já leva 'faltou parte da resposta'", async () => {
    comTarefa();
    // depois do 1º envio, resta tempo para uma mensagem, mas não para as duas que faltam
    enviar.mockImplementationOnce(async () => { relogio = 1_000_000 + PRAZO_TOTAL_MS - 2_000; return true; });
    await chamar(aviso("Dolores, crie aquela tarefa para a Bianca e liste tudo."));
    const enviados = enviar.mock.calls.map(c => c[0].texto as string);
    expect(enviados).toHaveLength(2);
    expect(enviados[0]).toMatch(/\*Posso fazer isto\?\*/);
    expect(enviados[1]).toMatch(/^\(2\/3\)\n/);
    expect(enviados[1].endsWith(AVISO_FALTOU_PARTE)).toBe(true);
    expect(enviados.every(t => t.length <= 3800)).toBe(true);
    const resumo = (await respostas()).find(x => x.motivo === "resposta incompleta: faltou parte")!.resumo;
    expect(resumo).toMatchObject({ partesPrevistas: 3, partesEnviadas: [1, 2], avisoDeFalta: true });
  });

  it("A1: a 2ª parte falhou no envio — uma mensagem curta avisa que faltou parte (e a auditoria registra)", async () => {
    comTarefa();
    enviar.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await chamar(aviso("Dolores, crie aquela tarefa para a Bianca e liste tudo."));
    const enviados = enviar.mock.calls.map(c => c[0]);
    expect(enviados).toHaveLength(3);
    expect(enviados[2].texto).toBe(AVISO_FALTOU_PARTE);
    expect(enviados.every(e => e.numero === DONO)).toBe(true);
    const resumo = (await respostas()).find(x => x.motivo === "resposta incompleta: faltou parte")!.resumo;
    expect(resumo).toMatchObject({ partesEnviadas: [1], avisoDeFalta: true });
  });

  it("revisão automática (C): entrega incompleta — a memória guarda só o que saiu do texto do modelo (sem os quadros), com a marca", async () => {
    comTarefa();
    enviar.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await chamar(aviso("Dolores, crie aquela tarefa para a Bianca e liste tudo."));
    const enviados = enviar.mock.calls.map(c => c[0].texto as string);
    const [linha] = await q<{ texto: string }>("SELECT texto FROM dolores_conversa WHERE origem = 'resposta' ORDER BY id DESC LIMIT 1");
    expect(linha.texto).toContain(MARCA_ENTREGA_INCOMPLETA);
    // o começo do texto do modelo (que foi na 1ª parte) está; o fim (que nunca saiu) não
    expect(linha.texto).toContain("- 1. Cliente 1 —");
    expect(enviados.join("\n")).not.toContain("- 300. Cliente 300");
    expect(linha.texto).not.toContain("- 300. Cliente 300");
    // os quadros do sistema não entram (só a nota de que foram mostrados)
    expect(linha.texto).not.toMatch(/Posso fazer isto\?/);
    expect(linha.texto).not.toMatch(/^\(\d\/\d\)/m);
  });

  it("revisão automática (C): textoEntregue (regra pura) — tira numeração e os quadros inteiros da 1ª parte; quadro cortado não deixa nada dela", () => {
    expect(textoEntregue(["(1/3)\nQUADRO\n\nTexto um", "(2/3)\nTexto dois"], "QUADRO")).toBe("Texto um\nTexto dois");
    expect(textoEntregue(["(1/3)\nQUADRO cortado…", "(2/3)\nTexto dois"], "QUADRO cortado por inteiro")).toBe("Texto dois");
    expect(textoEntregue(["(1/2)\nSó texto"], null)).toBe("Só texto");
  });

  it("A1: o laço guarda tempo para as 3 partes — resposta longa que termina no limite do laço sai inteira", async () => {
    // a chamada ao modelo usa TODO o tempo do laço: sobra só a folga do laço para o envio
    roteiro = [() => { relogio += PRAZO_TOTAL_MS - FOLGA_DO_LACO_MS; return { stop_reason: "end_turn", usage: uso, content: [{ type: "text", text: muito }] }; }];
    // cada envio leva o tempo reservado por parte
    enviar.mockImplementation(async () => { relogio += MINIMO_PARA_ENVIAR_MS - 100; return true; });
    const r = await chamar(aviso("Dolores, liste tudo"));
    expect(r.body.r).toEqual({ respondida: 1 });
    expect(enviar.mock.calls.map(c => (c[0].texto as string).slice(0, 6))).toEqual(["(1/3)\n", "(2/3)\n", "(3/3)\n"]);
  });
});

describe("QA item 2 — parcial em max_tokens", () => {
  it("A2 (era ACHADO): texto parcial que AFIRMA a ação, com a ação cortada: nada é executado e o dono lê que a ação NÃO foi executada", async () => {
    roteiro = [() => ({ stop_reason: "max_tokens", usage: { ...uso, output_tokens: 5000 }, content: [
      { type: "text", text: "Pronto, criei a tarefa para ligar para a Maria amanhã." },
      { type: "tool_use", id: "tu_cortado", name: "criar_tarefa", input: {} },
    ] })];
    await chamar(aviso("Dolores, crie uma tarefa para ligar para a Maria amanhã"));
    expect(pedidos).toHaveLength(1);
    expect(await q("SELECT id FROM dolores_acoes WHERE funcao = 'criar_tarefa'")).toEqual([]);
    expect(await q("SELECT id FROM dolores_autoria")).toEqual([]);
    const texto = enviar.mock.calls[0][0].texto as string;
    expect(texto).toContain("criei a tarefa");
    expect(texto).toContain(AVISO_FERRAMENTA_CORTADA);
    expect(texto).toMatch(/NÃO foi executada\. Nada foi alterado no sistema\.$/);
  });

  it("A2: ação executada ANTES do corte — o quadro do sistema vai primeiro e o aviso manda conferir o quadro (não diz 'nada alterado')", async () => {
    roteiro = [
      () => ({ stop_reason: "tool_use", usage: uso, content: [{ type: "tool_use", id: "tu_t", name: "criar_tarefa",
        input: { titulo: "Cobrar certidão no cartório", responsavel: "Bianca Souza", prazo: "2026-11-20", vinculo: { tipo: "cliente", id: 2 } } }] }),
      () => ({ stop_reason: "max_tokens", usage: uso, content: [{ type: "text", text: "Pronto, criei duas tarefas.\nE agora a segunda" }, { type: "tool_use", id: "tu_2", name: "criar_tarefa", input: {} }] }),
    ];
    // E11b: "aquela tarefa" (texto que não saiu das palavras dele) mantém a tarefa como PROPOSTA — o quadro do sistema continua testado
    await chamar(aviso("Dolores, crie aquela tarefa para a Bianca."));
    // EPIC-027 C5 (E2): a tarefa foi PROPOSTA antes do corte (item esperando o "pode")
    expect(await q("SELECT id FROM dolores_acoes WHERE funcao = 'criar_tarefa' AND resultado = 'ok'")).toHaveLength(1);
    expect(await q("SELECT id FROM dolores_aprovacoes WHERE situacao = 'aguardando'")).toHaveLength(1);
    const texto = enviar.mock.calls[0][0].texto as string;
    expect(enviar).toHaveBeenCalledTimes(1); // mensagem única: é a primeira, e o quadro do sistema vai nela
    expect(texto).toMatch(/\*Posso fazer isto\?\*\n- criar a tarefa "Cobrar certidão no cartório"/);
    expect(texto).toContain(AVISO_FERRAMENTA_CORTADA);
    expect(texto).toMatch(/Confira no quadro do sistema/);
    expect(texto).not.toMatch(/Nada foi alterado/);
  });

  it("max_tokens sem texto na ÚLTIMA volta: no máximo 1 chamada extra (MAX_VOLTAS + 1), sem ferramentas", async () => {
    const ferr = (i: number): RespostaModelo => ({ stop_reason: "tool_use", usage: uso, content: [{ type: "tool_use", id: `tu_${i}`, name: "listar_atrasos", input: { modulo: "crm" } }] });
    roteiro = [0, 1, 2, 3, 4].map(i => () => ferr(i));
    roteiro.push(() => ({ stop_reason: "max_tokens", usage: uso, content: [{ type: "tool_use", id: "tu_x", name: "listar_atrasos", input: {} }] }));
    roteiro.push(() => ({ stop_reason: "max_tokens", usage: uso, content: [] }));
    roteiro.push(() => { throw new Error("chamada a mais"); });
    await chamar(aviso("Dolores, quais atrasos?"));
    expect(pedidos).toHaveLength(7);
    expect(pedidos[6].semFerramentas).toBe(true);
    expect(pedidos.every(p => p.maxTokens <= 5000)).toBe(true);
  });

  it("A4: max_tokens sem texto com o teto de entrada do pedido já estourado: a chamada de resumo NÃO acontece; frase fixa", async () => {
    roteiro = [() => ({ stop_reason: "max_tokens", usage: { ...uso, input_tokens: TETO_ENTRADA_POR_PEDIDO }, content: [{ type: "tool_use", id: "tu_x", name: "listar_atrasos", input: {} }] })];
    roteiro.push(() => { throw new Error("chamada a mais"); });
    await chamar(aviso("Dolores, quais atrasos?"));
    expect(pedidos).toHaveLength(1);
    const texto = enviar.mock.calls[0][0].texto as string;
    expect(texto).toMatch(/^Dolores: não consegui concluir\. \(Parei antes de terminar: a resposta ficou longa demais\./);
    expect(texto).toContain(AVISO_FERRAMENTA_CORTADA);
    expect(texto).toContain("Nada foi alterado no sistema.");
  });
});

describe("QA item 5 — plano_de_atrasos pela porta da ponte", () => {
  const exec = (argumentos: Record<string, unknown>, canal: "whatsapp" | "ponte" = "whatsapp") =>
    executarFuncao({ funcao: "plano_de_atrasos", argumentos, pedidoId: `qa8-${++seq}` }, { canal } as never);

  it("data-limite absurda, inexistente ou no passado é recusada; campo extra é recusado", async () => {
    for (const dataLimite of ["9999-12-31", "2026-02-30", "2020-01-01", "2026-13-01"]) {
      const r = await exec({ dataLimite });
      expect(JSON.stringify(r.body), dataLimite).toMatch(/inválid|anterior|passa de|erro/i);
      expect(JSON.stringify(r.body)).not.toMatch(/"dias":\[\{/);
    }
    const extra = await exec({ modulo: "crm", sql: "DROP TABLE users" });
    expect(extra.body.ok).toBe(false);
  });
});
