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
import { ArrowLeft, Mountain, Plus, MapPin } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  in_study: "Em estudo",
  completed: "Concluído",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-500/20 text-gray-300 border border-gray-500/40",
  in_study: "bg-blue-500/20 text-blue-300 border border-blue-500/40",
  completed: "bg-[#00FF00]/20 text-[#00FF00] border border-[#00FF00]/40",
};

function hectares(m2: string | number): string {
  const n = typeof m2 === "string" ? parseFloat(m2) : m2;
  if (!n) return "—";
  return `${(n / 10_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ha`;
}

export default function AdminIncorporacao() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string>("todos");
  const [form, setForm] = useState({ name: "", city: "", state: "MA", address: "", responsible: "" });

  const { data: estudos = [], isLoading, refetch } = trpc.incorporacao.list.useQuery({
    status: status === "todos" ? undefined : status,
  });

  const createMutation = trpc.incorporacao.create.useMutation({
    onSuccess: () => {
      toast.success("Estudo criado!");
      refetch();
      setOpen(false);
      setForm({ name: "", city: "", state: "MA", address: "", responsible: "" });
    },
    onError: (e) => toast.error(e.message),
  });

  const handleCreate = () => {
    if (!form.name || !form.city) {
      toast.error("Preencha nome e cidade.");
      return;
    }
    createMutation.mutate({
      name: form.name,
      city: form.city,
      state: form.state || undefined,
      address: form.address || undefined,
      responsible: form.responsible || undefined,
    });
  };

  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <div className="bg-[#0F1923] border-b border-[#C9A961]/20 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <Link href="/admin">
              <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-[#C9A961] flex items-center gap-2">
                <Mountain className="h-5 w-5" /> Incorporação
              </h1>
              <p className="text-gray-400 text-sm">Estudos de viabilidade e desenvolvimento imobiliário</p>
            </div>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
                <Plus className="h-4 w-4 mr-2" /> Novo Estudo
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-[#C9A961]">Novo Estudo de Incorporação</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div>
                  <Label className="text-gray-300">Nome do estudo *</Label>
                  <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Ex.: Loteamento Jardim das Palmeiras"
                    className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <Label className="text-gray-300">Cidade *</Label>
                    <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                      placeholder="Imperatriz"
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                  <div>
                    <Label className="text-gray-300">UF</Label>
                    <Input value={form.state} maxLength={2}
                      onChange={(e) => setForm((f) => ({ ...f, state: e.target.value.toUpperCase() }))}
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                </div>
                <div>
                  <Label className="text-gray-300">Endereço do terreno</Label>
                  <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                    className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                </div>
                <div>
                  <Label className="text-gray-300">Responsável</Label>
                  <Input value={form.responsible} onChange={(e) => setForm((f) => ({ ...f, responsible: e.target.value }))}
                    placeholder="Opcional"
                    className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                </div>
                <Button onClick={handleCreate} disabled={createMutation.isPending}
                  className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
                  {createMutation.isPending ? "Criando..." : "Criar Estudo"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-56 bg-[#2C3E50] border-[#C9A961]/30 text-white">
              <SelectValue placeholder="Situação" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas as situações</SelectItem>
              {Object.entries(STATUS_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <p className="text-gray-400">Carregando...</p>
        ) : estudos.length === 0 ? (
          <Card className="bg-[#1A2332]/60 border-[#C9A961]/20">
            <CardContent className="py-16 text-center">
              <Mountain className="h-16 w-16 text-[#C9A961]/40 mx-auto mb-4" />
              <p className="text-gray-300 font-medium">Nenhum estudo de incorporação ainda</p>
              <p className="text-gray-500 text-sm mt-1">Crie um estudo para começar o planejamento do empreendimento.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {estudos.map((e: any) => (
              <Link key={e.id} href={`/admin/incorporacao/${e.id}`}>
                <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm hover:border-[#C9A961]/60 transition-all cursor-pointer h-full">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-white text-base truncate">{e.name}</CardTitle>
                      <Badge className={STATUS_COLORS[e.status] ?? ""}>{STATUS_LABELS[e.status] ?? e.status}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-gray-400 flex items-center gap-1 mb-3">
                      <MapPin className="h-3 w-3" /> {e.city}/{e.state}
                    </p>
                    <div className="text-xs text-gray-500">
                      <span className="text-gray-400">Área: </span>
                      <span className="font-bold text-white">{hectares(e.areaM2)}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
