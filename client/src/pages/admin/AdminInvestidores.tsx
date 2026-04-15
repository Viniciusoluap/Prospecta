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
import { ArrowLeft, TrendingUp, Plus, DollarSign, User } from "lucide-react";

function formatCurrencyBR(value: number | string | null | undefined) {
  if (!value && value !== 0) return "—";
  const num = typeof value === "string" ? parseFloat(value) : value || 0;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(num);
}

export default function AdminInvestidores() {
  const [open, setOpen] = useState(false);
  const [txOpen, setTxOpen] = useState(false);
  const [selectedInvestor, setSelectedInvestor] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    rate: "",
    initialBalance: "",
    notes: "",
  });
  const [txForm, setTxForm] = useState({
    type: "deposit" as any,
    amount: "",
    description: "",
    dueAt: "",
    notes: "",
  });

  const { data: investors = [], refetch } =
    trpc.investors.list.useQuery(undefined);

  const createMutation = trpc.investors.create.useMutation({
    onSuccess: () => {
      toast.success("Investidor cadastrado!");
      refetch();
      setOpen(false);
      setForm({
        name: "",
        phone: "",
        email: "",
        rate: "",
        initialBalance: "",
        notes: "",
      });
    },
    onError: e => toast.error(e.message),
  });

  const addTxMutation = trpc.investors.addTransaction.useMutation({
    onSuccess: () => {
      toast.success("Transação registrada!");
      refetch();
      setTxOpen(false);
      setTxForm({
        type: "deposit",
        amount: "",
        description: "",
        dueAt: "",
        notes: "",
      });
    },
    onError: e => toast.error(e.message),
  });

  const TX_LABELS: Record<string, string> = {
    deposit: "Aporte",
    return: "Retorno",
    withdrawal: "Saque",
    interest: "Juros",
  };

  const totalInvested = investors.reduce(
    (acc: number, inv: any) => acc + parseFloat(inv.balance || "0"),
    0
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
                Investidores
              </h1>
              <p className="text-gray-400 text-sm">
                Controle de sócios investidores e retornos
              </p>
            </div>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
                <Plus className="h-4 w-4 mr-2" /> Novo Investidor
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white">
              <DialogHeader>
                <DialogTitle className="text-[#C9A961]">
                  Cadastrar Investidor
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label className="text-gray-300">Nome</Label>
                    <Input
                      value={form.name}
                      onChange={e =>
                        setForm(f => ({ ...f, name: e.target.value }))
                      }
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300">Telefone</Label>
                    <Input
                      value={form.phone}
                      onChange={e =>
                        setForm(f => ({ ...f, phone: e.target.value }))
                      }
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300">Email</Label>
                    <Input
                      value={form.email}
                      onChange={e =>
                        setForm(f => ({ ...f, email: e.target.value }))
                      }
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300">Taxa de Retorno (%)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={form.rate}
                      onChange={e =>
                        setForm(f => ({ ...f, rate: e.target.value }))
                      }
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                      placeholder="ex: 1.8"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300">Saldo Inicial (R$)</Label>
                    <Input
                      type="number"
                      value={form.initialBalance}
                      onChange={e =>
                        setForm(f => ({ ...f, initialBalance: e.target.value }))
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
                      rate: form.rate ? parseFloat(form.rate) : undefined,
                      initialBalance: form.initialBalance
                        ? parseFloat(form.initialBalance)
                        : undefined,
                    })
                  }
                  disabled={createMutation.isPending || !form.name}
                  className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold"
                >
                  Cadastrar
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Transaction Dialog */}
      <Dialog open={txOpen} onOpenChange={setTxOpen}>
        <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white">
          <DialogHeader>
            <DialogTitle className="text-[#C9A961]">
              Registrar Transação
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-gray-300">Tipo</Label>
                <Select
                  value={txForm.type}
                  onValueChange={v => setTxForm(f => ({ ...f, type: v }))}
                >
                  <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deposit">Aporte</SelectItem>
                    <SelectItem value="return">Retorno</SelectItem>
                    <SelectItem value="withdrawal">Saque</SelectItem>
                    <SelectItem value="interest">Juros</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-gray-300">Valor (R$)</Label>
                <Input
                  type="number"
                  value={txForm.amount}
                  onChange={e =>
                    setTxForm(f => ({ ...f, amount: e.target.value }))
                  }
                  className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                />
              </div>
              <div className="col-span-2">
                <Label className="text-gray-300">Descrição</Label>
                <Input
                  value={txForm.description}
                  onChange={e =>
                    setTxForm(f => ({ ...f, description: e.target.value }))
                  }
                  className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                />
              </div>
              <div>
                <Label className="text-gray-300">Vencimento</Label>
                <Input
                  type="date"
                  value={txForm.dueAt}
                  onChange={e =>
                    setTxForm(f => ({ ...f, dueAt: e.target.value }))
                  }
                  className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                />
              </div>
            </div>
            <Button
              onClick={() =>
                selectedInvestor &&
                addTxMutation.mutate({
                  investorId: selectedInvestor,
                  ...txForm,
                  amount: parseFloat(txForm.amount),
                  dueAt: txForm.dueAt ? new Date(txForm.dueAt) : undefined,
                })
              }
              disabled={
                addTxMutation.isPending || !txForm.amount || !txForm.description
              }
              className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold"
            >
              Registrar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Summary */}
        <Card className="bg-[#2C3E50] border-[#C9A961]/20">
          <CardContent className="pt-6 flex items-center gap-3">
            <DollarSign className="h-8 w-8 text-[#C9A961]" />
            <div>
              <p className="text-gray-400 text-sm">Capital Total Investido</p>
              <p className="text-3xl font-bold text-[#C9A961]">
                {formatCurrencyBR(totalInvested)}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Investors */}
        {investors.length === 0 ? (
          <Card className="bg-[#2C3E50] border-[#C9A961]/20">
            <CardContent className="py-12 text-center text-gray-500">
              <TrendingUp className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p>Nenhum investidor cadastrado</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {investors.map((inv: any) => (
              <Card key={inv.id} className="bg-[#2C3E50] border-[#C9A961]/20">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-white flex items-center gap-2">
                      <User className="h-4 w-4 text-[#C9A961]" />
                      {inv.name}
                    </CardTitle>
                    <Badge
                      className={
                        inv.status === "active"
                          ? "bg-green-600 text-white"
                          : "bg-gray-600 text-white"
                      }
                    >
                      {inv.status === "active" ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="p-3 bg-[#1A2332] rounded-lg space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Saldo atual:</span>
                      <span className="font-bold text-[#C9A961] text-lg">
                        {formatCurrencyBR(inv.balance)}
                      </span>
                    </div>
                    {inv.rate && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Taxa retorno:</span>
                        <span className="text-green-400">{inv.rate}%</span>
                      </div>
                    )}
                    {inv.phone && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Telefone:</span>
                        <span className="text-gray-300">{inv.phone}</span>
                      </div>
                    )}
                  </div>
                  {inv.notes && (
                    <p className="text-xs text-gray-500 italic">{inv.notes}</p>
                  )}
                  <Button
                    size="sm"
                    onClick={() => {
                      setSelectedInvestor(inv.id);
                      setTxOpen(true);
                    }}
                    className="w-full bg-[#C9A961]/20 hover:bg-[#C9A961]/40 text-[#C9A961] border border-[#C9A961]/30 h-7 text-xs"
                  >
                    <Plus className="h-3 w-3 mr-1" /> Nova Transação
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
