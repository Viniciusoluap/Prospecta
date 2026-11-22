// Maquete 3D (EPIC-028, Etapa 4) — lotes ligados à maquete de uma planta (N lotes → a mesma estrutura) e a leitura
// PÚBLICA por lote (/maquete/<empreendimento>/<lote>-<código>).
// Público: só a versão de itens que foi PUBLICADA (a fixada no lote ou a publicada da maquete), nunca rascunho; resposta
// mínima (medidas, itens, status, textos); sem comprador, preço, ids, autor ou versões. Qualquer falha (lote que não
// existe, código errado, lote desligado, sem publicação, estrutura mudou) devolve o MESMO "não encontrado".
// Admin (o router confere o papel antes de chamar): ligar/editar lote, escolher a versão, gerar/regenerar o código e a
// semente do Lote 4 da Quadra 18 (Vila Esmeralda) → planta lote4-qd18.
import { randomInt } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { itensEdicaoSchema } from "../../shared/maquete-3d/edicao.js";
import type { ItemFonte } from "../../shared/maquete-3d/fonte.js";
import {
  ALFABETO_CODIGO, SLUG_RE, TAMANHO_CODIGO, caminhoDoLote, separarLoteECodigo, statusDaUnidade, type DadosLotePublico,
} from "../../shared/maquete-3d/lote-publico.js";
import { db } from "./base.js";
import { fonteDoRepo, garantirMaqueteDaFonte, hashDaEstrutura, slugPlantaValido } from "./itens.js";

const linhas = <T = Record<string, unknown>>(r: unknown) => (r as { rows: T[] }).rows;

/** A mesma resposta para tudo o que não abre (não diz se o lote existe). */
export const MENSAGEM_NAO_ENCONTRADO = "Maquete não encontrada.";
export const naoEncontrado = () => new TRPCError({ code: "NOT_FOUND", message: MENSAGEM_NAO_ENCONTRADO });

export function novoCodigo(): string {
  let s = "";
  for (let i = 0; i < TAMANHO_CODIGO; i++) s += ALFABETO_CODIGO[randomInt(ALFABETO_CODIGO.length)];
  return s;
}

const lerItens = (texto: string): ItemFonte[] | null => {
  try { const r = itensEdicaoSchema.safeParse(JSON.parse(texto)); return r.success ? (r.data as ItemFonte[]) : null; } catch { return null; }
};

// ── Leitura pública ──

/** Cópia sem as anotações internas de quem desenhou a planta (`nota`): o cliente recebe só medidas e marcas curtas. */
export function semNotas<T>(v: T): T {
  if (Array.isArray(v)) return v.map(semNotas) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => k !== "nota").map(([k, x]) => [k, semNotas(x)])) as T;
  return v;
}

/** Página pública do lote. Lança sempre o mesmo NOT_FOUND quando não abre. */
export async function lotePublico(empreendimento: unknown, segmentoLote: unknown): Promise<DadosLotePublico> {
  if (typeof empreendimento !== "string" || !SLUG_RE.test(empreendimento) || typeof segmentoLote !== "string") throw naoEncontrado();
  const partes = separarLoteECodigo(segmentoLote);
  if (!partes) throw naoEncontrado();
  const [l] = linhas<{ maquete_id: number; itens_versao: number | null; unit_id: number | null; fonte_slug: string | null; publicada: number | null;
    empreendimento_nome: string | null; quadra: string | null; lote_numero: string | null }>(await db().execute(sql`
    SELECT l.maquete_id, l.itens_versao, l.unit_id, l.empreendimento_nome, l.quadra, l.lote_numero, m.fonte_slug, m.itens_versao_publicada AS publicada
    FROM maquete_3d_lotes l JOIN maquetes_3d m ON m.id = l.maquete_id AND m.deleted_at IS NULL AND m.origem = 'fonte'
    WHERE l.empreendimento_slug = ${empreendimento} AND l.lote_slug = ${partes.loteSlug} AND l.codigo_link = ${partes.codigo} AND l.ativo
    LIMIT 1`));
  if (!l || !l.fonte_slug || !slugPlantaValido(l.fonte_slug)) throw naoEncontrado();
  const versao = l.itens_versao ?? l.publicada;
  if (!versao) throw naoEncontrado();
  // Só versão que foi publicada (a atual ou uma anterior, hoje arquivada). Rascunho nunca: publicada_em é marcada só ao publicar.
  const [v] = linhas<{ itens: string; estrutura_hash: string }>(await db().execute(sql`
    SELECT itens, estrutura_hash FROM maquete_3d_itens
    WHERE maquete_id = ${l.maquete_id} AND versao = ${versao} AND publicada_em IS NOT NULL AND situacao IN ('publicada', 'arquivada')
    LIMIT 1`));
  if (!v) throw naoEncontrado();
  const f = fonteDoRepo(l.fonte_slug);
  // Itens de uma estrutura antiga não valem para a planta atual (as regras das portas e paredes mudariam).
  if (v.estrutura_hash !== hashDaEstrutura(f)) throw naoEncontrado();
  const itens = lerItens(v.itens);
  if (!itens) throw naoEncontrado();
  let status: DadosLotePublico["status"] = null;
  if (l.unit_id) {
    const [u] = linhas<{ status: string }>(await db().execute(sql`SELECT status FROM incorporation_units WHERE id = ${l.unit_id} AND deleted_at IS NULL LIMIT 1`));
    status = statusDaUnidade(u?.status);
  }
  return {
    empreendimento: l.empreendimento_nome?.trim() || empreendimento,
    quadra: l.quadra?.trim() || null,
    lote: l.lote_numero?.trim() || null,
    fonte: semNotas({ ...f, itens }),
    status,
  };
}

// ── Admin ──

type LinhaLote = {
  id: number; empreendimento_slug: string; lote_slug: string; empreendimento_nome: string | null; quadra: string | null; lote_numero: string | null;
  itens_versao: number | null; unit_id: number | null; ativo: boolean; codigo_link: string | null;
  unidade_codigo: string | null; unidade_status: string | null; estudo: string | null;
};

/** Lotes da planta, as versões publicadas (a atual e as anteriores) e o que cada lote mostra hoje. */
export async function listarLotes(planta: string) {
  const f = fonteDoRepo(planta);
  const [m] = linhas<{ id: number; publicada: number | null }>(await db().execute(sql`
    SELECT id, itens_versao_publicada AS publicada FROM maquetes_3d WHERE fonte_slug = ${planta} AND deleted_at IS NULL LIMIT 1`));
  if (!m) return { versaoPublicada: null, versoes: [], lotes: [] };
  const hash = hashDaEstrutura(f);
  const versoes = linhas<{ versao: number; situacao: string; publicada_em: Date | string; estrutura_hash: string }>(await db().execute(sql`
    SELECT versao, situacao, publicada_em, estrutura_hash FROM maquete_3d_itens
    WHERE maquete_id = ${m.id} AND publicada_em IS NOT NULL ORDER BY versao DESC LIMIT 50`))
    .map(v => ({ versao: Number(v.versao), situacao: v.situacao, publicadaEm: v.publicada_em, valeParaPlanta: v.estrutura_hash === hash }));
  const validas = new Set(versoes.filter(v => v.valeParaPlanta).map(v => v.versao));
  const lotes = linhas<LinhaLote>(await db().execute(sql`
    SELECT l.id, l.empreendimento_slug, l.lote_slug, l.empreendimento_nome, l.quadra, l.lote_numero, l.itens_versao, l.unit_id, l.ativo, l.codigo_link,
      u.code AS unidade_codigo, u.status AS unidade_status, s.name AS estudo
    FROM maquete_3d_lotes l
    LEFT JOIN incorporation_units u ON u.id = l.unit_id AND u.deleted_at IS NULL
    LEFT JOIN incorporation_studies s ON s.id = u.study_id
    WHERE l.maquete_id = ${m.id} ORDER BY l.empreendimento_slug, l.lote_slug`)).map(l => {
    const efetiva = l.itens_versao ?? m.publicada ?? null;
    return {
      id: Number(l.id), empreendimentoSlug: l.empreendimento_slug, loteSlug: l.lote_slug,
      empreendimentoNome: l.empreendimento_nome, quadra: l.quadra, lote: l.lote_numero,
      itensVersao: l.itens_versao, versaoEfetiva: efetiva, ativo: l.ativo,
      caminho: l.codigo_link ? caminhoDoLote(l.empreendimento_slug, l.lote_slug, l.codigo_link) : null,
      unidade: l.unit_id && l.unidade_codigo ? { id: Number(l.unit_id), codigo: l.unidade_codigo, estudo: l.estudo, status: statusDaUnidade(l.unidade_status) } : null,
      /** Por que a página do lote não abre (para o admin corrigir); null = abre. */
      pendencia: !l.ativo ? "Lote desligado." : !l.codigo_link ? "Sem código: gere o link." : !efetiva ? "Nenhuma versão de itens publicada ainda."
        : !validas.has(efetiva) ? "A versão escolhida não vale para a planta atual: escolha outra." : null,
    };
  });
  return { versaoPublicada: m.publicada, versoes, lotes };
}

export type DadosLoteAdmin = {
  id?: number; planta: string; empreendimentoSlug: string; loteSlug: string; empreendimentoNome: string;
  quadra: string | null; lote: string | null; itensVersao: number | null; unitId: number | null; ativo: boolean;
};

const ruim = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });

async function conferirVersaoEUnidade(maqueteId: number, planta: string, itensVersao: number | null, unitId: number | null) {
  if (itensVersao !== null) {
    const [v] = linhas<{ estrutura_hash: string }>(await db().execute(sql`SELECT estrutura_hash FROM maquete_3d_itens
      WHERE maquete_id = ${maqueteId} AND versao = ${itensVersao} AND publicada_em IS NOT NULL LIMIT 1`));
    if (!v) throw ruim("Só uma versão que já foi publicada pode ser escolhida para o lote.");
    if (v.estrutura_hash !== hashDaEstrutura(fonteDoRepo(planta))) throw ruim("Esta versão foi salva para uma planta anterior: escolha outra.");
  }
  if (unitId !== null) {
    const [u] = linhas(await db().execute(sql`SELECT 1 FROM incorporation_units WHERE id = ${unitId} AND deleted_at IS NULL LIMIT 1`));
    if (!u) throw ruim("Unidade da Incorporação não encontrada.");
  }
}

/** Cria (sem id, já com o código do link) ou altera um lote da planta. */
export async function salvarLote(p: DadosLoteAdmin, autorId: number) {
  if (!SLUG_RE.test(p.empreendimentoSlug) || !SLUG_RE.test(p.loteSlug)) throw ruim("Endereço só com letras minúsculas, números e hífen.");
  const m = await garantirMaqueteDaFonte(p.planta, autorId);
  await conferirVersaoEUnidade(m.id, p.planta, p.itensVersao, p.unitId);
  const texto = (s: string | null, n: number) => (s?.trim() ? s.trim().slice(0, n) : null);
  try {
    if (p.id === undefined) {
      const r = await db().execute(sql`INSERT INTO maquete_3d_lotes (empreendimento_slug, lote_slug, maquete_id, itens_versao, unit_id, ativo, criado_por, codigo_link, empreendimento_nome, quadra, lote_numero)
        VALUES (${p.empreendimentoSlug}, ${p.loteSlug}, ${m.id}, ${p.itensVersao}, ${p.unitId}, ${p.ativo}, ${autorId}, ${novoCodigo()}, ${texto(p.empreendimentoNome, 120)}, ${texto(p.quadra, 20)}, ${texto(p.lote, 20)})
        RETURNING id`);
      return { id: Number(linhas<{ id: number }>(r)[0].id) };
    }
    const r = await db().execute(sql`UPDATE maquete_3d_lotes SET empreendimento_slug = ${p.empreendimentoSlug}, lote_slug = ${p.loteSlug},
        itens_versao = ${p.itensVersao}, unit_id = ${p.unitId}, ativo = ${p.ativo}, empreendimento_nome = ${texto(p.empreendimentoNome, 120)},
        quadra = ${texto(p.quadra, 20)}, lote_numero = ${texto(p.lote, 20)}, updated_at = now()
      WHERE id = ${p.id} AND maquete_id = ${m.id} RETURNING id`);
    if (!linhas(r).length) throw new TRPCError({ code: "NOT_FOUND", message: "Lote não encontrado nesta planta." });
    return { id: p.id };
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    if (/maquete_3d_lotes_slug_idx|duplicate key|unique/i.test(String((e as Error)?.message) + String((e as { cause?: Error })?.cause?.message ?? "")))
      throw new TRPCError({ code: "CONFLICT", message: "Já existe um lote com este endereço neste empreendimento." });
    throw e;
  }
}

/** Gera (ou troca) o código do link: o link anterior deixa de abrir na hora. */
export async function gerarCodigo(planta: string, id: number) {
  fonteDoRepo(planta);
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const codigo = novoCodigo();
    try {
      const r = await db().execute(sql`UPDATE maquete_3d_lotes l SET codigo_link = ${codigo}, updated_at = now()
        FROM maquetes_3d m WHERE l.id = ${id} AND m.id = l.maquete_id AND m.fonte_slug = ${planta} AND m.deleted_at IS NULL
        RETURNING l.empreendimento_slug, l.lote_slug`);
      const [l] = linhas<{ empreendimento_slug: string; lote_slug: string }>(r);
      if (!l) throw new TRPCError({ code: "NOT_FOUND", message: "Lote não encontrado nesta planta." });
      return { caminho: caminhoDoLote(l.empreendimento_slug, l.lote_slug, codigo) };
    } catch (e) {
      if (e instanceof TRPCError) throw e; // código repetido (quase impossível): tenta outro
    }
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível gerar o código. Tente de novo." });
}

/** Unidades da Incorporação para ligar ao lote (só código, estudo e status: nada de comprador ou preço). */
export async function buscarUnidades(busca: string) {
  const termo = `%${busca.trim().replace(/[%_\\]/g, "")}%`;
  return linhas<{ id: number; codigo: string; estudo: string | null; status: string }>(await db().execute(sql`
    SELECT u.id, u.code AS codigo, s.name AS estudo, u.status FROM incorporation_units u JOIN incorporation_studies s ON s.id = u.study_id
    WHERE u.deleted_at IS NULL AND (u.code ILIKE ${termo} OR s.name ILIKE ${termo}) ORDER BY s.name, u.code LIMIT 30`))
    .map(u => ({ id: Number(u.id), codigo: u.codigo, estudo: u.estudo, status: statusDaUnidade(u.status) }));
}

/** Lote que a semente liga, por planta do repositório. */
export const SEMENTES: Record<string, { empreendimentoSlug: string; loteSlug: string; empreendimentoNome: string; quadra: string; lote: string; estudo: string }> = {
  "lote4-qd18": { empreendimentoSlug: "vila-esmeralda", loteSlug: "qd18-lote4", empreendimentoNome: "Vila Esmeralda", quadra: "18", lote: "4", estudo: "vila esmeralda" },
};

/**
 * Semente idempotente (o admin aperta o botão): liga o Lote 4 da Quadra 18 (Vila Esmeralda) à maquete lote4-qd18, com
 * código novo. Se já existe, não mexe em nada. Liga a unidade da Incorporação só se houver UMA, num estudo "Vila
 * Esmeralda", com código "Quadra 18 Lote 4" (Q18 L4, QD 18 LT 04…); senão fica sem unidade (sem status na página).
 */
export async function semearLotePadrao(planta: string, autorId: number) {
  const s = SEMENTES[planta];
  if (!s) throw new TRPCError({ code: "NOT_FOUND", message: "Esta planta não tem lote padrão para ligar." });
  const m = await garantirMaqueteDaFonte(planta, autorId);
  const unidades = linhas<{ id: number }>(await db().execute(sql`SELECT u.id FROM incorporation_units u JOIN incorporation_studies s ON s.id = u.study_id
    WHERE u.deleted_at IS NULL AND lower(s.name) LIKE ${`%${s.estudo}%`}
      AND u.code_key ~ ${`^(Q|QD|QUADRA)[ .-]*0*${s.quadra}[ .,/-]*(L|LT|LOTE)[ .-]*0*${s.lote}$`} LIMIT 2`));
  const unitId = unidades.length === 1 ? Number(unidades[0].id) : null;
  const r = await db().execute(sql`INSERT INTO maquete_3d_lotes (empreendimento_slug, lote_slug, maquete_id, unit_id, criado_por, codigo_link, empreendimento_nome, quadra, lote_numero)
    VALUES (${s.empreendimentoSlug}, ${s.loteSlug}, ${m.id}, ${unitId}, ${autorId}, ${novoCodigo()}, ${s.empreendimentoNome}, ${s.quadra}, ${s.lote})
    ON CONFLICT ("empreendimento_slug", "lote_slug") DO NOTHING RETURNING id`);
  return { criado: linhas(r).length === 1, unidadeLigada: unitId !== null };
}

