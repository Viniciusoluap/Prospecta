// Pedido de 25/10: conectar o WhatsApp escaneando um QR code (Evolution API no Railway).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
import { QrCode, RefreshCw, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

export function ConexaoQrCode({ podeConfigurarServidor, onConectado }: { podeConfigurarServidor: boolean; onConectado: () => void }) {
  // LOTE B (25/10): endereço e chave do servidor ficam só em Configurações › Integrações.
  const servidor = trpc.whatsapp.evolutionStatus.useQuery();
  const [qr, setQr] = useState<string | null>(null);

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

      {servidor.isSuccess && !configurado && (
        <p className="text-sm text-yellow-200 flex items-center gap-2">
          <Server size={14} /> Servidor do WhatsApp não configurado.
          {podeConfigurarServidor
            ? <Link href="/admin/integracoes" className="underline text-[#C9A961]">Configurar em Integrações</Link>
            : " Peça ao administrador para configurar em Integrações."}
        </p>
      )}

      {configurado && (
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
          <p className="text-xs text-gray-300">
            Servidor configurado em{" "}
            {podeConfigurarServidor ? <Link href="/admin/integracoes" className="underline text-[#C9A961]">Integrações</Link> : "Integrações"}
            {servidor.data?.url ? ` (${servidor.data.url})` : ""}.
          </p>
        </div>
      )}
    </div>
  );
}
