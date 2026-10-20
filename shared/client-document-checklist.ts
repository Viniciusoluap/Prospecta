/** Checklist atual; tipos legados seguem armazenados e consultáveis pelo administrador. */
export const CLIENT_DOCUMENT_CHECKLIST = [
  ["rg", "RG ou CNH frente e verso"],
  ["address_proof", "Comprovante de endereço atualizado"],
  ["income_proof_formal", "Comprovante de renda atualizado"],
  ["spouse_docs", "RG ou CNH frente e verso (Cônjuge)"],
  ["spouse_income_proof", "Comprovante de renda atualizado (Cônjuge)"],
  ["pis", "PIS"],
  ["fgts", "Extrato do FGTS"],
  ["birth_marriage_certificate", "Certidão de Nascimento ou Casamento"],
  ["other", "Outros"],
] as const;
export type ClientDocumentCategory = typeof CLIENT_DOCUMENT_CHECKLIST[number][0];
