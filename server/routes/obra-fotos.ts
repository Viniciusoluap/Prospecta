import { Router, Request, Response } from "express";
import { eq, sql } from "drizzle-orm";
import { constructionPhotos, constructionProjects } from "../../drizzle/schema.js";
import { getTokenFromRequest, verifySessionToken } from "../_core/auth-utils.js";
import { getDb, getUserById } from "../db.js";
import { sessaoAindaValida } from "../../shared/session.js";
import { lerDataUrl, podeGerenciarFotos, podeVerFotosDaObra, validarFotoObra } from "../../shared/obra-fotos.js";
import { canAccessAdminProcedure } from "../_core/trpc.js";

// EPIC-020 Lote 4 (item 28) — fotos da obra gravadas no próprio banco.
// Antes: /api/upload-photo mandava para um storage externo que nunca foi
// configurado em produção (nenhuma foto gravada) e o erro deixava a tela presa
// em "Enviando...". Rotas Express puras: a sessão é verificada aqui com o mesmo
// mecanismo de createContext (server/_core/context.ts).

const router = Router();

async function usuarioDaSessao(req: Request) {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  const usuario = await getUserById(payload.userId);
  if (!usuario || !sessaoAindaValida(usuario, payload.sessionVersion) || !usuario.active) return null;
  return usuario;
}

const idValido = (v: string) => (/^\d{1,9}$/.test(v) ? Number(v) : null);

router.post("/obras/:projectId/fotos", async (req: Request, res: Response) => {
  try {
    const usuario = await usuarioDaSessao(req);
    if (!usuario) return res.status(401).json({ error: "Sessão expirada. Entre novamente." });
    // Item 06 (revisão do Codex no Santa Fé #180, mesma regra aqui): equipe com o
    // módulo Obras envia, como já faz pelas telas de obra (router "construction").
    if (!podeGerenciarFotos({ id: usuario.id, papel: usuario.role, acessoObras: canAccessAdminProcedure(usuario, "construction.fotos") }))
      return res.status(403).json({ error: "Sem permissão para enviar fotos desta obra." });
    const projectId = idValido(String(req.params.projectId));
    if (!projectId) return res.status(400).json({ error: "Obra inválida." });

    const { image, caption, takenAt, includeInReport } = (req.body ?? {}) as Record<string, unknown>;
    const base64 = lerDataUrl(image);
    if (!base64) return res.status(400).json({ error: "Imagem ausente ou em formato inválido." });
    const bytes = Buffer.from(base64, "base64");
    const legenda = typeof caption === "string" && caption.trim() ? caption.trim() : null;
    const validacao = validarFotoObra(bytes, legenda);
    if (!validacao.ok) return res.status(400).json({ error: validacao.erro });
    const data = typeof takenAt === "string" && !Number.isNaN(Date.parse(takenAt)) ? new Date(takenAt) : new Date();
    if (data.getTime() > Date.now() + 86_400_000) return res.status(400).json({ error: "Data da foto no futuro." });

    const db = getDb();
    const [obra] = await db.select({ id: constructionProjects.id }).from(constructionProjects).where(eq(constructionProjects.id, projectId)).limit(1);
    if (!obra) return res.status(404).json({ error: "Obra não encontrada." });

    // Id reservado antes para gravar foto + bytes no mesmo lote atômico.
    const reserva = await db.execute(sql`SELECT nextval(pg_get_serial_sequence('construction_photos', 'id'))::int AS id`);
    const photoId = Number((reserva as unknown as { rows: { id: number }[] }).rows[0].id);
    const imageUrl = `/api/obra-foto/${photoId}`;
    await db.batch([
      db.insert(constructionPhotos).values({
        id: photoId,
        projectId,
        imageUrl,
        caption: legenda,
        takenAt: data,
        uploadedBy: usuario.id,
        includeInReport: includeInReport !== false,
      }),
      db.execute(sql`INSERT INTO construction_photo_files (photo_id, mime, size_bytes, data)
        VALUES (${photoId}, ${validacao.mime}, ${bytes.length}, decode(${base64}, 'base64'))`),
    ]);
    return res.json({ id: photoId, imageUrl, caption: legenda, takenAt: data.toISOString(), includeInReport: includeInReport !== false });
  } catch (error) {
    console.error("[obra-fotos] envio:", error);
    return res.status(500).json({ error: "Erro ao gravar a foto. Tente novamente." });
  }
});

router.get("/obra-foto/:photoId", async (req: Request, res: Response) => {
  try {
    const usuario = await usuarioDaSessao(req);
    if (!usuario) return res.status(401).json({ error: "Não autorizado" });
    const photoId = idValido(String(req.params.photoId));
    if (!photoId) return res.status(404).json({ error: "Foto não encontrada" });
    const resultado = await getDb().execute(sql`
      SELECT f.mime, encode(f.data, 'base64') AS b64, p.user_id, p.lead_id
      FROM construction_photo_files f
      JOIN construction_photos ph ON ph.id = f.photo_id
      JOIN construction_projects p ON p.id = ph.project_id
      WHERE f.photo_id = ${photoId}`);
    const linha = (resultado as unknown as { rows: { mime: string; b64: string; user_id: number | null; lead_id: number | null }[] }).rows[0];
    if (!linha) return res.status(404).json({ error: "Foto não encontrada" });
    const pode = podeVerFotosDaObra(
      { id: usuario.id, papel: usuario.role, leadId: usuario.leadId ?? null, acessoObras: canAccessAdminProcedure(usuario, "construction.fotos") },
      { usuarioId: linha.user_id, leadId: linha.lead_id }
    );
    if (!pode) return res.status(404).json({ error: "Foto não encontrada" });
    const corpo = Buffer.from(linha.b64, "base64");
    res.setHeader("Content-Type", linha.mime);
    res.setHeader("Content-Length", String(corpo.length));
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.end(corpo);
  } catch (error) {
    console.error("[obra-fotos] leitura:", error);
    return res.status(500).json({ error: "Erro ao carregar a foto." });
  }
});

export default router;
