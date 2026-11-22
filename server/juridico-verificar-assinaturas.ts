import { PDF, PdfNumber } from "@libpdf/core";
import { Certificate, ContentInfo, SignedData, type SignedDataVerifyResult } from "pkijs";
import { raizesIcp, validarCertificado, type ConsultaPki } from "./juridico-pki.js";

const trustedCerts=raizesIcp;
export type AssinaturaConferida = { titular:string; documento:string; integridade:boolean; cadeia:ConsultaPki["cadeia"]; revogacao:ConsultaPki["revogacao"]; motivo:string };
export type ConferenciaAssinaturas={todos:boolean; validas:number; documentos:string[]; motivo:string; estado:"valida"|"pendente"|"invalida"; assinaturas:AssinaturaConferida[]; verificadoEm:string};
type Partes={partyADocument:string|null;partyBDocument:string|null;signers:string[]|null};
const digitos=(v:string|null|undefined)=>(v||"").replace(/\D/g,"");
export async function conferirAssinaturas(bytes:Buffer,partes:Partes,roots:Certificate[]=trustedCerts):Promise<ConferenciaAssinaturas> {
  const documentos:string[]=[],assinaturas:AssinaturaConferida[]=[];let validas=0,integroAte=0;
  const verificadoEm=new Date().toISOString(),signal=AbortSignal.timeout(20000);
  try {
    const pdf=await PDF.load(new Uint8Array(bytes));
    const fields=pdf.getForm()?.getSignatureFields().filter(f=>f.isSigned())||[];
    if(fields.length>20)throw Error("Quantidade de assinaturas acima do limite de conferência.");
    for(const field of fields) {
      const dict=field.getSignatureDict()!,range=dict.getArray("ByteRange"),content=dict.getString("Contents");
      if(!range||range.length!==4||!content)throw Error("Assinatura sem ByteRange válido.");
      const n=range.toArray().map(x=>x instanceof PdfNumber?x.value:NaN);const [a,b,c,d]=n;
      if(!n.every(Number.isSafeInteger)||a!==0||b<1||c<=b||d<1||c+d>bytes.length)throw Error("Cobertura da assinatura inválida.");
      const gap=bytes.subarray(b,c).toString("latin1");
      if(!/^<[a-fA-F0-9\s]+>$/.test(gap)||!Buffer.from(gap.slice(1,-1).replace(/\s/g,""),"hex").equals(Buffer.from(content.bytes)))throw Error("Conteúdo da assinatura inconsistente.");
      const cms=ContentInfo.fromBER(Uint8Array.from(content.bytes).buffer);
      const signed=new SignedData({schema:cms.content});
      const data=Uint8Array.from(Buffer.concat([bytes.subarray(0,b),bytes.subarray(c,c+d)])).buffer;
      const result=await signed.verify({signer:0,data,checkChain:false,extendedMode:true}) as SignedDataVerifyResult;
      if(!result.signatureVerified||!result.signerCertificate)throw Error("A assinatura não passou na conferência de integridade.");
      const cert=result.signerCertificate;
      const cn=cert.subject.typesAndValues.filter(x=>x.type==="2.5.4.3").map(x=>String(x.value.valueBlock.value)).join(" ");
      const doc=/(?:^|:)\s*(\d{14}|\d{11})\s*$/.exec(cn)?.[1];
      const fornecidos=signed.certificates?.filter((item):item is Certificate=>item instanceof Certificate)||[];
      const pki=await validarCertificado(cert,fornecidos,roots,undefined,signal);
      const vigente=new Date()>=cert.notBefore.value&&new Date()<cert.notAfter.value;
      assinaturas.push({titular:cn,documento:doc||"",integridade:true,cadeia:pki.cadeia,revogacao:pki.revogacao,motivo:vigente?pki.motivo:"Certificado fora da validade atual. A conferência histórica requer prova de tempo confiável."});
      if(doc&&vigente&&pki.cadeia==="valida"&&pki.revogacao==="regular"){documentos.push(doc);validas++;}
      integroAte=Math.max(integroAte,c+d);
    }
    if(integroAte!==bytes.length)throw Error("Há conteúdo fora da última assinatura ou o PDF não contém assinatura digital conferível.");
    const obrigatorios=[digitos(partes.partyADocument),digitos(partes.partyBDocument)];
    let semIdentificacao=obrigatorios.some(x=>x.length!==11&&x.length!==14)||new Set(obrigatorios).size<2;
    for(const signer of partes.signers||[]) {
      if(/^(CONSTRUTORA|CONTRATANTE|COMPRADOR|EMPREITEIRO CONTRATADO) —/i.test(signer))continue;
      const match=signer.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2}|\b\d{14}\b|\b\d{11}\b/);
      if(match)obrigatorios.push(digitos(match[0]));else semIdentificacao=true;
    }
    const estado=assinaturas.some(s=>s.revogacao==="revogado")?"invalida":validas===assinaturas.length?"valida":"pendente";
    const todos=estado==="valida"&&!semIdentificacao&&obrigatorios.every(x=>documentos.includes(x));
    return {todos,validas,documentos,estado,assinaturas,verificadoEm,motivo:estado==="invalida"?"Há certificado revogado.":estado==="pendente"?"Assinatura íntegra. A validação da cadeia ou da revogação está pendente.":todos?"Todas as partes identificadas têm assinatura digital conferida.":semIdentificacao?"Há partes ou testemunhas sem CPF/CNPJ identificado. Aguardando conferência do responsável.":"Ainda faltam assinaturas de partes do contrato."};
  } catch { return {todos:false,validas,documentos,estado:"invalida",assinaturas,verificadoEm,motivo:"Não foi possível conferir automaticamente a integridade de todas as assinaturas. O documento ficará aguardando sua confirmação."}; }
}
