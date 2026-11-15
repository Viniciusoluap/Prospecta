// Maquete 3D (EPIC-022) — infraestrutura comum: configuração, leitura dos PDFs guardados e as dependências
// externas (IA e arquivos), substituíveis nos testes. Sem transação interativa (neon-http): as mudanças de
// situação usam UPDATE ... WHERE status/versão RETURNING.
import { and, eq, isNull, sql } from "drizzle-orm";
import { projectDocuments } from "../../drizzle/schema.js";
import { maquete3dConfig } from "../../drizzle/schema-maquete-3d.js";
import { lerConfig, type ConfigMaquete, type DocumentoMaquete } from "../../shared/maquete-3d/regras.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { readPrivateDocument } from "../drive-documents.js";

export const db = () => getDb();

export type PdfLido = { nome: string; base64: string };
export type PedidoIA = {
  sistema: string; pedido: string; pdfs: PdfLido[];
  /** JSON Schema da resposta (saída estruturada). */
  esquema: Record<string, unknown>;
  config: ConfigMaquete;
};
export type RespostaIA = { json: unknown; entrada: number; saida: number };
export type ClienteIA = (p: PedidoIA) => Promise<RespostaIA>;
export type LeitorPdf = (d: DocumentoMaquete, alvoId: number) => Promise<Buffer>;

/** Falha que não adianta repetir sem mudar algo (sem chave, recusa da IA, PDF grande demais). */
export class LeituraIndisponivel extends Error {}

/** Cada passo precisa terminar antes do limite da função na Vercel (60 s). */
export const LIMITE_PASSO_MS = 52_000;

const iaPadrao: ClienteIA = async ({ sistema, pedido, pdfs, esquema, config }) => {
  if (!ENV.anthropicApiKey) throw new LeituraIndisponivel("Chave da IA não configurada (ANTHROPIC_API_KEY).");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const cliente = new Anthropic({ apiKey: ENV.anthropicApiKey, timeout: LIMITE_PASSO_MS, maxRetries: 0 });
  const r = await cliente.messages.create({
    model: config.modeloIA,
    max_tokens: 16000,
    system: sistema,
    output_config: { effort: config.esforcoIA, format: { type: "json_schema", schema: esquema } },
    messages: [{
      role: "user",
      content: [
        ...pdfs.map(p => ({ type: "document" as const, title: p.nome, source: { type: "base64" as const, media_type: "application/pdf" as const, data: p.base64 } })),
        { type: "text" as const, text: pedido },
      ],
    }],
  });
  if (r.stop_reason === "refusal") throw new LeituraIndisponivel("A IA recusou a leitura deste arquivo.");
  if (r.stop_reason === "max_tokens") throw new Error("A resposta da IA foi cortada (prancha com elementos demais para um passo).");
  const texto = r.content.map(b => (b.type === "text" ? b.text : "")).join("");
  let json: unknown;
  try { json = JSON.parse(texto); } catch { throw new Error("A IA devolveu uma resposta que não pôde ser lida."); }
  return { json, entrada: r.usage?.input_tokens ?? 0, saida: r.usage?.output_tokens ?? 0 };
};

const leitorPadrao: LeitorPdf = async (d, alvoId) => {
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

type Dependencias = { ia: ClienteIA; lerPdf: LeitorPdf; agora: () => Date };
const padrao: Dependencias = { ia: iaPadrao, lerPdf: leitorPadrao, agora: () => new Date() };
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

/** Mensagem de erro curta e sem dados sensíveis para guardar no passo e mostrar na tela. */
export function erroSeguro(e: unknown): string {
  const nome = e instanceof Error ? e.name : "";
  if (nome === "APIConnectionTimeoutError") return "A leitura deste passo passou do tempo limite. Tente de novo; se repetir, reduza o esforço da IA nas configurações.";
  if (nome === "RateLimitError") return "Limite de uso da IA atingido. Aguarde um minuto e tente de novo.";
  if (nome === "AuthenticationError") return "Chave da IA inválida (ANTHROPIC_API_KEY).";
  const m = e instanceof Error ? e.message : "Falha desconhecida";
  return m.replace(/sk-ant-[\w-]+/g, "***").slice(0, 300);
}
