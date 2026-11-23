// EPIC-029 S-2 (22/11/2026) — situação do rascunho de nota e as mudanças permitidas.
// Fluxo do dono: A_DECIDIR → EMITIDA | SEM_NOTA | ADIADA; EMITIDA → CANCELADA.
// Nesta etapa NADA é emitido: EMITINDO, EMITIDA, CANCELADA e ERRO existem no CHECK do banco, mas o gatilho da 0154 recusa
// gravá-los até a S-4 (homologação). "Reabrir" (volta a A_DECIDIR) corrige uma decisão de "sem nota" ou "depois".

export const STATUS_NOTA = ["A_DECIDIR", "ADIADA", "SEM_NOTA", "EMITINDO", "EMITIDA", "CANCELADA", "ERRO"] as const;
export type StatusNota = (typeof STATUS_NOTA)[number];

/** Situações que esta etapa pode gravar (as outras só a partir da S-4). */
export const STATUS_DA_ETAPA_2 = ["A_DECIDIR", "ADIADA", "SEM_NOTA"] as const satisfies readonly StatusNota[];

export const ROTULO_STATUS: Record<StatusNota, string> = {
  A_DECIDIR: "A decidir",
  ADIADA: "Depois",
  SEM_NOTA: "Sem nota",
  EMITINDO: "Emitindo",
  EMITIDA: "Emitida",
  CANCELADA: "Cancelada",
  ERRO: "Erro na emissão",
};

/** Mudanças que a pessoa pode pedir. A emissão (→ EMITIDA) e o cancelamento (→ CANCELADA) entram na S-4/S-5. */
const TRANSICOES: Record<StatusNota, readonly StatusNota[]> = {
  A_DECIDIR: ["SEM_NOTA", "ADIADA", "EMITIDA"],
  ADIADA: ["SEM_NOTA", "ADIADA", "A_DECIDIR", "EMITIDA"],
  SEM_NOTA: ["A_DECIDIR"],
  EMITINDO: ["EMITIDA", "ERRO"],
  EMITIDA: ["CANCELADA"],
  ERRO: ["A_DECIDIR", "EMITINDO"],
  CANCELADA: [],
};

export function transicaoValida(de: StatusNota, para: StatusNota): boolean {
  return TRANSICOES[de]?.includes(para) ?? false;
}

/**
 * Trava geral da emissão no código (1ª das três). Ligada pelo dono em 23/11/2026: mesmo assim NADA sai enquanto a empresa
 * emissora não for liberada (`fiscal_emissores.emissao_liberada`, rota `emissores.liberarEmissao`, com a frase digitada) E o
 * ambiente dela não for "producao_restrita"/"producao" (rota `emissores.ambiente`). O gatilho da 0167 confere as duas no banco.
 * Usado pelo servidor (emissao.ts), pela Dolores (acoes/fiscal.ts) e pela tela. Voltar para `false` desliga tudo de uma vez.
 */
export const EMISSAO_DISPONIVEL = true;
export const AVISO_EMISSAO_INDISPONIVEL = "A emissão de notas está desligada no sistema.";

/** Frase que o admin digita para LIGAR a emissão de uma empresa emissora. Conferida no servidor (trim, comparação exata). */
export const FRASE_LIBERAR_EMISSAO = "LIBERAR EMISSÃO";

/**
 * Por que esta empresa não emite agora (null = as três travas abertas). Mesma regra do servidor (emissao.ts#emissorLiberado),
 * só para mostrar o motivo real na tela e no resumo da Dolores — quem decide se algo sai é sempre o servidor.
 */
export function motivoSemEmissao(
  emissor: { ambiente: string | null | undefined; emissaoLiberada: boolean | null | undefined } | null | undefined,
  disponivel: boolean = EMISSAO_DISPONIVEL,
): { rotulo: string; frase: string } | null {
  if (!disponivel) return { rotulo: "desligada no sistema", frase: AVISO_EMISSAO_INDISPONIVEL };
  if (!emissor) return { rotulo: "sem empresa emissora", frase: "Escolha a empresa emissora (Editar)." };
  if (emissor.ambiente !== "producao_restrita" && emissor.ambiente !== "producao") {
    return { rotulo: "ambiente desligado", frase: "O ambiente de emissão desta empresa está desligado (Dados fiscais do perfil › Ambiente)." };
  }
  if (emissor.emissaoLiberada !== true) {
    return { rotulo: "empresa não liberada", frase: "A emissão desta empresa ainda não foi liberada pelo administrador (Dados fiscais do perfil › Liberar emissão desta empresa)." };
  }
  return null;
}

/** Só a emissão real (S-4) grava estas situações; o servidor desta etapa recusa todas. */
export function exigeEmissao(para: StatusNota): boolean {
  return para === "EMITINDO" || para === "EMITIDA" || para === "CANCELADA" || para === "ERRO";
}
