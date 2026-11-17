// EPIC-025 (Dolores, etapa 4) — regressões do portão de QA (Quinn, 17/11/2026). Cada teste é a versão INVERTIDA de um ataque
// de `qa-dolores-e4/ataques.test.ts`: passa quando o defeito NÃO existe. PGlite; nada sai para a rede.
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
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
}));

import { FERRAMENTA_CLASSIFICACAO } from "../../shared/dolores/grupos.js";
import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { enviarParaLixeira, uploadPrivateDocument } from "../drive-documents.js";
import { appRouter } from "../routers.js";
import { decidir, decisorDaTela, definirSorteioCodigo } from "./aprovacoes.js";
import { definirClienteModelo } from "./cerebro.js";
import { definirDependenciasClassificacao, type PedidoClassificacao, type RespostaClassificacao } from "./classificacao.js";
import { esquecerUsuarioDolores } from "./perfil.js";
import { definirDependenciasPonte, executarFuncao } from "./ponte.js";
import { AGORA, CENARIO, criarBanco } from "./testes-banco.js";
import { definirDependenciasWhatsapp, segredoWebhookDolores, tratarWebhookDolores } from "./whatsapp.js";

const DONO = "5599991234567";
const CLIENTE = "5599977776666";
const GRUPO = "120363111111111111@g.us";
let banco: Awaited<ReturnType<typeof criarBanco>>;
let enviar: ReturnType<typeof vi.fn>;
let conversa: ReturnType<typeof vi.fn>;
let pedidosIa: PedidoClassificacao[];
let respostaIa: (p: PedidoClassificacao) => RespostaClassificacao;
let baixar: ReturnType<typeof vi.fn>;
const segredoAntes = ENV.cookieSecret;
const q = async <T = any>(sql: string) => (await banco.pg.query<T>(sql)).rows;
const mensagens = () => q("SELECT * FROM dolores_grupo_mensagens ORDER BY id");
const fila = () => q<{ codigo: string; situacao: string; funcao: string; resumo: string; argumentos: any }>("SELECT * FROM dolores_aprovacoes ORDER BY id");

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF").toString("base64");
const ehToolUse = (input: unknown, entrada = 1500): RespostaClassificacao => ({
  stop_reason: "tool_use", usage: { input_tokens: entrada, output_tokens: 40 },
  content: [{ type: "tool_use", name: FERRAMENTA_CLASSIFICACAO.name, input }],
});

let seq = 0;
function item(p: { jid?: string; de?: string; texto?: string; message?: unknown; id?: string; quando?: Date; fromMe?: boolean }) {
  return {
    key: { remoteJid: p.jid ?? GRUPO, fromMe: p.fromMe ?? false, id: p.id ?? `QAG${++seq}`, participant: `${p.de ?? CLIENTE}@s.whatsapp.net` },
    message: p.message ?? { conversation: p.texto ?? "Bom dia, segue a documentação" },
    messageTimestamp: Math.floor((p.quando ?? new Date(AGORA.getTime() - 30_000)).getTime() / 1000),
  };
}
const documento = (nome = "rg-maria.pdf", legenda = "meu RG", tamanho = 2048) =>
  ({ documentMessage: { mimetype: "application/pdf", fileName: nome, fileLength: tamanho, caption: legenda } });
const aviso = (...itens: unknown[]) => ({ event: "messages.upsert", instance: "prospecta-dolores", data: itens.length === 1 ? itens[0] : itens });
const chamar = (body: unknown) => tratarWebhookDolores({ headers: { "x-webhook-token": segredoWebhookDolores() }, body, ip: "203.0.113.9" } as never);
const caller = (role: string, id = 1) =>
  appRouter.createCaller({ user: { id, role, active: true, permissions: "[]" }, req: {}, res: {} } as never);
const pedir = (funcao: string, argumentos: unknown, n = 1) => executarFuncao({ funcao, argumentos, pedidoId: `wa:9:${n}:0` }, { canal: "whatsapp", mensagemId: 9 });

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}', ia_ligada = true,
      limite_mensal_tokens_entrada = 1000000, limite_mensal_tokens_saida = 100000 WHERE id = 1;
    INSERT INTO dolores_grupos (instancia, grupo_jid, nome, ativo) VALUES ('prospecta-dolores', '${GRUPO}', 'Documentação — cliente novo', true);
    UPDATE dolores_grupos_config SET classificacao_ligada = true WHERE id = 1;`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  esquecerUsuarioDolores();
  definirDependenciasPonte({ agora: () => AGORA });
  enviar = vi.fn(async () => true);
  definirDependenciasWhatsapp({ agora: () => AGORA, enviar: enviar as never });
  vi.mocked(configuracaoAnthropicPainel).mockResolvedValue({ apiKey: "sk-ant-chave-de-teste-nao-real-123456", modelo: "modelo-do-painel" });
  conversa = vi.fn(async () => { throw new Error("o modelo de conversa não pode ser chamado por mensagem de grupo"); });
  definirClienteModelo(conversa as never);
  pedidosIa = [];
  respostaIa = () => ehToolUse({ tipo: "rg", confianca: 0.92, motivo: "documento de identidade com foto" });
  baixar = vi.fn(async () => ({ base64: PDF }));
  definirDependenciasClassificacao({ cliente: async p => { pedidosIa.push(JSON.parse(JSON.stringify(p))); return respostaIa(p); }, baixar: baixar as never });
  let s = 0;
  definirSorteioCodigo(() => ((s++ * 5) % 22) / 22 + 0.001);
  vi.mocked(uploadPrivateDocument).mockClear();
});
afterEach(() => {
  ENV.cookieSecret = segredoAntes;
  definirDependenciasPonte(); definirDependenciasWhatsapp(); definirClienteModelo(); definirDependenciasClassificacao(); definirSorteioCodigo();
  vi.clearAllMocks();
});

/** Documento chega no grupo → card criado pela fila → documento salvo pela fila. Devolve o lead_documents criado. */
async function documentoSalvoPelaDolores() {
  definirDependenciasPonte({ agora: () => new Date() });
  await chamar(aviso(item({ message: documento("rg.pdf", "RG") })));
  await pedir("criar_card_cliente", { grupoId: 1, nome: "Carla Nova", telefone: "99 98888-1111" });
  const [card] = await fila();
  expect((await decidir([card.codigo], "aprovar", decisorDaTela(1)))[0]).toMatchObject({ ok: true });
  await pedir("salvar_documentos_grupo", { grupoId: 1 }, 2);
  const doc = (await fila()).find(i => i.funcao === "salvar_documentos_grupo")!;
  expect((await decidir([doc.codigo], "aprovar", decisorDaTela(1)))[0]).toMatchObject({ ok: true });
  const [ld] = await q<{ id: number; lead_id: number }>("SELECT id, lead_id FROM lead_documents WHERE drive_file_id = 'drive-novo-1'");
  expect((await mensagens())[0]).toMatchObject({ situacao: "salvo", lead_document_id: ld.id });
  return ld;
}

describe("QA-B (achado 1): a 0126 não quebra nenhuma exclusão legítima que já existia", () => {
  it("documento salvo pela Dolores: a exclusão definitiva pela tela do CRM funciona; a mensagem continua 'salvo', sem o vínculo", async () => {
    const ld = await documentoSalvoPelaDolores();
    const r = await (caller("admin") as any).leadDocuments.excluirDefinitivo({ id: ld.id });
    expect(r).toMatchObject({ success: true });
    expect(vi.mocked(enviarParaLixeira)).toHaveBeenCalledWith("drive-novo-1");
    expect((await q(`SELECT count(*)::int n FROM lead_documents WHERE id = ${ld.id}`))[0].n).toBe(0);
    const [m] = await mensagens();
    expect(m).toMatchObject({ situacao: "salvo", lead_document_id: null, classificacao: "rg" });
    // "salvo" continua final: nem voltar, nem trocar a classificação, nem apontar para outro documento
    await expect(banco.pg.query(`UPDATE dolores_grupo_mensagens SET situacao = 'classificado' WHERE id = ${m.id}`)).rejects.toThrow(/DOLORES_GRUPO_MENSAGENS_SALVO/);
    await expect(banco.pg.query(`UPDATE dolores_grupo_mensagens SET classificacao = 'cnh' WHERE id = ${m.id}`)).rejects.toThrow(/DOLORES_GRUPO_MENSAGENS_SALVO/);
    const [outro] = await q<{ id: number }>(`INSERT INTO lead_documents (lead_id, type, status) VALUES (${ld.lead_id}, 'rg', 'pending') RETURNING id`);
    await expect(banco.pg.query(`UPDATE dolores_grupo_mensagens SET lead_document_id = ${outro.id} WHERE id = ${m.id}`)).rejects.toThrow(/DOLORES_GRUPO_MENSAGENS_SALVO/);
    await expect(banco.pg.query(`DELETE FROM dolores_grupo_mensagens WHERE id = ${m.id}`)).rejects.toThrow(/SEM_EXCLUSAO/);
  });

  it("lead arquivado com documento salvo pela Dolores e grupo ligado: a exclusão definitiva do lead (o SQL real de db.ts) funciona", async () => {
    const ld = await documentoSalvoPelaDolores();
    expect((await q("SELECT lead_id FROM dolores_grupos WHERE id = 1"))[0].lead_id).toBe(ld.lead_id);
    await banco.pg.query(`UPDATE leads SET deleted_at = now() WHERE id = ${ld.lead_id}`);
    // o MESMO SQL de excluirLeadArquivadoDefinitivamente (server/db.ts), lido do fonte: a função usa o getDb interno do módulo,
    // que o teste não consegue trocar pelo PGlite
    const fonte = readFileSync(new URL("../db.ts", import.meta.url), "utf8");
    const corpo = /export async function excluirLeadArquivadoDefinitivamente[\s\S]*?sql`([\s\S]*?)`\);/.exec(fonte)?.[1];
    expect(corpo).toMatch(/DELETE FROM lead_documents WHERE lead_id IN/);
    // tabelas que o banco de teste não gera (sem linhas: só para o NOT EXISTS do SQL real rodar)
    await banco.pg.exec("CREATE TABLE IF NOT EXISTS avaliacoes (lead_id integer); CREATE TABLE IF NOT EXISTS portal_contracts (lead_id integer);");
    const r = await banco.pg.query<{ count: number }>(corpo!.replaceAll("${id}", String(ld.lead_id)));
    expect(r.rows[0].count).toBe(1);
    expect((await q(`SELECT count(*)::int n FROM leads WHERE id = ${ld.lead_id}`))[0].n).toBe(0);
    expect((await q("SELECT lead_id FROM dolores_grupos WHERE id = 1"))[0].lead_id).toBeNull();
    expect((await mensagens())[0]).toMatchObject({ situacao: "salvo", lead_document_id: null });
  });

  it("usuário que cadastrou e editou grupo (e mexeu na configuração) pode ser excluído em Configurações › Usuários", async () => {
    await banco.pg.exec("UPDATE users SET role = 'admin' WHERE id = 2");
    const bia = caller("admin", 2) as any;
    const { id } = await bia.dolores.grupos.cadastrar({ grupoJid: "120363444444444444@g.us", nome: "Grupo da Bia" });
    await bia.dolores.grupos.atualizar({ id, nome: "Grupo da Bia (ok)" });
    await bia.dolores.grupos.configurar({ retencaoDias: 20 }).catch(() => undefined);
    expect(await (caller("admin", 1) as any).configuracoes.deleteUser({ id: 2 })).toMatchObject({ success: true });
    expect((await q(`SELECT criado_por_user_id, atualizado_por_user_id FROM dolores_grupos WHERE id = ${id}`))[0]).toEqual({ criado_por_user_id: null, atualizado_por_user_id: null });
    const tela = await q<{ autor_user_id: number | null; resumo: any }>("SELECT autor_user_id, resumo FROM dolores_acoes WHERE canal = 'tela' ORDER BY id");
    expect(tela.length).toBeGreaterThanOrEqual(2);
    for (const a of tela) { expect(a.autor_user_id).toBeNull(); expect(a.resumo.porUserId).toBe(2); }
  });

  it("obra excluída: o grupo ligado a ela fica sem vínculo (o SET NULL passa pelo gatilho do grupo)", async () => {
    await banco.pg.exec("UPDATE dolores_grupos SET obra_id = 2 WHERE id = 1");
    await banco.pg.exec("DELETE FROM construction_projects WHERE id = 2");
    expect((await q("SELECT obra_id, grupo_jid FROM dolores_grupos WHERE id = 1"))[0]).toEqual({ obra_id: null, grupo_jid: GRUPO });
  });
});
