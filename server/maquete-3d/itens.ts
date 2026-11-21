// Maquete 3D (EPIC-028, Etapa 3) — itens editáveis (móveis, bancadas, balcão) das maquetes que nascem de um JSON-fonte
// do repositório (data/plantas/<slug>.json). A ESTRUTURA vem sempre do arquivo do servidor: a tela só manda os itens.
// Cada salvamento grava uma versão nova e imutável em maquete_3d_itens (rascunho); "Publicar" troca a versão que o
// cliente vê (maquetes_3d.itens_versao_publicada). O servidor confere os itens (zod, lista fechada de materiais) e
// revalida as MESMAS regras da tela (validarFonte) contra a estrutura do servidor ao salvar e ao publicar.
// Sem transação interativa (neon-http): concorrência otimista com INSERT/UPDATE condicionais num só comando.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { users } from "../../drizzle/schema.js";
import { maquete3dItens, maquetes3d, type Maquete3d } from "../../drizzle/schema-maquete-3d.js";
import { lerFonte, type FontePlanta, type ItemFonte } from "../../shared/maquete-3d/fonte.js";
import { fonteParaModelo } from "../../shared/maquete-3d/fonte-cena.js";
import {
  bloqueiaSalvar, canonico, itensEdicaoSchema, problemasDaEdicao, travadosAlterados,
} from "../../shared/maquete-3d/edicao.js";
import type { ProblemaFonte } from "../../shared/maquete-3d/validacao-fonte.js";
import { db } from "./base.js";

// ── Plantas do repositório ──

/** Plantas com JSON-fonte no repositório. Caminhos fixos (o empacotador da Vercel enxerga o arquivo). */
const ARQUIVOS: Record<string, () => URL> = {
  "lote4-qd18": () => new URL("../../data/plantas/lote4-qd18.json", import.meta.url),
};
export const PLANTAS_DO_REPO = Object.keys(ARQUIVOS);
export const slugPlantaValido = (s: string) => /^[a-z0-9-]{1,80}$/.test(s) && s in ARQUIVOS;

const cache = new Map<string, FontePlanta>();
/** JSON-fonte da planta (estrutura do servidor + itens padrão). */
export function fonteDoRepo(slug: string): FontePlanta {
  if (!slugPlantaValido(slug)) throw new TRPCError({ code: "NOT_FOUND", message: "Planta não encontrada." });
  const pronta = cache.get(slug);
  if (pronta) return pronta;
  // Sem empacotar (Vercel): ao lado do código; empacotado (dist/index.js): a partir da pasta do projeto.
  const candidatos = [fileURLToPath(ARQUIVOS[slug]()), path.resolve(process.cwd(), "data", "plantas", `${slug}.json`)];
  const arquivo = candidatos.find(c => existsSync(c));
  if (!arquivo) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "O arquivo da planta não está no servidor." });
  const f = lerFonte(JSON.parse(readFileSync(arquivo, "utf8")));
  cache.set(slug, f);
  return f;
}

/** Hash da estrutura (paredes, aberturas, ambientes, cobertura): a versão dos itens diz a que estrutura se refere. */
export const hashDaEstrutura = (f: FontePlanta) => createHash("sha256").update(canonico({ estrutura: f.estrutura, lote: f.lote, niveis: f.niveis })).digest("hex");

// ── Maquete da planta (semente idempotente) ──

/**
 * A maquete da planta, criada na primeira vez que o admin abre o editor (sem script manual). Uma por planta
 * (índice único em fonte_slug): duas abas ao mesmo tempo não criam duas.
 */
export async function garantirMaqueteDaFonte(slug: string, autorId: number | null): Promise<Maquete3d> {
  const buscar = async () => (await db().select().from(maquetes3d)
    .where(and(eq(maquetes3d.fonteSlug, slug), isNull(maquetes3d.deletedAt))).limit(1))[0];
  const existente = await buscar();
  if (existente) return existente;
  const f = fonteDoRepo(slug);
  await db().execute(sql`INSERT INTO maquetes_3d (token, titulo, origem, tipo, status, modelo, modelo_versao, solicitado_por, fonte_slug)
    VALUES (${randomBytes(24).toString("hex")}, ${f.nome.slice(0, 255)}, 'fonte', 'casa', 'validada', ${JSON.stringify(fonteParaModelo(f))}, 1, ${autorId}, ${slug})
    ON CONFLICT ("fonte_slug") WHERE "deleted_at" IS NULL AND "fonte_slug" IS NOT NULL DO NOTHING`);
  const criada = await buscar();
  if (!criada) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível criar a maquete da planta." });
  return criada;
}

// ── Conferência dos itens ──

const listar = (ps: ProblemaFonte[]) => ps.filter(p => p.nivel === "erro").slice(0, 6).map(p => p.mensagem).join(" ");

/**
 * Confere os itens vindos da tela: formato (zod), itens travados da planta e as regras de `validarFonte` contra a
 * estrutura DO SERVIDOR. Qualquer erro recusa (BAD_REQUEST) com a mensagem em português.
 */
export function conferirItens(f: FontePlanta, brutos: unknown): { itens: ItemFonte[]; problemas: ProblemaFonte[] } {
  const r = itensEdicaoSchema.safeParse(brutos);
  if (!r.success) throw new TRPCError({ code: "BAD_REQUEST", message: `Itens em formato inválido: ${r.error.issues[0]?.message ?? "confira os campos"}.` });
  const itens = r.data as ItemFonte[];
  const travados = travadosAlterados(f.itens, itens);
  if (travados.length) throw new TRPCError({ code: "BAD_REQUEST", message: `Itens travados da planta não podem mudar: ${travados.join(", ")}.` });
  const problemas = problemasDaEdicao(f, itens);
  if (bloqueiaSalvar(problemas)) throw new TRPCError({ code: "BAD_REQUEST", message: `Não foi salvo: ${listar(problemas)}` });
  return { itens, problemas };
}

const conflito = () => new TRPCError({ code: "CONFLICT", message: "Os itens foram salvos por outra pessoa depois que você abriu o editor. Recarregue para ver a versão mais nova." });

type Linha = typeof maquete3dItens.$inferSelect;
const linhas = (r: unknown) => (r as { rows: Record<string, unknown>[] }).rows;

async function ultimaVersao(maqueteId: number): Promise<Linha | undefined> {
  return (await db().select().from(maquete3dItens).where(eq(maquete3dItens.maqueteId, maqueteId)).orderBy(desc(maquete3dItens.versao)).limit(1))[0];
}
async function versaoDe(maqueteId: number, versao: number): Promise<Linha | undefined> {
  return (await db().select().from(maquete3dItens).where(and(eq(maquete3dItens.maqueteId, maqueteId), eq(maquete3dItens.versao, versao))).limit(1))[0];
}
const lerItens = (texto: string): ItemFonte[] => {
  try { const r = itensEdicaoSchema.safeParse(JSON.parse(texto)); return r.success ? (r.data as ItemFonte[]) : []; } catch { return []; }
};

// ── Operações ──

/** Estrutura + o rascunho mais recente (ou o publicado, ou o padrão da planta) para o editor. */
export async function carregarParaEdicao(slug: string, autorId: number) {
  const f = fonteDoRepo(slug);
  const m = await garantirMaqueteDaFonte(slug, autorId);
  const ultima = await ultimaVersao(m.id);
  const hash = hashDaEstrutura(f);
  const itens = ultima ? lerItens(ultima.itens) : f.itens;
  const [autor] = ultima?.autorId ? await db().select({ nome: users.name }).from(users).where(eq(users.id, ultima.autorId)).limit(1) : [];
  return {
    maqueteId: m.id, slug, titulo: m.titulo,
    fonte: { ...f, itens },
    padrao: f.itens,
    versaoBase: ultima?.versao ?? 0,
    situacao: (ultima ? (ultima.situacao === "publicada" ? "publicada" : "rascunho") : "padrao") as "padrao" | "rascunho" | "publicada",
    versaoPublicada: m.itensVersaoPublicada ?? null,
    rascunhoNaoPublicado: !!ultima && ultima.versao !== m.itensVersaoPublicada,
    /** A estrutura do arquivo mudou depois que estes itens foram salvos: as regras valem contra a estrutura nova. */
    estruturaMudou: !!ultima && ultima.estruturaHash !== hash,
    ultimaSalva: ultima ? { versao: ultima.versao, em: ultima.createdAt, autor: autor?.nome ?? null } : null,
    problemas: problemasDaEdicao(f, itens),
  };
}

/** Grava uma versão nova (rascunho). `versaoBase`: a última versão que a tela conhecia (0 = nenhuma). */
export async function salvarRascunho(p: { slug: string; versaoBase: number; itens: unknown; motivo?: string | null; autorId: number; origem?: "rascunho" | "restauracao" }) {
  const f = fonteDoRepo(p.slug);
  const { itens, problemas } = conferirItens(f, p.itens);
  const m = await garantirMaqueteDaFonte(p.slug, p.autorId);
  const texto = JSON.stringify(itens);
  const r = await db().execute(sql`INSERT INTO maquete_3d_itens (maquete_id, versao, itens, quantidade, modelo_versao, estrutura_hash, situacao, origem, motivo, autor_id)
    SELECT ${m.id}, ${p.versaoBase + 1}, ${texto}, ${itens.length}, ${m.modeloVersao}, ${hashDaEstrutura(f)}, 'rascunho', ${p.origem ?? "rascunho"}, ${p.motivo?.slice(0, 400) || null}, ${p.autorId}
    WHERE (SELECT coalesce(max(versao), 0) FROM maquete_3d_itens WHERE maquete_id = ${m.id}) = ${p.versaoBase}
    ON CONFLICT DO NOTHING
    RETURNING versao`);
  const [linha] = linhas(r);
  if (!linha) throw conflito();
  return { versao: Number(linha.versao), avisos: problemas.filter(x => x.nivel === "aviso") };
}

/**
 * Publica a versão `versao` (tem de ser a última salva): revalida contra a estrutura atual do servidor, marca como
 * publicada, arquiva a publicada anterior e os rascunhos mais antigos, e aponta a maquete para ela — num só comando.
 */
export async function publicarVersao(p: { slug: string; versao: number; autorId: number }) {
  const f = fonteDoRepo(p.slug);
  const m = await garantirMaqueteDaFonte(p.slug, p.autorId);
  const alvo = await versaoDe(m.id, p.versao);
  if (!alvo) throw new TRPCError({ code: "NOT_FOUND", message: "Versão dos itens não encontrada." });
  const hash = hashDaEstrutura(f);
  if (alvo.estruturaHash !== hash)
    throw new TRPCError({ code: "CONFLICT", message: "A planta (estrutura) mudou depois que esta versão foi salva. Abra o editor de novo e salve antes de publicar." });
  let brutos: unknown;
  try { brutos = JSON.parse(alvo.itens); } catch { throw new TRPCError({ code: "BAD_REQUEST", message: "Versão gravada ilegível." }); }
  conferirItens(f, brutos);
  if (m.itensVersaoPublicada === p.versao && alvo.situacao === "publicada") return { versao: p.versao, jaPublicada: true };
  const r = await db().execute(sql`WITH alvo AS (
      SELECT versao FROM maquete_3d_itens
      WHERE maquete_id = ${m.id} AND versao = ${p.versao} AND situacao = 'rascunho' AND estrutura_hash = ${hash}
        AND versao = (SELECT max(versao) FROM maquete_3d_itens WHERE maquete_id = ${m.id})
    ), mq AS (
      UPDATE maquetes_3d SET itens_versao_publicada = ${p.versao}, publicado_em = now(), updated_at = now()
      WHERE id = ${m.id} AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM alvo) RETURNING id
    ), it AS (
      UPDATE maquete_3d_itens SET
        situacao = CASE WHEN versao = ${p.versao} THEN 'publicada' ELSE 'arquivada' END,
        publicada_em = CASE WHEN versao = ${p.versao} THEN now() ELSE publicada_em END,
        publicada_por = CASE WHEN versao = ${p.versao} THEN ${p.autorId} ELSE publicada_por END
      WHERE maquete_id = ${m.id} AND EXISTS (SELECT 1 FROM alvo)
        AND ((versao = ${p.versao} AND situacao = 'rascunho') OR (versao <> ${p.versao} AND situacao = 'publicada') OR (versao < ${p.versao} AND situacao = 'rascunho'))
      RETURNING versao
    )
    SELECT (SELECT count(*) FROM mq)::int AS maquete, (SELECT count(*) FROM it)::int AS itens`);
  const [res] = linhas(r);
  if (!res || Number(res.maquete) !== 1) throw conflito();
  return { versao: p.versao, jaPublicada: false };
}

/** Grava como rascunho os itens padrão da planta (o JSON do repositório). */
export async function restaurarPadrao(p: { slug: string; versaoBase: number; autorId: number }) {
  const f = fonteDoRepo(p.slug);
  return salvarRascunho({ slug: p.slug, versaoBase: p.versaoBase, itens: f.itens, motivo: "Padrão da planta restaurado", autorId: p.autorId, origem: "restauracao" });
}

/** Versões salvas (mais nova primeiro), sem o JSON dos itens. */
export async function listarVersoes(slug: string) {
  fonteDoRepo(slug);
  const [m] = await db().select().from(maquetes3d).where(and(eq(maquetes3d.fonteSlug, slug), isNull(maquetes3d.deletedAt))).limit(1);
  if (!m) return [];
  const vs = await db().select({
    versao: maquete3dItens.versao, situacao: maquete3dItens.situacao, origem: maquete3dItens.origem, quantidade: maquete3dItens.quantidade,
    autorId: maquete3dItens.autorId, createdAt: maquete3dItens.createdAt, publicadaEm: maquete3dItens.publicadaEm,
  }).from(maquete3dItens).where(eq(maquete3dItens.maqueteId, m.id)).orderBy(desc(maquete3dItens.versao)).limit(50);
  const ids = Array.from(new Set(vs.map(v => v.autorId).filter((v): v is number => !!v)));
  const nomes = new Map((ids.length ? await db().select({ id: users.id, nome: users.name }).from(users).where(inArray(users.id, ids)) : []).map(u => [u.id, u.nome]));
  return vs.map(({ autorId, ...v }) => ({ ...v, autor: autorId ? nomes.get(autorId) ?? null : null, emUso: v.versao === m.itensVersaoPublicada }));
}

/**
 * Leitura pública (pronta para a Etapa 4, sem rota nova agora): só a versão PUBLICADA, nunca rascunho. Sem itens
 * publicados, `null` (quem chamar mostra os itens padrão da planta ou nada). Nada de autor, histórico ou rascunho.
 */
export async function itensPublicados(maqueteId: number): Promise<{ versao: number; itens: ItemFonte[] } | null> {
  const [m] = await db().select({ v: maquetes3d.itensVersaoPublicada }).from(maquetes3d).where(and(eq(maquetes3d.id, maqueteId), isNull(maquetes3d.deletedAt))).limit(1);
  if (!m?.v) return null;
  const [l] = await db().select({ itens: maquete3dItens.itens, situacao: maquete3dItens.situacao }).from(maquete3dItens)
    .where(and(eq(maquete3dItens.maqueteId, maqueteId), eq(maquete3dItens.versao, m.v), eq(maquete3dItens.situacao, "publicada"))).limit(1);
  return l ? { versao: m.v, itens: lerItens(l.itens) } : null;
}
