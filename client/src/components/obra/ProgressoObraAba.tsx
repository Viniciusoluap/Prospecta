import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, History, Loader2, Pencil, Save, Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { lerPercentualDigitado } from "@shared/financeiro/obra";
import { SERVICOS_PROGRESSO, calcularProgresso, formatarPercentual, mesclarComPadrao } from "@shared/financeiro/progresso";

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

const reais = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataHora = (d: Date | string) => new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function ProgressoObraAba({ projectId }: { projectId: number }) {
  const consulta = trpc.obraProgresso.obter.useQuery({ projectId });
  const salvar = trpc.obraProgresso.salvar.useMutation();
  // Pedido de 18/10: ciclo da medição, edição e exclusão (admin, colaborador e empreiteiro).
  const solicitar = trpc.obraProgresso.solicitarMedicao.useMutation();
  const confirmar = trpc.obraProgresso.confirmarRecebimento.useMutation();
  const editar = trpc.obraProgresso.editarMedicao.useMutation();
  const excluir = trpc.obraProgresso.excluirMedicao.useMutation();
  const [editando, setEditando] = useState<{ id: number; quando: string } | null>(null);
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
      if (editando) {
        await editar.mutateAsync({ medicaoId: editando.id, itens: linhas });
        toast.success(`Medição de ${editando.quando} alterada.`);
        setEditando(null);
      } else {
        const r = await salvar.mutateAsync({ projectId, itens: linhas });
        toast.success(`Medição salva: progresso geral ${formatarPercentual(r.progresso)}.`);
      }
      setLinhas(null);
      await consulta.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const acao = async (fn: () => Promise<unknown>, sucesso: string) => {
    try {
      await fn();
      toast.success(sucesso);
      setLinhas(null);
      await consulta.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const iniciarEdicao = (h: (typeof dados.historico)[number]) => {
    setEditando({ id: h.id, quando: dataHora(h.criadoEm) });
    setLinhas(mesclarComPadrao(h.itens).map((i) => ({ chave: i.chave, incidencia: String(i.incidencia), execucao: String(i.execucao) })));
    document.getElementById("medicao-por-servico")?.scrollIntoView({ behavior: "smooth" });
  };
  const cancelarEdicao = () => {
    setEditando(null);
    setLinhas(null);
  };
  const ocupado = solicitar.isPending || confirmar.isPending || excluir.isPending || editar.isPending || salvar.isPending;

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

      <Card id="medicao-por-servico" className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-[#C9A961]">Medição por serviço</CardTitle>
          <CardDescription className="text-gray-400">Incidência e Execução do Item são editáveis (até 4 casas decimais). Execução na Obra é automática.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {editando && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-[#C9A961]/50 bg-[#C9A961]/10 p-3 text-sm text-[#F5E6C4]" role="status">
              <span>Editando a medição de {editando.quando}. Ao salvar, ela é corrigida no histórico.</span>
              <Button size="sm" variant="outline" onClick={cancelarEdicao} className="border-[#C9A961]/60 bg-transparent text-[#C9A961] gap-1"><X className="h-4 w-4" />Cancelar edição</Button>
            </div>
          )}
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
            <Button onClick={gravar} disabled={ocupado || calculo.erros.length > 0} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] gap-2">
              {salvar.isPending || editar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editando ? "Salvar alterações da medição" : "Salvar medição"}
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
            <>
              {/* Pedido de 18/10: valor estimado X = Y × avanço da medição; Y = (financiado + FGTS + subsídio) − terreno. */}
              <p className="mb-3 text-xs text-gray-400">
                {dados.baseMedicao.ok
                  ? <>Valor estimado = {reais(dados.baseMedicao.centavos)} (financiado + FGTS + subsídio − terreno) × percentual que a obra avançou na medição.</>
                  : <>Valor estimado indisponível — {dados.baseMedicao.motivo}. Preencha em Valores da Operação.</>}
              </p>
              <ul className="divide-y divide-[#C9A961]/10 text-sm">
                {dados.historico.map((h) => (
                  <li key={h.id} className="grid grid-cols-1 items-center gap-2 py-3 text-gray-300 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
                    <div className="min-w-0">
                      <p>{dataHora(h.criadoEm)} — {h.autor ?? "—"}</p>
                      {h.editadaEm && <p className="text-xs text-gray-400">Editada em {dataHora(h.editadaEm)}</p>}
                    </div>
                    <div>
                      {h.solicitadaEm ? (
                        <p className="text-xs text-amber-200"><Send className="mr-1 inline h-3 w-3" />Solicitada em {dataHora(h.solicitadaEm)}{h.solicitadaPor ? ` por ${h.solicitadaPor}` : ""}</p>
                      ) : (
                        <Button size="sm" variant="outline" disabled={ocupado} onClick={() => acao(() => solicitar.mutateAsync({ medicaoId: h.id }), "Medição solicitada.")} className="border-[#C9A961]/60 bg-transparent text-[#C9A961] gap-1">
                          <Send className="h-3.5 w-3.5" />Solicitar medição
                        </Button>
                      )}
                    </div>
                    <div>
                      {h.recebidaEm ? (
                        <p className="text-xs text-emerald-300"><CheckCircle2 className="mr-1 inline h-3 w-3" />Recebida em {dataHora(h.recebidaEm)}{h.recebidaPor ? ` por ${h.recebidaPor}` : ""}</p>
                      ) : (
                        <Button size="sm" variant="outline" disabled={ocupado || !h.solicitadaEm} title={h.solicitadaEm ? undefined : "Solicite a medição primeiro"}
                          onClick={() => acao(() => confirmar.mutateAsync({ medicaoId: h.id }), "Recebimento da medição confirmado.")} className="border-emerald-500/60 bg-transparent text-emerald-300 gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5" />Confirmar recebimento
                        </Button>
                      )}
                    </div>
                    <div className="md:text-right">
                      <p className="text-xs text-gray-400">Valor estimado</p>
                      <p className="font-semibold text-white tabular-nums">{h.estimativa.valorCentavos === null ? "—" : reais(h.estimativa.valorCentavos)}</p>
                      <p className={`text-xs ${h.estimativa.aviso ? "text-amber-300" : "text-gray-400"}`}>
                        {h.estimativa.aviso ?? `${formatarPercentual(h.estimativa.percentualDaMedicao)} nesta medição`}
                      </p>
                    </div>
                    <p className="font-semibold text-white tabular-nums md:text-right">{formatarPercentual(h.progresso)}</p>
                    <div className="flex gap-1 md:justify-end">
                      <Button size="icon" variant="ghost" aria-label={`Editar a medição de ${dataHora(h.criadoEm)}`} disabled={ocupado} onClick={() => iniciarEdicao(h)} className="text-[#C9A961] hover:bg-[#C9A961]/10"><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" aria-label={`Excluir a medição de ${dataHora(h.criadoEm)}`} disabled={ocupado}
                        onClick={() => { if (confirm(`Excluir definitivamente a medição de ${dataHora(h.criadoEm)}? Esta ação não pode ser desfeita.`)) void acao(() => excluir.mutateAsync({ medicaoId: h.id }), "Medição excluída."); }}
                        className="text-red-400 hover:bg-red-500/10"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
