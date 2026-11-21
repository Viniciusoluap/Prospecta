// EPIC-027 C5 (memória de longo prazo) — a memória PERMANENTE da Dolores (tabela dolores_memoria_longa, migração 0149).
// Decisão do dono (21/11/2026): fatos e preferências permanentes "dentro do sistema", com tela para ver, corrigir e apagar.
//
// Quem grava: (a) as ações guardar_memoria / corrigir_memoria / esquecer_memoria (acoes/memoria.ts), só depois do "pode" do dono na
// conversa direta dele; (b) a tela do administrador (memoria-longa-router.ts). Nada aqui grava por inferência.
// O texto: uma linha, sem colchetes, até 300 caracteres; senha/token/chave/código de acesso/dado bancário e link → RECUSA; CPF,
// telefone e e-mail → mascarados ("(dado pessoal omitido)"), porque o texto volta à IA em toda conversa do dono.
// Quem lê: só `blocoParaConversaDoDono`, chamado em whatsapp.ts#tratarComando (a conversa direta do número do dono). O laço de grupo
// (marcacao.ts) e o de cliente (atendimento.ts) não importam este arquivo — teste em c5-memoria-longa.test.ts.
// "Apagar" = ARQUIVAR (situacao 'arquivada', com quem e quando): o registro fica e pode ser restaurado (regra de não excluir).
// Auditoria: dolores_acoes "memoria_longa" com o número e a categoria — nunca o texto.
import { and, asc, desc, eq, ilike, sql } from "drizzle-orm";
import { doloresMemoriaLonga, type DoloresMemoriaLonga } from "../../drizzle/schema-dolores-memoria-longa.js";
import { tratarLinksDaResposta } from "../../shared/dolores/links.js";
import {
  MAX_CARACTERES_NO_CONTEXTO, MAX_FATOS_NO_CONTEXTO, MAX_MEMORIAS_ATIVAS, MAX_TEXTO_MEMORIA, MIN_TEXTO_MEMORIA, blocoDaMemoria, escolherParaContexto,
  normalizarMemoria, type CategoriaMemoria, type MemoriaParaContexto, type OrigemMemoria,
} from "../../shared/dolores/memoria-longa.js";
import { temCaractereInvisivel, textoDeDado } from "../../shared/dolores/fila.js";
import { sanitizarTexto } from "../../shared/dolores/sanitizar.js";
import type { ReferenciaConversa } from "../../drizzle/schema-dolores-conversa.js";
import { getDb, type DrizzleDb } from "../db.js";
import { registrarAcao } from "./auditoria.js";
import { FILTRO_DO_REGISTRO } from "./dados-pessoais.js";
import { erroParaLog } from "./erro-seguro.js";

export const FRASE_MEMORIA_COM_SEGREDO = "Isso eu não guardo na memória: o texto tem senha, token, chave, código de acesso ou dado bancário. Reescreva sem isso.";
export const FRASE_MEMORIA_COM_LINK = "Link eu não guardo na memória. Reescreva sem o link.";
export const FRASE_MEMORIA_COM_INVISIVEL = "O texto tem caracteres invisíveis (costuma acontecer com texto copiado); digite de novo, sem copiar.";
export const FRASE_MEMORIA_TAMANHO = `O que eu guardo na memória tem de ser curto: de ${MIN_TEXTO_MEMORIA} a ${MAX_TEXTO_MEMORIA} caracteres.`;
export const FRASE_MEMORIA_CHEIA = `A memória já tem ${MAX_MEMORIAS_ATIVAS} lembranças ativas; arquive alguma (Integrações › Memória da Dolores) antes de guardar outra.`;

export type TextoDaMemoria = { ok: true; texto: string; mascarou: boolean } | { ok: false; motivo: string };

/**
 * O texto como é guardado — a MESMA regra para a conversa e para a tela: recusa segredo, dado bancário, link e invisível; mascara CPF,
 * telefone e e-mail; uma linha, sem colchetes (ninguém escreve um "[Contexto do sistema]" falso), de 3 a 300 caracteres. Idempotente:
 * passar o resultado de novo devolve o mesmo texto.
 */
export function textoDaMemoria(bruto: string | null | undefined): TextoDaMemoria {
  const s = String(bruto ?? "");
  if (temCaractereInvisivel(s)) return { ok: false, motivo: FRASE_MEMORIA_COM_INVISIVEL };
  const linha = textoDeDado(s, Number.MAX_SAFE_INTEGER);
  // segredo e dado bancário: o filtro de segurança sem a parte de dados pessoais mexeria no texto → recusa
  if (sanitizarTexto(linha, { mascararDadosPessoais: false }) !== linha) return { ok: false, motivo: FRASE_MEMORIA_COM_SEGREDO };
  if (tratarLinksDaResposta(linha, null) !== linha) return { ok: false, motivo: FRASE_MEMORIA_COM_LINK };
  const mascarado = textoDeDado(sanitizarTexto(linha, FILTRO_DO_REGISTRO), Number.MAX_SAFE_INTEGER);
  if (mascarado.trim().length < MIN_TEXTO_MEMORIA || mascarado.length > MAX_TEXTO_MEMORIA) return { ok: false, motivo: FRASE_MEMORIA_TAMANHO };
  return { ok: true, texto: mascarado, mascarou: mascarado !== linha };
}

const auditar = (p: { resultado: "ok" | "recusada" | "erro"; motivo: string; canal: "tela" | "whatsapp"; autor: number | null; memoriaId?: number | null; resumo: Record<string, unknown> }) =>
  registrarAcao({ funcao: "memoria_longa", resultado: p.resultado, motivo: p.motivo, canal: p.canal, autorUserId: p.autor,
    pedidoId: p.memoriaId ? `memoria:${p.memoriaId}` : null, argumentos: p.memoriaId ? { memoriaId: p.memoriaId } : null, resumo: p.resumo }).catch(() => false);

/** Já existe memória ATIVA com o mesmo texto (sem acento, sem caixa)? */
export async function memoriaIgualAtiva(texto: string, db: DrizzleDb = getDb(), excetoId?: number): Promise<number | null> {
  const alvo = normalizarMemoria(texto);
  const linhas = await db.select({ id: doloresMemoriaLonga.id, texto: doloresMemoriaLonga.texto }).from(doloresMemoriaLonga)
    .where(eq(doloresMemoriaLonga.situacao, "ativa")).limit(MAX_MEMORIAS_ATIVAS + 10);
  return linhas.find(l => l.id !== excetoId && normalizarMemoria(l.texto) === alvo)?.id ?? null;
}

export async function contarAtivas(db: DrizzleDb = getDb()): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(doloresMemoriaLonga).where(eq(doloresMemoriaLonga.situacao, "ativa"));
  return Number(r?.n ?? 0);
}

export type NovaMemoria = { texto: string; categoria: CategoriaMemoria; leadId: number | null; obraId: number | null; origem: OrigemMemoria; autor: number | null; mensagemId?: number | null; agora: Date };

/** Grava (texto JÁ passado por `textoDaMemoria`). `db`: a transação de escrita da ação, ou a conexão comum (tela). */
export async function inserirMemoria(m: NovaMemoria, db: DrizzleDb = getDb()): Promise<DoloresMemoriaLonga> {
  const [linha] = await db.insert(doloresMemoriaLonga).values({
    texto: m.texto, categoria: m.categoria, leadId: m.leadId, obraId: m.obraId, origem: m.origem, situacao: "ativa",
    criadoEm: m.agora, atualizadoEm: m.agora, autorUserId: m.autor, atualizadoPor: m.autor, mensagemId: m.mensagemId ?? null,
  }).returning();
  return linha;
}

export async function lerMemoria(id: number, db: DrizzleDb = getDb()): Promise<DoloresMemoriaLonga | null> {
  const [m] = await db.select().from(doloresMemoriaLonga).where(eq(doloresMemoriaLonga.id, id)).limit(1);
  return m ?? null;
}

/** Corrige o texto/categoria/vínculo de uma memória (só se ainda estiver como a proposta/tela a leu: `antes`). */
export async function atualizarMemoria(id: number, p: { texto: string; categoria: CategoriaMemoria; leadId: number | null; obraId: number | null; por: number | null; agora: Date; antes?: string }, db: DrizzleDb = getDb()): Promise<boolean> {
  const r = await db.update(doloresMemoriaLonga)
    .set({ texto: p.texto, categoria: p.categoria, leadId: p.leadId, obraId: p.obraId, atualizadoEm: p.agora, atualizadoPor: p.por })
    .where(and(eq(doloresMemoriaLonga.id, id), p.antes !== undefined ? eq(doloresMemoriaLonga.texto, p.antes) : undefined))
    .returning({ id: doloresMemoriaLonga.id });
  return r.length > 0;
}

/** Arquiva ("apagar"/"esquece que…") ou restaura. Só muda se a situação for a esperada (uso único, sem corrida). */
export async function mudarSituacao(id: number, para: "ativa" | "arquivada", p: { por: number | null; agora: Date; antes?: string }, db: DrizzleDb = getDb()): Promise<boolean> {
  const de = para === "arquivada" ? "ativa" : "arquivada";
  const r = await db.update(doloresMemoriaLonga)
    .set({ situacao: para, arquivadoEm: para === "arquivada" ? p.agora : null, atualizadoEm: p.agora, atualizadoPor: p.por })
    .where(and(eq(doloresMemoriaLonga.id, id), eq(doloresMemoriaLonga.situacao, de), p.antes !== undefined ? eq(doloresMemoriaLonga.texto, p.antes) : undefined))
    .returning({ id: doloresMemoriaLonga.id });
  return r.length > 0;
}

export { auditar as auditarMemoria };

// ── Contexto da conversa do DONO ──

export type BlocoDaMemoria = { bloco: string; usadas: number; ativas: number; caracteres: number };

/** As memórias ativas (teto de linhas: as mais recentes primeiro, para o caso de passar do teto de ativas). */
async function ativasParaContexto(): Promise<MemoriaParaContexto[]> {
  const linhas = await getDb().select({ id: doloresMemoriaLonga.id, texto: doloresMemoriaLonga.texto, categoria: doloresMemoriaLonga.categoria,
    leadId: doloresMemoriaLonga.leadId, obraId: doloresMemoriaLonga.obraId, atualizadoEm: doloresMemoriaLonga.atualizadoEm })
    .from(doloresMemoriaLonga).where(eq(doloresMemoriaLonga.situacao, "ativa")).orderBy(desc(doloresMemoriaLonga.atualizadoEm), desc(doloresMemoriaLonga.id)).limit(MAX_MEMORIAS_ATIVAS);
  return linhas;
}

/**
 * O bloco da memória para a conversa direta do DONO (e só ela: whatsapp.ts#tratarComando). `referencias`: clientes/obras citados na
 * conversa recente (memória curta, E1) — se passar do teto, as ligadas a eles têm prioridade. Falha → null (ela responde sem a memória
 * longa; nada vai para log além da causa).
 */
export async function blocoParaConversaDoDono(referencias: readonly ReferenciaConversa[] = []): Promise<BlocoDaMemoria | null> {
  try {
    const ativas = await ativasParaContexto();
    if (!ativas.length) return null;
    const citados = {
      leads: new Set(referencias.filter(r => r.tipo === "cliente").map(r => r.id)),
      obras: new Set(referencias.filter(r => r.tipo === "obra").map(r => r.id)),
    };
    const escolhidas = escolherParaContexto(ativas, citados);
    const bloco = blocoDaMemoria(escolhidas);
    return bloco ? { bloco, usadas: escolhidas.length, ativas: ativas.length, caracteres: escolhidas.reduce((s, m) => s + m.texto.length, 0) } : null;
  } catch (e) {
    console.error("[dolores/memoria-longa] falha ao ler a memória de longo prazo; a conversa segue sem ela", erroParaLog(e));
    return null;
  }
}

// ── Tela (só admin: memoria-longa-router.ts) ──

export type FiltroDaTela = { busca?: string; categoria?: CategoriaMemoria; situacao: "ativa" | "arquivada" | "todas"; limite: number };

export async function listarParaTela(f: FiltroDaTela) {
  const busca = f.busca?.trim() ? `%${f.busca.trim().replace(/[\\%_]/g, m => `\\${m}`)}%` : null;
  const linhas = await getDb().select().from(doloresMemoriaLonga).where(and(
    f.situacao === "todas" ? undefined : eq(doloresMemoriaLonga.situacao, f.situacao),
    f.categoria ? eq(doloresMemoriaLonga.categoria, f.categoria) : undefined,
    busca ? ilike(doloresMemoriaLonga.texto, busca) : undefined,
  )).orderBy(asc(doloresMemoriaLonga.situacao), desc(doloresMemoriaLonga.atualizadoEm), desc(doloresMemoriaLonga.id)).limit(f.limite);
  const ativas = await ativasParaContexto();
  const usadas = escolherParaContexto(ativas);
  return {
    itens: linhas,
    contexto: { ativas: ativas.length, usadas: usadas.length, caracteres: usadas.reduce((s, m) => s + m.texto.length, 0),
      tetoFatos: MAX_FATOS_NO_CONTEXTO, tetoCaracteres: MAX_CARACTERES_NO_CONTEXTO, tetoAtivas: MAX_MEMORIAS_ATIVAS },
  };
}
