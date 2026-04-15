import { useState } from "react";
import { Link, useParams } from "wouter";
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
import { toast } from "sonner";
import {
  ArrowLeft,
  Plus,
  Building2,
  DollarSign,
  TrendingUp,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  HardHat,
  BarChart3,
} from "lucide-react";

const MEDICAO_TIPOS = [
  { key: "pls", label: "PLS (Por foto)" },
  { key: "rae", label: "RAE (Vistoria)" },
  { key: "marco_30", label: "Marco 30%" },
  { key: "marco_85", label: "Marco 85%" },
  { key: "final", label: "Final" },
  { key: "repactuacao", label: "Repactuação" },
];

const STATUS_MAP: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  pending: {
    label: "Pendente",
    color: "bg-gray-600 text-gray-200",
    icon: <Clock className="h-3 w-3" />,
  },
  cef_paid: {
    label: "CEF Pagou",
    color: "bg-blue-600 text-blue-100",
    icon: <DollarSign className="h-3 w-3" />,
  },
  received: {
    label: "Recebido",
    color: "bg-green-700 text-green-100",
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  contractor_paid: {
    label: "Empreiteiro Pago",
    color: "bg-yellow-600 text-yellow-100",
    icon: <HardHat className="h-3 w-3" />,
  },
};

function fmtBRL(cents: number | null | undefined) {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR");
}

export default function AdminObraMedicoes() {
  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id || "0");
  const { user } = useAuth();

  const [openNew, setOpenNew] = useState(false);
  const [openPay, setOpenPay] = useState<number | null>(null);
  const [newMed, setNewMed] = useState({
    tipo: "pls",
    dataPrevista: "",
    valorCef: "",
    empreiteiroCpf: "",
    notes: "",
  });
  const [payAmount, setPayAmount] = useState("");

  // Fetch project details
  const { data: project, isLoading: loadingProject } =
    trpc.construction.getProjectDetails.useQuery(
      { projectId },
      { enabled: !!projectId && user?.role === "admin" }
    );

  // Fetch measurements
  const { data: medicoes = [], refetch } = trpc.obraMedicoes.list.useQuery(
    { projectId },
    { enabled: !!projectId && user?.role === "admin" }
  );

  const createMutation = trpc.obraMedicoes.create.useMutation({
    onSuccess: () => {
      toast.success("Medição registrada com sucesso!");
      setOpenNew(false);
      setNewMed({
        tipo: "pls",
        dataPrevista: "",
        valorCef: "",
        empreiteiroCpf: "",
        notes: "",
      });
      refetch();
    },
    onError: e => toast.error(e.message),
  });

  const confirmReceiptMutation = trpc.obraMedicoes.confirmReceipt.useMutation({
    onSuccess: () => {
      toast.success("Recebimento confirmado!");
      refetch();
    },
    onError: e => toast.error(e.message),
  });

  const payContractorMutation = trpc.obraMedicoes.payContractor.useMutation({
    onSuccess: () => {
      toast.success("Pagamento registrado!");
      setOpenPay(null);
      setPayAmount("");
      refetch();
    },
    onError: e => toast.error(e.message),
  });

  if (user?.role !== "admin") return null;

  if (loadingProject) {
    return (
      <div className="min-h-screen bg-[#1A2332] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#C9A961]" />
      </div>
    );
  }

  // DRE Summary calculations
  const totalRecebido = medicoes
    .filter(m => m.status === "received" || m.status === "contractor_paid")
    .reduce((sum, m) => sum + (m.valorTransferido || 0), 0);
  const totalPagoEmpreiteiros = medicoes
    .filter(m => m.status === "contractor_paid")
    .reduce((sum, m) => sum + (m.valorPagoEmpreiteiro || 0), 0);
  const saldoProspecta = totalRecebido - totalPagoEmpreiteiros;
  const estimatedProfit = project
    ? parseFloat(project.contractValue || "0") -
      parseFloat((project as any).contractorPayment || "0") -
      parseFloat((project as any).materialCost || "0") -
      parseFloat(project.lotCost || "0")
    : 0;

  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      {/* Header */}
      <div className="bg-[#0F1923] border-b border-[#C9A961]/20 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin/obras">
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
                Medições da Obra
              </h1>
              <p className="text-gray-400 text-sm">
                {project?.title || `Obra #${projectId}`}
                {project?.address ? ` — ${project.address}` : ""}
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Link href={`/admin/obras/editar/${projectId}`}>
              <Button
                variant="outline"
                className="border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10"
              >
                Editar Obra
              </Button>
            </Link>
            <Dialog open={openNew} onOpenChange={setOpenNew}>
              <DialogTrigger asChild>
                <Button className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
                  <Plus className="h-4 w-4 mr-2" /> Registrar Medição
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white max-w-lg">
                <DialogHeader>
                  <DialogTitle className="text-[#C9A961]">
                    Nova Medição
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label className="text-gray-300">Tipo de Medição</Label>
                    <Select
                      value={newMed.tipo}
                      onValueChange={v => setNewMed({ ...newMed, tipo: v })}
                    >
                      <SelectTrigger className="bg-[#0F1923] border-[#C9A961]/30 text-white mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-[#0F1923] border-[#C9A961]/30 text-white">
                        {MEDICAO_TIPOS.map(t => (
                          <SelectItem key={t.key} value={t.key}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-gray-300">Data Prevista</Label>
                    <Input
                      type="date"
                      value={newMed.dataPrevista}
                      onChange={e =>
                        setNewMed({ ...newMed, dataPrevista: e.target.value })
                      }
                      className="bg-[#0F1923] border-[#C9A961]/30 text-white mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300">
                      Valor Esperado CEF (R$)
                    </Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={newMed.valorCef}
                      onChange={e =>
                        setNewMed({ ...newMed, valorCef: e.target.value })
                      }
                      placeholder="Ex: 45000.00"
                      className="bg-[#0F1923] border-[#C9A961]/30 text-white mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300">Observações</Label>
                    <Input
                      value={newMed.notes}
                      onChange={e =>
                        setNewMed({ ...newMed, notes: e.target.value })
                      }
                      placeholder="Observações opcionais"
                      className="bg-[#0F1923] border-[#C9A961]/30 text-white mt-1"
                    />
                  </div>
                  <div className="flex gap-3 justify-end pt-2">
                    <Button
                      variant="ghost"
                      onClick={() => setOpenNew(false)}
                      className="text-gray-400"
                    >
                      Cancelar
                    </Button>
                    <Button
                      className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold"
                      disabled={createMutation.isPending}
                      onClick={() => {
                        createMutation.mutate({
                          projectId,
                          tipo: newMed.tipo as any,
                          dataPrevista: newMed.dataPrevista
                            ? new Date(newMed.dataPrevista)
                            : undefined,
                          valorCef: newMed.valorCef
                            ? Math.round(parseFloat(newMed.valorCef) * 100)
                            : undefined,
                          notes: newMed.notes || undefined,
                        });
                      }}
                    >
                      {createMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Salvar"
                      )}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Financial Summary */}
        {project && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-[#0F1923] border-[#C9A961]/20">
              <CardContent className="pt-4 pb-4">
                <p className="text-gray-400 text-xs mb-1">VGV (Valor Global)</p>
                <p className="text-[#C9A961] font-bold text-xl">
                  {fmtBRL(parseFloat(project.contractValue || "0"))}
                </p>
              </CardContent>
            </Card>
            <Card className="bg-[#0F1923] border-[#C9A961]/20">
              <CardContent className="pt-4 pb-4">
                <p className="text-gray-400 text-xs mb-1">Gasto Construção</p>
                <p className="text-white font-bold text-xl">
                  {fmtBRL(
                    parseFloat((project as any).contractorPayment || "0")
                  )}
                </p>
              </CardContent>
            </Card>
            <Card className="bg-[#0F1923] border-[#C9A961]/20">
              <CardContent className="pt-4 pb-4">
                <p className="text-gray-400 text-xs mb-1">Recebido Total</p>
                <p className="text-green-400 font-bold text-xl">
                  {fmtBRL(totalRecebido)}
                </p>
              </CardContent>
            </Card>
            <Card className="bg-[#0F1923] border-[#C9A961]/20">
              <CardContent className="pt-4 pb-4">
                <p className="text-gray-400 text-xs mb-1">Lucro Estimado</p>
                <p className="text-yellow-400 font-bold text-xl">
                  {fmtBRL(estimatedProfit)}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Measurements Table */}
        <Card className="bg-[#0F1923] border-[#C9A961]/20">
          <CardHeader>
            <CardTitle className="text-[#C9A961] flex items-center gap-2">
              <BarChart3 className="h-5 w-5" /> Medições
            </CardTitle>
          </CardHeader>
          <CardContent>
            {medicoes.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Building2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>Nenhuma medição registrada ainda.</p>
                <p className="text-sm mt-1">
                  Clique em "Registrar Medição" para começar.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#C9A961]/20">
                      <th className="text-left py-3 px-3 text-gray-400 font-medium">
                        Tipo
                      </th>
                      <th className="text-left py-3 px-3 text-gray-400 font-medium">
                        Data Prevista
                      </th>
                      <th className="text-left py-3 px-3 text-gray-400 font-medium">
                        Receb. CEF
                      </th>
                      <th className="text-right py-3 px-3 text-gray-400 font-medium">
                        Valor CEF
                      </th>
                      <th className="text-left py-3 px-3 text-gray-400 font-medium">
                        Data Transferência
                      </th>
                      <th className="text-right py-3 px-3 text-gray-400 font-medium">
                        Valor Transferido
                      </th>
                      <th className="text-left py-3 px-3 text-gray-400 font-medium">
                        Status
                      </th>
                      <th className="text-right py-3 px-3 text-gray-400 font-medium">
                        Pago Empreiteiro
                      </th>
                      <th className="text-center py-3 px-3 text-gray-400 font-medium">
                        Ações
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {medicoes.map(m => {
                      const statusInfo =
                        STATUS_MAP[m.status] || STATUS_MAP.pending;
                      const tipoLabel =
                        MEDICAO_TIPOS.find(t => t.key === m.tipo)?.label ||
                        m.tipo;
                      return (
                        <tr
                          key={m.id}
                          className="border-b border-[#C9A961]/10 hover:bg-[#C9A961]/5 transition-colors"
                        >
                          <td className="py-3 px-3 font-medium text-white">
                            {tipoLabel}
                          </td>
                          <td className="py-3 px-3 text-gray-300">
                            {fmtDate(m.dataPrevista)}
                          </td>
                          <td className="py-3 px-3 text-gray-300">
                            {fmtDate(m.dataRecebimentoCef)}
                          </td>
                          <td className="py-3 px-3 text-right text-gray-300">
                            {fmtBRL(m.valorCef)}
                          </td>
                          <td className="py-3 px-3 text-gray-300">
                            {fmtDate(m.dataTransferencia)}
                          </td>
                          <td className="py-3 px-3 text-right text-green-400 font-medium">
                            {fmtBRL(m.valorTransferido)}
                          </td>
                          <td className="py-3 px-3">
                            <Badge
                              className={`${statusInfo.color} flex items-center gap-1 w-fit text-xs`}
                            >
                              {statusInfo.icon}
                              {statusInfo.label}
                            </Badge>
                          </td>
                          <td className="py-3 px-3 text-right text-yellow-400">
                            {fmtBRL(m.valorPagoEmpreiteiro)}
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-2 justify-center">
                              {m.status === "cef_paid" && (
                                <Button
                                  size="sm"
                                  className="bg-green-700 hover:bg-green-600 text-white text-xs h-7"
                                  onClick={() => {
                                    const transferValue = prompt(
                                      "Valor transferido pelo cliente (R$):"
                                    );
                                    if (!transferValue) return;
                                    confirmReceiptMutation.mutate({
                                      id: m.id,
                                      valorTransferido: Math.round(
                                        parseFloat(transferValue) * 100
                                      ),
                                      dataTransferencia: new Date(),
                                    });
                                  }}
                                >
                                  Confirmar Recebimento
                                </Button>
                              )}
                              {m.status === "pending" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-[#C9A961]/30 text-[#C9A961] hover:bg-[#C9A961]/10 text-xs h-7"
                                  onClick={() => {
                                    confirmReceiptMutation.mutate({
                                      id: m.id,
                                      cefPaid: true,
                                      dataRecebimentoCef: new Date(),
                                    });
                                  }}
                                >
                                  CEF Pagou
                                </Button>
                              )}
                              {m.status === "received" && (
                                <Dialog
                                  open={openPay === m.id}
                                  onOpenChange={v => {
                                    setOpenPay(v ? m.id : null);
                                    setPayAmount("");
                                  }}
                                >
                                  <DialogTrigger asChild>
                                    <Button
                                      size="sm"
                                      className="bg-yellow-600 hover:bg-yellow-500 text-white text-xs h-7"
                                    >
                                      <HardHat className="h-3 w-3 mr-1" /> Pagar
                                      Empreiteiro
                                    </Button>
                                  </DialogTrigger>
                                  <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white max-w-sm">
                                    <DialogHeader>
                                      <DialogTitle className="text-[#C9A961]">
                                        Pagar Empreiteiro
                                      </DialogTitle>
                                    </DialogHeader>
                                    <div className="space-y-4">
                                      <p className="text-gray-400 text-sm">
                                        Medição:{" "}
                                        <span className="text-white">
                                          {tipoLabel}
                                        </span>
                                      </p>
                                      <div>
                                        <Label className="text-gray-300">
                                          Valor Pago (R$)
                                        </Label>
                                        <Input
                                          type="number"
                                          step="0.01"
                                          value={payAmount}
                                          onChange={e =>
                                            setPayAmount(e.target.value)
                                          }
                                          placeholder="Ex: 35000.00"
                                          className="bg-[#0F1923] border-[#C9A961]/30 text-white mt-1"
                                        />
                                      </div>
                                      <div className="flex gap-3 justify-end">
                                        <Button
                                          variant="ghost"
                                          onClick={() => setOpenPay(null)}
                                          className="text-gray-400"
                                        >
                                          Cancelar
                                        </Button>
                                        <Button
                                          className="bg-yellow-600 hover:bg-yellow-500 text-white font-bold"
                                          disabled={
                                            payContractorMutation.isPending ||
                                            !payAmount
                                          }
                                          onClick={() => {
                                            payContractorMutation.mutate({
                                              id: m.id,
                                              valorPagoEmpreiteiro: Math.round(
                                                parseFloat(payAmount) * 100
                                              ),
                                            });
                                          }}
                                        >
                                          {payContractorMutation.isPending ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                          ) : (
                                            "Confirmar Pagamento"
                                          )}
                                        </Button>
                                      </div>
                                    </div>
                                  </DialogContent>
                                </Dialog>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* DRE Summary */}
        <Card className="bg-[#0F1923] border-[#C9A961]/20">
          <CardHeader>
            <CardTitle className="text-[#C9A961] flex items-center gap-2">
              <TrendingUp className="h-5 w-5" /> DRE — Demonstração de
              Resultados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-[#1A2332] rounded-lg p-4 border border-[#C9A961]/10">
                <p className="text-gray-400 text-xs mb-1">Total Recebido</p>
                <p className="text-green-400 font-bold text-lg">
                  {fmtBRL(totalRecebido)}
                </p>
              </div>
              <div className="bg-[#1A2332] rounded-lg p-4 border border-[#C9A961]/10">
                <p className="text-gray-400 text-xs mb-1">Pago Empreiteiros</p>
                <p className="text-red-400 font-bold text-lg">
                  ({fmtBRL(totalPagoEmpreiteiros)})
                </p>
              </div>
              <div className="bg-[#1A2332] rounded-lg p-4 border border-[#C9A961]/10">
                <p className="text-gray-400 text-xs mb-1">Taxas Pagas</p>
                <p className="text-orange-400 font-bold text-lg">—</p>
              </div>
              <div className="bg-[#1A2332] rounded-lg p-4 border border-[#C9A961]/10">
                <p className="text-gray-400 text-xs mb-1">Saldo Prospecta</p>
                <p
                  className={`font-bold text-lg ${saldoProspecta >= 0 ? "text-[#C9A961]" : "text-red-400"}`}
                >
                  {fmtBRL(saldoProspecta)}
                </p>
              </div>
              <div className="bg-[#1A2332] rounded-lg p-4 border border-[#C9A961]/20 border-2">
                <p className="text-gray-400 text-xs mb-1">Lucro Estimado</p>
                <p className="text-[#C9A961] font-bold text-lg">
                  {fmtBRL(estimatedProfit)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
