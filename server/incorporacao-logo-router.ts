// EPIC-024 S-02 — logotipo de cada empreendimento (tabela `incorporation_study_logos`, migração 0119).
// Nunca na linha do estudo: a listagem lê todas as colunas do estudo e o gatilho de versões copia cada UPDATE.
// O original sobe em partes (`documentChunks.part`, escopo `incorporacao-logo:<id>`); o PNG de exibição vai no pedido
// final. Cartões recebem só o PNG de exibição pela rota `/api/incorporacao/logo/:id` (server/routes/incorporacao-logo.ts).
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc.js";
import { requireModule } from "./_core/rbac.js";
import { getDb, getIncorporationStudyById } from "./db.js";
import { clearUpload, readUpload } from "./document-upload-chunks.js";
import { incorporationStudyLogos } from "../drizzle/schema-incorporacao-logos.js";
import {
  LADO_EXIBICAO, LIMITE_EXIBICAO_BYTES, LIMITE_LOGO_BYTES, ehPng, promptLogotipo, tipoDoLogo, tipoPelaExtensao,
} from "../shared/incorporacao/logotipo.js";

export const escopoEnvioLogo = (studyId: number) => `incorporacao-logo:${studyId}`;
export const PROVEDOR_IMAGEM = "Manus Forge (gerador de imagem já existente no sistema)";
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const nomeSeguro = (nome: string) => nome.replace(/[\u0000-\u001f\\/:*?"<>|]+/g, "_").slice(0, 200) || "logotipo";

/** Metadados do logotipo ativo (sem bytes). */
export async function logoAtivo(studyId: number) {
  const [l] = await getDb().select({
    id: incorporationStudyLogos.id, studyId: incorporationStudyLogos.studyId, mime: incorporationStudyLogos.mime,
    nome: incorporationStudyLogos.nome, origem: incorporationStudyLogos.origem, tamanho: incorporationStudyLogos.tamanho,
    sha256: incorporationStudyLogos.sha256, versao: incorporationStudyLogos.exibicaoSha256,
    largura: incorporationStudyLogos.largura, altura: incorporationStudyLogos.altura, createdAt: incorporationStudyLogos.createdAt,
  }).from(incorporationStudyLogos)
    .where(and(eq(incorporationStudyLogos.studyId, studyId), isNull(incorporationStudyLogos.deletedAt)))
    .orderBy(desc(incorporationStudyLogos.id)).limit(1);
  return l ?? null;
}

/** Bytes do logotipo ativo para as rotas de imagem/download (`exibicao` ou `original`). */
export async function bytesDoLogo(studyId: number, qual: "exibicao" | "original") {
  const [l] = await getDb().select({
    dados: qual === "exibicao" ? incorporationStudyLogos.exibicaoPng : incorporationStudyLogos.original,
    etag: qual === "exibicao" ? incorporationStudyLogos.exibicaoSha256 : incorporationStudyLogos.sha256,
    mime: incorporationStudyLogos.mime, nome: incorporationStudyLogos.nome,
  }).from(incorporationStudyLogos)
    .where(and(eq(incorporationStudyLogos.studyId, studyId), isNull(incorporationStudyLogos.deletedAt)))
    .orderBy(desc(incorporationStudyLogos.id)).limit(1);
  return l ? { ...l, dados: Buffer.from(l.dados) } : null;
}

async function exigirEstudo(studyId: number) {
  if (!(await getIncorporationStudyById(studyId))) throw new TRPCError({ code: "NOT_FOUND", message: "Estudo não encontrado." });
}

const studyInput = z.object({ studyId: z.number().int().positive() });

export const incorporationLogoRouter = router({
  obter: protectedProcedure.input(studyInput).query(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    return logoAtivo(input.studyId);
  }),

  /** Versão (hash do PNG) dos logotipos ativos, para os cartões da listagem — sem bytes. */
  versoes: protectedProcedure.query(async ({ ctx }) => {
    requireModule(ctx, "incorporacao");
    return getDb().select({
      studyId: incorporationStudyLogos.studyId, versao: incorporationStudyLogos.exibicaoSha256,
      largura: incorporationStudyLogos.largura, altura: incorporationStudyLogos.altura,
    }).from(incorporationStudyLogos).where(isNull(incorporationStudyLogos.deletedAt)).orderBy(incorporationStudyLogos.id);
  }),

  /** Grava (ou troca) o logotipo do estudo. O anterior fica marcado como excluído. */
  salvar: protectedProcedure.input(studyInput.extend({
    uploadId: z.string().regex(/^[a-zA-Z0-9-]{20,64}$/),
    nome: z.string().min(1).max(255),
    origem: z.enum(["envio", "ia"]).default("envio"),
    exibicaoBase64: z.string().min(8).max(Math.ceil(LIMITE_EXIBICAO_BYTES / 3) * 4 + 4),
    largura: z.number().int().min(1).max(LADO_EXIBICAO),
    altura: z.number().int().min(1).max(LADO_EXIBICAO),
  })).mutation(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    await exigirEstudo(input.studyId);
    const original = await readUpload(input.uploadId, ctx.user.id, escopoEnvioLogo(input.studyId), input.nome);
    await clearUpload(input.uploadId, ctx.user.id).catch(() => undefined);
    if (original.length > LIMITE_LOGO_BYTES) throw new TRPCError({ code: "BAD_REQUEST", message: "Logotipo acima de 10 MB." });
    const mime = tipoDoLogo(original);
    if (!mime) throw new TRPCError({ code: "BAD_REQUEST", message: "O arquivo não é PNG, JPG, SVG ou PDF válido." });
    const esperado = tipoPelaExtensao(input.nome);
    if (esperado && esperado !== mime) throw new TRPCError({ code: "BAD_REQUEST", message: "O conteúdo do arquivo não corresponde à extensão." });
    const exibicao = Buffer.from(input.exibicaoBase64, "base64");
    if (!ehPng(exibicao) || exibicao.length > LIMITE_EXIBICAO_BYTES)
      throw new TRPCError({ code: "BAD_REQUEST", message: "A imagem de exibição precisa ser PNG de até 1,5 MB." });
    const db = getDb();
    const [novo] = await db.insert(incorporationStudyLogos).values({
      studyId: input.studyId, mime, nome: nomeSeguro(input.nome), origem: input.origem, sha256: sha256(original),
      tamanho: original.length, original, exibicaoPng: exibicao, exibicaoSha256: sha256(exibicao),
      largura: input.largura, altura: input.altura, enviadoPor: ctx.user.id,
    }).returning({ id: incorporationStudyLogos.id });
    await db.update(incorporationStudyLogos).set({ deletedAt: new Date() }).where(and(
      eq(incorporationStudyLogos.studyId, input.studyId), isNull(incorporationStudyLogos.deletedAt), ne(incorporationStudyLogos.id, novo.id),
    ));
    return logoAtivo(input.studyId);
  }),

  excluir: protectedProcedure.input(studyInput).mutation(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    await getDb().update(incorporationStudyLogos).set({ deletedAt: new Date() })
      .where(and(eq(incorporationStudyLogos.studyId, input.studyId), isNull(incorporationStudyLogos.deletedAt)));
    return { success: true };
  }),

  /** Gerador de imagem disponível? Diz qual provedor e qual chave falta — nunca finge. */
  iaDisponivel: protectedProcedure.query(async ({ ctx }) => {
    requireModule(ctx, "incorporacao");
    const { faltandoParaGerarImagem } = await import("./_core/imageGeneration.js");
    const faltando = faltandoParaGerarImagem();
    return { disponivel: faltando.length === 0, provedor: PROVEDOR_IMAGEM, faltando };
  }),

  /** Proposta de logotipo pela IA a partir do nome; só volta para a tela aprovar (não grava). */
  gerarIa: protectedProcedure.input(studyInput).mutation(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    const estudo = await getIncorporationStudyById(input.studyId);
    if (!estudo) throw new TRPCError({ code: "NOT_FOUND", message: "Estudo não encontrado." });
    const { faltandoParaGerarImagem, generateImageBytes } = await import("./_core/imageGeneration.js");
    const faltando = faltandoParaGerarImagem();
    if (faltando.length) {
      return {
        ok: false as const, faltando,
        motivo: `Geração de imagem não configurada: o ${PROVEDOR_IMAGEM} precisa de ${faltando.join(" e ")} no servidor. Envie o logotipo pelo botão "Enviar logotipo".`,
      };
    }
    let imagem;
    try {
      imagem = await generateImageBytes({ prompt: promptLogotipo({ ...estudo, name: estudo.name ?? "" }) });
    } catch (e) {
      console.error("[logotipo-ia]", e instanceof Error ? e.message : e);
      return { ok: false as const, faltando: [], motivo: "O gerador de imagem não respondeu. Tente de novo mais tarde." };
    }
    const mime = tipoDoLogo(imagem.data);
    if (mime !== "image/png" && mime !== "image/jpeg") return { ok: false as const, faltando: [], motivo: "O gerador devolveu uma imagem em formato inesperado." };
    if (imagem.data.length > 3 * 1024 * 1024) return { ok: false as const, faltando: [], motivo: "O gerador devolveu uma imagem grande demais." };
    return { ok: true as const, mime, base64: imagem.data.toString("base64") };
  }),
});
