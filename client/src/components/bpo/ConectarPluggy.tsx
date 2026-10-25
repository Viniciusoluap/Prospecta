// Pedido de 25/10 (noite), item 8: o "Conectar banco (Meu Pluggy)" saiu de BPO › Bancos e fica
// em Configurações › Integrações (bloco Pluggy). Mesma lógica de antes, só mudou de lugar.
import { useState } from "react";
import { toast } from "sonner";
import { Link2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const campo = "mt-1 bg-[#1A2332] border-[#C9A961]/30 text-white";
const botaoSec = "border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10";

export function ConectarPluggy({ configurado }: { configurado: boolean }) {
  const utils = trpc.useUtils();
  const [itemForm, setItemForm] = useState({ itemId: "", dataInicial: "" });
  const importarItem = trpc.pluggySettings.importarItem.useMutation({
    onSuccess: r => {
      toast.success(`${r.encontradas} conta(s) encontrada(s), ${r.criadas} cadastrada(s) em BPO › Bancos.`);
      setItemForm({ itemId: "", dataInicial: "" });
      void utils.bancario.contas.list.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const connectToken = trpc.pluggySettings.connectToken.useMutation();

  async function conectarMeuPluggy() {
    try {
      const { accessToken } = await connectToken.mutateAsync();
      const { PluggyConnect } = await import("pluggy-connect-sdk");
      const pc = new PluggyConnect({
        connectToken: accessToken,
        includeSandbox: false,
        onSuccess: ({ item }) => importarItem.mutate({ itemId: item.id, dataInicial: itemForm.dataInicial || null }),
        onError: e => { toast.error(e.message); },
      });
      await pc.init();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir a Pluggy.");
    }
  }

  if (!configurado) {
    return <p className="text-xs text-gray-300">Salve o Client ID e o Client Secret para conectar bancos pelo Meu Pluggy (gratuito).</p>;
  }
  return (
    <div className="space-y-3 rounded-lg border border-[#C9A961]/20 p-3">
      <p className="text-xs text-gray-300">As contas conectadas no Meu Pluggy são cadastradas em BPO › Bancos e sincronizadas todo dia, sem custo.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-gray-300">Considerar movimentações a partir de</Label>
          <Input type="date" value={itemForm.dataInicial} onChange={e => setItemForm(f => ({ ...f, dataInicial: e.target.value }))} className={campo} />
        </div>
        <div>
          <Label className="text-gray-300">ID da conexão (itemId), se já tiver</Label>
          <Input value={itemForm.itemId} onChange={e => setItemForm(f => ({ ...f, itemId: e.target.value.trim() }))} className={campo} placeholder="opcional" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className={botaoSec} disabled={connectToken.isPending} onClick={conectarMeuPluggy}>
          <Link2 className="mr-1 h-3 w-3" /> Conectar banco (Meu Pluggy)
        </Button>
        <Button size="sm" variant="outline" className={botaoSec} disabled={itemForm.itemId.length < 8 || importarItem.isPending}
          onClick={() => importarItem.mutate({ itemId: itemForm.itemId, dataInicial: itemForm.dataInicial || null })}>
          Buscar contas deste ID
        </Button>
      </div>
    </div>
  );
}
