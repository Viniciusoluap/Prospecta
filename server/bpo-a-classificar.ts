// Pedido de 12/11 (noite): aba "A classificar" do BPO Financeiro.
// - Movimentações do banco sem correspondência segura (bank_transactions.a_classificar): o usuário cria o
//   lançamento (categoria, cliente BPO), marca como transferência interna/ignora, ou dá baixa/divide.
// - Lançamentos em aberto a classificar (bpo_lancamentos.a_classificar, ex.: em aberto do Conta Azul): o usuário
//   confirma (vão para Cobranças/Despesas), registra o pagamento ou cancela (arquivamento reversível em bpo-lote.ts).
// Regras puras em shared/financeiro/bpo-a-classificar.ts.
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "./db.js";
import { bankAccounts, bankTransactions, bpoClients, bpoLancamentoHistorico, bpoLancamentos, bpoRecebimentos } from "../drizzle/schema.js";
import { aplicarClassificacaoEmLote } from "./bpo-extrato.js";
import { TRANSFERENCIA_INTERNA, type CategoriaBpo } from "../shared/financeiro/bpo-extrato.js";
import { centavosDe, chaveAlocacao, resultadoDaBaixa, sugestoesDeBaixa, validarDivisao, type Alocacao } from "../shared/financeiro/bpo-a-classificar.js";

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

// ── Bloco 2: dividir pagamentos (split) ─────────────────────────────────────────────────────────────
// Uma linha em bpo_recebimentos por alocação (bank_transaction_id + request_key "bt:<mov>:<lanc>"); o lançamento
// acumula valor_recebido e só fica pago quando recebido = valor. A movimentação não ganha lançamento próprio
// (o dinheiro já está nos lançamentos que ela quitou), então nenhuma leitura soma o mesmo dinheiro duas vezes.
// Tudo numa transação (sessão WebSocket em produção), com FOR UPDATE na movimentação e nos lançamentos.

const assinatura = (xs: { lancamentoId: number; valor: number | string }[]) =>
  xs.map(x => `${x.lancamentoId}:${centavosDe(x.valor)}`).sort().join("|");

export type ResultadoBaixa = { movimentacaoId: number; repetida: boolean; alocacoes: { lancamentoId: number; valor: string; pago: boolean; saldo: number }[] };

/** Dá baixa (total ou parcial) em um ou vários lançamentos em aberto com uma movimentação do banco. Idempotente. */
export async function darBaixaComMovimentacao(input: { movimentacaoId: number; alocacoes: Alocacao[] }, userId: number): Promise<ResultadoBaixa> {
  return getDb().transaction(async tx => {
    const [m] = await tx.select().from(bankTransactions).where(eq(bankTransactions.id, input.movimentacaoId)).for("update");
    if (!m) throw new Error("Movimentação não encontrada.");
    const anteriores = await tx.select().from(bpoRecebimentos).where(eq(bpoRecebimentos.bankTransactionId, m.id));
    if (anteriores.length) {
      // Repetir a mesma chamada (duplo clique, retry) devolve o que já foi feito; outra divisão é recusada.
      if (assinatura(anteriores) !== assinatura(input.alocacoes)) throw new Error("Esta movimentação já foi usada para dar baixa em outros lançamentos.");
      const lancs = await tx.select().from(bpoLancamentos).where(inArray(bpoLancamentos.id, anteriores.map(r => r.lancamentoId)));
      const porId = new Map(lancs.map(l => [l.id, l]));
      return {
        movimentacaoId: m.id, repetida: true,
        alocacoes: anteriores.map(r => {
          const l = porId.get(r.lancamentoId);
          return { lancamentoId: r.lancamentoId, valor: r.valor, pago: Boolean(l?.pago), saldo: l ? (centavosDe(l.valor) - centavosDe(l.valorRecebido)) / 100 : 0 };
        }),
      };
    }
    if (!m.aClassificar) throw new Error("Esta movimentação não está em A classificar (já foi classificada ou conciliada). Atualize a tela.");
    const [ligado] = await tx.select({ id: bpoLancamentos.id }).from(bpoLancamentos).where(eq(bpoLancamentos.bankTransactionId, m.id)).limit(1);
    if (ligado) throw new Error("Esta movimentação já tem um lançamento próprio.");
    const ids = Array.from(new Set(input.alocacoes.map(a => a.lancamentoId))).sort((a, b) => a - b);
    const lancs = ids.length
      ? await tx.select().from(bpoLancamentos).where(inArray(bpoLancamentos.id, ids)).orderBy(asc(bpoLancamentos.id)).for("update")
      : [];
    const erros = validarDivisao(m, input.alocacoes, lancs);
    if (erros.length) throw new Error(erros.join(" "));
    const porId = new Map(lancs.map(l => [l.id, l]));
    const resultado: ResultadoBaixa["alocacoes"] = [];
    for (const a of input.alocacoes) {
      const l = porId.get(a.lancamentoId)!;
      const valor = (Math.round(a.valor * 100) / 100).toFixed(2);
      const r = resultadoDaBaixa(l, a.valor);
      await tx.insert(bpoRecebimentos).values({
        lancamentoId: l.id, requestKey: chaveAlocacao(m.id, l.id), valor, recebidoEm: m.data, registradoPorUserId: userId,
        bankTransactionId: m.id, observacoes: `Baixa pela movimentação #${m.id} do banco (${m.descricao}).`.slice(0, 1000),
      });
      const [depois] = await tx.update(bpoLancamentos).set({
        valorRecebido: r.valorRecebido, pago: r.pago, pagoEm: r.pago ? m.data : null,
        version: l.version + 1, aClassificar: false, updatedAt: new Date(),
      }).where(and(eq(bpoLancamentos.id, l.id), eq(bpoLancamentos.version, l.version))).returning();
      if (!depois) throw new Error("Um dos lançamentos foi alterado por outra pessoa. Atualize a tela.");
      await tx.insert(bpoLancamentoHistorico).values({
        lancamentoId: l.id, lancamentoReferencia: l.id, versaoAnterior: l.version, alteradoPorUserId: userId,
        motivo: `${r.pago ? "Quitado" : "Baixa parcial"} pela movimentação #${m.id} do banco (${valor})`,
        antesJson: JSON.stringify(l), depoisJson: JSON.stringify(depois),
      });
      resultado.push({ lancamentoId: l.id, valor, pago: r.pago, saldo: r.saldo });
    }
    await tx.update(bankTransactions).set({ aClassificar: false, status: "conciliado" }).where(eq(bankTransactions.id, m.id));
    return { movimentacaoId: m.id, repetida: false, alocacoes: resultado };
  });
}
