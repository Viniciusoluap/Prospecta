// Pedido de 25/10 (LOTE C): o extrato bancário alimenta todo o BPO Financeiro.
// Cada movimentação (importada ou sincronizada) gera um lançamento pago em bpo_lancamentos,
// com vínculo 1:1 por bpo_lancamentos.bank_transaction_id (único: nunca duplica).
// Crédito → receita (Cobranças), débito → despesa (Despesas). "Transferência interna"
// não gera lançamento, então fica fora de DRE, Cobranças, Despesas e Contabilidade.
// Regras puras em shared/financeiro/bpo-extrato.ts.
import { and, desc, eq, getTableColumns, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { getDb } from "./db.js";
import { bankAccounts, bankTransactions, bpoClients, bpoLancamentos, bpoRegrasTitular, leads, type BpoRegraTitular } from "../drizzle/schema.js";
import {
  TRANSFERENCIA_INTERNA,
  categoriaValida,
  descricaoDoLancamento,
  lancamentoDaMovimentacao,
  normalizarTitular,
  saldoPorMovimentos,
  sugerirCategoria,
  sugerirClientePorTitular,
  type CategoriaBpo,
  type ClienteParaSugestao,
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
      .values(valores.slice(i, i + LOTE).map(v => ({ ...v, origemEfetiva: "extrato" })))
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
      titular: bankTransactions.titular,
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
      titular: bankTransactions.titular,
      descricaoOriginal: bankTransactions.descricaoOriginal,
      status: bankTransactions.status,
      origem: bankTransactions.origem,
      lancamentoId: bpoLancamentos.id,
    })
    .from(bankTransactions)
    .leftJoin(bpoLancamentos, eq(bpoLancamentos.bankTransactionId, bankTransactions.id))
    .where(eq(bankTransactions.accountId, accountId))
    .orderBy(desc(bankTransactions.data), desc(bankTransactions.id));
}

// ── Pedido de 25/10 (noite), itens 9 e 10: titular, regra por titular e sugestão de cliente ──

type Db = ReturnType<typeof getDb>;
export type Consulta = { execute(): Promise<unknown> } & PromiseLike<unknown>;

/** Várias atualizações numa ida ao banco (neon-http `batch`); sem `batch`, uma a uma. */
export async function executarLote(db: Db, consultas: Consulta[]) {
  const comBatch = db as unknown as { batch?: (q: Consulta[]) => Promise<unknown> };
  for (let i = 0; i < consultas.length; i += 100) {
    const parte = consultas.slice(i, i + 100);
    if (typeof comBatch.batch === "function" && parte.length > 1) await comBatch.batch(parte);
    else for (const q of parte) await q;
  }
}

export type ContextoClassificacao = { regras: Map<string, BpoRegraTitular>; clientes: ClienteParaSugestao[] };

/** Regras dos titulares informados e clientes BPO (com nome do lead) para a sugestão automática. */
export async function contextoClassificacao(titulares: (string | null | undefined)[]): Promise<ContextoClassificacao> {
  const normalizados = Array.from(new Set(titulares.map(normalizarTitular).filter(Boolean)));
  if (!normalizados.length) return { regras: new Map(), clientes: [] };
  const db = getDb();
  const regras = new Map<string, BpoRegraTitular>();
  for (let i = 0; i < normalizados.length; i += 500) {
    const r = await db.select().from(bpoRegrasTitular).where(inArray(bpoRegrasTitular.titularNormalizado, normalizados.slice(i, i + 500)));
    r.forEach(x => regras.set(x.titularNormalizado, x));
  }
  const clientes = await db
    .select({ id: bpoClients.id, razaoSocial: bpoClients.razaoSocial, nomeLead: leads.name })
    .from(bpoClients)
    .leftJoin(leads, eq(leads.id, bpoClients.leadId));
  return { regras, clientes };
}

/** Categoria e cliente de uma movimentação nova: regra do titular > categoria do provedor > sugestão. */
export function classificacaoInicial(
  m: { descricao: string; tipo: "credito" | "debito"; categoria?: string | null; titular?: string | null },
  ctx: ContextoClassificacao,
): { categoria: CategoriaBpo; bpoClienteId: number | null } {
  const regra = ctx.regras.get(normalizarTitular(m.titular));
  const categoria = categoriaValida(regra?.categoria) ?? categoriaValida(m.categoria) ?? sugerirCategoria(`${m.descricao} ${m.titular ?? ""}`, m.tipo);
  const bpoClienteId = regra?.bpoClienteId ?? sugerirClientePorTitular(m.titular, ctx.clientes);
  return { categoria, bpoClienteId };
}

/**
 * Mesma categoria e/ou cliente para várias movimentações (regra por titular), mantendo os
 * lançamentos vinculados coerentes: Transferência interna remove; demais atualizam ou criam.
 */
export async function aplicarClassificacaoEmLote(ids: number[], mudanca: { categoria?: CategoriaBpo; bpoClienteId?: number | null }) {
  if (!ids.length || (mudanca.categoria === undefined && mudanca.bpoClienteId === undefined)) return 0;
  const db = getDb();
  let total = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const parte = ids.slice(i, i + 500);
    const linhas = await db
      .select({ ...getTableColumns(bankTransactions), lancamentoId: bpoLancamentos.id })
      .from(bankTransactions)
      .leftJoin(bpoLancamentos, eq(bpoLancamentos.bankTransactionId, bankTransactions.id))
      .where(inArray(bankTransactions.id, parte));
    if (!linhas.length) continue;
    const set = {
      ...(mudanca.categoria !== undefined ? { categoria: mudanca.categoria } : {}),
      ...(mudanca.bpoClienteId !== undefined ? { bpoClienteId: mudanca.bpoClienteId } : {}),
    };
    const comLancamento = linhas.filter(l => l.lancamentoId != null).map(l => l.id);
    if (mudanca.categoria === TRANSFERENCIA_INTERNA && comLancamento.length) {
      try { await db.delete(bpoLancamentos).where(inArray(bpoLancamentos.bankTransactionId, comLancamento)); }
      catch (e) { throw erroLancamentoEmUso(e); }
    }
    await db.update(bankTransactions).set(set).where(inArray(bankTransactions.id, linhas.map(l => l.id)));
    if (mudanca.categoria !== TRANSFERENCIA_INTERNA) {
      if (comLancamento.length) {
        await db.update(bpoLancamentos).set({
          ...(mudanca.categoria !== undefined ? { categoria: mudanca.categoria } : {}),
          ...(mudanca.bpoClienteId !== undefined ? { clienteId: mudanca.bpoClienteId } : {}),
        }).where(inArray(bpoLancamentos.bankTransactionId, comLancamento));
      }
      await gerarLancamentosDoExtrato(linhas.filter(l => l.lancamentoId == null).map(l => ({ ...l, ...set })));
    }
    total += linhas.length;
  }
  return total;
}

/** Grava (ou atualiza) a regra do titular; `undefined` mantém o que a regra já tinha. */
export async function salvarRegraTitular(titular: string, mudanca: { categoria?: CategoriaBpo; bpoClienteId?: number | null }) {
  const titularNormalizado = normalizarTitular(titular);
  if (!titularNormalizado) throw new Error("Esta movimentação não tem titular para criar a regra.");
  const db = getDb();
  const [atual] = await db.select().from(bpoRegrasTitular).where(eq(bpoRegrasTitular.titularNormalizado, titularNormalizado)).limit(1);
  const valores = {
    categoria: mudanca.categoria !== undefined ? mudanca.categoria : atual?.categoria ?? null,
    bpoClienteId: mudanca.bpoClienteId !== undefined ? mudanca.bpoClienteId : atual?.bpoClienteId ?? null,
  };
  if (atual) await db.update(bpoRegrasTitular).set({ ...valores, updatedAt: new Date() }).where(eq(bpoRegrasTitular.id, atual.id));
  else await db.insert(bpoRegrasTitular).values({ titularNormalizado, ...valores }).onConflictDoNothing({ target: bpoRegrasTitular.titularNormalizado }).returning({ id: bpoRegrasTitular.id });
  return { titularNormalizado, ...valores };
}

/**
 * Classifica uma movimentação; com `aplicarATodasDoTitular`, grava a regra do titular e
 * reclassifica as demais movimentações do mesmo titular (as próximas importações seguem a regra).
 */
export async function classificarMovimentacao(
  id: number,
  mudanca: { categoria?: CategoriaBpo; bpoClienteId?: number | null; aplicarATodasDoTitular?: boolean },
) {
  const { aplicarATodasDoTitular, ...campos } = mudanca;
  const resultado = await atualizarMovimentacao(id, campos);
  if (!aplicarATodasDoTitular) return { ...resultado, regra: null, outras: 0 };
  const db = getDb();
  const [t] = await db.select({ titular: bankTransactions.titular }).from(bankTransactions).where(eq(bankTransactions.id, id)).limit(1);
  if (!normalizarTitular(t?.titular)) return { ...resultado, regra: null, outras: 0 };
  const regra = await salvarRegraTitular(t!.titular!, campos);
  const candidatas = await db
    .select({ id: bankTransactions.id, titular: bankTransactions.titular })
    .from(bankTransactions)
    .where(isNotNull(bankTransactions.titular));
  const ids = candidatas.filter(c => c.id !== id && normalizarTitular(c.titular) === regra.titularNormalizado).map(c => c.id);
  const outras = await aplicarClassificacaoEmLote(ids, campos);
  return { ...resultado, regra, outras };
}

export type MovimentoParaCompletar = { externalId: string; titular?: string | null; detalhe?: string | null; original?: string | null };

/**
 * Reimportação do mesmo arquivo: completa titular/descrição original das movimentações já
 * gravadas que estão sem eles e atualiza a descrição do lançamento vinculado
 * ("Tipo — Titular — descrição"). Se houver regra para o titular, ela é aplicada; sem regra,
 * o cliente BPO só é sugerido quando a movimentação ainda não tem cliente.
 */
export async function completarMovimentacoesExistentes(movimentos: MovimentoParaCompletar[]) {
  const comDados = movimentos.filter(m => m.titular || m.original || m.detalhe);
  if (!comDados.length) return 0;
  const db = getDb();
  const porChave = new Map(comDados.map(m => [m.externalId, m]));
  const ctx = await contextoClassificacao(comDados.map(m => m.titular));
  const consultas: Consulta[] = [];
  const porRegra = new Map<string, number[]>();
  let completadas = 0;
  const chaves = Array.from(porChave.keys());
  for (let i = 0; i < chaves.length; i += 500) {
    const existentes = await db
      .select({
        id: bankTransactions.id, externalId: bankTransactions.externalId, descricao: bankTransactions.descricao,
        titular: bankTransactions.titular, descricaoOriginal: bankTransactions.descricaoOriginal, bpoClienteId: bankTransactions.bpoClienteId,
      })
      .from(bankTransactions)
      .where(inArray(bankTransactions.externalId, chaves.slice(i, i + 500)));
    for (const t of existentes) {
      const m = t.externalId ? porChave.get(t.externalId) : undefined;
      if (!m) continue;
      const titular = t.titular || m.titular || null;
      const descricaoOriginal = t.descricaoOriginal || m.original || null;
      if (titular === t.titular && descricaoOriginal === t.descricaoOriginal) continue;
      const clienteSugerido = !t.bpoClienteId && !ctx.regras.has(normalizarTitular(titular)) ? sugerirClientePorTitular(titular, ctx.clientes) : null;
      consultas.push(db.update(bankTransactions)
        .set({ titular, descricaoOriginal, ...(clienteSugerido ? { bpoClienteId: clienteSugerido } : {}) })
        .where(eq(bankTransactions.id, t.id)) as unknown as Consulta);
      consultas.push(db.update(bpoLancamentos)
        .set({ descricao: descricaoDoLancamento({ descricao: t.descricao, titular, detalhe: m.detalhe }), ...(clienteSugerido ? { clienteId: clienteSugerido } : {}) })
        .where(eq(bpoLancamentos.bankTransactionId, t.id)) as unknown as Consulta);
      const norma = normalizarTitular(titular);
      if (norma && ctx.regras.has(norma)) porRegra.set(norma, [...(porRegra.get(norma) ?? []), t.id]);
      completadas++;
    }
  }
  await executarLote(db, consultas);
  for (const [norma, ids] of Array.from(porRegra.entries())) {
    const regra = ctx.regras.get(norma)!;
    await aplicarClassificacaoEmLote(ids, {
      ...(categoriaValida(regra.categoria) ? { categoria: categoriaValida(regra.categoria)! } : {}),
      ...(regra.bpoClienteId ? { bpoClienteId: regra.bpoClienteId } : {}),
    });
  }
  return completadas;
}

/** Lançamentos com o titular da movimentação que os gerou (abas Cobranças e Despesas). */
export async function lancamentosComTitular() {
  return getDb()
    .select({ ...getTableColumns(bpoLancamentos), titular: bankTransactions.titular })
    .from(bpoLancamentos)
    .leftJoin(bankTransactions, eq(bankTransactions.id, bpoLancamentos.bankTransactionId))
    .orderBy(desc(bpoLancamentos.vencimento));
}
