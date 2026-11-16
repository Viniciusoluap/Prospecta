// EPIC-024 S-06 — proposta formal de aquisição do terreno: PDF para baixar e envio por e-mail com o MESMO PDF.
// O PDF é sempre montado no servidor pelo gerador único (`shared/incorporacao/proposta-terreno-pdf.ts`) a partir do que
// está gravado na negociação; os envios ficam em `incorporation_proposal_sends` (fora do JSON que a aba reescreve).
// Enviar NÃO muda a situação da proposta.
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc.js";
import { requireModule } from "./_core/rbac.js";
import { ENV } from "./_core/env.js";
import { sendEmail } from "./_core/email-smtp.js";
import { getDb, getIncorporationStudyById } from "./db.js";
import { bytesDoLogo } from "./incorporacao-logo-router.js";
import { incorporationProposalSends } from "../drizzle/schema-incorporacao-propostas.js";
import { parseNegociacao } from "../shared/incorporacao/negociacao.js";
import { dimensoesDoPng } from "../shared/incorporacao/logotipo.js";
import { dataBr, gerarPdfPropostaTerreno, nomeArquivoProposta, type DadosPropostaTerreno } from "../shared/incorporacao/proposta-terreno-pdf.js";
import { IDENTIDADE_EMAIL, rodapeEmail } from "../shared/email-identidade.js";

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Hoje em Brasília (AAAA-MM-DD). */
export function hojeBrasil(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

/** A emissão é a data de hoje (ou de até 2 dias atrás: prévia aberta na véspera); nunca no futuro. */
function conferirEmissao(data: string | undefined): string {
  const hoje = hojeBrasil();
  if (!data) return hoje;
  const dias = (Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${data}T00:00:00Z`)) / 86_400_000;
  if (!(dias >= 0 && dias <= 2)) throw new TRPCError({ code: "BAD_REQUEST", message: "Data de emissão inválida. Gere a prévia de novo." });
  return data;
}

type Usuario = { id: number; name?: string | null };

/** Monta os dados e o PDF da proposta gravada. Mesma entrada → mesmos bytes (download = anexo). */
export async function montarPdfProposta(studyId: number, propostaId: string, dataEmissao: string, usuario: Usuario) {
  const estudo = await getIncorporationStudyById(studyId);
  if (!estudo) throw new TRPCError({ code: "NOT_FOUND", message: "Estudo não encontrado." });
  const negociacao = parseNegociacao(estudo.landNegotiationJson ?? null);
  const proposta = negociacao?.propostas.find((p) => p.id === propostaId);
  if (!negociacao || !proposta) throw new TRPCError({ code: "NOT_FOUND", message: "Proposta não encontrada — salve a negociação e tente de novo." });
  if (proposta.autor !== "grupo")
    throw new TRPCError({ code: "BAD_REQUEST", message: "Esta proposta foi registrada como do proprietário. O PDF formal é emitido só para propostas da Prospecta." });
  const logo = await bytesDoLogo(studyId, "exibicao").catch(() => null);
  const area = Number(estudo.areaM2);
  const dados: DadosPropostaTerreno = {
    empreendimento: { nome: estudo.name, cidade: estudo.city, uf: estudo.state, endereco: estudo.address, tipo: estudo.incorporationType },
    terreno: { areaM2: Number.isFinite(area) ? area : null, matricula: estudo.propertyRegistration },
    proprietario: { nome: negociacao.proprietarioNome, contato: negociacao.proprietarioContato, email: negociacao.proprietarioEmail },
    proposta,
    proponente: { empresa: IDENTIDADE_EMAIL, responsavel: usuario.name ?? null },
    dataEmissao,
    logoEmpreendimento: logoDaProposta(logo?.dados),
  };
  const pdf = gerarPdfPropostaTerreno(dados);
  return { pdf, dados, nomeArquivo: nomeArquivoProposta(dados), sha256: sha256(pdf) };
}

/** Logotipo do empreendimento no cabeçalho; PNG inválido fica de fora (a proposta sai sem ele, nunca dá erro). */
function logoDaProposta(png: Uint8Array | undefined | null) {
  const medidas = png ? dimensoesDoPng(png) : null;
  return png && medidas ? { png, ...medidas } : null;
}

const entrada = z.object({
  studyId: z.number().int().positive(),
  propostaId: z.string().min(1).max(80),
  dataEmissao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function emailDaProposta(d: DadosPropostaTerreno) {
  const nome = (d.proprietario.nome ?? "").trim();
  return {
    subject: `Proposta de aquisição do terreno — ${d.empreendimento.nome}`,
    html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1A2332">
<p>${nome ? `Prezado(a) ${escapar(nome)},` : "Prezado(a),"}</p>
<p>Encaminhamos em anexo a proposta formal de aquisição do terreno referente ao empreendimento
<strong>${escapar(d.empreendimento.nome)}</strong>, emitida em ${dataBr(d.dataEmissao)}.</p>
<p>Permanecemos à disposição para esclarecimentos.</p>
<p>Atenciosamente,<br>${escapar(d.proponente.empresa)}${d.proponente.responsavel ? `<br>${escapar(d.proponente.responsavel)}` : ""}</p>
<p style="font-size:11px;color:#777">${escapar(rodapeEmail())}</p>
</body></html>`,
  };
}

export const incorporationProposalRouter = router({
  /** PDF para baixar (e prévia antes do envio). */
  pdf: protectedProcedure.input(entrada).mutation(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    const dataEmissao = conferirEmissao(input.dataEmissao);
    const r = await montarPdfProposta(input.studyId, input.propostaId, dataEmissao, ctx.user);
    return { base64: Buffer.from(r.pdf).toString("base64"), nomeArquivo: r.nomeArquivo, dataEmissao, sha256: r.sha256 };
  }),

  /** Envia o PDF (o mesmo da prévia: mesma data de emissão) e registra data, destinatário e situação. */
  enviar: protectedProcedure.input(entrada.extend({
    destinatario: z.string().trim().toLowerCase().email("E-mail do destinatário inválido.").max(254),
  })).mutation(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    const dataEmissao = conferirEmissao(input.dataEmissao);
    const r = await montarPdfProposta(input.studyId, input.propostaId, dataEmissao, ctx.user);
    const { subject, html } = emailDaProposta(r.dados);
    const smtpConfigurado = !!(ENV.smtpHost && ENV.smtpUser && ENV.smtpPassword);
    const ok = await sendEmail({
      to: input.destinatario, recipientName: r.dados.proprietario.nome ?? undefined, subject, html, templateType: "proposta_terreno",
      attachments: [{ filename: r.nomeArquivo, content: Buffer.from(r.pdf), contentType: "application/pdf" }],
      metadata: { studyId: input.studyId, propostaId: input.propostaId, pdfSha256: r.sha256 },
    });
    const motivo = ok ? null : smtpConfigurado
      ? "O servidor de e-mail recusou o envio (detalhe no registro de e-mails). Tente de novo."
      : "Servidor de e-mail (SMTP) não configurado. Baixe o PDF e envie por outro meio.";
    const [envio] = await getDb().insert(incorporationProposalSends).values({
      studyId: input.studyId, propostaId: input.propostaId, destinatario: input.destinatario, status: ok ? "enviado" : "falhou",
      motivo, dataEmissao, pdfSha256: r.sha256, enviadoPor: ctx.user.id, enviadoPorNome: ctx.user.name ?? null,
    }).returning();
    return { ok, motivo, envio };
  }),

  envios: protectedProcedure.input(z.object({ studyId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    return getDb().select().from(incorporationProposalSends)
      .where(eq(incorporationProposalSends.studyId, input.studyId))
      .orderBy(desc(incorporationProposalSends.id));
  }),
});
