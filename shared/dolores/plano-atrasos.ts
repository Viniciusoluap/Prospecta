// EPIC-025 (Dolores, etapa 8) — regra PURA do "plano de atrasos": distribui os itens atrasados IGUALMENTE pelos dias que restam
// até uma data-limite. É uma CONTA, e conta se faz por código (não pelo modelo). Sem banco nem rede.
// Fuso: os dias civis são os de Imperatriz (UTC−3 fixo, o mesmo de America/Sao_Paulo desde 2019, sem horário de verão).

/** Teto de dias de um plano (de hoje até a data-limite). */
export const MAX_DIAS_PLANO = 366;
/** Teto de itens listados nome a nome no plano (os demais entram só na contagem do dia). */
export const MAX_ITENS_LISTADOS_PLANO = 150;
/** Teto de caracteres do nome de cada item no plano (formato compacto). */
export const MAX_NOME_PLANO = 32;

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const ms = (dia: string) => Date.parse(`${dia}T00:00:00Z`);
const diaDe = (t: number) => new Date(t).toISOString().slice(0, 10);
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

/** É uma data AAAA-MM-DD válida (o dia existe)? */
export function diaValido(dia: string): boolean {
  if (!DIA.test(dia)) return false;
  const t = ms(dia);
  return Number.isFinite(t) && diaDe(t) === dia;
}

/** Último dia do mês do dia dado ("2026-11-19" → "2026-11-30"). */
export function fimDoMes(dia: string): string {
  const [a, m] = dia.split("-").map(Number);
  return diaDe(Date.UTC(a, m, 0));
}

/** Dia da semana (0 = domingo) de um dia civil. */
export const diaDaSemana = (dia: string) => new Date(ms(dia)).getUTCDay();
/** "20/11 (sex)". */
export const rotuloDoDia = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)} (${SEMANA[diaDaSemana(dia)]})`;

/**
 * Dias do plano, de `inicio` até `limite` (inclusive). Só dias úteis = segunda a sexta (feriado não é conhecido pelo sistema).
 * Limite antes do início → lista vazia. No máximo {@link MAX_DIAS_PLANO} dias corridos.
 */
export function diasDoPlano(inicio: string, limite: string, soDiasUteis: boolean): string[] {
  if (!diaValido(inicio) || !diaValido(limite) || ms(limite) < ms(inicio)) return [];
  const dias: string[] = [];
  for (let t = ms(inicio), n = 0; t <= ms(limite) && n < MAX_DIAS_PLANO; t += 86_400_000, n++) {
    const d = diaDe(t);
    const s = diaDaSemana(d);
    if (!soDiasUteis || (s >= 1 && s <= 5)) dias.push(d);
  }
  return dias;
}

/**
 * Divide `itens` (já na ordem de prioridade) IGUALMENTE pelos `dias`, na ordem: cada dia recebe ⌊N/D⌋ e o resto (N mod D) vai,
 * um a mais, para os primeiros dias. Mais dias do que itens → um por dia nos primeiros dias (os outros ficam vazios). Os itens
 * mais prioritários caem nos primeiros dias. Nenhum item some nem se repete.
 */
export function distribuirIgualmente<T>(itens: readonly T[], dias: readonly string[]): Array<{ dia: string; itens: T[] }> {
  if (!dias.length) return [];
  const base = Math.floor(itens.length / dias.length);
  const resto = itens.length % dias.length;
  const r: Array<{ dia: string; itens: T[] }> = [];
  let k = 0;
  dias.forEach((dia, i) => {
    const q = base + (i < resto ? 1 : 0);
    r.push({ dia, itens: itens.slice(k, k + q) });
    k += q;
  });
  return r;
}

export type ItemDoPlano = { modulo: string; cliente: string | null; diasDeAtraso: number | null; diasSemMovimentacao: number | null };

const MODULO_CURTO: Record<string, string> = {
  "Regularização": "reg", "Obra": "obra", "Financiamento": "fin", "CRM (prazo do card)": "crm", "CRM (prazo do serviço)": "crm-serv",
};

/** Nome curto de terceiro para o plano (uma linha, sem quebra). */
export function nomeCurto(s: string | null | undefined): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "(sem nome)";
  return t.length > MAX_NOME_PLANO ? `${t.slice(0, MAX_NOME_PLANO - 1).trimEnd()}…` : t;
}

/** "3. Maria Trello — 12 d de atraso [crm]" (o módulo só quando o plano mistura módulos). */
export function linhaDoItem(n: number, i: ItemDoPlano, comModulo: boolean): string {
  const quanto = i.diasDeAtraso != null ? `${i.diasDeAtraso} d de atraso` : i.diasSemMovimentacao != null ? `parado há ${i.diasSemMovimentacao} d` : "sem prazo registrado";
  return `${n}. ${nomeCurto(i.cliente)} — ${quanto}${comModulo ? ` [${MODULO_CURTO[i.modulo] ?? i.modulo}]` : ""}`;
}

export type Plano = {
  hoje: string; dataLimite: string; soDiasUteis: boolean;
  total: number; diasDisponiveis: number; porDia: { minimo: number; maximo: number };
  dias: Array<{ dia: string; quantidade: number; itens: string[] }>;
  /** Itens listados nome a nome (o resto só conta no dia). */
  listados: number; truncado: boolean;
  conferencia: { somaDosDias: number; confere: boolean };
};

/**
 * Monta o plano: os itens (já do mais atrasado para o menos) distribuídos igualmente pelos dias de `inicio` a `dataLimite`. Só os
 * dias que recebem itens aparecem. Formato compacto: por dia, a data, a quantidade e uma linha por item (nº, nome curto e dias).
 */
export function montarPlano(itens: readonly ItemDoPlano[], p: { inicio: string; dataLimite: string; soDiasUteis: boolean }): Plano {
  const dias = diasDoPlano(p.inicio, p.dataLimite, p.soDiasUteis);
  const grupos = distribuirIgualmente(itens.map((item, i) => ({ n: i + 1, item })), dias);
  const comModulo = new Set(itens.map(i => i.modulo)).size > 1;
  let listados = 0;
  const comItens = grupos.filter(g => g.itens.length > 0).map(g => ({
    dia: rotuloDoDia(g.dia), quantidade: g.itens.length,
    itens: g.itens.filter(() => listados++ < MAX_ITENS_LISTADOS_PLANO).map(x => linhaDoItem(x.n, x.item, comModulo)),
  }));
  const soma = comItens.reduce((s, d) => s + d.quantidade, 0);
  const quantidades = grupos.map(g => g.itens.length);
  return {
    hoje: p.inicio, dataLimite: p.dataLimite, soDiasUteis: p.soDiasUteis,
    total: itens.length, diasDisponiveis: dias.length,
    porDia: { minimo: quantidades.length ? Math.min(...quantidades) : 0, maximo: quantidades.length ? Math.max(...quantidades) : 0 },
    dias: comItens, listados: Math.min(listados, MAX_ITENS_LISTADOS_PLANO), truncado: itens.length > MAX_ITENS_LISTADOS_PLANO && dias.length > 0,
    conferencia: { somaDosDias: soma, confere: dias.length === 0 ? itens.length === 0 : soma === itens.length },
  };
}
