// Lote 23/10, etapa 4 — "Concluir" um serviço no CRM conclui o registro do módulo
// vinculado. Gêmeo em Grupo-Santa-Fe/web/src/lib/crm/conclusao-servico.ts (mesmas regras
// e mensagens; valores de status de cada stack).
//
// O vínculo é sempre pelo ID do serviço (lead_service_id), nunca por nome ou CPF.
// Só o status muda: etapas, documentos, valores e histórico ficam intactos.
// A propagação é de mão única (CRM → módulo), então não há recursão.

/** Status "concluído" de cada módulo (valor gravado no banco). */
export const STATUS_CONCLUIDO_DO_MODULO = {
  obras: "completed",
  projetos: "entregue",
  regularizacoes: "concluido",
  financiamentos: "liberado", // exibido como "Concluído" (etapa 5)
  avaliacoes: "entregue",
  tarefas: "done",
} as const;

/** Status de cancelamento: registro cancelado não é reaberto como concluído. */
export const STATUS_CANCELADO_DO_MODULO: Record<ModuloConcluivel, string> = {
  obras: "cancelled",
  projetos: "cancelado",
  regularizacoes: "cancelado",
  financiamentos: "cancelado",
  avaliacoes: "cancelada",
  tarefas: "cancelled",
};

export type ModuloConcluivel = keyof typeof STATUS_CONCLUIDO_DO_MODULO;

export function moduloConcluivel(modulo: string | null | undefined): modulo is ModuloConcluivel {
  return !!modulo && Object.hasOwn(STATUS_CONCLUIDO_DO_MODULO, modulo);
}

export type ResultadoConclusao =
  | { estado: "concluido"; modulo: ModuloConcluivel; registroId: number | string }
  | { estado: "ja_concluido"; modulo: ModuloConcluivel; registroId: number | string }
  | { estado: "cancelado"; modulo: ModuloConcluivel; registroId: number | string }
  | { estado: "sem_registro"; modulo: string | null }
  | { estado: "sem_modulo"; modulo: string | null };

/** Aviso exibido ao concluir no CRM (nunca diz que concluiu o que não concluiu). */
export function mensagemConclusao(r: ResultadoConclusao): string {
  switch (r.estado) {
    case "concluido": return "Serviço concluído no CRM e no módulo vinculado.";
    case "ja_concluido": return "Serviço concluído no CRM; o registro do módulo já estava concluído.";
    case "cancelado": return "Serviço concluído no CRM, mas o registro do módulo está cancelado e não foi alterado.";
    case "sem_registro": return "Serviço concluído no CRM; não há registro vinculado no módulo para concluir.";
    case "sem_modulo": return "Serviço concluído no CRM.";
  }
}
