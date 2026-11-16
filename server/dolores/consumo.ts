// EPIC-025 (Dolores, etapa 2) — configuração do WhatsApp da Dolores e consumo da IA (dolores_whatsapp_config,
// dolores_consumo). O limite mensal é em tokens (entrada e saída separados, porque têm preços diferentes): o sistema não
// sabe o preço do modelo e não o inventa; o admin converte o teto em reais para tokens (docs/dolores/como-ligar.md).
import { and, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { doloresConfig } from "../../drizzle/schema-dolores.js";
import { doloresConsumo, doloresMensagens, doloresWhatsappConfig, type DoloresWhatsappConfig } from "../../drizzle/schema-dolores-whatsapp.js";
import { bloqueioDoLimite, type Limites, type Uso } from "../../shared/dolores/whatsapp.js";
import { getDb } from "../db.js";

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
    console.error("[dolores/consumo] falha ao registrar o consumo", e instanceof Error ? e.message : String(e));
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
    const bloqueio = bloqueioDoLimite({
      entrada: Number(usado?.entrada ?? 0) + Number(reservado?.entrada ?? 0), saida: Number(usado?.saida ?? 0) + Number(reservado?.saida ?? 0),
    }, p.limites);
    if (bloqueio) return bloqueio;
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
