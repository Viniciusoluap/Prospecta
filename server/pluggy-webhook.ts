// Pedido de 25/10 (avisos em tempo real): a Pluggy avisa quando a conexão (item) tem dados novos
// e o sistema sincroniza na hora as contas daquela conexão. Cabeçalho secreto registrado por nós.
import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { segredoWebhookPluggy, sincronizarPorEvento } from "./bancos.js";

const EVENTOS = new Set(["item/updated", "item/created", "transactions/created", "transactions/updated", "transactions/deleted"]);

function tokenValido(recebido: unknown): boolean {
  if (typeof recebido !== "string") return false;
  const a = Buffer.from(recebido), b = Buffer.from(segredoWebhookPluggy());
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function handlePluggyWebhook(req: Request, res: Response) {
  if (!tokenValido(req.headers["x-webhook-token"])) return res.status(401).json({ error: "Não autorizado" });
  const { event, itemId } = (req.body ?? {}) as { event?: string; itemId?: string };
  if (!event || !itemId || !EVENTOS.has(event)) return res.status(200).json({ ignorado: true });
  try {
    const r = await sincronizarPorEvento({ provedor: "pluggy", itemId });
    return res.status(200).json({ ok: true, contas: r.length });
  } catch (e) {
    console.error("[Pluggy Webhook]", e instanceof Error ? e.message : e);
    return res.status(200).json({ ok: false });
  }
}
