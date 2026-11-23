// EPIC-029 S-7 (22/11/2026) — leitura (pura) do que a Sefin Nacional devolve: emissão, consulta da DPS, eventos e erros.
// Nomes dos campos JSON: [TERCEIROS] (nfelib e nfse-php, iguais — sefin.ts#CAMPOS_JSON), [NÃO CONFIRMADO no Swagger]: a leitura
// aceita maiúsculas/minúsculas e, se não achar o campo, trata a resposta como INCERTA (a emissão consulta a DPS antes de
// qualquer reenvio — nunca presume sucesso nem rejeição).
// Erros: só os CÓDIGOS da Sefin (E0000) saem daqui; a frase mostrada é fixa (FRASES_ERRO), nunca o texto cru do serviço.
import { DOMParser } from "@xmldom/xmldom";
import { PADRAO_CHAVE_NFSE } from "../../shared/fiscal/dps-campos.js";
import { CAMPOS_JSON, descompactarXml } from "./sefin.js";

export const TAMANHO_MAXIMO_XML_RETORNO = 2 * 1024 * 1024;

function json(corpo: string): unknown {
  try { return JSON.parse(corpo); } catch { return null; }
}

/** Primeiro valor de texto com a chave pedida (sem diferenciar maiúsculas), em qualquer nível do JSON. */
export function campoJson(obj: unknown, nome: string, profundidade = 0): string | null {
  if (!obj || typeof obj !== "object" || profundidade > 5) return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k.toLowerCase() === nome.toLowerCase() && (typeof v === "string" || typeof v === "number")) return String(v);
  }
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const achado = campoJson(v, nome, profundidade + 1);
    if (achado != null) return achado;
  }
  return null;
}

/** Códigos de erro/alerta da Sefin (E0000, A0000…) em qualquer parte da resposta. Nada além do código. */
export function codigosDaResposta(corpo: string): string[] {
  const achados = new Set<string>();
  const visitar = (o: unknown, nivel: number) => {
    if (!o || typeof o !== "object" || nivel > 6) return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (/^c(o|ó)digo$/i.test(k) && typeof v === "string" && /^[EA]\d{3,4}$/.test(v.trim())) achados.add(v.trim());
      else if (typeof v === "object") visitar(v, nivel + 1);
    }
  };
  visitar(json(corpo), 0);
  if (!achados.size) for (const m of Array.from(corpo.slice(0, 20_000).matchAll(/\b(E\d{4})\b/g))) achados.add(m[1]!);
  return Array.from(achados).slice(0, 10);
}

/**
 * Frases fixas para os códigos conhecidos (PESQUISA §3.3, §4, §5 e Anexo I). Código fora da lista → frase genérica com o
 * código. Nunca o texto do serviço (pode repetir dado da nota).
 */
export const FRASES_ERRO: Record<string, string> = {
  E0010: "A série da DPS está fora da faixa do aplicativo próprio (1 a 49999). Corrija a série da empresa emissora.",
  E0120: "A inscrição municipal informada não está cadastrada na prefeitura. Confira a inscrição municipal da empresa emissora.",
  E0714: "A assinatura digital da nota foi recusada. Envie o certificado A1 de novo e tente outra vez.",
  E0715: "O certificado da assinatura foi recusado pela Sefin (inválido). Envie um certificado A1 válido.",
  E0716: "O certificado da assinatura foi recusado pela Sefin (inválido). Envie um certificado A1 válido.",
  E0717: "A nota chegou sem assinatura digital. Nada foi emitido; tente de novo.",
  E0718: "A assinatura não é da empresa emissora da nota. Use o A1 do próprio CNPJ emissor.",
  E0822: "A prefeitura não aceita mais o cancelamento desta nota (fora do prazo). O caminho é pedir análise fiscal à prefeitura.",
  E0823: "A prefeitura não permite cancelar notas deste valor pelo sistema. Fale com a prefeitura.",
  E0824: "A prefeitura não permite cancelar nota sem tomador identificado.",
  E0827: "A nota já teve o imposto recolhido e a prefeitura não permite cancelá-la pelo sistema.",
  E0855: "A Sefin exige a classificação do IBS/CBS para esta competência. Peça ao contador o CST e a classificação tributária.",
  E0860: "A classificação tributária escolhida exige o código do indicador da operação (cIndOp). Peça ao contador.",
  E0960: "A classificação tributária escolhida exige o grupo de IBS/CBS completo. Peça ao contador.",
  E1000: "A calculadora oficial do IBS/CBS recusou os dados. Confira a classificação tributária com o contador.",
  E1206: "A lista de certificados revogados (LCR) do seu certificado não pôde ser consultada pela Sefin. Tente mais tarde.",
  E1228: "O documento foi enviado fora do formato (prefixo de namespace). Nada foi emitido.",
  E1229: "O documento foi enviado fora do formato (codificação). Nada foi emitido.",
};

export function fraseDosCodigos(codigos: string[], contexto: "emissao" | "cancelamento"): string {
  const conhecido = codigos.find(c => FRASES_ERRO[c]);
  if (conhecido) return `${FRASES_ERRO[conhecido]} (código ${codigos.join(", ")})`;
  const oQue = contexto === "emissao" ? "a nota" : "o cancelamento";
  return codigos.length
    ? `A Sefin recusou ${oQue} (código ${codigos.join(", ")}). Confira os dados e o cadastro e tente de novo.`
    : `A Sefin recusou ${oQue} sem informar o código. Confira os dados e tente de novo.`;
}

function xmlSeguro(xml: string): Document | null {
  if (!xml || xml.length > TAMANHO_MAXIMO_XML_RETORNO || /<!DOCTYPE|<!ENTITY/i.test(xml)) return null;
  try {
    let falhou = false;
    const doc = new DOMParser({ onError: () => { falhou = true; } }).parseFromString(xml, "text/xml");
    return falhou || !doc.documentElement ? null : (doc as unknown as Document);
  } catch { return null; }
}

const texto = (raiz: Element | Document | null | undefined, ...caminho: string[]): string | null => {
  let atual: Element | Document | null | undefined = raiz;
  for (const nome of caminho) {
    if (!atual) return null;
    const filhos: Element[] = Array.from((atual as Element).childNodes ?? []).filter((n): n is Element => n.nodeType === 1);
    atual = filhos.find(f => f.localName === nome) ?? null;
  }
  const t = (atual as Element | null)?.textContent?.trim();
  return t ? t : null;
};

export type Pessoa = { documento: string | null; nome: string | null; im: string | null; municipio: string | null; uf: string | null; cep: string | null; endereco: string | null; fone: string | null; email: string | null };

/** O que o DANFSe e a gravação precisam do XML AUTORIZADO da NFS-e. */
export type NfseLida = {
  chave: string; numero: string; nDFSe: string | null; dhProc: string | null; ambGer: string | null; cStat: string | null;
  tpAmb: string | null; xLocEmi: string | null; xLocPrestacao: string | null; xLocIncid: string | null; xTribNac: string | null; xNBS: string | null;
  dps: { id: string | null; serie: string | null; nDPS: string | null; dhEmi: string | null; dCompet: string | null; tpEmit: string | null; finNFSe: string | null };
  emitente: Pessoa; tomador: Pessoa | null;
  servico: { cTribNac: string | null; cNBS: string | null; descricao: string | null; cLocPrestacao: string | null; cObra: string | null };
  valores: { vServ: string | null; vDescIncond: string | null; vDescCond: string | null; vBC: string | null; pAliqAplic: string | null; vISSQN: string | null; vTotalRet: string | null; vLiq: string | null;
    tribISSQN: string | null; tpRetISSQN: string | null; vIBS: string | null; vCBS: string | null; vTotNF: string | null };
  xOutInf: string | null;
};

function pessoa(el: Element | null, endereco: "enderNac" | "end"): Pessoa | null {
  if (!el) return null;
  const end = Array.from(el.childNodes).find((n): n is Element => n.nodeType === 1 && (n as Element).localName === endereco) ?? null;
  const nac = end && endereco === "end" ? Array.from(end.childNodes).find((n): n is Element => n.nodeType === 1 && (n as Element).localName === "endNac") ?? null : end;
  const partes = [texto(end, "xLgr"), texto(end, "nro"), texto(end, "xCpl"), texto(end, "xBairro")].filter(Boolean);
  return {
    documento: texto(el, "CNPJ") ?? texto(el, "CPF") ?? texto(el, "NIF"), nome: texto(el, "xNome"), im: texto(el, "IM"),
    municipio: texto(nac, "cMun"), uf: texto(nac, "UF"), cep: texto(nac, "CEP"), endereco: partes.length ? partes.join(", ") : null,
    fone: texto(el, "fone"), email: texto(el, "email"),
  };
}

const filho = (el: Element | null | undefined, nome: string): Element | null =>
  el ? Array.from(el.childNodes).find((n): n is Element => n.nodeType === 1 && (n as Element).localName === nome) ?? null : null;
const neto = (el: Element | null | undefined, ...nomes: string[]): Element | null => nomes.reduce<Element | null>((a, n) => filho(a, n), el ?? null);

/** Lê o XML da NFS-e autorizada. XML ilegível, com DOCTYPE ou sem chave válida → null (nunca grava o que não leu). */
export function lerNfse(xml: string): NfseLida | null {
  const doc = xmlSeguro(xml);
  if (!doc) return null;
  const raiz = doc.documentElement;
  if (raiz.localName !== "NFSe") return null;
  const inf = filho(raiz, "infNFSe");
  const id = inf?.getAttribute("Id") ?? "";
  const chave = id.startsWith("NFS") ? id.slice(3) : "";
  const numero = texto(inf, "nNFSe");
  if (!inf || !PADRAO_CHAVE_NFSE.test(chave) || !numero) return null;
  const infDps = neto(inf, "DPS", "infDPS");
  const val = filho(inf, "valores");
  const valDps = filho(infDps, "valores");
  const tribMun = neto(valDps, "trib", "tribMun");
  return {
    chave, numero, nDFSe: texto(inf, "nDFSe"), dhProc: texto(inf, "dhProc"), ambGer: texto(inf, "ambGer"), cStat: texto(inf, "cStat"),
    tpAmb: texto(infDps, "tpAmb"), xLocEmi: texto(inf, "xLocEmi"), xLocPrestacao: texto(inf, "xLocPrestacao"), xLocIncid: texto(inf, "xLocIncid"),
    xTribNac: texto(inf, "xTribNac"), xNBS: texto(inf, "xNBS"),
    dps: { id: infDps?.getAttribute("Id") ?? null, serie: texto(infDps, "serie"), nDPS: texto(infDps, "nDPS"), dhEmi: texto(infDps, "dhEmi"),
      dCompet: texto(infDps, "dCompet"), tpEmit: texto(infDps, "tpEmit"), finNFSe: texto(infDps, "finNFSe") ?? texto(infDps, "IBSCBS", "finNFSe") },
    emitente: pessoa(filho(inf, "emit"), "enderNac")!,
    tomador: pessoa(filho(infDps, "toma"), "end"),
    servico: { cTribNac: texto(infDps, "serv", "cServ", "cTribNac"), cNBS: texto(infDps, "serv", "cServ", "cNBS"), descricao: texto(infDps, "serv", "cServ", "xDescServ"),
      cLocPrestacao: texto(infDps, "serv", "locPrest", "cLocPrestacao"), cObra: texto(infDps, "serv", "obra", "cObra") },
    valores: { vServ: texto(valDps, "vServPrest", "vServ"), vDescIncond: texto(valDps, "vDescCondIncond", "vDescIncond"), vDescCond: texto(valDps, "vDescCondIncond", "vDescCond"),
      vBC: texto(val, "vBC"), pAliqAplic: texto(val, "pAliqAplic"), vISSQN: texto(val, "vISSQN"), vTotalRet: texto(val, "vTotalRet"), vLiq: texto(val, "vLiq"),
      tribISSQN: texto(tribMun, "tribISSQN"), tpRetISSQN: texto(tribMun, "tpRetISSQN"),
      vIBS: texto(inf, "IBSCBS", "totCIBS", "gIBS", "vIBSTot"), vCBS: texto(inf, "IBSCBS", "totCIBS", "gCBS", "vCBS"),
      vTotNF: texto(inf, "IBSCBS", "totCIBS", "vTotNF") },
    xOutInf: texto(inf, "xOutInf"),
  };
}

export type RetornoEmissao =
  | { tipo: "autorizada"; chave: string; xml: string; nfse: NfseLida; protocolo: string | null }
  | { tipo: "rejeitada"; codigos: string[] }
  | { tipo: "incerta"; motivo: string };

/** O que a NFS-e devolvida tem de confirmar além do Id da DPS: o ambiente (tpAmb) e o CNPJ do emitente (o emissor). */
export type EsperadoNfse = { ambiente: "producao_restrita" | "producao"; cnpj: string };
const TP_AMB: Record<EsperadoNfse["ambiente"], string> = { producao: "1", producao_restrita: "2" };
const soDocumento = (d: string | null | undefined) => (d ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

/**
 * Resposta do POST /nfse. 2xx sem campo legível → INCERTA (consultar a DPS); 4xx → rejeitada; 5xx → incerta.
 * QA S-7 (B2): 408 (tempo esgotado no servidor) e 429 (limite de requisições) NÃO dizem que a DPS foi recusada — são INCERTAS
 * (a próxima tentativa consulta antes de reenviar), nunca "rejeitada".
 */
export function lerRetornoEmissao(status: number, corpo: string, dpsIdEsperado: string, esperado?: EsperadoNfse): RetornoEmissao {
  if (status >= 500 || status === 0 || status === 408 || status === 429) return { tipo: "incerta", motivo: `HTTP ${status}` };
  if (status >= 400) return { tipo: "rejeitada", codigos: codigosDaResposta(corpo) };
  if (status < 200 || status >= 300) return { tipo: "incerta", motivo: `HTTP ${status}` };
  const o = json(corpo);
  const b64 = campoJson(o, CAMPOS_JSON.nfse);
  if (!b64) return { tipo: "incerta", motivo: "resposta sem o XML da NFS-e" };
  let xml: string;
  try { xml = descompactarXml(b64); } catch { return { tipo: "incerta", motivo: "XML da NFS-e ilegível" }; }
  return conferirNfse(xml, dpsIdEsperado, campoJson(o, CAMPOS_JSON.chave), campoJson(o, "protocolo"), esperado);
}

/**
 * Confere o XML autorizado contra a DPS enviada e a chave informada; protocolo = o do JSON ou o nDFSe do XML.
 * QA S-7 (M2): só é "autorizada" com PROVA POSITIVA — o grupo DPS/infDPS presente com o MESMO Id, o tpAmb do ambiente da emissão
 * e o CNPJ do emitente igual ao do emissor. Faltou qualquer um (ou `esperado` não veio) → INCERTA (consultar antes), nunca autorizada.
 */
export function conferirNfse(xml: string, dpsIdEsperado: string, chaveInformada: string | null, protocolo: string | null, esperado?: EsperadoNfse): RetornoEmissao {
  const nfse = lerNfse(xml);
  if (!nfse) return { tipo: "incerta", motivo: "XML da NFS-e ilegível" };
  if (!nfse.dps.id) return { tipo: "incerta", motivo: "a NFS-e devolvida não traz a DPS" };
  if (nfse.dps.id !== dpsIdEsperado) return { tipo: "incerta", motivo: "a NFS-e devolvida não é desta DPS" };
  if (!esperado) return { tipo: "incerta", motivo: "ambiente e emitente esperados não informados" };
  if (nfse.tpAmb !== TP_AMB[esperado.ambiente]) return { tipo: "incerta", motivo: "a NFS-e devolvida é de outro ambiente" };
  if (!soDocumento(esperado.cnpj) || soDocumento(nfse.emitente?.documento) !== soDocumento(esperado.cnpj)) return { tipo: "incerta", motivo: "a NFS-e devolvida é de outro emitente" };
  if (chaveInformada && chaveInformada !== nfse.chave) return { tipo: "incerta", motivo: "chave diferente da do XML" };
  const prot = (protocolo ?? nfse.nDFSe ?? "").replace(/[^0-9A-Za-z\-]/g, "").slice(0, 60) || null;
  return { tipo: "autorizada", chave: nfse.chave, xml, nfse, protocolo: prot };
}

/** GET /dps/{id}: a chave da NFS-e gerada, se houver. 404 → não gerou; outro → incerto. */
export function lerConsultaDps(status: number, corpo: string): { tipo: "gerada"; chave: string } | { tipo: "nao_gerada" } | { tipo: "incerta" } {
  if (status === 404) return { tipo: "nao_gerada" };
  if (status < 200 || status >= 300) return { tipo: "incerta" };
  const chave = campoJson(json(corpo), CAMPOS_JSON.chave);
  return chave && PADRAO_CHAVE_NFSE.test(chave) ? { tipo: "gerada", chave } : { tipo: "incerta" };
}

/** GET /nfse/{chave}: o XML autorizado. */
export function lerConsultaNfse(status: number, corpo: string): string | null {
  if (status < 200 || status >= 300) return null;
  const b64 = campoJson(json(corpo), CAMPOS_JSON.nfse);
  if (!b64) return null;
  try { return descompactarXml(b64); } catch { return null; }
}

export type RetornoEvento = { tipo: "registrado"; xml: string; protocolo: string | null } | { tipo: "rejeitado"; codigos: string[] } | { tipo: "incerto"; motivo: string };

/** POST /nfse/{chave}/eventos. O evento registrado tem de citar a chave e o código 101101. */
export function lerRetornoEvento(status: number, corpo: string, chave: string): RetornoEvento {
  if (status >= 500 || status === 0 || status === 408 || status === 429) return { tipo: "incerto", motivo: `HTTP ${status}` };
  if (status >= 400) return { tipo: "rejeitado", codigos: codigosDaResposta(corpo) };
  const b64 = campoJson(json(corpo), CAMPOS_JSON.evento);
  if (!b64) return { tipo: "incerto", motivo: "resposta sem o XML do evento" };
  let xml: string;
  try { xml = descompactarXml(b64); } catch { return { tipo: "incerto", motivo: "XML do evento ilegível" }; }
  const doc = xmlSeguro(xml);
  if (!doc || !xml.includes(chave) || !/e101101/.test(xml)) return { tipo: "incerto", motivo: "evento devolvido não confere" };
  const nDFSe = Array.from(doc.getElementsByTagNameNS("*", "nDFSe"))[0]?.textContent?.trim() ?? null;
  return { tipo: "registrado", xml, protocolo: nDFSe ? nDFSe.replace(/[^0-9A-Za-z\-]/g, "").slice(0, 60) : null };
}
