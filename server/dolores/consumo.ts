// EPIC-025 (Dolores, etapa 2) — configuração do WhatsApp da Dolores e consumo da IA (dolores_whatsapp_config,
// dolores_consumo). O limite mensal é em tokens (entrada e saída separados, porque têm preços diferentes): o sistema não
// sabe o preço do modelo e não o inventa; o admin converte o teto em reais para tokens (docs/dolores/como-ligar.md). O cache
// entra no limite pelo peso do preço — escrita 1,25×, leitura 0,1× (entradaNoLimiteSql); a classificação de documentos guarda no orçamento próprio
// (dolores_grupos_consumo_mes) a entrada bruta, como antes — lá quase não há cache e a conta bruta é mais rígida.
import { and, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { doloresConfig } from "../../drizzle/schema-dolores.js";
import { doloresConsumo, doloresMensagens, doloresWhatsappConfig, type DoloresWhatsappConfig } from "../../drizzle/schema-dolores-whatsapp.js";
import { doloresGrupoMensagens, doloresGruposConsumoMes } from "../../drizzle/schema-dolores-grupos.js";
import { doloresMarcacoes } from "../../drizzle/schema-dolores-marcacoes.js";
import { doloresAtendimentos } from "../../drizzle/schema-whatsapp-atendimento.js";
import { bloqueioDoLimite, type Limites, type Uso } from "../../shared/dolores/whatsapp.js";
import {
  FATOR_CACHE_ESCRITA, FATOR_CACHE_LEITURA, FUNCOES_DO_GASTO, PARADA_CLIENTE, PARADA_GRUPO, PARTES_PADRAO, erroDasPartes, funcaoDaChamada, limiteDaParte,
  type FuncaoDoConsumo, type PartesDoGasto,
} from "../../shared/dolores/custo.js";
import { doloresGastoPartes } from "../../drizzle/schema-dolores-operacao.js";
import { getDb } from "../db.js";
import { erroParaLog } from "./erro-seguro.js";

export { PARADA_CLIENTE, PARADA_GRUPO };

// ── EPIC-027 C5-E5 — gasto separado por função ──
// Cada chamada à IA da Dolores conta na FUNÇÃO dela (coluna `dolores_consumo.funcao`, migração 0148; linha antiga sai pela regra
// antiga, `funcaoSql`). Cada função tem a sua PARTE do limite mensal (dolores_gasto_partes; padrão do dono: conversa 55 ·
// documentos 20 · grupos 10 · clientes 10 · avisos 5). Ao atingir a parte, SÓ aquela função para; a soma das partes é 100%, então o
// total nunca passa do limite. Toda conferência continua sob a MESMA trava (linha 1 de dolores_whatsapp_config em FOR UPDATE).

type Executor = { execute: ReturnType<typeof getDb>["execute"] };
const linhas = (r: unknown) => (r as { rows?: Array<Record<string, unknown>> }).rows ?? [];
let colunaFuncao = false;
/** A coluna `funcao` existe (0148 aplicada)? Só o "sim" fica guardado: antes da migração, confere de novo a cada vez (é barato). */
export async function temColunaFuncao(x: Executor = getDb()): Promise<boolean> {
  if (colunaFuncao) return true;
  const r = await x.execute(sql`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'dolores_consumo' AND column_name = 'funcao') AS existe`);
  colunaFuncao = linhas(r)[0]?.existe === true;
  return colunaFuncao;
}
/** Só para testes (banco novo a cada teste). */
export const esquecerColunaFuncao = () => { colunaFuncao = false; };

// a regra antiga, como LITERAL (constantes do código, só letras): com parâmetro, o Postgres não reconhece a mesma expressão no
// SELECT e no GROUP BY
const REGRA_ANTIGA = sql.raw(`CASE WHEN "dolores_consumo"."mensagem_id" IS NOT NULL THEN 'conversa' WHEN "dolores_consumo"."parada" LIKE '${PARADA_GRUPO.replace(/[^a-z_]/g, "")}%' THEN 'grupos' WHEN "dolores_consumo"."parada" LIKE '${PARADA_CLIENTE.replace(/[^a-z_]/g, "")}%' THEN 'clientes' ELSE 'documentos_e_notas' END`);
/** A função de cada linha de dolores_consumo: a gravada (0148) ou, em linha antiga, a regra antiga (a mesma de `funcaoDaChamada`). */
export const funcaoSql = (comColuna: boolean) => (comColuna ? sql<string>`COALESCE("dolores_consumo"."funcao", ${REGRA_ANTIGA})` : sql<string>`${REGRA_ANTIGA}`);

const USO_VAZIO = (): Record<FuncaoDoConsumo, Uso> => Object.fromEntries(FUNCOES_DO_GASTO.map(f => [f, { entrada: 0, saida: 0 }])) as Record<FuncaoDoConsumo, Uso>;

/** Uso do mês POR FUNÇÃO, com o mesmo peso do cache do limite (entradaNoLimiteSql). Função desconhecida vai para documentos. */
export async function usoPorFuncaoNoMes(mes: string, x: Transacao | ReturnType<typeof getDb> = getDb()): Promise<Record<FuncaoDoConsumo, Uso>> {
  const f = funcaoSql(await temColunaFuncao(x));
  const r = await x.select({ funcao: f, entrada: entradaNoLimiteSql(), saida: sql<number>`coalesce(sum(${doloresConsumo.tokensSaida}), 0)`.mapWith(Number) })
    .from(doloresConsumo).where(eq(doloresConsumo.mes, mes)).groupBy(f);
  const uso = USO_VAZIO();
  for (const l of r) {
    const k = ((FUNCOES_DO_GASTO as readonly string[]).includes(l.funcao) ? l.funcao : "documentos_e_notas") as FuncaoDoConsumo;
    uso[k] = { entrada: uso[k].entrada + Number(l.entrada ?? 0), saida: uso[k].saida + Number(l.saida ?? 0) };
  }
  return uso;
}

/**
 * Partes do gasto (linha única da 0148). Sem a migração, sem a linha ou valor inválido → a divisão PADRÃO do dono (nunca "sem
 * parte": a conversa continua com 55%, e nenhuma função ganha mais do que a parte padrão).
 */
export async function lerPartesDoGasto(x: Transacao | ReturnType<typeof getDb> = getDb()): Promise<{ partes: PartesDoGasto; disponivel: boolean }> {
  try {
    const existe = linhas(await x.execute(sql`SELECT to_regclass('public.dolores_gasto_partes') IS NOT NULL AS existe`))[0]?.existe;
    if (!existe) return { partes: { ...PARTES_PADRAO }, disponivel: false };
    const [c] = await x.select().from(doloresGastoPartes).where(eq(doloresGastoPartes.id, 1)).limit(1);
    if (!c) return { partes: { ...PARTES_PADRAO }, disponivel: false };
    const partes: PartesDoGasto = { conversa: c.conversaPct, documentos_e_notas: c.documentosPct, grupos: c.gruposPct, clientes: c.clientesPct, avisos: c.avisosPct };
    return erroDasPartes(partes) ? { partes: { ...PARTES_PADRAO }, disponivel: true } : { partes, disponivel: true };
  } catch (e) {
    console.error("[dolores/consumo] falha ao ler as partes do gasto; usei a divisão padrão", erroParaLog(e));
    return { partes: { ...PARTES_PADRAO }, disponivel: false };
  }
}

/** A reserva cabe na parte da função (uso real dela + o que já está reservado nela + esta reserva ≤ a parte)? */
const cabeNaParte = (uso: Uso, reservado: Uso, reserva: Uso, limites: Limites, pct: number) => {
  const parte = limiteDaParte(limites, pct);
  return uso.entrada + reservado.entrada + reserva.entrada <= parte.entrada && uso.saida + reservado.saida + reserva.saida <= parte.saida;
};
/** A parte da função já acabou pelo uso REAL (sem reservas)? Mesma regra do limite inteiro: atingido em entrada OU saída. */
const parteEsgotada = (uso: Uso, limites: Limites, pct: number) => {
  const parte = limiteDaParte(limites, pct);
  return uso.entrada >= parte.entrada || uso.saida >= parte.saida;
};

/**
 * Conferência rápida (sem trava) para a porta da chave (whatsapp.ts#bloqueioAtual): a parte desta função já acabou neste mês?
 * A trava de verdade é a reserva (abaixo); isto só evita ler a chave e montar o pedido à toa. Falha → true (falha fechada).
 */
export async function parteDaFuncaoEsgotada(mes: string, funcao: FuncaoDoConsumo, limites: Limites): Promise<boolean> {
  try {
    const [uso, { partes }] = await Promise.all([usoPorFuncaoNoMes(mes), lerPartesDoGasto()]);
    return parteEsgotada(uso[funcao], limites, partes[funcao]);
  } catch (e) {
    console.error("[dolores/consumo] falha ao conferir a parte da função", erroParaLog(e));
    return true;
  }
}

/**
 * REGISTRA os alertas de 80%/100% devidos, PENDENTES (server/dolores/operacao-gasto.ts). QA C5 (B1): nada é enviado daqui — isto
 * roda no meio do laço; o envio sai depois da resposta principal ou no cron (enviarAlertasPendentes). Nunca lança.
 */
async function dispararAlertas(mes: string, o: { bloqueadas?: FuncaoDoConsumo[]; totalBloqueado?: boolean } = {}) {
  try {
    const { registrarAlertasDevidos } = await import("./operacao-gasto.js");
    await registrarAlertasDevidos(mes, o);
  } catch (e) {
    console.error("[dolores/consumo] falha ao conferir os alertas de gasto", erroParaLog(e));
  }
}

/** Linha única da configuração do WhatsApp (criada pela migração 0124). Sem ela → null. */
export async function lerConfigWhatsapp(): Promise<DoloresWhatsappConfig | null> {
  const [c] = await getDb().select().from(doloresWhatsappConfig).where(eq(doloresWhatsappConfig.id, 1)).limit(1);
  return c ?? null;
}

/** Pausa geral da Dolores (dolores_config, etapa 1). Sem a linha → trata como indisponível (null). */
export async function lerPausa(): Promise<{ pausada: boolean; motivo: string | null } | null> {
  const [c] = await getDb().select({ pausada: doloresConfig.pausada, motivo: doloresConfig.motivoPausa }).from(doloresConfig).where(eq(doloresConfig.id, 1)).limit(1);
  return c ? { pausada: c.pausada, motivo: c.motivo } : null;
}

/**
 * QA C5-E1 r4 (achado 2) — a entrada que vale para o LIMITE MENSAL, somada no banco, pelo PESO DO PREÇO de cada tipo de token (a
 * proposta da story E8): entrada cheia + escrita de cache × 1,25 + leitura de cache × 0,1, cada uma arredondada para cima — a mesma
 * regra de shared/dolores/custo.ts (`entradaNoLimite`) e os mesmos fatores que a estimativa em dinheiro usa quando o preço do cache
 * não foi informado. Coerente com a tabela da Anthropic (shared/dolores/precos-padrao.ts): escrita = 1,25× nos dois modelos;
 * leitura = 0,1× no Haiku e 0,05× no Opus — então o peso nunca conta MENOS que o custo real. Antes a leitura contava como token
 * cheio (a memória da conversa, que lê o histórico do cache, gastava a cota até 10× mais rápido que o dinheiro) e a escrita, como
 * 1× (25% a menos que o preço). Os tokens BRUTOS continuam gravados por chamada em dolores_consumo (auditoria e tela); só a soma do
 * limite usa o peso. Vale para o limite inteiro e para os orçamentos próprios que saem de dolores_consumo (respostas em grupo e a
 * clientes).
 */
export const entradaNoLimiteSql = () =>
  sql<number>`coalesce(sum(${doloresConsumo.tokensEntrada}), 0) + ceil(coalesce(sum(${doloresConsumo.tokensCacheEscrita}), 0) * ${sql.raw(String(FATOR_CACHE_ESCRITA))}) + ceil(coalesce(sum(${doloresConsumo.tokensCacheLeitura}), 0) * ${sql.raw(String(FATOR_CACHE_LEITURA))})`.mapWith(Number);

/** Tokens do mês que contam no limite (entrada pelo peso do cache, ver entradaNoLimiteSql; saída cheia). */
export async function usoDoMes(mes: string): Promise<Uso> {
  const [r] = await getDb().select({
    entrada: entradaNoLimiteSql(),
    saida: sql<number>`coalesce(sum(${doloresConsumo.tokensSaida}), 0)`.mapWith(Number),
  }).from(doloresConsumo).where(eq(doloresConsumo.mes, mes));
  return { entrada: Number(r?.entrada ?? 0), saida: Number(r?.saida ?? 0) };
}

export type UsoDaChamada = { entrada: number; saida: number; cacheEscrita: number; cacheLeitura: number };

/**
 * Uma linha por chamada ao modelo. Falha ao gravar não derruba a resposta, mas vai para o log. Devolve se gravou: a
 * classificação de grupo falha fechado quando não gravou (QA r3 N7); a conversa do dono só registra.
 */
export async function registrarConsumo(c: { mes: string; mensagemId: number | null; modelo: string; volta: number; uso: UsoDaChamada; parada: string | null;
  /** C5-E5: a função da chamada. Sem ela, sai pela origem (mensagem do dono = conversa; parada "grupo…"/"cliente…"; o resto = documentos). */
  funcao?: FuncaoDoConsumo }): Promise<boolean> {
  const parada = c.parada?.slice(0, 30) ?? null;
  const funcao = funcaoDaChamada({ funcao: c.funcao ?? null, mensagemId: c.mensagemId, parada });
  try {
    const db = getDb();
    if (await temColunaFuncao(db)) {
      // a coluna da 0148 fica fora do schema Drizzle (ver drizzle/schema-dolores-operacao.ts): insert por SQL
      await db.execute(sql`INSERT INTO "dolores_consumo" ("mes", "mensagem_id", "modelo", "volta", "tokens_entrada", "tokens_saida", "tokens_cache_escrita", "tokens_cache_leitura", "parada", "funcao")
        VALUES (${c.mes}, ${c.mensagemId}, ${c.modelo.slice(0, 120)}, ${c.volta}, ${c.uso.entrada}, ${c.uso.saida}, ${c.uso.cacheEscrita}, ${c.uso.cacheLeitura}, ${parada}, ${funcao})`);
    } else {
      await db.insert(doloresConsumo).values({
        mes: c.mes, mensagemId: c.mensagemId, modelo: c.modelo.slice(0, 120), volta: c.volta,
        tokensEntrada: c.uso.entrada, tokensSaida: c.uso.saida, tokensCacheEscrita: c.uso.cacheEscrita, tokensCacheLeitura: c.uso.cacheLeitura, parada,
      });
    }
  } catch (e) {
    console.error("[dolores/consumo] falha ao registrar o consumo", erroParaLog(e));
    return false;
  }
  // C5-E5: o gasto cruzou 80%/100% (do total ou da parte da função)? O alerta fica PENDENTE (uma vez por mês por limite) e sai
  // depois da resposta principal (QA C5 B1); nunca derruba o registro.
  await dispararAlertas(c.mes);
  return true;
}

/** Marca o aviso do limite deste mês numa só instrução: true só na primeira vez do mês (o aviso sai uma vez). */
export async function marcarAvisoDoMes(mes: string): Promise<boolean> {
  const r = await getDb().update(doloresWhatsappConfig).set({ avisoLimiteMes: mes })
    .where(and(eq(doloresWhatsappConfig.id, 1), or(isNull(doloresWhatsappConfig.avisoLimiteMes), ne(doloresWhatsappConfig.avisoLimiteMes, mes))))
    .returning({ id: doloresWhatsappConfig.id });
  return r.length > 0;
}

/**
 * Reserva o limite mensal ANTES de chamar o modelo (QA achado 3: dois comandos ao mesmo tempo passavam pela conferência
 * e somavam acima do limite). Numa transação com a linha da configuração travada (FOR UPDATE), soma o consumo do mês e as
 * reservas ainda válidas das OUTRAS mensagens; se não bloquear, grava a reserva desta mensagem. Quem chega depois enxerga
 * a reserva e para. A reserva é liberada depois da chamada (liberarReserva) e vence sozinha em `validadeMs` (função que
 * morreu no meio não prende o limite para sempre). Devolve o motivo do bloqueio ou null (reservado).
 */
export async function reservarChamada(p: { mes: string; mensagemId: number; limites: Limites; reserva: Uso; validadeMs: number }) {
  const r = await getDb().transaction(async tx => {
    await tx.execute(sql`SELECT ${doloresWhatsappConfig.id} FROM ${doloresWhatsappConfig} WHERE ${doloresWhatsappConfig.id} = 1 FOR UPDATE`);
    const agora = new Date();
    const [usado] = await tx.select({
      entrada: entradaNoLimiteSql(),
      saida: sql<number>`coalesce(sum(${doloresConsumo.tokensSaida}), 0)`.mapWith(Number),
    }).from(doloresConsumo).where(eq(doloresConsumo.mes, p.mes));
    const [reservado] = await tx.select({
      entrada: sql<number>`coalesce(sum(${doloresMensagens.reservaEntrada}), 0)`.mapWith(Number),
      saida: sql<number>`coalesce(sum(${doloresMensagens.reservaSaida}), 0)`.mapWith(Number),
    }).from(doloresMensagens).where(and(gt(doloresMensagens.reservaAte, agora), ne(doloresMensagens.id, p.mensagemId)));
    // Etapa 4: as reservas das classificações de documentos em andamento também ocupam o limite
    const grupos = await reservasDasClassificacoes(tx, agora, null);
    // Etapa 4b: e as das respostas em grupo (quando marcada) em andamento
    const marcacoes = await reservasDasMarcacoes(tx, agora, null);
    // Etapa 9: e as das respostas a clientes cadastrados em andamento
    const atendimentos = await reservasDosAtendimentos(tx, agora, null);
    // C5 integração 2 (revisor do PR #298): e a do aviso proativo em voo (0160)
    const avisos = await reservasDosAvisos(tx, agora, null);
    if (reservado) {
      reservado.entrada = Number(reservado.entrada ?? 0) + grupos.entrada + marcacoes.entrada + atendimentos.entrada + avisos.entrada;
      reservado.saida = Number(reservado.saida ?? 0) + grupos.saida + marcacoes.saida + atendimentos.saida + avisos.saida;
    }
    // QA r2 N3: só o uso REAL decide "limite atingido". Se o que bloqueia é a reserva de OUTRO pedido em andamento, o motivo
    // é próprio ("outro_pedido": tente de novo em um minuto) e o aviso único do mês não é gasto.
    const real = bloqueioDoLimite({ entrada: Number(usado?.entrada ?? 0), saida: Number(usado?.saida ?? 0) }, p.limites);
    if (real) return real;
    // C5-E5: a PARTE da conversa (padrão 55%), pela MESMA regra do limite inteiro: esgotada pelo uso REAL da conversa → só a
    // conversa para ("orcamento_conversa"); grupos, clientes e documentos seguem com as partes deles. Como no limite inteiro, a
    // reserva da própria chamada não barra a primeira que chega (uma chamada pode passar da parte em no máximo o teto por pedido);
    // a de OUTRA mensagem em andamento barra ("outro_pedido"). Os terceiros, ao contrário, contam a própria reserva (abaixo).
    const [porFuncao, { partes }] = await Promise.all([usoPorFuncaoNoMes(p.mes, tx), lerPartesDoGasto(tx)]);
    if (parteEsgotada(porFuncao.conversa, p.limites, partes.conversa)) return "orcamento_conversa" as const;
    const comReservas = bloqueioDoLimite({
      entrada: Number(usado?.entrada ?? 0) + Number(reservado?.entrada ?? 0), saida: Number(usado?.saida ?? 0) + Number(reservado?.saida ?? 0),
    }, p.limites);
    if (comReservas) return "outro_pedido" as const;
    // outra mensagem do dono em andamento ocupa o que resta da parte da conversa: tente de novo em um minuto
    const [daConversa] = await tx.select({
      entrada: sql<number>`coalesce(sum(${doloresMensagens.reservaEntrada}), 0)`.mapWith(Number),
      saida: sql<number>`coalesce(sum(${doloresMensagens.reservaSaida}), 0)`.mapWith(Number),
    }).from(doloresMensagens).where(and(gt(doloresMensagens.reservaAte, agora), ne(doloresMensagens.id, p.mensagemId)));
    if (parteEsgotada({ entrada: porFuncao.conversa.entrada + Number(daConversa?.entrada ?? 0), saida: porFuncao.conversa.saida + Number(daConversa?.saida ?? 0) },
      p.limites, partes.conversa)) return "outro_pedido" as const;
    await tx.update(doloresMensagens).set({
      reservaEntrada: Math.max(0, Math.round(p.reserva.entrada)), reservaSaida: Math.max(0, Math.round(p.reserva.saida)),
      reservaAte: new Date(agora.getTime() + p.validadeMs),
    }).where(eq(doloresMensagens.id, p.mensagemId));
    return null;
  });
  if (r === "orcamento_conversa") await dispararAlertas(p.mes, { bloqueadas: ["conversa"] });
  else if (r === "limite_mensal") await dispararAlertas(p.mes, { totalBloqueado: true });
  return r;
}

/** Solta a reserva da mensagem (depois de registrar o consumo real). Falha só vai para o log: a reserva vence sozinha. */
export async function liberarReserva(mensagemId: number) {
  try {
    await getDb().update(doloresMensagens).set({ reservaEntrada: 0, reservaSaida: 0, reservaAte: null }).where(eq(doloresMensagens.id, mensagemId));
  } catch (e) {
    console.error("[dolores/consumo] falha ao liberar a reserva", e instanceof Error ? e.name : "erro");
  }
}

type Transacao = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Etapa 4 — reservas ainda válidas das classificações de documentos (dolores_grupo_mensagens), menos a da própria
 * mensagem. Sem a migração 0126, não há reserva de classificação (zero) — a etapa 2 continua igual.
 */
async function reservasDasClassificacoes(tx: Transacao, agora: Date, excetoId: number | null): Promise<Uso> {
  const existe = await tx.execute(sql`SELECT to_regclass('public.dolores_grupo_mensagens') IS NOT NULL AS existe`);
  if (!(existe as unknown as { rows: Array<{ existe: boolean }> }).rows[0]?.existe) return { entrada: 0, saida: 0 };
  const [r] = await tx.select({
    entrada: sql<number>`coalesce(sum(${doloresGrupoMensagens.reservaEntrada}), 0)`.mapWith(Number),
    saida: sql<number>`coalesce(sum(${doloresGrupoMensagens.reservaSaida}), 0)`.mapWith(Number),
  }).from(doloresGrupoMensagens).where(excetoId === null ? gt(doloresGrupoMensagens.reservaAte, agora)
    : and(gt(doloresGrupoMensagens.reservaAte, agora), ne(doloresGrupoMensagens.id, excetoId)));
  return { entrada: Number(r?.entrada ?? 0), saida: Number(r?.saida ?? 0) };
}

/**
 * Etapa 4 — a classificação de documentos nunca passa desta fração do limite mensal SOMANDO tudo (uso real de todos +
 * reservas): o resto fica de folga para os comandos do dono.
 */
export const FRACAO_DO_LIMITE_PARA_CLASSIFICACAO = 0.8;
/** QA E4 r2, N0 — orçamento PRÓPRIO da classificação (padrão; o admin ajusta em dolores_grupos_config, de 1% a 50%). */
export const ORCAMENTO_CLASSIFICACAO_PCT_PADRAO = 20;

/**
 * C5-E5 — conferência comum das funções de TERCEIROS (documentos, grupos, clientes; e os avisos da E4), já sob a trava, depois do
 * "uma chamada por vez" e do limite inteiro:
 * 1. QA C5 (achado M1) — o TOTAL comprometido: uso real de TODAS as funções + TODAS as reservas ativas (as das mensagens do dono em
 *    `dolores_mensagens` e as dos outros terceiros, `outrasReservas`) + esta reserva ≤ o limite inteiro. Antes só o uso real dos
 *    terceiros era somado: com a conversa perto da parte dela e uma reserva da conversa em andamento, um terceiro cabia na própria
 *    parte e o comprometido passava do limite. Passou → "folga_do_dono" (o terceiro para; a conversa do dono nunca é barrada aqui).
 * 2. Folga do dono: o uso real dos terceiros (tudo menos a conversa) + esta reserva ≤ FRACAO_DO_LIMITE_PARA_CLASSIFICACAO do limite.
 *    A conversa tem a PARTE dela e não come o crédito dos outros (decisão do dono: "cada função com seu gasto"). A folga continua
 *    valendo para o caso de o admin dar aos terceiros mais do que 80% somados.
 * 3. A PARTE da função: uso real dela + esta reserva ≤ a parte (dolores_gasto_partes). Acabou → "parte" (só ela para).
 * Roda dentro da MESMA transação e da MESMA trava (linha 1 de dolores_whatsapp_config em FOR UPDATE) das outras conferências:
 * duas reservas ao mesmo tempo nunca leem o mesmo "sobra".
 */
async function conferirTerceiro(tx: Transacao, p: { mes: string; limites: Limites; reserva: Uso; funcao: Exclude<FuncaoDoConsumo, "conversa">;
  /** reservas ativas dos OUTROS terceiros (classificação, marcação, atendimento), sem a da própria chamada */
  outrasReservas: Uso; agora: Date;
  /** a vaga do próprio aviso (reservarAvisos), cuja reserva não conta contra ela mesma */
  excetoAvisoId?: number | null }): Promise<"folga_do_dono" | "parte" | null> {
  const [porFuncao, { partes }] = await Promise.all([usoPorFuncaoNoMes(p.mes, tx), lerPartesDoGasto(tx)]);
  const soma = (fs: readonly FuncaoDoConsumo[]) => fs.reduce((s, f) => ({ entrada: s.entrada + porFuncao[f].entrada, saida: s.saida + porFuncao[f].saida }), { entrada: 0, saida: 0 });
  // 1. total comprometido (M1): uso real de tudo + reservas das mensagens do dono + reservas dos outros terceiros + esta
  const total = soma(FUNCOES_DO_GASTO);
  const [doDono] = await tx.select({
    entrada: sql<number>`coalesce(sum(${doloresMensagens.reservaEntrada}), 0)`.mapWith(Number),
    saida: sql<number>`coalesce(sum(${doloresMensagens.reservaSaida}), 0)`.mapWith(Number),
  }).from(doloresMensagens).where(gt(doloresMensagens.reservaAte, p.agora));
  // C5 integração 2 (revisor do PR #298): a reserva dos avisos proativos em voo (0160) entra no total de TODO terceiro
  const avisos = await reservasDosAvisos(tx, p.agora, p.excetoAvisoId ?? null);
  const comprometido = {
    entrada: total.entrada + Number(doDono?.entrada ?? 0) + p.outrasReservas.entrada + avisos.entrada + p.reserva.entrada,
    saida: total.saida + Number(doDono?.saida ?? 0) + p.outrasReservas.saida + avisos.saida + p.reserva.saida,
  };
  if (comprometido.entrada > p.limites.entrada || comprometido.saida > p.limites.saida) return "folga_do_dono";
  // 2. folga do dono (os terceiros somados)
  const terceiros = soma(FUNCOES_DO_GASTO.filter(f => f !== "conversa"));
  const teto = { entrada: Math.floor(p.limites.entrada * FRACAO_DO_LIMITE_PARA_CLASSIFICACAO), saida: Math.floor(p.limites.saida * FRACAO_DO_LIMITE_PARA_CLASSIFICACAO) };
  if (terceiros.entrada + p.reserva.entrada > teto.entrada || terceiros.saida + p.reserva.saida > teto.saida) return "folga_do_dono";
  // 3. a parte da função (na dos avisos, o outro aviso em voo também ocupa a parte)
  if (!cabeNaParte(porFuncao[p.funcao], p.funcao === "avisos" ? avisos : { entrada: 0, saida: 0 }, p.reserva, p.limites, partes[p.funcao])) return "parte";
  return null;
}

const somaDeReservas = (...us: Uso[]): Uso => us.reduce((s, u) => ({ entrada: s.entrada + u.entrada, saida: s.saida + u.saida }), { entrada: 0, saida: 0 });

/** Depois da transação: a parte acabou → o código próprio da função e o alerta de 100% dela; limite inteiro → o alerta do total. */
async function depoisDaReserva<B extends string>(mes: string, funcao: FuncaoDoConsumo, r: B | "parte" | null, codigoDaParte: B): Promise<B | null> {
  if (r === "parte") { await dispararAlertas(mes, { bloqueadas: [funcao] }); return codigoDaParte; }
  if (r === "limite_mensal") await dispararAlertas(mes, { totalBloqueado: true });
  return r;
}

/** Tokens usados pela classificação no mês (dolores_grupos_consumo_mes). Sem a linha → zero. */
async function usoDaClassificacaoNoMes(tx: Transacao, mes: string): Promise<Uso> {
  const [r] = await tx.select({ entrada: doloresGruposConsumoMes.tokensEntrada, saida: doloresGruposConsumoMes.tokensSaida })
    .from(doloresGruposConsumoMes).where(eq(doloresGruposConsumoMes.mes, mes)).limit(1);
  return { entrada: Number(r?.entrada ?? 0), saida: Number(r?.saida ?? 0) };
}

export type BloqueioDaClassificacao = "sem_limite" | "limite_mensal" | "folga_do_dono" | "orcamento_classificacao" | "outra_classificacao";

/**
 * Etapa 4 — reserva do limite mensal para UMA classificação, com a mesma trava da etapa 2 (linha da configuração em
 * FOR UPDATE). Na ordem:
 * 1. QA E4 r2, N0.2 — UMA classificação por vez (global): se outra mensagem de grupo já tem reserva válida, esta não reserva
 *    ("outra_classificacao"; o documento fica "a classificar" para o próximo aviso ou a tela). Assim, uma rajada de avisos
 *    simultâneos faz no máximo uma chamada à IA por vez, e o que a primeira usar já conta para a segunda.
 * 2. Uso real de tudo no mês: limite atingido → o mesmo motivo do dono (limite_mensal / sem_limite).
 * 3. Folga do dono: uso real de tudo + reservas dos comandos + esta reserva ≤ FRACAO_DO_LIMITE_PARA_CLASSIFICACAO do limite.
 * 4. QA E4 r2, N0.3 — orçamento PRÓPRIO: uso real DA CLASSIFICAÇÃO no mês + esta reserva ≤ `orcamentoPct`% do limite.
 *    Atingido, só a classificação para; os comandos do dono seguem com o restante do limite.
 * A reserva fica na própria mensagem do grupo e vence sozinha. Devolve o motivo do bloqueio ou null (reservado).
 */
export async function reservarClassificacao(p: { mes: string; mensagemGrupoId: number; limites: Limites; reserva: Uso; validadeMs: number; orcamentoPct?: number }): Promise<BloqueioDaClassificacao | null> {
  const r = await getDb().transaction(async (tx): Promise<BloqueioDaClassificacao | "parte" | null> => {
    await tx.execute(sql`SELECT ${doloresWhatsappConfig.id} FROM ${doloresWhatsappConfig} WHERE ${doloresWhatsappConfig.id} = 1 FOR UPDATE`);
    const agora = new Date();
    const classificacoes = await reservasDasClassificacoes(tx, agora, p.mensagemGrupoId);
    // E4b: uma resposta em grupo (quando marcada) em andamento também ocupa a vez — uma chamada de IA dos grupos por vez
    const respostas = await reservasDasMarcacoes(tx, agora, null);
    // E9: uma resposta a cliente cadastrado em andamento também ocupa a vez
    const clientes = await reservasDosAtendimentos(tx, agora, null);
    const outras = { entrada: classificacoes.entrada + respostas.entrada + clientes.entrada, saida: classificacoes.saida + respostas.saida + clientes.saida };
    const [andamento] = await tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(doloresGrupoMensagens)
      .where(and(gt(doloresGrupoMensagens.reservaAte, agora), gt(doloresGrupoMensagens.reservaEntrada, 0), ne(doloresGrupoMensagens.id, p.mensagemGrupoId)));
    if (Number(andamento?.n ?? 0) > 0 || outras.entrada > 0 || outras.saida > 0) return "outra_classificacao";
    const [usado] = await tx.select({
      entrada: entradaNoLimiteSql(),
      saida: sql<number>`coalesce(sum(${doloresConsumo.tokensSaida}), 0)`.mapWith(Number),
    }).from(doloresConsumo).where(eq(doloresConsumo.mes, p.mes));
    const real = bloqueioDoLimite({ entrada: Number(usado?.entrada ?? 0), saida: Number(usado?.saida ?? 0) }, p.limites);
    if (real) return real;
    const terceiro = await conferirTerceiro(tx, { mes: p.mes, limites: p.limites, reserva: p.reserva, funcao: "documentos_e_notas", outrasReservas: outras, agora });
    if (terceiro) return terceiro;
    const pct = Math.min(50, Math.max(1, Math.round(p.orcamentoPct ?? ORCAMENTO_CLASSIFICACAO_PCT_PADRAO)));
    const orcamento = { entrada: Math.floor((p.limites.entrada * pct) / 100), saida: Math.floor((p.limites.saida * pct) / 100) };
    const daClassificacao = await usoDaClassificacaoNoMes(tx, p.mes);
    if (daClassificacao.entrada + p.reserva.entrada > orcamento.entrada || daClassificacao.saida + p.reserva.saida > orcamento.saida) return "orcamento_classificacao";
    await tx.update(doloresGrupoMensagens).set({
      reservaEntrada: Math.max(0, Math.round(p.reserva.entrada)), reservaSaida: Math.max(0, Math.round(p.reserva.saida)),
      reservaAte: new Date(agora.getTime() + p.validadeMs),
    }).where(eq(doloresGrupoMensagens.id, p.mensagemGrupoId));
    return null;
  });
  return depoisDaReserva(p.mes, "documentos_e_notas", r, "orcamento_classificacao");
}

/**
 * QA E4 r2, N0.3 — soma o uso de UMA classificação no consumo do mês da classificação (além de dolores_consumo, que é o do
 * limite inteiro). Entrada conta também o cache. Devolve se gravou: quem chama FALHA FECHADO quando não gravou (QA r3 N7 — sem
 * o registro o orçamento próprio da classificação estouraria em silêncio).
 */
export async function registrarConsumoDaClassificacao(mes: string, uso: UsoDaChamada): Promise<boolean> {
  const entrada = Math.max(0, Math.round(uso.entrada + uso.cacheEscrita + uso.cacheLeitura));
  const saida = Math.max(0, Math.round(uso.saida));
  try {
    await getDb().insert(doloresGruposConsumoMes).values({ mes, tokensEntrada: entrada, tokensSaida: saida, chamadas: 1 })
      .onConflictDoUpdate({ target: doloresGruposConsumoMes.mes, set: {
        tokensEntrada: sql`${doloresGruposConsumoMes.tokensEntrada} + ${entrada}`, tokensSaida: sql`${doloresGruposConsumoMes.tokensSaida} + ${saida}`,
        chamadas: sql`${doloresGruposConsumoMes.chamadas} + 1`, ultimaEm: sql`now()` } });
    return true;
  } catch (e) {
    console.error("[dolores/consumo] falha ao registrar o consumo da classificação", erroParaLog(e));
    return false;
  }
}

/** Solta a reserva da classificação. Falha só vai para o log: a reserva vence sozinha. */
export async function liberarReservaClassificacao(mensagemGrupoId: number) {
  try {
    await getDb().update(doloresGrupoMensagens).set({ reservaEntrada: 0, reservaSaida: 0, reservaAte: null }).where(eq(doloresGrupoMensagens.id, mensagemGrupoId));
  } catch (e) {
    console.error("[dolores/consumo] falha ao liberar a reserva da classificação", e instanceof Error ? e.name : "erro");
  }
}

/**
 * Etapa 4b — reservas ainda válidas das respostas em grupo quando a Dolores é marcada (dolores_marcacoes), menos a da própria
 * marcação. Sem a migração 0129, zero (as etapas anteriores continuam iguais).
 */
async function reservasDasMarcacoes(tx: Transacao, agora: Date, excetoId: number | null): Promise<Uso> {
  const existe = await tx.execute(sql`SELECT to_regclass('public.dolores_marcacoes') IS NOT NULL AS existe`);
  if (!(existe as unknown as { rows: Array<{ existe: boolean }> }).rows[0]?.existe) return { entrada: 0, saida: 0 };
  const [r] = await tx.select({
    entrada: sql<number>`coalesce(sum(${doloresMarcacoes.reservaEntrada}), 0)`.mapWith(Number),
    saida: sql<number>`coalesce(sum(${doloresMarcacoes.reservaSaida}), 0)`.mapWith(Number),
  }).from(doloresMarcacoes).where(excetoId === null ? gt(doloresMarcacoes.reservaAte, agora)
    : and(gt(doloresMarcacoes.reservaAte, agora), ne(doloresMarcacoes.id, excetoId)));
  return { entrada: Number(r?.entrada ?? 0), saida: Number(r?.saida ?? 0) };
}

/**
 * E4b — orçamento PRÓPRIO das respostas em grupo: % do limite mensal. C5-E5: virou a PARTE "grupos" (dolores_gasto_partes, editável
 * pelo admin); este é o padrão. O prefixo da parada ("grupo…") continua o mesmo (PARADA_GRUPO, shared/dolores/custo.ts).
 */
export const ORCAMENTO_MARCACAO_PCT = PARTES_PADRAO.grupos;

export type BloqueioDaMarcacao = "sem_limite" | "limite_mensal" | "folga_do_dono" | "orcamento_marcacao" | "outra_chamada";

/**
 * Etapa 4b — reserva do limite mensal para UMA chamada do laço do grupo, com a mesma trava (linha da configuração em FOR UPDATE)
 * e as mesmas regras da classificação (QA E4 r2/r3), na ordem:
 * 1. UMA chamada de IA dos grupos por vez (global): reserva válida de uma classificação ou de OUTRA marcação → "outra_chamada"
 *    (silêncio; a reserva da própria marcação, de uma volta anterior, já foi solta antes da próxima volta).
 * 2. Uso real de tudo no mês: limite atingido → o mesmo motivo do dono.
 * 3. Folga do dono: uso real + reservas dos comandos + esta reserva ≤ FRACAO_DO_LIMITE_PARA_CLASSIFICACAO do limite.
 * 4. Orçamento PRÓPRIO: uso real das respostas em grupo no mês (`dolores_consumo` com `parada` "grupo…") + esta reserva ≤
 *    ORCAMENTO_MARCACAO_PCT% do limite. Atingido, só as respostas em grupo param.
 * A reserva fica na própria marcação e vence sozinha. Devolve o motivo do bloqueio ou null (reservado).
 */
export async function reservarMarcacao(p: { mes: string; marcacaoId: number; limites: Limites; reserva: Uso; validadeMs: number }): Promise<BloqueioDaMarcacao | null> {
  const r = await getDb().transaction(async (tx): Promise<BloqueioDaMarcacao | "parte" | null> => {
    await tx.execute(sql`SELECT ${doloresWhatsappConfig.id} FROM ${doloresWhatsappConfig} WHERE ${doloresWhatsappConfig.id} = 1 FOR UPDATE`);
    const agora = new Date();
    const classificacoes = await reservasDasClassificacoes(tx, agora, null);
    const outras = await reservasDasMarcacoes(tx, agora, p.marcacaoId);
    const clientes = await reservasDosAtendimentos(tx, agora, null);
    if (classificacoes.entrada > 0 || classificacoes.saida > 0 || outras.entrada > 0 || outras.saida > 0 || clientes.entrada > 0 || clientes.saida > 0) return "outra_chamada";
    const [usado] = await tx.select({
      entrada: entradaNoLimiteSql(),
      saida: sql<number>`coalesce(sum(${doloresConsumo.tokensSaida}), 0)`.mapWith(Number),
    }).from(doloresConsumo).where(eq(doloresConsumo.mes, p.mes));
    const real = bloqueioDoLimite({ entrada: Number(usado?.entrada ?? 0), saida: Number(usado?.saida ?? 0) }, p.limites);
    if (real) return real;
    // C5-E5: folga do dono e a PARTE das respostas em grupo (padrão 10%, a mesma do ORCAMENTO_MARCACAO_PCT fixo de antes)
    const terceiro = await conferirTerceiro(tx, { mes: p.mes, limites: p.limites, reserva: p.reserva, funcao: "grupos",
      outrasReservas: somaDeReservas(classificacoes, outras, clientes), agora });
    if (terceiro) return terceiro;
    await tx.update(doloresMarcacoes).set({
      reservaEntrada: Math.max(0, Math.round(p.reserva.entrada)), reservaSaida: Math.max(0, Math.round(p.reserva.saida)),
      reservaAte: new Date(agora.getTime() + p.validadeMs),
    }).where(eq(doloresMarcacoes.id, p.marcacaoId));
    return null;
  });
  return depoisDaReserva(p.mes, "grupos", r, "orcamento_marcacao");
}

/** Solta a reserva da resposta em grupo. Falha só vai para o log: a reserva vence sozinha. */
export async function liberarReservaMarcacao(marcacaoId: number) {
  try {
    await getDb().update(doloresMarcacoes).set({ reservaEntrada: 0, reservaSaida: 0, reservaAte: null }).where(eq(doloresMarcacoes.id, marcacaoId));
  } catch (e) {
    console.error("[dolores/consumo] falha ao liberar a reserva da resposta em grupo", e instanceof Error ? e.name : "erro");
  }
}

// ── Etapa 9 — respostas a clientes cadastrados (conversa direta) ──

/** Reservas ainda válidas das respostas a clientes (dolores_atendimentos), menos a do próprio atendimento. Sem a 0135, zero. */
async function reservasDosAtendimentos(tx: Transacao, agora: Date, excetoId: number | null): Promise<Uso> {
  const existe = await tx.execute(sql`SELECT to_regclass('public.dolores_atendimentos') IS NOT NULL AS existe`);
  if (!(existe as unknown as { rows: Array<{ existe: boolean }> }).rows[0]?.existe) return { entrada: 0, saida: 0 };
  const [r] = await tx.select({
    entrada: sql<number>`coalesce(sum(${doloresAtendimentos.reservaEntrada}), 0)`.mapWith(Number),
    saida: sql<number>`coalesce(sum(${doloresAtendimentos.reservaSaida}), 0)`.mapWith(Number),
  }).from(doloresAtendimentos).where(excetoId === null ? gt(doloresAtendimentos.reservaAte, agora)
    : and(gt(doloresAtendimentos.reservaAte, agora), ne(doloresAtendimentos.id, excetoId)));
  return { entrada: Number(r?.entrada ?? 0), saida: Number(r?.saida ?? 0) };
}

/** E9 — orçamento PRÓPRIO das respostas a clientes cadastrados. C5-E5: virou a PARTE "clientes" (editável); este é o padrão. */
export const ORCAMENTO_ATENDIMENTO_PCT = PARTES_PADRAO.clientes;

export type BloqueioDoAtendimento = "sem_limite" | "limite_mensal" | "folga_do_dono" | "orcamento_atendimento" | "outra_chamada";

/**
 * E9 — reserva do limite mensal para UMA chamada do laço de resposta a cliente, com a MESMA trava e as mesmas regras da resposta
 * em grupo (reservarMarcacao), na ordem: 1) UMA chamada de IA de terceiros por vez (classificação, marcação ou outro atendimento
 * com reserva válida → "outra_chamada"); 2) uso real do mês: limite atingido; 3) folga do dono; 4) orçamento próprio
 * (ORCAMENTO_ATENDIMENTO_PCT% do limite, pelo uso com `parada` "cliente…"). A reserva fica no atendimento e vence sozinha.
 */
export async function reservarAtendimento(p: { mes: string; atendimentoId: number; limites: Limites; reserva: Uso; validadeMs: number }): Promise<BloqueioDoAtendimento | null> {
  const r = await getDb().transaction(async (tx): Promise<BloqueioDoAtendimento | "parte" | null> => {
    await tx.execute(sql`SELECT ${doloresWhatsappConfig.id} FROM ${doloresWhatsappConfig} WHERE ${doloresWhatsappConfig.id} = 1 FOR UPDATE`);
    const agora = new Date();
    const classificacoes = await reservasDasClassificacoes(tx, agora, null);
    const marcacoes = await reservasDasMarcacoes(tx, agora, null);
    const outros = await reservasDosAtendimentos(tx, agora, p.atendimentoId);
    if ([classificacoes, marcacoes, outros].some(u => u.entrada > 0 || u.saida > 0)) return "outra_chamada";
    const [usado] = await tx.select({
      entrada: entradaNoLimiteSql(),
      saida: sql<number>`coalesce(sum(${doloresConsumo.tokensSaida}), 0)`.mapWith(Number),
    }).from(doloresConsumo).where(eq(doloresConsumo.mes, p.mes));
    const real = bloqueioDoLimite({ entrada: Number(usado?.entrada ?? 0), saida: Number(usado?.saida ?? 0) }, p.limites);
    if (real) return real;
    // C5-E5: folga do dono e a PARTE do atendimento a clientes (padrão 10%, a mesma do ORCAMENTO_ATENDIMENTO_PCT fixo de antes)
    const terceiro = await conferirTerceiro(tx, { mes: p.mes, limites: p.limites, reserva: p.reserva, funcao: "clientes",
      outrasReservas: somaDeReservas(classificacoes, marcacoes, outros), agora });
    if (terceiro) return terceiro;
    await tx.update(doloresAtendimentos).set({
      reservaEntrada: Math.max(0, Math.round(p.reserva.entrada)), reservaSaida: Math.max(0, Math.round(p.reserva.saida)),
      reservaAte: new Date(agora.getTime() + p.validadeMs),
    }).where(eq(doloresAtendimentos.id, p.atendimentoId));
    return null;
  });
  return depoisDaReserva(p.mes, "clientes", r, "orcamento_atendimento");
}

/** Solta a reserva da resposta a cliente. Falha só vai para o log: a reserva vence sozinha. */
export async function liberarReservaAtendimento(atendimentoId: number) {
  try {
    await getDb().update(doloresAtendimentos).set({ reservaEntrada: 0, reservaSaida: 0, reservaAte: null }).where(eq(doloresAtendimentos.id, atendimentoId));
  } catch (e) {
    console.error("[dolores/consumo] falha ao liberar a reserva da resposta a cliente", e instanceof Error ? e.name : "erro");
  }
}

// ── EPIC-027 C5-E4 — texto dos avisos automáticos ao dono ──

export type BloqueioDosAvisos = "sem_limite" | "limite_mensal" | "folga_do_dono" | "orcamento_avisos";

/**
 * C5-E4 — confere, sob a MESMA trava (linha 1 de dolores_whatsapp_config em FOR UPDATE), se UMA chamada que só redige o aviso cabe:
 * 1) uso real do mês contra o limite inteiro; 2) (integração 2) o TOTAL comprometido, a folga do dono e a PARTE "avisos" (padrão 5%),
 * pela mesma `conferirTerceiro` dos outros terceiros.
 * Integração 2 (revisor do PR #298): cabendo, GRAVA a reserva na própria vaga do aviso (`envioId`, linha de dolores_avisos_envios;
 * colunas da 0160), no mesmo formato das outras reservas de terceiros: a conversa do dono (reservarChamada) e todo terceiro
 * (conferirTerceiro) a enxergam nos totais enquanto vale. Quem chama solta com `liberarReservaAvisos` depois de registrar o consumo
 * real ou na falha; se a função morrer no meio, ela vence sozinha em `validadeMs`. Sem a 0160, confere como antes, sem gravar.
 * Bloqueado → o aviso sai com o texto fixo; a conversa do dono e as outras funções não são tocadas.
 */
export async function reservarAvisos(p: { mes: string; limites: Limites; reserva: Uso; envioId: number; validadeMs: number }): Promise<BloqueioDosAvisos | null> {
  const r = await getDb().transaction(async (tx): Promise<BloqueioDosAvisos | "parte" | null> => {
    await tx.execute(sql`SELECT ${doloresWhatsappConfig.id} FROM ${doloresWhatsappConfig} WHERE ${doloresWhatsappConfig.id} = 1 FOR UPDATE`);
    const [usado] = await tx.select({
      entrada: entradaNoLimiteSql(),
      saida: sql<number>`coalesce(sum(${doloresConsumo.tokensSaida}), 0)`.mapWith(Number),
    }).from(doloresConsumo).where(eq(doloresConsumo.mes, p.mes));
    const real = bloqueioDoLimite({ entrada: Number(usado?.entrada ?? 0), saida: Number(usado?.saida ?? 0) }, p.limites);
    if (real) return real;
    // Integração 2 (QA C5, M1): a MESMA conferência do total comprometido dos outros terceiros — uso real de tudo + reservas ativas
    // das mensagens do dono + reservas dos outros terceiros (classificação, marcação, atendimento) + esta ≤ limite; depois a folga do
    // dono e a parte "avisos" (5%).
    const agora = new Date();
    const outras = somaDeReservas(await reservasDasClassificacoes(tx, agora, null), await reservasDasMarcacoes(tx, agora, null), await reservasDosAtendimentos(tx, agora, null));
    const terceiro = await conferirTerceiro(tx, { mes: p.mes, limites: p.limites, reserva: p.reserva, funcao: "avisos", outrasReservas: outras, agora, excetoAvisoId: p.envioId });
    if (terceiro) return terceiro;
    if (await temReservaDosAvisos(tx)) {
      await tx.execute(sql`UPDATE "dolores_avisos_envios" SET "reserva_entrada" = ${Math.max(0, Math.round(p.reserva.entrada))}::integer,
        "reserva_saida" = ${Math.max(0, Math.round(p.reserva.saida))}::integer, "reserva_ate" = ${new Date(agora.getTime() + p.validadeMs).toISOString()}::timestamptz
        WHERE "id" = ${p.envioId}::integer`);
    }
    return null;
  });
  return depoisDaReserva(p.mes, "avisos", r, "orcamento_avisos");
}

/** Solta a reserva do aviso (depois de registrar o consumo real, ou na falha). Falha só vai para o log: a reserva vence sozinha. */
export async function liberarReservaAvisos(envioId: number) {
  try {
    const db = getDb();
    if (!(await temReservaDosAvisos(db))) return;
    await db.execute(sql`UPDATE "dolores_avisos_envios" SET "reserva_entrada" = 0, "reserva_saida" = 0, "reserva_ate" = NULL WHERE "id" = ${envioId}::integer`);
  } catch (e) {
    console.error("[dolores/consumo] falha ao liberar a reserva do aviso", e instanceof Error ? e.name : "erro");
  }
}

/** A 0160 (reserva do aviso na vaga) foi aplicada? Conferido a cada vez (barato), como as tabelas dos outros terceiros. */
async function temReservaDosAvisos(x: Executor): Promise<boolean> {
  const r = await x.execute(sql`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'dolores_avisos_envios' AND column_name = 'reserva_ate') AS existe`);
  return linhas(r)[0]?.existe === true;
}

/** Reservas ainda válidas dos avisos proativos em voo (dolores_avisos_envios, 0160), menos a da própria vaga. Sem a 0160, zero. */
async function reservasDosAvisos(tx: Transacao, agora: Date, excetoId: number | null): Promise<Uso> {
  if (!(await temReservaDosAvisos(tx))) return { entrada: 0, saida: 0 };
  const ate = agora.toISOString();
  const r = await tx.execute(excetoId === null
    ? sql`SELECT coalesce(sum("reserva_entrada"), 0)::bigint AS entrada, coalesce(sum("reserva_saida"), 0)::bigint AS saida FROM "dolores_avisos_envios" WHERE "reserva_ate" > ${ate}::timestamptz`
    : sql`SELECT coalesce(sum("reserva_entrada"), 0)::bigint AS entrada, coalesce(sum("reserva_saida"), 0)::bigint AS saida FROM "dolores_avisos_envios" WHERE "reserva_ate" > ${ate}::timestamptz AND "id" <> ${excetoId}::integer`);
  const l = linhas(r)[0];
  return { entrada: Number(l?.entrada ?? 0), saida: Number(l?.saida ?? 0) };
}
