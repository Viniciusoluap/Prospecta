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
import { PDF, PdfDict, PdfRef, PdfStream } from "@libpdf/core";
import { decodificarEstrito, paginaComMarca, paginaSoGanhouFonteSemUso } from "./juridico-marca-conferencia.js";

export async function conteudoContrato(documento:{id:number;driveFileId:string|null}) {
  return (await readPrivateDbFile("contract",documento.id))??(documento.driveFileId?await readPrivateDocument(documento.driveFileId):null);
}
/**
 * Retorno assinado pelo cliente (portal) ou anexado pelo admin. A conferência automática (integridade, cadeia ICP-Brasil,
 * LCR, identidades e conservação da revisão da empresa) é gravada junto com o documento, o arquivo e o status, no mesmo
 * lote. Só o portal conclui sozinho, e só com `todos` (identidades conferidas + revisão da empresa conservada).
 */
/**
 * Revisão da empresa que vale como base do retorno (achado A2): a ÚLTIMA assinatura_digital do contrato, e só se a
 * conferência gravada dela for "valida" com vínculo à origem conferido. Sem isso, não há conclusão automática.
 */
export async function baseDaEmpresa(contractId:number):Promise<{id:number;bytes:Buffer}|null> {
  const db=getDb();
  const [base]=await db.select().from(portalContractDocuments).where(and(eq(portalContractDocuments.contractId,contractId),eq(portalContractDocuments.type,"assinatura_digital"))).orderBy(desc(portalContractDocuments.createdAt),desc(portalContractDocuments.id)).limit(1);
  if(!base||!(await tabelaValidacoes()))return null;
  const res=await db.execute(sql`SELECT estado, relatorio->>'vinculoOrigem' AS vinculo FROM portal_contract_document_validacoes WHERE document_id=${base.id}`);
  const linha=(res as unknown as {rows:{estado:string;vinculo:string|null}[]}).rows[0];
  if(linha?.estado!=="valida"||linha.vinculo!=="conferido")return null;
  const bytes=await conteudoContrato(base);
  return bytes?{id:base.id,bytes}:null;
}
// Limite de envios pelo portal por cliente (cada envio pode consultar certificadoras): 6 por hora, por processo.
const enviosPortal=new Map<number,number[]>();
export function _limparEnviosPortal(){enviosPortal.clear();}
function conferirLimitePortal(leadId:number){
  const agora=Date.now(),recentes=(enviosPortal.get(leadId)||[]).filter(t=>agora-t<3600_000);
  if(recentes.length>=6)throw new TRPCError({code:"TOO_MANY_REQUESTS",message:"Muitos envios seguidos. Aguarde um pouco ou fale com a equipe."});
  recentes.push(agora);enviosPortal.set(leadId,recentes);
}
export async function salvarRetornoContrato(contract:typeof portalContracts.$inferSelect,bytes:Buffer,viaPortal:boolean,opcoes:OpcoesConferencia&{roots?:Certificate[]}={}) {
  const db=getDb();
  if(viaPortal&&contract.leadId)conferirLimitePortal(contract.leadId);
  const base=await baseDaEmpresa(contract.id);
  const conf=await relatorioRetorno(viaPortal?"retorno_portal":"retorno_admin",contract,bytes,base,mesmoConteudo,opcoes.roots,opcoes);
  const podeConcluir=viaPortal&&conf.todos&&base;
  const reserved=await db.execute(sql`SELECT nextval(pg_get_serial_sequence('portal_contract_documents','id'))::int AS id`);
  const id=Number((reserved as unknown as {rows:{id:number}[]}).rows[0].id);
  const gravar=await tabelaValidacoes();
  await db.batch([
    db.execute(sql`SELECT id FROM portal_contracts WHERE id=${contract.id} FOR UPDATE`),
    db.insert(portalContractDocuments).values({id,contractId:contract.id,type:"recebido_assinado",name:nomeContrato(contract.partyB,"recebido_assinado")}),
    db.execute(sql`INSERT INTO portal_contract_file_data(document_id,mime,size_bytes,data) VALUES(${id},'application/pdf',${bytes.length},decode(${bytes.toString("base64")},'base64'))`),
    ...(gravar?[db.execute(sqlInserirValidacao(id,conf))]:[]),
    ...(podeConcluir?[db.execute(sql`UPDATE portal_contract_documents SET type='assinado', name=${nomeContrato(contract.partyB,"assinado")}
      WHERE id=${id}
        AND EXISTS (SELECT 1 FROM portal_contracts WHERE id=${contract.id} AND signature_status=${contract.signatureStatus} AND signature_status<>'assinado')
        AND ${base.id}=(SELECT id FROM portal_contract_documents WHERE contract_id=${contract.id} AND type='assinatura_digital' ORDER BY created_at DESC,id DESC LIMIT 1)
        AND EXISTS (SELECT 1 FROM portal_contract_document_validacoes WHERE document_id=${base.id} AND estado='valida' AND relatorio->>'vinculoOrigem'='conferido')`)]:[]),
    db.execute(sql`UPDATE portal_contracts SET signature_status=CASE WHEN EXISTS (SELECT 1 FROM portal_contract_documents WHERE id=${id} AND type='assinado') THEN 'assinado' ELSE 'em_conferencia' END, updated_at=now()
      WHERE id=${contract.id} AND signature_status=${contract.signatureStatus} AND signature_status<>'assinado'`),
  ] as unknown as Parameters<typeof db.batch>[0]);
  const [salvo]=await db.select().from(portalContractDocuments).where(eq(portalContractDocuments.id,id)).limit(1);
  return {id,todos:salvo?.type==="assinado",conferencia:conf,validacao:resumir(id,conf,0,gravar?proximaTentativa(conf,0,new Date()):null)};
}
/**
 * O PDF `depois` conserva o conteúdo de `antes`. Com `marca` (assinatura da empresa sobre o documento de origem), UMA
 * página pode ter recebido só a marca visível da assinatura daquele titular (server/juridico-marca-conferencia.ts).
 */
export async function mesmoConteudo(antes:Buffer,depois:Buffer,marca?:{titular:string}) {
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
      if(v.type==="dict"||v.type==="stream")return {data:obj instanceof PdfStream?Buffer.from(decodificarEstrito(obj,{imagem:obj.getName("Subtype")?.value==="Image"})).toString("base64"):undefined,entries:Array.from(v as Iterable<[unknown,unknown]>).filter(([k])=>![/^\/?Length$/,/^\/?Filter$/,/^\/?DecodeParms$/].some(re=>re.test(nome(k)))).map(([k,val])=>[nome(k),serial(pdf,val,seen,ignorePages)]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))};
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
      // Portão de QA de 23/11/2026 (4ª revisão): o widget novo de assinatura precisa ser INVISÍVEL (retângulo de área zero ou
      // marcado como oculto). Carimbo visível pode cobrir cláusulas com outro texto: não conserva — vai para conferência humana.
      const invisivel=(w:PdfDict)=>{
        const f=w.getNumber("F")?.value??0;if((f&2)===2)return true;
        const r=w.getArray("Rect")?.toArray().map(n=>(n as {type?:string;value?:unknown}).type==="number"?Number((n as {value:number}).value):NaN);
        return !!r&&r.length===4&&r.every(Number.isFinite)&&(r[0]===r[2]||r[1]===r[3]);
      };
      if(restantes.some(item=>!(item instanceof PdfDict)||item.getName("Subtype")?.value!=="Widget"||!novosWidgets.has(item)||item.has("A")||item.has("AA")||!invisivel(item)))return false;
    }
    // Páginas citadas pelo catálogo (ex.: OpenAction do jsPDF) são comparadas à parte, abaixo.
    // Portão de QA de 23/11/2026 (5ª revisão): o catálogo inteiro precisa continuar igual (XFA, JavaScript de abertura e
    // afins trocam o que o leitor mostra). Só pode mudar o que uma assinatura muda: os campos e o SigFlags do /AcroForm, e
    // os dados de validação de longo prazo (/DSS, /Extensions). A árvore de páginas é comparada à parte.
    const igual=(pa:PDF,va:unknown,pb:PDF,vb:unknown)=>JSON.stringify(serial(pa,va,new Set(),true))===JSON.stringify(serial(pb,vb,new Set(),true));
    const chaves=(d:PdfDict|undefined|null)=>d?Array.from(d as unknown as Iterable<[unknown,unknown]>).map(([k])=>nome(k).replace(/^\//,"")):[];
    const dic=(pdf:PDF,v:unknown)=>{const o=v instanceof PdfRef?pdf.getObject(v):v;return o instanceof PdfDict?o:null;};
    const ca=a.getCatalog(),cb=b.getCatalog();
    for(const k of Array.from(new Set([...chaves(ca),...chaves(cb)]))){
      if(["Pages","AcroForm","DSS","Extensions"].includes(k))continue;
      if(!igual(a,ca.get(k),b,cb.get(k)))return false;
    }
    const PADRAO14=new Set(["Helvetica","Helvetica-Bold","Helvetica-Oblique","Helvetica-BoldOblique","Times-Roman","Times-Bold","Times-Italic","Times-BoldItalic","Courier","Courier-Bold","Courier-Oblique","Courier-BoldOblique","ZapfDingbats","Symbol"]);
    const drPadrao=(dr:PdfDict|null)=>{
      if(!dr||chaves(dr).some(k=>k!=="Font"))return false;
      const fontes=dic(b,dr.get("Font"));if(!fontes)return false;
      return Array.from(fontes as unknown as Iterable<[unknown,unknown]>).every(([,v])=>{const f=dic(b,v);
        return !!f&&chaves(f).every(k=>["Type","Subtype","BaseFont"].includes(k))&&f.getName("Subtype")?.value==="Type1"&&PADRAO14.has(f.getName("BaseFont")?.value||"");});
    };
    const fa=dic(a,ca.get("AcroForm")),fb=dic(b,cb.get("AcroForm"));
    if(fa&&!fb||(ca.get("AcroForm")||cb.get("AcroForm"))&&!fb)return false;
    for(const k of Array.from(new Set([...chaves(fa),...chaves(fb)]))){
      if(k==="Fields"||k==="SigFlags")continue;
      // O assinador, ao CRIAR o /AcroForm (a origem não tinha), põe o /DR padrão: só fontes Type1 padrão, sem mais nada.
      if(!fa&&k==="DR"&&drPadrao(dic(b,fb?.get(k))))continue;
      // …e o /DA padrão ("/Helv 0 Tf 0 g"), que só vale para campos de formulário; assinatura não tem aparência regerada.
      if(!fa&&k==="DA"&&JSON.stringify(serial(b,fb?.get(k),new Set(),true))===JSON.stringify(Buffer.from("/Helv 0 Tf 0 g").toString("hex")))continue;
      if(!fa&&k==="NeedAppearances"&&JSON.stringify(serial(b,fb?.get(k),new Set(),true))==="false")continue;
      if(!igual(a,fa?.get(k),b,fb?.get(k)))return false;
    }
    if(ap.some((p,i)=>!p.dict.get("Resources")||!bp[i].dict.get("Resources")))return false;
    const caixa=(p:typeof ap[number])=>JSON.stringify([p.getMediaBox(),p.getCropBox(),p.rotation]);
    const iguais=ap.map((p,i)=>JSON.stringify([caixa(p),serial(a,p.dict.get("Contents")),serial(a,p.dict.get("Resources"))])===JSON.stringify([caixa(bp[i]),serial(b,bp[i].dict.get("Contents")),serial(b,bp[i].dict.get("Resources"))]));
    if(iguais.every(Boolean))return true;
    if(!marca)return false;
    // Só UMA página pode ter o conteúdo mudado (a da marca). As demais podem diferir apenas por terem "ganhado" a fonte
    // padrão da marca quando o PDF usa um dicionário de recursos comum a todas as páginas (jsPDF, contrato de várias páginas).
    const txt=(pdf:PDF,v:unknown)=>JSON.stringify(serial(pdf,v));
    const conteudoMudou=ap.map((p,i)=>caixa(p)!==caixa(bp[i])||txt(a,p.dict.get("Contents"))!==txt(b,bp[i].dict.get("Contents")));
    const comMarca=conteudoMudou.map((mudou,i)=>mudou?i:-1).filter(i=>i>=0);
    if(comMarca.length!==1)return false;
    const i=comMarca[0];
    if(caixa(ap[i])!==caixa(bp[i]))return false;
    for(let j=0;j<ap.length;j++)if(j!==i&&!iguais[j]&&!paginaSoGanhouFonteSemUso(a,ap[j],b,bp[j],txt))return false;
    return paginaComMarca(a,ap[i],b,bp[i],marca.titular,txt);
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
