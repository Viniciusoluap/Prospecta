import { Router, Request, Response } from "express";
import { getTokenFromRequest, verifySessionToken } from "../_core/auth-utils.js";
import { getUserById } from "../db.js";
import { sessaoAindaValida } from "../../shared/session.js";
import { descreverErroDrive } from "../../shared/drive-erro.js";
import { assinarEstado, origemDaRequisicao, urlAutorizacao, verificarEstado } from "../../shared/google-drive-oauth.js";
import { clienteOAuth, concluirConexao, segredoEstado } from "../google-drive-oauth.js";

// Conexão do Google Drive com a conta Google do dono (OAuth). Só administradores.
// "conectar" leva ao consentimento do Google; "callback" recebe o código, grava o
// token criptografado e volta para Integrações com o resultado.

const router = Router();

async function adminDaSessao(req: Request) {
  const token = getTokenFromRequest(req);
  const payload = token ? await verifySessionToken(token) : null;
  const usuario = payload ? await getUserById(payload.userId) : null;
  if (!usuario || !payload || !usuario.active || !sessaoAindaValida(usuario, payload.sessionVersion) || usuario.role !== "admin") return null;
  return usuario;
}

const voltar = (res: Response, resultado: "ok" | "erro", motivo?: string) =>
  res.redirect(302, `/admin/integracoes?drive=${resultado}${motivo ? `&motivo=${encodeURIComponent(motivo.slice(0, 300))}` : ""}`);

router.get("/google-drive/conectar", async (req: Request, res: Response) => {
  try {
    const admin = await adminDaSessao(req);
    if (!admin) return voltar(res, "erro", "Entre como administrador para conectar o Google Drive.");
    const origem = origemDaRequisicao(req.get("x-forwarded-host") ?? req.get("host"));
    const { clientId } = await clienteOAuth();
    return res.redirect(302, urlAutorizacao(clientId, origem, assinarEstado(segredoEstado(), String(admin.id))));
  } catch (erro) {
    return voltar(res, "erro", erro instanceof Error ? erro.message : "Falha ao iniciar a conexão.");
  }
});

router.get("/google-drive/callback", async (req: Request, res: Response) => {
  try {
    const admin = await adminDaSessao(req);
    const estado = typeof req.query.state === "string" ? req.query.state : "";
    if (!admin || verificarEstado(segredoEstado(), estado) !== String(admin.id))
      return voltar(res, "erro", "A conexão expirou ou foi iniciada por outro usuário. Clique em Conectar de novo.");
    if (typeof req.query.error === "string")
      return voltar(res, "erro", req.query.error === "access_denied" ? "Você cancelou a autorização no Google." : `O Google recusou: ${req.query.error}`);
    const codigo = typeof req.query.code === "string" ? req.query.code : "";
    if (!codigo) return voltar(res, "erro", "O Google não devolveu o código de autorização.");
    const origem = origemDaRequisicao(req.get("x-forwarded-host") ?? req.get("host"));
    await concluirConexao(codigo, origem, admin.id);
    return voltar(res, "ok");
  } catch (erro) {
    // Só a explicação legível: nunca código, token ou segredo no log/URL.
    console.error("[google-drive] conexão falhou:", erro instanceof Error ? erro.message : "erro desconhecido");
    return voltar(res, "erro", erro instanceof Error && !/oauth|Google Drive falhou/i.test(erro.message) ? erro.message : descreverErroDrive(erro));
  }
});

export default router;
