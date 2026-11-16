// Maquete 3D (EPIC-024 S-03, QA rodada 2, N6) — rótulo do botão que continua a leitura, conforme o motivo da espera.
// Função pura (testada no servidor): "depois de cadastrar a chave" só quando o que falta é a chave da IA.

export type MotivoEspera = "chave" | "teto" | "confirmacao" | null | undefined;

export function rotuloContinuarLeitura(estadoDoProximo: string | null | undefined, motivo: MotivoEspera): string {
  if (estadoDoProximo === "erro") return "Tentar de novo este passo";
  if (estadoDoProximo === "aguardando" && motivo === "chave") return "Continuar leitura (depois de cadastrar a chave)";
  return "Continuar leitura";
}
