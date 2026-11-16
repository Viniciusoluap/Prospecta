// EPIC-025 (Dolores, etapa 3) — preparar_cobranca (FILA: mensagem a cliente só com aprovação do dono, seção 5 do prompt
// mestre; e o envio a clientes ainda não foi liberado). A Dolores PREPARA: confere o cliente, os documentos pendentes
// reais (mesma regra de `listar_documentos`), o último contato registrado (para não repetir contato) e o consentimento
// LGPD do cadastro, e monta o texto pelo SISTEMA (nada do modelo nem de dados livres entra na mensagem). Aprovada, a
// cobrança vira um registro no histórico do cliente e o texto volta ao dono — NUNCA é enviada ao cliente por ela, nunca
// registra pagamento nem mexe em documento.
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { leadActivities, leads, whatsappMessages } from "../../../drizzle/schema.js";
import { textoDaCobranca, textoDeDado } from "../../../shared/dolores/fila.js";
import { diaFortaleza } from "../../../shared/dolores/formato.js";
import { entradaListarDocumentos, listarDocumentos } from "../leitura/documentos.js";
import { emTransacaoDeEscrita } from "../escrita.js";
import { bancoDaLeitura, emTransacaoSomenteLeitura } from "../somente-leitura.js";
import { gravarAcompanhamento } from "./acompanhamentos.js";
import { RecusaAcao, type ContextoAcao, type Preparo, type ResultadoAcao } from "./comum.js";

export const entradaPrepararCobranca = z.object({
  leadIds: z.array(z.number().int().positive().max(2_147_483_647)).min(1).max(10)
    .describe("Ids dos clientes do CRM com documentos pendentes (até 10 por chamada; use listar_documentos antes)."),
}).strict();

export const entradaCobrancaAprovada = z.object({
  leadId: z.number().int().positive(),
  documentos: z.array(z.string().max(200)).max(60),
  texto: z.string().max(3000),
}).strict();

const dataBr = (d: Date | null) => (d ? diaFortaleza(d)!.split("-").reverse().join("/") : null);

type Situacao = { lead: { id: number; name: string; lgpdConsent: boolean | null }; documentos: string[]; ultimoContato: Date | null };

/** Situação atual do cliente (dentro de uma transação SOMENTE LEITURA): cadastro, pendências e último contato. */
async function situacaoDoCliente(leadId: number, agora: Date): Promise<Situacao | null> {
  const db = bancoDaLeitura();
  const [lead] = await db.select({ id: leads.id, name: leads.name, lgpdConsent: leads.lgpdConsent }).from(leads)
    .where(and(eq(leads.id, leadId), isNull(leads.deletedAt))).limit(1);
  if (!lead) return null;
  const r = await listarDocumentos(entradaListarDocumentos.parse({ leadId, situacao: "pendentes", limite: 50 }));
  const itens = ((r.dados as { itens?: Array<{ documento: string }> }).itens ?? []).map(i => i.documento);
  const documentos = Array.from(new Set(itens));
  // último contato com o cliente registrado: atividade de mensagem/ligação/documento/follow-up ou WhatsApp enviado
  const [atividade] = await db.select({ em: leadActivities.createdAt }).from(leadActivities)
    .where(and(eq(leadActivities.leadId, leadId), inArray(leadActivities.type, ["message", "call", "follow_up", "document"])))
    .orderBy(desc(leadActivities.createdAt)).limit(1);
  const [whats] = await db.select({ em: whatsappMessages.createdAt }).from(whatsappMessages)
    .where(and(eq(whatsappMessages.leadId, leadId), eq(whatsappMessages.direcao, "saida"))).orderBy(desc(whatsappMessages.createdAt)).limit(1);
  const datas = [atividade?.em, whats?.em].filter((d): d is Date => d instanceof Date && d.getTime() <= agora.getTime());
  const ultimoContato = datas.length ? new Date(Math.max(...datas.map(d => d.getTime()))) : null;
  return { lead, documentos, ultimoContato };
}

/** Resumo para o dono (quadro de pendências): nome e documentos são DADOS — uma linha só, sem colchetes (achado 7). */
function resumoDaCobranca(s: Situacao): string {
  const docs = s.documentos.slice(0, 6).map(d => textoDeDado(d, 80)).join(", ") + (s.documentos.length > 6 ? ` e mais ${s.documentos.length - 6}` : "");
  return textoDeDado(`Cobrança de documentos para ${textoDeDado(s.lead.name, 80)} (cliente ${s.lead.id}) — rascunho, não será enviada: ${s.documentos.length} pendente(s): ${docs}. `
    + `Último contato registrado: ${dataBr(s.ultimoContato) ?? "nenhum"}. Consentimento LGPD no cadastro: ${s.lead.lgpdConsent ? "sim" : "NÃO registrado"}.`, 600);
}

export async function prepararCobranca(args: z.infer<typeof entradaPrepararCobranca>, ctx: ContextoAcao): Promise<Preparo> {
  const preparo: Preparo = { itens: [], recusados: [] };
  for (const leadId of Array.from(new Set(args.leadIds))) {
    const s = await emTransacaoSomenteLeitura(() => situacaoDoCliente(leadId, ctx.agora));
    if (!s) { preparo.recusados.push({ alvo: `cliente ${leadId}`, motivo: "cliente não encontrado no CRM (ou excluído)" }); continue; }
    if (!s.documentos.length) { preparo.recusados.push({ alvo: `cliente ${leadId}`, motivo: "nenhum documento pendente registrado" }); continue; }
    preparo.itens.push({
      alvo: `lead:${leadId}`,
      resumo: resumoDaCobranca(s).slice(0, 600),
      argumentos: { leadId, documentos: s.documentos.slice(0, 60), texto: textoDaCobranca({ nome: s.lead.name, documentos: s.documentos }) },
    });
  }
  return preparo;
}

/** Item aprovado: revalida (cliente existe, ainda há pendência) e registra no histórico. Nada é enviado ao cliente. */
export async function executarCobrancaAprovada(args: z.infer<typeof entradaCobrancaAprovada>, ctx: ContextoAcao): Promise<ResultadoAcao> {
  const s = await emTransacaoSomenteLeitura(() => situacaoDoCliente(args.leadId, ctx.agora));
  if (!s) throw new RecusaAcao("O cliente não existe mais no CRM; nada foi registrado.");
  if (!s.documentos.length) {
    return { dados: { leadId: s.lead.id, nadaPendente: true }, resumo: { registrada: false, nadaPendente: true },
      feitos: [textoDeDado(`Cobrança de ${s.lead.name}: nada mais pendente na hora da aprovação; nada registrado.`, 300)] };
  }
  // O dono aprovou ESTA lista e ESTE texto: se as pendências mudaram entre o pedido e a aprovação, não registra outra
  // coisa — recusa e pede novo preparo (como a PCI com rascunho alterado).
  if (s.documentos.slice(0, 60).join("|") !== args.documentos.join("|")) {
    throw new RecusaAcao("A lista de documentos pendentes mudou depois do pedido; nada foi registrado. Peça de novo para eu preparar a cobrança com a lista atual.");
  }
  const texto = args.texto;
  const registro = `Cobrança de documentos preparada pela Dolores e aprovada pelo dono em ${dataBr(ctx.agora)}. NÃO foi enviada ao cliente `
    + `(o envio pela Dolores ainda não foi liberado): a equipe envia pelo canal de costume. Pendentes: ${s.documentos.join(", ")}.\n\nTexto preparado:\n${texto}`;
  const frase = textoDeDado(`Cobrança de ${s.lead.name} registrada no histórico (não enviada)`, 300);
  const id = await emTransacaoDeEscrita(() => gravarAcompanhamento(ctx, { leadId: s.lead.id, tipo: "note", texto: registro.slice(0, 4000), funcao: "preparar_cobranca", resumo: frase }));
  return {
    dados: { leadId: s.lead.id, acompanhamentoId: id, enviada: false, textoPreparado: texto },
    resumo: { registrada: true, enviada: false, documentos: s.documentos.length },
    feitos: [frase],
  };
}
