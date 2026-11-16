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
// CPF escrito com espaços ("123 456 789 09"): só sai se os dígitos verificadores conferem (não pega listas de números).
const CPF_COM_ESPACOS = /(?<![\d.,/-])\d{3} \d{3} \d{3}[ -]?\d{2}(?!\d|[.,/-]\d)/g;
const CNPJ_FORMATADO = /(?<!\d)\d{2}\.\d{3}\.\d{3}\/\d{4}-?\d{2}(?!\d)/g;
// Telefone: (DD) 9XXXX-XXXX, DD 9XXXXXXXX, +55…, XXXXX-XXXX, com o nono dígito separado ("9 9123-4567")
const TELEFONE = /(?<![\d/])(?:\+?55[\s-]?)?(?:\(?\d{2}\)?[\s-]?)?(?:9[\s-]?)?\d{4}[\s-]\d{4}(?![\d/])/g;
const CELULAR_COM_DDD = /(?<![\d/])\(?\d{2}\)?[\s-]9\d{8}(?![\d/])/g;
// Sequência de 10 a 14 dígitos. Pontuação ANTES ou DEPOIS só impede quando faz parte de outro número
// ("1.234567890", "0801234-56.2026"); fim de frase, vírgula ou hífen seguidos de letra/espaço não protegem o dado.
const DIGITOS_LONGOS = /(?<!\d)(?<!\d[.,/-])\d{10,14}(?!\d)(?![.,/-]\d)/g;
// Logo depois destes rótulos, a sequência é número de processo/protocolo/matrícula: fica, a não ser que seja um CPF
// válido, um CNPJ válido ou tenha forma de telefone brasileiro.
const CONTEXTO_DOCUMENTO = /\b(protocolos?|processos?|autos|matr[ií]culas?|requerimentos?|inscri[cç](?:[aã]o|[oõ]es)|guias?|boletos?)\s*(?:n[º°o.]*\s*)?[:#-]?\s*$/i;
const FORMA_DE_TELEFONE = /^(?:55)?[1-9]{2}(?:9\d{8}|[2-9]\d{7})$/;
const FORMA_DE_CELULAR = /^(?:55)?[1-9]{2}9\d{8}$/;

/** Texto livre com CPF/CNPJ, e-mail, telefone, dados bancários e senhas trocados por marcadores visíveis. */
export function sanitizarTexto(texto: string): string {
  if (!texto || !/[\d@]|senha|password|passwd|c[oó]digo|token|\bpin\b/i.test(texto)) return texto;
  return texto
    .replace(SENHA, (_m, palavra: string) => `${palavra} ${SENHA_OMITIDA}`)
    .replace(BANCARIO, (_m, rotulo: string, sep: string) => `${rotulo}${sep}${BANCARIO_OMITIDO}`)
    .replace(EMAIL, OMITIDO)
    .replace(CNPJ_FORMATADO, OMITIDO)
    .replace(CPF_FORMATADO, OMITIDO)
    .replace(CPF_COM_ESPACOS, m => (isValidCPF(m.replace(/\D/g, "")) ? OMITIDO : m))
    .replace(CELULAR_COM_DDD, OMITIDO)
    .replace(TELEFONE, OMITIDO)
    .replace(DIGITOS_LONGOS, (d: string, pos: number, todo: string) => {
      if (d.length === 14) return cnpjValido(d) ? OMITIDO : d;
      if (isValidCPF(d) || FORMA_DE_CELULAR.test(d)) return OMITIDO;
      if (CONTEXTO_DOCUMENTO.test(todo.slice(Math.max(0, pos - 40), pos))) return d; // nº de processo/protocolo/matrícula
      if (FORMA_DE_TELEFONE.test(d)) return OMITIDO;
      if (d.length === 11) return OMITIDO; // CPF digitado errado ou celular: na dúvida, sai
      if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return OMITIDO; // telefone com DDI
      return d; // 10 dígitos sem forma de telefone (ex.: valor sem separador)
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
