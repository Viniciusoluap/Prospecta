export function faseDocumento(tipo:string) {
  if(tipo==="assinado")return "Assinado por todos";
  if(tipo==="assinatura_digital")return "Assinado pela empresa";
  if(tipo==="recebido_assinado")return "Recebido para conferência";
  if(tipo==="contrato_gerado")return "Contrato gerado";
  return "Anexo";
}
export function nomeContrato(cliente:string|null|undefined,tipo:string) {
  const nome=(cliente||"Cliente").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9 ._-]/g,"").trim().replace(/\s+/g," ").slice(0,110)||"Cliente";
  return `Contrato - ${nome} - ${faseDocumento(tipo)}.pdf`;
}
export function tituloContrato(cliente:string|null|undefined) { return `Contrato — ${cliente?.trim()||"Cliente"}`; }
