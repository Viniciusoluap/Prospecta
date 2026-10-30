import { eq, sql } from "drizzle-orm";
import { getDb } from "./db.js";
import { bpoLancamentos, type BpoLancamento } from "../drizzle/schema.js";
import { exigirNaoCombinada } from "../shared/financeiro/bpo-lote.js";

export async function registrarRecebimento(input: { id: number; requestKey: string; valor: number; recebidoEm: Date; observacoes?: string }, userId: number): Promise<BpoLancamento> {
  const cents = Math.round(input.valor * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || Math.abs(input.valor * 100 - cents) > 0.00001 || !Number.isFinite(input.recebidoEm.getTime())) throw new Error("Valor ou data de recebimento inválido.");
  const valor = (cents / 100).toFixed(2);
  // Única instrução atômica: o driver Neon HTTP não suporta transações interativas.
  const r = await getDb().execute(sql`
    WITH anterior AS MATERIALIZED (SELECT * FROM bpo_lancamentos WHERE id = ${input.id} FOR UPDATE),
    existente AS MATERIALIZED (SELECT * FROM bpo_recebimentos WHERE request_key = ${input.requestKey}),
    novo AS (
      INSERT INTO bpo_recebimentos(lancamento_id,request_key,valor,recebido_em,registrado_por_user_id,observacoes)
      SELECT a.id, ${input.requestKey}, ${valor}::numeric, ${input.recebidoEm}, ${userId}, ${input.observacoes ?? null}
      FROM anterior a WHERE a.tipo <> 'despesa' AND a.combinada_em_id IS NULL AND a.asaas_payment_id IS NULL AND a.bank_transaction_id IS NULL AND NOT a.pago
        AND a.valor_recebido + ${valor}::numeric <= a.valor AND NOT EXISTS(SELECT 1 FROM existente)
      ON CONFLICT(request_key) DO NOTHING RETURNING *
    ), atualizado AS (
      UPDATE bpo_lancamentos l SET valor_recebido = a.valor_recebido + n.valor,
        pago = a.valor_recebido + n.valor = a.valor,
        pago_em = CASE WHEN a.valor_recebido + n.valor = a.valor THEN n.recebido_em ELSE NULL END,
        version = a.version + 1, updated_at = now()
      FROM anterior a JOIN novo n ON n.lancamento_id = a.id WHERE l.id = a.id RETURNING l.*
    ), auditoria AS (
      INSERT INTO bpo_lancamento_historico(lancamento_id,lancamento_referencia,versao_anterior,alterado_por_user_id,motivo,antes_json,depois_json)
      SELECT u.id,a.id,a.version,${userId},'Recebimento parcial ou liquidação',row_to_json(a)::text,row_to_json(u)::text
      FROM anterior a JOIN atualizado u ON u.id = a.id RETURNING id
    )
    SELECT COALESCE((SELECT row_to_json(u) FROM atualizado u WHERE EXISTS(SELECT 1 FROM auditoria)),
      (SELECT row_to_json(a) FROM anterior a WHERE EXISTS(SELECT 1 FROM existente e WHERE e.lancamento_id = a.id AND e.valor = ${valor}::numeric))) AS registro
  `);
  const row = r.rows?.[0] as { registro?: Record<string, unknown> } | undefined;
  if (!row?.registro) {
    // Original de "Combinar pagamentos" (lista antiga aberta): mensagem específica.
    const [l] = await getDb().select({ combinadaEmId: bpoLancamentos.combinadaEmId }).from(bpoLancamentos).where(eq(bpoLancamentos.id, input.id)).limit(1);
    if (l) exigirNaoCombinada(l);
    throw new Error("Recebimento não registrado: confira o saldo, a origem e a chave de envio. O valor não pode superar o saldo da cobrança.");
  }
  const registro = Object.fromEntries(Object.entries(row.registro).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value]));
  // row_to_json encodes numeric as JSON numbers; retain Drizzle's decimal/date contract.
  for (const key of ["valor", "valorRecebido"]) registro[key] = Number(registro[key]).toFixed(2);
  for (const key of ["vencimento", "pagoEm", "createdAt", "updatedAt"]) if (typeof registro[key] === "string") registro[key] = new Date(registro[key] as string);
  return registro as BpoLancamento;
}
