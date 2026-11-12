// Central de Vendas (12/11/2026) — retorno da análise. A decisão (pendente, aprovado, reprovado) é sempre de
// um humano: exige o usuário (admin ou analista da Central, ativo) e o banco recusa decisão sem `decisao_por`.
// Cada decisão dispara a mensagem e o próximo passo automaticamente.
import { and, eq, inArray } from "drizzle-orm";
import { leadActivities, leads, users } from "../../drizzle/schema.js";
import { centralVendasLeads } from "../../drizzle/schema-central-vendas.js";
import type { DecisaoAnalise } from "../../shared/central-vendas/config.js";
import { etapaAvancada } from "../../shared/central-vendas/regras.js";
import { agora, avisar, carregarConfig, dadosDoLead, db, registrarEvento } from "./base.js";
import { enfileirarTemplate, processarFila } from "./envio.js";

export class DecisaoInvalida extends Error {}

/** Só admin ou analista marcado na Central, ativo, decide. */
export async function podeDecidir(userId: number): Promise<boolean> {
  const [u] = await db().select({ id: users.id, role: users.role, active: users.active }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u || !u.active) return false;
  if (u.role === "admin") return true;
  return u.role === "colaborador" && (await carregarConfig()).analistas.includes(u.id);
}

export async function registrarDecisao(p: { leadId: number; decisao: DecisaoAnalise; pendencias?: string | null; motivoInterno?: string | null; userId: number }) {
  if (!Number.isInteger(p.userId) || !(await podeDecidir(p.userId))) throw new DecisaoInvalida("Só o administrador ou um analista da Central registra a decisão.");
  const pendencias = p.pendencias?.trim() ?? "";
  if (p.decisao === "pendente" && pendencias.length < 3) throw new DecisaoInvalida("Descreva as pendências para o cliente.");
  const quando = agora();
  const r = await db().update(centralVendasLeads).set({
    statusAnalise: p.decisao, decisaoPor: p.userId, decisaoEm: quando, pendenciasAnalise: p.decisao === "pendente" ? pendencias.slice(0, 2000) : null,
    ...(p.decisao === "pendente" ? { statusDocumental: "aguardando_documentos", docsSolicitadosEm: quando } : {}),
    ...(p.decisao === "reprovado" ? { statusAtendimento: "em_atendimento_humano", aguardandoHumanoDesde: quando, primeiraRespostaHumanaEm: null, motivoTransferencia: "reprovado" } : {}),
    updatedAt: quando,
  }).where(and(eq(centralVendasLeads.leadId, p.leadId), inArray(centralVendasLeads.statusAnalise, ["em_analise", "pendente"]))).returning();
  if (!r.length) throw new DecisaoInvalida("O lead não está em análise.");
  const cv = r[0];
  const lead = await dadosDoLead(p.leadId);
  await db().insert(leadActivities).values({
    leadId: p.leadId, type: "status_change", description: `Análise: ${p.decisao}${p.decisao === "pendente" ? ` — ${pendencias}` : ""}.`,
    performedBy: `Usuário #${p.userId}`, metadata: JSON.stringify({ decisao: p.decisao }),
  });
  if (p.decisao === "reprovado" && p.motivoInterno?.trim()) {
    // Motivo fica só no CRM (campo existente); nunca vai ao cliente pela automação.
    await db().update(leads).set({ rejectionReason: p.motivoInterno.trim().slice(0, 2000), updatedAt: quando }).where(eq(leads.id, p.leadId));
  }
  if (p.decisao === "aprovado") {
    const etapa = etapaAvancada(lead?.stage, "approved_projects");
    await db().update(leads).set({ ...(etapa ? { stage: etapa } : {}), temperature: "hot", updatedAt: quando }).where(eq(leads.id, p.leadId));
    await avisar([cv.operadorId], "Central de Vendas: cliente aprovado — follow-up comercial", `${lead?.name ?? "Cliente"} foi aprovado na análise e entrou na fila de follow-up comercial.`, p.leadId);
  } else if (p.decisao === "reprovado") {
    await avisar([cv.operadorId], "Central de Vendas: análise reprovada — atendimento humano", `${lead?.name ?? "Cliente"} teve a análise reprovada. A automação enviou só uma mensagem neutra; continue o atendimento.`, p.leadId);
  }
  await registrarEvento({ tipo: `analise_${p.decisao}`, leadId: p.leadId, origem: "humano", payload: { decididoPor: p.userId } });
  const slug = p.decisao === "pendente" ? "cv-analise-pendente" : p.decisao === "aprovado" ? "cv-analise-aprovado" : "cv-analise-reprovado";
  // Mensagem por iniciativa da empresa: respeita a janela 8h–20h (fora dela, sai na abertura seguinte).
  const job = await enfileirarTemplate({ leadId: p.leadId, slug, chave: `decisao:${p.leadId}:${p.decisao}:${quando.toISOString()}`, proativa: true, documentos: p.decisao === "pendente" ? pendencias : undefined });
  if (job) await processarFila({ ids: [job.id] });
  return { ok: true, decisao: p.decisao };
}
