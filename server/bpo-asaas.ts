// Pedido de 25/10 (noite), item 14: cobranças emitidas no Asaas → aba Cobranças do BPO.
// Roda junto com a sincronização da conta Asaas (botão Sincronizar, cron diário e webhook).
// Regras puras em shared/financeiro/bpo-asaas.ts. Nunca cria dois lançamentos para o mesmo dinheiro.
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
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
import { candidatosContaAzul } from "./bpo-conta-azul.js";
import { conciliarComContaAzul } from "../shared/financeiro/conta-azul.js";

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
  const db = getDb();
  // Cliente do Asaas só é consultado para cobrança nova ou ainda sem cliente BPO.
  const comCliente = new Set(
    (await db.select({ pid: bpoLancamentos.asaasPaymentId }).from(bpoLancamentos)
      .where(and(isNotNull(bpoLancamentos.asaasPaymentId), isNotNull(bpoLancamentos.clienteId))))
      .map(l => l.pid as string),
  );
  const cobrancas = (await fetchAsaasCobrancas(apiKey, desde, fetchImpl, id => !comCliente.has(id)))
    .filter(c => situacaoCobrancaAsaas(c.status) !== null);
  const resultado: ResultadoCobrancas = { recebidas: cobrancas.length, criadas: 0, atualizadas: 0, reconciliadas: 0 };
  if (!cobrancas.length) return resultado;
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
  let receitasContaAzul: Awaited<ReturnType<typeof candidatosContaAzul>> | null = null;
  const usadosContaAzul = new Set<number>();
  const consultas: Consulta[] = [];
  const novos: ReturnType<typeof lancamentoDaCobranca>[] = [];

  for (const c of cobrancas) {
    const clienteId = clienteDaCobranca(c, clientes);
    const desejado = lancamentoDaCobranca(c, clienteId);
    const atual = existentes.get(c.id);
    if (atual) {
      if (atual.exclusaoLoteBackupId != null) continue;
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
        consultas.push(db.update(bpoLancamentos).set(set).where(and(eq(bpoLancamentos.id, atual.id), isNull(bpoLancamentos.exclusaoLoteBackupId))) as unknown as Consulta);
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
    // Pedido de 12/11 (noite): a mesma receita importada do backup do Conta Azul assume a cobrança (não duplica).
    const doContaAzul = await receitaDoContaAzul(desejado);
    if (doContaAzul) {
      consultas.push(db.update(bpoLancamentos).set({
        asaasPaymentId: c.id,
        ...(desejado.pago ? { pago: true, pagoEm: desejado.pagoEm, valorRecebido: sql`${bpoLancamentos.valor}` } : {}),
        updatedAt: new Date(),
      }).where(and(eq(bpoLancamentos.id, doContaAzul), isNull(bpoLancamentos.asaasPaymentId))) as unknown as Consulta);
      resultado.reconciliadas++;
      continue;
    }
    novos.push(desejado);
  }

  async function receitaDoContaAzul(desejado: ReturnType<typeof lancamentoDaCobranca>): Promise<number | null> {
    if (!receitasContaAzul) {
      receitasContaAzul = await candidatosContaAzul(db, ["receita"], cobrancas.map(x => x.valor.toFixed(2)), true);
    }
    const livres = receitasContaAzul.filter(r => !usadosContaAzul.has(r.id));
    const par = conciliarComContaAzul([{ id: 0, tipo: "receita", valor: desejado.valor, data: desejado.pagoEm ?? desejado.vencimento }], livres);
    const id = par.get(0) ?? null;
    if (id) usadosContaAzul.add(id);
    return id;
  }

  function vincular(lancamentoId: number, c: AsaasCobranca, clienteId: number | null) {
    const ativo = sql`${bpoLancamentos.exclusaoLoteBackupId} IS NULL`;
    // Um crédito arquivado pode adquirir a identidade do pagamento sem mudar sua exibição ou seus valores.
    return db.update(bpoLancamentos).set({
      asaasPaymentId: c.id,
      pago: sql`CASE WHEN ${ativo} THEN true ELSE ${bpoLancamentos.pago} END`,
      vencimento: sql`CASE WHEN ${ativo} THEN ${lancamentoDaCobranca(c, clienteId).vencimento.toISOString()}::timestamp ELSE ${bpoLancamentos.vencimento} END`,
      descricao: sql`CASE WHEN ${ativo} THEN ${descricaoDaCobranca(c)} ELSE ${bpoLancamentos.descricao} END`,
      ...(clienteId
        ? { clienteId: sql`CASE WHEN ${ativo} THEN ${clienteId}::integer ELSE ${bpoLancamentos.clienteId} END`,
            clienteNomeLivre: sql`CASE WHEN ${ativo} THEN null ELSE ${bpoLancamentos.clienteNomeLivre} END` }
        : c.clienteNome ? { clienteNomeLivre: sql`CASE WHEN ${ativo} THEN ${c.clienteNome} ELSE ${bpoLancamentos.clienteNomeLivre} END` } : {}),
    }).where(and(eq(bpoLancamentos.id, lancamentoId), isNull(bpoLancamentos.asaasPaymentId))) as unknown as Consulta;
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
