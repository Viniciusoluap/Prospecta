// EPIC-025 (Dolores, etapa 3) — fila de aprovação (`dolores_aprovacoes`). Um item nasce só de uma função de nível "fila"
// chamada pela porta da ponte (comando do dono no WhatsApp); guarda a função, os argumentos JÁ validados, o resumo
// montado pelo sistema e um código curto. A decisão vem do dono — mensagem com "aprovar CÓDIGO"/"recusar CÓDIGO"
// reconhecida por código (shared/dolores/fila.ts) — ou da tela do administrador (papel admin). O modelo não tem
// ferramenta de aprovação. Aprovado: reivindicação atômica (aguardando → executando numa só instrução: aprovação dupla
// ou simultânea executa uma vez), revalidação completa na hora e resultado gravado; vencido não executa; execução
// interrompida vira "erro" e não é refeita (o gatilho do banco impede voltar de um estado encerrado).
import { randomInt } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { doloresAprovacoes, doloresAutoria, doloresFilaConfig, type DoloresAprovacao } from "../../drizzle/schema-dolores-fila.js";
import {
  EXECUCAO_VENCIDA_MS, ROTULO_SITUACAO, VALIDADE_PADRAO_HORAS, codigoValido, gerarCodigo, textoDeDado, type SituacaoItem,
} from "../../shared/dolores/fila.js";
import { limitarResposta } from "../../shared/dolores/formato.js";
import { sanitizarResposta, sanitizarTexto } from "../../shared/dolores/sanitizar.js";
import { getDb } from "../db.js";
import { acaoPorNome } from "./acoes/registro.js";
import { RecusaAcao, type ContextoAcao, type Preparo, type ResultadoAcao } from "./acoes/comum.js";
import { registrarAcao } from "./auditoria.js";
import { lerPausa } from "./consumo.js";
import { erroParaLog } from "./erro-seguro.js";
import { funcaoLiberada } from "./permissoes.js";
import { DoloresDesativada, usuarioDolores } from "./perfil.js";

export type Via = "whatsapp" | "tela";

/** Validade dos itens (horas) — dolores_fila_config; sem a linha (migração não aplicada) vale o padrão. */
export async function lerValidadeHoras(): Promise<number> {
  try {
    const [c] = await getDb().select({ h: doloresFilaConfig.validadeHoras }).from(doloresFilaConfig).where(eq(doloresFilaConfig.id, 1)).limit(1);
    return c?.h ?? VALIDADE_PADRAO_HORAS;
  } catch { return VALIDADE_PADRAO_HORAS; }
}

let sorteio: () => number = () => randomInt(0, 1_000_000) / 1_000_000;
/** Só para testes: o sorteio do código (sem argumento, volta ao aleatório seguro). */
export function definirSorteioCodigo(f?: () => number) { sorteio = f ?? (() => randomInt(0, 1_000_000) / 1_000_000); }

export type ItemCriado = { codigo: string; resumo: string; venceEm: Date; jaAguardava: boolean };

/**
 * Põe na fila o que a função preparou. O mesmo pedido (função + alvo) já aguardando não duplica: devolve o código
 * existente. Colisão de código → sorteia de novo (até 6 vezes).
 */
export async function porNaFila(funcao: string, preparo: Preparo, ctx: ContextoAcao): Promise<ItemCriado[]> {
  const horas = await lerValidadeHoras();
  const venceEm = new Date(ctx.agora.getTime() + horas * 3_600_000);
  const criados: ItemCriado[] = [];
  for (const item of preparo.itens) {
    let feito: ItemCriado | null = null;
    for (let tentativa = 0; tentativa < 6 && !feito; tentativa++) {
      const codigo = gerarCodigo(sorteio);
      const [linha] = await getDb().insert(doloresAprovacoes).values({
        codigo, venceEm, criadoEm: ctx.agora, mensagemId: ctx.mensagemId, pedidoId: ctx.pedidoId?.slice(0, 120) ?? null, autorUserId: ctx.autorId,
        funcao, alvo: item.alvo.slice(0, 80), argumentos: item.argumentos, resumo: sanitizarTexto(item.resumo).slice(0, 600),
      }).onConflictDoNothing().returning({ codigo: doloresAprovacoes.codigo, resumo: doloresAprovacoes.resumo, venceEm: doloresAprovacoes.venceEm });
      if (linha) { feito = { ...linha, jaAguardava: false }; break; }
      const [existente] = await getDb().select({ codigo: doloresAprovacoes.codigo, resumo: doloresAprovacoes.resumo, venceEm: doloresAprovacoes.venceEm })
        .from(doloresAprovacoes).where(and(eq(doloresAprovacoes.funcao, funcao), eq(doloresAprovacoes.alvo, item.alvo.slice(0, 80)), eq(doloresAprovacoes.situacao, "aguardando"))).limit(1);
      if (existente) feito = { ...existente, jaAguardava: true };
    }
    if (!feito) throw new Error("não foi possível sortear um código livre para o item da fila");
    criados.push(feito);
  }
  return criados;
}

/**
 * Manutenção barata, feita antes de listar ou decidir: item aguardando com prazo vencido → "vencida"; item "executando"
 * há mais de 3 min (a função parou no meio) → "erro", sem refazer.
 */
export async function vencerItens(agora: Date): Promise<number> {
  const vencidos = await getDb().update(doloresAprovacoes)
    .set({ situacao: "vencida", decididoEm: agora, decididoVia: "sistema", motivo: "prazo de aprovação vencido; nada foi feito" })
    .where(and(eq(doloresAprovacoes.situacao, "aguardando"), lte(doloresAprovacoes.venceEm, agora))).returning({ id: doloresAprovacoes.id });
  const interrompidos = await getDb().update(doloresAprovacoes)
    .set({ situacao: "erro", executadoEm: agora, motivo: "execução interrompida (a função parou); NÃO foi refeita — confira no sistema antes de pedir de novo" })
    .where(and(eq(doloresAprovacoes.situacao, "executando"), lt(doloresAprovacoes.decididoEm, new Date(agora.getTime() - EXECUCAO_VENCIDA_MS))))
    .returning({ id: doloresAprovacoes.id });
  return vencidos.length + interrompidos.length;
}

export type ResultadoDecisao = { codigo: string; ok: boolean; situacao: SituacaoItem | "inexistente" | "bloqueada"; texto: string };

type Decisor = { via: Via; userId: number | null; agora: Date; motivo?: string | null;
  /** Prazo (ms do `relogio`) até quando ainda dá para executar mais um item (WhatsApp: 60 s da Vercel). */
  prazoFinal?: number; relogio?: () => number; mensagemId?: number | null };

/** Tempo mínimo restante para COMEÇAR a executar um item (WhatsApp: prazo da Vercel). Ações leves: 6 s. */
const MINIMO_PARA_EXECUTAR_MS = 6_000;
/**
 * Por função, quando precisa de mais: a PCI (planilha + PDF + gravação + duas cópias ao Drive) só começa com 30 s.
 * Sem esse tempo, o item NÃO começa e continua aguardando.
 */
export const MINIMO_POR_FUNCAO_MS: Readonly<Record<string, number>> = { gerar_documento: 30_000 };
/** Funções pesadas: no máximo uma por mensagem de decisão (as outras continuam aguardando, com aviso). */
const PESADAS = new Set(["gerar_documento"]);
export const minimoParaExecutar = (funcao: string | null | undefined) => (funcao ? MINIMO_POR_FUNCAO_MS[funcao] : undefined) ?? MINIMO_PARA_EXECUTAR_MS;

async function explicar(codigo: string, agora: Date): Promise<ResultadoDecisao> {
  const [i] = await getDb().select({ situacao: doloresAprovacoes.situacao, venceEm: doloresAprovacoes.venceEm }).from(doloresAprovacoes).where(eq(doloresAprovacoes.codigo, codigo)).limit(1);
  if (!i) return { codigo, ok: false, situacao: "inexistente", texto: `[${codigo}] não existe na fila.` };
  if (i.situacao === "aguardando" && i.venceEm <= agora) return { codigo, ok: false, situacao: "vencida", texto: `[${codigo}] venceu; nada foi feito. Peça de novo se ainda quiser.` };
  return { codigo, ok: false, situacao: i.situacao, texto: `[${codigo}] já está ${ROTULO_SITUACAO[i.situacao]}; nada foi feito agora.` };
}

/** Recusa: aguardando → recusada (uma instrução). Vale mesmo com a Dolores pausada (recusar não faz nada no sistema). */
async function recusarUm(codigo: string, d: Decisor, autor: number | null): Promise<ResultadoDecisao> {
  const [i] = await getDb().update(doloresAprovacoes)
    .set({ situacao: "recusada", decididoEm: d.agora, decididoVia: d.via, decididoPorUserId: d.userId, motivo: d.motivo ? sanitizarTexto(d.motivo).slice(0, 300) : "recusado pelo dono" })
    .where(and(eq(doloresAprovacoes.codigo, codigo), eq(doloresAprovacoes.situacao, "aguardando"))).returning();
  if (!i) return explicar(codigo, d.agora);
  await registrarAcao({ funcao: i.funcao, argumentos: i.argumentos, resultado: "recusada", motivo: `item ${codigo} recusado pelo dono (${d.via})`,
    autorUserId: autor, canal: d.via, pedidoId: `fila:${codigo}`, resumo: { aprovacao: codigo, decisao: "recusar" } });
  return { codigo, ok: true, situacao: "recusada", texto: `[${codigo}] recusado; nada foi feito.` };
}

async function finalizar(id: number, situacao: "executada" | "erro", agora: Date, dados: { motivo?: string | null; resultado?: unknown }) {
  await getDb().update(doloresAprovacoes).set({ situacao, executadoEm: agora, motivo: dados.motivo?.slice(0, 300) ?? null, resultado: dados.resultado ?? null })
    .where(and(eq(doloresAprovacoes.id, id), eq(doloresAprovacoes.situacao, "executando")));
}

/** Aprovação: reivindica (aguardando e no prazo → executando), revalida e executa UMA vez. */
async function aprovarUm(codigo: string, d: Decisor, autor: number): Promise<ResultadoDecisao> {
  const [item] = await getDb().update(doloresAprovacoes)
    .set({ situacao: "executando", decididoEm: d.agora, decididoVia: d.via, decididoPorUserId: d.userId })
    .where(and(eq(doloresAprovacoes.codigo, codigo), eq(doloresAprovacoes.situacao, "aguardando"), sql`${doloresAprovacoes.venceEm} > ${d.agora}`))
    .returning();
  if (!item) return explicar(codigo, d.agora);
  const inicio = Date.now();
  const auditar = (resultado: "ok" | "recusada" | "erro", motivo: string | null, resumo: Record<string, unknown>) =>
    registrarAcao({ funcao: item.funcao, argumentos: item.argumentos, resultado, motivo, autorUserId: autor, canal: d.via, pedidoId: `fila:${codigo}`,
      duracaoMs: Date.now() - inicio, resumo: { aprovacao: codigo, decisao: "aprovar", ...resumo } });
  const fn = acaoPorNome(item.funcao);
  // revalidação: a função continua liberada e sabe executar um item aprovado (as de fila e as diretas que foram para a
  // fila pela regra de contaminação), e os argumentos guardados passam de novo pelo zod
  if (!fn || !fn.executarAprovado || !fn.entradaAprovada || !funcaoLiberada(item.funcao)) {
    await finalizar(item.id, "erro", d.agora, { motivo: "função não liberada na etapa atual; nada foi feito" });
    await auditar("recusada", "função não liberada na etapa atual", {});
    return { codigo, ok: false, situacao: "erro", texto: `[${codigo}] não pode ser executado: a função não está liberada. Nada foi feito.` };
  }
  const args = fn.entradaAprovada.safeParse(item.argumentos);
  if (!args.success) {
    await finalizar(item.id, "erro", d.agora, { motivo: "argumentos guardados inválidos; nada foi feito" });
    await auditar("recusada", "argumentos guardados inválidos", {});
    return { codigo, ok: false, situacao: "erro", texto: `[${codigo}] tem dados inválidos e não foi executado.` };
  }
  const relogio = d.relogio ?? Date.now;
  const ctx: ContextoAcao = { agora: d.agora, autorId: autor, mensagemId: item.mensagemId, pedidoId: `fila:${codigo}`, aprovacaoId: item.id,
    ...(d.prazoFinal !== undefined ? { tempoRestanteMs: () => d.prazoFinal! - relogio() } : {}) };
  let r: ResultadoAcao;
  try {
    r = await fn.executarAprovado(args.data as never, ctx);
  } catch (e) {
    const motivo = e instanceof RecusaAcao ? sanitizarTexto(e.message).slice(0, 300) : `falha: ${erroParaLog(e)}`;
    if (!(e instanceof RecusaAcao)) console.error("[dolores/fila] falha ao executar item aprovado", item.funcao, erroParaLog(e));
    await finalizar(item.id, "erro", d.agora, { motivo });
    await auditar(e instanceof RecusaAcao ? "recusada" : "erro", motivo, {});
    return { codigo, ok: false, situacao: "erro", texto: `[${codigo}] não foi executado: ${motivo}` };
  }
  // Daqui em diante a ação JÁ ACONTECEU: nenhuma falha de registro pode virar "não foi executado" (achado 3 do QA).
  const feitos = (r.feitos ?? ["executado"]).map(f => textoDeDado(f, 300));
  const extra = textoParaODono(item.funcao, r.dados);
  try {
    const { valor } = limitarResposta(sanitizarResposta(r.dados), 4000);
    await finalizar(item.id, "executada", d.agora, { resultado: { resumo: r.resumo, dados: valor, feitos } });
  } catch (e) {
    console.error("[dolores/fila] item executado, mas o resultado não foi gravado na fila", item.funcao, erroParaLog(e));
    await auditar("ok", "executado; falhou gravar o resultado na fila", r.resumo).catch(() => false);
    return { codigo, ok: true, situacao: "executada",
      texto: `[${codigo}] aprovado e FEITO: ${feitos.join("; ")}. Mas não consegui registrar o resultado na fila; confira no sistema antes de pedir de novo.${extra}` };
  }
  await auditar("ok", null, r.resumo).catch(() => false);
  return { codigo, ok: true, situacao: "executada", texto: `[${codigo}] aprovado e feito: ${feitos.join("; ")}.${extra}` };
}

/** Função de um item ainda aguardando (null se não existe ou já saiu de "aguardando": aprovarUm explica). */
async function funcaoAguardando(codigo: string): Promise<string | null> {
  const [i] = await getDb().select({ funcao: doloresAprovacoes.funcao }).from(doloresAprovacoes)
    .where(and(eq(doloresAprovacoes.codigo, codigo), eq(doloresAprovacoes.situacao, "aguardando"))).limit(1);
  return i?.funcao ?? null;
}

/** Texto extra devolvido ao dono (a cobrança preparada, para ele mesmo encaminhar se quiser). */
function textoParaODono(funcao: string, dados: unknown): string {
  const d = dados as { textoPreparado?: unknown } | null;
  if (funcao === "preparar_cobranca" && typeof d?.textoPreparado === "string") return `\nTexto preparado (NÃO enviado ao cliente):\n${d.textoPreparado}`;
  return "";
}

/**
 * Decide um ou mais itens pelo código. Aprovar exige a Dolores sem pausa e a usuária ativa (a execução é dela);
 * recusar vale sempre. Cada código é tratado sozinho (um item com erro não impede os outros).
 */
export async function decidir(codigos: readonly string[], decisao: "aprovar" | "recusar", d: Decisor): Promise<ResultadoDecisao[]> {
  try { await vencerItens(d.agora); } catch (e) { console.error("[dolores/fila] falha ao vencer itens", erroParaLog(e)); }
  let autor: number | null = null;
  if (decisao === "aprovar") {
    const pausa = await lerPausa().catch(() => null);
    const bloqueio = !pausa ? "não consegui ler a configuração da Dolores" : pausa.pausada ? "a Dolores está pausada" : null;
    if (!bloqueio) {
      try { autor = await usuarioDolores(); }
      catch (e) { return codigos.map(codigo => ({ codigo, ok: false, situacao: "bloqueada" as const, texto: `[${codigo}] não executado: ${e instanceof DoloresDesativada ? "a usuária Dolores está desativada" : "usuária Dolores indisponível"}. Nada foi feito.` })); }
    } else {
      return codigos.map(codigo => ({ codigo, ok: false, situacao: "bloqueada" as const, texto: `[${codigo}] não executado: ${bloqueio}. Nada foi feito; o item continua aguardando.` }));
    }
  } else {
    autor = await usuarioDolores().catch(() => null);
  }
  const relogio = d.relogio ?? Date.now;
  const resultados: ResultadoDecisao[] = [];
  let pesadas = 0;
  for (const codigo of codigos) {
    if (decisao === "aprovar") {
      // orçamento de tempo por função (achado 4 do QA): sem o mínimo da função, o item NÃO começa
      const funcao = await funcaoAguardando(codigo);
      if (funcao && PESADAS.has(funcao) && pesadas >= 1) {
        resultados.push({ codigo, ok: false, situacao: "aguardando", texto: `[${codigo}] continua aguardando: gero no máximo uma PCI por mensagem (leva tempo). Mande "aprovar ${codigo}" em outra mensagem.` });
        continue;
      }
      if (d.prazoFinal !== undefined && d.prazoFinal - relogio() < minimoParaExecutar(funcao)) {
        resultados.push({ codigo, ok: false, situacao: "aguardando", texto: `[${codigo}] não deu tempo de executar agora; nada foi feito e continua aguardando — mande "aprovar ${codigo}" de novo.` });
        continue;
      }
      if (funcao && PESADAS.has(funcao)) pesadas++;
    }
    try {
      resultados.push(decisao === "aprovar" ? await aprovarUm(codigo, d, autor!) : await recusarUm(codigo, d, autor));
    } catch (e) {
      // falha do banco no meio: não dá para afirmar o que aconteceu com ESTE item (os anteriores já estão na lista)
      console.error("[dolores/fila] falha ao decidir um item", erroParaLog(e));
      resultados.push({ codigo, ok: false, situacao: "erro", texto: `[${codigo}] não consegui confirmar a decisão (falha do sistema); confira na tela Integrações › Dolores antes de mandar de novo.` });
    }
  }
  return resultados;
}

/**
 * Itens que um comando do dono deixou aguardando (para o quadro determinístico da resposta), mais os que ele pediu de
 * novo e já aguardavam de outro comando (`codigos`, devolvidos pela porta) — o dono sempre recebe o código do que pediu.
 */
export async function itensAguardandoDoPedido(mensagemId: number, codigos: readonly string[] = []) {
  const extras = codigos.filter(codigoValido).slice(0, 30);
  return getDb().select({ codigo: doloresAprovacoes.codigo, resumo: doloresAprovacoes.resumo, venceEm: doloresAprovacoes.venceEm })
    .from(doloresAprovacoes).where(and(
      extras.length ? or(eq(doloresAprovacoes.mensagemId, mensagemId), inArray(doloresAprovacoes.codigo, extras)) : eq(doloresAprovacoes.mensagemId, mensagemId),
      eq(doloresAprovacoes.situacao, "aguardando")))
    .orderBy(asc(doloresAprovacoes.id)).limit(30);
}

/** O que a Dolores gravou DIRETO por este comando (tarefas, acompanhamentos), para o quadro da resposta. */
export async function feitosDoPedido(mensagemId: number) {
  const l = await getDb().select({ descricao: doloresAutoria.descricao }).from(doloresAutoria)
    .where(and(eq(doloresAutoria.mensagemId, mensagemId), isNull(doloresAutoria.aprovacaoId))).orderBy(asc(doloresAutoria.id)).limit(30);
  return l.map(x => x.descricao ?? "registro");
}

/** Quantas ações (diretas + itens na fila) um comando já gerou — teto por comando. */
export async function acoesDoPedido(mensagemId: number): Promise<number> {
  const [a] = await getDb().select({ n: sql<number>`count(*)`.mapWith(Number) }).from(doloresAutoria)
    .where(and(eq(doloresAutoria.mensagemId, mensagemId), isNull(doloresAutoria.aprovacaoId)));
  const [b] = await getDb().select({ n: sql<number>`count(*)`.mapWith(Number) }).from(doloresAprovacoes).where(eq(doloresAprovacoes.mensagemId, mensagemId));
  return Number(a?.n ?? 0) + Number(b?.n ?? 0);
}

/** Lista para a tela do administrador (aguardando primeiro). Nada de argumento cru: resumo, situação e resultado curto. */
export async function listarFila(filtro: { situacao?: SituacaoItem | "todas"; limite?: number }, agora: Date) {
  try { await vencerItens(agora); } catch (e) { console.error("[dolores/fila] falha ao vencer itens", erroParaLog(e)); }
  const onde = filtro.situacao && filtro.situacao !== "todas" ? eq(doloresAprovacoes.situacao, filtro.situacao) : undefined;
  const linhas = await getDb().select().from(doloresAprovacoes).where(onde)
    .orderBy(sql`CASE WHEN ${doloresAprovacoes.situacao} = 'aguardando' THEN 0 ELSE 1 END`, desc(doloresAprovacoes.id)).limit(Math.min(200, filtro.limite ?? 50));
  return linhas.map(paraTela);
}

export function paraTela(i: DoloresAprovacao) {
  const r = (i.resultado ?? null) as { feitos?: string[] } | null;
  return {
    id: i.id, codigo: i.codigo, funcao: i.funcao, resumo: i.resumo, situacao: i.situacao, rotuloSituacao: ROTULO_SITUACAO[i.situacao] ?? i.situacao,
    criadoEm: i.criadoEm, venceEm: i.venceEm, decididoEm: i.decididoEm, decididoVia: i.decididoVia, executadoEm: i.executadoEm,
    motivo: i.motivo, feitos: Array.isArray(r?.feitos) ? r!.feitos.slice(0, 5) : [],
  };
}

export const situacoesValidas = ["aguardando", "executando", "executada", "recusada", "vencida", "erro"] as const;
