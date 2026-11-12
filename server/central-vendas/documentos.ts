// Central de Vendas (12/11/2026) — documentação: checklist por produto/modalidade (editável em tela), lista de
// pendentes após a qualificação, classificação de cada mídia recebida (só metadados: o arquivo nunca sai do
// sistema), lembretes D+N pelo cron diário e o gatilho principal: checklist completo → análise, uma única vez.
import { and, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { leadActivities, leadDocuments, tasks, users, whatsappMessages, whatsappMidias } from "../../drizzle/schema.js";
import { centralVendasChecklists, centralVendasDocumentos, centralVendasLeads, centralVendasProdutos } from "../../drizzle/schema-central-vendas.js";
import { lerItensChecklist, type ConfigCentral } from "../../shared/central-vendas/config.js";
import { classificarPorNome, pendentesDoChecklist, type ItemChecklistLite } from "../../shared/central-vendas/regras.js";
import { agora, avisar, carregarConfig, dadosDoLead, db, registrarEvento, registroCentral, usuariosAtivos } from "./base.js";
import { enfileirarTemplate, processarFila } from "./envio.js";

const LIMIAR_DOCUMENTO = 0.7;
type RegistroCentral = NonNullable<Awaited<ReturnType<typeof registroCentral>>>;

export async function checklistDoLead(cv: RegistroCentral, config: ConfigCentral): Promise<ItemChecklistLite[]> {
  let id = cv.checklistId;
  if (!id && cv.produtoId) {
    const [p] = await db().select({ c: centralVendasProdutos.checklistId }).from(centralVendasProdutos).where(eq(centralVendasProdutos.id, cv.produtoId)).limit(1);
    id = p?.c ?? null;
  }
  id ??= config.checklistPadraoId;
  if (!id) return [];
  const [c] = await db().select().from(centralVendasChecklists).where(and(eq(centralVendasChecklists.id, id), eq(centralVendasChecklists.ativo, true))).limit(1);
  return c ? lerItensChecklist(c.documentos) : [];
}

/** Chaves do checklist já recebidas (documento não excluído nem recusado). "A conferir" conta: o fluxo não para. */
async function chavesRecebidas(leadId: number): Promise<string[]> {
  const r = await db().select({ chave: centralVendasDocumentos.chave }).from(centralVendasDocumentos)
    .innerJoin(leadDocuments, eq(leadDocuments.id, centralVendasDocumentos.leadDocumentId))
    .where(and(eq(centralVendasDocumentos.leadId, leadId), isNotNull(centralVendasDocumentos.chave), isNull(leadDocuments.deletedAt), ne(leadDocuments.status, "rejected")));
  return r.map(x => x.chave!);
}

export const listaPorExtenso = (nomes: string[]) =>
  nomes.length <= 1 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;

export async function documentosPendentes(leadId: number) {
  const cv = await registroCentral(leadId);
  if (!cv) return { itens: [], pendentes: [] as ItemChecklistLite[] };
  const itens = await checklistDoLead(cv, await carregarConfig());
  return { itens, pendentes: pendentesDoChecklist(itens, await chavesRecebidas(leadId)) };
}

/** Envia a lista de documentos pendentes (após a qualificação ou após pendência da análise). */
export async function solicitarDocumentos(leadId: number, motivo: "qualificacao" | "pendencia") {
  const { itens, pendentes } = await documentosPendentes(leadId);
  const cv = await registroCentral(leadId);
  if (!cv) return;
  if (!itens.length) {
    await registrarEvento({ tipo: "sem_checklist", leadId, resultado: "erro", erro: "Nenhum checklist para o produto/modalidade do lead nem checklist padrão." });
    await avisar([cv.operadorId], "Central de Vendas: lead qualificado sem checklist", "Cadastre um checklist (Central de Vendas › Checklists) ou escolha o checklist padrão para enviar a lista de documentos.", leadId);
    return;
  }
  if (!pendentes.length) { await verificarDocumentacao(leadId); return; }
  const quando = agora();
  await db().update(centralVendasLeads).set({
    statusDocumental: pendentes.length < itens.filter(i => i.obrigatorio).length ? "parcial" : "aguardando_documentos",
    docsSolicitadosEm: quando, statusAtendimento: cv.statusAtendimento === "em_atendimento_humano" ? cv.statusAtendimento : "aguardando_cliente", updatedAt: quando,
  }).where(eq(centralVendasLeads.leadId, leadId));
  await registrarEvento({ tipo: "documentos_solicitados", leadId, payload: { motivo, pendentes: pendentes.map(p => p.chave) } });
  if (motivo === "qualificacao") {
    const job = await enfileirarTemplate({ leadId, slug: "cv-documentos-pendentes", chave: `docs:${leadId}:${quando.toISOString()}`, proativa: false, documentos: listaPorExtenso(pendentes.map(p => p.nome)) });
    if (job) await processarFila({ ids: [job.id] });
  }
}

/** Mídia recebida (já guardada em whatsapp_midias e copiada ao Drive) → documento do lead, classificado. */
export async function receberMidia(leadId: number, messageId: number) {
  const config = await carregarConfig();
  if (!config.automacoes.documentos) return null;
  const [ja] = await db().select({ id: centralVendasDocumentos.id }).from(centralVendasDocumentos).where(eq(centralVendasDocumentos.messageId, messageId)).limit(1);
  if (ja) return null;
  const [m] = await db().select({ nome: whatsappMessages.midiaNome, mime: whatsappMessages.midiaMime, tamanho: whatsappMessages.midiaTamanho, texto: whatsappMessages.mensagem, tipo: whatsappMessages.midiaTipo, drive: whatsappMidias.driveFileId })
    .from(whatsappMessages).leftJoin(whatsappMidias, eq(whatsappMidias.messageId, whatsappMessages.id)).where(eq(whatsappMessages.id, messageId)).limit(1);
  if (!m || !m.tipo || m.tipo === "audio" || m.tipo === "figurinha") return null;
  const cv = await registroCentral(leadId);
  if (!cv) return null;
  const itens = await checklistDoLead(cv, config);
  const recebidas = await chavesRecebidas(leadId);
  const candidatos = pendentesDoChecklist(itens, recebidas).length ? pendentesDoChecklist(itens, recebidas) : itens;
  // Legenda escrita pelo cliente (o texto gravado traz "[documento] nome-do-arquivo" antes dela).
  let legenda = m.texto.replace(/^\[(imagem|documento|vídeo)\]\s*/i, "");
  if (m.nome && legenda.startsWith(m.nome)) legenda = legenda.slice(m.nome.length).trim();
  const texto = `${m.nome ?? ""} ${legenda}`;
  let classe = classificarPorNome(texto, candidatos) ?? classificarPorNome(texto, itens);
  if (!classe) {
    const { classificarDocumentoIA } = await import("./ia.js");
    classe = await classificarDocumentoIA({ nome: m.nome, mime: m.mime, legenda }, candidatos, leadId);
  }
  const item = classe ? itens.find(i => i.chave === classe!.chave) : undefined;
  const aConferir = !item || (classe?.confianca ?? 0) < LIMIAR_DOCUMENTO;
  const [doc] = await db().insert(leadDocuments).values({
    leadId, type: (item?.tipo ?? "other") as typeof leadDocuments.$inferInsert.type, fileName: (m.nome ?? `whatsapp-${messageId}`).slice(0, 255),
    fileUrl: `/api/whatsapp/midia/${messageId}`, driveFileId: m.drive ?? null, mimeType: m.mime, fileSize: m.tamanho, status: "received",
    notes: `${aConferir ? "A conferir — " : ""}Recebido pelo WhatsApp e classificado pela Central de Vendas${item ? ` como "${item.nome}"` : ""} (confiança ${Math.round((classe?.confianca ?? 0) * 100)}%).`,
    uploadedAt: agora(),
  }).returning({ id: leadDocuments.id });
  const vinculo = await db().insert(centralVendasDocumentos).values({
    leadId, leadDocumentId: doc.id, messageId, chave: aConferir && !item ? null : item?.chave ?? null, confianca: (classe?.confianca ?? 0).toFixed(3), aConferir, createdAt: agora(),
  }).onConflictDoNothing().returning({ id: centralVendasDocumentos.id });
  if (!vinculo.length) { await db().delete(leadDocuments).where(eq(leadDocuments.id, doc.id)); return null; } // aviso repetido em paralelo
  await db().insert(leadActivities).values({ leadId, type: "document", description: `Documento recebido pelo WhatsApp${item ? `: ${item.nome}` : ""}${aConferir ? " (a conferir)" : ""}.`, performedBy: "Central de Vendas" });
  await registrarEvento({ tipo: "documento_recebido", leadId, payload: { chave: item?.chave ?? null, confianca: classe?.confianca ?? 0, aConferir } });
  if (aConferir) await avisar([cv.operadorId], "Central de Vendas: documento a conferir", "Um documento recebido pelo WhatsApp não foi identificado com segurança. Confira no lead; o atendimento segue.", leadId);
  await verificarDocumentacao(leadId);
  return { leadDocumentId: doc.id, chave: item?.chave ?? null, aConferir };
}

/** Recalcula o status documental; checklist completo dispara o encaminhamento para análise. */
export async function verificarDocumentacao(leadId: number) {
  const cv = await registroCentral(leadId);
  if (!cv || cv.statusAnalise === "em_analise" || cv.statusAnalise === "aprovado" || cv.statusAnalise === "reprovado") return "sem_mudanca";
  const { itens, pendentes } = await documentosPendentes(leadId);
  if (!itens.length) return "sem_checklist";
  if (!pendentes.length) return (await encaminharParaAnalise(leadId)) ? "encaminhado" : "sem_mudanca";
  const recebidas = (await chavesRecebidas(leadId)).length;
  if (recebidas && cv.statusDocumental !== "parcial") await db().update(centralVendasLeads).set({ statusDocumental: "parcial", updatedAt: agora() }).where(eq(centralVendasLeads.leadId, leadId));
  return "parcial";
}

/** Gatilho principal: exatamente uma vez por ciclo (UPDATE condicionado ao estado anterior). */
export async function encaminharParaAnalise(leadId: number): Promise<boolean> {
  const quando = agora();
  const r = await db().update(centralVendasLeads).set({ statusDocumental: "completo", statusAnalise: "em_analise", docsCompletosEm: quando, enviadoAnaliseEm: quando, updatedAt: quando })
    .where(and(eq(centralVendasLeads.leadId, leadId), inArray(centralVendasLeads.statusAnalise, ["nao_enviado", "pendente"]))).returning();
  if (!r.length) return false;
  const cv = r[0];
  const config = await carregarConfig();
  const lead = await dadosDoLead(leadId);
  const analistas = await usuariosAtivos(config.analistas);
  const [responsavel] = analistas.length ? analistas : await usuariosAtivos(cv.operadorId ? [cv.operadorId] : []);
  const [quem] = responsavel ? [responsavel] : await db().select({ id: users.id, nome: users.name }).from(users).where(and(eq(users.role, "admin"), eq(users.active, true))).limit(1);
  await db().insert(tasks).values({
    title: `Análise — ${lead?.name ?? `lead #${leadId}`}`.slice(0, 255),
    description: "Documentação completa recebida pela Central de Vendas. Registre a decisão (pendente, aprovado ou reprovado) na Central de Vendas.",
    assignedTo: (quem?.nome || (quem ? `Usuário #${quem.id}` : "Análise")).slice(0, 100), relatedType: "lead", relatedId: leadId, priority: "high", status: "pending",
    dueAt: new Date(quando.getTime() + 24 * 3600_000),
  });
  await db().insert(leadActivities).values({ leadId, type: "status_change", description: "Documentação completa: encaminhado automaticamente para análise.", performedBy: "Central de Vendas" });
  await avisar([...analistas.map(a => a.id), quem?.id], "Central de Vendas: novo cadastro para análise", `${lead?.name ?? "Cliente"} completou a documentação.`, leadId);
  await registrarEvento({ tipo: "encaminhado_analise", leadId, payload: { responsavel: quem?.id ?? null } });
  const job = await enfileirarTemplate({ leadId, slug: "cv-confirmacao-analise", chave: `analise:${leadId}:${quando.toISOString()}`, proativa: false });
  if (job) await processarFila({ ids: [job.id] });
  return true;
}

/** Lembretes D+N (cron diário): só o maior prazo já vencido de cada pedido; nunca repete o mesmo. */
export async function agendarLembretes() {
  const config = await carregarConfig();
  if (!config.automacoes.lembretes || !config.lembretesDias.length) return 0;
  const linhas = await db().select().from(centralVendasLeads).where(and(
    inArray(centralVendasLeads.statusDocumental, ["aguardando_documentos", "parcial"]), isNotNull(centralVendasLeads.docsSolicitadosEm),
    eq(centralVendasLeads.optOut, false), sql`${centralVendasLeads.statusAnalise} IN ('nao_enviado', 'pendente')`,
  ));
  let n = 0;
  const dias = [...config.lembretesDias].sort((a, b) => b - a);
  for (const cv of linhas) {
    const base = cv.docsSolicitadosEm!;
    const d = dias.find(x => base.getTime() + x * 86_400_000 <= agora().getTime());
    if (!d) continue;
    const { pendentes } = await documentosPendentes(cv.leadId);
    if (!pendentes.length) continue;
    const job = await enfileirarTemplate({ leadId: cv.leadId, slug: "cv-lembrete-documentos", chave: `lembrete:${cv.leadId}:${d}:${base.toISOString()}`, proativa: true, documentos: listaPorExtenso(pendentes.map(p => p.nome)) });
    if (job) n++;
  }
  return n;
}
