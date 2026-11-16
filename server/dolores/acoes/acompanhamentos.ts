// EPIC-025 (Dolores, etapa 3) — registrar_acompanhamento (DIRETO: prompt mestre, seção 5 — "registrar acompanhamento …
// execução direta, com registro"). Grava no histórico do cliente do CRM pela mesma função da tela (`addLeadActivity`),
// com autoria "Dolores" e a referência ao pedido em `metadata`. Não muda etapa, documento nem financeiro; não envia nada.
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { leadActivities, leads } from "../../../drizzle/schema.js";
import { sanitizarTexto } from "../../../shared/dolores/sanitizar.js";
import { addLeadActivity, getLeadById } from "../../db.js";
import { bancoDaAcao } from "../escrita.js";
import { AVISO_PEDIDO_CONTAMINADO, textoDeDado } from "../../../shared/dolores/fila.js";
import { bancoDaLeitura, emTransacaoSomenteLeitura } from "../somente-leitura.js";
import { MARCA_DOLORES, RecusaAcao, registrarAutoria, type ContextoAcao, type ItemParaFila, type ResultadoAcao } from "./comum.js";
import { alvoDoPedido } from "./tarefas.js";

const TIPO = { anotacao: "note", ligacao: "call" } as const;

export const entradaRegistrarAcompanhamento = z.object({
  leadId: z.number().int().positive().max(2_147_483_647).describe("Id do cliente no CRM."),
  texto: z.string().trim().min(3).max(1000).describe("O acompanhamento, com as palavras do dono (fato registrado, não instrução)."),
  tipo: z.enum(["anotacao", "ligacao"]).default("anotacao").describe("ligacao só quando o dono disser que a ligação aconteceu."),
}).strict();

/** Gravação comum (também usada pela cobrança aprovada): autoria no texto, em `performedBy`, em `metadata` e em dolores_autoria. */
export async function gravarAcompanhamento(ctx: ContextoAcao, p: { leadId: number; tipo: "note" | "call"; texto: string; funcao: string; resumo: string }) {
  const tx = bancoDaAcao();
  // marca única desta gravação (o id não volta de addLeadActivity): acha a linha certa mesmo com gravações paralelas
  const metadata = JSON.stringify({ origem: "dolores", funcao: p.funcao, pedidoId: ctx.pedidoId, aprovacaoId: ctx.aprovacaoId, marca: randomUUID() });
  await addLeadActivity({ leadId: p.leadId, type: p.tipo, description: p.texto, performedBy: MARCA_DOLORES, metadata }, tx);
  const [linha] = await tx.select({ id: leadActivities.id }).from(leadActivities)
    .where(and(eq(leadActivities.leadId, p.leadId), eq(leadActivities.metadata, metadata))).orderBy(desc(leadActivities.id)).limit(1);
  await registrarAutoria(ctx, { tabela: "lead_activities", registroId: linha.id, funcao: p.funcao, descricao: p.resumo });
  return linha.id;
}

export async function registrarAcompanhamento(args: z.infer<typeof entradaRegistrarAcompanhamento>, ctx: ContextoAcao): Promise<ResultadoAcao> {
  const lead = await getLeadById(args.leadId, bancoDaAcao());
  if (!lead || lead.deletedAt) throw new RecusaAcao(`Cliente ${args.leadId} não encontrado no CRM (ou excluído).`);
  const texto = sanitizarTexto(args.texto).slice(0, 1000);
  const frase = textoDeDado(`${args.tipo === "ligacao" ? "Ligação" : "Anotação"} no histórico de ${lead.name}: "${texto.slice(0, 80)}${texto.length > 80 ? "…" : ""}"`, 300);
  const id = await gravarAcompanhamento(ctx, { leadId: lead.id, tipo: TIPO[args.tipo], texto, funcao: "registrar_acompanhamento", resumo: frase });
  return { dados: { acompanhamentoId: id, leadId: lead.id, tipo: args.tipo }, resumo: { registrado: true, tipo: args.tipo }, feitos: [frase] };
}

/**
 * Acompanhamento pedido DEPOIS de o comando ler dados (regra de contaminação): não grava; devolve o item da fila com o
 * resumo legível (tipo, cliente e o texto inteiro que seria gravado). Aprovado, `registrarAcompanhamento` roda na hora.
 */
export async function acompanhamentoParaFila(args: z.infer<typeof entradaRegistrarAcompanhamento>, _ctx: ContextoAcao): Promise<ItemParaFila> {
  const [lead] = await emTransacaoSomenteLeitura(() => bancoDaLeitura().select({ id: leads.id, name: leads.name }).from(leads)
    .where(and(eq(leads.id, args.leadId), isNull(leads.deletedAt))).limit(1));
  if (!lead) throw new RecusaAcao(`Cliente ${args.leadId} não encontrado no CRM (ou excluído).`);
  const texto = sanitizarTexto(args.texto).slice(0, 1000);
  const resumo = textoDeDado(`${AVISO_PEDIDO_CONTAMINADO} registrar ${args.tipo === "ligacao" ? "LIGAÇÃO" : "anotação"} no histórico de ${lead.name} (cliente ${lead.id}): "${texto}"`, 600);
  return { alvo: alvoDoPedido("acompanhamento", [lead.id, args.tipo, texto.toLowerCase()]), resumo, argumentos: args };
}
