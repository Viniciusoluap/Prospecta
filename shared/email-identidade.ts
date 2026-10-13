// 10 implementações, item 08 — identidade dos e-mails da Prospecta (exclusivo da Prospecta).
// Substitui "Prospecta Empreendimentos - Grupo Efficaz". O ano do rodapé é sempre o atual.

export const IDENTIDADE_EMAIL = "Prospecta Construções - VFX Capital";

/** Nome exibido como remetente; o endereço continua sendo o SMTP_USER configurado. */
export const REMETENTE_EMAIL = IDENTIDADE_EMAIL;

export function rodapeEmail(data: Date = new Date()): string {
  return `© ${data.getFullYear()} ${IDENTIDADE_EMAIL}`;
}
