// Central de Vendas (12/11/2026) — endpoints de entrada de leads (site e bloco "HTTP Request" da Logyca).
// Autenticados por token próprio (cifrado no cofre, gerado na tela), payload validado (zod) e limitação de taxa.
// Respostas nunca ecoam dados pessoais.
import { timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { SegredoCentral } from "../../shared/central-vendas/config.js";
import { carregarConfig, erroSeguro, registrarEvento, segredo } from "./base.js";
import { receberContato, type OrigemContato } from "./entrada.js";
import { enfileirarTemplate, processarFila } from "./envio.js";
import { dentroDoLimite } from "./rotina.js";

const texto = (max: number) => z.string().trim().max(max).optional().nullable();
export const payloadEntrada = z.object({
  telefone: z.string().trim().min(8).max(30),
  nome: texto(255),
  email: z.string().trim().email().max(320).optional().nullable().or(z.literal("")),
  cidade: texto(100),
  mensagem: texto(2000),
  idExterno: texto(160),
  campanha: z.string().trim().max(80).regex(/^[a-zA-Z0-9_-]*$/).optional().nullable(),
  /** Consentimento LGPD coletado pelo formulário do site (o agente pede de novo no WhatsApp se faltar). */
  consentimentoLgpd: z.boolean().optional(),
}).strict();

function tokenConfere(recebido: string | undefined, esperado: string | null) {
  if (!recebido || !esperado) return false;
  const a = Buffer.from(recebido), b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function tratarEntrada(origem: Exclude<OrigemContato, "whatsapp">, req: Pick<Request, "headers" | "body" | "ip">) {
  const config = await carregarConfig();
  if (!config.ativo || (origem === "logyca" && !config.logyca.ativo)) return { status: 404, body: { error: "Indisponível" } };
  const nome: SegredoCentral = origem === "site" ? "tokenSite" : "tokenLogycaEntrada";
  const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ""))?.[1]?.trim();
  if (!(await dentroDoLimite(`entrada:${origem}:${req.ip ?? "?"}`, 30))) return { status: 429, body: { error: "Muitas requisições" } };
  if (!tokenConfere(bearer, segredo(config, nome))) {
    await registrarEvento({ tipo: "entrada_recusada", origem, resultado: "bloqueado", payload: { motivo: "token" } });
    return { status: 401, body: { error: "Não autorizado" } };
  }
  const p = payloadEntrada.safeParse(req.body ?? {});
  if (!p.success) {
    await registrarEvento({ tipo: "entrada_recusada", origem, resultado: "bloqueado", payload: { motivo: "payload", campos: p.error.issues.map(i => i.path.join(".")).slice(0, 10) } });
    return { status: 400, body: { error: "Dados inválidos", campos: p.error.issues.map(i => i.path.join(".")) } };
  }
  try {
    const d = p.data;
    const r = await receberContato({ origem, telefone: d.telefone, nome: d.nome, email: d.email || null, cidade: d.cidade, texto: d.mensagem, idExterno: d.idExterno, campanha: d.campanha });
    // Lead novo do site recebe a saudação com o pedido de consentimento (proativa: respeita 8h–20h).
    if (r.criado && r.leadId && origem === "site") {
      const job = await enfileirarTemplate({ leadId: r.leadId, slug: "cv-saudacao", chave: `saudacao:${r.leadId}`, proativa: true });
      if (job) await processarFila({ ids: [job.id] });
    }
    return { status: r.leadId ? 200 : 202, body: { ok: Boolean(r.leadId), leadId: r.leadId, novo: r.criado, motivo: r.motivo ?? null } };
  } catch (e) {
    await registrarEvento({ tipo: "erro_entrada", origem, resultado: "erro", erro: erroSeguro(e) });
    return { status: 500, body: { error: "Falha ao registrar" } };
  }
}

const router = Router();
const handler = (origem: "site" | "logyca") => async (req: Request, res: Response) => {
  const r = await tratarEntrada(origem, req);
  res.status(r.status).json(r.body);
};
router.post("/central-vendas/entrada/site", handler("site"));
router.post("/central-vendas/entrada/logyca", handler("logyca"));
export default router;
