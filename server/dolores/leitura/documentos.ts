// EPIC-025 (Dolores, etapa 1) — documentos pendentes e recebidos, por cliente. SOMENTE LEITURA.
// Fontes: documentos do cliente no CRM (lead_documents), documentos do cadastro antigo da regularização e os itens do
// checklist do financiamento que pedem documento. Nunca devolve o arquivo, o link ou o id do Drive — só nome e situação.
import { and, desc, eq, inArray, isNull, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { financiamentoChecklistItems, financiamentos, leadDocuments, leads, regularizacaoDocuments, regularizacoes } from "../../../drizzle/schema.js";
import { diaFortaleza, paginar, truncar } from "../../../shared/dolores/formato.js";
import {
  MAX_LINHAS_LIDAS, SITUACAO_DOC_CLIENTE, db, docClientePendente, docRegularizacaoRecebido, idPositivo, paginacao, rotuloDocumento, type Resultado,
} from "./comum.js";

export const entradaListarDocumentos = z.object({
  leadId: idPositivo.optional().describe("Id do cliente; sem ele, agrupa por cliente."),
  situacao: z.enum(["pendentes", "recebidos", "todos"]).default("pendentes"),
  ...paginacao,
}).strict();

type Doc = { leadId: number | null; cliente: string; documento: string; situacao: string; pendente: boolean; origem: string; em: string | null };

export async function listarDocumentos(args: z.infer<typeof entradaListarDocumentos>): Promise<Resultado> {
  const porLead = args.leadId ? eq(leadDocuments.leadId, args.leadId) : undefined;
  const [docsLead, docsReg, itensFin] = await Promise.all([
    db().select({ leadId: leadDocuments.leadId, cliente: leads.name, type: leadDocuments.type, status: leadDocuments.status,
      uploadedAt: leadDocuments.uploadedAt, createdAt: leadDocuments.createdAt })
      .from(leadDocuments).innerJoin(leads, eq(leads.id, leadDocuments.leadId))
      .where(and(isNull(leadDocuments.deletedAt), isNull(leads.deletedAt), porLead)).orderBy(desc(leadDocuments.createdAt)).limit(MAX_LINHAS_LIDAS),
    db().select({ leadId: regularizacoes.leadId, cliente: regularizacoes.clientName, name: regularizacaoDocuments.name, status: regularizacaoDocuments.status,
      driveFileId: regularizacaoDocuments.driveFileId, fileUrl: regularizacaoDocuments.fileUrl, updatedAt: regularizacaoDocuments.updatedAt })
      .from(regularizacaoDocuments).innerJoin(regularizacoes, eq(regularizacoes.id, regularizacaoDocuments.regularizacaoId))
      .where(args.leadId ? eq(regularizacoes.leadId, args.leadId) : undefined).limit(MAX_LINHAS_LIDAS),
    db().select({ leadId: financiamentos.leadId, cliente: financiamentos.clienteNome, item: financiamentoChecklistItems.item,
      concluido: financiamentoChecklistItems.concluido, enviadoEm: financiamentoChecklistItems.enviadoEm,
      driveFileId: financiamentoChecklistItems.documentoDriveFileId, url: financiamentoChecklistItems.documentoUrl })
      .from(financiamentoChecklistItems).innerJoin(financiamentos, eq(financiamentos.id, financiamentoChecklistItems.financiamentoId))
      .where(and(eq(financiamentoChecklistItems.solicitarDocumento, true), args.leadId ? eq(financiamentos.leadId, args.leadId) : isNotNull(financiamentos.id)))
      .limit(MAX_LINHAS_LIDAS),
  ]);
  const todos: Doc[] = [
    ...docsLead.map(d => ({ leadId: d.leadId, cliente: d.cliente, documento: rotuloDocumento(d.type), situacao: SITUACAO_DOC_CLIENTE[d.status] ?? d.status,
      pendente: docClientePendente(d.status), origem: "documentos do cliente (CRM)", em: diaFortaleza(d.uploadedAt ?? d.createdAt) })),
    ...docsReg.map(d => {
      const recebido = docRegularizacaoRecebido({ status: d.status, temArquivo: !!(d.driveFileId || d.fileUrl) });
      return { leadId: d.leadId, cliente: d.cliente, documento: truncar(d.name, 120) ?? "(sem nome)", situacao: recebido ? "recebido" : "pendente",
        pendente: !recebido, origem: "regularização (cadastro antigo)", em: diaFortaleza(d.updatedAt) };
    }),
    ...itensFin.map(d => {
      const recebido = !!(d.driveFileId || d.url || d.enviadoEm) || d.concluido;
      return { leadId: d.leadId, cliente: d.cliente, documento: truncar(d.item, 120) ?? "(sem nome)", situacao: recebido ? "recebido" : "pendente",
        pendente: !recebido, origem: "checklist do financiamento", em: diaFortaleza(d.enviadoEm) };
    }),
  ];
  const escolhidos = todos.filter(d => args.situacao === "todos" || (args.situacao === "pendentes" ? d.pendente : !d.pendente));
  const totais = { pendentes: todos.filter(d => d.pendente).length, recebidos: todos.filter(d => !d.pendente).length };

  if (args.leadId) {
    const pagina = paginar(escolhidos.map(({ leadId: _l, ...d }) => d), args.pagina, args.limite);
    return { dados: { leadId: args.leadId, totais, ...pagina }, resumo: { encontrados: escolhidos.length, devolvidos: pagina.itens.length, ...totais } };
  }
  const grupos = new Map<string, { leadId: number | null; cliente: string; quantidade: number; documentos: string[] }>();
  for (const d of escolhidos) {
    const chave = d.leadId ? `l${d.leadId}` : `n${d.cliente}`;
    const g = grupos.get(chave) ?? { leadId: d.leadId, cliente: d.cliente, quantidade: 0, documentos: [] };
    g.quantidade++;
    if (g.documentos.length < 8) g.documentos.push(`${d.documento} (${d.situacao})`);
    grupos.set(chave, g);
  }
  const lista = Array.from(grupos.values()).sort((a, b) => b.quantidade - a.quantidade || a.cliente.localeCompare(b.cliente));
  const pagina = paginar(lista, args.pagina, args.limite);
  return {
    dados: { observacao: "Por cliente; até 8 documentos listados em cada um (consulte com leadId para todos).", totais, ...pagina },
    resumo: { clientes: lista.length, devolvidos: pagina.itens.length, ...totais },
  };
}
