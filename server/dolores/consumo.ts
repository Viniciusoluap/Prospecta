// EPIC-025 (Dolores, etapa 2) — configuração do WhatsApp da Dolores e consumo da IA (dolores_whatsapp_config,
// dolores_consumo). O limite mensal é em tokens (entrada e saída separados, porque têm preços diferentes): o sistema não
// sabe o preço do modelo e não o inventa; o admin converte o teto em reais para tokens (docs/dolores/como-ligar.md).
import { and, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { doloresConfig } from "../../drizzle/schema-dolores.js";
import { doloresConsumo, doloresMensagens, doloresWhatsappConfig, type DoloresWhatsappConfig } from "../../drizzle/schema-dolores-whatsapp.js";
import { doloresGrupoMensagens } from "../../drizzle/schema-dolores-grupos.js";
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

/** Uma linha por chamada ao modelo. Falha ao gravar não derruba a resposta, mas vai para o log. */
export async function registrarConsumo(c: { mes: string; mensagemId: number | null; modelo: string; volta: number; uso: UsoDaChamada; parada: string | null }) {
  try {
    await getDb().insert(doloresConsumo).values({
      mes: c.mes, mensagemId: c.mensagemId, modelo: c.modelo.slice(0, 120), volta: c.volta,
      tokensEntrada: c.uso.entrada, tokensSaida: c.uso.saida, tokensCacheEscrita: c.uso.cacheEscrita, tokensCacheLeitura: c.uso.cacheLeitura,
      parada: c.parada?.slice(0, 30) ?? null,
    });
  } catch (e) {
    console.error("[dolores/consumo] falha ao registrar o consumo", erroParaLog(e));
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
    if (reservado) { reservado.entrada = Number(reservado.entrada ?? 0) + grupos.entrada; reservado.saida = Number(reservado.saida ?? 0) + grupos.saida; }
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
 * Etapa 4 — a classificação de documentos só usa até esta fração do limite mensal: o resto fica de folga para os comandos
 * do dono (a leitura de grupo nunca deixa a Dolores sem orçamento para responder a ele).
 */
export const FRACAO_DO_LIMITE_PARA_CLASSIFICACAO = 0.8;

/**
 * Etapa 4 — reserva do limite mensal para UMA classificação, com a mesma trava da etapa 2 (linha da configuração em
 * FOR UPDATE): soma o uso real do mês, as reservas dos comandos do dono e as das outras classificações, e só reserva se
 * tudo, mais esta reserva, couber em FRACAO_DO_LIMITE_PARA_CLASSIFICACAO do limite. A reserva fica na própria mensagem do
 * grupo e vence sozinha. Devolve o motivo do bloqueio ou null (reservado).
 */
export async function reservarClassificacao(p: { mes: string; mensagemGrupoId: number; limites: Limites; reserva: Uso; validadeMs: number }) {
  return getDb().transaction(async tx => {
    await tx.execute(sql`SELECT ${doloresWhatsappConfig.id} FROM ${doloresWhatsappConfig} WHERE ${doloresWhatsappConfig.id} = 1 FOR UPDATE`);
    const agora = new Date();
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
    const outras = await reservasDasClassificacoes(tx, agora, p.mensagemGrupoId);
    const teto = { entrada: Math.floor(p.limites.entrada * FRACAO_DO_LIMITE_PARA_CLASSIFICACAO), saida: Math.floor(p.limites.saida * FRACAO_DO_LIMITE_PARA_CLASSIFICACAO) };
    const total = {
      entrada: Number(usado?.entrada ?? 0) + Number(comandos?.entrada ?? 0) + outras.entrada + p.reserva.entrada,
      saida: Number(usado?.saida ?? 0) + Number(comandos?.saida ?? 0) + outras.saida + p.reserva.saida,
    };
    if (total.entrada > teto.entrada || total.saida > teto.saida) return "folga_do_dono" as const;
    await tx.update(doloresGrupoMensagens).set({
      reservaEntrada: Math.max(0, Math.round(p.reserva.entrada)), reservaSaida: Math.max(0, Math.round(p.reserva.saida)),
      reservaAte: new Date(agora.getTime() + p.validadeMs),
    }).where(eq(doloresGrupoMensagens.id, p.mensagemGrupoId));
    return null;
  });
}

/** Solta a reserva da classificação. Falha só vai para o log: a reserva vence sozinha. */
export async function liberarReservaClassificacao(mensagemGrupoId: number) {
  try {
    await getDb().update(doloresGrupoMensagens).set({ reservaEntrada: 0, reservaSaida: 0, reservaAte: null }).where(eq(doloresGrupoMensagens.id, mensagemGrupoId));
  } catch (e) {
    console.error("[dolores/consumo] falha ao liberar a reserva da classificação", e instanceof Error ? e.name : "erro");
  }
}
