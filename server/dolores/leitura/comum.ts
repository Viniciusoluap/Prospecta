// EPIC-025 (Dolores, etapa 1) — peças comuns das leituras. SOMENTE LEITURA: nenhum arquivo desta pasta grava no
// banco (teste estático e em tempo de execução em server/dolores/leitura-somente.test.ts).
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { users } from "../../../drizzle/schema.js";
import { CLIENT_DOCUMENT_CHECKLIST } from "../../../shared/client-document-checklist.js";
import { bancoDaLeitura } from "../somente-leitura.js";

/** Conexão das leituras: dentro da ponte, uma transação READ ONLY (server/dolores/somente-leitura.ts). */
export const db = () => bancoDaLeitura();

/** Teto de linhas lidas do banco por consulta (a página devolvida é bem menor). */
export const MAX_LINHAS_LIDAS = 2000;

export const paginacao = {
  pagina: z.number().int().min(1).max(500).default(1).describe("Página (começa em 1)."),
  limite: z.number().int().min(1).max(50).default(20).describe("Itens por página (até 50)."),
};

export const idPositivo = z.number().int().positive();

/** Resultado de cada função: os dados e o resumo em contagens (vai para a auditoria). */
export type Resultado = { dados: unknown; resumo: Record<string, number | string | boolean | null> };

export async function nomesDeUsuarios(ids: readonly (number | null | undefined)[]): Promise<Map<number, string>> {
  const unicos = Array.from(new Set(ids.filter((x): x is number => typeof x === "number")));
  if (!unicos.length) return new Map();
  const linhas = await db().select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, unicos));
  return new Map(linhas.map(u => [u.id, u.name?.trim() || `Usuário #${u.id}`]));
}

const ROTULOS_DOC: Record<string, string> = {
  ...Object.fromEntries(CLIENT_DOCUMENT_CHECKLIST.map(([k, v]) => [k, v])),
  cnh: "CNH", income_proof_irpf: "Declaração de IRPF",
};
export const rotuloDocumento = (tipo: string) => ROTULOS_DOC[tipo] ?? tipo;

export const SITUACAO_DOC_CLIENTE: Record<string, string> = {
  pending: "pendente", received: "recebido", approved: "aprovado", rejected: "recusado (enviar de novo)",
};
/** Documento do cliente que ainda exige ação: não enviado ou recusado. */
export const docClientePendente = (status: string) => status === "pending" || status === "rejected";

/** Documento do cadastro antigo da regularização: recebido se tem arquivo ou status de recebido/aprovado. */
export function docRegularizacaoRecebido(d: { status: string; temArquivo: boolean }) {
  return d.temArquivo || ["received", "approved", "recebido", "aprovado", "entregue", "ok"].includes(d.status.toLowerCase());
}

export const PRIORIDADE: Record<string, string> = { low: "baixa", medium: "média", high: "alta", critical: "crítica" };
export const SITUACAO_TAREFA: Record<string, string> = { pending: "pendente", in_progress: "em andamento", done: "concluída", cancelled: "cancelada" };
export const tarefaAberta = (status: string) => status === "pending" || status === "in_progress";
