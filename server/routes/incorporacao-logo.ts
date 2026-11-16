// EPIC-024 S-02 — imagem do logotipo do empreendimento. Os cartões recebem só o PNG de exibição (ETag pelo sha256,
// cache curto e privado); o arquivo original só sai como download (`Content-Disposition: attachment`).
import { Router, type Request, type Response } from "express";
import { bytesDoLogo } from "../incorporacao-logo-router.js";
import { usuarioDaIncorporacao } from "./camadas-terreno.js";

const router = Router();

function estudoDaUrl(req: Request): number | null {
  const id = Number(req.params.studyId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get("/incorporacao/logo/:studyId", async (req: Request, res: Response) => {
  try {
    const u = await usuarioDaIncorporacao(req);
    if (u === null) return res.status(401).end();
    if (u === false) return res.status(403).end();
    const id = estudoDaUrl(req);
    const logo = id ? await bytesDoLogo(id, "exibicao") : null;
    if (!logo) return res.status(404).end();
    const etag = `"${logo.etag}"`;
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "private, max-age=300, must-revalidate");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.headers["if-none-match"] === etag) return res.status(304).end();
    res.setHeader("Content-Type", "image/png");
    return res.end(logo.dados);
  } catch (erro) {
    console.error("[incorporacao-logo]", erro);
    return res.status(500).end();
  }
});

router.get("/incorporacao/logo/:studyId/original", async (req: Request, res: Response) => {
  try {
    const u = await usuarioDaIncorporacao(req);
    if (u === null) return res.status(401).end();
    if (u === false) return res.status(403).end();
    const id = estudoDaUrl(req);
    const logo = id ? await bytesDoLogo(id, "original") : null;
    if (!logo) return res.status(404).end();
    res.setHeader("Content-Type", logo.mime);
    res.setHeader("Content-Disposition", `attachment; filename="logotipo"; filename*=UTF-8''${encodeURIComponent(logo.nome)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox");
    res.setHeader("Cache-Control", "private, no-store");
    return res.end(logo.dados);
  } catch (erro) {
    console.error("[incorporacao-logo]", erro);
    return res.status(500).end();
  }
});

export default router;
