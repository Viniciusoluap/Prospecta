// Pedido de 12/11 (noite): aba "A classificar" do BPO Financeiro.
// - Movimentações do banco sem correspondência segura (bank_transactions.a_classificar): o usuário cria o
//   lançamento (categoria, cliente BPO), marca como transferência interna/ignora, ou dá baixa/divide.
// - Lançamentos em aberto a classificar (bpo_lancamentos.a_classificar, ex.: em aberto do Conta Azul): o usuário
//   confirma (vão para Cobranças/Despesas), registra o pagamento ou cancela (arquivamento reversível em bpo-lote.ts).
// Regras puras em shared/financeiro/bpo-a-classificar.ts.
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "./db.js";
import { bankAccounts, bankTransactions, bpoClients, bpoLancamentoHistorico, bpoLancamentos } from "../drizzle/schema.js";
import { aplicarClassificacaoEmLote } from "./bpo-extrato.js";
import { TRANSFERENCIA_INTERNA, type CategoriaBpo } from "../shared/financeiro/bpo-extrato.js";
import { sugestoesDeBaixa } from "../shared/financeiro/bpo-a-classificar.js";

const clienteNome = sql<string | null>`coalesce(${bpoClients.razaoSocial}, ${bpoLancamentos.clienteNomeLivre})`;

/** Quantos itens esperam o usuário (rótulo da aba). */
export async function contagemAClassificar() {
  const d = getDb();
  const [[m], [l]] = await Promise.all([
    d.select({ n: sql<number>`count(*)::int` }).from(bankTransactions).where(eq(bankTransactions.aClassificar, true)),
    d.select({ n: sql<number>`count(*)::int` }).from(bpoLancamentos)
      .where(and(eq(bpoLancamentos.aClassificar, true), isNull(bpoLancamentos.exclusaoLoteBackupId), isNull(bpoLancamentos.combinadaEmId))),
  ]);
  const movimentacoes = Number(m?.n ?? 0), lancamentos = Number(l?.n ?? 0);
  return { movimentacoes, lancamentos, total: movimentacoes + lancamentos };
}

/** Movimentações do banco "A classificar", com a conta. */
export async function movimentacoesAClassificar() {
  return getDb()
    .select({
      id: bankTransactions.id, data: bankTransactions.data, descricao: bankTransactions.descricao, valor: bankTransactions.valor,
      tipo: bankTransactions.tipo, categoria: bankTransactions.categoria, titular: bankTransactions.titular,
      bpoClienteId: bankTransactions.bpoClienteId, descricaoOriginal: bankTransactions.descricaoOriginal,
      contaId: bankAccounts.id, conta: sql<string>`concat_ws(' · ', ${bankAccounts.banco}, nullif(${bankAccounts.conta}, '—'))`,
    })
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.accountId))
    .where(eq(bankTransactions.aClassificar, true))
    .orderBy(desc(bankTransactions.data), desc(bankTransactions.id));
}

/** Lançamentos em aberto "A classificar" (fora de Cobranças, Despesas e DRE). */
export async function lancamentosAClassificar() {
  return getDb()
    .select({
      id: bpoLancamentos.id, tipo: bpoLancamentos.tipo, descricao: bpoLancamentos.descricao, valor: bpoLancamentos.valor,
      valorRecebido: bpoLancamentos.valorRecebido, vencimento: bpoLancamentos.vencimento, competencia: bpoLancamentos.competencia,
      pago: bpoLancamentos.pago, categoria: bpoLancamentos.categoria, centroCustos: bpoLancamentos.centroCustos,
      clienteId: bpoLancamentos.clienteId, clienteNomeLivre: bpoLancamentos.clienteNomeLivre, clienteNome,
      origemEfetiva: bpoLancamentos.origemEfetiva, observacoes: bpoLancamentos.observacoes, version: bpoLancamentos.version,
      asaasPaymentId: bpoLancamentos.asaasPaymentId, bankTransactionId: bpoLancamentos.bankTransactionId,
    })
    .from(bpoLancamentos)
    .leftJoin(bpoClients, eq(bpoClients.id, bpoLancamentos.clienteId))
    .where(and(eq(bpoLancamentos.aClassificar, true), isNull(bpoLancamentos.exclusaoLoteBackupId), isNull(bpoLancamentos.combinadaEmId)))
    .orderBy(asc(bpoLancamentos.vencimento), asc(bpoLancamentos.id));
}

/** Só as que ainda estão "A classificar" (a tela pode estar desatualizada). */
async function idsAClassificar(ids: number[]) {
  if (!ids.length) return [];
  const r = await getDb().select({ id: bankTransactions.id }).from(bankTransactions)
    .where(and(inArray(bankTransactions.id, ids), eq(bankTransactions.aClassificar, true)));
  return r.map(x => x.id);
}

/**
 * "Criar lançamento" (individual ou em lote): classificação explícita — cria o lançamento pago de cada
 * movimentação com a categoria e o cliente escolhidos e tira de "A classificar".
 */
export async function criarLancamentosDasMovimentacoes(ids: number[], escolha: { categoria: CategoriaBpo; bpoClienteId?: number | null; centroCustos?: string | null }) {
  if (escolha.categoria === TRANSFERENCIA_INTERNA) throw new Error("Use \"Transferência interna / ignorar\" para tirar a movimentação do BPO.");
  const alvo = await idsAClassificar(ids);
  if (!alvo.length) throw new Error("Nenhuma das movimentações está mais em A classificar. Atualize a tela.");
  if (escolha.bpoClienteId) {
    const [c] = await getDb().select({ id: bpoClients.id }).from(bpoClients).where(eq(bpoClients.id, escolha.bpoClienteId)).limit(1);
    if (!c) throw new Error("Cliente BPO não encontrado.");
  }
  await aplicarClassificacaoEmLote(alvo, {
    categoria: escolha.categoria,
    ...(escolha.bpoClienteId !== undefined ? { bpoClienteId: escolha.bpoClienteId } : {}),
  });
  if (escolha.centroCustos !== undefined) {
    // Só nos lançamentos criados do extrato (um lançamento do Conta Azul ligado mantém o centro de custo dele).
    await getDb().update(bpoLancamentos).set({ centroCustos: escolha.centroCustos || null })
      .where(and(inArray(bpoLancamentos.bankTransactionId, alvo), eq(bpoLancamentos.origemEfetiva, "extrato"), isNull(bpoLancamentos.exclusaoLoteBackupId)));
  }
  return { classificadas: alvo.length };
}

/** "Transferência interna / ignorar": sem lançamento e fora de "A classificar". */
export async function ignorarMovimentacoes(ids: number[]) {
  const alvo = await idsAClassificar(ids);
  if (!alvo.length) throw new Error("Nenhuma das movimentações está mais em A classificar. Atualize a tela.");
  await aplicarClassificacaoEmLote(alvo, { categoria: TRANSFERENCIA_INTERNA });
  return { ignoradas: alvo.length };
}

/** "Confirmar": o lançamento sai de "A classificar" e entra em Cobranças/Despesas (em aberto), com histórico. */
export async function confirmarLancamentos(ids: number[], userId: number) {
  if (!ids.length) throw new Error("Selecione ao menos um lançamento.");
  return getDb().transaction(async tx => {
    const linhas = await tx.select().from(bpoLancamentos)
      .where(and(inArray(bpoLancamentos.id, ids), eq(bpoLancamentos.aClassificar, true), isNull(bpoLancamentos.exclusaoLoteBackupId), isNull(bpoLancamentos.combinadaEmId)))
      .orderBy(asc(bpoLancamentos.id))
      .for("update");
    for (const l of linhas) {
      const [depois] = await tx.update(bpoLancamentos)
        .set({ aClassificar: false, version: l.version + 1, updatedAt: new Date() })
        .where(and(eq(bpoLancamentos.id, l.id), eq(bpoLancamentos.version, l.version))).returning();
      if (!depois) throw new Error("Um dos lançamentos foi alterado por outra pessoa. Atualize a tela.");
      await tx.insert(bpoLancamentoHistorico).values({
        lancamentoId: l.id, lancamentoReferencia: l.id, versaoAnterior: l.version, alteradoPorUserId: userId,
        motivo: "Confirmado na aba A classificar", antesJson: JSON.stringify(l), depoisJson: JSON.stringify(depois),
      });
    }
    return { confirmados: linhas.length };
  });
}

/** Em aberto que podem receber baixa da movimentação (mesmo sentido), com as sugestões (máx. 5) primeiro. */
export async function abertosParaBaixa(movimentacaoId: number) {
  const d = getDb();
  const [m] = await d.select().from(bankTransactions).where(eq(bankTransactions.id, movimentacaoId)).limit(1);
  if (!m) throw new Error("Movimentação não encontrada.");
  const abertos = await d.select({
    id: bpoLancamentos.id, tipo: bpoLancamentos.tipo, descricao: bpoLancamentos.descricao, valor: bpoLancamentos.valor,
    valorRecebido: bpoLancamentos.valorRecebido, vencimento: bpoLancamentos.vencimento, competencia: bpoLancamentos.competencia,
    clienteId: bpoLancamentos.clienteId, clienteNome, pago: bpoLancamentos.pago, aClassificar: bpoLancamentos.aClassificar,
    centroCustos: bpoLancamentos.centroCustos,
  }).from(bpoLancamentos)
    .leftJoin(bpoClients, eq(bpoClients.id, bpoLancamentos.clienteId))
    .where(and(
      eq(bpoLancamentos.pago, false), isNull(bpoLancamentos.exclusaoLoteBackupId), isNull(bpoLancamentos.combinadaEmId),
      isNull(bpoLancamentos.asaasPaymentId), isNull(bpoLancamentos.bankTransactionId),
      m.tipo === "debito" ? eq(bpoLancamentos.tipo, "despesa") : ne(bpoLancamentos.tipo, "despesa"),
      sql`${bpoLancamentos.valorRecebido} < ${bpoLancamentos.valor}`,
    ))
    .orderBy(asc(bpoLancamentos.vencimento), asc(bpoLancamentos.id))
    .limit(1000);
  const sugeridos = sugestoesDeBaixa(m, abertos).map(l => l.id);
  return { movimentacao: m, abertos, sugeridos };
}
