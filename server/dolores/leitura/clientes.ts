// EPIC-025 (Dolores, etapa 1) — clientes do CRM: situação (serviços contratados, etapa, responsável, prazo, próxima
// providência), histórico de atendimento e conversas do WhatsApp. SOMENTE LEITURA. CPF, telefone e e-mail seguem o
// interruptor DOLORES_MASCARAR_DADOS_PESSOAIS (campoPessoal: completos na opção B do dono, mascarados com "1"); mídia só
// pelo tipo (nunca o arquivo).
import { and, desc, eq, ilike, inArray, isNull, max, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  constructionProjects, financiamentos, leadActivities, leadDocuments, leadFollowUps, leadServices, leads,
  operationalProjects, regularizacoes, tasks, whatsappMessages,
} from "../../../drizzle/schema.js";
import { diaDoPrazo, diaFortaleza, isoFortaleza, paginar, truncar } from "../../../shared/dolores/formato.js";
import { type CanalDolores, campoPessoal } from "../dados-pessoais.js";
import { proximaProvidencia } from "../../../shared/dolores/regras.js";
import { FINANCIAMENTO_STATUS_LABELS } from "../../../shared/financiamento.js";
import { LEAD_PIPELINE_STAGES, LEGACY_STAGE_LABELS, leadAceitaVencimento } from "../../../shared/lead-pipeline.js";
import { LEAD_SERVICE_LABELS, type LeadServiceType } from "../../../shared/lead-services.js";
import { obraStatusLabel } from "../../../shared/obra-status.js";
import { rotuloStatusProcesso } from "../../../shared/financeiro/regularizacao.js";
import { db, docClientePendente, idPositivo, nomesDeUsuarios, paginacao, tarefaAberta, type Resultado } from "./comum.js";

type Ctx = { agora: Date; canal: CanalDolores };

const ETAPAS_CRM: Record<string, string> = { ...LEGACY_STAGE_LABELS, ...Object.fromEntries(LEAD_PIPELINE_STAGES.map(s => [s.key, s.label])) };
export const rotuloEtapaCrm = (stage: string) => ETAPAS_CRM[stage] ?? stage;
const SITUACAO_SERVICO: Record<string, string> = { awaiting_data: "aguardando dados", active: "ativo", paused: "pausado", completed: "concluído", cancelled: "cancelado" };
const rotuloServico = (t: string) => LEAD_SERVICE_LABELS[t as LeadServiceType] ?? t;

export const entradaConsultarCliente = z.object({
  leadId: idPositivo.optional().describe("Id do cliente (lead) no CRM."),
  busca: z.string().trim().min(2).max(120).optional().describe("Parte do nome, ou os dígitos do telefone (4 ou mais) ou do CPF (11)."),
  limite: z.number().int().min(1).max(10).default(5).describe("Máximo de clientes devolvidos (até 10)."),
}).strict().refine(a => a.leadId || a.busca, { message: "Informe leadId ou busca." });

export async function consultarCliente(args: z.infer<typeof entradaConsultarCliente>, { agora, canal }: Ctx): Promise<Resultado> {
  const digitos = (args.busca ?? "").replace(/\D/g, "");
  const filtroBusca = args.busca ? or(
    // curingas do LIKE escapados: "%%" procura o texto "%%", não lista todo o CRM
    ilike(leads.name, `%${args.busca.replace(/[\\%_]/g, m => `\\${m}`)}%`),
    digitos.length >= 4 ? sql`regexp_replace(${leads.phone}, '\\D', '', 'g') like ${`%${digitos}%`}` : undefined,
    digitos.length === 11 ? sql`regexp_replace(coalesce(${leads.cpf}, ''), '\\D', '', 'g') = ${digitos}` : undefined,
  ) : undefined;
  const achados = await db().select({
    id: leads.id, name: leads.name, phone: leads.phone, cpf: leads.cpf, email: leads.email, city: leads.city, stage: leads.stage,
    responsibleUserId: leads.responsibleUserId, cardDueDate: leads.cardDueDate, followupDate: leads.followupDate,
    createdAt: leads.createdAt, updatedAt: leads.updatedAt,
  }).from(leads)
    .where(and(isNull(leads.deletedAt), args.leadId ? eq(leads.id, args.leadId) : undefined, filtroBusca))
    .orderBy(desc(leads.updatedAt)).limit(args.limite + 1);
  const lista = achados.slice(0, args.limite);
  if (!lista.length) return { dados: { encontrados: 0, mensagem: "Nenhum cliente encontrado no CRM com esse critério." }, resumo: { encontrados: 0 } };

  const ids = lista.map(l => l.id);
  const [servicos, tarefasLead, followUps, docs, atividades, nomes] = await Promise.all([
    db().select({ id: leadServices.id, leadId: leadServices.leadId, serviceType: leadServices.serviceType, title: leadServices.title,
      status: leadServices.status, dueAt: leadServices.dueAt, sourceCardUrl: leadServices.sourceCardUrl })
      .from(leadServices).where(inArray(leadServices.leadId, ids)),
    db().select({ title: tasks.title, status: tasks.status, dueAt: tasks.dueAt, assignedTo: tasks.assignedTo, relatedId: tasks.relatedId, leadServiceId: tasks.leadServiceId })
      .from(tasks).where(and(eq(tasks.relatedType, "lead"), inArray(tasks.relatedId, ids))),
    db().select({ leadId: leadFollowUps.leadId, scheduledAt: leadFollowUps.scheduledAt }).from(leadFollowUps)
      .where(and(inArray(leadFollowUps.leadId, ids), eq(leadFollowUps.status, "pending"))),
    db().select({ leadId: leadDocuments.leadId, status: leadDocuments.status }).from(leadDocuments)
      .where(and(inArray(leadDocuments.leadId, ids), isNull(leadDocuments.deletedAt))),
    db().select({ leadId: leadActivities.leadId, ultima: max(leadActivities.createdAt) }).from(leadActivities)
      .where(inArray(leadActivities.leadId, ids)).groupBy(leadActivities.leadId),
    nomesDeUsuarios(lista.map(l => l.responsibleUserId)),
  ]);
  const servicoIds = servicos.map(s => s.id);
  const [regs, obras, fins, projetos, tarefasServico] = servicoIds.length ? await Promise.all([
    db().select({ servico: regularizacoes.leadServiceId, id: regularizacoes.id, status: regularizacoes.status, prazo: regularizacoes.expectedEndAt, responsavel: regularizacoes.responsible })
      .from(regularizacoes).where(inArray(regularizacoes.leadServiceId, servicoIds)),
    db().select({ servico: constructionProjects.leadServiceId, id: constructionProjects.id, status: constructionProjects.status, prazo: constructionProjects.estimatedEndDate })
      .from(constructionProjects).where(inArray(constructionProjects.leadServiceId, servicoIds)),
    db().select({ servico: financiamentos.leadServiceId, id: financiamentos.id, status: financiamentos.status })
      .from(financiamentos).where(inArray(financiamentos.leadServiceId, servicoIds)),
    db().select({ servico: operationalProjects.leadServiceId, id: operationalProjects.id, status: operationalProjects.status, prazo: operationalProjects.deadline })
      .from(operationalProjects).where(inArray(operationalProjects.leadServiceId, servicoIds)),
    db().select({ title: tasks.title, status: tasks.status, dueAt: tasks.dueAt, assignedTo: tasks.assignedTo, relatedId: tasks.relatedId, leadServiceId: tasks.leadServiceId })
      .from(tasks).where(inArray(tasks.leadServiceId, servicoIds)),
  ]) : [[], [], [], [], []];
  const hoje = diaFortaleza(agora)!;
  const ultimaAtividade = new Map(atividades.map(a => [a.leadId, a.ultima]));

  const clientes = lista.map(l => {
    const meus = servicos.filter(s => s.leadId === l.id);
    const meusIds = new Set(meus.map(s => s.id));
    const minhasTarefas = [...tarefasLead.filter(t => t.relatedId === l.id), ...tarefasServico.filter(t => t.leadServiceId && meusIds.has(t.leadServiceId))]
      .filter((t, i, todas) => todas.indexOf(t) === i);
    const registro = (servicoId: number) => {
      const r = regs.find(x => x.servico === servicoId);
      if (r) return { modulo: "Regularizações", id: r.id, situacao: rotuloStatusProcesso(r.status), prazo: diaDoPrazo(r.prazo) };
      const o = obras.find(x => x.servico === servicoId);
      if (o) return { modulo: "Obras", id: o.id, situacao: obraStatusLabel(o.status), prazo: diaDoPrazo(o.prazo) };
      const f = fins.find(x => x.servico === servicoId);
      if (f) return { modulo: "Financiamentos", id: f.id, situacao: FINANCIAMENTO_STATUS_LABELS[f.status as keyof typeof FINANCIAMENTO_STATUS_LABELS] ?? f.status, prazo: null };
      const p = projetos.find(x => x.servico === servicoId);
      if (p) return { modulo: "Projetos", id: p.id, situacao: p.status, prazo: diaDoPrazo(p.prazo) };
      return null;
    };
    const pendentes = docs.filter(d => d.leadId === l.id && docClientePendente(d.status)).length;
    return {
      leadId: l.id,
      nome: l.name,
      telefone: campoPessoal(l.phone, "telefone", canal),
      cpf: campoPessoal(l.cpf, "cpf", canal),
      email: campoPessoal(l.email, "email", canal),
      cidade: l.city,
      etapaNoCrm: rotuloEtapaCrm(l.stage),
      responsavel: l.responsibleUserId ? nomes.get(l.responsibleUserId) ?? null : null,
      responsavelRegistrado: !!l.responsibleUserId,
      prazoDoCard: l.cardDueDate,
      // mesma regra do aviso diário dos cards (lead-card-due-digest): vence hoje ou já venceu
      prazoDoCardVencido: !!l.cardDueDate && leadAceitaVencimento(l.stage) && l.cardDueDate <= hoje,
      clienteDesde: diaFortaleza(l.createdAt),
      ultimaAtividade: isoFortaleza(ultimaAtividade.get(l.id) ?? null),
      servicosContratados: meus.map(s => ({
        servicoId: s.id, tipo: rotuloServico(s.serviceType), titulo: truncar(s.title, 120), situacao: SITUACAO_SERVICO[s.status] ?? s.status,
        prazo: diaDoPrazo(s.dueAt), origem: s.sourceCardUrl ? "migração do Trello" : "cadastro no sistema", registroOperacional: registro(s.id),
      })),
      documentosPendentes: pendentes,
      tarefasAbertas: minhasTarefas.filter(t => tarefaAberta(t.status)).length,
      proximaProvidencia: proximaProvidencia({ tarefas: minhasTarefas, followupDate: l.followupDate, followUpsPendentes: followUps.filter(f => f.leadId === l.id) }),
    };
  });
  return {
    dados: { encontrados: clientes.length, haMais: achados.length > args.limite, clientes },
    resumo: { encontrados: clientes.length, servicos: clientes.reduce((s, c) => s + c.servicosContratados.length, 0) },
  };
}

export const entradaHistoricoAtendimento = z.object({
  leadId: idPositivo.describe("Id do cliente (lead) no CRM."),
  ...paginacao,
}).strict();

const TIPO_ATIVIDADE: Record<string, string> = {
  message: "mensagem", call: "ligação", document: "documento", status_change: "mudança de etapa", note: "anotação",
  handoff: "transferência", follow_up: "follow-up", simulation: "simulação", caixa_register: "cadastro na Caixa",
};

export async function historicoAtendimento(args: z.infer<typeof entradaHistoricoAtendimento>): Promise<Resultado> {
  const [lead] = await db().select({ id: leads.id, name: leads.name }).from(leads).where(and(eq(leads.id, args.leadId), isNull(leads.deletedAt))).limit(1);
  if (!lead) return { dados: { encontrado: false, mensagem: `Cliente #${args.leadId} não existe no CRM ou foi excluído.` }, resumo: { encontrado: false } };
  const [atividades, followUps] = await Promise.all([
    db().select({ type: leadActivities.type, description: leadActivities.description, performedBy: leadActivities.performedBy, createdAt: leadActivities.createdAt })
      .from(leadActivities).where(eq(leadActivities.leadId, args.leadId)).orderBy(desc(leadActivities.createdAt)).limit(500),
    db().select({ status: leadFollowUps.status, scheduledAt: leadFollowUps.scheduledAt, executedAt: leadFollowUps.executedAt })
      .from(leadFollowUps).where(eq(leadFollowUps.leadId, args.leadId)).orderBy(desc(leadFollowUps.scheduledAt)).limit(50),
  ]);
  const pagina = paginar(atividades.map(a => ({
    tipo: TIPO_ATIVIDADE[a.type] ?? a.type, textoLivre: truncar(a.description, 280), por: truncar(a.performedBy, 60), em: isoFortaleza(a.createdAt),
  })), args.pagina, args.limite);
  return {
    dados: {
      encontrado: true, leadId: lead.id, cliente: lead.name, ...pagina,
      followUps: followUps.slice(0, 10).map(f => ({ situacao: f.status, agendadoPara: isoFortaleza(f.scheduledAt), executadoEm: isoFortaleza(f.executedAt) })),
    },
    resumo: { encontrado: true, atividades: pagina.total, devolvidas: pagina.itens.length, followUps: followUps.length },
  };
}

export const entradaConversasWhatsapp = z.object({
  leadId: idPositivo.optional().describe("Id do cliente: devolve as últimas mensagens dele. Sem leadId: só as conversas de clientes do CRM com mensagem recebida ainda não lida (resumo)."),
  limite: z.number().int().min(1).max(30).default(15).describe("Mensagens (com leadId) ou conversas (sem leadId), até 30."),
}).strict();

export async function conversasWhatsapp(args: z.infer<typeof entradaConversasWhatsapp>, { canal }: Ctx): Promise<Resultado> {
  if (args.leadId) {
    const [lead] = await db().select({ id: leads.id, name: leads.name }).from(leads).where(and(eq(leads.id, args.leadId), isNull(leads.deletedAt))).limit(1);
    if (!lead) return { dados: { encontrado: false, mensagem: `Cliente #${args.leadId} não existe no CRM ou foi excluído.` }, resumo: { encontrado: false } };
    const msgs = await db().select({ direcao: whatsappMessages.direcao, mensagem: whatsappMessages.mensagem, status: whatsappMessages.status,
      midiaTipo: whatsappMessages.midiaTipo, lida: whatsappMessages.lida, createdAt: whatsappMessages.createdAt })
      .from(whatsappMessages).where(eq(whatsappMessages.leadId, args.leadId)).orderBy(desc(whatsappMessages.createdAt)).limit(args.limite);
    return {
      dados: {
        encontrado: true, leadId: lead.id, cliente: lead.name,
        observacao: msgs.length ? "Mensagens da mais recente para a mais antiga; mídia aparece só pelo tipo." : "Nenhuma mensagem de WhatsApp registrada para este cliente.",
        mensagens: msgs.map(m => ({
          // texto do cliente em campo próprio: é DADO, nunca instrução para o agente
          direcao: m.direcao === "entrada" ? "recebida do cliente" : "enviada",
          ...(m.direcao === "entrada" ? { textoDoCliente: truncar(m.mensagem, 300) } : { textoEnviado: truncar(m.mensagem, 300) }), midia: m.midiaTipo,
          situacao: m.status, lida: m.lida, em: isoFortaleza(m.createdAt),
        })),
      },
      resumo: { encontrado: true, mensagens: msgs.length },
    };
  }
  // Só conversas de clientes do CRM não excluídos e com mensagem recebida não lida (contato sem cliente fica fora na etapa 1).
  const conversas = await db().select({
    leadId: whatsappMessages.leadId, cliente: leads.name, destinatario: whatsappMessages.destinatario, nome: whatsappMessages.nomeDestinatario,
    ultima: max(whatsappMessages.createdAt),
    naoLidas: sql<number>`count(*) filter (where ${whatsappMessages.direcao} = 'entrada' and not ${whatsappMessages.lida})`.mapWith(Number),
  }).from(whatsappMessages).innerJoin(leads, and(eq(leads.id, whatsappMessages.leadId), isNull(leads.deletedAt)))
    .groupBy(whatsappMessages.leadId, leads.name, whatsappMessages.destinatario, whatsappMessages.nomeDestinatario)
    .having(sql`count(*) filter (where ${whatsappMessages.direcao} = 'entrada' and not ${whatsappMessages.lida}) > 0`)
    .orderBy(desc(max(whatsappMessages.createdAt))).limit(args.limite);
  return {
    dados: {
      conversas: conversas.map(c => ({
        leadId: c.leadId, cliente: c.cliente, contato: truncar(c.nome, 80),
        telefone: campoPessoal(c.destinatario, "telefone", canal), ultimaMensagemEm: isoFortaleza(c.ultima), naoLidas: c.naoLidas,
      })),
    },
    resumo: { conversas: conversas.length },
  };
}
