// Lote 3, item 16 (29/10/2026): seleção em lote em Cobranças/Despesas — "Excluir", "Excluir tudo"
// (aba inteira, no servidor, respeitando os filtros) e "Combinar pagamentos". Registros protegidos
// (Asaas, extrato, baixa, obra, regularização, combinação) nunca são apagados. Toda exclusão grava
// backup JSON recuperável (bpo_lancamento_exclusoes_backup) e histórico por lançamento, em transação.
// Gêmeo no Santa Fé: web/src/lib/actions/bpo-lote.ts.
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, ne, sql, getTableColumns } from "drizzle-orm";
import { getDb } from "./db.js";
import { bpoClients, bpoLancamentoExclusoesBackup, bpoLancamentoHistorico, bpoLancamentos } from "../drizzle/schema.js";
import {
  CONFIRMACAO_EXCLUSAO, confirmacaoExclusaoValida, filtrarLancamentosLote, resumirExclusao, validarCombinacao,
  type FiltrosLote,
} from "../shared/financeiro/bpo-lote.js";

export type AbaLote = "cobrancas" | "despesas";
export type EntradaLote = { aba: AbaLote; modo: "selecionados" | "tudo"; ids?: number[]; filtros?: FiltrosLote; limpezaAjustes?: boolean; previaToken?: string };
type Executor = Pick<ReturnType<typeof getDb>, "select">;

const contagem = (q: ReturnType<typeof sql>) => sql<number>`(${q})::int`;

function consultaAba(d: Executor, aba: AbaLote, ids?: number[]) {
  const l = bpoLancamentos;
  const filtros = [isNull(l.exclusaoLoteBackupId), isNull(l.combinadaEmId), aba === "despesas" ? eq(l.tipo, "despesa") : ne(l.tipo, "despesa")];
  if (ids) filtros.push(inArray(l.id, ids.length ? ids : [0]));
  return d.select({
    ...getTableColumns(l),
    clienteNome: sql<string | null>`coalesce(${bpoClients.razaoSocial}, ${l.clienteNomeLivre})`,
    baixas: contagem(sql`SELECT count(*) FROM bpo_recebimentos r WHERE r.lancamento_id = ${l.id}`),
    movimentosObra: contagem(sql`SELECT count(*) FROM obra_movimentos om WHERE om.bpo_lancamento_id = ${l.id}`),
    recebimentosRegularizacao: contagem(sql`SELECT count(*) FROM regularizacao_recebimentos rr WHERE rr.bpo_lancamento_id = ${l.id}`),
    combinadas: contagem(sql`SELECT count(*) FROM bpo_lancamentos c WHERE c.combinada_em_id = ${l.id}`),
  }).from(l).leftJoin(bpoClients, eq(bpoClients.id, l.clienteId)).where(and(...filtros));
}

type Linha = Awaited<ReturnType<typeof consultaAba>>[number];
const comProtecao = (x: Linha) => ({ ...x, transacaoBancaria: x.bankTransactionId });

async function alcance(d: Executor, input: EntradaLote) {
  const todos = await consultaAba(d, input.aba);
  const base = input.modo === "tudo" ? filtrarLancamentosLote(todos, input.filtros ?? {}) : todos.filter(x => (input.ids ?? []).includes(x.id));
  return { totalAba: todos.length, ...resumirExclusao(todos.length, base.map(comProtecao), input.modo === "selecionados" ? (input.ids ?? []).length : 0, input.limpezaAjustes === true) };
}

export async function previaExclusaoLote(input: EntradaLote) {
  const { resumo, excluiveis } = await alcance(getDb(), input);
  return { ...resumo, previaToken: tokenDaPrevia(excluiveis) };
}

const tokenDaPrevia = (linhas: { id: number }[]) => createHash("sha256").update(JSON.stringify([...linhas].sort((a, b) => a.id - b.id))).digest("hex");

export async function excluirLancamentosEmLote(input: EntradaLote & { confirmacao: string }, userId: number) {
  if (!confirmacaoExclusaoValida(input.confirmacao)) throw new Error(`Digite ${CONFIRMACAO_EXCLUSAO} para confirmar a exclusão.`);
  if (input.modo === "selecionados" && !(input.ids ?? []).length) throw new Error("Selecione ao menos um lançamento.");
  return getDb().transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bpo_exclusao_lote'))`);
    let { resumo, excluiveis } = await alcance(tx, input);
    // Bloqueia as linhas alcançadas e relê o snapshot depois do lock; qualquer alteração da
    // prévia (inclusive importação nova) exige nova confirmação no modo de ajustes.
    if (input.limpezaAjustes) {
      if (excluiveis.length) await tx.execute(sql`SELECT id FROM bpo_lancamentos WHERE id IN (${sql.join(excluiveis.map(x => sql`${x.id}`), sql`, `)}) ORDER BY id FOR UPDATE`);
      ({ resumo, excluiveis } = await alcance(tx, input));
      if (!input.previaToken || input.previaToken !== tokenDaPrevia(excluiveis)) throw new Error("Os lançamentos mudaram desde a prévia. Atualize a prévia e confirme novamente.");
    }
    if (!excluiveis.length) return { ...resumo, excluidos: 0, backupId: null as number | null };
    const ids = excluiveis.map(x => x.id);
    const [backup] = await tx.insert(bpoLancamentoExclusoesBackup).values({
      modo: input.modo, aba: input.aba, filtrosJson: JSON.stringify({ ...(input.modo === "tudo" ? input.filtros ?? {} : { ids: input.ids }), ...(input.limpezaAjustes ? { limpezaAjustes: true } : {}) }),
      quantidade: ids.length, protegidos: resumo.protegidos, snapshotJson: JSON.stringify(excluiveis.map(x => input.limpezaAjustes ? { ...x, __limpezaAjustes: true } : x)), criadoPorUserId: userId,
    }).returning({ id: bpoLancamentoExclusoesBackup.id });
    await tx.insert(bpoLancamentoHistorico).values(excluiveis.map(x => ({
      lancamentoId: x.id, lancamentoReferencia: x.id, versaoAnterior: x.version, alteradoPorUserId: userId,
      motivo: `${input.limpezaAjustes ? "Limpeza local de ajustes" : "Excluído em lote"} (${input.modo === "tudo" ? "Excluir tudo" : "Excluir selecionados"}; backup #${backup.id})`,
      antesJson: JSON.stringify(x), depoisJson: JSON.stringify({ excluido: true, backupId: backup.id }),
    })));
    if (input.limpezaAjustes) {
      const alterados = await tx.update(bpoLancamentos).set({ exclusaoLoteBackupId: backup.id, version: sql`${bpoLancamentos.version} + 1`, updatedAt: new Date() })
        .where(and(inArray(bpoLancamentos.id, ids), isNull(bpoLancamentos.exclusaoLoteBackupId))).returning({ id: bpoLancamentos.id });
      if (alterados.length !== ids.length) throw new Error("Algum lançamento mudou durante a confirmação. Atualize a prévia e tente novamente.");
      return { ...resumo, excluidos: alterados.length, backupId: backup.id };
    }
    // Revalida a proteção no próprio DELETE: se algo mudou desde a leitura, nada é apagado.
    const apagados = await tx.delete(bpoLancamentos).where(and(
      inArray(bpoLancamentos.id, ids), isNull(bpoLancamentos.exclusaoLoteBackupId),
      isNull(bpoLancamentos.asaasPaymentId), isNull(bpoLancamentos.bankTransactionId), isNull(bpoLancamentos.combinadaEmId),
      eq(bpoLancamentos.pago, false), sql`${bpoLancamentos.valorRecebido} = 0`,
      sql`NOT EXISTS (SELECT 1 FROM bpo_recebimentos r WHERE r.lancamento_id = ${bpoLancamentos.id})`,
      sql`NOT EXISTS (SELECT 1 FROM obra_movimentos om WHERE om.bpo_lancamento_id = ${bpoLancamentos.id})`,
      sql`NOT EXISTS (SELECT 1 FROM regularizacao_recebimentos rr WHERE rr.bpo_lancamento_id = ${bpoLancamentos.id})`,
      sql`NOT EXISTS (SELECT 1 FROM bpo_lancamentos c WHERE c.combinada_em_id = ${bpoLancamentos.id})`,
    )).returning({ id: bpoLancamentos.id });
    if (apagados.length !== ids.length) throw new Error("Algum lançamento mudou durante a confirmação. Atualize a prévia e tente novamente.");
    return { ...resumo, excluidos: apagados.length, backupId: backup.id };
  });
}

async function cobrancasParaCombinar(d: Executor, ids: number[]) {
  const linhas = await consultaAba(d, "cobrancas", ids);
  return linhas.map(x => ({ ...comProtecao(x), valor: x.valor, vencimento: x.vencimento }));
}

export async function previaCombinacao(ids: number[]) {
  const linhas = await cobrancasParaCombinar(getDb(), ids);
  if (linhas.length !== ids.length) return { ok: false as const, erros: ["Alguma cobrança não está mais disponível (excluída, combinada ou é despesa)."], bloqueados: [] };
  return validarCombinacao(linhas);
}

/** Cria a cobrança combinada e marca as originais (combinada_em_id), sem apagar nada. */
export async function combinarPagamentos(input: { ids: number[]; requestKey: string }, userId: number) {
  return getDb().transaction(async tx => {
    const linhas = await cobrancasParaCombinar(tx, input.ids);
    if (linhas.length !== input.ids.length) throw new Error("Alguma cobrança não está mais disponível (excluída, combinada ou é despesa).");
    const r = validarCombinacao(linhas);
    if (!r.ok) throw new Error([...r.erros, ...r.bloqueados.map(b => `#${b.id}: ${b.motivo}`)].join(" "));
    const [nova] = await tx.insert(bpoLancamentos).values({
      clienteId: r.clienteId as number | null, clienteNomeLivre: r.clienteNomeLivre,
      tipo: r.tipo as typeof bpoLancamentos.$inferInsert.tipo, descricao: r.descricao, valor: r.total.toFixed(2),
      vencimento: r.vencimento, competencia: r.competencia, categoria: r.categoria,
      categoriaOperacional: r.categoriaOperacional, vinculoOperacionalId: r.vinculoOperacionalId,
      vinculoOperacionalRotulo: r.vinculoOperacionalId ? linhas[0].vinculoOperacionalRotulo : null,
      requestKey: input.requestKey, origemEfetiva: "manual",
    }).returning();
    for (const o of linhas) {
      const [depois] = await tx.update(bpoLancamentos)
        .set({ combinadaEmId: nova.id, version: o.version + 1, updatedAt: new Date() })
        .where(and(eq(bpoLancamentos.id, o.id), eq(bpoLancamentos.version, o.version), isNull(bpoLancamentos.combinadaEmId), isNull(bpoLancamentos.exclusaoLoteBackupId))).returning();
      if (!depois) throw new Error("Uma das cobranças foi alterada por outra pessoa. Atualize a tela.");
      await tx.insert(bpoLancamentoHistorico).values({
        lancamentoId: o.id, lancamentoReferencia: o.id, versaoAnterior: o.version, alteradoPorUserId: userId,
        motivo: `Combinada na cobrança #${nova.id} (combinar pagamentos)`, antesJson: JSON.stringify(o), depoisJson: JSON.stringify(depois),
      });
    }
    return { novaId: nova.id, total: r.total, vencimento: r.vencimento, combinadas: linhas.length };
  });
}
