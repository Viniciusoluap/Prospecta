// Cliente do WhatsApp Business Cloud API (Meta Graph API) — porta direta da
// lógica do Grupo Santa Fé (api/whatsapp/enviar/route.ts). A Evolution API
// (QR code/Baileys) existe no Santa Fé como código morto, sem nenhum import
// fora de si mesma — não portada aqui (No Invention).

/** Normaliza um telefone brasileiro (só dígitos, com DDI 55) para o formato exigido pela Graph API. */
export function normalizarNumero(numero: string): string {
  const num = numero.replace(/\D/g, "");
  return num.startsWith("55") ? num : `55${num}`;
}

export async function enviarWhatsappBusiness(
  token: string,
  phoneNumberId: string,
  numero: string,
  texto: string
): Promise<string | null> {
  const numFinal = normalizarNumero(numero);
  const res = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messaging_product: "whatsapp", to: numFinal, type: "text", text: { body: texto } }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { messages?: { id: string }[] };
  return data.messages?.[0]?.id ?? null;
}

/** Normaliza o status bruto de um evento de webhook para o vocabulário interno. */
export function normalizarStatusWebhook(rawStatus: string | undefined): string {
  const status = (rawStatus ?? "").toLowerCase();
  if (status === "delivery_ack" || status === "delivered") return "entregue";
  if (status === "read") return "lida";
  if (status === "failed" || status === "error") return "falhou";
  return "enviada";
}
