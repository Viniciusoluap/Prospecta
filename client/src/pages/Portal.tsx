import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { CalendarDays, CheckCircle2, Download, FileText, Home, LogOut, MessageSquare, Send, Upload } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const nav = [
  ["/portal", "Início", Home], ["/portal/documentos", "Documentos", FileText],
  ["/portal/visitas", "Visitas", CalendarDays], ["/portal/acompanhamento", "Acompanhamento", CheckCircle2],
  ["/portal/chat", "Chat", MessageSquare],
] as const;

const date = (value: Date | string) => new Date(value).toLocaleString("pt-BR", { dateStyle: "medium", timeStyle: "short" });

export default function Portal() {
  const [path] = useLocation();
  const { user, logout } = useAuth();
  const dashboard = trpc.portal.dashboard.useQuery(undefined, { enabled: path === "/portal" });
  const activities = trpc.portal.activities.useQuery(undefined, { enabled: path.includes("acompanhamento") });
  const visits = trpc.portal.visits.useQuery(undefined, { enabled: path.includes("visitas") });
  const contracts = trpc.portal.contracts.useQuery(undefined, { enabled: path.includes("documentos") });
  const messages = trpc.portal.messages.useQuery(undefined, { enabled: path.includes("chat"), refetchInterval: 4000 });
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadContractId, setUploadContractId] = useState<number | null>(null);
  const send = trpc.portal.sendMessage.useMutation({ onSuccess: () => { setText(""); messages.refetch(); } });
  const upload = trpc.portal.uploadSignedContract.useMutation({
    onSuccess: () => { toast.success("Contrato assinado enviado"); contracts.refetch(); },
    onError: error => toast.error(error.message),
  });

  useEffect(() => { window.scrollTo(0, 0); }, [path]);

  async function onFile(file?: File) {
    if (!file || !uploadContractId) return;
    if (file.type !== "application/pdf" || file.size > 10 * 1024 * 1024) return toast.error("Envie um PDF de até 10 MiB");
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.onerror = reject; reader.readAsDataURL(file);
    });
    upload.mutate({ contractId: uploadContractId, fileName: file.name, mimeType: "application/pdf", base64 });
  }

  return <div className="min-h-screen bg-slate-100 text-[#1A2332]">
    <header className="bg-[#1A2332] text-white border-b-4 border-[#C9A961]">
      <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
        <div><div className="font-black text-xl text-[#C9A961]">PROSPECTA</div><div className="text-xs text-slate-400">Portal do Cliente</div></div>
        <Button variant="ghost" className="text-white" onClick={() => logout().then(() => location.assign("/login"))}><LogOut className="h-4 w-4 mr-2"/>Sair</Button>
      </div>
    </header>
    <nav className="bg-white border-b overflow-x-auto"><div className="max-w-6xl mx-auto px-4 flex min-w-max">
      {nav.map(([href,label,Icon]) => <Link key={href} href={href} className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 ${path === href ? "border-[#C9A961] text-[#1A2332]" : "border-transparent text-slate-500"}`}><Icon className="h-4 w-4"/>{label}</Link>)}
    </div></nav>
    <main className="max-w-6xl mx-auto p-4 md:p-8">
      {path === "/portal" && <div className="space-y-5">
        <Card className="bg-[#1A2332] text-white border-0"><CardContent className="p-6"><p className="text-sm text-slate-400">Bem-vindo de volta</p><h1 className="text-2xl font-bold text-[#C9A961]">{dashboard.data?.lead.name ?? user?.name}</h1><Badge className="mt-3 bg-[#C9A961] text-[#1A2332]">{dashboard.data?.lead.stage.replaceAll("_", " ")}</Badge></CardContent></Card>
        {dashboard.data?.project && <Card><CardHeader><CardTitle>{dashboard.data.project.title}</CardTitle></CardHeader><CardContent><div className="flex justify-between text-sm mb-2"><span>Andamento da obra</span><b>{dashboard.data.project.progress}%</b></div><div className="h-3 rounded bg-slate-200 overflow-hidden"><div className="h-full bg-[#C9A961]" style={{width:`${Math.min(100,Math.max(0,dashboard.data.project.progress))}%`}}/></div></CardContent></Card>}
        <Card><CardHeader><CardTitle>Última atualização</CardTitle></CardHeader><CardContent>{dashboard.data?.lastActivity ? <><p>{dashboard.data.lastActivity.description}</p><p className="text-sm text-slate-500 mt-2">{date(dashboard.data.lastActivity.createdAt)}</p></> : <p className="text-slate-500">As atualizações do seu processo aparecerão aqui.</p>}</CardContent></Card>
      </div>}
      {path.includes("acompanhamento") && <Section title="Acompanhamento"><div className="space-y-3">{activities.data?.map(a => <Card key={a.id}><CardContent className="p-4"><div className="flex justify-between gap-3"><p>{a.description}</p><Badge variant="outline">{a.type}</Badge></div><p className="text-xs text-slate-500 mt-2">{date(a.createdAt)}</p></CardContent></Card>)}{activities.data?.length === 0 && <Empty text="Nenhuma atualização publicada."/>}</div></Section>}
      {path.includes("visitas") && <Section title="Visitas"><div className="space-y-3">{visits.data?.map(({visit,property}) => <Card key={visit.id}><CardContent className="p-4"><div className="flex justify-between"><div><p className="font-bold">{date(visit.scheduledAt)}</p><p className="text-sm text-slate-500">{property ? `${property.titulo} — ${property.bairro ?? property.cidade}` : visit.visitType}</p>{visit.responsibleName && <p className="text-sm">Responsável: {visit.responsibleName}</p>}</div><Badge>{visit.status}</Badge></div></CardContent></Card>)}{visits.data?.length === 0 && <Empty text="Nenhuma visita registrada. Fale com sua equipe para agendar."/>}</div></Section>}
      {path.includes("documentos") && <Section title="Documentos e contratos"><div className="space-y-4">{contracts.data?.map(c => <Card key={c.id}><CardHeader><div className="flex justify-between"><CardTitle className="text-lg">Contrato {c.number}</CardTitle><Badge>{c.signatureStatus}</Badge></div></CardHeader><CardContent className="space-y-3">{c.documents.map(d => <a key={d.id} href={d.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm underline"><Download className="h-4 w-4"/>{d.name}</a>)}{c.signatureStatus === "solicitado" && <div className="rounded bg-amber-50 p-4 text-sm space-y-2"><p className="font-bold">Assine em 3 passos</p><p>1. Baixe o contrato. 2. Assine em <a className="underline" target="_blank" rel="noreferrer" href="https://assinador.iti.br">assinador.iti.br</a>. 3. Envie o PDF assinado.</p><Button size="sm" onClick={() => { setUploadContractId(c.id); fileRef.current?.click(); }} disabled={upload.isPending}><Upload className="h-4 w-4 mr-2"/>Enviar PDF</Button></div>}</CardContent></Card>)}{contracts.data?.length === 0 && <Empty text="Nenhum documento disponível."/>}<input ref={fileRef} hidden type="file" accept="application/pdf" onChange={e => onFile(e.target.files?.[0])}/></div></Section>}
      {path.includes("chat") && <Section title="Chat com a equipe"><Card><CardContent className="p-4"><div className="h-[420px] overflow-y-auto space-y-3 mb-4">{messages.data?.map(m => <div key={m.id} className={`max-w-[80%] rounded-lg p-3 ${m.sender === "cliente" ? "ml-auto bg-[#1A2332] text-white" : "bg-slate-100"}`}><p>{m.text}</p><p className="text-[10px] opacity-60 mt-1">{date(m.createdAt)}</p></div>)}</div><form className="flex gap-2" onSubmit={e => { e.preventDefault(); if(text.trim()) send.mutate({text}); }}><Input maxLength={2000} value={text} onChange={e=>setText(e.target.value)} placeholder="Digite sua mensagem"/><Button disabled={!text.trim() || send.isPending}><Send className="h-4 w-4"/></Button></form></CardContent></Card></Section>}
    </main>
  </div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) { return <div><h1 className="text-2xl font-black mb-5">{title}</h1>{children}</div>; }
function Empty({ text }: { text: string }) { return <Card><CardContent className="p-10 text-center text-slate-500">{text}</CardContent></Card>; }
