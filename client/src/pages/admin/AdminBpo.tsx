import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { formatCurrency } from "@/lib/format";
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
  ArrowLeft,
  Building2,
  Receipt,
  TrendingDown,
  BarChart3,
  Plus,
  Landmark,
  BookOpen,
} from "lucide-react";
import TaxAccountingPanel from "./TaxAccountingPanel";
import AdminRelatorios from "./AdminRelatorios";
import BancosPanel from "./BancosPanel";
import { rotulo } from "@shared/rotulos";
import { CATEGORIAS_BPO, TRANSFERENCIA_INTERNA } from "@shared/financeiro/bpo-extrato";
import { situacaoDoLancamento } from "@shared/financeiro/bpo-asaas";

// Pedido de 25/10 (noite), item 11: categorias do "+ Lançamento" (transferência interna não é receita nem despesa).
const CATEGORIAS_LANCAMENTO = CATEGORIAS_BPO.filter(c => c !== TRANSFERENCIA_INTERNA);
const SITUACAO: Record<string, { texto: string; cor: string }> = {
  pago: { texto: "PAGO", cor: "text-green-500" },
  vencido: { texto: "VENCIDO", cor: "text-red-400" },
  aberto: { texto: "EM ABERTO", cor: "text-amber-300" },
};

function formatCurrencyBR(value: number | string | null | undefined) {
  if (!value) return formatCurrency(0);
  const num = typeof value === "string" ? parseFloat(value) : value;
  return formatCurrency(num);
}

type Aba =
  | "clientes"
  | "cobrancas"
  | "despesas"
  | "dre"
  | "bancos"
  | "contabilidade"
  | "relatorios";

const SERVICOS_OPCOES = [
  "contas_pagar",
  "contas_receber",
  "folha",
  "fiscal",
  "conciliacao",
];

const emptyClienteForm = {
  // Pedido de 25/10 (noite), item 10: lead do CRM (dados vêm dele) ou cadastro livre (fornecedor/terceiro).
  leadId: null as number | null,
  razaoSocial: "",
  cnpj: "",
  cpf: "",
  responsavel: "",
  email: "",
  telefone: "",
  servicos: [] as string[],
  honorarios: "",
  diaVencimento: "10",
  dataInicio: "",
  observacoes: "",
};

const emptyLancamentoForm = {
  clienteId: "",
  clienteNomeLivre: "",
  tipo: "cobranca" as "cobranca" | "despesa",
  categoria: "",
  descricao: "",
  valor: "",
  vencimento: "",
  competencia: "",
  centroCustos: "",
};

export default function AdminBpo({ initialTab }: { initialTab?: Aba } = {}) {
  const requestedTab = new URLSearchParams(window.location.search).get(
    "aba"
  ) as Aba | null;
  const [aba, setAba] = useState<Aba>(
    requestedTab &&
      [
        "clientes",
        "cobrancas",
        "despesas",
        "dre",
        "bancos",
        "contabilidade",
        "relatorios",
      ].includes(requestedTab)
      ? requestedTab
      : (initialTab ?? "clientes")
  );
  const [clienteOpen, setClienteOpen] = useState(false);
  const [lancamentoOpen, setLancamentoOpen] = useState(false);
  const [clienteForm, setClienteForm] = useState(emptyClienteForm);
  const [lancamentoForm, setLancamentoForm] = useState(emptyLancamentoForm);
  const [modoCliente, setModoCliente] = useState<"lead" | "livre">("lead");
  const [buscaLead, setBuscaLead] = useState("");
  const [clienteAberto, setClienteAberto] = useState<number | null>(null);
  const [dreVisao, setDreVisao] = useState<"competencia" | "categoria">("competencia");
  const { data: leadsAchados = [], isFetching: buscandoLeads } = trpc.bpo.clientes.buscarLeads.useQuery(
    { q: buscaLead.trim() },
    { enabled: clienteOpen && modoCliente === "lead" && buscaLead.trim().length >= 2 && !clienteForm.leadId },
  );

  const utils = trpc.useUtils();
  const { data: clientes = [] } = trpc.bpo.clientes.list.useQuery();
  const { data: lancamentos = [] } = trpc.bpo.lancamentos.list.useQuery();
  const { data: dreRows = [] } = trpc.bpo.dre.useQuery();
  const { data: dreCategorias = [] } = trpc.bpo.dreCategorias.useQuery();

  const createCliente = trpc.bpo.clientes.create.useMutation({
    onSuccess: r => {
      toast.success(`Cliente BPO cadastrado!${r.vinculadas ? ` ${r.vinculadas} movimentação(ões) do mesmo nome vinculada(s).` : ""}`);
      utils.bpo.clientes.list.invalidate();
      utils.bpo.lancamentos.list.invalidate();
      setClienteOpen(false);
      setClienteForm(emptyClienteForm);
      setBuscaLead("");
    },
    onError: e => toast.error(e.message),
  });

  const createLancamento = trpc.bpo.lancamentos.create.useMutation({
    onSuccess: () => {
      toast.success("Lançamento registrado!");
      utils.bpo.lancamentos.list.invalidate();
      utils.bpo.dre.invalidate();
      utils.bpo.dreCategorias.invalidate();
      utils.bpo.clientes.list.invalidate();
      setLancamentoOpen(false);
      setLancamentoForm(emptyLancamentoForm);
    },
    onError: e => toast.error(e.message),
  });

  const marcarPago = trpc.bpo.lancamentos.marcarPago.useMutation({
    onSuccess: () => {
      toast.success("Marcado como pago!");
      utils.bpo.lancamentos.list.invalidate();
      utils.bpo.dre.invalidate();
      utils.bpo.clientes.list.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const cobrancas = lancamentos.filter((l: any) => l.tipo !== "despesa");
  const despesas = lancamentos.filter((l: any) => l.tipo === "despesa");
  const clienteNome = (l: any) =>
    clientes.find((c: any) => c.id === l.clienteId)?.razaoSocial ??
    l.clienteNomeLivre ??
    "—";

  const abaClass = (a: Aba) =>
    `px-4 py-2 rounded-lg text-sm font-bold transition-colors ${aba === a ? "bg-[#C9A961] text-[#1A2332]" : "bg-[#2C3E50] text-gray-300 hover:text-white"}`;

  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <div className="bg-[#0F1923] border-b border-[#C9A961]/20 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <Link href="/admin">
              <Button
                variant="ghost"
                size="icon"
                className="w-fit text-gray-400 hover:text-white"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-[#C9A961]">
                BPO Financeiro
              </h1>
              <p className="text-gray-400 text-sm">
                Terceirização contábil — clientes, cobranças e DRE
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Dialog open={clienteOpen} onOpenChange={setClienteOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="border-[#C9A961]/30 text-[#C9A961]"
                >
                  <Plus className="h-4 w-4 mr-2" /> Cliente BPO
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="text-[#C9A961]">
                    Novo Cliente BPO
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-4">
                  <div className="flex gap-2">
                    {(["lead", "livre"] as const).map(m => (
                      <button key={m} type="button"
                        onClick={() => { setModoCliente(m); setClienteForm(emptyClienteForm); setBuscaLead(""); }}
                        className={`px-3 py-1 rounded-full text-xs font-bold border ${modoCliente === m ? "bg-[#C9A961] text-[#1A2332] border-[#C9A961]" : "border-[#C9A961]/30 text-gray-300"}`}>
                        {m === "lead" ? "Lead do CRM" : "Cadastro livre (fornecedor/terceiro)"}
                      </button>
                    ))}
                  </div>
                  {modoCliente === "lead" && (
                    <div>
                      <Label className="text-gray-300">Buscar lead (nome ou telefone)</Label>
                      {clienteForm.leadId ? (
                        <div className="mt-1 flex items-center justify-between gap-2 rounded bg-[#2C3E50] p-2 text-sm">
                          <span>{clienteForm.razaoSocial} — dados do CRM</span>
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-[#C9A961]"
                            onClick={() => setClienteForm(emptyClienteForm)}>Trocar</Button>
                        </div>
                      ) : (
                        <>
                          <Input value={buscaLead} onChange={e => setBuscaLead(e.target.value)} placeholder="ex.: Maria ou 18 99..."
                            className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                          {buscaLead.trim().length >= 2 && (
                            <div className="mt-1 max-h-48 overflow-y-auto rounded border border-[#C9A961]/20">
                              {buscandoLeads && <p className="p-2 text-xs text-gray-400">Buscando…</p>}
                              {!buscandoLeads && leadsAchados.length === 0 && <p className="p-2 text-xs text-gray-400">Nenhum lead encontrado.</p>}
                              {leadsAchados.map(l => (
                                <button key={l.id} type="button" className="block w-full p-2 text-left text-sm hover:bg-[#2C3E50]"
                                  onClick={() => setClienteForm(f => ({
                                    ...f, leadId: l.id, razaoSocial: l.name, cpf: l.cpf ?? "", telefone: l.phone ?? "", email: l.email ?? "",
                                  }))}>
                                  {l.name} <span className="text-xs text-gray-400">{l.phone}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <Label className="text-gray-300">Nome / Razão Social *</Label>
                      <Input
                        value={clienteForm.razaoSocial}
                        disabled={Boolean(clienteForm.leadId)}
                        onChange={e =>
                          setClienteForm(f => ({
                            ...f,
                            razaoSocial: e.target.value,
                          }))
                        }
                        className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-300">CNPJ</Label>
                      <Input
                        value={clienteForm.cnpj}
                        onChange={e =>
                          setClienteForm(f => ({ ...f, cnpj: e.target.value }))
                        }
                        className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-300">CPF</Label>
                      <Input
                        value={clienteForm.cpf}
                        disabled={Boolean(clienteForm.leadId)}
                        onChange={e =>
                          setClienteForm(f => ({ ...f, cpf: e.target.value }))
                        }
                        className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-300">Responsável</Label>
                      <Input
                        value={clienteForm.responsavel}
                        placeholder="igual ao nome, se vazio"
                        onChange={e =>
                          setClienteForm(f => ({
                            ...f,
                            responsavel: e.target.value,
                          }))
                        }
                        className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-300">Telefone</Label>
                      <Input
                        value={clienteForm.telefone}
                        disabled={Boolean(clienteForm.leadId)}
                        onChange={e =>
                          setClienteForm(f => ({
                            ...f,
                            telefone: e.target.value,
                          }))
                        }
                        className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                      />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-gray-300">Email</Label>
                      <Input
                        value={clienteForm.email}
                        disabled={Boolean(clienteForm.leadId)}
                        onChange={e =>
                          setClienteForm(f => ({ ...f, email: e.target.value }))
                        }
                        className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-300">
                        Honorário mensal (R$, opcional)
                      </Label>
                      <CurrencyInput
                        value={clienteForm.honorarios ? Number(clienteForm.honorarios) : 0}
                        onChange={v =>
                          setClienteForm(f => ({
                            ...f,
                            honorarios: v ? String(v) : "",
                          }))
                        }
                        className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-300">Dia de Vencimento</Label>
                      <Input
                        type="number"
                        value={clienteForm.diaVencimento}
                        onChange={e =>
                          setClienteForm(f => ({
                            ...f,
                            diaVencimento: e.target.value,
                          }))
                        }
                        className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                      />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-gray-300">Data de início (opcional)</Label>
                      <Input
                        type="date"
                        value={clienteForm.dataInicio}
                        onChange={e =>
                          setClienteForm(f => ({
                            ...f,
                            dataInicio: e.target.value,
                          }))
                        }
                        className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                      />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-gray-300 block mb-1">
                        Serviços Contratados
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {SERVICOS_OPCOES.map(s => {
                          const active = clienteForm.servicos.includes(s);
                          return (
                            <button
                              key={s}
                              type="button"
                              onClick={() =>
                                setClienteForm(f => ({
                                  ...f,
                                  servicos: active
                                    ? f.servicos.filter(x => x !== s)
                                    : [...f.servicos, s],
                                }))
                              }
                              className={`px-3 py-1 rounded-full text-xs font-bold border ${active ? "bg-[#C9A961] text-[#1A2332] border-[#C9A961]" : "border-[#C9A961]/30 text-gray-300"}`}
                            >
                              {s.replace("_", " ")}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="col-span-2">
                      <Label className="text-gray-300">Observações</Label>
                      <Textarea
                        value={clienteForm.observacoes}
                        onChange={e =>
                          setClienteForm(f => ({
                            ...f,
                            observacoes: e.target.value,
                          }))
                        }
                        className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                        rows={2}
                      />
                    </div>
                  </div>
                  <Button
                    onClick={() =>
                      createCliente.mutate({
                        ...clienteForm,
                        leadId: clienteForm.leadId,
                        honorarios: clienteForm.honorarios ? parseFloat(clienteForm.honorarios) : null,
                        diaVencimento:
                          Math.min(31, Math.max(1, parseInt(clienteForm.diaVencimento) || 10)),
                        dataInicio: clienteForm.dataInicio || null,
                      })
                    }
                    disabled={
                      createCliente.isPending ||
                      (modoCliente === "lead" ? !clienteForm.leadId : clienteForm.razaoSocial.trim().length < 2)
                    }
                    className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold"
                  >
                    Cadastrar Cliente
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={lancamentoOpen} onOpenChange={setLancamentoOpen}>
              <DialogTrigger asChild>
                <Button className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
                  <Plus className="h-4 w-4 mr-2" /> Lançamento
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="text-[#C9A961]">
                    Novo Lançamento
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-gray-300">Tipo</Label>
                      <Select
                        value={lancamentoForm.tipo}
                        onValueChange={(v: any) =>
                          setLancamentoForm(f => ({ ...f, tipo: v }))
                        }
                      >
                        <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cobranca">Cobrança</SelectItem>
                          <SelectItem value="despesa">Despesa</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-gray-300">Categoria *</Label>
                      <Select
                        value={lancamentoForm.categoria || undefined}
                        onValueChange={v => setLancamentoForm(f => ({ ...f, categoria: v }))}
                      >
                        <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1">
                          <SelectValue placeholder="Escolha" />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIAS_LANCAMENTO.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-gray-300">Cliente BPO</Label>
                      <Select
                        value={lancamentoForm.clienteId || "none"}
                        onValueChange={v =>
                          setLancamentoForm(f => ({
                            ...f,
                            clienteId: v === "none" ? "" : v,
                          }))
                        }
                      >
                        <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">
                            Nenhum (nome livre)
                          </SelectItem>
                          {clientes.map((c: any) => (
                            <SelectItem key={c.id} value={String(c.id)}>
                              {c.razaoSocial}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {!lancamentoForm.clienteId && (
                      <div className="col-span-2">
                        <Label className="text-gray-300">
                          Nome (cliente/lead sem cadastro BPO)
                        </Label>
                        <Input
                          value={lancamentoForm.clienteNomeLivre}
                          onChange={e =>
                            setLancamentoForm(f => ({
                              ...f,
                              clienteNomeLivre: e.target.value,
                            }))
                          }
                          className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                        />
                      </div>
                    )}
                    <div className="col-span-2">
                      <Label className="text-gray-300">Descrição *</Label>
                      <Input
                        value={lancamentoForm.descricao}
                        onChange={e =>
                          setLancamentoForm(f => ({
                            ...f,
                            descricao: e.target.value,
                          }))
                        }
                        className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-300">Valor (R$) *</Label>
                      <CurrencyInput
                        value={lancamentoForm.valor ? Number(lancamentoForm.valor) : 0}
                        onChange={v =>
                          setLancamentoForm(f => ({
                            ...f,
                            valor: v ? String(v) : "",
                          }))
                        }
                        className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-300">Vencimento *</Label>
                      <Input
                        type="date"
                        value={lancamentoForm.vencimento}
                        onChange={e =>
                          setLancamentoForm(f => ({
                            ...f,
                            vencimento: e.target.value,
                          }))
                        }
                        className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-300">Competência *</Label>
                      <Input
                        value={lancamentoForm.competencia}
                        onChange={e =>
                          setLancamentoForm(f => ({
                            ...f,
                            competencia: e.target.value,
                          }))
                        }
                        placeholder="2026-09"
                        className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-300">Centro de Custos</Label>
                      <Input
                        value={lancamentoForm.centroCustos}
                        onChange={e =>
                          setLancamentoForm(f => ({
                            ...f,
                            centroCustos: e.target.value,
                          }))
                        }
                        className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                      />
                    </div>
                  </div>
                  <Button
                    onClick={() =>
                      createLancamento.mutate({
                        ...lancamentoForm,
                        clienteId: lancamentoForm.clienteId
                          ? parseInt(lancamentoForm.clienteId)
                          : undefined,
                        clienteNomeLivre:
                          lancamentoForm.clienteNomeLivre || undefined,
                        categoria: lancamentoForm.categoria as (typeof CATEGORIAS_LANCAMENTO)[number],
                        valor: parseFloat(lancamentoForm.valor),
                        centroCustos: lancamentoForm.centroCustos || undefined,
                      })
                    }
                    disabled={
                      createLancamento.isPending ||
                      !lancamentoForm.categoria ||
                      !lancamentoForm.descricao ||
                      !lancamentoForm.valor ||
                      !lancamentoForm.vencimento ||
                      !lancamentoForm.competencia
                    }
                    className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold"
                  >
                    Registrar
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <div className="flex gap-2 flex-wrap">
          <button
            className={abaClass("clientes")}
            onClick={() => setAba("clientes")}
          >
            <Building2 className="h-4 w-4 inline mr-1" /> Clientes
          </button>
          <button
            className={abaClass("cobrancas")}
            onClick={() => setAba("cobrancas")}
          >
            <Receipt className="h-4 w-4 inline mr-1" /> Cobranças
          </button>
          <button
            className={abaClass("despesas")}
            onClick={() => setAba("despesas")}
          >
            <TrendingDown className="h-4 w-4 inline mr-1" /> Despesas
          </button>
          <button className={abaClass("dre")} onClick={() => setAba("dre")}>
            <BarChart3 className="h-4 w-4 inline mr-1" /> DRE
          </button>
          <button
            className={abaClass("bancos")}
            onClick={() => setAba("bancos")}
          >
            <Landmark className="h-4 w-4 inline mr-1" /> Bancos
          </button>
          <button
            className={abaClass("contabilidade")}
            onClick={() => setAba("contabilidade")}
          >
            <BookOpen className="h-4 w-4 inline mr-1" /> Contabilidade
          </button>
          <button
            className={abaClass("relatorios")}
            onClick={() => setAba("relatorios")}
          >
            <BarChart3 className="h-4 w-4 inline mr-1" /> Relatórios
          </button>
        </div>

        {aba === "clientes" && (
          <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
            <CardHeader>
              <CardTitle className="text-[#C9A961]">
                Clientes BPO ({clientes.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {clientes.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <Building2 className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p>Nenhum cliente BPO cadastrado</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Pedido de 25/10 (noite), item 10: total recebido e em aberto por cliente; clique expande os lançamentos. */}
                  {clientes.map(c => (
                    <div key={c.id} className="p-3 bg-[#1A2332] rounded-lg">
                      <button type="button" className="flex w-full items-center justify-between gap-3 flex-wrap text-left"
                        onClick={() => setClienteAberto(clienteAberto === c.id ? null : c.id)}>
                        <div>
                          <p className="text-white font-medium">
                            {c.razaoSocial}
                            {c.leadId ? <span className="ml-2 text-xs text-[#C9A961]">lead do CRM</span> : null}
                          </p>
                          <p className="text-xs text-gray-400">
                            {[c.telefone, `situação: ${rotulo(c.status)}`, Number(c.honorarios) > 0 ? `${formatCurrencyBR(c.honorarios)}/mês` : ""].filter(Boolean).join(" • ")}
                          </p>
                        </div>
                        <div className="text-right text-sm">
                          <p className="text-green-400 font-bold">Recebido {formatCurrencyBR(c.totalRecebido)}</p>
                          <p className="text-amber-300">Em aberto {formatCurrencyBR(c.totalEmAberto)}</p>
                        </div>
                      </button>
                      {clienteAberto === c.id && (
                        <div className="mt-2 border-t border-white/10 pt-2 space-y-1">
                          {lancamentos.filter(l => l.clienteId === c.id).length === 0
                            ? <p className="text-xs text-gray-400">Nenhum lançamento deste cliente.</p>
                            : lancamentos.filter(l => l.clienteId === c.id).map(l => (
                              <div key={l.id} className="flex justify-between gap-2 text-xs">
                                <span className="text-gray-200">{new Date(l.vencimento).toLocaleDateString("pt-BR", { timeZone: "UTC" })} • {l.descricao}</span>
                                <span className={`whitespace-nowrap font-bold ${l.tipo === "despesa" ? "text-red-400" : "text-green-400"}`}>
                                  {formatCurrencyBR(l.valor)} <span className={SITUACAO[situacaoDoLancamento(l)].cor}>{SITUACAO[situacaoDoLancamento(l)].texto}</span>
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {(aba === "cobrancas" || aba === "despesas") && (
          <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
            <CardHeader>
              <CardTitle className="text-[#C9A961]">
                {aba === "cobrancas"
                  ? "Cobranças (entradas do extrato, cobranças do Asaas e lançamentos)"
                  : "Despesas"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(aba === "cobrancas" ? cobrancas : despesas).length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <Receipt className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p>Nenhum lançamento encontrado</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {(aba === "cobrancas" ? cobrancas : despesas).map(
                    (l: any) => (
                      <div
                        key={l.id}
                        className="flex items-center justify-between p-3 bg-[#1A2332] rounded-lg gap-3 flex-wrap"
                      >
                        <div className="flex-1 min-w-[200px]">
                          <p className="text-white font-medium">
                            {l.descricao}
                          </p>
                          <p className="text-xs text-gray-400">
                            {clienteNome(l)}
                            {l.titular && l.titular !== clienteNome(l) ? ` • titular: ${l.titular}` : ""}
                            {" • "}{l.tipo === "receita" ? "Cobrança" : rotulo(l.tipo)}
                            {` • ${l.categoria || "sem categoria"}`}
                            {l.asaasPaymentId ? " • Asaas" : ""}
                            {l.bankTransactionId ? " • extrato bancário" : ""} • vence{" "}
                            {new Date(l.vencimento).toLocaleDateString("pt-BR")}{" "}
                            • comp. {l.competencia}
                            {l.pago && l.pagoEm
                              ? ` • pago em ${new Date(l.pagoEm).toLocaleDateString("pt-BR")}`
                              : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span
                            className={`font-bold text-lg ${l.tipo === "despesa" ? "text-red-400" : "text-green-400"}`}
                          >
                            {formatCurrencyBR(l.valor)}
                          </span>
                          {!l.pago && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs border-green-500/30 text-green-400 hover:bg-green-500/10"
                              onClick={() => marcarPago.mutate({ id: l.id })}
                              disabled={marcarPago.isPending}
                            >
                              Marcar pago
                            </Button>
                          )}
                          <span className={`text-xs font-bold ${SITUACAO[situacaoDoLancamento(l)].cor}`}>
                            {SITUACAO[situacaoDoLancamento(l)].texto}
                          </span>
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {aba === "dre" && (
          <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
            <CardHeader>
              <CardTitle className="text-[#C9A961] flex flex-wrap items-center justify-between gap-2">
                <span>DRE por {dreVisao === "competencia" ? "Competência" : "Categoria"}</span>
                <span className="flex gap-2">
                  {(["competencia", "categoria"] as const).map(v => (
                    <button key={v} type="button" onClick={() => setDreVisao(v)}
                      className={`px-3 py-1 rounded-full text-xs font-bold border ${dreVisao === v ? "bg-[#C9A961] text-[#1A2332] border-[#C9A961]" : "border-[#C9A961]/30 text-gray-300"}`}>
                      {v === "competencia" ? "Por competência" : "Por categoria"}
                    </button>
                  ))}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dreVisao === "categoria" ? (
                dreCategorias.length === 0 ? (
                  <p className="text-center py-12 text-gray-400">Sem lançamentos para consolidar</p>
                ) : (
                  <div className="overflow-x-auto">
                    <p className="text-xs text-gray-400 mb-2">"{TRANSFERENCIA_INTERNA}" fica fora (não é receita nem despesa).</p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-300 text-xs uppercase">
                          <th className="py-2 pr-4">Categoria</th>
                          <th className="py-2 pr-4 text-right">Entradas</th>
                          <th className="py-2 pr-4 text-right">Saídas</th>
                          <th className="py-2 pr-4 text-right">Resultado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dreCategorias.map(r => (
                          <tr key={r.categoria} className="border-t border-[#C9A961]/10">
                            <td className="py-2 pr-4 text-white font-medium">{r.categoria}</td>
                            <td className="py-2 pr-4 text-right text-green-400 font-bold">{formatCurrencyBR(r.entradas)}</td>
                            <td className="py-2 pr-4 text-right text-red-400 font-bold">{formatCurrencyBR(r.saidas)}</td>
                            <td className={`py-2 pr-4 text-right font-black ${r.resultado >= 0 ? "text-green-300" : "text-red-300"}`}>{formatCurrencyBR(r.resultado)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : dreRows.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p>Sem lançamentos para consolidar</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-300 text-xs uppercase">
                        <th className="py-2 pr-4">Competência</th>
                        <th className="py-2 pr-4 text-right">Cobranças</th>
                        <th className="py-2 pr-4 text-right">Despesas</th>
                        <th className="py-2 pr-4 text-right">Resultado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dreRows.map((r: any) => (
                        <tr
                          key={r.competencia}
                          className="border-t border-[#C9A961]/10"
                        >
                          <td className="py-2 pr-4 text-white font-medium">
                            {r.competencia}
                          </td>
                          <td className="py-2 pr-4 text-right text-green-400 font-bold">
                            {formatCurrencyBR(r.cobrancas)}
                          </td>
                          <td className="py-2 pr-4 text-right text-red-400 font-bold">
                            {formatCurrencyBR(r.despesas)}
                          </td>
                          <td
                            className={`py-2 pr-4 text-right font-black ${r.resultado >= 0 ? "text-green-300" : "text-red-300"}`}
                          >
                            {formatCurrencyBR(r.resultado)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {aba === "bancos" && <BancosPanel />}

        {aba === "contabilidade" && <TaxAccountingPanel />}
        {aba === "relatorios" && <AdminRelatorios embedded />}
      </div>
    </div>
  );
}
