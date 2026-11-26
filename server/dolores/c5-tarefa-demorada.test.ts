// EPIC-027 C5 — "tarefa demorada sem travar a conversa". Pelo webhook de verdade (PGlite, modelo, relógio e envio falsos, sem rede):
// o pedido só de leitura do dono que não cabe vira tarefa (por código: voltas e prazo), a Dolores responde na hora, a conversa segue
// livre, e um aviso posterior (ou o cron) retoma, conclui e manda o resultado UMA vez, só ao dono, só lendo.
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { ACOES } from "./acoes/registro.js";
import { ehPedidoDeRelatorio, intencaoDeAcao } from "../../shared/dolores/fila.js";
import { MAX_VOLTAS_TAREFA, VOLTAS_PARA_TAREFA, definirClienteModelo, type PedidoModelo, type RespostaModelo } from "./cerebro.js";
import { definirSorteioCodigo } from "./aprovacoes.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte } from "./ponte.js";
import { definirRelogioCron, tratarCronAvisos, tratarCronDolores } from "./rondas.js";
import { FRASE_SEM_TAREFA, FRASE_VOU_LEVANTAR, HORAS_DA_RETOMADA, MAX_TAREFAS_ABERTAS, MAX_TAREFAS_POR_DIA, VALIDADE_TAREFA_MS, fraseVouLevantarForaDeHora, proximosCrons, validadeSemTentativa } from "./tarefa-demorada.js";
import { AGORA, CENARIO, MIGRACAO_0153, criarBanco } from "./testes-banco.js";
import { definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";

const DONO = "5599991234567";
const ESTRANHO = "5511988887777";
const NOMES_ACOES = new Set(ACOES.map(a => a.nome));
let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviar: ReturnType<typeof vi.fn>;
let pedidosModelo: PedidoModelo[];
let roteiro: Array<(p: PedidoModelo) => RespostaModelo>;
let agora: Date;
/** Relógio do prazo (ms) do aviso: cada chamada ao modelo "leva" PASSO_MODELO_MS. */
let relogioMs: number;
let PASSO_MODELO_MS: number;
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
const tarefas = () => q<{ id: number; situacao: string; tentativas: number; comando: string | null; mensagem_id: number; motivo: string | null }>("SELECT * FROM dolores_tarefas_demoradas ORDER BY id");

let seq = 0;
function aviso(p: { de?: string; texto: string; grupo?: string }) {
  const key = p.grupo
    ? { remoteJid: p.grupo, fromMe: false, id: `TD-G${++seq}`, participant: `${p.de ?? DONO}@s.whatsapp.net` }
    : { remoteJid: `${p.de ?? DONO}@s.whatsapp.net`, fromMe: false, id: `TD-M${++seq}` };
  return { event: "messages.upsert", instance: "prospecta-dolores", data: { key, message: { conversation: p.texto }, messageTimestamp: Math.floor(agora.getTime() / 1000) - 5 } };
}
const chamar = (body: unknown) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, body, ip: "203.0.113.9" } as never);
const dono = (texto: string) => chamar(aviso({ texto }));
/** Aviso de situação de envio (chega segundos depois de toda mensagem enviada): é nele que a tarefa costuma ser retomada. */
const situacaoDeEnvio = () => chamar({ event: "messages.update", instance: "prospecta-dolores", data: { status: "DELIVERY_ACK" } });
const uso = { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const ferramenta = (...chamadas: Array<[string, unknown]>): RespostaModelo => ({ stop_reason: "tool_use", usage: uso,
  content: chamadas.map(([name, input], i) => ({ type: "tool_use", id: `tu_${name}_${i}_${Math.random()}`, name, input })) });
const texto = (t: string): RespostaModelo => ({ stop_reason: "end_turn", usage: uso, content: [{ type: "text", text: t }] });
const respostasAoDono = () => enviar.mock.calls.map(c => c[0] as { numero: string; texto: string }).filter(m => m.numero === DONO).map(m => m.texto);
const PEDIDO_LONGO = "me faz um relatório completo de todas as obras, medições e financiamentos";
/** O pedido longo: o modelo pede consultas volta após volta (não cabe). */
const roteiroLongo = () => { for (let i = 0; i < VOLTAS_PARA_TAREFA; i++) roteiro.push(() => ferramenta(["listar_obras", {}])); };
/** A retomada: duas voltas de consulta e o relatório. */
const roteiroRetomada = (final = "Relatório: a obra Casa Ana está em 60%.") => roteiro.push(() => ferramenta(["listar_obras", {}]), () => ferramenta(["listar_financiamentos", {}]), () => texto(final));

/** Cria a tarefa: o pedido do dono gasta voltas demais e o aviso termina sem tempo para retomar na hora. */
async function criarTarefa(pedido = PEDIDO_LONGO) {
  PASSO_MODELO_MS = 4_000;
  roteiroLongo();
  const r = await dono(pedido);
  PASSO_MODELO_MS = 0;
  return r;
}

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}', ia_ligada = true,
      limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  esquecerUsuarioDolores();
  agora = new Date(AGORA);
  relogioMs = 1_000_000;
  PASSO_MODELO_MS = 0;
  definirDependenciasPonte({ agora: () => agora });
  enviar = vi.fn(async () => true);
  definirDependenciasWhatsapp({ agora: () => agora, enviar: enviar as never, ms: () => relogioMs });
  let sorteio = 0;
  definirSorteioCodigo(() => ((sorteio++ * 5) % 22) / 22 + 0.001);
  vi.mocked(configuracaoAnthropicPainel).mockResolvedValue({ apiKey: "sk-ant-chave-de-teste-nao-real-123456", modelo: "modelo-do-painel" });
  pedidosModelo = [];
  roteiro = [];
  definirClienteModelo(async p => {
    pedidosModelo.push(JSON.parse(JSON.stringify(p)));
    relogioMs += PASSO_MODELO_MS;
    const passo = roteiro.shift();
    if (!passo) throw new Error("roteiro do modelo acabou");
    return passo(p);
  });
});
afterEach(() => {
  ENV.cookieSecret = segredoAntes;
  definirDependenciasPonte(); definirDependenciasWhatsapp(); definirClienteModelo(); definirSorteioCodigo(); definirRelogioCron();
  vi.restoreAllMocks();
});

describe("migração 0153", () => {
  it("idempotente; situação, tentativas, uma por mensagem e pedido só na tarefa aberta são barrados pelo banco", async () => {
    await banco.pg.exec(MIGRACAO_0153());
    await banco.pg.exec(MIGRACAO_0153());
    await banco.pg.exec("INSERT INTO dolores_mensagens (instancia, external_id, remetente, do_dono, situacao) VALUES ('x', 'm1', '(sem número)', true, 'respondida')");
    const ins = (extra: string, valores: string) => banco.pg.exec(`INSERT INTO dolores_tarefas_demoradas (dia, expira_em${extra}) VALUES ('2026-11-16', now()${valores})`);
    await ins(", mensagem_id, comando", ", 1, 'pedido'");
    await expect(ins(", mensagem_id, comando", ", 1, 'de novo'")).rejects.toThrow();
    await expect(ins(", situacao", ", 'sumida'")).rejects.toThrow();
    await expect(ins(", tentativas", ", 3")).rejects.toThrow();
    await expect(ins(", situacao, comando", ", 'concluida', 'pedido guardado depois do fim'")).rejects.toThrow();
    await ins(", situacao", ", 'concluida'");
  });
});

describe("criação — só a conversa direta do dono, só pedido de leitura", () => {
  it("pedido de leitura que não cabe: responde na hora \"vou levantar\", grava a tarefa e NÃO manda resposta pela metade", async () => {
    await criarTarefa();
    expect(pedidosModelo).toHaveLength(VOLTAS_PARA_TAREFA);
    // sem a chamada de fechamento: parou por código depois das voltas de consulta
    expect(respostasAoDono()).toEqual([FRASE_VOU_LEVANTAR]);
    const [t] = await tarefas();
    expect(t).toMatchObject({ situacao: "aguardando", tentativas: 0, comando: PEDIDO_LONGO });
    const [m] = await q<{ situacao: string; motivo: string }>(`SELECT situacao, motivo FROM dolores_mensagens WHERE id = ${t.mensagem_id}`);
    expect(m).toEqual({ situacao: "respondida", motivo: "virou tarefa demorada" });
  });

  it("pelo PRAZO (menos de 18 s com o modelo ainda pedindo consulta), mesmo antes das 3 voltas", async () => {
    PASSO_MODELO_MS = 14_000; // 45 s de prazo: depois da 2ª volta sobram < 18 s
    roteiro.push(() => ferramenta(["listar_obras", {}]), () => ferramenta(["listar_obras", {}]));
    await dono(PEDIDO_LONGO);
    expect(pedidosModelo).toHaveLength(2);
    expect(respostasAoDono()).toEqual([FRASE_VOU_LEVANTAR]);
    expect(await tarefas()).toHaveLength(1);
  });

  it("pedido com intenção de AÇÃO nunca vira tarefa (segue o caminho da proposta, com o que deu)", async () => {
    PASSO_MODELO_MS = 4_000;
    for (let i = 0; i < 6; i++) roteiro.push(() => ferramenta(["listar_obras", {}]));
    roteiro.push(() => texto("Consultei as obras."));
    await dono("cria uma tarefa para a Bianca revisar todas as obras");
    expect(await tarefas()).toHaveLength(0);
    expect(respostasAoDono().join("\n")).not.toContain(FRASE_VOU_LEVANTAR);
  });

  it("estranho, grupo e cliente: nunca criam tarefa (nem chamam o modelo)", async () => {
    roteiroLongo();
    await chamar(aviso({ de: ESTRANHO, texto: PEDIDO_LONGO }));
    await chamar(aviso({ de: "5599988887777", texto: PEDIDO_LONGO })); // João, cliente cadastrado (atendimento desligado)
    await chamar(aviso({ grupo: "120363000000000001@g.us", texto: PEDIDO_LONGO }));
    expect(pedidosModelo).toHaveLength(0);
    expect(await tarefas()).toHaveLength(0);
  });

  it("por código: o único chamador de criarTarefaDemorada é a conversa do dono (whatsapp.ts#tratarComando); a ponte HTTP e os grupos não", () => {
    const pasta = new URL("./", import.meta.url);
    const chamadores = readdirSync(pasta).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .filter(f => /criarTarefaDemorada\(/.test(readFileSync(new URL(f, pasta), "utf8")) && f !== "tarefa-demorada.ts");
    expect(chamadores).toEqual(["whatsapp.ts"]);
    const whatsapp = readFileSync(new URL("whatsapp.ts", pasta), "utf8");
    const inicio = whatsapp.indexOf("async function tratarComando(");
    const fim = whatsapp.indexOf("\n}\n", inicio);
    expect(whatsapp.indexOf("criarTarefaDemorada(")).toBeGreaterThan(inicio);
    expect(whatsapp.indexOf("criarTarefaDemorada(")).toBeLessThan(fim);
    expect((whatsapp.match(/virarTarefa:/g) ?? []).length).toBe(1);
    for (const f of ["ponte.ts", "marcacao.ts", "atendimento.ts", "grupos.ts"]) expect(readFileSync(new URL(f, pasta), "utf8"), f).not.toMatch(/virarTarefa|criarTarefaDemorada/);
  });

  it("tetos: no máximo 2 abertas e 10 por dia — passou, vai o que deu para levantar, com o porquê", async () => {
    for (let i = 0; i < MAX_TAREFAS_ABERTAS; i++) await criarTarefa();
    expect(await tarefas()).toHaveLength(MAX_TAREFAS_ABERTAS);
    PASSO_MODELO_MS = 4_000;
    roteiroLongo();
    await dono(PEDIDO_LONGO);
    expect(await tarefas()).toHaveLength(MAX_TAREFAS_ABERTAS);
    expect(respostasAoDono().at(-1)).toContain(FRASE_SEM_TAREFA.abertas);
    // por dia: as terminadas contam
    await banco.pg.exec("UPDATE dolores_tarefas_demoradas SET situacao = 'concluida', comando = NULL");
    for (let i = (await tarefas()).length; i < MAX_TAREFAS_POR_DIA; i++) {
      await banco.pg.exec(`INSERT INTO dolores_tarefas_demoradas (dia, expira_em, situacao) VALUES ('2026-11-16', now(), 'concluida')`);
    }
    PASSO_MODELO_MS = 4_000;
    roteiroLongo();
    await dono(PEDIDO_LONGO);
    expect(respostasAoDono().at(-1)).toContain(FRASE_SEM_TAREFA.dia);
  });
});

describe("retomada — conclui e manda UMA vez, só ao dono, só lendo", () => {
  it("o próximo aviso com tempo retoma, conclui e manda o resultado ao dono; o pedido guardado é apagado", async () => {
    await criarTarefa();
    roteiroRetomada();
    const r = await situacaoDeEnvio();
    expect(r.body).toMatchObject({ tarefa: "concluida" });
    const respostas = respostasAoDono();
    expect(respostas).toHaveLength(2);
    expect(respostas[1]).toMatch(/^Dolores: aqui está o levantamento que você pediu às 09:00\.\n\nRelatório: a obra Casa Ana está em 60%\./);
    expect(enviar.mock.calls.every(c => (c[0] as { numero: string }).numero === DONO)).toBe(true);
    const [t] = await tarefas();
    expect(t).toMatchObject({ situacao: "concluida", tentativas: 1, comando: null });
    // o resultado entrou na memória da conversa do dono
    expect((await q<{ texto: string }>("SELECT texto FROM dolores_conversa WHERE papel = 'dolores'")).some(l => l.texto.includes("Casa Ana"))).toBe(true);
  });

  it("retomada dupla (dois avisos ao mesmo tempo, e de novo depois, e o cron) não manda duas respostas", async () => {
    await criarTarefa();
    roteiroRetomada();
    const [a, b] = await Promise.all([situacaoDeEnvio(), situacaoDeEnvio()]);
    expect([a.body.tarefa, b.body.tarefa].filter(x => x === "concluida")).toHaveLength(1);
    await situacaoDeEnvio();
    process.env.CRON_SECRET = "segredo-do-cron-de-teste";
    definirRelogioCron({ agora: () => agora, ms: () => relogioMs });
    await tratarCronDolores({ headers: { authorization: "Bearer segredo-do-cron-de-teste" } } as never);
    delete process.env.CRON_SECRET;
    expect(respostasAoDono()).toHaveLength(2); // o "vou levantar" + UM resultado
    expect(pedidosModelo).toHaveLength(VOLTAS_PARA_TAREFA + 3);
  });

  it("o cron (sem aviso nenhum) também retoma", async () => {
    await criarTarefa();
    roteiroRetomada();
    process.env.CRON_SECRET = "segredo-do-cron-de-teste";
    definirRelogioCron({ agora: () => agora, ms: () => relogioMs });
    await tratarCronDolores({ headers: { authorization: "Bearer segredo-do-cron-de-teste" } } as never);
    delete process.env.CRON_SECRET;
    expect((await tarefas())[0].situacao).toBe("concluida");
    expect(respostasAoDono()).toHaveLength(2);
  });

  it("a tarefa NUNCA executa ação: sem ferramenta de ação no pedido ao modelo; ação pedida pelo modelo é recusada e nada é gravado", async () => {
    await criarTarefa("lista tudo o que está atrasado nas obras e me diz o que fazer");
    const antes = pedidosModelo.length;
    roteiro.push(
      () => ferramenta(["criar_tarefa", { titulo: "Cobrar a obra", responsavel: "Bianca Souza", prazo: "2026-11-17" }], ["registrar_acompanhamento", { leadId: 1, texto: "x" }]),
      () => texto("Levantei os atrasos."),
    );
    await situacaoDeEnvio();
    const daRetomada = pedidosModelo.slice(antes);
    expect(daRetomada.length).toBeGreaterThan(0);
    for (const p of daRetomada) expect(p.ferramentas.map(f => (f as { name: string }).name).filter(n => NOMES_ACOES.has(n))).toEqual([]);
    expect(await q("SELECT * FROM dolores_aprovacoes")).toHaveLength(0);
    expect(await q("SELECT * FROM dolores_conversa_pendencia")).toHaveLength(0);
    expect(await q("SELECT * FROM tasks WHERE title = 'Cobrar a obra'")).toHaveLength(0);
    expect(await q("SELECT * FROM dolores_autoria")).toHaveLength(0);
    expect((await tarefas())[0].situacao).toBe("concluida");
    // um "pode" depois do resultado não confirma nada (não há proposta)
    roteiro.push(() => texto("Certo."));
    await dono("pode");
    expect(await q("SELECT * FROM dolores_aprovacoes")).toHaveLength(0);
  });

  it("a retomada usa o limite de voltas próprio (MAX_VOLTAS_TAREFA) e o teto de saída do relatório", async () => {
    await criarTarefa();
    const antes = pedidosModelo.length;
    for (let i = 0; i < MAX_VOLTAS_TAREFA; i++) roteiro.push(() => ferramenta(["listar_obras", {}]));
    roteiro.push(() => texto("Fechamento com o que deu."));
    await situacaoDeEnvio();
    // MAX_VOLTAS_TAREFA voltas + a de fechamento; nunca vira tarefa de novo
    expect(pedidosModelo.length - antes).toBe(MAX_VOLTAS_TAREFA + 1);
    expect(await tarefas()).toHaveLength(1);
    expect(respostasAoDono().at(-1)).toContain("Fechamento com o que deu.");
  });
});

describe("conversa livre durante a tarefa", () => {
  it("com a tarefa aguardando, o dono conversa normalmente; a resposta dele sai antes do resultado da tarefa", async () => {
    await criarTarefa();
    roteiro.push(() => texto("Bom dia! Tudo certo por aqui."));
    roteiroRetomada();
    await dono("bom dia");
    const respostas = respostasAoDono();
    expect(respostas[1]).toBe("Bom dia! Tudo certo por aqui.");
    expect(respostas[2]).toMatch(/^Dolores: aqui está o levantamento/);
    expect((await tarefas())[0].situacao).toBe("concluida");
  });

  it("com uma proposta aberta esperando o \"pode\", o resultado ESPERA (não tira a proposta de ordem)", async () => {
    await criarTarefa();
    roteiro.push(() => ferramenta(["criar_tarefa", { titulo: "Ligar para o João", responsavel: "Bianca Souza", prazo: "2026-11-17" }]), () => texto("Vou criar a tarefa."));
    // E11b: "aquela tarefa" (texto que não saiu das palavras dele) — fica como proposta esperando o "pode"
    await dono("cria aquela tarefa para a Bianca");
    expect(await q("SELECT * FROM dolores_conversa_pendencia WHERE situacao = 'aberta' AND adjacente")).toHaveLength(1);
    const r = await situacaoDeEnvio();
    expect(r.body).toMatchObject({ tarefa: "proposta-aberta" });
    expect((await tarefas())[0].situacao).toBe("aguardando");
    expect(await q("SELECT * FROM dolores_conversa_pendencia WHERE situacao = 'aberta' AND adjacente")).toHaveLength(1);
  });
});

describe("validade, tentativas, pausa e teto de gasto", () => {
  it("passou da validade: vence, o pedido é apagado e o dono é avisado UMA vez", async () => {
    await criarTarefa();
    // nunca tentada: vale até a 2ª chamada de cron depois da criação (09:00 → crons 10h e 11h) + 1 h de folga = 12:00 de Imperatriz
    expect(validadeSemTentativa(agora).toISOString()).toBe("2026-11-16T15:00:00.000Z");
    agora = new Date(validadeSemTentativa(agora).getTime() + 60_000);
    await situacaoDeEnvio();
    await situacaoDeEnvio();
    expect((await tarefas())[0]).toMatchObject({ situacao: "expirada", comando: null });
    const avisos = respostasAoDono().filter(t => t.includes("não consegui terminar a tempo"));
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain("Nada foi alterado no sistema");
    expect(pedidosModelo).toHaveLength(VOLTAS_PARA_TAREFA);
  });

  it("execução que parou no meio volta à fila na 1ª tentativa e falha (com aviso) na 2ª; envio interrompido fica \"incerta\" sem reenviar", async () => {
    await criarTarefa();
    await banco.pg.exec("UPDATE dolores_tarefas_demoradas SET situacao = 'executando', tentativas = 1, iniciada_em = '2026-11-16T11:50:00Z'");
    roteiroRetomada();
    await situacaoDeEnvio();
    expect((await tarefas())[0]).toMatchObject({ situacao: "concluida", tentativas: 2 });

    await criarTarefa();
    await banco.pg.exec("UPDATE dolores_tarefas_demoradas SET situacao = 'executando', tentativas = 2, iniciada_em = '2026-11-16T11:50:00Z' WHERE situacao = 'aguardando'");
    await situacaoDeEnvio();
    const t2 = (await tarefas())[1];
    expect(t2).toMatchObject({ situacao: "falhou", comando: null });
    expect(respostasAoDono().filter(t => t.includes("não consegui terminar a tempo"))).toHaveLength(1);

    await criarTarefa();
    await banco.pg.exec("UPDATE dolores_tarefas_demoradas SET situacao = 'enviando', comando = NULL, tentativas = 1, iniciada_em = '2026-11-16T11:50:00Z' WHERE situacao = 'aguardando'");
    const enviadasAntes = respostasAoDono().length;
    await situacaoDeEnvio();
    expect((await tarefas())[2].situacao).toBe("incerta");
    expect(respostasAoDono()).toHaveLength(enviadasAntes);
  });

  it("pausa geral: não retoma, não envia, não gasta — a tarefa espera; despausada, segue", async () => {
    await criarTarefa();
    await banco.pg.exec("UPDATE dolores_config SET pausada = true, motivo_pausa = 'teste' WHERE id = 1");
    const r = await situacaoDeEnvio();
    expect(r.body).toMatchObject({ tarefa: "pausada" });
    expect((await tarefas())[0]).toMatchObject({ situacao: "aguardando", tentativas: 0 });
    expect(pedidosModelo).toHaveLength(VOLTAS_PARA_TAREFA);
    expect(respostasAoDono()).toHaveLength(1);
    await banco.pg.exec("UPDATE dolores_config SET pausada = false WHERE id = 1");
    roteiroRetomada();
    await situacaoDeEnvio();
    expect((await tarefas())[0].situacao).toBe("concluida");
  });

  it("teto de gasto do mês atingido: não chama a IA, a tarefa fica bloqueada e o dono é avisado", async () => {
    await criarTarefa();
    await banco.pg.exec("INSERT INTO dolores_consumo (mes, modelo, volta, tokens_entrada, tokens_saida) VALUES ('2026-11', 'm', 1, 2000000, 0)");
    const r = await situacaoDeEnvio();
    expect(r.body).toMatchObject({ tarefa: "bloqueada" });
    expect((await tarefas())[0]).toMatchObject({ situacao: "bloqueada", comando: null });
    expect(pedidosModelo).toHaveLength(VOLTAS_PARA_TAREFA);
    expect(respostasAoDono().at(-1)).toMatch(/^Dolores: não fiz o levantamento que você pediu às/);
  });

  it("IA desligada no meio: bloqueia e avisa (nada é consultado)", async () => {
    await criarTarefa();
    await banco.pg.exec("UPDATE dolores_whatsapp_config SET ia_ligada = false WHERE id = 1");
    await situacaoDeEnvio();
    expect((await tarefas())[0].situacao).toBe("bloqueada");
    expect(pedidosModelo).toHaveLength(VOLTAS_PARA_TAREFA);
  });
});

describe("dados pessoais e segredos", () => {
  it("o pedido guardado perde segredos; auditoria e log não levam o texto nem o CPF", async () => {
    const erros = vi.spyOn(console, "error");
    await criarTarefa("relatório completo do cliente CPF 123.456.789-01, senha: abc12345");
    const [t] = await tarefas();
    expect(t.comando).toContain("123.456.789-01"); // o dono digitou para a busca (opção B)
    expect(t.comando).not.toContain("abc12345");
    roteiroRetomada();
    await situacaoDeEnvio();
    const auditoria = JSON.stringify(await q("SELECT * FROM dolores_acoes WHERE funcao LIKE 'tarefa_demorada%'"));
    expect(auditoria).not.toContain("123.456.789-01");
    expect(auditoria).not.toContain("relatório completo");
    expect(JSON.stringify(erros.mock.calls)).not.toContain("123.456.789-01");
    expect((await tarefas())[0].comando).toBeNull();
  });
});

describe("portão de QA — \"gera/prepara/monta um relatório\" é leitura; ação de verdade continua ação", () => {
  it("regra pura: só verbo + relatório/levantamento/resumo/lista, sem outro verbo de ação no resto", () => {
    for (const t of ["gera um relatório completo das obras", "Gere o relatório de financiamentos", "prepara um levantamento das medições",
      "prepare uma lista das obras atrasadas", "monta um resumo de tudo que está parado", "me faz um levantamento das obras", "Dolores, gera uma listagem dos clientes"])
      expect(ehPedidoDeRelatorio(t), t).toBe(true);
    for (const t of ["gera o PCI da obra da Ana", "gera um relatório e cria uma tarefa para a Bianca", "prepara a cobrança do João",
      "prepara um resumo da cobrança do João", "monta uma lista e lembra que a Ana atrasou", "registra um relatório no cliente",
      "cria uma lista de tarefas", "gera um relatório e agenda a visita", "gera um relatório e salva na pasta", "o relatório: gera e cria tarefas"])
      expect(ehPedidoDeRelatorio(t), t).toBe(false);
    // a lista de verbos de ação não mudou (a regra nova não afrouxa nada para ação)
    expect(intencaoDeAcao("gera o PCI da obra da Ana")).toBe(true);
    expect(intencaoDeAcao("gera um relatório completo das obras")).toBe(true);
  });

  it("\"gera um relatório completo de todas as obras\": só ferramentas de leitura desde a 1ª chamada e vira tarefa", async () => {
    await criarTarefa("gera um relatório completo de todas as obras e medições");
    for (const p of pedidosModelo) expect(p.ferramentas.map(f => (f as { name: string }).name).filter(n => NOMES_ACOES.has(n))).toEqual([]);
    expect(await tarefas()).toHaveLength(1);
    expect(respostasAoDono()).toEqual([FRASE_VOU_LEVANTAR]);
  });

  it("\"gera o PCI da obra\" (ação de verdade) continua com as ações e nunca vira tarefa", async () => {
    PASSO_MODELO_MS = 4_000;
    for (let i = 0; i < 6; i++) roteiro.push(() => ferramenta(["listar_obras", {}]));
    roteiro.push(() => texto("Consultei a obra."));
    await dono("gera o PCI da obra da Ana");
    expect(pedidosModelo[0].ferramentas.map(f => (f as { name: string }).name)).toContain("gerar_documento");
    expect(await tarefas()).toHaveLength(0);
  });

  it("todo resultado em segundo plano termina com o fecho fixo, mesmo quando o modelo afirma ter feito algo", async () => {
    await criarTarefa();
    roteiroRetomada("Pronto, já criei as tarefas e cobrei os clientes.");
    await situacaoDeEnvio();
    expect(respostasAoDono().at(-1)!.trimEnd().endsWith("Nada foi alterado no sistema.")).toBe(true);
  });
});

// ── Revisor do PR #298: a rede de segurança do cron garante a retomada (relógio simulado, sem aviso nenhum da Evolution) ─────────
describe("rede de segurança do cron — a tarefa nunca vence sem ter sido tentada", () => {
  const SEGREDO = "segredo-do-cron-de-teste";
  const cron = async (quando: string, qual: "manha" | "tarde") => {
    agora = new Date(quando);
    process.env.CRON_SECRET = SEGREDO;
    definirRelogioCron({ agora: () => agora, ms: () => relogioMs });
    try {
      const req = { headers: { authorization: `Bearer ${SEGREDO}` } } as never;
      return qual === "manha" ? await tratarCronDolores(req) : await tratarCronAvisos(req);
    } finally { delete process.env.CRON_SECRET; }
  };

  it("as horas da retomada são as dos crons que já existem (07h–19h), sem cron novo", () => {
    expect(HORAS_DA_RETOMADA).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as { crons: Array<{ path: string }> };
    expect(vercel.crons).toHaveLength(15);
    // 18:30 → 19h e, depois da noite, 07h do dia seguinte
    expect(proximosCrons(new Date("2026-11-16T21:30:00Z"), 2).map(d => d.toISOString())).toEqual(["2026-11-16T22:00:00.000Z", "2026-11-17T10:00:00.000Z"]);
  });

  it("07:05 sem aviso nenhum: não vence na manutenção do cron das 08:00 — é resolvida nele", async () => {
    agora = new Date("2026-11-16T10:05:00Z"); // 07:05 de Imperatriz
    await criarTarefa();
    expect(respostasAoDono()).toEqual([FRASE_VOU_LEVANTAR]);
    const [t] = await q<{ expira_em: Date; situacao: string }>("SELECT expira_em, situacao FROM dolores_tarefas_demoradas");
    expect(t.situacao).toBe("aguardando");
    expect(new Date(t.expira_em).toISOString()).toBe("2026-11-16T13:00:00.000Z"); // 2ª chamada (09h) + 1 h = 10:00 de Imperatriz
    roteiroRetomada();
    await cron("2026-11-16T11:00:30Z", "manha"); // o cron das 08:00
    expect((await tarefas())[0]).toMatchObject({ situacao: "concluida", tentativas: 1 });
    expect(respostasAoDono()).toHaveLength(2);
    expect(respostasAoDono()[1]).toMatch(/^Dolores: aqui está o levantamento que você pediu às 07:05\./);
    expect(respostasAoDono().join("\n")).not.toContain("não consegui terminar a tempo");
  });

  it("mesmo com o cron das 08:00 sem tentar (pausa geral), o das 09:00 ainda retoma (a validade cobre duas chamadas)", async () => {
    agora = new Date("2026-11-16T10:05:00Z");
    await criarTarefa();
    roteiroRetomada();
    await banco.pg.exec("UPDATE dolores_config SET pausada = true, motivo_pausa = 'teste' WHERE id = 1");
    await cron("2026-11-16T11:40:00Z", "manha"); // 08:40: pausada, não tenta
    expect((await tarefas())[0]).toMatchObject({ situacao: "aguardando", tentativas: 0 });
    await banco.pg.exec("UPDATE dolores_config SET pausada = false WHERE id = 1");
    await cron("2026-11-16T12:55:00Z", "manha"); // o das 09:00 saindo no fim da hora (Vercel)
    expect((await tarefas())[0]).toMatchObject({ situacao: "concluida", tentativas: 1 });
  });

  it("15h: o cron da tarde (só avisos) também retoma — antes não retomava", async () => {
    agora = new Date("2026-11-16T18:10:00Z"); // 15:10
    await criarTarefa();
    expect(respostasAoDono()).toEqual([FRASE_VOU_LEVANTAR]);
    roteiroRetomada();
    const r = await cron("2026-11-16T19:00:20Z", "tarde"); // o cron das 16:00
    expect(r.status).toBe(200);
    expect((await tarefas())[0]).toMatchObject({ situacao: "concluida", tentativas: 1 });
    expect(respostasAoDono()[1]).toMatch(/^Dolores: aqui está o levantamento que você pediu às 15:10\./);
  });

  it("noite (20:30): a tarefa é criada, a resposta diz que sai a partir das 7h, vale até a manhã e o cron das 07:00 resolve", async () => {
    agora = new Date("2026-11-16T23:30:00Z"); // 20:30
    await criarTarefa();
    expect(respostasAoDono()).toEqual([fraseVouLevantarForaDeHora(7)]);
    expect(respostasAoDono()[0]).toContain("a partir das 7h");
    expect(respostasAoDono()[0]).not.toContain("em seguida.");
    const [t] = await q<{ expira_em: Date }>("SELECT expira_em FROM dolores_tarefas_demoradas");
    expect(new Date(t.expira_em).toISOString()).toBe("2026-11-17T12:00:00.000Z"); // 2ª chamada da manhã (08h) + 1 h
    roteiroRetomada();
    await cron("2026-11-17T10:00:10Z", "manha"); // 07:00 do dia seguinte
    expect((await tarefas())[0]).toMatchObject({ situacao: "concluida", tentativas: 1 });
    expect(respostasAoDono()[1]).toMatch(/^Dolores: aqui está o levantamento que você pediu às 20:30\./);
  });

  it("18:30: o próximo cron (19h) está perto — \"em seguida\"; se ele não tentar, a validade chega até a manhã", async () => {
    agora = new Date("2026-11-16T21:30:00Z");
    await criarTarefa();
    expect(respostasAoDono()).toEqual([FRASE_VOU_LEVANTAR]);
    const [t] = await q<{ expira_em: Date }>("SELECT expira_em FROM dolores_tarefas_demoradas");
    expect(new Date(t.expira_em).toISOString()).toBe("2026-11-17T11:00:00.000Z"); // 07h + 1 h
  });

  it("na 1ª tentativa a validade passa a contar dela (nunca encurta): parada no meio, a 2ª tentativa ainda cabe", async () => {
    agora = new Date("2026-11-16T10:05:00Z");
    await criarTarefa();
    // a 1ª tentativa falha às 09:50 (a IA não responde) e volta à fila: a validade de 10:00 vira 10:20
    roteiro.push(() => { throw new Error("a IA não respondeu"); });
    await cron("2026-11-16T12:50:00Z", "manha");
    const [t1] = await q<{ expira_em: Date; tentativas: number; situacao: string }>("SELECT expira_em, tentativas, situacao FROM dolores_tarefas_demoradas");
    expect(t1.tentativas).toBe(1);
    expect(new Date(t1.expira_em).getTime()).toBe(new Date("2026-11-16T12:50:00Z").getTime() + VALIDADE_TAREFA_MS);
    expect(t1.situacao).toBe("aguardando");
    // 10:10 — já passou da validade sem tentativa (10:00), mas a da tentativa (10:20) ainda vale
    roteiroRetomada();
    await cron("2026-11-16T13:10:00Z", "manha");
    expect((await tarefas())[0]).toMatchObject({ situacao: "concluida", tentativas: 2 });
  });
});
