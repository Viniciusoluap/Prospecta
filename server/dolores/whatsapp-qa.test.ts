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
