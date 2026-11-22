import { PDF, PdfNumber } from "@libpdf/core";
import { Certificate, ContentInfo, SignedData, type SignedDataVerifyResult } from "pkijs";
import raizes from "./certificados/icp-raizes.json";

const trustedCerts=raizes.map(x=>Certificate.fromBER(Uint8Array.from(Buffer.from(x.pem.replace(/-----(BEGIN|END) CERTIFICATE-----|\s/g,""),"base64")).buffer));
export type ConferenciaAssinaturas={todos:boolean; validas:number; documentos:string[]; motivo:string};
type Partes={partyADocument:string|null;partyBDocument:string|null;signers:string[]|null};
const digitos=(v:string|null|undefined)=>(v||"").replace(/\D/g,"");
export async function conferirAssinaturas(bytes:Buffer,partes:Partes,roots:Certificate[]=trustedCerts):Promise<ConferenciaAssinaturas> {
  const documentos:string[]=[];let validas=0,integroAte=0;
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
      const result=await signed.verify({signer:0,data,checkChain:true,trustedCerts:roots,extendedMode:true,passedWhenNotRevValues:true}) as SignedDataVerifyResult;
      if(!result.signatureVerified||!result.signerCertificateVerified||!result.signerCertificate)throw Error("A assinatura não passou na conferência de integridade e cadeia.");
      const cert=result.signerCertificate;
      if(new Date()<cert.notBefore.value||new Date()>=cert.notAfter.value)throw Error("Certificado fora da validade atual.");
      const cn=cert.subject.typesAndValues.filter(x=>x.type==="2.5.4.3").map(x=>String(x.value.valueBlock.value)).join(" ");
      const doc=/(?:^|:)\s*(\d{14}|\d{11})\s*$/.exec(cn)?.[1];
      if(doc)documentos.push(doc);validas++;integroAte=Math.max(integroAte,c+d);
    }
    if(integroAte!==bytes.length)throw Error("Há conteúdo fora da última assinatura ou o PDF não contém assinatura digital conferível.");
    const obrigatorios=[digitos(partes.partyADocument),digitos(partes.partyBDocument)];
    let semIdentificacao=obrigatorios.some(x=>x.length!==11&&x.length!==14)||new Set(obrigatorios).size<2;
    for(const signer of partes.signers||[]) {
      if(/testemunha/i.test(signer)) {
        const match=signer.match(/\d{3}\.\d{3}\.\d{3}-\d{2}|\b\d{11}\b/);
        if(match)obrigatorios.push(digitos(match[0]));else semIdentificacao=true;
      }
    }
    const todos=!semIdentificacao&&obrigatorios.every(x=>documentos.includes(x));
    return {todos,validas,documentos,motivo:todos?"Todas as partes identificadas têm assinatura digital conferida.":semIdentificacao?"Há partes ou testemunhas sem CPF/CNPJ identificado. Aguardando conferência do responsável.":"Ainda faltam assinaturas de partes do contrato."};
  } catch { return {todos:false,validas,documentos,motivo:"Não foi possível conferir automaticamente todas as assinaturas. O documento ficará aguardando sua confirmação."}; }
}
