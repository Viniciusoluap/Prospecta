import { Router, Request, Response } from "express";
import { storagePut } from "../storage.js";
import { getTokenFromRequest, verifySessionToken } from "../_core/auth-utils.js";
import { getUserById } from "../db.js";
import { sessaoAindaValida } from "../../shared/session.js";

const router = Router();

// Rota Express pura (fora do tRPC) - nao herda o adminProcedure/protectedProcedure
// dos routers tRPC, entao a sessao precisa ser verificada manualmente aqui, com o
// mesmo mecanismo usado por createContext (server/_core/context.ts). So chamada
// hoje por AdminEditarObra.tsx (upload de fotos de obra), que so deveria ser
// acessivel a admin.
async function usuarioAdminAutenticado(req: Request) {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  const usuario = await getUserById(payload.userId);
  if (!sessaoAindaValida(usuario, payload.sessionVersion) || usuario?.role !== "admin") return null;
  return usuario;
}

router.post("/upload-photo", async (req: Request, res: Response) => {
  const usuario = await usuarioAdminAutenticado(req);
  if (!usuario) return res.status(401).json({ error: "Não autorizado" });

  try {
    const { image, filename, projectId } = req.body;

    if (!image || !filename || !projectId) {
      return res.status(400).json({ error: "Dados incompletos" });
    }

    // Extrair dados da imagem base64
    const matches = image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return res.status(400).json({ error: "Formato de imagem inválido" });
    }

    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, "base64");

    // Gerar nome único para o arquivo
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const extension = filename.split(".").pop() || "jpg";
    const fileKey = `construction-photos/${projectId}/${timestamp}-${randomSuffix}.${extension}`;

    // Upload para S3
    const { url } = await storagePut(fileKey, buffer, mimeType);

    res.json({ url });
  } catch (error) {
    console.error("Erro ao fazer upload:", error);
    res.status(500).json({ error: "Erro ao fazer upload da foto" });
  }
});

export default router;
