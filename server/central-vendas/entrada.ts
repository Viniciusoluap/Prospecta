// Central de Vendas (12/11/2026) — serviço único de entrada de leads (WhatsApp, site e Logyca), com
// deduplicação pela chave do telefone (DDD + 8 últimos dígitos) e pela origem + ID externo, e origem pela
// campanha ([ref:...]). Sem transação: a reivindicação do telefone (central_vendas_contatos) garante um lead só.
import { and, eq, isNull, sql } from "drizzle-orm";
import { leadActivities, leads, whatsappConversationLinks, whatsappMessages } from "../../drizzle/schema.js";
import {
  centralVendasCampanhas, centralVendasContatos, centralVendasLeads, centralVendasProdutos,
} from "../../drizzle/schema-central-vendas.js";
import { ehOptOut, extrairRef, numeroAutorizado, origemDoRef } from "../../shared/central-vendas/regras.js";
import { chaveTelefone } from "../../shared/whatsapp/conversas.js";
import { agora, atualizarCentral, carregarConfig, db, registrarEvento, registroCentral } from "./base.js";
import { atribuirOperador } from "./distribuicao.js";
import { cancelarPendentes, enfileirar, enfileirarTemplate, processarFila } from "./envio.js";

export type OrigemContato = "whatsapp" | "site" | "logyca";
export type Contato = {
  origem: OrigemContato; telefone: string; nome?: string | null; texto?: string | null; idExterno?: string | null;
  campanha?: string | null; email?: string | null; cidade?: string | null; connectionId?: number | null;
};
export type ResultadoEntrada = { leadId: number | null; criado: boolean; motivo?: string };

const nomePadrao = (digitos: string) => `WhatsApp ${digitos}`;
const digitosSem55 = (t: string) => t.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");

async function leadAtivoPorTelefone(phoneKey: string, connectionId?: number | null): Promise<number | null> {
  if (connectionId) {
    const [v] = await db().select({ leadId: whatsappConversationLinks.leadId }).from(whatsappConversationLinks).innerJoin(leads, eq(leads.id, whatsappConversationLinks.leadId))
      .where(and(eq(whatsappConversationLinks.connectionId, connectionId), eq(whatsappConversationLinks.phoneKey, phoneKey), isNull(leads.deletedAt))).limit(1);
    if (v) return v.leadId;
  }
  const ativos = await db().select({ id: leads.id, phone: leads.phone }).from(leads).where(isNull(leads.deletedAt)).orderBy(leads.id);
  return ativos.find(l => chaveTelefone(l.phone) === phoneKey)?.id ?? null;
}

/** Lead que já existia no CRM entra na Central em atendimento humano (a IA só atende quem chegou pela Central). */
async function garantirRegistro(leadId: number, c: Contato) {
  const [l] = await db().select({ responsavel: leads.responsibleUserId, nome: leads.name }).from(leads).where(eq(leads.id, leadId)).limit(1);
  const criado = await db().insert(centralVendasLeads).values({
    leadId, origem: "crm", statusAtendimento: "em_atendimento_humano", operadorId: l?.responsavel ?? null,
    atribuidoEm: l?.responsavel ? agora() : null, connectionId: c.connectionId ?? null, createdAt: agora(), updatedAt: agora(),
  }).onConflictDoNothing().returning({ leadId: centralVendasLeads.leadId });
  if (criado.length) await registrarEvento({ tipo: "lead_existente_vinculado", leadId, origem: c.origem });
  // Fonte oficial é o Prospecta: dado divergente vindo da Logyca não sobrescreve, só é registrado.
  if (c.origem === "logyca" && c.nome && l?.nome && !/^whatsapp\s/i.test(l.nome) && c.nome.trim().toLowerCase() !== l.nome.trim().toLowerCase()) {
    await registrarEvento({ tipo: "conflito_logyca", leadId, origem: "logyca", payload: { campos: ["nome"], prevalece: "prospecta" }, resultado: "ignorado" });
  }
}

export async function receberContato(c: Contato): Promise<ResultadoEntrada> {
  const config = await carregarConfig();
  if (!config.ativo) return { leadId: null, criado: false, motivo: "desligado" };
  const phoneKey = chaveTelefone(c.telefone);
  if (phoneKey.length < 10) return { leadId: null, criado: false, motivo: "telefone_invalido" };
  if (config.modoTeste && !numeroAutorizado(c.telefone, config.numerosTeste)) {
    await registrarEvento({ tipo: "ignorado_modo_teste", origem: c.origem, resultado: "ignorado" });
    return { leadId: null, criado: false, motivo: "modo_teste" };
  }
  const idExterno = c.idExterno?.trim().slice(0, 160) || null;
  if (idExterno) {
    const [ja] = await db().select({ leadId: centralVendasLeads.leadId }).from(centralVendasLeads)
      .where(and(eq(centralVendasLeads.origem, c.origem), eq(centralVendasLeads.idExterno, idExterno))).limit(1);
    if (ja) return { leadId: ja.leadId, criado: false, motivo: "id_externo_repetido" };
  }
  const existente = await leadAtivoPorTelefone(phoneKey, c.connectionId);
  if (existente) { await garantirRegistro(existente, c); return { leadId: existente, criado: false }; }

  // Reivindica o telefone: só quem reivindicar cria o lead (avisos repetidos/simultâneos não duplicam).
  let reivindicado = (await db().insert(centralVendasContatos).values({ phoneKey, createdAt: agora() }).onConflictDoNothing().returning()).length > 0;
  if (!reivindicado) {
    const [ct] = await db().select({ leadId: centralVendasContatos.leadId, apagado: leads.deletedAt }).from(centralVendasContatos)
      .leftJoin(leads, eq(leads.id, centralVendasContatos.leadId)).where(eq(centralVendasContatos.phoneKey, phoneKey)).limit(1);
    if (ct?.leadId && !ct.apagado) { await garantirRegistro(ct.leadId, c); return { leadId: ct.leadId, criado: false }; }
    if (!ct?.leadId) return { leadId: null, criado: false, motivo: "em_processamento" };
    // O lead antigo deste telefone foi excluído: libera a reivindicação uma única vez.
    reivindicado = (await db().update(centralVendasContatos).set({ leadId: null }).where(and(eq(centralVendasContatos.phoneKey, phoneKey), eq(centralVendasContatos.leadId, ct.leadId))).returning()).length > 0;
    if (!reivindicado) return { leadId: null, criado: false, motivo: "em_processamento" };
  }

  const ref = extrairRef(c.texto) ?? (c.campanha ? c.campanha.trim().toLowerCase() : null);
  const [campanhas, produtos] = await Promise.all([
    db().select({ codigo: centralVendasCampanhas.codigo, canal: centralVendasCampanhas.canal, produtoId: centralVendasCampanhas.produtoId }).from(centralVendasCampanhas).where(eq(centralVendasCampanhas.ativo, true)),
    db().select({ id: centralVendasProdutos.id, slug: centralVendasProdutos.slug, checklistId: centralVendasProdutos.checklistId }).from(centralVendasProdutos).where(eq(centralVendasProdutos.ativo, true)),
  ]);
  const origem = origemDoRef(ref, campanhas, produtos);
  const digitos = digitosSem55(c.telefone);
  const [lead] = await db().insert(leads).values({
    name: c.nome?.trim().slice(0, 255) || nomePadrao(digitos), phone: digitos.slice(0, 20), email: c.email?.trim().slice(0, 320) || null,
    city: c.cidade?.trim().slice(0, 100) || null, sourceChannel: (origem.canal ?? c.origem).slice(0, 100), stage: "lead_new",
  }).returning({ id: leads.id });
  await db().update(centralVendasContatos).set({ leadId: lead.id }).where(eq(centralVendasContatos.phoneKey, phoneKey));
  const produto = produtos.find(p => p.id === origem.produtoId);
  await db().insert(centralVendasLeads).values({
    leadId: lead.id, origem: c.origem, idExterno, campanha: origem.campanha, produtoId: origem.produtoId, checklistId: produto?.checklistId ?? null,
    connectionId: c.connectionId ?? null, primeiraMensagemEm: c.texto ? agora() : null, ultimaMensagemClienteEm: c.texto ? agora() : null,
    createdAt: agora(), updatedAt: agora(),
  }).onConflictDoNothing();
  await db().insert(leadActivities).values({ leadId: lead.id, type: "note", description: `Lead criado automaticamente pela Central de Vendas (origem: ${origem.canal ?? c.origem}${origem.campanha ? `, campanha ${origem.campanha}` : ""}).`, performedBy: "Central de Vendas" });
  await registrarEvento({ tipo: "lead_criado", leadId: lead.id, origem: c.origem, payload: { canal: origem.canal, campanha: origem.campanha, produtoId: origem.produtoId } });
  await atribuirOperador(lead.id);
  return { leadId: lead.id, criado: true };
}

const STATUS_DA_IA = new Set(["novo", "em_atendimento_ia", "aguardando_cliente", "sem_resposta"]);

/**
 * Gancho do webhook da Evolution, chamado depois de gravar a mensagem recebida (e a mídia). Nunca lança:
 * a falha fica na auditoria e o aviso da Evolution continua respondendo 200.
 */
export async function aoReceberMensagemWhatsapp(m: { connectionId: number; messageId: number; numero: string; nome?: string | null; texto: string; temMidia: boolean; leadIdDaMensagem: number | null }) {
  try {
    const config = await carregarConfig();
    if (!config.ativo) return { r: "desligado" };
    const entrada = await receberContato({ origem: "whatsapp", telefone: m.numero, nome: m.nome, texto: m.texto, connectionId: m.connectionId });
    if (!entrada.leadId) return { r: entrada.motivo ?? "sem-lead" };
    const leadId = entrada.leadId;
    if (m.leadIdDaMensagem !== leadId) await db().update(whatsappMessages).set({ leadId }).where(eq(whatsappMessages.id, m.messageId));
    const cv = await registroCentral(leadId);
    if (!cv) return { r: "sem-registro" };
    const voltaParaIA = cv.statusAtendimento === "sem_resposta" || cv.statusAtendimento === "aguardando_cliente";
    await db().update(centralVendasLeads).set({
      ultimaMensagemClienteEm: agora(), primeiraMensagemEm: sql`COALESCE(${centralVendasLeads.primeiraMensagemEm}, ${agora()})`,
      connectionId: cv.connectionId ?? m.connectionId, ...(voltaParaIA ? { statusAtendimento: "em_atendimento_ia" } : {}), updatedAt: agora(),
    }).where(eq(centralVendasLeads.leadId, leadId));

    if (ehOptOut(m.texto)) {
      if (!cv.optOut) {
        await atualizarCentral(leadId, { optOut: true, optOutEm: agora() });
        await cancelarPendentes(leadId, "opt_out");
        await registrarEvento({ tipo: "opt_out", leadId, origem: "whatsapp" });
        const job = await enfileirarTemplate({ leadId, slug: "cv-optout-confirmacao", chave: `optout:${leadId}:${m.messageId}`, proativa: false, ignorarOptOut: true });
        if (job) await processarFila({ ids: [job.id] });
      }
      return { r: "opt_out" };
    }
    if (cv.optOut) return { r: "opt_out_ativo" };

    if (m.temMidia) {
      const { receberMidia } = await import("./documentos.js");
      await receberMidia(leadId, m.messageId);
      return { r: "midia" };
    }
    if (!STATUS_DA_IA.has(cv.statusAtendimento)) return { r: "humano" };
    if (!config.automacoes.ia) {
      const { transferirParaHumano } = await import("./ia.js");
      await transferirParaHumano(leadId, "ia_desligada");
      return { r: "ia_desligada" };
    }
    const job = await enfileirar({ chave: `ia:${m.messageId}`, tipo: "ia", leadId, payload: { messageId: m.messageId } });
    if (job) await processarFila({ ids: [job.id] });
    return { r: "ia" };
  } catch (e) {
    const { erroSeguro } = await import("./base.js");
    await registrarEvento({ tipo: "erro_entrada_whatsapp", origem: "whatsapp", resultado: "erro", erro: erroSeguro(e) }).catch(() => undefined);
    return { r: "erro" };
  }
}
