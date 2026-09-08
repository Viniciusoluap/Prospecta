import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft, Building2, Receipt, TrendingDown, BarChart3, Plus } from "lucide-react";

function formatCurrencyBR(value: number | string | null | undefined) {
  if (!value) return "R$ 0,00";
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(num);
}

type Aba = "clientes" | "cobrancas" | "despesas" | "dre";

const SERVICOS_OPCOES = ["contas_pagar", "contas_receber", "folha", "fiscal", "conciliacao"];

const emptyClienteForm = {
  razaoSocial: "", cnpj: "", cpf: "", responsavel: "", email: "", telefone: "",
  servicos: [] as string[], honorarios: "", diaVencimento: "10", dataInicio: "", observacoes: "",
};

const emptyLancamentoForm = {
  clienteId: "", clienteNomeLivre: "", tipo: "honorario" as "honorario" | "despesa" | "reembolso",
  descricao: "", valor: "", vencimento: "", competencia: "", centroCustos: "",
};

export default function AdminBpo() {
  const [aba, setAba] = useState<Aba>("clientes");
  const [clienteOpen, setClienteOpen] = useState(false);
  const [lancamentoOpen, setLancamentoOpen] = useState(false);
  const [clienteForm, setClienteForm] = useState(emptyClienteForm);
  const [lancamentoForm, setLancamentoForm] = useState(emptyLancamentoForm);

  const utils = trpc.useUtils();
  const { data: clientes = [] } = trpc.bpo.clientes.list.useQuery();
  const { data: lancamentos = [] } = trpc.bpo.lancamentos.list.useQuery();
  const { data: dreRows = [] } = trpc.bpo.dre.useQuery();

  const createCliente = trpc.bpo.clientes.create.useMutation({
    onSuccess: () => { toast.success("Cliente BPO cadastrado!"); utils.bpo.clientes.list.invalidate(); setClienteOpen(false); setClienteForm(emptyClienteForm); },
    onError: (e) => toast.error(e.message),
  });

  const createLancamento = trpc.bpo.lancamentos.create.useMutation({
    onSuccess: () => { toast.success("Lançamento registrado!"); utils.bpo.lancamentos.list.invalidate(); utils.bpo.dre.invalidate(); setLancamentoOpen(false); setLancamentoForm(emptyLancamentoForm); },
    onError: (e) => toast.error(e.message),
  });

  const marcarPago = trpc.bpo.lancamentos.marcarPago.useMutation({
    onSuccess: () => { toast.success("Marcado como pago!"); utils.bpo.lancamentos.list.invalidate(); utils.bpo.dre.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const cobrancas = lancamentos.filter((l: any) => l.tipo !== "despesa");
  const despesas = lancamentos.filter((l: any) => l.tipo === "despesa");
  const clienteNome = (l: any) => clientes.find((c: any) => c.id === l.clienteId)?.razaoSocial ?? l.clienteNomeLivre ?? "—";

  const abaClass = (a: Aba) =>
    `px-4 py-2 rounded-lg text-sm font-bold transition-colors ${aba === a ? "bg-[#C9A961] text-[#1A2332]" : "bg-[#2C3E50] text-gray-400 hover:text-white"}`;

  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <div className="bg-[#0F1923] border-b border-[#C9A961]/20 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4">
            <Link href="/admin">
              <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-[#C9A961]">BPO Financeiro</h1>
              <p className="text-gray-400 text-sm">Terceirização contábil — clientes, cobranças e DRE</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Dialog open={clienteOpen} onOpenChange={setClienteOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="border-[#C9A961]/30 text-[#C9A961]">
                  <Plus className="h-4 w-4 mr-2" /> Cliente BPO
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle className="text-[#C9A961]">Novo Cliente BPO</DialogTitle></DialogHeader>
                <div className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <Label className="text-gray-300">Razão Social *</Label>
                      <Input value={clienteForm.razaoSocial} onChange={e => setClienteForm(f => ({ ...f, razaoSocial: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-gray-300">CNPJ</Label>
                      <Input value={clienteForm.cnpj} onChange={e => setClienteForm(f => ({ ...f, cnpj: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-gray-300">CPF</Label>
                      <Input value={clienteForm.cpf} onChange={e => setClienteForm(f => ({ ...f, cpf: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-gray-300">Responsável *</Label>
                      <Input value={clienteForm.responsavel} onChange={e => setClienteForm(f => ({ ...f, responsavel: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-gray-300">Telefone *</Label>
                      <Input value={clienteForm.telefone} onChange={e => setClienteForm(f => ({ ...f, telefone: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-gray-300">Email</Label>
                      <Input value={clienteForm.email} onChange={e => setClienteForm(f => ({ ...f, email: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-gray-300">Honorário Mensal (R$) *</Label>
                      <Input type="number" value={clienteForm.honorarios} onChange={e => setClienteForm(f => ({ ...f, honorarios: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-gray-300">Dia de Vencimento</Label>
                      <Input type="number" value={clienteForm.diaVencimento} onChange={e => setClienteForm(f => ({ ...f, diaVencimento: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-gray-300">Data de Início *</Label>
                      <Input type="date" value={clienteForm.dataInicio} onChange={e => setClienteForm(f => ({ ...f, dataInicio: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-gray-300 block mb-1">Serviços Contratados</Label>
                      <div className="flex flex-wrap gap-2">
                        {SERVICOS_OPCOES.map(s => {
                          const active = clienteForm.servicos.includes(s);
                          return (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setClienteForm(f => ({
                                ...f,
                                servicos: active ? f.servicos.filter(x => x !== s) : [...f.servicos, s],
                              }))}
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
                      <Textarea value={clienteForm.observacoes} onChange={e => setClienteForm(f => ({ ...f, observacoes: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" rows={2} />
                    </div>
                  </div>
                  <Button
                    onClick={() => createCliente.mutate({
                      ...clienteForm,
                      honorarios: parseFloat(clienteForm.honorarios),
                      diaVencimento: parseInt(clienteForm.diaVencimento) || 10,
                      dataInicio: clienteForm.dataInicio,
                    })}
                    disabled={createCliente.isPending || !clienteForm.razaoSocial || !clienteForm.responsavel || !clienteForm.telefone || !clienteForm.honorarios || !clienteForm.dataInicio}
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
                <DialogHeader><DialogTitle className="text-[#C9A961]">Novo Lançamento</DialogTitle></DialogHeader>
                <div className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-gray-300">Tipo</Label>
                      <Select value={lancamentoForm.tipo} onValueChange={(v: any) => setLancamentoForm(f => ({ ...f, tipo: v }))}>
                        <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="honorario">Honorário</SelectItem>
                          <SelectItem value="despesa">Despesa</SelectItem>
                          <SelectItem value="reembolso">Reembolso</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-gray-300">Cliente BPO</Label>
                      <Select value={lancamentoForm.clienteId || "none"} onValueChange={v => setLancamentoForm(f => ({ ...f, clienteId: v === "none" ? "" : v }))}>
                        <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Nenhum (nome livre)</SelectItem>
                          {clientes.map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.razaoSocial}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    {!lancamentoForm.clienteId && (
                      <div className="col-span-2">
                        <Label className="text-gray-300">Nome (cliente/lead sem cadastro BPO)</Label>
                        <Input value={lancamentoForm.clienteNomeLivre} onChange={e => setLancamentoForm(f => ({ ...f, clienteNomeLivre: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                      </div>
                    )}
                    <div className="col-span-2">
                      <Label className="text-gray-300">Descrição *</Label>
                      <Input value={lancamentoForm.descricao} onChange={e => setLancamentoForm(f => ({ ...f, descricao: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-gray-300">Valor (R$) *</Label>
                      <Input type="number" value={lancamentoForm.valor} onChange={e => setLancamentoForm(f => ({ ...f, valor: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-gray-300">Vencimento *</Label>
                      <Input type="date" value={lancamentoForm.vencimento} onChange={e => setLancamentoForm(f => ({ ...f, vencimento: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-gray-300">Competência *</Label>
                      <Input value={lancamentoForm.competencia} onChange={e => setLancamentoForm(f => ({ ...f, competencia: e.target.value }))} placeholder="2026-09" className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-gray-300">Centro de Custos</Label>
                      <Input value={lancamentoForm.centroCustos} onChange={e => setLancamentoForm(f => ({ ...f, centroCustos: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                  </div>
                  <Button
                    onClick={() => createLancamento.mutate({
                      ...lancamentoForm,
                      clienteId: lancamentoForm.clienteId ? parseInt(lancamentoForm.clienteId) : undefined,
                      clienteNomeLivre: lancamentoForm.clienteNomeLivre || undefined,
                      valor: parseFloat(lancamentoForm.valor),
                      centroCustos: lancamentoForm.centroCustos || undefined,
                    })}
                    disabled={createLancamento.isPending || !lancamentoForm.descricao || !lancamentoForm.valor || !lancamentoForm.vencimento || !lancamentoForm.competencia}
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
          <button className={abaClass("clientes")} onClick={() => setAba("clientes")}><Building2 className="h-4 w-4 inline mr-1" /> Clientes</button>
          <button className={abaClass("cobrancas")} onClick={() => setAba("cobrancas")}><Receipt className="h-4 w-4 inline mr-1" /> Cobranças</button>
          <button className={abaClass("despesas")} onClick={() => setAba("despesas")}><TrendingDown className="h-4 w-4 inline mr-1" /> Despesas</button>
          <button className={abaClass("dre")} onClick={() => setAba("dre")}><BarChart3 className="h-4 w-4 inline mr-1" /> DRE</button>
        </div>

        {aba === "clientes" && (
          <Card className="bg-[#2C3E50] border-[#C9A961]/20">
            <CardHeader><CardTitle className="text-[#C9A961]">Clientes BPO ({clientes.length})</CardTitle></CardHeader>
            <CardContent>
              {clientes.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <Building2 className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p>Nenhum cliente BPO cadastrado</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {clientes.map((c: any) => (
                    <div key={c.id} className="flex items-center justify-between p-3 bg-[#1A2332] rounded-lg gap-3 flex-wrap">
                      <div>
                        <p className="text-white font-medium">{c.razaoSocial}</p>
                        <p className="text-xs text-gray-500">{c.responsavel} • {c.telefone} • status: {c.status}</p>
                      </div>
                      <span className="font-bold text-[#C9A961]">{formatCurrencyBR(c.honorarios)}/mês</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {(aba === "cobrancas" || aba === "despesas") && (
          <Card className="bg-[#2C3E50] border-[#C9A961]/20">
            <CardHeader><CardTitle className="text-[#C9A961]">{aba === "cobrancas" ? "Cobranças (honorários/reembolsos)" : "Despesas"}</CardTitle></CardHeader>
            <CardContent>
              {(aba === "cobrancas" ? cobrancas : despesas).length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <Receipt className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p>Nenhum lançamento encontrado</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {(aba === "cobrancas" ? cobrancas : despesas).map((l: any) => (
                    <div key={l.id} className="flex items-center justify-between p-3 bg-[#1A2332] rounded-lg gap-3 flex-wrap">
                      <div className="flex-1 min-w-[200px]">
                        <p className="text-white font-medium">{l.descricao}</p>
                        <p className="text-xs text-gray-500">
                          {clienteNome(l)} • {l.tipo} • vence {new Date(l.vencimento).toLocaleDateString("pt-BR")} • comp. {l.competencia}
                          {l.pago && l.pagoEm ? ` • pago em ${new Date(l.pagoEm).toLocaleDateString("pt-BR")}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`font-bold text-lg ${l.tipo === "despesa" ? "text-red-400" : "text-green-400"}`}>
                          {formatCurrencyBR(l.valor)}
                        </span>
                        {!l.pago && (
                          <Button size="sm" variant="outline" className="h-7 text-xs border-green-500/30 text-green-400 hover:bg-green-500/10"
                            onClick={() => marcarPago.mutate({ id: l.id })} disabled={marcarPago.isPending}>
                            Marcar pago
                          </Button>
                        )}
                        {l.pago && <span className="text-xs font-bold text-green-500">PAGO</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {aba === "dre" && (
          <Card className="bg-[#2C3E50] border-[#C9A961]/20">
            <CardHeader><CardTitle className="text-[#C9A961]">DRE por Competência</CardTitle></CardHeader>
            <CardContent>
              {dreRows.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p>Sem lançamentos para consolidar</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-400 text-xs uppercase">
                        <th className="py-2 pr-4">Competência</th>
                        <th className="py-2 pr-4 text-right">Cobranças</th>
                        <th className="py-2 pr-4 text-right">Despesas</th>
                        <th className="py-2 pr-4 text-right">Resultado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dreRows.map((r: any) => (
                        <tr key={r.competencia} className="border-t border-[#C9A961]/10">
                          <td className="py-2 pr-4 text-white font-medium">{r.competencia}</td>
                          <td className="py-2 pr-4 text-right text-green-400 font-bold">{formatCurrencyBR(r.cobrancas)}</td>
                          <td className="py-2 pr-4 text-right text-red-400 font-bold">{formatCurrencyBR(r.despesas)}</td>
                          <td className={`py-2 pr-4 text-right font-black ${r.resultado >= 0 ? "text-green-300" : "text-red-300"}`}>{formatCurrencyBR(r.resultado)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
