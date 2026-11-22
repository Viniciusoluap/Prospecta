// Maquete 3D (EPIC-028, Etapa 4) — página pública por lote: /maquete/<empreendimento>/<lote>-<código>.
// Regras compartilhadas pela tela e pelo servidor: formato do endereço (o código não adivinhável é o último pedaço do
// segmento do lote), status do lote só leitura (vem de incorporation_units, o inventário que a Incorporação e a
// Central de Vendas usam) e o link do WhatsApp da EMPRESA com a mensagem pronta do lote.
import { CANAL_DO_TITULAR } from "../termo-consentimento.js";
import type { FontePlanta } from "./fonte.js";

/** Slug de empreendimento ou de lote (o mesmo CHECK da 0146). */
export const SLUG_RE = /^[a-z0-9-]{1,80}$/;
/** Código do link: 10 letras/números (o CHECK da 0147 aceita de 10 a 24). */
export const CODIGO_RE = /^[a-z0-9]{10,24}$/;
/** Alfabeto do código (sem 0/o, 1/l/i, para ditar sem confusão): 31 símbolos × 10 ≈ 49 bits. */
export const ALFABETO_CODIGO = "abcdefghjkmnpqrstuvwxyz23456789";
export const TAMANHO_CODIGO = 10;

/** Separa o segmento do lote em slug + código ("qd18-lote4-k3m9x2pq7a" → qd18-lote4 / k3m9x2pq7a). */
export function separarLoteECodigo(segmento: string): { loteSlug: string; codigo: string } | null {
  if (typeof segmento !== "string" || segmento.length > 106) return null;
  const i = segmento.lastIndexOf("-");
  if (i <= 0) return null;
  const loteSlug = segmento.slice(0, i), codigo = segmento.slice(i + 1);
  return SLUG_RE.test(loteSlug) && CODIGO_RE.test(codigo) ? { loteSlug, codigo } : null;
}

/** Caminho público do lote. */
export const caminhoDoLote = (empreendimentoSlug: string, loteSlug: string, codigo: string) =>
  `/maquete/${empreendimentoSlug}/${loteSlug}-${codigo}`;

// ── Status (só leitura) ──

export type StatusLote = "disponivel" | "reservado" | "vendido";
export const ROTULO_STATUS: Record<StatusLote, string> = { disponivel: "Disponível", reservado: "Reservado", vendido: "Vendido" };
/** incorporation_units.status → status mostrado. Valor desconhecido → null (a página não mostra status). */
export function statusDaUnidade(s: string | null | undefined): StatusLote | null {
  return s === "disponivel" ? "disponivel" : s === "reservada" ? "reservado" : s === "vendida" ? "vendido" : null;
}

// ── WhatsApp da empresa ──

/** Número da EMPRESA, (99) 98139-2210: o mesmo canal já cadastrado no sistema (termo de consentimento, site). */
export const WHATSAPP_EMPRESA = `55${CANAL_DO_TITULAR.telefone.replace(/\D/g, "")}`;

export type TextosDoLote = { empreendimento: string; quadra: string | null; lote: string | null };

/** Nome do lote para o cliente: "Lote 4, Quadra 18". */
export function nomeDoLote(t: Pick<TextosDoLote, "quadra" | "lote">): string {
  return [t.lote ? `Lote ${t.lote}` : null, t.quadra ? `Quadra ${t.quadra}` : null].filter(Boolean).join(", ") || "Lote";
}

/** Mensagem pronta: empreendimento, quadra e lote. */
export function mensagemWhatsAppDoLote(t: TextosDoLote): string {
  return `Olá! Vi a maquete 3D do ${nomeDoLote(t)} (${t.empreendimento}) e quero saber mais sobre este lote.`;
}

/** https://wa.me/55…?text=… com o texto codificado. */
export function linkWhatsAppDoLote(t: TextosDoLote): string {
  return `https://wa.me/${WHATSAPP_EMPRESA}?text=${encodeURIComponent(mensagemWhatsAppDoLote(t))}`;
}

// ── Resposta pública (mínima) ──

export type DadosLotePublico = TextosDoLote & {
  /** Medidas da planta (estrutura do servidor) com os itens da versão PUBLICADA do lote. */
  fonte: FontePlanta;
  status: StatusLote | null;
};
