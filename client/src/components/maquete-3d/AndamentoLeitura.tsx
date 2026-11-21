// Maquete 3D (EPIC-027 C1) — andamento de verdade da leitura, nas duas telas que a disparam (leitura do projeto e
// planta importada): indicador animado enquanto há trabalho, o passo atual, "prancha X de Y", a situação da prancha
// na IA e o tempo decorrido. Sem porcentagem inventada: a Anthropic não informa quanto da prancha já foi lido.
import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { andamentoDaLeitura, tempoDecorrido, type PassoDoAndamento } from "./rotulos-leitura";

export function AndamentoLeitura({ passos, trabalhando, usadas, teto, aoCancelar, cancelando }: {
  passos: PassoDoAndamento[];
  /** A tela está chamando o servidor (passo do leitor próprio ou consulta do lote). */
  trabalhando: boolean;
  /** Contador da maquete (leituras + importações) e o teto das Configurações. */
  usadas: number; teto: number | null;
  /** Recebe a chave da prancha mostrada: o servidor só cancela se ela ainda for a que está na IA (QA C1, achado 4). */
  aoCancelar?: (chave: string) => void; cancelando?: boolean;
}) {
  const a = andamentoDaLeitura(passos);
  const naIA = a.atual?.estado === "executando";
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!naIA && !trabalhando) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [naIA, trabalhando]);
  if (!a.atual || (!trabalhando && !naIA)) return null;
  const desde = a.desde ? Date.parse(a.desde) : NaN;
  return (
    <div className="space-y-1 rounded-lg border border-[#C9A961]/30 bg-[#1A2332]/60 p-3 text-sm" role="status" aria-live="polite">
      <p className="flex flex-wrap items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-[#C9A961]" aria-hidden />
        <span className="font-semibold">{a.atual.rotulo}</span>
        <span className="text-xs text-gray-400">passo {a.passo.x} de {a.passo.y}{a.pranchaIA ? ` · prancha ${a.pranchaIA.x} de ${a.pranchaIA.y} pela IA` : ""}</span>
      </p>
      {naIA ? (
        <>
          <p className="text-amber-200">{a.situacao}{Number.isFinite(desde) ? ` · há ${tempoDecorrido(agora - desde)}` : ""}</p>
          <p className="text-xs text-gray-300">A leitura pela IA pode levar alguns minutos (em geral menos de uma hora). Você pode fechar esta página: a leitura continua na Anthropic e esta tela retoma quando você voltar.</p>
          <p className="text-xs text-gray-400">Esta maquete já usou {usadas} de {teto ?? "—"} prancha(s) pela IA (a que está em andamento já conta; se a IA não entregar resultado, ela é devolvida).</p>
          {aoCancelar && a.atual.lote && a.atual.lote.situacao !== "cancelando" && (
            <Button size="sm" variant="outline" className="border-red-400/50 bg-transparent text-red-300" disabled={cancelando}
              onClick={() => { if (window.confirm(`Cancelar a leitura pela IA de "${a.atual!.rotulo.replace(/^Leitura pela IA — /, "")}"? Se a IA ainda não começou a ler, nada é cobrado. Se ela já leu, a leitura (já paga) é aproveitada.`)) aoCancelar(a.atual!.chave); }}>
              <X className="mr-1 h-4 w-4" />Cancelar leitura pela IA
            </Button>
          )}
        </>
      ) : <p className="text-xs text-gray-300">Lendo com o leitor próprio…</p>}
    </div>
  );
}
