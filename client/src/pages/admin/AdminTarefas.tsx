import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft, CheckSquare, Plus, Clock, AlertTriangle, User } from "lucide-react";

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-gray-500",
  medium: "bg-blue-500",
  high: "bg-orange-500",
  critical: "bg-red-500",
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  critical: "Crítica",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500",
  in_progress: "bg-blue-500",
  done: "bg-green-500",
  cancelled: "bg-gray-500",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  in_progress: "Em Andamento",
  done: "Concluída",
  cancelled: "Cancelada",
};

function formatDate(d: string | Date | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("pt-BR");
}

export default function AdminTarefas() {
  const [open, setOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterResp, setFilterResp] = useState("all");
  const [form, setForm] = useState({
    title: "", description: "", assignedTo: "sarah",
    priority: "medium" as any, dueAt: "", slaHours: "",
  });

  const { data: tasks = [], refetch } = trpc.tasks.list.useQuery({
    status: filterStatus !== "all" ? filterStatus : undefined,
    assignedTo: filterResp !== "all" ? filterResp : undefined,
  });

  const createMutation = trpc.tasks.create.useMutation({
    onSuccess: () => { toast.success("Tarefa criada!"); refetch(); setOpen(false); setForm({ title: "", description: "", assignedTo: "sarah", priority: "medium", dueAt: "", slaHours: "" }); },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.tasks.update.useMutation({
    onSuccess: () => { refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const pending = tasks.filter(t => t.status === "pending").length;
  const inProgress = tasks.filter(t => t.status === "in_progress").length;
  const overdue = tasks.filter(t => t.dueAt && new Date(t.dueAt) < new Date() && t.status !== "done" && t.status !== "cancelled").length;

  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <div className="bg-[#0F1923] border-b border-[#C9A961]/20 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin">
              <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-[#C9A961]">Tarefas & SLA</h1>
              <p className="text-gray-400 text-sm">Controle de demandas internas</p>
            </div>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
                <Plus className="h-4 w-4 mr-2" /> Nova Tarefa
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white">
              <DialogHeader>
                <DialogTitle className="text-[#C9A961]">Criar Tarefa</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div>
                  <Label className="text-gray-300">Título</Label>
                  <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                </div>
                <div>
                  <Label className="text-gray-300">Descrição</Label>
                  <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" rows={3} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-gray-300">Responsável</Label>
                    <Select value={form.assignedTo} onValueChange={v => setForm(f => ({ ...f, assignedTo: v }))}>
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
                    <Label className="text-gray-300">Prioridade</Label>
                    <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                      <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Baixa (SLA 24h)</SelectItem>
                        <SelectItem value="medium">Média (SLA 6h)</SelectItem>
                        <SelectItem value="high">Alta (SLA 2h)</SelectItem>
                        <SelectItem value="critical">Crítica (imediato)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-gray-300">Prazo</Label>
                    <Input type="datetime-local" value={form.dueAt} onChange={e => setForm(f => ({ ...f, dueAt: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                </div>
                <Button
                  onClick={() => createMutation.mutate({ ...form, dueAt: form.dueAt ? new Date(form.dueAt) : undefined, slaHours: form.slaHours ? parseInt(form.slaHours) : undefined })}
                  disabled={createMutation.isPending || !form.title}
                  className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold"
                >
                  Criar Tarefa
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-[#2C3E50] border-yellow-500/30">
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <Clock className="h-6 w-6 text-yellow-400" />
              <div>
                <p className="text-gray-400 text-xs">Pendentes</p>
                <p className="text-2xl font-bold text-yellow-400">{pending}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#2C3E50] border-blue-500/30">
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <CheckSquare className="h-6 w-6 text-blue-400" />
              <div>
                <p className="text-gray-400 text-xs">Em Andamento</p>
                <p className="text-2xl font-bold text-blue-400">{inProgress}</p>
              </div>
            </CardContent>
          </Card>
          <Card className={`bg-[#2C3E50] ${overdue > 0 ? "border-red-500/30" : "border-gray-500/30"}`}>
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <AlertTriangle className={`h-6 w-6 ${overdue > 0 ? "text-red-400" : "text-gray-400"}`} />
              <div>
                <p className="text-gray-400 text-xs">Atrasadas</p>
                <p className={`text-2xl font-bold ${overdue > 0 ? "text-red-400" : "text-gray-400"}`}>{overdue}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40 bg-[#2C3E50] border-[#C9A961]/30 text-white">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="pending">Pendente</SelectItem>
              <SelectItem value="in_progress">Em Andamento</SelectItem>
              <SelectItem value="done">Concluída</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterResp} onValueChange={setFilterResp}>
            <SelectTrigger className="w-40 bg-[#2C3E50] border-[#C9A961]/30 text-white">
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

        {/* Tasks List */}
        {tasks.length === 0 ? (
          <Card className="bg-[#2C3E50] border-[#C9A961]/20">
            <CardContent className="py-12 text-center text-gray-500">
              <CheckSquare className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p>Nenhuma tarefa encontrada</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {tasks.map((task: any) => {
              const isOverdue = task.dueAt && new Date(task.dueAt) < new Date() && task.status !== "done" && task.status !== "cancelled";
              return (
                <Card key={task.id} className={`bg-[#2C3E50] ${isOverdue ? "border-red-500/50" : "border-[#C9A961]/20"}`}>
                  <CardContent className="py-4 px-4">
                    <div className="flex items-start gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-white">{task.title}</span>
                          <Badge className={`${PRIORITY_COLORS[task.priority] || "bg-gray-500"} text-white text-xs`}>
                            {PRIORITY_LABELS[task.priority] || task.priority}
                          </Badge>
                          <Badge className={`${STATUS_COLORS[task.status] || "bg-gray-500"} text-white text-xs`}>
                            {STATUS_LABELS[task.status] || task.status}
                          </Badge>
                          {isOverdue && <Badge className="bg-red-600 text-white text-xs">ATRASADA</Badge>}
                        </div>
                        {task.description && <p className="text-sm text-gray-400 mt-1">{task.description}</p>}
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                          <span className="flex items-center gap-1"><User className="h-3 w-3" /> {task.assignedTo}</span>
                          {task.dueAt && <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Prazo: {formatDate(task.dueAt)}</span>}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {task.status === "pending" && (
                          <Button size="sm" onClick={() => updateMutation.mutate({ id: task.id, status: "in_progress" })} className="bg-blue-600 hover:bg-blue-700 text-white h-7 text-xs">
                            Iniciar
                          </Button>
                        )}
                        {task.status === "in_progress" && (
                          <Button size="sm" onClick={() => updateMutation.mutate({ id: task.id, status: "done" })} className="bg-green-600 hover:bg-green-700 text-white h-7 text-xs">
                            Concluir
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
