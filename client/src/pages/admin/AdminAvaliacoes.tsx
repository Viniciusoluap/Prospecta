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
import { toast } from "sonner";
import { ArrowLeft, ClipboardCheck, Plus, FileSearch, Clock, CheckCircle2, XCircle } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  solicitada: "Solicitada",
  vistoria: "Vistoria",
  elaboracao: "Elaboração",
  revisao: "Revisão",
  entregue: "Entregue",
  cancelada: "Cancelada",
};

const STATUS_COLORS: Record<string, string> = {
  solicitada: "bg-gray-600",
  vistoria: "bg-blue-600",
  elaboracao: "bg-yellow-600",
  revisao: "bg-purple-600",
  entregue: "bg-green-600",
  cancelada: "bg-red-600",
};

const TIPO_LABELS: Record<string, string> = {
  mercado: "Mercado",
  locacao: "Locação",
  judicial: "Judicial",
  parecer_tecnico: "Parecer Técnico",
};

function formatCurrencyBR(value: string | number | null | undefined) {
  if (!value) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(num);
}

export default function AdminAvaliacoes() {
  const [open, setOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterTipo, setFilterTipo] = useState("all");
  const [form, setForm] = useState({
    tipo: "mercado", finalidade: "compra_venda",
    clienteNome: "", clienteCpf: "", clienteTel: "", clienteEmail: "",
    endereco: "", bairro: "", cidade: "", estado: "",
    areaConstruida: "", areaTerreno: "", quartos: "", banheiros: "", vagas: "",
    metodologia: "comparativo", avaliador: "", valorServico: "",
  });

  const { data: avaliacoes = [], refetch } = trpc.avaliacoes.list.useQuery({
    status: filterStatus !== "all" ? filterStatus : undefined,
    tipo: filterTipo !== "all" ? filterTipo : undefined,
  });

  const createMutation = trpc.avaliacoes.create.useMutation({
    onSuccess: () => {
      toast.success("Avaliação criada!");
      refetch();
      setOpen(false);
      setForm({
        tipo: "mercado", finalidade: "compra_venda",
        clienteNome: "", clienteCpf: "", clienteTel: "", clienteEmail: "",
        endereco: "", bairro: "", cidade: "", estado: "",
        areaConstruida: "", areaTerreno: "", quartos: "", banheiros: "", vagas: "",
        metodologia: "comparativo", avaliador: "", valorServico: "",
      });
    },
    onError: (e) => toast.error(e.message),
  });

  const total = avaliacoes.length;
  const pendentes = avaliacoes.filter((a: any) => ["solicitada", "vistoria", "elaboracao", "revisao"].includes(a.status)).length;
  const entregues = avaliacoes.filter((a: any) => a.status === "entregue").length;
  const canceladas = avaliacoes.filter((a: any) => a.status === "cancelada").length;

  function handleCreate() {
    createMutation.mutate({
      tipo: form.tipo,
      finalidade: form.finalidade,
      clienteNome: form.clienteNome,
      clienteCpf: form.clienteCpf || undefined,
      clienteTel: form.clienteTel,
      clienteEmail: form.clienteEmail || undefined,
      endereco: form.endereco,
      bairro: form.bairro,
      cidade: form.cidade,
      estado: form.estado,
      areaConstruida: form.areaConstruida ? parseFloat(form.areaConstruida) : undefined,
      areaTerreno: form.areaTerreno ? parseFloat(form.areaTerreno) : undefined,
      quartos: form.quartos ? parseInt(form.quartos) : undefined,
      banheiros: form.banheiros ? parseInt(form.banheiros) : undefined,
      vagas: form.vagas ? parseInt(form.vagas) : undefined,
      metodologia: form.metodologia,
      avaliador: form.avaliador,
      valorServico: form.valorServico ? parseFloat(form.valorServico) : undefined,
    });
  }

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
              <h1 className="text-2xl font-bold text-[#C9A961]">Avaliações (Laudos)</h1>
              <p className="text-gray-400 text-sm">Avaliação imobiliária — comparativo/renda/custo</p>
            </div>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
                <Plus className="h-4 w-4 mr-2" /> Nova Avaliação
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-[#C9A961]">Solicitar Avaliação</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-gray-300">Tipo</Label>
                    <Select value={form.tipo} onValueChange={(v) => setForm(f => ({ ...f, tipo: v }))}>
                      <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mercado">Mercado</SelectItem>
                        <SelectItem value="locacao">Locação</SelectItem>
                        <SelectItem value="judicial">Judicial</SelectItem>
                        <SelectItem value="parecer_tecnico">Parecer Técnico</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-gray-300">Finalidade</Label>
                    <Select value={form.finalidade} onValueChange={(v) => setForm(f => ({ ...f, finalidade: v }))}>
                      <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="compra_venda">Compra e Venda</SelectItem>
                        <SelectItem value="locacao">Locação</SelectItem>
                        <SelectItem value="judicial">Judicial</SelectItem>
                        <SelectItem value="garantia">Garantia</SelectItem>
                        <SelectItem value="inventario">Inventário</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-gray-300">Cliente</Label>
                    <Input value={form.clienteNome} onChange={e => setForm(f => ({ ...f, clienteNome: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                  <div>
                    <Label className="text-gray-300">CPF</Label>
                    <Input value={form.clienteCpf} onChange={e => setForm(f => ({ ...f, clienteCpf: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                  <div>
                    <Label className="text-gray-300">Telefone</Label>
                    <Input value={form.clienteTel} onChange={e => setForm(f => ({ ...f, clienteTel: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                  <div>
                    <Label className="text-gray-300">Email</Label>
                    <Input value={form.clienteEmail} onChange={e => setForm(f => ({ ...f, clienteEmail: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Label className="text-gray-300">Endereço</Label>
                    <Input value={form.endereco} onChange={e => setForm(f => ({ ...f, endereco: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                  <div>
                    <Label className="text-gray-300">Bairro</Label>
                    <Input value={form.bairro} onChange={e => setForm(f => ({ ...f, bairro: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-gray-300">Cidade</Label>
                      <Input value={form.cidade} onChange={e => setForm(f => ({ ...f, cidade: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-gray-300">UF</Label>
                      <Input value={form.estado} maxLength={2} onChange={e => setForm(f => ({ ...f, estado: e.target.value.toUpperCase() }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-gray-300">Área const. (m²)</Label>
                    <Input type="number" value={form.areaConstruida} onChange={e => setForm(f => ({ ...f, areaConstruida: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                  <div>
                    <Label className="text-gray-300">Área terreno (m²)</Label>
                    <Input type="number" value={form.areaTerreno} onChange={e => setForm(f => ({ ...f, areaTerreno: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                  <div>
                    <Label className="text-gray-300">Metodologia</Label>
                    <Select value={form.metodologia} onValueChange={(v) => setForm(f => ({ ...f, metodologia: v }))}>
                      <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="comparativo">Comparativo</SelectItem>
                        <SelectItem value="renda">Renda</SelectItem>
                        <SelectItem value="custo">Custo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-gray-300">Quartos</Label>
                    <Input type="number" value={form.quartos} onChange={e => setForm(f => ({ ...f, quartos: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                  <div>
                    <Label className="text-gray-300">Banheiros</Label>
                    <Input type="number" value={form.banheiros} onChange={e => setForm(f => ({ ...f, banheiros: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                  <div>
                    <Label className="text-gray-300">Vagas</Label>
                    <Input type="number" value={form.vagas} onChange={e => setForm(f => ({ ...f, vagas: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-gray-300">Avaliador</Label>
                    <Input value={form.avaliador} onChange={e => setForm(f => ({ ...f, avaliador: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                  <div>
                    <Label className="text-gray-300">Valor do serviço (R$)</Label>
                    <Input type="number" value={form.valorServico} onChange={e => setForm(f => ({ ...f, valorServico: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                </div>

                <Button
                  onClick={handleCreate}
                  disabled={createMutation.isPending || !form.clienteNome || !form.clienteTel || !form.endereco || !form.cidade || !form.estado || !form.avaliador}
                  className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold"
                >
                  Criar Avaliação
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Indicadores */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-[#2C3E50] border-[#C9A961]/20">
            <CardContent className="pt-6 flex items-center gap-3">
              <FileSearch className="h-7 w-7 text-[#C9A961]" />
              <div>
                <p className="text-gray-400 text-xs">Total</p>
                <p className="text-2xl font-bold text-white">{total}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#2C3E50] border-[#C9A961]/20">
            <CardContent className="pt-6 flex items-center gap-3">
              <Clock className="h-7 w-7 text-yellow-500" />
              <div>
                <p className="text-gray-400 text-xs">Em andamento</p>
                <p className="text-2xl font-bold text-white">{pendentes}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#2C3E50] border-[#C9A961]/20">
            <CardContent className="pt-6 flex items-center gap-3">
              <CheckCircle2 className="h-7 w-7 text-green-500" />
              <div>
                <p className="text-gray-400 text-xs">Entregues</p>
                <p className="text-2xl font-bold text-white">{entregues}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#2C3E50] border-[#C9A961]/20">
            <CardContent className="pt-6 flex items-center gap-3">
              <XCircle className="h-7 w-7 text-red-500" />
              <div>
                <p className="text-gray-400 text-xs">Canceladas</p>
                <p className="text-2xl font-bold text-white">{canceladas}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filtros */}
        <div className="flex gap-3">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-48 bg-[#2C3E50] border-[#C9A961]/30 text-white">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterTipo} onValueChange={setFilterTipo}>
            <SelectTrigger className="w-48 bg-[#2C3E50] border-[#C9A961]/30 text-white">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              {Object.entries(TIPO_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Lista */}
        {avaliacoes.length === 0 ? (
          <Card className="bg-[#2C3E50] border-[#C9A961]/20">
            <CardContent className="py-12 text-center text-gray-500">
              <ClipboardCheck className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p>Nenhuma avaliação encontrada</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {avaliacoes.map((a: any) => (
              <Link key={a.id} href={`/admin/avaliacoes/${a.id}`}>
                <Card className="bg-[#2C3E50] border-[#C9A961]/20 hover:border-[#C9A961]/50 transition-colors cursor-pointer">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-white text-base flex items-center gap-2">
                          {a.numero}
                          <Badge className={`${STATUS_COLORS[a.status]} text-white`}>{STATUS_LABELS[a.status]}</Badge>
                        </CardTitle>
                        <p className="text-sm text-gray-400 mt-1">{a.clienteNome} • {a.endereco}, {a.bairro} — {a.cidade}/{a.estado}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{TIPO_LABELS[a.tipo] ?? a.tipo} • {a.avaliador}</p>
                      </div>
                      <div className="text-right">
                        {a.valorEstimado && <p className="text-[#C9A961] font-bold text-lg">{formatCurrencyBR(a.valorEstimado)}</p>}
                        {a.valorServico && <p className="text-xs text-gray-400">Serviço: {formatCurrencyBR(a.valorServico)}</p>}
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
