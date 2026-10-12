import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, History, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { lerPercentualDigitado } from "@shared/financeiro/obra";
import { SERVICOS_PROGRESSO, calcularProgresso, formatarPercentual } from "@shared/financeiro/progresso";

// EPIC-020 Lote 4 (item 27) — progresso físico por incidência. O Progresso
// Geral é somente leitura: soma das Execuções na Obra (Incidência × Execução).

type Linha = { chave: string; incidencia: string; execucao: string };

const canonico = (n: number) => n.toFixed(4).replace(/\.?0+$/, "") || "0";
const exibir = (v: string) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

function CelulaPercentual({ valor, onChange, rotulo }: { valor: string; onChange: (v: string) => void; rotulo: string }) {
  const [texto, setTexto] = useState("");
  const [focado, setFocado] = useState(false);
  const invalido = focado && texto.trim() !== "" && lerPercentualDigitado(texto) === null;
  return (
    <Input
      aria-label={rotulo}
      inputMode="decimal"
      value={focado ? texto : exibir(valor)}
      onFocus={() => { setTexto(exibir(valor)); setFocado(true); }}
      onBlur={() => setFocado(false)}
      onChange={(e) => {
        setTexto(e.target.value);
        const n = e.target.value.trim() === "" ? 0 : lerPercentualDigitado(e.target.value);
        if (n !== null && Number.isFinite(n)) onChange(canonico(n));
      }}
      className={`h-8 w-24 text-right bg-[#2C3E50] border-[#C9A961]/30 text-white ${invalido ? "border-red-500" : ""}`}
    />
  );
}

export function BarraProgresso({ valor }: { valor: number }) {
  const largura = Math.max(0, Math.min(100, valor));
  return (
    <div className="w-full bg-gray-700 rounded-full h-5 overflow-hidden" role="progressbar" aria-valuenow={Number(valor.toFixed(2))} aria-valuemin={0} aria-valuemax={100}>
      <div
        className="bg-gradient-to-r from-[#C9A961] to-[#FFD700] h-5 rounded-full transition-all flex items-center justify-end pr-2 text-xs font-semibold text-[#1A2332]"
        style={{ width: `${largura}%` }}
      >
        {largura >= 12 ? formatarPercentual(valor) : ""}
      </div>
    </div>
  );
}

export function ProgressoObraAba({ projectId }: { projectId: number }) {
  const consulta = trpc.obraProgresso.obter.useQuery({ projectId });
  const salvar = trpc.obraProgresso.salvar.useMutation();
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  useEffect(() => {
    if (consulta.data && !linhas) setLinhas(consulta.data.itens);
  }, [consulta.data, linhas]);
  const calculo = useMemo(() => (linhas ? calcularProgresso(linhas) : null), [linhas]);

  if (!consulta.data || !linhas || !calculo) return <Loader2 className="h-6 w-6 animate-spin text-[#C9A961]" />;
  const dados = consulta.data;
  const alterar = (chave: string, campo: "incidencia" | "execucao", v: string) =>
    setLinhas((atual) => atual!.map((l) => (l.chave === chave ? { ...l, [campo]: v } : l)));

  const gravar = async () => {
    try {
      const r = await salvar.mutateAsync({ projectId, itens: linhas });
      toast.success(`Medição salva: progresso geral ${formatarPercentual(r.progresso)}.`);
      setLinhas(null);
      await consulta.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-[#C9A961]">Progresso Geral</CardTitle>
          <CardDescription className="text-gray-400">
            Calculado automaticamente: soma de Incidência × Execução de cada serviço (Mensurado Acumulado Total). Não é editável.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-4">
            <span className="text-3xl font-bold text-white min-w-[120px]" data-testid="progresso-geral">{formatarPercentual(calculo.progresso)}</span>
            <div className="flex-1"><BarraProgresso valor={calculo.progresso} /></div>
          </div>
          {!dados.medido && dados.progressoLegado > 0 && (
            <p className="text-xs text-amber-300">
              Esta obra tinha {dados.progressoLegado}% digitado manualmente. Ao salvar a primeira medição, o progresso passa a ser o calculado acima.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-[#C9A961]">Medição por serviço</CardTitle>
          <CardDescription className="text-gray-400">Incidência e Execução do Item são editáveis (até 4 casas decimais). Execução na Obra é automática.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {calculo.erros.length > 0 && (
            <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200 space-y-1" role="alert">
              {calculo.erros.map((e) => <p key={e}>{e}</p>)}
            </div>
          )}
          {calculo.avisos.map((a) => (
            <p key={a} className="flex items-center gap-2 text-sm text-amber-300"><AlertTriangle className="h-4 w-4" />{a}</p>
          ))}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-[#C9A961]/20">
                  <th className="py-2 pr-2">Serviço</th>
                  <th className="py-2 px-2 text-right">Incidência (%)</th>
                  <th className="py-2 px-2 text-right">Execução do Item (%)</th>
                  <th className="py-2 pl-2 text-right">Execução na Obra (%)</th>
                </tr>
              </thead>
              <tbody>
                {SERVICOS_PROGRESSO.map((s) => {
                  const linha = linhas.find((l) => l.chave === s.chave)!;
                  const item = calculo.itens.find((i) => i.chave === s.chave);
                  return (
                    <tr key={s.chave} className="border-b border-[#C9A961]/10">
                      <td className="py-1.5 pr-2 text-gray-200">{s.nome}</td>
                      <td className="py-1.5 px-2"><div className="flex justify-end"><CelulaPercentual rotulo={`Incidência ${s.nome}`} valor={linha.incidencia} onChange={(v) => alterar(s.chave, "incidencia", v)} /></div></td>
                      <td className="py-1.5 px-2"><div className="flex justify-end"><CelulaPercentual rotulo={`Execução ${s.nome}`} valor={linha.execucao} onChange={(v) => alterar(s.chave, "execucao", v)} /></div></td>
                      <td className="py-1.5 pl-2 text-right text-gray-200 tabular-nums">{item ? formatarPercentual(item.execucaoObra, 4) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold text-[#C9A961]">
                  <td className="py-2 pr-2">Total</td>
                  <td className={`py-2 px-2 text-right tabular-nums ${calculo.somaIncidencia > 100 ? "text-red-400" : ""}`}>{formatarPercentual(calculo.somaIncidencia, 2)}</td>
                  <td className="py-2 px-2 text-right text-gray-400">Mensurado Acumulado Total</td>
                  <td className="py-2 pl-2 text-right tabular-nums">{formatarPercentual(calculo.progresso)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="flex justify-end">
            <Button onClick={gravar} disabled={salvar.isPending || calculo.erros.length > 0} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] gap-2">
              {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar medição
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-[#C9A961] flex items-center gap-2"><History className="h-4 w-4" />Histórico de medições</CardTitle>
        </CardHeader>
        <CardContent>
          {dados.historico.length === 0 ? (
            <p className="text-gray-400 text-sm">Nenhuma medição salva ainda.</p>
          ) : (
            <ul className="divide-y divide-[#C9A961]/10 text-sm">
              {dados.historico.map((h) => (
                <li key={h.id} className="flex justify-between py-2 text-gray-300">
                  <span>{new Date(h.criadoEm).toLocaleString("pt-BR")} — {h.autor ?? "—"}</span>
                  <span className="font-semibold text-white">{formatarPercentual(h.progresso)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
