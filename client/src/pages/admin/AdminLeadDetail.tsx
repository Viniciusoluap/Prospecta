import { useState, useEffect } from "react";
import { Link, useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  ArrowLeft, User, Phone, Mail, MapPin, Flame, Snowflake, Thermometer,
  FileText, MessageSquare, ChevronRight, Clock,
  Building2, DollarSign, Calculator, AlertCircle, Plus, Edit, Trash2, RotateCcw
} from "lucide-react";
import { AdminPortalLeadPanel } from "@/components/admin/AdminPortalLeadPanel";
import { LeadDocuments } from "@/components/LeadDocuments";
import { LEAD_SERVICE_LABELS, LEAD_SERVICE_MODULE_ROUTES, LEAD_SERVICE_PRIMARY_TYPES, type LeadServiceType } from "../../../../shared/lead-services";
import { LEAD_PIPELINE_STAGES, LEGACY_STAGE_LABELS } from "../../../../shared/lead-pipeline";

const STAGES = LEAD_PIPELINE_STAGES;
const STAGE_COLORS: Record<string, string> = Object.fromEntries(STAGES.map(stage => [stage.key, stage.color]));

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  message: <MessageSquare className="h-4 w-4" />,
  call: <Phone className="h-4 w-4" />,
  document: <FileText className="h-4 w-4" />,
  status_change: <ChevronRight className="h-4 w-4" />,
  note: <Edit className="h-4 w-4" />,
  handoff: <User className="h-4 w-4" />,
  follow_up: <Clock className="h-4 w-4" />,
};

function formatCurrencyBR(value: number | string | null | undefined) {
  if (!value) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(num);
}

function formatDate(dateStr: string | Date | null | undefined) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function AdminLeadDetail() {
  const [, navigate] = useLocation();
  const params = useParams<{ id: string }>();
  const leadId = parseInt(params.id || "0");

  const [addActivityOpen, setAddActivityOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [activityForm, setActivityForm] = useState({ type: "note", description: "" });
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const [serviceType, setServiceType] = useState<LeadServiceType>("obra_cliente");

  const { data: lead, refetch } = trpc.leads.getById.useQuery({ id: leadId }, {
    enabled: !!leadId,
  });
  const { data: services = [], refetch: refetchServices } = trpc.leadServices.listByLead.useQuery({ leadId }, { enabled: !!leadId });
  const { data: deletionContext } = trpc.leads.deletionContext.useQuery({ id: leadId }, { enabled: deleteOpen && !!leadId });

  const deleteMutation = trpc.leads.softDelete.useMutation({
    onSuccess: () => { toast.success("Lead excluído com possibilidade de recuperação."); navigate("/admin/crm"); },
    onError: error => toast.error(error.message),
  });
  const restoreMutation = trpc.leads.restore.useMutation({
    onSuccess: () => { toast.success("Lead recuperado."); refetch(); },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    if (lead && Object.keys(editForm).length === 0) {
      setEditForm({
        name: lead.name, phone: lead.phone, email: lead.email || "",
        city: lead.city || "", state: lead.state || "",
        income: lead.income || "", fgts: (lead as any).fgts || false,
        pisFgts: lead.pisFgts || "", hasSpouse: lead.hasSpouse || false,
        spouseName: lead.spouseName || "", incomeComposition: lead.incomeComposition || false,
        cpfStatus: lead.cpfStatus || "unknown",
        temperature: lead.temperature || "cold",
        stage: lead.stage, responsible: lead.responsible,
        notes: lead.notes || "", adminNotes: lead.adminNotes || "",
        simulationValue: lead.simulationValue || "", approvedValue: lead.approvedValue || "",
        interest: (lead as any).interest || "financing", type: lead.type || "new_lead",
      });
    }
  }, [lead]);

  const updateMutation = trpc.leads.update.useMutation({
    onSuccess: () => { toast.success("Lead atualizado!"); setEditForm({}); refetch(); setEditOpen(false); },
    onError: (e) => toast.error(e.message),
  });

  const addActivityMutation = trpc.leads.addActivity.useMutation({
    onSuccess: () => { toast.success("Atividade registrada!"); refetch(); setAddActivityOpen(false); setActivityForm({ type: "note", description: "" }); },
    onError: (e) => toast.error(e.message),
  });

  const createServiceMutation = trpc.leadServices.create.useMutation({
    onSuccess: () => { toast.success("Serviço criado e sincronizado automaticamente."); refetchServices(); },
    onError: (error) => toast.error(error.message),
  });
  const updateServiceStatusMutation = trpc.leadServices.setStatus.useMutation({ onSuccess: () => { toast.success("Status do serviço atualizado."); refetchServices(); }, onError: error => toast.error(error.message) });
  const unlinkServiceMutation = trpc.leadServices.unlinkProcess.useMutation({ onSuccess: () => { toast.success("Processo desvinculado do serviço."); refetchServices(); }, onError: error => toast.error(error.message) });
  const removeServiceMutation = trpc.leadServices.remove.useMutation({ onSuccess: () => { toast.success("Serviço excluído do lead."); refetchServices(); }, onError: error => toast.error(error.message) });

  const handleAdvanceStage = () => {
    if (!lead) return;
    const currentIdx = STAGES.findIndex(s => s.key === lead.stage);
    if (currentIdx >= 0 && currentIdx < STAGES.length - 1) {
      const nextStage = STAGES[currentIdx + 1].key;
      updateMutation.mutate({ id: leadId, stage: nextStage as any });
    }
  };

  // 80% rule calculator
  const income = parseFloat(editForm.income || lead?.income || "0");
  const spouseIncome = 0; // Could be extended
  const totalIncome = income + spouseIncome;
  const maxMonthlyPayment = totalIncome * 0.3; // 30% of income (Caixa rule)
  const estimatedFinancing = maxMonthlyPayment * 360 / 1.5; // rough estimate
  const rule80Value = estimatedFinancing / 0.8;

  if (!lead) {
    return (
      <div className="min-h-screen bg-[#1A2332] flex items-center justify-center">
        <div className="text-white">Carregando...</div>
      </div>
    );
  }

  const currentStageIdx = STAGES.findIndex(s => s.key === lead.stage);
  const canAdvance = !lead.deletedAt && currentStageIdx >= 0 && currentStageIdx < STAGES.length - 1;

  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      {/* Header */}
      <div className="bg-[#0F1923] border-b border-[#C9A961]/20 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <Link href="/admin/crm">
              <Button variant="ghost" size="icon" className="w-fit text-gray-400 hover:text-white">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-[#C9A961] break-words">{lead.name}</h1>
              <div className="flex flex-wrap items-center gap-3 mt-1">
                <Badge className={`${STAGE_COLORS[lead.stage] || "bg-gray-500"} text-white text-xs`}>
                  {STAGES.find(s => s.key === lead.stage)?.label || LEGACY_STAGE_LABELS[lead.stage] || lead.stage}
                </Badge>
                <span className="text-gray-400 text-sm">Lead #{lead.id}</span>
                {lead.stageClassificationPending && <Badge className="bg-amber-700 text-white">Classificação pendente: {LEGACY_STAGE_LABELS[lead.legacyStage || lead.stage] || lead.stage}</Badge>}
                {lead.deletedAt && <Badge className="bg-red-700 text-white">Excluído</Badge>}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {lead.deletedAt ? (
              <Button onClick={() => restoreMutation.mutate({ id: leadId })} disabled={restoreMutation.isPending} variant="outline" className="text-white border-white/40"><RotateCcw className="h-4 w-4 mr-2" />Recuperar lead</Button>
            ) : (
              <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <DialogTrigger asChild><Button variant="outline" className="text-red-300 border-red-500/40"><Trash2 className="h-4 w-4 mr-2" />Excluir lead</Button></DialogTrigger>
                <DialogContent className="bg-[#1A2332] text-white border-[#C9A961]/30">
                  <DialogHeader><DialogTitle>Confirmar exclusão de {lead.name}?</DialogTitle></DialogHeader>
                  <p className="text-sm text-gray-300">O lead sairá do CRM. Serviços, contas e obras vinculados serão preservados; um administrador poderá recuperar o cadastro.</p>
                  {deletionContext && <p className="text-sm text-amber-300">Vínculos encontrados: {deletionContext.services} serviços, {deletionContext.accounts} contas, {deletionContext.projects} obras.</p>}
                  <Button disabled={!deletionContext || deleteMutation.isPending} onClick={() => deleteMutation.mutate({ id: leadId })} className="bg-red-700 hover:bg-red-800 text-white">Confirmar exclusão</Button>
                </DialogContent>
              </Dialog>
            )}
            {canAdvance && (
              <Button
                onClick={handleAdvanceStage}
                disabled={updateMutation.isPending}
                className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold"
              >
                <ChevronRight className="h-4 w-4 mr-1" />
                Avançar Etapa
              </Button>
            )}
            {!lead.deletedAt && <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="border-[#C9A961]/30 text-[#C9A961] hover:bg-[#2C3E50]">
                  <Edit className="h-4 w-4 mr-2" />
                  Editar
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="text-[#C9A961]">Editar Lead</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-gray-300">Nome</Label>
                      <Input value={editForm.name || ""} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-gray-300">Telefone</Label>
                      <Input value={editForm.phone || ""} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-gray-300">Email</Label>
                      <Input value={editForm.email || ""} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-gray-300">Cidade</Label>
                      <Input value={editForm.city || ""} onChange={e => setEditForm(f => ({ ...f, city: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-gray-300">Renda Mensal (R$)</Label>
                      <Input type="number" value={editForm.income || ""} onChange={e => setEditForm(f => ({ ...f, income: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-gray-300">Temperatura</Label>
                      <Select value={editForm.temperature} onValueChange={v => setEditForm(f => ({ ...f, temperature: v }))}>
                        <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cold">Frio</SelectItem>
                          <SelectItem value="warm">Morno</SelectItem>
                          <SelectItem value="hot">Quente</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-gray-300">Responsável</Label>
                      <Select value={editForm.responsible} onValueChange={v => setEditForm(f => ({ ...f, responsible: v }))}>
                        <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sarah">Sarah</SelectItem>
                          <SelectItem value="vinicius">Vinicius</SelectItem>
                          <SelectItem value="bianca">Bianca</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-gray-300">Estágio</Label>
                      <Select value={STAGES.some(s => s.key === editForm.stage) ? editForm.stage : undefined} onValueChange={v => setEditForm(f => ({ ...f, stage: v }))}>
                        <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1">
                          <SelectValue placeholder={lead.stageClassificationPending ? "Classificar etapa comercial" : "Selecione"} />
                        </SelectTrigger>
                        <SelectContent>
                          {STAGES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-gray-300">Valor Simulação (R$)</Label>
                      <Input type="number" value={editForm.simulationValue || ""} onChange={e => setEditForm(f => ({ ...f, simulationValue: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-gray-300">Valor Aprovado (R$)</Label>
                      <Input type="number" value={editForm.approvedValue || ""} onChange={e => setEditForm(f => ({ ...f, approvedValue: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-gray-300">Notas Internas (admin)</Label>
                    <Textarea value={editForm.adminNotes || ""} onChange={e => setEditForm(f => ({ ...f, adminNotes: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" rows={3} />
                  </div>
                  <Button
                    onClick={() => updateMutation.mutate({ id: leadId, ...editForm, stage: STAGES.some(s => s.key === editForm.stage) ? editForm.stage : undefined, income: editForm.income ? parseFloat(editForm.income) : undefined, simulationValue: editForm.simulationValue ? parseFloat(editForm.simulationValue) : undefined, approvedValue: editForm.approvedValue ? parseFloat(editForm.approvedValue) : undefined })}
                    disabled={updateMutation.isPending}
                    className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold"
                  >
                    Salvar Alterações
                  </Button>
                </div>
              </DialogContent>
            </Dialog>}
          </div>
        </div>
      </div>

      {/* Pipeline Progress */}
      <div className="bg-[#0F1923] border-b border-[#C9A961]/10 px-6 py-3 overflow-x-auto">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-1 min-w-max">
            {STAGES.map((stage, idx) => (
              <div key={stage.key} className="flex items-center gap-1">
                <button
                  onClick={() => !lead.deletedAt && updateMutation.mutate({ id: leadId, stage: stage.key })}
                  disabled={!!lead.deletedAt}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    idx <= currentStageIdx
                      ? `${STAGE_COLORS[stage.key]} text-white`
                      : "bg-[#2C3E50] text-gray-500"
                  }`}
                >
                  {stage.label}
                </button>
                {idx < STAGES.length - 1 && (
                  <ChevronRight className={`h-3 w-3 ${idx < currentStageIdx ? "text-[#C9A961]" : "text-gray-700"}`} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column — Lead Data */}
        <div className="lg:col-span-1 space-y-4">
          {/* Personal Info */}
          <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-[#C9A961] text-sm flex items-center gap-2">
                <User className="h-4 w-4" /> Dados Pessoais
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <InfoRow label="Nome" value={lead.name} />
              <InfoRow label="Telefone" value={lead.phone} icon={<Phone className="h-3 w-3" />} />
              <InfoRow label="Email" value={lead.email} icon={<Mail className="h-3 w-3" />} />
              <InfoRow label="Cidade" value={`${lead.city || "—"}${lead.state ? `/${lead.state}` : ""}`} icon={<MapPin className="h-3 w-3" />} />
              <InfoRow label="Temperatura" value={
                lead.temperature === "hot" ? "Quente 🔥" :
                lead.temperature === "warm" ? "Morno 🌡️" : "Frio ❄️"
              } />
              <InfoRow label="Responsável" value={lead.responsible === "sarah" ? "Sarah" : lead.responsible === "vinicius" ? "Vinicius" : "Bianca"} />
              <InfoRow label="Canal de Origem" value={lead.sourceChannel} />
              <InfoRow label="Cidade Origem" value={lead.sourceCity} />
            </CardContent>
          </Card>

          {/* Financial Info */}
          <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-[#C9A961] text-sm flex items-center gap-2">
                <DollarSign className="h-4 w-4" /> Dados Financeiros
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <InfoRow label="Renda" value={formatCurrencyBR(lead.income)} />
              <InfoRow label="FGTS" value={(lead as any).fgts ? "Sim" : "Não"} />
              <InfoRow label="PIS/FGTS" value={lead.pisFgts} />
              <InfoRow label="Cônjuge" value={lead.hasSpouse ? `Sim — ${lead.spouseName || ""}` : "Não"} />
              <InfoRow label="Composição de Renda" value={lead.incomeComposition ? "Sim" : "Não"} />
              <InfoRow label="CPF Status" value={lead.cpfStatus === "clean" ? "Limpo" : lead.cpfStatus === "restricted" ? "Restrito" : "Desconhecido"} />
              <InfoRow label="Interesse" value={(lead as any).interest === "house" ? "Casa" : (lead as any).interest === "lot" ? "Lote" : (lead as any).interest === "financing" ? "Financiamento" : "Obra"} />
              <Separator className="bg-[#C9A961]/20" />
              <InfoRow label="Valor Simulação" value={formatCurrencyBR(lead.simulationValue)} highlight />
              <InfoRow label="Valor Aprovado" value={formatCurrencyBR(lead.approvedValue)} highlight />
            </CardContent>
          </Card>

          {/* 80% Rule Calculator */}
          {income > 0 && (
            <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-white">
              <CardHeader className="pb-3">
                <CardTitle className="text-[#C9A961] text-sm flex items-center gap-2">
                  <Calculator className="h-4 w-4" /> Regra dos 80%
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="p-3 bg-[#1A2332] rounded-lg space-y-2">
                  <InfoRow label="Renda Total" value={formatCurrencyBR(totalIncome)} />
                  <InfoRow label="Parcela Máx (30%)" value={formatCurrencyBR(maxMonthlyPayment)} />
                  <InfoRow label="Financiamento Est." value={formatCurrencyBR(estimatedFinancing)} />
                  <Separator className="bg-[#C9A961]/20" />
                  <div className="flex justify-between font-bold text-[#C9A961]">
                    <span>Imóvel Máx (÷0,8):</span>
                    <span>{formatCurrencyBR(rule80Value)}</span>
                  </div>
                </div>
                <p className="text-gray-400 text-xs">* Estimativa. Banco financia até 80% do menor valor (avaliação ou compra)</p>
              </CardContent>
            </Card>
          )}

          {/* Admin Notes */}
          {lead.adminNotes && (
            <Card className="bg-[#2C3E50] border-yellow-500/30">
              <CardHeader className="pb-3">
                <CardTitle className="text-yellow-400 text-sm flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" /> Notas Internas
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-300 text-sm whitespace-pre-wrap">{lead.adminNotes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column — Timeline + Documents */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-white">
            <CardHeader className="pb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <CardTitle className="text-[#C9A961] text-sm flex items-center gap-2">
                  <Building2 className="h-4 w-4" /> Serviços do cliente
                </CardTitle>
                <p className="mt-1 text-xs text-gray-300">Cada serviço é independente e pode ser ligado ao módulo operacional correspondente.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Select value={serviceType} onValueChange={value => setServiceType(value as LeadServiceType)}>
                  <SelectTrigger className="w-48 h-8 bg-[#1A2332] border-white/20 text-white text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LEAD_SERVICE_PRIMARY_TYPES.map(type => <SelectItem key={type} value={type}>{LEAD_SERVICE_LABELS[type]}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={() => createServiceMutation.mutate({ leadId, serviceType })} disabled={createServiceMutation.isPending} className="bg-[#C9A961] text-black hover:bg-[#B8985A]">
                  <Plus className="h-3 w-3 mr-1" /> Vincular
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {services.length === 0 ? (
                <p className="text-sm text-gray-400">Nenhum serviço vinculado. Cadastre o serviço antes de iniciar o processo operacional.</p>
              ) : (
                <div className="space-y-2">
                  {services.map(service => (
                    <div key={service.id} className="rounded-lg border border-white/10 bg-[#1A2332] px-3 py-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white">{LEAD_SERVICE_LABELS[service.serviceType as LeadServiceType] || service.serviceType}</p>
                        <p className="text-xs text-gray-300 break-words">{service.operationalRecordId ? `Processo vinculado em ${service.operationalModule}` : `Aguardando configuração em ${service.operationalModule || "CRM"}`}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {service.operationalModule && LEAD_SERVICE_MODULE_ROUTES[service.operationalModule] && <Link href={LEAD_SERVICE_MODULE_ROUTES[service.operationalModule]} className="rounded border border-[#C9A961]/50 px-2 py-1 text-xs text-[#E6CA88]">Abrir módulo</Link>}
                        <Badge className={service.status === "completed" ? "bg-green-700" : service.status === "cancelled" ? "bg-red-700" : "bg-teal-600"}>{service.status === "completed" ? "Concluído" : service.status === "cancelled" ? "Cancelado" : "Em andamento"}</Badge>
                        {service.status !== "completed" && <Button size="sm" variant="outline" className="h-7 border-green-600/50 text-green-300" onClick={() => updateServiceStatusMutation.mutate({ id: service.id, status: "completed" })}>Concluir</Button>}
                        {service.operationalRecordId && <Button size="sm" variant="outline" className="h-7" onClick={() => { if (window.confirm("Desvincular o processo operacional deste serviço? A obra não será excluída.")) unlinkServiceMutation.mutate({ id: service.id }); }}>Desvincular</Button>}
                        <Button size="sm" variant="outline" className="h-7 border-red-600/50 text-red-300" onClick={() => { if (window.confirm("Excluir este serviço do lead? O processo operacional existente não será excluído.")) removeServiceMutation.mutate({ id: service.id }); }}>Excluir</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          {/* Documentos privados vinculados ao cadastro do cliente */}
          <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-white">
            <CardHeader><CardTitle className="text-[#C9A961] text-sm">Documentos</CardTitle></CardHeader>
            <CardContent><LeadDocuments leadId={leadId} admin /></CardContent>
          </Card>

          {/* Activity Timeline */}
          <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-white">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-[#C9A961] text-sm flex items-center gap-2">
                <MessageSquare className="h-4 w-4" /> Timeline de Atividades
              </CardTitle>
              <Dialog open={addActivityOpen} onOpenChange={setAddActivityOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" className="border-[#C9A961]/30 text-[#C9A961] hover:bg-[#1A2332] h-7">
                    <Plus className="h-3 w-3 mr-1" /> Registrar
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white">
                  <DialogHeader>
                    <DialogTitle className="text-[#C9A961]">Registrar Atividade</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 mt-4">
                    <div>
                      <Label className="text-gray-300">Tipo</Label>
                      <Select value={activityForm.type} onValueChange={v => setActivityForm(f => ({ ...f, type: v }))}>
                        <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="message">Mensagem</SelectItem>
                          <SelectItem value="call">Ligação</SelectItem>
                          <SelectItem value="document">Documento</SelectItem>
                          <SelectItem value="note">Nota interna</SelectItem>
                          <SelectItem value="handoff">Repasse</SelectItem>
                          <SelectItem value="follow_up">Follow-up</SelectItem>
                          <SelectItem value="status_change">Mudança de status</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-gray-300">Descrição</Label>
                      <Textarea
                        value={activityForm.description}
                        onChange={e => setActivityForm(f => ({ ...f, description: e.target.value }))}
                        className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                        rows={3}
                        placeholder="Descreva o que aconteceu..."
                      />
                    </div>
                    <Button
                      onClick={() => addActivityMutation.mutate({ leadId, type: activityForm.type as any, description: activityForm.description })}
                      disabled={addActivityMutation.isPending || !activityForm.description}
                      className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold"
                    >
                      Registrar
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {lead.activities && lead.activities.length > 0 ? (
                <div className="space-y-3">
                  {lead.activities.map((activity: any) => (
                    <div key={activity.id} className="flex gap-3 p-3 rounded-lg bg-[#1A2332]">
                      <div className="mt-0.5 text-[#C9A961]">
                        {ACTIVITY_ICONS[activity.type] || <MessageSquare className="h-4 w-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-[#C9A961] font-medium uppercase">{activity.type}</span>
                          <span className="text-xs text-gray-500 whitespace-nowrap">{formatDate(activity.createdAt)}</span>
                        </div>
                        <p className="text-sm text-gray-300 mt-1 whitespace-pre-wrap">{activity.description}</p>
                        {activity.performedBy && (
                          <span className="text-xs text-gray-500 mt-1">— {activity.performedBy}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Nenhuma atividade registrada</p>
                </div>
              )}
            </CardContent>
          </Card>

          <AdminPortalLeadPanel leadId={leadId} defaultEmail={lead.email} />

          {/* Notes */}
          {lead.notes && (
            <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-white">
              <CardHeader className="pb-3">
                <CardTitle className="text-[#C9A961] text-sm">Observações do Lead</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-300 text-sm whitespace-pre-wrap">{lead.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, icon, highlight }: { label: string; value?: string | null; icon?: React.ReactNode; highlight?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-2">
      <span className="text-gray-300 shrink-0">{label}:</span>
      <span className={`font-medium text-right ${highlight ? "text-[#C9A961]" : "text-gray-200"} flex items-center gap-1`}>
        {icon} {value || "—"}
      </span>
    </div>
  );
}
