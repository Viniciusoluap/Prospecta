// Jurídico — cadeia ICP-Brasil e revogação (LCR) dos certificados que assinaram um PDF (22/11/2026).
//
// Regra principal: dado incompleto NUNCA vira verde. Cada certificado termina em um de três estados:
//   - "valida"   → cadeia até uma raiz oficial ICP-Brasil (server/certificados/icp-raizes.json) conferida pelo PKIjs 3.4.0
//                  e por estas regras extras, e LCR atual, assinada pelo emissor, sem o certificado;
//   - "pendente" → faltou informação (certificadora fora do ar, prazo, LCR vencida/adulterada/de outro emissor, escopo não
//                  suportado). `transitoria` diz se vale tentar de novo depois;
//   - "invalida" → a cadeia não chega a uma raiz ICP-Brasil, viola uma regra (vencido, CA sem permissão, extensão crítica
//                  desconhecida, limite de caminho) ou o certificado consta como revogado.
// É uma conferência técnica do próprio sistema, na data da consulta: não é o relatório oficial do VALIDAR/ITI e não é
// validação histórica com carimbo de tempo.
import { createHash } from "node:crypto";
import { Certificate, CertificateChainValidationEngine, CertificateRevocationList, ContentInfo, SignedData, type DistributionPoint } from "pkijs";
import raizes from "./certificados/icp-raizes.json" with { type: "json" };
import { ErroRedePki, EnderecoRecusadoPki, SessaoPki } from "./juridico-pki-download.js";

export type EstadoPki = "valida" | "pendente" | "invalida";
export type EstadoRevogacao = "regular" | "revogado" | "pendente";
export type ConsultaPki = {
  cadeia: EstadoPki; revogacao: EstadoRevogacao; estado: EstadoPki; transitoria: boolean; motivo: string;
  /** Intermediários (DER em base64) encontrados, sem a folha e sem a raiz. */
  certificados: string[];
};
export type Baixador = Pick<SessaoPki, "baixar">;

export function derDe(texto: Buffer | Uint8Array): ArrayBuffer {
  const bytes = Buffer.from(texto);
  const ascii = bytes.subarray(0, 64).toString("latin1");
  const der = ascii.includes("-----BEGIN") ? Buffer.from(bytes.toString("latin1").replace(/-----[^-]+-----|\s/g, ""), "base64") : bytes;
  return Uint8Array.from(der).buffer;
}
export const raizesIcp: Certificate[] = raizes.map(item => Certificate.fromBER(derDe(Buffer.from(item.pem))));
/** Impressões das raízes OFICIAIS (fixadas no carregamento): só nelas se exige política de assinatura ICP-Brasil. */
const OFICIAIS = new Set(raizesIcp.map(c => createHash("sha256").update(Buffer.from(c.toSchema().toBER(false))).digest("hex")));

export function derCertificado(cert: Certificate): Buffer { return Buffer.from(cert.toSchema().toBER(false)); }
const idCert = (cert: Certificate) => createHash("sha256").update(derCertificado(cert)).digest("hex");
const mesmo = (a: Certificate, b: Certificate) => idCert(a) === idCert(b);
const ehRaiz = (cert: Certificate, roots: Certificate[]) => roots.some(r => mesmo(r, cert));

const OID = {
  keyUsage: "2.5.29.15", basicConstraints: "2.5.29.19", aia: "1.3.6.1.5.5.7.1.1", caIssuers: "1.3.6.1.5.5.7.48.2",
  crlDp: "2.5.29.31", crlNumber: "2.5.29.20", deltaCrl: "2.5.29.27", idp: "2.5.29.28", aki: "2.5.29.35",
  reasonCode: "2.5.29.21", invalidityDate: "2.5.29.24", freshestCrl: "2.5.29.46",
};
/** Extensões críticas que esta conferência sabe tratar (o PKIjs ou as regras abaixo as aplicam). */
const CRITICAS_CONHECIDAS = new Set([
  OID.keyUsage, OID.basicConstraints, "2.5.29.32" /* políticas */, "2.5.29.17" /* SAN */, "2.5.29.37" /* EKU */,
  "2.5.29.30" /* name constraints */, "2.5.29.36" /* policy constraints */, "2.5.29.33" /* policy mappings */,
  "2.5.29.54" /* inhibit anyPolicy */, "2.5.29.14" /* SKI */, OID.aki, OID.crlDp,
]);

function extensao(cert: Certificate, oid: string) { return cert.extensions?.find(ext => ext.extnID === oid); }
/** Bits do keyUsage (primeiro byte): 0x80 digitalSignature, 0x40 nonRepudiation, 0x04 keyCertSign, 0x02 cRLSign. */
function usoDaChave(cert: Certificate): number | null {
  const ext = extensao(cert, OID.keyUsage);
  if (!ext) return null;
  const view = new Uint8Array(ext.parsedValue?.valueBlock?.valueHexView ?? ext.parsedValue?.valueBlock?.valueHex ?? []);
  return view[0] ?? 0;
}
export function urlsEmissor(cert: Certificate): string[] {
  const aia = extensao(cert, OID.aia)?.parsedValue;
  return (aia?.accessDescriptions || [])
    .filter((item: { accessMethod: string; accessLocation: { type: number } }) => item.accessMethod === OID.caIssuers && item.accessLocation.type === 6)
    .map((item: { accessLocation: { value: string } }) => String(item.accessLocation.value)).slice(0, 2);
}
/** Lê certificado DER/PEM ou "certs-only" PKCS#7 (formato comum do AIA). Nunca lança. */
export function certificadosPublicos(bytes: Buffer): Certificate[] {
  try { return [Certificate.fromBER(derDe(bytes))]; } catch { /* tenta PKCS#7 */ }
  try {
    const cms = ContentInfo.fromBER(derDe(bytes));
    if (cms.contentType !== "1.2.840.113549.1.7.2") return [];
    return (new SignedData({ schema: cms.content }).certificates || []).filter((c): c is Certificate => c instanceof Certificate).slice(0, 10);
  } catch { return []; }
}
/** Algoritmo/curva que o WebCrypto do servidor não confere (ex.: ECDSA secp256k1): não é prova de assinatura inválida. */
export function algoritmoNaoSuportado(e: unknown): boolean {
  const erro = e as { name?: string; message?: string } | null;
  return erro?.name === "NotSupportedError" || /not ?supported|unsupported|unrecognized|unknown (?:algorithm|curve|named curve)|namedCurve/i.test(erro?.message || "");
}
class NaoSuportado extends Error {}
async function assinadoPor(cert: Certificate, emissor: Certificate): Promise<boolean> {
  if (!cert.issuer.isEqual(emissor.subject)) return false;
  try { return await cert.verify(emissor); } catch (e) { if (algoritmoNaoSuportado(e)) throw new NaoSuportado(); return false; }
}
const organizacoes = (nome: Certificate["subject"]) => nome.typesAndValues.filter(t => t.type === "2.5.4.10").map(t => String(t.value.valueBlock.value).trim().toUpperCase());
/**
 * Só segue o AIA quando o emissor declarado pertence à mesma hierarquia das raízes confiáveis (O= de alguma raiz; nas
 * oficiais, "ICP-Brasil"). Reduz o uso do servidor para buscar endereços de certificados fabricados por quem envia o PDF.
 */
function emissorDaHierarquia(cert: Certificate, roots: Certificate[]) {
  const permitidas = new Set(roots.flatMap(r => organizacoes(r.subject)));
  return organizacoes(cert.issuer).some(o => permitidas.has(o));
}

const OID_EKU = { email: "1.3.6.1.5.5.7.3.4", qualquer: "2.5.29.37.0", adobe: "1.2.840.113583.1.1.5", msDocumento: "1.3.6.1.4.1.311.10.3.12" };
/** EKU da folha: ausente, proteção de e-mail (padrão ICP-Brasil A1/A3), "qualquer" ou assinatura de documento. */
export function ekuPermiteAssinatura(cert: Certificate): boolean {
  const ext = cert.extensions?.find(e => e.extnID === "2.5.29.37");
  if (!ext) return true;
  const usos: string[] = ext.parsedValue?.keyPurposes || [];
  return usos.some(u => Object.values(OID_EKU).includes(u));
}
/** Políticas de certificado de ASSINATURA da ICP-Brasil (A1 a A4: 2.16.76.1.2.1–4.*). Sigilo (S) e tempo (T) não assinam. */
export function politicaAssinaturaIcp(cert: Certificate): boolean {
  const politicas: { policyIdentifier: string }[] = cert.extensions?.find(e => e.extnID === "2.5.29.32")?.parsedValue?.certificatePolicies || [];
  return politicas.some(p => /^2\.16\.76\.1\.2\.[1-4]\./.test(p.policyIdentifier));
}
/**
 * CPF/CNPJ do titular: primeiro o SAN otherName da ICP-Brasil (2.16.76.1.3.3 = CNPJ; 2.16.76.1.3.1 = data de nascimento
 * + CPF), depois o sufixo ":documento" do nome comum. Se os dois existirem e divergirem, não identifica ninguém.
 */
export function documentoDoCertificado(cert: Certificate): string {
  const cn = cert.subject.typesAndValues.filter(t => t.type === "2.5.4.3").map(t => String(t.value.valueBlock.value)).join(" ");
  const doCn = /(?:^|:)\s*(\d{14}|\d{11})\s*$/.exec(cn)?.[1] || "";
  const cnpjs = new Set<string>(), cpfs = new Set<string>();
  try {
    const nomes: { type: number; value: { valueBlock?: { value?: unknown[] } } }[] = cert.extensions?.find(e => e.extnID === "2.5.29.17")?.parsedValue?.altNames || [];
    for (const nome of nomes) {
      if (nome.type !== 0) continue;
      const partes = (nome.value?.valueBlock?.value || []) as { valueBlock?: { toString?: () => string; value?: unknown[] } }[];
      const oid = partes[0]?.valueBlock?.toString?.() || "";
      const conteudo = ((partes[1]?.valueBlock?.value || [])[0] as { valueBlock?: { value?: string; valueHexView?: Uint8Array } } | undefined)?.valueBlock;
      const texto = typeof conteudo?.value === "string" ? conteudo.value : conteudo?.valueHexView ? Buffer.from(conteudo.valueHexView).toString("latin1") : "";
      if (oid === "2.16.76.1.3.3" && /^\d{14}$/.test(texto.trim())) cnpjs.add(texto.trim());
      if (oid === "2.16.76.1.3.1" && /^\d{19}/.test(texto.trim())) cpfs.add(texto.trim().slice(8, 19));
    }
  } catch { /* SAN ilegível: usa só o nome comum */ }
  // Um e-CNPJ também contém o CPF do responsável. A identidade da empresa prevalece, em qualquer ordem do SAN.
  const documentos = cnpjs.size ? cnpjs : cpfs;
  if (documentos.size > 1) return "";
  const doSan = Array.from(documentos)[0] || "";
  if (doSan && doCn && doSan !== doCn) return "";
  return doSan || doCn;
}

type Cadeia = { estado: EstadoPki; transitoria: boolean; motivo: string; caminho: Certificate[]; intermediarios: Certificate[] };

/** Regras que o PKIjs 3.4.0 não aplica: extensões críticas desconhecidas, limite de caminho e uso da chave da folha. */
function regrasExtras(caminho: Certificate[]): string | null {
  for (const cert of caminho) {
    for (const ext of cert.extensions || []) {
      if (ext.critical && (!CRITICAS_CONHECIDAS.has(ext.extnID) || ext.parsedValue === undefined)) return `Extensão crítica não reconhecida (${ext.extnID}).`;
    }
  }
  // caminho[0] é a folha; caminho[i] (i ≥ 1) é CA com i-1 intermediários abaixo dela.
  for (let i = 1; i < caminho.length; i++) {
    const bc = extensao(caminho[i], OID.basicConstraints)?.parsedValue;
    if (!bc?.cA && !ehAutoassinado(caminho[i])) return "Certificado emissor sem permissão de autoridade certificadora.";
    const limite = bc?.pathLenConstraint;
    const valor = typeof limite === "number" ? limite : typeof limite?.valueBlock?.valueDec === "number" ? limite.valueBlock.valueDec : null;
    if (valor !== null && i - 1 > valor) return "A cadeia excede o limite de níveis permitido pela autoridade certificadora.";
    const uso = usoDaChave(caminho[i]);
    if (uso !== null && !(uso & 0x04)) return "Certificado emissor sem permissão para emitir certificados.";
  }
  const usoFolha = usoDaChave(caminho[0]);
  if (usoFolha !== null && !(usoFolha & 0xc0)) return "O certificado não tem permissão de assinatura digital.";
  if (!ekuPermiteAssinatura(caminho[0])) return "O uso estendido do certificado não permite assinatura de documentos.";
  return null;
}
function ehAutoassinado(cert: Certificate) { return cert.subject.isEqual(cert.issuer); }

/** Monta e confere a cadeia: certificados fornecidos (do PDF/navegador), raízes fixas e AIA (download limitado). */
export async function montarCadeia(cert: Certificate, fornecidos: Certificate[], roots: Certificate[] = raizesIcp, sessao: Baixador = new SessaoPki(), agora = new Date()): Promise<Cadeia> {
  // Âncora de confiança assinando diretamente: confiável por configuração (não há emissor nem LCR acima dela).
  if (ehRaiz(cert, roots)) {
    if (agora < cert.notBefore.value || agora > cert.notAfter.value) return { estado: "invalida", transitoria: false, motivo: "Certificado fora da validade na data da conferência.", caminho: [cert], intermediarios: [] };
    return { estado: "valida", transitoria: false, motivo: "", caminho: [cert], intermediarios: [] };
  }
  const pool = new Map<string, Certificate>();
  for (const item of fornecidos.slice(0, 10)) if (!mesmo(item, cert) && !ehRaiz(item, roots)) pool.set(idCert(item), item);
  let transitoria = false, atual = cert, chegou = false;
  try {
  for (let nivel = 0; nivel < 6; nivel++) {
    let emissor: Certificate | undefined;
    for (const root of roots) if (await assinadoPor(atual, root)) { emissor = root; break; }
    if (!emissor) for (const candidato of Array.from(pool.values())) if (!mesmo(candidato, atual) && await assinadoPor(atual, candidato)) { emissor = candidato; break; }
    if (!emissor && emissorDaHierarquia(atual, roots)) {
      for (const url of urlsEmissor(atual)) {
        try {
          for (const candidato of certificadosPublicos(await sessao.baixar(url))) {
            if (await assinadoPor(atual, candidato)) { emissor = candidato; if (!ehRaiz(candidato, roots)) pool.set(idCert(candidato), candidato); break; }
          }
        } catch (e) { if (!(e instanceof EnderecoRecusadoPki)) transitoria = true; }
        if (emissor) break;
      }
    }
    if (!emissor) break;
    if (ehRaiz(emissor, roots)) { chegou = true; break; }
    if (ehAutoassinado(emissor)) break; // raiz que não é ICP-Brasil
    atual = emissor;
  }
  } catch (e) {
    if (e instanceof NaoSuportado) return { estado: "pendente", transitoria: false, motivo: "Algoritmo de assinatura do certificado não suportado pela conferência automática. Confira manualmente.", caminho: [], intermediarios: Array.from(pool.values()) };
    throw e;
  }
  const intermediarios = Array.from(pool.values());
  if (!chegou) {
    return transitoria
      ? { estado: "pendente", transitoria: true, motivo: "Não foi possível baixar a cadeia da certificadora agora. O sistema tentará novamente.", caminho: [], intermediarios }
      : { estado: "invalida", transitoria: false, motivo: "O certificado não pertence a uma cadeia ICP-Brasil reconhecida.", caminho: [], intermediarios };
  }
  // Conferência formal pelo PKIjs. A folha vai por ÚLTIMO em `certs` (é assim que o motor 3.4.0 a identifica) e nenhuma
  // cópia de raiz/folha entra na lista, para a remoção de duplicados do motor não trocar a folha.
  const engine = new CertificateChainValidationEngine({ trustedCerts: roots, certs: [...intermediarios, cert], checkDate: agora });
  let resultado: Awaited<ReturnType<CertificateChainValidationEngine["verify"]>>;
  try { resultado = await engine.verify({ passedWhenNotRevValues: true }); }
  catch { return { estado: "pendente", transitoria: false, motivo: "A cadeia não pôde ser conferida automaticamente.", caminho: [], intermediarios }; }
  const caminho = resultado.certificatePath || [];
  if (!resultado.result || caminho.length < 2 || !mesmo(caminho[0], cert) || !ehRaiz(caminho[caminho.length - 1], roots)) {
    const vencido = resultado.resultCode === 8;
    return { estado: "invalida", transitoria: false, motivo: vencido ? "Há certificado vencido ou ainda não válido na cadeia, na data da conferência." : "A cadeia de certificação não passou na conferência.", caminho: [], intermediarios };
  }
  const problema = regrasExtras(caminho);
  if (problema) return { estado: problema.startsWith("Extensão crítica") ? "pendente" : "invalida", transitoria: false, motivo: problema, caminho: [], intermediarios };
  if (OFICIAIS.has(idCert(caminho[caminho.length - 1])) && !politicaAssinaturaIcp(cert)) {
    return { estado: "pendente", transitoria: false, motivo: "O certificado não declara política de assinatura ICP-Brasil (A1 a A4). Confira manualmente.", caminho: [], intermediarios };
  }
  return { estado: "valida", transitoria: false, motivo: "", caminho, intermediarios: caminho.slice(1, -1) };
}

// ── LCR ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Cache de LCR já conferida (assinatura do emissor válida), por URL + emissor, até o nextUpdate (máx. 6 h). */
const cacheLcr = new Map<string, { bytes: Buffer; ate: number }>();
const CACHE_MAX_ITENS = 32, CACHE_MAX_BYTES = 48 * 1024 * 1024, CACHE_MAX_MS = 6 * 3600_000;
export function limparCacheLcr() { cacheLcr.clear(); }
function guardarNoCache(chave: string, bytes: Buffer, ate: number) {
  cacheLcr.delete(chave);
  cacheLcr.set(chave, { bytes, ate });
  let total = Array.from(cacheLcr.values()).reduce((s, v) => s + v.bytes.length, 0);
  for (const [k, v] of Array.from(cacheLcr.entries())) {
    if (cacheLcr.size <= CACHE_MAX_ITENS && total <= CACHE_MAX_BYTES) break;
    cacheLcr.delete(k); total -= v.bytes.length;
  }
}

function urlsDoPonto(ponto: DistributionPoint): string[] {
  if (ponto.reasons || ponto.cRLIssuer || !Array.isArray(ponto.distributionPoint)) return [];
  return ponto.distributionPoint.filter(item => item.type === 6).map(item => String(item.value)).filter(u => /^https?:/i.test(u)).slice(0, 2);
}
function ehCa(cert: Certificate) { return !!extensao(cert, OID.basicConstraints)?.parsedValue?.cA; }

/** Problema da LCR (null = utilizável para este certificado). */
async function problemaLcr(crl: CertificateRevocationList, cert: Certificate, emissor: Certificate, urlsPonto: string[], agora: Date): Promise<string | null> {
  if (!crl.issuer.isEqual(emissor.subject)) return "LCR de outro emissor.";
  const uso = usoDaChave(emissor);
  if (uso !== null && !(uso & 0x02)) return "O emissor não tem permissão para assinar LCR.";
  let assinada = false;
  try { assinada = await crl.verify({ issuerCertificate: emissor }); } catch { assinada = false; }
  if (!assinada) return "LCR com assinatura inválida.";
  if (crl.thisUpdate.value.getTime() > agora.getTime() + 5 * 60_000) return "LCR com data futura.";
  if (!crl.nextUpdate || crl.nextUpdate.value.getTime() <= agora.getTime()) return "LCR vencida.";
  const exts = crl.crlExtensions?.extensions || [];
  if (exts.some(ext => ext.extnID === OID.deltaCrl)) return "LCR delta não suportada.";
  if (exts.some(ext => ext.critical && ext.extnID !== OID.idp)) return "LCR com extensão crítica não suportada.";
  const idp = exts.find(ext => ext.extnID === OID.idp)?.parsedValue;
  if (idp) {
    if (idp.indirectCRL || idp.onlySomeReasons || idp.onlyContainsAttributeCerts) return "Escopo da LCR não suportado.";
    if (idp.onlyContainsUserCerts && ehCa(cert)) return "A LCR não cobre certificados de autoridade.";
    if (idp.onlyContainsCACerts && !ehCa(cert)) return "A LCR só cobre certificados de autoridade.";
    if (idp.distributionPoint !== undefined) {
      const nomes = Array.isArray(idp.distributionPoint) ? idp.distributionPoint.filter((n: { type: number }) => n.type === 6).map((n: { value: string }) => String(n.value)) : [];
      if (!nomes.some((n: string) => urlsPonto.includes(n))) return "A LCR não corresponde ao ponto de distribuição do certificado.";
    }
  }
  for (const entrada of crl.revokedCertificates || []) {
    for (const ext of entrada.crlEntryExtensions?.extensions || []) {
      if (ext.critical && ext.extnID !== OID.reasonCode && ext.extnID !== OID.invalidityDate) return "Entrada da LCR com extensão crítica não suportada.";
    }
  }
  return null;
}

export type Revogacao = { estado: EstadoRevogacao; transitoria: boolean; motivo: string };

/** Consulta ATUAL de revogação pela LCR. Revogado só com LCR confiável; regular só com LCR confiável e vigente. */
export async function conferirRevogacao(cert: Certificate, emissor: Certificate, sessao: Baixador, agora = new Date()): Promise<Revogacao> {
  const pontos: DistributionPoint[] = extensao(cert, OID.crlDp)?.parsedValue?.distributionPoints || [];
  const urls = pontos.slice(0, 3).map(urlsDoPonto).filter(lista => lista.length);
  if (!urls.length) return { estado: "pendente", transitoria: false, motivo: "O certificado não informa uma LCR consultável." };
  let transitoria = false, ultimo = "LCR indisponível.";
  for (const lista of urls) {
    for (const url of lista) {
      const chave = `${url}\n${idCert(emissor)}`;
      const guardada = cacheLcr.get(chave);
      let bytes: Buffer;
      if (guardada && guardada.ate > agora.getTime()) bytes = guardada.bytes;
      else {
        try { bytes = await sessao.baixar(url); }
        catch (e) { if (!(e instanceof EnderecoRecusadoPki)) transitoria = true; ultimo = e instanceof ErroRedePki ? "LCR indisponível no momento." : "Endereço da LCR recusado."; continue; }
      }
      let crl: CertificateRevocationList;
      try { crl = CertificateRevocationList.fromBER(derDe(bytes)); }
      catch { transitoria = true; ultimo = "LCR ilegível."; continue; }
      const problema = await problemaLcr(crl, cert, emissor, lista, agora);
      if (problema) { transitoria = true; ultimo = problema; continue; }
      guardarNoCache(chave, bytes, Math.min(crl.nextUpdate!.value.getTime(), agora.getTime() + CACHE_MAX_MS));
      return crl.isCertificateRevoked(cert)
        ? { estado: "revogado", transitoria: false, motivo: "Certificado revogado pela autoridade certificadora." }
        : { estado: "regular", transitoria: false, motivo: "" };
    }
  }
  return { estado: "pendente", transitoria, motivo: `${ultimo} A revogação não pôde ser confirmada.` };
}

/** Cadeia + revogação de cada certificado não raiz do caminho. Nunca lança: erro inesperado vira pendência. */
export async function validarCertificado(cert: Certificate, fornecidos: Certificate[], roots: Certificate[] = raizesIcp, sessao: Baixador = new SessaoPki(), agora = new Date()): Promise<ConsultaPki> {
  try {
    const cadeia = await montarCadeia(cert, fornecidos, roots, sessao, agora);
    const certificados = cadeia.intermediarios.map(c => derCertificado(c).toString("base64"));
    if (cadeia.estado !== "valida") return { cadeia: cadeia.estado, revogacao: "pendente", estado: cadeia.estado, transitoria: cadeia.transitoria, motivo: cadeia.motivo, certificados };
    // Folha primeiro, raiz por último: cada certificado é conferido na LCR do seguinte.
    const estados: Revogacao[] = [];
    for (let i = 0; i < cadeia.caminho.length - 1; i++) {
      const r = await conferirRevogacao(cadeia.caminho[i], cadeia.caminho[i + 1], sessao, agora);
      estados.push(r);
      if (r.estado === "revogado") break;
    }
    const revogado = estados.find(r => r.estado === "revogado");
    if (revogado) return { cadeia: "valida", revogacao: "revogado", estado: "invalida", transitoria: false, motivo: i18nRevogado(estados.indexOf(revogado)), certificados };
    const pendente = estados.find(r => r.estado === "pendente");
    if (pendente) return { cadeia: "valida", revogacao: "pendente", estado: "pendente", transitoria: estados.every(r => r.estado !== "pendente" || r.transitoria), motivo: pendente.motivo, certificados };
    return { cadeia: "valida", revogacao: "regular", estado: "valida", transitoria: false, motivo: "Cadeia ICP-Brasil e LCR conferidas automaticamente pelo sistema.", certificados };
  } catch {
    return { cadeia: "pendente", revogacao: "pendente", estado: "pendente", transitoria: true, motivo: "A conferência da cadeia falhou inesperadamente. O sistema tentará novamente.", certificados: [] };
  }
}
function i18nRevogado(indice: number) {
  return indice === 0 ? "Certificado do signatário revogado pela autoridade certificadora." : "Há certificado de autoridade revogado na cadeia de assinatura.";
}
