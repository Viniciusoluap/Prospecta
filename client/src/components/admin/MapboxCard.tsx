// Mapbox (opcional) — pedido de 11/11: com o token PÚBLICO (pk.) o mapa do terreno usa o
// satélite do Mapbox (mais nítido em várias cidades); sem token tudo funciona com a Esri.
// Gêmeo de Grupo-Santa-Fe/web/src/app/admin/integracoes/_components/mapbox-card.tsx.
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const botaoSec = "border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10";

export function MapboxCard() {
  const utils = trpc.useUtils();
  const status = trpc.integracoes.statusMapbox.useQuery();
  const teste = trpc.integracoes.testarMapbox.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const [trocando, setTrocando] = useState(false);
  const [token, setToken] = useState("");
  const recarregar = async () => { await Promise.all([utils.integracoes.statusMapbox.invalidate(), utils.integracoes.testarMapbox.invalidate()]); };
  const salvar = trpc.integracoes.salvarMapbox.useMutation({
    onSuccess: async r => { toast.success(r.mensagem); setToken(""); setTrocando(false); await recarregar(); },
    onError: e => toast.error(e.message),
  });
  const remover = trpc.integracoes.removerMapbox.useMutation({
    onSuccess: async () => { toast.success("Token removido — o mapa volta a usar a Esri."); await recarregar(); },
    onError: e => toast.error(e.message),
  });
  const s = status.data;
  return (
    <Card className="border-[#C9A961]/20 bg-[#2C3E50] text-gray-100">
      <CardHeader><CardTitle className="text-[#C9A961]">Mapbox — satélite do mapa do terreno (opcional)</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {teste.isFetching ? <p className="flex items-center gap-2 text-sm text-gray-300"><Loader2 className="h-4 w-4 animate-spin" /> Testando…</p>
          : teste.data && (s?.configurado
            ? <p className={`flex items-start gap-2 text-sm ${teste.data.ok ? "text-green-300" : "text-red-300"}`}>{teste.data.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />} {teste.data.mensagem}</p>
            : <p className="flex items-start gap-2 text-sm text-gray-300"><Info className="mt-0.5 h-4 w-4 shrink-0" /> {teste.data.mensagem}</p>)}
        <p className="text-sm text-gray-300">{s?.configurado ? `Token salvo terminando em ${s.final}${s.fonte === "env" ? " (variável MAPBOX_PUBLIC_TOKEN do servidor)" : " (salvo nesta tela)"}.` : "Nenhum token salvo — não é obrigatório."}</p>
        <p className="text-xs text-gray-400">Use o token público (começa com pk.) da sua conta Mapbox. O sistema confere o token no Mapbox antes de salvar.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className={botaoSec} disabled={teste.isFetching} onClick={() => teste.refetch()}>Testar</Button>
          <Button size="sm" variant="outline" className={botaoSec} onClick={() => { setTrocando(t => !t); setToken(""); }}>{trocando ? "Cancelar" : s?.configurado ? "Trocar" : "Adicionar token"}</Button>
          {s?.configurado && s.fonte === "banco" && <Button size="sm" variant="outline" className={botaoSec} disabled={remover.isPending} onClick={() => remover.mutate()}>Remover</Button>}
        </div>
        {trocando && (
          <form className="space-y-3 rounded-lg bg-[#1A2332] p-3" onSubmit={e => { e.preventDefault(); salvar.mutate({ token }); }}>
            <div>
              <Label className="text-gray-300">Token público do Mapbox</Label>
              <Input autoComplete="off" placeholder="pk.eyJ1Ijoi..." value={token} onChange={e => setToken(e.target.value)} className="mt-1 bg-[#1A2332] border-[#C9A961]/30 text-white placeholder:text-gray-500" />
            </div>
            <Button type="submit" size="sm" disabled={!token.trim() || salvar.isPending} className="bg-[#C9A961] font-bold text-[#1A2332] hover:bg-[#B8985A]">{salvar.isPending ? "Validando…" : "Validar e salvar"}</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
