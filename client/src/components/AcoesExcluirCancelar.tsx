import { useState } from "react";
import { Ban, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Item 03 — duas ações separadas (mesmo comportamento do Santa Fé):
 * Cancelar mantém o registro e o histórico; Excluir remove definitivamente
 * (o servidor recusa e explica quando há guarda financeira/jurídica).
 */
export function AcoesExcluirCancelar({ rotulo, cancelado, onCancelar, onExcluir, compacto = false }: {
  rotulo: string;
  cancelado: boolean;
  onCancelar?: () => Promise<unknown>;
  onExcluir: () => Promise<unknown>;
  compacto?: boolean;
}) {
  const [pendente, setPendente] = useState(false);

  async function executar(acao: () => Promise<unknown>, pergunta: string, sucesso: string) {
    if (!window.confirm(pergunta)) return;
    setPendente(true);
    try {
      await acao();
      toast.success(sucesso);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na operação", { duration: 12000 });
    } finally {
      setPendente(false);
    }
  }

  return (
    <span className="inline-flex gap-2" onClick={(e) => e.stopPropagation()}>
      {onCancelar && !cancelado && (
        <Button type="button" size="sm" variant="outline" disabled={pendente} title="Cancelar (mantém o histórico)" aria-label={`Cancelar ${rotulo}`}
          className="border-amber-500/50 text-amber-300 hover:bg-amber-500/10"
          onClick={(e) => { e.preventDefault(); void executar(onCancelar, `Cancelar "${rotulo}"? O registro continua no sistema com a situação Cancelado.`, "Registro cancelado"); }}>
          <Ban className="h-4 w-4" />{!compacto && <span className="ml-1">Cancelar</span>}
        </Button>
      )}
      <Button type="button" size="sm" variant="destructive" disabled={pendente} title="Excluir definitivamente" aria-label={`Excluir ${rotulo}`}
        onClick={(e) => { e.preventDefault(); void executar(onExcluir, `Excluir "${rotulo}" definitivamente? O registro será removido do sistema e esta ação não pode ser desfeita. Os dados do cliente no CRM são preservados.`, "Registro excluído"); }}>
        <Trash2 className="h-4 w-4" />{!compacto && <span className="ml-1">Excluir</span>}
      </Button>
    </span>
  );
}
