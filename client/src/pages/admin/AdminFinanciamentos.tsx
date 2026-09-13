import { FormEvent, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Building2, CheckCircle2, FileCheck2, Landmark, Pencil, Plus, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  FINANCIAMENTO_BANCO_LABELS,
  FINANCIAMENTO_BANCOS,
  FINANCIAMENTO_STATUS,
  FINANCIAMENTO_STATUS_LABELS,
  FINANCIAMENTO_TIPO_LABELS,
  FINANCIAMENTO_TIPOS,
} from "../../../../shared/financiamento";

type Status = (typeof FINANCIAMENTO_STATUS)[number];
type Tipo = (typeof FINANCIAMENTO_TIPOS)[number];
type Banco = (typeof FINANCIAMENTO_BANCOS)[number];

function moeda(valor: string | number | null | undefined) {
  const numero = Number(valor ?? 0);
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(numero);
}

function numero(formData: FormData, nome: string) {
  return Number(formData.get(nome) || 0);
}

export default function AdminFinanciamentos() {
  const [novoAberto, setNovoAberto] = useState(false);
  const [editarAberto, setEditarAberto] = useState(false);
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const [filtro, setFiltro] = useState<Status | "todos">("todos");
  const utils = trpc.useUtils();
  const { data: processos = [], isLoading } = trpc.financiamentos.list.useQuery(
    filtro === "todos" ? {} : { status: filtro },
  );
  const { data: detalhe } = trpc.financiamentos.getById.useQuery(
    { id: selecionado ?? 0 },
    { enabled: selecionado !== null },
  );
  const { data: options } = trpc.financiamentos.options.useQuery();

  const criar = trpc.financiamentos.create.useMutation({
    onSuccess: async (item) => {
      await utils.financiamentos.list.invalidate();
      setNovoAberto(false);
      setSelecionado(item.id);
      toast.success("Financiamento cadastrado");
    },
    onError: (erro) => toast.error(erro.message),
  });
  const atualizarStatus = trpc.financiamentos.updateStatus.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.financiamentos.list.invalidate(), utils.financiamentos.getById.invalidate()]);
      toast.success("Etapa atualizada");
    },
    onError: (erro) => toast.error(erro.message),
  });
  const atualizarChecklist = trpc.financiamentos.updateChecklist.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.financiamentos.list.invalidate(), utils.financiamentos.getById.invalidate()]);
    },
    onError: (erro) => toast.error(erro.message),
  });
  const excluir = trpc.financiamentos.delete.useMutation({
    onSuccess: async () => {
      await utils.financiamentos.list.invalidate();
      setSelecionado(null);
      toast.success("Processo excluído");
    },
    onError: (erro) => toast.error(erro.message),
  });
  const atualizar = trpc.financiamentos.update.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.financiamentos.list.invalidate(), utils.financiamentos.getById.invalidate()]);
      setEditarAberto(false);
      toast.success("Financiamento atualizado");
    },
    onError: (erro) => toast.error(erro.message),
  });

  function dadosFormulario(form: HTMLFormElement) {
    const dados = new FormData(form);
    const optionalId = (nome: string) => {
      const valor = String(dados.get(nome) || "");
      return valor && valor !== "none" ? Number(valor) : null;
    };
    return {
      clienteNome: String(dados.get("clienteNome") || ""),
      clienteCpf: String(dados.get("clienteCpf") || "") || null,
      clienteTel: String(dados.get("clienteTel") || ""),
      clienteEmail: String(dados.get("clienteEmail") || "") || null,
      imovel: String(dados.get("imovel") || ""),
      tipo: String(dados.get("tipo")) as Tipo,
      banco: String(dados.get("banco")) as Banco,
      bancoOutro: String(dados.get("bancoOutro") || "") || null,
      valorImovel: numero(dados, "valorImovel"),
      valorFinanciado: numero(dados, "valorFinanciado"),
      entrada: numero(dados, "entrada"),
      taxa: numero(dados, "taxa"),
      prazo: numero(dados, "prazo"),
      parcela: numero(dados, "parcela") || null,
      protocolo: String(dados.get("protocolo") || "") || null,
      observacoes: String(dados.get("observacoes") || "") || null,
      leadId: optionalId("leadId"),
      imovelVinculadoId: optionalId("imovelVinculadoId"),
      corretorId: optionalId("corretorId"),
    };
  }

  function handleCriar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    criar.mutate(dadosFormulario(event.currentTarget));
  }

  const total = processos.reduce((soma, item) => soma + Number(item.financiamento.valorFinanciado), 0);
  const ativos = processos.filter(({ financiamento }) => !["liberado", "cancelado"].includes(financiamento.status)).length;
  const concluidos = processos.filter(({ financiamento }) => financiamento.status === "liberado").length;

  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <header className="border-b border-[#C9A961]/20 bg-[#0F1923] px-4 py-4 md:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/admin"><Button variant="ghost" size="icon" className="text-gray-400"><ArrowLeft /></Button></Link>
            <div>
              <h1 className="text-2xl font-bold text-[#C9A961]">Financiamentos</h1>
              <p className="text-sm text-gray-400">Crédito imobiliário e checklist documental</p>
            </div>
          </div>
          <Button onClick={() => setNovoAberto(true)} className="bg-[#C9A961] font-bold text-[#1A2332] hover:bg-[#B8985A]">
            <Plus className="mr-2 h-4 w-4" /> Novo financiamento
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 md:px-6">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { titulo: "Em andamento", valor: String(ativos), icone: FileCheck2, cor: "text-blue-400" },
            { titulo: "Crédito liberado", valor: String(concluidos), icone: CheckCircle2, cor: "text-green-400" },
            { titulo: "Volume financiado", valor: moeda(total), icone: Landmark, cor: "text-[#C9A961]" },
          ].map(({ titulo, valor, icone: Icone, cor }) => (
            <Card key={titulo} className="border-[#C9A961]/20 bg-[#2C3E50]">
              <CardContent className="flex items-center gap-3 pt-6"><Icone className={`h-8 w-8 ${cor}`} /><div><p className="text-sm text-gray-400">{titulo}</p><p className={`text-2xl font-bold ${cor}`}>{valor}</p></div></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={filtro === "todos" ? "default" : "outline"} onClick={() => setFiltro("todos")}>Todos</Button>
          {FINANCIAMENTO_STATUS.map((status) => (
            <Button key={status} size="sm" variant={filtro === status ? "default" : "outline"} onClick={() => setFiltro(status)}>
              {FINANCIAMENTO_STATUS_LABELS[status]}
            </Button>
          ))}
        </div>

        <Card className="border-[#C9A961]/20 bg-[#2C3E50]">
          <CardContent className="pt-6">
            {isLoading ? <p className="py-10 text-center text-gray-400">Carregando…</p> : processos.length === 0 ? (
              <div className="py-12 text-center text-gray-500"><Building2 className="mx-auto mb-3 h-12 w-12 opacity-30" /><p>Nenhum financiamento encontrado</p></div>
            ) : (
              <div className="space-y-2">
                {processos.map(({ financiamento, checklistTotal, checklistConcluido }) => (
                  <button key={financiamento.id} onClick={() => setSelecionado(financiamento.id)} className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg bg-[#1A2332] p-4 text-left hover:ring-1 hover:ring-[#C9A961]/50">
                    <div className="min-w-[220px] flex-1"><p className="font-semibold">{financiamento.clienteNome}</p><p className="text-xs text-gray-400">{financiamento.imovel} • {FINANCIAMENTO_BANCO_LABELS[financiamento.banco]}</p></div>
                    <div className="text-sm"><p className="font-bold text-[#C9A961]">{moeda(financiamento.valorFinanciado)}</p><p className="text-xs text-gray-500">de {moeda(financiamento.valorImovel)}</p></div>
                    <div className="min-w-32 text-sm"><p>{FINANCIAMENTO_STATUS_LABELS[financiamento.status]}</p><p className="text-xs text-gray-500">Checklist {checklistConcluido}/{checklistTotal}</p></div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <Dialog open={novoAberto} onOpenChange={setNovoAberto}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto border-[#C9A961]/30 bg-[#1A2332] text-white">
          <DialogHeader><DialogTitle className="text-[#C9A961]">Novo financiamento</DialogTitle></DialogHeader>
          <form onSubmit={handleCriar} className="grid gap-4 md:grid-cols-2">
            <Campo nome="clienteNome" rotulo="Cliente" obrigatorio />
            <Campo nome="clienteTel" rotulo="Telefone" obrigatorio />
            <Campo nome="clienteEmail" rotulo="E-mail" tipo="email" />
            <Campo nome="clienteCpf" rotulo="CPF" />
            <div className="md:col-span-2"><Campo nome="imovel" rotulo="Imóvel" obrigatorio /></div>
            <Selecao nome="tipo" rotulo="Tipo" opcoes={FINANCIAMENTO_TIPOS.map((v) => [v, FINANCIAMENTO_TIPO_LABELS[v]])} />
            <Selecao nome="banco" rotulo="Banco" opcoes={FINANCIAMENTO_BANCOS.map((v) => [v, FINANCIAMENTO_BANCO_LABELS[v]])} />
            <Campo nome="bancoOutro" rotulo="Outro banco" />
            <Campo nome="protocolo" rotulo="Protocolo" />
            <Vinculos options={options} />
            <Campo nome="valorImovel" rotulo="Valor do imóvel" tipo="number" obrigatorio />
            <Campo nome="valorFinanciado" rotulo="Valor financiado" tipo="number" obrigatorio />
            <Campo nome="entrada" rotulo="Entrada" tipo="number" obrigatorio />
            <Campo nome="parcela" rotulo="Parcela estimada" tipo="number" />
            <Campo nome="taxa" rotulo="Taxa anual (%)" tipo="number" obrigatorio passo="0.0001" />
            <Campo nome="prazo" rotulo="Prazo (meses)" tipo="number" obrigatorio valorPadrao="360" />
            <div className="md:col-span-2"><Label>Observações</Label><Textarea name="observacoes" className="mt-1 border-[#C9A961]/30 bg-[#2C3E50]" /></div>
            <Button type="submit" disabled={criar.isPending} className="md:col-span-2 bg-[#C9A961] font-bold text-[#1A2332] hover:bg-[#B8985A]">Cadastrar processo</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={selecionado !== null} onOpenChange={(aberto) => !aberto && setSelecionado(null)}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto border-[#C9A961]/30 bg-[#1A2332] text-white">
          {detalhe && <>
            <DialogHeader><DialogTitle className="text-[#C9A961]">{detalhe.financiamento.clienteNome}</DialogTitle></DialogHeader>
            <div className="grid gap-3 rounded-lg bg-[#2C3E50] p-4 text-sm md:grid-cols-3">
              <div><p className="text-gray-400">Imóvel</p><p>{detalhe.financiamento.imovel}</p></div>
              <div><p className="text-gray-400">Financiado</p><p>{moeda(detalhe.financiamento.valorFinanciado)}</p></div>
              <div><p className="text-gray-400">Banco</p><p>{FINANCIAMENTO_BANCO_LABELS[detalhe.financiamento.banco]}</p></div>
            </div>
            <div><Label>Etapa atual</Label><Select value={detalhe.financiamento.status} onValueChange={(status: Status) => atualizarStatus.mutate({ id: detalhe.financiamento.id, status })}><SelectTrigger className="mt-1 border-[#C9A961]/30 bg-[#2C3E50]"><SelectValue /></SelectTrigger><SelectContent>{FINANCIAMENTO_STATUS.map((status) => <SelectItem key={status} value={status}>{FINANCIAMENTO_STATUS_LABELS[status]}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><h3 className="font-semibold text-[#C9A961]">Checklist documental</h3>{detalhe.checklist.map((item) => <label key={item.id} className="flex cursor-pointer items-start gap-3 rounded-lg bg-[#2C3E50] p-3"><input type="checkbox" checked={item.concluido} onChange={(evento) => atualizarChecklist.mutate({ id: item.id, financiamentoId: detalhe.financiamento.id, concluido: evento.target.checked, notas: item.notas ?? undefined })} className="mt-1 accent-[#C9A961]" /><span><strong>{item.item}</strong><span className="block text-xs text-gray-400">{item.grupo}</span></span></label>)}</div>
            <div className="flex gap-2"><Button onClick={() => setEditarAberto(true)} className="flex-1 bg-[#C9A961] text-[#1A2332]"><Pencil className="mr-2 h-4 w-4" /> Editar dados e vínculos</Button><Button variant="destructive" onClick={() => confirm("Excluir este financiamento e seu checklist?") && excluir.mutate({ id: detalhe.financiamento.id })}><Trash2 className="h-4 w-4" /></Button></div>
          </>}
        </DialogContent>
      </Dialog>

      <Dialog open={editarAberto} onOpenChange={setEditarAberto}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto border-[#C9A961]/30 bg-[#1A2332] text-white">
          <DialogHeader><DialogTitle className="text-[#C9A961]">Editar financiamento</DialogTitle></DialogHeader>
          {detalhe && <form onSubmit={(event) => { event.preventDefault(); atualizar.mutate({ id: detalhe.financiamento.id, data: dadosFormulario(event.currentTarget) }); }} className="grid gap-4 md:grid-cols-2">
            <Campo nome="clienteNome" rotulo="Cliente" obrigatorio valorPadrao={detalhe.financiamento.clienteNome} /><Campo nome="clienteTel" rotulo="Telefone" obrigatorio valorPadrao={detalhe.financiamento.clienteTel} />
            <Campo nome="clienteEmail" rotulo="E-mail" tipo="email" valorPadrao={detalhe.financiamento.clienteEmail || ""} /><Campo nome="clienteCpf" rotulo="CPF" valorPadrao={detalhe.financiamento.clienteCpf || ""} />
            <div className="md:col-span-2"><Campo nome="imovel" rotulo="Descrição do imóvel" obrigatorio valorPadrao={detalhe.financiamento.imovel} /></div>
            <Selecao nome="tipo" rotulo="Tipo" valorPadrao={detalhe.financiamento.tipo} opcoes={FINANCIAMENTO_TIPOS.map((v) => [v, FINANCIAMENTO_TIPO_LABELS[v]])} /><Selecao nome="banco" rotulo="Banco" valorPadrao={detalhe.financiamento.banco} opcoes={FINANCIAMENTO_BANCOS.map((v) => [v, FINANCIAMENTO_BANCO_LABELS[v]])} />
            <Campo nome="bancoOutro" rotulo="Outro banco" valorPadrao={detalhe.financiamento.bancoOutro || ""} /><Campo nome="protocolo" rotulo="Protocolo" valorPadrao={detalhe.financiamento.protocolo || ""} />
            <Vinculos options={options} initial={detalhe.financiamento} />
            <Campo nome="valorImovel" rotulo="Valor do imóvel" tipo="number" obrigatorio valorPadrao={String(detalhe.financiamento.valorImovel)} /><Campo nome="valorFinanciado" rotulo="Valor financiado" tipo="number" obrigatorio valorPadrao={String(detalhe.financiamento.valorFinanciado)} />
            <Campo nome="entrada" rotulo="Entrada" tipo="number" obrigatorio valorPadrao={String(detalhe.financiamento.entrada)} /><Campo nome="parcela" rotulo="Parcela" tipo="number" valorPadrao={String(detalhe.financiamento.parcela || "")} />
            <Campo nome="taxa" rotulo="Taxa anual (%)" tipo="number" passo="0.0001" obrigatorio valorPadrao={String(detalhe.financiamento.taxa)} /><Campo nome="prazo" rotulo="Prazo (meses)" tipo="number" obrigatorio valorPadrao={String(detalhe.financiamento.prazo)} />
            <div className="md:col-span-2"><Label>Observações</Label><Textarea name="observacoes" defaultValue={detalhe.financiamento.observacoes || ""} /></div><Button type="submit" className="md:col-span-2 bg-[#C9A961] text-[#1A2332]">Salvar alterações</Button>
          </form>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Campo({ nome, rotulo, tipo = "text", obrigatorio = false, passo, valorPadrao }: { nome: string; rotulo: string; tipo?: string; obrigatorio?: boolean; passo?: string; valorPadrao?: string }) {
  return <div><Label htmlFor={nome}>{rotulo}{obrigatorio ? " *" : ""}</Label><Input id={nome} name={nome} type={tipo} required={obrigatorio} step={passo ?? (tipo === "number" ? "0.01" : undefined)} min={tipo === "number" ? 0 : undefined} defaultValue={valorPadrao} className="mt-1 border-[#C9A961]/30 bg-[#2C3E50]" /></div>;
}

function Selecao({ nome, rotulo, opcoes, valorPadrao }: { nome: string; rotulo: string; opcoes: readonly (readonly [string, string])[]; valorPadrao?: string }) {
  return <div><Label>{rotulo}</Label><Select name={nome} defaultValue={valorPadrao || opcoes[0][0]}><SelectTrigger className="mt-1 border-[#C9A961]/30 bg-[#2C3E50]"><SelectValue /></SelectTrigger><SelectContent>{opcoes.map(([valor, texto]) => <SelectItem key={valor} value={valor}>{texto}</SelectItem>)}</SelectContent></Select></div>;
}

function Vinculos({ options, initial }: { options?: { leads: { id: number; name: string }[]; properties: { id: number; title: string }[]; brokers: { id: number; name: string | null; email: string | null }[] }; initial?: { leadId: number | null; imovelVinculadoId: number | null; corretorId: number | null } }) {
  return <><div><Label>Lead vinculado</Label><Select name="leadId" defaultValue={initial?.leadId ? String(initial.leadId) : "none"}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Sem vínculo</SelectItem>{options?.leads.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select></div><div><Label>Imóvel vinculado</Label><Select name="imovelVinculadoId" defaultValue={initial?.imovelVinculadoId ? String(initial.imovelVinculadoId) : "none"}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Sem vínculo</SelectItem>{options?.properties.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.title}</SelectItem>)}</SelectContent></Select></div><div className="md:col-span-2"><Label>Corretor responsável</Label><Select name="corretorId" defaultValue={initial?.corretorId ? String(initial.corretorId) : "none"}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Sem responsável</SelectItem>{options?.brokers.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name || item.email}</SelectItem>)}</SelectContent></Select></div></>;
}
