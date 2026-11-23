// EPIC-029 S-6 — a Dolores avisa o dono quando a receita do ano de uma empresa chega perto do limite do regime dela, e responde na conversa
// direta dele ("quanto falta para estourar o Simples na Prospecta?"). Regras: tipo novo dos avisos, nasce SILENCIADO; 70/85/95/100%, cada
// faixa UMA vez por empresa, limite e ano (sem reaviso); só ao número do dono; texto natural sem comandos; leitura só na conversa do dono.
// Banco em memória (PGlite) + webhook de verdade (modelo e envio falsos, sem rede).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));

import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { SILENCIADOS_POR_PADRAO, TIPOS_AVISO, textoDaIAValido } from "../../shared/dolores/avisos.js";
import { lerConfirmacao } from "../../shared/dolores/confirmacao.js";
import { definirClienteModelo, type PedidoModelo, type RespostaModelo } from "./cerebro.js";
import { definirSorteioCodigo } from "./aprovacoes.js";
import { definirDependenciasAvisos, definirSilencio, executarAvisos, tiposSilenciados } from "./avisos.js";
import { LEITURAS_DO_DONO } from "./funcoes.js";
import { funcaoLiberada } from "./permissoes.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte, executarFuncao } from "./ponte.js";
import { CENARIO, criarBanco } from "./testes-banco.js";
import { definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";

const DONO = "5599991234567";
const SEG_9H = new Date("2026-11-16T12:00:00Z"); // segunda, 09:00 de Brasília
const M0164 = readFileSync(new URL("../../drizzle/0164_contas_empresa_limite_receita.sql", import.meta.url), "utf8");
const TAX = `CREATE TABLE IF NOT EXISTS "tax_profiles" ("id" serial PRIMARY KEY, "company_name" varchar(255) NOT NULL, "cnpj" varchar(20), "regime" varchar(40) NOT NULL,
  "estimated_rate" numeric(7,4) DEFAULT '0' NOT NULL, "effective_from" timestamp NOT NULL, "effective_to" timestamp, "notes" text, "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL, "updated_at" timestamp DEFAULT now() NOT NULL)`;
let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviar: ReturnType<typeof vi.fn>;
let agora: Date;
let pedidosModelo: PedidoModelo[];
let roteiro: Array<(p: PedidoModelo) => RespostaModelo>;
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
const mensagens = () => enviar.mock.calls.map(c => c[0] as { numero: string; texto: string });
const rodar = (quando: Date) => { agora = quando; return executarAvisos({ agora: quando }); };
let seq = 0;
let tx = 0;
const ts = (t: string) => Math.floor((agora.getTime() + (lerConfirmacao(t) ? 1_000 : -5_000)) / 1000);
const doDono = (texto: string) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, ip: "203.0.113.9",
  body: { event: "messages.upsert", instance: "prospecta-dolores", data: { key: { remoteJid: `${DONO}@s.whatsapp.net`, fromMe: false, id: `S6M${++seq}` }, message: { conversation: texto }, messageTimestamp: ts(texto) } } } as never);
const usoModelo = { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const ferramenta = (name: string, input: unknown): RespostaModelo => ({ stop_reason: "tool_use", usage: usoModelo, content: [{ type: "tool_use", id: `tu_${name}_${++seq}`, name, input }] });
const textoModelo = (t: string): RespostaModelo => ({ stop_reason: "end_turn", usage: usoModelo, content: [{ type: "text", text: t }] });

/** Conta da empresa (CNPJ) e entradas pagas nela (lançamento ligado à movimentação, como o extrato faz). */
async function conta(cnpj: string | null, apelido: string) {
  const [c] = await q<{ id: number }>(`INSERT INTO bank_accounts (banco, conta, apelido, empresa_cnpj) VALUES ('Cora', '98765-4', '${apelido}', ${cnpj ? `'${cnpj}'` : "NULL"}) RETURNING id`);
  return c!.id;
}
async function entrada(contaId: number, reais: number, dia = "2026-10-10") {
  const [t] = await q<{ id: number }>(`INSERT INTO bank_transactions (account_id, data, descricao, valor, tipo, external_id)
    VALUES (${contaId}, '${dia}T12:00:00Z', 'PIX recebido', ${reais}, 'credito', 's6-${++tx}') RETURNING id`);
  await q(`INSERT INTO bpo_lancamentos (tipo, descricao, valor, vencimento, pago, pago_em, competencia, bank_transaction_id)
    VALUES ('receita', 'Recebimento de cliente', ${reais}, '${dia}T12:00:00Z', true, '${dia}T12:00:00Z', '${dia.slice(0, 7)}', ${t!.id})`);
}

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(TAX);
  await banco.pg.exec(M0164);
  await banco.pg.exec(M0164);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}',
    limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;`);
  await banco.pg.exec(`INSERT INTO tax_profiles (company_name, cnpj, regime, effective_from) VALUES
    ('Prospecta Construções', '41.865.900/0001-89', 'simples_nacional', '2021-05-07'),
    ('VFX Capital', '58121993000100', 'lucro_real', '2025-01-01'),
    ('Efficaz LTDA', '21704736000110', 'lucro_presumido', '2020-01-01')`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-s6-0123456789";
  esquecerUsuarioDolores();
  agora = new Date(SEG_9H);
  definirDependenciasPonte({ agora: () => agora });
  enviar = vi.fn(async () => true);
  definirDependenciasWhatsapp({ agora: () => agora, enviar: enviar as never });
  let sorteio = 0;
  definirSorteioCodigo(() => ((sorteio++ * 5) % 22) / 22 + 0.001);
  vi.mocked(configuracaoAnthropicPainel).mockResolvedValue({ apiKey: "sk-ant-chave-de-teste-nao-real-123456", modelo: "modelo-do-painel" });
  pedidosModelo = [];
  roteiro = [];
  definirClienteModelo(async p => {
    pedidosModelo.push(JSON.parse(JSON.stringify(p)));
    const passo = roteiro.shift();
    if (!passo) throw new Error("roteiro do modelo acabou");
    return passo(p);
  });
});
afterEach(() => {
  ENV.cookieSecret = segredoAntes;
  definirDependenciasPonte(); definirDependenciasWhatsapp(); definirClienteModelo(); definirSorteioCodigo(); definirDependenciasAvisos();
  vi.restoreAllMocks();
});

/** Avisos ligados, só o tipo do limite de receita ativo (isola dos achados do cenário). */
async function soOLimite() {
  await banco.pg.exec("UPDATE dolores_avisos_config SET ligado = true WHERE id = 1");
  for (const t of TIPOS_AVISO) if (t !== "limite_receita") await definirSilencio({ tipo: t, silenciado: true, porUserId: null, via: "tela" });
  await definirSilencio({ tipo: "limite_receita", silenciado: false, porUserId: null, via: "tela" });
}

describe("S-6 — aviso de limite de receita", () => {
  it("nasce silenciado: com os avisos ligados e a empresa a 80% do teto, nada sai até o dono religar o tipo", async () => {
    expect(SILENCIADOS_POR_PADRAO).toContain("limite_receita");
    expect(await tiposSilenciados()).toContain("limite_receita");
    const c = await conta("41865900000189", "Cora obras");
    await entrada(c, 3_850_000);
    await banco.pg.exec("UPDATE dolores_avisos_config SET ligado = true WHERE id = 1");
    for (const t of TIPOS_AVISO) if (t !== "limite_receita") await definirSilencio({ tipo: t, silenciado: true, porUserId: null, via: "tela" });
    expect((await rodar(SEG_9H)).r).toBe("nada-novo");
    expect(mensagens()).toHaveLength(0);
    expect(await q("SELECT count(*)::int AS n FROM dolores_avisos_achados WHERE tipo = 'limite_receita'")).toEqual([{ n: 0 }]);
  });

  it("cada faixa sai UMA vez por empresa e limite (sem reaviso); só ao dono; texto natural, sem CNPJ, sem número de conta, sem comando", async () => {
    await soOLimite();
    const c1 = await conta("41865900000189", "Cora obras");
    const c2 = await conta("41865900000189", "Inter");
    await entrada(c1, 2_000_000);
    await entrada(c2, 1_400_000); // 3,4 mi: ME 100% (informativo), sublimite 94,4% → faixa 85, teto 70,8% → faixa 70
    const r1 = await rodar(SEG_9H);
    expect(r1.r, JSON.stringify(r1)).toBe("enviado");
    expect(mensagens().map(m => m.numero)).toEqual([DONO]);
    const t1 = mensagens()[0]!.texto;
    expect(t1).toMatch(/Prospecta Construções/);
    expect(t1).toMatch(/sublimite do Simples/);
    expect(t1).toMatch(/teto do Simples/);
    expect(t1).toMatch(/contador/);
    expect(t1).not.toMatch(/41\.?865|98765|confirmo|\bpode\b/i);
    expect(textoDaIAValido(t1)).not.toBeNull(); // passa a mesma conferência de "sem pedido de confirmação"
    expect(await q("SELECT chave, faixa, faixa_avisada FROM dolores_avisos_achados WHERE tipo = 'limite_receita' ORDER BY chave")).toEqual([
      { chave: "limite_receita:empresa:41865900:2026:me", faixa: 100, faixa_avisada: 100 },
      { chave: "limite_receita:empresa:41865900:2026:sublimite", faixa: 85, faixa_avisada: 85 },
      { chave: "limite_receita:empresa:41865900:2026:teto_simples", faixa: 70, faixa_avisada: 70 },
    ]);
    // dias depois (além do reaviso de 7 dias), mesma faixa: nada
    expect((await rodar(new Date("2026-11-25T12:00:00Z"))).r).toBe("nada-novo");
    expect(mensagens()).toHaveLength(1);
    // um estorno de fora baixa a receita e depois ela volta: a faixa já avisada não volta
    await banco.pg.exec("UPDATE bpo_lancamentos SET pago = false WHERE valor = 1400000");
    expect((await rodar(new Date("2026-11-26T12:00:00Z"))).r).toBe("nada-novo");
    await banco.pg.exec("UPDATE bpo_lancamentos SET pago = true WHERE valor = 1400000");
    expect((await rodar(new Date("2026-11-27T12:00:00Z"))).r).toBe("nada-novo");
    // sobe para 95% do sublimite: só o que subiu de faixa sai
    await entrada(c1, 50_000, "2026-11-20");
    expect((await rodar(new Date("2026-11-28T12:00:00Z"))).r).toBe("enviado");
    const t2 = mensagens()[1]!.texto;
    expect(t2).toMatch(/95,8% do sublimite/);
    expect(t2).not.toMatch(/teto do Simples/);
  });

  it("Presumido avisa no limite de R$ 78 mi; Real nunca; conta sem empresa e empresa 'a confirmar' não geram aviso", async () => {
    await soOLimite();
    await banco.pg.exec("INSERT INTO tax_profiles (company_name, cnpj, regime, effective_from) VALUES ('Eficaz', '39740145000164', 'a_confirmar', '2024-01-01')");
    await entrada(await conta("21704736000110", "Efficaz BB"), 56_000_000); // 71,8% de 78 mi
    await entrada(await conta("58121993000100", "VFX Itaú"), 200_000_000);
    await entrada(await conta("39740145000164", "Eficaz C6"), 9_000_000);
    await entrada(await conta(null, "Solta"), 5_000_000);
    expect((await rodar(SEG_9H)).r).toBe("enviado");
    expect(await q("SELECT chave, faixa FROM dolores_avisos_achados WHERE tipo = 'limite_receita'")).toEqual([
      { chave: "limite_receita:empresa:21704736:2026:presumido", faixa: 70 }]);
    expect(mensagens()[0]!.texto).toMatch(/Efficaz LTDA.*71,7% do limite do Lucro Presumido/s);
  });

  it("virada do ano: o achado do ano anterior fica resolvido e o ano novo começa do zero", async () => {
    await soOLimite();
    await entrada(await conta("41865900000189", "Cora"), 300_000, "2026-06-10"); // 83% da ME
    expect((await rodar(SEG_9H)).r).toBe("enviado");
    await rodar(new Date("2027-01-04T12:00:00Z"));
    expect(await q("SELECT chave, resolvido_em IS NOT NULL AS resolvido FROM dolores_avisos_achados WHERE tipo = 'limite_receita'")).toEqual([
      { chave: "limite_receita:empresa:41865900:2026:me", resolvido: true }]);
  });
});

describe("S-6 — a Dolores responde na conversa do dono (leitura só dele)", () => {
  it("liberada, marcada só do dono, fora da ponte HTTP e dos grupos (403)", async () => {
    expect(funcaoLiberada("consultar_limites_receita")).toBe(true);
    expect(LEITURAS_DO_DONO.find(f => f.nome === "consultar_limites_receita")).toMatchObject({ soConversaDoDono: true, contamina: true });
    for (const opcoes of [{ canal: "ponte" }, { canal: "grupo", mensagemId: 1 }, { canal: "cliente", mensagemId: 1 }, { canal: "whatsapp" }]) {
      const r = await executarFuncao({ funcao: "consultar_limites_receita", argumentos: {} }, opcoes as never);
      expect(r.status, opcoes.canal).toBe(403);
      expect(JSON.stringify(r.body)).not.toMatch(/Prospecta Construções/);
    }
  });

  it("\"quanto falta para estourar o Simples na Prospecta?\": o modelo consulta e recebe os números da empresa, sem número de conta", async () => {
    await banco.pg.exec("UPDATE dolores_whatsapp_config SET ia_ligada = true");
    const c = await conta("41865900000189", "Cora obras");
    await entrada(c, 1_200_000);
    roteiro.push(() => ferramenta("consultar_limites_receita", { empresa: "Prospecta" }));
    roteiro.push(() => textoModelo("Pela receita registrada, faltam R$ 3,6 milhões para o teto do Simples. A apuração oficial é do contador."));
    await doDono("quanto falta para estourar o Simples na Prospecta?");
    expect(pedidosModelo).toHaveLength(2);
    expect((pedidosModelo[0]!.ferramentas as Array<{ name: string }>).map(f => f.name)).toContain("consultar_limites_receita");
    const resultado = JSON.stringify(pedidosModelo[1]!.mensagens);
    expect(resultado).toMatch(/Prospecta Construções/);
    expect(resultado).toMatch(/R\$\s?3\.600\.000,00/); // falta para o teto: 4,8 mi − 1,2 mi
    expect(resultado).toMatch(/Simples Nacional/);
    expect(resultado).toMatch(/contador/);
    expect(resultado).not.toMatch(/98765/);
    expect(mensagens().map(m => m.numero)).toEqual([DONO]);
    expect(mensagens()[0]!.texto).toMatch(/teto do Simples/);
  });
});
