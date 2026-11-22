import { and, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { portalContractDocuments, portalContracts } from "../drizzle/schema.js";
import { nomeContrato } from "../shared/contratos/documentos.js";
import { getDb } from "./db.js";
import { readPrivateDbFile } from "./private-document-files.js";
import { readPrivateDocument } from "./drive-documents.js";
import { conferirAssinaturas } from "./juridico-verificar-assinaturas.js";
import { PDF } from "@libpdf/core";

export async function conteudoContrato(documento:{id:number;driveFileId:string|null}) {
  return (await readPrivateDbFile("contract",documento.id))??(documento.driveFileId?await readPrivateDocument(documento.driveFileId):null);
}
export async function salvarRetornoContrato(contract:typeof portalContracts.$inferSelect,bytes:Buffer,viaPortal:boolean) {
  const db=getDb();
  let conf=await conferirAssinaturas(bytes,contract);
  if(viaPortal&&conf.todos) {
    const [base]=await db.select().from(portalContractDocuments).where(and(eq(portalContractDocuments.contractId,contract.id),eq(portalContractDocuments.type,"assinatura_digital"))).orderBy(desc(portalContractDocuments.createdAt)).limit(1);
    const original=base?await conteudoContrato(base):null;
    // Retorno automático deve conservar a revisão assinada pela empresa e o conteúdo das páginas.
    if(!original||!bytes.subarray(0,original.length).equals(original)||!(await mesmoConteudo(original,bytes)))conf={...conf,todos:false,motivo:"O documento retornado precisa de conferência do responsável."};
  }
  const tipo=viaPortal&&conf.todos?"assinado":"recebido_assinado";
  const reserved=await db.execute(sql`SELECT nextval(pg_get_serial_sequence('portal_contract_documents','id'))::int AS id`);
  const id=Number((reserved as unknown as {rows:{id:number}[]}).rows[0].id);
  await db.batch([
    db.insert(portalContractDocuments).values({id,contractId:contract.id,type:tipo,name:nomeContrato(contract.partyB,tipo)}),
    db.execute(sql`INSERT INTO portal_contract_file_data(document_id,mime,size_bytes,data) VALUES(${id},'application/pdf',${bytes.length},decode(${bytes.toString("base64")},'base64'))`),
    db.update(portalContracts).set({signatureStatus:tipo==="assinado"?"assinado":"em_conferencia",updatedAt:new Date()}).where(eq(portalContracts.id,contract.id)),
  ]);
  return {id,todos:tipo==="assinado",conferencia:conf};
}
async function mesmoConteudo(antes:Buffer,depois:Buffer) {
  try {
    const a=await PDF.load(new Uint8Array(antes)),b=await PDF.load(new Uint8Array(depois));
    const ap=a.getPages(),bp=b.getPages();if(ap.length!==bp.length)return false;
    // Qualquer edição de conteúdo/recursos exige conferência humana; widgets de assinatura podem ser acrescentados.
    const serial=(pdf:PDF,obj:unknown,seen=new Set<string>()):unknown=>{
      if(!obj||typeof obj!=="object")return obj;
      const v=obj as {type:string;toString():string;value?:unknown;bytes?:Uint8Array;toArray?:()=>unknown[];getDecodedData?:()=>Uint8Array;[Symbol.iterator]?:()=>Iterator<[unknown,unknown]>};
      if(v.type==="ref"){const key=v.toString();if(seen.has(key))return key;const next=new Set(seen);next.add(key);return serial(pdf,pdf.getObject(obj as never),next);}
      if(v.type==="array")return v.toArray!().map(x=>serial(pdf,x,seen));
      if(v.type==="dict"||v.type==="stream")return {data:v.getDecodedData?Buffer.from(v.getDecodedData()).toString("base64"):undefined,entries:Array.from(v as Iterable<[unknown,unknown]>).filter(([k])=>![/^\/?Length$/,/^\/?Filter$/,/^\/?DecodeParms$/].some(re=>re.test(String(k)))).map(([k,val])=>[String(k),serial(pdf,val,seen)]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))};
      return v.bytes?Buffer.from(v.bytes).toString("hex"):v.value??String(v);
    };
    return ap.every((p,i)=>JSON.stringify([p.getMediaBox(),p.getCropBox(),p.rotation,serial(a,p.dict.get("Contents")),serial(a,p.dict.get("Resources"))])===JSON.stringify([bp[i].getMediaBox(),bp[i].getCropBox(),bp[i].rotation,serial(b,bp[i].dict.get("Contents")),serial(b,bp[i].dict.get("Resources"))]));
  }catch{return false;}
}
export async function confirmarTodasAssinaturas(id:number,role:string) {
  if(role!=="admin")throw new TRPCError({code:"FORBIDDEN",message:"A confirmação de todas as assinaturas é exclusiva do administrador."});
  const db=getDb();const [doc]=await db.select().from(portalContractDocuments).where(eq(portalContractDocuments.id,id)).limit(1);
  if(!doc||!["recebido_assinado","assinatura_digital"].includes(doc.type))throw new TRPCError({code:"BAD_REQUEST",message:"Selecione o contrato devolvido para conferência."});
  const [contract]=await db.select().from(portalContracts).where(eq(portalContracts.id,doc.contractId)).limit(1);
  if(!contract)throw new TRPCError({code:"NOT_FOUND"});
  await db.batch([
    db.update(portalContractDocuments).set({type:"assinado",name:nomeContrato(contract.partyB,"assinado")}).where(eq(portalContractDocuments.id,id)),
    db.update(portalContracts).set({signatureStatus:"assinado",updatedAt:new Date()}).where(eq(portalContracts.id,contract.id)),
  ]);
  return {success:true};
}
