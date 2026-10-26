// Pedido de 25/10 (noite): em BPO › Bancos fica só o botão "Conectar conta Pluggy" (sem campos).
// As chaves (Client ID/Secret) ficam em Configurações › Integrações; a data inicial de cada conta
// é ajustada depois no botão "Data inicial" da própria conta.
import { toast } from "sonner";
import { Link2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

export function ConectarPluggy() {
  const utils = trpc.useUtils();
  const importarItem = trpc.pluggySettings.importarItem.useMutation({
    onSuccess: r => {
      toast.success(`${r.encontradas} conta(s) encontrada(s), ${r.criadas} cadastrada(s) em BPO › Bancos.`);
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
        onSuccess: ({ item }) => importarItem.mutate({ itemId: item.id, dataInicial: null }),
        onError: e => { toast.error(e.message); },
      });
      await pc.init();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir a Pluggy. Confira as chaves em Configurações › Integrações.");
    }
  }

  return (
    <Button variant="outline" className="border-[#C9A961] text-[#C9A961] hover:bg-[#C9A961]/10 font-bold"
      disabled={connectToken.isPending || importarItem.isPending} onClick={conectarMeuPluggy}>
      <Link2 className="h-4 w-4 mr-2" /> {connectToken.isPending || importarItem.isPending ? "Conectando..." : "Conectar conta Pluggy"}
    </Button>
  );
}
