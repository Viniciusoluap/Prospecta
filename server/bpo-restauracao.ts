// Lote 4 (30/10/2026): "Restaurar" exclusões em lote do BPO a partir do backup JSON
// (bpo_lancamento_exclusoes_backup). Uma vez só por backup (restaurado_em/por), em transação, sem
// duplicar lançamento existente; vínculo externo que não existe mais volta vazio (com aviso);
// histórico por lançamento. Só admin (adminProcedure no router).
// Gêmeo no Santa Fé: web/src/lib/actions/bpo-lote.ts (listar/previa/restaurarExclusaoEmLote).
import { and, desc, eq, getTableColumns, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { getDb } from "./db.js";
import { bpoClients, bpoLancamentoExclusoesBackup, bpoLancamentoHistorico, bpoLancamentos, users, type InsertBpoLancamento } from "../drizzle/schema.js";
import { catalogoDaCategoria } from "../shared/financeiro/bpo-operacional.js";
import {
  CONFIRMACAO_RESTAURACAO, confirmacaoRestauracaoValida, lerSnapshot, planejarRestauracao, type PlanoRestauracao,
} from "../shared/financeiro/bpo-restauracao.js";

type Executor = Pick<ReturnType<typeof getDb>, "select">;
/** Catálogo de vínculos operacionais (obras, projetos, comissões…) — `catalogoVinculosOperacionais` do router. */
export type CarregarCatalogo = () => Promise<Record<string, unknown>>;

const COLUNAS_LANCAMENTO = Object.keys(getTableColumns(bpoLancamentos));
const COLUNAS_DATA_LANCAMENTO = ["vencimento", "pagoEm", "createdAt", "updatedAt"];

export type ExclusaoEmLoteResumo = {
  id: number; criadoEm: string; modo: string; aba: string; quantidade: number; protegidos: number;
  usuario: string | null; restauradoEm: string | null; restauradoPor: string | null;
  restauracao: { restaurados: number; jaExistiam: number; comAviso: number } | null;
};

export async function listarExclusoesEmLote(): Promise<ExclusaoEmLoteResumo[]> {
  const b = bpoLancamentoExclusoesBackup;
  const linhas = await getDb().select({
    id: b.id, createdAt: b.createdAt, modo: b.modo, aba: b.aba, quantidade: b.quantidade, protegidos: b.protegidos,
    criadoPorUserId: b.criadoPorUserId, restauradoEm: b.restauradoEm, restauradoPorUserId: b.restauradoPorUserId, restauracaoJson: b.restauracaoJson,
  }).from(b).orderBy(desc(b.createdAt), desc(b.id)).limit(100);
  const ids = Array.from(new Set(linhas.flatMap(l => [l.criadoPorUserId, l.restauradoPorUserId]).filter((x): x is number => x != null)));
  const us = ids.length ? await getDb().select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : [];
  const nomes = new Map(us.map(u => [u.id, u.name || `usuário #${u.id}`]));
  return linhas.map(l => {
    let restauracao: ExclusaoEmLoteResumo["restauracao"] = null;
    try { restauracao = l.restauracaoJson ? JSON.parse(l.restauracaoJson) : null; } catch { restauracao = null; }
    return {
      id: l.id, criadoEm: l.createdAt.toISOString(), modo: l.modo, aba: l.aba, quantidade: l.quantidade, protegidos: l.protegidos,
      usuario: l.criadoPorUserId != null ? nomes.get(l.criadoPorUserId) ?? "usuário removido" : null,
      restauradoEm: l.restauradoEm?.toISOString() ?? null,
      restauradoPor: l.restauradoPorUserId != null ? nomes.get(l.restauradoPorUserId) ?? "usuário removido" : null,
      restauracao,
    };
  });
}

async function planoDoBackup(d: Executor, snapshotJson: string, carregarCatalogo: CarregarCatalogo): Promise<PlanoRestauracao> {
  const snapshot = lerSnapshot(snapshotJson);
  const ids = snapshot.map(s => Number(s.id)).filter(Number.isInteger);
  const clienteIds = Array.from(new Set(snapshot.map(s => s.clienteId).filter(x => x != null).map(Number)));
  const existentes = ids.length ? await d.select({ id: bpoLancamentos.id }).from(bpoLancamentos).where(inArray(bpoLancamentos.id, ids)) : [];
  const clientes = clienteIds.length ? await d.select({ id: bpoClients.id }).from(bpoClients).where(inArray(bpoClients.id, clienteIds)) : [];
  const chaves = Array.from(new Set(snapshot.map(s => s.requestKey).filter((x): x is string => typeof x === "string" && !!x)));
  const usadas = chaves.length
    ? await d.select({ v: bpoLancamentos.requestKey }).from(bpoLancamentos).where(and(inArray(bpoLancamentos.requestKey, chaves), ids.length ? notInArray(bpoLancamentos.id, ids) : sql`true`))
    : [];
  const catalogo = snapshot.some(s => s.vinculoOperacionalId) ? await carregarCatalogo() : {};
  return planejarRestauracao(snapshot, {
    idsExistentes: new Set(existentes.map(e => String(e.id))),
    clientesExistentes: new Set(clientes.map(c => String(c.id))),
    vinculoExiste: (tipo, categoria, id) => {
      const lista = catalogo[catalogoDaCategoria(tipo === "despesa" ? "despesa" : "cobranca", categoria)];
      return Array.isArray(lista) && lista.some((o: { id?: unknown }) => String(o?.id) === id);
    },
    unicosEmUso: { requestKey: new Set(usadas.map(u => String(u.v))) },
  }, COLUNAS_LANCAMENTO, COLUNAS_DATA_LANCAMENTO);
}

export async function previaRestauracaoExclusao(backupId: number, carregarCatalogo: CarregarCatalogo) {
  const [b] = await getDb().select().from(bpoLancamentoExclusoesBackup).where(eq(bpoLancamentoExclusoesBackup.id, backupId));
  if (!b) throw new Error("Exclusão em lote não encontrada.");
  const plano = await planoDoBackup(getDb(), b.snapshotJson, carregarCatalogo);
  return {
    backupId: b.id, aba: b.aba, criadoEm: b.createdAt.toISOString(), restauradoEm: b.restauradoEm?.toISOString() ?? null,
    restaurar: plano.restaurar, jaExistem: plano.jaExistem, comAviso: plano.comAviso,
    itens: plano.itens.map(i => ({ id: i.id, descricao: i.descricao, valor: i.valor, vencimento: i.vencimento, clienteNome: i.clienteNome, acao: i.acao, avisos: i.avisos })),
  };
}

export async function restaurarExclusaoEmLote(input: { backupId: number; confirmacao: string }, userId: number, carregarCatalogo: CarregarCatalogo) {
  if (!confirmacaoRestauracaoValida(input.confirmacao)) throw new Error(`Digite ${CONFIRMACAO_RESTAURACAO} para confirmar a restauração.`);
  return getDb().transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bpo_exclusao_lote'))`);
    const [b] = await tx.select().from(bpoLancamentoExclusoesBackup).where(eq(bpoLancamentoExclusoesBackup.id, input.backupId));
    if (!b) throw new Error("Exclusão em lote não encontrada.");
    if (b.restauradoEm) throw new Error(`Esta exclusão já foi restaurada em ${b.restauradoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`);
    const plano = await planoDoBackup(tx, b.snapshotJson, carregarCatalogo);
    const avisos: string[] = [];
    for (const item of plano.itens) {
      if (item.acao !== "restaurar") continue;
      const versaoAnterior = Number(item.dados.version ?? 1) || 1;
      const dados = { ...item.dados, version: versaoAnterior + 1 } as InsertBpoLancamento;
      const [criado] = await tx.insert(bpoLancamentos).values(dados).returning({ id: bpoLancamentos.id });
      await tx.insert(bpoLancamentoHistorico).values({
        lancamentoId: criado.id, lancamentoReferencia: criado.id, versaoAnterior, alteradoPorUserId: userId,
        motivo: `Restaurado da exclusão em lote (backup #${b.id})${item.avisos.length ? ` — ${item.avisos.join(" ")}` : ""}`,
        antesJson: JSON.stringify({ excluido: true, backupId: b.id }), depoisJson: JSON.stringify(dados),
      });
      for (const a of item.avisos) avisos.push(`${item.descricao || `#${item.id}`}: ${a}`);
    }
    const resumo = { restaurados: plano.restaurar, jaExistiam: plano.jaExistem, comAviso: plano.comAviso };
    const marcado = await tx.update(bpoLancamentoExclusoesBackup)
      .set({ restauradoEm: new Date(), restauradoPorUserId: userId, restauracaoJson: JSON.stringify(resumo) })
      .where(and(eq(bpoLancamentoExclusoesBackup.id, b.id), isNull(bpoLancamentoExclusoesBackup.restauradoEm)))
      .returning({ id: bpoLancamentoExclusoesBackup.id });
    if (marcado.length !== 1) throw new Error("Esta exclusão já foi restaurada por outra pessoa. Atualize a tela.");
    return { ...resumo, avisos };
  });
}
