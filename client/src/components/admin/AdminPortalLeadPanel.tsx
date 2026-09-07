import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CalendarDays, FileText, KeyRound, MessageSquare } from "lucide-react";

export function AdminPortalLeadPanel({ leadId, defaultEmail }: { leadId: number; defaultEmail?: string | null }) {
  const overview = trpc.portal.admin.overview.useQuery({ leadId });
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [password, setPassword] = useState("");
  const [visitAt, setVisitAt] = useState("");
  const [contract, setContract] = useState({ number: "", type: "obra" });
  const [document, setDocument] = useState({ contractId: "", name: "", url: "" });
  const [message, setMessage] = useState("");
  const provision = trpc.portal.admin.provisionAccess.useMutation({ onSuccess: () => { toast.success("Acesso do cliente atualizado"); setPassword(""); overview.refetch(); }, onError: e => toast.error(e.message) });
  const createVisit = trpc.portal.admin.createVisit.useMutation({ onSuccess: () => { toast.success("Visita registrada"); setVisitAt(""); overview.refetch(); }, onError: e => toast.error(e.message) });
  const createContract = trpc.portal.admin.createContract.useMutation({ onSuccess: () => { toast.success("Contrato criado"); setContract({ number: "", type: "obra" }); overview.refetch(); }, onError: e => toast.error(e.message) });
  const addDocument = trpc.portal.admin.addDocument.useMutation({ onSuccess: () => { toast.success("Documento vinculado"); setDocument({ contractId: "", name: "", url: "" }); overview.refetch(); }, onError: e => toast.error(e.message) });
  const signature = trpc.portal.admin.setSignatureStatus.useMutation({ onSuccess: () => { toast.success("Assinatura solicitada"); overview.refetch(); }, onError: e => toast.error(e.message) });
  const send = trpc.portal.admin.sendMessage.useMutation({ onSuccess: () => { setMessage(""); overview.refetch(); }, onError: e => toast.error(e.message) });

  return <Card className="bg-[#2C3E50] border-[#C9A961]/20">
    <CardHeader><CardTitle className="text-[#C9A961] text-sm">Portal do Cliente</CardTitle></CardHeader>
    <CardContent className="space-y-6">
      <div className="grid md:grid-cols-3 gap-3">
        <div className="space-y-2"><Label className="text-gray-300 flex gap-2"><KeyRound className="h-4 w-4"/>Acesso</Label><Input value={email} onChange={e=>setEmail(e.target.value)} placeholder="cliente@email.com" className="bg-[#1A2332] text-white"/><Input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="Senha (mín. 8)" className="bg-[#1A2332] text-white"/><Button size="sm" disabled={!email || password.length<8 || provision.isPending} onClick={()=>provision.mutate({leadId,email,password})}>Provisionar</Button>{overview.data?.account && <p className="text-xs text-green-400">Ativo: {overview.data.account.email}</p>}</div>
        <div className="space-y-2"><Label className="text-gray-300 flex gap-2"><CalendarDays className="h-4 w-4"/>Visita</Label><Input value={visitAt} onChange={e=>setVisitAt(e.target.value)} type="datetime-local" className="bg-[#1A2332] text-white"/><Button size="sm" disabled={!visitAt || createVisit.isPending} onClick={()=>createVisit.mutate({leadId,scheduledAt:new Date(visitAt),status:"agendada"})}>Registrar visita</Button><p className="text-xs text-gray-400">{overview.data?.visits.length ?? 0} visita(s)</p></div>
        <div className="space-y-2"><Label className="text-gray-300 flex gap-2"><FileText className="h-4 w-4"/>Contrato</Label><Input value={contract.number} onChange={e=>setContract({...contract,number:e.target.value})} placeholder="Número" className="bg-[#1A2332] text-white"/><Input value={contract.type} onChange={e=>setContract({...contract,type:e.target.value})} placeholder="Tipo" className="bg-[#1A2332] text-white"/><Button size="sm" disabled={!contract.number || !contract.type || createContract.isPending} onClick={()=>createContract.mutate({leadId,...contract})}>Criar contrato</Button><p className="text-xs text-gray-400">{overview.data?.contracts.length ?? 0} contrato(s)</p></div>
      </div>
      {overview.data?.contracts.map(c => <div key={c.id} className="bg-[#1A2332] rounded p-3 flex flex-wrap items-center justify-between gap-2 text-sm"><span className="text-white">{c.number} · {c.type}</span><span className="text-gray-400">{c.signatureStatus}</span><Button size="sm" variant="outline" disabled={signature.isPending || c.signatureStatus === "assinado"} onClick={()=>signature.mutate({contractId:c.id,status:"solicitado"})}>Solicitar assinatura</Button></div>)}
      {overview.data?.contracts.length ? <div className="grid md:grid-cols-4 gap-2"><select aria-label="Contrato do documento" value={document.contractId} onChange={e=>setDocument({...document,contractId:e.target.value})} className="rounded bg-[#1A2332] border border-input px-3 text-white"><option value="">Contrato...</option>{overview.data.contracts.map(c=><option key={c.id} value={c.id}>{c.number}</option>)}</select><Input value={document.name} onChange={e=>setDocument({...document,name:e.target.value})} placeholder="Nome do PDF" className="bg-[#1A2332] text-white"/><Input value={document.url} onChange={e=>setDocument({...document,url:e.target.value})} placeholder="URL segura do PDF" className="bg-[#1A2332] text-white"/><Button disabled={!document.contractId || !document.name || !document.url || addDocument.isPending} onClick={()=>addDocument.mutate({contractId:Number(document.contractId),name:document.name,url:document.url,type:"contrato_gerado"})}>Vincular documento</Button></div> : null}
      <div><Label className="text-gray-300 flex gap-2 mb-2"><MessageSquare className="h-4 w-4"/>Chat</Label><div className="max-h-48 overflow-y-auto bg-[#1A2332] rounded p-3 space-y-2">{overview.data?.messages.map(m=><div key={m.id} className={`text-sm ${m.sender === "cliente" ? "text-white" : "text-[#C9A961]"}`}><b>{m.sender}:</b> {m.text}</div>)}{overview.data?.messages.length===0&&<p className="text-xs text-gray-500">Sem mensagens.</p>}</div><form className="flex gap-2 mt-2" onSubmit={e=>{e.preventDefault();if(message.trim())send.mutate({leadId,text:message});}}><Input value={message} onChange={e=>setMessage(e.target.value)} maxLength={2000} placeholder="Responder ao cliente" className="bg-[#1A2332] text-white"/><Button disabled={!message.trim() || send.isPending}>Enviar</Button></form></div>
    </CardContent>
  </Card>;
}
