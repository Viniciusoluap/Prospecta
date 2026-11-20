// EPIC-026 C3 — a mídia da saudação de campanha (UMA imagem e UM áudio por campanha), guardada no banco
// (`whatsapp_campanha_midias`, migração 0137). Quem grava e remove é só o administrador por PAPEL (atendimento-router.ts);
// aqui ficam a conferência pelos BYTES (a mesma da tela, shared/whatsapp/saudacao-midia.ts), as leituras e a gravação.
// Nada aqui busca URL de fora (o arquivo sobe em partes pelo próprio sistema) e nada é servido por URL: a Evolution recebe o
// arquivo em base64 dentro do pedido de envio. Nenhum log com nome de arquivo, número ou conteúdo.
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { whatsappCampanhaMidias } from "../../drizzle/schema-whatsapp-atendimento.js";
import { conferirMidiaSaudacao, nomeSeguroDaMidia, type MidiaConferida, type TipoMidiaSaudacao } from "../../shared/whatsapp/saudacao-midia.js";
import { getDb } from "../db.js";

/** Tamanho de cada pedaço da pré-visualização (a resposta fica bem abaixo do limite de corpo da Vercel). */
export const PARTE_PREVIA = 1024 * 1024;

export type MetaDaMidia = { campanhaId: number; tipo: TipoMidiaSaudacao; mime: string; nome: string; tamanho: number; duracaoS: number | null; versao: string };

const colunasMeta = {
  campanhaId: whatsappCampanhaMidias.campanhaId, tipo: whatsappCampanhaMidias.tipo, mime: whatsappCampanhaMidias.mime,
  nome: whatsappCampanhaMidias.nome, tamanho: whatsappCampanhaMidias.tamanho, duracaoS: whatsappCampanhaMidias.duracaoS,
  versao: whatsappCampanhaMidias.sha256,
};

/** Metadados (sem bytes) das mídias de várias campanhas, para a tela. */
export async function metasDasMidias(): Promise<MetaDaMidia[]> {
  return getDb().select(colunasMeta).from(whatsappCampanhaMidias).limit(400);
}

/**
 * Confere pelos bytes e grava (ou troca) a mídia do tipo pedido. Devolve o erro em linguagem simples, ou a conferência.
 * O tipo gravado é o dos BYTES; o nome declarado só serve de rótulo (limpo, com a extensão do tipo real).
 */
export async function gravarMidiaDaCampanha(p: { campanhaId: number; tipo: TipoMidiaSaudacao; nome: string; bytes: Buffer; userId: number }): Promise<MidiaConferida> {
  const c = conferirMidiaSaudacao(p.tipo, p.bytes);
  if (!c.ok) return c;
  // QA-SEG C3 R2-3: da imagem fica só até o fim dela (o apêndice do celular é cortado); tamanho e hash do que foi guardado
  const guardado = c.tipo === "imagem" ? Buffer.from(p.bytes.subarray(0, c.fim)) : p.bytes;
  const dados = {
    mime: c.mime, nome: nomeSeguroDaMidia(p.nome, c.mime), tamanho: guardado.length, duracaoS: c.duracaoS,
    sha256: createHash("sha256").update(guardado).digest("hex"), conteudo: guardado, enviadoPor: p.userId, criadoEm: new Date(),
  };
  await getDb().insert(whatsappCampanhaMidias).values({ campanhaId: p.campanhaId, tipo: p.tipo, ...dados })
    .onConflictDoUpdate({ target: [whatsappCampanhaMidias.campanhaId, whatsappCampanhaMidias.tipo], set: dados });
  return c;
}

export async function removerMidiaDaCampanha(campanhaId: number, tipo: TipoMidiaSaudacao): Promise<boolean> {
  const r = await getDb().delete(whatsappCampanhaMidias)
    .where(and(eq(whatsappCampanhaMidias.campanhaId, campanhaId), eq(whatsappCampanhaMidias.tipo, tipo)))
    .returning({ tipo: whatsappCampanhaMidias.tipo });
  return r.length > 0;
}

/** Um pedaço da mídia para a pré-visualização da tela (só administrador; quem chama confere). */
export async function parteDaMidia(campanhaId: number, tipo: TipoMidiaSaudacao, offset: number) {
  const [m] = await getDb().select({
    ...colunasMeta,
    parte: sql<string>`encode(substring(${whatsappCampanhaMidias.conteudo} from ${offset + 1} for ${PARTE_PREVIA}), 'base64')`,
  }).from(whatsappCampanhaMidias)
    .where(and(eq(whatsappCampanhaMidias.campanhaId, campanhaId), eq(whatsappCampanhaMidias.tipo, tipo))).limit(1);
  if (!m) return null;
  const { parte, ...meta } = m;
  return { ...meta, offset, base64: (parte ?? "").replace(/\s+/g, "") };
}

export type MidiaParaEnvio = { tipo: TipoMidiaSaudacao; mime: string; nome: string; base64: string };

/**
 * As mídias da campanha para o envio, CONFERIDAS DE NOVO pelos bytes (nada que não passe hoje sai, mesmo que tenha sido gravado
 * antes). Falha de leitura → sem mídia (a saudação sai só com o texto).
 */
export async function midiasParaEnvio(campanhaId: number): Promise<{ imagem: MidiaParaEnvio | null; audio: MidiaParaEnvio | null }> {
  const vazio = { imagem: null, audio: null };
  let linhas: { tipo: TipoMidiaSaudacao; nome: string; conteudo: Buffer }[];
  try {
    linhas = await getDb().select({ tipo: whatsappCampanhaMidias.tipo, nome: whatsappCampanhaMidias.nome, conteudo: whatsappCampanhaMidias.conteudo })
      .from(whatsappCampanhaMidias).where(eq(whatsappCampanhaMidias.campanhaId, campanhaId)).limit(2);
  } catch { return vazio; }
  const r: { imagem: MidiaParaEnvio | null; audio: MidiaParaEnvio | null } = { ...vazio };
  for (const l of linhas) {
    const bytes = Buffer.from(l.conteudo);
    const c = conferirMidiaSaudacao(l.tipo, bytes);
    if (!c.ok || c.tipo !== l.tipo) continue;
    const enviado = c.tipo === "imagem" ? bytes.subarray(0, c.fim) : bytes; // nenhum byte depois do fim da imagem vai à Evolution
    r[l.tipo] = { tipo: l.tipo, mime: c.mime, nome: nomeSeguroDaMidia(l.nome, c.mime), base64: Buffer.from(enviado).toString("base64") };
  }
  return r;
}
