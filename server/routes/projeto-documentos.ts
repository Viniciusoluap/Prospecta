import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { operationalProjects as projects, projectDocuments, projectRevisionRequests as revisoes } from "../../drizzle/schema.js";
import { getTokenFromRequest, verifySessionToken } from "../_core/auth-utils.js";
import { canAccessAdminProcedure } from "../_core/trpc.js";
import { getDb, getUserById } from "../db.js";
import { sessaoAindaValida } from "../../shared/session.js";
import { encryptSecret, decryptSecret } from "../_core/secret-vault.js";
import { iniciarUploadProjetoDrive, enviarParteProjetoDrive } from "../drive-documents.js";
import { projectChecklist, projectDocumentCanonicalName, reconcileProjectChecklist, validateProjectUpload, PROJECT_CHUNK_SIZE, type ProjectCheck } from "../../shared/projeto-documentos.js";
import { PROJECT_TYPE_LABELS } from "../../shared/operacional.js";
const router = Router();
type Session = { uid: number; projectId: number; revisionId?: number; documentId: number; itemId: string; kind: "editable" | "pdf"; name: string; canonicalName: string; version: number; mime: string; size: number; location: string; expires: number };
const parseArray = <T,>(value: string | null): T[] => { try { const x = JSON.parse(value || "[]"); return Array.isArray(x) ? x : []; } catch { return []; } };

async function reservarDocumento(input: { projectId: number; revisionId?: number; itemId: string; itemName: string; kind: "editable" | "pdf"; name: string; mime: string; size: number; projectName: string; clientName: string; userId: number }) {
  return getDb().transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`project-document:${input.projectId}:${input.itemId}:${input.kind}`}))`);
    const [ultimo] = await tx.select({ version: sql<number>`coalesce(max(${projectDocuments.version}), 0)::int` }).from(projectDocuments)
      .where(and(eq(projectDocuments.projectId, input.projectId), eq(projectDocuments.itemId, input.itemId), eq(projectDocuments.kind, input.kind)));
    const version = (ultimo?.version ?? 0) + 1;
    const canonicalName = projectDocumentCanonicalName({ projectName: input.projectName, clientName: input.clientName, itemName: input.itemName, version, originalName: input.name, mime: input.mime });
    const [document] = await tx.insert(projectDocuments).values({
      projectId: input.projectId, revisionId: input.revisionId ?? null, itemId: input.itemId, kind: input.kind,
      originalName: input.name, canonicalName, mime: input.mime, size: input.size, version,
      status: "uploading", uploadedByUserId: input.userId,
    }).returning({ id: projectDocuments.id });
    return { documentId: document.id, version, canonicalName };
  });
}

router.post("/projetos/:projectId/documentos", async (req, res) => {
  try {
    const token = getTokenFromRequest(req);
    const payload = token ? await verifySessionToken(token) : null;
    const user = payload ? await getUserById(payload.userId) : null;
    if (!user || !payload || !user.active || !sessaoAindaValida(user, payload.sessionVersion)) return res.status(401).json({ error: "Entre novamente." });
    if (!canAccessAdminProcedure(user, "projetos.update")) return res.status(403).json({ error: "Sem permissão para projetos." });
    const projectId = Number(req.params.projectId);
    if (!Number.isSafeInteger(projectId) || projectId <= 0) return res.status(400).json({ error: "Projeto inválido." });
    const [project] = await getDb().select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) return res.status(404).json({ error: "Projeto não encontrado." });
    const body = req.body || {};
    if (body.action === "start" && body.revisionId != null) {
      // Lote 23/10, etapa 2C: versão revisada entregue no próprio card do pedido.
      validateProjectUpload(body.name, body.size, body.kind);
      const revisionId = Number(body.revisionId);
      if (!Number.isSafeInteger(revisionId) || revisionId <= 0) return res.status(400).json({ error: "Pedido de revisão inválido." });
      const [pedido] = await getDb().select({ id: revisoes.id }).from(revisoes).where(and(eq(revisoes.id, revisionId), eq(revisoes.projectId, projectId))).limit(1);
      if (!pedido) return res.status(404).json({ error: "Pedido de revisão não encontrado neste projeto." });
      const mime = body.kind === "pdf" ? "application/pdf" : String(body.mime || "application/octet-stream").slice(0, 150);
      const itemId = `revisao-${revisionId}`;
      const reserved = await reservarDocumento({ projectId, revisionId, itemId, itemName: `Revisão ${revisionId}`, kind: body.kind, name: body.name, mime, size: body.size, projectName: project.name, clientName: project.clientName, userId: user.id });
      const location = await iniciarUploadProjetoDrive({ projectId: String(projectId), clientId: String(project.leadId || `projeto-${projectId}`), clientName: project.clientName, projectName: project.name, itemId, itemName: `Revisão ${revisionId}`, kind: body.kind, name: body.name, canonicalName: reserved.canonicalName, mime, size: body.size });
      const session: Session = { uid: user.id, projectId, revisionId, ...reserved, itemId, kind: body.kind, name: body.name, mime, size: body.size, location, expires: Date.now() + 24 * 60 * 60 * 1000 };
      return res.json({ session: encryptSecret(JSON.stringify(session)), offset: 0 });
    }
    if (body.action === "start") {
      validateProjectUpload(body.name, body.size, body.kind);
      const checks = projectChecklist(parseArray<string>(project.types), parseArray<ProjectCheck>(project.checklist), PROJECT_TYPE_LABELS);
      const item = checks.find(c => c.id === body.itemId);
      if (!item) return res.status(400).json({ error: "Salve o item do checklist antes de enviar o arquivo." });
      const mime = body.kind === "pdf" ? "application/pdf" : String(body.mime || "application/octet-stream").slice(0, 150);
      const reserved = await reservarDocumento({ projectId, itemId: item.id!, itemName: item.text, kind: body.kind, name: body.name, mime, size: body.size, projectName: project.name, clientName: project.clientName, userId: user.id });
      const location = await iniciarUploadProjetoDrive({ projectId: String(projectId), clientId: String(project.leadId || `projeto-${projectId}`), clientName: project.clientName, projectName: project.name, itemId: item.id!, itemName: item.text, kind: body.kind, name: body.name, canonicalName: reserved.canonicalName, mime, size: body.size });
      const session: Session = { uid: user.id, projectId, ...reserved, itemId: item.id!, kind: body.kind, name: body.name, mime, size: body.size, location, expires: Date.now() + 24 * 60 * 60 * 1000 };
      return res.json({ session: encryptSecret(JSON.stringify(session)), offset: 0 });
    }
    if (body.action === "delete") {
      const documentId = Number(body.documentId);
      if (!Number.isSafeInteger(documentId) || documentId <= 0) return res.status(400).json({ error: "Documento inválido." });
      const updated = await getDb().transaction(async tx => {
        await tx.execute(sql`SELECT id FROM operational_projects WHERE id = ${projectId} FOR UPDATE`);
        const [document] = await tx.select().from(projectDocuments).where(and(eq(projectDocuments.id, documentId), eq(projectDocuments.projectId, projectId))).limit(1);
        if (!document || document.status === "deleted") throw new Error("Documento não encontrado.");
        await tx.update(projectDocuments).set({ status: "deleted", deletedAt: new Date(), updatedAt: new Date() }).where(eq(projectDocuments.id, documentId));
        const active = await tx.select({ itemId: projectDocuments.itemId, kind: projectDocuments.kind }).from(projectDocuments)
          .where(and(eq(projectDocuments.projectId, projectId), eq(projectDocuments.status, "active")));
        const current = await tx.select().from(projects).where(eq(projects.id, projectId)).limit(1);
        const checklist = reconcileProjectChecklist(projectChecklist(parseArray<string>(current[0].types), parseArray<ProjectCheck>(current[0].checklist), PROJECT_TYPE_LABELS), active.map(d => ({ itemId: d.itemId, kind: d.kind as "editable" | "pdf" })));
        const files = parseArray<{ documentId?: number; driveFileId?: string }>(current[0].files).filter(file => file.documentId !== documentId && file.driveFileId !== document.driveFileId);
        await tx.update(projects).set({ checklist: JSON.stringify(checklist), files: JSON.stringify(files), updatedAt: new Date() }).where(eq(projects.id, projectId));
        return { checklist, files };
      });
      return res.json({ success: true, ...updated });
    }
    const session = JSON.parse(decryptSecret(String(body.session || ""))) as Session;
    if (session.uid !== user.id || session.projectId !== projectId || session.expires < Date.now()) return res.status(400).json({ error: "Envio expirado. Selecione o arquivo novamente." });
    const start = Number(body.offset);
    const bytes = Buffer.from(String(body.chunk || ""), "base64");
    if (!Number.isSafeInteger(start) || start < 0 || bytes.length > PROJECT_CHUNK_SIZE || start + bytes.length > session.size || (bytes.length && start % (256 * 1024) !== 0)) return res.status(400).json({ error: "Parte de arquivo inválida." });
    const result = await enviarParteProjetoDrive(session.location, start, session.size, session.mime, bytes);
    if (!result.driveFileId) return res.json(result);
    if (session.revisionId) {
      const entrega = { nome: session.canonicalName, nomeOriginal: session.name, versao: session.version, documentId: session.documentId, url: `https://drive.google.com/file/d/${result.driveFileId}/view`, driveFileId: result.driveFileId, tipo: session.kind, enviadoEm: new Date().toISOString(), enviadoPor: user.name || user.email || `Usuário ${user.id}` };
      // Acrescenta (nunca sobrescreve) e marca o pedido como entregue; idempotente por driveFileId.
      await getDb().transaction(async tx => {
        await tx.execute(sql`SELECT id FROM operational_projects WHERE id = ${projectId} FOR UPDATE`);
        await tx.update(projectDocuments).set({ status: "substituted", replacedById: session.documentId, updatedAt: new Date() })
          .where(and(eq(projectDocuments.projectId, projectId), eq(projectDocuments.itemId, session.itemId), eq(projectDocuments.kind, session.kind), eq(projectDocuments.status, "active")));
        await tx.update(projectDocuments).set({ status: "active", driveFileId: result.driveFileId, url: entrega.url, updatedAt: new Date() }).where(eq(projectDocuments.id, session.documentId));
        await tx.execute(sql`UPDATE project_revision_requests SET deliveries = (COALESCE(NULLIF(deliveries, ''), '[]')::jsonb || ${JSON.stringify([entrega])}::jsonb)::text, status = 'entregue', delivered_at = now(), delivered_by_user_id = ${user.id}, updated_at = now() WHERE id = ${session.revisionId} AND project_id = ${projectId} AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(NULLIF(deliveries, ''), '[]')::jsonb) f WHERE f->>'driveFileId' = ${result.driveFileId})`);
        const [pending] = await tx.select({ id: revisoes.id }).from(revisoes).where(and(eq(revisoes.projectId, projectId), eq(revisoes.status, "pendente"))).limit(1);
        if (!pending) {
          const [origin] = await tx.select({ status: revisoes.previousProjectStatus }).from(revisoes)
            .where(and(eq(revisoes.projectId, projectId), sql`${revisoes.previousProjectStatus} is not null`)).orderBy(sql`${revisoes.createdAt} desc`).limit(1);
          await tx.update(projects).set({ status: origin?.status || "execucao", updatedAt: new Date() }).where(eq(projects.id, projectId));
        }
      });
      return res.json({ ...result, entrega });
    }
    const file = { name: session.canonicalName, originalName: session.name, version: session.version, documentId: session.documentId, url: `https://drive.google.com/file/d/${result.driveFileId}/view`, itemId: session.itemId, kind: session.kind, driveFileId: result.driveFileId };
    const checklist = await getDb().transaction(async tx => {
      await tx.execute(sql`SELECT id FROM operational_projects WHERE id = ${projectId} FOR UPDATE`);
      await tx.update(projectDocuments).set({ status: "substituted", replacedById: session.documentId, updatedAt: new Date() })
        .where(and(eq(projectDocuments.projectId, projectId), eq(projectDocuments.itemId, session.itemId), eq(projectDocuments.kind, session.kind), eq(projectDocuments.status, "active")));
      await tx.update(projectDocuments).set({ status: "active", driveFileId: result.driveFileId, url: file.url, updatedAt: new Date() }).where(eq(projectDocuments.id, session.documentId));
      const active = await tx.select({ itemId: projectDocuments.itemId, kind: projectDocuments.kind }).from(projectDocuments)
        .where(and(eq(projectDocuments.projectId, projectId), eq(projectDocuments.status, "active")));
      const current = (await tx.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0];
      const reconciled = reconcileProjectChecklist(projectChecklist(parseArray<string>(current.types), parseArray<ProjectCheck>(current.checklist), PROJECT_TYPE_LABELS), active.map(d => ({ itemId: d.itemId, kind: d.kind as "editable" | "pdf" })));
      const files = parseArray<{ driveFileId?: string; documentId?: number }>(current.files).filter(existing => existing.documentId !== session.documentId && existing.driveFileId !== result.driveFileId);
      await tx.update(projects).set({ files: JSON.stringify([...files, file]), checklist: JSON.stringify(reconciled), updatedAt: new Date() }).where(eq(projects.id, projectId));
      return reconciled;
    });
    return res.json({ ...result, file, checklist });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Não foi possível enviar o arquivo ao Drive." });
  }
});
export default router;
