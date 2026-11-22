// EPIC-029 S-2 — relatório do contador "Notas × receita do mês": com nota, sem nota (por motivo), a decidir e a diferença
// linha a linha, fechando com a mesma conta do cartão "Receita realizada" desta aba. Exporta CSV.
import { useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const dinheiro = (c: number) => formatCurrency(c / 100);

function mesAtual() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
}

export function NotasReceitaMes({ emissorId }: { emissorId: number | null }) {
  const utils = trpc.useUtils();
  const [competencia, setCompetencia] = useState(mesAtual());
  const valida = /^\d{4}-(0[1-9]|1[0-2])$/.test(competencia);
  const { data: r, isLoading } = trpc.fiscal.relatorio.mensal.useQuery({ competencia, emissorId: emissorId ?? undefined }, { enabled: valida });

  const exportar = async () => {
    try {
      const { nomeArquivo, csv } = await utils.fiscal.relatorio.csv.fetch({ competencia, emissorId: emissorId ?? undefined });
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url; a.download = nomeArquivo; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
      <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3">
        <CardTitle className="text-[#C9A961]">Notas × receita do mês</CardTitle>
        <div className="flex items-end gap-2">
          <div>
            <Label htmlFor="fiscal-competencia">Mês</Label>
            <Input id="fiscal-competencia" type="month" value={competencia} onChange={e => setCompetencia(e.target.value)} className="mt-1 bg-[#1A2332]" />
          </div>
          <Button size="sm" variant="outline" disabled={!r} onClick={() => void exportar()}><Download className="mr-1 h-4 w-4" /> CSV</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isLoading || !r ? <p className="text-gray-400">Carregando relatório...</p> : (
          <>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              <Resumo titulo="Receita realizada do mês" valor={r.receitaRealizadaCentavos} destaque />
              <Resumo titulo="Com nota" valor={r.comNotaCentavos} />
              <Resumo titulo="Sem nota" valor={r.semNotaCentavos} />
              <Resumo titulo="A decidir" valor={r.aDecidirCentavos} />
              <Resumo titulo="Diferença (sem rascunho)" valor={r.diferencaCentavos} />
            </div>
            {r.outraEmpresaCentavos !== 0 && <p className="text-xs text-gray-400">De outra empresa ou sem empresa definida: {dinheiro(r.outraEmpresaCentavos)}.</p>}
            <p className={`text-xs ${r.fecha ? "text-green-400" : "text-red-300"}`}>
              {r.fecha ? "Fecha com a receita realizada (mesma conta do cartão da aba)." : "Atenção: a soma não fechou com a receita realizada."}
            </p>
            {!!r.semNotaPorMotivo.length && (
              <div>
                <p className="font-medium text-white">Sem nota, por motivo</p>
                {r.semNotaPorMotivo.map(m => <p key={m.motivo} className="text-gray-300">{m.rotulo}: {dinheiro(m.centavos)}</p>)}
              </div>
            )}
            {!!r.diferencas.length && (
              <div>
                <p className="font-medium text-white">Diferença, linha a linha</p>
                {r.diferencas.slice(0, 50).map((d, i) => (
                  <p key={`${d.fonte}-${d.id}-${i}`} className="text-gray-300">
                    {d.fonte === "bpo" ? "BPO" : "Financeiro"} nº {d.id} — {d.descricao || "sem descrição"} — {dinheiro(d.centavos)} <span className="text-xs text-gray-500">({d.explicacao})</span>
                  </p>
                ))}
                {r.diferencas.length > 50 && <p className="text-xs text-gray-500">… e mais {r.diferencas.length - 50} no CSV.</p>}
              </div>
            )}
            {!!r.foraDaReceita.length && (
              <p className="text-xs text-gray-400">
                {r.foraDaReceita.length} rascunho(s) do mês vêm de recebimentos que não entram no cartão "Receita realizada" (ex.: recebimento
                de obra sem lançamento no BPO) e não somam acima.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Resumo({ titulo, valor, destaque }: { titulo: string; valor: number; destaque?: boolean }) {
  return (
    <div className="rounded bg-[#1A2332] p-3">
      <p className="text-xs text-gray-400">{titulo}</p>
      <p className={`mt-1 font-bold ${destaque ? "text-green-400" : "text-white"}`}>{dinheiro(valor)}</p>
    </div>
  );
}
