// Pedido de 25/10: Conversas do WhatsApp — ver respostas dos clientes e continuar a conversa pelo sistema.
// Lote 03 (29/10/2026): seleção múltipla com exclusão em lote (01) e "Vincular lead" (02).
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { ArrowLeft, Download, ExternalLink, Link2, RefreshCw, Send, Trash2, Unlink, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { alternarItem, alternarTodosVisiveis, chaveTelefone, podarSelecao, textoConfirmacaoExclusao } from "@shared/whatsapp/conversas";

const hora = (d: string | Date) => new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const formatar = (n: string) => {
  const d = n.replace(/\D/g, "").replace(/^55/, "");
  return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : n;
};

type Midia = { tipo: string; mime: string | null; nome: string | null; tamanho: number | null; baixada: boolean };

/** Pedido de 25/10 (noite): imagem em miniatura (abre grande), áudio/vídeo com player e documento para baixar. */
function MidiaMensagem({ id, midia }: { id: number; midia: Midia }) {
  const utils = trpc.useUtils();
  const [grande, setGrande] = useState(false);
  const deNovo = trpc.whatsapp.baixarMidiaDeNovo.useMutation({
    onSuccess: () => { toast.success("Arquivo baixado."); utils.whatsapp.mensagensConversa.invalidate(); },
    onError: e => toast.error(e.message),
  });
  if (!midia.baixada) {
    const grandeDemais = (midia.tamanho ?? 0) > 10 * 1024 * 1024;
    return (
      <div className="mb-1 text-xs text-gray-300">
        {grandeDemais ? "Arquivo maior que 10 MB (veja no celular)." : (
          <button type="button" disabled={deNovo.isPending} onClick={() => deNovo.mutate({ id })} className="inline-flex items-center gap-1 underline">
            <RefreshCw className="h-3 w-3" /> {deNovo.isPending ? "Baixando..." : "Tentar baixar de novo"}
          </button>
        )}
      </div>
    );
  }
  const url = `/api/whatsapp/midia/${id}`;
  if (midia.tipo === "imagem" || midia.tipo === "figurinha") {
    return (
      <>
        <button type="button" onClick={() => setGrande(true)} className="mb-1 block">
          <img src={url} alt={midia.nome ?? "Imagem recebida"} loading="lazy" className={`rounded ${midia.tipo === "figurinha" ? "max-h-24" : "max-h-48"} max-w-full object-contain`} />
        </button>
        {grande && (
          <Dialog open onOpenChange={aberto => { if (!aberto) setGrande(false); }}>
            <DialogContent aria-describedby={undefined} showCloseButton={false} className="flex items-center justify-center border-0 bg-transparent p-0 shadow-none sm:max-w-4xl">
              <DialogTitle className="sr-only">Imagem ampliada</DialogTitle>
              <button type="button" aria-label="Fechar imagem" onClick={() => setGrande(false)} className="flex justify-center">
                <img src={url} alt={midia.nome ?? "Imagem recebida"} className="max-h-[calc(100dvh-2rem)] max-w-full object-contain" />
              </button>
            </DialogContent>
          </Dialog>
        )}
      </>
    );
  }
  if (midia.tipo === "audio") return <audio controls preload="none" src={url} className="mb-1 max-w-full" />;
  if (midia.tipo === "video") return <video controls preload="metadata" src={url} className="mb-1 max-h-64 max-w-full rounded" />;
  return (
    <>
      <button type="button" onClick={() => setGrande(true)} className="mb-1 inline-flex items-center gap-1 text-xs underline"><Download className="h-3 w-3" />{midia.nome ?? "Abrir documento"}</button>
      {grande && <Dialog open onOpenChange={aberto => { if (!aberto) setGrande(false); }}><DialogContent aria-describedby={undefined} showCloseButton={false} className="flex h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogTitle className="sr-only">Visualizador de documento</DialogTitle>
        <div className="flex items-center justify-between bg-[#1A2332] p-3 text-white"><button type="button" onClick={() => setGrande(false)} className="inline-flex items-center gap-2 text-sm font-bold"><ArrowLeft size={16}/>Voltar à conversa</button><button type="button" aria-label="Fechar documento" onClick={() => setGrande(false)}><X size={18}/></button></div>
        {midia.mime === "application/pdf" || midia.nome?.toLowerCase().endsWith(".pdf")
          ? <iframe src={url} title={midia.nome ?? "Documento PDF"} className="min-h-0 flex-1 bg-white" />
          : <div className="bg-white p-5 text-gray-900"><p>Este tipo de arquivo deve ser aberto no aplicativo compatível.</p><a href={url} target="_blank" rel="noopener noreferrer" download={midia.nome ?? undefined} className="mt-3 inline-block underline">Baixar ou abrir arquivo em outra aba</a></div>}
      </DialogContent></Dialog>}
    </>
  );
}

const ORIGEM: Record<string, string> = { manual: "vinculado manualmente", telefone: "identificado pelo telefone", mensagem: "registrado nas mensagens" };

/**
 * Lote 03, correção 02: busca de lead (nome, telefone ou CPF) para vincular à conversa. No modo "duplicado"
 * (antes de "Criar lead"), lista os leads com o mesmo telefone e permite criar um novo assim mesmo.
 */
function VincularLeadDialog({ numero, modo, onFechar, onVinculado, onCriarMesmoAssim }: {
  numero: string; modo: "vincular" | "duplicado"; onFechar: () => void; onVinculado: () => void; onCriarMesmoAssim: () => void;
}) {
  const [termo, setTermo] = useState("");
  const [busca, setBusca] = useState("");
  useEffect(() => { const t = setTimeout(() => setBusca(termo), 300); return () => clearTimeout(t); }, [termo]);
  const candidatos = trpc.whatsapp.buscarLeadsParaVincular.useQuery({ numero, termo: busca });
  const vincular = trpc.whatsapp.vincularLead.useMutation({
    onSuccess: () => { toast.success("Conversa vinculada ao lead."); onVinculado(); },
    onError: e => toast.error(e.message),
  });
  const lista = candidatos.data ?? [];
  const mesmos = lista.filter(l => l.mesmoTelefone).length;
  return (
    <Dialog open onOpenChange={aberto => { if (!aberto) onFechar(); }}>
      <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[#C9A961]">{modo === "duplicado" ? "Já existe lead com este telefone" : "Vincular lead"}</DialogTitle>
          <DialogDescription className="text-gray-300">
            {modo === "duplicado"
              ? "Para não duplicar o cadastro, vincule a conversa a um lead existente ou crie um novo assim mesmo."
              : "Busque por nome, telefone ou CPF. O cadastro do lead não é alterado."}
          </DialogDescription>
        </DialogHeader>
        <Input autoFocus placeholder="Nome, telefone ou CPF" value={termo} onChange={e => setTermo(e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" />
        {mesmos > 1 && <p className="text-xs text-yellow-200">Este telefone está em {mesmos} leads. Escolha qual é o desta conversa.</p>}
        <div className="max-h-72 overflow-y-auto space-y-1">
          {candidatos.isLoading && <p className="text-xs text-gray-300 p-2">Buscando…</p>}
          {!candidatos.isLoading && lista.length === 0 && <p className="text-xs text-gray-300 p-2">{busca ? "Nenhum lead encontrado." : "Nenhum lead com o telefone desta conversa. Digite para buscar."}</p>}
          {lista.map(l => (
            <div key={l.id} className="flex items-center justify-between gap-2 rounded border border-white/10 p-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{l.nome}</p>
                <p className="truncate text-xs text-gray-300">{[l.telefone, l.cpf ? `CPF ${l.cpf}` : null, `Lead #${l.id}`].filter(Boolean).join(" · ")}</p>
                {l.mesmoTelefone && <span className="text-[10px] font-bold uppercase text-green-400">mesmo telefone</span>}
              </div>
              <Button size="sm" disabled={vincular.isPending} className="h-7 shrink-0 bg-[#C9A961] text-[#1A2332] hover:bg-[#B8985A] text-xs"
                onClick={() => vincular.mutate({ numero, leadId: l.id })}>Vincular</Button>
            </div>
          ))}
        </div>
        {modo === "duplicado" && (
          <Button variant="outline" className="border-[#C9A961]/30 text-[#C9A961]" onClick={onCriarMesmoAssim}>
            <UserPlus className="h-4 w-4 mr-1" /> Criar lead novo mesmo assim
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Rótulo gravado no texto ("[imagem] legenda") vira só a legenda quando o arquivo aparece. */
const legenda = (texto: string, midia: Midia | null) => (midia?.baixada ? texto.replace(/^\[(imagem|áudio|vídeo|documento|figurinha)\]\s*/, "") : texto);

export function ConversasWhatsApp({ numeroInicial }: { numeroInicial?: string | null }) {
  const utils = trpc.useUtils();
  const [numero, setNumero] = useState<string | null>(numeroInicial ?? null);
  const [texto, setTexto] = useState("");
  const [busca, setBusca] = useState("");
  const fim = useRef<HTMLDivElement>(null);
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [confirmarLote, setConfirmarLote] = useState(false);
  const [dialogoLead, setDialogoLead] = useState<"vincular" | "duplicado" | null>(null);

  const ativar = trpc.whatsapp.ativarAvisos.useMutation({ onError: e => toast.error(e.message) });
  useEffect(() => { ativar.mutate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const conversas = trpc.whatsapp.conversas.useQuery(undefined, { refetchInterval: 5000 });
  const mensagens = trpc.whatsapp.mensagensConversa.useQuery({ numero: numero ?? "" }, { enabled: Boolean(numero), refetchInterval: 4000 });
  const responder = trpc.whatsapp.responder.useMutation({
    onSuccess: () => { setTexto(""); utils.whatsapp.mensagensConversa.invalidate(); utils.whatsapp.conversas.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const criarLead = trpc.whatsapp.criarLeadDaConversa.useMutation({
    onSuccess: () => { toast.success("Lead criado no CRM."); setDialogoLead(null); utils.whatsapp.conversas.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const desvincular = trpc.whatsapp.desvincularLead.useMutation({
    onSuccess: () => { toast.success("Vínculo desfeito."); utils.whatsapp.conversas.invalidate(); },
    onError: e => toast.error(e.message),
  });
  // Lote 03, correção 02: antes de criar, confere se já existe lead com o mesmo telefone.
  const [conferindo, setConferindo] = useState(false);
  async function iniciarCriarLead(n: string, nome: string | null) {
    setConferindo(true);
    try {
      const mesmos = (await utils.whatsapp.buscarLeadsParaVincular.fetch({ numero: n, termo: "" })).filter(l => l.mesmoTelefone);
      if (mesmos.length) setDialogoLead("duplicado");
      else criarLead.mutate({ numero: n, nome: nome ?? undefined });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui conferir os leads.");
    } finally { setConferindo(false); }
  }
  // Lote 03, correção 01: exclusão em lote (só no sistema; o celular mantém as mensagens).
  const previaLote = trpc.whatsapp.previaExclusaoConversas.useQuery({ numeros: selecionadas }, { enabled: confirmarLote && selecionadas.length > 0 });
  const excluirLote = trpc.whatsapp.excluirConversas.useMutation({
    onSuccess: (r, v) => {
      toast.success(`${r.conversas} conversa(s) excluída(s) (${r.apagadas} mensagem(ns)).`);
      if (numero && v.numeros.some(n => chaveTelefone(n) === chaveTelefone(numero))) setNumero(null);
      setSelecionadas([]); setConfirmarLote(false);
      utils.whatsapp.conversas.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  // Pedido de 25/10 (noite): excluir conversa só no sistema (não apaga no celular).
  const excluir = trpc.whatsapp.excluirConversa.useMutation({
    onSuccess: (r, v) => {
      toast.success(`Conversa excluída (${r.apagadas} mensagem(ns)).`);
      if (numero && v.numero.slice(-8) === numero.replace(/\D/g, "").slice(-8)) setNumero(null);
      utils.whatsapp.conversas.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const confirmarExclusao = (n: string, nome: string | null) => {
    if (window.confirm(`Excluir a conversa com ${nome ?? formatar(n)}? As mensagens saem do sistema, mas continuam no celular.`)) excluir.mutate({ numero: n });
  };
  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [mensagens.data?.length]);

  const lista = (conversas.data ?? []).filter(c => !busca || (c.nome ?? "").toLowerCase().includes(busca.toLowerCase()) || c.numero.includes(busca.replace(/\D/g, "")));
  const atual = (conversas.data ?? []).find(c => numero && c.numero.replace(/\D/g, "").endsWith(numero.replace(/\D/g, "").slice(-8)));
  const visiveis = lista.map(c => c.numero);
  const todasVisiveis = visiveis.length > 0 && visiveis.every(n => selecionadas.includes(n));
  // Conversa que sumiu (excluída em outra aba, por exemplo) sai da seleção.
  useEffect(() => {
    if (conversas.data) setSelecionadas(s => podarSelecao(s, conversas.data.map(c => c.numero)));
  }, [conversas.data]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4 min-h-[520px]">
      <div className="rounded-lg border border-[#C9A961]/20 bg-[#2C3E50] flex flex-col">
        <div className="p-3 border-b border-[#C9A961]/10 space-y-2">
          <Input placeholder="Buscar conversa..." value={busca} onChange={e => setBusca(e.target.value)} className="bg-[#1A2332] border-[#C9A961]/30 text-white" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs text-gray-300">
              <input type="checkbox" className="accent-[#C9A961]" checked={todasVisiveis} disabled={!visiveis.length}
                onChange={() => setSelecionadas(s => alternarTodosVisiveis(s, visiveis))} aria-label="Selecionar todas as conversas da lista" />
              Selecionar todas ({visiveis.length})
            </label>
            <span className="text-xs text-gray-300">{selecionadas.length} selecionada(s)</span>
            <Button size="sm" variant="outline" disabled={!selecionadas.length || excluirLote.isPending} onClick={() => setConfirmarLote(true)}
              className="h-7 border-red-400/40 text-xs text-red-300 hover:bg-red-500/10">
              <Trash2 className="h-3 w-3 mr-1" /> Excluir selecionadas
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto max-h-[560px]">
          {lista.length === 0 && <p className="p-4 text-sm text-gray-300">Nenhuma conversa ainda. As mensagens recebidas aparecem aqui sozinhas.</p>}
          {lista.map(c => (
            <div key={c.numero} className={`flex items-stretch border-b border-white/5 ${numero && c.numero.endsWith(numero.slice(-8)) ? "bg-[#C9A961]/10" : ""}`}>
              <label className="flex items-center pl-3">
                <input type="checkbox" className="accent-[#C9A961]" checked={selecionadas.includes(c.numero)}
                  onChange={() => setSelecionadas(s => alternarItem(s, c.numero))} aria-label={`Selecionar conversa com ${c.nome ?? formatar(c.numero)}`} />
              </label>
              <button onClick={() => setNumero(c.numero)} className="min-w-0 flex-1 text-left px-3 py-3 hover:bg-white/5">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold text-sm text-white truncate">{c.nome ?? formatar(c.numero)}</p>
                  {c.naoLidas > 0 && <span className="rounded-full bg-green-600 px-2 text-xs font-bold text-white">{c.naoLidas}</span>}
                </div>
                <p className="text-xs text-gray-300 truncate">{c.ultima}</p>
                <p className="text-[11px] text-gray-400">{hora(c.quando)}</p>
              </button>
              <button type="button" title="Excluir conversa" aria-label={`Excluir conversa com ${c.nome ?? formatar(c.numero)}`} disabled={excluir.isPending}
                onClick={() => confirmarExclusao(c.numero, c.nome)} className="px-3 text-gray-400 hover:text-red-400">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-[#C9A961]/20 bg-[#2C3E50] flex flex-col">
        {!numero ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-300 p-6">Escolha uma conversa à esquerda.</div>
        ) : (
          <>
            <div className="p-3 border-b border-[#C9A961]/10 flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="font-bold text-white">{atual?.nome ?? formatar(numero)}</p>
                <p className="text-xs text-gray-300">{formatar(numero)}</p>
              </div>
              {atual && !atual.leadId && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={criarLead.isPending || conferindo} className="h-7 text-xs border-[#C9A961]/30 text-[#C9A961]"
                    onClick={() => iniciarCriarLead(numero, atual.nome)}><UserPlus className="h-3 w-3 mr-1" /> Criar lead</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs border-[#C9A961]/30 text-[#C9A961]"
                    onClick={() => setDialogoLead("vincular")}><Link2 className="h-3 w-3 mr-1" /> Vincular lead</Button>
                </div>
              )}
              {atual?.leadId && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Link href={`/admin/crm/${atual.leadId}`} className="inline-flex items-center gap-1 text-[#C9A961] underline">
                    <ExternalLink className="h-3 w-3" /> Abrir lead no CRM
                  </Link>
                  {atual.vinculo && <span className="text-gray-400">({ORIGEM[atual.vinculo]})</span>}
                  <Button size="sm" variant="outline" className="h-7 text-xs border-[#C9A961]/30 text-[#C9A961]" onClick={() => setDialogoLead("vincular")}>
                    <Link2 className="h-3 w-3 mr-1" /> Trocar lead
                  </Button>
                  {atual.vinculo === "manual" && (
                    <Button size="sm" variant="outline" disabled={desvincular.isPending} className="h-7 text-xs border-red-400/40 text-red-300"
                      onClick={() => { if (window.confirm("Desfazer o vínculo desta conversa com o lead? O lead não é alterado.")) desvincular.mutate({ numero }); }}>
                      <Unlink className="h-3 w-3 mr-1" /> Desvincular
                    </Button>
                  )}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto max-h-[460px] p-3 space-y-2">
              {(mensagens.data ?? []).map(m => (
                <div key={m.id} className={`flex ${m.direcao === "saida" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${m.direcao === "saida" ? "bg-green-800 text-white" : "bg-[#1A2332] text-gray-100"}`}>
                    {m.midia && <MidiaMensagem id={m.id} midia={m.midia} />}
                    {legenda(m.mensagem, m.midia)}
                    <div className="text-[10px] text-gray-300 mt-1 text-right">{hora(m.quando)}{m.direcao === "saida" ? ` • ${m.status}` : ""}</div>
                  </div>
                </div>
              ))}
              <div ref={fim} />
            </div>
            <form className="p-3 border-t border-[#C9A961]/10 flex gap-2" onSubmit={e => { e.preventDefault(); if (texto.trim()) responder.mutate({ numero, texto }); }}>
              <Input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Escreva uma resposta..." className="bg-[#1A2332] border-[#C9A961]/30 text-white" />
              <Button type="submit" disabled={responder.isPending || !texto.trim()} className="bg-green-600 hover:bg-green-700 text-white"><Send className="h-4 w-4" /></Button>
            </form>
          </>
        )}
      </div>

      {dialogoLead && numero && (
        <VincularLeadDialog numero={numero} modo={dialogoLead} onFechar={() => setDialogoLead(null)}
          onVinculado={() => { setDialogoLead(null); utils.whatsapp.conversas.invalidate(); }}
          onCriarMesmoAssim={() => criarLead.mutate({ numero, nome: atual?.nome ?? undefined, forcar: true })} />
      )}

      <AlertDialog open={confirmarLote} onOpenChange={setConfirmarLote}>
        <AlertDialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir conversas selecionadas</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-300">
              {previaLote.data ? textoConfirmacaoExclusao(previaLote.data.conversas, previaLote.data.mensagens) : previaLote.error ? previaLote.error.message : "Contando mensagens…"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-gray-900">Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={!previaLote.data || excluirLote.isPending} className="bg-red-600 hover:bg-red-700"
              onClick={e => { e.preventDefault(); excluirLote.mutate({ numeros: selecionadas }); }}>
              {excluirLote.isPending ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
