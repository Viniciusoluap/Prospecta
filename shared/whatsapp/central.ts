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

/**
 * Onde cada papel conecta o número (QR code). EPIC-025 E9 (regra do dono de 20/11/2026, "uma conexão só"): o admin conecta o número
 * da EMPRESA (Dolores e Central) em Configurações › Integrações; corretor e colaborador seguem na aba "Minha conexão" da Central (o
 * colaborador ali só vê a situação da conexão da empresa).
 */
export const linkConexaoWhatsapp = (role: string) => (role === "admin" ? "/admin/integracoes#whatsapp-empresa" : "/admin/whatsapp?aba=conexao");
