// Onde cada documento fica no Google Drive (ver shared/drive-estrutura.ts).
// Só consultas ao banco: as chamadas ao Drive ficam em drive-documents.ts.
import { eq } from "drizzle-orm";
import { incorporationStudies, leads, leadServices, financiamentoChecklistItems } from "../drizzle/schema.js";
import { areaDoServico, caminhoCliente, caminhoEstudo, type AreaCliente, type PastaAlvo } from "../shared/drive-estrutura.js";
import { lerDueDiligence } from "../shared/incorporacao/due-diligence.js";
import { DOCUMENTOS_PADRAO_REGISTRO, type DocumentoRegistro } from "../shared/incorporacao/registro-incorporacao.js";
import { getDb } from "./db.js";

export const ITEM_LEVANTAMENTO = "levantamento_topografico";

/** Categorias que não vêm de um serviço do CRM e já definem a área. */
const AREA_DA_CATEGORIA: Record<string, AreaCliente> = {
  juridico: "juridico",
  financiamento_checklist: "financiamento",
};

export async function caminhoDocumentoCliente(leadId: number, serviceId: number | null, categoria: string): Promise<PastaAlvo[]> {
  const db = getDb();
  const [lead] = await db.select({ nome: leads.name }).from(leads).where(eq(leads.id, leadId)).limit(1);
  let area = categoria.startsWith("financiamento_checklist:") ? "financiamento" as AreaCliente : AREA_DA_CATEGORIA[categoria];
  if (!area) {
    const [servico] = serviceId
      ? await db.select({ tipo: leadServices.serviceType }).from(leadServices).where(eq(leadServices.id, serviceId)).limit(1)
      : [];
    area = areaDoServico(servico?.tipo ?? null);
  }
  const caminho = caminhoCliente({ id: leadId, numero: leadId, nome: lead?.nome ?? null }, area);
  if (categoria.startsWith("financiamento_checklist:")) {
    const [, financingId, itemId] = categoria.split(":");
    caminho.push({ chave: `cliente:${leadId}:financiamento:${financingId}`, nome: `Financiamento (nº ${financingId})` });
    const [checklist] = await db.select({ item: financiamentoChecklistItems.item }).from(financiamentoChecklistItems).where(eq(financiamentoChecklistItems.id, Number(itemId))).limit(1);
    caminho.push({ chave: `cliente:${leadId}:financiamento:${financingId}:documento:${itemId}`, nome: checklist?.item ?? `Documento (nº ${itemId})` });
  }
  return caminho;
}

function documentosDoRegistro(json: string | null): DocumentoRegistro[] {
  const padrao = DOCUMENTOS_PADRAO_REGISTRO.map((nome, i) => ({ id: `padrao-${i}`, nome, status: "pendente" }) as DocumentoRegistro);
  if (!json) return padrao;
  try {
    const parsed = JSON.parse(json) as { documentos?: DocumentoRegistro[] };
    return Array.isArray(parsed.documentos) && parsed.documentos.length ? parsed.documentos : padrao;
  } catch {
    return padrao;
  }
}

/** Pasta da etapa (Levantamento, Due Diligence — <etapa>, Registro) e rótulo do documento. */
export async function destinoDocumentoEstudo(studyId: number, itemId: string): Promise<{ caminho: PastaAlvo[]; rotulo: string }> {
  const [estudo] = await getDb().select({
    name: incorporationStudies.name, dueDiligenceJson: incorporationStudies.dueDiligenceJson,
    incorporationRegistrationJson: incorporationStudies.incorporationRegistrationJson,
  }).from(incorporationStudies).where(eq(incorporationStudies.id, studyId)).limit(1);
  const base = { id: studyId, numero: studyId, nome: estudo?.name ?? null };
  if (itemId === ITEM_LEVANTAMENTO) {
    return { caminho: caminhoEstudo(base, { chave: "levantamento", nome: "Levantamento topográfico" }), rotulo: "Levantamento topográfico" };
  }
  if (itemId.startsWith("dd_")) {
    const [, etapaId, documentoId] = itemId.split("_");
    let etapas: ReturnType<typeof lerDueDiligence>["etapas"] = [];
    try { etapas = lerDueDiligence(estudo?.dueDiligenceJson).etapas; } catch { /* JSON ilegível: nomes genéricos */ }
    const etapa = etapas.find((e) => e.id === etapaId);
    const documento = etapa?.documentos.find((d) => d.id === documentoId);
    return {
      caminho: caminhoEstudo(base, { chave: `dd-${etapaId}`, nome: `Due Diligence — ${etapa?.nome ?? "etapa"}` }),
      rotulo: documento?.nome ?? "Documento",
    };
  }
  const documento = documentosDoRegistro(estudo?.incorporationRegistrationJson ?? null).find((d) => d.id === itemId);
  return { caminho: caminhoEstudo(base, { chave: "registro", nome: "Registro do loteamento" }), rotulo: documento?.nome ?? "Documento" };
}
