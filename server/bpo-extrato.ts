// Pedido de 25/10 (LOTE C): o extrato bancário alimenta todo o BPO Financeiro.
// Cada movimentação (importada ou sincronizada) gera um lançamento pago em bpo_lancamentos,
// com vínculo 1:1 por bpo_lancamentos.bank_transaction_id (único: nunca duplica).
// Crédito → receita (Cobranças), débito → despesa (Despesas). "Transferência interna"
// não gera lançamento, então fica fora de DRE, Cobranças, Despesas e Contabilidade.
// Regras puras em shared/financeiro/bpo-extrato.ts.
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { getDb } from "./db.js";
import { bankAccounts, bankTransactions, bpoClients, bpoLancamentos } from "../drizzle/schema.js";
import {
  categoriaValida,
  lancamentoDaMovimentacao,
  saldoPorMovimentos,
  sugerirCategoria,
  type CategoriaBpo,
  type MovimentoParaLancamento,
} from "../shared/financeiro/bpo-extrato.js";

const LOTE = 200;

/** Gera (sem duplicar) os lançamentos das movimentações informadas. Devolve quantos foram criados. */
export async function gerarLancamentosDoExtrato(movimentos: MovimentoParaLancamento[]): Promise<number> {
  const valores = movimentos.map(lancamentoDaMovimentacao).filter((l): l is NonNullable<typeof l> => l !== null);
  const db = getDb();
  let criados = 0;
  for (let i = 0; i < valores.length; i += LOTE) {
    const r = await db
      .insert(bpoLancamentos)
      .values(valores.slice(i, i + LOTE))
      .onConflictDoNothing({ target: bpoLancamentos.bankTransactionId })
      .returning({ id: bpoLancamentos.id });
    criados += r.length;
  }
  return criados;
}

/** Saldo = créditos − débitos de todas as movimentações da conta; grava e devolve. */
export async function recalcularSaldoConta(contaId: number): Promise<number> {
  const db = getDb();
  const movs = await db
    .select({ tipo: bankTransactions.tipo, valor: bankTransactions.valor })
    .from(bankTransactions)
    .where(eq(bankTransactions.accountId, contaId));
  const saldo = saldoPorMovimentos(movs);
  await db.update(bankAccounts).set({ saldoAtual: saldo.toFixed(2), saldoFonte: "calculado" }).where(eq(bankAccounts.id, contaId));
  return saldo;
}

export type ResultadoReprocessamento = { categorizadas: number; lancamentosCriados: number; saldosRecalculados: number };

/**
 * Backfill idempotente: categoriza as movimentações sem categoria da lista padrão, gera os
 * lançamentos que faltam e recalcula o saldo das contas de importação sem saldo de arquivo.
 * Rodar de novo não cria nada repetido.
 */
export async function reprocessarMovimentacoes(): Promise<ResultadoReprocessamento> {
  const db = getDb();
  const todas = await db
    .select({
      id: bankTransactions.id,
      data: bankTransactions.data,
      descricao: bankTransactions.descricao,
      valor: bankTransactions.valor,
      tipo: bankTransactions.tipo,
      categoria: bankTransactions.categoria,
      bpoClienteId: bankTransactions.bpoClienteId,
      lancamentoId: bpoLancamentos.id,
    })
    .from(bankTransactions)
    .leftJoin(bpoLancamentos, eq(bpoLancamentos.bankTransactionId, bankTransactions.id));

  // 1) Categoria sugerida onde não há categoria da lista padrão (uma atualização por categoria).
  const porCategoria = new Map<CategoriaBpo, number[]>();
  for (const t of todas) {
    if (categoriaValida(t.categoria)) continue;
    const c = sugerirCategoria(t.descricao, t.tipo);
    t.categoria = c;
    porCategoria.set(c, [...(porCategoria.get(c) ?? []), t.id]);
  }
  let categorizadas = 0;
  for (const [categoria, ids] of Array.from(porCategoria.entries())) {
    for (let i = 0; i < ids.length; i += 500) {
      await db.update(bankTransactions).set({ categoria }).where(inArray(bankTransactions.id, ids.slice(i, i + 500)));
    }
    categorizadas += ids.length;
  }

  // 2) Lançamentos que faltam (transferência interna não gera).
  const lancamentosCriados = await gerarLancamentosDoExtrato(todas.filter(t => t.lancamentoId == null));

  // 3) Saldo das contas de importação que ainda não têm saldo vindo de arquivo ou de API.
  const contas = await db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.ativo, true), eq(bankAccounts.provedor, "manual"), or(isNull(bankAccounts.saldoFonte), eq(bankAccounts.saldoFonte, "calculado"))));
  for (const c of contas) await recalcularSaldoConta(c.id);

  return { categorizadas, lancamentosCriados, saldosRecalculados: contas.length };
}

/** Mensagem legível quando o lançamento já foi usado em obra/regularização (FK restrict). */
function erroLancamentoEmUso(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/foreign key|violates|restrict|23503/i.test(msg)) {
    return new Error("O lançamento desta movimentação já foi usado em uma obra ou regularização. Cancele esse vínculo antes de marcar como Transferência interna.");
  }
  return e instanceof Error ? e : new Error(msg);
}

/**
 * Muda categoria e/ou Cliente BPO de uma movimentação e mantém o lançamento vinculado coerente:
 * Transferência interna remove o lançamento; voltar para outra categoria o recria.
 */
export async function atualizarMovimentacao(id: number, mudanca: { categoria?: CategoriaBpo; bpoClienteId?: number | null }) {
  const db = getDb();
  const [t] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, id)).limit(1);
  if (!t) throw new Error("Movimentação não encontrada.");
  if (mudanca.bpoClienteId) {
    const [cli] = await db.select({ id: bpoClients.id }).from(bpoClients).where(eq(bpoClients.id, mudanca.bpoClienteId)).limit(1);
    if (!cli) throw new Error("Cliente BPO não encontrado.");
  }
  const [existente] = await db
    .select({ id: bpoLancamentos.id })
    .from(bpoLancamentos)
    .where(eq(bpoLancamentos.bankTransactionId, id))
    .limit(1);
  const novo = {
    categoria: mudanca.categoria ?? categoriaValida(t.categoria) ?? sugerirCategoria(t.descricao, t.tipo),
    bpoClienteId: mudanca.bpoClienteId !== undefined ? mudanca.bpoClienteId : t.bpoClienteId,
  };
  const desejado = lancamentoDaMovimentacao({ ...t, ...novo });

  // Remove primeiro o lançamento (pode falhar se já estiver alocado) e só então grava a movimentação.
  if (!desejado && existente) {
    try { await db.delete(bpoLancamentos).where(eq(bpoLancamentos.id, existente.id)); }
    catch (e) { throw erroLancamentoEmUso(e); }
  }
  await db.update(bankTransactions).set(novo).where(eq(bankTransactions.id, id));
  if (desejado && existente) {
    await db.update(bpoLancamentos)
      .set({ categoria: desejado.categoria, clienteId: desejado.clienteId, tipo: desejado.tipo })
      .where(eq(bpoLancamentos.id, existente.id));
  } else if (desejado) {
    await gerarLancamentosDoExtrato([{ ...t, ...novo }]);
  }
  return { categoria: novo.categoria, bpoClienteId: novo.bpoClienteId ?? null, lancamento: desejado ? "vinculado" : "nenhum" };
}

/** Movimentações de uma conta com o lançamento vinculado (para a aba Bancos › Movimentações). */
export async function movimentacoesDaConta(accountId: number) {
  const db = getDb();
  return db
    .select({
      id: bankTransactions.id,
      data: bankTransactions.data,
      descricao: bankTransactions.descricao,
      valor: bankTransactions.valor,
      tipo: bankTransactions.tipo,
      categoria: bankTransactions.categoria,
      bpoClienteId: bankTransactions.bpoClienteId,
      status: bankTransactions.status,
      origem: bankTransactions.origem,
      lancamentoId: bpoLancamentos.id,
    })
    .from(bankTransactions)
    .leftJoin(bpoLancamentos, eq(bpoLancamentos.bankTransactionId, bankTransactions.id))
    .where(eq(bankTransactions.accountId, accountId))
    .orderBy(desc(bankTransactions.data), desc(bankTransactions.id));
}
