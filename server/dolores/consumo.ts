// EPIC-025 (Dolores, etapa 2) — configuração do WhatsApp da Dolores e consumo da IA (dolores_whatsapp_config,
// dolores_consumo). O limite mensal é em tokens (entrada e saída separados, porque têm preços diferentes): o sistema não
// sabe o preço do modelo e não o inventa; o admin converte o teto em reais para tokens (docs/dolores/como-ligar.md).
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { doloresConfig } from "../../drizzle/schema-dolores.js";
import { doloresConsumo, doloresWhatsappConfig, type DoloresWhatsappConfig } from "../../drizzle/schema-dolores-whatsapp.js";
import type { Uso } from "../../shared/dolores/whatsapp.js";
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
