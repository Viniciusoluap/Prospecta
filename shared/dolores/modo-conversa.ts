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

/**
 * Um silêncio automático novo (mensagem da equipe enviada em `desde`) vale depois de um "Devolver" em `devolvidaEm`? Só se a
 * mensagem for do mesmo instante ou POSTERIOR ao "Devolver" (o eco atrasado de uma mensagem anterior não cala de novo).
 */
export const silencioValeDepoisDeDevolver = (desde: Date, devolvidaEm: Date | null | undefined) => !devolvidaEm || desde.getTime() >= devolvidaEm.getTime();

export const ACOES_DO_ATENDIMENTO = ["assumir", "devolver"] as const;
export type AcaoDoAtendimento = (typeof ACOES_DO_ATENDIMENTO)[number];

/** Textos da tela (curtos). */
export const TEXTO_MODO = {
  dolores: "Dolores atendendo",
  assumida: "Equipe atendendo (assumida)",
  silencio: "Equipe atendendo",
  assumir: "Assumir (humano)",
  devolver: "Devolver para a Dolores",
  ajudaAssumir: "A Dolores fica calada nesta conversa até alguém devolver. Nenhuma mensagem é enviada.",
  ajudaDevolver: "Ela responde só a próxima mensagem do cliente; as antigas sem resposta ficam com a equipe.",
} as const;
