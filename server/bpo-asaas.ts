// Pedido de 25/10 (noite), item 14: cobranças emitidas no Asaas → aba Cobranças do BPO.
// Roda junto com a sincronização da conta Asaas (botão Sincronizar, cron diário e webhook).
// Regras puras em shared/financeiro/bpo-asaas.ts. Nunca cria dois lançamentos para o mesmo dinheiro.
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "./db.js";
import { bankAccounts, bankTransactions, bpoClients, bpoLancamentos, leads } from "../drizzle/schema.js";
import { fetchAsaasCobrancas, type AsaasCobranca } from "./_core/asaas-extrato.js";
import {
  clienteDaCobranca,
  creditoDaCobranca,
  descricaoDaCobranca,
  lancamentoDaCobranca,
  situacaoCobrancaAsaas,
  type ClienteBpoParaCobranca,
  type CreditoCandidato,
} from "../shared/financeiro/bpo-asaas.js";
import { executarLote, type Consulta } from "./bpo-extrato.js";

export type ResultadoCobrancas = { recebidas: number; criadas: number; atualizadas: number; reconciliadas: number };

async function clientesParaCobranca(): Promise<ClienteBpoParaCobranca[]> {
  const linhas = await getDb()
    .select({ id: bpoClients.id, razaoSocial: bpoClients.razaoSocial, cpf: bpoClients.cpf, cnpj: bpoClients.cnpj, nomeLead: leads.name, cpfLead: leads.cpf })
    .from(bpoClients)
    .leftJoin(leads, eq(leads.id, bpoClients.leadId));
  return linhas.map(l => ({ id: l.id, razaoSocial: l.razaoSocial, nomeLead: l.nomeLead, documentos: [l.cpf, l.cnpj, l.cpfLead] }));
}

const dia = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Cobranças do Asaas (criadas desde `desde`) viram lançamentos de receita:
 * 1) já existe lançamento com o id do pagamento → atualiza situação, vencimento e cliente;
 * 2) o extrato do Asaas já tem o crédito desse pagamento → o lançamento do crédito vira a cobrança;
 * 3) paga e sem id no extrato → reconcilia com um crédito de mesmo valor e data próxima;
 * 4) senão → cria o lançamento (em aberto, vencido ou pago).
 */
export async function sincronizarCobrancasAsaas(apiKey: string, desde: string, fetchImpl: typeof fetch = fetch): Promise<ResultadoCobrancas> {
  const cobrancas = (await fetchAsaasCobrancas(apiKey, desde, fetchImpl)).filter(c => situacaoCobrancaAsaas(c.status) !== null);
  const resultado: ResultadoCobrancas = { recebidas: cobrancas.length, criadas: 0, atualizadas: 0, reconciliadas: 0 };
  if (!cobrancas.length) return resultado;
  const db = getDb();
  const ids = cobrancas.map(c => c.id);

  const existentes = new Map<string, typeof bpoLancamentos.$inferSelect>();
  const doExtrato = new Map<string, { bankTransactionId: number; lancamentoId: number | null }>();
  for (let i = 0; i < ids.length; i += 500) {
    const parte = ids.slice(i, i + 500);
    (await db.select().from(bpoLancamentos).where(inArray(bpoLancamentos.asaasPaymentId, parte)))
      .forEach(l => l.asaasPaymentId && existentes.set(l.asaasPaymentId, l));
    (await db.select({ pid: bankTransactions.asaasPaymentId, bankTransactionId: bankTransactions.id, lancamentoId: bpoLancamentos.id })
      .from(bankTransactions)
      .leftJoin(bpoLancamentos, eq(bpoLancamentos.bankTransactionId, bankTransactions.id))
      .where(inArray(bankTransactions.asaasPaymentId, parte)))
      .forEach(t => t.pid && doExtrato.set(t.pid, { bankTransactionId: t.bankTransactionId, lancamentoId: t.lancamentoId }));
  }
  const clientes = await clientesParaCobranca();

  // Créditos do Asaas ainda sem cobrança (só carregados se houver cobrança paga sem vínculo).
  let candidatos: (CreditoCandidato & { lancamentoId: number })[] | null = null;
  const carregarCandidatos = async () => {
    if (candidatos) return candidatos;
    const linhas = await db
      .select({ bankTransactionId: bankTransactions.id, valor: bankTransactions.valor, data: bankTransactions.data, lancamentoId: bpoLancamentos.id })
      .from(bankTransactions)
      .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.accountId))
      .innerJoin(bpoLancamentos, eq(bpoLancamentos.bankTransactionId, bankTransactions.id))
      .where(and(eq(bankAccounts.provedor, "asaas"), eq(bankTransactions.tipo, "credito"), isNull(bankTransactions.asaasPaymentId), isNull(bpoLancamentos.asaasPaymentId)));
    candidatos = linhas.filter((l): l is typeof l & { lancamentoId: number } => l.lancamentoId != null);
    return candidatos;
  };
  const usados = new Set<number>();
  const consultas: Consulta[] = [];
  const novos: ReturnType<typeof lancamentoDaCobranca>[] = [];

  for (const c of cobrancas) {
    const clienteId = clienteDaCobranca(c, clientes);
    const desejado = lancamentoDaCobranca(c, clienteId);
    const atual = existentes.get(c.id);
    if (atual) {
      const set: Partial<typeof bpoLancamentos.$inferInsert> = {};
      // Já reconciliado com o extrato: o dinheiro entrou; valor e pagamento ficam os do banco.
      if (!atual.bankTransactionId) {
        if (atual.pago !== desejado.pago) set.pago = desejado.pago;
        if (dia(atual.pagoEm) !== dia(desejado.pagoEm)) set.pagoEm = desejado.pagoEm;
        if (Number(atual.valor).toFixed(2) !== desejado.valor) set.valor = desejado.valor;
      }
      if (dia(atual.vencimento) !== dia(desejado.vencimento)) { set.vencimento = desejado.vencimento; set.competencia = desejado.competencia; }
      if (!atual.clienteId && clienteId) { set.clienteId = clienteId; set.clienteNomeLivre = null; }
      if (Object.keys(set).length) {
        consultas.push(db.update(bpoLancamentos).set(set).where(eq(bpoLancamentos.id, atual.id)) as unknown as Consulta);
        resultado.atualizadas++;
      }
      continue;
    }
    const credito = doExtrato.get(c.id);
    if (credito?.lancamentoId) {
      consultas.push(vincular(credito.lancamentoId, c, clienteId));
      resultado.reconciliadas++;
      continue;
    }
    if (credito) continue; // crédito marcado como transferência interna: não vira receita.
    if (desejado.pago) {
      const lista = await carregarCandidatos();
      const btId = creditoDaCobranca(c, lista, usados);
      const alvo = btId ? lista.find(k => k.bankTransactionId === btId) : undefined;
      if (alvo) {
        usados.add(alvo.bankTransactionId);
        consultas.push(vincular(alvo.lancamentoId, c, clienteId));
        consultas.push(db.update(bankTransactions).set({ asaasPaymentId: c.id }).where(eq(bankTransactions.id, alvo.bankTransactionId)) as unknown as Consulta);
        resultado.reconciliadas++;
        continue;
      }
    }
    novos.push(desejado);
  }

  function vincular(lancamentoId: number, c: AsaasCobranca, clienteId: number | null) {
    return db.update(bpoLancamentos).set({
      asaasPaymentId: c.id,
      pago: true,
      vencimento: lancamentoDaCobranca(c, clienteId).vencimento,
      descricao: descricaoDaCobranca(c),
      ...(clienteId ? { clienteId, clienteNomeLivre: null } : c.clienteNome ? { clienteNomeLivre: c.clienteNome } : {}),
    }).where(eq(bpoLancamentos.id, lancamentoId)) as unknown as Consulta;
  }

  await executarLote(db, consultas);
  for (let i = 0; i < novos.length; i += 200) {
    const r = await db.insert(bpoLancamentos).values(novos.slice(i, i + 200))
      .onConflictDoNothing({ target: bpoLancamentos.asaasPaymentId })
      .returning({ id: bpoLancamentos.id });
    resultado.criadas += r.length;
  }
  return resultado;
}

/**
 * Lado do extrato: crédito novo com id de pagamento do Asaas assume o lançamento da cobrança
 * (marca pago, valor do banco) em vez de gerar outro. Chamado antes de gerar os lançamentos.
 */
export async function vincularCobrancasAoExtrato(movs: { id: number; asaasPaymentId?: string | null; valor: string; data: Date; tipo: "credito" | "debito" }[]) {
  const comPagamento = movs.filter(m => m.asaasPaymentId && m.tipo === "credito");
  if (!comPagamento.length) return 0;
  const db = getDb();
  const cobrancas = await db.select({ id: bpoLancamentos.id, pid: bpoLancamentos.asaasPaymentId })
    .from(bpoLancamentos)
    .where(and(inArray(bpoLancamentos.asaasPaymentId, comPagamento.map(m => m.asaasPaymentId!)), isNull(bpoLancamentos.bankTransactionId), isNotNull(bpoLancamentos.asaasPaymentId)));
  const porPagamento = new Map(cobrancas.map(c => [c.pid, c.id]));
  const consultas: Consulta[] = [];
  for (const m of comPagamento) {
    const lancamentoId = porPagamento.get(m.asaasPaymentId!);
    if (!lancamentoId) continue;
    consultas.push(db.update(bpoLancamentos).set({ bankTransactionId: m.id, pago: true, pagoEm: m.data, valor: m.valor })
      .where(eq(bpoLancamentos.id, lancamentoId)) as unknown as Consulta);
  }
  await executarLote(db, consultas);
  return consultas.length;
}
