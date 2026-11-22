// EPIC-027 C5-COM (mesa comercial ligada à maquete) — a parte da Dolores que conversa com o servidor da MAQUETE (server/maquete-3d/):
// a conferência da planta usada pelas leituras (o mesmo hash da estrutura que a página pública confere) e a troca do código do link,
// com o MESMO gerador do painel do admin (`novoCodigo`: aleatório criptográfico, alfabeto sem 0/o, 1/l/i). Fica fora de
// server/dolores/acoes/ porque grava (UPDATE condicional), dentro da transação de escrita da ação (`bancoDaAcao`).
// Ligar lote a planta/unidade e publicar versão continuam SÓ pela tela do admin.
import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { maquete3dLotes, maquetes3d } from "../../drizzle/schema-maquete-3d.js";
import type { LoteParaBusca } from "../../shared/dolores/maquete-lote.js";
import { fonteDoRepo, hashDaEstrutura, slugPlantaValido } from "../maquete-3d/itens.js";
import { novoCodigo } from "../maquete-3d/lotes.js";
import { bancoDaAcao } from "./escrita.js";
import { bancoDaLeitura, emTransacaoSomenteLeitura } from "./somente-leitura.js";

/** Hash da estrutura atual da planta do repositório (null = planta que o servidor não tem). */
export function hashDaPlanta(fonteSlug: string): string | null {
  return slugPlantaValido(fonteSlug) ? hashDaEstrutura(fonteDoRepo(fonteSlug)) : null;
}

/** Marca do código atual guardada no item da fila (nunca o código em si): confere, na execução, que o link não mudou. */
export const marcaDoCodigo = (codigo: string | null | undefined) => (codigo ? createHash("sha256").update(codigo).digest("hex").slice(0, 16) : null);

export type LoteParaLink = LoteParaBusca & { id: number; ativo: boolean; codigoLink: string | null; maqueteOk: boolean };

const colunas = {
  id: maquete3dLotes.id, empreendimentoSlug: maquete3dLotes.empreendimentoSlug, loteSlug: maquete3dLotes.loteSlug,
  empreendimentoNome: maquete3dLotes.empreendimentoNome, quadra: maquete3dLotes.quadra, loteNumero: maquete3dLotes.loteNumero,
  ativo: maquete3dLotes.ativo, codigoLink: maquete3dLotes.codigoLink, maqueteId: maquetes3d.id, origem: maquetes3d.origem, fonteSlug: maquetes3d.fonteSlug,
};
type Linha = { id: number; empreendimentoSlug: string; loteSlug: string; empreendimentoNome: string | null; quadra: string | null; loteNumero: string | null;
  ativo: boolean; codigoLink: string | null; maqueteId: number | null; origem: string | null; fonteSlug: string | null };
const paraLote = (l: Linha): LoteParaLink => ({ ...l, id: Number(l.id), maqueteOk: !!l.maqueteId && l.origem === "fonte" && !!l.fonteSlug && slugPlantaValido(l.fonteSlug) });

/** O lote (só leitura), com a maquete não excluída. */
export async function lerLoteParaLink(loteId: number): Promise<LoteParaLink | null> {
  const [l] = await emTransacaoSomenteLeitura(() => bancoDaLeitura().select(colunas).from(maquete3dLotes)
    .leftJoin(maquetes3d, and(eq(maquetes3d.id, maquete3dLotes.maqueteId), isNull(maquetes3d.deletedAt)))
    .where(eq(maquete3dLotes.id, loteId)).limit(1));
  return l ? paraLote(l as Linha) : null;
}

/**
 * Troca o código do link do lote — SÓ se ele ainda é o que o dono viu na proposta (`marcaAntes`: null = sem link). Roda na transação
 * de escrita da ação. null = o lote mudou (ou sumiu) depois da proposta: nada gravado.
 */
export async function trocarCodigoDoLote(loteId: number, marcaAntes: string | null): Promise<{ lote: LoteParaLink; codigo: string } | null> {
  const db = bancoDaAcao();
  const [l] = await db.select(colunas).from(maquete3dLotes)
    .leftJoin(maquetes3d, and(eq(maquetes3d.id, maquete3dLotes.maqueteId), isNull(maquetes3d.deletedAt)))
    .where(eq(maquete3dLotes.id, loteId)).limit(1).for("update", { of: maquete3dLotes });
  if (!l) return null;
  const lote = paraLote(l as Linha);
  if (!lote.maqueteOk || marcaDoCodigo(lote.codigoLink) !== marcaAntes) return null;
  const codigo = novoCodigo();
  const r = await db.update(maquete3dLotes).set({ codigoLink: codigo, updatedAt: sql`now()` })
    .where(and(eq(maquete3dLotes.id, loteId), lote.codigoLink === null ? isNull(maquete3dLotes.codigoLink) : eq(maquete3dLotes.codigoLink, lote.codigoLink)))
    .returning({ id: maquete3dLotes.id });
  return r.length ? { lote: { ...lote, codigoLink: codigo }, codigo } : null;
}
