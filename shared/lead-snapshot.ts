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

// ── Endereço da Avaliação (regra do dono, 17/11/2026: "sempre vindo do lead, mas com a possibilidade de edição na
// avaliação, isso para os dois"). Gêmeo no Grupo Santa Fé: web/src/lib/crm/servicos-lead.ts (enderecoDaAvaliacaoAposLead).
//   - ao criar ou vincular, o endereço vem do lead;
//   - o endereço continua editável na avaliação e o que foi salvo nela nunca é sobrescrito ao salvar a avaliação;
//   - mudar o endereço do lead atualiza a avaliação campo a campo, só onde o valor da avaliação ainda é igual ao
//     antigo do lead, ou está vazio / "A definir". Cidade e UF também seguem quando o endereço da avaliação ainda está
//     pendente. Lead que apaga um campo não apaga o da avaliação.

/** Marcador de endereço pendente (usado no Santa Fé; aceito aqui pela mesma regra). */
export const ENDERECO_A_DEFINIR = "A definir";

export type EnderecoDaAvaliacao = { endereco: string; bairro: string; cidade: string; estado: string };

const comparavel = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const pendente = (v: string | null | undefined) => comparavel(v) === "" || comparavel(v) === comparavel(ENDERECO_A_DEFINIR);

/** Endereço do lead nos campos da avaliação. */
export function enderecoDoLeadParaAvaliacao(lead: Pick<LeadContactSource, "address" | "neighborhood" | "city" | "state">): EnderecoDaAvaliacao {
  const c = leadContact({ name: "", phone: null, email: null, ...lead });
  return { endereco: c.address, bairro: c.neighborhood, cidade: c.city, estado: c.state };
}

/**
 * O que muda na avaliação quando o endereço do lead muda de `antes` para `depois`. Devolve só os campos a gravar
 * (objeto vazio = nada muda).
 */
export function enderecoDaAvaliacaoAposLead(
  avaliacao: Partial<EnderecoDaAvaliacao>,
  antes: Pick<LeadContactSource, "address" | "neighborhood" | "city" | "state">,
  depois: Pick<LeadContactSource, "address" | "neighborhood" | "city" | "state">,
): Partial<EnderecoDaAvaliacao> {
  const velho = enderecoDoLeadParaAvaliacao(antes);
  const novo = enderecoDoLeadParaAvaliacao(depois);
  const enderecoPendente = pendente(avaliacao.endereco);
  const patch: Partial<EnderecoDaAvaliacao> = {};
  for (const campo of ["endereco", "bairro", "cidade", "estado"] as const) {
    const atual = avaliacao[campo];
    if (!novo[campo] || comparavel(novo[campo]) === comparavel(atual)) continue;
    const segueOLead = pendente(atual) || comparavel(atual) === comparavel(velho[campo])
      || ((campo === "cidade" || campo === "estado") && enderecoPendente);
    if (segueOLead) patch[campo] = novo[campo];
  }
  return patch;
}

/** Ao vincular um lead a uma avaliação: os campos que o lead tem preenchidos vêm dele; os vazios ficam como estão. */
export function enderecoAoVincular(lead: Pick<LeadContactSource, "address" | "neighborhood" | "city" | "state">): Partial<EnderecoDaAvaliacao> {
  const e = enderecoDoLeadParaAvaliacao(lead);
  return Object.fromEntries(Object.entries(e).filter(([, v]) => v)) as Partial<EnderecoDaAvaliacao>;
}
