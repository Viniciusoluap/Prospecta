// EPIC-025 (Dolores, etapa 2) — configuração do WhatsApp da Dolores e consumo da IA (dolores_whatsapp_config,
// dolores_consumo). O limite mensal é em tokens (entrada e saída separados, porque têm preços diferentes): o sistema não
// sabe o preço do modelo e não o inventa; o admin converte o teto em reais para tokens (docs/dolores/como-ligar.md).
import { and, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { doloresConfig } from "../../drizzle/schema-dolores.js";
import { doloresConsumo, doloresMensagens, doloresWhatsappConfig, type DoloresWhatsappConfig } from "../../drizzle/schema-dolores-whatsapp.js";
import { doloresGrupoMensagens, doloresGruposConsumoMes } from "../../drizzle/schema-dolores-grupos.js";
import { doloresMarcacoes } from "../../drizzle/schema-dolores-marcacoes.js";
import { doloresAtendimentos } from "../../drizzle/schema-whatsapp-atendimento.js";
import { bloqueioDoLimite, type Limites, type Uso } from "../../shared/dolores/whatsapp.js";
import { getDb } from "../db.js";
import { erroParaLog } from "./erro-seguro.js";

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

/** Tokens do mês. Entrada conta também a escrita e a leitura de cache (o que for cobrado como entrada). */
export async function usoDoMes(mes: string): Promise<Uso> {
  const [r] = await getDb().select({
    entrada: sql<number>`coalesce(sum(${doloresConsumo.tokensEntrada} + ${doloresConsumo.tokensCacheEscrita} + ${doloresConsumo.tokensCacheLeitura}), 0)`.mapWith(Number),
    saida: sql<number>`coalesce(sum(${doloresConsumo.tokensSaida}), 0)`.mapWith(Number),
  }).from(doloresConsumo).where(eq(doloresConsumo.mes, mes));
  return { entrada: Number(r?.entrada ?? 0), saida: Number(r?.saida ?? 0) };
}

export type UsoDaChamada = { entrada: number; saida: number; cacheEscrita: number; cacheLeitura: number };

/**
 * Uma linha por chamada ao modelo. Falha ao gravar não derruba a resposta, mas vai para o log. Devolve se gravou: a
 * classificação de grupo falha fechado quando não gravou (QA r3 N7); a conversa do dono só registra.
 */
export async function registrarConsumo(c: { mes: string; mensagemId: number | null; modelo: string; volta: number; uso: UsoDaChamada; parada: string | null }): Promise<boolean> {
  try {
    await getDb().insert(doloresConsumo).values({
      mes: c.mes, mensagemId: c.mensagemId, modelo: c.modelo.slice(0, 120), volta: c.volta,
      tokensEntrada: c.uso.entrada, tokensSaida: c.uso.saida, tokensCacheEscrita: c.uso.cacheEscrita, tokensCacheLeitura: c.uso.cacheLeitura,
      parada: c.parada?.slice(0, 30) ?? null,
    });
    return true;
  } catch (e) {
    console.error("[dolores/consumo] falha ao registrar o consumo", erroParaLog(e));
    return false;
  }
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
  return getDb().transaction(async tx => {
    await tx.execute(sql`SELECT ${doloresWhatsappConfig.id} FROM ${doloresWhatsappConfig} WHERE ${doloresWhatsappConfig.id} = 1 FOR UPDATE`);
    const agora = new Date();
    const [usado] = await tx.select({
      entrada: sql<number>`coalesce(sum(${doloresConsumo.tokensEntrada} + ${doloresConsumo.tokensCacheEscrita} + ${doloresConsumo.tokensCacheLeitura}), 0)`.mapWith(Number),
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
    if (reservado) {
      reservado.entrada = Number(reservado.entrada ?? 0) + grupos.entrada + marcacoes.entrada + atendimentos.entrada;
      reservado.saida = Number(reservado.saida ?? 0) + grupos.saida + marcacoes.saida + atendimentos.saida;
    }
    // QA r2 N3: só o uso REAL decide "limite atingido". Se o que bloqueia é a reserva de OUTRO pedido em andamento, o motivo
    // é próprio ("outro_pedido": tente de novo em um minuto) e o aviso único do mês não é gasto.
    const real = bloqueioDoLimite({ entrada: Number(usado?.entrada ?? 0), saida: Number(usado?.saida ?? 0) }, p.limites);
    if (real) return real;
    const comReservas = bloqueioDoLimite({
      entrada: Number(usado?.entrada ?? 0) + Number(reservado?.entrada ?? 0), saida: Number(usado?.saida ?? 0) + Number(reservado?.saida ?? 0),
    }, p.limites);
    if (comReservas) return "outro_pedido" as const;
    await tx.update(doloresMensagens).set({
      reservaEntrada: Math.max(0, Math.round(p.reserva.entrada)), reservaSaida: Math.max(0, Math.round(p.reserva.saida)),
      reservaAte: new Date(agora.getTime() + p.validadeMs),
    }).where(eq(doloresMensagens.id, p.mensagemId));
    return null;
  });
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
  return getDb().transaction(async tx => {
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
      entrada: sql<number>`coalesce(sum(${doloresConsumo.tokensEntrada} + ${doloresConsumo.tokensCacheEscrita} + ${doloresConsumo.tokensCacheLeitura}), 0)`.mapWith(Number),
      saida: sql<number>`coalesce(sum(${doloresConsumo.tokensSaida}), 0)`.mapWith(Number),
    }).from(doloresConsumo).where(eq(doloresConsumo.mes, p.mes));
    const real = bloqueioDoLimite({ entrada: Number(usado?.entrada ?? 0), saida: Number(usado?.saida ?? 0) }, p.limites);
    if (real) return real;
    const [comandos] = await tx.select({
      entrada: sql<number>`coalesce(sum(${doloresMensagens.reservaEntrada}), 0)`.mapWith(Number),
      saida: sql<number>`coalesce(sum(${doloresMensagens.reservaSaida}), 0)`.mapWith(Number),
    }).from(doloresMensagens).where(gt(doloresMensagens.reservaAte, agora));
    const teto = { entrada: Math.floor(p.limites.entrada * FRACAO_DO_LIMITE_PARA_CLASSIFICACAO), saida: Math.floor(p.limites.saida * FRACAO_DO_LIMITE_PARA_CLASSIFICACAO) };
    const total = {
      entrada: Number(usado?.entrada ?? 0) + Number(comandos?.entrada ?? 0) + p.reserva.entrada,
      saida: Number(usado?.saida ?? 0) + Number(comandos?.saida ?? 0) + p.reserva.saida,
    };
    if (total.entrada > teto.entrada || total.saida > teto.saida) return "folga_do_dono";
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

/** E4b — orçamento PRÓPRIO das respostas em grupo: % do limite mensal (como o da classificação, mas separado). */
export const ORCAMENTO_MARCACAO_PCT = 10;
/** E4b — prefixo de `dolores_consumo.parada` das chamadas das respostas em grupo (o uso delas no mês sai daí). */
export const PARADA_GRUPO = "grupo";

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
  return getDb().transaction(async tx => {
    await tx.execute(sql`SELECT ${doloresWhatsappConfig.id} FROM ${doloresWhatsappConfig} WHERE ${doloresWhatsappConfig.id} = 1 FOR UPDATE`);
    const agora = new Date();
    const classificacoes = await reservasDasClassificacoes(tx, agora, null);
    const outras = await reservasDasMarcacoes(tx, agora, p.marcacaoId);
    const clientes = await reservasDosAtendimentos(tx, agora, null);
    if (classificacoes.entrada > 0 || classificacoes.saida > 0 || outras.entrada > 0 || outras.saida > 0 || clientes.entrada > 0 || clientes.saida > 0) return "outra_chamada";
    const [usado] = await tx.select({
      entrada: sql<number>`coalesce(sum(${doloresConsumo.tokensEntrada} + ${doloresConsumo.tokensCacheEscrita} + ${doloresConsumo.tokensCacheLeitura}), 0)`.mapWith(Number),
      saida: sql<number>`coalesce(sum(${doloresConsumo.tokensSaida}), 0)`.mapWith(Number),
    }).from(doloresConsumo).where(eq(doloresConsumo.mes, p.mes));
    const real = bloqueioDoLimite({ entrada: Number(usado?.entrada ?? 0), saida: Number(usado?.saida ?? 0) }, p.limites);
    if (real) return real;
    const [comandos] = await tx.select({
      entrada: sql<number>`coalesce(sum(${doloresMensagens.reservaEntrada}), 0)`.mapWith(Number),
      saida: sql<number>`coalesce(sum(${doloresMensagens.reservaSaida}), 0)`.mapWith(Number),
    }).from(doloresMensagens).where(gt(doloresMensagens.reservaAte, agora));
    const teto = { entrada: Math.floor(p.limites.entrada * FRACAO_DO_LIMITE_PARA_CLASSIFICACAO), saida: Math.floor(p.limites.saida * FRACAO_DO_LIMITE_PARA_CLASSIFICACAO) };
    const total = {
      entrada: Number(usado?.entrada ?? 0) + Number(comandos?.entrada ?? 0) + p.reserva.entrada,
      saida: Number(usado?.saida ?? 0) + Number(comandos?.saida ?? 0) + p.reserva.saida,
    };
    if (total.entrada > teto.entrada || total.saida > teto.saida) return "folga_do_dono";
    const [doGrupo] = await tx.select({
      entrada: sql<number>`coalesce(sum(${doloresConsumo.tokensEntrada} + ${doloresConsumo.tokensCacheEscrita} + ${doloresConsumo.tokensCacheLeitura}), 0)`.mapWith(Number),
      saida: sql<number>`coalesce(sum(${doloresConsumo.tokensSaida}), 0)`.mapWith(Number),
    }).from(doloresConsumo).where(and(eq(doloresConsumo.mes, p.mes), sql`${doloresConsumo.parada} LIKE ${PARADA_GRUPO + "%"}`));
    const orcamento = { entrada: Math.floor((p.limites.entrada * ORCAMENTO_MARCACAO_PCT) / 100), saida: Math.floor((p.limites.saida * ORCAMENTO_MARCACAO_PCT) / 100) };
    if (Number(doGrupo?.entrada ?? 0) + p.reserva.entrada > orcamento.entrada || Number(doGrupo?.saida ?? 0) + p.reserva.saida > orcamento.saida) return "orcamento_marcacao";
    await tx.update(doloresMarcacoes).set({
      reservaEntrada: Math.max(0, Math.round(p.reserva.entrada)), reservaSaida: Math.max(0, Math.round(p.reserva.saida)),
      reservaAte: new Date(agora.getTime() + p.validadeMs),
    }).where(eq(doloresMarcacoes.id, p.marcacaoId));
    return null;
  });
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

/** E9 — orçamento PRÓPRIO das respostas a clientes cadastrados: % do limite mensal (separado do dos grupos). */
export const ORCAMENTO_ATENDIMENTO_PCT = 10;
/** E9 — prefixo de `dolores_consumo.parada` das chamadas das respostas a clientes (o uso delas no mês sai daí). */
export const PARADA_CLIENTE = "cliente";

export type BloqueioDoAtendimento = "sem_limite" | "limite_mensal" | "folga_do_dono" | "orcamento_atendimento" | "outra_chamada";

/**
 * E9 — reserva do limite mensal para UMA chamada do laço de resposta a cliente, com a MESMA trava e as mesmas regras da resposta
 * em grupo (reservarMarcacao), na ordem: 1) UMA chamada de IA de terceiros por vez (classificação, marcação ou outro atendimento
 * com reserva válida → "outra_chamada"); 2) uso real do mês: limite atingido; 3) folga do dono; 4) orçamento próprio
 * (ORCAMENTO_ATENDIMENTO_PCT% do limite, pelo uso com `parada` "cliente…"). A reserva fica no atendimento e vence sozinha.
 */
export async function reservarAtendimento(p: { mes: string; atendimentoId: number; limites: Limites; reserva: Uso; validadeMs: number }): Promise<BloqueioDoAtendimento | null> {
  return getDb().transaction(async tx => {
    await tx.execute(sql`SELECT ${doloresWhatsappConfig.id} FROM ${doloresWhatsappConfig} WHERE ${doloresWhatsappConfig.id} = 1 FOR UPDATE`);
    const agora = new Date();
    const classificacoes = await reservasDasClassificacoes(tx, agora, null);
    const marcacoes = await reservasDasMarcacoes(tx, agora, null);
    const outros = await reservasDosAtendimentos(tx, agora, p.atendimentoId);
    if ([classificacoes, marcacoes, outros].some(u => u.entrada > 0 || u.saida > 0)) return "outra_chamada";
    const [usado] = await tx.select({
      entrada: sql<number>`coalesce(sum(${doloresConsumo.tokensEntrada} + ${doloresConsumo.tokensCacheEscrita} + ${doloresConsumo.tokensCacheLeitura}), 0)`.mapWith(Number),
      saida: sql<number>`coalesce(sum(${doloresConsumo.tokensSaida}), 0)`.mapWith(Number),
    }).from(doloresConsumo).where(eq(doloresConsumo.mes, p.mes));
    const real = bloqueioDoLimite({ entrada: Number(usado?.entrada ?? 0), saida: Number(usado?.saida ?? 0) }, p.limites);
    if (real) return real;
    const [comandos] = await tx.select({
      entrada: sql<number>`coalesce(sum(${doloresMensagens.reservaEntrada}), 0)`.mapWith(Number),
      saida: sql<number>`coalesce(sum(${doloresMensagens.reservaSaida}), 0)`.mapWith(Number),
    }).from(doloresMensagens).where(gt(doloresMensagens.reservaAte, agora));
    const teto = { entrada: Math.floor(p.limites.entrada * FRACAO_DO_LIMITE_PARA_CLASSIFICACAO), saida: Math.floor(p.limites.saida * FRACAO_DO_LIMITE_PARA_CLASSIFICACAO) };
    if (Number(usado?.entrada ?? 0) + Number(comandos?.entrada ?? 0) + p.reserva.entrada > teto.entrada
      || Number(usado?.saida ?? 0) + Number(comandos?.saida ?? 0) + p.reserva.saida > teto.saida) return "folga_do_dono";
    const [doCliente] = await tx.select({
      entrada: sql<number>`coalesce(sum(${doloresConsumo.tokensEntrada} + ${doloresConsumo.tokensCacheEscrita} + ${doloresConsumo.tokensCacheLeitura}), 0)`.mapWith(Number),
      saida: sql<number>`coalesce(sum(${doloresConsumo.tokensSaida}), 0)`.mapWith(Number),
    }).from(doloresConsumo).where(and(eq(doloresConsumo.mes, p.mes), sql`${doloresConsumo.parada} LIKE ${PARADA_CLIENTE + "%"}`));
    const orcamento = { entrada: Math.floor((p.limites.entrada * ORCAMENTO_ATENDIMENTO_PCT) / 100), saida: Math.floor((p.limites.saida * ORCAMENTO_ATENDIMENTO_PCT) / 100) };
    if (Number(doCliente?.entrada ?? 0) + p.reserva.entrada > orcamento.entrada || Number(doCliente?.saida ?? 0) + p.reserva.saida > orcamento.saida) return "orcamento_atendimento";
    await tx.update(doloresAtendimentos).set({
      reservaEntrada: Math.max(0, Math.round(p.reserva.entrada)), reservaSaida: Math.max(0, Math.round(p.reserva.saida)),
      reservaAte: new Date(agora.getTime() + p.validadeMs),
    }).where(eq(doloresAtendimentos.id, p.atendimentoId));
    return null;
  });
}

/** Solta a reserva da resposta a cliente. Falha só vai para o log: a reserva vence sozinha. */
export async function liberarReservaAtendimento(atendimentoId: number) {
  try {
    await getDb().update(doloresAtendimentos).set({ reservaEntrada: 0, reservaSaida: 0, reservaAte: null }).where(eq(doloresAtendimentos.id, atendimentoId));
  } catch (e) {
    console.error("[dolores/consumo] falha ao liberar a reserva da resposta a cliente", e instanceof Error ? e.name : "erro");
  }
}
