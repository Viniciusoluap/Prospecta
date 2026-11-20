// EPIC-025 (etapa 9, item 7 da regra do dono de 20/11/2026) — o PONTO ÚNICO que escolhe o canal de envio de campanha/disparo da Central.
// Hoje só existe o WhatsApp Web pela Evolution. A API oficial da Meta fica reservada para os disparos de campanha, mas DESLIGADA: a
// coexistência no mesmo número é fase separada (credenciamento próprio na Meta, conferir Brasil, grupos e requisitos). Até lá, pelo
// número principal da empresa não há disparo em massa: uma mensagem por vez. A conexão própria do corretor segue como antes.
import { LOTE_ENVIO_WHATSAPP } from "../shared/whatsapp/conversas.js";

/** Coexistência com a API oficial no número principal — NÃO implementada (fase separada). Não ligar sem a fase própria. */
export const API_OFICIAL_PARA_CAMPANHAS = false as const;

export const AVISO_DISPARO_BLOQUEADO =
  "Disparo em massa pelo número principal da empresa está bloqueado até a coexistência com a API oficial do WhatsApp (fase separada). Envie para um contato por vez.";

export type CanalDeDisparo = { canal: "evolution" | "api_oficial"; maxDestinatarios: number; aviso: string | null };

export function canalDeDisparo(p: { daEmpresa: boolean }): CanalDeDisparo {
  if (!p.daEmpresa) return { canal: "evolution", maxDestinatarios: LOTE_ENVIO_WHATSAPP, aviso: null };
  if (API_OFICIAL_PARA_CAMPANHAS) return { canal: "api_oficial", maxDestinatarios: LOTE_ENVIO_WHATSAPP, aviso: null };
  return { canal: "evolution", maxDestinatarios: 1, aviso: AVISO_DISPARO_BLOQUEADO };
}
