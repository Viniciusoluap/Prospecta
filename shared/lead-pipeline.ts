/** Commercial stages. Operational services maintain their own independent statuses. */
export const LEAD_PIPELINE_STAGES = [
  { key: "lead_new", label: "Lead Novo", color: "bg-gray-500" },
  { key: "attending", label: "Em Atendimento", color: "bg-blue-500" },
  { key: "approved_projects", label: "Aprovado e Follow up", color: "bg-green-600" },
  { key: "followup", label: "Projetos e Vistorias", color: "bg-pink-500" },
  { key: "contracts_registry", label: "Contratos e Cartório", color: "bg-purple-600" },
  { key: "measurements", label: "Medições", color: "bg-teal-600" },
  { key: "finalized", label: "Finalizado", color: "bg-gray-400" },
] as const;

export type LeadPipelineStage = (typeof LEAD_PIPELINE_STAGES)[number]["key"];
export const LEAD_PIPELINE_KEYS = LEAD_PIPELINE_STAGES.map(stage => stage.key) as [LeadPipelineStage, ...LeadPipelineStage[]];

export const LEGACY_STAGE_LABELS: Record<string, string> = {
  lead_new: "Lead Novo",
  attending: "Em Atendimento",
  waiting_docs: "Aguardando Docs",
  analysis: "Em Análise",
  caixa_register: "Cadastro Caixa",
  approval: "Em Aprovação",
  approved: "Aprovado",
  rejected: "Reprovado",
  followup: "Follow-up",
  in_process: "Cliente em Processo",
  done: "Concluído",
};
