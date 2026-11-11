import { Router, Request, Response } from "express";
import { getTokenFromRequest, verifySessionToken } from "../_core/auth-utils.js";
import { getUserById } from "../db.js";
import { sessaoAindaValida } from "../../shared/session.js";
import { podeUsarModulo } from "../_core/rbac.js";
import { buscarCamadasTerreno, idsValidos, validarContorno } from "../_core/geo/camadas-terreno-busca.js";
import { tokenMapbox } from "../_core/geo/mapbox-config.js";

// Mapa do terreno da Incorporação (pedido de 11/11): as camadas ambientais e de
// restrição são buscadas AQUI, no servidor (cache, timeout e espelho por fonte),
// e o navegador pede uma camada por vez para cada item da legenda ter estado próprio.
// Gêmeo de Grupo-Santa-Fe/web/src/app/api/incorporacao/camadas-terreno/route.ts.

const router = Router();

async function usuarioDaIncorporacao(req: Request) {
  const token = getTokenFromRequest(req);
  const payload = token ? await verifySessionToken(token) : null;
  const usuario = payload ? await getUserById(payload.userId) : null;
  if (!usuario || !payload || !usuario.active || !sessaoAindaValida(usuario, payload.sessionVersion)) return null;
  return podeUsarModulo(usuario, "incorporacao") ? usuario : false;
}

router.post("/incorporacao/camadas-terreno", async (req: Request, res: Response) => {
  try {
    const u = await usuarioDaIncorporacao(req);
    if (u === null) return res.status(401).json({ error: "Entre novamente." });
    if (u === false) return res.status(403).json({ error: "Sem permissão para a Incorporação." });
    let contorno;
    try { contorno = validarContorno(req.body?.geojson); }
    catch (e) { return res.status(400).json({ error: e instanceof Error ? e.message : "Contorno inválido." }); }
    const resposta = await buscarCamadasTerreno(contorno, idsValidos(req.body?.ids), { fetchImpl: (...a) => fetch(...a) }, { ignorarCache: req.body?.novamente === true });
    return res.json(resposta);
  } catch (erro) {
    console.error("[camadas-terreno]", erro);
    return res.status(500).json({ error: "Falha ao buscar as camadas." });
  }
});

/** Configuração do mapa base: token público do Mapbox, se o admin tiver salvo um (opcional). */
router.get("/incorporacao/mapa-base", async (req: Request, res: Response) => {
  try {
    const u = await usuarioDaIncorporacao(req);
    if (u === null) return res.status(401).json({ error: "Entre novamente." });
    if (u === false) return res.status(403).json({ error: "Sem permissão para a Incorporação." });
    const t = await tokenMapbox().catch(() => null);
    return res.json({ mapboxToken: t?.token ?? null });
  } catch {
    return res.json({ mapboxToken: null });
  }
});

export default router;
