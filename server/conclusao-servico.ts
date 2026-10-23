// Lote 23/10, etapa 4 — conclui no módulo o registro vinculado ao serviço do CRM.
// Gêmeo em Grupo-Santa-Fe/web/src/lib/crm/conclusao-servico-db.ts.
import { sql } from "drizzle-orm";
import { getDb } from "./db.js";
import {
  STATUS_CANCELADO_DO_MODULO,
  STATUS_CONCLUIDO_DO_MODULO,
  moduloConcluivel,
  type ResultadoConclusao,
} from "../shared/conclusao-servico.js";

const TABELA_DO_MODULO = {
  obras: "construction_projects",
  projetos: "operational_projects",
  regularizacoes: "regularizacoes",
  financiamentos: "financiamentos",
  avaliacoes: "avaliacoes",
  tarefas: "tasks",
} as const;

/**
 * Procura o registro pelo `lead_service_id` (ID do serviço) e, se não estiver
 * concluído nem cancelado, grava só o status de conclusão (e `updated_at`).
 */
export async function concluirRegistroDoServico(servico: { id: number; operationalModule: string | null }): Promise<ResultadoConclusao> {
  const modulo = servico.operationalModule;
  if (!moduloConcluivel(modulo)) return { estado: "sem_modulo", modulo };
  const tabela = sql.raw(`"${TABELA_DO_MODULO[modulo]}"`);
  const final = STATUS_CONCLUIDO_DO_MODULO[modulo];
  const cancelado = STATUS_CANCELADO_DO_MODULO[modulo];
  const db = getDb();
  const atualizados = await db.execute(sql`
    UPDATE ${tabela} SET status = ${final}, updated_at = now()
    WHERE lead_service_id = ${servico.id} AND status::text NOT IN (${final}, ${cancelado})
    RETURNING id
  `);
  const linhas = atualizados.rows as Array<{ id: number }>;
  if (linhas.length) return { estado: "concluido", modulo, registroId: linhas[0].id };
  const existentes = await db.execute(sql`SELECT id, status::text AS status FROM ${tabela} WHERE lead_service_id = ${servico.id} ORDER BY id LIMIT 1`);
  const atual = existentes.rows[0] as { id: number; status: string } | undefined;
  if (!atual) return { estado: "sem_registro", modulo };
  return { estado: atual.status === cancelado ? "cancelado" : "ja_concluido", modulo, registroId: atual.id };
}

/**
 * Divergências históricas: serviços concluídos no CRM cujo registro (pelo ID do
 * serviço) não está concluído nem cancelado. `aplicar=false` só lista.
 */
export async function reconciliarConclusoes(aplicar: boolean) {
  const db = getDb();
  const servicos = await db.execute(sql`SELECT id, lead_id, operational_module FROM lead_services WHERE status = 'completed' ORDER BY id`);
  const divergentes: Array<{ servicoId: number; leadId: number; modulo: string; registroId: number; statusAtual: string }> = [];
  for (const s of servicos.rows as Array<{ id: number; lead_id: number; operational_module: string | null }>) {
    if (!moduloConcluivel(s.operational_module)) continue;
    const m = s.operational_module;
    const r = await db.execute(sql`
      SELECT id, status::text AS status FROM ${sql.raw(`"${TABELA_DO_MODULO[m]}"`)}
      WHERE lead_service_id = ${s.id} AND status::text NOT IN (${STATUS_CONCLUIDO_DO_MODULO[m]}, ${STATUS_CANCELADO_DO_MODULO[m]})
    `);
    for (const row of r.rows as Array<{ id: number; status: string }>)
      divergentes.push({ servicoId: s.id, leadId: s.lead_id, modulo: m, registroId: row.id, statusAtual: row.status });
  }
  if (aplicar) for (const d of divergentes) await concluirRegistroDoServico({ id: d.servicoId, operationalModule: d.modulo });
  return { aplicado: aplicar, divergentes };
}
