// EPIC-027 C2 — grupos do WhatsApp na Central (decisão do dono de 20/11/2026, noite: "Aqui nas mensagens do WhatsApp também deve
// aparecer as mensagens do grupo para que o humano possa intervir"; quem vê: "Somente o Admin e os colaboradores que tiverem esse
// campo selecionado lá na hora do cadastro dele"; quais: "Todos"; intervir: "Pode escrever, exatamente igual faz na conversa").
// Regras puras (sem banco), usadas pelo servidor (que confere de novo em toda rota) e pela tela.
import { parsePermissions } from "../admin-permissions.js";

export type UsuarioDosGrupos = { role: string; permissions?: string | null; active?: boolean | null };

/**
 * Quem vê os grupos na Central: admin ativo, sempre; colaborador ativo com o módulo WhatsApp E a permissão "Grupos do WhatsApp"
 * marcada no cadastro; mais ninguém (corretor, cliente, empreiteiro, inativo, anônimo).
 */
export function podeVerGruposNaCentral(u: UsuarioDosGrupos | null | undefined): boolean {
  if (!u || u.active === false) return false;
  if (u.role === "admin") return true;
  if (u.role !== "colaborador") return false;
  const p = parsePermissions(u.permissions);
  return p.includes("whatsapp") && p.includes("whatsappGrupos");
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

/** Quem escreveu, como aparece na conversa do grupo. */
export const autorDaEquipe = (nome: string | null | undefined) => `equipe — ${nome?.trim() || "usuário removido"}`;
export const AUTOR_DOLORES = "Dolores";

export const LIMITE_MENSAGENS_GRUPO = 60;

export const TEXTO_GRUPOS = {
  aguardando: "aguardando o dono",
  semEscrita: "Este grupo ainda espera o dono confirmar quem colocou a empresa nele: por aqui só dá para ler.",
  naoEhComando: "O que você escreve aqui sai pelo número da empresa para todos do grupo. Não é comando para a Dolores e não a faz responder.",
  semGrupos: "Nenhum grupo ainda. Os grupos em que o número da empresa está aparecem aqui quando chega a primeira mensagem.",
  ajudaAssumir: "Toque em Assumir para a Dolores não responder neste grupo nem quando for marcada, até alguém devolver. Tocar não envia nada ao grupo.",
  ajudaDevolver: "A Dolores está parada neste grupo. Toque em Devolver para ela voltar a responder quando for marcada (se a resposta no grupo estiver ligada). Tocar não envia nada.",
  limitacao: "Aparecem as mensagens dos participantes, as respostas da Dolores e o que a equipe escreveu por aqui. O que for escrito no celular da empresa direto no grupo não aparece. CPF, telefone e afins aparecem mascarados.",
} as const;
