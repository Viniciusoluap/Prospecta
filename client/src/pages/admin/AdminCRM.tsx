import { useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Users, Plus, Search, Filter, Phone, Mail, MapPin,
  Thermometer, User, ArrowLeft, Flame, Snowflake, TrendingUp, Trash2, RotateCcw
} from "lucide-react";
import { LEAD_SERVICE_LABELS, LEAD_SERVICE_PRIMARY_TYPES, type LeadServiceType } from "../../../../shared/lead-services";
import { LEAD_PIPELINE_STAGES, LEGACY_STAGE_LABELS } from "../../../../shared/lead-pipeline";

const STAGES = LEAD_PIPELINE_STAGES;

const TEMP_COLORS: Record<string, string> = {
  cold: "text-blue-400",
  warm: "text-yellow-400",
  hot: "text-red-500",
};

const TEMP_ICONS: Record<string, React.ReactNode> = {
  cold: <Snowflake className="h-4 w-4" />,
  warm: <Thermometer className="h-4 w-4" />,
  hot: <Flame className="h-4 w-4" />,
};

const TEMP_LABELS: Record<string, string> = {
  cold: "Frio",
  warm: "Morno",
  hot: "Quente",
};

const RESPONSIBLE_LABELS: Record<string, string> = {
  sarah: "Sarah",
  vinicius: "Vinicius",
  bianca: "Bianca",
};

export default function AdminCRM() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [filterStage, setFilterStage] = useState<string>("all");
  const [filterTemp, setFilterTemp] = useState<string>("all");
  const [filterResp, setFilterResp] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"pipeline" | "list">("pipeline");
  const [showDeleted, setShowDeleted] = useState(false);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [newLead, setNewLead] = useState({
    name: "", phone: "", email: "", city: "", state: "",
    income: "", incomeType: "formal" as any, notes: "", type: "new_lead" as any, services: [] as LeadServiceType[],
  });

  const { data: leads = [], refetch } = trpc.leads.list.useQuery({
    includeDeleted: showDeleted,
    stage: filterStage !== "all" ? filterStage : undefined,
    responsible: filterResp !== "all" ? filterResp : undefined,
    temperature: filterTemp !== "all" ? filterTemp : undefined,
  });

  const { data: stats } = trpc.leads.stats.useQuery();
  const utils = trpc.useUtils();
  const softDelete = trpc.leads.softDelete.useMutation({
    onSuccess: async () => { toast.success("Lead arquivado. Os vínculos e históricos foram preservados."); await Promise.all([refetch(), utils.leads.stats.invalidate()]); },
    onError: err => toast.error(err.message),
  });
  const restore = trpc.leads.restore.useMutation({
    onSuccess: async () => { toast.success("Lead recuperado."); await Promise.all([refetch(), utils.leads.stats.invalidate()]); },
    onError: err => toast.error(err.message),
  });

  const createMutation = trpc.leads.create.useMutation({
    onSuccess: () => {
      toast.success("Lead criado com sucesso!");
      setNewLeadOpen(false);
      setNewLead({ name: "", phone: "", email: "", city: "", state: "", income: "", incomeType: "formal", notes: "", type: "new_lead", services: [] });
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const filtered = leads.filter(l =>
    !search || l.name.toLowerCase().includes(search.toLowerCase()) ||
    l.phone.includes(search) || (l.city || "").toLowerCase().includes(search.toLowerCase())
  );

  if (user?.role !== "admin") return null;

  const handleCreate = () => {
    if (!newLead.name) {
      toast.error("Nome é obrigatório");
      return;
    }
    createMutation.mutate({ ...newLead, phone: newLead.phone || undefined, email: newLead.email || undefined, city: newLead.city || undefined, state: newLead.state || undefined, income: newLead.income || undefined, notes: newLead.notes || undefined } as any);
  };

  const toggleService = (service: LeadServiceType) => {
    setNewLead(current => ({
      ...current,
      services: current.services.includes(service)
        ? current.services.filter(item => item !== service)
        : [...current.services, service],
    }));
  };

  const getLeadsByStage = (stage: string) => filtered.filter(l => l.stage === stage);
  const pendingClassification = filtered.filter(l => l.stageClassificationPending && !l.deletedAt);
  const archiveLead = async (lead: typeof leads[number]) => {
    try {
      const links = await utils.leads.deletionContext.fetch({ id: lead.id });
      const details = `${links.services} serviço(s), ${links.projects} obra(s) e ${links.accounts} conta(s) vinculadas`;
      if (window.confirm(`Excluir logicamente o lead ${lead.name}?\n${details}. Os registros vinculados e históricos serão preservados.`)) {
        softDelete.mutate({ id: lead.id });
      }
    } catch (error) {
      toast.error("Não foi possível verificar os vínculos deste lead.");
    }
  };

  return (
    <div className="min-h-screen bg-[#0F1419]">
      <div className="border-b border-white/10 bg-[#1A2332]">
        <div className="container mx-auto flex flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <Link href="/admin">
              <Button variant="ghost" size="sm" className="w-fit text-gray-400 hover:text-white">
                <ArrowLeft className="h-4 w-4 mr-2" /> Admin
              </Button>
            </Link>
            <div className="flex min-w-0 items-center gap-2">
              <Users className="h-6 w-6 shrink-0 text-[#C9A961]" />
              <h1 className="truncate text-xl font-bold text-white">CRM — Pipeline de Leads</h1>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => { setShowDeleted(v => !v); setViewMode("list"); }}
              className="border-white/20 text-white">
              {showDeleted ? "Ocultar arquivados" : "Ver arquivados"}
            </Button>
            <Button
              variant={viewMode === "pipeline" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("pipeline")}
              className={viewMode === "pipeline" ? "bg-[#C9A961] text-black" : "border-white/20 text-white"}
            >
              Pipeline
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("list")}
              className={viewMode === "list" ? "bg-[#C9A961] text-black" : "border-white/20 text-white"}
            >
              Lista
            </Button>
            <Dialog open={newLeadOpen} onOpenChange={setNewLeadOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-[#C9A961] hover:bg-[#B8984E] text-black font-bold">
                  <Plus className="h-4 w-4 mr-2" /> Novo Lead
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[#1A2332] border-[#C9A961]/30 text-white max-w-lg">
                <DialogHeader>
                  <DialogTitle className="text-[#C9A961]">Cadastrar Novo Lead</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-gray-300">Nome *</Label>
                      <Input value={newLead.name} onChange={e => setNewLead(p => ({ ...p, name: e.target.value }))}
                        placeholder="Nome completo" className="bg-white/10 border-white/20 text-white" />
                    </div>
                    <div>
                      <Label className="text-gray-300">Telefone</Label>
                      <Input value={newLead.phone} onChange={e => setNewLead(p => ({ ...p, phone: e.target.value }))}
                        placeholder="(99) 99999-9999" className="bg-white/10 border-white/20 text-white" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-gray-300">Email</Label>
                    <Input value={newLead.email} onChange={e => setNewLead(p => ({ ...p, email: e.target.value }))}
                      placeholder="email@exemplo.com" className="bg-white/10 border-white/20 text-white" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-gray-300">Cidade</Label>
                      <Input value={newLead.city} onChange={e => setNewLead(p => ({ ...p, city: e.target.value }))}
                        placeholder="Imperatriz" className="bg-white/10 border-white/20 text-white" />
                    </div>
                    <div>
                      <Label className="text-gray-300">Estado</Label>
                      <Input value={newLead.state} onChange={e => setNewLead(p => ({ ...p, state: e.target.value }))}
                        placeholder="MA" maxLength={2} className="bg-white/10 border-white/20 text-white" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-gray-300">Renda (R$)</Label>
                      <Input value={newLead.income} onChange={e => setNewLead(p => ({ ...p, income: e.target.value }))}
                        placeholder="3000.00" className="bg-white/10 border-white/20 text-white" />
                    </div>
                    <div>
                      <Label className="text-gray-300">Tipo de Renda</Label>
                      <Select value={newLead.incomeType} onValueChange={v => setNewLead(p => ({ ...p, incomeType: v as any }))}>
                        <SelectTrigger className="bg-white/10 border-white/20 text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="formal">Formal (CLT)</SelectItem>
                          <SelectItem value="informal">Informal (Declarada)</SelectItem>
                          <SelectItem value="irpf">IRPF</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label className="text-gray-300">Tipo de Lead</Label>
                    <Select value={newLead.type} onValueChange={v => setNewLead(p => ({ ...p, type: v as any }))}>
                      <SelectTrigger className="bg-white/10 border-white/20 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new_lead">Lead Novo</SelectItem>
                        <SelectItem value="broker">Corretor</SelectItem>
                        <SelectItem value="supplier">Fornecedor</SelectItem>
                        <SelectItem value="vip">VIP</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-gray-300">Serviços solicitados</Label>
                    <p className="text-xs text-gray-400 mt-1">Selecione todos os serviços deste cliente. Os dados operacionais serão preenchidos no respectivo módulo.</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
                      {LEAD_SERVICE_PRIMARY_TYPES.map(service => {
                        const selected = newLead.services.includes(service);
                        return (
                          <button
                            key={service}
                            type="button"
                            onClick={() => toggleService(service)}
                            className={`rounded border px-2 py-2 text-left text-xs transition-colors ${selected ? "border-[#C9A961] bg-[#C9A961]/15 text-[#F4D37D]" : "border-white/15 bg-white/5 text-gray-300 hover:bg-white/10"}`}
                          >
                            {selected ? "✓ " : ""}{LEAD_SERVICE_LABELS[service]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <Label className="text-gray-300">Observações</Label>
                    <Textarea value={newLead.notes} onChange={e => setNewLead(p => ({ ...p, notes: e.target.value }))}
                      placeholder="Informações adicionais..." rows={3}
                      className="bg-white/10 border-white/20 text-white" />
                  </div>
                  <Button onClick={handleCreate} disabled={createMutation.isPending}
                    className="w-full bg-[#C9A961] hover:bg-[#B8984E] text-black font-bold">
                    {createMutation.isPending ? "Criando..." : "Criar Lead"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="container mx-auto px-4 py-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-[#1A2332] border-white/10">
            <CardContent className="p-4 flex items-center gap-3">
              <Users className="h-8 w-8 text-[#C9A961]" />
              <div>
                <p className="text-2xl font-bold text-white">{stats.total}</p>
                <p className="text-xs text-gray-400">Total Leads</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#1A2332] border-white/10">
            <CardContent className="p-4 flex items-center gap-3">
              <Flame className="h-8 w-8 text-red-500" />
              <div>
                <p className="text-2xl font-bold text-white">{stats.hot}</p>
                <p className="text-xs text-gray-400">Leads Quentes</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#1A2332] border-white/10">
            <CardContent className="p-4 flex items-center gap-3">
              <TrendingUp className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-2xl font-bold text-white">{stats.approved}</p>
                <p className="text-xs text-gray-400">Aprovado e Follow up</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#1A2332] border-white/10">
            <CardContent className="p-4 flex items-center gap-3">
              <User className="h-8 w-8 text-purple-400" />
              <div>
                <p className="text-2xl font-bold text-white">{pendingClassification.length}</p>
                <p className="text-xs text-gray-400">A classificar</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="container mx-auto px-4 pb-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar lead..." className="pl-9 bg-[#1A2332] border-white/20 text-white" />
        </div>
        <Select value={filterStage} onValueChange={setFilterStage}>
          <SelectTrigger className="w-48 bg-[#1A2332] border-white/20 text-white">
            <SelectValue placeholder="Etapa" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as etapas</SelectItem>
            {STAGES.map(stage => <SelectItem key={stage.key} value={stage.key}>{stage.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterTemp} onValueChange={setFilterTemp}>
          <SelectTrigger className="w-36 bg-[#1A2332] border-white/20 text-white">
            <SelectValue placeholder="Temperatura" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="hot">Quente</SelectItem>
            <SelectItem value="warm">Morno</SelectItem>
            <SelectItem value="cold">Frio</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterResp} onValueChange={setFilterResp}>
          <SelectTrigger className="w-36 bg-[#1A2332] border-white/20 text-white">
            <SelectValue placeholder="Responsável" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="sarah">Sarah</SelectItem>
            <SelectItem value="vinicius">Vinicius</SelectItem>
            <SelectItem value="bianca">Bianca</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {pendingClassification.length > 0 && (
        <div className="container mx-auto px-4 pb-5">
          <Card className="border-amber-500/40 bg-amber-500/10 text-white">
            <CardContent className="p-4">
              <p className="font-semibold">{pendingClassification.length} lead(s) aguardam classificação na nova sequência</p>
              <p className="text-sm text-gray-300 mt-1">A etapa anterior foi preservada. Abra cada cadastro para selecionar a etapa correta.</p>
              <div className="flex flex-wrap gap-2 mt-3">
                {pendingClassification.map(lead => (
                  <Link key={lead.id} href={`/admin/crm/${lead.id}`}>
                    <Button variant="outline" size="sm" className="border-amber-500/40 text-white">
                      {lead.name} · {LEGACY_STAGE_LABELS[lead.legacyStage || lead.stage] || lead.legacyStage || lead.stage}
                    </Button>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Pipeline View */}
      {viewMode === "pipeline" && (
        <div className="container mx-auto px-4 pb-8">
          <div className="overflow-x-auto">
            <div className="flex gap-4 min-w-max">
              {STAGES.map(stage => {
                const stageLeads = getLeadsByStage(stage.key).filter(lead => !lead.stageClassificationPending && !lead.deletedAt);
                return (
                  <div key={stage.key} className="w-64 flex-shrink-0">
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`h-3 w-3 rounded-full ${stage.color}`} />
                      <span className="text-sm font-medium text-gray-300">{stage.label}</span>
                      <span className="ml-auto bg-white/10 text-gray-400 text-xs rounded-full px-2 py-0.5">
                        {stageLeads.length}
                      </span>
                    </div>
                    <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                      {stageLeads.map(lead => (
                        <Link key={lead.id} href={`/admin/crm/${lead.id}`}>
                          <Card className="bg-[#1A2332] border-white/10 hover:border-[#C9A961]/50 cursor-pointer transition-all">
                            <CardContent className="p-3 space-y-2">
                              <div className="flex items-start justify-between">
                                <p className="text-sm font-medium text-white leading-tight">{lead.name}</p>
                                <span className={`flex items-center gap-1 ${TEMP_COLORS[lead.temperature]}`}>
                                  {TEMP_ICONS[lead.temperature]}
                                </span>
                              </div>
                              {lead.phone && (
                                <div className="flex items-center gap-1 text-xs text-gray-400">
                                  <Phone className="h-3 w-3" /> {lead.phone}
                                </div>
                              )}
                              {lead.city && (
                                <div className="flex items-center gap-1 text-xs text-gray-400">
                                  <MapPin className="h-3 w-3" /> {lead.city}
                                </div>
                              )}
                              <div className="flex items-center justify-between">
                                <Badge variant="outline" className="text-xs border-white/20 text-gray-400">
                                  {RESPONSIBLE_LABELS[lead.responsible]}
                                </Badge>
                                {lead.income && (
                                  <span className="text-xs text-[#C9A961]">
                                    R$ {Number(lead.income).toLocaleString("pt-BR")}
                                  </span>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        </Link>
                      ))}
                      {stageLeads.length === 0 && (
                        <div className="text-center text-gray-600 text-xs py-4">Nenhum lead</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* List View */}
      {viewMode === "list" && (
        <div className="container mx-auto px-4 pb-8">
          <Card className="bg-[#1A2332] border-white/10">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left p-4 text-xs text-gray-400 font-medium">CLIENTE</th>
                    <th className="text-left p-4 text-xs text-gray-400 font-medium">CONTATO</th>
                    <th className="text-left p-4 text-xs text-gray-400 font-medium">CIDADE</th>
                    <th className="text-left p-4 text-xs text-gray-400 font-medium">ESTÁGIO</th>
                    <th className="text-left p-4 text-xs text-gray-400 font-medium">TEMP.</th>
                    <th className="text-left p-4 text-xs text-gray-400 font-medium">RESP.</th>
                    <th className="text-left p-4 text-xs text-gray-400 font-medium">RENDA</th>
                    <th className="text-left p-4 text-xs text-gray-400 font-medium">AÇÕES</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(lead => {
                    const stage = STAGES.find(s => s.key === lead.stage);
                    return (
                      <tr key={lead.id}
                        onClick={() => navigate(`/admin/crm/${lead.id}`)}
                        className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors">
                        <td className="p-4 text-white font-medium">{lead.name}</td>
                        <td className="p-4 text-gray-400 text-sm">{lead.phone}</td>
                        <td className="p-4 text-gray-400 text-sm">{lead.city || "—"}</td>
                        <td className="p-4">
                          {(stage || lead.stageClassificationPending) && (
                            <div className="flex items-center gap-2">
                              <div className={`h-2 w-2 rounded-full ${stage?.color || "bg-amber-500"}`} />
                              <span className="text-xs text-gray-300">{lead.stageClassificationPending ? `Classificar: ${LEGACY_STAGE_LABELS[lead.legacyStage || lead.stage] || lead.legacyStage || lead.stage}` : stage?.label}</span>
                            </div>
                          )}
                        </td>
                        <td className="p-4">
                          <span className={`flex items-center gap-1 text-xs ${TEMP_COLORS[lead.temperature]}`}>
                            {TEMP_ICONS[lead.temperature]}
                            {TEMP_LABELS[lead.temperature]}
                          </span>
                        </td>
                        <td className="p-4 text-gray-400 text-sm">{RESPONSIBLE_LABELS[lead.responsible]}</td>
                        <td className="p-4 text-[#C9A961] text-sm">
                          {lead.income ? `R$ ${Number(lead.income).toLocaleString("pt-BR")}` : "—"}
                        </td>
                        <td className="p-4">
                          {lead.deletedAt ? (
                            <Button variant="outline" size="sm" className="text-white border-white/20" disabled={restore.isPending}
                              onClick={e => { e.stopPropagation(); restore.mutate({ id: lead.id }); }} aria-label={`Recuperar ${lead.name}`}>
                              <RotateCcw className="h-4 w-4 mr-1" /> Recuperar
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" className="text-red-300 border-red-400/30" disabled={softDelete.isPending}
                              onClick={e => { e.stopPropagation(); archiveLead(lead); }} aria-label={`Excluir ${lead.name}`}>
                              <Trash2 className="h-4 w-4 mr-1" /> Excluir
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-gray-500">
                        Nenhum lead encontrado
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
