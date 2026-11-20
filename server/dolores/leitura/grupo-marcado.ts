// EPIC-025 (Dolores, etapa 4b) — as ÚNICAS leituras do laço do grupo (quando a Dolores é marcada). SOMENTE LEITURA.
// Regras fixas deste arquivo:
// - O cliente/obra vem do CONTEXTO do servidor (o vínculo do grupo cadastrado daquela mensagem), nunca de argumento: as
//   funções não têm argumento nenhum. Não há como pedir outro cliente, listar clientes nem buscar por nome.
// - LISTA DE CAMPOS PERMITIDOS (montada aqui, campo a campo; o resto do banco não sai): primeiro nome do cliente do grupo, por
//   serviço o tipo e a situação NEUTRA, o módulo e a situação neutra nele (lista fechada `situacaoNeutraDoGrupo`: em análise, em
//   andamento, concluído, pausado, encerrado — QA-SEG E4b achado 1: nunca "Aprovado"/"Análise do banco"), a etapa atual e a próxima
//   (nome passado pelo filtro de rótulo), etapas concluídas/total, progresso (%), a data da última movimentação; documentos
//   pendentes (nome + "pendente"/"recusado — enviar de novo") e quantos já foram recebidos; quantos arquivos chegaram no grupo e
//   aguardam a conferência da equipe; próximos passos montados pelo sistema.
// - NUNCA saem: CPF/CNPJ, telefone, e-mail, endereço, cidade, valores (preço, parcela, custo, medição em R$, lançamento),
//   dados bancários, banco, corretor/comissão, responsável da equipe, anotações/observações, histórico de atendimento, etapa
//   comercial do CRM ("Lead Novo", "Reprovado", "Em Aprovação"…), status bruto ou rótulo interno de processo, resultado de aprovação,
//   conversas, títulos livres de serviço ou obra, tarefas, prazos previstos (promessa), ids internos, outros clientes.
// - Texto livre que sobra (nome de documento do cadastro antigo, item do checklist, nome de etapa) passa por
//   `rotuloSeguroParaGrupo`: com dígitos, link, "@", marcador de dado mascarado ou palavra fora do escopo, vira um rótulo
//   genérico. Na dúvida, não devolve.
import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import {
  constructionProjects, constructionStages, financiamentoChecklistItems, financiamentos, leadDocuments, leadServices, leads,
  regularizacaoDocuments, regularizacaoEtapas, regularizacoes,
} from "../../../drizzle/schema.js";
import { doloresGrupoMensagens } from "../../../drizzle/schema-dolores-grupos.js";
import { diaFortaleza } from "../../../shared/dolores/formato.js";
import { primeiroNome } from "../../../shared/dolores/fila.js";
import { rotuloSeguroParaGrupo, situacaoNeutraDoGrupo } from "../../../shared/dolores/marcacao.js";
import { STATUS_ENCERRADOS_PROCESSO, etapaAtual, maisRecente } from "../../../shared/dolores/regras.js";
import { LEAD_FINALIZED_STAGE } from "../../../shared/lead-pipeline.js";
import { LEAD_SERVICE_LABELS, type LeadServiceType } from "../../../shared/lead-services.js";
import { SITUACAO_DOC_CLIENTE, db, docClientePendente, docRegularizacaoRecebido, rotuloDocumento, type Resultado } from "./comum.js";

/**
 * Contexto do SERVIDOR: o vínculo do grupo cadastrado e ativo da mensagem que marcou a Dolores. Etapa 7: no grupo de PARCEIROS,
 * `parceiroUserId` é o usuário corretor ativo identificado pelo telefone de quem marcou (servidor do WhatsApp), nunca pelo texto.
 */
export type ContextoDoGrupo = { agora: Date; grupoId: number; leadId: number | null; obraId: number | null; parceiroUserId?: number | null };

/** As funções do grupo não recebem argumento (objeto vazio, estrito). */
export const entradaSemArgumentos = z.object({}).strict();

const STATUS_OBRA_ENCERRADA = new Set(["completed", "cancelled", "distrato"]);
const rotuloServico = (t: string) => LEAD_SERVICE_LABELS[t as LeadServiceType] ?? "serviço";
const pct = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null; };

/** Cliente do grupo (não excluído do CRM). */
async function clienteDoGrupo(ctx: ContextoDoGrupo) {
  if (!ctx.leadId) return null;
  const [l] = await db().select({ id: leads.id, name: leads.name }).from(leads)
    .where(and(eq(leads.id, ctx.leadId), isNull(leads.deletedAt))).limit(1);
  return l ?? null;
}

type EtapaDoGrupo = { nome: string | null; ordem: number; concluida: boolean; updatedAt: Date | null };
function resumoDasEtapas(etapas: EtapaDoGrupo[]) {
  const ordenadas = [...etapas].sort((a, b) => a.ordem - b.ordem);
  const atual = ordenadas.find(e => !e.concluida) ?? null;
  const proxima = atual ? ordenadas.find(e => e.ordem > atual.ordem && !e.concluida) ?? null : null;
  return {
    etapaAtual: atual ? rotuloSeguroParaGrupo(atual.nome, "etapa em andamento") : ordenadas.length ? "todas as etapas concluídas" : null,
    proximaEtapa: proxima ? rotuloSeguroParaGrupo(proxima.nome, "próxima etapa") : null,
    etapasConcluidas: ordenadas.filter(e => e.concluida).length,
    etapasNoTotal: ordenadas.length,
  };
}

/** Andamento por serviço do cliente (ou da obra do grupo), só com os campos permitidos. */
async function andamento(ctx: ContextoDoGrupo) {
  const cliente = await clienteDoGrupo(ctx);
  const servicos = cliente ? await db().select({ id: leadServices.id, tipo: leadServices.serviceType, status: leadServices.status, updatedAt: leadServices.updatedAt })
    .from(leadServices).where(eq(leadServices.leadId, cliente.id)).limit(20) : [];
  const ids = servicos.map(s => s.id);
  const [regs, obras] = await Promise.all([
    cliente ? db().select({ id: regularizacoes.id, servico: regularizacoes.leadServiceId, status: regularizacoes.status, updatedAt: regularizacoes.updatedAt })
      .from(regularizacoes).where(eq(regularizacoes.leadId, cliente.id)).limit(20) : Promise.resolve([]),
    db().select({ id: constructionProjects.id, servico: constructionProjects.leadServiceId, status: constructionProjects.status, progress: constructionProjects.progress,
      medido: constructionProjects.progressMeasuredPct, updatedAt: constructionProjects.updatedAt })
      .from(constructionProjects)
      .where(ctx.obraId ? eq(constructionProjects.id, ctx.obraId) : cliente ? eq(constructionProjects.leadId, cliente.id) : eq(constructionProjects.id, -1)).limit(20),
  ]);
  const fins = cliente ? await db().select({ id: financiamentos.id, servico: financiamentos.leadServiceId, status: financiamentos.status, updatedAt: financiamentos.updatedAt })
    .from(financiamentos).where(eq(financiamentos.leadId, cliente.id)).limit(20) : [];
  const [etapasReg, etapasObra] = await Promise.all([
    regs.length ? db().select({ dono: regularizacaoEtapas.regularizacaoId, nome: regularizacaoEtapas.nome, ordem: regularizacaoEtapas.ordem, progresso: regularizacaoEtapas.progresso, updatedAt: regularizacaoEtapas.updatedAt })
      .from(regularizacaoEtapas).where(inArray(regularizacaoEtapas.regularizacaoId, regs.map(r => r.id))).orderBy(asc(regularizacaoEtapas.ordem)) : Promise.resolve([]),
    obras.length ? db().select({ dono: constructionStages.projectId, nome: constructionStages.name, ordem: constructionStages.orderIndex, status: constructionStages.status, updatedAt: constructionStages.updatedAt })
      .from(constructionStages).where(inArray(constructionStages.projectId, obras.map(o => o.id))) : Promise.resolve([]),
  ]);

  const processos: Array<Record<string, unknown>> = [];
  const usados = new Set<number>();
  for (const r of regs) {
    const etapas = etapasReg.filter(e => e.dono === r.id);
    const atual = etapaAtual(etapas.map(e => ({ nome: e.nome ?? "", ordem: e.ordem, progresso: e.progresso })));
    processos.push({
      modulo: "Regularização", situacao: situacaoNeutraDoGrupo(r.status), encerrado: STATUS_ENCERRADOS_PROCESSO.has(r.status),
      ...resumoDasEtapas(etapas.map(e => ({ nome: e.nome, ordem: e.ordem, concluida: e.progresso >= 100, updatedAt: e.updatedAt }))),
      progressoDaEtapaAtualPct: atual && !atual.todasConcluidas ? pct(atual.progresso) : null,
      ultimaMovimentacao: diaFortaleza(maisRecente([r.updatedAt, ...etapas.map(e => e.updatedAt)])),
    });
    if (r.servico) usados.add(r.servico);
  }
  for (const o of obras) {
    const etapas = etapasObra.filter(e => e.dono === o.id);
    processos.push({
      modulo: "Obra", situacao: situacaoNeutraDoGrupo(o.status), encerrado: STATUS_OBRA_ENCERRADA.has(o.status),
      ...resumoDasEtapas(etapas.map(e => ({ nome: e.nome, ordem: e.ordem, concluida: e.status === "completed", updatedAt: e.updatedAt }))),
      progressoDaObraPct: o.medido !== null && o.medido !== undefined ? pct(o.medido) : pct(o.progress),
      ultimaMovimentacao: diaFortaleza(maisRecente([o.updatedAt, ...etapas.map(e => e.updatedAt)])),
    });
    if (o.servico) usados.add(o.servico);
  }
  for (const f of fins) {
    processos.push({
      modulo: "Financiamento", situacao: situacaoNeutraDoGrupo(f.status),
      ultimaMovimentacao: diaFortaleza(f.updatedAt),
    });
    if (f.servico) usados.add(f.servico);
  }
  // serviços contratados sem registro no módulo operacional: só o tipo e a situação
  for (const s of servicos) if (!usados.has(s.id)) processos.push({ modulo: rotuloServico(s.tipo), situacao: situacaoNeutraDoGrupo(s.status), ultimaMovimentacao: diaFortaleza(s.updatedAt) });
  return { cliente, servicos: ids.length, processos };
}

/** Documentos pendentes do cliente do grupo (mesmas fontes de listar_documentos), só nome e situação. */
async function pendencias(ctx: ContextoDoGrupo) {
  const cliente = await clienteDoGrupo(ctx);
  const [docsLead, docsReg, itensFin, noGrupo] = await Promise.all([
    cliente ? db().select({ type: leadDocuments.type, status: leadDocuments.status }).from(leadDocuments)
      .where(and(eq(leadDocuments.leadId, cliente.id), isNull(leadDocuments.deletedAt))).limit(200) : Promise.resolve([]),
    cliente ? db().select({ name: regularizacaoDocuments.name, status: regularizacaoDocuments.status, driveFileId: regularizacaoDocuments.driveFileId, fileUrl: regularizacaoDocuments.fileUrl })
      .from(regularizacaoDocuments).innerJoin(regularizacoes, eq(regularizacoes.id, regularizacaoDocuments.regularizacaoId))
      .where(eq(regularizacoes.leadId, cliente.id)).limit(200) : Promise.resolve([]),
    cliente ? db().select({ item: financiamentoChecklistItems.item, concluido: financiamentoChecklistItems.concluido, enviadoEm: financiamentoChecklistItems.enviadoEm,
      driveFileId: financiamentoChecklistItems.documentoDriveFileId, url: financiamentoChecklistItems.documentoUrl })
      .from(financiamentoChecklistItems).innerJoin(financiamentos, eq(financiamentos.id, financiamentoChecklistItems.financiamentoId))
      .where(and(eq(financiamentos.leadId, cliente.id), eq(financiamentoChecklistItems.solicitarDocumento, true))).limit(200) : Promise.resolve([]),
    db().select({ situacao: doloresGrupoMensagens.situacao }).from(doloresGrupoMensagens)
      .where(and(eq(doloresGrupoMensagens.grupoId, ctx.grupoId), inArray(doloresGrupoMensagens.situacao, ["a_classificar", "classificando", "classificado", "confira", "salvo"])))
      .groupBy(doloresGrupoMensagens.situacao),
  ]);
  const pendentes: Array<{ documento: string; situacao: string }> = [
    ...docsLead.filter(d => docClientePendente(d.status)).map(d => ({ documento: rotuloDocumento(d.type), situacao: d.status === "rejected" ? "recusado — enviar de novo" : SITUACAO_DOC_CLIENTE[d.status] ?? "pendente" })),
    ...docsReg.filter(d => !docRegularizacaoRecebido({ status: d.status, temArquivo: !!(d.driveFileId || d.fileUrl) })).map(d => ({ documento: rotuloSeguroParaGrupo(d.name, "documento do processo"), situacao: "pendente" })),
    ...itensFin.filter(d => !(d.driveFileId || d.url || d.enviadoEm || d.concluido)).map(d => ({ documento: rotuloSeguroParaGrupo(d.item, "documento do financiamento"), situacao: "pendente" })),
  ];
  // rótulo genérico repetido ou rótulo duplicado aparece uma vez só
  const unicos = pendentes.filter((p, i, a) => a.findIndex(x => x.documento === p.documento && x.situacao === p.situacao) === i).slice(0, 30);
  const recebidos = docsLead.filter(d => !docClientePendente(d.status)).length
    + docsReg.filter(d => docRegularizacaoRecebido({ status: d.status, temArquivo: !!(d.driveFileId || d.fileUrl) })).length
    + itensFin.filter(d => d.driveFileId || d.url || d.enviadoEm || d.concluido).length;
  const conta = (...s: string[]) => noGrupo.filter(x => s.includes(x.situacao)).length;
  return {
    cliente, pendentes: unicos, recebidos,
    arquivosDoGrupoAguardandoConferencia: conta("a_classificar", "classificando", "classificado", "confira") > 0,
    algumArquivoDoGrupoJaSalvo: conta("salvo") > 0,
  };
}

export async function andamentoDoGrupo(_args: z.infer<typeof entradaSemArgumentos>, ctx: ContextoDoGrupo): Promise<Resultado> {
  const a = await andamento(ctx);
  const vinculado = !!a.cliente || !!ctx.obraId;
  return {
    dados: vinculado ? {
      cliente: a.cliente ? { primeiroNome: primeiroNome(a.cliente.name) || null } : null,
      processos: a.processos,
      observacao: a.processos.length ? "Só situação (em análise, em andamento, aguardando dados, concluído, pausado ou encerrado), etapas e datas de movimento deste grupo. Prazos previstos, valores e resultado de aprovação não são informados no grupo." : "Nenhum processo registrado para este cliente.",
    } : { semVinculo: true, observacao: "Grupo ainda sem cliente ligado no sistema." },
    resumo: { vinculado, processos: a.processos.length },
  };
}

export async function documentosPendentesDoGrupo(_args: z.infer<typeof entradaSemArgumentos>, ctx: ContextoDoGrupo): Promise<Resultado> {
  const p = await pendencias(ctx);
  if (!p.cliente) return { dados: { semVinculo: true, observacao: "Grupo ainda sem cliente ligado no sistema." }, resumo: { vinculado: false } };
  return {
    dados: {
      pendentes: p.pendentes, documentosRecebidos: p.recebidos,
      arquivosRecebidosNoGrupoAguardandoConferencia: p.arquivosDoGrupoAguardandoConferencia,
      observacao: p.pendentes.length ? "Documentos que ainda faltam pelo cadastro." : "Nenhum documento pendente no cadastro.",
    },
    resumo: { vinculado: true, pendentes: p.pendentes.length, recebidos: p.recebidos },
  };
}

/** Próximos passos montados pelo SISTEMA (frases fixas a partir dos dados permitidos; nada de texto livre da equipe). */
export async function proximosPassosDoGrupo(_args: z.infer<typeof entradaSemArgumentos>, ctx: ContextoDoGrupo): Promise<Resultado> {
  const [a, p] = await Promise.all([andamento(ctx), pendencias(ctx)]);
  if (!a.cliente && !ctx.obraId) return { dados: { semVinculo: true, observacao: "Grupo ainda sem cliente ligado no sistema." }, resumo: { vinculado: false } };
  const passos: string[] = [];
  const recusados = p.pendentes.filter(d => d.situacao.startsWith("recusado"));
  if (recusados.length) passos.push(`Reenviar ${recusados.length === 1 ? "o documento recusado" : `${recusados.length} documentos recusados`}: ${recusados.slice(0, 5).map(d => d.documento).join(", ")}.`);
  const faltam = p.pendentes.filter(d => !d.situacao.startsWith("recusado"));
  if (faltam.length) passos.push(`Enviar ${faltam.length === 1 ? "o documento que falta" : `os ${faltam.length} documentos que faltam`}: ${faltam.slice(0, 8).map(d => d.documento).join(", ")}${faltam.length > 8 ? " e outros" : ""}.`);
  if (p.arquivosDoGrupoAguardandoConferencia) passos.push("A equipe vai conferir os arquivos enviados aqui no grupo.");
  for (const pr of a.processos) {
    if (pr.encerrado) continue;
    if (typeof pr.etapaAtual === "string" && pr.etapaAtual !== "todas as etapas concluídas") passos.push(`${pr.modulo}: etapa em andamento — ${pr.etapaAtual}${typeof pr.proximaEtapa === "string" ? `; depois, ${pr.proximaEtapa}` : ""}.`);
  }
  if (!passos.length) passos.push("Nada pendente do lado do cliente no cadastro; a equipe segue com o atendimento.");
  return { dados: { passos: passos.slice(0, 8) }, resumo: { passos: passos.length } };
}

// ── Etapa 7 — grupo de PARCEIROS: só os clientes de QUEM MARCOU ──

/** Teto de clientes do parceiro consultados por marcação (a resposta é curta; o resto, a equipe responde). */
export const MAX_CLIENTES_DO_PARCEIRO = 10;

/** "Maria S." — primeiro nome e a inicial do último sobrenome (o grupo é lido por outros parceiros). */
function nomeCurto(nome: string | null | undefined): string | null {
  const p = primeiroNome(nome);
  if (!p) return null;
  const ultimo = String(nome ?? "").trim().split(/\s+/).slice(1).pop() ?? "";
  const inicial = /^[A-Za-zÀ-ÖØ-öø-ÿ]/.test(ultimo) ? `${ultimo[0].toUpperCase()}.` : "";
  return inicial ? `${p} ${inicial}` : p;
}

/**
 * Andamento dos clientes que o PARCEIRO (corretor) de quem marcou indicou: só os leads ativos com `broker_id` = esse usuário, até
 * {@link MAX_CLIENTES_DO_PARCEIRO}, mais recentes primeiro. Por cliente, só o nome curto e a MESMA lista de campos permitidos do
 * grupo de cliente (situação neutra, etapas, progresso, última movimentação). Nunca valores, comissão, CPF, telefone, etapa
 * comercial, anotações nem cliente de outro parceiro. Sem parceiro identificado: nada.
 */
export async function andamentoDosClientesDoParceiro(_args: z.infer<typeof entradaSemArgumentos>, ctx: ContextoDoGrupo): Promise<Resultado> {
  if (!ctx.parceiroUserId) return { dados: { semParceiro: true, observacao: "Quem perguntou não foi identificado como parceiro." }, resumo: { parceiro: false } };
  const meus = await db().select({ id: leads.id, name: leads.name }).from(leads)
    .where(and(eq(leads.brokerId, ctx.parceiroUserId), isNull(leads.deletedAt), ne(leads.stage, LEAD_FINALIZED_STAGE)))
    .orderBy(desc(leads.updatedAt)).limit(MAX_CLIENTES_DO_PARCEIRO);
  const clientes: Array<Record<string, unknown>> = [];
  for (const l of meus) {
    const a = await andamento({ agora: ctx.agora, grupoId: ctx.grupoId, leadId: l.id, obraId: null });
    clientes.push({ cliente: nomeCurto(l.name) ?? "cliente", processos: a.processos });
  }
  return {
    dados: clientes.length ? {
      clientes,
      observacao: "Só os clientes indicados por quem perguntou: situação (em análise, em andamento, aguardando dados, concluído, pausado ou encerrado), etapas e datas de movimento. Valores, comissões, prazos e resultado de aprovação não são informados no grupo.",
    } : { clientes: [], observacao: "Nenhum cliente em andamento indicado por quem perguntou." },
    resumo: { parceiro: true, clientes: clientes.length },
  };
}
