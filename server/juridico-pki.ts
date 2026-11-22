import { Certificate, CertificateChainValidationEngine, CertificateRevocationList, ContentInfo, SignedData, type DistributionPoint } from "pkijs";
import raizes from "./certificados/icp-raizes.json" with { type: "json" };
import { baixarMaterialPki } from "./juridico-pki-download.js";

export const raizesIcp = raizes.map(item => Certificate.fromBER(derPublico(Buffer.from(item.pem))));
export type ConsultaPki = { cadeia: "valida" | "pendente"; revogacao: "regular" | "revogado" | "pendente"; motivo: string; certificados: string[] };
type Baixar = (url: string, signal: AbortSignal) => Promise<Buffer>;

function derPublico(bytes: Buffer): ArrayBuffer {
  const texto = bytes.toString("ascii");
  return Uint8Array.from(texto.includes("-----BEGIN") ? Buffer.from(texto.replace(/-----[^-]+-----|\s/g, ""), "base64") : bytes).buffer;
}
function id(cert: Certificate) { return Buffer.from(cert.toSchema().toBER(false)).toString("base64"); }
function emissores(cert: Certificate): string[] {
  const aia = cert.extensions?.find(ext => ext.extnID === "1.3.6.1.5.5.7.1.1")?.parsedValue;
  return (aia?.accessDescriptions || []).filter((item: { accessMethod: string; accessLocation: { type: number } }) => item.accessMethod === "1.3.6.1.5.5.7.48.2" && item.accessLocation.type === 6).map((item: { accessLocation: { value: string } }) => item.accessLocation.value).slice(0, 2);
}
function certificadosPublicos(bytes: Buffer): Certificate[] {
  try { return [Certificate.fromBER(derPublico(bytes))]; }
  catch {
    const cms = ContentInfo.fromBER(derPublico(bytes));
    if (cms.contentType !== "1.2.840.113549.1.7.2") return [];
    return new SignedData({ schema: cms.content }).certificates?.filter((cert): cert is Certificate => cert instanceof Certificate) || [];
  }
}

export async function montarCadeia(cert: Certificate, fornecidos: Certificate[], roots = raizesIcp, baixar: Baixar = baixarMaterialPki, signal = AbortSignal.timeout(18000)) {
  const encontrados = new Map(fornecidos.map(item => [id(item), item]));
  let atual = cert;
  for (let nivel = 0; nivel < 8; nivel++) {
    if (roots.some(root => id(root) === id(atual))) break;
    let issuer: Certificate | undefined;
    for (const candidato of [...encontrados.values(), ...roots]) {
      if (id(candidato) !== id(atual) && atual.issuer.isEqual(candidato.subject) && await atual.verify(candidato).catch(() => false)) { issuer = candidato; break; }
    }
    if (!issuer) {
      for (const url of emissores(atual)) {
        try {
          for (const candidato of certificadosPublicos(await baixar(url, signal))) {
            if (atual.issuer.isEqual(candidato.subject) && await atual.verify(candidato)) { issuer = candidato; encontrados.set(id(candidato), candidato); break; }
          }
        } catch { /* A próxima URL pode estar disponível. */ }
        if (issuer) break;
      }
    }
    if (!issuer) break;
    atual = issuer;
  }
  // A folha fica por último conforme a entrada esperada pelo PKIjs.
  const engine = new CertificateChainValidationEngine({ trustedCerts: roots, certs: [...encontrados.values()].filter(c => id(c) !== id(cert)).concat(cert) });
  const resultado = await engine.verify({ passedWhenNotRevValues: true });
  return { valido: resultado.result, caminho: resultado.certificatePath || [], certificados: [...encontrados.values()].filter(c => id(c) !== id(cert)).map(id) };
}

function urlsLcr(ponto: DistributionPoint): string[] {
  if (ponto.reasons || ponto.cRLIssuer || !Array.isArray(ponto.distributionPoint)) return [];
  return ponto.distributionPoint.filter(item => item.type === 6).map(item => String(item.value)).slice(0, 2);
}

/** Consulta atual de revogação. Uma LCR parcial, vencida ou sem assinatura confiável deixa a análise pendente. */
export async function conferirRevogacao(cert: Certificate, issuer: Certificate, baixar: Baixar, signal: AbortSignal): Promise<ConsultaPki["revogacao"]> {
  const pontos: DistributionPoint[] = cert.extensions?.find(ext => ext.extnID === "2.5.29.31")?.parsedValue?.distributionPoints || [];
  for (const ponto of pontos.slice(0, 3)) {
    for (const url of urlsLcr(ponto)) {
      try {
        const crl = CertificateRevocationList.fromBER(derPublico(await baixar(url, signal)));
        if (!crl.issuer.isEqual(issuer.subject) || !await crl.verify({ issuerCertificate: issuer })) continue;
        if (crl.thisUpdate.value > new Date() || !crl.nextUpdate || crl.nextUpdate.value <= new Date()) continue;
        // LCR delta/indireta ou limitada a motivos/tipos de certificado exige um validador específico.
        if (crl.crlExtensions?.extensions.some(ext => ext.extnID === "2.5.29.27" || ext.critical && ext.extnID !== "2.5.29.28")) continue;
        const scope = crl.crlExtensions?.extensions.find(ext => ext.extnID === "2.5.29.28")?.parsedValue;
        if (scope && (scope.indirectCRL || scope.onlyContainsUserCerts || scope.onlyContainsCACerts || scope.onlyContainsAttributeCerts || scope.onlySomeReasons || scope.distributionPoint && (!Array.isArray(scope.distributionPoint) || !scope.distributionPoint.some((item: { type: number; value: string }) => item.type === 6 && urlsLcr(ponto).includes(item.value))))) continue;
        return crl.isCertificateRevoked(cert) ? "revogado" : "regular";
      } catch { /* Falha de consulta não confirma revogação nem regularidade. */ }
    }
  }
  return "pendente";
}

export async function validarCertificado(cert: Certificate, fornecidos: Certificate[], roots = raizesIcp, baixar: Baixar = baixarMaterialPki, signal = AbortSignal.timeout(18000)): Promise<ConsultaPki> {
  const cadeia = await montarCadeia(cert, fornecidos, roots, baixar, signal);
  const pendente: ConsultaPki = { cadeia: cadeia.valido ? "valida" : "pendente", revogacao: "pendente", motivo: "A consulta à cadeia ou à revogação ficou pendente. O sistema tentará novamente.", certificados: cadeia.certificados };
  if (!cadeia.valido || !cadeia.caminho.length) return pendente;
  // A cadeia devolvida começa pela folha e termina na raiz de confiança.
  const estados = await Promise.all(cadeia.caminho.slice(0, -1).map((item, i) => conferirRevogacao(item, cadeia.caminho[i + 1], baixar, signal)));
  if (estados.includes("revogado")) return { ...pendente, revogacao: "revogado", motivo: "Há certificado revogado na cadeia de assinatura." };
  if (estados.includes("pendente")) return pendente;
  return { ...pendente, revogacao: "regular", motivo: "Cadeia ICP-Brasil e revogação conferidas automaticamente." };
}
