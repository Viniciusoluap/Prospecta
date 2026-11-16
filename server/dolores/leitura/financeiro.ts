// EPIC-025 (Dolores, etapa 1) — financiamentos e recebíveis pendentes. SOMENTE LEITURA.
// Financiamento: situação e checklist (sem CPF inteiro, sem documentos). Recebíveis: cobranças do BPO em aberto com a
// mesma seleção da tela (sem combinadas, arquivadas nem "A classificar"; transferência interna fora) e a situação
// de `situacaoDoLancamento`; e o saldo a receber das regularizações pela tabela financeira (calcularFinanceiroRegularizacao).
// Nada de dados bancários (conta, agência, PIX, chaves de integração).
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import {
  bpoClients, bpoLancamentos, financiamentoChecklistItems, financiamentos, regularizacaoItensFinanceiros,
  regularizacaoRecebimentos, regularizacoes,
} from "../../../drizzle/schema.js";
import { centavosParaReais, diaDoPrazo, diaFortaleza, isoFortaleza, paginar, reais, truncar } from "../../../shared/dolores/formato.js";
import { type CanalDolores, campoPessoal } from "../dados-pessoais.js";
import { DIAS_PARADO_PADRAO, situacaoDoPrazo } from "../../../shared/dolores/regras.js";
import { situacaoDoLancamento } from "../../../shared/financeiro/bpo-asaas.js";
import { contaNoResultado, recebidoDoLancamento } from "../../../shared/financeiro/bpo-extrato.js";
import { calcularFinanceiroRegularizacao } from "../../../shared/financeiro/regularizacao.js";
import { FINANCIAMENTO_BANCO_LABELS, FINANCIAMENTO_STATUS_LABELS, FINANCIAMENTO_TIPO_LABELS } from "../../../shared/financiamento.js";
import { MAX_LINHAS_LIDAS, db, nomesDeUsuarios, paginacao, type Resultado } from "./comum.js";

type Ctx = { agora: Date; canal: CanalDolores };
const ENCERRADOS_FIN = new Set(["liberado", "cancelado"]);
const rot = <T extends string>(m: Record<T, string>, v: string | null) => (v ? m[v as T] ?? v : null);

export async function carregarFinanciamentos(agora: Date, canal: CanalDolores, diasParado = DIAS_PARADO_PADRAO) {
  const linhas = await db().select({
    id: financiamentos.id, clienteNome: financiamentos.clienteNome, clienteCpf: financiamentos.clienteCpf, tipo: financiamentos.tipo,
    banco: financiamentos.banco, bancoOutro: financiamentos.bancoOutro, status: financiamentos.status, valorImovel: financiamentos.valorImovel,
    valorFinanciado: financiamentos.valorFinanciado, leadId: financiamentos.leadId, corretorId: financiamentos.corretorId,
    createdAt: financiamentos.createdAt, updatedAt: financiamentos.updatedAt,
  }).from(financiamentos).orderBy(desc(financiamentos.updatedAt)).limit(MAX_LINHAS_LIDAS);
  if (!linhas.length) return [];
  const [itens, nomes] = await Promise.all([
    db().select({ financiamentoId: financiamentoChecklistItems.financiamentoId, grupo: financiamentoChecklistItems.grupo, item: financiamentoChecklistItems.item,
      concluido: financiamentoChecklistItems.concluido, concluidoEm: financiamentoChecklistItems.concluidoEm })
      .from(financiamentoChecklistItems).where(inArray(financiamentoChecklistItems.financiamentoId, linhas.map(l => l.id))),
    nomesDeUsuarios(linhas.map(l => l.corretorId)),
  ]);
  return linhas.map(f => {
    const meus = itens.filter(i => i.financiamentoId === f.id);
    const encerrado = ENCERRADOS_FIN.has(f.status);
    const ultima = [f.updatedAt, ...meus.map(i => i.concluidoEm)].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? f.updatedAt;
    const s = situacaoDoPrazo({ encerrado, prazo: null, ultimaMovimentacao: ultima, agora, diasParado });
    return {
      id: f.id, cliente: f.clienteNome, cpf: campoPessoal(f.clienteCpf, "cpf", canal), leadId: f.leadId,
      situacao: rot(FINANCIAMENTO_STATUS_LABELS, f.status), encerrado,
      tipo: rot(FINANCIAMENTO_TIPO_LABELS, f.tipo), banco: f.banco === "outro" ? truncar(f.bancoOutro, 60) ?? "Outro" : rot(FINANCIAMENTO_BANCO_LABELS, f.banco),
      moeda: "BRL", valorDoImovel: reais(f.valorImovel), valorFinanciado: reais(f.valorFinanciado),
      corretor: f.corretorId ? nomes.get(f.corretorId) ?? null : null,
      abertoEm: diaFortaleza(f.createdAt), ultimaMovimentacao: isoFortaleza(ultima), diasSemMovimentacao: s.diasSemMovimentacao, parado: s.parado,
      checklist: { itens: meus.length, concluidos: meus.filter(i => i.concluido).length },
      pendenciasDoChecklist: meus.filter(i => !i.concluido).slice(0, 15).map(i => `${truncar(i.grupo, 40)}: ${truncar(i.item, 120)}`),
    };
  });
}

export const entradaListarFinanciamentos = z.object({
  situacao: z.enum(["abertos", "parados", "todos"]).default("abertos").describe("abertos = não concluídos nem cancelados."),
  diasParado: z.number().int().min(1).max(365).default(DIAS_PARADO_PADRAO),
  ...paginacao,
}).strict();

export async function listarFinanciamentos(args: z.infer<typeof entradaListarFinanciamentos>, { agora, canal }: Ctx): Promise<Resultado> {
  const todos = await carregarFinanciamentos(agora, canal, args.diasParado);
  const filtrados = todos.filter(f => args.situacao === "todos" || (!f.encerrado && (args.situacao !== "parados" || f.parado)))
    .sort((a, b) => (b.diasSemMovimentacao ?? 0) - (a.diasSemMovimentacao ?? 0) || a.id - b.id);
  const pagina = paginar(filtrados, args.pagina, args.limite);
  const abertos = todos.filter(f => !f.encerrado);
  const porSituacao: Record<string, number> = {};
  for (const f of abertos) porSituacao[f.situacao ?? "?"] = (porSituacao[f.situacao ?? "?"] ?? 0) + 1;
  const totais = { financiamentos: todos.length, abertos: abertos.length, parados: abertos.filter(f => f.parado).length };
  return {
    dados: { criterio: `parado = sem movimentação (cadastro ou checklist) há ${args.diasParado} dias ou mais`, totais, porSituacao, ...pagina },
    resumo: { encontrados: filtrados.length, devolvidos: pagina.itens.length, ...totais },
  };
}

export const entradaListarRecebiveis = z.object({
  situacao: z.enum(["em_aberto", "vencidos"]).default("em_aberto").describe("em_aberto = todas as não pagas (inclui as vencidas)."),
  origem: z.enum(["todas", "bpo", "regularizacoes"]).default("todas"),
  ...paginacao,
}).strict();

export async function listarRecebiveisPendentes(args: z.infer<typeof entradaListarRecebiveis>, { agora }: Ctx): Promise<Resultado> {
  const querBpo = args.origem !== "regularizacoes";
  const querReg = args.origem !== "bpo" && args.situacao === "em_aberto";
  const [lancamentos, regs, itens, recebimentos] = await Promise.all([
    querBpo ? db().select({ id: bpoLancamentos.id, tipo: bpoLancamentos.tipo, descricao: bpoLancamentos.descricao, valor: bpoLancamentos.valor,
      valorRecebido: bpoLancamentos.valorRecebido, pago: bpoLancamentos.pago, vencimento: bpoLancamentos.vencimento, categoria: bpoLancamentos.categoria,
      competencia: bpoLancamentos.competencia, cliente: bpoClients.razaoSocial, clienteLivre: bpoLancamentos.clienteNomeLivre })
      .from(bpoLancamentos).leftJoin(bpoClients, eq(bpoClients.id, bpoLancamentos.clienteId))
      .where(and(eq(bpoLancamentos.pago, false), ne(bpoLancamentos.tipo, "despesa"), isNull(bpoLancamentos.combinadaEmId),
        isNull(bpoLancamentos.exclusaoLoteBackupId), eq(bpoLancamentos.aClassificar, false)))
      .orderBy(bpoLancamentos.vencimento).limit(MAX_LINHAS_LIDAS) : Promise.resolve([]),
    querReg ? db().select({ id: regularizacoes.id, cliente: regularizacoes.clientName, status: regularizacoes.status }).from(regularizacoes).limit(MAX_LINHAS_LIDAS) : Promise.resolve([]),
    querReg ? db().select({ id: regularizacaoItensFinanceiros.id, regularizacaoId: regularizacaoItensFinanceiros.regularizacaoId, nome: regularizacaoItensFinanceiros.nome,
      grupo: regularizacaoItensFinanceiros.grupo, ordem: regularizacaoItensFinanceiros.ordem, previsto: regularizacaoItensFinanceiros.previsto }).from(regularizacaoItensFinanceiros) : Promise.resolve([]),
    querReg ? db().select({ regularizacaoId: regularizacaoRecebimentos.regularizacaoId, itemId: regularizacaoRecebimentos.itemId, valor: regularizacaoRecebimentos.valor,
      status: regularizacaoRecebimentos.status }).from(regularizacaoRecebimentos) : Promise.resolve([]),
  ]);
  const cobrancas = lancamentos.filter(l => contaNoResultado(l.categoria)).map(l => {
    const situacao = situacaoDoLancamento(l, agora);
    const recebido = recebidoDoLancamento(l);
    return {
      origem: "BPO (cobrança)", id: l.id, cliente: truncar(l.cliente ?? l.clienteLivre, 120) ?? "(sem cliente)", descricao: truncar(l.descricao, 160),
      vencimento: diaDoPrazo(l.vencimento), situacao, valor: reais(l.valor), recebido: reais(recebido),
      emAberto: Math.round((Number(l.valor) - recebido) * 100) / 100, competencia: l.competencia,
    };
  }).filter(c => args.situacao === "em_aberto" || c.situacao === "vencido");
  type Saldo = { origem: string; id: number; cliente: string; previsto?: number; recebido?: number; emAberto?: number; erro?: string };
  const saldos: Saldo[] = regs.filter(r => r.status !== "cancelado").flatMap((r): Saldo[] => {
    try {
      const f = calcularFinanceiroRegularizacao(itens.filter(i => i.regularizacaoId === r.id), recebimentos.filter(x => x.regularizacaoId === r.id));
      return f.geral.saldo > 0 ? [{ origem: "Regularização (tabela financeira)", id: r.id, cliente: r.cliente, previsto: centavosParaReais(f.geral.previsto),
        recebido: centavosParaReais(f.geral.recebido), emAberto: centavosParaReais(f.geral.saldo) }] : [];
    } catch { return [{ origem: "Regularização (tabela financeira)", id: r.id, cliente: r.cliente, erro: "tabela financeira inconsistente" }]; }
  }).sort((a, b) => (b.emAberto ?? 0) - (a.emAberto ?? 0));
  const soma = (xs: { emAberto?: number }[]) => Math.round(xs.reduce((s, x) => s + (x.emAberto ?? 0), 0) * 100) / 100;
  const totais = {
    moeda: "BRL",
    cobrancasBpo: cobrancas.length, emAbertoBpo: soma(cobrancas),
    vencidasBpo: cobrancas.filter(c => c.situacao === "vencido").length, vencidoBpo: soma(cobrancas.filter(c => c.situacao === "vencido")),
    regularizacoesComSaldo: saldos.length, saldoRegularizacoes: soma(saldos),
  };
  const lista = [...cobrancas.sort((a, b) => Number(b.situacao === "vencido") - Number(a.situacao === "vencido") || String(a.vencimento).localeCompare(String(b.vencimento))), ...saldos];
  const pagina = paginar(lista, args.pagina, args.limite);
  return {
    dados: {
      criterios: { vencido: "cobrança não paga com vencimento anterior a hoje (regra do BPO)", regularizacao: "previsto − recebido confirmado da tabela financeira do processo (processos não cancelados)" },
      totais, ...pagina,
    },
    resumo: { encontrados: lista.length, devolvidos: pagina.itens.length, cobrancasBpo: totais.cobrancasBpo, regularizacoesComSaldo: totais.regularizacoesComSaldo },
  };
}
