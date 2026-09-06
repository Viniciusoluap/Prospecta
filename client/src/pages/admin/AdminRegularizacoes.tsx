import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Building2, FileText, Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

const STATUSES = ["analysis", "documentation", "protocol", "registry", "completed", "cancelled"] as const;
type Status = (typeof STATUSES)[number];

const STATUS_LABELS: Record<Status, string> = {
  analysis: "Em análise",
  documentation: "Documentação",
  protocol: "Protocolado",
  registry: "Em cartório",
  completed: "Concluído",
  cancelled: "Cancelado",
};

const EMPTY_FORM = {
  clientName: "",
  clientPhone: "",
  type: "",
  address: "",
  registration: "",
  registryOffice: "",
  responsible: "",
  serviceValue: "0",
  expectedEndAt: "",
  description: "",
};

function currency(value: string | null) {
  return Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo"));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

export default function AdminRegularizacoes() {
  const [filter, setFilter] = useState<Status | "all">("all");
  const [selectedId, setSelectedId] = useState<number>();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [documentName, setDocumentName] = useState("");

  const listQuery = trpc.regularizacao.list.useQuery(filter === "all" ? undefined : { status: filter });
  const detailQuery = trpc.regularizacao.get.useQuery(
    { id: selectedId ?? 0 },
    { enabled: Boolean(selectedId) },
  );
  const utils = trpc.useUtils();

  const refresh = async () => {
    await Promise.all([
      utils.regularizacao.list.invalidate(),
      utils.regularizacao.get.invalidate(),
    ]);
  };

  const createMutation = trpc.regularizacao.create.useMutation({
    onSuccess: async record => {
      toast.success("Regularização criada");
      setSelectedId(record.id);
      setForm(EMPTY_FORM);
      setCreateOpen(false);
      await refresh();
    },
    onError: error => toast.error(error.message),
  });
  const updateMutation = trpc.regularizacao.update.useMutation({
    onSuccess: async () => { toast.success("Processo atualizado"); await refresh(); },
    onError: error => toast.error(error.message),
  });
  const createDocument = trpc.regularizacao.documents.create.useMutation({
    onSuccess: async () => { setDocumentName(""); toast.success("Documento incluído"); await refresh(); },
    onError: error => toast.error(error.message),
  });
  const updateDocument = trpc.regularizacao.documents.update.useMutation({
    onSuccess: refresh,
    onError: error => toast.error(error.message),
  });
  const uploadDocument = trpc.regularizacao.documents.upload.useMutation({
    onSuccess: async () => { toast.success("Arquivo enviado"); await refresh(); },
    onError: error => toast.error(error.message),
  });

  const records = listQuery.data ?? [];
  const totals = useMemo(() => ({
    active: records.filter(record => !["completed", "cancelled"].includes(record.status)).length,
    completed: records.filter(record => record.status === "completed").length,
    value: records.reduce((sum, record) => sum + Number(record.serviceValue), 0),
  }), [records]);
  const selected = detailQuery.data;

  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <header className="border-b border-[#C9A961]/20 bg-[#0F1923] px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin"><Button variant="ghost" size="icon" className="text-gray-300"><ArrowLeft /></Button></Link>
            <div><h1 className="text-2xl font-bold text-[#C9A961]">Regularizações</h1><p className="text-sm text-gray-400">Processos imobiliários e documentos</p></div>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button className="bg-[#C9A961] text-[#1A2332]"><Plus className="mr-2 h-4 w-4" />Novo processo</Button></DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto bg-[#1A2332] text-white">
              <DialogHeader><DialogTitle>Nova regularização</DialogTitle></DialogHeader>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Cliente"><Input value={form.clientName} onChange={e => setForm({ ...form, clientName: e.target.value })} /></Field>
                <Field label="Telefone"><Input value={form.clientPhone} onChange={e => setForm({ ...form, clientPhone: e.target.value })} /></Field>
                <Field label="Tipo"><Input placeholder="Usucapião, escritura..." value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} /></Field>
                <Field label="Responsável"><Input value={form.responsible} onChange={e => setForm({ ...form, responsible: e.target.value })} /></Field>
                <Field label="Matrícula"><Input value={form.registration} onChange={e => setForm({ ...form, registration: e.target.value })} /></Field>
                <Field label="Cartório"><Input value={form.registryOffice} onChange={e => setForm({ ...form, registryOffice: e.target.value })} /></Field>
                <Field label="Valor do serviço"><Input type="number" min="0" step="0.01" value={form.serviceValue} onChange={e => setForm({ ...form, serviceValue: e.target.value })} /></Field>
                <Field label="Previsão de conclusão"><Input type="date" value={form.expectedEndAt} onChange={e => setForm({ ...form, expectedEndAt: e.target.value })} /></Field>
                <div className="sm:col-span-2"><Field label="Endereço"><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></Field></div>
                <div className="sm:col-span-2"><Field label="Descrição"><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></Field></div>
              </div>
              <Button className="w-full bg-[#C9A961] text-[#1A2332]" disabled={createMutation.isPending} onClick={() => createMutation.mutate({
                clientName: form.clientName,
                clientPhone: form.clientPhone || null,
                type: form.type,
                address: form.address,
                registration: form.registration || null,
                registryOffice: form.registryOffice || null,
                responsible: form.responsible,
                serviceValue: Number(form.serviceValue || 0),
                expectedEndAt: form.expectedEndAt ? new Date(`${form.expectedEndAt}T12:00:00`) : null,
                description: form.description,
              })}>Salvar processo</Button>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Metric label="Processos ativos" value={String(totals.active)} />
          <Metric label="Concluídos" value={String(totals.completed)} />
          <Metric label="Valor contratado" value={currency(String(totals.value))} />
        </div>

        <div className="flex max-w-xs items-center gap-2">
          <Label>Status</Label>
          <Select value={filter} onValueChange={value => setFilter(value as Status | "all")}>
            <SelectTrigger className="bg-[#2C3E50]"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos</SelectItem>{STATUSES.map(status => <SelectItem key={status} value={status}>{STATUS_LABELS[status]}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <Card className="border-[#C9A961]/20 bg-[#2C3E50] text-white">
            <CardHeader><CardTitle>Processos</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {listQuery.isLoading && <p className="text-gray-400">Carregando...</p>}
              {!listQuery.isLoading && !records.length && <p className="text-gray-400">Nenhum processo encontrado.</p>}
              {records.map(record => (
                <button key={record.id} onClick={() => setSelectedId(record.id)} className={`w-full rounded-md border p-3 text-left ${selectedId === record.id ? "border-[#C9A961]" : "border-white/10"}`}>
                  <div className="flex items-start justify-between gap-2"><strong>{record.clientName}</strong><Badge variant="secondary">{STATUS_LABELS[record.status as Status] ?? record.status}</Badge></div>
                  <p className="mt-1 text-sm text-gray-400">{record.type} · {record.responsible}</p>
                  <p className="text-sm text-[#C9A961]">{currency(record.serviceValue)}</p>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="border-[#C9A961]/20 bg-[#2C3E50] text-white">
            <CardHeader><CardTitle>{selected ? selected.clientName : "Detalhes"}</CardTitle></CardHeader>
            <CardContent>
              {!selected && <p className="text-gray-400">Selecione um processo para acompanhar o workflow.</p>}
              {selected && (
                <div className="space-y-6">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><p className="text-xs text-gray-400">Imóvel</p><p>{selected.address}</p></div>
                    <div><p className="text-xs text-gray-400">Matrícula / cartório</p><p>{selected.registration || "—"} · {selected.registryOffice || "—"}</p></div>
                    <Field label="Etapa do processo">
                      <Select value={selected.status} onValueChange={status => updateMutation.mutate({ id: selected.id, status: status as Status })}>
                        <SelectTrigger className="bg-[#1A2332]"><SelectValue /></SelectTrigger>
                        <SelectContent>{STATUSES.map(status => <SelectItem key={status} value={status}>{STATUS_LABELS[status]}</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                    <Field label="Valor pago">
                      <Input className="bg-[#1A2332]" type="number" min="0" step="0.01" defaultValue={Number(selected.paidValue)} onBlur={event => updateMutation.mutate({ id: selected.id, paidValue: Number(event.target.value) })} />
                    </Field>
                  </div>

                  <section className="space-y-3">
                    <h2 className="flex items-center gap-2 font-semibold text-[#C9A961]"><FileText className="h-4 w-4" />Documentos</h2>
                    <div className="flex gap-2"><Input className="bg-[#1A2332]" placeholder="Nome do documento exigido" value={documentName} onChange={e => setDocumentName(e.target.value)} /><Button variant="outline" disabled={!documentName} onClick={() => createDocument.mutate({ regularizacaoId: selected.id, name: documentName })}><Plus className="h-4 w-4" /></Button></div>
                    {selected.documents.map(document => (
                      <div key={document.id} className="rounded-md border border-white/10 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div><p className="font-medium">{document.name}</p>{document.fileUrl && <a className="text-sm text-[#C9A961] underline" href={document.fileUrl} target="_blank" rel="noreferrer">Abrir arquivo</a>}</div>
                          <div className="flex items-center gap-2">
                            <Select value={document.status} onValueChange={status => updateDocument.mutate({ id: document.id, status: status as "pending" | "requested" | "received" | "approved" | "rejected" })}>
                              <SelectTrigger className="w-36 bg-[#1A2332]"><SelectValue /></SelectTrigger>
                              <SelectContent>{["pending", "requested", "received", "approved", "rejected"].map(status => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
                            </Select>
                            <label className="cursor-pointer rounded-md border border-white/20 p-2" title="Enviar arquivo"><Upload className="h-4 w-4" /><input className="hidden" type="file" accept="application/pdf,image/jpeg,image/png" onChange={async event => {
                              const file = event.target.files?.[0];
                              if (!file) return;
                              if (file.size > 10 * 1024 * 1024) return toast.error("O arquivo deve ter no máximo 10 MB");
                              uploadDocument.mutate({ id: document.id, fileName: file.name, mimeType: file.type as "application/pdf" | "image/jpeg" | "image/png", base64: await fileToBase64(file) });
                            }} /></label>
                          </div>
                        </div>
                      </div>
                    ))}
                  </section>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label>{label}</Label>{children}</div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <Card className="border-[#C9A961]/20 bg-[#2C3E50] text-white"><CardContent className="flex items-center gap-3 pt-6"><Building2 className="h-6 w-6 text-[#C9A961]" /><div><p className="text-xs text-gray-400">{label}</p><p className="text-xl font-bold">{value}</p></div></CardContent></Card>;
}
