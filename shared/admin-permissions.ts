// Módulos que o admin libera ao colaborador (pedido de 17/10/2026): as 15 opções
// do Painel Administrativo, na mesma ordem, + o Ecossistema de Sorteio. "API
// Contas" (integração bancária) e "Usuários e Acessos" ficam só com o admin.
// "Corretores" deixou de ser módulo em 15/11/2026 (EPIC-023): o cadastro foi para "Usuários e Acessos" (só admin).
// Mesma lista (sem o sorteio e sem a Maquete 3D, exclusivos do Prospecta) em Grupo-Santa-Fe/web/src/lib/modulos.ts.
export const ADMIN_MODULES = [
  "crm", "obras", "agenda", "regularizacao", "comissoes", "projetos",
  "mapa", "avaliacoes", "imoveis", "incorporacao", "whatsapp", "bpo",
  "financiamentos", "juridico", "maquete3d", "sorteios",
] as const;

export type AdminModule = (typeof ADMIN_MODULES)[number];

export const ADMIN_MODULE_LABELS: Record<AdminModule, string> = {
  crm: "CRM / Pipeline",
  obras: "Obras",
  agenda: "Tarefas e Agenda",
  regularizacao: "Regularizações",
  comissoes: "Comissões",
  projetos: "Projetos",
  mapa: "Mapa operacional",
  avaliacoes: "Avaliações",
  imoveis: "Imóveis",
  incorporacao: "Incorporação",
  whatsapp: "WhatsApp",
  bpo: "BPO Financeiro",
  financiamentos: "Financiamentos",
  juridico: "Jurídico",
  maquete3d: "Maquete 3D",
  sorteios: "Ecossistema de Sorteio",
};

/**
 * Chaves antigas gravadas antes de 17/10/2026: Contabilidade e Relatórios entraram
 * no BPO Financeiro e o Agregador em Imóveis. Painel, Integração bancária e
 * Configurações deixaram de ser módulos (o painel é a página inicial de todos;
 * as outras duas são só do admin).
 */
const MODULOS_ANTIGOS: Readonly<Record<string, AdminModule>> = {
  contabilidade: "bpo",
  relatorios: "bpo",
  agregador: "imoveis",
};

export function normalizePermissions(value: unknown): AdminModule[] {
  const raw = Array.isArray(value) ? value : [];
  const modulos = raw
    .map((item) => (typeof item === "string" ? MODULOS_ANTIGOS[item] ?? item : null))
    .filter((item): item is AdminModule => !!item && ADMIN_MODULES.includes(item as AdminModule));
  return ADMIN_MODULES.filter((m) => modulos.includes(m));
}

export function parsePermissions(value: string | null | undefined): AdminModule[] {
  try {
    return normalizePermissions(JSON.parse(value || "[]"));
  } catch {
    return [];
  }
}
