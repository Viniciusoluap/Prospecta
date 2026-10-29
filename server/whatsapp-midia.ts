// Pedido de 25/10 (noite): imagem, áudio, vídeo e documentos das conversas do WhatsApp
// guardados no próprio banco (regra do dono: sem storage externo) e servidos por rota autenticada.
import { Router, type Request, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import { whatsappMessages } from "../drizzle/schema.js";
import { getTokenFromRequest, verifySessionToken } from "./_core/auth-utils.js";
import { LIMITE_MIDIA, baixarMidiaEvolution } from "./_core/evolution.js";
import { sessaoAindaValida } from "../shared/session.js";
import { getDb, getUserById } from "./db.js";
import { copiarParaDrive, lixeiraDoArquivo } from "./drive-organizacao.js";

type Linhas<T> = { rows: T[] };

/** Grava (ou troca) o arquivo da mensagem. Devolve false se passar do limite. */
export async function guardarMidia(messageId: number, base64: string, dados: { mime?: string | null; nome?: string | null }): Promise<boolean> {
  const tamanho = Buffer.byteLength(base64, "base64");
  if (!tamanho || tamanho > LIMITE_MIDIA) return false;
  const db = getDb();
  const anterior = (await db.execute(sql`SELECT drive_file_id FROM whatsapp_midias WHERE message_id = ${messageId}`) as unknown as Linhas<{ drive_file_id: string | null }>).rows[0];
  // Pedido de 29/10: arquivo trocado → a cópia antiga do Drive vai para a lixeira e a nova é enviada.
  const r = await db.execute(sql`INSERT INTO whatsapp_midias (message_id, conteudo) VALUES (${messageId}, decode(${base64}, 'base64'))
    ON CONFLICT (message_id) DO UPDATE SET conteudo = EXCLUDED.conteudo, drive_file_id = NULL RETURNING id`);
  await db.update(whatsappMessages).set({
    midiaTamanho: tamanho,
    ...(dados.mime ? { midiaMime: dados.mime } : {}),
    ...(dados.nome ? { midiaNome: dados.nome } : {}),
    updatedAt: new Date(),
  }).where(eq(whatsappMessages.id, messageId));
  const midiaId = (r as unknown as Linhas<{ id: number }>).rows[0]?.id;
  if (anterior?.drive_file_id) await lixeiraDoArquivo(anterior.drive_file_id);
  if (midiaId) await copiarParaDrive("whatsapp_midia", Number(midiaId));
  return true;
}

/**
 * Busca o arquivo na Evolution e guarda. Tolerante: qualquer falha devolve um motivo
 * e a mensagem continua gravada com o rótulo ("tentar baixar de novo" na tela).
 */
export async function baixarEGuardarMidia(messageId: number, instancia: string, externalId: string, tamanhoDeclarado: number | null, fetchImpl?: typeof fetch): Promise<{ ok: boolean; motivo?: string }> {
  if (tamanhoDeclarado && tamanhoDeclarado > LIMITE_MIDIA) return { ok: false, motivo: "Arquivo maior que 10 MB: fica só o aviso." };
  try {
    const { configEvolution } = await import("./whatsapp-router.js");
    const c = await configEvolution();
    if (!c) return { ok: false, motivo: "Servidor do WhatsApp não configurado." };
    const arquivo = await baixarMidiaEvolution(c, instancia, externalId, fetchImpl);
    if (!arquivo) return { ok: false, motivo: "A Evolution não entregou o arquivo." };
    if (!(await guardarMidia(messageId, arquivo.base64, arquivo))) return { ok: false, motivo: "Arquivo maior que 10 MB: fica só o aviso." };
    return { ok: true };
  } catch (e) {
    console.error("[whatsapp-midia] download:", e instanceof Error ? e.message : "falha");
    return { ok: false, motivo: e instanceof Error ? e.message : "Falha ao baixar o arquivo." };
  }
}

async function usuarioDaSessao(req: Request) {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  const usuario = await getUserById(payload.userId);
  if (!usuario || !sessaoAindaValida(usuario, payload.sessionVersion) || !usuario.active) return null;
  return usuario;
}

/** Mídia passiva e PDF abrem no visualizador; HTML/SVG seguem como download. */
export function tipoDeEntrega(mime: string | null | undefined, tipo: string | null | undefined): { mime: string; inline: boolean } {
  if (mime?.toLowerCase().split(";")[0].trim() === "application/pdf") return { mime: "application/pdf", inline: true };
  const m = (mime ?? "").toLowerCase();
  const seguro = /^(image\/(jpeg|png|webp|gif)|audio\/[\w.+-]+|video\/[\w.+-]+)$/.test(m);
  if (seguro && tipo !== "documento") return { mime: m, inline: true };
  return { mime: "application/octet-stream", inline: false };
}

const router = Router();

/** Mesma checagem de acesso da conversa (whatsapp.mensagensConversa); sem acesso = 404. */
router.get("/whatsapp/midia/:id", async (req: Request, res: Response) => {
  try {
    const usuario = await usuarioDaSessao(req);
    if (!usuario) return res.status(401).json({ error: "Não autorizado" });
    const id = /^\d{1,9}$/.test(String(req.params.id)) ? Number(req.params.id) : null;
    if (!id) return res.status(404).json({ error: "Arquivo não encontrado" });
    const { acessoMensagemWhatsapp } = await import("./whatsapp-router.js");
    const msg = await acessoMensagemWhatsapp(usuario, id);
    if (!msg) return res.status(404).json({ error: "Arquivo não encontrado" });
    const r = await getDb().execute(sql`SELECT encode(conteudo, 'base64') AS b64 FROM whatsapp_midias WHERE message_id = ${id}`);
    const linha = (r as unknown as Linhas<{ b64: string }>).rows[0];
    if (!linha) return res.status(404).json({ error: "Arquivo ainda não baixado" });
    const corpo = Buffer.from(linha.b64, "base64");
    const { mime, inline } = tipoDeEntrega(msg.midiaMime, msg.midiaTipo);
    const nome = msg.midiaNome ?? `whatsapp-${id}`;
    const ascii = nome.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", String(corpo.length));
    res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`);
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.end(corpo);
  } catch (error) {
    console.error("[whatsapp-midia] leitura:", error instanceof Error ? error.message : "falha");
    return res.status(500).json({ error: "Erro ao carregar o arquivo." });
  }
});

export default router;
