/**
 * EPIC-017 — fonte única dos dados cadastrais que migram do lead (CRM) para os
 * registros operacionais (Avaliações, Projetos, Regularizações, Obras e
 * Financiamentos). O profissional nunca redigita o que o CRM já possui.
 */
export type LeadContactSource = {
  name: string;
  phone: string | null;
  email: string | null;
  cpf?: string | null;
  address?: string | null;
  neighborhood?: string | null;
  city: string | null;
  state: string | null;
};

export type LeadContact = {
  name: string;
  phone: string;
  email: string | null;
  cpf: string | null;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
};

const clean = (value: string | null | undefined) => (value ?? "").trim();

export function leadContact(lead: LeadContactSource): LeadContact {
  return {
    name: clean(lead.name),
    phone: clean(lead.phone),
    email: clean(lead.email) || null,
    cpf: clean(lead.cpf) || null,
    address: clean(lead.address),
    neighborhood: clean(lead.neighborhood),
    city: clean(lead.city),
    state: clean(lead.state).toUpperCase().slice(0, 2),
  };
}

/** Endereço em uma linha, para módulos que guardam o endereço num único campo. */
export function leadFullAddress(lead: LeadContactSource): string {
  const contact = leadContact(lead);
  const cityState = [contact.city, contact.state].filter(Boolean).join("/");
  return [contact.address, contact.neighborhood, cityState].filter(Boolean).join(", ");
}

/** Campos do lead que ainda faltam para que o endereço migre completo. */
export function missingLeadAddressFields(lead: LeadContactSource): string[] {
  const contact = leadContact(lead);
  const missing: string[] = [];
  if (!contact.address) missing.push("endereço");
  if (!contact.neighborhood) missing.push("bairro");
  if (!contact.city) missing.push("cidade");
  if (!contact.state) missing.push("UF");
  return missing;
}
