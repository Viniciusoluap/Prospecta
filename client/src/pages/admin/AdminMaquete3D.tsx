// Maquete 3D (EPIC-022, S-04) — painel do módulo: pedidos, novo pedido a partir de um projeto ou de um estudo de
// incorporação, preços padrão (só admin) e, em cada pedido, liberação/autorização, leitura do PDF e revisão da planta.
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { ArrowLeft, Box, Check, Copy, Eye, Globe, Play, Plus, RefreshCw, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { EditorPlanta } from "@/components/maquete-3d/EditorPlanta";

const Visualizador = lazy(() => import("@/components/maquete-3d/visualizador/Visualizador"));
import { ROTULOS_TIPO, TIPOS_MAQUETE, type ModeloMaquete, type TipoMaquete } from "@shared/maquete-3d/modelo";
import {
  ESFORCOS_IA, FAIXAS_PRECO, MAX_DOCUMENTOS, ROTULOS_FAIXA, ROTULOS_STATUS, type DocumentoMaquete, type FaixaPreco,
  type OrigemMaquete, type StatusMaquete,
} from "@shared/maquete-3d/regras";

const cardCls = "bg-[#2C3E50] border-[#C9A961]/20 text-white";
const inputCls = "h-9 w-full rounded-md border border-[#C9A961]/30 bg-[#1A2332] px-2 text-sm text-white";
const btnOutline = "border-[#C9A961]/30 bg-transparent text-gray-200";
const btnOuro = "bg-[#C9A961] text-[#1A2332] hover:bg-[#C9A961]/90";
const reais = (v: number | null) => (v === null ? "Sem cobrança" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const dataHora = (d: Date | string | null) => (d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
const falha = (e: unknown) => toast.error(e instanceof Error ? e.message : "Não foi possível concluir.");
const ROTULOS_ESFORCO: Record<(typeof ESFORCOS_IA)[number], string> = { low: "Rápida", medium: "Equilibrada", high: "Mais cuidadosa (mais lenta)" };
const COR_STATUS: Record<StatusMaquete, string> = {
  aguardando_pagamento: "bg-amber-500/20 text-amber-300", aguardando_autorizacao: "bg-amber-500/20 text-amber-300",
  liberada: "bg-sky-500/20 text-sky-300", em_leitura: "bg-sky-500/20 text-sky-300", em_revisao: "bg-violet-500/20 text-violet-300",
  validada: "bg-emerald-500/20 text-emerald-300", publicada: "bg-emerald-500/20 text-emerald-300", recusada: "bg-red-500/20 text-red-300",
};
const Selo = ({ status }: { status: StatusMaquete }) => <span className={`rounded-full px-2 py-0.5 text-xs ${COR_STATUS[status]}`}>{ROTULOS_STATUS[status]}</span>;

/** Prévia em 3D para a equipe (a mesma tela do cliente), com a planta salva. */
function Previa3D({ id }: { id: number }) {
  const [, ir] = useLocation();
  const detalhe = trpc.maquete3d.detalhe.useQuery({ id }, { refetchOnWindowFocus: false });
  const d = detalhe.data;
  if (detalhe.isLoading) return <p className="min-h-screen bg-[#0B1022] p-6 text-sm text-gray-300">Carregando…</p>;
  if (!d?.modelo) return <p className="min-h-screen bg-[#0B1022] p-6 text-sm text-gray-300">Esta maquete ainda não tem planta lida.</p>;
  return (
    <Suspense fallback={<p className="min-h-screen bg-[#0B1022] p-6 text-sm text-gray-300">Preparando o 3D…</p>}>
      <Visualizador modelo={d.modelo} aoSair={() => ir(`/admin/maquete-3d/${id}`)}
        comercial={{ nome: d.comercial.nome || d.titulo, logo: "/logo.webp", localizacao: d.comercial.localizacao || null, preco: d.comercial.preco, whatsapp: d.comercial.whatsapp || null }} />
    </Suspense>
  );
}

export default function AdminMaquete3D() {
  const [, params] = useRoute("/admin/maquete-3d/:id");
  const [, previa] = useRoute("/admin/maquete-3d/:id/3d");
  const id = params?.id ? Number(params.id) : null;
  if (previa?.id) return <Previa3D id={Number(previa.id)} />;
  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <header className="border-b border-[#C9A961]/20 bg-[#0F1923] px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
          <Link href={id ? "/admin/maquete-3d" : "/admin"}><Button variant="ghost" size="icon" className="text-gray-400 hover:text-white" aria-label="Voltar"><ArrowLeft className="h-5 w-5" /></Button></Link>
          <Box className="h-6 w-6 text-[#C9A961]" />
          <h1 className="text-2xl font-bold text-[#C9A961]">Maquete 3D</h1>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        {id ? <Detalhe id={id} /> : <Lista />}
      </main>
    </div>
  );
}

// ── Lista, novo pedido e preços ──

function Lista() {
  const { user } = useAuth();
  const admin = user?.role === "admin";
  const lista = trpc.maquete3d.listar.useQuery({});
  const [novo, setNovo] = useState(false);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-300">Converte o projeto em PDF em uma maquete 3D navegável. Projeto de cliente é pago; Incorporação precisa da autorização do administrador.</p>
        <Button className={btnOuro} onClick={() => setNovo(v => !v)}><Plus className="mr-1 h-4 w-4" />Novo pedido</Button>
      </div>
      {novo && <NovoPedido admin={admin} aoFechar={() => setNovo(false)} />}
      <Card className={cardCls}>
        <CardHeader><CardTitle className="text-lg">Pedidos</CardTitle></CardHeader>
        <CardContent>
          {lista.isLoading ? <p className="text-sm text-gray-400">Carregando…</p> : lista.error ? <p className="text-sm text-red-300">{lista.error.message}</p> : !lista.data?.length ? (
            <p className="text-sm text-gray-400">Nenhuma maquete pedida ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-gray-400"><tr><th className="py-2 pr-3">Maquete</th><th className="pr-3">Origem</th><th className="pr-3">Tipo</th><th className="pr-3">Valor</th><th className="pr-3">Situação</th><th className="pr-3">Criada em</th></tr></thead>
                <tbody>
                  {lista.data.map(m => (
                    <tr key={m.id} className="border-t border-[#C9A961]/10">
                      <td className="py-2 pr-3"><Link href={`/admin/maquete-3d/${m.id}`} className="font-medium text-[#C9A961] hover:underline">{m.titulo}</Link>
                        {m.resumo && <span className="block text-xs text-gray-400">{m.resumo.areaTotal.toLocaleString("pt-BR")} m² · {m.resumo.pavimentos} pav. · {m.resumo.quartos} quarto(s)</span>}</td>
                      <td className="pr-3">{m.origem === "projeto" ? "Projeto" : "Incorporação"}<span className="block text-xs text-gray-400">{m.alvo}{m.cliente ? ` · ${m.cliente}` : ""}</span></td>
                      <td className="pr-3">{ROTULOS_TIPO[m.tipo as TipoMaquete]}</td>
                      <td className="pr-3">{reais(m.preco)}</td>
                      <td className="pr-3"><Selo status={m.status} /></td>
                      <td className="pr-3 text-gray-300">{dataHora(m.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <Configuracoes admin={admin} />
    </>
  );
}

function EscolhaDocumentos({ origem, alvoId, escolhidos, onChange }: { origem: OrigemMaquete; alvoId: number; escolhidos: DocumentoMaquete[]; onChange: (d: DocumentoMaquete[]) => void }) {
  const docs = trpc.maquete3d.documentosDisponiveis.useQuery({ origem, alvoId });
  if (docs.isLoading) return <p className="text-sm text-gray-400">Carregando arquivos…</p>;
  if (!docs.data?.length) return <p className="text-sm text-amber-300">Nenhum PDF ativo neste {origem === "projeto" ? "projeto" : "estudo"}. Envie o projeto em PDF pelo módulo {origem === "projeto" ? "Projetos" : "Incorporação"} e volte aqui.</p>;
  return (
    <div className="space-y-1">
      {docs.data.map(d => {
        const marcado = escolhidos.some(e => e.id === d.id);
        return (
          <label key={d.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={marcado} disabled={!marcado && escolhidos.length >= MAX_DOCUMENTOS}
              onChange={e => onChange(e.target.checked ? [...escolhidos, d] : escolhidos.filter(x => x.id !== d.id))} />{d.nome}
          </label>
        );
      })}
      <p className="text-xs text-gray-400">Marque as plantas baixas de todos os pavimentos, os cortes (de onde vem o pé-direito) e, se houver, a implantação. Até {MAX_DOCUMENTOS} arquivos.</p>
    </div>
  );
}

function NovoPedido({ admin, aoFechar }: { admin: boolean; aoFechar: () => void }) {
  const [, ir] = useLocation();
  const opcoes = trpc.maquete3d.opcoes.useQuery();
  const config = trpc.maquete3d.config.useQuery();
  const utils = trpc.useUtils();
  const [origem, setOrigem] = useState<OrigemMaquete>("projeto");
  const [alvoId, setAlvoId] = useState<number | null>(null);
  const [tipo, setTipo] = useState<TipoMaquete>("casa");
  const [faixa, setFaixa] = useState<FaixaPreco>("terrea_ate_70");
  const [preco, setPreco] = useState<string>("");
  const [documentos, setDocumentos] = useState<DocumentoMaquete[]>([]);
  const criar = trpc.maquete3d.criar.useMutation({
    onSuccess: r => { utils.maquete3d.listar.invalidate(); toast.success("Pedido criado."); ir(`/admin/maquete-3d/${r.id}`); },
    onError: falha,
  });
  const padrao = config.data?.precos[faixa] ?? null;
  const alvos = origem === "projeto" ? opcoes.data?.projetos.map(p => ({ id: p.id, rotulo: `${p.nome} — ${p.cliente}` })) : opcoes.data?.estudos.map(e => ({ id: e.id, rotulo: `${e.nome} — ${e.cidade}` }));
  const trocarOrigem = (o: OrigemMaquete) => { setOrigem(o); setAlvoId(null); setDocumentos([]); setTipo(o === "projeto" ? "casa" : "loteamento"); };

  return (
    <Card className={cardCls}>
      <CardHeader><CardTitle className="text-lg">Novo pedido de maquete</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-gray-300">Origem
            <select className={inputCls} value={origem} onChange={e => trocarOrigem(e.target.value as OrigemMaquete)}>
              <option value="projeto">Projeto de cliente (pago)</option><option value="incorporacao">Incorporação (sem cobrança)</option>
            </select></label>
          <label className="text-xs text-gray-300 sm:col-span-2">{origem === "projeto" ? "Projeto" : "Estudo de incorporação"}
            <select className={inputCls} value={alvoId ?? ""} onChange={e => { setAlvoId(e.target.value ? Number(e.target.value) : null); setDocumentos([]); }}>
              <option value="">— escolher —</option>{alvos?.map(a => <option key={a.id} value={a.id}>{a.rotulo}</option>)}
            </select></label>
          <label className="text-xs text-gray-300">Tipo de maquete
            <select className={inputCls} value={tipo} onChange={e => setTipo(e.target.value as TipoMaquete)}>
              {TIPOS_MAQUETE.map(t => <option key={t} value={t}>{ROTULOS_TIPO[t]}</option>)}
            </select></label>
          {origem === "projeto" && (
            <>
              <label className="text-xs text-gray-300">Faixa de preço
                <select className={inputCls} value={faixa} onChange={e => { setFaixa(e.target.value as FaixaPreco); setPreco(""); }}>
                  {FAIXAS_PRECO.map(f => <option key={f} value={f}>{ROTULOS_FAIXA[f]}</option>)}
                </select></label>
              <label className="text-xs text-gray-300">Valor (R$){admin ? "" : " — padrão da faixa"}
                <input className={inputCls} type="number" min={0} step="0.01" disabled={!admin} placeholder={padrao?.toFixed(2) ?? ""} value={preco} onChange={e => setPreco(e.target.value)} /></label>
            </>
          )}
        </div>
        {origem === "incorporacao" && <p className="text-sm text-amber-300">Maquete de Incorporação não tem cobrança, mas só é gerada depois que o administrador autorizar.</p>}
        {alvoId && <div><p className="mb-1 text-sm font-semibold">PDFs do projeto para a leitura</p><EscolhaDocumentos origem={origem} alvoId={alvoId} escolhidos={documentos} onChange={setDocumentos} /></div>}
        <div className="flex gap-2">
          <Button className={btnOuro} disabled={!alvoId || criar.isPending}
            onClick={() => criar.mutate({ origem, alvoId: alvoId!, tipo, documentos, ...(origem === "projeto" ? { faixaPreco: faixa, ...(preco !== "" && admin ? { preco: Number(preco) } : {}) } : {}) })}>Criar pedido</Button>
          <Button variant="outline" className={btnOutline} onClick={aoFechar}>Cancelar</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Configuracoes({ admin }: { admin: boolean }) {
  const config = trpc.maquete3d.config.useQuery();
  const utils = trpc.useUtils();
  const [form, setForm] = useState<typeof config.data | null>(null);
  useEffect(() => { if (config.data) setForm(config.data); }, [config.data]);
  const salvar = trpc.maquete3d.salvarConfig.useMutation({ onSuccess: () => { utils.maquete3d.config.invalidate(); toast.success("Configurações salvas."); }, onError: falha });
  if (!form) return null;
  return (
    <Card className={cardCls}>
      <CardHeader><CardTitle className="text-lg">Preços padrão e leitura</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {FAIXAS_PRECO.map(f => (
            <label key={f} className="text-xs text-gray-300">{ROTULOS_FAIXA[f]} (R$)
              <input className={inputCls} type="number" min={0} step="0.01" disabled={!admin} value={form.precos[f]}
                onChange={e => setForm({ ...form, precos: { ...form.precos, [f]: Number(e.target.value) || 0 } })} /></label>
          ))}
        </div>
        {admin && (
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs text-gray-300">Leitura do projeto pela IA
              <select className={inputCls} value={form.esforcoIA} onChange={e => setForm({ ...form, esforcoIA: e.target.value as (typeof ESFORCOS_IA)[number] })}>
                {ESFORCOS_IA.map(x => <option key={x} value={x}>{ROTULOS_ESFORCO[x]}</option>)}
              </select></label>
            <label className="text-xs text-gray-300">Modelo da IA
              <input className={inputCls} value={form.modeloIA} onChange={e => setForm({ ...form, modeloIA: e.target.value })} /></label>
          </div>
        )}
        {!form.iaConfigurada && <p className="text-sm text-amber-300">A chave da IA (ANTHROPIC_API_KEY) não está configurada no servidor: a leitura dos PDFs não vai funcionar até ela ser cadastrada.</p>}
        {admin ? <Button className={btnOuro} disabled={salvar.isPending} onClick={() => salvar.mutate({ precos: form.precos, modeloIA: form.modeloIA, esforcoIA: form.esforcoIA })}><Save className="mr-1 h-4 w-4" />Salvar</Button>
          : <p className="text-xs text-gray-400">Só o administrador altera os preços.</p>}
      </CardContent>
    </Card>
  );
}

// ── Pedido: liberação, leitura e revisão ──

function Detalhe({ id }: { id: number }) {
  const { user } = useAuth();
  const admin = user?.role === "admin";
  const [, ir] = useLocation();
  const utils = trpc.useUtils();
  const detalhe = trpc.maquete3d.detalhe.useQuery({ id });
  const recarregar = () => { utils.maquete3d.detalhe.invalidate({ id }); utils.maquete3d.listar.invalidate(); };
  const d = detalhe.data;

  const [nota, setNota] = useState("");
  const [motivo, setMotivo] = useState("");
  const [recusando, setRecusando] = useState(false);
  const [trocandoDocs, setTrocandoDocs] = useState<DocumentoMaquete[] | null>(null);
  const liberar = trpc.maquete3d.liberar.useMutation({ onSuccess: () => { toast.success("Liberada."); recarregar(); }, onError: falha });
  const recusar = trpc.maquete3d.recusar.useMutation({ onSuccess: () => { toast.success("Pedido recusado."); setRecusando(false); recarregar(); }, onError: falha });
  const excluir = trpc.maquete3d.excluir.useMutation({ onSuccess: () => { utils.maquete3d.listar.invalidate(); ir("/admin/maquete-3d"); }, onError: falha });
  const definirDocs = trpc.maquete3d.definirDocumentos.useMutation({ onSuccess: () => { setTrocandoDocs(null); recarregar(); }, onError: falha });

  // Leitura: a tela chama um passo por vez até acabar ou até um passo falhar.
  const iniciar = trpc.maquete3d.iniciarLeitura.useMutation();
  const avancar = trpc.maquete3d.avancarLeitura.useMutation();
  const [lendo, setLendo] = useState(false);
  const parar = useRef(false);
  useEffect(() => () => { parar.current = true; }, []);
  async function ler(doInicio: boolean) {
    setLendo(true);
    try {
      if (doInicio) await iniciar.mutateAsync({ id });
      for (;;) {
        const r = await avancar.mutateAsync({ id });
        await utils.maquete3d.detalhe.invalidate({ id });
        if (parar.current) return;
        if (r.erro) { toast.error(r.erro); break; }
        if (!r.proximo) { toast.success("Leitura concluída. Confira a planta."); break; }
      }
    } catch (e) { falha(e); } finally { setLendo(false); recarregar(); }
  }

  // Revisão: rascunho local até salvar.
  const [rascunho, setRascunho] = useState<ModeloMaquete | null>(null);
  const [versao, setVersao] = useState(0);
  const [sujo, setSujo] = useState(false);
  useEffect(() => { if (d && !sujo) { setRascunho(d.modelo); setVersao(d.modeloVersao); } }, [d, sujo]);
  const salvar = trpc.maquete3d.salvarModelo.useMutation({ onSuccess: r => { setVersao(r.versao); setSujo(false); toast.success("Planta salva."); recarregar(); }, onError: falha });
  const validar = trpc.maquete3d.validar.useMutation({ onSuccess: () => { toast.success("Planta validada."); recarregar(); }, onError: falha });

  // Visualizador 3D, apresentação comercial e publicação do link.
  const [comercial, setComercial] = useState<{ nome: string; localizacao: string; preco: string; whatsapp: string } | null>(null);
  useEffect(() => { if (d && !comercial) setComercial({ nome: d.comercial.nome, localizacao: d.comercial.localizacao, preco: d.comercial.preco === null ? "" : String(d.comercial.preco), whatsapp: d.comercial.whatsapp }); }, [d, comercial]);
  const salvarComercial = trpc.maquete3d.salvarComercial.useMutation({ onSuccess: () => { toast.success("Apresentação salva."); recarregar(); }, onError: falha });
  const publicar = trpc.maquete3d.publicar.useMutation({ onSuccess: () => { toast.success("Maquete publicada. O link já abre para o cliente."); recarregar(); }, onError: falha });
  const despublicar = trpc.maquete3d.despublicar.useMutation({ onSuccess: () => { toast.success("Link tirado do ar."); recarregar(); }, onError: falha });

  if (detalhe.isLoading) return <p className="text-sm text-gray-400">Carregando…</p>;
  if (!d) return <p className="text-sm text-red-300">{detalhe.error?.message ?? "Maquete não encontrada."}</p>;

  const aguardando = d.status === "aguardando_pagamento" || d.status === "aguardando_autorizacao";
  const podeLer = ["liberada", "em_leitura", "em_revisao", "validada"].includes(d.status);
  const podeRevisar = d.status === "em_revisao" || d.status === "validada";
  const erros = d.problemas.filter(p => p.nivel === "erro"), avisos = d.problemas.filter(p => p.nivel === "aviso");
  const alvoId = (d.projectId ?? d.studyId)!;

  const link = `${window.location.origin}/maquete/${d.token}`;

  return (
    <>
      <Card className={cardCls}>
        <CardHeader><CardTitle className="flex flex-wrap items-center gap-3 text-lg">{d.titulo}<Selo status={d.status} /></CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid gap-2 sm:grid-cols-4">
            <p><span className="block text-xs text-gray-400">Origem</span>{d.origem === "projeto" ? "Projeto de cliente" : "Incorporação"}</p>
            <p><span className="block text-xs text-gray-400">Tipo</span>{ROTULOS_TIPO[d.tipo as TipoMaquete]}</p>
            <p><span className="block text-xs text-gray-400">Valor</span>{reais(d.preco)}{d.faixaPreco ? ` · ${ROTULOS_FAIXA[d.faixaPreco as FaixaPreco]}` : ""}</p>
            <p><span className="block text-xs text-gray-400">{d.origem === "projeto" ? "Pagamento confirmado" : "Autorizada"}</span>{d.liberadoEm ? `${dataHora(d.liberadoEm)}${d.liberadoPorNome ? ` · ${d.liberadoPorNome}` : ""}` : "—"}</p>
          </div>
          {d.liberacaoNota && <p className="text-xs text-gray-300">Nota: {d.liberacaoNota}</p>}
          {d.recusaMotivo && <p className="text-red-300">Recusada: {d.recusaMotivo}</p>}

          <div>
            <p className="mb-1 font-semibold">PDFs da leitura</p>
            {trocandoDocs ? (
              <div className="space-y-2">
                <EscolhaDocumentos origem={d.origem} alvoId={alvoId} escolhidos={trocandoDocs} onChange={setTrocandoDocs} />
                <div className="flex gap-2">
                  <Button size="sm" className={btnOuro} disabled={!trocandoDocs.length || definirDocs.isPending} onClick={() => definirDocs.mutate({ id, documentos: trocandoDocs })}>Salvar arquivos</Button>
                  <Button size="sm" variant="outline" className={btnOutline} onClick={() => setTrocandoDocs(null)}>Cancelar</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <span className={d.documentos.length ? "" : "text-amber-300"}>{d.documentos.length ? d.documentos.map(x => x.nome).join(", ") : "Nenhum PDF escolhido."}</span>
                {!["em_leitura", "publicada", "recusada"].includes(d.status) && !lendo && <Button size="sm" variant="outline" className={btnOutline} onClick={() => setTrocandoDocs(d.documentos)}>Escolher arquivos</Button>}
              </div>
            )}
          </div>

          {aguardando && (
            <div className="space-y-2 rounded-lg border border-amber-400/30 p-3">
              {d.origem === "projeto"
                ? <p>Aguardando o pagamento do cliente. Quando ele paga pelo portal (Asaas), o pedido é liberado sozinho. Se o pagamento foi recebido por fora, o administrador confirma aqui.</p>
                : <p>Maquete de Incorporação: precisa da autorização do administrador para ser gerada.</p>}
              {admin ? (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="min-w-[240px] flex-1 text-xs text-gray-300">{d.origem === "projeto" ? "Como o pagamento foi confirmado (obrigatório)" : "Observação (opcional)"}
                    <input className={inputCls} value={nota} maxLength={400} onChange={e => setNota(e.target.value)} placeholder={d.origem === "projeto" ? "Ex.: PIX recebido em 14/11" : ""} /></label>
                  <Button className={btnOuro} disabled={liberar.isPending} onClick={() => liberar.mutate({ id, nota })}><Check className="mr-1 h-4 w-4" />{d.origem === "projeto" ? "Confirmar pagamento e liberar" : "Autorizar"}</Button>
                </div>
              ) : <p className="text-xs text-gray-400">Só o administrador pode {d.origem === "projeto" ? "confirmar o pagamento" : "autorizar"}.</p>}
            </div>
          )}

          {admin && !["publicada", "recusada"].includes(d.status) && (
            recusando ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[240px] flex-1 text-xs text-gray-300">Motivo da recusa
                  <input className={inputCls} value={motivo} maxLength={400} onChange={e => setMotivo(e.target.value)} /></label>
                <Button variant="outline" className="border-red-400/50 bg-transparent text-red-300" disabled={motivo.trim().length < 5 || recusar.isPending} onClick={() => recusar.mutate({ id, motivo })}>Confirmar recusa</Button>
                <Button variant="outline" className={btnOutline} onClick={() => setRecusando(false)}>Cancelar</Button>
              </div>
            ) : <Button size="sm" variant="outline" className="border-red-400/50 bg-transparent text-red-300" onClick={() => setRecusando(true)}><X className="mr-1 h-4 w-4" />Recusar pedido</Button>
          )}
          {admin && d.status === "recusada" && <Button size="sm" variant="outline" className="border-red-400/50 bg-transparent text-red-300" disabled={excluir.isPending}
            onClick={() => { if (window.confirm("Excluir este pedido de maquete?")) excluir.mutate({ id }); }}>Excluir pedido</Button>}
        </CardContent>
      </Card>

      {podeLer && (
        <Card className={cardCls}>
          <CardHeader><CardTitle className="text-lg">Leitura do projeto</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {d.progresso.total > 0 && (
              <>
                <div className="h-2 overflow-hidden rounded-full bg-[#1A2332]"><div className="h-full bg-[#C9A961] transition-all" style={{ width: `${(d.progresso.feitos / d.progresso.total) * 100}%` }} /></div>
                <ul className="space-y-1">
                  {d.passos.map(p => (
                    <li key={p.chave} className="flex flex-wrap gap-2">
                      <span className={p.estado === "feito" ? "text-emerald-400" : p.estado === "erro" ? "text-red-300" : "text-gray-400"}>{p.estado === "feito" ? "✓" : p.estado === "erro" ? "✕" : "○"}</span>
                      <span>{p.rotulo}</span>{p.erro && <span className="text-red-300">— {p.erro}</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {d.status === "liberada" && <Button className={btnOuro} disabled={lendo || !d.documentos.length} onClick={() => ler(true)}><Play className="mr-1 h-4 w-4" />Gerar maquete (ler o projeto)</Button>}
              {d.status === "em_leitura" && <Button className={btnOuro} disabled={lendo} onClick={() => ler(false)}><Play className="mr-1 h-4 w-4" />{d.progresso.proximo?.estado === "erro" ? "Tentar de novo este passo" : "Continuar leitura"}</Button>}
              {(d.status === "em_revisao" || d.status === "validada" || d.status === "em_leitura") && <Button variant="outline" className={btnOutline} disabled={lendo || !d.documentos.length}
                onClick={() => { if (window.confirm("Ler o projeto de novo apaga a planta atual e as correções feitas na revisão. Continuar?")) { setSujo(false); ler(true); } }}><RefreshCw className="mr-1 h-4 w-4" />Ler de novo do zero</Button>}
              {lendo && <span className="text-gray-300">Lendo… cada passo leva até um minuto. Mantenha esta página aberta.</span>}
            </div>
            {!d.documentos.length && <p className="text-amber-300">Escolha os PDFs do projeto antes de gerar.</p>}
          </CardContent>
        </Card>
      )}

      {rascunho && (
        <Card className={cardCls}>
          <CardHeader><CardTitle className="flex flex-wrap items-center justify-between gap-2 text-lg">
            <span>Revisão da planta</span>
            {d.resumo && <span className="text-sm font-normal text-gray-300">{d.resumo.areaTotal.toLocaleString("pt-BR")} m² · {d.resumo.pavimentos} pavimento(s) · {d.resumo.quartos} quarto(s) ({d.resumo.suites} suíte) · {d.resumo.banheiros} banheiro(s) · {d.resumo.vagas} vaga(s)</span>}
          </CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <EditorPlanta modelo={rascunho} maqueteId={id} pranchas={d.pranchas} somenteLeitura={!podeRevisar} onChange={m => { setRascunho(m); setSujo(true); }} />

            {rascunho.pendencias.length > 0 && (
              <div className="space-y-1 text-sm">
                <p className="font-semibold text-[#C9A961]">Dados que o projeto não trouxe — confirme cada um</p>
                {rascunho.pendencias.map(p => (
                  <label key={p.id} className="flex items-start gap-2">
                    <input type="checkbox" className="mt-1" disabled={!podeRevisar} checked={p.resolvida}
                      onChange={e => { setRascunho({ ...rascunho, pendencias: rascunho.pendencias.map(x => (x.id === p.id ? { ...x, resolvida: e.target.checked } : x)) }); setSujo(true); }} />
                    <span className={p.resolvida ? "text-gray-400 line-through" : ""}>{p.descricao}</span>
                  </label>
                ))}
              </div>
            )}

            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div><p className="font-semibold text-red-300">Erros ({erros.length}) — impedem validar</p>
                {erros.length ? <ul className="list-disc pl-5">{erros.map((p, i) => <li key={i}><span className="text-gray-400">{p.onde}:</span> {p.mensagem}</li>)}</ul> : <p className="text-gray-400">Nenhum.</p>}</div>
              <div><p className="font-semibold text-amber-300">Avisos ({avisos.length})</p>
                {avisos.length ? <ul className="max-h-56 list-disc overflow-y-auto pl-5">{avisos.map((p, i) => <li key={i}><span className="text-gray-400">{p.onde}:</span> {p.mensagem}</li>)}</ul> : <p className="text-gray-400">Nenhum.</p>}</div>
            </div>
            {sujo && <p className="text-xs text-amber-300">Há alterações não salvas. Erros e avisos são recalculados ao salvar.</p>}

            {podeRevisar && (
              <div className="flex flex-wrap gap-2">
                <Button className={btnOuro} disabled={!sujo || salvar.isPending} onClick={() => salvar.mutate({ id, versao, modelo: rascunho })}><Save className="mr-1 h-4 w-4" />Salvar planta</Button>
                {d.status === "em_revisao" && <Button variant="outline" className="border-emerald-400/50 bg-transparent text-emerald-300" disabled={sujo || erros.length > 0 || validar.isPending} onClick={() => validar.mutate({ id })}><Check className="mr-1 h-4 w-4" />Validar planta</Button>}
              </div>
            )}
            {d.status === "validada" && <p className="text-sm text-emerald-300">Planta validada em {dataHora(d.revisadoEm)}. Veja a maquete em 3D e publique o link abaixo.</p>}
          </CardContent>
        </Card>
      )}

      {rascunho && comercial && (
        <Card className={cardCls}>
          <CardHeader><CardTitle className="text-lg">Maquete 3D e link do cliente</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Button className={btnOuro} disabled={sujo} onClick={() => ir(`/admin/maquete-3d/${id}/3d`)}><Eye className="mr-1 h-4 w-4" />Ver a maquete em 3D</Button>
              <span className="text-xs text-gray-400">{sujo ? "Salve a planta para ver as alterações em 3D." : "A prévia funciona mesmo antes de validar e de publicar."}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-gray-300">Nome na apresentação
                <input className={inputCls} maxLength={160} placeholder={d.titulo} value={comercial.nome} onChange={e => setComercial({ ...comercial, nome: e.target.value })} /></label>
              <label className="text-xs text-gray-300">Localização
                <input className={inputCls} maxLength={200} placeholder="Bairro, cidade — UF" value={comercial.localizacao} onChange={e => setComercial({ ...comercial, localizacao: e.target.value })} /></label>
              <label className="text-xs text-gray-300">Preço de venda (R$) — opcional
                <input className={inputCls} type="number" min={0} step="0.01" value={comercial.preco} onChange={e => setComercial({ ...comercial, preco: e.target.value })} /></label>
              <label className="text-xs text-gray-300">WhatsApp do consultor (só números, com 55 e DDD)
                <input className={inputCls} inputMode="numeric" maxLength={15} placeholder="5599999999999" value={comercial.whatsapp} onChange={e => setComercial({ ...comercial, whatsapp: e.target.value.replace(/\D/g, "") })} /></label>
            </div>
            <p className="text-xs text-gray-400">Campo vazio não aparece para o cliente. Área, quartos, banheiros e vagas vêm da planta validada.</p>
            <Button variant="outline" className={btnOutline} disabled={salvarComercial.isPending}
              onClick={() => salvarComercial.mutate({ id, comercial: { nome: comercial.nome, localizacao: comercial.localizacao, preco: comercial.preco === "" ? null : Number(comercial.preco), whatsapp: comercial.whatsapp } })}><Save className="mr-1 h-4 w-4" />Salvar apresentação</Button>

            {d.status === "publicada" ? (
              <div className="space-y-2 rounded-lg border border-emerald-400/30 p-3">
                <p className="text-emerald-300">Publicada em {dataHora(d.publicadoEm)}. Link do cliente:</p>
                <div className="flex flex-wrap items-center gap-2">
                  <a href={link} target="_blank" rel="noreferrer" className="break-all text-[#C9A961] underline">{link}</a>
                  <Button size="sm" variant="outline" className={btnOutline} onClick={() => { void navigator.clipboard.writeText(link).then(() => toast.success("Link copiado.")); }}><Copy className="mr-1 h-4 w-4" />Copiar</Button>
                  {d.clienteTelefone && (
                    <a target="_blank" rel="noreferrer" href={`https://wa.me/${(d.clienteTelefone.replace(/\D/g, "").length <= 11 ? "55" : "") + d.clienteTelefone.replace(/\D/g, "")}?text=${encodeURIComponent(`Olá! A sua maquete 3D ficou pronta. Abra para ver a casa por dentro e por fora: ${link}`)}`}>
                      <Button size="sm" variant="outline" className="border-emerald-400/50 bg-transparent text-emerald-300">Enviar ao cliente pelo WhatsApp</Button>
                    </a>
                  )}
                </div>
                {admin && <Button size="sm" variant="outline" className="border-red-400/50 bg-transparent text-red-300" disabled={despublicar.isPending}
                  onClick={() => { if (window.confirm("Tirar o link do ar? O cliente deixa de conseguir abrir a maquete.")) despublicar.mutate({ id }); }}>Tirar do ar</Button>}
              </div>
            ) : d.status === "validada" ? (
              admin ? <Button className={btnOuro} disabled={publicar.isPending} onClick={() => publicar.mutate({ id })}><Globe className="mr-1 h-4 w-4" />Publicar e gerar o link do cliente</Button>
                : <p className="text-xs text-gray-400">Só o administrador publica a maquete.</p>
            ) : <p className="text-xs text-gray-400">O link do cliente é liberado depois que a planta for validada.</p>}
          </CardContent>
        </Card>
      )}
    </>
  );
}
