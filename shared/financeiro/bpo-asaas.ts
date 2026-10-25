// Pedido de 25/10 (noite), item 14: cobranças emitidas no Asaas na aba Cobranças do BPO.
// Regras puras (sem banco/rede) — mesmo comportamento a portar no Grupo Santa Fé.
//
// Cada cobrança vira um lançamento de receita (asaas_payment_id único). Quando o dinheiro entra,
// o crédito do extrato do Asaas e a cobrança são o MESMO lançamento: pelo id do pagamento que o
// extrato traz ou, sem ele, pelo valor (bruto ou líquido) e data próximos — nunca dois lançamentos.
import { sugerirClientePorTitular, type ClienteParaSugestao } from "./bpo-extrato.js";

export type SituacaoCobranca = "pago" | "aberto" | "vencido";

const PAGAS = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH", "DUNNING_RECEIVED"]);
const ABERTAS = new Set(["PENDING", "AWAITING_RISK_ANALYSIS", "AUTHORIZED"]);
const VENCIDAS = new Set(["OVERDUE", "DUNNING_REQUESTED"]);

/** Situação da cobrança do Asaas; `null` = não entra no BPO (estornada, cancelada, excluída…). */
export function situacaoCobrancaAsaas(status: string | null | undefined): SituacaoCobranca | null {
  const s = String(status ?? "").toUpperCase();
  if (PAGAS.has(s)) return "pago";
  if (VENCIDAS.has(s)) return "vencido";
  if (ABERTAS.has(s)) return "aberto";
  return null;
}

/** Situação exibida de qualquer lançamento: pago, vencido (não pago e vencimento passado) ou em aberto. */
export function situacaoDoLancamento(l: { pago: boolean; vencimento: Date | string }, hoje = new Date()): SituacaoCobranca {
  if (l.pago) return "pago";
  const venc = (typeof l.vencimento === "string" ? l.vencimento : l.vencimento.toISOString()).slice(0, 10);
  return venc < hoje.toISOString().slice(0, 10) ? "vencido" : "aberto";
}

export type CobrancaAsaas = {
  id: string;
  status: string;
  valor: number;
  valorLiquido: number | null;
  vencimento: string;
  pagoEm: string | null;
  descricao: string;
  clienteNome: string | null;
  clienteDocumento: string | null;
};

export type ClienteBpoParaCobranca = ClienteParaSugestao & { documentos?: (string | null | undefined)[] };

const digitos = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");

/** Cliente BPO da cobrança: CPF/CNPJ igual (do cliente ou do lead) e, sem documento, o nome. */
export function clienteDaCobranca(c: Pick<CobrancaAsaas, "clienteNome" | "clienteDocumento">, clientes: ClienteBpoParaCobranca[]): number | null {
  const doc = digitos(c.clienteDocumento);
  if (doc.length >= 11) {
    const porDoc = clientes.filter(x => (x.documentos ?? []).some(d => digitos(d) === doc));
    if (porDoc.length === 1) return porDoc[0].id;
  }
  return sugerirClientePorTitular(c.clienteNome, clientes);
}

const meioDia = (dia: string) => new Date(`${dia.slice(0, 10)}T12:00:00Z`);

export function descricaoDaCobranca(c: Pick<CobrancaAsaas, "clienteNome" | "descricao">): string {
  return ["Cobrança Asaas", c.clienteNome, c.descricao].map(x => (x ?? "").trim()).filter(Boolean).join(" — ").slice(0, 500);
}

/** Valores do lançamento de uma cobrança sem crédito no extrato ainda. */
export function lancamentoDaCobranca(c: CobrancaAsaas, clienteId: number | null) {
  const situacao = situacaoCobrancaAsaas(c.status);
  const pago = situacao === "pago";
  return {
    asaasPaymentId: c.id,
    tipo: "receita" as const,
    categoria: "Recebimento de cliente",
    clienteId,
    clienteNomeLivre: clienteId ? null : c.clienteNome,
    descricao: descricaoDaCobranca(c),
    valor: c.valor.toFixed(2),
    vencimento: meioDia(c.vencimento),
    pago,
    pagoEm: pago ? meioDia(c.pagoEm ?? c.vencimento) : null,
    competencia: c.vencimento.slice(0, 7),
  };
}

export type CreditoCandidato = { bankTransactionId: number; valor: string | number; data: Date | string };

/**
 * Crédito do extrato do Asaas que corresponde à cobrança paga sem id de pagamento no extrato:
 * mesmo valor (bruto ou líquido) e data até 3 dias da data do pagamento; o mais próximo vence.
 */
export function creditoDaCobranca(c: CobrancaAsaas, candidatos: CreditoCandidato[], usados: Set<number>): number | null {
  if (situacaoCobrancaAsaas(c.status) !== "pago") return null;
  const alvos = new Set([c.valor, c.valorLiquido].filter((v): v is number => v != null).map(v => Math.round(v * 100)));
  const ref = meioDia(c.pagoEm ?? c.vencimento).getTime();
  let melhor: { id: number; dist: number } | null = null;
  for (const k of candidatos) {
    if (usados.has(k.bankTransactionId) || !alvos.has(Math.round(Number(k.valor) * 100))) continue;
    const dia = (typeof k.data === "string" ? k.data : k.data.toISOString()).slice(0, 10);
    const dist = Math.abs(meioDia(dia).getTime() - ref) / 86400000;
    if (dist > 3) continue;
    if (!melhor || dist < melhor.dist) melhor = { id: k.bankTransactionId, dist };
  }
  return melhor?.id ?? null;
}

