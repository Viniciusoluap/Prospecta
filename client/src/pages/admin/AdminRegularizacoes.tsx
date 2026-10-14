import { AcoesExcluir } from "@/components/AcoesExcluir";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Building2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { formatCurrency } from "@/lib/format";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { LinkedServiceQueue } from "./LinkedServiceQueue";
import { EtapasProcesso, FinanceiroRegularizacaoTabela } from "@/components/regularizacao/ProcessoRegularizacao";
import { STATUS_PROCESSO, rotuloStatusProcesso, type StatusProcesso } from "@shared/financeiro/regularizacao";

// EPIC-020 Lote 6 (30): Status do Processo com 3 opções, independente das etapas.
const STATUSES = STATUS_PROCESSO;
type Status = StatusProcesso;

// EPIC-017 (story 1.3): processos nascem do vínculo no CRM; aqui o profissional
// completa apenas os dados técnicos. Cliente e telefone vêm do lead.
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
  return formatCurrency(Number(value ?? 0));
}

export default function AdminRegularizacoes() {
  const [filter, setFilter] = useState<Status | "all">("all");
  const [selectedId, setSelectedId] = useState<number>();
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

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

  const removeMutation = trpc.regularizacao.remove.useMutation();
  const updateMutation = trpc.regularizacao.update.useMutation({
    onSuccess: async () => { toast.success("Processo atualizado"); setEditOpen(false); await refresh(); },
    onError: error => toast.error(error.message),
  });

  const records = listQuery.data ?? [];
  const totals = useMemo(() => ({
    active: records.filter(record => !["concluido", "cancelado"].includes(record.status)).length,
    completed: records.filter(record => record.status === "concluido").length,
    value: records.reduce((sum, record) => sum + Number(record.serviceValue), 0),
  }), [records]);
  const selected = detailQuery.data;

  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <header className="border-b border-[#C9A961]/20 bg-[#0F1923] px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <Link href="/admin"><Button variant="ghost" className="w-fit gap-2 text-gray-200 hover:text-white"><ArrowLeft className="h-4 w-4" />Voltar</Button></Link>
            <div className="min-w-0"><h1 className="text-2xl font-bold text-[#C9A961]">Regularizações</h1><p className="text-sm text-gray-400">Processos imobiliários, etapas e financeiro</p></div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <LinkedServiceQueue module="regularizacoes" title="Regularizações" onRecordsCreated={() => void refresh()} />
        <p className="rounded-md border border-white/10 bg-[#243345] p-3 text-sm text-gray-200">
          Novos processos nascem do CRM: no cadastro do lead, vincule o serviço “Regularização imobiliária”.
          O processo aparece aqui com os dados do cliente; complete tipo, responsável, matrícula e valor do serviço em “Editar dados do processo”.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Metric label="Processos ativos" value={String(totals.active)} />
          <Metric label="Concluídos" value={String(totals.completed)} />
          <Metric label="Valor contratado" value={currency(String(totals.value))} />
        </div>

        <div className="flex max-w-xs items-center gap-2">
          <Label>Status</Label>
          <Select value={filter} onValueChange={value => setFilter(value as Status | "all")}>
            <SelectTrigger className="bg-[#2C3E50]"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos</SelectItem>{STATUSES.map(status => <SelectItem key={status} value={status}>{rotuloStatusProcesso(status)}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <Card className="border-[#C9A961]/20 bg-[#2C3E50] text-white">
            <CardHeader><CardTitle>Processos</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {listQuery.isLoading && <p className="text-gray-300">Carregando...</p>}
              {!listQuery.isLoading && !records.length && <p className="text-gray-300">Nenhum processo encontrado.</p>}
              {records.map(record => (
                <div key={record.id}>
                <button key={record.id} onClick={() => setSelectedId(record.id)} className={`w-full rounded-md border p-3 text-left ${selectedId === record.id ? "border-[#C9A961]" : "border-white/10"}`}>
                  <div className="flex items-start justify-between gap-2"><strong>{record.clientName}</strong><Badge variant="secondary">{rotuloStatusProcesso(record.status)}</Badge></div>
                  {!record.type.trim() || !record.responsible.trim()
                    ? <p className="mt-1 text-sm font-semibold text-amber-300">Aguardando dados técnicos</p>
                    : <p className="mt-1 text-sm text-gray-300">{record.type} · {record.responsible}</p>}
                  <p className="text-sm text-[#C9A961]">{currency(record.serviceValue)}</p>
                </button>
                <div className="flex flex-wrap items-center justify-between gap-2 py-1">
                  {record.leadId ? <Link href={`/admin/crm/${record.leadId}`} className="text-sm text-[#E6CA88] underline">Abrir cadastro CRM</Link> : <span />}
                  <AcoesExcluir compacto rotulo={record.clientName}
                    onExcluir={async () => { await removeMutation.mutateAsync({ id: record.id }); if (selectedId === record.id) setSelectedId(undefined); await listQuery.refetch(); }} />
                </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-[#C9A961]/20 bg-[#2C3E50] text-white">
            <CardHeader><CardTitle>{selected ? selected.clientName : "Detalhes"}</CardTitle></CardHeader>
            <CardContent>
              {!selected && <p className="text-gray-300">Selecione um processo para acompanhar o workflow.</p>}
              {selected && (
                <div className="space-y-6">
                  <Button
                    variant="outline"
                    className="gap-2 border-[#C9A961]/60 text-[#E6CA88]"
                    onClick={() => {
                      setForm({
                        clientName: selected.clientName,
                        clientPhone: selected.clientPhone ?? "",
                        type: selected.type,
                        address: selected.address,
                        registration: selected.registration ?? "",
                        registryOffice: selected.registryOffice ?? "",
                        responsible: selected.responsible,
                        serviceValue: String(Number(selected.serviceValue)),
                        expectedEndAt: selected.expectedEndAt ? new Date(selected.expectedEndAt).toISOString().slice(0, 10) : "",
                        description: selected.description,
                      });
                      setEditOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />Editar dados do processo
                  </Button>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><p className="text-xs text-gray-300">Cliente</p><p>{selected.clientName}{selected.clientPhone ? ` · ${selected.clientPhone}` : ""}</p></div>
                    <div><p className="text-xs text-gray-300">Tipo / responsável</p><p>{selected.type || "—"} · {selected.responsible || "—"}</p></div>
                    <div><p className="text-xs text-gray-300">Imóvel</p><p>{selected.address || "—"}</p></div>
                    <div><p className="text-xs text-gray-300">Matrícula / cartório</p><p>{selected.registration || "—"} · {selected.registryOffice || "—"}</p></div>
                    <Field label="Status do processo">
                      <Select value={selected.status} onValueChange={status => updateMutation.mutate({ id: selected.id, status: status as Status })}>
                        <SelectTrigger className="bg-[#1A2332]"><SelectValue>{rotuloStatusProcesso(selected.status)}</SelectValue></SelectTrigger>
                        <SelectContent>{STATUSES.map(status => <SelectItem key={status} value={status}>{rotuloStatusProcesso(status)}</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                  </div>

                  <EtapasProcesso regularizacaoId={selected.id} etapas={selected.etapas} progressoEtapas={selected.progressoEtapas} onMudou={() => void refresh()} />
                  <FinanceiroRegularizacaoTabela
                    regularizacaoId={selected.id}
                    financeiro={selected.financeiro}
                    recebimentos={selected.recebimentos}
                    itensComRecebimento={selected.itensComRecebimento}
                    onMudou={() => void refresh()}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto bg-[#1A2332] text-white">
          <DialogHeader><DialogTitle>Dados do processo</DialogTitle></DialogHeader>
          {selected && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={selected.leadId ? "Cliente (do CRM)" : "Cliente"}><Input disabled={Boolean(selected.leadId)} value={form.clientName} onChange={e => setForm({ ...form, clientName: e.target.value })} /></Field>
                <Field label={selected.leadId ? "Telefone (do CRM)" : "Telefone"}><Input disabled={Boolean(selected.leadId)} value={form.clientPhone} onChange={e => setForm({ ...form, clientPhone: e.target.value })} /></Field>
                <Field label="Tipo *"><Input placeholder="Usucapião, escritura..." value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} /></Field>
                <Field label="Responsável *"><Input value={form.responsible} onChange={e => setForm({ ...form, responsible: e.target.value })} /></Field>
                <Field label="Matrícula"><Input value={form.registration} onChange={e => setForm({ ...form, registration: e.target.value })} /></Field>
                <Field label="Cartório"><Input value={form.registryOffice} onChange={e => setForm({ ...form, registryOffice: e.target.value })} /></Field>
                <Field label="Valor do serviço"><CurrencyInput value={form.serviceValue ? Number(form.serviceValue) : 0} onChange={v => setForm({ ...form, serviceValue: v ? String(v) : "" })} /></Field>
                <Field label="Previsão de conclusão"><Input type="date" value={form.expectedEndAt} onChange={e => setForm({ ...form, expectedEndAt: e.target.value })} /></Field>
                <div className="sm:col-span-2"><Field label="Endereço do imóvel *"><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></Field></div>
                <div className="sm:col-span-2"><Field label="Descrição"><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></Field></div>
              </div>
              <Button className="w-full bg-[#C9A961] text-[#1A2332]" disabled={updateMutation.isPending || form.type.trim().length < 2 || form.responsible.trim().length < 2 || form.address.trim().length < 3} onClick={() => updateMutation.mutate({
                id: selected.id,
                ...(selected.leadId ? {} : { clientName: form.clientName, clientPhone: form.clientPhone || null }),
                type: form.type,
                address: form.address,
                registration: form.registration || null,
                registryOffice: form.registryOffice || null,
                responsible: form.responsible,
                serviceValue: Number(form.serviceValue || 0),
                expectedEndAt: form.expectedEndAt ? new Date(`${form.expectedEndAt}T12:00:00`) : null,
                description: form.description,
              })}>Salvar dados do processo</Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label>{label}</Label>{children}</div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <Card className="border-[#C9A961]/20 bg-[#2C3E50] text-white"><CardContent className="flex items-center gap-3 pt-6"><Building2 className="h-6 w-6 text-[#C9A961]" /><div><p className="text-xs text-gray-300">{label}</p><p className="text-xl font-bold">{value}</p></div></CardContent></Card>;
}
