import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Plus, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { parseNumeroBR } from "@shared/numero-br";
import { calcularObra, centavosDe, lerPercentualDigitado, type Indicador, type Natureza, type ResultadoObra } from "@shared/financeiro/obra";
import { calcularComissaoObra } from "@shared/financeiro/comissao";
import { SERVICOS_PROGRESSO } from "@shared/financeiro/progresso";

// EPIC-020 Lote 2 — abas "Valores da Operação" e "Custos". Os campos
// automáticos são calculados ao vivo pelo mesmo motor usado no servidor e
// nunca são editáveis nem enviados para gravação.

const campo = "bg-[#2C3E50] border-[#C9A961]/30 text-white";
const campoLeitura = "bg-[#2C3E50]/50 border-[#C9A961]/20 text-gray-200 cursor-not-allowed";

export interface FormFinanceiro {
  vgv: string | null;
  financiamento: string | null;
  fgts: string | null;
  subsidio: string | null;
  custoTerreno: string | null;
  comissao: string | null;
  comissaoPercentual: string | null;
  orcamentoPrevisto: string | null;
  taxaMensalPct: string | null;
  parcelas: number | null;
  empreiteiroId: number | null;
  percentualEmpreiteiro: string | null;
  investidores: { investidorId: number; nome: string; percentual: string }[];
}

type Resumo = inferRouterOutputs<AppRouter>["obraFinanceiro"]["resumo"];
type Movimento = Resumo["movimentos"][number];

export function formInicial(resumo: Resumo): FormFinanceiro {
  const v = resumo.valores;
  return {
    vgv: v.vgv,
    financiamento: v.financiamento,
    fgts: v.fgts,
    subsidio: v.subsidio,
    custoTerreno: v.custoTerreno,
    comissao: v.comissao,
    comissaoPercentual: v.comissaoPercentual,
    orcamentoPrevisto: v.orcamentoPrevisto,
    taxaMensalPct: v.taxaMensalPct,
    parcelas: v.parcelas,
    empreiteiroId: resumo.empreiteiro?.id ?? null,
    percentualEmpreiteiro: v.percentualEmpreiteiro,
    investidores: resumo.investidores.map((i) => ({ investidorId: i.investidorId, nome: i.nome, percentual: i.percentual })),
  };
}

/** Item 32: com corretor no CRM e regra de %, a comissão é VGV × % (somente leitura). */
export function comissaoAoVivo(form: FormFinanceiro, resumo: Resumo) {
  return calcularComissaoObra({
    corretor: resumo.corretor,
    vgvCentavos: centavosDe(resumo.obra.vgvAutomatico ? resumo.baseComissao : form.vgv),
    percentualObra: form.comissaoPercentual,
    pagoCentavos: resumo.comissaoCalculada.pagoCentavos,
  });
}

export function calcularAoVivo(form: FormFinanceiro, resumo: Resumo, datas: { inicio: string; termino: string }): ResultadoObra {
  return calcularObra({
    vgv: centavosDe(form.vgv),
    financiamento: centavosDe(form.financiamento),
    fgts: centavosDe(form.fgts),
    subsidio: centavosDe(form.subsidio),
    custoTerreno: centavosDe(form.custoTerreno),
    comissao: resumo.corretor ? comissaoAoVivo(form, resumo).valorCentavos : centavosDe(form.comissao),
    orcamentoPrevisto: centavosDe(form.orcamentoPrevisto),
    taxaMensalPct: form.taxaMensalPct,
    parcelas: form.parcelas,
    dataInicio: datas.inicio || null,
    dataTerminoPrevista: datas.termino || null,
    investidores: form.investidores.map((i) => ({ id: i.investidorId, percentual: i.percentual })),
    percentualEmpreiteiro: form.empreiteiroId ? form.percentualEmpreiteiro : null,
    movimentos: resumo.movimentos.map((m) => ({ natureza: m.natureza, valorCentavos: centavosDe(m.valor)!, status: m.status })),
  });
}

const brl = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brlDecimal = (valor: string | null | undefined) => (valor == null ? "—" : brl(centavosDe(valor) ?? 0));
const dataBr = (iso: string) => iso.split("-").reverse().join("/");

/** Campo numérico em padrão brasileiro que aceita vazio (vazio = não informado, nunca zero). */
export function CampoDecimal({ valor, onChange, casas = 2, prefixo, sufixo, placeholder, id }: {
  valor: string | null;
  onChange: (v: string | null) => void;
  casas?: number;
  prefixo?: string;
  sufixo?: string;
  placeholder?: string;
  id?: string;
}) {
  const formatar = (v: string | null) =>
    v == null ? "" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas === 2 ? 2 : 0, maximumFractionDigits: casas, useGrouping: true });
  // Fora de foco mostra sempre o valor canônico; em foco, o texto digitado.
  const [texto, setTexto] = useState("");
  const [focado, setFocado] = useState(false);
  return (
    <div className="relative">
      {prefixo && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{prefixo}</span>}
      <Input
        id={id}
        inputMode="decimal"
        value={focado ? texto : formatar(valor)}
        placeholder={placeholder ?? "Não informado"}
        onFocus={() => { setTexto(formatar(valor)); setFocado(true); }}
        onBlur={() => setFocado(false)}
        onChange={(e) => {
          const t = e.target.value;
          setTexto(t);
          if (!t.trim()) return onChange(null);
          // Percentual/taxa: ponto é decimal ("2.345" = 2,345%); dinheiro segue o padrão BR.
          const n = casas > 2 ? lerPercentualDigitado(t) : parseNumeroBR(t);
          if (n !== null && Number.isFinite(n) && n >= 0) onChange(n.toFixed(casas));
        }}
        className={`${campo} ${prefixo ? "pl-10" : ""} ${sufixo ? "pr-8" : ""}`}
      />
      {sufixo && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{sufixo}</span>}
    </div>
  );
}

function Calculado({ label, indicador, destaque, ajuda }: { label: string; indicador: Indicador; destaque?: boolean; ajuda?: string }) {
  const negativo = indicador.ok && indicador.centavos < 0;
  return (
    <div className="space-y-1">
      <Label className="text-gray-300">{label} <span className="text-[10px] uppercase tracking-wider text-gray-400">automático</span></Label>
      <div className={`rounded-md border px-3 py-2 text-sm ${campoLeitura} ${destaque ? "font-semibold text-[#F4D37D]" : ""} ${negativo ? "!text-red-300 border-red-400/40" : ""}`} aria-readonly="true">
        {indicador.ok ? brl(indicador.centavos) : <span className="text-amber-300 text-xs">{indicador.motivo}</span>}
      </div>
      {negativo && <p className="text-xs text-red-300">Valor negativo — verifique os lançamentos.</p>}
      {ajuda && <p className="text-xs text-gray-400">{ajuda}</p>}
    </div>
  );
}

function Leitura({ label, valor, ajuda }: { label: string; valor: string; ajuda?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-gray-300">{label}</Label>
      <div className={`rounded-md border px-3 py-2 text-sm ${campoLeitura}`} aria-readonly="true">{valor}</div>
      {ajuda && <p className="text-xs text-gray-400">{ajuda}</p>}
    </div>
  );
}

function Alertas({ calculo }: { calculo: ResultadoObra }) {
  if (!calculo.alertas.length) return null;
  return (
    <div role="alert" className="rounded-md border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200 space-y-1">
      {calculo.alertas.map((a) => <p key={a} className="flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{a}</p>)}
    </div>
  );
}

const ORIGEM_LABEL = { manual: "Manual", bpo: "BPO", migracao: "Migrado" } as const;
const CATEGORIA_LABEL: Record<string, string> = {
  terreno: "Terreno", comissao: "Comissão", empreiteiro: "Empreiteiro", fornecedor: "Fornecedor", outros: "Outros", nao_detalhado: "Não detalhado (migrado)",
  mao_de_obra: "Mão de obra", material: "Material",
};
const CATEGORIAS_PAGAMENTO = ["empreiteiro", "terreno", "comissao", "fornecedor", "outros", "mao_de_obra", "material"] as const;
const ETAPA_LABEL: Record<string, string> = Object.fromEntries(SERVICOS_PROGRESSO.map((s) => [s.chave, s.nome]));
const SEM_ETAPA = "__sem_etapa__";

function Historico({ titulo, movimentos, onMudou }: { titulo: string; movimentos: Movimento[]; onMudou: () => void }) {
  const [excluindo, setExcluindo] = useState<Movimento | null>(null);
  const excluir = trpc.obraFinanceiro.excluirMovimento.useMutation({
    onSuccess: () => { toast.success("Lançamento excluído."); setExcluindo(null); onMudou(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-gray-200">{titulo}</p>
      {movimentos.length === 0 ? (
        <p className="text-xs text-gray-400">Nenhum lançamento.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[#C9A961]/20">
          <table className="w-full text-sm">
            <thead className="bg-[#1A2332] text-gray-400 text-xs uppercase">
              <tr><th className="p-2 text-left">Data</th><th className="p-2 text-left">Descrição</th><th className="p-2 text-left">Origem</th><th className="p-2 text-right">Valor</th><th className="p-2" /></tr>
            </thead>
            <tbody>
              {movimentos.map((m) => (
                <tr key={m.id} className="border-t border-white/5">
                  <td className="p-2 whitespace-nowrap text-gray-300">{dataBr(m.data)}</td>
                  <td className="p-2 text-gray-200">
                    {m.descricao}
                    {m.categoria && <span className="ml-2 text-[10px] uppercase text-gray-400">{CATEGORIA_LABEL[m.categoria]}</span>}
                    {m.etapa && <span className="ml-2 text-[10px] uppercase text-gray-400">· {ETAPA_LABEL[m.etapa] ?? m.etapa}</span>}
                    {m.observacao && <span className="block text-xs text-gray-400">{m.observacao}</span>}
                    {m.bpo && <span className="block text-xs text-gray-400">BPO: {m.bpo.descricao}{m.bpo.pago === false ? " — não está mais pago!" : ""}</span>}
                  </td>
                  <td className="p-2 text-gray-400">{ORIGEM_LABEL[m.origem]}</td>
                  <td className="p-2 text-right text-gray-100 whitespace-nowrap">{brlDecimal(m.valor)}</td>
                  <td className="p-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" className="text-red-300 hover:text-red-200" onClick={() => setExcluindo(m)} aria-label={`Excluir ${m.descricao}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={!!excluindo} onOpenChange={(o) => !o && setExcluindo(null)}>
        <DialogContent className="bg-[#1A2332] border-[#C9A961]/30 text-white">
          <DialogHeader><DialogTitle className="text-[#C9A961]">Excluir lançamento</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-300">
            {excluindo?.descricao} — {brlDecimal(excluindo?.valor)}. O lançamento será removido definitivamente e sai dos totais. Esta ação não pode ser desfeita.
            {excluindo?.origem === "bpo" && " O lançamento original no BPO não é alterado (só deixa de estar vinculado a esta obra)."}
          </p>
          <Button disabled={excluir.isPending} onClick={() => excluindo && excluir.mutate({ id: excluindo.id })} className="bg-red-500 hover:bg-red-600">
            Excluir definitivamente
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NovoMovimento({ projectId, natureza, rotulo, onMudou, permitirBpo = true }: { projectId: number; natureza: Natureza; rotulo: string; onMudou: () => void; permitirBpo?: boolean }) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [aberto, setAberto] = useState(false);
  const [origem, setOrigem] = useState<"manual" | "bpo">("manual");
  const [bpoId, setBpoId] = useState<string>("");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState<string | null>(null);
  const [data, setData] = useState(hoje);
  const [observacao, setObservacao] = useState("");
  const [categoria, setCategoria] = useState<string>("empreiteiro");
  const [etapa, setEtapa] = useState<string>(SEM_ETAPA);
  const disponiveis = trpc.obraFinanceiro.bpoDisponiveis.useQuery({ natureza }, { enabled: aberto && origem === "bpo" });
  const adicionar = trpc.obraFinanceiro.adicionarMovimento.useMutation({
    onSuccess: () => {
      toast.success("Lançamento registrado.");
      setAberto(false); setDescricao(""); setValor(null); setObservacao(""); setBpoId(""); setOrigem("manual"); setData(hoje); setEtapa(SEM_ETAPA);
      onMudou();
    },
    onError: (e) => toast.error(e.message),
  });
  const escolhido = disponiveis.data?.find((b) => String(b.id) === bpoId);
  return (
    <>
      <Button type="button" variant="outline" className="border-[#C9A961]/40 text-[#C9A961] gap-2" onClick={() => setAberto(true)}>
        <Plus className="h-4 w-4" /> {rotulo}
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="bg-[#1A2332] border-[#C9A961]/30 text-white max-w-lg">
          <DialogHeader><DialogTitle className="text-[#C9A961]">{rotulo}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {permitirBpo && <div>
              <Label className="text-gray-300">Origem</Label>
              <Select value={origem} onValueChange={(v) => setOrigem(v as "manual" | "bpo")}>
                <SelectTrigger className={campo}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Lançamento manual</SelectItem>
                  <SelectItem value="bpo">Vincular lançamento do BPO Financeiro</SelectItem>
                </SelectContent>
              </Select>
            </div>}
            {natureza === "pagamento" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <Label className="text-gray-300">Categoria</Label>
                  <Select value={categoria} onValueChange={setCategoria}>
                    <SelectTrigger className={campo}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIAS_PAGAMENTO.map((c) => <SelectItem key={c} value={c}>{CATEGORIA_LABEL[c]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0">
                  <Label className="text-gray-300">Etapa</Label>
                  <Select value={etapa} onValueChange={setEtapa}>
                    <SelectTrigger className={campo}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SEM_ETAPA}>Sem etapa</SelectItem>
                      {SERVICOS_PROGRESSO.map((s) => <SelectItem key={s.chave} value={s.chave}>{s.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            {origem === "bpo" && (
              <div>
                <Label className="text-gray-300">Lançamento do BPO (pago)</Label>
                <Select value={bpoId} onValueChange={(v) => {
                  setBpoId(v);
                  const b = disponiveis.data?.find((x) => String(x.id) === v);
                  if (b) { setDescricao(b.descricao.slice(0, 255)); setValor((b.disponivelCentavos / 100).toFixed(2)); }
                }}>
                  <SelectTrigger className={campo}><SelectValue placeholder={disponiveis.isLoading ? "Carregando..." : "Selecione"} /></SelectTrigger>
                  <SelectContent>
                    {(disponiveis.data ?? []).map((b) => (
                      <SelectItem key={b.id} value={String(b.id)}>{b.descricao} · disponível {brl(b.disponivelCentavos)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {disponiveis.data?.length === 0 && <p className="text-xs text-gray-400 mt-1">Nenhum lançamento pago com saldo disponível no BPO.</p>}
                {escolhido && <p className="text-xs text-gray-400 mt-1">Você pode alocar parte do valor; o restante continua disponível para outras obrigações.</p>}
              </div>
            )}
            <div><Label className="text-gray-300">Descrição</Label><Input value={descricao} onChange={(e) => setDescricao(e.target.value)} className={campo} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-gray-300">Valor</Label><CampoDecimal valor={valor} onChange={setValor} prefixo="R$" placeholder="0,00" /></div>
              <div><Label className="text-gray-300">Data</Label><Input type="date" value={data} onChange={(e) => setData(e.target.value)} className={campo} /></div>
            </div>
            <div><Label className="text-gray-300">Observação (opcional)</Label><Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} className={campo} rows={2} /></div>
            <Button
              className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332]"
              disabled={adicionar.isPending || !valor || Number(valor) <= 0 || descricao.trim().length < 2 || !data || (origem === "bpo" && !bpoId)}
              onClick={() => adicionar.mutate({
                projectId,
                natureza,
                categoria: natureza === "pagamento" ? (categoria as "empreiteiro") : undefined,
                etapa: natureza === "pagamento" && etapa !== SEM_ETAPA ? etapa : undefined,
                descricao,
                valor: valor!,
                data,
                observacao: observacao || undefined,
                bpoLancamentoId: origem === "bpo" ? Number(bpoId) : undefined,
              })}
            >
              Registrar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Investidores({ form, setForm, calculo }: { form: FormFinanceiro; setForm: (f: FormFinanceiro) => void; calculo: ResultadoObra }) {
  const utils = trpc.useUtils();
  const lista = trpc.obraFinanceiro.listarInvestidores.useQuery();
  const [novoAberto, setNovoAberto] = useState(false);
  const [novo, setNovo] = useState({ nome: "", documento: "", telefone: "", email: "" });
  const criar = trpc.obraFinanceiro.criarInvestidor.useMutation({
    onSuccess: (inv) => {
      utils.obraFinanceiro.listarInvestidores.invalidate();
      setForm({ ...form, investidores: [...form.investidores, { investidorId: inv.id, nome: inv.nome, percentual: "0.000000" }] });
      setNovoAberto(false); setNovo({ nome: "", documento: "", telefone: "", email: "" });
      toast.success("Investidor cadastrado e vinculado. Defina a participação e salve.");
    },
    onError: (e) => toast.error(e.message),
  });
  const disponiveis = (lista.data ?? []).filter((i) => !form.investidores.some((f) => f.investidorId === i.id));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-200">Investidores vinculados</p>
        <div className="flex gap-2">
          <Select value="" onValueChange={(v) => {
            const inv = lista.data?.find((i) => String(i.id) === v);
            if (inv) setForm({ ...form, investidores: [...form.investidores, { investidorId: inv.id, nome: inv.nome, percentual: "0.000000" }] });
          }}>
            <SelectTrigger className={`${campo} w-56`}><SelectValue placeholder="Vincular investidor" /></SelectTrigger>
            <SelectContent>
              {disponiveis.length === 0 && <SelectItem value="__nenhum" disabled>Nenhum outro cadastrado</SelectItem>}
              {disponiveis.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" className="border-[#C9A961]/40 text-[#C9A961]" onClick={() => setNovoAberto(true)}><UserPlus className="h-4 w-4" /></Button>
        </div>
      </div>
      {form.investidores.length === 0 && <p className="text-xs text-gray-400">Nenhum investidor nesta obra.</p>}
      {form.investidores.map((inv, idx) => (
        <div key={inv.investidorId} className="grid grid-cols-1 md:grid-cols-[1fr_160px_1fr_auto] gap-3 items-end">
          <Leitura label="Investidor" valor={inv.nome} />
          <div className="space-y-1">
            <Label className="text-gray-300">Participação</Label>
            <CampoDecimal valor={inv.percentual} casas={6} sufixo="%" placeholder="0" onChange={(v) => {
              const investidores = [...form.investidores];
              investidores[idx] = { ...inv, percentual: v ?? "0.000000" };
              setForm({ ...form, investidores });
            }} />
          </div>
          <Calculado label="Lucro do Investidor" indicador={calculo.investidores[idx]?.lucro ?? { ok: false, motivo: "—" }} />
          <Button type="button" variant="ghost" className="text-red-300" aria-label={`Remover ${inv.nome}`}
            onClick={() => setForm({ ...form, investidores: form.investidores.filter((_, i) => i !== idx) })}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Dialog open={novoAberto} onOpenChange={setNovoAberto}>
        <DialogContent className="bg-[#1A2332] border-[#C9A961]/30 text-white">
          <DialogHeader><DialogTitle className="text-[#C9A961]">Novo investidor</DialogTitle></DialogHeader>
          {(["nome", "documento", "telefone", "email"] as const).map((k) => (
            <div key={k}><Label className="text-gray-300 capitalize">{k === "documento" ? "CPF/CNPJ" : k}</Label>
              <Input value={novo[k]} onChange={(e) => setNovo({ ...novo, [k]: e.target.value })} className={campo} /></div>
          ))}
          <Button disabled={criar.isPending || novo.nome.trim().length < 2} className="bg-[#C9A961] text-[#1A2332]" onClick={() => criar.mutate(novo)}>Cadastrar</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const porNatureza = (resumo: Resumo, natureza: Natureza) => resumo.movimentos.filter((m) => m.natureza === natureza);

export function ValoresOperacaoAba({ projectId, resumo, form, setForm, calculo, nomeEmpresa, onMudou }: {
  projectId: number; resumo: Resumo; form: FormFinanceiro; setForm: (f: FormFinanceiro) => void; calculo: ResultadoObra; nomeEmpresa: string; onMudou: () => void;
}) {
  const set = (k: keyof FormFinanceiro) => (v: string | null) => setForm({ ...form, [k]: v });
  const empreiteiros = trpc.obraFinanceiro.listarEmpreiteiros.useQuery();
  const nomeEmpreiteiro = empreiteiros.data?.find((e) => e.id === form.empreiteiroId)?.name ?? resumo.empreiteiro?.name;
  const pls = calculo.plsReal;
  return (
    <div className="space-y-6">
      <Alertas calculo={calculo} />
      <Card className="bg-[#1A2332]/60 border-[#C9A961]/20">
        <CardHeader><CardTitle className="text-[#C9A961] text-lg">Composição da operação</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Pedido de 15/10: obra com cliente no CRM tem VGV = Valor Aprovado do lead (não editável aqui). */}
          {resumo.obra.vgvAutomatico
            ? <Leitura label="VGV (R$) · automático" valor={form.vgv ? brlDecimal(form.vgv) : "Valor Aprovado não informado no CRM"}
                ajuda="Vem do Valor Aprovado do cliente no CRM. Para alterar, edite o lead." />
            : <div className="space-y-1"><Label className="text-gray-300">VGV (R$)</Label><CampoDecimal valor={form.vgv} onChange={set("vgv")} prefixo="R$" /></div>}
          <div className="space-y-1"><Label className="text-gray-300">Financiamento CEF (R$)</Label><CampoDecimal valor={form.financiamento} onChange={set("financiamento")} prefixo="R$" /></div>
          <div className="space-y-1"><Label className="text-gray-300">FGTS (R$)</Label><CampoDecimal valor={form.fgts} onChange={set("fgts")} prefixo="R$" /></div>
          <div className="space-y-1"><Label className="text-gray-300">Subsídio (R$)</Label><CampoDecimal valor={form.subsidio} onChange={set("subsidio")} prefixo="R$" /></div>
        </CardContent>
      </Card>

      <Card className="bg-[#1A2332]/60 border-[#C9A961]/20">
        <CardHeader>
          <CardTitle className="text-[#C9A961] text-lg">Entrada</CardTitle>
          <CardDescription className="text-gray-400">Entrada Total = VGV − Financiamento CEF − FGTS − Subsídio · Saldo = Entrada Total − Entrada Paga</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Calculado label="Entrada Total" indicador={calculo.entradaTotal} />
            <Calculado label="Entrada Paga" indicador={calculo.entradaPaga} ajuda="Soma dos recebimentos de entrada confirmados." />
            <Calculado label="Saldo da Entrada" indicador={calculo.saldoEntrada} destaque />
          </div>
          <NovoMovimento projectId={projectId} natureza="entrada" rotulo="Adicionar Entrada" onMudou={onMudou} />
          <Historico titulo="Histórico de entradas" movimentos={porNatureza(resumo, "entrada")} onMudou={onMudou} />
        </CardContent>
      </Card>

      <Card className="bg-[#1A2332]/60 border-[#C9A961]/20">
        <CardHeader>
          <CardTitle className="text-[#C9A961] text-lg">Caixa Econômica Federal</CardTitle>
          <CardDescription className="text-gray-400">A Receber do Banco = Financiamento + Subsídio + FGTS − Terreno − Recebido CEF · PLS Real = Recebido CEF × 100 ÷ (Financiamento + Subsídio + FGTS − Terreno)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Calculado label="Valor Recebido CEF" indicador={calculo.recebidoCef} />
            <Calculado label="Valor a Receber do Banco" indicador={calculo.receberBanco} destaque />
            <Leitura label="PLS Real (%)" valor={pls.ok ? `${pls.percentual.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : pls.motivo}
              ajuda="Percentual financeiro recebido — não mede a execução física." />
          </div>
          <NovoMovimento projectId={projectId} natureza="recebimento_cef" rotulo="Adicionar recebimento da CEF" onMudou={onMudou} />
          <Historico titulo="Histórico de recebimentos da CEF" movimentos={porNatureza(resumo, "recebimento_cef")} onMudou={onMudou} />
        </CardContent>
      </Card>

      <Card className="bg-[#1A2332]/60 border-[#C9A961]/20">
        <CardHeader><CardTitle className="text-[#C9A961] text-lg">Custos (vindos da aba Custos)</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Calculado label="Custo Construção" indicador={calculo.custoConstrucao} ajuda="Igual ao Orçamento Previsto da aba Custos." />
          <Calculado label="Gasto Obra Realizado" indicador={calculo.gastoObraRealizado} ajuda="Igual ao Total Gasto na Obra da aba Custos." />
        </CardContent>
      </Card>

      <Card className="bg-[#1A2332]/60 border-[#C9A961]/20">
        <CardHeader>
          <CardTitle className="text-[#C9A961] text-lg">Distribuição dos lucros</CardTitle>
          <CardDescription className="text-gray-400">Lucro Estimado = VGV − Terreno − Comissão − Orçamento Previsto. Estimativa da operação, não é lucro contábil líquido.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Calculado label="Lucro Estimado da Operação" indicador={calculo.lucroEstimado} destaque />
          <Investidores form={form} setForm={setForm} calculo={calculo} />
          <Calculado label="Lucro dos Investidores (total)" indicador={calculo.lucroInvestidores} />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end">
            <Leitura label="Empreiteiro" valor={nomeEmpreiteiro ?? "Nenhum (selecione na aba Custos)"} />
            <div className="space-y-1">
              <Label className="text-gray-300">Participação do Empreiteiro</Label>
              {form.empreiteiroId ? (
                <CampoDecimal valor={form.percentualEmpreiteiro} onChange={set("percentualEmpreiteiro")} casas={6} sufixo="%" placeholder="0" />
              ) : <div className={`rounded-md border px-3 py-2 text-sm ${campoLeitura}`}>—</div>}
            </div>
            <Calculado label="Base do Empreiteiro" indicador={calculo.baseEmpreiteiro} ajuda="Lucro Estimado − Lucro dos Investidores" />
            <Calculado label="Lucro do Empreiteiro" indicador={calculo.lucroEmpreiteiro} />
          </div>
          <Calculado label={`Lucro ${nomeEmpresa}`} indicador={calculo.lucroEmpresa} destaque ajuda="Lucro Estimado − Lucro dos Investidores − Lucro do Empreiteiro" />
        </CardContent>
      </Card>

      <Card className="bg-[#1A2332]/60 border-[#C9A961]/20">
        <CardHeader>
          <CardTitle className="text-[#C9A961] text-lg">Pró-Soluto</CardTitle>
          <CardDescription className="text-gray-400">Pró-Soluto = Saldo da Entrada · Parcela pelo sistema Price (equivalente à HP 12C, modo END)</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Calculado label="Pró-Soluto" indicador={calculo.proSoluto} />
          <div className="space-y-1"><Label className="text-gray-300">Taxa Mensal (%)</Label><CampoDecimal valor={form.taxaMensalPct} onChange={set("taxaMensalPct")} casas={4} sufixo="%" /></div>
          <div className="space-y-1">
            <Label className="text-gray-300">Quantidade de Parcelas</Label>
            <Input inputMode="numeric" value={form.parcelas ?? ""} placeholder="Não informado" className={campo}
              onChange={(e) => { const t = e.target.value.replace(/\D/g, ""); setForm({ ...form, parcelas: t ? Number(t) : null }); }} />
          </div>
          <Calculado label="Valor da Parcela" indicador={calculo.valorParcela} destaque />
        </CardContent>
      </Card>

      <Card className="bg-[#1A2332]/60 border-[#C9A961]/20">
        <CardHeader><CardTitle className="text-[#C9A961] text-lg">Prazo</CardTitle></CardHeader>
        <CardContent>
          <Leitura label="Dias de Obra" valor={calculo.diasObra.ok ? `${calculo.diasObra.dias} dias` : calculo.diasObra.motivo}
            ajuda="Data prevista de término − data de início (aba Informações)." />
        </CardContent>
      </Card>
    </div>
  );
}

export function CustosAba({ projectId, resumo, form, setForm, calculo, corretor, onMudou, modoEmpreiteiro = false }: {
  projectId: number; resumo: Resumo; form: FormFinanceiro; setForm: (f: FormFinanceiro) => void; calculo: ResultadoObra; corretor: string | null; onMudou: () => void;
  /** Portal do Empreiteiro (15/10): Custos previstos só leitura; Pagamentos liberados, sem vincular o BPO da empresa. */
  modoEmpreiteiro?: boolean;
}) {
  const set = (k: keyof FormFinanceiro) => (v: string | null) => setForm({ ...form, [k]: v });
  const empreiteiros = trpc.obraFinanceiro.listarEmpreiteiros.useQuery();
  const pagamentos = useMemo(() => porNatureza(resumo, "pagamento"), [resumo]);
  return (
    <div className="space-y-6">
      <fieldset disabled={modoEmpreiteiro} className="contents">
      <Card className="bg-[#1A2332]/60 border-[#C9A961]/20">
        <CardHeader>
          <CardTitle className="text-[#C9A961] text-lg">Custos previstos</CardTitle>
          {modoEmpreiteiro && <CardDescription className="text-gray-400">Somente leitura: definidos pela empresa.</CardDescription>}
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1">
            <Label className="text-gray-300">Orçamento Previsto (R$)</Label>
            <CampoDecimal valor={form.orcamentoPrevisto} onChange={set("orcamentoPrevisto")} prefixo="R$" />
            <p className="text-xs text-gray-400">Orçamento da construção. Não inclui terreno nem comissão.</p>
          </div>
          <div className="space-y-1">
            <Label className="text-gray-300">Empreiteiro</Label>
            <Select value={form.empreiteiroId ? String(form.empreiteiroId) : "nenhum"}
              onValueChange={(v) => setForm({ ...form, empreiteiroId: v === "nenhum" ? null : Number(v), percentualEmpreiteiro: v === "nenhum" ? null : form.percentualEmpreiteiro })}>
              <SelectTrigger className={campo}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nenhum">Nenhum</SelectItem>
                {(empreiteiros.data ?? []).map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.name || e.email}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-400">
              Usuários com papel "empreiteiro" (Configurações → Usuários).
              {resumo.obra.tipoContratoLegado && ` Tipo de contrato antigo preservado: ${resumo.obra.tipoContratoLegado}.`}
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-gray-300">Custo do Terreno (R$)</Label>
            <CampoDecimal valor={form.custoTerreno} onChange={set("custoTerreno")} prefixo="R$" />
            <p className="text-xs text-gray-400">Valor contratual previsto; pagamentos do terreno entram no histórico.</p>
          </div>
          <ComissaoCampos resumo={resumo} form={form} setForm={setForm} />
          <Leitura label="Corretor vinculado" valor={corretor ?? "Sem corretor no lead"} ajuda="Vem do lead no CRM." />
        </CardContent>
      </Card>
      </fieldset>

      <Card className="bg-[#1A2332]/60 border-[#C9A961]/20">
        <CardHeader>
          <CardTitle className="text-[#C9A961] text-lg">Pagamentos</CardTitle>
          <CardDescription className="text-gray-400">Total Gasto = soma dos pagamentos efetivamente realizados · Saldo Restante = VGV − Total Gasto (não é lucro nem saldo bancário)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <NovoMovimento projectId={projectId} natureza="pagamento" rotulo="Adicionar Pagamento" onMudou={onMudou} permitirBpo={!modoEmpreiteiro} />
          <Historico titulo="Histórico de pagamentos" movimentos={pagamentos} onMudou={onMudou} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Calculado label="Total Gasto na Obra" indicador={calculo.totalGasto} destaque />
            <Calculado label="Saldo Restante" indicador={calculo.saldoRestante} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Item 32 + 17.4: comissão vinculada ao corretor do CRM. Com regra de % e VGV,
 *  o valor é calculado (VGV × % / 100); sem regra, o valor informado é preservado. */
function ComissaoCampos({ resumo, form, setForm }: { resumo: Resumo; form: FormFinanceiro; setForm: (f: FormFinanceiro) => void }) {
  const c = comissaoAoVivo(form, resumo);
  const padrao = resumo.corretor?.percentualPadrao;
  return (
    <>
      {resumo.corretor && (
        <div className="space-y-1">
          <Label className="text-gray-300">Percentual de Comissão (%)</Label>
          <CampoDecimal valor={form.comissaoPercentual} onChange={(v) => setForm({ ...form, comissaoPercentual: v })} casas={4} sufixo="%"
            placeholder={padrao ? `Padrão do corretor: ${Number(padrao).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%` : "Sem regra cadastrada"} />
          <p className="text-xs text-gray-400">Vazio usa o percentual padrão do corretor (Corretores). Nunca é presumido.</p>
        </div>
      )}
      {c.valorCentavos !== null ? (
        <Leitura label="Comissão (R$) · automático" valor={brl(c.valorCentavos)}
          ajuda={`VGV × ${Number(c.percentual).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}% (${c.fontePercentual === "obra" ? "percentual da obra" : "padrão do corretor"}) · pago ${brl(c.pagoCentavos)}`} />
      ) : resumo.corretor ? (
        <div className="space-y-1">
          <Leitura label="Comissão (R$) · automático" valor="Indisponível" ajuda="Obra com corretor: a comissão é sempre VGV × % (nunca digitada)." />
          {c.pendencias.map((p) => <p key={p} className="text-xs text-amber-300">{p}</p>)}
        </div>
      ) : (
        <div className="space-y-1">
          <Label className="text-gray-300">Comissão (R$)</Label>
          <CampoDecimal valor={form.comissao} onChange={(v) => setForm({ ...form, comissao: v })} prefixo="R$" />
        </div>
      )}
    </>
  );
}
