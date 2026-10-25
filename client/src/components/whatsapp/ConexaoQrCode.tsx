// Pedido de 25/10: conectar o WhatsApp escaneando um QR code (Evolution API no Railway).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { QrCode, RefreshCw, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

const inputCls = "bg-[#1A2332] border-[#C9A961]/30 text-white";

export function ConexaoQrCode({ podeConfigurarServidor, onConectado }: { podeConfigurarServidor: boolean; onConectado: () => void }) {
  const utils = trpc.useUtils();
  const servidor = trpc.whatsapp.evolutionStatus.useQuery();
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [editarServidor, setEditarServidor] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  const salvar = trpc.whatsapp.salvarEvolution.useMutation({
    onSuccess: () => { toast.success("Servidor da Evolution conectado."); setApiKey(""); setEditarServidor(false); utils.whatsapp.evolutionStatus.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const conectar = trpc.whatsapp.conectarQr.useMutation({
    onSuccess: r => {
      if (r.status === "conectado") { toast.success("WhatsApp já está conectado."); onConectado(); return; }
      if (!r.qrCode) toast.warning("A Evolution ainda não gerou o QR. Clique em Gerar novamente em alguns segundos.");
      setQr(r.qrCode);
    },
    onError: e => toast.error(e.message),
  });
  // Enquanto o QR está na tela, pergunta o estado a cada 3 s; conectou → fecha o QR.
  const status = trpc.whatsapp.statusQr.useQuery(undefined, { enabled: qr !== null, refetchInterval: 3000 });
  useEffect(() => {
    if (qr && status.data?.status === "conectado") {
      setQr(null);
      toast.success("WhatsApp conectado!");
      onConectado();
    }
  }, [qr, status.data?.status, onConectado]);

  const configurado = servidor.data?.configurado;
  const src = qr ? (qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`) : null;

  return (
    <div className="space-y-4">
      <div className="border border-green-500/30 bg-green-500/10 p-4 text-xs text-green-200 rounded space-y-1">
        <p className="font-bold">Conectar pelo QR code (como no WhatsApp Web)</p>
        <p>Abra o WhatsApp no celular › Dispositivos conectados › Conectar dispositivo, e aponte para o QR abaixo.</p>
        <p>Conexão não oficial: use com moderação (envios em massa podem levar a bloqueio do número).</p>
      </div>

      {(!configurado || editarServidor) && podeConfigurarServidor && (
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); salvar.mutate({ url, apiKey }); }}>
          <p className="text-sm text-gray-300 flex items-center gap-2"><Server size={14} /> Servidor da Evolution (Railway)</p>
          <div><Label className="text-gray-300">Endereço do servidor</Label><Input value={url} onChange={e => setUrl(e.target.value.trim())} placeholder="https://evolution-xxxx.up.railway.app" required className={`${inputCls} mt-1`} /></div>
          <div><Label className="text-gray-300">Chave de acesso (AUTHENTICATION_API_KEY)</Label><Input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} required autoComplete="off" className={`${inputCls} mt-1`} /></div>
          <Button type="submit" disabled={salvar.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">{salvar.isPending ? "Testando..." : "Salvar e testar servidor"}</Button>
        </form>
      )}
      {!configurado && !podeConfigurarServidor && <p className="text-sm text-yellow-200">A equipe ainda não configurou o servidor do WhatsApp.</p>}

      {configurado && !editarServidor && (
        <div className="space-y-3">
          {src ? (
            <div className="flex flex-col items-center gap-3">
              <img src={src} alt="QR code para conectar o WhatsApp" className="w-64 h-64 bg-white p-2 rounded" />
              <p className="text-xs text-gray-300">Aguardando a leitura… o QR expira em cerca de 1 minuto.</p>
              <Button size="sm" variant="outline" className="border-[#C9A961]/30 text-[#C9A961]" disabled={conectar.isPending} onClick={() => conectar.mutate()}>
                <RefreshCw className="h-3 w-3 mr-1" /> Gerar novo QR
              </Button>
            </div>
          ) : (
            <Button disabled={conectar.isPending} onClick={() => conectar.mutate()} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
              <QrCode className="h-4 w-4 mr-2" /> {conectar.isPending ? "Gerando..." : "Gerar QR code"}
            </Button>
          )}
          {podeConfigurarServidor && (
            <button type="button" onClick={() => setEditarServidor(true)} className="block text-xs text-gray-300 underline">
              Trocar servidor da Evolution{servidor.data?.url ? ` (${servidor.data.url})` : ""}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
