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
  Pencil,
} from "lucide-react";
import TaxAccountingPanel from "./TaxAccountingPanel";
import AdminRelatorios from "./AdminRelatorios";
import BancosPanel from "./BancosPanel";
import { rotulo } from "@shared/rotulos";
import { CATEGORIAS_BPO, TRANSFERENCIA_INTERNA, recebidoDoLancamento } from "@shared/financeiro/bpo-extrato";
import { situacaoDoLancamento } from "@shared/financeiro/bpo-asaas";
import {
  CATEGORIAS_DESPESA_OPERACIONAL, CATEGORIAS_RECEITA_OPERACIONAL,
  ROTULOS_CATEGORIA_OPERACIONAL, TIPOS_DESPESA_OBRA,
  catalogoDaCategoria,
} from "@shared/financeiro/bpo-operacional";

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

const emptyClienteForm = {
  // Pedido de 25/10 (noite), item 10: lead do CRM (dados vêm dele) ou cadastro livre (fornecedor/terceiro).
  leadId: null as number | null,
  razaoSocial: "",
  cnpj: "",
  cpf: "",
  responsavel: "",
  email: "",
  telefone: "",
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
  categoriaOperacional: "",
  vinculoOperacionalId: "",
  tipoDespesaObra: "",
  etapaObra: "",
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
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [clienteAberto, setClienteAberto] = useState<number | null>(null);
  const [dreVisao, setDreVisao] = useState<"competencia" | "categoria">("competencia");

  const utils = trpc.useUtils();
  const { data: clientes = [] } = trpc.bpo.clientes.list.useQuery();
  const { data: lancamentos = [] } = trpc.bpo.lancamentos.list.useQuery();
  const { data: dreRows = [] } = trpc.bpo.dre.useQuery();
  const { data: dreCategorias = [] } = trpc.bpo.dreCategorias.useQuery();
  const { data: catalogoOperacional } = trpc.bpo.lancamentos.catalogoOperacional.useQuery();

  const createCliente = trpc.bpo.clientes.create.useMutation({
    onSuccess: r => {
      toast.success(`Cliente BPO cadastrado!${r.vinculadas ? ` ${r.vinculadas} movimentação(ões) do mesmo nome vinculada(s).` : ""}`);
      utils.bpo.clientes.list.invalidate();
      utils.bpo.lancamentos.list.invalidate();
      setClienteOpen(false);
      setClienteForm(emptyClienteForm);
    },
    onError: e => toast.error(e.message),
  });

  const importarClientes = trpc.bpo.clientes.importarCrm.useMutation({
    onSuccess: r => {
      toast.success(`CRM sincronizado: ${r.inseridos} novo(s), ${r.atualizados} atualizado(s), ${r.inalterados} sem alteração.`);
      utils.bpo.clientes.list.invalidate();
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
      setRequestKey(crypto.randomUUID());
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
  const [editando, setEditando] = useState<any | null>(null);
  const [recebendo, setRecebendo] = useState<{ id: number; requestKey: string; valor: number; saldo: number; recebidoEm: string; observacoes: string } | null>(null);
  const receber = trpc.bpo.lancamentos.receber.useMutation({
    onSuccess: () => { setRecebendo(null); toast.success("Recebimento registrado."); utils.bpo.lancamentos.list.invalidate(); utils.bpo.clientes.list.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const editarLancamento = trpc.bpo.lancamentos.editar.useMutation({
    onSuccess: () => {
      toast.success("Lançamento atualizado e registrado no histórico.");
      setEditando(null);
      utils.bpo.lancamentos.list.invalidate(); utils.bpo.dre.invalidate(); utils.bpo.dreCategorias.invalidate(); utils.bpo.clientes.list.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const filtroOperacional = new URLSearchParams(window.location.search);
  const filtrados = lancamentos.filter(l => (!filtroOperacional.get("categoriaOperacional") || l.categoriaOperacional === filtroOperacional.get("categoriaOperacional")) && (!filtroOperacional.get("vinculoOperacionalId") || l.vinculoOperacionalId === filtroOperacional.get("vinculoOperacionalId")));
  const cobrancas = filtrados.filter((l: any) => l.tipo !== "despesa");
  const despesas = filtrados.filter((l: any) => l.tipo === "despesa");
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
            <Button variant="outline" className="border-[#C9A961]/30 text-[#C9A961]" disabled={importarClientes.isPending} onClick={() => importarClientes.mutate()}>
              {importarClientes.isPending ? "Importando…" : "Importar clientes"}
            </Button>
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
                  <p className="text-sm text-gray-300">Cadastro livre para clientes avulsos, fornecedores e terceiros. Para clientes do CRM, utilize Importar clientes.</p>
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
                      clienteForm.razaoSocial.trim().length < 2
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
                      <Label className="text-gray-300">Classificação contábil *</Label>
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
                      <Label className="text-gray-300">Categoria operacional *</Label>
                      <Select value={lancamentoForm.categoriaOperacional || undefined} onValueChange={v => setLancamentoForm(f => ({ ...f, categoriaOperacional: v, vinculoOperacionalId: "", tipoDespesaObra: "", etapaObra: "" }))}>
                        <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"><SelectValue placeholder="Escolha" /></SelectTrigger>
                        <SelectContent>
                          {(lancamentoForm.tipo === "cobranca" ? CATEGORIAS_RECEITA_OPERACIONAL : CATEGORIAS_DESPESA_OPERACIONAL).map(c => <SelectItem key={c} value={c}>{ROTULOS_CATEGORIA_OPERACIONAL[c]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    {lancamentoForm.categoriaOperacional && (
                      <div className="col-span-2">
                        <Label className="text-gray-300">Registro vinculado *</Label>
                        <Select value={lancamentoForm.vinculoOperacionalId || undefined} onValueChange={v => {
                          const opcoes = (catalogoOperacional?.[catalogoDaCategoria(lancamentoForm.tipo, lancamentoForm.categoriaOperacional) as keyof typeof catalogoOperacional] ?? []) as any[];
                          const escolhido = opcoes.find(o => o.id === v);
                          setLancamentoForm(f => ({ ...f, vinculoOperacionalId: v, clienteNomeLivre: escolhido?.clienteNome || f.clienteNomeLivre }));
                        }}>
                          <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"><SelectValue placeholder="Selecione um cadastro real" /></SelectTrigger>
                          <SelectContent>{((catalogoOperacional?.[catalogoDaCategoria(lancamentoForm.tipo, lancamentoForm.categoriaOperacional) as keyof typeof catalogoOperacional] ?? []) as any[]).map(o => <SelectItem key={o.id} value={o.id}>{o.rotulo}{o.clienteNome ? ` — ${o.clienteNome}` : ""}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    )}
                    {lancamentoForm.tipo === "despesa" && lancamentoForm.categoriaOperacional === "obras" && (
                      <>
                        <div>
                          <Label className="text-gray-300">Tipo de despesa *</Label>
                          <Select value={lancamentoForm.tipoDespesaObra || undefined} onValueChange={v => setLancamentoForm(f => ({ ...f, tipoDespesaObra: v }))}>
                            <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"><SelectValue placeholder="Escolha" /></SelectTrigger>
                            <SelectContent>{TIPOS_DESPESA_OBRA.map(t => <SelectItem key={t} value={t}>{t.replaceAll("_", " ")}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-gray-300">Etapa da obra</Label>
                          <Select value={lancamentoForm.etapaObra || "none"} onValueChange={v => setLancamentoForm(f => ({ ...f, etapaObra: v === "none" ? "" : v }))}>
                            <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="none">Não informada</SelectItem>{catalogoOperacional?.etapasObra.map(e => <SelectItem key={e.chave} value={e.chave}>{e.nome}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                      </>
                    )}
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
                        requestKey,
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
                          {l.tipo !== "despesa" && <p className="text-xs text-gray-300">Recebido {formatCurrencyBR(recebidoDoLancamento(l))} · Saldo {formatCurrencyBR(Number(l.valor) - recebidoDoLancamento(l))}</p>}
                          {l.categoriaOperacional && l.vinculoOperacionalId && (() => {
                            const opcoes = (catalogoOperacional?.[catalogoDaCategoria(l.tipo === "despesa" ? "despesa" : "cobranca", l.categoriaOperacional) as keyof typeof catalogoOperacional] ?? []) as any[];
                            const registro = opcoes.find(o => o.id === l.vinculoOperacionalId);
                            return registro ? <Link className="text-xs text-[#C9A961] underline" href={registro.href}>{registro.rotulo}</Link> : <p className="text-xs text-amber-300">Registro operacional indisponível</p>;
                          })()}
                        </div>
                        <div className="flex items-center gap-3">
                          <span
                            className={`font-bold text-lg ${l.tipo === "despesa" ? "text-red-400" : "text-green-400"}`}
                          >
                            {formatCurrencyBR(l.valor)}
                          </span>
                          <Button size="sm" variant="outline" className="h-7 text-xs border-[#C9A961]/30 text-[#C9A961]"
                            onClick={() => setEditando({ ...l, valor: String(l.valor), vencimento: new Date(l.vencimento).toISOString().slice(0, 10), motivo: "", observacoes: l.observacoes ?? "" })}>
                            <Pencil className="h-3 w-3 mr-1" /> Editar
                          </Button>
                          {!l.pago && l.tipo !== "despesa" && !l.asaasPaymentId && !l.bankTransactionId && <Button size="sm" onClick={() => setRecebendo({ id: l.id, requestKey: crypto.randomUUID(), valor: Number(l.valor) - recebidoDoLancamento(l), saldo: Number(l.valor) - recebidoDoLancamento(l), recebidoEm: new Date().toISOString().slice(0, 10), observacoes: "" })}>Registrar recebimento</Button>}
                          {!l.pago && (l.tipo === "despesa" || l.asaasPaymentId || l.bankTransactionId) && (
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

      <Dialog open={Boolean(recebendo)} onOpenChange={o => !o && setRecebendo(null)}>
        <DialogContent className="bg-[#1A2332] text-white"><DialogHeader><DialogTitle>Registrar recebimento</DialogTitle></DialogHeader>
          {recebendo && <div className="space-y-3"><p>Saldo {formatCurrencyBR(recebendo.saldo)}</p><Label>Valor recebido</Label><CurrencyInput value={recebendo.valor} onChange={v => setRecebendo({ ...recebendo, valor: v })}/><Label>Data</Label><Input type="date" value={recebendo.recebidoEm} onChange={e => setRecebendo({ ...recebendo, recebidoEm: e.target.value })}/><Label>Observações</Label><Textarea value={recebendo.observacoes} onChange={e => setRecebendo({ ...recebendo, observacoes: e.target.value })}/><Button disabled={receber.isPending || recebendo.valor <= 0 || recebendo.valor > recebendo.saldo} onClick={() => receber.mutate(recebendo)}>Confirmar recebimento</Button></div>}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(editando)} onOpenChange={o => !o && setEditando(null)}>
        <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-[#C9A961]">Editar lançamento</DialogTitle></DialogHeader>
          {editando && <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><Label>Descrição</Label><Input value={editando.descricao} onChange={e => setEditando({ ...editando, descricao: e.target.value })} className="bg-[#2C3E50] border-[#C9A961]/30" /></div>
            <div><Label>Valor (R$)</Label><Input type="number" min="0.01" step="0.01" value={editando.valor} onChange={e => setEditando({ ...editando, valor: e.target.value })} className="bg-[#2C3E50] border-[#C9A961]/30" /></div>
            <div><Label>Categoria contábil</Label><select value={editando.categoria ?? ""} onChange={e => setEditando({ ...editando, categoria: e.target.value })} className="w-full h-10 bg-[#2C3E50] border border-[#C9A961]/30 rounded px-2">
              {CATEGORIAS_LANCAMENTO.map(c => <option key={c}>{c}</option>)}
            </select></div>
            <div><Label>Vencimento</Label><Input type="date" value={editando.vencimento} onChange={e => setEditando({ ...editando, vencimento: e.target.value })} className="bg-[#2C3E50] border-[#C9A961]/30" /></div>
            <div><Label>Competência</Label><Input type="month" value={editando.competencia} onChange={e => setEditando({ ...editando, competencia: e.target.value })} className="bg-[#2C3E50] border-[#C9A961]/30" /></div>
            <div className="col-span-2"><Label>Centro de custos</Label><Input value={editando.centroCustos ?? ""} onChange={e => setEditando({ ...editando, centroCustos: e.target.value })} className="bg-[#2C3E50] border-[#C9A961]/30" /></div>
            <div><Label>Cliente BPO</Label><select className="w-full bg-[#2C3E50] p-2" value={editando.clienteId ?? ""} onChange={e => setEditando({ ...editando, clienteId: e.target.value ? Number(e.target.value) : null })}><option value="">Cadastro livre</option>{clientes.map(c => <option key={c.id} value={c.id}>{c.razaoSocial}</option>)}</select></div>
            {!editando.clienteId && <div><Label>Nome / identificação</Label><Input value={editando.clienteNomeLivre ?? ""} onChange={e => setEditando({ ...editando, clienteNomeLivre: e.target.value })} className="bg-[#2C3E50] border-[#C9A961]/30" /></div>}
            <div className="col-span-2"><Label>Observações</Label><Textarea value={editando.observacoes ?? ""} onChange={e => setEditando({ ...editando, observacoes: e.target.value })} className="bg-[#2C3E50] border-[#C9A961]/30" /></div>
            <div><Label>Categoria operacional</Label><select className="w-full bg-[#2C3E50] p-2" value={editando.categoriaOperacional ?? ""} onChange={e => setEditando({ ...editando, categoriaOperacional: e.target.value, vinculoOperacionalId: "", tipoDespesaObra: "", etapaObra: "" })}><option value="">Sem vínculo</option>{(editando.tipo === "despesa" ? CATEGORIAS_DESPESA_OPERACIONAL : CATEGORIAS_RECEITA_OPERACIONAL).map(c => <option key={c} value={c}>{ROTULOS_CATEGORIA_OPERACIONAL[c]}</option>)}</select></div>
            {editando.categoriaOperacional && <div><Label>Registro vinculado</Label><select className="w-full bg-[#2C3E50] p-2" value={editando.vinculoOperacionalId ?? ""} onChange={e => setEditando({ ...editando, vinculoOperacionalId: e.target.value })}><option value="">Selecione</option>{((catalogoOperacional?.[catalogoDaCategoria(editando.tipo === "despesa" ? "despesa" : "cobranca", editando.categoriaOperacional) as keyof typeof catalogoOperacional] ?? []) as any[]).map(o => <option key={o.id} value={o.id}>{o.rotulo}</option>)}</select></div>}
            {editando.tipo === "despesa" && editando.categoriaOperacional === "obras" && <><div><Label>Tipo de despesa</Label><select className="w-full bg-[#2C3E50] p-2" value={editando.tipoDespesaObra ?? ""} onChange={e => setEditando({ ...editando, tipoDespesaObra: e.target.value })}><option value="">Selecione</option>{TIPOS_DESPESA_OBRA.map(t => <option key={t} value={t}>{t.replaceAll("_", " ")}</option>)}</select></div><div><Label>Etapa</Label><select className="w-full bg-[#2C3E50] p-2" value={editando.etapaObra ?? ""} onChange={e => setEditando({ ...editando, etapaObra: e.target.value })}><option value="">Não informada</option>{catalogoOperacional?.etapasObra.map(e => <option key={e.chave} value={e.chave}>{e.nome}</option>)}</select></div></>}
            <div className="col-span-2"><Label>Motivo da alteração *</Label><Textarea value={editando.motivo} onChange={e => setEditando({ ...editando, motivo: e.target.value })} placeholder="Obrigatório para a trilha de auditoria" className="bg-[#2C3E50] border-[#C9A961]/30" /></div>
            {(editando.asaasPaymentId || editando.bankTransactionId) && <p className="col-span-2 text-xs text-amber-300">Este é um ajuste interno. A origem externa e a conciliação serão preservadas.</p>}
            <Button className="col-span-2 bg-[#C9A961] text-[#1A2332]" disabled={editarLancamento.isPending || editando.motivo.trim().length < 3}
              onClick={() => editarLancamento.mutate({
                id: editando.id, version: editando.version, motivo: editando.motivo, descricao: editando.descricao,
                valor: Number(editando.valor), categoria: editando.categoria, clienteId: editando.clienteId,
                clienteNomeLivre: editando.clienteNomeLivre, vencimento: editando.vencimento, competencia: editando.competencia,
                centroCustos: editando.centroCustos, observacoes: editando.observacoes,
                categoriaOperacional: editando.categoriaOperacional, vinculoOperacionalId: editando.vinculoOperacionalId,
                tipoDespesaObra: editando.tipoDespesaObra, etapaObra: editando.etapaObra,
              })}>{editarLancamento.isPending ? "Salvando..." : "Salvar com auditoria"}</Button>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
