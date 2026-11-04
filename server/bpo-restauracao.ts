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

/** Backups de ajustes reativam a própria linha: nunca recriam recebimentos ou chaves externas. */
const ehBackupAjustes = (snapshotJson: string) => {
  const itens = lerSnapshot(snapshotJson);
  if (itens.some(i => i.__limpezaAjustes === true) && !itens.every(i => i.__limpezaAjustes === true)) throw new Error("Backup corrompido: mistura de exclusão e limpeza de ajustes.");
  return itens.length > 0 && itens.every(i => i.__limpezaAjustes === true);
};

async function planoArquivado(d: Executor, backupId: number, snapshotJson: string): Promise<PlanoRestauracao> {
  const snapshot = lerSnapshot(snapshotJson);
  const ids = snapshot.map(s => Number(s.id));
  const atuais = ids.length ? await d.select().from(bpoLancamentos).where(inArray(bpoLancamentos.id, ids)) : [];
  const porId = new Map(atuais.map(l => [l.id, l]));
  const itens = snapshot.map(s => {
    const atual = porId.get(Number(s.id));
    const proprio = atual?.exclusaoLoteBackupId === backupId;
    const avisos = proprio
      ? s.bankTransactionId != null && atual?.bankTransactionId == null
        ? ["A movimentação bancária original foi removida: o lançamento volta sem esse vínculo, preservando os dados atuais."]
        : []
      : [atual ? "O lançamento não pertence mais a esta limpeza; será mantido sem alteração." : "O lançamento não existe mais; esta limpeza não recria registros nem vínculos externos."];
    return { id: String(s.id), descricao: String(s.descricao ?? ""), valor: Number(s.valor ?? 0), vencimento: s.vencimento ? String(s.vencimento) : null,
      clienteNome: s.clienteNome ? String(s.clienteNome) : null, acao: proprio ? "restaurar" as const : "ja_existe" as const,
      avisos,
      dados: atual ?? {},
    };
  });
  return { itens, restaurar: itens.filter(i => i.acao === "restaurar").length, jaExistem: itens.filter(i => i.acao !== "restaurar").length,
    comAviso: itens.filter(i => i.avisos.length > 0).length };
}

export async function previaRestauracaoExclusao(backupId: number, carregarCatalogo: CarregarCatalogo) {
  const [b] = await getDb().select().from(bpoLancamentoExclusoesBackup).where(eq(bpoLancamentoExclusoesBackup.id, backupId));
  if (!b) throw new Error("Exclusão em lote não encontrada.");
  const plano = ehBackupAjustes(b.snapshotJson) ? await planoArquivado(getDb(), b.id, b.snapshotJson) : await planoDoBackup(getDb(), b.snapshotJson, carregarCatalogo);
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
    const ajustes = ehBackupAjustes(b.snapshotJson);
    if (ajustes) {
      const ids = lerSnapshot(b.snapshotJson).map(s => Number(s.id));
      if (ids.length) await tx.execute(sql`SELECT id FROM bpo_lancamentos WHERE id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)}) ORDER BY id FOR UPDATE`);
    }
    const plano = ajustes ? await planoArquivado(tx, b.id, b.snapshotJson) : await planoDoBackup(tx, b.snapshotJson, carregarCatalogo);
    const avisos: string[] = ajustes ? plano.itens.flatMap(i => i.avisos.map(a => `${i.descricao || `#${i.id}`}: ${a}`)) : [];
    if (ajustes && plano.restaurar) {
      // Uma atualização e um INSERT de histórico por lote, inclusive para centenas de linhas.
      // O lock acima mantém o plano estável; o marcador limita a restauração ao próprio backup.
      const itens = plano.itens.filter(item => item.acao === "restaurar");
      const antesPorId = new Map(itens.map(item => [Number(item.id), item.dados]));
      const alterados = await tx.update(bpoLancamentos)
        .set({ exclusaoLoteBackupId: null, version: sql`${bpoLancamentos.version} + 1`, updatedAt: new Date() })
        .where(and(inArray(bpoLancamentos.id, itens.map(item => Number(item.id))), eq(bpoLancamentos.exclusaoLoteBackupId, b.id))).returning();
      if (alterados.length !== itens.length) throw new Error("A limpeza mudou durante a restauração. Atualize a prévia.");
      await tx.insert(bpoLancamentoHistorico).values(alterados.map(alterado => {
        const antes = antesPorId.get(alterado.id)!;
        return { lancamentoId: alterado.id, lancamentoReferencia: alterado.id,
          versaoAnterior: Number(antes.version), alteradoPorUserId: userId, motivo: `Restaurado da limpeza local de ajustes (backup #${b.id})`,
          antesJson: JSON.stringify(antes), depoisJson: JSON.stringify(alterado) };
      }));
    }
    for (const item of ajustes ? [] : plano.itens) {
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
