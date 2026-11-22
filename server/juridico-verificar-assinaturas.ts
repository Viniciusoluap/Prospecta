// Jurídico — conferência técnica das assinaturas digitais de um PDF (22/11/2026).
//
// Para cada assinatura: ByteRange e /Contents coerentes, integridade CMS (o hash do trecho coberto bate com a assinatura)
// e, só depois, cadeia ICP-Brasil + LCR (server/juridico-pki.ts). O documento inteiro precisa estar coberto pela última
// assinatura. Resultado por assinatura e do documento:
//   - "invalida": PDF/assinatura estruturalmente errada, integridade quebrada, cobertura incompleta, certificado fora da
//                 ICP-Brasil, vencido ou revogado — nunca vira válida sozinha;
//   - "pendente": íntegra, mas cadeia ou LCR não puderam ser confirmadas agora (`transitoria` = vale tentar de novo);
//   - "valida":   íntegra, cadeia e LCR conferidas.
// Uma falha de rede nunca é tratada como assinatura inválida, e um timeout nunca vira válido.
import { PDF, PdfNumber } from "@libpdf/core";
import { Certificate, ContentInfo, SignedData, type SignedDataVerifyResult } from "pkijs";
import { algoritmoNaoSuportado, documentoDoCertificado, raizesIcp, validarCertificado, type ConsultaPki, type EstadoPki, type Baixador } from "./juridico-pki.js";
import { SessaoPki } from "./juridico-pki-download.js";

export const MAX_ASSINATURAS = 20;
export type AssinaturaConferida = {
  titular: string; documento: string; emissor: string; serial: string;
  integridade: boolean; cobertura: [number, number];
  cadeia: ConsultaPki["cadeia"]; revogacao: ConsultaPki["revogacao"];
  estado: EstadoPki; transitoria: boolean; motivo: string;
};
export type ConferenciaAssinaturas = {
  todos: boolean; validas: number; documentos: string[]; motivo: string;
  estado: EstadoPki; transitoria: boolean; coberturaTotal: boolean;
  assinaturas: AssinaturaConferida[]; verificadoEm: string;
};
type Partes = { partyADocument: string | null; partyBDocument: string | null; signers: string[] | null };
export type OpcoesConferencia = { sessao?: Baixador; agora?: Date };

const digitos = (v: string | null | undefined) => (v || "").replace(/\D/g, "");
const atributo = (nome: Certificate["subject"], oid: string) => nome.typesAndValues.filter(x => x.type === oid).map(x => String(x.value.valueBlock.value)).join(" ");

class FalhaEstrutural extends Error {}
class NaoSuportadoCms extends Error { constructor(readonly fim: number) { super("não suportado"); } }

export async function conferirAssinaturas(bytes: Buffer, partes: Partes, roots: Certificate[] = raizesIcp, opcoes: OpcoesConferencia = {}): Promise<ConferenciaAssinaturas> {
  const agora = opcoes.agora ?? new Date();
  const verificadoEm = agora.toISOString();
  const assinaturas: AssinaturaConferida[] = [];
  const invalido = (motivo: string): ConferenciaAssinaturas => ({ todos: false, validas: 0, documentos: [], motivo, estado: "invalida", transitoria: false, coberturaTotal: false, assinaturas, verificadoEm });
  let fields;
  try {
    const pdf = await PDF.load(new Uint8Array(bytes));
    fields = pdf.getForm()?.getSignatureFields().filter(f => f.isSigned()) || [];
  } catch { return invalido("O arquivo não é um PDF legível."); }
  if (!fields.length) return invalido("O PDF não contém assinatura digital conferível.");
  if (fields.length > MAX_ASSINATURAS) return invalido("Quantidade de assinaturas acima do limite de conferência.");
  const sessao = opcoes.sessao ?? new SessaoPki();
  let integroAte = 0;
  for (const field of fields) {
    let cert: Certificate, fornecidos: Certificate[], fim: number;
    try {
      const dict = field.getSignatureDict(), range = dict?.getArray("ByteRange"), content = dict?.getString("Contents");
      if (!range || range.length !== 4 || !content) throw new FalhaEstrutural("Assinatura sem ByteRange válido.");
      const n = range.toArray().map(x => x instanceof PdfNumber ? x.value : NaN); const [a, b, c, d] = n;
      if (!n.every(Number.isSafeInteger) || a !== 0 || b < 1 || c <= b || d < 1 || c + d > bytes.length) throw new FalhaEstrutural("Cobertura da assinatura inválida.");
      const gap = bytes.subarray(b, c).toString("latin1");
      if (!/^<[a-fA-F0-9\s]+>$/.test(gap) || !Buffer.from(gap.slice(1, -1).replace(/\s/g, ""), "hex").equals(Buffer.from(content.bytes))) throw new FalhaEstrutural("Conteúdo da assinatura inconsistente.");
      const cms = ContentInfo.fromBER(Uint8Array.from(content.bytes).buffer);
      const signed = new SignedData({ schema: cms.content });
      if ((signed.signerInfos || []).length !== 1) throw new FalhaEstrutural("A assinatura deve ter um único signatário.");
      const data = Uint8Array.from(Buffer.concat([bytes.subarray(0, b), bytes.subarray(c, c + d)])).buffer;
      let result: SignedDataVerifyResult;
      try { result = await signed.verify({ signer: 0, data, checkChain: false, extendedMode: true }) as SignedDataVerifyResult; }
      catch (e) {
        if (algoritmoNaoSuportado(e)) throw new NaoSuportadoCms(c + d);
        throw e;
      }
      if (!result.signatureVerified || !result.signerCertificate) throw new FalhaEstrutural("A assinatura não passou na conferência de integridade.");
      cert = result.signerCertificate;
      fornecidos = (signed.certificates || []).filter((item): item is Certificate => item instanceof Certificate);
      fim = c + d;
    } catch (e) {
      if (e instanceof NaoSuportadoCms) {
        // Algoritmo que o servidor não sabe conferir: não é prova de fraude nem de validade → pendência manual.
        assinaturas.push({ titular: "", documento: "", emissor: "", serial: "", integridade: false, cobertura: [0, e.fim], cadeia: "pendente", revogacao: "pendente", estado: "pendente", transitoria: false, motivo: "Algoritmo da assinatura não suportado pela conferência automática. Confira manualmente." });
        integroAte = Math.max(integroAte, e.fim);
        continue;
      }
      // Erro de leitura do CMS também é falha criptográfica/estrutural: não depende de rede.
      return invalido(e instanceof FalhaEstrutural ? e.message : "A assinatura não passou na conferência de integridade.");
    }
    const titular = atributo(cert.subject, "2.5.4.3") || atributo(cert.subject, "2.5.4.10");
    const documento = documentoDoCertificado(cert);
    const pki = await validarCertificado(cert, fornecidos, roots, sessao, agora);
    let estado = pki.estado, motivo = pki.motivo, transitoria = pki.transitoria;
    if (estado === "valida" && !documento) { estado = "pendente"; transitoria = false; motivo = "Assinatura conferida, mas o certificado não identifica CPF/CNPJ no nome do titular."; }
    assinaturas.push({
      titular, documento, emissor: atributo(cert.issuer, "2.5.4.3") || atributo(cert.issuer, "2.5.4.10"),
      serial: Buffer.from(cert.serialNumber.valueBlock.valueHexView).toString("hex"),
      integridade: true, cobertura: [0, fim], cadeia: pki.cadeia, revogacao: pki.revogacao, estado, transitoria, motivo,
    });
    integroAte = Math.max(integroAte, fim);
  }
  const coberturaTotal = integroAte === bytes.length;
  const validasLista = assinaturas.filter(s => s.estado === "valida");
  const documentos = validasLista.map(s => s.documento);
  const validas = validasLista.length;
  const base = { validas, documentos, assinaturas, verificadoEm, coberturaTotal };
  if (!coberturaTotal) return { ...base, todos: false, estado: "invalida", transitoria: false, motivo: "Há conteúdo depois da última assinatura: o documento inteiro não está coberto pela assinatura." };
  const invalida = assinaturas.find(s => s.estado === "invalida");
  if (invalida) return { ...base, todos: false, estado: "invalida", transitoria: false, motivo: invalida.motivo };
  const pendentes = assinaturas.filter(s => s.estado === "pendente");
  if (pendentes.length) return { ...base, todos: false, estado: "pendente", transitoria: pendentes.every(s => s.transitoria), motivo: `Assinatura íntegra. ${pendentes[0].motivo}` };

  const obrigatorios = [digitos(partes.partyADocument), digitos(partes.partyBDocument)];
  let semIdentificacao = obrigatorios.some(x => x.length !== 11 && x.length !== 14) || new Set(obrigatorios).size < 2;
  for (const signer of partes.signers || []) {
    if (/^(CONSTRUTORA|CONTRATANTE|COMPRADOR|EMPREITEIRO CONTRATADO) —/i.test(signer)) continue;
    const match = signer.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2}|\b\d{14}\b|\b\d{11}\b/);
    if (match) obrigatorios.push(digitos(match[0])); else semIdentificacao = true;
  }
  const todos = !semIdentificacao && obrigatorios.every(x => documentos.includes(x));
  return {
    ...base, todos, estado: "valida", transitoria: false,
    motivo: todos ? "Todas as partes identificadas têm assinatura digital conferida." : semIdentificacao ? "Há partes ou testemunhas sem CPF/CNPJ identificado. Aguardando conferência do responsável." : "Ainda faltam assinaturas de partes do contrato.",
  };
}
