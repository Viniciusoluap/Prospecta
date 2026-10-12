// Temperatura do lead (Lote 1 — item 05). Independente da etapa do funil.
export const LEAD_TEMPERATURAS = ["cold", "warm", "hot", "closed"] as const;

export type LeadTemperatura = (typeof LEAD_TEMPERATURAS)[number];

export const LEAD_TEMPERATURA_CONFIG: Record<LeadTemperatura, { label: string; emoji: string }> = {
  cold: { label: "Frio", emoji: "❄️" },
  warm: { label: "Morno", emoji: "🌡️" },
  hot: { label: "Quente", emoji: "🔥" },
  closed: { label: "Negócio fechado", emoji: "🤝" },
};

export function leadTemperaturaRotulo(temperatura: string | null | undefined): string {
  const cfg = LEAD_TEMPERATURA_CONFIG[(temperatura ?? "cold") as LeadTemperatura];
  return cfg ? `${cfg.emoji} ${cfg.label}` : String(temperatura);
}
