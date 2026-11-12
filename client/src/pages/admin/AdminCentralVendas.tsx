// Central de Vendas (12/11/2026) — painel de indicadores, atendimentos (com a decisão da análise) e as telas de
// configuração (só admin): interruptores, modo de teste, horários, SLA, limites, produtos, checklists,
// sequências, campanhas (links wa.me), templates e auditoria/fila.
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Download, Plus, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { ROTULOS_SEQUENCIA, ROTULOS_STATUS, TIPOS_DOCUMENTO, TIPOS_SEQUENCIA, type ItemChecklist, type PassoSequencia, type TipoSequencia } from "@shared/central-vendas/config";

const cardCls = "bg-[#2C3E50] border-[#C9A961]/20 text-white";
const inputCls = "bg-[#1A2332] border-[#C9A961]/30 text-white";
const selectCls = "h-9 rounded-md border border-[#C9A961]/30 bg-[#1A2332] px-2 text-sm text-white";
const SEM = "sem dados";

type Aba = "painel" | "atendimentos" | "configuracoes" | "produtos" | "checklists" | "sequencias" | "campanhas" | "templates" | "auditoria";
const ABAS: { id: Aba; rotulo: string; admin?: boolean }[] = [
  { id: "painel", rotulo: "Painel" }, { id: "atendimentos", rotulo: "Atendimentos" },
  { id: "configuracoes", rotulo: "Configurações", admin: true }, { id: "produtos", rotulo: "Produtos", admin: true },
  { id: "checklists", rotulo: "Checklists", admin: true }, { id: "sequencias", rotulo: "Sequências", admin: true },
  { id: "campanhas", rotulo: "Campanhas", admin: true }, { id: "templates", rotulo: "Templates", admin: true },
  { id: "auditoria", rotulo: "Auditoria", admin: true },
];

const fmtMin = (v: number | null) => (v === null ? SEM : v < 60 ? `${v.toLocaleString("pt-BR")} min` : v < 1440 ? `${(v / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h` : `${(v / 1440).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`);
const rot = (s: string) => ROTULOS_STATUS[s] ?? s;
const erro = (e: unknown) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");

export default function AdminCentralVendas() {
  const { user } = useAuth();
  const admin = user?.role === "admin";
  const [aba, setAba] = useState<Aba>("painel");
  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <header className="border-b border-[#C9A961]/20 bg-[#0F1923] px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
          <Link href="/admin"><Button variant="ghost" size="icon" className="text-gray-400 hover:text-white" aria-label="Voltar"><ArrowLeft className="h-5 w-5" /></Button></Link>
          <h1 className="text-2xl font-bold text-[#C9A961]">Central de Vendas</h1>
        </div>
        <nav className="mx-auto mt-3 flex max-w-6xl flex-wrap gap-2">
          {ABAS.filter(a => admin || !a.admin).map(a => (
            <Button key={a.id} size="sm" variant={aba === a.id ? "default" : "outline"} onClick={() => setAba(a.id)}
              className={aba === a.id ? "bg-[#C9A961] text-[#1A2332] hover:bg-[#C9A961]/90" : "border-[#C9A961]/30 bg-transparent text-gray-200"}>{a.rotulo}</Button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        {aba === "painel" && <Painel />}
        {aba === "atendimentos" && <Atendimentos />}
        {admin && aba === "configuracoes" && <Configuracoes />}
        {admin && aba === "produtos" && <Produtos />}
        {admin && aba === "checklists" && <Checklists />}
        {admin && aba === "sequencias" && <Sequencias />}
        {admin && aba === "campanhas" && <Campanhas />}
        {admin && aba === "templates" && <Templates />}
        {admin && aba === "auditoria" && <Auditoria />}
      </main>
    </div>
  );
}

function Kpi({ rotulo, valor }: { rotulo: string; valor: string | number | null }) {
  return (
    <Card className={cardCls}><CardContent className="p-4">
      <p className="text-xs text-gray-400">{rotulo}</p>
      <p className="mt-1 text-2xl font-semibold">{valor === null ? <span className="text-base text-gray-400">{SEM}</span> : valor}</p>
    </CardContent></Card>
  );
}

function Painel() {
  const [f, setF] = useState<{ de: string; ate: string; operadorId: string; produtoId: string; origem: string }>({ de: "", ate: "", operadorId: "", produtoId: "", origem: "" });
  const filtros = { de: f.de || null, ate: f.ate || null, operadorId: f.operadorId ? Number(f.operadorId) : null, produtoId: f.produtoId ? Number(f.produtoId) : null, origem: f.origem || null };
  const q = trpc.centralVendas.painel.useQuery(filtros);
  const csv = trpc.centralVendas.exportarCsv.useMutation();
  const ind = q.data?.indicadores;
  async function exportar() {
    try {
      const r = await csv.mutateAsync(filtros);
      const url = URL.createObjectURL(new Blob([r.csv], { type: "text/csv;charset=utf-8;" }));
      const a = document.createElement("a");
      a.href = url; a.download = `central-de-vendas-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { erro(e); }
  }
  return (
    <>
      {q.data && !q.data.ativo && <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">As automações estão desligadas (interruptor geral em Configurações).</p>}
      <Card className={cardCls}><CardContent className="flex flex-wrap items-end gap-3 p-4">
        <div><Label className="text-xs">De</Label><Input type="date" className={inputCls} value={f.de} onChange={e => setF({ ...f, de: e.target.value })} /></div>
        <div><Label className="text-xs">Até</Label><Input type="date" className={inputCls} value={f.ate} onChange={e => setF({ ...f, ate: e.target.value })} /></div>
        {q.data?.admin && (
          <div><Label className="text-xs">Operador</Label><br />
            <select className={selectCls} value={f.operadorId} onChange={e => setF({ ...f, operadorId: e.target.value })}>
              <option value="">Todos</option>{q.data.opcoes.operadores.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select></div>
        )}
        <div><Label className="text-xs">Empreendimento</Label><br />
          <select className={selectCls} value={f.produtoId} onChange={e => setF({ ...f, produtoId: e.target.value })}>
            <option value="">Todos</option>{q.data?.opcoes.produtos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select></div>
        <div><Label className="text-xs">Origem</Label><br />
          <select className={selectCls} value={f.origem} onChange={e => setF({ ...f, origem: e.target.value })}>
            <option value="">Todas</option>{q.data?.opcoes.origens.map(o => <option key={o} value={o}>{o}</option>)}
          </select></div>
        <Button variant="outline" className="border-[#C9A961]/40 bg-transparent text-[#C9A961]" onClick={exportar} disabled={csv.isPending}><Download className="mr-2 h-4 w-4" />CSV</Button>
      </CardContent></Card>
      {q.isLoading && <p className="text-gray-400">Carregando…</p>}
      {ind && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi rotulo="Leads recebidos" valor={ind.recebidos} />
            <Kpi rotulo="Qualificados" valor={ind.recebidos ? ind.qualificados : null} />
            <Kpi rotulo="Tempo de 1ª resposta (média)" valor={ind.tempoPrimeiraRespostaMin === null ? null : fmtMin(ind.tempoPrimeiraRespostaMin)} />
            <Kpi rotulo="Taxa de conversão (aprovados/recebidos)" valor={ind.taxaConversao === null ? null : `${ind.taxaConversao.toLocaleString("pt-BR")}%`} />
            <Kpi rotulo="Aguardando documentos" valor={ind.recebidos ? ind.aguardandoDocumentos : null} />
            <Kpi rotulo="Documentação completa" valor={ind.recebidos ? ind.documentacaoCompleta : null} />
            <Kpi rotulo="Enviados à análise" valor={ind.recebidos ? ind.enviadosAnalise : null} />
            <Kpi rotulo="Pendências da análise" valor={ind.recebidos ? ind.pendencias : null} />
            <Kpi rotulo="Aprovados" valor={ind.recebidos ? ind.aprovados : null} />
            <Kpi rotulo="Reprovados" valor={ind.recebidos ? ind.reprovados : null} />
            <Kpi rotulo="Entrada → qualificação" valor={ind.tempoMedioEtapasMin.entradaAteQualificacao === null ? null : fmtMin(ind.tempoMedioEtapasMin.entradaAteQualificacao)} />
            <Kpi rotulo="Qualificação → documentos" valor={ind.tempoMedioEtapasMin.qualificacaoAteDocumentos === null ? null : fmtMin(ind.tempoMedioEtapasMin.qualificacaoAteDocumentos)} />
            <Kpi rotulo="Análise → decisão" valor={ind.tempoMedioEtapasMin.documentosAteDecisao === null ? null : fmtMin(ind.tempoMedioEtapasMin.documentosAteDecisao)} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Card className={cardCls}><CardHeader><CardTitle className="text-base">Atendimentos por operador</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">
              {ind.atendimentosPorOperador.length ? ind.atendimentosPorOperador.map(o => <div key={o.operadorId} className="flex justify-between"><span>{o.nome}</span><span>{o.total}</span></div>) : <p className="text-gray-400">{SEM}</p>}
            </CardContent></Card>
            <Card className={cardCls}><CardHeader><CardTitle className="text-base">Origem das oportunidades</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">
              {ind.origens.length ? ind.origens.map(o => <div key={o.origem} className="flex justify-between"><span>{o.origem}</span><span>{o.total}</span></div>) : <p className="text-gray-400">{SEM}</p>}
            </CardContent></Card>
          </div>
        </>
      )}
    </>
  );
}

function Atendimentos() {
  const utils = trpc.useUtils();
  const q = trpc.centralVendas.atendimentos.useQuery({});
  const decidir = trpc.centralVendas.registrarDecisao.useMutation();
  const reativar = trpc.centralVendas.reativarAutomacao.useMutation();
  const encerrar = trpc.centralVendas.encerrar.useMutation();
  const [decisao, setDecisao] = useState<{ leadId: number; tipo: "pendente" | "aprovado" | "reprovado"; pendencias: string; motivo: string } | null>(null);
  const recarregar = () => utils.centralVendas.atendimentos.invalidate();
  async function confirmar() {
    if (!decisao) return;
    try {
      await decidir.mutateAsync({ leadId: decisao.leadId, decisao: decisao.tipo, pendencias: decisao.pendencias || undefined, motivoInterno: decisao.motivo || undefined });
      toast.success("Decisão registrada. A mensagem ao cliente foi disparada automaticamente.");
      setDecisao(null); recarregar();
    } catch (e) { erro(e); }
  }
  if (q.isLoading) return <p className="text-gray-400">Carregando…</p>;
  if (!q.data?.length) return <p className="text-gray-400">Nenhum atendimento na Central ainda.</p>;
  return (
    <div className="space-y-3">
      {q.data.map(a => (
        <Card key={a.leadId} className={cardCls}><CardContent className="space-y-2 p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href={`/admin/crm/${a.leadId}`} className="font-semibold text-[#C9A961] hover:underline">{a.nome}</Link>
            <span className="text-xs text-gray-400">{a.origem}{a.campanha ? ` · ${a.campanha}` : ""} · {a.operador ?? "sem operador"}</span>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded bg-blue-500/20 px-2 py-0.5">{rot(a.statusAtendimento)}</span>
            <span className="rounded bg-teal-500/20 px-2 py-0.5">Docs: {rot(a.statusDocumental)}</span>
            <span className="rounded bg-purple-500/20 px-2 py-0.5">Análise: {rot(a.statusAnalise)}</span>
            {a.optOut && <span className="rounded bg-red-500/20 px-2 py-0.5">Saiu das mensagens automáticas</span>}
          </div>
          {a.motivo && <p className="text-xs text-gray-300">Transferido: {a.motivo}</p>}
          {a.resumo && <p className="whitespace-pre-line text-xs text-gray-300">{a.resumo}</p>}
          {a.pendencias && <p className="text-xs text-amber-200">Pendências: {a.pendencias}</p>}
          <div className="flex flex-wrap gap-2">
            {a.podeDecidir && (["pendente", "aprovado", "reprovado"] as const).map(t => (
              <Button key={t} size="sm" variant="outline" className="border-[#C9A961]/40 bg-transparent text-white" onClick={() => setDecisao({ leadId: a.leadId, tipo: t, pendencias: "", motivo: "" })}>
                {t === "pendente" ? "Pendente" : t === "aprovado" ? "Aprovar" : "Reprovar"}
              </Button>
            ))}
            {a.optOut && <Button size="sm" variant="outline" className="border-gray-500 bg-transparent text-gray-200" onClick={async () => { try { await reativar.mutateAsync({ leadId: a.leadId }); recarregar(); } catch (e) { erro(e); } }}>Reativar automação</Button>}
            {a.statusAtendimento !== "encerrado" && <Button size="sm" variant="ghost" className="text-gray-400" onClick={async () => { try { await encerrar.mutateAsync({ leadId: a.leadId }); recarregar(); } catch (e) { erro(e); } }}>Encerrar</Button>}
          </div>
          {decisao?.leadId === a.leadId && (
            <div className="space-y-2 rounded-md border border-[#C9A961]/30 p-3">
              <p className="font-medium">Registrar: {decisao.tipo}</p>
              {decisao.tipo === "pendente" && <Textarea className={inputCls} placeholder="Pendências (vão para o cliente)" value={decisao.pendencias} onChange={e => setDecisao({ ...decisao, pendencias: e.target.value })} />}
              {decisao.tipo === "reprovado" && <Textarea className={inputCls} placeholder="Motivo interno (fica só no CRM; o cliente recebe mensagem neutra)" value={decisao.motivo} onChange={e => setDecisao({ ...decisao, motivo: e.target.value })} />}
              <div className="flex gap-2">
                <Button size="sm" className="bg-[#C9A961] text-[#1A2332]" onClick={confirmar} disabled={decidir.isPending}>Confirmar</Button>
                <Button size="sm" variant="ghost" onClick={() => setDecisao(null)}>Cancelar</Button>
              </div>
            </div>
          )}
        </CardContent></Card>
      ))}
    </div>
  );
}

const linhas = (t: string) => t.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
const ids = (t: string) => linhas(t).map(Number).filter(n => Number.isInteger(n) && n > 0);

function Configuracoes() {
  const utils = trpc.useUtils();
  const q = trpc.centralVendas.configuracao.useQuery();
  const checklists = trpc.centralVendas.checklists.useQuery();
  const salvar = trpc.centralVendas.salvarConfiguracao.useMutation();
  const gerar = trpc.centralVendas.gerarToken.useMutation();
  const segredo = trpc.centralVendas.definirSegredo.useMutation();
  const rotina = trpc.centralVendas.executarRotina.useMutation();
  type Cfg = NonNullable<typeof q.data>["config"];
  const [c, setC] = useState<Cfg | null>(null);
  const [testes, setTestes] = useState("");
  const [lembretes, setLembretes] = useState("");
  const [token, setToken] = useState<{ nome: string; valor: string } | null>(null);
  const [segredos, setSegredos] = useState({ tokenLogycaEnvio: "", chaveAnthropic: "" });
  useEffect(() => {
    if (q.data && !c) { setC(q.data.config); setTestes(q.data.config.numerosTeste.join("\n")); setLembretes(q.data.config.lembretesDias.join(", ")); }
  }, [q.data, c]);
  if (!c || !q.data) return <p className="text-gray-400">Carregando…</p>;
  const set = (p: Partial<Cfg>) => setC({ ...c, ...p });
  const alternar = (lista: number[], id: number) => (lista.includes(id) ? lista.filter(x => x !== id) : [...lista, id]);
  async function gravar() {
    if (!c) return;
    try {
      const { segredosDefinidos: _s, ...resto } = c;
      await salvar.mutateAsync({ ...resto, numerosTeste: linhas(testes), lembretesDias: ids(lembretes) });
      toast.success("Configurações salvas."); utils.centralVendas.invalidate();
    } catch (e) { erro(e); }
  }
  const auto = c.automacoes;
  return (
    <div className="space-y-4">
      <Card className={cardCls}><CardHeader><CardTitle className="text-base">Interruptores</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-3"><Switch checked={c.ativo} onCheckedChange={v => set({ ativo: v })} /> Automações ligadas (geral)</label>
        <label className="flex items-center gap-3"><Switch checked={c.modoTeste} onCheckedChange={v => set({ modoTeste: v })} /> Modo de teste (só números autorizados)</label>
        {(Object.keys(auto) as (keyof typeof auto)[]).map(k => (
          <label key={k} className="flex items-center gap-3"><Switch checked={auto[k]} onCheckedChange={v => set({ automacoes: { ...auto, [k]: v } })} />
            {{ ia: "IA de atendimento", documentos: "Documentos", lembretes: "Lembretes", followup: "Follow-up", reativacao: "Reativação" }[k]}</label>
        ))}
        <div className="sm:col-span-2"><Label>Números autorizados no modo de teste (um por linha)</Label><Textarea className={inputCls} value={testes} onChange={e => setTestes(e.target.value)} /></div>
      </CardContent></Card>

      <Card className={cardCls}><CardHeader><CardTitle className="text-base">Equipe</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
        <p className="text-gray-300">Operadores recebem os atendimentos em rodízio. Analistas recebem a tarefa de análise e registram a decisão (o administrador também pode).</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {q.data.pessoas.map(p => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 rounded border border-[#C9A961]/20 p-2">
              <span className="min-w-32 flex-1">{p.nome ?? `Usuário #${p.id}`}</span>
              <label className="flex items-center gap-1"><input type="checkbox" checked={c.operadores.includes(p.id)} onChange={() => set({ operadores: alternar(c.operadores, p.id) })} /> Operador</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={c.analistas.includes(p.id)} onChange={() => set({ analistas: alternar(c.analistas, p.id) })} /> Analista</label>
            </div>
          ))}
        </div>
      </CardContent></Card>

      <Card className={cardCls}><CardHeader><CardTitle className="text-base">Horários, SLA e limites</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-3">
        <div><Label>Atendimento: início</Label><Input type="time" className={inputCls} value={c.horarioAtendimento.inicio} onChange={e => set({ horarioAtendimento: { ...c.horarioAtendimento, inicio: e.target.value } })} /></div>
        <div><Label>Atendimento: fim</Label><Input type="time" className={inputCls} value={c.horarioAtendimento.fim} onChange={e => set({ horarioAtendimento: { ...c.horarioAtendimento, fim: e.target.value } })} /></div>
        <div><Label>Dias de atendimento</Label>
          <div className="flex flex-wrap gap-1 pt-1 text-xs">{["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
            <label key={i} className="flex items-center gap-0.5"><input type="checkbox" checked={c.horarioAtendimento.dias.includes(i)} onChange={() => set({ horarioAtendimento: { ...c.horarioAtendimento, dias: alternar(c.horarioAtendimento.dias, i).sort() } })} />{d}</label>
          ))}</div></div>
        <div><Label>Envio automático: início</Label><Input type="time" className={inputCls} value={c.janelaEnvio.inicio} onChange={e => set({ janelaEnvio: { ...c.janelaEnvio, inicio: e.target.value } })} /></div>
        <div><Label>Envio automático: fim</Label><Input type="time" className={inputCls} value={c.janelaEnvio.fim} onChange={e => set({ janelaEnvio: { ...c.janelaEnvio, fim: e.target.value } })} /></div>
        <div><Label>SLA 1ª resposta humana (min)</Label><Input type="number" className={inputCls} value={c.slaMinutos} onChange={e => set({ slaMinutos: Number(e.target.value) })} /></div>
        <div><Label>Limite diário por número</Label><Input type="number" className={inputCls} value={c.limiteDiarioPorNumero} onChange={e => set({ limiteDiarioPorNumero: Number(e.target.value) })} /></div>
        <div><Label>Intervalo mínimo entre envios (s)</Label><Input type="number" className={inputCls} value={c.intervaloMinSeg} onChange={e => set({ intervaloMinSeg: Number(e.target.value) })} /></div>
        <div><Label>Intervalo máximo entre envios (s)</Label><Input type="number" className={inputCls} value={c.intervaloMaxSeg} onChange={e => set({ intervaloMaxSeg: Number(e.target.value) })} /></div>
        <div><Label>Limite mensal de tokens da IA</Label><Input type="number" className={inputCls} value={c.limiteMensalTokens} onChange={e => set({ limiteMensalTokens: Number(e.target.value) })} /></div>
        <div><Label>Modelo da IA</Label><Input className={inputCls} value={c.modeloIA} onChange={e => set({ modeloIA: e.target.value })} /></div>
        <div><Label>Confiança mínima da IA (0–1)</Label><Input type="number" step="0.05" className={inputCls} value={c.limiarConfianca} onChange={e => set({ limiarConfianca: Number(e.target.value) })} /></div>
        <div><Label>Lembretes de documentos (dias)</Label><Input className={inputCls} value={lembretes} onChange={e => setLembretes(e.target.value)} placeholder="1, 3, 7" /></div>
        <div><Label>Checklist padrão</Label><br />
          <select className={selectCls} value={c.checklistPadraoId ?? ""} onChange={e => set({ checklistPadraoId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Nenhum</option>{checklists.data?.map(k => <option key={k.id} value={k.id}>{k.nome}</option>)}
          </select></div>
        <div><Label>Número dos links de campanha</Label><Input className={inputCls} value={c.numeroCampanhas} placeholder={q.data.numeroConexao ?? "número conectado"} onChange={e => set({ numeroCampanhas: e.target.value })} /></div>
      </CardContent></Card>

      <Card className={cardCls}><CardHeader><CardTitle className="text-base">Entradas, Logyca e IA</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
        <p className="text-gray-300">Site: POST <code>/api/central-vendas/entrada/site</code> · Logyca (bloco HTTP Request): POST <code>/api/central-vendas/entrada/logyca</code>, ambos com <code>Authorization: Bearer &lt;token&gt;</code>.</p>
        <div className="flex flex-wrap gap-2">
          {(["tokenSite", "tokenLogycaEntrada"] as const).map(n => (
            <Button key={n} size="sm" variant="outline" className="border-[#C9A961]/40 bg-transparent text-white" onClick={async () => { try { const r = await gerar.mutateAsync({ nome: n }); setToken({ nome: n, valor: r.token }); utils.centralVendas.configuracao.invalidate(); } catch (e) { erro(e); } }}>
              {c.segredosDefinidos[n] ? "Trocar" : "Gerar"} token {n === "tokenSite" ? "do site" : "de entrada da Logyca"}
            </Button>
          ))}
        </div>
        {token && <p className="break-all rounded border border-amber-500/40 bg-amber-500/10 p-2 text-amber-100">Copie agora (não será mostrado de novo): <code>{token.valor}</code></p>}
        <label className="flex items-center gap-3"><Switch checked={c.logyca.ativo} onCheckedChange={v => set({ logyca: { ...c.logyca, ativo: v } })} /> Adaptador Logyca ligado</label>
        <label className="flex items-center gap-3"><Switch checked={c.logyca.usarParaEnvio} onCheckedChange={v => set({ logyca: { ...c.logyca, usarParaEnvio: v } })} /> Enviar mensagens pela Logyca (em vez da conexão QR code)</label>
        <div><Label>Endpoint de envio (menu "Mensagens API" da Logyca)</Label><Input className={inputCls} value={c.logyca.endpointEnvio} onChange={e => set({ logyca: { ...c.logyca, endpointEnvio: e.target.value } })} /></div>
        {(["tokenLogycaEnvio", "chaveAnthropic"] as const).map(n => (
          <div key={n} className="flex flex-wrap items-end gap-2">
            <div className="flex-1"><Label>{n === "tokenLogycaEnvio" ? "Token de envio da Logyca" : "Chave própria da IA (opcional; sem ela usa ANTHROPIC_API_KEY)"} {c.segredosDefinidos[n] ? "· definido" : "· não definido"}</Label>
              <Input type="password" autoComplete="off" className={inputCls} value={segredos[n]} onChange={e => setSegredos({ ...segredos, [n]: e.target.value })} /></div>
            <Button size="sm" variant="outline" className="border-[#C9A961]/40 bg-transparent text-white" onClick={async () => { try { await segredo.mutateAsync({ nome: n, valor: segredos[n] }); setSegredos({ ...segredos, [n]: "" }); toast.success("Guardado no cofre."); utils.centralVendas.configuracao.invalidate(); } catch (e) { erro(e); } }}>{segredos[n] ? "Guardar" : "Remover"}</Button>
          </div>
        ))}
      </CardContent></Card>

      <div className="flex flex-wrap gap-2">
        <Button className="bg-[#C9A961] text-[#1A2332]" onClick={gravar} disabled={salvar.isPending}><Save className="mr-2 h-4 w-4" />Salvar configurações</Button>
        <Button variant="outline" className="border-[#C9A961]/40 bg-transparent text-white" onClick={async () => { try { await rotina.mutateAsync(); toast.success("Rotina executada."); } catch (e) { erro(e); } }}><RefreshCw className="mr-2 h-4 w-4" />Executar rotina agora</Button>
      </div>
    </div>
  );
}

type ProdutoForm = { id?: number; nome: string; slug: string; tipo: "empreendimento" | "produto"; descricao: string; cidade: string; precoMin: string; precoMax: string; requisitos: string; condicoes: string; checklistId: string; ativo: boolean };
const produtoVazio: ProdutoForm = { nome: "", slug: "", tipo: "empreendimento", descricao: "", cidade: "", precoMin: "", precoMax: "", requisitos: "", condicoes: "", checklistId: "", ativo: true };

function Produtos() {
  const utils = trpc.useUtils();
  const q = trpc.centralVendas.produtos.useQuery();
  const checklists = trpc.centralVendas.checklists.useQuery();
  const salvar = trpc.centralVendas.salvarProduto.useMutation();
  const [f, setF] = useState<ProdutoForm | null>(null);
  const num = (v: string) => (v.trim() ? Number(v.replace(/\./g, "").replace(",", ".")) : null);
  async function gravar() {
    if (!f) return;
    try {
      await salvar.mutateAsync({ ...f, cidade: f.cidade || null, precoMin: num(f.precoMin), precoMax: num(f.precoMax), checklistId: f.checklistId ? Number(f.checklistId) : null });
      toast.success("Produto salvo."); setF(null); utils.centralVendas.produtos.invalidate();
    } catch (e) { erro(e); }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-300">A IA só fala o que estiver cadastrado aqui. Condições comerciais (parcelas, entrada etc.) só podem ser citadas se estiverem escritas no campo "Condições".</p>
      <Button size="sm" className="bg-[#C9A961] text-[#1A2332]" onClick={() => setF(produtoVazio)}><Plus className="mr-1 h-4 w-4" />Novo</Button>
      {f && (
        <Card className={cardCls}><CardContent className="grid gap-3 p-4 sm:grid-cols-2">
          <div><Label>Nome</Label><Input className={inputCls} value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} /></div>
          <div><Label>Código (usado nos links [ref:...])</Label><Input className={inputCls} value={f.slug} onChange={e => setF({ ...f, slug: e.target.value })} /></div>
          <div><Label>Tipo</Label><br /><select className={selectCls} value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value as ProdutoForm["tipo"] })}><option value="empreendimento">Empreendimento</option><option value="produto">Produto/modalidade</option></select></div>
          <div><Label>Cidade</Label><Input className={inputCls} value={f.cidade} onChange={e => setF({ ...f, cidade: e.target.value })} /></div>
          <div><Label>Preço mínimo (R$)</Label><Input className={inputCls} value={f.precoMin} onChange={e => setF({ ...f, precoMin: e.target.value })} /></div>
          <div><Label>Preço máximo (R$)</Label><Input className={inputCls} value={f.precoMax} onChange={e => setF({ ...f, precoMax: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label>Descrição</Label><Textarea className={inputCls} value={f.descricao} onChange={e => setF({ ...f, descricao: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label>Requisitos</Label><Textarea className={inputCls} value={f.requisitos} onChange={e => setF({ ...f, requisitos: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label>Condições comerciais cadastradas</Label><Textarea className={inputCls} value={f.condicoes} onChange={e => setF({ ...f, condicoes: e.target.value })} /></div>
          <div><Label>Checklist de documentos</Label><br /><select className={selectCls} value={f.checklistId} onChange={e => setF({ ...f, checklistId: e.target.value })}><option value="">Padrão da Central</option>{checklists.data?.map(k => <option key={k.id} value={k.id}>{k.nome}</option>)}</select></div>
          <label className="flex items-center gap-3"><Switch checked={f.ativo} onCheckedChange={v => setF({ ...f, ativo: v })} /> Ativo</label>
          <div className="flex gap-2 sm:col-span-2"><Button size="sm" className="bg-[#C9A961] text-[#1A2332]" onClick={gravar} disabled={salvar.isPending}>Salvar</Button><Button size="sm" variant="ghost" onClick={() => setF(null)}>Cancelar</Button></div>
        </CardContent></Card>
      )}
      {q.data?.map(p => (
        <Card key={p.id} className={cardCls}><CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <span><b>{p.nome}</b> <span className="text-gray-400">({p.slug}{p.cidade ? `, ${p.cidade}` : ""}){p.ativo ? "" : " · inativo"}</span></span>
          <Button size="sm" variant="outline" className="border-[#C9A961]/40 bg-transparent text-white" onClick={() => setF({ id: p.id, nome: p.nome, slug: p.slug, tipo: p.tipo as ProdutoForm["tipo"], descricao: p.descricao, cidade: p.cidade ?? "", precoMin: p.precoMin ?? "", precoMax: p.precoMax ?? "", requisitos: p.requisitos, condicoes: p.condicoes, checklistId: p.checklistId ? String(p.checklistId) : "", ativo: p.ativo })}>Editar</Button>
        </CardContent></Card>
      ))}
    </div>
  );
}

function Checklists() {
  const utils = trpc.useUtils();
  const q = trpc.centralVendas.checklists.useQuery();
  const salvar = trpc.centralVendas.salvarChecklist.useMutation();
  const [f, setF] = useState<{ id?: number; nome: string; itens: ItemChecklist[]; ativo: boolean } | null>(null);
  const novoItem = (): ItemChecklist => ({ chave: "", nome: "", tipo: "other", obrigatorio: true });
  async function gravar() {
    if (!f) return;
    try { await salvar.mutateAsync(f); toast.success("Checklist salvo."); setF(null); utils.centralVendas.checklists.invalidate(); } catch (e) { erro(e); }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-300">Documentos por produto ou modalidade (ex.: MCMV, ATC, SBPE). Nenhum documento é fixo no sistema: tudo vem daqui.</p>
      <Button size="sm" className="bg-[#C9A961] text-[#1A2332]" onClick={() => setF({ nome: "", itens: [novoItem()], ativo: true })}><Plus className="mr-1 h-4 w-4" />Novo checklist</Button>
      {f && (
        <Card className={cardCls}><CardContent className="space-y-3 p-4">
          <div><Label>Nome</Label><Input className={inputCls} value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} /></div>
          {f.itens.map((it, i) => {
            const mudar = (p: Partial<ItemChecklist>) => setF({ ...f, itens: f.itens.map((x, j) => (j === i ? { ...x, ...p } : x)) });
            return (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <div><Label className="text-xs">Chave</Label><Input className={`${inputCls} w-32`} value={it.chave} onChange={e => mudar({ chave: e.target.value.toLowerCase() })} /></div>
                <div className="flex-1"><Label className="text-xs">Nome para o cliente</Label><Input className={inputCls} value={it.nome} onChange={e => mudar({ nome: e.target.value })} /></div>
                <div><Label className="text-xs">Tipo no CRM</Label><br /><select className={selectCls} value={it.tipo} onChange={e => mudar({ tipo: e.target.value as ItemChecklist["tipo"] })}>{TIPOS_DOCUMENTO.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={it.obrigatorio} onChange={e => mudar({ obrigatorio: e.target.checked })} /> Obrigatório</label>
                <Button size="sm" variant="ghost" className="text-red-300" onClick={() => setF({ ...f, itens: f.itens.filter((_, j) => j !== i) })}>Remover</Button>
              </div>
            );
          })}
          <Button size="sm" variant="outline" className="border-[#C9A961]/40 bg-transparent text-white" onClick={() => setF({ ...f, itens: [...f.itens, novoItem()] })}><Plus className="mr-1 h-4 w-4" />Documento</Button>
          <label className="flex items-center gap-3"><Switch checked={f.ativo} onCheckedChange={v => setF({ ...f, ativo: v })} /> Ativo</label>
          <div className="flex gap-2"><Button size="sm" className="bg-[#C9A961] text-[#1A2332]" onClick={gravar} disabled={salvar.isPending}>Salvar</Button><Button size="sm" variant="ghost" onClick={() => setF(null)}>Cancelar</Button></div>
        </CardContent></Card>
      )}
      {q.data?.map(k => (
        <Card key={k.id} className={cardCls}><CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <span><b>{k.nome}</b> <span className="text-gray-400">· {k.itens.length} documento(s){k.ativo ? "" : " · inativo"}</span></span>
          <Button size="sm" variant="outline" className="border-[#C9A961]/40 bg-transparent text-white" onClick={() => setF({ id: k.id, nome: k.nome, itens: k.itens, ativo: k.ativo })}>Editar</Button>
        </CardContent></Card>
      ))}
    </div>
  );
}

function Sequencias() {
  const utils = trpc.useUtils();
  const q = trpc.centralVendas.sequencias.useQuery();
  const templates = trpc.centralVendas.templates.useQuery();
  const salvar = trpc.centralVendas.salvarSequencia.useMutation();
  const [f, setF] = useState<{ id?: number; tipo: TipoSequencia; nome: string; passos: PassoSequencia[]; ativo: boolean } | null>(null);
  async function gravar() {
    if (!f) return;
    try { await salvar.mutateAsync(f); toast.success("Sequência salva."); setF(null); utils.centralVendas.sequencias.invalidate(); } catch (e) { erro(e); }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-300">Envios só entre o horário de envio configurado, respeitando opt-out (SAIR/PARAR), limite diário e modo de teste.</p>
      <Button size="sm" className="bg-[#C9A961] text-[#1A2332]" onClick={() => setF({ tipo: "reativacao", nome: "", passos: [{ aposDias: 30, templateSlug: "cv-reativacao" }], ativo: true })}><Plus className="mr-1 h-4 w-4" />Nova sequência</Button>
      {f && (
        <Card className={cardCls}><CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap gap-3">
            <div><Label>Tipo</Label><br /><select className={selectCls} value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value as TipoSequencia })}>{TIPOS_SEQUENCIA.map(t => <option key={t} value={t}>{ROTULOS_SEQUENCIA[t]}</option>)}</select></div>
            <div className="flex-1"><Label>Nome</Label><Input className={inputCls} value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} /></div>
          </div>
          {f.passos.map((p, i) => {
            const mudar = (x: Partial<PassoSequencia>) => setF({ ...f, passos: f.passos.map((y, j) => (j === i ? { ...y, ...x } : y)) });
            return (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <div><Label className="text-xs">Após (dias)</Label><Input type="number" className={`${inputCls} w-24`} value={p.aposDias} onChange={e => mudar({ aposDias: Number(e.target.value) })} /></div>
                <div><Label className="text-xs">Template</Label><br /><select className={selectCls} value={p.templateSlug} onChange={e => mudar({ templateSlug: e.target.value })}>{templates.data?.map(t => <option key={t.slug} value={t.slug}>{t.nome}</option>)}</select></div>
                <Button size="sm" variant="ghost" className="text-red-300" onClick={() => setF({ ...f, passos: f.passos.filter((_, j) => j !== i) })}>Remover</Button>
              </div>
            );
          })}
          <Button size="sm" variant="outline" className="border-[#C9A961]/40 bg-transparent text-white" onClick={() => setF({ ...f, passos: [...f.passos, { aposDias: 1, templateSlug: "cv-sem-resposta" }] })}><Plus className="mr-1 h-4 w-4" />Passo</Button>
          <label className="flex items-center gap-3"><Switch checked={f.ativo} onCheckedChange={v => setF({ ...f, ativo: v })} /> Ativa</label>
          <div className="flex gap-2"><Button size="sm" className="bg-[#C9A961] text-[#1A2332]" onClick={gravar} disabled={salvar.isPending}>Salvar</Button><Button size="sm" variant="ghost" onClick={() => setF(null)}>Cancelar</Button></div>
        </CardContent></Card>
      )}
      {q.data?.map(s => (
        <Card key={s.id} className={cardCls}><CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <span><b>{s.nome}</b> <span className="text-gray-400">· {ROTULOS_SEQUENCIA[s.tipo as TipoSequencia] ?? s.tipo} · {s.passosLista.map(p => `D+${p.aposDias}`).join(", ")}{s.ativo ? "" : " · inativa"}</span></span>
          <Button size="sm" variant="outline" className="border-[#C9A961]/40 bg-transparent text-white" onClick={() => setF({ id: s.id, tipo: s.tipo as TipoSequencia, nome: s.nome, passos: s.passosLista, ativo: s.ativo })}>Editar</Button>
        </CardContent></Card>
      ))}
    </div>
  );
}

function Campanhas() {
  const utils = trpc.useUtils();
  const q = trpc.centralVendas.campanhas.useQuery();
  const produtos = trpc.centralVendas.produtos.useQuery();
  const criar = trpc.centralVendas.criarCampanha.useMutation();
  const [f, setF] = useState({ canal: "instagram", nome: "", produtoId: "" });
  async function gravar() {
    try { const r = await criar.mutateAsync({ canal: f.canal, nome: f.nome || f.canal, produtoId: f.produtoId ? Number(f.produtoId) : null }); toast.success(`Campanha ${r.codigo} criada.`); utils.centralVendas.campanhas.invalidate(); } catch (e) { erro(e); }
  }
  return (
    <div className="space-y-3">
      <Card className={cardCls}><CardContent className="flex flex-wrap items-end gap-3 p-4">
        <div><Label>Canal</Label><Input className={inputCls} value={f.canal} onChange={e => setF({ ...f, canal: e.target.value })} /></div>
        <div><Label>Nome</Label><Input className={inputCls} value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} /></div>
        <div><Label>Empreendimento/produto</Label><br /><select className={selectCls} value={f.produtoId} onChange={e => setF({ ...f, produtoId: e.target.value })}><option value="">Nenhum</option>{produtos.data?.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></div>
        <Button className="bg-[#C9A961] text-[#1A2332]" onClick={gravar} disabled={criar.isPending}>Gerar link</Button>
      </CardContent></Card>
      {!q.data?.numero && <p className="text-sm text-amber-200">Conecte o WhatsApp (QR code) ou informe o número dos links em Configurações para gerar os links.</p>}
      {q.data?.campanhas.map(k => (
        <Card key={k.id} className={cardCls}><CardContent className="space-y-1 p-3 text-sm">
          <p><b>{k.nome}</b> <span className="text-gray-400">· {k.canal} · [ref:{k.codigo}]</span></p>
          {k.link && <div className="flex flex-wrap items-center gap-2"><code className="break-all text-xs text-gray-300">{k.link}</code>
            <Button size="sm" variant="outline" className="border-[#C9A961]/40 bg-transparent text-white" onClick={() => { navigator.clipboard?.writeText(k.link!); toast.success("Link copiado."); }}>Copiar</Button></div>}
        </CardContent></Card>
      ))}
    </div>
  );
}

function Templates() {
  const utils = trpc.useUtils();
  const q = trpc.centralVendas.templates.useQuery();
  const salvar = trpc.centralVendas.salvarTemplate.useMutation();
  const [edit, setEdit] = useState<Record<string, string>>({});
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-300">Textos automáticos (guardados nos templates do WhatsApp). Variáveis: {"{{nome}}"} (primeiro nome), {"{{documentos}}"} (pendentes ou pendências do analista), {"{{corretor}}"} (operador).</p>
      {q.data?.map(t => (
        <Card key={t.slug} className={cardCls}><CardContent className="space-y-2 p-3 text-sm">
          <p><b>{t.nome}</b> <span className="text-gray-400">· {t.slug}{t.personalizado ? " · personalizado" : " · padrão"}</span></p>
          <Textarea className={inputCls} value={edit[t.slug] ?? t.conteudo} onChange={e => setEdit({ ...edit, [t.slug]: e.target.value })} />
          {edit[t.slug] !== undefined && edit[t.slug] !== t.conteudo && (
            <Button size="sm" className="bg-[#C9A961] text-[#1A2332]" onClick={async () => { try { await salvar.mutateAsync({ slug: t.slug, conteudo: edit[t.slug] }); toast.success("Template salvo."); utils.centralVendas.templates.invalidate(); } catch (e) { erro(e); } }}>Salvar</Button>
          )}
        </CardContent></Card>
      ))}
    </div>
  );
}

function Auditoria() {
  const utils = trpc.useUtils();
  const q = trpc.centralVendas.auditoria.useQuery({});
  const reprocessar = trpc.centralVendas.reprocessar.useMutation();
  const data = (d: Date | string) => new Date(d).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className={cardCls}><CardHeader><CardTitle className="text-base">Fila de envio e reprocessamento</CardTitle></CardHeader><CardContent className="space-y-1 text-xs">
        {q.data?.fila.length ? q.data.fila.map(j => (
          <div key={j.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 py-1">
            <span>#{j.id} {j.tipo}{j.proativa ? " (proativa)" : ""} · lead {j.leadId ?? "—"} · {j.status} · {j.tentativas} tentativa(s){j.erro ? ` · ${j.erro}` : ""}</span>
            {(j.status === "falhou" || j.status === "incerto") && (
              <Button size="sm" variant="outline" className="h-7 border-[#C9A961]/40 bg-transparent text-white" onClick={async () => {
                if (j.status === "incerto" && !window.confirm("Este envio pode já ter saído. Reenviar mesmo assim?")) return;
                try { await reprocessar.mutateAsync({ id: j.id }); utils.centralVendas.auditoria.invalidate(); } catch (e) { erro(e); }
              }}>Reprocessar</Button>
            )}
          </div>
        )) : <p className="text-gray-400">{SEM}</p>}
      </CardContent></Card>
      <Card className={cardCls}><CardHeader><CardTitle className="text-base">Eventos (auditoria)</CardTitle></CardHeader><CardContent className="space-y-1 text-xs">
        {q.data?.eventos.length ? q.data.eventos.map(e => (
          <div key={e.id} className="border-b border-white/5 py-1">
            <span className="text-gray-400">{data(e.createdAt)}</span> · <b>{e.tipo}</b> · lead {e.leadId ?? "—"} · {e.origem} · {e.resultado}{e.erro ? ` · ${e.erro}` : ""}
          </div>
        )) : <p className="text-gray-400">{SEM}</p>}
      </CardContent></Card>
    </div>
  );
}
