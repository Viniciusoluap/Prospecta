// EPIC-024 S-02 — logotipo de cada empreendimento (tabela `incorporation_study_logos`, migração 0119).
// Nunca na linha do estudo: a listagem lê todas as colunas do estudo e o gatilho de versões copia cada UPDATE.
// O original sobe em partes (`documentChunks.part`, escopo `incorporacao-logo:<id>`); o PNG de exibição vai no pedido
// final. Cartões recebem só o PNG de exibição pela rota `/api/incorporacao/logo/:id` (server/routes/incorporacao-logo.ts).
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc.js";
import { requireModule } from "./_core/rbac.js";
import { getDb, getIncorporationStudyById } from "./db.js";
import { clearUpload, readUpload } from "./document-upload-chunks.js";
import { incorporationStudyLogos } from "../drizzle/schema-incorporacao-logos.js";
import {
  LADO_EXIBICAO, LIMITE_EXIBICAO_BYTES, LIMITE_LOGO_BYTES, TETO_LOGO_IA_POR_DIA, dimensoesDoPng, ehPng, tipoDoLogo, tipoPelaExtensao,
} from "../shared/incorporacao/logotipo.js";
import { SvgRecusado, sanitizarSvg } from "./incorporacao-logo-svg.js";
import {
  MENSAGEM_SEM_CHAVE_LOGO, gerarSvgDoLogotipo, logotipoIaDisponivel, reservarGeracaoLogo, resolverCredencialLogotipo,
} from "./incorporacao-logo-ia.js";

/** Trava (por estudo) da troca do logotipo: uma troca por vez. */
const TRAVA_LOGO = 24_02;
export const escopoEnvioLogo = (studyId: number) => `incorporacao-logo:${studyId}`;
/** EPIC-027 C8: a proposta de logotipo é desenhada em SVG pela IA da chave do painel (função "Logotipo da incorporação"). */
export const PROVEDOR_IMAGEM = "IA da Anthropic (chave de Configurações › Integrações › Anthropic)";
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
    let original: Buffer = await readUpload(input.uploadId, ctx.user.id, escopoEnvioLogo(input.studyId), input.nome);
    await clearUpload(input.uploadId, ctx.user.id).catch(() => undefined);
    if (original.length > LIMITE_LOGO_BYTES) throw new TRPCError({ code: "BAD_REQUEST", message: "Logotipo acima de 10 MB." });
    const mime = tipoDoLogo(original);
    if (!mime) throw new TRPCError({ code: "BAD_REQUEST", message: "O arquivo não é PNG, JPG, SVG ou PDF válido." });
    const esperado = tipoPelaExtensao(input.nome);
    if (esperado && esperado !== mime) throw new TRPCError({ code: "BAD_REQUEST", message: "O conteúdo do arquivo não corresponde à extensão." });
    // EPIC-027 C8: SVG enviado ou desenhado pela IA passa pela mesma limpeza antes de ser guardado como original
    if (mime === "image/svg+xml") {
      try {
        original = sanitizarSvg(original, LIMITE_LOGO_BYTES);
      } catch (e) {
        if (e instanceof SvgRecusado) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        throw e;
      }
    }
    const exibicao = Buffer.from(input.exibicaoBase64, "base64");
    // As medidas valem as do próprio PNG (cabeçalho IHDR), não as que o navegador declarou.
    const medidas = exibicao.length <= LIMITE_EXIBICAO_BYTES ? dimensoesDoPng(exibicao) : null;
    if (!ehPng(exibicao) || !medidas || medidas.largura > LADO_EXIBICAO || medidas.altura > LADO_EXIBICAO)
      throw new TRPCError({ code: "BAD_REQUEST", message: `A imagem de exibição precisa ser um PNG válido de até 1,5 MB e ${LADO_EXIBICAO} px de lado.` });
    // Troca numa transação só: dois envios ao mesmo tempo não podem arquivar o logotipo um do outro e deixar o
    // empreendimento sem nenhum (o último a gravar fica ativo).
    await getDb().transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(${TRAVA_LOGO}, ${input.studyId})`);
      await tx.update(incorporationStudyLogos).set({ deletedAt: new Date() }).where(and(
        eq(incorporationStudyLogos.studyId, input.studyId), isNull(incorporationStudyLogos.deletedAt)));
      await tx.insert(incorporationStudyLogos).values({
        studyId: input.studyId, mime, nome: nomeSeguro(input.nome), origem: input.origem, sha256: sha256(original),
        tamanho: original.length, original, exibicaoPng: exibicao, exibicaoSha256: sha256(exibicao),
        largura: medidas.largura, altura: medidas.altura, enviadoPor: ctx.user.id,
      });
    });
    return logoAtivo(input.studyId);
  }),

  excluir: protectedProcedure.input(studyInput).mutation(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    await getDb().update(incorporationStudyLogos).set({ deletedAt: new Date() })
      .where(and(eq(incorporationStudyLogos.studyId, input.studyId), isNull(incorporationStudyLogos.deletedAt)));
    return { success: true };
  }),

  /** IA do logotipo disponível? Só diz SE há chave no painel (nunca a chave) e o teto do dia. */
  iaDisponivel: protectedProcedure.query(async ({ ctx }) => {
    requireModule(ctx, "incorporacao");
    const disponivel = await logotipoIaDisponivel();
    return { disponivel, provedor: PROVEDOR_IMAGEM, motivo: disponivel ? null : MENSAGEM_SEM_CHAVE_LOGO, tetoPorDia: TETO_LOGO_IA_POR_DIA };
  }),

  /**
   * Proposta de logotipo em SVG pela IA (chave do painel), já limpa; só volta para a tela pré-visualizar e aprovar —
   * não grava nada. Mesma permissão de quem envia o logotipo.
   */
  gerarIa: protectedProcedure.input(studyInput).mutation(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    const estudo = await getIncorporationStudyById(input.studyId);
    if (!estudo) throw new TRPCError({ code: "NOT_FOUND", message: "Estudo não encontrado." });
    const credencial = await resolverCredencialLogotipo();
    if (!credencial) return { ok: false as const, motivo: MENSAGEM_SEM_CHAVE_LOGO };
    const reserva = await reservarGeracaoLogo(input.studyId, ctx.user.id);
    if (!reserva.ok) return { ok: false as const, motivo: reserva.motivo };
    const r = await gerarSvgDoLogotipo(estudo, credencial);
    if (!r.ok) return { ok: false as const, motivo: r.motivo };
    return { ok: true as const, mime: "image/svg+xml" as const, base64: r.svg.toString("base64"), restantes: reserva.restantes };
  }),
});
