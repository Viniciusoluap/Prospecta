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

/** Emissão só depois da homologação (S-4). Usado pelo servidor e pela tela (botão desabilitado). */
export const EMISSAO_DISPONIVEL = false;
export const AVISO_EMISSAO_INDISPONIVEL = "Emissão disponível após a homologação.";

/** Só a emissão real (S-4) grava estas situações; o servidor desta etapa recusa todas. */
export function exigeEmissao(para: StatusNota): boolean {
  return para === "EMITINDO" || para === "EMITIDA" || para === "CANCELADA" || para === "ERRO";
}
