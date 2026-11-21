// EPIC-025 (Dolores, etapa 8) — estimativa do gasto da IA POR MODELO e por tipo de token. Regras puras, sem banco nem rede.
// O sistema não inventa preço: tudo vem do que o administrador informou na tela (preço por modelo em US$ por milhão de tokens e a
// cotação do dólar). Modelo sem preço usa a RESERVA (os dois campos antigos de preço único, em R$ por milhão) e a tela diz isso.
// Cache: a escrita custa 1,25× e a leitura 0,1× do preço de entrada quando o admin deixa esses campos vazios (regra da Anthropic
// para o cache de 5 minutos) — e a tela diz que assumiu.
// Isto é só ESTIMATIVA para a tela e o relatório: o limite mensal (a trava) continua em tokens. QA C5-E1 r4: no limite, o cache conta pelo
// peso do preço — escrita FATOR_CACHE_ESCRITA (1,25×), leitura FATOR_CACHE_LEITURA (0,1×) — a mesma soma do banco
// (server/dolores/consumo.ts#entradaNoLimiteSql).

export const FATOR_CACHE_ESCRITA = 1.25;
export const FATOR_CACHE_LEITURA = 0.1;
/** Teto de cada preço aceito pela tela (US$ por milhão de tokens). */
export const MAX_PRECO_MILHAO_USD = 10_000;
/** Faixa da cotação aceita pela tela (R$ por US$). */
export const COTACAO_MINIMA = 0.5;
export const COTACAO_MAXIMA = 100;

export type UsoDetalhado = { entrada: number; saida: number; cacheEscrita: number; cacheLeitura: number };
/** Preço de um modelo, em US$ por milhão de tokens (null = não informado). */
export type PrecoModelo = { entrada: number | null; saida: number | null; cacheEscrita: number | null; cacheLeitura: number | null };
/** Reserva: os campos antigos de preço único (R$ por milhão), para modelo sem preço cadastrado. */
export type PrecoReserva = { entradaMilhao: number | null; saidaMilhao: number | null };

/** Grupo de uso de `dolores_consumo`, separado pela origem gravada (mensagem do dono, parada "grupo…", o resto). */
export type FuncaoDoConsumo = "conversa" | "grupos" | "clientes" | "documentos_e_notas";
export const ROTULO_FUNCAO_CONSUMO: Record<FuncaoDoConsumo, string> = {
  conversa: "Conversa com o dono (WhatsApp)",
  grupos: "Resposta em grupo quando marcada",
  clientes: "Resposta a clientes cadastrados (conversa direta)",
  documentos_e_notas: "Documentos dos grupos e notas de obra",
};

const valido = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;
const arredonda = (x: number, casas = 4) => Math.round(x * 10 ** casas) / 10 ** casas;
const somaUso = (a: UsoDetalhado, b: UsoDetalhado): UsoDetalhado =>
  ({ entrada: a.entrada + b.entrada, saida: a.saida + b.saida, cacheEscrita: a.cacheEscrita + b.cacheEscrita, cacheLeitura: a.cacheLeitura + b.cacheLeitura });
export const USO_ZERO: UsoDetalhado = { entrada: 0, saida: 0, cacheEscrita: 0, cacheLeitura: 0 };

/**
 * Tokens que o LIMITE MENSAL conta como entrada, pelo peso do preço: entrada + escrita de cache × 1,25 + leitura de cache × 0,1
 * (cada uma arredondada para cima; o −1e-9 só tira o erro de ponto flutuante, ex.: 50.480 × 0,1). Os tokens brutos ficam em `uso`.
 */
const pesado = (x: number, fator: number) => Math.ceil(x * fator - 1e-9);
export const entradaNoLimite = (u: UsoDetalhado) => u.entrada + pesado(u.cacheEscrita, FATOR_CACHE_ESCRITA) + pesado(u.cacheLeitura, FATOR_CACHE_LEITURA);

/**
 * Custo de um uso com um preço por milhão (na moeda do preço). Entrada ou saída sem preço → null. Escrita/leitura de cache
 * vazias → 1,25× / 0,1× da entrada (`cacheAssumido` = true).
 */
export function custoDoUso(u: UsoDetalhado, p: PrecoModelo): { valor: number; cacheAssumido: boolean } | null {
  if (!valido(p.entrada) || !valido(p.saida)) return null;
  const escrita = valido(p.cacheEscrita) ? p.cacheEscrita : p.entrada * FATOR_CACHE_ESCRITA;
  const leitura = valido(p.cacheLeitura) ? p.cacheLeitura : p.entrada * FATOR_CACHE_LEITURA;
  const cacheAssumido = (!valido(p.cacheEscrita) && u.cacheEscrita > 0) || (!valido(p.cacheLeitura) && u.cacheLeitura > 0);
  const valor = (u.entrada * p.entrada + u.saida * p.saida + u.cacheEscrita * escrita + u.cacheLeitura * leitura) / 1e6;
  return { valor, cacheAssumido };
}

export type CustoDoModelo = {
  modelo: string; uso: UsoDetalhado; tokensNoLimite: { entrada: number; saida: number };
  /** "tabela" = preço do modelo (US$); "reserva" = preço único antigo (R$); "sem_preco" = nem um nem outro. */
  fonte: "tabela" | "reserva" | "sem_preco";
  dolares: number | null; reais: number | null; cacheAssumido: boolean;
};
export type CustoDoMes = {
  porModelo: CustoDoModelo[];
  porFuncao: Array<{ funcao: FuncaoDoConsumo; rotulo: string; uso: UsoDetalhado; dolares: number | null; reais: number | null; completo: boolean }>;
  total: { dolares: number | null; reais: number | null; completo: boolean };
  /** Modelos estimados pela reserva (sem preço cadastrado) e modelos sem preço nenhum. */
  usouReserva: string[]; semPreco: string[]; cacheAssumido: boolean; cotacao: number | null;
  tokensNoLimite: { entrada: number; saida: number };
};

/** Custo de um modelo: tabela (US$, convertido pela cotação) → reserva (R$, convertida de volta pela cotação) → sem preço. */
export function custoDoModelo(modelo: string, uso: UsoDetalhado, tabela: ReadonlyMap<string, PrecoModelo>, reserva: PrecoReserva, cotacao: number | null): CustoDoModelo {
  const cot = valido(cotacao) && cotacao > 0 ? cotacao : null;
  const base = { modelo, uso, tokensNoLimite: { entrada: entradaNoLimite(uso), saida: uso.saida } };
  const daTabela = tabela.get(modelo);
  const t = daTabela ? custoDoUso(uso, daTabela) : null;
  if (t) return { ...base, fonte: "tabela", dolares: arredonda(t.valor), reais: cot ? arredonda(t.valor * cot, 2) : null, cacheAssumido: t.cacheAssumido };
  const r = custoDoUso(uso, { entrada: reserva.entradaMilhao, saida: reserva.saidaMilhao, cacheEscrita: null, cacheLeitura: null });
  if (r) return { ...base, fonte: "reserva", reais: arredonda(r.valor, 2), dolares: cot ? arredonda(r.valor / cot) : null, cacheAssumido: r.cacheAssumido };
  return { ...base, fonte: "sem_preco", dolares: null, reais: null, cacheAssumido: false };
}

const somar = (xs: Array<number | null>) => (xs.every(x => x !== null) ? arredonda(xs.reduce<number>((s, x) => s + (x as number), 0)) : null);

/**
 * Gasto do mês a partir das linhas de consumo agrupadas por modelo e função. Totais em US$ e R$ só quando TODOS os modelos têm
 * preço (e a cotação, para converter); senão `completo` = false e a tela mostra o que falta.
 */
export function custoDoMes(linhas: ReadonlyArray<{ modelo: string; funcao: FuncaoDoConsumo; uso: UsoDetalhado }>, tabela: ReadonlyMap<string, PrecoModelo>,
  reserva: PrecoReserva, cotacao: number | null): CustoDoMes {
  const porModeloUso = new Map<string, UsoDetalhado>();
  for (const l of linhas) porModeloUso.set(l.modelo, somaUso(porModeloUso.get(l.modelo) ?? USO_ZERO, l.uso));
  const porModelo = Array.from(porModeloUso, ([m, u]) => custoDoModelo(m, u, tabela, reserva, cotacao)).sort((a, b) => a.modelo.localeCompare(b.modelo));
  const funcoes: FuncaoDoConsumo[] = ["conversa", "grupos", "clientes", "documentos_e_notas"];
  const porFuncao = funcoes.map(funcao => {
    const doGrupo = linhas.filter(l => l.funcao === funcao);
    const custos = doGrupo.map(l => custoDoModelo(l.modelo, l.uso, tabela, reserva, cotacao));
    return { funcao, rotulo: ROTULO_FUNCAO_CONSUMO[funcao], uso: doGrupo.reduce((s, l) => somaUso(s, l.uso), USO_ZERO),
      dolares: somar(custos.map(c => c.dolares)), reais: somar(custos.map(c => c.reais)), completo: custos.every(c => c.fonte !== "sem_preco") };
  }).filter(f => f.uso.entrada + f.uso.saida + f.uso.cacheEscrita + f.uso.cacheLeitura > 0);
  const total = porModelo.reduce((s, m) => somaUso(s, m.uso), USO_ZERO);
  const reais = somar(porModelo.map(m => m.reais));
  return {
    porModelo, porFuncao,
    total: { dolares: somar(porModelo.map(m => m.dolares)), reais: reais === null ? null : arredonda(reais, 2), completo: porModelo.every(m => m.fonte !== "sem_preco") },
    usouReserva: porModelo.filter(m => m.fonte === "reserva").map(m => m.modelo),
    semPreco: porModelo.filter(m => m.fonte === "sem_preco").map(m => m.modelo),
    cacheAssumido: porModelo.some(m => m.cacheAssumido),
    cotacao: valido(cotacao) && cotacao > 0 ? cotacao : null,
    tokensNoLimite: { entrada: entradaNoLimite(total), saida: total.saida },
  };
}

const usd = (x: number) => `US$ ${x.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: x < 1 ? 4 : 2 })}`;
const brl = (x: number) => x.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Uma linha para o relatório do dono (modelo fixo, sem IA): "Estimativa: US$ 0,09 (R$ 0,48) …" com o que faltou. */
export function linhaDoCustoParaRelatorio(c: CustoDoMes, tetoReais: number): string {
  if (!c.porModelo.length) return "Estimativa: nada gasto com a IA neste mês.";
  const partes: string[] = [];
  if (c.total.dolares !== null || c.total.reais !== null) {
    partes.push(`Estimativa: ${c.total.dolares !== null ? usd(c.total.dolares) : "US$ —"}${c.total.reais !== null ? ` (${brl(c.total.reais)}; teto do dono ${brl(tetoReais)})` : " (informe a cotação do dólar na tela para ver em reais)"}.`);
  } else partes.push("Estimativa: incompleta.");
  if (c.semPreco.length) partes.push(`Sem preço cadastrado: ${c.semPreco.join(", ")} (informe na tela).`);
  if (c.usouReserva.length) partes.push(`Pelo preço de reserva: ${c.usouReserva.join(", ")}.`);
  if (c.cacheAssumido) partes.push("Cache estimado em 1,25× (escrita) e 0,1× (leitura) do preço de entrada.");
  return partes.join(" ");
}
