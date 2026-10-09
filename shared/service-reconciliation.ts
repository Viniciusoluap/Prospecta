export type ProcessReference = {
  id: number;
  lead_id: number | null;
  lead_service_id: number | null;
};

/** Exige chaves explícitas; correspondências por nome nunca são permitidas. */
export function selectProcessReference(
  rows: ProcessReference[],
  leadId: number,
  serviceId: number,
  operationalRecordId: number | null,
  siblingServiceCount: number,
) {
  const linked = rows.find(row => row.lead_service_id === serviceId);
  const explicit = operationalRecordId === null ? undefined : rows.find(row => row.id === operationalRecordId);
  if (explicit && (
    explicit.lead_id !== null && explicit.lead_id !== leadId ||
    explicit.lead_service_id !== null && explicit.lead_service_id !== serviceId
  )) return { state: "conflict" as const };

  const orphaned = rows.filter(row => row.lead_id === leadId && row.lead_service_id === null);
  const selected = linked ?? explicit ?? (orphaned.length === 1 && siblingServiceCount === 1 ? orphaned[0] : undefined);
  if (!selected) return {
    state: orphaned.length > 1 || orphaned.length > 0 && siblingServiceCount > 1
      ? "ambiguous" as const : "awaiting_configuration" as const,
  };
  if (selected.lead_id !== null && selected.lead_id !== leadId ||
    rows.some(row => row.lead_service_id === serviceId && row.id !== selected.id))
    return { state: "conflict" as const };
  return { state: linked ? "already_linked" as const : "relinked" as const, selected };
}
