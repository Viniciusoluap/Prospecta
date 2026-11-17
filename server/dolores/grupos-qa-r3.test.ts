// EPIC-025 (Dolores, etapa 4) — regressões da 3ª rodada do portão de QA (Quinn, 17/11/2026). Cada teste é a versão
// INVERTIDA de um ataque de `qa-dolores-e4-r3/ataques-r3.test.ts` (blocos R3-C e R3-D) ou do resíduo do N6: passa quando o
// defeito NÃO existe. PGlite; nada sai para a rede (o SDK da Anthropic é simulado neste arquivo).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));
vi.mock("../drive-documents.js", async orig => ({
  ...(await orig<typeof import("../drive-documents.js")>()),
  driveConfigured: vi.fn(async () => true),
  uploadPrivateDocument: vi.fn(async () => "drive-novo-1"),
  comPrazoNoDrive: vi.fn((_ms: number, fn: () => Promise<unknown>) => fn()),
  enviarParaLixeira: vi.fn(async () => undefined),
}));
vi.mock("../drive-organizacao.js", async orig => ({
  ...(await orig<typeof import("../drive-organizacao.js")>()),
  arquivosDoLeadNoDrive: vi.fn(async () => []),
  lixeiraDoLead: vi.fn(async () => undefined),
  lixeiraDaEntidade: vi.fn(async () => undefined),
  lixeiraDoArquivo: vi.fn(async () => undefined),
  lixeiraDoProjeto: vi.fn(async () => undefined),
}));
// o SDK da Anthropic simulado: registra o que a contagem prévia e a chamada receberam (nada sai para a rede)
const sdk = vi.hoisted(() => ({
  contagens: [] as any[], criacoes: [] as any[], chaves: [] as string[],
  contar: async (_b: any): Promise<{ input_tokens: number }> => ({ input_tokens: 1_200 }),
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages: any;
    constructor(o: { apiKey: string }) {
      sdk.chaves.push(o.apiKey);
      this.messages = {
        countTokens: async (b: any) => { sdk.contagens.push(JSON.parse(JSON.stringify(b))); return sdk.contar(b); },
        create: async (b: any) => {
          sdk.criacoes.push(JSON.parse(JSON.stringify(b)));
          return { stop_reason: "tool_use", usage: { input_tokens: 1_200, output_tokens: 30 },
            content: [{ type: "tool_use", name: "registrar_classificacao", input: { tipo: "rg", confianca: 0.9, motivo: "documento com foto" } }] };
        },
      };
    }
  },
}));
// o getDb interno de server/db.ts (deleteUser e outras rotas antigas) também cai no PGlite
const atual = vi.hoisted(() => ({ db: null as any }));
vi.mock("drizzle-orm/neon-http", async orig => ({
  ...(await orig<any>()),
  drizzle: () => new Proxy({}, { get: (_t, k) => { const v = atual.db[k]; return typeof v === "function" ? v.bind(atual.db) : v; }, set: () => true }),
}));
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://u:p@127.0.0.1:1/qa";

import { readFileSync } from "node:fs";
import { FERRAMENTA_CLASSIFICACAO } from "../../shared/dolores/grupos.js";
import { bloqueioDoLimite } from "../../shared/dolores/whatsapp.js";
import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { uploadPrivateDocument } from "../drive-documents.js";
import { appRouter } from "../routers.js";
import { decidir, decisorDaTela, definirSorteioCodigo } from "./aprovacoes.js";
import { definirClienteModelo } from "./cerebro.js";
import { clienteIndicadoNoTexto } from "./acoes/grupos.js";
import {
  FUNCAO_DESLIGAMENTO_POR_FALHA, MOTIVO_DESLIGAMENTO_POR_FALHA, classificacaoPausadaPorFalha, classificarPendentes, definirDependenciasClassificacao,
  limparPausaPorFalhaNoConsumo, type ContadorClassificacao, type PedidoClassificacao, type RespostaClassificacao,
} from "./classificacao.js";
import { liberarReserva, reservarChamada } from "./consumo.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte, executarFuncao } from "./ponte.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";
import { credencialDaClassificacao, definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";

const DONO = "5599991234567";
const CLIENTE = "5599977776666";
const GRUPO = "120363111111111111@g.us";
const LIMITE = { entrada: 1_000_000, saida: 100_000 };
let banco: Awaited<ReturnType<typeof criarBanco>>;
let pedidosIa: PedidoClassificacao[];
let respostaIa: (p: PedidoClassificacao) => RespostaClassificacao | Promise<RespostaClassificacao>;
let baixar: ReturnType<typeof vi.fn>;
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
const mensagens = () => q("SELECT * FROM dolores_grupo_mensagens ORDER BY id");
const usoTotal = async () => (await q("SELECT coalesce(sum(tokens_entrada + tokens_cache_escrita + tokens_cache_leitura),0)::int e, coalesce(sum(tokens_saida),0)::int s FROM dolores_consumo"))[0];

const ehToolUse = (input: unknown, entrada = 1500): RespostaClassificacao => ({
  stop_reason: "tool_use", usage: { input_tokens: entrada, output_tokens: 40 },
  content: [{ type: "tool_use", name: FERRAMENTA_CLASSIFICACAO.name, input }],
});

/** PDF clássico de `n` páginas (tabela xref, /Kids com referências diretas). */
function pdfClassico(n: number): Buffer {
  const objs: string[] = [`<< /Type /Catalog /Pages 2 0 R >>`, `<< /Type /Pages /Kids [${Array.from({ length: n }, (_, i) => `${i + 3} 0 R`).join(" ")}] /Count ${n} >>`];
  for (let i = 0; i < n; i++) objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${n + 3} 0 R >>`);
  const texto = "BT /F1 12 Tf 72 720 Td (ola) Tj ET";
  objs.push(`<< /Length ${texto.length} >>\nstream\n${texto}\nendstream`);
  let corpo = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(corpo, "latin1")); corpo += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(corpo, "latin1");
  corpo += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  corpo += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(corpo, "latin1");
}

let seq = 0;
function item(p: { jid?: string; de?: string; texto?: string; message?: unknown; id?: string }) {
  return {
    key: { remoteJid: p.jid ?? GRUPO, fromMe: false, id: p.id ?? `QAR3${++seq}`, participant: `${p.de ?? CLIENTE}@s.whatsapp.net` },
    message: p.message ?? { conversation: p.texto ?? "Bom dia" },
    messageTimestamp: Math.floor((AGORA.getTime() - 30_000) / 1000),
  };
}
const documento = (nome = "rg.pdf", legenda = "meu RG") => ({ documentMessage: { mimetype: "application/pdf", fileName: nome, fileLength: 2048, caption: legenda } });
const aviso = (...itens: unknown[]) => ({ event: "messages.upsert", instance: "prospecta-dolores", data: itens.length === 1 ? itens[0] : itens });
const chamar = (body: unknown) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, body, ip: "203.0.113.9" } as never);
/** Modelo falso que registra o pedido; `contar` é a contagem prévia falsa. */
const usarModelo = (contar?: ContadorClassificacao) => definirDependenciasClassificacao({
  cliente: async p => { pedidosIa.push(JSON.parse(JSON.stringify(p))); return respostaIa(p); }, baixar: baixar as never, contar,
});

beforeEach(async () => {
  banco = await criarBanco();
  const comBatch = Object.assign(Object.create(Object.getPrototypeOf(banco.db)), banco.db, { batch: async (qs: any[]) => { const r = []; for (const x of qs) r.push(await x); return r; } });
  atual.db = comBatch;
  vi.mocked(getDb).mockReturnValue(comBatch as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}', ia_ligada = true,
      limite_mensal_tokens_entrada = ${LIMITE.entrada}, limite_mensal_tokens_saida = ${LIMITE.saida} WHERE id = 1;
    INSERT INTO dolores_grupos (instancia, grupo_jid, nome, ativo) VALUES ('prospecta-dolores', '${GRUPO}', 'Documentação — cliente novo', true);
    UPDATE dolores_grupos_config SET classificacao_ligada = true, teto_classificacoes_dia = 1000, teto_classificacoes_grupo_dia = 200 WHERE id = 1;`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  esquecerUsuarioDolores();
  definirDependenciasPonte({ agora: () => AGORA });
  definirDependenciasWhatsapp({ agora: () => AGORA, enviar: vi.fn(async () => true) as never });
  vi.mocked(configuracaoAnthropicPainel).mockResolvedValue({ apiKey: "sk-ant-chave-de-teste-nao-real-123456", modelo: "modelo-do-painel" });
  definirClienteModelo((async () => { throw new Error("o modelo de conversa não pode ser chamado por mensagem de grupo"); }) as never);
  pedidosIa = [];
  respostaIa = () => ehToolUse({ tipo: "rg", confianca: 0.92, motivo: "documento de identidade com foto" });
  baixar = vi.fn(async () => ({ base64: pdfClassico(1).toString("base64") }));
  usarModelo();
  sdk.contagens = []; sdk.criacoes = []; sdk.chaves = []; sdk.contar = async () => ({ input_tokens: 1_200 });
  let s = 0;
  definirSorteioCodigo(() => ((s++ * 5) % 22) / 22 + 0.001);
  vi.mocked(uploadPrivateDocument).mockClear();
});
afterEach(() => {
  ENV.cookieSecret = segredoAntes;
  definirDependenciasPonte(); definirDependenciasWhatsapp(); definirClienteModelo(); definirDependenciasClassificacao(); definirSorteioCodigo();
  limparPausaPorFalhaNoConsumo(); // a pausa em memória (QA r3 N7) não vaza de um teste para outro
  vi.clearAllMocks();
});

const caller = (role: string, id = 1) => appRouter.createCaller({ user: { id, role, active: true, permissions: "[]", name: "x" }, req: {}, res: {} } as never) as any;
const doDono = (texto: string) => ({ key: { remoteJid: `${DONO}@s.whatsapp.net`, fromMe: false, id: `DONOR3${++seq}` }, message: { conversation: texto },
  messageTimestamp: Math.floor((AGORA.getTime() - 30_000) / 1000) });
/** Modelo falso de 25 mil tokens por classificação (o arquivo vai: a contagem prévia cabe na reserva). */
const usarModeloDe25mil = () => definirDependenciasClassificacao({ baixar: baixar as never, contar: async () => 25_000,
  cliente: async p => { pedidosIa.push(p); return ehToolUse({ tipo: "rg", confianca: 0.9, motivo: "documento" }, 25_000); } });
const falharGravacaoEm = (tabela: string) => banco.pg.exec(`
  CREATE OR REPLACE FUNCTION qa_falha() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'QA: falha ao gravar'; END; $$ LANGUAGE plpgsql;
  CREATE TRIGGER qa_falha_${tabela} BEFORE INSERT OR UPDATE ON ${tabela} FOR EACH ROW EXECUTE FUNCTION qa_falha();`);
const desligamentos = () => q("SELECT resultado, motivo, canal, resumo FROM dolores_acoes WHERE funcao = $1 ORDER BY id".replace("$1", `'${FUNCAO_DESLIGAMENTO_POR_FALHA}'`));
const ligada = async () => (await q("SELECT classificacao_ligada l FROM dolores_grupos_config WHERE id = 1"))[0].l;

describe("QA r3 N7: sem o registro do uso, a classificação falha fechado (desliga, audita e a tela mostra o motivo)", () => {
  it("gravação em dolores_grupos_consumo_mes falhando: 40 documentos ⇒ 1 chamada à IA, classificação desligada e auditada; o dono segue", async () => {
    await falharGravacaoEm("dolores_grupos_consumo_mes");
    usarModeloDe25mil();
    const erros = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (let i = 0; i < 40; i++) await chamar(aviso(item({ message: documento(`f${i}.pdf`) })));
    expect(pedidosIa.length).toBeLessThanOrEqual(1);
    expect(pedidosIa).toHaveLength(1);
    expect(await ligada()).toBe(false);
    expect(classificacaoPausadaPorFalha()).toBe(false); // o desligamento ficou no banco (vale para todas as instâncias)
    const d = await desligamentos();
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ resultado: "erro", motivo: MOTIVO_DESLIGAMENTO_POR_FALHA, canal: "whatsapp",
      resumo: { grupoId: 1, mensagemId: 1, registroQueFalhou: ["dolores_grupos_consumo_mes"], desligadaNoBanco: true } });
    // o uso da única chamada está no limite inteiro (dolores_consumo gravou)
    expect((await usoTotal()).e).toBe(25_000);
    // as seguintes, pela tela também, devolvem "classificacao-desligada" sem chamar a IA
    const r = await classificarPendentes({ maximo: 5, prazoFinal: Date.now() + 45_000, obterCredencial: credencialDaClassificacao, canal: "tela" });
    expect(r).toEqual({ "classificacao-desligada": 1 });
    expect(pedidosIa).toHaveLength(1);
    expect((await mensagens()).filter(m => m.situacao === "a_classificar")).toHaveLength(39);
    // a tela do admin mostra que desligou sozinha, quando e por quê
    const tela = await caller("admin").dolores.grupos.listar();
    expect(tela.config.classificacaoLigada).toBe(false);
    expect(tela.desligamentoPorFalha).toMatchObject({ motivo: MOTIVO_DESLIGAMENTO_POR_FALHA, soNestaInstancia: false });
    expect(typeof tela.desligamentoPorFalha.em).toBe("string");
    // os comandos do dono continuam liberados: reserva do limite e resposta pelo WhatsApp
    const [dm] = await q<{ id: number }>("INSERT INTO dolores_mensagens (instancia, external_id, do_dono) VALUES ('prospecta-dolores', 'DONOR3X', true) RETURNING id");
    expect(await reservarChamada({ mes: "2026-11", mensagemId: dm.id, limites: LIMITE, reserva: { entrada: 30_000, saida: 2_000 }, validadeMs: 60_000 })).toBeNull();
    await liberarReserva(dm.id);
    const enviar = vi.fn(async () => true);
    definirDependenciasWhatsapp({ agora: () => AGORA, enviar: enviar as never });
    definirClienteModelo((async () => ({ stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 10 }, content: [{ type: "text", text: "Pronto, dono." }] })) as never);
    await chamar(aviso(doDono("bom dia, Dolores")));
    expect(enviar.mock.calls.filter((c: any) => c[0].numero === DONO)).toHaveLength(1);
    erros.mockRestore();
    // o admin confere, o banco volta ao normal e ele religa pela tela: o aviso some e a classificação segue
    await banco.pg.exec("DROP TRIGGER qa_falha_dolores_grupos_consumo_mes ON dolores_grupos_consumo_mes");
    await caller("admin").dolores.grupos.salvarConfig({ classificacaoLigada: true });
    expect((await caller("admin").dolores.grupos.listar()).desligamentoPorFalha).toBeNull();
    expect(await classificarPendentes({ maximo: 1, prazoFinal: Date.now() + 45_000, obterCredencial: credencialDaClassificacao, canal: "tela" })).toEqual({ classificado: 1 });
  }, 120_000);

  it("gravação em dolores_consumo (limite inteiro) falhando: também desliga", async () => {
    await falharGravacaoEm("dolores_consumo");
    usarModeloDe25mil();
    const erros = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (let i = 0; i < 5; i++) await chamar(aviso(item({ message: documento(`c${i}.pdf`) })));
    erros.mockRestore();
    expect(pedidosIa).toHaveLength(1);
    expect(await ligada()).toBe(false);
    expect((await desligamentos())[0].resumo.registroQueFalhou).toEqual(["dolores_consumo"]);
  }, 60_000);

  it("nem o desligamento grava: pausa em memória nesta instância (tela mostra), e o admin religando limpa", async () => {
    await falharGravacaoEm("dolores_grupos_consumo_mes");
    await falharGravacaoEm("dolores_grupos_config");
    usarModeloDe25mil();
    const erros = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (let i = 0; i < 10; i++) await chamar(aviso(item({ message: documento(`m${i}.pdf`) })));
    expect(pedidosIa).toHaveLength(1);
    expect(classificacaoPausadaPorFalha()).toBe(true);
    expect(await ligada()).toBe(true); // o banco não gravou o desligamento…
    expect((await desligamentos())[0].resumo).toMatchObject({ desligadaNoBanco: false }); // …mas a auditoria ficou
    expect(await classificarPendentes({ maximo: 5, prazoFinal: Date.now() + 45_000, obterCredencial: credencialDaClassificacao, canal: "tela" }))
      .toEqual({ "classificacao-desligada": 1 });
    expect((await caller("admin").dolores.grupos.listar()).desligamentoPorFalha).toMatchObject({ soNestaInstancia: true, em: null });
    erros.mockRestore();
    await banco.pg.exec(`DROP TRIGGER qa_falha_dolores_grupos_config ON dolores_grupos_config; DROP TRIGGER qa_falha_dolores_grupos_consumo_mes ON dolores_grupos_consumo_mes;`);
    await caller("admin").dolores.grupos.salvarConfig({ classificacaoLigada: true });
    expect(classificacaoPausadaPorFalha()).toBe(false);
    expect(await classificarPendentes({ maximo: 1, prazoFinal: Date.now() + 45_000, obterCredencial: credencialDaClassificacao, canal: "tela" })).toEqual({ classificado: 1 });
  }, 60_000);

  it("sem falha: comportamento normal — o orçamento de 20% segura (7 chamadas de 25 mil) e nada é desligado", async () => {
    usarModeloDe25mil();
    for (let i = 0; i < 12; i++) await chamar(aviso(item({ message: documento(`g${i}.pdf`) })));
    expect(pedidosIa).toHaveLength(7);
    expect(await ligada()).toBe(true);
    expect(await desligamentos()).toEqual([]);
    expect((await caller("admin").dolores.grupos.listar()).desligamentoPorFalha).toBeNull();
    const [m] = await q("SELECT tokens_entrada::int e, chamadas FROM dolores_grupos_consumo_mes WHERE mes = '2026-11'");
    expect(m).toEqual({ e: 7 * 25_000, chamadas: 7 });
    expect((await q("SELECT motivo FROM dolores_acoes WHERE funcao = 'classificar_documento' AND resultado = 'recusada'")).map(a => a.motivo))
      .toContain("orçamento mensal da classificação atingido");
  }, 120_000);
});

describe("QA r3 N8: a exceção da 0130 só vale para o usuário que foi mesmo excluído", () => {
  const sql0130 = readFileSync(new URL("../../drizzle/0130_dolores_fila_guarda.sql", import.meta.url), "utf8");
  const pedir = (funcao: string, argumentos: unknown) => executarFuncao({ funcao, argumentos, pedidoId: "wa:9:1:0" }, { canal: "whatsapp", mensagemId: 9 });
  async function comEsbocos<T>(fn: () => Promise<T>): Promise<T> {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e: any) {
        const causa = String(e?.cause?.message ?? e?.cause?.cause?.message ?? e?.message ?? "");
        const m = /relation "(\w+)" does not exist/.exec(causa);
        if (!m || i > 15) throw e;
        const consulta = String(e?.cause?.query ?? e?.query ?? e?.message ?? "");
        const cols = Array.from(new Set(Array.from(consulta.matchAll(new RegExp(`"${m[1]}"\\."(\\w+)"`, "g"))).map(x => x[1]).filter(c => c !== "id")));
        await banco.pg.exec(`CREATE TABLE IF NOT EXISTS "${m[1]}" (id serial${cols.map(c => `, "${c}" integer`).join("")})`);
      }
    }
  }
  const linhaSemDecisor = (l: any) => { const { decidido_por_user_id: _x, ...resto } = l; return resto; };

  it("0130 aplicada 2×: NULL à mão com o usuário existindo é barrado; excluir pelo appRouter funciona e o item fica encerrado e íntegro", async () => {
    await banco.pg.exec(sql0130); await banco.pg.exec(sql0130);
    expect(sql0130).toContain(`NOT EXISTS (SELECT 1 FROM "users" WHERE "id" = OLD."decidido_por_user_id")`);
    await banco.pg.exec("UPDATE users SET role = 'admin' WHERE id = 2");
    definirDependenciasPonte({ agora: () => new Date() });
    await chamar(aviso(item({ message: documento("rg.pdf", "RG") })));
    await pedir("criar_card_cliente", { grupoId: 1, nome: "Carla Nova", telefone: "99 98888-1111" });
    const [card] = await q("SELECT codigo FROM dolores_aprovacoes ORDER BY id");
    expect((await decidir([card.codigo], "recusar", decisorDaTela(2)))[0]).toMatchObject({ ok: true });
    const [antes] = await q("SELECT * FROM dolores_aprovacoes ORDER BY id");
    expect(antes).toMatchObject({ situacao: "recusada", decidido_por_user_id: 2, decidido_via: "tela" });
    // à mão, sem excluir ninguém: barrado
    await expect(banco.pg.query("UPDATE dolores_aprovacoes SET decidido_por_user_id = NULL WHERE id = 1")).rejects.toThrow(/DOLORES_FILA_ENCERRADO/);
    expect((await q("SELECT decidido_por_user_id d FROM dolores_aprovacoes WHERE id = 1"))[0].d).toBe(2);
    // excluir o usuário pela rota (ON DELETE SET NULL): passa
    await comEsbocos(() => caller("admin", 1).configuracoes.deleteUser({ id: 2 }));
    expect(await q("SELECT id FROM users WHERE id = 2")).toEqual([]);
    const [depois] = await q("SELECT * FROM dolores_aprovacoes ORDER BY id");
    expect(depois.decidido_por_user_id).toBeNull();
    expect(linhaSemDecisor(depois)).toEqual(linhaSemDecisor(antes));
    // continua encerrado
    await expect(banco.pg.query("UPDATE dolores_aprovacoes SET situacao = 'aguardando' WHERE id = 1")).rejects.toThrow(/DOLORES_FILA/);
  });
});

describe("QA r3 (resíduo do N6): '#N' solto depois de palavra de outra coisa não indica o cliente", () => {
  it("regras puras", () => {
    for (const nao of ["documento #3", "salve o documento #3", "Documento nº #3", "item #3", "a nota #3", "parcela #3", "lote #3", "quadra #3", "etapa #3",
      "obra #3", "pedido #3", "protocolo #3", "arquivo #3", "foto #3", "grupo #3", "documento # 3", "salve os 3 documentos", "#33", "##3"]) {
      expect(clienteIndicadoNoTexto(nao, 3), nao).toBe(false);
    }
    for (const sim of ["#3", "o #3", "é o #3, salva o documento", "#3 é o cliente", "documento do #3", "cliente #3", "lead #3", "card #3", "documento do cliente 3",
      "documento #2 do cliente #3", "salve o documento #2 no #3"]) {
      expect(clienteIndicadoNoTexto(sim, 3), sim).toBe(true);
    }
  });
});
