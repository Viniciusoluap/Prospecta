import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { imoveis, leads, portalChatMessages, portalContractDocuments, portalContracts } from "../drizzle/schema.js";
import { ASSINATURA_STATUS, CONTRATO_STATUS, contratoInputSchema } from "../shared/juridico.js";
import { adminProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";
import { CAMPOS_MODELO, MODELOS_CONTRATO, modeloNovo, montarContrato, type CamposModelo } from "../shared/contratos/modelos.js";
import { gerarPdfModelo } from "../shared/contratos/pdf.js";
import { opcoesModelosContrato } from "./juridico-modelos.js";
import { readPrivateDocument, tryDriveUpload, uploadPrivateDocument } from "./drive-documents.js";
import { nomeContrato } from "../shared/contratos/documentos.js";
import { confirmarTodasAssinaturas, salvarRetornoContrato, conteudoContrato } from "./juridico-workflow.js";
import { sendEmail } from "./_core/email-smtp.js";
import { gerarESalvarContratoPdf } from "./juridico-pdf.js";
import { readPrivateDbFile } from "./private-document-files.js";

const documentType = z.enum(["contrato_gerado", "assinado", "anexo", "assinatura_digital"]);

export function isValidContractPdf(buffer: Buffer): boolean {
  return buffer.length > 0 && buffer.length <= 10 * 1024 * 1024 && buffer.subarray(0, 4).toString() === "%PDF";
}

export const juridicoRouter = router({
  list: adminProcedure.input(z.object({ status: z.enum(CONTRATO_STATUS).optional() }).optional()).query(async ({ input }) => {
    const rows = await getDb().select({ contract: portalContracts, leadName: leads.name, propertyTitle: imoveis.titulo })
      .from(portalContracts)
      .leftJoin(leads, eq(portalContracts.leadId, leads.id))
      .leftJoin(imoveis, eq(portalContracts.propertyId, imoveis.id))
      .orderBy(desc(portalContracts.createdAt));
    return input?.status ? rows.filter(({ contract }) => contract.status === input.status) : rows;
  }),

  getById: adminProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ input }) => {
    const db = getDb();
    const [contract] = await db.select().from(portalContracts).where(eq(portalContracts.id, input.id)).limit(1);
    if (!contract) return null;
    const documents = await db.select().from(portalContractDocuments)
      .where(eq(portalContractDocuments.contractId, input.id)).orderBy(desc(portalContractDocuments.createdAt));
    return { contract, documents };
  }),

  options: adminProcedure.query(async () => {
    const db = getDb();
    const [leadOptions, propertyOptions] = await Promise.all([
      db.select({ id: leads.id, name: leads.name, email: leads.email }).from(leads).orderBy(leads.name),
      db.select({ id: imoveis.id, title: imoveis.titulo, city: imoveis.cidade }).from(imoveis).orderBy(imoveis.titulo),
    ]);
    return { leads: leadOptions, properties: propertyOptions };
  }),

  modelOptions: adminProcedure.query(() => opcoesModelosContrato()),

  create: adminProcedure.input(z.record(z.enum(CAMPOS_MODELO), z.string().trim().max(1000))).mutation(async ({ input }) => {
    const campos = input as CamposModelo;
    if (!/^\d+$/.test(campos.obraId) || !Number.isSafeInteger(Number(campos.obraId))) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Selecione uma obra." });
    }
    const opcoes = await opcoesModelosContrato(Number(campos.obraId));
    const contrato = (() => {
      try { return montarContrato(campos, opcoes); }
      catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: (error as Error).message }); }
    })();
    const [created] = await getDb().insert(portalContracts).values({
      number: `PRO-${Date.now()}-${randomUUID().slice(0, 8)}`,
      type: contrato.tipo, partyA: contrato.empresa.nome, partyADocument: contrato.empresa.documento,
      partyB: contrato.parteB, partyBDocument: contrato.parteBDoc,
      leadId: Number(contrato.obra.leadId), propertyId: Number(contrato.obra.imovelId), projectId: Number(contrato.obra.id),
      contractorId: contrato.empreiteiroId ? Number(contrato.empreiteiroId) : null,
      brokerId: contrato.corretorId ? Number(contrato.corretorId) : null,
      signatureDate: campos.dataAssinatura, value: contrato.valor.toFixed(2),
      description: contrato.description, clauses: contrato.clausulas, signers: contrato.assinaturas,
    }).returning();
    return created;
  }),

  generatePdf: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input }) => gerarESalvarContratoPdf(input.id)),

  modelPdf: adminProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ input }) => {
    const [contrato] = await getDb().select().from(portalContracts).where(eq(portalContracts.id, input.id)).limit(1);
    if (!contrato || !modeloNovo(contrato.type) || !contrato.signatureDate || !contrato.signers || !contrato.clauses) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Contrato ou modelo não encontrado." });
    }
    const doc = gerarPdfModelo({
      numero: contrato.number, titulo: MODELOS_CONTRATO[contrato.type],
      data: new Date(contrato.signatureDate), clausulas: contrato.clauses, assinaturas: contrato.signers,
    });
    return { fileName: `${contrato.number}.pdf`, base64: Buffer.from(doc.output("arraybuffer")).toString("base64") };
  }),

  update: adminProcedure.input(z.object({ id: z.number().int().positive(), data: contratoInputSchema }))
    .mutation(async ({ input }) => {
      const [updated] = await getDb().update(portalContracts).set({
        ...input.data,
        signatureStatus:undefined,
        number: input.data.number || undefined,
        partyADocument: input.data.partyADocument || null,
        partyBDocument: input.data.partyBDocument || null,
        description: input.data.description || "",
        clauses: input.data.clauses || "",
        value: input.data.value.toFixed(2),
        updatedAt: new Date(),
      }).where(and(eq(portalContracts.id, input.id), isNull(portalContracts.signers))).returning();
      if (!updated) throw new TRPCError({ code: "BAD_REQUEST", message: "Use o modelo salvo para gerar o PDF. A edição livre é exclusiva de contratos antigos." });
      return updated;
    }),

  setStatus: adminProcedure.input(z.object({
    id: z.number().int().positive(),
    status: z.enum(CONTRATO_STATUS).optional(),
    signatureStatus: z.enum(ASSINATURA_STATUS).optional(),
  })).mutation(async ({ input }) => {
    if(input.signatureStatus==="assinado")throw new TRPCError({code:"BAD_REQUEST",message:"Use a confirmação de todas as assinaturas no documento recebido."});
    const [updated] = await getDb().update(portalContracts).set({
      status: input.status,
      signatureStatus: input.signatureStatus,
      updatedAt: new Date(),
    }).where(and(eq(portalContracts.id, input.id), input.signatureStatus ? isNull(portalContracts.signers) : undefined)).returning();
    if (!updated) throw new TRPCError({ code: "BAD_REQUEST", message: "Para registrar a assinatura deste modelo, anexe o PDF com todas as assinaturas." });
    return updated;
  }),

  confirmarAssinaturas: adminProcedure.input(z.object({documentId:z.number().int().positive(),confirmado:z.literal(true)})).mutation(({ctx,input})=>confirmarTodasAssinaturas(input.documentId,ctx.user.role)),

  enviarParaAssinatura: adminProcedure.input(z.object({id:z.number().int().positive(),email:z.boolean().default(true)})).mutation(async({input})=>{
    const db=getDb();const [contract]=await db.select().from(portalContracts).where(eq(portalContracts.id,input.id)).limit(1);
    if(!contract||!contract.leadId)throw new TRPCError({code:"BAD_REQUEST",message:"Vincule o contrato ao cliente para disponibilizar no portal."});
    if(contract.signatureStatus==="assinado")throw new TRPCError({code:"BAD_REQUEST",message:"Este contrato já foi concluído."});
    const [document]=await db.select().from(portalContractDocuments).where(and(eq(portalContractDocuments.contractId,contract.id),eq(portalContractDocuments.type,"assinatura_digital"))).orderBy(desc(portalContractDocuments.createdAt)).limit(1);
    if(!document)throw new TRPCError({code:"BAD_REQUEST",message:"Assine pela empresa antes de enviar ao cliente."});
    if(input.email){
      const [lead]=await db.select({email:leads.email}).from(leads).where(eq(leads.id,contract.leadId)).limit(1);
      if(!lead?.email)throw new TRPCError({code:"BAD_REQUEST",message:"Preencha o e-mail do cliente no cadastro antes de enviar."});
      const bytes=await conteudoContrato(document);if(!bytes)throw new TRPCError({code:"NOT_FOUND",message:"PDF não encontrado."});
      const sent=await sendEmail({to:lead.email,subject:"Contrato para assinatura — Prospecta",html:'<p>Seu contrato está anexo, assinado pela empresa. Confira, assine e devolva pelo portal do cliente.</p><p><a href="https://www.prospectaconstrucoes.com/portal/documentos">Abrir documentos no portal</a></p>',templateType:"admin_notification",attachments:[{filename:nomeContrato(contract.partyB,"assinatura_digital"),content:bytes,contentType:"application/pdf"}]});
      if(!sent)throw new TRPCError({code:"INTERNAL_SERVER_ERROR",message:"O e-mail não foi enviado. Confira a configuração de e-mail e tente novamente."});
    }
    await db.update(portalContracts).set({signatureStatus:"solicitado",updatedAt:new Date()}).where(eq(portalContracts.id,contract.id));
    return {success:true,emailEnviado:input.email};
  }),

  addDocument: adminProcedure.input(z.object({
    contractId: z.number().int().positive(),
    name: z.string().trim().min(1).max(255),
    url: z.string().url(),
    type: documentType.default("anexo"),
  })).mutation(async ({ input }) => {
    const [document] = await getDb().insert(portalContractDocuments).values(input).returning();
    return document;
  }),

  uploadDocument: adminProcedure.input(z.object({
    contractId: z.number().int().positive(),
    name: z.string().trim().min(1).max(255),
    type: documentType.default("anexo"),
    base64: z.string().min(8).max(4 * 1024 * 1024),
  })).mutation(async ({ input }) => {
    const db = getDb();
    const [contract] = await db.select().from(portalContracts).where(eq(portalContracts.id, input.contractId)).limit(1);
    if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato não encontrado" });
    const buffer = Buffer.from(input.base64, "base64");
    // A consulta devolve base64 pela API: 3 MiB ficam abaixo do limite de resposta da função.
    if (!isValidContractPdf(buffer) || buffer.length > 3 * 1024 * 1024) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Envie um PDF válido de até 3 MiB" });
    }
    if(input.type==="assinado")return salvarRetornoContrato(contract,buffer,false);
    const nome=input.type==="anexo"?input.name:nomeContrato(contract.partyB,input.type);
    if(input.type==="assinatura_digital"&&contract.signatureStatus==="assinado")throw new TRPCError({code:"BAD_REQUEST",message:"O contrato já está assinado por todos."});
    const fileName = `${contract.number.replace(/[^a-zA-Z0-9_-]/g, "-")}-${Date.now()}.pdf`;
    const leadId = contract.leadId;
    const { driveFileId } = leadId
      ? await tryDriveUpload(() => uploadPrivateDocument({ leadId, serviceId: null, categoria: "juridico", rotulo: `Contrato ${contract.number}`, nomeOriginal: fileName, mimeType: "application/pdf", data: buffer }))
      : { driveFileId: null };
    if (driveFileId) {
      const [document] = await db.insert(portalContractDocuments).values({
        contractId: input.contractId, name: nome, type: input.type, driveFileId,
      }).returning();
      if (input.type === "assinatura_digital") await db.update(portalContracts).set({
        signatureStatus: "parcial", signedDocumentUrl: null, updatedAt: new Date(),
      }).where(eq(portalContracts.id, input.contractId));
      return document;
    }
    const reserved = await db.execute(sql`SELECT nextval(pg_get_serial_sequence('portal_contract_documents', 'id'))::int AS id`);
    const id = Number((reserved as unknown as { rows: { id: number }[] }).rows[0].id);
    const insert = db.insert(portalContractDocuments).values({
      id, contractId: input.contractId, name: nome, type: input.type,
    });
    const file = db.execute(sql`INSERT INTO portal_contract_file_data (document_id, mime, size_bytes, data)
      VALUES (${id}, 'application/pdf', ${buffer.length}, decode(${buffer.toString("base64")}, 'base64'))`);
    if (input.type === "assinatura_digital") {
      await db.batch([insert, file, db.update(portalContracts).set({
        signatureStatus: "parcial", signedDocumentUrl: null, updatedAt: new Date(),
      }).where(eq(portalContracts.id, input.contractId))]);
    } else {
      await db.batch([insert, file]);
    }
    const [document] = await db.select().from(portalContractDocuments).where(eq(portalContractDocuments.id, id));
    return document;
  }),

  documentContent: adminProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ input }) => {
    const [document] = await getDb().select().from(portalContractDocuments).where(eq(portalContractDocuments.id, input.id)).limit(1);
    if (!document) throw new TRPCError({ code: "NOT_FOUND" });
    // Cópia no banco (fallback) tem prioridade; o Drive pode ter só a cópia organizada (29/10).
    const data = (await readPrivateDbFile("contract", document.id)) ?? (document.driveFileId ? await readPrivateDocument(document.driveFileId) : null);
    if (!data) throw new TRPCError({ code: "NOT_FOUND" });
    return { fileName: document.name, base64: data.toString("base64") };
  }),

  deleteDocument: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
    await getDb().delete(portalContractDocuments).where(eq(portalContractDocuments.id, input.id));
    return { success: true } as const;
  }),

  delete: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
    await getDb().delete(portalContracts).where(eq(portalContracts.id, input.id));
    return { success: true } as const;
  }),

  chats: adminProcedure.query(async () => getDb().select({ message: portalChatMessages, leadName: leads.name })
    .from(portalChatMessages).innerJoin(leads, eq(portalChatMessages.leadId, leads.id))
    .orderBy(asc(portalChatMessages.createdAt)).limit(500)),

  sendMessage: adminProcedure.input(z.object({ leadId: z.number().int().positive(), text: z.string().trim().min(1).max(2000) }))
    .mutation(async ({ input }) => {
      const [message] = await getDb().insert(portalChatMessages).values({ leadId: input.leadId, sender: "corretor", text: input.text }).returning();
      return message;
    }),

  markChatRead: adminProcedure.input(z.object({ leadId: z.number().int().positive() })).mutation(async ({ input }) => {
    await getDb().update(portalChatMessages).set({ read: true }).where(eq(portalChatMessages.leadId, input.leadId));
    return { success: true } as const;
  }),
});
