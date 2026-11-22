// EPIC-027 C5-E5 — o gasto da Dolores POR FUNÇÃO (situação do mês para a tela e o relatório) e os ALERTAS ao dono em 80% e 100%.
// Regras deste arquivo:
// - A situação usa a MESMA conta da tela (server/dolores/custo.ts#custoEstimadoDoMes) para os reais e os tokens contados no limite
//   (cache pelo peso do preço) para a trava. Sem preço completo, só os tokens contam — como antes.
// - Alerta = texto FIXO (shared/dolores/custo.ts#textoDoAlerta): sem IA, sem custo, só números e nomes de função (nunca nome de
//   cliente, telefone, CPF ou texto de mensagem). Vai SÓ ao número do dono, pela porta de sempre (whatsapp.ts#enviarAvisoAoDono:
//   pausa geral, conexão e filtros de saída).
// - UMA vez por mês por limite (mês, alvo, nível): a chave primária de dolores_gasto_alertas faz a idempotência sob concorrência —
//   INSERT … ON CONFLICT DO NOTHING, e só quem inseriu envia. Envio que falhou devolve a vaga (tenta de novo na próxima chamada).
// - Sem a migração 0148, não há alerta (não há como garantir "uma vez"); a divisão padrão continua valendo nas reservas.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { doloresGastoAlertas } from "../../drizzle/schema-dolores-operacao.js";
import {
  NIVEIS_ALERTA, alertasDevidos, custoDoMes, situacaoDoGasto, textoDoAlerta, type AlvoAlerta, type FuncaoDoConsumo, type NivelAlerta, type PartesDoGasto,
  type SituacaoDoGasto,
} from "../../shared/dolores/custo.js";
import { TETO_DONO_REAIS } from "../../shared/dolores/operacao.js";
import { getDb } from "../db.js";
import { lerConfigWhatsapp, lerPartesDoGasto } from "./consumo.js";
import { consumoDoMesDetalhado, lerPrecos, type PrecosCadastrados } from "./custo.js";
import { erroParaLog } from "./erro-seguro.js";
import { lerConfigOperacao } from "./operacao.js";

export type EnvioDoAlerta = (texto: string, ctx: { funcao: string; pedidoId: string; autor: number | null; prazoFinal: number; canal: "whatsapp" | "tela" | "cron"; resumo: Record<string, unknown> }) => Promise<{ ok: boolean; motivo: string | null }>;

let envioDeTeste: EnvioDoAlerta | null = null;
/** Só para testes: troca o envio ao dono (null volta ao de verdade). */
export function definirEnvioDosAlertas(f: EnvioDoAlerta | null) { envioDeTeste = f; }
async function envio(): Promise<EnvioDoAlerta> {
  if (envioDeTeste) return envioDeTeste;
  const { enviarAvisoAoDono } = await import("./whatsapp.js");
  return enviarAvisoAoDono;
}
/** Prazo do envio de um alerta (ele sai no meio de outra rotina: curto). */
const PRAZO_ALERTA_MS = 8_000;

export type GastoPorFuncao = { mes: string; partes: PartesDoGasto; partesDisponiveis: boolean; situacao: SituacaoDoGasto; limites: { entrada: number; saida: number } };

/** Situação do mês por função (tela, relatório e alertas usam esta mesma conta). */
export async function gastoPorFuncaoDoMes(mes: string, o: { precos?: PrecosCadastrados; limites?: { entrada: number; saida: number } } = {}): Promise<GastoPorFuncao> {
  const [linhas, precos, cfgOp, partes, limites] = await Promise.all([
    consumoDoMesDetalhado(mes), o.precos ? Promise.resolve(o.precos) : lerPrecos(), lerConfigOperacao(), lerPartesDoGasto(),
    o.limites ? Promise.resolve(o.limites) : lerConfigWhatsapp().then(c => ({ entrada: c?.limiteMensalTokensEntrada ?? 0, saida: c?.limiteMensalTokensSaida ?? 0 })),
  ]);
  const reserva = { entradaMilhao: cfgOp?.precoEntradaMilhao ?? null, saidaMilhao: cfgOp?.precoSaidaMilhao ?? null };
  const custo = custoDoMes(linhas, precos.tabela, reserva, precos.cotacao);
  return { mes, partes: partes.partes, partesDisponiveis: partes.disponivel, limites, situacao: situacaoDoGasto({ linhas, custo, limites, partes: partes.partes, tetoReais: TETO_DONO_REAIS }) };
}

async function tabelaDosAlertas(): Promise<boolean> {
  const r = await getDb().execute(sql`SELECT to_regclass('public.dolores_gasto_alertas') IS NOT NULL AS existe`);
  return (r as unknown as { rows: Array<{ existe: boolean }> }).rows[0]?.existe === true;
}

/** Alertas já registrados no mês (para a tela). Sem a 0148 → `disponivel: false`. */
export async function alertasDoMes(mes: string): Promise<{ disponivel: boolean; alertas: Array<{ alvo: AlvoAlerta; nivel: NivelAlerta; criadoEm: string; enviado: boolean }> }> {
  try {
    if (!(await tabelaDosAlertas())) return { disponivel: false, alertas: [] };
    const r = await getDb().select().from(doloresGastoAlertas).where(eq(doloresGastoAlertas.mes, mes));
    return { disponivel: true, alertas: r.map(a => ({ alvo: a.alvo as AlvoAlerta, nivel: a.nivel as NivelAlerta, criadoEm: a.criadoEm.toISOString(), enviado: a.enviadoEm !== null })) };
  } catch (e) {
    console.error("[dolores/operacao-gasto] falha ao ler os alertas", erroParaLog(e));
    return { disponivel: false, alertas: [] };
  }
}

/** Reserva a vaga do alerta (mês, alvo, nível): true só para quem inseriu agora. */
async function reservarVaga(mes: string, alvo: AlvoAlerta, nivel: NivelAlerta): Promise<boolean> {
  const r = await getDb().insert(doloresGastoAlertas).values({ mes, alvo, nivel }).onConflictDoNothing().returning({ alvo: doloresGastoAlertas.alvo });
  return r.length > 0;
}
const devolverVaga = (mes: string, alvo: AlvoAlerta, nivel: NivelAlerta) =>
  getDb().delete(doloresGastoAlertas).where(and(eq(doloresGastoAlertas.mes, mes), eq(doloresGastoAlertas.alvo, alvo), eq(doloresGastoAlertas.nivel, nivel), isNull(doloresGastoAlertas.enviadoEm)));

/**
 * Confere se o gasto do mês cruzou 80% ou 100% (do total ou da parte de uma função) e avisa o dono UMA vez por limite. Chamado
 * depois de cada consumo registrado e quando uma reserva é barrada pela parte/limite (`bloqueadas`, `totalBloqueado`). Nunca lança.
 * Devolve os alertas enviados agora (para os testes e o registro).
 */
export async function conferirAlertasDoGasto(mes: string, o: { bloqueadas?: readonly FuncaoDoConsumo[]; totalBloqueado?: boolean } = {}): Promise<Array<{ alvo: AlvoAlerta; nivel: NivelAlerta }>> {
  const enviados: Array<{ alvo: AlvoAlerta; nivel: NivelAlerta }> = [];
  try {
    if (!(await tabelaDosAlertas())) return enviados;
    const jaSaiu = new Set((await getDb().select({ alvo: doloresGastoAlertas.alvo, nivel: doloresGastoAlertas.nivel }).from(doloresGastoAlertas)
      .where(eq(doloresGastoAlertas.mes, mes))).map(a => `${a.alvo}:${a.nivel}`));
    // nada a conferir se todos os alertas possíveis do mês já saíram (barato: sem ler consumo e preços)
    if (jaSaiu.size >= 6 * NIVEIS_ALERTA.length) return enviados;
    const g = await gastoPorFuncaoDoMes(mes);
    // EPIC-027 C5-E4: o tipo de aviso "gasto" silenciado pelo dono segura só o alerta de 80% (o de 100% — a função parou — sai sempre)
    const silenciado = await import("./avisos.js").then(m => m.tipoSilenciado("gasto")).catch(() => false);
    const devidos = alertasDevidos(g.situacao, o).filter(a => !jaSaiu.has(`${a.alvo}:${a.nivel}`) && !(silenciado && a.nivel === 80));
    if (!devidos.length) return enviados;
    const enviar = await envio();
    for (const a of devidos) {
      if (!(await reservarVaga(mes, a.alvo, a.nivel))) continue; // outra rotina pegou esta vaga ao mesmo tempo
      // com 100% devido, o de 80% do mesmo alvo vai junto (uma mensagem só): reserva a vaga dele também, sem enviar outro texto
      const junto = a.nivel === 100 && !jaSaiu.has(`${a.alvo}:80`) ? await reservarVaga(mes, a.alvo, 80) : false;
      let ok = false;
      try {
        const r = await enviar(textoDoAlerta(a, g.situacao, mes), { funcao: "gasto_alerta", pedidoId: `gasto:${mes}:${a.alvo}:${a.nivel}`, autor: null,
          prazoFinal: Date.now() + PRAZO_ALERTA_MS, canal: "whatsapp", resumo: { mes, alvo: a.alvo, nivel: a.nivel } });
        ok = r.ok;
      } catch (e) {
        console.error("[dolores/operacao-gasto] falha ao enviar o alerta", erroParaLog(e));
      }
      if (ok) {
        await getDb().update(doloresGastoAlertas).set({ enviadoEm: new Date() })
          .where(and(eq(doloresGastoAlertas.mes, mes), eq(doloresGastoAlertas.alvo, a.alvo), inArray(doloresGastoAlertas.nivel, junto ? [a.nivel, 80] : [a.nivel])));
        enviados.push(a);
      } else {
        // não saiu (pausa, desconectada, falha): devolve a vaga — o alerta é conferido de novo na próxima chamada
        await devolverVaga(mes, a.alvo, a.nivel).catch(() => undefined);
        if (junto) await devolverVaga(mes, a.alvo, 80).catch(() => undefined);
      }
    }
  } catch (e) {
    console.error("[dolores/operacao-gasto] falha ao conferir os alertas de gasto", erroParaLog(e));
  }
  return enviados;
}
