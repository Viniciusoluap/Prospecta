// EPIC-025 (Dolores, etapa 4) — regressões da 2ª rodada do portão de QA (Quinn, 17/11/2026). Cada teste é a versão
// INVERTIDA de um ataque de `qa-dolores-e4-r2/ataques-r2*.test.ts`: passa quando o defeito NÃO existe. PGlite; nada sai
// para a rede (o SDK da Anthropic é simulado neste arquivo).
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

import { FERRAMENTA_CLASSIFICACAO } from "../../shared/dolores/grupos.js";
import { bloqueioDoLimite } from "../../shared/dolores/whatsapp.js";
import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { uploadPrivateDocument } from "../drive-documents.js";
import { appRouter } from "../routers.js";
import { decidir, decisorDaTela, definirSorteioCodigo } from "./aprovacoes.js";
import { definirClienteModelo } from "./cerebro.js";
import {
  RESERVA_ENTRADA_CLASSIFICACAO, classificarPendentes, definirDependenciasClassificacao, type ContadorClassificacao, type PedidoClassificacao,
  type RespostaClassificacao,
} from "./classificacao.js";
import { reservarChamada } from "./consumo.js";
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
    key: { remoteJid: p.jid ?? GRUPO, fromMe: false, id: p.id ?? `QAR2${++seq}`, participant: `${p.de ?? CLIENTE}@s.whatsapp.net` },
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
  vi.clearAllMocks();
});

describe("QA r2 N0: rajada de PDFs densos não estoura o limite nem bloqueia o dono", () => {
  it("contagem prévia pelo SDK (messages.countTokens) com o MESMO modelo, instrução, ferramenta, conteúdo e chave da chamada", async () => {
    definirDependenciasClassificacao({ baixar: baixar as never }); // contador e modelo PADRÃO (o SDK simulado acima)
    await chamar(aviso(item({ message: documento() })));
    expect(sdk.contagens).toHaveLength(1);
    expect(sdk.criacoes).toHaveLength(1);
    const [c] = sdk.contagens; const [m] = sdk.criacoes;
    expect(c).toEqual({ model: m.model, system: m.system, tools: m.tools, tool_choice: m.tool_choice, messages: m.messages });
    expect(c.messages[0].content.map((b: any) => b.type)).toEqual(["document", "text"]);
    // a mesma chave que veio da porta única (bloqueioAtual → credencialDaClassificacao)
    expect(new Set(sdk.chaves)).toEqual(new Set(["sk-ant-chave-de-teste-nao-real-123456"]));
    expect((await mensagens())[0]).toMatchObject({ situacao: "classificado" });
  });

  it("contagem acima da reserva: o arquivo NÃO vai; classifica só por nome e legenda, com 'confira'", async () => {
    definirDependenciasClassificacao({ baixar: baixar as never });
    sdk.contar = async () => ({ input_tokens: 150_000 });
    await chamar(aviso(item({ message: documento() })));
    expect(sdk.contagens).toHaveLength(1);
    expect(sdk.criacoes).toHaveLength(1);
    expect(sdk.criacoes[0].messages[0].content.map((b: any) => b.type)).toEqual(["text"]);
    const [m] = await mensagens();
    expect(m.situacao).toBe("confira");
    expect(m.motivo).toMatch(/só pelo nome e pela legenda/);
  });

  it("contagem com erro ou fora do prazo: o arquivo NÃO vai (só nome e legenda, 'confira')", async () => {
    usarModelo(async () => { throw Object.assign(new Error("429"), { status: 429 }); });
    await chamar(aviso(item({ message: documento("a.pdf") })));
    usarModelo(() => new Promise<number>(() => undefined)); // nunca responde: o prazo curto corta
    await chamar(aviso(item({ message: documento("b.pdf") })));
    usarModelo(async () => Number.NaN);
    await chamar(aviso(item({ message: documento("c.pdf") })));
    expect(pedidosIa.map(p => p.conteudo.map(c => c.type))).toEqual([["text"], ["text"], ["text"]]);
    expect((await mensagens()).map(m => m.situacao)).toEqual(["confira", "confira", "confira"]);
  }, 60_000);

  it("sem o arquivo, nome e legenda vão cortados (o pedido só de texto cabe na reserva base)", async () => {
    usarModelo(async () => 999_999);
    await chamar(aviso(item({ message: documento(`${"n".repeat(150)}.pdf`, "L".repeat(1900)) })));
    const dados = JSON.parse((pedidosIa[0].conteudo[0] as { text: string }).text);
    expect(dados.legenda.length).toBeLessThanOrEqual(300);
    expect(dados.nomeDoArquivo.length).toBeLessThanOrEqual(160);
    expect(dados.arquivoEnviado).toBe(false);
  });

  it("10 avisos simultâneos com PDF denso (contagem honesta de 150 mil): nenhuma chamada com o arquivo; uso total dentro da reserva", async () => {
    const pedidos: PedidoClassificacao[] = [];
    definirDependenciasClassificacao({ baixar: baixar as never, contar: async () => 150_000,
      cliente: async p => { pedidos.push(p); await new Promise(r => setTimeout(r, 200)); return ehToolUse({ tipo: "rg", confianca: 0.9, motivo: "documento" }, 1_200); } });
    await Promise.all(Array.from({ length: 10 }, (_, i) => chamar(aviso(item({ message: documento(`d${i}.pdf`) })))));
    expect(pedidos.every(p => p.conteudo.every(c => c.type === "text"))).toBe(true);
    expect(pedidos.length).toBeLessThanOrEqual(1); // uma por vez: as outras ficam "a classificar"
    const u = await usoTotal();
    expect(u.e).toBeLessThanOrEqual(RESERVA_ENTRADA_CLASSIFICACAO);
    expect((await mensagens()).filter(m => m.situacao === "a_classificar").length).toBeGreaterThanOrEqual(9);
  });

  it("rajada com a contagem errando para baixo (uso real 150 mil por chamada), 10 grupos × 10 avisos: uma chamada por vez, orçamento próprio respeitado e o dono continua com limite", async () => {
    const grupos = Array.from({ length: 10 }, (_, i) => `1203639${String(i).padStart(11, "0")}@g.us`);
    await banco.pg.exec(`INSERT INTO dolores_grupos (instancia, grupo_jid, nome, ativo) VALUES ${grupos.map(g => `('prospecta-dolores', '${g}', 'G', true)`).join(", ")}`);
    let emAndamento = 0; let maximoSimultaneo = 0; let chamadas = 0;
    definirDependenciasClassificacao({ baixar: baixar as never, contar: async () => 1_000,
      cliente: async () => {
        chamadas++; emAndamento++; maximoSimultaneo = Math.max(maximoSimultaneo, emAndamento);
        await new Promise(r => setTimeout(r, 100));
        emAndamento--;
        return ehToolUse({ tipo: "rg", confianca: 0.9, motivo: "documento" }, 150_000);
      } });
    for (let rodada = 0; rodada < 10; rodada++) {
      await Promise.all(grupos.map((g, i) => chamar(aviso(item({ jid: g, message: documento(`r${rodada}-${i}.pdf`) })))));
    }
    expect(maximoSimultaneo).toBe(1);
    const u = await usoTotal();
    const orcamento = LIMITE.entrada * 0.2;
    // no máximo UMA chamada acima do orçamento próprio (a que já estava em andamento quando ele acabou)
    expect(u.e).toBeLessThanOrEqual(orcamento + 150_000);
    expect(u.e).toBeLessThan(LIMITE.entrada * 0.8);
    expect(bloqueioDoLimite({ entrada: u.e, saida: u.s }, LIMITE)).toBeNull();
    const [mes] = await q("SELECT tokens_entrada::int e, chamadas FROM dolores_grupos_consumo_mes");
    expect(mes).toMatchObject({ e: u.e, chamadas });
    // o comando do dono ainda reserva o limite (não é "limite_mensal" nem "outro_pedido")
    const [dm] = await q<{ id: number }>("INSERT INTO dolores_mensagens (instancia, external_id, do_dono) VALUES ('prospecta-dolores', 'DONO1', true) RETURNING id");
    expect(await reservarChamada({ mes: "2026-11", mensagemId: dm.id, limites: LIMITE, reserva: { entrada: 30_000, saida: 2_000 }, validadeMs: 60_000 })).toBeNull();
    const cred = await credencialDaClassificacao();
    expect(cred.motivo).toBeNull(); // a porta da chave não virou "limite_mensal" por causa de documentos
  }, 120_000);

  it("orçamento próprio atingido: só a classificação para ('classificacao-orcamento', auditada); a vaga do dia volta", async () => {
    await banco.pg.exec("INSERT INTO dolores_grupos_consumo_mes (mes, tokens_entrada, tokens_saida, chamadas) VALUES ('2026-11', 190000, 100, 5)");
    await chamar(aviso(item({ message: documento() })));
    expect(pedidosIa).toEqual([]);
    expect((await mensagens())[0]).toMatchObject({ situacao: "a_classificar", reserva_entrada: 0 });
    expect((await q("SELECT motivo FROM dolores_acoes WHERE funcao = 'classificar_documento'")).map(a => a.motivo)).toEqual(["orçamento mensal da classificação atingido"]);
    expect((await q("SELECT classificacoes FROM dolores_grupos_contagem WHERE grupo_id = 1"))[0].classificacoes).toBe(0);
    // o admin sobe o orçamento para 30%: volta a classificar
    await banco.pg.exec("UPDATE dolores_grupos_config SET orcamento_classificacao_pct = 30");
    const r = await classificarPendentes({ maximo: 1, prazoFinal: Date.now() + 45_000, obterCredencial: credencialDaClassificacao, canal: "tela" });
    expect(r).toEqual({ classificado: 1 });
  });

  it("uma classificação por vez: com outra em andamento (reserva válida), esta fica 'a classificar' sem chamar a IA", async () => {
    await chamar(aviso(item({ message: documento("a.pdf") })));
    await banco.pg.exec(`UPDATE dolores_grupo_mensagens SET situacao = 'classificando', reserva_entrada = 28000, reserva_saida = 300, reserva_ate = now() + interval '2 minutes' WHERE id = 1`);
    pedidosIa = [];
    await chamar(aviso(item({ message: documento("b.pdf") })));
    expect(pedidosIa).toEqual([]);
    expect((await mensagens())[1]).toMatchObject({ situacao: "a_classificar", tentativas: 0 });
    expect((await mensagens())[1].motivo).toMatch(/uma por vez/);
    // vencida a reserva da outra, segue normalmente
    await banco.pg.exec(`UPDATE dolores_grupo_mensagens SET reserva_ate = now() - interval '1 second' WHERE id = 1`);
    const r = await classificarPendentes({ maximo: 1, prazoFinal: Date.now() + 45_000, obterCredencial: credencialDaClassificacao, canal: "tela" });
    expect(r).toEqual({ classificado: 1 });
  });
});

describe("QA r2 N1: a estimativa de páginas não é furada por NUL, \\f, comentário nos /Kids, /Count com sinal ou página sem /Type", () => {
  /** PDF clássico com xref correta; `sep` separa as palavras, `ref` escreve cada filho, `count` o /Count, `pagina` cada página. */
  function pdfVariante(n: number, o: { sep?: string; ref?: (k: number) => string; count?: string; pagina?: (i: number) => string } = {}): Buffer {
    const sep = o.sep ?? " ";
    const ref = o.ref ?? (k => `${k}${sep}0${sep}R`);
    const objs = [`<< /Type /Catalog /Pages 2 0 R >>`, `<< /Type${sep}/Pages /Kids [${Array.from({ length: n }, (_, i) => ref(i + 3)).join(sep)}] /Count${sep}${o.count ?? String(n)} >>`];
    for (let i = 0; i < n; i++) objs.push(o.pagina ? o.pagina(i) : `<< /Type${i === 0 ? " " : sep}/Page /Parent 2 0 R /MediaBox [0 0 612 792] >>`);
    let c = "%PDF-1.4\n"; const offs: number[] = [];
    objs.forEach((x, i) => { offs.push(Buffer.byteLength(c, "latin1")); c += `${i + 1} 0 obj\n${x}\nendobj\n`; });
    const xref = Buffer.byteLength(c, "latin1");
    c += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(x => `${String(x).padStart(10, "0")} 00000 n \n`).join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(c, "latin1");
  }
  const semTipoNemPai = (i: number) => (i === 0 ? "<< /Type /Page /MediaBox [0 0 612 792] >>" : "<< /MediaBox [0 0 612 792] >>");
  const variantes: Array<[string, Buffer]> = [
    ["NUL como espaço", pdfVariante(60, { sep: "\u0000" })],
    ["\\f como espaço", pdfVariante(60, { sep: "\f" })],
    ["comentário dentro das referências dos /Kids, /Count +60, páginas sem /Type", pdfVariante(60, { ref: k => `${k} 0%c\nR`, count: "+60",
      pagina: i => (i === 0 ? "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>" : "<< /Parent 2 0 R /MediaBox [0 0 612 792] >>") })],
    ["comentário com ']' nos /Kids e páginas sem /Type nem /Parent", pdfVariante(60, { ref: k => `${k} 0 R %]\n`, count: "60", pagina: semTipoNemPai })],
    ["/Count +60 e páginas sem /Type nem /Parent", pdfVariante(60, { count: "+60", pagina: semTipoNemPai })],
    ["/Count 60.0", pdfVariante(60, { count: "60.0", pagina: semTipoNemPai })],
    ["NUL nos /Kids e páginas sem /Type nem /Parent", pdfVariante(60, { sep: "\u0000", count: "60", pagina: semTipoNemPai })],
  ];

  // o pdf.js conta 60 páginas em todas as variantes (conferido fora da suíte com qa-dolores-e4-r2/pdfcheck/conta.mjs: aqui o
  // pdf.js recusa rodar por causa de um Array.prototype.random do projeto)
  it.each(variantes)("%s: 'não sei' ou pelo menos as 60 páginas que o pdf.js conta (nunca 1)", async (_nome, pdf) => {
    const { paginasPdfEstimadas } = await import("../../shared/dolores/grupos.js");
    const estimativa = paginasPdfEstimadas(pdf);
    expect(estimativa === null || estimativa >= 60).toBe(true);
    if (process.env.QA_SALVAR_PDFS) (await import("node:fs")).writeFileSync(`${process.env.QA_SALVAR_PDFS}/${_nome.replace(/[^a-z0-9]+/gi, "-")}.pdf`, pdf);
  });

  it("no fluxo: o PDF de 60 páginas com NUL não vai à IA como arquivo", async () => {
    baixar.mockResolvedValue({ base64: pdfVariante(60, { sep: "\u0000" }).toString("base64") });
    await chamar(aviso(item({ message: documento("extrato.pdf", "extrato") })));
    expect(pedidosIa.map(p => p.conteudo.map(c => c.type))).toEqual([["text"]]);
  });

  it("PDFs legítimos continuam contados: 1 e 5 páginas", async () => {
    const { paginasPdfEstimadas } = await import("../../shared/dolores/grupos.js");
    expect(paginasPdfEstimadas(pdfClassico(1))).toBe(1);
    expect(paginasPdfEstimadas(pdfClassico(5))).toBe(5);
    expect(paginasPdfEstimadas(pdfVariante(3))).toBe(3);
  });
});

describe("QA r2 N2: admin que decidiu item da fila pela tela pode ser excluído (0130); o item continua encerrado e íntegro", () => {
  const callerId = (role: string, id: number) => appRouter.createCaller({ user: { id, role, active: true, permissions: "[]", name: "x" }, req: {}, res: {} } as never) as any;
  const pedir = (funcao: string, argumentos: unknown, n = 1) => executarFuncao({ funcao, argumentos, pedidoId: `wa:9:${n}:0` }, { canal: "whatsapp", mensagemId: 9 });
  const fila = () => q("SELECT * FROM dolores_aprovacoes ORDER BY id");
  /** Rotas antigas tocam tabelas que o PGlite da suíte não cria (sem relação com a Dolores): cria um esboço vazio e tenta de novo. */
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

  it.each([["recusar"], ["aprovar"]] as const)("decidiu (%s) pela tela → excluir pela rota funciona; o item fica igual, só sem quem decidiu", async decisao => {
    await banco.pg.exec("UPDATE users SET role = 'admin' WHERE id = 2");
    definirDependenciasPonte({ agora: () => new Date() });
    await chamar(aviso(item({ message: documento("rg.pdf", "RG") })));
    await pedir("criar_card_cliente", { grupoId: 1, nome: "Carla Nova", telefone: "99 98888-1111" });
    const [card] = await fila();
    expect((await decidir([card.codigo], decisao, decisorDaTela(2)))[0]).toMatchObject({ ok: true });
    const [antes] = await fila();
    expect(antes).toMatchObject({ decidido_por_user_id: 2, decidido_via: "tela" });
    expect(["recusada", "executada"]).toContain(antes.situacao);
    await comEsbocos(() => callerId("admin", 1).configuracoes.deleteUser({ id: 2 }));
    expect(await q("SELECT id FROM users WHERE id = 2")).toEqual([]);
    const [depois] = await fila();
    expect(depois.decidido_por_user_id).toBeNull();
    expect(linhaSemDecisor(depois)).toEqual(linhaSemDecisor(antes));
  });

  it("inverso: a exceção é só a passagem para NULL de quem decidiu, sem mudar mais nada", async () => {
    await banco.pg.exec("UPDATE users SET role = 'admin' WHERE id = 2");
    definirDependenciasPonte({ agora: () => new Date() });
    await chamar(aviso(item({ message: documento("rg.pdf", "RG") })));
    await pedir("criar_card_cliente", { grupoId: 1, nome: "Carla Nova", telefone: "99 98888-1111" });
    const [card] = await fila();
    await decidir([card.codigo], "recusar", decisorDaTela(2));
    const recusa = (sql: string) => expect(banco.pg.query(sql)).rejects.toThrow(/DOLORES_FILA/);
    await recusa("UPDATE dolores_aprovacoes SET decidido_por_user_id = 1 WHERE id = 1"); // trocar quem decidiu
    await recusa("UPDATE dolores_aprovacoes SET decidido_por_user_id = NULL, situacao = 'aguardando' WHERE id = 1"); // NULL + reabrir
    await recusa("UPDATE dolores_aprovacoes SET decidido_por_user_id = NULL, motivo = 'outro' WHERE id = 1"); // NULL + outra coluna
    await recusa("UPDATE dolores_aprovacoes SET decidido_por_user_id = NULL, resumo = 'x' WHERE id = 1");
    await recusa("DELETE FROM dolores_aprovacoes WHERE id = 1");
    await recusa("UPDATE dolores_aprovacoes SET situacao = 'aguardando' WHERE id = 1");
    // a autora (usuária Dolores) continua sem poder ser apagada: ON DELETE RESTRICT de propósito
    const [{ autor }] = await q<{ autor: number }>("SELECT autor_user_id autor FROM dolores_aprovacoes WHERE id = 1");
    await expect(banco.pg.query(`DELETE FROM users WHERE id = ${autor}`)).rejects.toThrow();
  });

  it("estático: a 0130 é só CREATE OR REPLACE FUNCTION, com o corpo da 0125 e a exceção no começo", async () => {
    const { readFileSync } = await import("node:fs");
    const sql0130 = readFileSync(new URL("../../drizzle/0130_dolores_fila_guarda.sql", import.meta.url), "utf8");
    const sql0125 = readFileSync(new URL("../../drizzle/0125_dolores_fila.sql", import.meta.url), "utf8");
    const semComentario = (s: string) => s.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
    expect(semComentario(sql0130)).not.toMatch(/ALTER\s+TABLE|DROP\s+|DELETE\s+FROM|TRUNCATE\s+[a-z"]|CREATE\s+TABLE|UPDATE\s+"/i);
    // todas as regras da 0125 continuam
    for (const regra of ["DOLORES_FILA_SEM_EXCLUSAO", "DOLORES_FILA_IMUTAVEL: o que será feito", "DOLORES_FILA_ENCERRADO", "DOLORES_FILA_EXECUCAO_UNICA: item aguardando",
      "DOLORES_FILA_EXECUCAO_UNICA: item em execução", "DOLORES_FILA_IMUTAVEL: a decisão", "DOLORES_FILA_RESULTADO"]) {
      expect(sql0125).toContain(regra);
      expect(sql0130).toContain(regra);
    }
  });
});

describe("QA r2 N4: as chamadas da Dolores à Evolution não seguem redirecionamento (o apikey não vai a outro host)", () => {
  async function servidores() {
    const { createServer } = await import("node:http");
    let viu: { apikey?: unknown } | null = null;
    const alvo = createServer((req, res) => { viu = { apikey: req.headers["apikey"] }; res.writeHead(201, { "content-type": "application/json" }); res.end('{"base64":"QUJD"}'); });
    await new Promise<void>(r => alvo.listen(0, "127.0.0.1", () => r()));
    const pa = (alvo.address() as { port: number }).port;
    const origem = createServer((_req, res) => { res.writeHead(307, { location: `http://localhost:${pa}/interno` }); res.end(); });
    await new Promise<void>(r => origem.listen(0, "127.0.0.1", () => r()));
    const po = (origem.address() as { port: number }).port;
    return { po, visto: () => viu, fechar: () => { alvo.close(); origem.close(); } };
  }

  it("download (fetchComTeto): 307 para outro host é recusado e o outro host não recebe nada", async () => {
    const { fetchComTeto } = await import("./classificacao.js");
    const s = await servidores();
    try {
      await expect(fetchComTeto(5_000, 1024 * 1024)(`http://127.0.0.1:${s.po}/chat/getBase64FromMediaMessage/x`, { method: "POST", headers: { apikey: "chave-evo" }, body: "{}" })).rejects.toThrow();
      expect(s.visto()).toBeNull();
    } finally { s.fechar(); }
  });

  it("cliente da Evolution: com semRedirecionamento manda redirect 'error'; sem ele (Central de Vendas) fica como antes", async () => {
    const { baixarMidiaEvolution, enviarTextoEvolution, listarGruposEvolution } = await import("../_core/evolution.js");
    const vistos: Array<RequestInit | undefined> = [];
    const espiao = (async (_u: unknown, init?: RequestInit) => { vistos.push(init); return new Response('{"base64":"QUJD"}', { status: 200 }); }) as typeof fetch;
    const c = { url: "https://evo.exemplo", apiKey: "k" };
    await baixarMidiaEvolution({ ...c, semRedirecionamento: true }, "i", "x", espiao);
    await listarGruposEvolution({ ...c, semRedirecionamento: true }, "i", espiao).catch(() => undefined);
    await enviarTextoEvolution({ ...c, semRedirecionamento: true }, "i", "5599991234567", "oi", espiao).catch(() => undefined);
    await baixarMidiaEvolution(c, "i", "x", espiao);
    expect(vistos.slice(0, 3).map(v => v?.redirect)).toEqual(["error", "error", "error"]);
    expect(vistos[3]?.redirect).toBeUndefined();
  });

  it("estático: todo ponto da Dolores que pega a configuração da Evolution liga o semRedirecionamento", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const dir = new URL("./", import.meta.url);
    const arquivos = [...readdirSync(dir).map(n => `./${n}`), ...readdirSync(new URL("./acoes/", import.meta.url)).map(n => `./acoes/${n}`)]
      .filter(n => n.endsWith(".ts") && !n.endsWith(".test.ts") && n !== "./testes-banco.ts");
    const usam = arquivos.filter(n => readFileSync(new URL(n, dir), "utf8").includes("configEvolution("));
    expect(usam.sort()).toEqual(["./classificacao.ts", "./grupos-router.ts", "./router.ts", "./whatsapp.ts"]);
    for (const n of usam) {
      const texto = readFileSync(new URL(n, dir), "utf8");
      expect(texto.split("configEvolution(").length - 1, n).toBe(texto.split("semRedirecionamento: true").length - 1);
    }
  });
});
