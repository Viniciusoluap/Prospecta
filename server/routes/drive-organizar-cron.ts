// Pedido de 29/10: "Organizar Drive" diário (vercel.json → crons). Mesma proteção
// de /api/cron/lead-card-due: só com `Authorization: Bearer <CRON_SECRET>`.
// Registrada em api/index.ts (Vercel) e server/_core/index.ts (servidor local).
import type { Request, Response } from "express";
import { organizarDriveAgora } from "../drive-organizacao.js";

export async function cronOrganizarDrive(req: Request, res: Response) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: "Não autorizado" });
  try {
    // Prazo de ~45 s dentro do limite de 60 s da função; a próxima execução continua de onde parou.
    return res.json({ ok: true, relatorio: await organizarDriveAgora({ prazoMs: 45_000 }) });
  } catch (error) {
    console.error("[cron/organizar-drive]", error instanceof Error ? error.message : "falha");
    return res.status(500).json({ error: "Falha ao organizar o Drive" });
  }
}
