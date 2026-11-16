// Maquete 3D (EPIC-022) — infraestrutura comum: configuração, leitura dos PDFs guardados e as dependências
// externas (IA e arquivos), substituíveis nos testes. Sem transação interativa (neon-http): as mudanças de
// situação usam UPDATE ... WHERE status/versão RETURNING.
import { APIConnectionError, APIConnectionTimeoutError, APIError, AuthenticationError, PermissionDeniedError, RateLimitError } from "@anthropic-ai/sdk";
import { and, eq, isNull, sql } from "drizzle-orm";
import { projectDocuments } from "../../drizzle/schema.js";
import { maquete3dConfig } from "../../drizzle/schema-maquete-3d.js";
import { lerConfig, type ConfigMaquete, type DocumentoMaquete } from "../../shared/maquete-3d/regras.js";
import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { readPrivateDocument } from "../drive-documents.js";

export const db = () => getDb();

import { abrirPdf, type PdfAberto } from "./pdf-vetorial.js";
export type PdfLido = { nome: string; base64: string };
/** O que vai para a IA numa leitura de prancha (S-03): a imagem da página, um PDF de uma página ou o PDF original. */
export type AnexoIA = { tipo: "imagem"; base64: string } | { tipo: "pdf"; nome: string; base64: string };
/**
 * Chave e modelo da leitura por IA da maquete (EPIC-024 S-03, opção explícita autorizada pelo dono): primeiro a
 * chave cadastrada em Integrações → Anthropic, com o modelo preferencial de lá; sem ela, a ANTHROPIC_API_KEY do
 * servidor com o modelo das configurações da maquete. Nada é escrito em ENV.
 */
export type CredencialIA = { apiKey: string; modelo: string | null; origem: "painel" | "ambiente" };
export type PedidoIA = {
  sistema: string; pedido: string; pdfs: PdfLido[];
  /** Leitura de uma prancha: só o necessário da página (no lugar de `pdfs`). */
  anexos?: AnexoIA[];
  /** JSON Schema da resposta (saída estruturada). */
  esquema: Record<string, unknown>;
  config: ConfigMaquete;
  credencial?: CredencialIA | null;
  /** Tempo que sobra no passo para a resposta da IA. */
  prazoMs?: number;
};
export type RespostaIA = { json: unknown; entrada: number; saida: number; modelo?: string };
export type ClienteIA = (p: PedidoIA) => Promise<RespostaIA>;
/** `alvoId`: id do projeto ou do estudo; para PDF avulso, o id da maquete (use `alvoDoDocumento`). */
export type LeitorPdf = (d: DocumentoMaquete, alvoId: number) => Promise<Buffer>;
export const alvoDoDocumento = (m: { id: number; projectId: number | null; studyId: number | null }, d: DocumentoMaquete): number =>
  d.fonte === "avulso" ? m.id : (m.projectId ?? m.studyId ?? 0);

/** Falha que não adianta repetir sem mudar algo (sem chave, recusa da IA, PDF grande demais). */
export class LeituraIndisponivel extends Error {}

/** Cada passo precisa terminar antes do limite da função na Vercel (60 s). */
export const LIMITE_PASSO_MS = 52_000;

/** Painel primeiro (chave e modelo preferencial); sem chave no painel, a variável de ambiente. */
export async function resolverCredencialIA(
  painel: () => Promise<{ apiKey: string; modelo: string | null } | null> = () => configuracaoAnthropicPainel(),
  ambiente: { anthropicApiKey?: string } = ENV,
): Promise<CredencialIA | null> {
  const p = await painel().catch(() => null);
  if (p?.apiKey) return { apiKey: p.apiKey, modelo: p.modelo || null, origem: "painel" };
  return ambiente.anthropicApiKey ? { apiKey: ambiente.anthropicApiKey, modelo: null, origem: "ambiente" } : null;
}

/** Modelo da leitura: o preferencial do painel (quando a chave é de lá), senão o das configurações da maquete. */
export const modeloDaLeitura = (c: CredencialIA | null | undefined, config: ConfigMaquete) => (c?.origem === "painel" && c.modelo) || config.modeloIA;

const iaPadrao: ClienteIA = async ({ sistema, pedido, pdfs, anexos, esquema, config, credencial, prazoMs }) => {
  const c = credencial ?? (await resolverCredencialIA());
  if (!c) throw new LeituraIndisponivel("Chave da IA não configurada: cadastre-a em Integrações → Anthropic.");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const cliente = new Anthropic({ apiKey: c.apiKey, timeout: Math.max(5_000, Math.min(LIMITE_PASSO_MS, prazoMs ?? LIMITE_PASSO_MS)), maxRetries: 0 });
  const modelo = modeloDaLeitura(c, config);
  const blocos = anexos
    ? anexos.map(a => a.tipo === "imagem"
      ? { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: a.base64 } }
      : { type: "document" as const, title: a.nome, source: { type: "base64" as const, media_type: "application/pdf" as const, data: a.base64 } })
    : pdfs.map(p => ({ type: "document" as const, title: p.nome, source: { type: "base64" as const, media_type: "application/pdf" as const, data: p.base64 } }));
  const r = await cliente.messages.create({
    model: modelo,
    max_tokens: 16000,
    system: sistema,
    output_config: { effort: config.esforcoIA, format: { type: "json_schema", schema: esquema } },
    messages: [{ role: "user", content: [...blocos, { type: "text" as const, text: pedido }] }],
  });
  if (r.stop_reason === "refusal") throw new LeituraIndisponivel("A IA recusou a leitura deste arquivo.");
  if (r.stop_reason === "max_tokens") throw new Error("A resposta da IA foi cortada (prancha com elementos demais para um passo).");
  const texto = r.content.map(b => (b.type === "text" ? b.text : "")).join("");
  let json: unknown;
  try { json = JSON.parse(texto); } catch { throw new Error("A IA devolveu uma resposta que não pôde ser lida."); }
  return { json, entrada: r.usage?.input_tokens ?? 0, saida: r.usage?.output_tokens ?? 0, modelo: r.model || modelo };
};

const leitorPadrao: LeitorPdf = async (d, alvoId) => {
  if (d.fonte === "avulso") {
    // PDF enviado direto no pedido: `alvoId` é o id da maquete.
    const r = await db().execute(sql`SELECT encode(dados, 'base64') AS b64 FROM maquete_3d_arquivos WHERE id = ${d.id} AND maquete_id = ${alvoId}`);
    const b64 = (r as unknown as { rows: { b64: string | null }[] }).rows[0]?.b64;
    if (!b64) throw new LeituraIndisponivel(`Arquivo "${d.nome}" não está mais disponível neste pedido.`);
    return Buffer.from(b64, "base64");
  }
  if (d.fonte === "projeto") {
    const [doc] = await db().select({ driveFileId: projectDocuments.driveFileId }).from(projectDocuments)
      .where(and(eq(projectDocuments.id, d.id), eq(projectDocuments.projectId, alvoId), eq(projectDocuments.status, "active"), isNull(projectDocuments.deletedAt))).limit(1);
    if (!doc?.driveFileId) throw new LeituraIndisponivel(`Arquivo "${d.nome}" não está mais disponível no projeto.`);
    return readPrivateDocument(doc.driveFileId);
  }
  const r = await db().execute(sql`SELECT d.drive_file_id, d.storage, encode(x.data, 'base64') AS b64
    FROM incorporation_registration_documents d
    LEFT JOIN incorporation_registration_file_data x ON x.document_id = d.id AND d.storage = 'banco'
    WHERE d.id = ${d.id} AND d.study_id = ${alvoId} AND d.action = 'uploaded'`);
  const linha = (r as unknown as { rows: { drive_file_id: string | null; b64: string | null }[] }).rows[0];
  if (linha?.b64) return Buffer.from(linha.b64, "base64");
  if (linha?.drive_file_id) return readPrivateDocument(linha.drive_file_id);
  throw new LeituraIndisponivel(`Arquivo "${d.nome}" não está mais disponível no estudo.`);
};

/** Cobrança criada no provedor de pagamento (Asaas). */
export type Cobranca = { id: string; link: string | null; pixImagem: string | null; pixCopiaCola: string | null };
export type Pagador = { id: number; name: string | null; email: string | null; cpf: string | null };
export type MetodoPagamento = "pix" | "boleto" | "cartao";
export type Cobrador = {
  criar: (p: { pagador: Pagador; valor: number; descricao: string; referencia: string; metodo: MetodoPagamento }) => Promise<Cobranca>;
  consultar: (id: string) => Promise<Cobranca>;
};

const cobradorPadrao: Cobrador = {
  criar: async ({ pagador, valor, descricao, referencia, metodo }) => {
    const asaas = await import("../_core/asaas.js");
    const cliente = await asaas.createOrUpdateAsaasCustomer({ name: pagador.name || "Cliente", email: pagador.email || undefined, cpfCnpj: pagador.cpf || undefined, externalReference: `user_${pagador.id}` });
    const vencimento = new Date(agora().getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const pagamento = await asaas.createAsaasPayment({
      customer: cliente.id!, billingType: metodo === "pix" ? "PIX" : metodo === "cartao" ? "CREDIT_CARD" : "BOLETO",
      value: valor, dueDate: vencimento, description: descricao, externalReference: referencia,
    });
    if (!pagamento.id) throw new Error("O Asaas não devolveu o identificador da cobrança.");
    const pix = metodo === "pix" ? await asaas.getAsaasPixQrCode(pagamento.id).catch(() => null) : null;
    return { id: pagamento.id, link: pagamento.invoiceUrl ?? null, pixImagem: pix?.encodedImage ?? null, pixCopiaCola: pix?.payload ?? null };
  },
  consultar: async id => {
    const asaas = await import("../_core/asaas.js");
    const pagamento = await asaas.getAsaasPayment(id);
    const pix = pagamento.billingType === "PIX" ? await asaas.getAsaasPixQrCode(id).catch(() => null) : null;
    return { id, link: pagamento.invoiceUrl ?? null, pixImagem: pix?.encodedImage ?? null, pixCopiaCola: pix?.payload ?? null };
  },
};

/** Envio de e-mail ao cliente. Devolve true quando o servidor de e-mail aceitou a mensagem. */
export type Carteiro = (p: { para: string; nome: string; assunto: string; html: string; maqueteId: number; motivo: "aprovado" | "pronta" }) => Promise<boolean>;
const carteiroPadrao: Carteiro = async ({ para, nome, assunto, html, maqueteId, motivo }) => {
  const { sendEmail } = await import("../_core/email-smtp.js");
  return sendEmail({ to: para, subject: assunto, html, recipientName: nome, templateType: "maquete_3d", metadata: { maqueteId, motivo } });
};

/** Abre um PDF para o leitor geométrico (injetável nos testes). */
export type AbridorPdf = (dados: Buffer) => Promise<PdfAberto>;
type Dependencias = { ia: ClienteIA; credencialIA: () => Promise<CredencialIA | null>; abrirPdf: AbridorPdf; lerPdf: LeitorPdf; agora: () => Date; cobrador: Cobrador; carteiro: Carteiro };
const padrao: Dependencias = { ia: iaPadrao, credencialIA: () => resolverCredencialIA(), abrirPdf: dados => abrirPdf(dados), lerPdf: leitorPadrao, agora: () => new Date(), cobrador: cobradorPadrao, carteiro: carteiroPadrao };
let deps: Dependencias = { ...padrao };

/** Só para testes: troca IA/arquivos/relógio. Sem argumento, volta ao padrão. */
export function definirDependencias(d?: Partial<Dependencias>) { deps = d ? { ...deps, ...d } : { ...padrao }; }
export const dependencias = () => deps;
export const agora = () => deps.agora();

export async function carregarConfig(): Promise<ConfigMaquete> {
  const [r] = await db().select({ dados: maquete3dConfig.dados }).from(maquete3dConfig).where(eq(maquete3dConfig.id, 1)).limit(1);
  return lerConfig(r?.dados);
}

export async function salvarConfig(c: ConfigMaquete, userId: number | null): Promise<void> {
  const dados = JSON.stringify(c);
  await db().insert(maquete3dConfig).values({ id: 1, dados, updatedBy: userId, updatedAt: agora() })
    .onConflictDoUpdate({ target: maquete3dConfig.id, set: { dados, updatedBy: userId, updatedAt: agora() } });
}

/**
 * Tipo do erro da IA. O SDK da Anthropic deixa `name === "Error"` em todas as classes (QA rodada 2, N2): o tipo vem
 * de `instanceof` com as classes do SDK, do nome da classe e do `status` HTTP — nunca de `e.name`.
 */
export type ErroDaIA = "tempo" | "conexao" | "limite" | "chave" | "permissao" | "sobrecarga" | "fora_do_ar" | "recusado" | null;
export function tipoDoErroIA(e: unknown): ErroDaIA {
  const classe = (e as { constructor?: { name?: string } } | null)?.constructor?.name ?? "";
  const bruto = (e as { status?: unknown } | null)?.status;
  const status = typeof bruto === "number" ? bruto : undefined;
  if (e instanceof APIConnectionTimeoutError || classe === "APIConnectionTimeoutError") return "tempo";
  if (e instanceof APIConnectionError || classe === "APIConnectionError") return "conexao";
  if (e instanceof RateLimitError || status === 429) return "limite";
  if (e instanceof AuthenticationError || status === 401) return "chave";
  if (e instanceof PermissionDeniedError || status === 403) return "permissao";
  if (status === 529 || classe === "OverloadedError") return "sobrecarga";
  if (status !== undefined && status >= 500) return "fora_do_ar";
  if (e instanceof APIError || (status !== undefined && status >= 400)) return "recusado";
  return null;
}

const semChave = (t: string) => t.replace(/sk-ant-[\w-]+/g, "***");

/** Mensagem de erro curta e sem dados sensíveis para guardar no passo e mostrar na tela (nunca "429 {}" cru). */
export function erroSeguro(e: unknown): string {
  switch (tipoDoErroIA(e)) {
    case "tempo": return "A leitura deste passo passou do tempo limite. Esta tentativa conta como usada: tentar de novo pode pedir nova confirmação do administrador. Se repetir, reduza o esforço da IA nas configurações.";
    case "conexao": return "Não foi possível falar com a IA agora. Esta tentativa conta como usada: tentar de novo pode pedir nova confirmação do administrador.";
    case "limite": return "Limite de uso da IA atingido. Aguarde um minuto e tente de novo.";
    case "chave": return "Chave da IA inválida ou revogada: confira em Integrações → Anthropic.";
    case "permissao": return "A chave da IA não tem permissão para este modelo ou recurso: confira em Integrações → Anthropic.";
    case "sobrecarga": return "A IA está sobrecarregada agora. Tente de novo este passo em instantes.";
    case "fora_do_ar": return "A IA ficou fora do ar durante a leitura. Tente de novo este passo.";
    case "recusado": {
      // Pedido recusado pela API (400, 404, 413...): o motivo dela, quando houver, sem o JSON cru e sem a chave.
      const status = (e as { status?: number }).status;
      const interno = (e as { error?: { error?: { message?: unknown } } }).error?.error?.message;
      const motivo = typeof interno === "string" && interno.trim() ? ` Motivo: ${semChave(interno.trim()).slice(0, 200)}` : "";
      return `A IA não aceitou o pedido deste passo${status ? ` (código ${status})` : ""}.${motivo}`;
    }
    default: {
      const m = e instanceof Error ? e.message : "Falha desconhecida";
      return semChave(m).slice(0, 300);
    }
  }
}
