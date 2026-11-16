// Maquete 3D (EPIC-024 S-05) — histórico das plantas: cada mudança do modelo grava uma linha em maquete_3d_revisoes
// com o modelo inteiro. Sem transação interativa (neon-http). Regra do dono: a planta anterior nunca se perde. Por
// isso a ordem é: (1) a planta que vai ser substituída é guardada no histórico (se já estiver lá, nada muda); se isso
// falhar, a operação para com erro claro e NADA é sobrescrito; (2) o modelo novo é gravado com a trava otimista
// (UPDATE ... WHERE modelo_versao = versão lida); (3) a revisão nova é registrada. Se (3) falhar, o modelo novo
// está na própria maquete e entra no histórico pelo passo (1) da próxima mudança: o erro vai só para o log.
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { users } from "../../drizzle/schema.js";
import { maquete3dRevisoes, maquetes3d, type Maquete3d } from "../../drizzle/schema-maquete-3d.js";
import type { ModeloMaquete } from "../../shared/maquete-3d/modelo.js";
import type { DocumentoMaquete, StatusMaquete } from "../../shared/maquete-3d/regras.js";
import { LeituraIndisponivel, agora, db } from "./base.js";

export const ORIGENS_REVISAO = ["anterior", "leitura", "edicao", "tipo_padrao", "implantacao_estudo", "importacao_pdf", "restauracao"] as const;
export type OrigemRevisao = (typeof ORIGENS_REVISAO)[number];

/** Não foi possível guardar a planta atual no histórico: a operação que a substituiria foi cancelada. */
export class HistoricoIndisponivel extends LeituraIndisponivel {}

/**
 * Guarda no histórico a planta que está na maquete (versão atual), ANTES de ela ser substituída. Já guardada (a
 * versão tem linha): nada muda. Falhou: lança `HistoricoIndisponivel` e quem chamou não sobrescreve nada.
 */
export async function guardarAnterior(m: Pick<Maquete3d, "id" | "modelo" | "modeloVersao">, motivo = "Planta como estava antes do histórico"): Promise<void> {
  if (!m.modelo) return;
  try {
    await db().insert(maquete3dRevisoes).values({ maqueteId: m.id, versao: m.modeloVersao, modelo: m.modelo, origem: "anterior", motivo, createdAt: agora() })
      .onConflictDoNothing();
  } catch (e) {
    console.error(`[maquete-3d] histórico: falha ao guardar a planta anterior da maquete ${m.id}:`, e instanceof Error ? e.message : e);
    throw new HistoricoIndisponivel("Não foi possível guardar a planta atual no histórico, então nada foi alterado (a planta anterior nunca é perdida). Tente de novo em instantes.");
  }
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
 * Vale para toda mudança do modelo — edição comum, troca de tipo, implantação do estudo, planta importada e
 * restauração: a planta que está na maquete é guardada antes; sem isso, `HistoricoIndisponivel` e nada muda.
 * `condicao`: condição a mais no UPDATE (ex.: a importação ainda é a que foi lida).
 */
export async function gravarModelo(p: {
  de: Maquete3d; versao: number; modelo: ModeloMaquete; status: readonly StatusMaquete[]; extra?: Partial<typeof maquetes3d.$inferInsert>;
  origem: OrigemRevisao; motivo?: string | null; documento?: DocumentoMaquete | null; autorId: number | null; condicao?: SQL;
}): Promise<number> {
  const texto = JSON.stringify(p.modelo);
  // Versão diferente da lida: conflito, sem tocar no histórico. Mesma versão: a planta atual vai antes para o histórico.
  if (p.de.modeloVersao !== p.versao) throw new ConflitoDeVersao("A planta foi alterada por outra pessoa ou não está nesta situação. Recarregue a página.");
  await guardarAnterior(p.de);
  const r = await db().update(maquetes3d).set({ ...p.extra, modelo: texto, modeloVersao: p.versao + 1, updatedAt: agora() })
    .where(and(eq(maquetes3d.id, p.de.id), isNull(maquetes3d.deletedAt), eq(maquetes3d.modeloVersao, p.versao), inArray(maquetes3d.status, [...p.status]), p.condicao))
    .returning({ versao: maquetes3d.modeloVersao });
  if (!r.length) throw new ConflitoDeVersao("A planta foi alterada por outra pessoa ou não está nesta situação. Recarregue a página.");
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
