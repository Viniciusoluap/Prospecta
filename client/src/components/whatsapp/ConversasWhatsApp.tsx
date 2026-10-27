// Pedido de 25/10: Conversas do WhatsApp — ver respostas dos clientes e continuar a conversa pelo sistema.
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Download, RefreshCw, Send, Trash2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

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
          <div role="dialog" aria-label="Imagem ampliada" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setGrande(false)}>
            <img src={url} alt={midia.nome ?? "Imagem recebida"} className="max-h-full max-w-full object-contain" />
          </div>
        )}
      </>
    );
  }
  if (midia.tipo === "audio") return <audio controls preload="none" src={url} className="mb-1 max-w-full" />;
  if (midia.tipo === "video") return <video controls preload="metadata" src={url} className="mb-1 max-h-64 max-w-full rounded" />;
  return (
    <>
      <button type="button" onClick={() => setGrande(true)} className="mb-1 inline-flex items-center gap-1 text-xs underline"><Download className="h-3 w-3" />{midia.nome ?? "Abrir documento"}</button>
      {grande && <div role="dialog" aria-modal="true" aria-label="Visualizador de documento" className="fixed inset-0 z-50 flex flex-col bg-black/80 p-3 sm:p-6">
        <div className="flex items-center justify-between bg-[#1A2332] p-3 text-white"><button type="button" onClick={() => setGrande(false)} className="inline-flex items-center gap-2 text-sm font-bold"><ArrowLeft size={16}/>Voltar à conversa</button><button type="button" aria-label="Fechar documento" onClick={() => setGrande(false)}><X size={18}/></button></div>
        {midia.mime === "application/pdf" || midia.nome?.toLowerCase().endsWith(".pdf")
          ? <iframe src={url} title={midia.nome ?? "Documento PDF"} className="min-h-0 flex-1 bg-white" />
          : <div className="bg-white p-5 text-gray-900"><p>Este tipo de arquivo deve ser aberto no aplicativo compatível.</p><a href={url} target="_blank" rel="noopener noreferrer" download={midia.nome ?? undefined} className="mt-3 inline-block underline">Baixar ou abrir arquivo em outra aba</a></div>}
      </div>}
    </>
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

  const ativar = trpc.whatsapp.ativarAvisos.useMutation({ onError: e => toast.error(e.message) });
  useEffect(() => { ativar.mutate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const conversas = trpc.whatsapp.conversas.useQuery(undefined, { refetchInterval: 5000 });
  const mensagens = trpc.whatsapp.mensagensConversa.useQuery({ numero: numero ?? "" }, { enabled: Boolean(numero), refetchInterval: 4000 });
  const responder = trpc.whatsapp.responder.useMutation({
    onSuccess: () => { setTexto(""); utils.whatsapp.mensagensConversa.invalidate(); utils.whatsapp.conversas.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const criarLead = trpc.whatsapp.criarLeadDaConversa.useMutation({
    onSuccess: () => { toast.success("Lead criado no CRM."); utils.whatsapp.conversas.invalidate(); },
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

  return (
    <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4 min-h-[520px]">
      <div className="rounded-lg border border-[#C9A961]/20 bg-[#2C3E50] flex flex-col">
        <div className="p-3 border-b border-[#C9A961]/10">
          <Input placeholder="Buscar conversa..." value={busca} onChange={e => setBusca(e.target.value)} className="bg-[#1A2332] border-[#C9A961]/30 text-white" />
        </div>
        <div className="flex-1 overflow-y-auto max-h-[560px]">
          {lista.length === 0 && <p className="p-4 text-sm text-gray-300">Nenhuma conversa ainda. As mensagens recebidas aparecem aqui sozinhas.</p>}
          {lista.map(c => (
            <div key={c.numero} className={`flex items-stretch border-b border-white/5 ${numero && c.numero.endsWith(numero.slice(-8)) ? "bg-[#C9A961]/10" : ""}`}>
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
                <Button size="sm" variant="outline" disabled={criarLead.isPending} className="h-7 text-xs border-[#C9A961]/30 text-[#C9A961]"
                  onClick={() => criarLead.mutate({ numero, nome: atual.nome ?? undefined })}><UserPlus className="h-3 w-3 mr-1" /> Criar lead</Button>
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
    </div>
  );
}
