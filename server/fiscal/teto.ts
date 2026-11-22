// EPIC-029 S-6 (22/11/2026) — leitura dos dados da soma de receitas por empresa (aba Contabilidade, aviso e leitura da Dolores).
// SÓ LEITURA: perfis tributários, contas bancárias, lançamentos pagos do ano e as saídas (para casar transferências entre contas da
// mesma empresa). A conta em si é pura (shared/fiscal/regimes.ts#apurarReceitas). Nenhum dado pessoal sai daqui: só nomes de empresa,
// apelidos de conta e valores.
import { sql } from "drizzle-orm";
import {
  JANELA_TRANSFERENCIA_MS, anoEmBrasilia, apurarReceitas, cnpjDaEmpresa, type Apuracao, type ContaParaSoma, type DebitoParaSoma,
  type PerfilParaRegime, type ReceitaParaSoma,
} from "../../shared/fiscal/regimes.js";

type Linha = Record<string, unknown>;
type Conexao = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };
const linhas = (r: unknown): Linha[] => (r as { rows?: Linha[] }).rows ?? [];
const centavos = (v: unknown) => Math.round(Number(v ?? 0) * 100);
const data = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));
const txt = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/** Versões dos perfis tributários com CNPJ (para o regime vigente na data). */
export async function lerPerfis(db: Conexao): Promise<PerfilParaRegime[]> {
  return linhas(await db.execute(sql`
    SELECT id, company_name, cnpj, regime, effective_from, effective_to, is_active FROM tax_profiles WHERE coalesce(cnpj, '') <> ''`))
    .map(r => ({ id: Number(r.id), companyName: String(r.company_name), cnpj: cnpjDaEmpresa(String(r.cnpj)), regime: String(r.regime),
      effectiveFrom: data(r.effective_from), effectiveTo: r.effective_to == null ? null : data(r.effective_to), isActive: Boolean(r.is_active) }))
    .filter(p => p.cnpj);
}

export async function lerContas(db: Conexao): Promise<ContaParaSoma[]> {
  return linhas(await db.execute(sql`SELECT id, banco, apelido, descricao, conta, empresa_cnpj, ativo FROM bank_accounts ORDER BY id`))
    .map(r => ({ id: Number(r.id), banco: String(r.banco), apelido: txt(r.apelido), descricao: txt(r.descricao), conta: txt(r.conta),
      empresaCnpj: txt(r.empresa_cnpj), ativo: Boolean(r.ativo) }));
}

/** Soma do ano corrente (Brasília) por empresa. `db`: a conexão normal ou a de leitura da Dolores (transação somente leitura). */
export async function apurarLimites(db: Conexao, agora: Date = new Date()): Promise<Apuracao> {
  const ano = anoEmBrasilia(agora);
  const inicio = `${ano}-01-01`;
  const fim = `${ano + 1}-01-01`;
  const [perfis, contas] = [await lerPerfis(db), await lerContas(db)];
  // Mesmas condições da "Receita realizada" (tax-router#linhasDaReceitaRealizada) + fora o combinado em outra cobrança.
  const receitas: ReceitaParaSoma[] = linhas(await db.execute(sql`
    SELECT l.id, l.tipo::text AS tipo, l.valor, l.descricao, l.categoria, l.pago_em, bt.account_id, bt.descricao AS tx_descricao
    FROM bpo_lancamentos l LEFT JOIN bank_transactions bt ON bt.id = l.bank_transaction_id
    WHERE l.tipo <> 'despesa' AND l.pago = true AND l.a_classificar = false AND l.combinada_em_id IS NULL AND l.exclusao_lote_backup_id IS NULL
      AND l.pago_em >= ${inicio}::timestamp AND l.pago_em < ${fim}::timestamp`))
    .map(r => ({ lancamentoId: Number(r.id), contaId: r.account_id == null ? null : Number(r.account_id), tipo: String(r.tipo), valorCentavos: centavos(r.valor),
      descricao: txt(r.descricao), categoria: txt(r.categoria), pagoEm: data(r.pago_em), txDescricao: txt(r.tx_descricao) }));
  const folga = `${Math.ceil(JANELA_TRANSFERENCIA_MS / 86_400_000)} days`;
  const debitos: DebitoParaSoma[] = linhas(await db.execute(sql`
    SELECT bt.id, bt.account_id, bt.valor, bt.data FROM bank_transactions bt JOIN bank_accounts ba ON ba.id = bt.account_id
    WHERE bt.tipo = 'debito' AND ba.empresa_cnpj IS NOT NULL
      AND bt.data >= (${inicio}::timestamp - ${folga}::interval) AND bt.data < (${fim}::timestamp + ${folga}::interval)`))
    .map(r => ({ txId: Number(r.id), contaId: Number(r.account_id), valorCentavos: Math.abs(centavos(r.valor)), data: data(r.data) }));
  return apurarReceitas({ agora, perfis, contas, receitas, debitos });
}
