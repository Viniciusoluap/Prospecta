import { Router, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { imoveis } from "../../drizzle/schema.js";
import { getTokenFromRequest, verifySessionToken } from "../_core/auth-utils.js";
import { getDb, getUserById } from "../db.js";
import { sessaoAindaValida } from "../../shared/session.js";
import { readPrivateDocument } from "../drive-documents.js";
import { lerFotoImovel } from "../imovel-fotos.js";

// Pedido de 15/10: fotos de imóveis guardadas no Google Drive (ou no banco
// enquanto o Drive estiver fora). Imóvel aprovado: foto pública (site/portais).
// Pendente/reprovado: só a equipe e o corretor que cadastrou.

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

router.get("/imovel-foto/:id", async (req: Request, res: Response) => {
  try {
    const id = /^\d{1,9}$/.test(String(req.params.id)) ? Number(req.params.id) : null;
    const foto = id ? await lerFotoImovel(id) : null;
    if (!foto) return res.status(404).json({ error: "Foto não encontrada" });
    const [imovel] = await getDb().select({ reviewStatus: imoveis.reviewStatus, criador: imoveis.createdByUserId })
      .from(imoveis).where(eq(imoveis.id, foto.imovelId)).limit(1);
    const publica = imovel?.reviewStatus === "approved";
    if (!publica) {
      const u = await usuarioDaSessao(req);
      const pode = u && (u.role === "admin" || u.role === "colaborador" || u.id === imovel?.criador);
      if (!pode) return res.status(404).json({ error: "Foto não encontrada" });
    }
    const corpo = foto.bytes ?? (foto.driveFileId ? await readPrivateDocument(foto.driveFileId) : null);
    if (!corpo) return res.status(404).json({ error: "Foto não encontrada" });
    res.setHeader("Content-Type", foto.mime);
    res.setHeader("Content-Length", String(corpo.length));
    res.setHeader("Cache-Control", publica ? "public, max-age=86400, s-maxage=86400" : "private, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.end(corpo);
  } catch (error) {
    console.error("[imovel-fotos] leitura:", error instanceof Error ? error.message : "erro");
    return res.status(500).json({ error: "Erro ao carregar a foto." });
  }
});

export default router;
