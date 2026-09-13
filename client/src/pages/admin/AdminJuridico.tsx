import { FormEvent, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, FileText, MessageSquare, Paperclip, Plus, Scale, Send, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ASSINATURA_STATUS, CONTRATO_STATUS, CONTRATO_TIPOS, ContratoInput } from "../../../../shared/juridico";

const labels: Record<string, string> = {
  compra_venda: "Compra e venda", construcao: "Construção", prestacao_servicos: "Prestação de serviços",
  corretagem: "Corretagem", locacao: "Locação", permuta: "Permuta", consultoria_juridica: "Consultoria jurídica", outro: "Outro",
};
const money = (value: string | number | null | undefined) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
const optionalId = (value: FormDataEntryValue | null) => value && value !== "none" ? Number(value) : null;

export default function AdminJuridico() {
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<"contratos" | "chat">("contratos");
  const [formOpen, setFormOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [chatLeadId, setChatLeadId] = useState<number | null>(null);
  const { data: contracts = [] } = trpc.juridico.list.useQuery({});
  const { data: options } = trpc.juridico.options.useQuery();
  const { data: detail } = trpc.juridico.getById.useQuery({ id: selectedId || 0 }, { enabled: !!selectedId });
  const { data: chats = [] } = trpc.juridico.chats.useQuery(undefined, { enabled: tab === "chat" });
  const invalidate = async () => Promise.all([utils.juridico.list.invalidate(), utils.juridico.getById.invalidate(), utils.juridico.chats.invalidate()]);
  const criar = trpc.juridico.create.useMutation({ onSuccess: async item => { await invalidate(); setFormOpen(false); setSelectedId(item.id); toast.success("Contrato criado"); }, onError: e => toast.error(e.message) });
  const atualizar = trpc.juridico.update.useMutation({ onSuccess: async () => { await invalidate(); setFormOpen(false); toast.success("Contrato atualizado"); }, onError: e => toast.error(e.message) });
  const status = trpc.juridico.setStatus.useMutation({ onSuccess: invalidate, onError: e => toast.error(e.message) });
  const excluir = trpc.juridico.delete.useMutation({ onSuccess: async () => { await invalidate(); setSelectedId(null); toast.success("Contrato excluído"); }, onError: e => toast.error(e.message) });
  const upload = trpc.juridico.uploadDocument.useMutation({ onSuccess: async () => { await invalidate(); toast.success("Documento anexado"); }, onError: e => toast.error(e.message) });
  const deleteDocument = trpc.juridico.deleteDocument.useMutation({ onSuccess: invalidate, onError: e => toast.error(e.message) });
  const send = trpc.juridico.sendMessage.useMutation({ onSuccess: invalidate, onError: e => toast.error(e.message) });

  const chatLeads = useMemo(() => {
    const ids = new Set(chats.map(item => item.message.leadId));
    return (options?.leads || []).filter(lead => ids.has(lead.id) || lead.id === chatLeadId);
  }, [chats, options, chatLeadId]);
  const activeChat = chats.filter(item => item.message.leadId === chatLeadId);
  const totalActive = contracts.filter(item => item.contract.status === "ativo").reduce((sum, item) => sum + Number(item.contract.value), 0);

  function payload(form: HTMLFormElement): ContratoInput {
    const data = new FormData(form);
    return {
      number: String(data.get("number") || "") || undefined,
      type: String(data.get("type")) as ContratoInput["type"], status: String(data.get("status")) as ContratoInput["status"],
      partyA: String(data.get("partyA") || ""), partyADocument: String(data.get("partyADocument") || "") || null,
      partyB: String(data.get("partyB") || ""), partyBDocument: String(data.get("partyBDocument") || "") || null,
      leadId: optionalId(data.get("leadId")), propertyId: optionalId(data.get("propertyId")), value: Number(data.get("value") || 0),
      dueAt: data.get("dueAt") ? new Date(String(data.get("dueAt")) + "T12:00:00") : null,
      description: String(data.get("description") || ""), clauses: String(data.get("clauses") || ""),
      signatureStatus: String(data.get("signatureStatus")) as ContratoInput["signatureStatus"],
    };
  }

  async function handlePdf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!detail) return;
    const data = new FormData(event.currentTarget); const file = data.get("file");
    if (!(file instanceof File)) return;
    const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(file); });
    upload.mutate({ contractId: detail.contract.id, name: file.name, type: String(data.get("type")) as "anexo" | "assinado" | "contrato_gerado", base64 });
    event.currentTarget.reset();
  }

  return <div className="min-h-screen bg-[#1A2332] text-white">
    <header className="border-b border-[#C9A961]/20 bg-[#0F1923] px-4 py-4 md:px-6"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3"><Link href="/admin"><Button variant="ghost" size="icon"><ArrowLeft /></Button></Link><Scale className="text-[#C9A961]" /><div><h1 className="text-2xl font-bold text-[#C9A961]">Jurídico</h1><p className="text-sm text-gray-400">Contratos, documentos, assinatura e atendimento</p></div></div>
      <Button onClick={() => { setSelectedId(null); setFormOpen(true); }} className="bg-[#C9A961] font-bold text-[#1A2332]"><Plus className="mr-2 h-4 w-4" /> Novo contrato</Button>
    </div></header>
    <main className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <div className="grid gap-3 sm:grid-cols-3">{[["Contratos", contracts.length], ["Ativos", contracts.filter(x => x.contract.status === "ativo").length], ["Valor em carteira", money(totalActive)]].map(([label, value]) => <Card key={label} className="border-[#C9A961]/20 bg-[#2C3E50]"><CardContent className="pt-5"><p className="text-sm text-gray-400">{label}</p><p className="text-2xl font-bold text-[#C9A961]">{value}</p></CardContent></Card>)}</div>
      <div className="flex gap-2"><Button variant={tab === "contratos" ? "default" : "outline"} onClick={() => setTab("contratos")}><FileText className="mr-2 h-4 w-4" />Contratos</Button><Button variant={tab === "chat" ? "default" : "outline"} onClick={() => setTab("chat")}><MessageSquare className="mr-2 h-4 w-4" />Atendimento</Button></div>
      {tab === "contratos" ? <Card className="border-[#C9A961]/20 bg-[#2C3E50]"><CardContent className="space-y-2 pt-6">{contracts.length === 0 ? <p className="py-10 text-center text-gray-500">Nenhum contrato cadastrado</p> : contracts.map(({ contract, leadName, propertyTitle }) => <button key={contract.id} onClick={() => setSelectedId(contract.id)} className="grid w-full gap-2 rounded-lg bg-[#1A2332] p-4 text-left hover:ring-1 hover:ring-[#C9A961]/50 md:grid-cols-4">
        <div><p className="font-semibold">{contract.number}</p><p className="text-xs text-gray-400">{labels[contract.type] || contract.type}</p></div><div><p>{contract.partyA || leadName || "Parte não informada"}</p><p className="text-xs text-gray-500">{propertyTitle || "Sem imóvel"}</p></div><div><p className="text-[#C9A961]">{money(contract.value)}</p><p className="text-xs capitalize text-gray-500">{contract.status}</p></div><div><p className="text-sm">Assinatura: {contract.signatureStatus}</p></div>
      </button>)}</CardContent></Card> : <div className="grid gap-4 md:grid-cols-[280px_1fr]"><Card className="border-[#C9A961]/20 bg-[#2C3E50]"><CardContent className="space-y-2 pt-6"><Select value={chatLeadId ? String(chatLeadId) : undefined} onValueChange={v => setChatLeadId(Number(v))}><SelectTrigger><SelectValue placeholder="Selecionar cliente" /></SelectTrigger><SelectContent>{(options?.leads || []).map(lead => <SelectItem key={lead.id} value={String(lead.id)}>{lead.name}</SelectItem>)}</SelectContent></Select>{chatLeads.map(lead => <Button key={lead.id} variant="ghost" className="w-full justify-start" onClick={() => setChatLeadId(lead.id)}>{lead.name}</Button>)}</CardContent></Card><Card className="border-[#C9A961]/20 bg-[#2C3E50]"><CardContent className="pt-6"><div className="mb-4 h-[360px] space-y-2 overflow-y-auto rounded bg-[#1A2332] p-3">{activeChat.map(({ message }) => <div key={message.id} className={`max-w-[80%] rounded p-2 text-sm ${message.sender === "cliente" ? "bg-slate-700" : "ml-auto bg-[#C9A961] text-[#1A2332]"}`}><p>{message.text}</p><p className="mt-1 text-[10px] opacity-60">{new Date(message.createdAt).toLocaleString("pt-BR")}</p></div>)}</div><form onSubmit={event => { event.preventDefault(); if (!chatLeadId) return; const data = new FormData(event.currentTarget); send.mutate({ leadId: chatLeadId, text: String(data.get("text")) }); event.currentTarget.reset(); }} className="flex gap-2"><Input name="text" required placeholder="Mensagem ao cliente" /><Button type="submit" disabled={!chatLeadId}><Send className="h-4 w-4" /></Button></form></CardContent></Card></div>}
    </main>

    <Dialog open={formOpen} onOpenChange={setFormOpen}><DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto border-[#C9A961]/30 bg-[#1A2332] text-white"><DialogHeader><DialogTitle>{detail ? "Editar contrato" : "Novo contrato"}</DialogTitle></DialogHeader><ContractForm initial={detail?.contract} options={options} onSubmit={event => { event.preventDefault(); const data = payload(event.currentTarget); detail ? atualizar.mutate({ id: detail.contract.id, data }) : criar.mutate(data); }} /></DialogContent></Dialog>
    <Dialog open={!!detail && !formOpen} onOpenChange={open => !open && setSelectedId(null)}><DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto border-[#C9A961]/30 bg-[#1A2332] text-white">{detail && <><DialogHeader><DialogTitle>{detail.contract.number}</DialogTitle></DialogHeader><div className="grid gap-3 rounded bg-[#2C3E50] p-4 sm:grid-cols-3"><div><p className="text-xs text-gray-400">Parte A</p><p>{detail.contract.partyA || "—"}</p></div><div><p className="text-xs text-gray-400">Parte B</p><p>{detail.contract.partyB || "—"}</p></div><div><p className="text-xs text-gray-400">Valor</p><p>{money(detail.contract.value)}</p></div></div>
      <div className="grid gap-3 sm:grid-cols-2"><div><Label>Status</Label><Select value={detail.contract.status} onValueChange={value => status.mutate({ id: detail.contract.id, status: value as typeof CONTRATO_STATUS[number] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CONTRATO_STATUS.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></div><div><Label>Assinatura</Label><Select value={detail.contract.signatureStatus} onValueChange={value => status.mutate({ id: detail.contract.id, signatureStatus: value as typeof ASSINATURA_STATUS[number] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ASSINATURA_STATUS.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></div></div>
      <div><h3 className="mb-2 font-semibold text-[#C9A961]">Documentos</h3>{detail.documents.map(doc => <div key={doc.id} className="flex items-center justify-between rounded bg-[#2C3E50] p-2"><a href={doc.url} target="_blank" rel="noreferrer" className="text-sm underline">{doc.name} · {doc.type}</a><Button size="icon" variant="ghost" onClick={() => deleteDocument.mutate({ id: doc.id })}><Trash2 className="h-4 w-4 text-red-400" /></Button></div>)}<form onSubmit={handlePdf} className="mt-3 flex flex-wrap gap-2"><Input name="file" type="file" accept="application/pdf" required className="flex-1" /><Select name="type" defaultValue="anexo"><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="anexo">Anexo</SelectItem><SelectItem value="contrato_gerado">Contrato gerado</SelectItem><SelectItem value="assinado">Assinado</SelectItem></SelectContent></Select><Button type="submit"><Paperclip className="mr-2 h-4 w-4" />Anexar</Button></form></div>
      <div className="flex gap-2"><Button onClick={() => setFormOpen(true)} className="flex-1 bg-[#C9A961] text-[#1A2332]">Editar contrato</Button><Button variant="destructive" onClick={() => confirm("Excluir contrato e documentos?") && excluir.mutate({ id: detail.contract.id })}><Trash2 className="h-4 w-4" /></Button></div>
    </>}</DialogContent></Dialog>
  </div>;
}

function ContractForm({ initial, options, onSubmit }: { initial?: any; options?: any; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const date = initial?.dueAt ? new Date(initial.dueAt).toISOString().slice(0, 10) : "";
  return <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2"><Field name="number" label="Número (automático se vazio)" defaultValue={initial?.number || ""} /><div><Label>Tipo</Label><Select name="type" defaultValue={initial?.type || CONTRATO_TIPOS[0]}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CONTRATO_TIPOS.map(v => <SelectItem key={v} value={v}>{labels[v]}</SelectItem>)}</SelectContent></Select></div><div><Label>Status</Label><Select name="status" defaultValue={initial?.status || "rascunho"}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CONTRATO_STATUS.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></div><div><Label>Assinatura</Label><Select name="signatureStatus" defaultValue={initial?.signatureStatus || "pendente"}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ASSINATURA_STATUS.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></div>
    <Field name="partyA" label="Parte A" defaultValue={initial?.partyA || "Prospecta Construções"} required /><Field name="partyADocument" label="CPF/CNPJ Parte A" defaultValue={initial?.partyADocument || ""} /><Field name="partyB" label="Parte B" defaultValue={initial?.partyB || ""} required /><Field name="partyBDocument" label="CPF/CNPJ Parte B" defaultValue={initial?.partyBDocument || ""} />
    <div><Label>Cliente/lead</Label><Select name="leadId" defaultValue={initial?.leadId ? String(initial.leadId) : "none"}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Sem vínculo</SelectItem>{(options?.leads || []).map((x: any) => <SelectItem key={x.id} value={String(x.id)}>{x.name}</SelectItem>)}</SelectContent></Select></div><div><Label>Imóvel</Label><Select name="propertyId" defaultValue={initial?.propertyId ? String(initial.propertyId) : "none"}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Sem vínculo</SelectItem>{(options?.properties || []).map((x: any) => <SelectItem key={x.id} value={String(x.id)}>{x.title}</SelectItem>)}</SelectContent></Select></div>
    <Field name="value" label="Valor" type="number" defaultValue={String(initial?.value || 0)} required /><Field name="dueAt" label="Vencimento" type="date" defaultValue={date} /><div className="md:col-span-2"><Label>Descrição</Label><Textarea name="description" defaultValue={initial?.description || ""} /></div><div className="md:col-span-2"><Label>Cláusulas</Label><Textarea name="clauses" rows={6} defaultValue={initial?.clauses || ""} /></div><Button type="submit" className="md:col-span-2 bg-[#C9A961] text-[#1A2332]">Salvar contrato</Button></form>;
}
function Field({ name, label, type = "text", defaultValue, required }: { name: string; label: string; type?: string; defaultValue?: string; required?: boolean }) { return <div><Label htmlFor={name}>{label}</Label><Input id={name} name={name} type={type} defaultValue={defaultValue} required={required} min={type === "number" ? 0 : undefined} step={type === "number" ? "0.01" : undefined} className="mt-1" /></div>; }
