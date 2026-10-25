// Pedido de 25/10 (noite), item 12 (opção B): a conexão do admin sai da Central WhatsApp e vai para
// Configurações › Integrações; corretor (e colaborador, que não acessa Integrações) conecta pela aba
// "Minha conexão" da Central. A Central abre em Conversas.
export type AbaCentral = "conexao" | "conversas" | "enviar" | "templates" | "historico";

export function abasCentralWhatsapp(role: string): AbaCentral[] {
  const base: AbaCentral[] = ["conversas", "enviar", "templates", "historico"];
  return role === "admin" ? base : [...base, "conexao"];
}

export function abaInicialCentral(role: string, pedida: string | null): AbaCentral {
  const abas = abasCentralWhatsapp(role);
  return abas.includes(pedida as AbaCentral) ? (pedida as AbaCentral) : "conversas";
}

/** Onde cada papel conecta o número (QR code). */
export const linkConexaoWhatsapp = (role: string) => (role === "admin" ? "/admin/integracoes" : "/admin/whatsapp?aba=conexao");
