// Pedido de 25/10 (noite), item 12: conexão do WhatsApp (QR code, estado, remover e conexões dos corretores).
// Admin: fica em Configurações › Integrações. Corretor/colaborador: aba "Minha conexão" da Central WhatsApp.
import { useState } from "react";
import { CheckCircle2, WifiOff, Wifi } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { ConexaoQrCode } from "@/components/whatsapp/ConexaoQrCode";

const cardCls = "bg-[#2C3E50] border-[#C9A961]/20";
const inputCls = "bg-[#1A2332] border-[#C9A961]/30 text-white";

function StatusConexao({ status }: { status: string }) {
  if (status === "conectado") {
    return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 text-green-400 text-xs font-bold rounded"><Wifi size={12} /> Conectado</span>;
  }
  return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-500/10 text-gray-400 text-xs font-bold rounded"><WifiOff size={12} /> Desconectado</span>;
}

export function ConexaoWhatsApp({ role, mostrarCorretores = true }: { role: string; mostrarCorretores?: boolean }) {
  const utils = trpc.useUtils();
  const [businessToken, setBusinessToken] = useState("");
  const [businessPhoneId, setBusinessPhoneId] = useState("");
  const [businessNumero, setBusinessNumero] = useState("");
  const conexao = trpc.whatsapp.minhaConexao.useQuery();
  const conexoesCorretores = trpc.whatsapp.conexoesCorretores.useQuery(undefined, { enabled: mostrarCorretores && (role === "admin" || role === "colaborador") });
  const salvarConexao = trpc.whatsapp.salvarConexao.useMutation({
    onSuccess: () => {
      toast.success("WhatsApp Business configurado com sucesso!");
      setBusinessToken(""); setBusinessPhoneId(""); setBusinessNumero("");
      utils.whatsapp.minhaConexao.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const desconectar = trpc.whatsapp.desconectar.useMutation({
    onSuccess: () => { toast.success("WhatsApp desconectado"); utils.whatsapp.minhaConexao.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const conexaoAtiva = conexao.data?.status === "conectado";

  return (
      <div className="space-y-5">
        {(role === "admin" || role === "colaborador" || role === "corretor") && (
          <Card className={cardCls}>
            <CardHeader><CardTitle className="text-sm text-gray-300">Minha Conexão WhatsApp</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {conexaoAtiva ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-3 bg-green-500/10 rounded">
                    <CheckCircle2 size={20} className="text-green-400" />
                    <div><p className="font-bold text-green-400 text-sm">{conexao.data?.provider === "evolution" ? "Conectado pelo QR code" : "Conectado via WhatsApp Business API"}</p>{conexao.data?.numero && <p className="text-xs text-gray-400">{conexao.data.numero}</p>}</div>
                  </div>
                  <Button variant="outline" onClick={() => desconectar.mutate()} disabled={desconectar.isPending}
                    className="border-red-500/30 text-red-400 hover:bg-red-500/10">
                    <WifiOff className="h-4 w-4 mr-2" /> {desconectar.isPending ? "Removendo..." : "Remover conexão"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                <ConexaoQrCode podeConfigurarServidor={role === "admin"} onConectado={() => utils.whatsapp.minhaConexao.invalidate()} />
                <details className="border-t border-[#C9A961]/10 pt-3">
                <summary className="cursor-pointer text-xs text-gray-300">Usar a API oficial do WhatsApp Business (Meta)</summary>
                <form onSubmit={(e) => { e.preventDefault(); salvarConexao.mutate({ token: businessToken, phoneNumberId: businessPhoneId, numero: businessNumero }); }} className="space-y-3 mt-3">
                  <div className="border border-blue-500/30 bg-blue-500/10 p-4 text-xs text-blue-300 rounded space-y-1">
                    <p className="font-bold">WhatsApp Business API (Meta Cloud API)</p>
                    <p>Gratuito até 1.000 conversas/mês. Requer conta Meta Business verificada.</p>
                    <a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noopener noreferrer" className="inline-block mt-1 font-bold underline">Ver guia de configuração →</a>
                  </div>
                  <div><Label className="text-gray-300">Token de Acesso Permanente</Label><Input value={businessToken} onChange={(e) => setBusinessToken(e.target.value)} placeholder="EAAxxxxxxxx..." required className={`${inputCls} mt-1`} /></div>
                  <div><Label className="text-gray-300">Phone Number ID</Label><Input value={businessPhoneId} onChange={(e) => setBusinessPhoneId(e.target.value)} placeholder="1234567890" required className={`${inputCls} mt-1`} /></div>
                  <div><Label className="text-gray-300">Número WhatsApp</Label><Input value={businessNumero} onChange={(e) => setBusinessNumero(e.target.value)} placeholder="+55 94 9 9999-9999" required className={`${inputCls} mt-1`} /></div>
                  <Button type="submit" disabled={salvarConexao.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
                    <CheckCircle2 className="h-4 w-4 mr-2" /> Salvar e Conectar
                  </Button>
                </form>
                </details>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {mostrarCorretores && (role === "admin" || role === "colaborador") && (
          <Card className={cardCls}>
            <CardHeader><CardTitle className="text-sm text-gray-300">Conexões dos Corretores {conexoesCorretores.data && conexoesCorretores.data.length > 0 && `(${conexoesCorretores.data.length})`}</CardTitle></CardHeader>
            <CardContent>
              {!conexoesCorretores.data?.length ? <p className="text-sm text-gray-400">Nenhum corretor cadastrado.</p> : (
                <div className="divide-y divide-[#C9A961]/10">
                  {conexoesCorretores.data.map((c) => (
                    <div key={c.userId} className="flex items-center gap-4 py-3">
                      <div className="w-8 h-8 bg-[#1A2332] flex items-center justify-center text-[#C9A961] font-black text-sm shrink-0 rounded">{c.nome[0]}</div>
                      <div className="flex-1 min-w-0"><p className="font-bold text-white text-sm truncate">{c.nome}</p>{c.numero && <p className="text-xs text-gray-400">{c.numero}</p>}</div>
                      <StatusConexao status={c.status} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
  );
}
