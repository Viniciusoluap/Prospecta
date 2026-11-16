// EPIC-025 (Dolores, etapa 1) — formato das respostas da ponte. Regras puras, sem banco nem rede.
// Datas em ISO com o fuso de Imperatriz (America/Fortaleza, UTC−3 fixo, sem horário de verão), dinheiro em número
// (reais, BRL), textos cortados e dados pessoais mascarados (LGPD): a resposta tem de caber no contexto do agente.

export const FUSO = "America/Fortaleza";
export const DESLOCAMENTO_FUSO = "-03:00";
export const MOEDA = "BRL";
/** Limite do tamanho de uma resposta da ponte (caracteres do JSON). */
export const MAX_CARACTERES_RESPOSTA = 60_000;
export const MAX_TEXTO = 280;

const TRES_HORAS = 3 * 60 * 60 * 1000;

function data(d: Date | string | null | undefined): Date | null {
  if (d === null || d === undefined || d === "") return null;
  const v = d instanceof Date ? d : new Date(d);
  return Number.isNaN(v.getTime()) ? null : v;
}

/** "2026-11-16T09:30:00-03:00" (instante no fuso de Imperatriz). */
export function isoFortaleza(d: Date | string | null | undefined): string | null {
  const v = data(d);
  if (!v) return null;
  return new Date(v.getTime() - TRES_HORAS).toISOString().slice(0, 19) + DESLOCAMENTO_FUSO;
}

/** Dia civil em Imperatriz (AAAA-MM-DD). Texto já no formato AAAA-MM-DD (coluna date) é mantido. */
export function diaFortaleza(d: Date | string | null | undefined): string | null {
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const v = data(d);
  return v ? new Date(v.getTime() - TRES_HORAS).toISOString().slice(0, 10) : null;
}

/** Dias corridos entre dois dias civis de Imperatriz (b − a). */
export function diasEntre(a: Date | string | null | undefined, b: Date | string | null | undefined): number | null {
  const da = diaFortaleza(a), db = diaFortaleza(b);
  if (!da || !db) return null;
  return Math.round((Date.parse(`${db}T00:00:00Z`) - Date.parse(`${da}T00:00:00Z`)) / 86_400_000);
}

/** Valor decimal do banco ("1234.50") → número em reais com 2 casas; inválido → null. */
export function reais(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export const centavosParaReais = (c: number) => Math.round(c) / 100;

/** CPF só com os 2 últimos dígitos: "***.***.***-01". Vazio → null; formato desconhecido → "***". */
export function mascararCpf(cpf: string | null | undefined): string | null {
  const d = String(cpf ?? "").replace(/\D/g, "");
  if (!d) return null;
  return d.length === 11 ? `***.***.***-${d.slice(-2)}` : "***";
}

/** Telefone só com o DDD e os 4 últimos dígitos (para identificar o contato): "(99) *****-1234". */
export function mascararTelefone(tel: string | null | undefined): string | null {
  let d = String(tel ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  if (d.length < 8) return "***";
  const ddd = d.length >= 10 ? `(${d.slice(0, 2)}) ` : "";
  return `${ddd}*****-${d.slice(-4)}`;
}

/** Corta o texto (espaços normalizados) em `max` caracteres, com reticências. */
export function truncar(texto: string | null | undefined, max = MAX_TEXTO): string | null {
  const t = String(texto ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Página de uma lista já ordenada. */
export function paginar<T>(itens: readonly T[], pagina: number, limite: number) {
  const inicio = (pagina - 1) * limite;
  return { itens: itens.slice(inicio, inicio + limite), total: itens.length, pagina, limite, temMais: inicio + limite < itens.length };
}

/**
 * Garante que o JSON da resposta caiba em `max` caracteres: corta pela metade, repetidamente, a maior lista
 * encontrada. Devolve se houve corte (o agente é avisado para pedir a próxima página ou filtrar).
 */
export function limitarResposta<T>(valor: T, max = MAX_CARACTERES_RESPOSTA): { valor: T; truncado: boolean } {
  let atual = JSON.parse(JSON.stringify(valor ?? null)) as T;
  let truncado = false;
  for (let i = 0; i < 200 && JSON.stringify(atual).length > max; i++) {
    let maior: unknown[] | null = null, tamanho = -1;
    const visitar = (v: unknown) => {
      if (Array.isArray(v)) {
        if (v.length > 0) { const t = JSON.stringify(v).length; if (t > tamanho) { maior = v; tamanho = t; } }
        v.forEach(visitar);
      } else if (v && typeof v === "object") Object.values(v).forEach(visitar);
    };
    visitar(atual);
    const lista = maior as unknown[] | null;
    if (!lista) break;
    lista.splice(Math.floor(lista.length / 2));
    truncado = true;
  }
  if (JSON.stringify(atual).length > max) {
    atual = { erro: "Resposta grande demais mesmo após o corte; filtre a consulta." } as T;
    truncado = true;
  }
  return { valor: atual, truncado };
}
