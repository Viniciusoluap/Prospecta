// EPIC-026 C6 — "Assumir (humano)" / "Devolver para a Dolores" na conversa da Central WhatsApp (pedido do dono de 20/11/2026:
// "Faça um botão nas mensagens lá no WhatsApp para que coloque para assumir o humano ou devolver pra Dolores"). Regra pura, sem
// banco: quem atende a conversa agora. Precedência: assumida pela equipe (sem prazo) > silêncio automático depois de resposta da
// equipe (até `silencioAte`) > Dolores.

export type ModoGravado = "humano" | "dolores";
export type EstadoDoAtendimento = "assumida" | "silencio" | "dolores";

export function estadoDoAtendimento(p: { modo: ModoGravado | null | undefined; silencioAte: Date | null | undefined; agora: Date }): EstadoDoAtendimento {
  if (p.modo === "humano") return "assumida";
  if (p.silencioAte && p.silencioAte.getTime() > p.agora.getTime()) return "silencio";
  return "dolores";
}

/** Folga a favor do silêncio: a hora do eco do celular vem em SEGUNDOS e a do "Devolver" em ms (QA-SEG C6 M1). */
export const FOLGA_DEVOLVER_MS = 5_000;

/**
 * Um silêncio automático novo (mensagem da equipe enviada em `desde`) vale depois de um "Devolver" em `devolvidaEm`? Só se a
 * mensagem for de até 5 s antes do "Devolver" ou posterior (o eco bem atrasado de uma mensagem anterior não cala de novo). Na
 * dúvida dentro da folga, cala (pior caso: um eco antigo recala — seguro).
 */
export const silencioValeDepoisDeDevolver = (desde: Date, devolvidaEm: Date | null | undefined) =>
  !devolvidaEm || desde.getTime() >= devolvidaEm.getTime() - FOLGA_DEVOLVER_MS;

export const ACOES_DO_ATENDIMENTO = ["assumir", "devolver"] as const;
export type AcaoDoAtendimento = (typeof ACOES_DO_ATENDIMENTO)[number];

/** Textos da tela (curtos). */
export const TEXTO_MODO = {
  dolores: "Dolores atendendo",
  assumida: "Equipe atendendo (assumida)",
  silencio: "Equipe atendendo",
  assumir: "Assumir (humano)",
  devolver: "Devolver para a Dolores",
  // EPIC-027 C6: a frase abaixo do botão descreve o efeito de TOCAR nele (antes, com "Dolores atendendo", parecia dizer que ela já
  // estava calada). Uma por estado.
  /** Estado "Dolores atendendo" (botão "Assumir"). */
  ajudaAssumir: "Toque em Assumir para a Dolores parar de responder nesta conversa até você devolver. Tocar não envia nada ao cliente.",
  /** Estado "Equipe atendendo (assumida)" (botão "Devolver"). */
  ajudaDevolver: "A Dolores está parada nesta conversa. Toque em Devolver para ela voltar: responde só a próxima mensagem do cliente; as antigas sem resposta ficam com a equipe. Tocar não envia nada.",
  /** Estado "Equipe atendendo" por silêncio automático depois de resposta da equipe (botão "Devolver"). */
  ajudaSilencio: "A Dolores está parada porque a equipe respondeu; ela volta sozinha no horário indicado. Toque em Devolver para ela voltar antes: responde só a próxima mensagem do cliente. Tocar não envia nada.",
} as const;
/** A frase de ajuda do estado atual (o efeito de tocar no botão). */
export const ajudaDoEstado = (e: EstadoDoAtendimento) => (e === "assumida" ? TEXTO_MODO.ajudaDevolver : e === "silencio" ? TEXTO_MODO.ajudaSilencio : TEXTO_MODO.ajudaAssumir);
