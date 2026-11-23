// EPIC-029 S-4 (22/11/2026) — rotas do cofre do certificado A1 (montadas em `integracoes.certificadoFiscal`).
// "integracoes" não está no mapa de módulos do colaborador; além disso, aqui vale o PAPEL: só admin.
// Caminho principal (pedido do dono em 22/11): o A1 que ele JÁ cadastrou no Jurídico é enviado do próprio cartão de lá
// ("Usar também para emitir notas fiscais"); o envio direto do .pfx fica como alternativa.
// Nenhuma rota devolve o arquivo, a senha ou a chave: só o resumo (titular, CNPJ, AC, validade, impressão digital).
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { fiscalEmissores } from "../../drizzle/schema-fiscal.js";
import { adminProcedure, router } from "../_core/trpc.js";
import { getDb } from "../db.js";
import { auditarCertificado, desativarCertificado, ErroCertificado, FRASE_EMISSOR_NAO_ENCONTRADO, guardarCertificado, resumosAtivos, TAMANHO_MAXIMO_PFX } from "./certificado.js";
import { testarConexaoSefin } from "./sefin.js";

/** Só admin por papel; erro inesperado vira frase genérica (o log leva só o nome do erro, nunca a mensagem). */
const adminDoCofre = adminProcedure.use(async ({ ctx, next, path }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Só o administrador cuida do certificado de emissão." });
  const r = await next();
  if (!r.ok && !(r.error.cause instanceof ErroCertificado) && r.error.code !== "BAD_REQUEST" && r.error.code !== "FORBIDDEN" && r.error.code !== "NOT_FOUND") {
    console.error("[fiscal-certificado]", path, r.error.cause instanceof Error ? r.error.cause.name : "falha");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível concluir agora. Tente de novo em instantes." });
  }
  return r;
});

const BASE64_MAX = Math.ceil(TAMANHO_MAXIMO_PFX / 3) * 4 + 4;

function paraTrpc(e: unknown): never {
  if (e instanceof ErroCertificado) throw new TRPCError({ code: "BAD_REQUEST", message: e.message, cause: e });
  throw e;
}

export const certificadoFiscalRouter = router({
  /** Resumo por emissor (sem segredo) + aviso de vencimento. */
  status: adminDoCofre.query(async () => {
    const db = getDb();
    const [emissores, certificados] = await Promise.all([
      db.select({ id: fiscalEmissores.id, cnpj: fiscalEmissores.cnpj, ambiente: fiscalEmissores.ambiente, ativo: fiscalEmissores.ativo }).from(fiscalEmissores),
      resumosAtivos(db),
    ]);
    return emissores.map(e => ({ ...e, certificado: certificados.find(c => c.emissorId === e.id) ?? null }));
  }),

  /** Envia o A1 (do Jurídico ou por arquivo). Senha e arquivo só chegam aqui; a resposta é só o resumo. */
  enviar: adminDoCofre
    .input(z.object({
      pfxBase64: z.string().min(16, "Arquivo do certificado vazio.").max(BASE64_MAX, "Envie um certificado A1 de até 1 MiB.").regex(/^[A-Za-z0-9+/]+={0,2}$/, "Arquivo do certificado inválido."),
      senha: z.string().min(1, "Informe a senha do certificado.").max(200, "Senha longa demais."),
      emissorId: z.number().int().positive().nullable().optional(),
      origem: z.enum(["juridico", "arquivo"]),
    }).strict())
    .mutation(async ({ input, ctx }) => {
      const pfx = Buffer.from(input.pfxBase64, "base64");
      try {
        return await guardarCertificado(getDb(), { pfx, senha: input.senha, emissorId: input.emissorId ?? null, origem: input.origem, usuarioId: ctx.user.id });
      } catch (e) { return paraTrpc(e); }
      finally { pfx.fill(0); }
    }),

  /** Remover = desativar (não apaga). */
  desativar: adminDoCofre
    .input(z.object({ emissorId: z.number().int().positive() }).strict())
    .mutation(({ input, ctx }) => desativarCertificado(getDb(), input.emissorId, ctx.user.id)),

  /**
   * Testar conexão: com ambiente "desligado" recusa sem sair do sistema; "producao" recusado nesta etapa; em
   * "producao_restrita" (base da Sefin confirmada) faz só um GET de leitura do convênio do município sede.
   */
  testarConexao: adminDoCofre
    .input(z.object({ emissorId: z.number().int().positive() }).strict())
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [emissor] = await db.select({ id: fiscalEmissores.id, ambiente: fiscalEmissores.ambiente, municipioIbge: fiscalEmissores.municipioIbge }).from(fiscalEmissores).where(eq(fiscalEmissores.id, input.emissorId)).limit(1);
      // Revisão da S-4: NOT_FOUND passa pelo middleware com a frase própria (antes virava erro 500 genérico).
      if (!emissor) throw new TRPCError({ code: "NOT_FOUND", message: FRASE_EMISSOR_NAO_ENCONTRADO });
      const r = await testarConexaoSefin(db, emissor);
      await auditarCertificado(db, { emissorId: emissor.id, acao: "teste_conexao", detalhe: `ambiente=${emissor.ambiente}; ${r.ok ? "ok" : "recusado"}`, usuarioId: ctx.user.id });
      return r;
    }),
});
