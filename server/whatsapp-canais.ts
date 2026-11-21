// EPIC-025 (etapa 9, item 7 da regra do dono de 20/11/2026) — o PONTO ÚNICO que escolhe o canal de envio de campanha/disparo da Central.
// Hoje só existe o WhatsApp Web pela Evolution. A API oficial da Meta fica reservada para os disparos de campanha, mas DESLIGADA: a
// coexistência no mesmo número é fase separada (credenciamento próprio na Meta, conferir Brasil, grupos e requisitos). Até lá, pelo
// número principal da empresa não há disparo em massa: uma mensagem por vez. A conexão própria do corretor segue como antes.
import { LOTE_ENVIO_WHATSAPP } from "../shared/whatsapp/conversas.js";

/** Coexistência com a API oficial no número principal — NÃO implementada (fase separada). Não ligar sem a fase própria. */
export const API_OFICIAL_PARA_CAMPANHAS = false as const;

// EPIC-027 C7.2 (21/11/2026): a coexistência já existe (YCloud, C7) — o disparo em massa é a "Campanha pela API oficial".
export const AVISO_DISPARO_BLOQUEADO =
  "Pelo WhatsApp Web, o número da empresa envia para um contato por vez. Disparo em massa: use a \"Campanha pela API oficial\" (modelo aprovado pela Meta), em Enviar mensagem.";

export type CanalDeDisparo = { canal: "evolution" | "api_oficial"; maxDestinatarios: number; aviso: string | null };

export function canalDeDisparo(p: { daEmpresa: boolean }): CanalDeDisparo {
  if (!p.daEmpresa) return { canal: "evolution", maxDestinatarios: LOTE_ENVIO_WHATSAPP, aviso: null };
  if (API_OFICIAL_PARA_CAMPANHAS) return { canal: "api_oficial", maxDestinatarios: LOTE_ENVIO_WHATSAPP, aviso: null };
  return { canal: "evolution", maxDestinatarios: 1, aviso: AVISO_DISPARO_BLOQUEADO };
}

// ── QA-SEG E9 achado 5: ritmo dos envios MANUAIS pela conexão da empresa (Enviar mensagem, Templates e responder na Central) ──
// O limite de 1 destinatário por chamada não basta: um laço de chamadas viraria disparo em massa. Teto por minuto e por dia, no
// SERVIDOR, somando todos os usuários (é o mesmo número). Os automáticos (saudação, avisos, Dolores) têm os próprios tetos.
export const TETO_ENVIO_MANUAL_MINUTO = 10;
export const TETO_ENVIO_MANUAL_DIA = 200;
export const AVISO_TETO_MINUTO =
  `Limite de envios pelo número da empresa: no máximo ${TETO_ENVIO_MANUAL_MINUTO} mensagens por minuto (protege o número contra bloqueio). Aguarde um minuto e tente de novo.`;
export const AVISO_TETO_DIA =
  `Limite de ${TETO_ENVIO_MANUAL_DIA} mensagens por dia pelo número da empresa atingido (protege o número contra bloqueio). Tente de novo amanhã.`;
export const AVISO_TETO_INDISPONIVEL = "Não consegui conferir o limite de envios do número da empresa; nada foi enviado. Tente de novo em instantes.";

/**
 * Reserva UM envio manual pelo número da empresa (contadores atômicos no banco). null = pode enviar; texto = o motivo para a tela.
 * Falha ao contar → recusa (falha fechada).
 */
export async function reservarEnvioManualDaEmpresa(): Promise<string | null> {
  try {
    const { agoraDoRoteamento, vagaNoContador } = await import("./dolores/roteamento.js");
    const { diaDeImperatriz } = await import("../shared/dolores/grupos.js");
    const agora = agoraDoRoteamento();
    if (!(await vagaNoContador(`envio-manual-min:${agora.toISOString().slice(0, 16)}`, TETO_ENVIO_MANUAL_MINUTO))) return AVISO_TETO_MINUTO;
    if (!(await vagaNoContador(`envio-manual-dia:${diaDeImperatriz(agora)}`, TETO_ENVIO_MANUAL_DIA))) return AVISO_TETO_DIA;
    return null;
  } catch {
    return AVISO_TETO_INDISPONIVEL;
  }
}
