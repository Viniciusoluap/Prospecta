// EPIC-029 S-5 (22/11/2026) — validador ÚNICO de CNPJ (numérico e alfanumérico) e de CPF.
//
// CNPJ alfanumérico (IN RFB 2.229/2024, emitido desde 07/2026): as 12 primeiras posições aceitam letras (A–Z) e números;
// as 2 últimas (dígitos verificadores) continuam numéricas. O cálculo é o mesmo módulo 11 do CNPJ numérico, com os
// mesmos pesos; cada caractere vale o seu código ASCII menos 48 ("0" = 0 … "9" = 9, "A" = 17 … "Z" = 42). Para um CNPJ
// só de números o resultado é IDÊNTICO ao cálculo antigo (é a mesma conta).
//
// Antes desta etapa havia 4 cópias do cálculo (DIAGNOSTICO.md §2): `shared/contratos/modelos.ts`, `shared/dolores/notas.ts`,
// `shared/dolores/sanitizar.ts` e `shared/pci-gerador.ts`. Todas passam a usar `cnpjValido` daqui. As que só trabalham com
// números (texto livre filtrado pela Dolores, coluna numérica das notas de grupo, memorial do PCI) continuam restritas a
// números por uma guarda explícita no próprio arquivo — a regra delas não muda; a regra de CPF não muda em lugar nenhum.
import { isValidCPF } from "../cpf.js";

const PESOS_DV1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const PESOS_DV2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

/** Forma do CNPJ (14 caracteres, sem máscara): 12 letras/números + 2 dígitos. */
export const FORMA_CNPJ = /^[0-9A-Z]{12}[0-9]{2}$/;

/** Tira a máscara comum (ponto, traço, barra e espaços) e passa para maiúsculas. Outros caracteres ficam (e invalidam). */
export function semMascaraDocumento(valor: string | null | undefined): string {
  return String(valor ?? "").replace(/[.\-/\s]/g, "").toUpperCase();
}

/** Só letras e números, em maiúsculas (para comparar documentos vindos de cadastros diferentes). */
export function normalizarDocumento(valor: string | null | undefined): string {
  return String(valor ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** Um dígito verificador do CNPJ (módulo 11; letras valem ASCII − 48). `base` já sem máscara. */
function digitoCnpj(base: string, pesos: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < pesos.length; i++) total += (base.charCodeAt(i) - 48) * pesos[i];
  const resto = total % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** Os dois dígitos verificadores de uma base de 12 caracteres (letras/números). Usado nos testes e em fixtures. */
export function digitosVerificadoresCnpj(base12: string): string {
  const b = semMascaraDocumento(base12);
  if (!/^[0-9A-Z]{12}$/.test(b)) throw new Error("A base do CNPJ tem 12 letras ou números.");
  const dv1 = digitoCnpj(b, PESOS_DV1);
  const dv2 = digitoCnpj(`${b}${dv1}`, PESOS_DV2);
  return `${dv1}${dv2}`;
}

/** CNPJ válido — numérico OU alfanumérico — com os dois dígitos verificadores conferidos. Aceita máscara. */
export function cnpjValido(valor: string | null | undefined): boolean {
  const c = semMascaraDocumento(valor);
  if (!FORMA_CNPJ.test(c) || /^(\d)\1+$/.test(c)) return false;
  return Number(c[12]) === digitoCnpj(c, PESOS_DV1) && Number(c[13]) === digitoCnpj(c, PESOS_DV2);
}

/** CNPJ que usa letras (o alfanumérico novo). Só faz sentido para um CNPJ já válido. */
export const cnpjAlfanumerico = (c: string) => /[A-Z]/.test(c);

/** CPF: 11 dígitos com os dígitos verificadores (mesma regra de sempre, `shared/cpf.ts`). */
export const cpfValido = (valor: string | null | undefined): boolean => {
  const d = semMascaraDocumento(valor);
  return /^\d{11}$/.test(d) && isValidCPF(d);
};

export type DocumentoConferido =
  | { tipo: "cpf"; valor: string; alfanumerico: false }
  | { tipo: "cnpj"; valor: string; alfanumerico: boolean };

/** CPF ou CNPJ (numérico ou alfanumérico) conferido, sem máscara; senão null. */
export function documentoFiscalConferido(bruto: string | null | undefined): DocumentoConferido | null {
  const c = semMascaraDocumento(bruto);
  if (c.length === 11 && cpfValido(c)) return { tipo: "cpf", valor: c, alfanumerico: false };
  if (c.length === 14 && cnpjValido(c)) return { tipo: "cnpj", valor: c, alfanumerico: cnpjAlfanumerico(c) };
  return null;
}
