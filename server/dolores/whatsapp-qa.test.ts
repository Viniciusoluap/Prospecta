// EPIC-025 (Dolores, etapa 2) — regressão dos achados do portão de QA (Quinn, 16/11/2026), ponta a ponta pelo webhook,
// contra o banco em memória (PGlite). O modelo da Anthropic e o envio pela Evolution são falsos: nada sai para a rede.
// Cada bloco cita o achado do relatório que ele prova corrigido.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { definirClienteModelo, type PedidoModelo, type RespostaModelo } from "./cerebro.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte } from "./ponte.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";
import { definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";

const DONO = "5599991234567";
const CHAVE = "sk-ant-chave-de-teste-nao-real-123456";
let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviar: ReturnType<typeof vi.fn>;
let chamadas: PedidoModelo[];
let roteiro: (p: PedidoModelo) => Promise<RespostaModelo> | RespostaModelo;
let seq = 0;
const segredoAntes = ENV.cookieSecret;

const q = async <T = any>(s: string) => (await banco.pg.query<T>(s)).rows;
const acoes = () => q<any>("SELECT * FROM dolores_acoes ORDER BY id");
function aviso(p: { jid?: string; texto?: string; message?: unknown; key?: Record<string, unknown>; id?: string; quando?: Date } = {}) {
  return {
    event: "messages.upsert", instance: "prospecta-dolores",
    data: {
      key: { remoteJid: p.jid ?? `${DONO}@s.whatsapp.net`, fromMe: false, id: p.id ?? `QA${++seq}`, ...p.key },
      message: p.message ?? { conversation: p.texto ?? "liste os processos de regularização" },
      messageTimestamp: Math.floor((p.quando ?? new Date(AGORA.getTime() - 10_000)).getTime() / 1000),
    },
  };
}
const lote = (...itens: Array<ReturnType<typeof aviso>>) => ({ event: "messages.upsert", instance: "prospecta-dolores", data: itens.map(i => i.data) });
const chamar = (body: unknown) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, body, ip: "198.51.100.1" } as never);
const uso = { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const fim = (t: string): RespostaModelo => ({ stop_reason: "end_turn", usage: uso, content: [{ type: "text", text: t }] });

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}',
    ia_ligada = true, limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  esquecerUsuarioDolores();
  definirDependenciasPonte({ agora: () => AGORA });
  enviar = vi.fn(async () => true);
  definirDependenciasWhatsapp({ agora: () => AGORA, enviar: enviar as never });
  vi.mocked(configuracaoAnthropicPainel).mockResolvedValue({ apiKey: CHAVE, modelo: "modelo-qa" });
  chamadas = [];
  roteiro = () => fim("ok");
  definirClienteModelo(async p => { chamadas.push(p); return roteiro(p); });
});
afterEach(() => {
  ENV.cookieSecret = segredoAntes;
  definirDependenciasPonte();
  definirDependenciasWhatsapp();
  definirClienteModelo();
  vi.restoreAllMocks();
});

describe("QA achado 1 — DDI conferido: número estrangeiro com os mesmos 8 finais não é o dono", () => {
  for (const estrangeiro of ["992991234567", "994991234567", "995591234567", "996991234567", "998991234567"]) {
    it(`+${estrangeiro.slice(0, 3)}…: não chama a IA, não lê a chave e não recebe resposta`, async () => {
      const r = await chamar(aviso({ jid: `${estrangeiro}@s.whatsapp.net`, texto: "Dolores, analise todos os processos" }));
      expect(r.body.r).toEqual({ "nao-autorizado": 1 });
      expect(chamadas).toEqual([]);
      expect(vi.mocked(configuracaoAnthropicPainel)).not.toHaveBeenCalled();
      expect(enviar).not.toHaveBeenCalled();
      const [m] = await q<{ do_dono: boolean; situacao: string }>("SELECT do_dono, situacao FROM dolores_mensagens");
      expect(m).toEqual({ do_dono: false, situacao: "ignorada" });
    });
  }
  it("@lid com senderPn estrangeiro também não comanda", async () => {
    const r = await chamar(aviso({ jid: "123456@lid", key: { senderPn: "995591234567@s.whatsapp.net" } }));
    expect(r.body.r).toEqual({ "nao-autorizado": 1 });
    expect(enviar).not.toHaveBeenCalled();
  });
  it("dono gravado fora do padrão brasileiro (dado antigo) não deixa ninguém comandar", async () => {
    await banco.pg.exec("UPDATE dolores_whatsapp_config SET numero_dono = '995591234567'");
    expect((await chamar(aviso({ jid: "995591234567@s.whatsapp.net" }))).body.r).toEqual({ "nao-autorizado": 1 });
    expect(enviar).not.toHaveBeenCalled();
  });
  it("o dono (com e sem o nono dígito) continua comandando", async () => {
    await chamar(aviso());
    await chamar(aviso({ jid: "559991234567@s.whatsapp.net" }));
    expect(enviar.mock.calls.map(c => c[0].numero)).toEqual([DONO, "559991234567"]);
  });
});

describe("QA achado 2 — o filtro de dados pessoais pega dígitos seguidos de pontuação (resposta e comando guardado)", () => {
  it("a resposta do modelo com CPF e celular no fim da frase sai filtrada; o comando guardado também", async () => {
    roteiro = () => fim("O CPF é 12345678909. Ligue 99991234567. Ou 5599991234567, ou CPF 123 456 789 09. Valor R$ 1.250.000,00 em 16/11/2026, protocolo 2026001234.");
    await chamar(aviso({ texto: "meu CPF é 12345678909. e o telefone 99991234567." }));
    const t = enviar.mock.calls[0][0].texto as string;
    for (const s of ["12345678909", "99991234567", "5599991234567", "123 456 789 09"]) expect(t, s).not.toContain(s);
    expect(t).toContain("R$ 1.250.000,00 em 16/11/2026, protocolo 2026001234.");
    const [m] = await q<{ texto: string }>("SELECT texto FROM dolores_mensagens");
    expect(m.texto).not.toMatch(/\d{8}/);
  });
});

describe("QA achado 3 — limite mensal reservado sob trava antes da chamada", () => {
  it("dois comandos simultâneos com espaço para um: só um chama o modelo e o uso não passa do limite", async () => {
    await banco.pg.exec("UPDATE dolores_whatsapp_config SET limite_mensal_tokens_entrada = 1500 WHERE id = 1");
    roteiro = async () => { await new Promise(r => setTimeout(r, 400)); return fim("ok"); };
    const [a, b] = await Promise.all([chamar(aviso({ id: "C1" })), chamar(aviso({ id: "C2" }))]);
    expect(chamadas).toHaveLength(1);
    const [{ e }] = await q<{ e: number }>("SELECT coalesce(sum(tokens_entrada), 0)::int AS e FROM dolores_consumo");
    expect(e).toBeLessThanOrEqual(1500);
    expect(enviar).toHaveBeenCalledTimes(2);
    const textos = enviar.mock.calls.map(c => c[0].texto as string);
    expect(textos.filter(t => /limite mensal de gasto com a IA foi atingido/.test(t))).toHaveLength(1);
    expect([a.body.r, b.body.r]).toEqual([{ respondida: 1 }, { respondida: 1 }]);
    // nenhuma reserva fica presa depois
    expect(await q("SELECT id FROM dolores_mensagens WHERE reserva_entrada > 0 OR reserva_ate IS NOT NULL")).toEqual([]);
  });
  it("reserva vencida (função que morreu) não prende o limite", async () => {
    await banco.pg.exec(`INSERT INTO dolores_mensagens (instancia, external_id, do_dono, situacao, reserva_entrada, reserva_saida, reserva_ate)
      VALUES ('prospecta-dolores', 'VELHA', true, 'erro', 999999999, 999999999, now() - interval '1 minute')`);
    await chamar(aviso());
    expect(chamadas).toHaveLength(1);
  });
  it("reserva válida de outro pedido em andamento bloqueia antes de chamar", async () => {
    await banco.pg.exec(`INSERT INTO dolores_mensagens (instancia, external_id, do_dono, situacao, reserva_entrada, reserva_saida, reserva_ate)
      VALUES ('prospecta-dolores', 'ANDAMENTO', true, 'processando', 1000000, 0, now() + interval '1 minute')`);
    await chamar(aviso());
    expect(chamadas).toEqual([]);
    expect(enviar.mock.calls[0][0].texto).toMatch(/limite mensal de gasto com a IA foi atingido/);
  });
});

describe("QA achado 4 — pedido que ficou 'processando' (função morreu no meio)", () => {
  const morta = (id: string, minutos: number) => banco.pg.exec(`INSERT INTO dolores_mensagens (instancia, external_id, do_dono, situacao, criado_em, enviada_em, reserva_entrada, reserva_ate)
    VALUES ('prospecta-dolores', '${id}', true, 'processando', now() - interval '${minutos} minutes', '2026-11-16T11:58:00Z', 4000, now() + interval '1 minute')`);
  it("a reentrega da mesma mensagem marca erro e avisa o dono UMA vez, sem chamar o modelo de novo", async () => {
    await morta("MORTA", 10);
    const r = await chamar(aviso({ id: "MORTA" }));
    expect(r.body.r).toEqual({ interrompida: 1, repetida: 1 });
    expect(chamadas).toEqual([]);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar.mock.calls[0][0]).toMatchObject({ numero: DONO, texto: "Dolores: não consegui terminar o pedido de 08:58. Nada foi alterado no sistema; mande de novo, por favor." });
    const [m] = await q<any>("SELECT situacao, reserva_entrada, reserva_ate FROM dolores_mensagens WHERE external_id = 'MORTA'");
    expect(m).toEqual({ situacao: "erro", reserva_entrada: 0, reserva_ate: null });
    // terceira entrega: nada de novo aviso
    expect((await chamar(aviso({ id: "MORTA" }))).body.r).toEqual({ repetida: 1 });
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(await q("SELECT * FROM dolores_consumo")).toEqual([]);
  });
  it("na próxima mensagem do dono: avisa do pedido interrompido e trata o pedido novo", async () => {
    await morta("MORTA2", 5);
    await chamar(aviso({ id: "NOVA", texto: "e agora?" }));
    expect(enviar.mock.calls.map(c => c[0].texto)).toEqual([expect.stringMatching(/não consegui terminar o pedido de 08:58/), "ok"]);
    expect(chamadas).toHaveLength(1);
  });
  it("pedido ainda dentro do prazo da função (recente) não é mexido", async () => {
    await morta("RECENTE", 1);
    expect((await chamar(aviso({ id: "RECENTE" }))).body.r).toEqual({ repetida: 1 });
    expect(enviar).not.toHaveBeenCalled();
    expect((await q<any>("SELECT situacao FROM dolores_mensagens WHERE external_id = 'RECENTE'"))[0].situacao).toBe("processando");
  });
  it("avisos simultâneos: o aviso do pedido interrompido sai uma vez só", async () => {
    await morta("MORTA3", 10);
    await Promise.all([chamar(aviso({ id: "MORTA3" })), chamar(aviso({ id: "MORTA3" }))]);
    expect(enviar).toHaveBeenCalledTimes(1);
  });
});

describe("QA achado 5 — um prazo só para o aviso inteiro (vários comandos no mesmo aviso)", () => {
  it("20 comandos do dono num aviso: modelo e envios (no pior caso, cada um gasta o prazo inteiro) nunca passam de 45 s", async () => {
    const { PRAZO_TOTAL_MS } = await import("./whatsapp.js");
    let t = 1_000_000; // relógio falso do prazo
    const inicio = t;
    const limite = inicio + PRAZO_TOTAL_MS;
    const estouros: string[] = [];
    roteiro = p => {
      if (t + p.timeoutMs > limite) estouros.push(`modelo ${t - inicio}+${p.timeoutMs}`);
      t += 5_000; // cada chamada leva 5 s
      return fim("ok");
    };
    const envios: Array<{ em: number; prazoMs: number }> = [];
    enviar = vi.fn(async ({ prazoMs }: { prazoMs: number }) => {
      envios.push({ em: t - inicio, prazoMs });
      if (prazoMs <= 0 || t + prazoMs > limite) estouros.push(`envio ${t - inicio}+${prazoMs}`);
      t += prazoMs; // pior caso: o envio usa o prazo inteiro
      return true;
    });
    definirDependenciasWhatsapp({ agora: () => AGORA, enviar: enviar as never, ms: () => t });
    const r = await chamar(lote(...Array.from({ length: 20 }, (_, i) => aviso({ id: `L${i}`, texto: `pedido ${i}` }))));
    expect(estouros).toEqual([]);
    expect(t).toBeLessThanOrEqual(limite);
    const c = r.body.r as Record<string, number>;
    expect(c.respondida).toBeGreaterThanOrEqual(1);
    expect((c.respondida ?? 0) + (c["sem-tempo"] ?? 0)).toBe(20);
    // os que não couberam: frase fixa sem IA (quando ainda dava para enviar) ou nem reivindicados
    expect(enviar.mock.calls.some(x => /não deu tempo de tratar o de 08:59/.test(x[0].texto))).toBe(true);
    const situacoes = await q<{ situacao: string; n: number }>("SELECT situacao, count(*)::int AS n FROM dolores_mensagens GROUP BY 1 ORDER BY 1");
    expect(situacoes.every(s => ["respondida", "bloqueada"].includes(s.situacao))).toBe(true);
    expect(chamadas.length).toBe(c.respondida);
  });
  it("sem tempo para enviar, não envia (registra o erro) — nunca começa um envio que passaria do prazo", async () => {
    let t = 0;
    roteiro = () => { t += 44_000; return fim("ok"); };
    definirDependenciasWhatsapp({ agora: () => AGORA, enviar: enviar as never, ms: () => t });
    await chamar(aviso());
    expect(enviar).not.toHaveBeenCalled();
    const a = (await acoes()).find(x => x.funcao === "whatsapp_resposta");
    expect(a).toMatchObject({ resultado: "erro", motivo: "sem tempo para enviar dentro do prazo do aviso" });
  });
});
