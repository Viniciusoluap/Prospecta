// EPIC-029 S-6 (22/11/2026) — leitura dos dados da soma de receitas por empresa (aba Contabilidade, aviso e leitura da Dolores).
// SÓ LEITURA: perfis tributários, contas bancárias, lançamentos pagos do ano e as saídas (para casar transferências entre contas da
// mesma empresa). A conta em si é pura (shared/fiscal/regimes.ts#apurarReceitas). Nenhum dado pessoal sai daqui: só nomes de empresa,
// apelidos de conta e valores.
import { sql } from "drizzle-orm";
import {
  JANELA_TRANSFERENCIA_MS, anoEmBrasilia, apurarReceitas, cnpjDaEmpresa, type Apuracao, type ContaParaSoma, type CreditoPendente, type DebitoParaSoma,
  type EntradaDaSoma, type PerfilParaRegime, type ReceitaParaSoma,
} from "../../shared/fiscal/regimes.js";

type Linha = Record<string, unknown>;
type Conexao = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };
const linhas = (r: unknown): Linha[] => (r as { rows?: Linha[] }).rows ?? [];
const centavos = (v: unknown) => Math.round(Number(v ?? 0) * 100);
const data = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));
const txt = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/**
 * Tabelas opcionais (de outras migrações) que a leitura usa se existirem. Conferir ANTES evita um erro que abortaria a transação SOMENTE
 * LEITURA da Dolores (bancos de teste antigos não têm todas).
 */
async function tabelasOpcionais(db: Conexao): Promise<{ historico: boolean; recebimentos: boolean; marcacoes: boolean; apelido: boolean; empresaCnpj: boolean }> {
  const [r] = linhas(await db.execute(sql`
    SELECT to_regclass('tax_profiles_historico') IS NOT NULL AS historico, to_regclass('bpo_recebimentos') IS NOT NULL AS recebimentos,
      to_regclass('bpo_transferencia_marcacoes') IS NOT NULL AS marcacoes,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bank_accounts' AND column_name = 'apelido') AS apelido,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bank_accounts' AND column_name = 'empresa_cnpj') AS empresa_cnpj`));
  return { historico: Boolean(r?.historico), recebimentos: Boolean(r?.recebimentos), marcacoes: Boolean(r?.marcacoes), apelido: Boolean(r?.apelido),
    empresaCnpj: Boolean(r?.empresa_cnpj) };
}

/** S-6 × S-8: o banco já tem a conta por empresa (coluna `bank_accounts.empresa_cnpj`, migração 0164)? */
export async function temContaPorEmpresa(db: Conexao): Promise<boolean> {
  return (await tabelasOpcionais(db)).empresaCnpj;
}

/** QA3 S-6 (Q3): quem marcou a movimentação como Transferência interna (última marcação auditada; null = sem registro). */
const ultimaMarcacao = (btId: ReturnType<typeof sql>) =>
  sql`FROM bpo_transferencia_marcacoes m LEFT JOIN users u ON u.id = m.usuario_id WHERE m.bank_transaction_id = ${btId} ORDER BY m.criado_em DESC, m.id DESC LIMIT 1`;
const quemMarcou = (temMarcacoes: boolean, btId: ReturnType<typeof sql>) => temMarcacoes
  ? sql`(SELECT CASE WHEN m.usuario_id IS NULL THEN 'automática (' || m.via || ')' ELSE coalesce(nullif(btrim(u.name), ''), 'usuário #' || m.usuario_id) END
      ${ultimaMarcacao(btId)})`
  : sql`NULL::text`;
/** QA4 S-6 (R4): quando foi a última marcação auditada (null = sem registro). */
const quandoMarcou = (temMarcacoes: boolean, btId: ReturnType<typeof sql>) => temMarcacoes
  ? sql`(SELECT m.criado_em ${ultimaMarcacao(btId)})`
  : sql`NULL::timestamptz`;
const instante = (v: unknown): Date | null => (v === null || v === undefined || v === "" ? null : data(v));

/** Versões dos perfis tributários com CNPJ (para o regime vigente na data), com a última desativação do histórico (QA2 S-6, N4). */
export async function lerPerfis(db: Conexao): Promise<PerfilParaRegime[]> {
  const { historico } = await tabelasOpcionais(db);
  const desativacao = historico
    ? sql`(SELECT h.acao FROM tax_profiles_historico h WHERE h.profile_id = t.id AND h.acao IN ('desativado', 'desativado_por_nova_versao')
        ORDER BY h.criado_em DESC, h.id DESC LIMIT 1)`
    : sql`NULL::text`;
  return linhas(await db.execute(sql`
    SELECT t.id, t.company_name, t.cnpj, t.regime, t.effective_from, t.effective_to, t.is_active, ${desativacao} AS desativacao
    FROM tax_profiles t WHERE coalesce(t.cnpj, '') <> ''`))
    .map(r => ({ id: Number(r.id), companyName: String(r.company_name), cnpj: cnpjDaEmpresa(String(r.cnpj)), regime: String(r.regime),
      effectiveFrom: data(r.effective_from), effectiveTo: r.effective_to == null ? null : data(r.effective_to), isActive: Boolean(r.is_active),
      desativacao: r.desativacao === "desativado" ? "manual" as const : r.desativacao === "desativado_por_nova_versao" ? "nova_versao" as const : null }))
    .filter(p => p.cnpj);
}

export async function lerContas(db: Conexao): Promise<ContaParaSoma[]> {
  // S-8 (junção): banco de teste/antigo só com parte da 0164 — a coluna que falta vem nula
  const { apelido, empresaCnpj } = await tabelasOpcionais(db);
  return linhas(await db.execute(sql`SELECT id, banco, ${apelido ? sql`apelido` : sql`NULL::text AS apelido`}, descricao, conta,
    ${empresaCnpj ? sql`empresa_cnpj` : sql`NULL::text AS empresa_cnpj`}, ativo FROM bank_accounts ORDER BY id`))
    .map(r => ({ id: Number(r.id), banco: String(r.banco), apelido: txt(r.apelido), descricao: txt(r.descricao), conta: txt(r.conta),
      empresaCnpj: txt(r.empresa_cnpj), ativo: Boolean(r.ativo) }));
}

/**
 * Começo do ano em Brasília, como instante UTC sem fuso (as colunas são `timestamp` gravadas em UTC). QA S-6: o corte do ano é à meia-noite
 * de Brasília (03:00 UTC), e não à meia-noite UTC — o recebimento das 22h de 31/12 em Brasília é do ano que termina.
 */
export function inicioDoAnoEmBrasilia(ano: number): string {
  // Brasília sem horário de verão desde 2019: -03:00. A conta pelo Intl confere o deslocamento do dia (sem depender do fuso do servidor).
  const meioDia = new Date(Date.UTC(ano, 0, 1, 12));
  const horaLocal = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" }).format(meioDia));
  const deslocamentoHoras = 12 - horaLocal; // 3 em Brasília
  return new Date(Date.UTC(ano, 0, 1, deslocamentoHoras)).toISOString().replace("T", " ").replace("Z", "");
}

/** Soma do ano corrente (Brasília) por empresa. `db`: a conexão normal ou a de leitura da Dolores (transação somente leitura). */
export async function apurarLimites(db: Conexao, agora: Date = new Date()): Promise<Apuracao> {
  const ano = anoEmBrasilia(agora);
  const dados = await lerDadosDaSoma(db, inicioDoAnoEmBrasilia(ano), inicioDoAnoEmBrasilia(ano + 1));
  return apurarReceitas({ agora, ...dados });
}

/**
 * EPIC-029 S-6 × S-8: a mesma apuração numa janela QUALQUER (instantes UTC sem fuso, `inicio` incluso e `fim` excluso) — é a fonte de
 * receita do RBT12 (server/fiscal/simples.ts#fonteReceitaDaApuracao). Devolve a apuração e, por empresa (raiz), cada entrada somada
 * (para não contar duas vezes o que já está numa nota emitida) e os créditos pendentes (a classificar ou com diferença do extrato).
 */
export async function apurarPeriodo(db: Conexao, inicio: string, fim: string, agora: Date): Promise<{
  apuracao: Apuracao; somadas: Map<string, EntradaDaSoma[]>; pendentes: Map<string, CreditoPendente[]>;
}> {
  const dados = await lerDadosDaSoma(db, inicio, fim);
  const somadas = new Map<string, EntradaDaSoma[]>();
  const apuracao = apurarReceitas({ agora, ...dados, filtrarAno: false,
    aoSomar: (raiz, r) => { (somadas.get(raiz) ?? somadas.set(raiz, []).get(raiz)!).push(r); } });
  const raizDaConta = new Map(dados.contas.map(c => [c.id, c.empresaCnpj ? cnpjDaEmpresa(c.empresaCnpj).slice(0, 8) : ""]));
  const pendentes = new Map<string, CreditoPendente[]>();
  for (const c of dados.pendentes) {
    const raiz = raizDaConta.get(c.contaId);
    if (raiz) (pendentes.get(raiz) ?? pendentes.set(raiz, []).get(raiz)!).push(c);
  }
  return { apuracao, somadas, pendentes };
}

/** Leitura (só SELECT) de tudo o que a soma usa, na janela [inicio, fim). */
async function lerDadosDaSoma(db: Conexao, inicio: string, fim: string): Promise<{
  perfis: PerfilParaRegime[]; contas: ContaParaSoma[]; receitas: ReceitaParaSoma[]; debitos: DebitoParaSoma[]; pendentes: CreditoPendente[];
  financeiro: { receitaCentavos: number; lancamentos: number };
}> {
  const [perfis, contas] = [await lerPerfis(db), await lerContas(db)];
  const { recebimentos: temRecebimentos, marcacoes: temMarcacoes } = await tabelasOpcionais(db);
  // QA2 S-6 (N2): baixa pela "divisão de pagamentos" (1 crédito → N cobranças, bpo_recebimentos.bank_transaction_id). A parte quitada pelo
  // banco entra pela CONTA do crédito (uma linha por baixa, na data dela); o resto da cobrança paga (baixa manual) fica sem conta. Nunca soma
  // a mesma cobrança duas vezes. Cobrança com movimentação própria (bank_transaction_id) não usa as baixas.
  const pagoPeloBanco = temRecebimentos
    ? sql`CASE WHEN l.bank_transaction_id IS NULL THEN (SELECT coalesce(sum(r.valor), 0) FROM bpo_recebimentos r JOIN bank_transactions rbt ON rbt.id = r.bank_transaction_id
        WHERE r.lancamento_id = l.id AND rbt.tipo = 'credito') ELSE 0 END`
    : sql`0`;
  const condicoes = sql`l.tipo <> 'despesa' AND l.a_classificar = false AND l.combinada_em_id IS NULL AND l.exclusao_lote_backup_id IS NULL`;
  // Mesmas condições da "Receita realizada" (tax-router#linhasDaReceitaRealizada) + fora o combinado em outra cobrança.
  const receitas: ReceitaParaSoma[] = linhas(await db.execute(sql`
    SELECT l.id, l.tipo::text AS tipo, l.valor - ${pagoPeloBanco} AS valor, l.descricao, l.categoria, l.pago_em, bt.account_id, bt.descricao AS tx_descricao,
      coalesce(bt.categoria, '') = 'Transferência interna' AS marcada, ${quemMarcou(temMarcacoes, sql`bt.id`)} AS marcada_por,
      ${quandoMarcou(temMarcacoes, sql`bt.id`)} AS marcada_em
    FROM bpo_lancamentos l LEFT JOIN bank_transactions bt ON bt.id = l.bank_transaction_id
    WHERE ${condicoes} AND l.pago = true AND l.pago_em >= ${inicio}::timestamp AND l.pago_em < ${fim}::timestamp`))
    .map(r => ({ lancamentoId: Number(r.id), contaId: r.account_id == null ? null : Number(r.account_id), tipo: String(r.tipo), valorCentavos: centavos(r.valor),
      descricao: txt(r.descricao), categoria: txt(r.categoria), pagoEm: data(r.pago_em), txDescricao: txt(r.tx_descricao),
      marcadaTransferencia: Boolean(r.marcada) || txt(r.categoria) === "Transferência interna", marcadaPor: txt(r.marcada_por), marcadaEm: instante(r.marcada_em) }));
  // QA3 S-6 (Q1): ENTRADA marcada como Transferência interna (sem lançamento, por definição) — entra como receita marcada: só sai da soma
  // casando com uma saída marcada de outra conta da mesma empresa (apurarReceitas). Sem par, conta. Vale também para a marcação automática
  // da importação (sugerirCategoria): crédito de outro titular nunca é transferência sem par.
  receitas.push(...linhas(await db.execute(sql`
    SELECT bt.id, abs(bt.valor) AS valor, bt.data, bt.account_id, bt.descricao AS tx_descricao, ${quemMarcou(temMarcacoes, sql`bt.id`)} AS marcada_por,
      ${quandoMarcou(temMarcacoes, sql`bt.id`)} AS marcada_em
    FROM bank_transactions bt
    WHERE bt.tipo = 'credito' AND coalesce(bt.categoria, '') = 'Transferência interna' AND bt.data >= ${inicio}::timestamp AND bt.data < ${fim}::timestamp
      AND NOT EXISTS (SELECT 1 FROM bpo_lancamentos l WHERE l.bank_transaction_id = bt.id AND l.exclusao_lote_backup_id IS NULL)`))
    .map(r => ({ lancamentoId: -Number(r.id), contaId: Number(r.account_id), tipo: "receita", valorCentavos: centavos(r.valor), descricao: null,
      categoria: "Transferência interna", pagoEm: data(r.data), txDescricao: txt(r.tx_descricao), marcadaTransferencia: true, marcadaPor: txt(r.marcada_por),
      marcadaEm: instante(r.marcada_em) })));
  if (temRecebimentos) {
    receitas.push(...linhas(await db.execute(sql`
      SELECT l.id, l.tipo::text AS tipo, r.valor, l.descricao, l.categoria, r.recebido_em, rbt.account_id, rbt.descricao AS tx_descricao
      FROM bpo_recebimentos r JOIN bpo_lancamentos l ON l.id = r.lancamento_id JOIN bank_transactions rbt ON rbt.id = r.bank_transaction_id
      WHERE ${condicoes} AND l.bank_transaction_id IS NULL AND rbt.tipo = 'credito'
        AND r.recebido_em >= ${inicio}::timestamp AND r.recebido_em < ${fim}::timestamp`))
      .map(r => ({ lancamentoId: Number(r.id), contaId: Number(r.account_id), tipo: String(r.tipo), valorCentavos: centavos(r.valor),
        descricao: txt(r.descricao), categoria: txt(r.categoria), pagoEm: data(r.recebido_em), txDescricao: txt(r.tx_descricao) })));
  }
  const folga = `${Math.ceil(JANELA_TRANSFERENCIA_MS / 86_400_000)} days`;
  // QA S-6 (A1) e QA2 (N1/N1b): a saída leva a classificação — com lançamento de despesa no BPO, ou que deu baixa em despesas pela divisão
  // de pagamentos, é pagamento; marcada como Transferência interna (na movimentação ou no lançamento) é transferência — a ÚNICA que tira
  // uma entrada da soma; sem lançamento, null (a entrada conta e só fica apontada como "possível transferência").
  const debitos: DebitoParaSoma[] = linhas(await db.execute(sql`
    SELECT bt.id, bt.account_id, bt.valor, bt.data, ${quemMarcou(temMarcacoes, sql`bt.id`)} AS marcada_por, ${quandoMarcou(temMarcacoes, sql`bt.id`)} AS marcada_em,
      CASE
        WHEN coalesce(bt.categoria, '') = 'Transferência interna' OR EXISTS (SELECT 1 FROM bpo_lancamentos ld WHERE ld.bank_transaction_id = bt.id
          AND ld.exclusao_lote_backup_id IS NULL AND coalesce(ld.categoria, '') = 'Transferência interna') THEN 'transferencia'
        WHEN EXISTS (SELECT 1 FROM bpo_lancamentos ld WHERE ld.bank_transaction_id = bt.id AND ld.exclusao_lote_backup_id IS NULL AND ld.tipo = 'despesa') THEN 'despesa'
        ${temRecebimentos ? sql`WHEN EXISTS (SELECT 1 FROM bpo_recebimentos r JOIN bpo_lancamentos ld ON ld.id = r.lancamento_id WHERE r.bank_transaction_id = bt.id
          AND ld.tipo = 'despesa') THEN 'despesa'` : sql``}
        ELSE NULL
      END AS classificacao
    FROM bank_transactions bt JOIN bank_accounts ba ON ba.id = bt.account_id
    WHERE bt.tipo = 'debito' AND ba.empresa_cnpj IS NOT NULL
      AND bt.data >= (${inicio}::timestamp - ${folga}::interval) AND bt.data < (${fim}::timestamp + ${folga}::interval)`))
    .map(r => ({ txId: Number(r.id), contaId: Number(r.account_id), valorCentavos: Math.abs(centavos(r.valor)), data: data(r.data),
      classificacao: r.classificacao === "despesa" ? "despesa" as const : r.classificacao === "transferencia" ? "transferencia" as const : null,
      marcadaPor: txt(r.marcada_por), marcadaEm: instante(r.marcada_em) }));
  // QA S-6 (A6): crédito do ano sem lançamento válido (a classificar, ou que nunca virou lançamento) e que não foi marcado como
  // Transferência interna: pendência com valor (não some da tela nem do aviso).
  // QA2 S-6 (N2): o crédito usado na divisão de pagamentos já está na soma pelas baixas — só a parte NÃO alocada fica pendente.
  // QA4 S-6 (R1/R2): o que o BANCO recebeu nunca sai do limite por edição do lançamento. Do crédito sai só o que os lançamentos ligados a ele
  // já levam para a soma (pagos; combinados em outra cobrança; despesa ligada — esta nunca foi receita). O resto vira pendência com valor:
  // lançamento editado para baixo (a diferença) ou que voltou a "não pago" (o crédito inteiro). Lado seguro: conta pelo maior.
  const alocado = temRecebimentos ? sql`(SELECT coalesce(sum(r.valor), 0) FROM bpo_recebimentos r WHERE r.bank_transaction_id = bt.id)` : sql`0`;
  const valido = sql`l.bank_transaction_id = bt.id AND l.a_classificar = false AND l.exclusao_lote_backup_id IS NULL`;
  const levado = sql`(SELECT coalesce(sum(l.valor), 0) FROM bpo_lancamentos l WHERE ${valido}
    AND (l.pago = true OR l.combinada_em_id IS NOT NULL OR l.tipo = 'despesa'))`;
  const pendentes: CreditoPendente[] = linhas(await db.execute(sql`
    SELECT bt.id, bt.account_id, abs(bt.valor) - ${alocado} - ${levado} AS valor, bt.data,
      EXISTS (SELECT 1 FROM bpo_lancamentos l WHERE ${valido}) AS tem_lancamento
    FROM bank_transactions bt
    WHERE bt.tipo = 'credito' AND coalesce(bt.categoria, '') <> 'Transferência interna'
      AND bt.data >= ${inicio}::timestamp AND bt.data < ${fim}::timestamp`))
    .map(r => ({ txId: Number(r.id), contaId: Number(r.account_id), valorCentavos: centavos(r.valor), data: data(r.data),
      motivo: r.tem_lancamento ? "diferenca" as const : "a_classificar" as const }))
    .filter(c => c.valorCentavos > 0);
  // "Receita realizada" do Financeiro (financial_transactions: entradas e comissões pagas) — sem conta, então sem empresa: pendência.
  const [fin] = linhas(await db.execute(sql`
    SELECT coalesce(sum(amount), 0) AS total, count(*)::int AS n FROM financial_transactions
    WHERE status = 'paid' AND type IN ('income', 'commission') AND paid_at >= ${inicio}::timestamp AND paid_at < ${fim}::timestamp`));
  const financeiro = { receitaCentavos: centavos(fin?.total), lancamentos: Number(fin?.n ?? 0) };
  return { perfis, contas, receitas, debitos, pendentes, financeiro };
}
