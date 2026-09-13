export const ADMIN_MODULES = [
  "dashboard", "crm", "imoveis", "obras", "projetos", "regularizacao",
  "financiamentos", "juridico", "corretores", "comissoes", "avaliacoes",
  "bpo", "contabilidade", "banco", "whatsapp", "agregador", "configuracoes",
] as const;

export type AdminModule = (typeof ADMIN_MODULES)[number];

export const ADMIN_MODULE_LABELS: Record<AdminModule, string> = {
  dashboard: "Painel e indicadores",
  crm: "Leads / CRM",
  imoveis: "Imóveis",
  obras: "Obras",
  projetos: "Projetos e orçamentos",
  regularizacao: "Regularização",
  financiamentos: "Financiamentos",
  juridico: "Jurídico e contratos",
  corretores: "Corretores",
  comissoes: "Comissões",
  avaliacoes: "Avaliações",
  bpo: "BPO Financeiro",
  contabilidade: "Contabilidade",
  banco: "Integração bancária",
  whatsapp: "WhatsApp",
  agregador: "Agregador / feeds",
  configuracoes: "Configurações",
};

export function normalizePermissions(value: unknown): AdminModule[] {
  const raw = Array.isArray(value) ? value : [];
  return Array.from(new Set(raw.filter((item): item is AdminModule =>
    typeof item === "string" && ADMIN_MODULES.includes(item as AdminModule),
  )));
}

export function parsePermissions(value: string | null | undefined): AdminModule[] {
  try {
    return normalizePermissions(JSON.parse(value || "[]"));
  } catch {
    return [];
  }
}
