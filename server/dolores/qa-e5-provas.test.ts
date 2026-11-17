// QA (Quinn) — provas do gate de segurança da etapa 5 (EPIC-025, notas de obra). Somente leitura do código de produção:
// cada teste documentava um achado do gate; depois da correção (Dex), cada um prova que o defeito SUMIU (regressão).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000 });

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../_core/anthropic-painel.js", async orig => ({ ...(await orig<typeof import("../_core/anthropic-painel.js")>()), configuracaoAnthropicPainel: vi.fn() }));
vi.mock("../drive-documents.js", async orig => ({
  ...(await orig<typeof import("../drive-documents.js")>()),
  driveConfigured: vi.fn(async () => true),
  uploadArquivoNoCaminho: vi.fn(async () => "drive-nota-1"),
  comPrazoNoDrive: vi.fn((_ms: number, fn: () => Promise<unknown>) => fn()),
}));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { constructor() { throw new Error("SDK real não é usado"); } } }));
const atual = vi.hoisted(() => ({ db: null as any }));
vi.mock("drizzle-orm/neon-http", async orig => ({
  ...(await orig<any>()),
  drizzle: () => new Proxy({}, { get: (_t, k) => { const v = atual.db[k]; return typeof v === "function" ? v.bind(atual.db) : v; }, set: () => true }),
}));
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://u:p@127.0.0.1:1/qa";

import { FERRAMENTA_NOTA, type SaidaNota } from "../../shared/dolores/notas.js";
import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { appRouter } from "../routers.js";
import { decidir, decisorDaTela, definirSorteioCodigo } from "./aprovacoes.js";
import { definirClienteModelo } from "./cerebro.js";
import { definirDependenciasClassificacao, limparPausaPorFalhaNoConsumo, type RespostaClassificacao } from "./classificacao.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte } from "./ponte.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";
import { definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";

const DONO = "5599991234567";
const EMPREITEIRO = "5599988887777";
const GRUPO_OBRA = "120363222222222222@g.us";
let banco: Awaited<ReturnType<typeof criarBanco>>;
let baixar: ReturnType<typeof vi.fn>;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
const notas = () => q("SELECT * FROM obra_notas ORDER BY id");

function pdf(variante: number): Buffer {
  const objs = [`<< /Type /Catalog /Pages 2 0 R >>`, `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>`];
  const texto = `BT /F1 12 Tf 72 720 Td (NOTA ${variante}) Tj ET`;
  objs.push(`<< /Length ${texto.length} >>\nstream\n${texto}\nendstream`);
  let corpo = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(corpo, "latin1")); corpo += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(corpo, "latin1");
  corpo += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  corpo += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(corpo, "latin1");
}
const conf = (v = 0.95) => ({ tipo: v, emitente: v, documento: v, numero: v, data: v, valor: v, descricao: v, itens: v, chave: v });
const saidaBoa = (x: Partial<SaidaNota> = {}): SaidaNota => ({
  eNota: true, tipo: "nfse", emitenteNome: "Zé Empreiteiro ME", emitenteDocumento: "529.982.247-25", numero: "45", dataEmissao: "2026-11-15",
  valorTotalCentavos: 250_000, descricao: "Mão de obra", itens: [{ descricao: "Alvenaria", quantidade: 1, valorCentavos: 250_000 }],
  chaveAcesso: null, categoriaSugerida: "empreiteiro", etapaSugerida: "paredes",
  sinais: { ilegivel: false, possivelAdulteracao: false, temDadosBancarios: false }, confianca: conf(), ...x,
});
const respostaNota = (input: unknown): RespostaClassificacao => ({
  stop_reason: "tool_use", usage: { input_tokens: 3_000, output_tokens: 300 }, content: [{ type: "tool_use", name: FERRAMENTA_NOTA.name, input }],
});
let seq = 0;
const chamar = (body: unknown) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, body, ip: "203.0.113.9" } as never);
async function mandarNota(variante: number) {
  baixar.mockResolvedValueOnce({ base64: pdf(variante).toString("base64") });
  const id = `QA${variante}-${++seq}`;
  await chamar({ event: "messages.upsert", instance: "prospecta-dolores", data: {
    key: { remoteJid: GRUPO_OBRA, fromMe: false, id, participant: `${EMPREITEIRO}@s.whatsapp.net` },
    message: { documentMessage: { mimetype: "application/pdf", fileName: `nota-${variante}.pdf`, fileLength: 2048, caption: "nota" } },
    messageTimestamp: Math.floor((AGORA.getTime() - 30_000) / 1000),
  } });
  return id;
}
const caller = (role: string, id = 1) => appRouter.createCaller({ user: { id, role, active: true, permissions: "[]", name: "x" }, req: {}, res: {} } as never) as any;

beforeEach(async () => {
  banco = await criarBanco();
  const comBatch = Object.assign(Object.create(Object.getPrototypeOf(banco.db)), banco.db, { batch: async (qs: any[]) => { const r = []; for (const x of qs) r.push(await x); return r; } });
  atual.db = comBatch;
  vi.mocked(getDb).mockReturnValue(comBatch as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`
    INSERT INTO users ("openId", name, role, active, "passwordHash", phone, cpf) VALUES ('emp', 'Zé Empreiteiro', 'empreiteiro', true, 'hash', '(99) 98888-7777', '529.982.247-25');
    UPDATE construction_projects SET contractor_user_id = 3 WHERE id = 1;
    UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}', ia_ligada = true,
      limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;
    INSERT INTO dolores_grupos (instancia, grupo_jid, nome, ativo, obra_id) VALUES ('prospecta-dolores', '${GRUPO_OBRA}', 'Obra Casa Ana', true, 1);
    UPDATE dolores_grupos_config SET classificacao_ligada = true, teto_classificacoes_dia = 1000, teto_classificacoes_grupo_dia = 200 WHERE id = 1;
    UPDATE obra_notas_config SET leitura_ligada = true WHERE id = 1;`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  esquecerUsuarioDolores();
  definirDependenciasPonte({ agora: () => AGORA });
  definirDependenciasWhatsapp({ agora: () => AGORA, enviar: vi.fn(async () => true) as never });
  vi.mocked(configuracaoAnthropicPainel).mockResolvedValue({ apiKey: "sk-ant-chave-de-teste-nao-real-123456", modelo: "modelo-do-painel" });
  definirClienteModelo((async () => { throw new Error("conversa não"); }) as never);
  baixar = vi.fn(async () => ({ base64: pdf(0).toString("base64") }));
  definirDependenciasClassificacao({ cliente: async () => respostaNota(saidaBoa()), baixar: baixar as never });
  let s = 0;
  definirSorteioCodigo(() => ((s++ * 5) % 22) / 22 + 0.001);
});
afterEach(() => {
  definirDependenciasPonte(); definirDependenciasWhatsapp(); definirClienteModelo(); definirDependenciasClassificacao(); definirSorteioCodigo();
  limparPausaPorFalhaNoConsumo();
  vi.clearAllMocks();
});

/** 100 notas antigas do MESMO emitente (CPF do empreiteiro) com outros números, gravadas direto (registro já existente). */
async function cemNotasDoMesmoEmitente() {
  await banco.pg.exec(`
    INSERT INTO dolores_grupo_mensagens (grupo_id, instancia, external_id, tipo, situacao)
      SELECT (SELECT id FROM dolores_grupos WHERE grupo_jid = '${GRUPO_OBRA}'), 'prospecta-dolores', 'ANTIGA' || g, 'documento', 'classificado' FROM generate_series(1, 100) g;
    INSERT INTO obra_notas (grupo_id, mensagem_id, obra_id, situacao, emitente_documento, numero)
      SELECT m.grupo_id, m.id, 1, 'rascunho', '52998224725', '9' || m.id FROM dolores_grupo_mensagens m WHERE m.external_id LIKE 'ANTIGA%' ORDER BY m.id;`);
}

describe("QA E5 — duplicidade por número + emitente", () => {
  it("CORRIGIDO: com 100+ notas do mesmo emitente, a nota repetida (mesmo nº e CPF, outro arquivo) é marcada duplicada", async () => {
    await cemNotasDoMesmoEmitente();
    await mandarNota(1); // nº 45 do CPF do empreiteiro — a 101ª nota deste emitente
    await mandarNota(2); // outro arquivo, MESMO nº 45 e MESMO CPF → "duplicada"
    const lidas = (await notas()).filter(n => n.numero === "45");
    expect(lidas).toHaveLength(2);
    expect(lidas[1].duplicada_de).toBe(lidas[0].id);
    expect(lidas[1].situacao).toBe("confira");
  });

  it("CORRIGIDO: o número é comparado normalizado NO SQL (zeros à esquerda e pontuação), mesmo atrás de 100+ notas do emitente", async () => {
    await cemNotasDoMesmoEmitente();
    // a nota antiga foi lida como "000.045" — a mesma 45 para numeroComparavel
    await banco.pg.exec(`INSERT INTO dolores_grupo_mensagens (grupo_id, instancia, external_id, tipo, situacao)
        SELECT id, 'prospecta-dolores', 'ANTIGA-45', 'documento', 'classificado' FROM dolores_grupos WHERE grupo_jid = '${GRUPO_OBRA}';
      INSERT INTO obra_notas (grupo_id, mensagem_id, obra_id, situacao, emitente_documento, numero)
        SELECT grupo_id, id, 1, 'rascunho', '52998224725', '000.045' FROM dolores_grupo_mensagens WHERE external_id = 'ANTIGA-45';`);
    const [antiga] = await q("SELECT id FROM obra_notas WHERE numero = '000.045'");
    await mandarNota(5); // nº 45 lido agora
    const [nova] = await q("SELECT * FROM obra_notas WHERE numero = '45'");
    expect(nova.duplicada_de).toBe(antiga.id);
    // outro emitente com o mesmo número NÃO é duplicada
    definirDependenciasClassificacao({ cliente: async () => respostaNota(saidaBoa({ emitenteDocumento: "11.222.333/0001-81", numero: "45" })), baixar: baixar as never });
    await mandarNota(6);
    const outras = await q("SELECT * FROM obra_notas WHERE numero = '45' ORDER BY id");
    expect(outras).toHaveLength(2);
    expect(outras[1].duplicada_de).toBeNull();
  });
});

describe("QA E5 — gatilho da 0128 (defesa em profundidade)", () => {
  it("ACHADO (baixo): o gatilho aceita conciliar SEM aprovação e trocar a resposta registrada (correção → confirmada)", async () => {
    await mandarNota(3);
    const [n] = await notas();
    await banco.pg.exec(`INSERT INTO bank_accounts (banco, conta) VALUES ('Banco', '1');
      INSERT INTO bpo_lancamentos (tipo, descricao, valor, valor_recebido, vencimento, pago, competencia, a_classificar) VALUES ('despesa', 'x', '1.00', '0', '2026-11-16', true, '2026-11', false);`);
    await expect(banco.pg.query(`UPDATE obra_notas SET bpo_lancamento_id = (SELECT max(id) FROM bpo_lancamentos), conciliada_em = now() WHERE id = ${n.id}`)).resolves.toBeTruthy();
    expect((await notas())[0].conciliada_aprovacao_id).toBeNull();
    await banco.pg.query(`UPDATE obra_notas SET confirmacao = 'correcao' WHERE id = ${n.id}`);
    await expect(banco.pg.query(`UPDATE obra_notas SET confirmacao = 'confirmada' WHERE id = ${n.id}`)).resolves.toBeTruthy();
  });
});

describe("QA E5 — conciliação depois que o lançamento do BPO some", () => {
  it("ACHADO (baixo): lançamento excluído (ex.: reclassificação do extrato) deixa a nota 'conciliada com nada' para sempre", async () => {
    await banco.pg.exec(`INSERT INTO bank_accounts (banco, conta) VALUES ('Banco', '1');
      INSERT INTO bank_transactions (account_id, data, descricao, valor, tipo) VALUES (1, '2026-11-16', 'PIX', '-2500.00', 'debito');
      INSERT INTO bpo_lancamentos (tipo, descricao, valor, valor_recebido, vencimento, pago, pago_em, competencia, a_classificar, categoria_operacional, vinculo_operacional_id, tipo_despesa_obra, bank_transaction_id)
        VALUES ('despesa', 'PIX', '2500.00', '0', '2026-11-16', true, '2026-11-16 12:00', '2026-11', false, 'obras', '1', 'empreiteiro', 1);`);
    await mandarNota(4);
    const [n] = await notas();
    await caller("admin").dolores.notas.proporConciliacao({ notaId: n.id });
    const [ap] = await q("SELECT codigo FROM dolores_aprovacoes");
    await decidir([ap.codigo], "aprovar", decisorDaTela(1));
    await banco.pg.query("DELETE FROM bpo_lancamentos");
    // o mesmo pagamento volta ao BPO (novo id)
    await banco.pg.exec(`INSERT INTO bpo_lancamentos (tipo, descricao, valor, valor_recebido, vencimento, pago, pago_em, competencia, a_classificar, categoria_operacional, vinculo_operacional_id, tipo_despesa_obra, bank_transaction_id)
        VALUES ('despesa', 'PIX', '2500.00', '0', '2026-11-16', true, '2026-11-16 12:00', '2026-11', false, 'obras', '1', 'empreiteiro', 1);`);
    const [depois] = await notas();
    expect(depois).toMatchObject({ bpo_lancamento_id: null });
    expect(depois.conciliada_em).not.toBeNull();
    await expect(caller("admin").dolores.notas.proporConciliacao({ notaId: n.id })).rejects.toThrow(/já está ligada/);
    const lista = await caller("admin").dolores.notas.listar({ situacao: "abertas" });
    expect(lista.notas.find((x: any) => x.id === n.id)).toBeUndefined();
  });
});
