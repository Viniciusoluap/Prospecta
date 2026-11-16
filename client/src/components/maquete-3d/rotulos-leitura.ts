// Maquete 3D (EPIC-024 S-03, QA rodada 2, N6) — rótulo do botão que continua a leitura, conforme o motivo da espera.
// Função pura (testada no servidor): "depois de cadastrar a chave" só quando o que falta é a chave da IA.

export type MotivoEspera = "chave" | "teto" | "confirmacao" | null | undefined;

export function rotuloContinuarLeitura(estadoDoProximo: string | null | undefined, motivo: MotivoEspera): string {
  if (estadoDoProximo === "erro") return "Tentar de novo este passo";
  if (estadoDoProximo === "aguardando" && motivo === "chave") return "Continuar leitura (depois de cadastrar a chave)";
  return "Continuar leitura";
}

/**
 * QA S-11 r2, achado 2: o botão de confirmar o custo diz com que modelo a IA vai ler (o mesmo que a tela devolve ao
 * confirmar). Sem o modelo (passo parado antes desta versão), o botão fica como era e o servidor pede para recarregar.
 */
export function rotuloConfirmarIA(modelo: string | null | undefined, rotulo: string): string {
  return modelo ? `${rotulo} — modelo ${modelo}` : rotulo;
}

/** Pergunta de "Autorizar além do teto", com o modelo que será usado. */
export function perguntaAlemDoTeto(pendentes: number, teto: number | null | undefined, modelo: string | null | undefined): string {
  return `Autorizar a leitura paga de mais ${pendentes} prancha(s) pela IA${modelo ? `, com o modelo ${modelo}` : ""}, além do teto de ${teto ?? "—"} desta maquete?`;
}
