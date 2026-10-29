import { sql } from "drizzle-orm";
import { getDb } from "./db.js";

export type PreviaLimpezaConta = {
  contaId: number;
  contaRotulo: string;
  transacoes: number;
  lancamentosRemovidos: number;
  lancamentosPreservados: number;
  vinculosOperacionais: number;
};

const primeira = <T>(resultado: { rows?: unknown[] }): T | null => (resultado.rows?.[0] as T | undefined) ?? null;

export async function previaLimpezaConta(contaId: number): Promise<PreviaLimpezaConta> {
  const resultado = await getDb().execute(sql`
    SELECT a.id AS "contaId", concat_ws(' · ', a.banco, nullif(a.conta, '')) AS "contaRotulo",
      count(DISTINCT t.id)::int AS transacoes,
      count(DISTINCT l.id) FILTER (WHERE l.id IS NOT NULL AND l.asaas_payment_id IS NULL
        AND l.origem_efetiva = 'extrato' AND l.vinculo_operacional_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM obra_movimentos om WHERE om.bpo_lancamento_id = l.id)
        AND NOT EXISTS (SELECT 1 FROM regularizacao_recebimentos rr WHERE rr.bpo_lancamento_id = l.id))::int AS "lancamentosRemovidos",
      count(DISTINCT l.id) FILTER (WHERE l.id IS NOT NULL AND (l.asaas_payment_id IS NOT NULL
        OR l.origem_efetiva <> 'extrato' OR l.vinculo_operacional_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM obra_movimentos om WHERE om.bpo_lancamento_id = l.id)
        OR EXISTS (SELECT 1 FROM regularizacao_recebimentos rr WHERE rr.bpo_lancamento_id = l.id)))::int AS "lancamentosPreservados",
      count(DISTINCT l.id) FILTER (WHERE l.id IS NOT NULL AND (
        EXISTS (SELECT 1 FROM obra_movimentos om WHERE om.bpo_lancamento_id = l.id)
        OR EXISTS (SELECT 1 FROM regularizacao_recebimentos rr WHERE rr.bpo_lancamento_id = l.id)))::int AS "vinculosOperacionais"
    FROM bank_accounts a
    LEFT JOIN bank_transactions t ON t.account_id = a.id
    LEFT JOIN bpo_lancamentos l ON l.bank_transaction_id = t.id
    WHERE a.id = ${contaId}
    GROUP BY a.id, a.banco, a.conta
  `);
  const row = primeira<PreviaLimpezaConta>(resultado);
  if (!row) throw new Error("Conta bancária não encontrada.");
  return row;
}

/**
 * Um único comando SQL garante backup, desvinculação das receitas legítimas e limpeza atômica.
 * A credencial criptografada da conta é deliberadamente excluída do snapshot.
 */
export async function limparContaComBackup(contaId: number, confirmarRotulo: string, userId: number) {
  const previa = await previaLimpezaConta(contaId);
  if (confirmarRotulo.trim() !== previa.contaRotulo) throw new Error("Digite exatamente o nome da conta exibido para confirmar a limpeza.");
  const resultado = await getDb().execute(sql`
    WITH conta AS (
      SELECT id, banco, agencia, conta, tipo, descricao, saldo_atual, ativo, pluggy_item_id,
        pluggy_account_id, webhook_url, ultima_sincronizacao, provedor, data_inicial,
        ultimo_erro, saldo_fonte, created_at
      FROM bank_accounts WHERE id = ${contaId}
    ), movimentos AS (
      SELECT t.* FROM bank_transactions t JOIN conta a ON a.id = t.account_id
    ), lancamentos AS (
      SELECT l.*,
        (l.asaas_payment_id IS NOT NULL OR l.origem_efetiva <> 'extrato' OR l.vinculo_operacional_id IS NOT NULL
          OR EXISTS (SELECT 1 FROM obra_movimentos om WHERE om.bpo_lancamento_id = l.id)
          OR EXISTS (SELECT 1 FROM regularizacao_recebimentos rr WHERE rr.bpo_lancamento_id = l.id)) AS preservar
      FROM bpo_lancamentos l JOIN movimentos t ON t.id = l.bank_transaction_id
    ), backup AS (
      INSERT INTO bpo_conta_limpeza_backups
        (conta_referencia, conta_rotulo, snapshot_json, transacoes, lancamentos_removidos,
         lancamentos_preservados, criado_por_user_id)
      SELECT a.id, concat_ws(' · ', a.banco, nullif(a.conta, '')),
        jsonb_build_object(
          'conta', to_jsonb(a),
          'transacoes', COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM movimentos m), '[]'::jsonb),
          'lancamentos', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM lancamentos l), '[]'::jsonb)
        )::text,
        (SELECT count(*) FROM movimentos)::int,
        (SELECT count(*) FROM lancamentos WHERE NOT preservar)::int,
        (SELECT count(*) FROM lancamentos WHERE preservar)::int,
        ${userId}
      FROM conta a RETURNING id
    ), preservados AS (
      UPDATE bpo_lancamentos l SET bank_transaction_id = NULL,
        origem_efetiva = CASE WHEN l.asaas_payment_id IS NOT NULL THEN 'asaas' ELSE l.origem_efetiva END,
        updated_at = now(), version = version + 1
      WHERE l.id IN (SELECT id FROM lancamentos WHERE preservar)
      RETURNING l.id
    ), removida AS (
      DELETE FROM bank_accounts a WHERE a.id = ${contaId}
        AND (SELECT count(*) FROM backup) = 1
        AND (SELECT count(*) FROM preservados) >= 0
      RETURNING a.id
    )
    SELECT (SELECT id FROM backup)::int AS "backupId",
      (SELECT count(*) FROM removida)::int AS removidas,
      ${previa.transacoes}::int AS transacoes,
      ${previa.lancamentosRemovidos}::int AS "lancamentosRemovidos",
      ${previa.lancamentosPreservados}::int AS "lancamentosPreservados"
  `);
  const row = primeira<{ backupId: number; removidas: number; transacoes: number; lancamentosRemovidos: number; lancamentosPreservados: number }>(resultado);
  if (!row?.removidas) throw new Error("A conta mudou durante a confirmação. Atualize a prévia e tente novamente.");
  return row;
}

export type EdicaoLancamento = {
  id: number; version: number; motivo: string; descricao: string; valor: number;
  categoria: string; clienteId?: number | null; clienteNomeLivre?: string | null;
  vencimento: Date; competencia: string; centroCustos?: string | null; observacoes?: string | null;
  categoriaOperacional?: string | null; vinculoOperacionalId?: string | null; vinculoOperacionalRotulo?: string | null;
  tipoDespesaObra?: string | null; etapaObra?: string | null;
};

export async function editarLancamentoAuditavel(input: EdicaoLancamento, userId: number) {
  const resultado = await getDb().execute(sql`
    WITH anterior AS (
      SELECT * FROM bpo_lancamentos WHERE id = ${input.id} AND version = ${input.version}
        AND valor_recebido <= ${input.valor.toFixed(2)} FOR UPDATE
    ), atualizado AS (
      UPDATE bpo_lancamentos l SET
        descricao = ${input.descricao}, valor = ${input.valor.toFixed(2)}, categoria = ${input.categoria},
        cliente_id = ${input.clienteId ?? null}, cliente_nome_livre = ${input.clienteId ? null : input.clienteNomeLivre ?? null},
        vencimento = ${input.vencimento}, competencia = ${input.competencia},
        centro_custos = ${input.centroCustos === undefined ? sql`l.centro_custos` : input.centroCustos},
        observacoes = ${input.observacoes ?? null}, version = l.version + 1, updated_at = now(),
        pago = CASE WHEN l.valor_recebido > 0 THEN l.valor_recebido = ${input.valor.toFixed(2)} ELSE l.pago END,
        categoria_operacional = ${input.categoriaOperacional ?? null}, vinculo_operacional_id = ${input.vinculoOperacionalId ?? null},
        vinculo_operacional_rotulo = ${input.vinculoOperacionalRotulo ?? null},
        tipo_despesa_obra = ${input.tipoDespesaObra ?? null}, etapa_obra = ${input.etapaObra ?? null}
      FROM anterior a WHERE l.id = a.id RETURNING l.*
    ), auditoria AS (
      INSERT INTO bpo_lancamento_historico
        (lancamento_id, lancamento_referencia, versao_anterior, alterado_por_user_id, motivo, antes_json, depois_json)
      SELECT u.id, a.id, a.version, ${userId}, ${input.motivo}, to_jsonb(a)::text, to_jsonb(u)::text
      FROM anterior a JOIN atualizado u ON u.id = a.id RETURNING id
    )
    SELECT u.*, EXISTS(SELECT 1 FROM auditoria) AS auditado FROM atualizado u
  `);
  const row = primeira<Record<string, unknown>>(resultado);
  if (!row) throw new Error("O lançamento foi alterado por outra pessoa. Atualize a tela antes de salvar novamente.");
  return row;
}
