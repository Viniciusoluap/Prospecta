import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Item 03 + pedido A6 — excluir é excluir (mesmo comportamento do Santa Fé):
 * remove o registro definitivamente, junto com os lançamentos dele. Não existe
 * mais "Cancelar".
 */
export function AcoesExcluir({ rotulo, onExcluir, compacto = false }: {
  rotulo: string;
  onExcluir: () => Promise<unknown>;
  compacto?: boolean;
}) {
  const [pendente, setPendente] = useState(false);

  async function excluir() {
    if (!window.confirm(`Excluir "${rotulo}" definitivamente? O registro e os lançamentos dele serão removidos do sistema e esta ação não pode ser desfeita. Os dados do cliente no CRM são preservados.`)) return;
    setPendente(true);
    try {
      await onExcluir();
      toast.success("Registro excluído");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na operação", { duration: 12000 });
    } finally {
      setPendente(false);
    }
  }

  return (
    <span className="inline-flex gap-2" onClick={(e) => e.stopPropagation()}>
      <Button type="button" size="sm" variant="destructive" disabled={pendente} title="Excluir definitivamente" aria-label={`Excluir ${rotulo}`}
        onClick={(e) => { e.preventDefault(); void excluir(); }}>
        <Trash2 className="h-4 w-4" />{!compacto && <span className="ml-1">Excluir</span>}
      </Button>
    </span>
  );
}
