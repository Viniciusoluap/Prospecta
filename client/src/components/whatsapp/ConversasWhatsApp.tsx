// Pedido de 25/10: Conversas do WhatsApp — ver respostas dos clientes e continuar a conversa pelo sistema.
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Send, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

const hora = (d: string | Date) => new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const formatar = (n: string) => {
  const d = n.replace(/\D/g, "").replace(/^55/, "");
  return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : n;
};

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
            <button key={c.numero} onClick={() => setNumero(c.numero)}
              className={`w-full text-left px-3 py-3 border-b border-white/5 hover:bg-white/5 ${numero && c.numero.endsWith(numero.slice(-8)) ? "bg-[#C9A961]/10" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold text-sm text-white truncate">{c.nome ?? formatar(c.numero)}</p>
                {c.naoLidas > 0 && <span className="rounded-full bg-green-600 px-2 text-xs font-bold text-white">{c.naoLidas}</span>}
              </div>
              <p className="text-xs text-gray-300 truncate">{c.ultima}</p>
              <p className="text-[11px] text-gray-400">{hora(c.quando)}</p>
            </button>
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
                    {m.mensagem}
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
