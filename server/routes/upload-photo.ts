import { Router } from "express";
import { storagePut } from "../storage";

const router = Router();

router.post("/upload-photo", async (req, res) => {
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
