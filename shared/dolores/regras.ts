// EPIC-025 (Dolores, etapa 1) — regras de leitura dos processos. Puras, sem banco nem rede.
// "Atrasado" segue o que as telas já usam: tarefa → `tarefaAtrasada` (shared/tarefas-filtro.ts); lançamento →
// `situacaoDoLancamento` (shared/financeiro/bpo-asaas.ts); processo/obra → previsão de término vencida e não encerrado.
import { diaFortaleza, diasEntre } from "./formato.js";

/** Sem movimentação há este número de dias (ou mais) = parado. Padrão da consulta; o agente pode pedir outro. */
export const DIAS_PARADO_PADRAO = 15;

export const RESPONSAVEL_A_CONFIRMAR = "a confirmar";

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
/** Valores que não identificam ninguém. O vazio é o padrão gravado pela migração do Trello (lead-services-router). */
const MARCADORES_SEM_RESPONSAVEL = new Set(["", "-", "—", "--", "sem responsavel", "a definir", "a confirmar", "nao definido", "indefinido", "n/a", "na", "nenhum"]);

export type Responsavel = { nome: string; aConfirmar: boolean; motivo: string | null };

/**
 * Responsável do processo. Vazio ou marcador → "a confirmar" (suposição 5 do EPIC-025): nunca um nome deduzido.
 * `migrado` = o processo veio de um cartão do Trello (serviço com `source_card_url`).
 */
export function responsavelDoProcesso(valor: string | null | undefined, migrado: boolean): Responsavel {
  const nome = String(valor ?? "").replace(/\s+/g, " ").trim();
  if (!MARCADORES_SEM_RESPONSAVEL.has(sem(nome))) return { nome, aConfirmar: false, motivo: null };
  return {
    nome: RESPONSAVEL_A_CONFIRMAR, aConfirmar: true,
    motivo: migrado ? "padrão da migração do Trello (responsável não informado)" : "responsável não registrado no processo",
  };
}

/** Responsável de tarefa (texto livre): "Sem responsável" e vazios contam como não definido. */
export function responsavelDaTarefa(valor: string | null | undefined): string {
  const nome = String(valor ?? "").trim();
  return MARCADORES_SEM_RESPONSAVEL.has(sem(nome)) ? "sem responsável" : nome;
}

export const STATUS_ENCERRADOS_PROCESSO = new Set(["concluido", "cancelado"]);

export type Etapa = { nome: string; ordem: number; progresso: number; observacoes?: string | null; updatedAt?: Date | string | null };

/** Etapa atual: a primeira (pela ordem) com progresso abaixo de 100 %; todas concluídas → a última. */
export function etapaAtual<T extends Etapa>(etapas: readonly T[]): (T & { todasConcluidas: boolean }) | null {
  const ordenadas = [...etapas].sort((a, b) => a.ordem - b.ordem);
  if (!ordenadas.length) return null;
  const aberta = ordenadas.find(e => e.progresso < 100);
  return aberta ? { ...aberta, todasConcluidas: false } : { ...ordenadas[ordenadas.length - 1], todasConcluidas: true };
}

/** Data mais recente da lista (ignora vazias). */
export function maisRecente(datas: readonly (Date | string | null | undefined)[]): Date | null {
  let r: Date | null = null;
  for (const d of datas) {
    if (!d) continue;
    const v = d instanceof Date ? d : new Date(d);
    if (!Number.isNaN(v.getTime()) && (!r || v > r)) r = v;
  }
  return r;
}

export type SituacaoPrazo = { atrasado: boolean; diasDeAtraso: number | null; diasSemMovimentacao: number | null; parado: boolean };

/** Atraso pela previsão (dia civil vencido) e parada pela última movimentação; encerrado nunca está atrasado. */
export function situacaoDoPrazo(p: {
  encerrado: boolean; prazo: Date | string | null | undefined; ultimaMovimentacao: Date | string | null | undefined;
  agora: Date; diasParado?: number;
}): SituacaoPrazo {
  const hoje = diaFortaleza(p.agora)!;
  const prazo = diaFortaleza(p.prazo);
  const atrasado = !p.encerrado && !!prazo && prazo < hoje;
  const diasSemMovimentacao = diasEntre(p.ultimaMovimentacao, p.agora);
  const parado = !p.encerrado && diasSemMovimentacao !== null && diasSemMovimentacao >= (p.diasParado ?? DIAS_PARADO_PADRAO);
  return { atrasado, diasDeAtraso: atrasado ? diasEntre(prazo, hoje) : null, diasSemMovimentacao, parado };
}

export type Providencia = { fonte: "tarefa" | "follow_up_crm" | "follow_up_agendado"; descricao: string; prazo: string | null; responsavel: string | null };
export type TarefaParaProvidencia = { title: string; status: string; dueAt: Date | string | null; assignedTo: string | null };

/**
 * Próxima providência REGISTRADA no sistema, nesta ordem: tarefa aberta (a de prazo mais cedo; sem prazo por último),
 * data de follow-up do lead, follow-up agendado pendente. Nada registrado → null (o agente diz "não registrada").
 */
export function proximaProvidencia(p: {
  tarefas: readonly TarefaParaProvidencia[]; followupDate?: Date | string | null;
  followUpsPendentes?: readonly { scheduledAt: Date | string; message?: string | null }[];
}): Providencia | null {
  const abertas = p.tarefas.filter(t => t.status === "pending" || t.status === "in_progress")
    .sort((a, b) => (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) - (b.dueAt ? new Date(b.dueAt).getTime() : Infinity));
  if (abertas[0]) {
    const t = abertas[0];
    return { fonte: "tarefa", descricao: t.title, prazo: t.dueAt ? String(diaFortaleza(t.dueAt)) : null, responsavel: responsavelDaTarefa(t.assignedTo) };
  }
  if (p.followupDate) return { fonte: "follow_up_crm", descricao: "Follow-up marcado no cadastro do cliente", prazo: diaFortaleza(p.followupDate), responsavel: null };
  const f = [...(p.followUpsPendentes ?? [])].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];
  if (f) return { fonte: "follow_up_agendado", descricao: "Follow-up agendado", prazo: diaFortaleza(f.scheduledAt), responsavel: null };
  return null;
}
