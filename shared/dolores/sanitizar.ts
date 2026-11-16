// EPIC-025 (Dolores) — filtro de dados pessoais em TEXTO LIVRE (anotações, mensagens, títulos, observações), aplicado
// pela ponte a TODA string que sai para o agente e aos argumentos guardados na auditoria. Melhor esforço: pega os
// formatos comuns; não garante achar tudo o que alguém escreveu à mão. Campos estruturados já mascarados
// ("***.***.***-01", "(99) *****-4567") passam intactos (não têm a sequência de dígitos).
import { isValidCPF } from "../cpf.js";

export const OMITIDO = "[dado pessoal omitido]";
export const SENHA_OMITIDA = "[senha omitida]";
export const BANCARIO_OMITIDO = "[dado bancário omitido]";

function cnpjValido(d: string): boolean {
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const dv = (base: string, pesos: number[]) => {
    const s = pesos.reduce((t, p, i) => t + Number(base[i]) * p, 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return dv(d, p1) === Number(d[12]) && dv(d, [6, ...p1]) === Number(d[13]);
}

// Palavra de senha/código: tudo até o fim da oração (ponto, ponto e vírgula, vírgula, quebra de linha).
const SENHA = /\b(senhas?|password|passwd|c[oó]digos?|token|pin)\b.*?(?=[;\n]|[.,!?](?:\s|$)|$)/gi;
// Agência, conta, PIX: o rótulo fica, o número/chave sai.
const BANCARIO = /\b(ag[eê]ncia|ag\.?|conta(?:\s+corrente|\s+poupan[cç]a)?|c\/c|cc|chave\s+pix|pix)\b(\s*(?:n[ºo°.]?|:|#|-)?\s*)((?=[^\s]*[\d@])[\w.@+\-/]+)/gi;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const CPF_FORMATADO = /(?<!\d)\d{3}[.,]\d{3}[.,]\d{3}[-.]?\d{2}(?!\d)/g;
const CNPJ_FORMATADO = /(?<!\d)\d{2}\.\d{3}\.\d{3}\/\d{4}-?\d{2}(?!\d)/g;
// Telefone: (DD) 9XXXX-XXXX, DD 9XXXXXXXX, +55…, XXXXX-XXXX
const TELEFONE = /(?<![\d/])(?:\+?55[\s-]?)?(?:\(?\d{2}\)?[\s-]?)?9?\d{4}[\s-]\d{4}(?![\d/])/g;
const CELULAR_COM_DDD = /(?<![\d/])\(?\d{2}\)?[\s-]9\d{8}(?![\d/])/g;
const DIGITOS_LONGOS = /(?<![\d.,/-])\d{10,14}(?![\d.,/-])/g;

/** Texto livre com CPF/CNPJ, e-mail, telefone, dados bancários e senhas trocados por marcadores visíveis. */
export function sanitizarTexto(texto: string): string {
  if (!texto || !/[\d@]|senha|password|passwd|c[oó]digo|token|\bpin\b/i.test(texto)) return texto;
  return texto
    .replace(SENHA, (_m, palavra: string) => `${palavra} ${SENHA_OMITIDA}`)
    .replace(BANCARIO, (_m, rotulo: string, sep: string) => `${rotulo}${sep}${BANCARIO_OMITIDO}`)
    .replace(EMAIL, OMITIDO)
    .replace(CNPJ_FORMATADO, OMITIDO)
    .replace(CPF_FORMATADO, OMITIDO)
    .replace(CELULAR_COM_DDD, OMITIDO)
    .replace(TELEFONE, OMITIDO)
    .replace(DIGITOS_LONGOS, d => {
      if (d.length === 11) return OMITIDO; // CPF ou celular com DDD
      if (d.length === 14) return cnpjValido(d) ? OMITIDO : d;
      if (d.length === 10 || ((d.length === 12 || d.length === 13) && d.startsWith("55"))) return OMITIDO; // telefone
      return isValidCPF(d) ? OMITIDO : d;
    });
}

/** Percorre a resposta e filtra toda string (chaves ficam como estão). */
export function sanitizarResposta<T>(valor: T): T {
  if (typeof valor === "string") return sanitizarTexto(valor) as T;
  if (Array.isArray(valor)) return valor.map(v => sanitizarResposta(v)) as T;
  if (valor && typeof valor === "object" && !(valor instanceof Date)) {
    const r: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) r[k] = sanitizarResposta(v);
    return r as T;
  }
  return valor;
}
