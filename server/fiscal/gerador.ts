// EPIC-029 S-2 (22/11/2026) — gerador de rascunhos de nota por VARREDURA IDEMPOTENTE (DIAGNOSTICO.md §3.2, opção C).
//
// Um só lugar lê as origens que o sistema já registra e cria UM rascunho "A_DECIDIR" por origem
// (INSERT … ON CONFLICT (origem_tipo, origem_id) DO NOTHING). Rodar 1 ou 100 vezes dá o mesmo resultado.
// - Só eventos a partir da data de corte (`fiscal_config.inicio_em`, padrão: 1º dia do mês corrente em Brasília).
// - Regra contra nota em dobro (§3.1): recebimento de obra/regularização ligado a um lançamento do BPO é a origem; o
//   lançamento fica "coberto" e não gera rascunho próprio (e vice-versa: se o lançamento já tinha rascunho, o módulo não
//   gera outro).
// - Tipo de serviço "nunca_gerar" não cria rascunho. Não existe regra "automático" (decisão h).
// - Origem cancelada/estornada depois: o rascunho volta a "A_DECIDIR" com alerta — nunca é apagado.
// - Nada sai do sistema: só leitura das tabelas de origem e escrita nas tabelas fiscal_*. Nenhum dado pessoal em log.
import { and, eq, sql } from "drizzle-orm";
import { fiscalConfig, fiscalEmissores, fiscalNotas, fiscalTiposServico } from "../../drizzle/schema-fiscal.js";
import {
  escolherTipoServico,
  inicioDoDiaEmBrasilia,
  motivoSugerido,
  primeiroDiaDoMesEmBrasilia,
  type OrigemNota,
} from "../../shared/fiscal/origens.js";
import type { DrizzleDb } from "../db.js";

type Linha = Record<string, unknown>;
const linhas = (r: unknown): Linha[] => (r as { rows?: Linha[] }).rows ?? [];

/** Máximo de rascunhos novos por origem numa passada (a próxima passada continua; cabe no tempo da função). */
export const LIMITE_POR_ORIGEM = 500;

export const ALERTA_ORIGEM_CANCELADA =
  "A origem deste rascunho foi cancelada, estornada ou deixou de contar como receita depois que ele foi criado. Confira antes de decidir.";

export type ResultadoVarredura = {
  executou: boolean;
  motivo?: "desligado";
  inicioEm: string;
  criados: Record<OrigemNota, number>;
  ignoradosNuncaGerar: number;
  alertados: number;
};

/** Data AAAA-MM-DD em Brasília de um instante. */
export function dataEmBrasilia(valor: unknown): string {
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  const d = valor instanceof Date ? valor : new Date(String(valor));
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Lê a configuração; na primeira vez grava a padrão (desligado, corte = 1º dia do mês corrente). */
export async function carregarConfigFiscal(db: DrizzleDb, agora: Date = new Date()) {
  await db.insert(fiscalConfig).values({ id: true, ligado: false, inicioEm: primeiroDiaDoMesEmBrasilia(agora) }).onConflictDoNothing();
  const [config] = await db.select().from(fiscalConfig).where(eq(fiscalConfig.id, true)).limit(1);
  return config!;
}

type Candidato = {
  origemTipo: OrigemNota;
  origemId: number;
  subtipo: string | null;
  dataEvento: string;
  bpoClientId: number | null;
  leadId: number | null;
  obraId: number | null;
  leadServiceId: number | null;
};

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const txt = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

async function candidatos(db: DrizzleDb, inicioData: string, inicioInstante: Date): Promise<Candidato[]> {
  const semNota = (tipo: OrigemNota, coluna: string) =>
    sql.raw(`NOT EXISTS (SELECT 1 FROM fiscal_notas n WHERE n.origem_tipo = '${tipo}' AND n.origem_id = ${coluna})`);
  const lancamentoJaTemNota = (coluna: string) =>
    sql.raw(`(${coluna} IS NULL OR NOT EXISTS (SELECT 1 FROM fiscal_notas n WHERE n.origem_tipo = 'bpo_lancamento' AND n.origem_id = ${coluna}))`);
  const limite = sql.raw(String(LIMITE_POR_ORIGEM));
  const instante = inicioInstante.toISOString();
  const lista: Candidato[] = [];

  // 1) Recebimentos da obra (parcela da Caixa e entrada), confirmados. Município = o da obra.
  for (const r of linhas(await db.execute(sql`
    SELECT om.id, om.natureza AS subtipo, om.data::text AS data, cp.id AS obra_id, cp.lead_id, cp.lead_service_id, l.cliente_id
    FROM obra_movimentos om
    JOIN construction_projects cp ON cp.id = om.project_id
    LEFT JOIN bpo_lancamentos l ON l.id = om.bpo_lancamento_id
    WHERE om.natureza IN ('recebimento_cef', 'entrada') AND om.status = 'confirmado' AND om.data >= ${inicioData}::date
      AND ${semNota("obra_movimento", "om.id")} AND ${lancamentoJaTemNota("om.bpo_lancamento_id")}
    ORDER BY om.id LIMIT ${limite}`))) {
    lista.push({ origemTipo: "obra_movimento", origemId: Number(r.id), subtipo: txt(r.subtipo), dataEvento: dataEmBrasilia(r.data),
      bpoClientId: num(r.cliente_id), leadId: num(r.lead_id), obraId: num(r.obra_id), leadServiceId: num(r.lead_service_id) });
  }

  // 2) Recebimentos de regularização confirmados (itens de repasse nascem com motivo sugerido).
  for (const r of linhas(await db.execute(sql`
    SELECT rr.id, i.chave_padrao AS subtipo, rr.data::text AS data, g.lead_id, g.lead_service_id, l.cliente_id
    FROM regularizacao_recebimentos rr
    JOIN regularizacoes g ON g.id = rr.regularizacao_id
    LEFT JOIN regularizacao_itens_financeiros i ON i.id = rr.item_id
    LEFT JOIN bpo_lancamentos l ON l.id = rr.bpo_lancamento_id
    WHERE rr.status = 'confirmado' AND rr.data >= ${inicioData}::date
      AND ${semNota("regularizacao_recebimento", "rr.id")} AND ${lancamentoJaTemNota("rr.bpo_lancamento_id")}
    ORDER BY rr.id LIMIT ${limite}`))) {
    lista.push({ origemTipo: "regularizacao_recebimento", origemId: Number(r.id), subtipo: txt(r.subtipo), dataEvento: dataEmBrasilia(r.data),
      bpoClientId: num(r.cliente_id), leadId: num(r.lead_id), obraId: null, leadServiceId: num(r.lead_service_id) });
  }

  // 3) Avaliações entregues com valor de serviço.
  for (const r of linhas(await db.execute(sql`
    SELECT a.id, a.tipo AS subtipo, COALESCE(a.data_entrega, a.updated_at) AS quando, a.lead_id, a.lead_service_id
    FROM avaliacoes a
    WHERE a.status = 'entregue' AND a.valor_servico > 0 AND COALESCE(a.data_entrega, a.updated_at) >= ${instante}::timestamptz
      AND ${semNota("avaliacao", "a.id")}
    ORDER BY a.id LIMIT ${limite}`))) {
    lista.push({ origemTipo: "avaliacao", origemId: Number(r.id), subtipo: txt(r.subtipo), dataEvento: dataEmBrasilia(r.quando),
      bpoClientId: null, leadId: num(r.lead_id), obraId: null, leadServiceId: num(r.lead_service_id) });
  }

  // 4) Comissão da EMPRESA paga (comissão de corretor é despesa: não entra).
  for (const r of linhas(await db.execute(sql`
    SELECT c.id, c.business_type AS subtipo, c.paid_at, c.construction_project_id AS obra_id, cp.lead_id, cp.lead_service_id
    FROM operational_commissions c
    LEFT JOIN construction_projects cp ON cp.id = c.construction_project_id
    WHERE c.beneficiary = 'empresa' AND c.status = 'paga' AND c.paid_at >= ${instante}::timestamptz
      AND ${semNota("comissao_empresa", "c.id")}
    ORDER BY c.id LIMIT ${limite}`))) {
    lista.push({ origemTipo: "comissao_empresa", origemId: Number(r.id), subtipo: txt(r.subtipo), dataEvento: dataEmBrasilia(r.paid_at),
      bpoClientId: null, leadId: num(r.lead_id), obraId: num(r.obra_id), leadServiceId: num(r.lead_service_id) });
  }

  // 5) Lançamentos do BPO recebidos (honorário, receita; reembolso com motivo sugerido), válidos e NÃO cobertos por
  //    recebimento de obra/regularização (esses já são a origem). Por último: o módulo tem prioridade na mesma passada.
  for (const r of linhas(await db.execute(sql`
    SELECT l.id, l.tipo::text AS subtipo, l.pago_em, l.cliente_id, bc.lead_id
    FROM bpo_lancamentos l
    LEFT JOIN bpo_clients bc ON bc.id = l.cliente_id
    WHERE l.tipo IN ('honorario', 'receita', 'reembolso') AND l.pago = true AND l.a_classificar = false
      AND l.combinada_em_id IS NULL AND l.exclusao_lote_backup_id IS NULL AND l.pago_em >= ${instante}::timestamptz
      AND ${semNota("bpo_lancamento", "l.id")}
      AND NOT EXISTS (SELECT 1 FROM obra_movimentos om WHERE om.bpo_lancamento_id = l.id AND om.status = 'confirmado')
      AND NOT EXISTS (SELECT 1 FROM regularizacao_recebimentos rr WHERE rr.bpo_lancamento_id = l.id AND rr.status = 'confirmado')
    ORDER BY l.id LIMIT ${limite}`))) {
    lista.push({ origemTipo: "bpo_lancamento", origemId: Number(r.id), subtipo: txt(r.subtipo), dataEvento: dataEmBrasilia(r.pago_em),
      bpoClientId: num(r.cliente_id), leadId: num(r.lead_id), obraId: null, leadServiceId: null });
  }
  return lista;
}

/** Condição "a origem ainda vale" de cada tipo (o contrário vira alerta no rascunho). */
const ORIGEM_VALIDA: Record<OrigemNota, string> = {
  bpo_lancamento: `SELECT 1 FROM bpo_lancamentos t WHERE t.id = n.origem_id AND t.pago = true AND t.a_classificar = false
    AND t.combinada_em_id IS NULL AND t.exclusao_lote_backup_id IS NULL AND t.tipo <> 'despesa'`,
  obra_movimento: `SELECT 1 FROM obra_movimentos t WHERE t.id = n.origem_id AND t.status = 'confirmado'`,
  regularizacao_recebimento: `SELECT 1 FROM regularizacao_recebimentos t WHERE t.id = n.origem_id AND t.status = 'confirmado'`,
  avaliacao: `SELECT 1 FROM avaliacoes t WHERE t.id = n.origem_id AND t.status = 'entregue' AND t.valor_servico > 0`,
  comissao_empresa: `SELECT 1 FROM operational_commissions t WHERE t.id = n.origem_id AND t.status = 'paga' AND t.beneficiary = 'empresa'`,
};

async function alertarOrigensCanceladas(db: DrizzleDb): Promise<number> {
  let total = 0;
  for (const [tipo, valida] of Object.entries(ORIGEM_VALIDA)) {
    const r = await db.execute(sql`
      UPDATE fiscal_notas n SET status = 'A_DECIDIR', motivo_sem_nota = NULL, motivo_texto = NULL, adiada_ate = NULL,
        alerta = ${ALERTA_ORIGEM_CANCELADA}, versao = n.versao + 1, atualizado_por = NULL, alterado_via = 'sistema'
      WHERE n.origem_tipo = ${tipo} AND n.status IN ('A_DECIDIR', 'ADIADA', 'SEM_NOTA') AND n.alerta IS NULL
        AND NOT EXISTS (${sql.raw(valida)})
      RETURNING n.id`);
    total += linhas(r).length;
  }
  return total;
}

/**
 * Varre as origens e cria os rascunhos que faltam. `origem: "cron"` só roda com o gerador LIGADO na aba;
 * `origem: "botao"` (botão "Atualizar", só admin) roda sempre — é um pedido explícito.
 */
export async function gerarRascunhos(
  db: DrizzleDb,
  opcoes: { origem: "cron" | "botao"; agora?: Date },
): Promise<ResultadoVarredura> {
  const agora = opcoes.agora ?? new Date();
  const config = await carregarConfigFiscal(db, agora);
  const criados: Record<OrigemNota, number> = {
    bpo_lancamento: 0, obra_movimento: 0, regularizacao_recebimento: 0, avaliacao: 0, comissao_empresa: 0,
  };
  if (opcoes.origem === "cron" && !config.ligado) {
    return { executou: false, motivo: "desligado", inicioEm: config.inicioEm, criados, ignoradosNuncaGerar: 0, alertados: 0 };
  }

  const tipos = await db.select().from(fiscalTiposServico).where(eq(fiscalTiposServico.ativo, true)).orderBy(fiscalTiposServico.id);
  const emissores = await db.select({ id: fiscalEmissores.id }).from(fiscalEmissores).where(eq(fiscalEmissores.ativo, true));
  const emissorUnico = emissores.length === 1 ? emissores[0]!.id : null;

  let ignoradosNuncaGerar = 0;
  const novos: (typeof fiscalNotas.$inferInsert)[] = [];
  for (const c of await candidatos(db, config.inicioEm, inicioDoDiaEmBrasilia(config.inicioEm))) {
    const tipo = escolherTipoServico(tipos, c.origemTipo, c.subtipo);
    if (tipo?.regra === "nunca_gerar") { ignoradosNuncaGerar++; continue; }
    novos.push({
      origemTipo: c.origemTipo,
      origemId: c.origemId,
      origemSubtipo: c.subtipo?.slice(0, 40) ?? null,
      dataEvento: c.dataEvento,
      bpoClientId: c.bpoClientId,
      leadId: c.leadId,
      obraId: c.obraId,
      leadServiceId: c.leadServiceId,
      tipoServicoId: tipo?.id ?? null,
      emissorId: tipo?.emissorId ?? emissorUnico,
      motivoSugerido: motivoSugerido(c.origemTipo, c.subtipo),
      status: "A_DECIDIR",
      alteradoVia: "sistema",
    });
  }
  for (let i = 0; i < novos.length; i += 100) {
    const lote = novos.slice(i, i + 100);
    const inseridos = await db.insert(fiscalNotas).values(lote)
      .onConflictDoNothing({ target: [fiscalNotas.origemTipo, fiscalNotas.origemId] })
      .returning({ origemTipo: fiscalNotas.origemTipo });
    for (const n of inseridos) criados[n.origemTipo]++;
  }

  const alertados = await alertarOrigensCanceladas(db);
  await db.update(fiscalConfig).set({ ultimaVarreduraEm: agora }).where(and(eq(fiscalConfig.id, true)));
  return { executou: true, inicioEm: config.inicioEm, criados, ignoradosNuncaGerar, alertados };
}

/** Para os crons que JÁ existem (sem cron novo): nunca lança nem muda a resposta do cron; log sem dado pessoal. */
export async function gerarRascunhosNoCron(db: () => DrizzleDb): Promise<{ criados: number } | { erro: true } | { desligado: true }> {
  try {
    const r = await gerarRascunhos(db(), { origem: "cron" });
    if (!r.executou) return { desligado: true };
    return { criados: Object.values(r.criados).reduce((a, b) => a + b, 0) };
  } catch (e) {
    console.error("[cron/fiscal-rascunhos]", e instanceof Error ? e.name : "falha");
    return { erro: true };
  }
}
