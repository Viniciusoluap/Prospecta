// EPIC-025 (Dolores, etapa 1) — processos de regularização (teste de aceite da etapa). SOMENTE LEITURA.
// Junta, por processo: cliente, serviço, status, etapa atual, responsável ("a confirmar" quando é o padrão da
// migração), prazo, atraso, dias sem movimentação, documentos pendentes, tarefas abertas/atrasadas e a próxima
// providência registrada. Status e financeiro usam as regras das telas (shared/financeiro/regularizacao.ts).
import { and, asc, desc, eq, inArray, isNull, max, or } from "drizzle-orm";
import { z } from "zod";
import {
  leadActivities, leadDocuments, leadFollowUps, leadServices, leads, regularizacaoDocuments, regularizacaoEtapas,
  regularizacaoItensFinanceiros, regularizacaoRecebimentos, regularizacoes, tasks,
} from "../../../drizzle/schema.js";
import { centavosParaReais, diaDoPrazo, diaFortaleza, isoFortaleza, mascararTelefone, paginar, truncar } from "../../../shared/dolores/formato.js";
import {
  DIAS_PARADO_PADRAO, STATUS_ENCERRADOS_PROCESSO, etapaAtual, maisRecente, proximaProvidencia, responsavelDaTarefa,
  responsavelDoProcesso, situacaoDoPrazo,
} from "../../../shared/dolores/regras.js";
import { calcularFinanceiroRegularizacao, progressoDasEtapas, rotuloStatusProcesso } from "../../../shared/financeiro/regularizacao.js";
import { LEAD_SERVICE_LABELS, type LeadServiceType } from "../../../shared/lead-services.js";
import { tarefaAtrasada } from "../../../shared/tarefas-filtro.js";
import {
  MAX_LINHAS_LIDAS, PRIORIDADE, SITUACAO_DOC_CLIENTE, SITUACAO_TAREFA, db, docClientePendente, docRegularizacaoRecebido,
  idPositivo, nomesDeUsuarios, paginacao, rotuloDocumento, tarefaAberta, type Resultado,
} from "./comum.js";

type Ctx = { agora: Date };

/** Lê os processos (todos ou os ids pedidos) com tudo o que a análise precisa. */
export async function carregarProcessos(ids: number[] | null, agora: Date, diasParado = DIAS_PARADO_PADRAO) {
  const regs = await db().select({
    reg: {
      id: regularizacoes.id, clientName: regularizacoes.clientName, clientPhone: regularizacoes.clientPhone, type: regularizacoes.type,
      status: regularizacoes.status, responsible: regularizacoes.responsible, leadId: regularizacoes.leadId,
      leadServiceId: regularizacoes.leadServiceId, expectedEndAt: regularizacoes.expectedEndAt, notes: regularizacoes.notes,
      registryOffice: regularizacoes.registryOffice, createdAt: regularizacoes.createdAt, updatedAt: regularizacoes.updatedAt,
    },
    servico: { serviceType: leadServices.serviceType, title: leadServices.title, sourceCardUrl: leadServices.sourceCardUrl, dueAt: leadServices.dueAt },
    lead: { name: leads.name, responsibleUserId: leads.responsibleUserId, followupDate: leads.followupDate, deletedAt: leads.deletedAt },
  }).from(regularizacoes)
    .leftJoin(leadServices, eq(leadServices.id, regularizacoes.leadServiceId))
    .leftJoin(leads, eq(leads.id, regularizacoes.leadId))
    .where(ids ? inArray(regularizacoes.id, ids) : undefined)
    .orderBy(desc(regularizacoes.updatedAt)).limit(MAX_LINHAS_LIDAS);
  if (!regs.length) return [];

  const regIds = regs.map(r => r.reg.id);
  // Cliente excluído do CRM (deleted_at): o processo continua (como na tela de Regularizações), mas nada do CRM dele
  // (documentos, tarefas, atividades, follow-ups, responsável) é lido.
  const crmAtivo = (r: (typeof regs)[number]) => !!r.lead && !r.lead.deletedAt;
  const leadIds = Array.from(new Set(regs.filter(crmAtivo).map(r => r.reg.leadId).filter((x): x is number => !!x)));
  const servicoIds = Array.from(new Set(regs.filter(r => crmAtivo(r) || !r.reg.leadId).map(r => r.reg.leadServiceId).filter((x): x is number => !!x)));
  const vazio = Promise.resolve([] as never[]);

  const [etapas, docsReg, docsLead, tarefas, atividades, followUps, recebimentos, nomes] = await Promise.all([
    db().select({ regularizacaoId: regularizacaoEtapas.regularizacaoId, nome: regularizacaoEtapas.nome, ordem: regularizacaoEtapas.ordem,
      progresso: regularizacaoEtapas.progresso, observacoes: regularizacaoEtapas.observacoes, updatedAt: regularizacaoEtapas.updatedAt })
      .from(regularizacaoEtapas).where(inArray(regularizacaoEtapas.regularizacaoId, regIds)).orderBy(asc(regularizacaoEtapas.ordem)),
    db().select({ regularizacaoId: regularizacaoDocuments.regularizacaoId, name: regularizacaoDocuments.name, status: regularizacaoDocuments.status,
      driveFileId: regularizacaoDocuments.driveFileId, fileUrl: regularizacaoDocuments.fileUrl, updatedAt: regularizacaoDocuments.updatedAt })
      .from(regularizacaoDocuments).where(inArray(regularizacaoDocuments.regularizacaoId, regIds)),
    leadIds.length ? db().select({ leadId: leadDocuments.leadId, serviceId: leadDocuments.serviceId, type: leadDocuments.type,
      status: leadDocuments.status, uploadedAt: leadDocuments.uploadedAt, createdAt: leadDocuments.createdAt })
      .from(leadDocuments).where(and(inArray(leadDocuments.leadId, leadIds), isNull(leadDocuments.deletedAt))) : vazio,
    leadIds.length || servicoIds.length ? db().select({ id: tasks.id, title: tasks.title, status: tasks.status, dueAt: tasks.dueAt, assignedTo: tasks.assignedTo,
      priority: tasks.priority, leadServiceId: tasks.leadServiceId, relatedType: tasks.relatedType, relatedId: tasks.relatedId, updatedAt: tasks.updatedAt })
      .from(tasks).where(or(
        servicoIds.length ? inArray(tasks.leadServiceId, servicoIds) : undefined,
        leadIds.length ? and(eq(tasks.relatedType, "lead"), inArray(tasks.relatedId, leadIds)) : undefined,
      )) : vazio,
    leadIds.length ? db().select({ leadId: leadActivities.leadId, ultima: max(leadActivities.createdAt) })
      .from(leadActivities).where(inArray(leadActivities.leadId, leadIds)).groupBy(leadActivities.leadId) : vazio,
    leadIds.length ? db().select({ leadId: leadFollowUps.leadId, scheduledAt: leadFollowUps.scheduledAt })
      .from(leadFollowUps).where(and(inArray(leadFollowUps.leadId, leadIds), eq(leadFollowUps.status, "pending"))) : vazio,
    db().select({ regularizacaoId: regularizacaoRecebimentos.regularizacaoId, ultima: max(regularizacaoRecebimentos.createdAt) })
      .from(regularizacaoRecebimentos).where(inArray(regularizacaoRecebimentos.regularizacaoId, regIds)).groupBy(regularizacaoRecebimentos.regularizacaoId),
    nomesDeUsuarios(regs.map(r => r.lead?.responsibleUserId)),
  ]);

  const por = <T, K>(lista: readonly T[], chave: (x: T) => K) => {
    const m = new Map<K, T[]>();
    for (const x of lista) { const k = chave(x); m.set(k, [...(m.get(k) ?? []), x]); }
    return m;
  };
  const etapasPor = por(etapas, e => e.regularizacaoId);
  const docsRegPor = por(docsReg, d => d.regularizacaoId);
  const docsLeadPor = por(docsLead, d => d.leadId);
  const followPor = por(followUps, f => f.leadId);
  const atividadePor = new Map(atividades.map(a => [a.leadId, a.ultima]));
  const recebimentoPor = new Map(recebimentos.map(r => [r.regularizacaoId, r.ultima]));

  return regs.map(linha => {
    const { reg, servico, lead } = linha;
    const ativo = crmAtivo(linha);
    const lid = ativo ? reg.leadId : null;
    const sid = ativo || !reg.leadId ? reg.leadServiceId : null;
    const leadAtivo = ativo ? lead : null;
    const encerrado = STATUS_ENCERRADOS_PROCESSO.has(reg.status);
    const minhasEtapas = etapasPor.get(reg.id) ?? [];
    const atual = etapaAtual(minhasEtapas);
    const minhasTarefas = tarefas.filter(t => (sid && t.leadServiceId === sid)
      || (lid && t.relatedType === "lead" && t.relatedId === lid));
    const abertas = minhasTarefas.filter(t => tarefaAberta(t.status));
    const atrasadas = abertas.filter(t => tarefaAtrasada(t, agora));
    // Documentos do cliente: os deste serviço e os gerais do cliente (sem serviço).
    const docsCliente = (lid ? docsLeadPor.get(lid) ?? [] : []).filter(d => !d.serviceId || d.serviceId === reg.leadServiceId);
    const docsAntigos = (reg.leadId && !ativo ? [] : docsRegPor.get(reg.id) ?? []).map(d => ({ nome: d.name, recebido: docRegularizacaoRecebido({ status: d.status, temArquivo: !!(d.driveFileId || d.fileUrl) }), updatedAt: d.updatedAt }));
    const pendentes = [
      ...docsCliente.filter(d => docClientePendente(d.status)).map(d => ({ documento: rotuloDocumento(d.type), situacao: SITUACAO_DOC_CLIENTE[d.status] ?? d.status, origem: "documentos do cliente (CRM)" })),
      ...docsAntigos.filter(d => !d.recebido).map(d => ({ documento: d.nome, situacao: "pendente", origem: "documentos do processo (cadastro antigo)" })),
    ];
    const recebidos = [
      ...docsCliente.filter(d => !docClientePendente(d.status)).map(d => ({ documento: rotuloDocumento(d.type), situacao: SITUACAO_DOC_CLIENTE[d.status] ?? d.status, em: diaFortaleza(d.uploadedAt ?? d.createdAt) })),
      ...docsAntigos.filter(d => d.recebido).map(d => ({ documento: d.nome, situacao: "recebido", em: diaFortaleza(d.updatedAt) })),
    ];
    const ultimaMovimentacao = maisRecente([
      reg.updatedAt, ...minhasEtapas.map(e => e.updatedAt), ...docsAntigos.map(d => d.updatedAt),
      ...docsCliente.map(d => d.uploadedAt ?? d.createdAt), ...minhasTarefas.map(t => t.updatedAt),
      lid ? atividadePor.get(lid) : null, recebimentoPor.get(reg.id),
    ]);
    const prazo = diaDoPrazo(reg.expectedEndAt ?? servico?.dueAt ?? null);
    const situacao = situacaoDoPrazo({ encerrado, prazo, ultimaMovimentacao, agora, diasParado });
    const migrado = !!servico?.sourceCardUrl;
    const responsavel = responsavelDoProcesso(reg.responsible, migrado);
    const nomeServico = servico?.serviceType ? LEAD_SERVICE_LABELS[servico.serviceType as LeadServiceType] ?? servico.serviceType : null;
    const providencia = proximaProvidencia({
      tarefas: minhasTarefas, followupDate: leadAtivo?.followupDate ?? null,
      followUpsPendentes: lid ? followPor.get(lid) ?? [] : [],
    });
    return {
      id: reg.id,
      cliente: reg.clientName,
      telefone: mascararTelefone(reg.clientPhone),
      leadId: reg.leadId,
      clienteExcluidoDoCrm: !!lead?.deletedAt,
      servico: truncar(reg.type, 120) ?? (servico?.title ? truncar(servico.title, 120) : null) ?? nomeServico,
      tipoDeServico: nomeServico,
      origem: migrado ? "migração do Trello" : "cadastro no sistema",
      status: rotuloStatusProcesso(reg.status),
      encerrado,
      etapaAtual: atual ? { nome: atual.nome, progresso: atual.progresso, todasConcluidas: atual.todasConcluidas } : null,
      progressoDasEtapas: progressoDasEtapas(minhasEtapas),
      responsavel: responsavel.nome,
      responsavelAConfirmar: responsavel.aConfirmar,
      motivoResponsavel: responsavel.motivo,
      responsavelNoCrm: leadAtivo?.responsibleUserId ? nomes.get(leadAtivo.responsibleUserId) ?? null : null,
      cartorio: truncar(reg.registryOffice, 120),
      abertoEm: diaFortaleza(reg.createdAt),
      prazo: diaFortaleza(prazo),
      origemDoPrazo: reg.expectedEndAt ? "previsão de término do processo" : servico?.dueAt ? "prazo do serviço no CRM" : null,
      atrasado: situacao.atrasado,
      diasDeAtraso: situacao.diasDeAtraso,
      ultimaMovimentacao: isoFortaleza(ultimaMovimentacao),
      diasSemMovimentacao: situacao.diasSemMovimentacao,
      parado: situacao.parado,
      documentosPendentes: pendentes,
      documentosRecebidos: recebidos,
      tarefasAbertas: abertas.length,
      tarefasAtrasadas: atrasadas.map(t => ({ id: t.id, tarefa: truncar(t.title, 160), responsavel: responsavelDaTarefa(t.assignedTo), prazo: diaFortaleza(t.dueAt), prioridade: PRIORIDADE[t.priority] ?? t.priority })),
      tarefas: minhasTarefas,
      proximaProvidencia: providencia,
      // Motivo do atraso/parada, quando registrado: observação da etapa atual e observações do processo.
      observacaoDaEtapaAtual: truncar(atual?.observacoes ?? null, 280),
      observacoesDoProcesso: truncar(reg.notes, 280),
      etapas: minhasEtapas,
    };
  });
}

export type ProcessoCarregado = Awaited<ReturnType<typeof carregarProcessos>>[number];

/** Versão da lista (sem as listas completas de tarefas/etapas). */
function resumoDoProcesso(p: ProcessoCarregado) {
  const { tarefas: _t, etapas: _e, documentosRecebidos, ...resto } = p;
  return { ...resto, documentosRecebidos: documentosRecebidos.length };
}

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const entradaListarRegularizacoes = z.object({
  situacao: z.enum(["abertos", "atrasados", "parados", "com_pendencias", "todos"]).default("abertos")
    .describe("abertos = não concluídos/cancelados; atrasados = prazo vencido; parados = sem movimentação há `diasParado` dias; com_pendencias = documento pendente ou tarefa atrasada; todos = inclusive encerrados."),
  responsavel: z.string().trim().min(1).max(120).optional().describe("Filtra pelo responsável (parte do nome; use \"a confirmar\" para os sem responsável)."),
  busca: z.string().trim().min(2).max(120).optional().describe("Parte do nome do cliente ou do serviço."),
  diasParado: z.number().int().min(1).max(365).default(DIAS_PARADO_PADRAO).describe("Dias sem movimentação para contar como parado."),
  ...paginacao,
}).strict();

export async function listarProcessosRegularizacao(args: z.infer<typeof entradaListarRegularizacoes>, { agora }: Ctx): Promise<Resultado> {
  const todos = await carregarProcessos(null, agora, args.diasParado);
  const filtrados = todos.filter(p => {
    if (args.situacao !== "todos" && p.encerrado) return false;
    if (args.situacao === "atrasados" && !p.atrasado) return false;
    if (args.situacao === "parados" && !p.parado) return false;
    if (args.situacao === "com_pendencias" && !p.documentosPendentes.length && !p.tarefasAtrasadas.length) return false;
    if (args.responsavel && !sem(p.responsavel).includes(sem(args.responsavel))) return false;
    if (args.busca && !sem(`${p.cliente} ${p.servico ?? ""}`).includes(sem(args.busca))) return false;
    return true;
  });
  // Mais urgente primeiro: atrasados (mais dias), depois parados (mais dias sem movimento).
  filtrados.sort((a, b) => Number(b.atrasado) - Number(a.atrasado) || (b.diasDeAtraso ?? 0) - (a.diasDeAtraso ?? 0)
    || (b.diasSemMovimentacao ?? 0) - (a.diasSemMovimentacao ?? 0) || a.id - b.id);
  const pagina = paginar(filtrados.map(resumoDoProcesso), args.pagina, args.limite);
  const abertos = todos.filter(p => !p.encerrado);
  const porResponsavel = new Map<string, { processos: number; atrasados: number; parados: number }>();
  for (const p of abertos) {
    const r = porResponsavel.get(p.responsavel) ?? { processos: 0, atrasados: 0, parados: 0 };
    r.processos++; if (p.atrasado) r.atrasados++; if (p.parado) r.parados++;
    porResponsavel.set(p.responsavel, r);
  }
  const totais = {
    processosNoSistema: todos.length,
    abertos: abertos.length,
    atrasados: abertos.filter(p => p.atrasado).length,
    parados: abertos.filter(p => p.parado).length,
    semPrazoRegistrado: abertos.filter(p => !p.prazo).length,
    comDocumentosPendentes: abertos.filter(p => p.documentosPendentes.length).length,
    comTarefasAtrasadas: abertos.filter(p => p.tarefasAtrasadas.length).length,
    responsavelAConfirmar: abertos.filter(p => p.responsavelAConfirmar).length,
    semProximaProvidencia: abertos.filter(p => !p.proximaProvidencia).length,
    vindosDoTrello: abertos.filter(p => p.origem === "migração do Trello").length,
  };
  return {
    dados: {
      criterios: {
        atrasado: "prazo (previsão de término do processo ou, sem ela, prazo do serviço no CRM) anterior a hoje e processo não concluído/cancelado",
        parado: `sem nenhuma movimentação registrada (processo, etapas, documentos, tarefas, atividades do cliente, recebimentos) há ${args.diasParado} dias ou mais`,
        tarefaAtrasada: "tarefa pendente ou em andamento com prazo vencido (mesma regra da tela de Tarefas)",
      },
      totais,
      porResponsavel: Array.from(porResponsavel, ([responsavel, r]) => ({ responsavel, ...r })).sort((a, b) => b.processos - a.processos),
      ...pagina,
    },
    resumo: { encontrados: filtrados.length, devolvidos: pagina.itens.length, ...totais },
  };
}

export const entradaDetalharRegularizacao = z.object({ id: idPositivo.describe("Id do processo de regularização.") }).strict();

export async function detalharProcessoRegularizacao(args: z.infer<typeof entradaDetalharRegularizacao>, { agora }: Ctx): Promise<Resultado> {
  const [p] = await carregarProcessos([args.id], agora);
  if (!p) return { dados: { encontrado: false, mensagem: `Processo de regularização #${args.id} não existe no sistema.` }, resumo: { encontrado: false } };
  const [itens, recebimentos] = await Promise.all([
    db().select({ id: regularizacaoItensFinanceiros.id, nome: regularizacaoItensFinanceiros.nome, grupo: regularizacaoItensFinanceiros.grupo,
      ordem: regularizacaoItensFinanceiros.ordem, previsto: regularizacaoItensFinanceiros.previsto })
      .from(regularizacaoItensFinanceiros).where(eq(regularizacaoItensFinanceiros.regularizacaoId, p.id)),
    db().select({ itemId: regularizacaoRecebimentos.itemId, valor: regularizacaoRecebimentos.valor, status: regularizacaoRecebimentos.status })
      .from(regularizacaoRecebimentos).where(eq(regularizacaoRecebimentos.regularizacaoId, p.id)),
  ]);
  let financeiro: unknown = null;
  try {
    const f = calcularFinanceiroRegularizacao(itens, recebimentos);
    financeiro = { moeda: "BRL", previsto: centavosParaReais(f.geral.previsto), recebido: centavosParaReais(f.geral.recebido), saldoAReceber: centavosParaReais(f.geral.saldo) };
  } catch (e) {
    financeiro = { erro: `Tabela financeira inconsistente: ${e instanceof Error ? e.message : "erro"}` };
  }
  const historico = p.leadId && !p.clienteExcluidoDoCrm ? await db().select({ type: leadActivities.type, description: leadActivities.description, performedBy: leadActivities.performedBy, createdAt: leadActivities.createdAt })
    .from(leadActivities).where(eq(leadActivities.leadId, p.leadId)).orderBy(desc(leadActivities.createdAt)).limit(10) : [];
  const { tarefas, etapas, ...resto } = p;
  return {
    dados: {
      encontrado: true,
      ...resto,
      etapas: etapas.map(e => ({ nome: e.nome, ordem: e.ordem, progresso: e.progresso, observacao: truncar(e.observacoes, 280), atualizadaEm: isoFortaleza(e.updatedAt) })),
      tarefas: tarefas.slice(0, 30).map(t => ({ id: t.id, tarefa: truncar(t.title, 160), situacao: SITUACAO_TAREFA[t.status] ?? t.status, responsavel: responsavelDaTarefa(t.assignedTo), prazo: diaFortaleza(t.dueAt), atrasada: tarefaAtrasada(t, agora) })),
      financeiro,
      ultimasAtividadesDoCliente: historico.map(h => ({ tipo: h.type, textoLivre: truncar(h.description, 200), por: truncar(h.performedBy, 60), em: isoFortaleza(h.createdAt) })),
    },
    resumo: { encontrado: true, etapas: etapas.length, tarefas: tarefas.length, documentosPendentes: p.documentosPendentes.length, atividades: historico.length },
  };
}
