import { ArrowRight } from "lucide-react";
import { exibirNotificacao, type NotificacaoBruta } from "@shared/notificacao-formato";

/**
 * Pedido de 23/10 (H4): corpo padronizado das notificações (sino e "Ver todas").
 * O clique no item inteiro já executa a ação; o botão deixa claro para onde vai.
 */
export function NotificacaoConteudo({ notificacao, maxItens = 5, escuro = false, quando }: {
  notificacao: NotificacaoBruta;
  maxItens?: number;
  escuro?: boolean;
  quando?: string;
}) {
  const n = exibirNotificacao(notificacao, maxItens);
  const suave = escuro ? "text-gray-300" : "text-muted-foreground";
  return (
    <div className="w-full min-w-0 space-y-1.5">
      <div className="flex items-start gap-2">
        <span className="text-lg leading-none shrink-0" aria-hidden="true">{n.icone}</span>
        <span className="font-semibold text-sm leading-snug break-words">{n.titulo}</span>
      </div>
      {n.resumo && <p className={`text-xs ${suave} break-words`}>{n.resumo}</p>}
      {n.itens.length > 0 && (
        <ul className={`text-xs ${suave} space-y-0.5 pl-1`}>
          {n.itens.map((item, i) => <li key={i} className="flex gap-1.5 break-words"><span aria-hidden="true">•</span><span>{item}</span></li>)}
          {n.restantes > 0 && <li className="italic">e mais {n.restantes}</li>}
        </ul>
      )}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        {quando && <span className={`text-[11px] ${suave}`}>{quando}</span>}
        {n.acao && (
          <span className={`ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${escuro ? "bg-[#C9A961]/20 text-[#C9A961]" : "bg-primary/10 text-primary"}`}>
            {n.acao.rotulo} <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </span>
        )}
      </div>
    </div>
  );
}
