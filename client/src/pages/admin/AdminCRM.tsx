import { useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Users,
  Plus,
  Search,
  Filter,
  Phone,
  Mail,
  MapPin,
  Thermometer,
  User,
  ArrowLeft,
  Flame,
  Snowflake,
  TrendingUp,
} from "lucide-react";

const STAGES = [
  { key: "lead_new", label: "Lead Novo", color: "bg-gray-500" },
  { key: "attending", label: "Em Atendimento", color: "bg-blue-500" },
  { key: "waiting_docs", label: "Aguardando Docs", color: "bg-yellow-500" },
  { key: "analysis", label: "Em Análise", color: "bg-orange-500" },
  { key: "caixa_register", label: "Cadastro Caixa", color: "bg-purple-500" },
  { key: "approval", label: "Em Aprovação", color: "bg-indigo-500" },
  { key: "approved", label: "Aprovado", color: "bg-green-500" },
  { key: "rejected", label: "Reprovado", color: "bg-red-500" },
  { key: "followup", label: "Follow-up", color: "bg-pink-500" },
  { key: "in_process", label: "Cliente em Processo", color: "bg-teal-500" },
  { key: "done", label: "Concluído", color: "bg-gray-400" },
];

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
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [newLead, setNewLead] = useState({
    name: "",
    phone: "",
    email: "",
    city: "",
    state: "",
    income: "",
    incomeType: "formal" as any,
    notes: "",
    type: "new_lead" as any,
  });

  const { data: leads = [], refetch } = trpc.leads.list.useQuery({
    stage: filterStage !== "all" ? filterStage : undefined,
    responsible: filterResp !== "all" ? filterResp : undefined,
    temperature: filterTemp !== "all" ? filterTemp : undefined,
  });

  const { data: stats } = trpc.leads.stats.useQuery();

  const createMutation = trpc.leads.create.useMutation({
    onSuccess: () => {
      toast.success("Lead criado com sucesso!");
      setNewLeadOpen(false);
      setNewLead({
        name: "",
        phone: "",
        email: "",
        city: "",
        state: "",
        income: "",
        incomeType: "formal",
        notes: "",
        type: "new_lead",
      });
      refetch();
    },
    onError: err => toast.error(err.message),
  });

  const filtered = leads.filter(
    l =>
      !search ||
      l.name.toLowerCase().includes(search.toLowerCase()) ||
      l.phone.includes(search) ||
      (l.city || "").toLowerCase().includes(search.toLowerCase())
  );

  if (user?.role !== "admin") return null;

  const handleCreate = () => {
    if (!newLead.name || !newLead.phone) {
      toast.error("Nome e telefone são obrigatórios");
      return;
    }
    createMutation.mutate(newLead as any);
  };

  const getLeadsByStage = (stage: string) =>
    filtered.filter(l => l.stage === stage);

  return (
    <div className="min-h-screen bg-[#0F1419]">
      <div className="border-b border-white/10 bg-[#1A2332]">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin">
              <Button
                variant="ghost"
                size="sm"
                className="text-gray-400 hover:text-white"
              >
                <ArrowLeft className="h-4 w-4 mr-2" /> Admin
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Users className="h-6 w-6 text-[#C9A961]" />
              <h1 className="text-xl font-bold text-white">
                CRM — Pipeline de Leads
              </h1>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant={viewMode === "pipeline" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("pipeline")}
              className={
                viewMode === "pipeline"
                  ? "bg-[#C9A961] text-black"
                  : "border-white/20 text-white"
              }
            >
              Pipeline
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("list")}
              className={
                viewMode === "list"
                  ? "bg-[#C9A961] text-black"
                  : "border-white/20 text-white"
              }
            >
              Lista
            </Button>
            <Dialog open={newLeadOpen} onOpenChange={setNewLeadOpen}>
              <DialogTrigger asChild>
                <Button
                  size="sm"
                  className="bg-[#C9A961] hover:bg-[#B8984E] text-black font-bold"
                >
                  <Plus className="h-4 w-4 mr-2" /> Novo Lead
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[#1A2332] border-[#C9A961]/30 text-white max-w-lg">
                <DialogHeader>
                  <DialogTitle className="text-[#C9A961]">
                    Cadastrar Novo Lead
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-gray-300">Nome *</Label>
                      <Input
                        value={newLead.name}
                        onChange={e =>
                          setNewLead(p => ({ ...p, name: e.target.value }))
                        }
                        placeholder="Nome completo"
                        className="bg-white/10 border-white/20 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-300">Telefone *</Label>
                      <Input
                        value={newLead.phone}
                        onChange={e =>
                          setNewLead(p => ({ ...p, phone: e.target.value }))
                        }
                        placeholder="(99) 99999-9999"
                        className="bg-white/10 border-white/20 text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-gray-300">Email</Label>
                    <Input
                      value={newLead.email}
                      onChange={e =>
                        setNewLead(p => ({ ...p, email: e.target.value }))
                      }
                      placeholder="email@exemplo.com"
                      className="bg-white/10 border-white/20 text-white"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-gray-300">Cidade</Label>
                      <Input
                        value={newLead.city}
                        onChange={e =>
                          setNewLead(p => ({ ...p, city: e.target.value }))
                        }
                        placeholder="Imperatriz"
                        className="bg-white/10 border-white/20 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-300">Estado</Label>
                      <Input
                        value={newLead.state}
                        onChange={e =>
                          setNewLead(p => ({ ...p, state: e.target.value }))
                        }
                        placeholder="MA"
                        maxLength={2}
                        className="bg-white/10 border-white/20 text-white"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-gray-300">Renda (R$)</Label>
                      <Input
                        value={newLead.income}
                        onChange={e =>
                          setNewLead(p => ({ ...p, income: e.target.value }))
                        }
                        placeholder="3000.00"
                        className="bg-white/10 border-white/20 text-white"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-300">Tipo de Renda</Label>
                      <Select
                        value={newLead.incomeType}
                        onValueChange={v =>
                          setNewLead(p => ({ ...p, incomeType: v as any }))
                        }
                      >
                        <SelectTrigger className="bg-white/10 border-white/20 text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="formal">Formal (CLT)</SelectItem>
                          <SelectItem value="informal">
                            Informal (Declarada)
                          </SelectItem>
                          <SelectItem value="irpf">IRPF</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label className="text-gray-300">Tipo de Lead</Label>
                    <Select
                      value={newLead.type}
                      onValueChange={v =>
                        setNewLead(p => ({ ...p, type: v as any }))
                      }
                    >
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
                    <Label className="text-gray-300">Observações</Label>
                    <Textarea
                      value={newLead.notes}
                      onChange={e =>
                        setNewLead(p => ({ ...p, notes: e.target.value }))
                      }
                      placeholder="Informações adicionais..."
                      rows={3}
                      className="bg-white/10 border-white/20 text-white"
                    />
                  </div>
                  <Button
                    onClick={handleCreate}
                    disabled={createMutation.isPending}
                    className="w-full bg-[#C9A961] hover:bg-[#B8984E] text-black font-bold"
                  >
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
                <p className="text-2xl font-bold text-white">
                  {stats.approved}
                </p>
                <p className="text-xs text-gray-400">Aprovados</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#1A2332] border-white/10">
            <CardContent className="p-4 flex items-center gap-3">
              <User className="h-8 w-8 text-purple-400" />
              <div>
                <p className="text-2xl font-bold text-white">
                  {stats.rejected}
                </p>
                <p className="text-xs text-gray-400">Reprovados</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="container mx-auto px-4 pb-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar lead..."
            className="pl-9 bg-[#1A2332] border-white/20 text-white"
          />
        </div>
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

      {/* Pipeline View */}
      {viewMode === "pipeline" && (
        <div className="container mx-auto px-4 pb-8">
          <div className="overflow-x-auto">
            <div className="flex gap-4 min-w-max">
              {STAGES.map(stage => {
                const stageLeads = getLeadsByStage(stage.key);
                return (
                  <div key={stage.key} className="w-64 flex-shrink-0">
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`h-3 w-3 rounded-full ${stage.color}`} />
                      <span className="text-sm font-medium text-gray-300">
                        {stage.label}
                      </span>
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
                                <p className="text-sm font-medium text-white leading-tight">
                                  {lead.name}
                                </p>
                                <span
                                  className={`flex items-center gap-1 ${TEMP_COLORS[lead.temperature]}`}
                                >
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
                                <Badge
                                  variant="outline"
                                  className="text-xs border-white/20 text-gray-400"
                                >
                                  {RESPONSIBLE_LABELS[lead.responsible]}
                                </Badge>
                                {lead.income && (
                                  <span className="text-xs text-[#C9A961]">
                                    R${" "}
                                    {Number(lead.income).toLocaleString(
                                      "pt-BR"
                                    )}
                                  </span>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        </Link>
                      ))}
                      {stageLeads.length === 0 && (
                        <div className="text-center text-gray-600 text-xs py-4">
                          Nenhum lead
                        </div>
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
                    <th className="text-left p-4 text-xs text-gray-400 font-medium">
                      CLIENTE
                    </th>
                    <th className="text-left p-4 text-xs text-gray-400 font-medium">
                      CONTATO
                    </th>
                    <th className="text-left p-4 text-xs text-gray-400 font-medium">
                      CIDADE
                    </th>
                    <th className="text-left p-4 text-xs text-gray-400 font-medium">
                      ESTÁGIO
                    </th>
                    <th className="text-left p-4 text-xs text-gray-400 font-medium">
                      TEMP.
                    </th>
                    <th className="text-left p-4 text-xs text-gray-400 font-medium">
                      RESP.
                    </th>
                    <th className="text-left p-4 text-xs text-gray-400 font-medium">
                      RENDA
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(lead => {
                    const stage = STAGES.find(s => s.key === lead.stage);
                    return (
                      <tr
                        key={lead.id}
                        onClick={() => navigate(`/admin/crm/${lead.id}`)}
                        className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors"
                      >
                        <td className="p-4 text-white font-medium">
                          {lead.name}
                        </td>
                        <td className="p-4 text-gray-400 text-sm">
                          {lead.phone}
                        </td>
                        <td className="p-4 text-gray-400 text-sm">
                          {lead.city || "—"}
                        </td>
                        <td className="p-4">
                          {stage && (
                            <div className="flex items-center gap-2">
                              <div
                                className={`h-2 w-2 rounded-full ${stage.color}`}
                              />
                              <span className="text-xs text-gray-300">
                                {stage.label}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="p-4">
                          <span
                            className={`flex items-center gap-1 text-xs ${TEMP_COLORS[lead.temperature]}`}
                          >
                            {TEMP_ICONS[lead.temperature]}
                            {TEMP_LABELS[lead.temperature]}
                          </span>
                        </td>
                        <td className="p-4 text-gray-400 text-sm">
                          {RESPONSIBLE_LABELS[lead.responsible]}
                        </td>
                        <td className="p-4 text-[#C9A961] text-sm">
                          {lead.income
                            ? `R$ ${Number(lead.income).toLocaleString("pt-BR")}`
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-gray-500">
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
