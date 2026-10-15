import { LEAD_PIPELINE_STAGES, LEGACY_STAGE_LABELS } from "./lead-pipeline.js";

// Portal do corretor (pedido de 15/10). Gêmeo em
// Grupo-Santa-Fe/web/src/lib/portal-corretor.ts.

/** Tipos de imóvel que o corretor pode marcar (sem texto livre). */
export const BROKER_PROPERTY_TYPES = [
  { value: "casa", label: "Casa" },
  { value: "apartamento", label: "Apartamento" },
  { value: "lote", label: "Lote" },
  { value: "sala_comercial", label: "Sala comercial" },
  { value: "galpao", label: "Galpão" },
] as const;

export const MAX_BROKER_PHOTOS = 15;
/** Foto já comprimida no aparelho (1200 px, JPEG): ~3 MiB em base64 é folga. */
const MAX_PHOTO_CHARS = 4 * 1024 * 1024;

export function isPropertyPhoto(value: string): boolean {
  return value.length <= MAX_PHOTO_CHARS && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value);
}

/** Etapa do CRM em que o lead está, com a posição na régua das 7 etapas. */
export function brokerLeadStage(stage: string): { stageLabel: string; stageIndex: number; totalStages: number } {
  const index = LEAD_PIPELINE_STAGES.findIndex(s => s.key === stage);
  return {
    stageLabel: index >= 0 ? LEAD_PIPELINE_STAGES[index].label : LEGACY_STAGE_LABELS[stage] ?? "Em classificação",
    stageIndex: index,
    totalStages: LEAD_PIPELINE_STAGES.length,
  };
}
