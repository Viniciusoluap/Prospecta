import { AcoesExcluir } from "@/components/AcoesExcluir";
import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { LinkedServiceQueue } from "./LinkedServiceQueue";
import { LeadPicker } from "@/components/admin/LeadPicker";
import { leadContact, missingLeadAddressFields } from "../../../../shared/lead-snapshot";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { formatarNumeroParaEdicao, aplicarDigitacao } from "@/lib/numero-input";
import { formatCurrency } from "@/lib/format";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowLeft, ClipboardCheck, Plus, FileSearch, Clock, CheckCircle2, XCircle, Printer } from "lucide-react";

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
  return formatCurrency(num);
}

export default function AdminAvaliacoes() {
  const [open, setOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterTipo, setFilterTipo] = useState("all");
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  // EPIC-017 (story 1.1): o cliente vem de um lead do CRM; nada é redigitado.
  const emptyForm = () => ({
    tipo: "mercado", finalidade: "compra_venda", leadId: null as number | null,
    areaConstruida: "", areaTerreno: "", quartos: "", banheiros: "", vagas: "",
    metodologia: "comparativo", avaliador: "", valorServico: "",
  });
  const [form, setForm] = useState(emptyForm);
  // Buffers de texto de "Área const." e "Área terreno" (m²) — mesmo motivo
  // do `EstudoMassa.tsx` (Lote 5). Resetados junto com `form` sempre que
  // ele volta a `emptyForm()`.
  const [areaConstruidaTexto, setAreaConstruidaTexto] = useState("");
  const [areaTerrenoTexto, setAreaTerrenoTexto] = useState("");
  const { data: leadOptions = [], isLoading: leadsLoading } = trpc.avaliacoes.leadContactOptions.useQuery(undefined, { enabled: open });
  const selectedLead = leadOptions.find(lead => lead.id === form.leadId);
  const selectedContact = selectedLead ? leadContact(selectedLead) : null;
  const missingAddress = selectedLead ? missingLeadAddressFields(selectedLead) : [];

  const { data: avaliacoes = [], refetch } = trpc.avaliacoes.list.useQuery({
    status: filterStatus !== "all" ? filterStatus : undefined,
    tipo: filterTipo !== "all" ? filterTipo : undefined,
  });

  const utils = trpc.useUtils();
  const deleteMutation = trpc.avaliacoes.delete.useMutation();
  const createMutation = trpc.avaliacoes.create.useMutation({
    onSuccess: () => {
      toast.success("Avaliação criada!");
      refetch();
      setOpen(false);
      setForm(emptyForm());
      setAreaConstruidaTexto("");
      setAreaTerrenoTexto("");
    },
    onError: (e) => toast.error(e.message),
  });

  function toggleSelecionada(id: number) {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function baixarLaudos() {
    const ids = Array.from(selecionadas).join(",");
    window.open(`/admin/avaliacoes/laudos?ids=${ids}`, "_blank");
  }

  const total = avaliacoes.length;
  const pendentes = avaliacoes.filter((a: any) => ["solicitada", "vistoria", "elaboracao", "revisao"].includes(a.status)).length;
  const entregues = avaliacoes.filter((a: any) => a.status === "entregue").length;
  const canceladas = avaliacoes.filter((a: any) => a.status === "cancelada").length;

  function handleCreate() {
    if (!form.leadId) return;
    createMutation.mutate({
      tipo: form.tipo,
      finalidade: form.finalidade,
      leadId: form.leadId,
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
      <div className="bg-[#0F1923] border-b border-[#C9A961]/20 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <Link href="/admin">
              <Button variant="ghost" size="icon" className="w-fit text-gray-400 hover:text-white">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-[#C9A961]">Avaliações (Laudos)</h1>
              <p className="text-gray-400 text-sm">Avaliação imobiliária — comparativo/renda/custo</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selecionadas.size > 0 && (
              <Button onClick={baixarLaudos} variant="outline" className="border-[#C9A961]/30 text-[#C9A961]">
                <Printer className="h-4 w-4 mr-2" /> Baixar Laudos ({selecionadas.size})
              </Button>
            )}
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

                <LeadPicker
                  label="Cliente (lead do CRM)"
                  leads={leadOptions}
                  loading={leadsLoading}
                  value={form.leadId}
                  onChange={leadId => setForm(f => ({ ...f, leadId }))}
                />
                {selectedContact && (
                  <div className="rounded-md border border-white/10 bg-[#0F1923] p-3 text-sm" aria-label="Dados migrados do lead">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#C9A961]">Dados migrados do CRM</p>
                    <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                      <div><dt className="inline text-gray-400">CPF: </dt><dd className="inline">{selectedContact.cpf || "—"}</dd></div>
                      <div><dt className="inline text-gray-400">Telefone: </dt><dd className="inline">{selectedContact.phone || "—"}</dd></div>
                      <div className="sm:col-span-2"><dt className="inline text-gray-400">E-mail: </dt><dd className="inline">{selectedContact.email || "—"}</dd></div>
                      <div className="sm:col-span-2"><dt className="inline text-gray-400">Endereço: </dt><dd className="inline">{[selectedContact.address, selectedContact.neighborhood, [selectedContact.city, selectedContact.state].filter(Boolean).join("/")].filter(Boolean).join(", ") || "—"}</dd></div>
                    </dl>
                    {missingAddress.length > 0 && (
                      <p className="mt-2 text-xs text-amber-300">
                        O lead não tem {missingAddress.join(", ")}. A avaliação será criada mesmo assim; complete o cadastro no{" "}
                        <Link href={`/admin/crm/${selectedLead!.id}`} className="underline">CRM</Link> para o laudo sair completo.
                      </p>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-gray-300">Área const. (m²)</Label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={areaConstruidaTexto}
                      onChange={e => {
                        const { texto, numero } = aplicarDigitacao(e.target.value);
                        setAreaConstruidaTexto(texto);
                        setForm(f => ({ ...f, areaConstruida: numero ? String(numero) : "" }));
                      }}
                      onBlur={() => setAreaConstruidaTexto(form.areaConstruida ? formatarNumeroParaEdicao(Number(form.areaConstruida)) : "")}
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300">Área terreno (m²)</Label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      value={areaTerrenoTexto}
                      onChange={e => {
                        const { texto, numero } = aplicarDigitacao(e.target.value);
                        setAreaTerrenoTexto(texto);
                        setForm(f => ({ ...f, areaTerreno: numero ? String(numero) : "" }));
                      }}
                      onBlur={() => setAreaTerrenoTexto(form.areaTerreno ? formatarNumeroParaEdicao(Number(form.areaTerreno)) : "")}
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
                    />
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
                    <CurrencyInput value={form.valorServico ? Number(form.valorServico) : 0} onChange={v => setForm(f => ({ ...f, valorServico: v ? String(v) : "" }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                </div>

                <Button
                  onClick={handleCreate}
                  disabled={createMutation.isPending || !form.leadId || !form.avaliador}
                  className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold"
                >
                  Criar Avaliação
                </Button>
              </div>
            </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <LinkedServiceQueue
          module="avaliacoes"
          title="Avaliações"
          startLabel="Solicitar avaliação"
          onStart={leadId => { setForm({ ...emptyForm(), leadId }); setAreaConstruidaTexto(""); setAreaTerrenoTexto(""); setOpen(true); }}
        />
        {/* Indicadores */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-[#2C3E50] border-[#C9A961]/20">
            <CardContent className="pt-6 flex items-center gap-3">
              <FileSearch className="h-7 w-7 text-[#C9A961]" />
              <div>
                <p className="text-gray-300 text-xs">Total</p>
                <p className="text-2xl font-bold text-white">{total}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#2C3E50] border-[#C9A961]/20">
            <CardContent className="pt-6 flex items-center gap-3">
              <Clock className="h-7 w-7 text-yellow-500" />
              <div>
                <p className="text-gray-300 text-xs">Em andamento</p>
                <p className="text-2xl font-bold text-white">{pendentes}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#2C3E50] border-[#C9A961]/20">
            <CardContent className="pt-6 flex items-center gap-3">
              <CheckCircle2 className="h-7 w-7 text-green-500" />
              <div>
                <p className="text-gray-300 text-xs">Entregues</p>
                <p className="text-2xl font-bold text-white">{entregues}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#2C3E50] border-[#C9A961]/20">
            <CardContent className="pt-6 flex items-center gap-3">
              <XCircle className="h-7 w-7 text-red-500" />
              <div>
                <p className="text-gray-300 text-xs">Canceladas</p>
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
              <Card key={a.id} className="bg-[#2C3E50] border-[#C9A961]/20 hover:border-[#C9A961]/50 transition-colors">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selecionadas.has(a.id)}
                      onChange={() => toggleSelecionada(a.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 shrink-0 accent-[#C9A961]"
                    />
                    <Link href={`/admin/avaliacoes/${a.id}`} className="flex-1">
                      <div className="flex items-center justify-between cursor-pointer">
                        <div>
                          <CardTitle className="text-white text-base flex items-center gap-2">
                            {a.numero}
                            <Badge className={`${STATUS_COLORS[a.status]} text-white`}>{STATUS_LABELS[a.status]}</Badge>
                          </CardTitle>
                          <p className="text-sm text-gray-300 mt-1">{a.clienteNome} • {a.endereco}, {a.bairro} — {a.cidade}/{a.estado}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{TIPO_LABELS[a.tipo] ?? a.tipo} • {a.avaliador}</p>
                        </div>
                        <div className="text-right">
                          {a.valorEstimado && <p className="text-[#C9A961] font-bold text-lg">{formatCurrencyBR(a.valorEstimado)}</p>}
                          {a.valorServico && <p className="text-xs text-gray-400">Serviço: {formatCurrencyBR(a.valorServico)}</p>}
                        </div>
                      </div>
                    </Link>
                    {a.leadId && <Link href={`/admin/crm/${a.leadId}`} className="text-sm text-[#E6CA88] underline">CRM</Link>}
                    <AcoesExcluir compacto rotulo={a.numero ?? `Avaliação ${a.id}`} onExcluir={async () => { await deleteMutation.mutateAsync({ id: a.id }); await utils.avaliacoes.list.invalidate(); }} />
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
