import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { operationalProjects as projects, projectRevisionRequests as revisoes } from "../../drizzle/schema.js";
import { getTokenFromRequest, verifySessionToken } from "../_core/auth-utils.js";
import { canAccessAdminProcedure } from "../_core/trpc.js";
import { getDb, getUserById } from "../db.js";
import { sessaoAindaValida } from "../../shared/session.js";
import { encryptSecret, decryptSecret } from "../_core/secret-vault.js";
import { iniciarUploadProjetoDrive, enviarParteProjetoDrive } from "../drive-documents.js";
import { projectChecklist, validateProjectUpload, PROJECT_CHUNK_SIZE, type ProjectCheck } from "../../shared/projeto-documentos.js";
import { PROJECT_TYPE_LABELS } from "../../shared/operacional.js";
const router = Router();
type Session = { uid: number; projectId: number; revisionId?: number; itemId: string; kind: "editable" | "pdf"; name: string; mime: string; size: number; location: string; expires: number };
const parseArray = <T,>(value: string | null): T[] => { try { const x = JSON.parse(value || "[]"); return Array.isArray(x) ? x : []; } catch { return []; } };

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
      const location = await iniciarUploadProjetoDrive({ projectId: String(projectId), clientId: String(project.leadId || `projeto-${projectId}`), clientName: project.clientName, projectName: project.name, itemId, itemName: `Revisão ${revisionId}`, kind: body.kind, name: body.name, mime, size: body.size });
      const session: Session = { uid: user.id, projectId, revisionId, itemId, kind: body.kind, name: body.name, mime, size: body.size, location, expires: Date.now() + 24 * 60 * 60 * 1000 };
      return res.json({ session: encryptSecret(JSON.stringify(session)), offset: 0 });
    }
    if (body.action === "start") {
      validateProjectUpload(body.name, body.size, body.kind);
      const checks = projectChecklist(parseArray<string>(project.types), parseArray<ProjectCheck>(project.checklist), PROJECT_TYPE_LABELS);
      const item = checks.find(c => c.id === body.itemId);
      if (!item) return res.status(400).json({ error: "Salve o item do checklist antes de enviar o arquivo." });
      const mime = body.kind === "pdf" ? "application/pdf" : String(body.mime || "application/octet-stream").slice(0, 150);
      const location = await iniciarUploadProjetoDrive({ projectId: String(projectId), clientId: String(project.leadId || `projeto-${projectId}`), clientName: project.clientName, projectName: project.name, itemId: item.id!, itemName: item.text, kind: body.kind, name: body.name, mime, size: body.size });
      const session: Session = { uid: user.id, projectId, itemId: item.id!, kind: body.kind, name: body.name, mime, size: body.size, location, expires: Date.now() + 24 * 60 * 60 * 1000 };
      return res.json({ session: encryptSecret(JSON.stringify(session)), offset: 0 });
    }
    const session = JSON.parse(decryptSecret(String(body.session || ""))) as Session;
    if (session.uid !== user.id || session.projectId !== projectId || session.expires < Date.now()) return res.status(400).json({ error: "Envio expirado. Selecione o arquivo novamente." });
    const start = Number(body.offset);
    const bytes = Buffer.from(String(body.chunk || ""), "base64");
    if (!Number.isSafeInteger(start) || start < 0 || bytes.length > PROJECT_CHUNK_SIZE || start + bytes.length > session.size || (bytes.length && start % (256 * 1024) !== 0)) return res.status(400).json({ error: "Parte de arquivo inválida." });
    const result = await enviarParteProjetoDrive(session.location, start, session.size, session.mime, bytes);
    if (!result.driveFileId) return res.json(result);
    if (session.revisionId) {
      const entrega = { nome: session.name, url: `https://drive.google.com/file/d/${result.driveFileId}/view`, driveFileId: result.driveFileId, tipo: session.kind, enviadoEm: new Date().toISOString(), enviadoPor: user.name || user.email || `Usuário ${user.id}` };
      // Acrescenta (nunca sobrescreve) e marca o pedido como entregue; idempotente por driveFileId.
      await getDb().execute(sql`UPDATE project_revision_requests SET deliveries = (COALESCE(NULLIF(deliveries, ''), '[]')::jsonb || ${JSON.stringify([entrega])}::jsonb)::text, status = 'entregue', delivered_at = now(), delivered_by_user_id = ${user.id}, updated_at = now() WHERE id = ${session.revisionId} AND project_id = ${projectId} AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(NULLIF(deliveries, ''), '[]')::jsonb) f WHERE f->>'driveFileId' = ${result.driveFileId})`);
      return res.json({ ...result, entrega });
    }
    const file = { name: session.name, url: `https://drive.google.com/file/d/${result.driveFileId}/view`, itemId: session.itemId, kind: session.kind, driveFileId: result.driveFileId };
    await getDb().execute(sql`UPDATE operational_projects SET files = (COALESCE(NULLIF(files, ''), '[]')::jsonb || ${JSON.stringify([file])}::jsonb)::text, updated_at = now() WHERE id = ${projectId} AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(NULLIF(files, ''), '[]')::jsonb) f WHERE f->>'driveFileId' = ${result.driveFileId})`);
    return res.json({ ...result, file });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Não foi possível enviar o arquivo ao Drive." });
  }
});
export default router;
