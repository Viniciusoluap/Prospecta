// Campos da Obra cuja fonte oficial é o CRM (Lote 1 — itens 08, 09 e 24).
// A obra apenas exibe esses dados; alterações acontecem somente no lead.

export function tipoProjetoDoServico(serviceType: string | null | undefined): string | null {
  if (!serviceType) return null;
  return serviceType === "vistoria_medicao" ? "Vistoria e medição" : "Obra / reforma";
}

export interface ObraDadosCrm {
  vinculada: boolean;
  clientName: string | null;
  brokerName: string | null;
  projectType: string | null;
  /** "crm" quando vem do lead/serviço; "legado" quando a obra não tem vínculo e mostra o valor antigo gravado. */
  projectTypeOrigem: "crm" | "legado" | null;
}

export function montarDadosCrmObra(input: {
  leadName: string | null | undefined;
  brokerName: string | null | undefined;
  serviceType: string | null | undefined;
  projectTypeGravado: string | null | undefined;
}): ObraDadosCrm {
  const tipoCrm = tipoProjetoDoServico(input.serviceType);
  const tipoLegado = input.projectTypeGravado?.trim() || null;
  return {
    vinculada: !!input.leadName,
    clientName: input.leadName?.trim() || null,
    brokerName: input.brokerName?.trim() || null,
    projectType: tipoCrm ?? tipoLegado,
    projectTypeOrigem: tipoCrm ? "crm" : tipoLegado ? "legado" : null,
  };
}
