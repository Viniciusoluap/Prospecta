// A conexão fica em Serviços › WhatsApp para todos os perfis autorizados. A Central abre em
// Conversas e não expõe a antiga aba Histórico; os registros permanecem no banco para métricas.
export type AbaCentral = "conexao" | "conversas" | "enviar" | "templates";

export function abasCentralWhatsapp(role: string): AbaCentral[] {
  return ["conversas", "enviar", "templates", "conexao"];
}

export function abaInicialCentral(role: string, pedida: string | null): AbaCentral {
  const abas = abasCentralWhatsapp(role);
  return abas.includes(pedida as AbaCentral) ? (pedida as AbaCentral) : "conversas";
}

/** Onde cada papel conecta o número (QR code). */
export const linkConexaoWhatsapp = (_role: string) => "/admin/whatsapp?aba=conexao";
