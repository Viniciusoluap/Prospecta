import { useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { CalendarDays, ExternalLink, FileText, KeyRound, MessageSquare, Paperclip, Send } from "lucide-react";
import { CONTRATO_TIPOS } from "@shared/juridico";
import { VISIT_TYPES } from "@shared/operacional";
import { rotulo } from "@shared/rotulos";
import { mutarComProgresso } from "@/lib/envio-progresso";

const campo = "bg-[#1A2332] text-white placeholder:text-gray-400 border-[#C9A961]/30";
const seletor = "h-9 w-full rounded-md border border-[#C9A961]/30 bg-[#1A2332] px-2 text-sm text-white";
const botaoClaro = "border-[#C9A961] bg-transparent text-[#C9A961] hover:bg-[#C9A961] hover:text-[#1A2332]";

function lerBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Falha na leitura do arquivo"));
    reader.readAsDataURL(file);
  });
}

export function AdminPortalLeadPanel({ leadId, defaultEmail }: { leadId: number; defaultEmail?: string | null }) {
  const overview = trpc.portal.admin.overview.useQuery({ leadId });
  const opcoes = trpc.agenda.options.useQuery();
  const utils = trpc.useUtils();
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [password, setPassword] = useState("");
  // Item 10 (18/10): "Agendamento de visita" cria o compromisso na Agenda do sistema
  // (mesmo registro: o que muda lá aparece aqui e vice-versa).
  const [visita, setVisita] = useState({ quando: "", responsavel: "", corretor: "", tipo: "imovel", observacoes: "" });
  // Item 11 (18/10): contrato nasce no Jurídico, vinculado ao lead.
  const [contrato, setContrato] = useState<{ tipo: (typeof CONTRATO_TIPOS)[number]; valor: string }>({ tipo: "construcao", valor: "" });
  const [anexando, setAnexando] = useState<number | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");

  const recarregar = async () => {
    await Promise.all([overview.refetch(), utils.agenda.list.invalidate(), utils.juridico.list.invalidate()]);
  };
  const provision = trpc.portal.admin.provisionAccess.useMutation({ onSuccess: () => { toast.success("Acesso do cliente atualizado"); setPassword(""); overview.refetch(); }, onError: e => toast.error(e.message) });
  const agendar = trpc.agenda.create.useMutation({
    onSuccess: async () => {
      toast.success("Visita agendada e incluída na Agenda");
      setVisita({ quando: "", responsavel: "", corretor: "", tipo: "imovel", observacoes: "" });
      await recarregar();
    },
    onError: e => toast.error(e.message),
  });
  const criarContrato = trpc.juridico.createFromLead.useMutation({
    onSuccess: async created => {
      toast.success(`Contrato ${created.number} criado no Jurídico`);
      setContrato({ tipo: "construcao", valor: "" });
      await recarregar();
    },
    onError: e => toast.error(e.message),
  });
  const assinatura = trpc.juridico.setStatus.useMutation({ onSuccess: async () => { toast.success("Assinatura solicitada"); await recarregar(); }, onError: e => toast.error(e.message) });
  const send = trpc.portal.admin.sendMessage.useMutation({ onSuccess: () => { setMessage(""); overview.refetch(); }, onError: e => toast.error(e.message) });

  const nomeCorretor = (id: number | null) => opcoes.data?.brokers.find(b => b.id === id)?.name ?? null;

  async function anexarPdf(file?: File) {
    if (arquivoRef.current) arquivoRef.current.value = "";
    const contractId = anexando;
    if (!file || !contractId) return;
    if (file.type !== "application/pdf" || file.size > 3 * 1024 * 1024) {
      toast.error("Envie um PDF de até 3 MiB");
      return;
    }
    try {
      await mutarComProgresso("juridico.uploadDocument", { contractId, name: file.name, type: "contrato_gerado", base64: await lerBase64(file) }, { item: "PDF" });
      toast.success("PDF anexado ao contrato");
      await Promise.all([recarregar(), utils.juridico.getById.invalidate()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao anexar o PDF");
    } finally {
      setAnexando(null);
    }
  }

  return <Card className="bg-[#2C3E50] border-[#C9A961]/20">
    <CardHeader><CardTitle className="text-[#C9A961] text-sm">Portal do Cliente</CardTitle></CardHeader>
    <CardContent className="space-y-6 text-white">
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-2">
          <Label className="text-gray-200 flex gap-2"><KeyRound className="h-4 w-4"/>Acesso</Label>
          <Input aria-label="E-mail de acesso do cliente" value={email} onChange={e=>setEmail(e.target.value)} placeholder="cliente@email.com" className={campo}/>
          <Input aria-label="Senha inicial" value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="Senha (mín. 8)" className={campo}/>
          <Button size="sm" disabled={!email || password.length<8 || provision.isPending} onClick={()=>provision.mutate({leadId,email,password})}>Provisionar</Button>
          <p className="text-xs text-gray-300">Nome e telefone da conta vêm do cadastro deste cliente no CRM.</p>
          {overview.data?.account && <p className="text-xs text-green-300">Ativo: {overview.data.account.email}</p>}
        </div>

        <div className="space-y-2">
          <Label className="text-gray-200 flex gap-2"><CalendarDays className="h-4 w-4"/>Agendamento de visita</Label>
          <Input aria-label="Data e hora da visita" value={visita.quando} onChange={e=>setVisita({...visita,quando:e.target.value})} type="datetime-local" className={campo}/>
          <select aria-label="Responsável pela visita" value={visita.responsavel} onChange={e=>setVisita({...visita,responsavel:e.target.value})} className={seletor}>
            <option value="">Responsável…</option>
            {opcoes.data?.responsibles.map(r => <option key={r.id} value={r.id}>{r.name || `Usuário #${r.id}`}</option>)}
          </select>
          <select aria-label="Corretor da visita" value={visita.corretor} onChange={e=>setVisita({...visita,corretor:e.target.value})} className={seletor}>
            <option value="">Corretor (opcional)</option>
            {opcoes.data?.brokers.map(b => <option key={b.id} value={b.id}>{b.name || `Corretor #${b.id}`}</option>)}
          </select>
          <select aria-label="Tipo de visita" value={visita.tipo} onChange={e=>setVisita({...visita,tipo:e.target.value})} className={seletor}>
            {VISIT_TYPES.map(t => <option key={t} value={t}>{rotulo(t)}</option>)}
          </select>
          <Textarea aria-label="Observações da visita" value={visita.observacoes} onChange={e=>setVisita({...visita,observacoes:e.target.value})} placeholder="Observações" rows={2} className={campo}/>
          <Button size="sm" disabled={!visita.quando || agendar.isPending} onClick={()=>agendar.mutate({
            leadId, propertyId: null, brokerId: visita.corretor ? Number(visita.corretor) : null,
            clientName: "", clientPhone: "", scheduledAt: new Date(visita.quando), status: "agendada",
            visitType: visita.tipo as (typeof VISIT_TYPES)[number],
            responsibleId: visita.responsavel ? Number(visita.responsavel) : null, notes: visita.observacoes,
          })}>Agendar visita</Button>
        </div>

        <div className="space-y-2">
          <Label className="text-gray-200 flex gap-2"><FileText className="h-4 w-4"/>Contrato (Jurídico)</Label>
          <select aria-label="Tipo de contrato" value={contrato.tipo} onChange={e=>setContrato({...contrato,tipo:e.target.value as (typeof CONTRATO_TIPOS)[number]})} className={seletor}>
            {CONTRATO_TIPOS.map(t => <option key={t} value={t}>{rotulo(t)}</option>)}
          </select>
          <Input aria-label="Valor do contrato" inputMode="decimal" value={contrato.valor} onChange={e=>setContrato({...contrato,valor:e.target.value})} placeholder="Valor (opcional)" className={campo}/>
          <Button size="sm" disabled={criarContrato.isPending} onClick={()=>criarContrato.mutate({ leadId, type: contrato.tipo, value: Number(contrato.valor.replace(/\./g,"").replace(",",".")) || 0 })}>Criar contrato no Jurídico</Button>
          <p className="text-xs text-gray-300">Número do Jurídico e dados do cliente preenchidos automaticamente.</p>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[#C9A961]">Visitas agendadas</h3>
        {overview.data?.visits.length ? overview.data.visits.map(v => (
          <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-[#1A2332] p-3 text-sm">
            <div className="min-w-0">
              <p className="font-semibold">{new Date(v.scheduledAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · {rotulo(v.visitType)}</p>
              <p className="text-xs text-gray-300 break-words">
                {[v.responsibleName && `Responsável: ${v.responsibleName}`, nomeCorretor(v.brokerId) && `Corretor: ${nomeCorretor(v.brokerId)}`, v.notes].filter(Boolean).join(" · ") || "Sem observações"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-white/10 px-2 py-0.5 text-xs">{rotulo(v.status)}</span>
              <Link href="/admin/agenda" className="inline-flex items-center gap-1 text-xs text-[#C9A961] underline"><ExternalLink className="h-3 w-3"/>Abrir na Agenda</Link>
            </div>
          </div>
        )) : <p className="text-xs text-gray-300">Nenhuma visita agendada.</p>}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[#C9A961]">Contratos do cliente</h3>
        {overview.data?.contracts.length ? overview.data.contracts.map(c => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-[#1A2332] p-3 text-sm">
            <div className="min-w-0">
              <p className="font-semibold break-words">{c.number} · {rotulo(c.type)}</p>
              <p className="text-xs text-gray-300">Situação: {rotulo(c.status)} · Assinatura: {rotulo(c.signatureStatus)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/admin/juridico?contrato=${c.id}`}><Button size="sm" variant="outline" className={botaoClaro}><ExternalLink className="mr-1 h-3 w-3"/>Abrir no Jurídico</Button></Link>
              <Button size="sm" variant="outline" className={botaoClaro} disabled={assinatura.isPending || c.signatureStatus === "assinado" || c.signatureStatus === "solicitado"} onClick={()=>assinatura.mutate({ id: c.id, signatureStatus: "solicitado" })}>
                {c.signatureStatus === "solicitado" ? "Assinatura solicitada" : "Solicitar assinatura"}
              </Button>
              <Button size="sm" variant="outline" className={botaoClaro} disabled={anexando !== null} onClick={()=>{ setAnexando(c.id); arquivoRef.current?.click(); }}>
                <Paperclip className="mr-1 h-3 w-3"/>Anexar PDF
              </Button>
            </div>
          </div>
        )) : <p className="text-xs text-gray-300">Nenhum contrato para este cliente. Contratos criados no Jurídico para ele também aparecem aqui.</p>}
        <input ref={arquivoRef} type="file" accept="application/pdf" className="sr-only" aria-label="Selecionar PDF do contrato" onChange={e => void anexarPdf(e.target.files?.[0])} />
      </div>

      <div><Label className="text-gray-200 flex gap-2 mb-2"><MessageSquare className="h-4 w-4"/>Chat</Label><div className="max-h-48 overflow-y-auto bg-[#1A2332] rounded p-3 space-y-2">{overview.data?.messages.map(m=><div key={m.id} className={`text-sm ${m.sender === "cliente" ? "text-white" : "text-[#C9A961]"}`}><b>{m.sender === "cliente" ? "Cliente" : "Equipe"}:</b> {m.text}</div>)}{overview.data?.messages.length===0&&<p className="text-xs text-gray-300">Sem mensagens.</p>}</div><form className="flex gap-2 mt-2" onSubmit={e=>{e.preventDefault();if(message.trim())send.mutate({leadId,text:message});}}><Input value={message} onChange={e=>setMessage(e.target.value)} maxLength={2000} placeholder="Responder ao cliente" className={campo}/><Button disabled={!message.trim() || send.isPending} aria-label="Enviar mensagem"><Send className="h-4 w-4"/></Button></form></div>
    </CardContent>
  </Card>;
}
