import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
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
import { ArrowLeft, Map, Plus } from "lucide-react";

function formatCurrencyBR(value: number | string | null | undefined) {
  if (!value) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(num);
}

const STATUS_COLORS: Record<string, string> = {
  available: "bg-green-600",
  reserved: "bg-yellow-600",
  sold: "bg-red-600",
  construction: "bg-blue-600",
};

const STATUS_LABELS: Record<string, string> = {
  available: "Disponível",
  reserved: "Reservado",
  sold: "Vendido",
  construction: "Em Obra",
};

const LOTEAMENTOS = [
  "Residencial Aurora",
  "Lot. Morada do Bosque",
  "Jet Reginaldo",
];

export default function AdminLotes() {
  const [open, setOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterLoteamento, setFilterLoteamento] = useState("all");
  const [form, setForm] = useState({
    loteamento: "",
    block: "",
    number: "",
    area: "",
    price: "",
    ownerName: "",
    ownerPhone: "",
    status: "available" as any,
    notes: "",
  });

  const { data: lots = [], refetch } = trpc.lots.list.useQuery({
    status: filterStatus !== "all" ? filterStatus : undefined,
    loteamento: filterLoteamento !== "all" ? filterLoteamento : undefined,
  });

  const createMutation = trpc.lots.create.useMutation({
    onSuccess: () => {
      toast.success("Lote cadastrado!");
      refetch();
      setOpen(false);
      setForm({
        loteamento: "",
        block: "",
        number: "",
        area: "",
        price: "",
        ownerName: "",
        ownerPhone: "",
        status: "available",
        notes: "",
      });
    },
    onError: e => toast.error(e.message),
  });

  const updateMutation = trpc.lots.update.useMutation({
    onSuccess: () => {
      toast.success("Atualizado!");
      refetch();
    },
    onError: e => toast.error(e.message),
  });

  const available = lots.filter(l => l.status === "available").length;
  const reserved = lots.filter(l => l.status === "reserved").length;
  const sold = lots.filter(l => l.status === "sold").length;

  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <div className="bg-[#0F1923] border-b border-[#C9A961]/20 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin">
              <Button
                variant="ghost"
                size="icon"
                className="text-gray-400 hover:text-white"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-[#C9A961]">
                Controle de Lotes
              </h1>
              <p className="text-gray-400 text-sm">
                Aurora, Morada do Bosque, Jet Reginaldo
              </p>
            </div>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
                <Plus className="h-4 w-4 mr-2" /> Novo Lote
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white">
              <DialogHeader>
                <DialogTitle className="text-[#C9A961]">
                  Cadastrar Lote
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label className="text-gray-300">Loteamento</Label>
                    <Select
                      value={form.loteamento}
                      onValueChange={v =>
                        setForm(f => ({ ...f, loteamento: v }))
                      }
                    >
                      <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1">
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                      <SelectContent>
                        {LOTEAMENTOS.map(l => (
                          <SelectItem key={l} value={l}>
                            {l}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-gray-300">Quadra</Label>
                    <Input
                      value={form.block}
                      onChange={e =>
                        setForm(f => ({ ...f, block: e.target.value }))
                      }
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                      placeholder="ex: Q01"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300">Lote</Label>
                    <Input
                      value={form.number}
                      onChange={e =>
                        setForm(f => ({ ...f, number: e.target.value }))
                      }
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                      placeholder="ex: L05"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300">Área (m²)</Label>
                    <Input
                      type="number"
                      value={form.area}
                      onChange={e =>
                        setForm(f => ({ ...f, area: e.target.value }))
                      }
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300">Preço (R$)</Label>
                    <Input
                      type="number"
                      value={form.price}
                      onChange={e =>
                        setForm(f => ({ ...f, price: e.target.value }))
                      }
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300">Status</Label>
                    <Select
                      value={form.status}
                      onValueChange={v => setForm(f => ({ ...f, status: v }))}
                    >
                      <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="available">Disponível</SelectItem>
                        <SelectItem value="reserved">Reservado</SelectItem>
                        <SelectItem value="sold">Vendido</SelectItem>
                        <SelectItem value="construction">Em Obra</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-gray-300">
                      Nome Proprietário/Cliente
                    </Label>
                    <Input
                      value={form.ownerName}
                      onChange={e =>
                        setForm(f => ({ ...f, ownerName: e.target.value }))
                      }
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300">Telefone</Label>
                    <Input
                      value={form.ownerPhone}
                      onChange={e =>
                        setForm(f => ({ ...f, ownerPhone: e.target.value }))
                      }
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-gray-300">Observações</Label>
                  <Textarea
                    value={form.notes}
                    onChange={e =>
                      setForm(f => ({ ...f, notes: e.target.value }))
                    }
                    className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                    rows={2}
                  />
                </div>
                <Button
                  onClick={() =>
                    createMutation.mutate({
                      ...form,
                      area: form.area ? parseFloat(form.area) : undefined,
                      price: form.price ? parseFloat(form.price) : undefined,
                    })
                  }
                  disabled={
                    createMutation.isPending || !form.loteamento || !form.number
                  }
                  className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold"
                >
                  Cadastrar Lote
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Summary */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-[#2C3E50] border-green-500/30">
            <CardContent className="pt-4 pb-4 text-center">
              <p className="text-3xl font-bold text-green-400">{available}</p>
              <p className="text-gray-400 text-sm mt-1">Disponíveis</p>
            </CardContent>
          </Card>
          <Card className="bg-[#2C3E50] border-yellow-500/30">
            <CardContent className="pt-4 pb-4 text-center">
              <p className="text-3xl font-bold text-yellow-400">{reserved}</p>
              <p className="text-gray-400 text-sm mt-1">Reservados</p>
            </CardContent>
          </Card>
          <Card className="bg-[#2C3E50] border-red-500/30">
            <CardContent className="pt-4 pb-4 text-center">
              <p className="text-3xl font-bold text-red-400">{sold}</p>
              <p className="text-gray-400 text-sm mt-1">Vendidos</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-44 bg-[#2C3E50] border-[#C9A961]/30 text-white">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="available">Disponíveis</SelectItem>
              <SelectItem value="reserved">Reservados</SelectItem>
              <SelectItem value="sold">Vendidos</SelectItem>
              <SelectItem value="construction">Em Obra</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterLoteamento} onValueChange={setFilterLoteamento}>
            <SelectTrigger className="w-56 bg-[#2C3E50] border-[#C9A961]/30 text-white">
              <SelectValue placeholder="Loteamento" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {LOTEAMENTOS.map(l => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Lots Grid */}
        {lots.length === 0 ? (
          <Card className="bg-[#2C3E50] border-[#C9A961]/20">
            <CardContent className="py-12 text-center text-gray-500">
              <Map className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p>Nenhum lote encontrado</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {lots.map((lot: any) => (
              <Card
                key={lot.id}
                className={`bg-[#2C3E50] border-[#C9A961]/20 cursor-pointer hover:border-[#C9A961]/50 transition-all`}
              >
                <CardContent className="pt-3 pb-3 px-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-white text-sm">
                      {lot.block ? `${lot.block} ` : ""}
                      {lot.number}
                    </span>
                    <Badge
                      className={`${STATUS_COLORS[lot.status] || "bg-gray-600"} text-white text-xs`}
                    >
                      {STATUS_LABELS[lot.status] || lot.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-400 truncate">
                    {lot.loteamento}
                  </p>
                  {lot.area && (
                    <p className="text-xs text-gray-400">{lot.area}m²</p>
                  )}
                  {lot.price && (
                    <p className="text-sm font-medium text-[#C9A961]">
                      {formatCurrencyBR(lot.price)}
                    </p>
                  )}
                  {lot.ownerName && (
                    <p className="text-xs text-gray-500 mt-1 truncate">
                      {lot.ownerName}
                    </p>
                  )}
                  {lot.status === "available" && (
                    <Button
                      size="sm"
                      onClick={() =>
                        updateMutation.mutate({
                          id: lot.id,
                          status: "reserved",
                        })
                      }
                      className="w-full mt-2 bg-yellow-600 hover:bg-yellow-700 text-white h-6 text-xs"
                    >
                      Reservar
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
