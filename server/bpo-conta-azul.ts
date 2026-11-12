// Pedido de 12/11: importação do backup ZIP do Conta Azul Pro no BPO Financeiro.
// O navegador abre o ZIP e manda o texto dos CSVs; aqui eles são lidos de novo (nada do cliente é confiado),
// comparados com o banco (prévia) e gravados numa transação (importação). Reimportar o mesmo backup não
// duplica: cada lançamento leva a chave da linha do Conta Azul no request_key (único).
import { and, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { getDb } from "./db.js";
import { bpoClients, bpoLancamentos, bpoRecebimentos } from "../drizzle/schema.js";
import { normalizarTitular } from "../shared/financeiro/bpo-extrato.js";
import {
  conciliarComContaAzul, lerBackupContaAzul, observacoesDoMovimento,
  type BackupContaAzul, type MovimentoParaConciliar, type PessoaContaAzul,
} from "../shared/financeiro/conta-azul.js";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Cliente = { id: number; razaoSocial: string; cpf: string | null; cnpj: string | null };

const LOTE = 200;
const digitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** Cadastra no BPO só quem é Cliente no Conta Azul; fornecedores ficam como nome nos lançamentos. */
const papelCliente = (p: PessoaContaAzul) => p.papel.toLowerCase() === "cliente";

function indiceClientes(clientes: Cliente[]) {
  const porDoc = new Map<string, Cliente>(), porNome = new Map<string, Cliente>();
  for (const c of clientes) {
    for (const d of [digitos(c.cpf), digitos(c.cnpj)]) if (d.length >= 11 && !porDoc.has(d)) porDoc.set(d, c);
    const n = normalizarTitular(c.razaoSocial);
    if (n && !porNome.has(n)) porNome.set(n, c);
  }
  return { porDoc, porNome };
}

function planejar(backup: BackupContaAzul, clientes: Cliente[], chavesExistentes: Set<string>) {
  const idx = indiceClientes(clientes);
  const novosClientes: PessoaContaAzul[] = [];
  let clientesExistentes = 0;
  const vistos = new Set<string>();
  for (const p of backup.pessoas.filter(papelCliente)) {
    const doc = p.cpf ?? p.cnpj ?? "";
    const chave = doc || p.chaveNome;
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    if ((doc && idx.porDoc.has(doc)) || idx.porNome.has(p.chaveNome)) clientesExistentes++;
    else novosClientes.push(p);
  }
  const movimentosNovos = backup.movimentos.filter(m => !chavesExistentes.has(m.chave));
  return { novosClientes, clientesExistentes, movimentosNovos, movimentosExistentes: backup.movimentos.length - movimentosNovos.length };
}

async function chavesJaImportadas(d: Db | Tx, chaves: string[]) {
  const existentes = new Set<string>();
  for (let i = 0; i < chaves.length; i += 500) {
    const r = await d.select({ k: bpoLancamentos.requestKey }).from(bpoLancamentos).where(inArray(bpoLancamentos.requestKey, chaves.slice(i, i + 500)));
    for (const x of r) if (x.k) existentes.add(x.k);
  }
  return existentes;
}

const soma = (xs: { valor: string }[]) => (xs.reduce((s, x) => s + Math.round(Number(x.valor) * 100), 0) / 100).toFixed(2);

export type PreviaContaAzul = Awaited<ReturnType<typeof previaContaAzul>>;

/** Prévia sem gravar nada: o que entra, o que já existe e o que fica de fora (e por quê). */
export async function previaContaAzul(arquivos: Record<string, string>) {
  const backup = lerBackupContaAzul(arquivos);
  const d = getDb();
  const [clientes, existentes] = await Promise.all([
    d.select({ id: bpoClients.id, razaoSocial: bpoClients.razaoSocial, cpf: bpoClients.cpf, cnpj: bpoClients.cnpj }).from(bpoClients),
    chavesJaImportadas(d, backup.movimentos.map(m => m.chave)),
  ]);
  const plano = planejar(backup, clientes, existentes);
  const receitas = plano.movimentosNovos.filter(m => m.tipo === "receita");
  const despesas = plano.movimentosNovos.filter(m => m.tipo === "despesa");
  const porCategoria = new Map<string, number>();
  for (const m of plano.movimentosNovos) porCategoria.set(m.categoria, (porCategoria.get(m.categoria) ?? 0) + 1);
  const competencias = backup.movimentos.map(m => m.competencia).sort();
  // Lançamentos que vieram do extrato bancário no mesmo período: podem ser as mesmas movimentações.
  const [sobreposicao] = competencias.length ? await d.select({ n: sql<number>`count(*)::int` }).from(bpoLancamentos).where(and(
    eq(bpoLancamentos.origemEfetiva, "extrato"), isNull(bpoLancamentos.exclusaoLoteBackupId),
    gte(bpoLancamentos.competencia, competencias[0]), lte(bpoLancamentos.competencia, competencias[competencias.length - 1]),
  )) : [{ n: 0 }];
  return {
    lancamentosDoExtratoNoPeriodo: Number(sobreposicao?.n ?? 0),
    valido: backup.erros.length === 0 || backup.movimentos.length > 0 || backup.pessoas.length > 0,
    pessoas: { total: backup.pessoas.length, clientes: backup.pessoas.filter(papelCliente).length, fornecedores: backup.pessoas.filter(p => p.papel.toLowerCase() === "fornecedor").length },
    clientesNovos: plano.novosClientes.length,
    clientesExistentes: plano.clientesExistentes,
    lancamentos: {
      novos: plano.movimentosNovos.length,
      jaImportados: plano.movimentosExistentes,
      receitas: { quantidade: receitas.length, total: soma(receitas) },
      despesas: { quantidade: despesas.length, total: soma(despesas) },
      pagos: plano.movimentosNovos.filter(m => m.pago).length,
      emAberto: plano.movimentosNovos.filter(m => !m.pago).length,
      porCategoria: Array.from(porCategoria.entries()).sort((a, b) => b[1] - a[1]).map(([categoria, quantidade]) => ({ categoria, quantidade })),
      periodo: competencias.length ? { de: competencias[0], ate: competencias[competencias.length - 1] } : null,
    },
    repetidasPorCentro: backup.repetidasPorCentro,
    transferencias: backup.transferencias,
    outrosArquivos: backup.outrosArquivos,
    arquivosAusentes: backup.arquivosAusentes,
    erros: backup.erros.slice(0, 50),
    totalErros: backup.erros.length,
  };
}

/** Importa numa transação (com trava): clientes novos, depois os lançamentos que ainda não existem. */
export async function importarContaAzul(arquivos: Record<string, string>) {
  const backup = lerBackupContaAzul(arquivos);
  if (!backup.movimentos.length && !backup.pessoas.length) throw new Error(backup.erros[0] ?? "Nada para importar neste arquivo.");
  return getDb().transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bpo_importar_conta_azul'))`);
    const clientes: Cliente[] = await tx.select({ id: bpoClients.id, razaoSocial: bpoClients.razaoSocial, cpf: bpoClients.cpf, cnpj: bpoClients.cnpj }).from(bpoClients);
    const existentes = await chavesJaImportadas(tx, backup.movimentos.map(m => m.chave));
    const plano = planejar(backup, clientes, existentes);
    const agora = new Date();
    for (let i = 0; i < plano.novosClientes.length; i += LOTE) {
      const criados = await tx.insert(bpoClients).values(plano.novosClientes.slice(i, i + LOTE).map(p => ({
        razaoSocial: p.nome,
        cpf: p.cpf, cnpj: p.cnpj,
        responsavel: p.nome,
        email: p.email,
        telefone: p.telefone,
        honorarios: "0.00",
        dataInicio: agora,
        status: p.ativo ? "ativo" as const : "encerrado" as const,
        observacoes: ["Importado do Conta Azul (backup).", p.razaoSocial && p.razaoSocial !== p.nome ? `Razão social: ${p.razaoSocial}.` : ""].filter(Boolean).join(" "),
      }))).returning({ id: bpoClients.id, razaoSocial: bpoClients.razaoSocial, cpf: bpoClients.cpf, cnpj: bpoClients.cnpj });
      clientes.push(...criados);
    }
    const { porNome } = indiceClientes(clientes);
    let lancamentosCriados = 0;
    for (let i = 0; i < plano.movimentosNovos.length; i += LOTE) {
      const r = await tx.insert(bpoLancamentos).values(plano.movimentosNovos.slice(i, i + LOTE).map(m => {
        const cliente = m.negociador ? porNome.get(normalizarTitular(m.negociador)) : undefined;
        const meioDia = (d: string) => new Date(`${d}T12:00:00Z`);
        return {
          clienteId: cliente?.id ?? null,
          clienteNomeLivre: cliente ? null : (m.negociador || null),
          tipo: m.tipo,
          descricao: m.descricao,
          valor: m.valor,
          vencimento: meioDia(m.vencimento),
          pago: m.pago,
          pagoEm: m.pagoEm ? meioDia(m.pagoEm) : null,
          valorRecebido: m.pago ? m.valor : "0",
          competencia: m.competencia,
          centroCustos: m.centrosCusto.join(" / ").slice(0, 100) || null,
          categoria: m.categoria,
          observacoes: observacoesDoMovimento(m),
          origemEfetiva: "conta_azul",
          // Pedido de 12/11 (noite): em aberto só entra em Cobranças/Despesas depois que o dono classificar.
          aClassificar: !m.pago,
          requestKey: m.chave,
        };
      })).onConflictDoNothing({ target: bpoLancamentos.requestKey }).returning({ id: bpoLancamentos.id });
      lancamentosCriados += r.length;
    }
    return {
      clientesCriados: plano.novosClientes.length,
      clientesExistentes: plano.clientesExistentes,
      lancamentosCriados,
      lancamentosJaImportados: plano.movimentosExistentes + (plano.movimentosNovos.length - lancamentosCriados),
      transferenciasIgnoradas: backup.transferencias.quantidade,
      linhasComErro: backup.erros.length,
    };
  });
}

/**
 * Lançamentos do Conta Azul ainda sem movimentação bancária, com os valores informados (candidatos à
 * conciliação). Fora: os que já receberam baixa de uma movimentação na divisão de pagamentos.
 */
export async function candidatosContaAzul(d: Db | Tx, tipos: ("receita" | "despesa")[], valores: string[], semAsaas = false) {
  if (!valores.length || !tipos.length) return [];
  const linhas = [];
  const unicos = Array.from(new Set(valores));
  for (let i = 0; i < unicos.length; i += 500) {
    linhas.push(...await d.select({
      id: bpoLancamentos.id, tipo: bpoLancamentos.tipo, valor: bpoLancamentos.valor, pago: bpoLancamentos.pago,
      pagoEm: bpoLancamentos.pagoEm, vencimento: bpoLancamentos.vencimento, clienteId: bpoLancamentos.clienteId,
    }).from(bpoLancamentos).where(and(
      eq(bpoLancamentos.origemEfetiva, "conta_azul"),
      isNull(bpoLancamentos.bankTransactionId),
      isNull(bpoLancamentos.exclusaoLoteBackupId),
      isNull(bpoLancamentos.combinadaEmId),
      inArray(bpoLancamentos.tipo, tipos),
      inArray(bpoLancamentos.valor, unicos.slice(i, i + 500)),
      ...(semAsaas ? [isNull(bpoLancamentos.asaasPaymentId)] : []),
    )));
  }
  if (!linhas.length) return linhas;
  const comBaixaDoBanco = new Set<number>();
  const ids = linhas.map(l => l.id);
  for (let i = 0; i < ids.length; i += 500) {
    const r = await d.select({ id: bpoRecebimentos.lancamentoId }).from(bpoRecebimentos)
      .where(and(inArray(bpoRecebimentos.lancamentoId, ids.slice(i, i + 500)), isNotNull(bpoRecebimentos.bankTransactionId)));
    r.forEach(x => comBaixaDoBanco.add(x.id));
  }
  return linhas.filter(l => !comBaixaDoBanco.has(l.id));
}

/**
 * Pedido de 12/11 (noite): a movimentação do extrato que corresponde a um lançamento do Conta Azul JÁ PAGO
 * (mesmo tipo e valor, até 3 dias da quitação) só é ligada a ele — sem mudar valor, status nem data de
 * pagamento — em vez de criar outro lançamento. Em aberto não é baixado sozinho (vira sugestão em
 * "A classificar"). Devolve os ids das movimentações ligadas (as demais seguem o fluxo normal).
 */
export async function conciliarMovimentosComContaAzul(movimentos: MovimentoParaConciliar[]): Promise<Set<number>> {
  const conciliadas = new Set<number>();
  if (!movimentos.length) return conciliadas;
  const d = getDb();
  const candidatos = (await candidatosContaAzul(d, Array.from(new Set(movimentos.map(m => m.tipo))), movimentos.map(m => Number(m.valor).toFixed(2))))
    .filter(c => c.pago);
  if (!candidatos.length) return conciliadas;
  for (const [movId, lancId] of Array.from(conciliarComContaAzul(movimentos, candidatos).entries())) {
    const r = await d.update(bpoLancamentos).set({ bankTransactionId: movId, updatedAt: new Date() })
      .where(and(eq(bpoLancamentos.id, lancId), isNull(bpoLancamentos.bankTransactionId), eq(bpoLancamentos.pago, true)))
      .returning({ id: bpoLancamentos.id }).catch(() => []);
    if (r.length) conciliadas.add(movId);
  }
  return conciliadas;
}
