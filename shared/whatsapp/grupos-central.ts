// EPIC-027 C2 — grupos do WhatsApp na Central (decisão do dono de 20/11/2026, noite: "Aqui nas mensagens do WhatsApp também deve
// aparecer as mensagens do grupo para que o humano possa intervir"; quem vê: "Somente o Admin e os colaboradores que tiverem esse
// campo selecionado lá na hora do cadastro dele"; quais: "Todos"; intervir: "Pode escrever, exatamente igual faz na conversa").
// Regras puras (sem banco), usadas pelo servidor (que confere de novo em toda rota) e pela tela.
import { parsePermissions } from "../admin-permissions.js";

export type UsuarioDosGrupos = { role: string; permissions?: string | null; active?: boolean | null };

/**
 * Quem vê os grupos na Central: admin ativo, sempre; colaborador ativo com o módulo WhatsApp (decisão do dono de 21/11/2026: "quem já
 * tem 'WhatsApp' marcado deve ver os grupos direto" — sem permissão separada); mais ninguém (corretor, que entra em whatsapp.* só pela
 * conexão própria, cliente, empreiteiro, inativo, anônimo).
 */
export function podeVerGruposNaCentral(u: UsuarioDosGrupos | null | undefined): boolean {
  if (!u || u.active === false) return false;
  if (u.role === "admin") return true;
  if (u.role !== "colaborador") return false;
  const p = parsePermissions(u.permissions);
  return p.includes("whatsapp");
}

/** Situações de grupo que a Central mostra. Recusado nunca; "aguardando o dono" só ao admin (marcado). */
export type SituacaoNaCentral = "aceito" | "aguardando_dono";

/** O grupo aparece para este papel? Desativado e recusado: nunca. Aguardando o dono: só admin. */
export function grupoVisivelNaCentral(g: { ativo: boolean; situacaoConfirmacao: string }, role: string): boolean {
  if (!g.ativo || g.situacaoConfirmacao === "recusado") return false;
  if (g.situacaoConfirmacao === "aguardando_dono") return role === "admin";
  return true;
}

/** Tipos de mensagem de grupo (os mesmos de dolores_grupo_mensagens.tipo). */
const ROTULO_MIDIA: Record<string, string> = {
  imagem: "[imagem]", documento: "[documento]", video: "[vídeo]", audio: "[áudio]", figurinha: "[figurinha]",
};

/** Texto de uma mensagem de grupo para leitura humana: a mídia vira rótulo ("[imagem]", "[áudio]", "[documento] nome"), mais a legenda. */
export function textoDaMensagemDeGrupo(m: { tipo: string; texto: string | null; midiaNome?: string | null }): string {
  const rotulo = ROTULO_MIDIA[m.tipo];
  if (!rotulo) return m.texto ?? "";
  const cabeca = m.tipo === "documento" && m.midiaNome ? `${rotulo} ${m.midiaNome}` : rotulo;
  return m.texto ? `${cabeca} ${m.texto}` : cabeca;
}

/**
 * Nomes "da empresa": participante cujo nome contenha um destes é marcado "(participante)". Lista única, fácil de editar.
 * Confirmada pelo dono em 21/11/2026 (com "Exclusive" acrescentado por ele).
 */
export const NOMES_DA_EMPRESA: readonly string[] = ["Prospecta", "Central Efficaz", "Efficaz", "Eficaz", "VFX Capital", "Exclusive"];
/** Nomes que só a própria Dolores e a equipe usam na conversa do grupo. */
const NOMES_RESERVADOS = ["dolores", "equipe"] as const;

/** Homógrafos comuns (cirílico e grego) → latim, e dígitos que imitam letras. */
const HOMOGRAFOS: Readonly<Record<string, string>> = {
  "а": "a", "в": "b", "е": "e", "ё": "e", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c", "т": "t", "у": "y", "х": "x",
  "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ӏ": "l", "ԛ": "q", "ԝ": "w",
  "α": "a", "β": "b", "ε": "e", "η": "n", "ι": "i", "κ": "k", "μ": "m", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u", "χ": "x",
  "ς": "s", "σ": "o", "ℓ": "l",
  "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s",
};

/**
 * Forma compacta para comparar: NFKC (letras largas/estilizadas viram comuns), minúsculas, sem diacríticos, homógrafos → latim e SÓ
 * as letras a–z (espaços, pontos, traços e invisíveis entre as letras somem: "D o l o r e s", "D.o.l.o.r.e.s" → "dolores").
 * Laço simples por caractere (tempo linear; nenhuma regex com retrocesso). Entrada cortada em 400 caracteres.
 */
export function formaCompacta(s: string | null | undefined): string {
  const base = String(s ?? "").slice(0, 400).normalize("NFKC").toLowerCase().normalize("NFD");
  let out = "";
  for (const ch of base) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x300 && cp <= 0x36f) continue; // diacrítico
    const t = HOMOGRAFOS[ch] ?? ch;
    if (t >= "a" && t <= "z" && t.length === 1) out += t;
  }
  return out;
}

/**
 * Portão de QA da C2 (achados 3 e r2-B1): o nome que o participante escolheu imita a Dolores, a equipe, a empresa ou um usuário da
 * equipe? Por código, sobre a forma compacta: contém "dolores" ou "equipe"; contém um dos `NOMES_DA_EMPRESA`; ou é IGUAL ao nome de
 * um usuário ativo da equipe (`equipe`, lido do cadastro pelo servidor).
 */
export function nomeImitaQuemNaoE(nome: string | null | undefined, equipe: readonly string[] = []): boolean {
  const c = formaCompacta(nome);
  if (!c) return false;
  if (NOMES_RESERVADOS.some(r => c.includes(r))) return true;
  if (NOMES_DA_EMPRESA.some(e => { const x = formaCompacta(e); return x.length >= 4 && c.includes(x); })) return true;
  return equipe.some(u => { const x = formaCompacta(u); return x.length >= 4 && x === c; });
}

/** Autor de uma mensagem de participante: o nome dele (marcado se imitar a Dolores/equipe/empresa) ou o número mascarado. */
export function autorDoParticipante(m: { nome: string | null; remetente: string | null; doDono: boolean }, equipe: readonly string[] = []): string {
  const base = m.nome ? (nomeImitaQuemNaoE(m.nome, equipe) ? `${m.nome} (participante)` : m.nome) : m.remetente ?? "participante";
  return m.doDono ? `${base} (dono)` : base;
}

/** Quem escreveu, como aparece na conversa do grupo. */
export const autorDaEquipe = (nome: string | null | undefined) => `equipe — ${nome?.trim() || "usuário removido"}`;
export const AUTOR_DOLORES = "Dolores";

export const LIMITE_MENSAGENS_GRUPO = 60;

// ---- Histórico do grupo na tela (puro): páginas antigas + a página mais nova, que se atualiza sozinha ----

/** Uma página como a rota `whatsappGrupos.mensagens` devolve (da mais antiga para a mais nova). */
export type PaginaDoGrupo<M extends { chave: string }> = { mensagens: readonly M[]; temMais: boolean; maisAntiga: Date | string | null };
/**
 * O que a tela já carregou de UM grupo: todas as mensagens vistas (páginas antigas e cada atualização da mais nova, unidas por
 * `chave`) e, se a pessoa pediu "Ver mensagens anteriores", o cursor da página antiga mais velha. Sempre amarrado ao `grupoId`.
 */
export type HistoricoDoGrupo<M extends { chave: string }> = {
  grupoId: number; mensagens: M[]; antigas: { temMais: boolean; maisAntiga: Date | string | null } | null;
};

/**
 * União por `chave`, em ordem: primeiro as de `maisVelhas` que não estão em `maisNovas`, depois `maisNovas` (a versão de `maisNovas`
 * prevalece — ex.: a situação de um envio da equipe). Sem duplicar, nem dentro de uma mesma lista. Nunca abre buraco: o que já
 * foi carregado e saiu da janela da página mais nova continua.
 */
export function unirMensagensDoGrupo<M extends { chave: string }>(maisVelhas: readonly M[], maisNovas: readonly M[]): M[] {
  const novas = new Set(maisNovas.map(m => m.chave));
  const vistas = new Set<string>();
  const out: M[] = [];
  for (const m of [...maisVelhas.filter(v => !novas.has(v.chave)), ...maisNovas]) {
    if (vistas.has(m.chave)) continue;
    vistas.add(m.chave); out.push(m);
  }
  return out;
}

/** Chegou a página mais nova do grupo `grupoId`: une ao que já foi carregado dele; de outro grupo (ou nada ainda), recomeça. */
export function aplicarPaginaRecente<M extends { chave: string }>(h: HistoricoDoGrupo<M> | null, grupoId: number, p: PaginaDoGrupo<M>): HistoricoDoGrupo<M> {
  if (!h || h.grupoId !== grupoId) return { grupoId, mensagens: [...p.mensagens], antigas: null };
  return { ...h, mensagens: unirMensagensDoGrupo(h.mensagens, p.mensagens) };
}

/**
 * Chegou uma página antiga pedida para o grupo `grupoId`. Se a tela já está em outro grupo (a pessoa trocou antes de a resposta
 * chegar), a página é DESCARTADA: mensagens de um grupo nunca aparecem debaixo do título de outro, nem o cursor dele é usado.
 */
export function aplicarPaginaAntiga<M extends { chave: string }>(h: HistoricoDoGrupo<M> | null, grupoId: number, p: PaginaDoGrupo<M>): HistoricoDoGrupo<M> | null {
  if (!h || h.grupoId !== grupoId) return h;
  return { grupoId, mensagens: unirMensagensDoGrupo(p.mensagens, h.mensagens), antigas: { temMais: p.temMais, maisAntiga: p.maisAntiga } };
}

/**
 * O que a tela mostra do grupo `grupoId`: o histórico dele unido à página mais nova (que pode ter chegado antes de o histórico se
 * atualizar), e o cursor de "Ver mensagens anteriores" — o da página antiga mais velha, ou o da mais nova se nenhuma foi pedida.
 * Histórico de outro grupo é ignorado.
 */
export function vistaDoGrupo<M extends { chave: string }>(h: HistoricoDoGrupo<M> | null, grupoId: number | null, recente: PaginaDoGrupo<M> | null | undefined) {
  const meu = h && grupoId !== null && h.grupoId === grupoId ? h : null;
  const mensagens = unirMensagensDoGrupo(meu?.mensagens ?? [], recente?.mensagens ?? []);
  const pag = meu?.antigas ?? (recente ? { temMais: recente.temMais, maisAntiga: recente.maisAntiga } : null);
  return { mensagens, temMais: pag?.temMais ?? false, cursor: pag?.maisAntiga ?? null };
}

export const TEXTO_GRUPOS = {
  aguardando: "aguardando o dono",
  semEscrita: "Este grupo ainda espera o dono confirmar quem colocou a empresa nele: por aqui só dá para ler.",
  naoEhComando: "O que você escreve aqui sai pelo número da empresa para todos do grupo. Não é comando para a Dolores e não a faz responder.",
  semGrupos: "Nenhum grupo ainda. Os grupos em que o número da empresa está aparecem aqui quando chega a primeira mensagem.",
  ajudaAssumir: "Toque em Assumir para a Dolores não responder neste grupo nem quando for marcada, até alguém devolver. Tocar não envia nada ao grupo.",
  ajudaDevolver: "A Dolores está parada neste grupo. Toque em Devolver para ela voltar a responder quando for marcada (se a resposta no grupo estiver ligada). Tocar não envia nada.",
  limitacao: "Aparecem as mensagens dos participantes, as respostas da Dolores e o que a equipe escreveu por aqui. O que for escrito no celular da empresa direto no grupo não aparece. Nesta tela, CPF, telefone e afins aparecem mascarados em todas as mensagens.",
} as const;
