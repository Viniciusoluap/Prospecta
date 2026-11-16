// Maquete 3D (EPIC-024 S-05) — histórico das plantas: cada mudança do modelo grava uma linha em maquete_3d_revisoes
// com o modelo inteiro. Sem transação interativa (neon-http): o modelo é gravado primeiro, com a trava otimista
// (UPDATE ... WHERE modelo_versao = versão lida), e a revisão logo depois; a versão é única por maquete.
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { users } from "../../drizzle/schema.js";
import { maquete3dRevisoes, maquetes3d, type Maquete3d } from "../../drizzle/schema-maquete-3d.js";
import type { ModeloMaquete } from "../../shared/maquete-3d/modelo.js";
import type { DocumentoMaquete, StatusMaquete } from "../../shared/maquete-3d/regras.js";
import { agora, db } from "./base.js";

export const ORIGENS_REVISAO = ["anterior", "leitura", "edicao", "tipo_padrao", "implantacao_estudo", "importacao_pdf", "restauracao"] as const;
export type OrigemRevisao = (typeof ORIGENS_REVISAO)[number];

/** Modelo que existia antes do histórico (maquete antiga): guardado uma vez, para poder voltar a ele. */
export async function guardarAnterior(m: Pick<Maquete3d, "id" | "modelo" | "modeloVersao">, motivo = "Planta como estava antes do histórico"): Promise<void> {
  if (!m.modelo) return;
  try {
    await db().insert(maquete3dRevisoes).values({ maqueteId: m.id, versao: m.modeloVersao, modelo: m.modelo, origem: "anterior", motivo, createdAt: agora() })
      .onConflictDoNothing();
  } catch (e) { console.error(`[maquete-3d] histórico: falha ao guardar a planta anterior da maquete ${m.id}:`, e instanceof Error ? e.message : e); }
}

/** O modelo já foi gravado quando a revisão é registrada: uma falha aqui é registrada no log e não desfaz o salvamento. */
export async function registrarRevisao(r: { maqueteId: number; versao: number; modelo: string; origem: OrigemRevisao; motivo?: string | null; documento?: DocumentoMaquete | null; autorId?: number | null }): Promise<void> {
  try {
    await db().insert(maquete3dRevisoes).values({
      maqueteId: r.maqueteId, versao: r.versao, modelo: r.modelo, origem: r.origem, motivo: r.motivo?.slice(0, 400) || null,
      documento: r.documento ? JSON.stringify(r.documento) : null, autorId: r.autorId ?? null, createdAt: agora(),
    }).onConflictDoNothing();
  } catch (e) { console.error(`[maquete-3d] histórico: falha ao registrar a versão ${r.versao} da maquete ${r.maqueteId}:`, e instanceof Error ? e.message : e); }
}

export class ConflitoDeVersao extends Error {}

/**
 * Grava um modelo novo com a trava otimista e registra a revisão. `de`: a maquete como foi lida (versão e status).
 * `status`: situações em que a mudança vale. `extra`: outras colunas a gravar junto (status, tipo, publicação…).
 */
export async function gravarModelo(p: {
  de: Maquete3d; versao: number; modelo: ModeloMaquete; status: readonly StatusMaquete[]; extra?: Partial<typeof maquetes3d.$inferInsert>;
  origem: OrigemRevisao; motivo?: string | null; documento?: DocumentoMaquete | null; autorId: number | null;
}): Promise<number> {
  const texto = JSON.stringify(p.modelo);
  const r = await db().update(maquetes3d).set({ ...p.extra, modelo: texto, modeloVersao: p.versao + 1, updatedAt: agora() })
    .where(and(eq(maquetes3d.id, p.de.id), isNull(maquetes3d.deletedAt), eq(maquetes3d.modeloVersao, p.versao), inArray(maquetes3d.status, [...p.status])))
    .returning({ versao: maquetes3d.modeloVersao });
  if (!r.length) throw new ConflitoDeVersao("A planta foi alterada por outra pessoa ou não está nesta situação. Recarregue a página.");
  // Primeira mudança registrada de uma maquete antiga: a planta de antes entra no histórico.
  if (p.de.modelo && p.de.modeloVersao === p.versao) await guardarAnterior(p.de);
  await registrarRevisao({ maqueteId: p.de.id, versao: r[0].versao, modelo: texto, origem: p.origem, motivo: p.motivo, documento: p.documento, autorId: p.autorId });
  return r[0].versao;
}

/** Histórico para a tela (sem o modelo, que pode ser grande). */
export async function listarRevisoes(maqueteId: number) {
  const linhas = await db().select({
    id: maquete3dRevisoes.id, versao: maquete3dRevisoes.versao, origem: maquete3dRevisoes.origem, motivo: maquete3dRevisoes.motivo,
    documento: maquete3dRevisoes.documento, autorId: maquete3dRevisoes.autorId, createdAt: maquete3dRevisoes.createdAt,
    tamanho: sql<number>`length(${maquete3dRevisoes.modelo})`,
  }).from(maquete3dRevisoes).where(eq(maquete3dRevisoes.maqueteId, maqueteId)).orderBy(desc(maquete3dRevisoes.versao)).limit(60);
  const ids = Array.from(new Set(linhas.map(l => l.autorId).filter((v): v is number => !!v)));
  const nomes = new Map((ids.length ? await db().select({ id: users.id, nome: users.name }).from(users).where(inArray(users.id, ids)) : []).map(u => [u.id, u.nome]));
  return linhas.map(({ autorId, documento, tamanho: _t, ...l }) => {
    let doc: { nome: string } | null = null;
    try { doc = documento ? (JSON.parse(documento) as { nome: string }) : null; } catch { doc = null; }
    return { ...l, documento: doc?.nome ?? null, autor: autorId ? nomes.get(autorId) ?? `Usuário ${autorId}` : null };
  });
}

export async function lerRevisao(maqueteId: number, revisaoId: number) {
  const [r] = await db().select().from(maquete3dRevisoes).where(and(eq(maquete3dRevisoes.id, revisaoId), eq(maquete3dRevisoes.maqueteId, maqueteId))).limit(1);
  return r ?? null;
}
