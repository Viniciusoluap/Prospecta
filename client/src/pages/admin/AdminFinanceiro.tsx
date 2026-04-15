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
import { ArrowLeft, TrendingUp, TrendingDown, DollarSign, Plus, Users } from "lucide-react";

function formatCurrencyBR(value: number | string | null | undefined) {
  if (!value) return "R$ 0,00";
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(num);
}

const TRANSACTION_TYPES = [
  { key: "income", label: "Receita", color: "text-green-400" },
  { key: "expense", label: "Despesa", color: "text-red-400" },
  { key: "commission", label: "Comissão", color: "text-yellow-400" },
  { key: "salary", label: "Salário", color: "text-orange-400" },
  { key: "contractor_payment", label: "Pagamento Empreiteiro", color: "text-purple-400" },
];

export default function AdminFinanceiro() {
  const [open, setOpen] = useState(false);
  const [filterType, setFilterType] = useState("all");
  const [form, setForm] = useState({
    type: "income" as any,
    amount: "",
    description: "",
    category: "",
    paidAt: "",
    responsible: "",
    notes: "",
  });

  const { data: transactions = [], refetch } = trpc.financialTransactions.list.useQuery({
    type: filterType !== "all" ? filterType : undefined,
  });

  const createMutation = trpc.financialTransactions.create.useMutation({
    onSuccess: () => { toast.success("Transação registrada!"); refetch(); setOpen(false); setForm({ type: "income", amount: "", description: "", category: "", paidAt: "", responsible: "", notes: "" }); },
    onError: (e) => toast.error(e.message),
  });

  const { data: distributions = [], refetch: refetchDist } = trpc.partnerDistributions.list.useQuery({ status: "pending" });

  const markPaidMutation = trpc.partnerDistributions.markPaid.useMutation({
    onSuccess: () => { toast.success("Distribuição marcada como paga!"); refetchDist(); },
    onError: (e) => toast.error(e.message),
  });

  const totalIncome = transactions.filter(t => t.type === "income" || t.type === "commission").reduce((acc, t) => acc + parseFloat(t.amount || "0"), 0);
  const totalExpense = transactions.filter(t => t.type === "expense" || t.type === "salary" || t.type === "contractor_payment").reduce((acc, t) => acc + parseFloat(t.amount || "0"), 0);
  const profit = totalIncome - totalExpense;

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
              <h1 className="text-2xl font-bold text-[#C9A961]">Financeiro</h1>
              <p className="text-gray-400 text-sm">Receitas, despesas e distribuições</p>
            </div>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
                <Plus className="h-4 w-4 mr-2" /> Nova Transação
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white">
              <DialogHeader>
                <DialogTitle className="text-[#C9A961]">Registrar Transação</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-gray-300">Tipo</Label>
                    <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                      <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TRANSACTION_TYPES.map(t => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-gray-300">Valor (R$)</Label>
                    <Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" placeholder="0.00" />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-gray-300">Descrição</Label>
                    <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                  <div>
                    <Label className="text-gray-300">Categoria</Label>
                    <Input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" placeholder="ex: obra, taxa, comissão" />
                  </div>
                  <div>
                    <Label className="text-gray-300">Data Pagamento</Label>
                    <Input type="date" value={form.paidAt} onChange={e => setForm(f => ({ ...f, paidAt: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                  <div>
                    <Label className="text-gray-300">Responsável</Label>
                    <Input value={form.responsible} onChange={e => setForm(f => ({ ...f, responsible: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                </div>
                <div>
                  <Label className="text-gray-300">Observações</Label>
                  <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" rows={2} />
                </div>
                <Button
                  onClick={() => createMutation.mutate({ ...form, amount: parseFloat(form.amount), paidAt: form.paidAt ? new Date(form.paidAt) : undefined })}
                  disabled={createMutation.isPending || !form.amount || !form.description}
                  className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold"
                >
                  Registrar
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-[#2C3E50] border-green-500/30">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <TrendingUp className="h-8 w-8 text-green-400" />
                <div>
                  <p className="text-gray-400 text-sm">Total Receitas</p>
                  <p className="text-2xl font-bold text-green-400">{formatCurrencyBR(totalIncome)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#2C3E50] border-red-500/30">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <TrendingDown className="h-8 w-8 text-red-400" />
                <div>
                  <p className="text-gray-400 text-sm">Total Despesas</p>
                  <p className="text-2xl font-bold text-red-400">{formatCurrencyBR(totalExpense)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className={`bg-[#2C3E50] ${profit >= 0 ? "border-[#C9A961]/30" : "border-red-500/30"}`}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <DollarSign className={`h-8 w-8 ${profit >= 0 ? "text-[#C9A961]" : "text-red-400"}`} />
                <div>
                  <p className="text-gray-400 text-sm">Lucro Líquido</p>
                  <p className={`text-2xl font-bold ${profit >= 0 ? "text-[#C9A961]" : "text-red-400"}`}>{formatCurrencyBR(profit)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Pending Distributions */}
        {distributions.length > 0 && (
          <Card className="bg-[#2C3E50] border-[#C9A961]/20">
            <CardHeader>
              <CardTitle className="text-[#C9A961] flex items-center gap-2">
                <Users className="h-5 w-5" /> Distribuições Pendentes para Sócios
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {distributions.map((dist: any) => (
                  <div key={dist.id} className="flex items-center justify-between p-3 bg-[#1A2332] rounded-lg">
                    <div>
                      <p className="font-medium text-white">{dist.notes || `Distribuição #${dist.id}`}</p>
                      <p className="text-sm text-gray-400">{dist.percentage}% • {formatCurrencyBR(dist.amount)}</p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => markPaidMutation.mutate({ id: dist.id })}
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      Marcar Pago
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Transactions List */}
        <Card className="bg-[#2C3E50] border-[#C9A961]/20">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-[#C9A961]">Lançamentos</CardTitle>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-44 bg-[#1A2332] border-[#C9A961]/30 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {TRANSACTION_TYPES.map(t => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {transactions.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <DollarSign className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p>Nenhum lançamento encontrado</p>
              </div>
            ) : (
              <div className="space-y-2">
                {transactions.map((t: any) => {
                  const typeInfo = TRANSACTION_TYPES.find(tt => tt.key === t.type);
                  const isPositive = t.type === "income" || t.type === "commission";
                  return (
                    <div key={t.id} className="flex items-center justify-between p-3 bg-[#1A2332] rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Badge className="text-xs" style={{ backgroundColor: "transparent", color: typeInfo?.color?.replace("text-", "") }}>
                            {typeInfo?.label}
                          </Badge>
                          <span className="text-white font-medium">{t.description}</span>
                        </div>
                        {t.category && <p className="text-xs text-gray-500 mt-0.5">{t.category} {t.responsible ? `• ${t.responsible}` : ""}</p>}
                      </div>
                      <span className={`font-bold text-lg ${isPositive ? "text-green-400" : "text-red-400"}`}>
                        {isPositive ? "+" : "-"}{formatCurrencyBR(t.amount)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
