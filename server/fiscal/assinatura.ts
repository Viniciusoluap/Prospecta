// EPIC-029 S-4 (22/11/2026) — assinatura XML-DSig ENVELOPADA (referência pelo Id do elemento) com o A1. xml-crypto (MIT).
// [OFICIAL, PESQUISA §3.3 — MANINT §6.1.4]: Reference URI="#Id"; transformações enveloped-signature + C14N inclusiva
// 20010315; CanonicalizationMethod igual; só o certificado final em X509Data. Algoritmo do manual: RSA-SHA1 + digest SHA-1
// (padrão aqui); RSA-SHA256 [NÃO CONFIRMADO no oficial] fica disponível para testar na homologação — ficar com o que passar.
// A assinatura entra logo DEPOIS do elemento assinado (infDPS), dentro da raiz (DPS). A mesma função assina o evento de
// cancelamento (elemento infPedReg, PESQUISA §1.5) quando ele existir.
// Nada é logado: nem o XML (tem dados do tomador), nem a chave.
import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";

export const ALGORITMOS = {
  /** [OFICIAL] o que o manual fixa. */
  sha1: { assinatura: "http://www.w3.org/2000/09/xmldsig#rsa-sha1", digest: "http://www.w3.org/2000/09/xmldsig#sha1" },
  /** [NÃO CONFIRMADO] aceitação pela Sefin — testar na produção restrita. */
  sha256: { assinatura: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256", digest: "http://www.w3.org/2001/04/xmlenc#sha256" },
} as const;
export type AlgoritmoAssinatura = keyof typeof ALGORITMOS;
export const ALGORITMO_PADRAO: AlgoritmoAssinatura = "sha1";
export const CANONICALIZACAO = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
export const TRANSFORMA_ENVELOPADA = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const NS_DSIG = "http://www.w3.org/2000/09/xmldsig#";

export class ErroAssinatura extends Error {
  constructor(message: string) { super(message); this.name = "ErroAssinatura"; }
}

const seletor = (elemento: string) => {
  if (!/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(elemento)) throw new ErroAssinatura("Elemento a assinar inválido.");
  return `//*[local-name(.)='${elemento}']`;
};

/** O elemento existe UMA vez e tem Id? (referência por Id, sem ambiguidade). */
function idDoElemento(xml: string, elemento: string): string {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const achados = Array.from(doc.getElementsByTagNameNS("*", elemento));
  if (achados.length !== 1) throw new ErroAssinatura(`O XML precisa ter exatamente um elemento ${elemento}.`);
  const id = achados[0]!.getAttribute("Id");
  if (!id || !/^[A-Za-z0-9]{1,60}$/.test(id)) throw new ErroAssinatura(`O elemento ${elemento} precisa de um atributo Id.`);
  if (doc.getElementsByTagNameNS(NS_DSIG, "Signature").length) throw new ErroAssinatura("O XML já está assinado.");
  return id;
}

/** Assina o elemento (padrão infDPS) e devolve o XML assinado. Credencial só em memória. */
export function assinarXml(xml: string, credencial: { certPem: string; chavePem: string }, elemento = "infDPS", algoritmo: AlgoritmoAssinatura = ALGORITMO_PADRAO): string {
  const id = idDoElemento(xml, elemento);
  const alg = ALGORITMOS[algoritmo];
  // Só o certificado FINAL (sem a cadeia) vai em X509Data (EndCertOnly).
  const finais = credencial.certPem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  if (finais.length !== 1) throw new ErroAssinatura("Informe só o certificado final para a assinatura.");
  const sig = new SignedXml({
    privateKey: credencial.chavePem,
    publicCert: finais[0],
    signatureAlgorithm: alg.assinatura,
    canonicalizationAlgorithm: CANONICALIZACAO,
  });
  sig.addReference({ xpath: seletor(elemento), digestAlgorithm: alg.digest, transforms: [TRANSFORMA_ENVELOPADA, CANONICALIZACAO] });
  try { sig.computeSignature(xml, { location: { reference: seletor(elemento), action: "after" } }); }
  catch { throw new ErroAssinatura("Não foi possível assinar o XML com o certificado."); }
  const assinado = sig.getSignedXml();
  if (!assinado.includes(`URI="#${id}"`)) throw new ErroAssinatura("A assinatura não referenciou o Id do elemento.");
  return assinado;
}

/**
 * Confere a assinatura com o certificado ESPERADO (nunca com o que vem dentro do XML) e que ela cobre o elemento pedido.
 */
export function verificarAssinaturaXml(xml: string, certPem: string, elemento = "infDPS"): boolean {
  try {
    const id = new DOMParser().parseFromString(xml, "text/xml").getElementsByTagNameNS("*", elemento)[0]?.getAttribute("Id");
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const assinaturas = doc.getElementsByTagNameNS(NS_DSIG, "Signature");
    if (assinaturas.length !== 1 || !id) return false;
    const sig = new SignedXml({ publicCert: certPem, getCertFromKeyInfo: () => null });
    sig.loadSignature(assinaturas[0]!.toString());
    if (!sig.checkSignature(xml)) return false;
    return sig.getReferences().length === 1 && sig.getReferences()[0]!.uri === `#${id}`;
  } catch { return false; }
}
