// Maquete 3D (EPIC-022, S-04) — painel do módulo: pedidos, novo pedido a partir de um projeto ou de um estudo de
// incorporação, preços padrão (só admin) e, em cada pedido, liberação/autorização, leitura do PDF e revisão da planta.
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { ArrowLeft, Box, Check, Copy, Eye, Globe, Play, Plus, RefreshCw, Save, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { enviarPartes, LIMITE_DOCUMENTO } from "@/lib/documentos-partes";
import { EditorPlanta } from "@/components/maquete-3d/EditorPlanta";
import { EditorMuro } from "@/components/maquete-3d/EditorMuro";
import { HistoricoPlanta, ImportarPlanta } from "@/components/maquete-3d/ImportarPlanta";
import { INTERVALO_CONSULTA_MS, consultaDeNovo, perguntaAlemDoTeto, rotuloConfirmarIA, rotuloContinuarLeitura } from "@/components/maquete-3d/rotulos-leitura";
import { AndamentoLeitura } from "@/components/maquete-3d/AndamentoLeitura";

const Visualizador = lazy(() => import("@/components/maquete-3d/visualizador/Visualizador"));
import { ROTULOS_TIPO, TIPOS_MAQUETE, publicadoSemMuro, type ModeloMaquete, type TipoMaquete } from "@shared/maquete-3d/modelo";
import { LIMITES_CASA, LIMITES_M2_POR_VAGA, LIMITES_PREDIO, M2_DA_VAGA, M2_POR_VAGA, contaDoEstacionamento, ehPadrao, type ContaDoEstacionamento } from "@shared/maquete-3d/padrao";
import {
  ESFORCOS_IA, FAIXAS_PRECO, MAX_DOCUMENTOS, MOTORES_LEITURA, ROTULOS_FAIXA, ROTULOS_MOTOR, ROTULOS_STATUS, escopoEnvioMaquete, type DocumentoMaquete, type FaixaPreco,
  type MotorLeitura, type OrigemMaquete, type StatusMaquete,
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
  aguardando_aprovacao: "bg-amber-500/20 text-amber-300", aguardando_pagamento: "bg-amber-500/20 text-amber-300", aguardando_autorizacao: "bg-amber-500/20 text-amber-300",
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
      <Visualizador modelo={d.modelo} unidades={d.unidades} aoSair={() => ir(`/admin/maquete-3d/${id}`)}
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
  // EPIC-023 (S-A): excluir pela lista. Mantém o padrão do detalhe: primeiro a recusa (com motivo), depois a exclusão.
  const utils = trpc.useUtils();
  const [apagar, setApagar] = useState<{ id: number; titulo: string; status: string } | null>(null);
  const [motivo, setMotivo] = useState("");
  const recusar = trpc.maquete3d.recusar.useMutation();
  const excluir = trpc.maquete3d.excluir.useMutation();
  const apagando = recusar.isPending || excluir.isPending;
  async function confirmarExclusao() {
    if (!apagar) return;
    try {
      if (apagar.status !== "recusada") await recusar.mutateAsync({ id: apagar.id, motivo: motivo.trim() });
      await excluir.mutateAsync({ id: apagar.id });
      toast.success("Pedido excluído.");
      setApagar(null); setMotivo("");
    } catch (e) { falha(e); }
    await utils.maquete3d.listar.invalidate();
  }
  return (
    <>
      <Dialog open={!!apagar} onOpenChange={aberto => { if (!aberto && !apagando) { setApagar(null); setMotivo(""); } }}>
        <DialogContent className="border-[#C9A961]/30 bg-[#1A2332] text-white">
          <DialogHeader><DialogTitle>Excluir pedido — {apagar?.titulo}</DialogTitle></DialogHeader>
          {apagar?.status === "recusada" ? <p className="text-sm text-gray-300">Este pedido já está recusado. Confirma a exclusão?</p> : (
            <label className="block text-sm text-gray-300">Antes de excluir, o pedido é recusado. Informe o motivo da recusa (mínimo de 5 letras):
              <input className={`mt-1 ${inputCls}`} value={motivo} maxLength={400} onChange={e => setMotivo(e.target.value)} autoFocus /></label>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" className={btnOutline} disabled={apagando} onClick={() => { setApagar(null); setMotivo(""); }}>Cancelar</Button>
            <Button variant="outline" className="border-red-400/50 bg-transparent text-red-300" disabled={apagando || (apagar?.status !== "recusada" && motivo.trim().length < 5)} onClick={confirmarExclusao}>
              <Trash2 className="mr-1 h-4 w-4" />{apagar?.status === "recusada" ? "Excluir" : "Recusar e excluir"}</Button>
          </div>
        </DialogContent>
      </Dialog>
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
                <thead className="text-xs uppercase text-gray-400"><tr><th className="py-2 pr-3">Maquete</th><th className="pr-3">Origem</th><th className="pr-3">Tipo</th><th className="pr-3">Valor</th><th className="pr-3">Situação</th><th className="pr-3">Criada em</th>{admin && <th className="text-right">Excluir</th>}</tr></thead>
                <tbody>
                  {lista.data.map(m => (
                    <tr key={m.id} className="border-t border-[#C9A961]/10">
                      <td className="py-2 pr-3"><Link href={`/admin/maquete-3d/${m.id}`} className="font-medium text-[#C9A961] hover:underline">{m.titulo}</Link>
                        {m.resumo && <span className="block text-xs text-gray-400">{m.resumo.areaTotal.toLocaleString("pt-BR")} m² · {m.resumo.pavimentos} pav. · {m.resumo.quartos} quarto(s)</span>}</td>
                      <td className="pr-3">{m.origem === "incorporacao" ? "Incorporação" : m.porCliente ? "Cliente do CRM" : "Projeto"}<span className="block text-xs text-gray-400">{m.alvo}{m.cliente ? ` · ${m.cliente}` : ""}</span></td>
                      <td className="pr-3">{ROTULOS_TIPO[m.tipo as TipoMaquete]}</td>
                      <td className="pr-3">{reais(m.preco)}</td>
                      <td className="pr-3"><Selo status={m.status} /></td>
                      <td className="whitespace-nowrap pr-3 text-gray-300">{dataHora(m.createdAt)}</td>
                      {admin && <td className="whitespace-nowrap text-right">
                        <Button size="icon" variant="ghost" aria-label={`Excluir ${m.titulo}`} title={m.status === "publicada" ? "Despublique a maquete antes de excluir" : "Excluir pedido"} disabled={m.status === "publicada"}
                          className="h-8 w-8 text-red-300 hover:bg-red-500/10 hover:text-red-200" onClick={() => { setMotivo(""); setApagar({ id: m.id, titulo: m.titulo, status: m.status }); }}><Trash2 className="h-4 w-4" /></Button>
                      </td>}
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

const mesmoDoc = (a: DocumentoMaquete, b: DocumentoMaquete) => a.fonte === b.fonte && a.id === b.id;
const ROTULO_FONTE: Record<DocumentoMaquete["fonte"], string> = { projeto: "do projeto", incorporacao: "do estudo", avulso: "enviado neste pedido" };

function EscolhaDocumentos({ lista, carregando, vazio, escolhidos, onChange }: { lista: DocumentoMaquete[] | undefined; carregando?: boolean; vazio: string; escolhidos: DocumentoMaquete[]; onChange: (d: DocumentoMaquete[]) => void }) {
  if (carregando) return <p className="text-sm text-gray-400">Carregando arquivos…</p>;
  if (!lista?.length) return <p className="text-sm text-amber-300">{vazio}</p>;
  return (
    <div className="space-y-1">
      {lista.map(d => {
        const marcado = escolhidos.some(e => mesmoDoc(e, d));
        return (
          <label key={`${d.fonte}-${d.id}`} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={marcado} disabled={!marcado && escolhidos.length >= MAX_DOCUMENTOS}
              onChange={e => onChange(e.target.checked ? [...escolhidos, d] : escolhidos.filter(x => !mesmoDoc(x, d)))} />{d.nome}
            <span className="text-xs text-gray-400">({ROTULO_FONTE[d.fonte]})</span>
          </label>
        );
      })}
      <p className="text-xs text-gray-400">Marque as plantas baixas de todos os pavimentos, os cortes (de onde vem o pé-direito) e, se houver, a implantação. Até {MAX_DOCUMENTOS} arquivos.</p>
    </div>
  );
}

/** Campo de PDF avulso: só escolhe os arquivos; o envio acontece depois que o pedido existe. */
function CampoPdfAvulso({ arquivos, onChange, limite }: { arquivos: File[]; onChange: (a: File[]) => void; limite: number }) {
  const ref = useRef<HTMLInputElement>(null);
  function escolher(novos: FileList | null) {
    const lista = Array.from(novos ?? []);
    const grande = lista.find(f => f.size > LIMITE_DOCUMENTO), naoPdf = lista.find(f => !/\.pdf$/i.test(f.name));
    if (naoPdf) { toast.error(`"${naoPdf.name}" não é um PDF.`); return; }
    if (grande) { toast.error(`"${grande.name}" passa de 20 MB.`); return; }
    onChange([...arquivos, ...lista].slice(0, Math.max(0, limite)));
    if (ref.current) ref.current.value = "";
  }
  return (
    <div className="space-y-1">
      <input ref={ref} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={e => escolher(e.target.files)} />
      <Button type="button" size="sm" variant="outline" className={btnOutline} disabled={arquivos.length >= limite} onClick={() => ref.current?.click()}><Upload className="mr-1 h-4 w-4" />Enviar PDF avulso</Button>
      {arquivos.map((f, i) => (
        <p key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm">{f.name}<span className="text-xs text-gray-400">({(f.size / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB)</span>
          <button type="button" aria-label={`Tirar ${f.name}`} className="text-red-300" onClick={() => onChange(arquivos.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button></p>
      ))}
      <p className="text-xs text-gray-400">PDF de até 20 MB, sem precisar cadastrar no projeto ou no estudo.</p>
    </div>
  );
}

/** Sobe os PDFs avulsos e anexa ao pedido; devolve quantos entraram. */
async function enviarAvulsos(id: number, arquivos: File[], anexar: (v: { id: number; uploadId: string; nome: string }) => Promise<unknown>): Promise<number> {
  let enviados = 0;
  for (const f of arquivos) {
    const uploadId = await enviarPartes(f, escopoEnvioMaquete(id));
    await anexar({ id, uploadId, nome: f.name });
    enviados++;
  }
  return enviados;
}

function NovoPedido({ admin, aoFechar }: { admin: boolean; aoFechar: () => void }) {
  const [, ir] = useLocation();
  const opcoes = trpc.maquete3d.opcoes.useQuery();
  const config = trpc.maquete3d.config.useQuery();
  const utils = trpc.useUtils();
  const [origem, setOrigem] = useState<OrigemMaquete>("projeto");
  // Projeto de cliente: ligado ao projeto cadastrado OU a um cliente do CRM (um dos dois).
  const [vinculo, setVinculo] = useState<"projeto" | "cliente">("projeto");
  const [alvoId, setAlvoId] = useState<number | null>(null);
  const [leadId, setLeadId] = useState<number | null>(null);
  const [buscaCliente, setBuscaCliente] = useState("");
  const [tipo, setTipo] = useState<TipoMaquete>("casa");
  const [faixa, setFaixa] = useState<FaixaPreco>("terrea_ate_70");
  const [preco, setPreco] = useState<string>("");
  const [documentos, setDocumentos] = useState<DocumentoMaquete[]>([]);
  const [avulsos, setAvulsos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const porCliente = origem === "projeto" && vinculo === "cliente";
  const clientes = trpc.maquete3d.clientes.useQuery({ busca: buscaCliente }, { enabled: porCliente });
  const docs = trpc.maquete3d.documentosDisponiveis.useQuery({ origem, alvoId: alvoId ?? 0 }, { enabled: !porCliente && !!alvoId });
  const criar = trpc.maquete3d.criar.useMutation();
  const anexar = trpc.maquete3d.anexarPdf.useMutation();
  const padrao = config.data?.precos[faixa] ?? null;
  // O nome do projeto costuma já trazer o do cliente: não repete no rótulo.
  const alvos = origem === "projeto"
    ? opcoes.data?.projetos.map(p => ({ id: p.id, rotulo: p.cliente && !p.nome.toLowerCase().includes(p.cliente.toLowerCase()) ? `${p.nome} — ${p.cliente}` : p.nome }))
    : opcoes.data?.estudos.map(e => ({ id: e.id, rotulo: `${e.nome} — ${e.cidade}` }));
  const limpar = () => { setAlvoId(null); setLeadId(null); setDocumentos([]); };
  const trocarOrigem = (o: OrigemMaquete) => { setOrigem(o); limpar(); setTipo(o === "projeto" ? "casa" : "loteamento"); };
  const pronto = porCliente ? !!leadId : !!alvoId;

  async function criarPedido() {
    setEnviando(true);
    let id: number | null = null;
    try {
      ({ id } = await criar.mutateAsync({
        origem, tipo, documentos, ...(porCliente ? { leadId: leadId! } : { alvoId: alvoId! }),
        ...(origem === "projeto" ? { faixaPreco: faixa, ...(preco !== "" && admin ? { preco: Number(preco) } : {}) } : {}),
      }));
      if (avulsos.length) await enviarAvulsos(id, avulsos, v => anexar.mutateAsync(v));
      toast.success("Pedido criado.");
    } catch (e) {
      // O pedido pode ter sido criado e só o envio do PDF ter falhado: abre o pedido para enviar de novo.
      toast.error(id ? `Pedido criado, mas um PDF não foi enviado: ${e instanceof Error ? e.message : "falha no envio"}. Envie de novo na tela do pedido.` : e instanceof Error ? e.message : "Não foi possível criar o pedido.");
    } finally {
      setEnviando(false);
      utils.maquete3d.listar.invalidate();
      if (id) ir(`/admin/maquete-3d/${id}`);
    }
  }

  return (
    <Card className={cardCls}>
      <CardHeader><CardTitle className="text-lg">Novo pedido de maquete</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-gray-300">Origem
            <select className={inputCls} value={origem} onChange={e => trocarOrigem(e.target.value as OrigemMaquete)}>
              <option value="projeto">Projeto de cliente (pago)</option><option value="incorporacao">Incorporação (sem cobrança)</option>
            </select></label>
          {origem === "projeto" && (
            <label className="text-xs text-gray-300">Vincular a
              <select className={inputCls} value={vinculo} onChange={e => { setVinculo(e.target.value as typeof vinculo); limpar(); }}>
                <option value="projeto">Projeto cadastrado</option><option value="cliente">Cliente do CRM</option>
              </select></label>
          )}
          {porCliente ? (
            <div className="text-xs text-gray-300">Cliente do CRM
              <input className={inputCls} value={buscaCliente} onChange={e => setBuscaCliente(e.target.value)} placeholder="Pesquisar por nome, telefone ou e-mail" aria-label="Pesquisar cliente do CRM" />
              <select className={`mt-1 ${inputCls}`} aria-label="Cliente do CRM" value={leadId ?? ""} onChange={e => setLeadId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">{clientes.isLoading ? "Carregando…" : "— escolher —"}</option>
                {clientes.data?.map(c => <option key={c.id} value={c.id}>{c.nome}{c.telefone ? ` · ${c.telefone}` : ""}</option>)}
              </select></div>
          ) : (
            <label className={`text-xs text-gray-300 ${origem === "projeto" ? "" : "sm:col-span-2"}`}>{origem === "projeto" ? "Projeto" : "Estudo de incorporação"}
              <select className={inputCls} value={alvoId ?? ""} onChange={e => { setAlvoId(e.target.value ? Number(e.target.value) : null); setDocumentos([]); }}>
                <option value="">— escolher —</option>{alvos?.map(a => <option key={a.id} value={a.id}>{a.rotulo}</option>)}
              </select></label>
          )}
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
        {porCliente && <p className="text-xs text-gray-400">Pedido ligado ao cliente, sem projeto cadastrado: envie o PDF do projeto abaixo. O cliente acompanha pelo portal e recebe o link por e-mail.</p>}
        {!porCliente && alvoId && <div><p className="mb-1 text-sm font-semibold">PDFs {origem === "projeto" ? "do projeto" : "do estudo"} para a leitura</p>
          <EscolhaDocumentos lista={docs.data} carregando={docs.isLoading} escolhidos={documentos} onChange={setDocumentos}
            vazio={`Nenhum PDF ativo neste ${origem === "projeto" ? "projeto" : "estudo"}. Envie um PDF avulso abaixo ou cadastre-o no módulo ${origem === "projeto" ? "Projetos" : "Incorporação"}.`} /></div>}
        {pronto && <div><p className="mb-1 text-sm font-semibold">PDF avulso</p><CampoPdfAvulso arquivos={avulsos} onChange={setAvulsos} limite={MAX_DOCUMENTOS - documentos.length} /></div>}
        <div className="flex gap-2">
          <Button className={btnOuro} disabled={!pronto || enviando} onClick={criarPedido}>{enviando ? "Criando e enviando…" : "Criar pedido"}</Button>
          <Button variant="outline" className={btnOutline} disabled={enviando} onClick={aoFechar}>Cancelar</Button>
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
            <label className="text-xs text-gray-300">Quem lê o PDF do projeto{form.motorEscolhido ? "" : " (padrão)"}
              <select className={inputCls} value={form.motor} onChange={e => setForm({ ...form, motor: e.target.value as MotorLeitura, motorEscolhido: e.target.value as MotorLeitura })}>
                {MOTORES_LEITURA.map(x => <option key={x} value={x}>{ROTULOS_MOTOR[x]}</option>)}
              </select></label>
            {form.motor !== "geometrico" && <label className="text-xs text-gray-300">Máximo de pranchas (chamadas pagas) pela IA por maquete, somando leituras e importações
              <input className={inputCls} type="number" min={0} max={60} step={1} value={form.limitePranchasIA} onChange={e => setForm({ ...form, limitePranchasIA: Math.max(0, Math.min(60, Math.round(Number(e.target.value) || 0))) })} /></label>}
            {form.motor !== "geometrico" && <><label className="text-xs text-gray-300">Leitura do projeto pela IA
              <select className={inputCls} value={form.esforcoIA} onChange={e => setForm({ ...form, esforcoIA: e.target.value as (typeof ESFORCOS_IA)[number] })}>
                {ESFORCOS_IA.map(x => <option key={x} value={x}>{ROTULOS_ESFORCO[x]}</option>)}
              </select></label>
            <label className="text-xs text-gray-300">Modelo da IA{form.origemChaveIA === "painel" ? " (quando o painel não tem preferido)" : ""}
              <input className={inputCls} value={form.modeloIA} onChange={e => setForm({ ...form, modeloIA: e.target.value })} /></label></>}
          </div>
        )}
        {form.motor === "geometrico"
          ? <p className="text-xs text-gray-400">O leitor próprio não tem custo: lê as linhas e os textos do PDF exportado do programa de desenho (CAD/Revit). PDF escaneado ou fotografado não tem linhas para ler; nesse caso a planta é desenhada na revisão ou usa-se a construção padrão. Neste modo a IA nunca é usada.</p>
          : form.motor === "hibrido"
            ? <p className="text-xs text-gray-400">O leitor próprio lê primeiro, sem custo. Só vão para a IA as pranchas que ele não consegue ler (imagem escaneada ou fotografada) ou lê de forma insuficiente (planta sem cômodos com nome, leitura parcial). Em cada leitura ou importação que precise da IA, o administrador vê quantas pranchas irão e confirma; a confirmação vale só para aquela execução, e o teto abaixo vale por maquete (passar dele exige autorizar além do teto).</p>
            : <p className="text-xs text-gray-400">Todos os passos da leitura usam a IA (paga).</p>}
        {form.motor !== "geometrico" && (form.iaConfigurada
          ? <p className="text-xs text-gray-300">Chave da IA: {form.origemChaveIA === "painel" ? "a cadastrada em Integrações → Anthropic" : "a do servidor (ANTHROPIC_API_KEY)"} · modelo em uso: {form.modeloEmUso}.</p>
          : <p className="text-sm text-amber-300">Não há chave da IA: cadastre-a em Integrações → Anthropic. Sem ela, as pranchas que precisam da IA ficam aguardando, e o leitor próprio continua funcionando.</p>)}
        {admin ? <Button className={btnOuro} disabled={salvar.isPending} onClick={() => salvar.mutate({ precos: form.precos, ...(form.motorEscolhido ? { motor: form.motorEscolhido } : {}), limitePranchasIA: form.limitePranchasIA, modeloIA: form.modeloIA, esforcoIA: form.esforcoIA })}><Save className="mr-1 h-4 w-4" />Salvar</Button>
          : <p className="text-xs text-gray-400">Só o administrador altera os preços.</p>}
      </CardContent>
    </Card>
  );
}

// ── Tipo da maquete e construções padrão (EPIC-023, S-C) ──

const numero = (texto: string) => Number(texto.replace(",", "."));

/**
 * Trocar o tipo redesenha a maquete: Casa/Condomínio e Prédio pedem as medidas e o motor gera uma construção
 * padrão (sem PDF e sem IA), uma em cada lote; Loteamento deixa só os lotes.
 */
function TipoEPadrao({ id, tipoAtual, temLidas, temImplantacao, incorporacao, sujo, aoAplicar }: {
  id: number; tipoAtual: TipoMaquete; temLidas: boolean; temImplantacao: boolean; incorporacao: boolean; sujo: boolean; aoAplicar: () => void;
}) {
  const [tipo, setTipo] = useState<TipoMaquete>(tipoAtual);
  const [usarLida, setUsarLida] = useState(false);
  const [casa, setCasa] = useState({ frente: "8", fundo: "12", quartos: "2", pavimentos: "1", garagem: true });
  const [predio, setPredio] = useState({ largura: "24", profundidade: "14", andares: "8", aptosPorAndar: "6", vagasPorApto: "1", m2PorVaga: String(M2_POR_VAGA).replace(".", ","), pilotis: true, subsolos: "0", areaTerreno: "" });
  type Conta = ContaDoEstacionamento & { areaTerreno: number; vagasPorApto: number };
  const [conta, setConta] = useState<Conta | null>(null);
  useEffect(() => setTipo(tipoAtual), [tipoAtual]);
  const aplicar = trpc.maquete3d.aplicarTipo.useMutation({
    onSuccess: r => {
      toast.success(r.lotes ? `${ROTULOS_TIPO[tipo]}: ${r.construcoes} construção(ões) em ${r.lotes} lote(s) vendável(is).` : `Tipo alterado para ${ROTULOS_TIPO[tipo]}${r.padrao ? ` — ${r.padrao} gerada` : ""}.`);
      setConta(r.estacionamento);
      if (r.estacionamento?.reduzido) toast.warning(`Estacionamento: cabem ${r.estacionamento.vagas.total} vaga(s) por prédio. Os ${r.estacionamento.andaresPedidos} andares pedidos foram reduzidos para ${r.estacionamento.andares} (${r.estacionamento.apartamentos} apartamentos).`, { duration: 15000 });
      if (r.semConstrucaoTotal) toast.warning(`${r.semConstrucaoTotal} lote(s) ficaram sem construção porque ela não cabe: ${r.semConstrucao.slice(0, 8).join(", ")}${r.semConstrucaoTotal > 8 ? "…" : ""}. Diminua a frente ou o fundo e aplique de novo.`, { duration: 12000 });
      aoAplicar();
    },
    onError: falha,
  });
  const ehCasa = tipo === "casa" || tipo === "condominio", ehPredio = tipo === "predio";
  const campo = (rotulo: string, valor: string, mudar: (v: string) => void, faixa: readonly [number, number], passo = "0.5") => (
    <label className="text-xs text-gray-300">{rotulo}
      <input className={inputCls} type="number" inputMode="decimal" step={passo} min={faixa[0]} max={faixa[1]} value={valor} onChange={e => mudar(e.target.value)} /></label>
  );
  const medidasDoPredio = { largura: numero(predio.largura), profundidade: numero(predio.profundidade), andares: Math.round(numero(predio.andares)), aptosPorAndar: Math.round(numero(predio.aptosPorAndar)),
    vagasPorApto: numero(predio.vagasPorApto), pilotis: predio.pilotis, subsolos: Math.round(numero(predio.subsolos)),
    ...(Number.isFinite(numero(predio.m2PorVaga)) ? { m2PorVaga: Math.min(LIMITES_M2_POR_VAGA[1], Math.max(LIMITES_M2_POR_VAGA[0], numero(predio.m2PorVaga))) } : {}) };
  // Prévia da conta do estacionamento enquanto se digita (quando a área do terreno é informada aqui).
  const previa = ehPredio && !(usarLida && temLidas) && numero(predio.areaTerreno) >= medidasDoPredio.largura * medidasDoPredio.profundidade && [medidasDoPredio.largura, medidasDoPredio.profundidade, medidasDoPredio.andares, medidasDoPredio.aptosPorAndar, medidasDoPredio.vagasPorApto].every(Number.isFinite)
    ? { ...contaDoEstacionamento(medidasDoPredio, medidasDoPredio, numero(predio.areaTerreno)), areaTerreno: numero(predio.areaTerreno), vagasPorApto: medidasDoPredio.vagasPorApto } : null;
  const mostrada: Conta | null = previa ?? (ehPredio ? conta : null);
  function enviar() {
    if (sujo && !window.confirm("Há alterações não salvas na planta. Aplicar o tipo descarta essas alterações. Continuar?")) return;
    const padrao = usarLida && temLidas ? {} : ehCasa
      ? { casa: { frente: numero(casa.frente), fundo: numero(casa.fundo), quartos: Math.round(numero(casa.quartos)), pavimentos: (casa.pavimentos === "2" ? 2 : 1) as 1 | 2, garagem: casa.garagem } }
      : ehPredio ? { predio: { ...medidasDoPredio, ...(predio.areaTerreno ? { areaTerreno: numero(predio.areaTerreno) } : {}) } } : {};
    aplicar.mutate({ id, tipo, ...padrao });
  }
  return (
    <Card className={cardCls}>
      <CardHeader><CardTitle className="text-lg">Tipo da maquete e construções</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="text-xs text-gray-300">Tipo
            <select className={inputCls} value={tipo} onChange={e => setTipo(e.target.value as TipoMaquete)}>{TIPOS_MAQUETE.map(t => <option key={t} value={t}>{ROTULOS_TIPO[t]}</option>)}</select></label>
          {ehCasa && !(usarLida && temLidas) && <>
            {campo("Frente da casa (m)", casa.frente, v => setCasa(c => ({ ...c, frente: v })), LIMITES_CASA.frente)}
            {campo("Fundo da casa (m)", casa.fundo, v => setCasa(c => ({ ...c, fundo: v })), LIMITES_CASA.fundo)}
            {campo("Quartos", casa.quartos, v => setCasa(c => ({ ...c, quartos: v })), LIMITES_CASA.quartos, "1")}
            <label className="text-xs text-gray-300">Pavimentos
              <select className={inputCls} value={casa.pavimentos} onChange={e => setCasa(c => ({ ...c, pavimentos: e.target.value }))}><option value="1">Térrea</option><option value="2">Sobrado</option></select></label>
            <label className="flex items-end gap-2 pb-2 text-xs text-gray-300"><input type="checkbox" checked={casa.garagem} onChange={e => setCasa(c => ({ ...c, garagem: e.target.checked }))} />Com garagem (frente a partir de 7,5 m)</label>
          </>}
          {ehPredio && !(usarLida && temLidas) && <>
            {campo("Largura do prédio (m)", predio.largura, v => setPredio(c => ({ ...c, largura: v })), LIMITES_PREDIO.largura)}
            {campo("Profundidade (m)", predio.profundidade, v => setPredio(c => ({ ...c, profundidade: v })), LIMITES_PREDIO.profundidade)}
            {campo("Andares de apartamentos", predio.andares, v => setPredio(c => ({ ...c, andares: v })), LIMITES_PREDIO.andares, "1")}
            {campo("Apartamentos por andar", predio.aptosPorAndar, v => setPredio(c => ({ ...c, aptosPorAndar: v })), LIMITES_PREDIO.aptosPorAndar, "1")}
            {campo("Vagas por apartamento", predio.vagasPorApto, v => setPredio(c => ({ ...c, vagasPorApto: v })), LIMITES_PREDIO.vagasPorApto)}
            <label className="text-xs text-gray-300">Área por vaga, com a manobra (m²)
              <input className={inputCls} inputMode="decimal" value={predio.m2PorVaga} onChange={e => setPredio(c => ({ ...c, m2PorVaga: e.target.value }))} /></label>
            {campo("Subsolos de garagem", predio.subsolos, v => setPredio(c => ({ ...c, subsolos: v })), LIMITES_PREDIO.subsolos, "1")}
            {!temImplantacao && !incorporacao && campo("Área do terreno (m²)", predio.areaTerreno, v => setPredio(c => ({ ...c, areaTerreno: v })), LIMITES_PREDIO.areaTerreno, "1")}
            <label className="flex items-end gap-2 pb-2 text-xs text-gray-300"><input type="checkbox" checked={predio.pilotis} onChange={e => setPredio(c => ({ ...c, pilotis: e.target.checked }))} />Térreo em pilotis com estacionamento</label>
          </>}
        </div>
        {ehPredio && !(usarLida && temLidas) && (
          <div className={`rounded-md border p-3 text-xs ${mostrada?.inviavel ? "border-red-400/50 text-red-200" : mostrada?.reduzido ? "border-amber-400/50 text-amber-200" : "border-[#C9A961]/20 text-gray-300"}`}>
            <p className="mb-1 font-semibold text-white">Estacionamento</p>
            <p className="mb-1 text-gray-400">Cada vaga é de um carro ({M2_DA_VAGA.toLocaleString("pt-BR")} m²: 2,5 × 5 m). A conta usa {(mostrada?.m2PorVaga ?? M2_POR_VAGA).toLocaleString("pt-BR")} m² por vaga porque inclui a parte do corredor por onde o carro entra e sai.</p>
            {mostrada ? (
              <>
                <p>Terreno de {mostrada.areaTerreno.toLocaleString("pt-BR")} m² por prédio: cabem <strong>{mostrada.vagas.total} vaga(s)</strong> — {mostrada.vagas.patio} no pátio, {mostrada.vagas.pilotis} sob o pilotis e {mostrada.vagas.subsolos} em subsolo.</p>
                {mostrada.inviavel ? <p>Não cabe nem um andar com {mostrada.vagasPorApto.toLocaleString("pt-BR")} vaga(s) por apartamento. Use pilotis, acrescente subsolo ou aumente o terreno.</p>
                  : <p>{mostrada.apartamentos} apartamento(s) em {mostrada.andares} andar(es) de {mostrada.aptosPorAndar} precisam de {mostrada.vagasNecessarias} vaga(s).{mostrada.reduzido ? ` Você pediu ${mostrada.andaresPedidos} andares: o prédio ${previa ? "será" : "foi"} gerado com ${mostrada.andares}, que é o que o estacionamento comporta.` : " O estacionamento comporta."}</p>}
              </>
            ) : <p>O sistema calcula quantas vagas cabem no terreno e nunca gera mais apartamentos do que o estacionamento comporta. {temImplantacao || incorporacao ? "A conta usa o menor lote em que o prédio cabe e aparece aqui depois de gerar." : "Informe a área do terreno para ver a conta."}</p>}
          </div>
        )}
        {temLidas && tipo !== "loteamento" && <label className="flex items-center gap-2 text-xs text-gray-300"><input type="checkbox" checked={usarLida} onChange={e => setUsarLida(e.target.checked)} />Usar a construção já lida do PDF em vez da padrão</label>}
        <p className="text-xs text-gray-400">
          {tipo === "loteamento" ? "Loteamento mostra só o terreno, as ruas e os lotes; as construções saem da implantação."
            : `O motor desenha uma ${ehPredio ? "torre" : "casa"} padrão desse tamanho, só para representar o empreendimento${temImplantacao || incorporacao ? ", e põe uma em cada lote vendável, com a frente para a rua" : ""}. Não é a planta do projeto: quando o PDF real for lido, ele pode substituir a padrão.`}
          {incorporacao && !temImplantacao && " A implantação (terreno, ruas e lotes) é montada do estudo ao aplicar."}
        </p>
        <Button className={btnOuro} disabled={aplicar.isPending} onClick={enviar}><Box className="mr-1 h-4 w-4" />{aplicar.isPending ? "Aplicando…" : tipo === "loteamento" ? "Aplicar tipo" : "Gerar e distribuir nos lotes"}</Button>
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
  // PDF avulso: sobe em partes e já entra na lista da leitura.
  const anexarPdf = trpc.maquete3d.anexarPdf.useMutation();
  const [novosPdfs, setNovosPdfs] = useState<File[]>([]);
  const [anexando, setAnexando] = useState(false);
  async function enviarNovosPdfs() {
    setAnexando(true);
    try { const n = await enviarAvulsos(id, novosPdfs, v => anexarPdf.mutateAsync(v)); toast.success(`${n} PDF(s) anexado(s).`); setNovosPdfs([]); setTrocandoDocs(null); }
    catch (e) { falha(e); }
    finally { setAnexando(false); recarregar(); }
  }

  // Leitura: a tela chama um passo por vez até acabar ou até um passo falhar. Com a prancha na IA (lote em segundo
  // plano, EPIC-027 C1), consulta de novo a cada poucos segundos até ela terminar.
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
        if (r.aguardando && consultaDeNovo(r.aguardando.motivo)) {
          await new Promise(ok => setTimeout(ok, INTERVALO_CONSULTA_MS));
          if (parar.current) return;
          continue;
        }
        if (r.aguardando) { toast.warning(r.aguardando.mensagem, { duration: 12000 }); break; }
        if (!r.proximo) { toast.success("Leitura concluída. Confira a planta."); break; }
      }
    } catch (e) { falha(e); } finally { setLendo(false); recarregar(); }
  }

  // Leitura híbrida (S-03): confirmação do custo da IA (admin) ou seguir sem ela.
  const confirmarIA = trpc.maquete3d.confirmarIA.useMutation();
  const pularIA = trpc.maquete3d.pularIA.useMutation();
  // QA S-11 r2, achado 2: a confirmação leva o modelo que a tela mostrou; se ele mudou, o servidor recusa e a tela atualiza.
  const modeloAConfirmar = d?.passos.find(p => p.estado === "aguardando")?.modeloAConfirmar ?? undefined;
  async function decidirIA(usar: boolean, alemDoTeto = false) {
    try {
      if (usar) await confirmarIA.mutateAsync({ id, alemDoTeto, modeloVisto: modeloAConfirmar }); else await pularIA.mutateAsync({ id });
      await ler(false);
    } catch (e) { falha(e); recarregar(); }
  }
  // EPIC-027 C1: cancelar a prancha na IA; e, ao abrir a página com uma prancha ainda na IA, retomar a consulta.
  const cancelarIA = trpc.maquete3d.cancelarLeituraIA.useMutation({ onSuccess: () => { toast.info("Cancelamento pedido à Anthropic. A tela confirma o resultado em instantes."); recarregar(); }, onError: falha });
  const retomou = useRef(false);
  useEffect(() => {
    if (!d || lendo || retomou.current || d.status !== "em_leitura" || !d.ia.emCurso) return;
    retomou.current = true;
    void ler(false);
  }, [d, lendo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Revisão: rascunho local até salvar.
  const [rascunho, setRascunho] = useState<ModeloMaquete | null>(null);
  const [versao, setVersao] = useState(0);
  const [sujo, setSujo] = useState(false);
  useEffect(() => { if (d && !sujo) { setRascunho(d.modelo); setVersao(d.modeloVersao); } }, [d, sujo]);
  const salvar = trpc.maquete3d.salvarModelo.useMutation({ onSuccess: r => { setVersao(r.versao); setSujo(false); toast.success("Planta salva."); recarregar(); }, onError: falha });
  const montarImplantacao = trpc.maquete3d.implantacaoDoEstudo.useMutation({
    onSuccess: r => {
      toast.success(`Implantação montada: ${r.lotes} lote(s), ${r.ruas} trecho(s) de rua${r.temTerreno ? "" : ", sem a divisa do terreno"}${r.temRelevo ? ", com a topografia do estudo" : ""}.`);
      if (!r.temRelevo) toast.warning("O estudo não tem a topografia carregada (aba Topografia 3D): o terreno foi desenhado plano.");
      if (r.semCenario) toast.warning("O estudo ainda não tem estudo de massa: só o terreno foi desenhado.");
      if (r.descartados) toast.warning(`${r.descartados} lote(s) com geometria inválida ficaram de fora.`);
      if (r.areas > 1) toast.info(`O terreno tem ${r.areas} áreas separadas: o muro do condomínio cerca cada uma, com o seu portão.`);
      if (r.portoesReposicionados) toast.warning("O contorno do terreno mudou: os portões editados foram levados ao ponto da nova divisa mais perto de onde estavam. Confira em \"Muro do condomínio\" e salve.");
      setSujo(false); recarregar();
    },
    onError: falha,
  });
  const validar = trpc.maquete3d.validar.useMutation({ onSuccess: () => { toast.success("Planta validada."); recarregar(); }, onError: falha });

  // Visualizador 3D, apresentação comercial e publicação do link.
  const [comercial, setComercial] = useState<{ nome: string; localizacao: string; preco: string; whatsapp: string } | null>(null);
  useEffect(() => { if (d && !comercial) setComercial({ nome: d.comercial.nome, localizacao: d.comercial.localizacao, preco: d.comercial.preco === null ? "" : String(d.comercial.preco), whatsapp: d.comercial.whatsapp }); }, [d, comercial]);
  const salvarComercial = trpc.maquete3d.salvarComercial.useMutation({ onSuccess: () => { toast.success("Apresentação salva."); recarregar(); }, onError: falha });
  const avisoEmail = (r: { enviado: boolean; para: string | null; motivo?: string } | null) => {
    if (!r) return;
    if (r.enviado) toast.success(`E-mail enviado para ${r.para}.`); else toast.warning(`E-mail não enviado: ${r.motivo ?? "falha no envio."}`);
  };
  const publicar = trpc.maquete3d.publicar.useMutation({ onSuccess: r => { toast.success("Maquete publicada. O link já abre para o cliente."); avisoEmail(r.email); recarregar(); }, onError: falha });
  const reenviar = trpc.maquete3d.reenviarEmail.useMutation({ onSuccess: avisoEmail, onError: falha });
  const [faixaAprovada, setFaixaAprovada] = useState<FaixaPreco | null>(null);
  const aprovar = trpc.maquete3d.aprovarPedido.useMutation({ onSuccess: r => { toast.success(`Pedido aprovado por ${reais(r.preco)}. O cliente já pode pagar no portal.`); avisoEmail(r.email); recarregar(); }, onError: falha });
  const precosPadrao = trpc.maquete3d.config.useQuery().data?.precos;
  const despublicar = trpc.maquete3d.despublicar.useMutation({ onSuccess: () => { toast.success("Link tirado do ar."); recarregar(); }, onError: falha });

  if (detalhe.isLoading) return <p className="text-sm text-gray-400">Carregando…</p>;
  if (!d) return <p className="text-sm text-red-300">{detalhe.error?.message ?? "Maquete não encontrada."}</p>;

  const aguardando = d.status === "aguardando_pagamento" || d.status === "aguardando_autorizacao";
  /** QA rodada 2, N1: com um passo sendo lido pela IA, confirmar, seguir sem a IA e ler de novo esperam ele terminar. */
  const emCurso = d.status === "em_leitura" && d.ia.emCurso;
  const podeLer = ["liberada", "em_leitura", "em_revisao", "validada"].includes(d.status);
  const podeRevisar = d.status === "em_revisao" || d.status === "validada";
  const erros = d.problemas.filter(p => p.nivel === "erro"), avisos = d.problemas.filter(p => p.nivel === "aviso");
  const alvoId = (d.projectId ?? d.studyId)!;
  // S-05: importar planta arquitetônica (e restaurar versões) também em maquete validada ou publicada.
  const podeImportar = ["liberada", "em_revisao", "validada", "publicada"].includes(d.status) && !lendo;
  const aposRestaurar = () => { setSujo(false); recarregar(); };

  const link = `${window.location.origin}/maquete/${d.token}`;

  return (
    <>
      <Card className={cardCls}>
        <CardHeader><CardTitle className="flex flex-wrap items-center gap-3 text-lg">{d.titulo}<Selo status={d.status} /></CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid gap-2 sm:grid-cols-4">
            <p><span className="block text-xs text-gray-400">Origem</span>{d.origem === "incorporacao" ? "Incorporação" : d.leadId ? "Cliente do CRM" : "Projeto de cliente"}</p>
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
                <EscolhaDocumentos lista={d.disponiveis} escolhidos={trocandoDocs} onChange={setTrocandoDocs} vazio="Nenhum PDF neste pedido ainda. Envie um PDF avulso abaixo." />
                <CampoPdfAvulso arquivos={novosPdfs} onChange={setNovosPdfs} limite={MAX_DOCUMENTOS - d.documentos.length} />
                {novosPdfs.length > 0 && <Button size="sm" className={btnOuro} disabled={anexando} onClick={enviarNovosPdfs}>{anexando ? "Enviando…" : `Enviar ${novosPdfs.length} PDF(s)`}</Button>}
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

          {d.status === "aguardando_aprovacao" && (
            <div className="space-y-2 rounded-lg border border-amber-400/30 p-3">
              <p>Pedido feito pelo cliente no portal. Confira a faixa com o projeto e aprove: só então a cobrança é liberada para ele pagar pelo Asaas.</p>
              {admin ? (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-xs text-gray-300">Faixa de preço
                    <select className={inputCls} value={faixaAprovada ?? (d.faixaPreco as FaixaPreco) ?? "terrea_ate_70"} onChange={e => setFaixaAprovada(e.target.value as FaixaPreco)}>
                      {FAIXAS_PRECO.map(f => <option key={f} value={f}>{ROTULOS_FAIXA[f]}{precosPadrao ? ` — ${reais(precosPadrao[f])}` : ""}</option>)}
                    </select></label>
                  <Button className={btnOuro} disabled={aprovar.isPending} onClick={() => aprovar.mutate({ id, faixaPreco: faixaAprovada ?? (d.faixaPreco as FaixaPreco) ?? "terrea_ate_70" })}><Check className="mr-1 h-4 w-4" />Aprovar e liberar o pagamento</Button>
                </div>
              ) : <p className="text-xs text-gray-400">Só o administrador aprova o pedido.</p>}
              {!d.emailCliente && <p className="text-xs text-amber-300">O cliente não tem e-mail no cadastro: ele verá a aprovação no portal, mas não receberá o aviso por e-mail.</p>}
            </div>
          )}

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
                      <span className={p.estado === "feito" ? "text-emerald-400" : p.estado === "erro" ? "text-red-300" : p.estado === "aguardando" ? "text-amber-300" : "text-gray-400"}>{p.estado === "feito" ? "✓" : p.estado === "erro" ? "✕" : p.estado === "aguardando" ? "‖" : "○"}</span>
                      <span>{p.rotulo}</span>
                      {p.estado === "feito" && (p.tipo === "prancha" || p.tipo === "prancha_ia") && <span className="text-xs text-gray-400">
                        {p.motor === "ia" ? `— lida pela IA (modelo ${p.modelo ?? "?"}${p.tokens ? `, ${p.tokens.entrada.toLocaleString("pt-BR")} + ${p.tokens.saida.toLocaleString("pt-BR")} tokens` : ""})`
                          : p.motor === "pulada" ? "— sem a IA: ficou o que o leitor próprio leu" : "— lida pelo leitor próprio"}</span>}
                      {p.estado === "pendente" && p.motivoIA && <span className="text-xs text-gray-400">— {p.motivoIA}</span>}
                      {p.estado === "executando" && <span className="text-xs text-amber-300">— sendo lida pela IA em segundo plano (pode fechar a página)</span>}
                      {p.envioMotivo && <span className="text-xs text-gray-400">— {p.envioMotivo}</span>}
                      {p.erro && <span className={p.estado === "aguardando" ? "text-amber-300" : "text-red-300"}>— {p.erro}</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {d.status === "em_leitura" && <AndamentoLeitura passos={d.passos} trabalhando={lendo} usadas={d.ia.lidasNaMaquete} teto={d.ia.teto}
              aoCancelar={chave => cancelarIA.mutate({ id, chave })} cancelando={cancelarIA.isPending} />}
            {d.status === "em_leitura" && d.progresso.proximo?.estado === "erro" && d.progresso.proximo.tipo === "prancha_ia" && (
              <Button variant="outline" className={btnOutline} disabled={lendo || emCurso || pularIA.isPending}
                onClick={() => { if (window.confirm("Seguir sem a IA? Essas pranchas ficam com o que o leitor próprio leu (pode ser nada); a planta pode ser desenhada na revisão.")) void decidirIA(false); }}>Continuar sem a IA</Button>
            )}
            {d.status === "em_leitura" && d.progresso.proximo?.estado === "aguardando" && (
              <div className="space-y-2 rounded-lg border border-amber-400/30 p-3">
                {d.passos.find(p => p.estado === "aguardando")?.aguardando === "confirmacao" ? (
                  <>
                    <p>{d.ia.pendentes} prancha(s) não podem ser lidas pelo leitor próprio e precisam da leitura por IA, que é paga (cobrada pela Anthropic por tokens). A confirmação vale só para esta leitura e para as pranchas autorizadas (esta maquete já usou {d.ia.lidasNaMaquete} de {d.ia.teto ?? "—"} pela IA).</p>
                    {admin ? <Button className={btnOuro} disabled={lendo || emCurso || confirmarIA.isPending} onClick={() => decidirIA(true)}><Check className="mr-1 h-4 w-4" />{rotuloConfirmarIA(modeloAConfirmar, "Confirmar a leitura pela IA (até o teto da maquete)")}</Button>
                      : <p className="text-xs text-gray-400">Só o administrador autoriza a leitura paga pela IA.</p>}
                  </>
                ) : d.passos.find(p => p.estado === "aguardando")?.aguardando === "teto" ? (
                  <>
                    <p>{d.passos.find(p => p.estado === "aguardando")?.erro}</p>
                    {admin ? <Button className={btnOuro} disabled={lendo || emCurso || confirmarIA.isPending}
                      onClick={() => { if (window.confirm(perguntaAlemDoTeto(d.ia.pendentes, d.ia.teto, modeloAConfirmar))) void decidirIA(true, true); }}><Check className="mr-1 h-4 w-4" />{rotuloConfirmarIA(modeloAConfirmar, `Autorizar além do teto (${d.ia.pendentes} prancha(s))`)}</Button>
                      : <p className="text-xs text-gray-400">Só o administrador autoriza passar do teto de pranchas pela IA.</p>}
                  </>
                ) : <p>Cadastre a chave em Integrações → Anthropic e clique em “Continuar leitura”: ela retoma deste passo, sem perder o que já foi lido.</p>}
                <Button variant="outline" className={btnOutline} disabled={lendo || emCurso || pularIA.isPending}
                  onClick={() => { if (window.confirm("Seguir sem a IA? Essas pranchas ficam com o que o leitor próprio leu (pode ser nada); a planta pode ser desenhada na revisão.")) void decidirIA(false); }}>Continuar sem a IA</Button>
              </div>
            )}
            {d.ia.foraDoLimite.map(a => <p key={a} className="text-xs text-amber-300">{a}</p>)}
            <div className="flex flex-wrap items-center gap-2">
              {d.status === "liberada" && <Button className={btnOuro} disabled={lendo || !d.documentos.length} onClick={() => ler(true)}><Play className="mr-1 h-4 w-4" />Gerar maquete (ler o projeto)</Button>}
              {d.status === "em_leitura" && <Button className={btnOuro} disabled={lendo} onClick={() => ler(false)}><Play className="mr-1 h-4 w-4" />{rotuloContinuarLeitura(d.progresso.proximo?.estado, d.passos.find(p => p.estado === "aguardando")?.aguardando)}</Button>}
              {(d.status === "em_revisao" || d.status === "validada" || d.status === "em_leitura") && <Button variant="outline" className={btnOutline} disabled={lendo || emCurso || !d.documentos.length}
                onClick={() => { if (window.confirm("Ler o projeto de novo apaga a planta atual e as correções feitas na revisão. Continuar?")) { setSujo(false); ler(true); } }}><RefreshCw className="mr-1 h-4 w-4" />Ler de novo do zero</Button>}
              {emCurso && <span className="text-amber-300">Uma prancha está sendo lida pela IA: aguarde terminar (ou cancele a leitura pela IA) para confirmar, seguir sem a IA ou ler de novo.</span>}
            </div>
            {d.escalas.length > 0 && <p className="text-xs text-gray-300">Escala usada: {d.escalas.map(e => `${e.titulo || "planta"} ${e.escala ? `1:${e.escala}` : "sem escala legível"}${e.lidaPor === "ia" ? " (lida pela IA)" : ""}${!e.escala ? " — acerte uma medida conhecida na revisão" : e.origem === "texto" ? "" : e.origem === "areas" ? " (conferida pelas áreas)" : " (suposta — confira)"}`).join(" · ")}</p>}
            {d.avisosDaLeitura.map(a => <p key={a} className="text-xs text-amber-300">{a}</p>)}
            {!d.documentos.length && <p className="text-amber-300">{d.origem === "incorporacao" ? "Para a casa-tipo ou o prédio, escolha os PDFs do projeto. O loteamento não precisa de PDF." : "Escolha os PDFs do projeto antes de gerar."}</p>}
            {d.origem === "incorporacao" && ["liberada", "em_revisao", "validada"].includes(d.status) && (
              <div className="space-y-1 border-t border-[#C9A961]/15 pt-3">
                <Button variant="outline" className={btnOutline} disabled={lendo || montarImplantacao.isPending}
                  onClick={() => { if (!sujo || window.confirm("Há alterações não salvas na planta. Montar a implantação descarta essas alterações. Continuar?")) montarImplantacao.mutate({ id }); }}>
                  <RefreshCw className="mr-1 h-4 w-4" />{d.modelo?.implantacao ? "Atualizar a implantação a partir do estudo" : "Montar a implantação a partir do estudo"}
                </Button>
                <p className="text-xs text-gray-400">Usa o terreno (KML) e o cenário escolhido do estudo de massa: ruas e lotes. Sem IA e sem PDF. As edificações já lidas são mantidas.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {["liberada", "em_revisao", "validada"].includes(d.status) && (
        <TipoEPadrao id={id} tipoAtual={d.tipo as TipoMaquete} temLidas={!!d.modelo?.edificacoes.some(e => !ehPadrao(e))} temImplantacao={!!d.modelo?.implantacao}
          incorporacao={d.origem === "incorporacao"} sujo={sujo} aoAplicar={() => { setSujo(false); recarregar(); }} />
      )}

      {rascunho && (
        <Card className={cardCls}>
          <CardHeader><CardTitle className="flex flex-wrap items-center justify-between gap-2 text-lg">
            <span>Revisão da planta</span>
            {d.resumo && <span className="text-sm font-normal text-gray-300">{d.resumo.areaTotal.toLocaleString("pt-BR")} m² · {d.resumo.pavimentos} pavimento(s) · {d.resumo.quartos} quarto(s) ({d.resumo.suites} suíte) · {d.resumo.banheiros} banheiro(s) · {d.resumo.vagas} vaga(s)</span>}
          </CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <EditorPlanta modelo={rascunho} maqueteId={id} pranchas={d.pranchas} somenteLeitura={!podeRevisar} onChange={m => { setRascunho(m); setSujo(true); }} />
            {rascunho.implantacao && <EditorMuro modelo={rascunho} somenteLeitura={!podeRevisar} onChange={m => { setRascunho(m); setSujo(true); }} />}

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
            {podeImportar && <ImportarPlanta d={d} admin={admin} sujo={sujo} aoMudar={recarregar} />}
            <HistoricoPlanta d={d} admin={admin} sujo={sujo} aoMudar={aposRestaurar} />
          </CardContent>
        </Card>
      )}

      {!rascunho && podeImportar && (
        <Card className={cardCls}>
          <CardHeader><CardTitle className="text-lg">Revisão da planta</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-gray-300">Ainda não há planta. Gere a maquete pela leitura do projeto, use a construção padrão ou importe a planta arquitetônica.</p>
            <ImportarPlanta d={d} admin={admin} sujo={sujo} aoMudar={recarregar} />
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
                {d.modelo && publicadoSemMuro(d.modelo) && (
                  <p className="rounded-md border border-amber-400/40 bg-amber-500/10 p-2 text-xs text-amber-200">Condomínio publicado antes do muro: revise e publique de novo para o cliente ver o muro. Até lá, o link continua como foi publicado, sem o muro (tire do ar, revise o muro na planta, valide e publique).</p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <a href={link} target="_blank" rel="noreferrer" className="break-all text-[#C9A961] underline">{link}</a>
                  <Button size="sm" variant="outline" className={btnOutline} onClick={() => { void navigator.clipboard.writeText(link).then(() => toast.success("Link copiado.")); }}><Copy className="mr-1 h-4 w-4" />Copiar</Button>
                  {d.clienteTelefone && (
                    <a target="_blank" rel="noreferrer" href={`https://wa.me/${(d.clienteTelefone.replace(/\D/g, "").length <= 11 ? "55" : "") + d.clienteTelefone.replace(/\D/g, "")}?text=${encodeURIComponent(`Olá! A sua maquete 3D ficou pronta. Abra para ver a casa por dentro e por fora: ${link}`)}`}>
                      <Button size="sm" variant="outline" className="border-emerald-400/50 bg-transparent text-emerald-300">Enviar ao cliente pelo WhatsApp</Button>
                    </a>
                  )}
                </div>
                {d.origem === "projeto" && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-300">
                    <span>{d.emailCliente ? `E-mail do cliente: ${d.emailCliente}` : "O cliente não tem e-mail no cadastro: envie o link pelo WhatsApp."}</span>
                    {d.emailCliente && <Button size="sm" variant="outline" className={btnOutline} disabled={reenviar.isPending} onClick={() => reenviar.mutate({ id })}>Reenviar o e-mail com o link</Button>}
                  </div>
                )}
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
