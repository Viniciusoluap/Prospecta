import { and, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { portalContractDocuments, portalContracts } from "../drizzle/schema.js";
import { nomeContrato } from "../shared/contratos/documentos.js";
import { getDb } from "./db.js";
import { readPrivateDbFile } from "./private-document-files.js";
import { readPrivateDocument } from "./drive-documents.js";
import type { OpcoesConferencia } from "./juridico-verificar-assinaturas.js";
import { proximaTentativa, relatorioRetorno, resumir, sqlInserirValidacao, tabelaValidacoes } from "./juridico-validacao.js";
import type { Certificate } from "pkijs";
import { PDF, PdfDict, PdfRef } from "@libpdf/core";

export async function conteudoContrato(documento:{id:number;driveFileId:string|null}) {
  return (await readPrivateDbFile("contract",documento.id))??(documento.driveFileId?await readPrivateDocument(documento.driveFileId):null);
}
/**
 * Retorno assinado pelo cliente (portal) ou anexado pelo admin. A conferência automática (integridade, cadeia ICP-Brasil,
 * LCR, identidades e conservação da revisão da empresa) é gravada junto com o documento, o arquivo e o status, no mesmo
 * lote. Só o portal conclui sozinho, e só com `todos` (identidades conferidas + revisão da empresa conservada).
 */
export async function salvarRetornoContrato(contract:typeof portalContracts.$inferSelect,bytes:Buffer,viaPortal:boolean,opcoes:OpcoesConferencia&{roots?:Certificate[]}={}) {
  const db=getDb();
  const [base]=await db.select().from(portalContractDocuments).where(and(eq(portalContractDocuments.contractId,contract.id),eq(portalContractDocuments.type,"assinatura_digital"))).orderBy(desc(portalContractDocuments.createdAt)).limit(1);
  const original=base?await conteudoContrato(base):null;
  const conf=await relatorioRetorno(viaPortal?"retorno_portal":"retorno_admin",contract,bytes,base&&original?{id:base.id,bytes:original}:null,mesmoConteudo,opcoes.roots,opcoes);
  const tipo=viaPortal&&conf.todos?"assinado":"recebido_assinado";
  const reserved=await db.execute(sql`SELECT nextval(pg_get_serial_sequence('portal_contract_documents','id'))::int AS id`);
  const id=Number((reserved as unknown as {rows:{id:number}[]}).rows[0].id);
  const gravar=await tabelaValidacoes();
  await db.batch([
    db.insert(portalContractDocuments).values({id,contractId:contract.id,type:tipo,name:nomeContrato(contract.partyB,tipo)}),
    db.execute(sql`INSERT INTO portal_contract_file_data(document_id,mime,size_bytes,data) VALUES(${id},'application/pdf',${bytes.length},decode(${bytes.toString("base64")},'base64'))`),
    ...(gravar?[db.execute(sqlInserirValidacao(id,conf))]:[]),
    db.update(portalContracts).set({signatureStatus:tipo==="assinado"?"assinado":"em_conferencia",updatedAt:new Date()}).where(eq(portalContracts.id,contract.id)),
  ] as unknown as Parameters<typeof db.batch>[0]);
  return {id,todos:tipo==="assinado",conferencia:conf,validacao:resumir(id,conf,0,gravar?proximaTentativa(conf,0,new Date()):null)};
}
export async function mesmoConteudo(antes:Buffer,depois:Buffer) {
  try {
    const a=await PDF.load(new Uint8Array(antes)),b=await PDF.load(new Uint8Array(depois));
    const ap=a.getPages(),bp=b.getPages();if(ap.length!==bp.length)return false;
    // Qualquer edição de conteúdo/recursos exige conferência humana; widgets de assinatura podem ser acrescentados.
    const nome=(key:unknown)=>(key as {value?:string}).value??String(key);
    const serial=(pdf:PDF,obj:unknown,seen=new Set<string>(),ignorePages=false):unknown=>{
      if(!obj||typeof obj!=="object")return obj;
      const v=obj as {type:string;toString():string;value?:unknown;bytes?:Uint8Array;toArray?:()=>unknown[];getDecodedData?:()=>Uint8Array;[Symbol.iterator]?:()=>Iterator<[unknown,unknown]>};
      if(v.type==="ref"){const target=pdf.getObject(obj as never);if(ignorePages&&target instanceof PdfDict&&target.getName("Type")?.value==="Page")return "[page]";const key=v.toString();if(seen.has(key))return key;const next=new Set(seen);next.add(key);return serial(pdf,target,next,ignorePages);}
      if(v.type==="array")return v.toArray!().map(x=>serial(pdf,x,seen,ignorePages));
      if(v.type==="dict"||v.type==="stream")return {data:v.getDecodedData?Buffer.from(v.getDecodedData()).toString("base64"):undefined,entries:Array.from(v as Iterable<[unknown,unknown]>).filter(([k])=>![/^\/?Length$/,/^\/?Filter$/,/^\/?DecodeParms$/].some(re=>re.test(nome(k)))).map(([k,val])=>[nome(k),serial(pdf,val,seen,ignorePages)]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))};
      return v.bytes?Buffer.from(v.bytes).toString("hex"):v.value??String(v);
    };
    const novosWidgets=new Set(b.getForm()?.getSignatureFields().filter(f=>f.isSigned()).flatMap(f=>f.getWidgets().map(w=>w.dict))||[]);
    for(let i=0;i<ap.length;i++) {
      const anotacoes=(pdf:PDF,page:typeof ap[number])=>(page.dict.getArray("Annots")?.toArray()||[]).map(v=>v instanceof PdfRef?pdf.getObject(v):v);
      const antigas=anotacoes(a,ap[i]),novas=anotacoes(b,bp[i]);
      const restantes=[...novas];
      for(const old of antigas) {
        const digest=JSON.stringify(serial(a,old,new Set(),true));
        const index=restantes.findIndex(current=>JSON.stringify(serial(b,current,new Set(),true))===digest);
        if(index<0)return false;restantes.splice(index,1);
      }
      if(restantes.some(item=>!(item instanceof PdfDict)||item.getName("Subtype")?.value!=="Widget"||!novosWidgets.has(item)||item.has("A")||item.has("AA")))return false;
    }
    if(["OCProperties","OpenAction","AA","Perms"].some(k=>JSON.stringify(serial(a,a.getCatalog().get(k)))!==JSON.stringify(serial(b,b.getCatalog().get(k)))))return false;
    if(ap.some((p,i)=>!p.dict.get("Resources")||!bp[i].dict.get("Resources")))return false;
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
