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

/**
 * Função de cada chamada em `dolores_consumo`. EPIC-027 C5-E5: gravada na coluna `funcao` (migração 0148); linha antiga (sem a
 * coluna preenchida) sai pela origem gravada — mensagem do dono = conversa, parada "grupo…" = grupos, "cliente…" = clientes, o
 * resto = documentos e notas (`funcaoDaChamada`, a MESMA regra do SQL em server/dolores/consumo.ts#funcaoSql).
 */
export type FuncaoDoConsumo = "conversa" | "grupos" | "clientes" | "documentos_e_notas" | "avisos";
export const ROTULO_FUNCAO_CONSUMO: Record<FuncaoDoConsumo, string> = {
  conversa: "Conversa com o dono (WhatsApp)",
  grupos: "Resposta em grupo quando marcada",
  clientes: "Resposta a clientes cadastrados (conversa direta)",
  documentos_e_notas: "Documentos dos grupos e notas de obra",
  avisos: "Avisos automáticos e relatórios",
};
/** As 5 partes do gasto, na ordem da tela e do relatório. */
export const FUNCOES_DO_GASTO: readonly FuncaoDoConsumo[] = ["conversa", "documentos_e_notas", "grupos", "clientes", "avisos"];
/** Nome da função numa frase para o dono ("A conversa com você chegou a 80% da parte dela"). */
export const NOME_DA_FUNCAO_NA_FRASE: Record<FuncaoDoConsumo, string> = {
  conversa: "a conversa com você", documentos_e_notas: "a leitura de documentos e notas de obra", grupos: "as respostas em grupo",
  clientes: "o atendimento a clientes", avisos: "os avisos automáticos",
};
/** Prefixos de `dolores_consumo.parada` (as respostas em grupo e a clientes gravam assim desde as etapas 4b e 9). */
export const PARADA_GRUPO = "grupo";
export const PARADA_CLIENTE = "cliente";

/** A função de uma chamada pela origem gravada (linha antiga sem `funcao`, ou chamador que não informou). */
export function funcaoDaChamada(c: { funcao?: FuncaoDoConsumo | null; mensagemId: number | null; parada: string | null }): FuncaoDoConsumo {
  if (c.funcao && (FUNCOES_DO_GASTO as readonly string[]).includes(c.funcao)) return c.funcao;
  if (c.mensagemId != null) return "conversa";
  if (c.parada?.startsWith(PARADA_GRUPO)) return "grupos";
  if (c.parada?.startsWith(PARADA_CLIENTE)) return "clientes";
  return "documentos_e_notas";
}

// ── EPIC-027 C5-E5 — gasto separado por função (decisão do dono de 21/11: "cada função com seu gasto") ──

/** Parte de cada função no limite mensal, em % inteiros (soma 100, cada uma pelo menos 1). */
export type PartesDoGasto = Record<FuncaoDoConsumo, number>;
/** Divisão decidida pelo dono em 21/11/2026: conversa 55 · documentos 20 · grupos 10 · clientes 10 · avisos 5. */
export const PARTES_PADRAO: Readonly<PartesDoGasto> = Object.freeze({ conversa: 55, documentos_e_notas: 20, grupos: 10, clientes: 10, avisos: 5 });
export const PARTE_MINIMA = 1;
export const PARTE_MAXIMA = 100 - (FUNCOES_DO_GASTO.length - 1) * PARTE_MINIMA;

/** Partes válidas? null = sim; senão, a frase do motivo (a tela mostra, o servidor recusa). */
export function erroDasPartes(p: Partial<Record<string, unknown>>): string | null {
  for (const f of FUNCOES_DO_GASTO) {
    const v = p[f];
    if (typeof v !== "number" || !Number.isInteger(v)) return `A parte de "${ROTULO_FUNCAO_CONSUMO[f]}" tem de ser um número inteiro.`;
  }
  for (const f of FUNCOES_DO_GASTO) {
    if ((p[f] as number) < PARTE_MINIMA) return `Nenhuma função pode ficar com 0%: "${ROTULO_FUNCAO_CONSUMO[f]}" precisa de pelo menos ${PARTE_MINIMA}%.`;
  }
  for (const f of FUNCOES_DO_GASTO) {
    if ((p[f] as number) > PARTE_MAXIMA) return `"${ROTULO_FUNCAO_CONSUMO[f]}" pode ter no máximo ${PARTE_MAXIMA}% (as outras precisam de pelo menos ${PARTE_MINIMA}% cada).`;
  }
  const soma = FUNCOES_DO_GASTO.reduce((s, f) => s + (p[f] as number), 0);
  if (soma !== 100) return `As partes somam ${soma}%: precisam somar exatamente 100%.`;
  const extras = Object.keys(p).filter(k => !(FUNCOES_DO_GASTO as readonly string[]).includes(k));
  if (extras.length) return "Função desconhecida na divisão do gasto.";
  return null;
}

/** Tokens da parte de uma função no limite mensal (arredondado para baixo: a soma das partes nunca passa do limite). */
export const limiteDaParte = (limites: { entrada: number; saida: number }, pct: number) =>
  ({ entrada: Math.floor((Math.max(0, limites.entrada) * pct) / 100), saida: Math.floor((Math.max(0, limites.saida) * pct) / 100) });

/** Níveis de alerta ao dono: 80% (aviso) e 100% (modo sem IA). */
export const NIVEIS_ALERTA = [80, 100] as const;
export type NivelAlerta = (typeof NIVEIS_ALERTA)[number];
export type AlvoAlerta = "total" | FuncaoDoConsumo;

type Medida = { tokens: { entrada: number; saida: number }; limiteTokens: { entrada: number; saida: number }; tokensPct: number;
  reais: number | null; limiteReais: number; reaisPct: number | null; pct: number };
export type SituacaoDoGasto = {
  total: Medida;
  funcoes: Array<Medida & { funcao: FuncaoDoConsumo; rotulo: string; parte: number }>;
};

const pctDe = (uso: number, limite: number) => (limite > 0 ? (uso / limite) * 100 : uso > 0 ? Infinity : 0);
const umaCasa = (x: number) => (Number.isFinite(x) ? Math.floor(x * 10) / 10 : 999);
function medida(tokens: { entrada: number; saida: number }, limiteTokens: { entrada: number; saida: number }, reais: number | null, limiteReais: number): Medida {
  const tokensPct = umaCasa(Math.max(pctDe(tokens.entrada, limiteTokens.entrada), pctDe(tokens.saida, limiteTokens.saida)));
  const reaisPct = reais === null ? null : umaCasa(pctDe(reais, limiteReais));
  return { tokens, limiteTokens, tokensPct, reais, limiteReais, reaisPct, pct: Math.max(tokensPct, reaisPct ?? 0) };
}

/**
 * Situação do mês por função e no total, pelas duas medidas: tokens contados no limite (a TRAVA; cache pelo peso do preço) e o R$
 * estimado pela MESMA conta da tela (`custoDoMes`) contra o teto do dono. `pct` = a maior das duas (o alerta de 80% sai pela
 * primeira que chegar). Sem preço completo (modelo sem preço ou sem cotação), só os tokens contam — como antes.
 */
export function situacaoDoGasto(p: { linhas: ReadonlyArray<{ modelo: string; funcao: FuncaoDoConsumo; uso: UsoDetalhado }>; custo: CustoDoMes;
  limites: { entrada: number; saida: number }; partes: PartesDoGasto; tetoReais: number }): SituacaoDoGasto {
  const funcoes = FUNCOES_DO_GASTO.map(funcao => {
    const uso = p.linhas.filter(l => l.funcao === funcao).reduce((s, l) => somaUso(s, l.uso), USO_ZERO);
    const doCusto = p.custo.porFuncao.find(f => f.funcao === funcao);
    const temUso = uso.entrada + uso.saida + uso.cacheEscrita + uso.cacheLeitura > 0;
    const reais = !temUso ? (p.custo.total.completo && p.custo.cotacao !== null ? 0 : null) : doCusto?.completo && doCusto.reais !== null ? doCusto.reais : null;
    const parte = p.partes[funcao];
    return { funcao, rotulo: ROTULO_FUNCAO_CONSUMO[funcao], parte,
      ...medida({ entrada: entradaNoLimite(uso), saida: uso.saida }, limiteDaParte(p.limites, parte), reais, arredonda((p.tetoReais * parte) / 100, 2)) };
  });
  const tokens = funcoes.reduce((s, f) => ({ entrada: s.entrada + f.tokens.entrada, saida: s.saida + f.tokens.saida }), { entrada: 0, saida: 0 });
  const reaisTotal = !p.custo.porModelo.length ? (p.custo.cotacao !== null ? 0 : null) : p.custo.total.completo ? p.custo.total.reais : null;
  return { total: medida(tokens, { entrada: Math.max(0, p.limites.entrada), saida: Math.max(0, p.limites.saida) }, reaisTotal, p.tetoReais), funcoes };
}

/**
 * Alertas devidos agora (antes de conferir quais já saíram no mês). 100%: o TOTAL bateu o limite (ou foi bloqueado por ele), ou a
 * função bateu a parte dela em tokens (ou foi bloqueada pela parte). 80%: a maior das duas medidas chegou a 80% — do teto/limite
 * (total) ou da parte (função). Com 100% devido, o de 80% do mesmo alvo vai junto (uma mensagem só, a de 100%).
 */
export function alertasDevidos(s: SituacaoDoGasto, o: { totalBloqueado?: boolean; bloqueadas?: readonly FuncaoDoConsumo[] } = {}): Array<{ alvo: AlvoAlerta; nivel: NivelAlerta }> {
  const r: Array<{ alvo: AlvoAlerta; nivel: NivelAlerta }> = [];
  const total100 = o.totalBloqueado === true || (s.total.limiteTokens.entrada > 0 && s.total.limiteTokens.saida > 0 && s.total.tokensPct >= 100);
  if (total100) r.push({ alvo: "total", nivel: 100 });
  else if (s.total.limiteTokens.entrada > 0 && s.total.pct >= 80) r.push({ alvo: "total", nivel: 80 });
  for (const f of s.funcoes) {
    const temLimite = f.limiteTokens.entrada > 0 && f.limiteTokens.saida > 0;
    if (!temLimite) continue;
    if (o.bloqueadas?.includes(f.funcao) || f.tokensPct >= 100) r.push({ alvo: f.funcao, nivel: 100 });
    else if (f.pct >= 80) r.push({ alvo: f.funcao, nivel: 80 });
  }
  return r;
}

const brlAlerta = (x: number) => x.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const nAlerta = (x: number) => Math.round(x).toLocaleString("pt-BR");
const pctTxt = (x: number) => `${(Number.isFinite(x) ? Math.min(999, Math.floor(x)) : 999).toLocaleString("pt-BR")}%`;
const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Texto FIXO do alerta (sem IA, sem custo): só números e nomes de função — nunca nome de cliente, telefone, CPF ou texto de
 * mensagem. Diz quanto gastou, quanto resta e em qual função.
 */
export function textoDoAlerta(a: { alvo: AlvoAlerta; nivel: NivelAlerta }, s: SituacaoDoGasto, mes: string): string {
  const m = a.alvo === "total" ? s.total : s.funcoes.find(f => f.funcao === a.alvo)!;
  const deQue = a.alvo === "total" ? "do limite do mês" : `da parte dela (${s.funcoes.find(f => f.funcao === a.alvo)!.parte}% do limite do mês)`;
  const quem = a.alvo === "total" ? "O gasto total com a IA" : maiuscula(NOME_DA_FUNCAO_NA_FRASE[a.alvo]);
  const verbo = a.alvo === "grupos" || a.alvo === "avisos" ? "chegaram" : "chegou";
  const L: string[] = [`Dolores: aviso de gasto da IA (mês ${mes}). ${quem} ${verbo} a ${pctTxt(m.pct)} ${deQue}${a.nivel === 100 && m.pct < 100 ? " — não cabe mais uma chamada à IA" : ""}.`];
  L.push(m.reais !== null
    ? `Gasto: ${brlAlerta(m.reais)} de ${brlAlerta(m.limiteReais)} (resta ${brlAlerta(Math.max(0, m.limiteReais - m.reais))}).`
    : "Gasto em reais: sem preço cadastrado para algum modelo (ou sem a cotação) — contei pelos tokens.");
  L.push(`Tokens contados no limite: ${nAlerta(m.tokens.entrada)} de ${nAlerta(m.limiteTokens.entrada)} de entrada e ${nAlerta(m.tokens.saida)} de ${nAlerta(m.limiteTokens.saida)} de saída (resta ${pctTxt(Math.max(0, 100 - m.tokensPct))}).`);
  if (a.alvo === "total") {
    const linha = s.funcoes.filter(f => f.tokens.entrada + f.tokens.saida > 0).map(f => `${NOME_DA_FUNCAO_NA_FRASE[f.funcao]} ${f.reais !== null ? brlAlerta(f.reais) : `${pctTxt(f.tokensPct)} da parte`}`);
    if (linha.length) L.push(`Por função: ${linha.join("; ")}.`);
  }
  if (a.nivel === 100) {
    L.push(a.alvo === "total"
      ? "Entrei em modo sem IA: não uso mais a IA neste mês (volto no mês que vem ou quando o limite for aumentado em Integrações › Dolores). Comandos fixos, como \"relatório\", continuam."
      : `Entrei em modo sem IA só nessa função até o mês que vem (ou até a parte dela ser aumentada em Dolores — operação contínua). As outras funções continuam funcionando.`);
  } else {
    L.push(a.alvo === "total"
      ? "Ao chegar a 100%, eu paro de usar a IA até o mês que vem."
      : "Ao chegar a 100% da parte, só essa função para de usar a IA; as outras continuam.");
  }
  L.push("Nada foi alterado no sistema.");
  return L.join("\n");
}

/** Uma linha para o relatório diário: o gasto de cada função contra a parte dela. */
export function linhaDoGastoPorFuncao(s: SituacaoDoGasto): string {
  return `Por função: ${s.funcoes.map(f => `${NOME_DA_FUNCAO_NA_FRASE[f.funcao]} ${f.reais !== null ? `${brlAlerta(f.reais)} · ` : ""}${pctTxt(f.pct)} da parte de ${f.parte}%`).join("; ")}.`;
}

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
  const funcoes: FuncaoDoConsumo[] = ["conversa", "grupos", "clientes", "documentos_e_notas", "avisos"];
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
