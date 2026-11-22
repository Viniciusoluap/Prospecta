// EPIC-027 C5 (criadora de mesas) — as PROPOSTAS DE MESA da Dolores (tabelas dolores_mesas_propostas e dolores_mesas_versoes, migração 0151).
// Pedido do dono (aprovado em 21/11/2026): quando ele pede uma função nova, a Dolores escreve uma proposta e guarda para aprovação; só
// entra em operação depois que ele aprovar E a função for construída pelo processo normal de desenvolvimento (fora da Dolores).
//
// Quem grava: (a) as ações propor_mesa / revisar_mesa / propor_aprovacao_mesa / recusar_mesa (acoes/mesas.ts), só depois do "pode"/"confirmo" do
// dono na conversa direta dele; (b) a tela do administrador (mesas-router.ts), que só muda a situação para em construção, em operação ou
// arquivada; (c) a semeadura das mesas que já existem (`semearMesasIniciais`, idempotente, derivada do registro de funções).
// Nada aqui executa código, cria ferramenta, muda o texto do sistema da Dolores ou liga função: aprovar só muda a SITUAÇÃO.
// Texto: uma linha, sem colchetes; senha/token/chave/código de acesso/dado bancário, link e invisível → RECUSA; CPF, telefone e e-mail →
// mascarados (o texto volta à IA quando o dono pergunta pelas mesas, como DADO). Auditoria: dolores_acoes "mesa" com o número e a
// operação — nunca o texto.
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { doloresMesasPropostas, doloresMesasVersoes, type DoloresMesa, type DoloresMesaVersao } from "../../drizzle/schema-dolores-mesas.js";
import { tratarLinksDaResposta } from "../../shared/dolores/links.js";
import {
  MAX_MESA, MAX_MESAS_ABERTAS, SITUACOES_ABERTAS, conferirCapacidades, normalizarMesa, quemAprovaMinimo, maisForte, sementesDerivadas,
  type CatalogoDeCapacidades, type FaixaCusto, type PropostaMesa, type QuemAprova, type SituacaoMesa,
} from "../../shared/dolores/mesas.js";
import { temCaractereInvisivel, textoDeDado } from "../../shared/dolores/fila.js";
import { sanitizarTexto } from "../../shared/dolores/sanitizar.js";
import { getDb, type DrizzleDb } from "../db.js";
import { registrarAcao } from "./auditoria.js";
import { FILTRO_DO_REGISTRO } from "./dados-pessoais.js";

export const FRASE_MESA_COM_SEGREDO = "A proposta tem senha, token, chave, código de acesso ou dado bancário; isso não entra numa mesa. Reescreva sem isso.";
export const FRASE_MESA_COM_LINK = "Link não entra numa proposta de mesa. Reescreva sem o link.";
export const FRASE_MESA_COM_INVISIVEL = "A proposta tem caracteres invisíveis (costuma acontecer com texto copiado); escreva de novo, sem copiar.";
export const FRASE_MESAS_CHEIAS = `Já há ${MAX_MESAS_ABERTAS} mesas abertas (rascunho, aguardando, aprovadas ou em construção); recuse ou arquive alguma antes de propor outra.`;
export const SEM_MIGRACAO_MESAS = "Mesas da Dolores indisponíveis: a migração 0151 ainda não foi aplicada.";

/** Termo bancário (sem acento, minúsculo) + número longo ou e-mail = dado bancário (mais estrito que o filtro geral, como na memória). */
const TERMO_BANCARIO = /\b(?:pix|agencia|ag|conta|cc|banco|bancaria|bancario|ted|doc|boleto|iban|swift)\b/;
const NUMERO_OU_EMAIL = /\d(?:[\d.\-/ ]{4,}\d)|[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

export type TextoDaMesa = { ok: true; texto: string; mascarou: boolean } | { ok: false; motivo: string };

/**
 * Um campo de texto da proposta, como é guardado — a MESMA regra para a conversa e para a semeadura: recusa segredo, dado bancário, link e
 * invisível; mascara CPF, telefone e e-mail; uma linha, sem colchetes (ninguém escreve um "[Aviso do sistema]" falso). Idempotente.
 */
export function textoDaMesa(bruto: string | null | undefined, max: number, min = 1): TextoDaMesa {
  const s = String(bruto ?? "");
  if (temCaractereInvisivel(s)) return { ok: false, motivo: FRASE_MESA_COM_INVISIVEL };
  const linha = textoDeDado(s, Number.MAX_SAFE_INTEGER);
  if (sanitizarTexto(linha, { mascararDadosPessoais: false }) !== linha) return { ok: false, motivo: FRASE_MESA_COM_SEGREDO };
  if (TERMO_BANCARIO.test(normalizarMesa(linha)) && NUMERO_OU_EMAIL.test(linha)) return { ok: false, motivo: FRASE_MESA_COM_SEGREDO };
  if (tratarLinksDaResposta(linha, null) !== linha) return { ok: false, motivo: FRASE_MESA_COM_LINK };
  const mascarado = textoDeDado(sanitizarTexto(linha, FILTRO_DO_REGISTRO), Number.MAX_SAFE_INTEGER);
  if (mascarado.trim().length < min || mascarado.length > max) return { ok: false, motivo: `Um campo da proposta passou do tamanho (até ${max} caracteres). Encurte.` };
  return { ok: true, texto: mascarado, mascarou: mascarado !== linha };
}

/**
 * O pedido original do dono, como fica guardado: o texto da mensagem dele (já sem senha/token/chave/dado bancário — cerebro.ts filtra antes
 * de tudo) com CPF, telefone e e-mail mascarados, sem links, uma linha, até 600 caracteres. Nunca recusa (é registro do que ele pediu).
 */
export function pedidoOriginalFiltrado(t: string | null | undefined): string {
  const semSegredo = sanitizarTexto(String(t ?? ""), FILTRO_DO_REGISTRO);
  return textoDeDado(tratarLinksDaResposta(semSegredo, null), MAX_MESA.pedido);
}

/** A proposta como veio da IA (ou da revisão), antes da conferência. */
export type PropostaBruta = {
  titulo: string; objetivo: string; quandoAge: string; le?: readonly string[]; escreve?: readonly string[]; funcoesNovas?: readonly string[];
  quemAprova: QuemAprova; exemplosBons?: readonly string[]; exemplosRuins?: readonly string[]; riscos?: readonly string[]; custo: FaixaCusto;
};
export type PropostaConferida = { ok: true; proposta: PropostaMesa; ajustes: string[]; mascarou: boolean } | { ok: false; motivo: string };

/**
 * Confere a proposta INTEIRA por código: textos (segredo/link/invisível recusados; dados pessoais mascarados; tamanhos), leituras e ações
 * contra o registro real (`conferirCapacidades`: nome inexistente vira "precisa de função nova") e quem aprova (nunca menos que o mínimo).
 * `ajustes`: o que o sistema mudou (mostrado ao dono no resumo — nada muda em silêncio).
 */
export function conferirProposta(b: PropostaBruta, cat: CatalogoDeCapacidades,
  /** Teto das funções novas citadas na ENTRADA (3 para a IA; numa revisão que mantém as da versão anterior, o teto total). */
  tetoNovasDaEntrada: number = MAX_MESA.funcoesNovasDoModelo): PropostaConferida {
  let mascarou = false;
  const um = (s: string, max: number, min = 3) => {
    const r = textoDaMesa(s, max, min);
    if (!r.ok) throw new Error(r.motivo);
    mascarou ||= r.mascarou;
    return r.texto;
  };
  const varios = (xs: readonly string[] | undefined, teto: number) => {
    const lista = (xs ?? []).map(x => um(x, MAX_MESA.item)).filter(Boolean);
    const unicos = lista.filter((x, i) => lista.findIndex(y => normalizarMesa(y) === normalizarMesa(x)) === i);
    if (unicos.length > teto) throw new Error(`A proposta tem itens demais (até ${teto} por lista). Encurte.`);
    return unicos;
  };
  try {
    const titulo = um(b.titulo, MAX_MESA.titulo);
    const objetivo = um(b.objetivo, MAX_MESA.objetivo, 10);
    const quandoAge = um(b.quandoAge, MAX_MESA.quandoAge, 5);
    const novasDoModelo = varios(b.funcoesNovas, tetoNovasDaEntrada);
    if ((b.le?.length ?? 0) > MAX_MESA.leituras || (b.escreve?.length ?? 0) > MAX_MESA.acoes) throw new Error("A proposta cita leituras ou ações demais. Encurte.");
    const cap = conferirCapacidades({ le: b.le ?? [], escreve: b.escreve ?? [], funcoesNovas: novasDoModelo }, cat);
    if (cap.funcoesNovas.length > MAX_MESA.funcoesNovas) throw new Error(`A proposta precisa de funções novas demais (até ${MAX_MESA.funcoesNovas}); divida em mesas menores.`);
    // os nomes convertidos em "função nova" também passam pelo filtro de texto (vieram da IA)
    const funcoesNovas = cap.funcoesNovas.map(x => um(x, MAX_MESA.item));
    const minimo = quemAprovaMinimo(cap.escreve, funcoesNovas, cat);
    const quemAprova = maisForte(b.quemAprova, minimo);
    const ajustes = [...cap.ajustes];
    if (quemAprova !== b.quemAprova) ajustes.push("quem aprova foi reforçado pelo sistema (a mesa grava no sistema)");
    return {
      ok: true, mascarou, ajustes,
      proposta: { titulo, objetivo, quandoAge, le: cap.le, escreve: cap.escreve, funcoesNovas, quemAprova,
        exemplosBons: varios(b.exemplosBons, MAX_MESA.exemplos), exemplosRuins: varios(b.exemplosRuins, MAX_MESA.exemplos),
        riscos: varios(b.riscos, MAX_MESA.riscos), custo: b.custo },
    };
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : FRASE_MESA_COM_SEGREDO };
  }
}

/**
 * Na EXECUÇÃO de um item aprovado: a proposta guardada (já conferida no preparo) ainda vale? Textos intactos pela mesma regra, leituras e
 * ações ainda no registro, quem aprova não abaixo do mínimo. Motivo da recusa, ou null.
 */
export function revalidarProposta(p: PropostaMesa, cat: CatalogoDeCapacidades): string | null {
  const textos = [p.titulo, p.objetivo, p.quandoAge, ...p.funcoesNovas, ...p.exemplosBons, ...p.exemplosRuins, ...p.riscos];
  for (const t of textos) {
    const r = textoDaMesa(t, MAX_MESA.objetivo, 1);
    if (!r.ok || r.texto !== t) return "O texto da proposta não é mais exatamente o que foi mostrado; nada foi guardado. Peça de novo.";
  }
  const leituras = new Set(cat.leituras);
  const acoes = new Set(cat.acoes);
  if (p.le.some(n => !leituras.has(n)) || p.escreve.some(n => !acoes.has(n))) return "Uma leitura ou ação citada na proposta não existe mais no sistema; nada foi guardado. Peça de novo.";
  if (maisForte(p.quemAprova, quemAprovaMinimo(p.escreve, p.funcoesNovas, cat)) !== p.quemAprova) return "Quem aprova ficou abaixo do mínimo do sistema; nada foi guardado. Peça de novo.";
  return null;
}

/** Erro de "tabela não existe" (a migração 0151 não foi aplicada), em qualquer nível da causa. */
export const semTabelaDasMesas = (e: unknown) => {
  for (let x: unknown = e, i = 0; x && i < 5; x = (x as { cause?: unknown }).cause, i++) if ((x as { code?: unknown }).code === "42P01") return true;
  return false;
};

export const auditarMesa = (p: { resultado: "ok" | "recusada" | "erro"; motivo: string; canal: "tela" | "whatsapp"; autor: number | null; mesaId?: number | null; resumo: Record<string, unknown> }) =>
  registrarAcao({ funcao: "mesa", resultado: p.resultado, motivo: p.motivo, canal: p.canal, autorUserId: p.autor,
    pedidoId: p.mesaId ? `mesa:${p.mesaId}` : null, argumentos: p.mesaId ? { mesaId: p.mesaId } : null, resumo: p.resumo }).catch(() => false);

// ── Banco ──

export async function lerMesa(id: number, db: DrizzleDb = getDb()): Promise<DoloresMesa | null> {
  const [m] = await db.select().from(doloresMesasPropostas).where(eq(doloresMesasPropostas.id, id)).limit(1);
  return m ?? null;
}
export async function lerVersao(mesaId: number, versao: number, db: DrizzleDb = getDb()): Promise<DoloresMesaVersao | null> {
  const [v] = await db.select().from(doloresMesasVersoes).where(and(eq(doloresMesasVersoes.mesaId, mesaId), eq(doloresMesasVersoes.versao, versao))).limit(1);
  return v ?? null;
}
export async function contarAbertas(db: DrizzleDb = getDb()): Promise<number> {
  const [r] = await db.select({ n: count() }).from(doloresMesasPropostas).where(inArray(doloresMesasPropostas.situacao, [...SITUACOES_ABERTAS]));
  return Number(r?.n ?? 0);
}
/** Já existe mesa ABERTA (ou em operação) com o mesmo título (sem acento, sem caixa)? */
export async function tituloIgualAberto(titulo: string, db: DrizzleDb = getDb(), excetoId?: number): Promise<number | null> {
  const alvo = normalizarMesa(titulo);
  const linhas = await db.select({ id: doloresMesasPropostas.id, titulo: doloresMesasPropostas.titulo }).from(doloresMesasPropostas)
    .where(inArray(doloresMesasPropostas.situacao, [...SITUACOES_ABERTAS, "em_operacao"])).limit(200);
  return linhas.find(l => l.id !== excetoId && normalizarMesa(l.titulo) === alvo)?.id ?? null;
}

export type NovaMesa = { proposta: PropostaMesa; pedidoOriginal: string; situacao: SituacaoMesa; origem: "conversa" | "semente"; chaveSemente?: string | null;
  autor: number | null; mensagemId?: number | null; agora: Date };

/** Grava cabeçalho + versão 1 (na transação de escrita da ação, ou na conexão comum para a semeadura). */
export async function inserirMesa(m: NovaMesa, db: DrizzleDb = getDb()): Promise<DoloresMesa> {
  const [cab] = await db.insert(doloresMesasPropostas).values({
    titulo: m.proposta.titulo, pedidoOriginal: m.pedidoOriginal, situacao: m.situacao, versaoAtual: 1, origem: m.origem, chaveSemente: m.chaveSemente ?? null,
    criadoEm: m.agora, atualizadoEm: m.agora, autorUserId: m.autor, atualizadoPor: m.autor, mensagemId: m.mensagemId ?? null,
  }).returning();
  await db.insert(doloresMesasVersoes).values({ mesaId: cab.id, versao: 1, proposta: m.proposta, origem: m.origem, criadoEm: m.agora, autorUserId: m.autor, mensagemId: m.mensagemId ?? null });
  return cab;
}

/** Versão nova (linha nova, imutável) e cabeçalho atualizado — só se a mesa ainda estiver na versão e situação que a proposta leu. */
export async function inserirRevisao(p: { mesaId: number; versaoAntes: number; situacaoAntes: SituacaoMesa; proposta: PropostaMesa; situacao: SituacaoMesa;
  autor: number | null; mensagemId: number | null; agora: Date }, db: DrizzleDb): Promise<boolean> {
  const r = await db.update(doloresMesasPropostas).set({
    titulo: p.proposta.titulo, versaoAtual: p.versaoAntes + 1, situacao: p.situacao, atualizadoEm: p.agora, atualizadoPor: p.autor,
    // a revisão de uma aprovada desfaz a aprovação (o histórico fica nas versões e na auditoria)
    aprovadaEm: null, aprovadaVersao: null, aprovadaMensagemId: null,
  }).where(and(eq(doloresMesasPropostas.id, p.mesaId), eq(doloresMesasPropostas.versaoAtual, p.versaoAntes), eq(doloresMesasPropostas.situacao, p.situacaoAntes)))
    .returning({ id: doloresMesasPropostas.id });
  if (!r.length) return false;
  await db.insert(doloresMesasVersoes).values({ mesaId: p.mesaId, versao: p.versaoAntes + 1, proposta: p.proposta, origem: "conversa", criadoEm: p.agora, autorUserId: p.autor, mensagemId: p.mensagemId });
  return true;
}

/** Muda a situação, só se ela ainda for uma das esperadas (e, quando dado, na versão esperada): uso único, sem corrida. */
export async function mudarSituacaoMesa(id: number, de: readonly SituacaoMesa[], para: SituacaoMesa, p: { por: number | null; agora: Date; versao?: number;
  aprovadaMensagemId?: number | null }, db: DrizzleDb = getDb()): Promise<boolean> {
  const r = await db.update(doloresMesasPropostas).set({
    situacao: para, atualizadoEm: p.agora, atualizadoPor: p.por,
    ...(para === "aprovada" ? { aprovadaEm: p.agora, aprovadaVersao: p.versao ?? sql`${doloresMesasPropostas.versaoAtual}`, aprovadaMensagemId: p.aprovadaMensagemId ?? null } : {}),
    ...(para === "recusada" || para === "arquivada" ? { encerradaEm: p.agora } : {}),
  }).where(and(eq(doloresMesasPropostas.id, id), inArray(doloresMesasPropostas.situacao, [...de]),
    p.versao !== undefined ? eq(doloresMesasPropostas.versaoAtual, p.versao) : undefined))
    .returning({ id: doloresMesasPropostas.id });
  return r.length > 0;
}

// ── Mesas que já existem (semeadura) ──

/** Grava as sementes que faltam (idempotente: a chave é única; rodar de novo não duplica nem altera). Devolve quantas entraram. */
export async function semearMesasIniciais(cat: CatalogoDeCapacidades, agora: Date, db: DrizzleDb = getDb()): Promise<number> {
  const ja = new Set((await db.select({ chave: doloresMesasPropostas.chaveSemente }).from(doloresMesasPropostas)
    .where(eq(doloresMesasPropostas.origem, "semente"))).map(l => l.chave));
  let novas = 0;
  for (const s of sementesDerivadas(cat)) {
    if (ja.has(s.chave)) continue;
    try {
      await db.transaction(async tx => {
        const [cab] = await tx.insert(doloresMesasPropostas).values({
          titulo: s.proposta.titulo, pedidoOriginal: "", situacao: "em_operacao", versaoAtual: 1, origem: "semente", chaveSemente: s.chave,
          criadoEm: agora, atualizadoEm: agora,
        }).onConflictDoNothing().returning({ id: doloresMesasPropostas.id });
        if (!cab) return;
        await tx.insert(doloresMesasVersoes).values({ mesaId: cab.id, versao: 1, proposta: s.proposta, origem: "semente", criadoEm: agora });
        novas++;
      });
    } catch (e) {
      // corrida com outra semeadura (chave única): a outra gravou — segue
      if ((e as { code?: string })?.code !== "23505") throw e;
    }
  }
  if (novas) await auditarMesa({ resultado: "ok", motivo: "mesas que já existem registradas (semeadura)", canal: "tela", autor: null, resumo: { operacao: "semear", novas } });
  return novas;
}

// ── Tela (só admin: mesas-router.ts) ──

export type FiltroMesas = { situacao: SituacaoMesa | "abertas" | "todas"; limite: number };

export async function listarMesas(f: FiltroMesas, db: DrizzleDb = getDb()) {
  const onde = f.situacao === "todas" ? undefined : f.situacao === "abertas" ? inArray(doloresMesasPropostas.situacao, [...SITUACOES_ABERTAS]) : eq(doloresMesasPropostas.situacao, f.situacao);
  const cabs = await db.select().from(doloresMesasPropostas).where(onde)
    .orderBy(asc(sql`CASE ${doloresMesasPropostas.situacao} WHEN 'aguardando_dono' THEN 0 WHEN 'rascunho' THEN 1 WHEN 'aprovada' THEN 2 WHEN 'em_construcao' THEN 3 WHEN 'em_operacao' THEN 4 ELSE 5 END`),
      desc(doloresMesasPropostas.atualizadoEm), desc(doloresMesasPropostas.id)).limit(f.limite);
  if (!cabs.length) return [];
  const versoes = await db.select().from(doloresMesasVersoes).where(inArray(doloresMesasVersoes.mesaId, cabs.map(c => c.id)));
  const atual = new Map(versoes.filter(v => cabs.some(c => c.id === v.mesaId && c.versaoAtual === v.versao)).map(v => [v.mesaId, v]));
  return cabs.map(c => ({ ...c, proposta: atual.get(c.id)?.proposta ?? null }));
}

export async function versoesDaMesa(id: number, db: DrizzleDb = getDb()) {
  return db.select().from(doloresMesasVersoes).where(eq(doloresMesasVersoes.mesaId, id)).orderBy(desc(doloresMesasVersoes.versao));
}
