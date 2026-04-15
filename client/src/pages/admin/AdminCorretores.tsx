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
import { toast } from "sonner";
import {
  ArrowLeft,
  Users,
  Plus,
  CheckCircle2,
  Clock,
  DollarSign,
} from "lucide-react";

function formatCurrencyBR(value: number | string | null | undefined) {
  if (!value) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(num);
}

function formatDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR");
}

export default function AdminCorretores() {
  const [open, setOpen] = useState(false);
  const [filterBroker, setFilterBroker] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [form, setForm] = useState({
    brokerName: "",
    clientName: "",
    projectName: "",
    totalAmount: "",
    installment1: "",
    installment2: "",
    installment3: "",
    installment4: "",
    dueDate1: "",
    dueDate2: "",
    dueDate3: "",
    dueDate4: "",
  });

  const { data: commissions = [], refetch } =
    trpc.brokerCommissions.list.useQuery({
      brokerName: filterBroker !== "all" ? filterBroker : undefined,
      status: filterStatus !== "all" ? filterStatus : undefined,
    });

  const createMutation = trpc.brokerCommissions.create.useMutation({
    onSuccess: () => {
      toast.success("Comissão cadastrada!");
      refetch();
      setOpen(false);
    },
    onError: e => toast.error(e.message),
  });

  const markPaidMutation = trpc.brokerCommissions.update.useMutation({
    onSuccess: () => {
      toast.success("Parcela paga!");
      refetch();
    },
    onError: e => toast.error(e.message),
  });

  const pendingTotal = commissions
    .filter((c: any) => c.status !== "paid")
    .reduce((acc: number, c: any) => {
      const paid = parseFloat(c.paidInstallments || "0");
      const total = parseFloat(c.totalAmount || "0");
      return acc + (total - paid);
    }, 0);

  // Get unique broker names
  const brokerNames = Array.from(
    new Set(commissions.map((c: any) => c.brokerName))
  );

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
                Controle de Corretores
              </h1>
              <p className="text-gray-400 text-sm">Comissões em 4 parcelas</p>
            </div>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
                <Plus className="h-4 w-4 mr-2" /> Nova Comissão
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white max-w-xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-[#C9A961]">
                  Registrar Comissão
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-gray-300">Corretor</Label>
                    <Input
                      value={form.brokerName}
                      onChange={e =>
                        setForm(f => ({ ...f, brokerName: e.target.value }))
                      }
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300">Cliente</Label>
                    <Input
                      value={form.clientName}
                      onChange={e =>
                        setForm(f => ({ ...f, clientName: e.target.value }))
                      }
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-gray-300">Projeto</Label>
                    <Input
                      value={form.projectName}
                      onChange={e =>
                        setForm(f => ({ ...f, projectName: e.target.value }))
                      }
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-gray-300">
                      Total da Comissão (R$)
                    </Label>
                    <Input
                      type="number"
                      value={form.totalAmount}
                      onChange={e =>
                        setForm(f => ({ ...f, totalAmount: e.target.value }))
                      }
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-300 text-sm font-medium">
                    Parcelas (4x)
                  </Label>
                  {[1, 2, 3, 4].map(n => (
                    <div key={n} className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-gray-400 text-xs">
                          Parcela {n} (R$)
                        </Label>
                        <Input
                          type="number"
                          value={(form as any)[`installment${n}`]}
                          onChange={e =>
                            setForm(f => ({
                              ...f,
                              [`installment${n}`]: e.target.value,
                            }))
                          }
                          className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-0.5 h-8 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-gray-400 text-xs">
                          Vencimento {n}
                        </Label>
                        <Input
                          type="date"
                          value={(form as any)[`dueDate${n}`]}
                          onChange={e =>
                            setForm(f => ({
                              ...f,
                              [`dueDate${n}`]: e.target.value,
                            }))
                          }
                          className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-0.5 h-8 text-sm"
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <Button
                  onClick={() =>
                    createMutation.mutate({
                      brokerName: form.brokerName,
                      clientName: form.clientName,
                      projectName: form.projectName,
                      totalAmount: parseFloat(form.totalAmount),
                      installment1: form.installment1
                        ? parseFloat(form.installment1)
                        : undefined,
                      installment2: form.installment2
                        ? parseFloat(form.installment2)
                        : undefined,
                      installment3: form.installment3
                        ? parseFloat(form.installment3)
                        : undefined,
                      installment4: form.installment4
                        ? parseFloat(form.installment4)
                        : undefined,
                      dueDate1: form.dueDate1
                        ? new Date(form.dueDate1)
                        : undefined,
                      dueDate2: form.dueDate2
                        ? new Date(form.dueDate2)
                        : undefined,
                      dueDate3: form.dueDate3
                        ? new Date(form.dueDate3)
                        : undefined,
                      dueDate4: form.dueDate4
                        ? new Date(form.dueDate4)
                        : undefined,
                    })
                  }
                  disabled={
                    createMutation.isPending ||
                    !form.brokerName ||
                    !form.totalAmount
                  }
                  className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold"
                >
                  Registrar Comissão
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Summary */}
        <Card className="bg-[#2C3E50] border-[#C9A961]/20">
          <CardContent className="pt-6 flex items-center gap-3">
            <DollarSign className="h-8 w-8 text-[#C9A961]" />
            <div>
              <p className="text-gray-400 text-sm">Total a Pagar (Pendente)</p>
              <p className="text-3xl font-bold text-[#C9A961]">
                {formatCurrencyBR(pendingTotal)}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Filters */}
        <div className="flex gap-3">
          <Select value={filterBroker} onValueChange={setFilterBroker}>
            <SelectTrigger className="w-48 bg-[#2C3E50] border-[#C9A961]/30 text-white">
              <SelectValue placeholder="Corretor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {brokerNames.map(b => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40 bg-[#2C3E50] border-[#C9A961]/30 text-white">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="pending">Pendente</SelectItem>
              <SelectItem value="partial">Parcial</SelectItem>
              <SelectItem value="paid">Pago</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Commissions */}
        {commissions.length === 0 ? (
          <Card className="bg-[#2C3E50] border-[#C9A961]/20">
            <CardContent className="py-12 text-center text-gray-500">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p>Nenhuma comissão registrada</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {commissions.map((c: any) => (
              <Card key={c.id} className="bg-[#2C3E50] border-[#C9A961]/20">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-white text-base">
                        {c.brokerName}
                      </CardTitle>
                      <p className="text-sm text-gray-400">
                        {c.clientName} • {c.projectName}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[#C9A961] font-bold text-lg">
                        {formatCurrencyBR(c.totalAmount)}
                      </p>
                      <Badge
                        className={
                          c.status === "paid"
                            ? "bg-green-600 text-white"
                            : c.status === "partial"
                              ? "bg-yellow-600 text-white"
                              : "bg-gray-600 text-white"
                        }
                      >
                        {c.status === "paid"
                          ? "Pago"
                          : c.status === "partial"
                            ? "Parcial"
                            : "Pendente"}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 3, 4].map(n => {
                      const installmentAmount = c[`installment${n}`];
                      const dueDate = c[`dueDate${n}`];
                      const paidDate = c[`paidDate${n}`];
                      if (!installmentAmount) return null;
                      return (
                        <div
                          key={n}
                          className={`p-2 rounded-lg ${paidDate ? "bg-green-900/30 border border-green-600/30" : "bg-[#1A2332] border border-[#C9A961]/10"}`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-gray-400">
                              {n}ª parcela
                            </span>
                            {paidDate ? (
                              <CheckCircle2 className="h-3 w-3 text-green-400" />
                            ) : (
                              <Clock className="h-3 w-3 text-gray-500" />
                            )}
                          </div>
                          <p className="font-medium text-white text-sm">
                            {formatCurrencyBR(installmentAmount)}
                          </p>
                          {dueDate && (
                            <p className="text-xs text-gray-500 mt-0.5">
                              {formatDate(dueDate)}
                            </p>
                          )}
                          {paidDate && (
                            <p className="text-xs text-green-400 mt-0.5">
                              Pago {formatDate(paidDate)}
                            </p>
                          )}
                          {!paidDate && (
                            <Button
                              size="sm"
                              onClick={() =>
                                markPaidMutation.mutate({
                                  id: c.id,
                                  [`paidDate${n}`]: new Date(),
                                })
                              }
                              className="w-full mt-1 bg-green-700 hover:bg-green-600 text-white h-5 text-xs"
                            >
                              Pagar
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
