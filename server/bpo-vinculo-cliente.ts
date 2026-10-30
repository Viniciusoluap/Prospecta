// Lote 3, item 17 (29/10/2026): vincular lançamentos "Cadastro livre" a clientes do CRM.
// Regra pura em shared/financeiro/bpo-vinculo-cliente.ts; aqui só carga de dados e gravação auditada.
// Mesmo comportamento no Santa Fé: web/src/lib/actions/bpo-vinculo.ts.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "./db.js";
import { bankTransactions, bpoClients, bpoLancamentoHistorico, bpoLancamentos, bpoRegrasTitular, leads } from "../drizzle/schema.js";
import {
  montarCandidatos, sugerirClientesParaLancamento,
  type CandidatoCliente, type ResultadoSugestao,
} from "../shared/financeiro/bpo-vinculo-cliente.js";
import { normalizarTitular } from "../shared/financeiro/bpo-extrato.js";
import { catalogoDaCategoria } from "../shared/financeiro/bpo-operacional.js";
import { exigirNaoCombinada } from "../shared/financeiro/bpo-lote.js";

type LancamentoLivre = {
  id: number; version: number; clienteId: number | null; clienteNomeLivre: string | null; descricao: string;
  tipo: string; categoriaOperacional: string | null; vinculoOperacionalId: string | null; bankTransactionId: number | null;
  titular: string | null; transacaoClienteId: number | null;
};

type CatalogoComLead = Record<string, unknown>;

export async function carregarCandidatosCrm(): Promise<CandidatoCliente[]> {
  const d = getDb();
  const [clientes, crm] = await Promise.all([
    d.select({ id: bpoClients.id, razaoSocial: bpoClients.razaoSocial, cpf: bpoClients.cpf, cnpj: bpoClients.cnpj, telefone: bpoClients.telefone, leadId: bpoClients.leadId }).from(bpoClients),
    d.select({ id: leads.id, nome: leads.name, cpf: leads.cpf, telefone: leads.phone }).from(leads).where(isNull(leads.deletedAt)),
  ]);
  return montarCandidatos(clientes, crm);
}

async function lancamentosLivres(ids?: number[]): Promise<LancamentoLivre[]> {
  const filtros = [isNull(bpoLancamentos.clienteId), isNull(bpoLancamentos.combinadaEmId)];
  if (ids) filtros.push(inArray(bpoLancamentos.id, ids.length ? ids : [0]));
  return getDb().select({
    id: bpoLancamentos.id, version: bpoLancamentos.version, clienteId: bpoLancamentos.clienteId,
    clienteNomeLivre: bpoLancamentos.clienteNomeLivre, descricao: bpoLancamentos.descricao, tipo: bpoLancamentos.tipo,
    categoriaOperacional: bpoLancamentos.categoriaOperacional, vinculoOperacionalId: bpoLancamentos.vinculoOperacionalId,
    bankTransactionId: bpoLancamentos.bankTransactionId, titular: bankTransactions.titular, transacaoClienteId: bankTransactions.bpoClienteId,
  }).from(bpoLancamentos)
    .leftJoin(bankTransactions, eq(bankTransactions.id, bpoLancamentos.bankTransactionId))
    .where(and(...filtros));
}

async function regrasPorTitular(titulares: (string | null)[]) {
  const nomes = Array.from(new Set(titulares.map(normalizarTitular).filter(n => n.length >= 3)));
  if (!nomes.length) return new Map<string, number>();
  const r = await getDb().select({ t: bpoRegrasTitular.titularNormalizado, c: bpoRegrasTitular.bpoClienteId })
    .from(bpoRegrasTitular).where(inArray(bpoRegrasTitular.titularNormalizado, nomes));
  return new Map(r.filter(x => x.c != null).map(x => [x.t, x.c as number]));
}

function sugerir(l: LancamentoLivre, candidatos: CandidatoCliente[], catalogo: CatalogoComLead, regras: Map<string, number>): ResultadoSugestao {
  const tipo = l.tipo === "despesa" ? "despesa" : "cobranca";
  const opcoes = l.categoriaOperacional ? catalogo[catalogoDaCategoria(tipo, l.categoriaOperacional)] : null;
  const registro = Array.isArray(opcoes) ? (opcoes as { id: string; leadId?: string | null }[]).find(o => o.id === l.vinculoOperacionalId) : null;
  const regra = regras.get(normalizarTitular(l.titular));
  return sugerirClientesParaLancamento({
    leadIds: [registro?.leadId],
    clienteIdsIntegracao: [l.transacaoClienteId != null ? String(l.transacaoClienteId) : null, regra != null ? String(regra) : null],
    nome: l.clienteNomeLivre || l.titular,
    textos: [l.clienteNomeLivre, l.descricao, l.titular],
  }, candidatos);
}

export async function sugestoesDoLancamento(id: number, catalogo: CatalogoComLead) {
  const [l] = await lancamentosLivres([id]);
  if (!l) return { lancamentoId: id, sugestoes: [], automatico: null, ambiguo: false };
  const [candidatos, regras] = await Promise.all([carregarCandidatosCrm(), regrasPorTitular([l.titular])]);
  return { lancamentoId: id, ...sugerir(l, candidatos, catalogo, regras) };
}

/** Prévia da ação em massa: todos os "Cadastro livre" com sugestão; automáticos só com 1 candidato forte. */
export async function previaVinculosEmMassa(catalogo: CatalogoComLead) {
  const livres = (await lancamentosLivres()).filter(l => (l.clienteNomeLivre ?? l.titular ?? "").trim() || l.vinculoOperacionalId);
  const [candidatos, regras] = await Promise.all([carregarCandidatosCrm(), regrasPorTitular(livres.map(l => l.titular))]);
  const itens = livres.map(l => {
    const r = sugerir(l, candidatos, catalogo, regras);
    return {
      lancamentoId: l.id, version: l.version, nome: l.clienteNomeLivre || l.titular || "—", descricao: l.descricao,
      automatico: r.automatico, ambiguo: r.ambiguo, sugestoes: r.sugestoes.slice(0, 3),
    };
  }).filter(i => i.sugestoes.length);
  return { analisados: livres.length, comSugestao: itens.length, automaticos: itens.filter(i => i.automatico).length, itens };
}

export type AlvoVinculo = { clienteId?: number | null; leadId?: number | null };

/**
 * Liga o lançamento ao cliente BPO (cria o cliente a partir do lead se ainda não existir — sem
 * duplicar: reaproveita o cliente do lead ou o cadastro livre com o mesmo CPF/CNPJ). Grava no
 * histórico auditado do lançamento o antes/depois (o nome livre original fica preservado ali).
 */
export async function vincularLancamentoACliente(input: { id: number; version: number; motivo: string } & AlvoVinculo, userId: number) {
  if (!input.clienteId && !input.leadId) throw new Error("Escolha um cliente ou lead.");
  const { montarClienteBpo } = await import("./bpo-router.js");
  return getDb().transaction(async tx => {
    const [antes] = await tx.select().from(bpoLancamentos).where(eq(bpoLancamentos.id, input.id)).limit(1);
    if (antes) exigirNaoCombinada(antes);
    if (!antes || antes.version !== input.version) throw new Error("O lançamento foi alterado por outra pessoa. Atualize a tela.");
    let clienteId = input.clienteId ?? null;
    let criado = false;
    if (clienteId) {
      const [c] = await tx.select({ id: bpoClients.id }).from(bpoClients).where(eq(bpoClients.id, clienteId)).limit(1);
      if (!c) throw new Error("Cliente BPO não encontrado.");
    } else {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bpo_importar_clientes_crm'))`);
      const [lead] = await tx.select({ id: leads.id, name: leads.name, phone: leads.phone, email: leads.email, cpf: leads.cpf })
        .from(leads).where(and(eq(leads.id, input.leadId!), isNull(leads.deletedAt))).limit(1);
      if (!lead) throw new Error("Lead não encontrado.");
      const [doLead] = await tx.select({ id: bpoClients.id }).from(bpoClients).where(eq(bpoClients.leadId, lead.id)).limit(1);
      if (doLead) clienteId = doLead.id;
      else {
        const doc = (lead.cpf ?? "").replace(/\D/g, "");
        const livres = doc.length >= 11
          ? (await tx.select({ id: bpoClients.id, cpf: bpoClients.cpf, cnpj: bpoClients.cnpj }).from(bpoClients).where(isNull(bpoClients.leadId)))
            .filter(c => (c.cpf ?? "").replace(/\D/g, "") === doc || (c.cnpj ?? "").replace(/\D/g, "") === doc)
          : [];
        if (livres.length === 1) {
          clienteId = livres[0].id;
          await tx.update(bpoClients).set({ leadId: lead.id, updatedAt: new Date() }).where(eq(bpoClients.id, clienteId));
        } else {
          const [novo] = await tx.insert(bpoClients).values(montarClienteBpo({ servicos: [] }, lead)).returning({ id: bpoClients.id });
          clienteId = novo.id;
          criado = true;
        }
      }
    }
    const [depois] = await tx.update(bpoLancamentos)
      .set({ clienteId, clienteNomeLivre: null, version: antes.version + 1, updatedAt: new Date() })
      .where(and(eq(bpoLancamentos.id, antes.id), eq(bpoLancamentos.version, antes.version), isNull(bpoLancamentos.combinadaEmId))).returning();
    if (!depois) throw new Error("O lançamento foi alterado por outra pessoa. Atualize a tela.");
    await tx.insert(bpoLancamentoHistorico).values({
      lancamentoId: antes.id, lancamentoReferencia: antes.id, versaoAnterior: antes.version, alteradoPorUserId: userId,
      motivo: `Vínculo com cliente do CRM: ${input.motivo}`.slice(0, 1000),
      antesJson: JSON.stringify(antes), depoisJson: JSON.stringify(depois),
    });
    return { lancamentoId: antes.id, clienteId: clienteId!, clienteCriado: criado, version: depois.version };
  });
}

/** Aplica a ação em massa confirmada: cada item é independente (um conflito não desfaz os outros). */
export async function aplicarVinculosEmMassa(itens: ({ id: number; version: number } & AlvoVinculo)[], userId: number) {
  let vinculados = 0;
  const falhas: { lancamentoId: number; motivo: string }[] = [];
  for (const item of itens) {
    try {
      await vincularLancamentoACliente({ ...item, motivo: "sugestão em massa confirmada" }, userId);
      vinculados++;
    } catch (e) {
      falhas.push({ lancamentoId: item.id, motivo: e instanceof Error ? e.message : "Falha ao vincular." });
    }
  }
  return { vinculados, falhas };
}
