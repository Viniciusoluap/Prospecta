// EPIC-029 S-2 (22/11/2026) — motivos de "não emitir nota" (decisão do dono). Lista fechada; "outro" exige texto.
// A mesma lista está no CHECK de `fiscal_notas.motivo_sem_nota` (drizzle/0154_fiscal_notas.sql).

export const MOTIVOS_SEM_NOTA = [
  "reembolso_custas",
  "itbi_repassado",
  "taxa_caixa_repassada",
  "servico_nao_faturavel",
  "emitida_fora",
  "outro",
] as const;

export type MotivoSemNota = (typeof MOTIVOS_SEM_NOTA)[number];

export const ROTULO_MOTIVO: Record<MotivoSemNota, string> = {
  reembolso_custas: "Reembolso de custas/cartório",
  itbi_repassado: "ITBI repassado",
  taxa_caixa_repassada: "Taxa da Caixa repassada",
  servico_nao_faturavel: "Serviço não faturável",
  emitida_fora: "Emitida fora do sistema",
  outro: "Outro",
};

export function ehMotivoSemNota(valor: unknown): valor is MotivoSemNota {
  return typeof valor === "string" && (MOTIVOS_SEM_NOTA as readonly string[]).includes(valor);
}

/** Texto mínimo exigido quando o motivo é "outro" (o mesmo limite está no CHECK do banco). */
export const MINIMO_TEXTO_OUTRO = 3;

/** Devolve a frase do problema, ou null quando o motivo é aceito. */
export function problemaDoMotivo(motivo: unknown, texto?: string | null): string | null {
  if (!ehMotivoSemNota(motivo)) return "Escolha o motivo de não emitir a nota.";
  if (motivo === "outro" && (texto ?? "").trim().length < MINIMO_TEXTO_OUTRO) {
    return "Com o motivo \"Outro\", escreva o motivo (pelo menos 3 letras).";
  }
  return null;
}
