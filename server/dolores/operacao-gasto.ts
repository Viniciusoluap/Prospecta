// EPIC-027 C5-E5 — o gasto da Dolores POR FUNÇÃO (situação do mês para a tela e o relatório) e os ALERTAS ao dono em 80% e 100%.
// Regras deste arquivo:
// - A situação usa a MESMA conta da tela (server/dolores/custo.ts#custoEstimadoDoMes) para os reais e os tokens contados no limite
//   (cache pelo peso do preço) para a trava. Sem preço completo, só os tokens contam — como antes.
// - Alerta = texto FIXO (shared/dolores/custo.ts#textoDoAlerta): sem IA, sem custo, só números e nomes de função (nunca nome de
//   cliente, telefone, CPF ou texto de mensagem). Vai SÓ ao número do dono, pela porta de sempre (whatsapp.ts#enviarAvisoAoDono:
//   pausa geral, conexão e filtros de saída).
// - UMA vez por mês por limite (mês, alvo, nível): a chave primária de dolores_gasto_alertas faz a idempotência sob concorrência —
//   INSERT … ON CONFLICT DO NOTHING (a vaga).
// - QA C5 (achado B1) — registrar e enviar são DOIS passos. O registro (`registrarAlertasDevidos`) roda na hora em que o consumo é
//   gravado ou a reserva é barrada: só toma a vaga, PENDENTE (`enviado_em` vazio), sem mandar nada — nunca come o prazo de quem está
//   no meio do laço. O envio (`enviarAlertasPendentes`) roda DEPOIS da resposta principal (fim do aviso do WhatsApp) e no cron,
//   dentro do prazo de quem chamou. Para mandar, a rotina TOMA o alerta (UPDATE condicional `enviado_em` vazio → agora): duas
//   rotinas ao mesmo tempo nunca mandam o mesmo alerta. Envio que com certeza não saiu (pausa, desconectada, sem tempo: `tentou`
//   = false) volta a pendente; envio tentado que deu erro (pode ter chegado) conta uma TENTATIVA (registrada na auditoria) e é
//   refeito no máximo UMA vez — o dono recebe o mesmo alerta no máximo duas vezes, nunca em laço.
// - QA C5 (achado B2) — enquanto houver uma proposta aberta e confirmável na conversa do dono, o alerta ESPERA (fica pendente; sai
//   quando a proposta for decidida/vencer, no fim do próximo aviso ou no cron): ele nunca tira a proposta "de ordem" (o "pode" do
//   dono continua confirmando). A regra fica num ponto só: pendencia.ts#podeEnviarAvisoAgora.
// - Sem a migração 0148, não há alerta (não há como garantir "uma vez"); a divisão padrão continua valendo nas reservas.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { doloresAcoes } from "../../drizzle/schema-dolores.js";
import { doloresGastoAlertas } from "../../drizzle/schema-dolores-operacao.js";
import {
  NIVEIS_ALERTA, alertasDevidos, custoDoMes, situacaoDoGasto, textoDoAlerta, type AlvoAlerta, type FuncaoDoConsumo, type NivelAlerta, type PartesDoGasto,
  type SituacaoDoGasto,
} from "../../shared/dolores/custo.js";
import { TETO_DONO_REAIS } from "../../shared/dolores/operacao.js";
import { mesFortaleza } from "../../shared/dolores/whatsapp.js";
import { getDb } from "../db.js";
import { lerConfigWhatsapp, lerPartesDoGasto } from "./consumo.js";
import { consumoDoMesDetalhado, lerPrecos, type PrecosCadastrados } from "./custo.js";
import { erroParaLog } from "./erro-seguro.js";
import { registrarAcao } from "./auditoria.js";
import { lerConfigOperacao } from "./operacao.js";
import { podeEnviarAvisoAgora } from "./pendencia.js";

export type EnvioDoAlerta = (texto: string, ctx: { funcao: string; pedidoId: string; autor: number | null; prazoFinal: number; canal: "whatsapp" | "tela" | "cron"; resumo: Record<string, unknown> }) => Promise<{ ok: boolean; motivo: string | null;
  /** false = com certeza nada saiu (recusado antes do envio: pausa, desconectada, sem tempo). Sem o campo = pode ter saído. */
  tentou?: boolean }>;

let envioDeTeste: EnvioDoAlerta | null = null;
/** Só para testes: troca o envio ao dono (null volta ao de verdade). */
export function definirEnvioDosAlertas(f: EnvioDoAlerta | null) { envioDeTeste = f; }
async function envio(): Promise<EnvioDoAlerta> {
  if (envioDeTeste) return envioDeTeste;
  const { enviarAvisoAoDono } = await import("./whatsapp.js");
  return enviarAvisoAoDono;
}
/** Prazo máximo do envio de um alerta (curto), nunca além do prazo de quem chamou. */
const PRAZO_ALERTA_MS = 8_000;
/** Abaixo disto do prazo de quem chamou, nenhum alerta é tentado (fica pendente para o próximo aviso ou o cron). */
export const MINIMO_PARA_ALERTA_MS = 3_000;
/** Envios TENTADOS que deram erro (podem ter chegado): a 1ª e no máximo mais uma. */
export const MAX_TENTATIVAS_DO_ALERTA = 2;

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

/** Toma a vaga do alerta (mês, alvo, nível), PENDENTE: true só para quem inseriu agora. */
async function reservarVaga(mes: string, alvo: AlvoAlerta, nivel: NivelAlerta): Promise<boolean> {
  const r = await getDb().insert(doloresGastoAlertas).values({ mes, alvo, nivel }).onConflictDoNothing().returning({ alvo: doloresGastoAlertas.alvo });
  return r.length > 0;
}

/**
 * QA C5 (B1) — confere se o gasto do mês cruzou 80% ou 100% (do total ou da parte de uma função) e REGISTRA o alerta pendente, UMA
 * vez por limite. Não envia nada (o envio é `enviarAlertasPendentes`, depois da resposta principal). Chamado depois de cada consumo
 * registrado e quando uma reserva é barrada pela parte/limite (`bloqueadas`, `totalBloqueado`). Nunca lança. Devolve os registrados agora.
 */
export async function registrarAlertasDevidos(mes: string, o: { bloqueadas?: readonly FuncaoDoConsumo[]; totalBloqueado?: boolean } = {}): Promise<Array<{ alvo: AlvoAlerta; nivel: NivelAlerta }>> {
  const novos: Array<{ alvo: AlvoAlerta; nivel: NivelAlerta }> = [];
  try {
    if (!(await tabelaDosAlertas())) return novos;
    const jaTem = new Set((await getDb().select({ alvo: doloresGastoAlertas.alvo, nivel: doloresGastoAlertas.nivel }).from(doloresGastoAlertas)
      .where(eq(doloresGastoAlertas.mes, mes))).map(a => `${a.alvo}:${a.nivel}`));
    // nada a conferir se todos os alertas possíveis do mês já foram registrados (barato: sem ler consumo e preços)
    if (jaTem.size >= 6 * NIVEIS_ALERTA.length) return novos;
    const g = await gastoPorFuncaoDoMes(mes);
    for (const a of alertasDevidos(g.situacao, o).filter(a => !jaTem.has(`${a.alvo}:${a.nivel}`))) {
      if (!(await reservarVaga(mes, a.alvo, a.nivel))) continue; // outra rotina registrou ao mesmo tempo
      novos.push(a);
      // com 100% devido, o de 80% do mesmo alvo fica registrado também: no envio, os dois saem numa mensagem só
      if (a.nivel === 100 && !jaTem.has(`${a.alvo}:80`)) await reservarVaga(mes, a.alvo, 80);
    }
  } catch (e) {
    console.error("[dolores/operacao-gasto] falha ao registrar os alertas de gasto", erroParaLog(e));
  }
  return novos;
}

const pedidoDoAlerta = (mes: string, alvo: string, nivel: number) => `gasto:${mes}:${alvo}:${nivel}`;
/** A marca de cada envio TENTADO que deu erro fica na auditoria, com um pedidoId próprio (sem texto nem número). */
const pedidoDaTentativa = (mes: string, alvo: string, nivel: number) => `${pedidoDoAlerta(mes, alvo, nivel)}:tentativa`;

/** Quantas tentativas com erro este alerta já teve. Falha ao ler → null (quem chama não envia: lado seguro, nunca duplica). */
async function tentativasComErro(mes: string, alvo: string, nivel: number): Promise<number | null> {
  try {
    const [r] = await getDb().select({ n: sql<number>`count(*)`.mapWith(Number) }).from(doloresAcoes)
      .where(and(eq(doloresAcoes.funcao, "gasto_alerta"), eq(doloresAcoes.pedidoId, pedidoDaTentativa(mes, alvo, nivel))));
    return Number(r?.n ?? 0);
  } catch (e) {
    console.error("[dolores/operacao-gasto] falha ao contar as tentativas do alerta", erroParaLog(e));
    return null;
  }
}

/** Toma o envio (pendente → enviado agora). Devolve os níveis tomados por ESTA rotina. */
async function tomarEnvio(mes: string, alvo: string, niveis: NivelAlerta[]): Promise<NivelAlerta[]> {
  const r = await getDb().update(doloresGastoAlertas).set({ enviadoEm: new Date() })
    .where(and(eq(doloresGastoAlertas.mes, mes), eq(doloresGastoAlertas.alvo, alvo), inArray(doloresGastoAlertas.nivel, niveis), isNull(doloresGastoAlertas.enviadoEm)))
    .returning({ nivel: doloresGastoAlertas.nivel });
  return r.map(x => x.nivel as NivelAlerta);
}
/** Volta a pendente (o envio não saiu). */
const devolverAPendente = (mes: string, alvo: string, niveis: NivelAlerta[]) =>
  getDb().update(doloresGastoAlertas).set({ enviadoEm: null })
    .where(and(eq(doloresGastoAlertas.mes, mes), eq(doloresGastoAlertas.alvo, alvo), inArray(doloresGastoAlertas.nivel, niveis)));

/**
 * QA C5 (B1/B2) — envia os alertas PENDENTES do mês ao dono, dentro do prazo de quem chamou. Chamado depois da resposta principal
 * (fim do aviso do WhatsApp) e no cron. Com uma proposta aberta e confirmável na conversa do dono, não envia nada (espera:
 * pendencia.ts#podeEnviarAvisoAgora). Nunca lança. Devolve os alertas enviados agora.
 */
export async function enviarAlertasPendentes(p: { prazoFinal: number; canal: "whatsapp" | "tela" | "cron"; mes?: string; agora?: Date; relogio?: () => number }): Promise<Array<{ alvo: AlvoAlerta; nivel: NivelAlerta }>> {
  const enviados: Array<{ alvo: AlvoAlerta; nivel: NivelAlerta }> = [];
  const ms = p.relogio ?? Date.now;
  try {
    if (p.prazoFinal - ms() < MINIMO_PARA_ALERTA_MS) return enviados;
    if (!(await tabelaDosAlertas())) return enviados;
    const agora = p.agora ?? new Date();
    const mes = p.mes ?? mesFortaleza(agora);
    const pendentes = await getDb().select({ alvo: doloresGastoAlertas.alvo, nivel: doloresGastoAlertas.nivel }).from(doloresGastoAlertas)
      .where(and(eq(doloresGastoAlertas.mes, mes), isNull(doloresGastoAlertas.enviadoEm)));
    if (!pendentes.length) return enviados;
    const porAlvo = new Map<AlvoAlerta, NivelAlerta[]>();
    for (const a of pendentes) porAlvo.set(a.alvo as AlvoAlerta, [...(porAlvo.get(a.alvo as AlvoAlerta) ?? []), a.nivel as NivelAlerta]);
    let g: GastoPorFuncao | null = null;
    let enviar: EnvioDoAlerta | null = null;
    for (const [alvo, niveis] of Array.from(porAlvo.entries())) {
      if (p.prazoFinal - ms() < MINIMO_PARA_ALERTA_MS) break; // sem tempo: fica pendente
      // B2: proposta aberta e confirmável → espera (conferido a cada alerta: uma proposta pode ter nascido no meio)
      if (!(await podeEnviarAvisoAgora(agora))) break;
      // com 100% pendente, sai só o texto de 100% (o de 80% pendente vai junto, numa mensagem só)
      const nivel: NivelAlerta = niveis.includes(100) ? 100 : 80;
      const tentativas = await tentativasComErro(mes, alvo, nivel);
      if (tentativas === null || tentativas >= MAX_TENTATIVAS_DO_ALERTA) continue; // já tentou o bastante: fica registrado como não enviado
      const tomados = await tomarEnvio(mes, alvo, nivel === 100 ? niveis : [80]);
      if (!tomados.includes(nivel)) { if (tomados.length) await devolverAPendente(mes, alvo, tomados).catch(() => undefined); continue; } // outra rotina pegou
      g ??= await gastoPorFuncaoDoMes(mes);
      enviar ??= await envio();
      let r: Awaited<ReturnType<EnvioDoAlerta>>;
      try {
        r = await enviar(textoDoAlerta({ alvo, nivel }, g.situacao, mes), { funcao: "gasto_alerta", pedidoId: pedidoDoAlerta(mes, alvo, nivel), autor: null,
          prazoFinal: Math.min(p.prazoFinal, ms() + PRAZO_ALERTA_MS), canal: p.canal, resumo: { mes, alvo, nivel } });
      } catch (e) {
        console.error("[dolores/operacao-gasto] falha ao enviar o alerta", erroParaLog(e));
        r = { ok: false, motivo: "falha no envio", tentou: true };
      }
      if (r.ok) {
        enviados.push({ alvo, nivel });
        // o texto de 100% cobre o de 80% do mesmo alvo: se ele ainda estava pendente (outra rotina), sai junto
        if (nivel === 100) await tomarEnvio(mes, alvo, [80]).catch(() => undefined);
        continue;
      }
      if (r.tentou === false) {
        // com certeza não saiu (pausa, desconectada, sem tempo): volta a pendente, sem contar tentativa
        await devolverAPendente(mes, alvo, tomados).catch(() => undefined);
        continue;
      }
      // tentado e com erro: pode ter chegado. Conta a tentativa; sem conseguir contar, o alerta fica como enviado (nunca duplica).
      const marcou = await registrarAcao({ funcao: "gasto_alerta", resultado: "erro", motivo: "envio do alerta sem confirmação: no máximo mais uma tentativa",
        autorUserId: null, canal: p.canal, pedidoId: pedidoDaTentativa(mes, alvo, nivel), resumo: { mes, alvo, nivel, tentativa: tentativas + 1 } });
      if (marcou) await devolverAPendente(mes, alvo, tomados).catch(() => undefined);
    }
  } catch (e) {
    console.error("[dolores/operacao-gasto] falha ao enviar os alertas de gasto", erroParaLog(e));
  }
  return enviados;
}

/**
 * Registra (B1) e, em seguida, tenta enviar os alertas pendentes do mês, com prazo curto próprio. Para quem NÃO está no meio de
 * outra rotina (tela, testes). O laço da IA nunca chama isto: lá só se registra (consumo.ts).
 */
export async function conferirAlertasDoGasto(mes: string, o: { bloqueadas?: readonly FuncaoDoConsumo[]; totalBloqueado?: boolean } = {},
  p: { prazoFinal?: number; canal?: "whatsapp" | "tela" | "cron" } = {}): Promise<Array<{ alvo: AlvoAlerta; nivel: NivelAlerta }>> {
  await registrarAlertasDevidos(mes, o);
  return enviarAlertasPendentes({ mes, prazoFinal: p.prazoFinal ?? Date.now() + PRAZO_ALERTA_MS, canal: p.canal ?? "whatsapp" });
}
