import { Router, Request, Response } from "express";
import { getAllImoveis } from "../db.js";
import {
  gerarFeedZap,
  gerarFeedOlx,
  gerarFeedVivaReal,
  gerarFeedChavesNaMao,
  XML_HEADERS,
} from "../_core/imovel-feeds.js";

const router = Router();

function siteUrlFromRequest(req: Request): string {
  return `${req.protocol}://${req.get("host")}`;
}

router.get("/feed/zap", async (req: Request, res: Response) => {
  const imoveis = await getAllImoveis({ publicadoOnly: true });
  const zapOnly = imoveis.filter((i) => i.publicadoZap);
  res.set(XML_HEADERS).send(gerarFeedZap(zapOnly, siteUrlFromRequest(req)));
});

router.get("/feed/olx", async (req: Request, res: Response) => {
  const imoveis = await getAllImoveis({ publicadoOnly: true });
  const olxOnly = imoveis.filter((i) => i.publicadoOlx);
  res.set(XML_HEADERS).send(gerarFeedOlx(olxOnly, siteUrlFromRequest(req)));
});

router.get("/feed/vivareal", async (req: Request, res: Response) => {
  const imoveis = await getAllImoveis({ publicadoOnly: true });
  const vivaOnly = imoveis.filter((i) => i.publicadoViva);
  res.set(XML_HEADERS).send(gerarFeedVivaReal(vivaOnly, siteUrlFromRequest(req)));
});

router.get("/feed/chavesnamao", async (req: Request, res: Response) => {
  const imoveis = await getAllImoveis({ publicadoOnly: true });
  const cnmOnly = imoveis.filter((i) => i.publicadoChavesNaMao);
  res.set(XML_HEADERS).send(gerarFeedChavesNaMao(cnmOnly, siteUrlFromRequest(req)));
});

export default router;
