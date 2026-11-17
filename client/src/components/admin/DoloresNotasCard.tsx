// EPIC-025 (Dolores, etapa 5): notas de obra — só admin. Mostra os RASCUNHOS que a Dolores montou com as notas e recibos que
// chegaram nos grupos de OBRA (campos lidos, dúvidas, alertas), a resposta do empreiteiro no grupo (indício, não assinatura),
// o apontamento da conciliação com o BPO e o texto sugerido para o DONO enviar ao empreiteiro (a Dolores não envia nada).
// Ligar a nota ao pagamento do BPO e salvar o arquivo no Drive só são PROPOSTOS aqui: vão para a fila, e o dono aprova lá.
// Layout em uma coluna no iPad em pé e em duas no computador; botões com área de toque de 40 px.
import { useState } from "react";
import { toast } from "sonner";
import { Copy, FileText } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const botaoSec = "min-h-10 border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10";
const campo = "mt-1 bg-[#1A2332] border-[#C9A961]/30 text-white";
const quando = (d: string | null | undefined) => (d ? new Date(d).toLocaleString("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short", timeStyle: "short" }) : "—");
const reais = (c: number | null | undefined) => (c == null ? "não lido" : (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const dataBr = (s: string | null | undefined) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "não lida");
const COR_APONTAMENTO: Record<string, string> = {
  conciliada: "text-emerald-300", ja_lancado: "text-emerald-200", provavel_duplicata: "text-red-300", duplicada: "text-red-300",
  divergente: "text-amber-300", varios: "text-amber-300", sem_lancamento: "text-gray-300", sem_dados: "text-gray-300",
};

export function DoloresNotasCard() {
  const utils = trpc.useUtils();
  const [obraFiltro, setObraFiltro] = useState("");
  const obraId = obraFiltro ? Number(obraFiltro) || undefined : undefined;
  const dados = trpc.dolores.notas.listar.useQuery({ obraId, situacao: "todas" }, { retry: false });
  const [cfgEdit, setCfgEdit] = useState<Record<string, string>>({});
  const recarregar = () => utils.dolores.notas.listar.invalidate();
  const erro = (e: { message: string }) => toast.error(e.message);
  const salvarConfig = trpc.dolores.notas.salvarConfig.useMutation({ onSuccess: async () => { toast.success("Configuração salva."); setCfgEdit({}); await recarregar(); }, onError: erro });
  const ler = trpc.dolores.notas.lerPendentes.useMutation({
    onSuccess: async r => { const t = Object.entries(r.contagem).map(([k, v]) => `${k}: ${v}`).join(", "); toast.message(t ? `Leitura: ${t}` : "Nenhuma nota a ler."); await recarregar(); },
    onError: erro,
  });
  const naFila = (r: { itens: Array<{ codigo: string; jaAguardava: boolean }> }) => {
    toast.success(`Na fila de aprovação: ${r.itens.map(i => `${i.codigo}${i.jaAguardava ? " (já aguardava)" : ""}`).join(", ")}. Aprove em "Fila de aprovação".`);
    void utils.dolores.fila.listar.invalidate();
  };
  const conciliar = trpc.dolores.notas.proporConciliacao.useMutation({ onSuccess: naFila, onError: erro });
  const salvar = trpc.dolores.notas.proporSalvar.useMutation({ onSuccess: naFila, onError: erro });
  const cfg = dados.data?.config;
  const copiar = async (t: string) => { try { await navigator.clipboard.writeText(t); toast.success("Texto copiado. Envie você mesmo no grupo, se quiser."); } catch { toast.error("Não consegui copiar; selecione o texto."); } };

  return (
    <Card className="border-[#C9A961]/20 bg-[#2C3E50] text-gray-100">
      <CardHeader><CardTitle className="flex items-center gap-2 text-[#C9A961]"><FileText className="h-5 w-5" /> Dolores — notas de obra</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-300">
          As notas e recibos que chegam nos grupos de OBRA são lidos e viram RASCUNHO da Dolores: nada é lançado, pago nem baixado.
          Valores, CPF/CNPJ, datas e chave de acesso são conferidos pelo sistema; o que não foi lido com segurança fica vazio, com a
          dúvida. Dados bancários da nota nunca são gravados. Ligar a nota ao pagamento do BPO e salvar o arquivo na pasta da obra
          só acontecem com a aprovação do dono, pela fila.
        </p>
        {dados.isLoading ? <p className="text-sm text-gray-300">Carregando…</p> : dados.error ? <p role="alert" className="text-sm text-red-300">{dados.error.message}</p> : <>
          <p role="note" className="rounded border border-amber-400/40 bg-amber-500/10 p-2 text-xs text-amber-100">{dados.data!.aviso}</p>

          {/* Configuração */}
          <section className="space-y-2 rounded-lg border border-[#C9A961]/20 bg-[#1A2332] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[#C9A961]">Leitura das notas pela IA</h3>
              <label className="flex min-h-10 items-center gap-2 text-sm">
                <Switch checked={!!cfg?.leituraLigada} disabled={salvarConfig.isPending} onCheckedChange={v => salvarConfig.mutate({ leituraLigada: v })} aria-label="Leitura de notas ligada" />
                {cfg?.leituraLigada ? "ligada" : "desligada"}
              </label>
            </div>
            <p className="text-xs text-gray-400">
              Usa as mesmas travas da classificação dos grupos (interruptor da IA, classificação ligada, tetos do dia, orçamento dos
              documentos e uma leitura por vez) e o modelo da função "Dolores — leitura de notas de obra" (Integrações › Anthropic).
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div><Label htmlFor="nota-prazo" className="text-xs text-gray-300">Prazo da confirmação do empreiteiro (dias)</Label>
                <Input id="nota-prazo" inputMode="numeric" className={campo} placeholder={String(cfg?.prazoConfirmacaoDias ?? 7)} value={cfgEdit.prazo ?? ""} onChange={e => setCfgEdit({ ...cfgEdit, prazo: e.target.value.replace(/\D/g, "") })} /></div>
              <div><Label htmlFor="nota-janela" className="text-xs text-gray-300">Janela da conciliação com o BPO (± dias)</Label>
                <Input id="nota-janela" inputMode="numeric" className={campo} placeholder={String(cfg?.janelaConciliacaoDias ?? 30)} value={cfgEdit.janela ?? ""} onChange={e => setCfgEdit({ ...cfgEdit, janela: e.target.value.replace(/\D/g, "") })} /></div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className={botaoSec} disabled={salvarConfig.isPending || (!cfgEdit.prazo && !cfgEdit.janela)}
                onClick={() => salvarConfig.mutate({ prazoConfirmacaoDias: cfgEdit.prazo ? Number(cfgEdit.prazo) : undefined, janelaConciliacaoDias: cfgEdit.janela ? Number(cfgEdit.janela) : undefined })}>Salvar prazos</Button>
              <Button size="sm" variant="outline" className={botaoSec} disabled={ler.isPending || !dados.data!.pendentesDeLeitura} onClick={() => ler.mutate({ maximo: 1 })}>
                {ler.isPending ? "Lendo…" : `Ler a próxima nota pendente (${dados.data!.pendentesDeLeitura})`}
              </Button>
            </div>
          </section>

          {/* Filtro por obra */}
          <div className="flex flex-wrap items-end gap-2">
            <div><Label htmlFor="nota-obra" className="text-xs text-gray-300">Nº da obra (vazio = todas)</Label>
              <Input id="nota-obra" inputMode="numeric" className={`${campo} w-40`} value={obraFiltro} onChange={e => setObraFiltro(e.target.value.replace(/\D/g, ""))} /></div>
          </div>
          {obraId && dados.data!.pagamentosSemNota.length > 0 && (
            <section className="rounded border border-amber-400/30 bg-[#1A2332] p-3 text-xs">
              <h3 className="mb-1 font-semibold text-amber-200">Pagamentos da obra no BPO sem nota (últimos 90 dias)</h3>
              <ul className="space-y-1">{dados.data!.pagamentosSemNota.map(p => <li key={p.lancamentoId}>Lançamento #{p.lancamentoId} — {p.valor} — {dataBr(p.data)} — {p.descricao}</li>)}</ul>
            </section>
          )}

          {/* Notas */}
          {!dados.data!.notas.length ? <p className="text-sm text-gray-300">Nenhuma nota lida ainda.</p> : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {dados.data!.notas.map(n => (
                <li key={n.id} className="space-y-2 rounded-lg border border-[#C9A961]/20 bg-[#1A2332] p-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold text-[#C9A961]">Nota {n.id} — {n.obra ?? `obra ${n.obraId ?? "excluída"}`}</span>
                    <span className="text-xs text-gray-400">recebida {quando(n.recebidaEm)} {n.enviadaPor ? `por ${n.enviadaPor}` : ""}</span>
                  </div>
                  <p className="text-xs text-gray-300">{n.rotuloSituacao}{n.tipo ? ` · ${n.tipo}` : ""}</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-gray-400">Emitente</dt><dd className="break-words">{n.emitente ?? "não lido"}{n.documento ? ` — ${n.documento}` : ""}{n.empreiteiroConfere ? " (é o empreiteiro da obra)" : ""}</dd>
                    <dt className="text-gray-400">Número</dt><dd>{n.numero ?? "não lido"}</dd>
                    <dt className="text-gray-400">Data</dt><dd>{dataBr(n.dataEmissao)}</dd>
                    <dt className="text-gray-400">Valor</dt><dd className="font-semibold">{reais(n.valorCentavos)}</dd>
                    <dt className="text-gray-400">Serviço</dt><dd className="break-words">{n.descricao ?? "não lido"}</dd>
                    <dt className="text-gray-400">Sugestão</dt><dd>{n.categoria ?? "sem categoria"}{n.etapa ? ` · ${n.etapa}` : ""}</dd>
                  </dl>
                  {n.itens.length > 0 && (
                    <details className="text-xs"><summary className="cursor-pointer text-gray-300">Itens ({n.itens.length})</summary>
                      <ul className="mt-1 space-y-0.5">{n.itens.map((i, k) => <li key={k} className="break-words">{i.descricao}{i.quantidade ? ` × ${i.quantidade}` : ""} — {reais(i.valorCentavos)}</li>)}</ul>
                    </details>
                  )}
                  {n.alertas.length > 0 && <ul role="alert" className="space-y-0.5 text-xs text-red-300">{n.alertas.map((a, k) => <li key={k}>⚠ {a}</li>)}</ul>}
                  {n.duvidas.length > 0 && <ul className="space-y-0.5 text-xs text-amber-200">{n.duvidas.map((a, k) => <li key={k}>Confira: {a}</li>)}</ul>}
                  <p className="text-xs"><span className="text-gray-400">Empreiteiro: </span>{n.rotuloConfirmacao}
                    {n.respostas.map((r, k) => <span key={k} className="block text-gray-400">{r.tipo === "confirmacao" ? "confirmou" : "pediu correção"} {quando(r.recebidaEm)} ({r.remetente ?? "remetente sem número"}, {r.ligacao}){r.texto ? `: "${r.texto}"` : ""}</span>)}
                  </p>
                  {n.conciliacao && <p className={`text-xs ${COR_APONTAMENTO[n.conciliacao.situacao] ?? ""}`}><span className="text-gray-400">BPO: </span>{n.conciliacao.rotulo} — {n.conciliacao.texto}</p>}
                  {n.vinculoPerdido && <p role="alert" className="text-xs text-amber-200">⚠ Vínculo perdido: {n.vinculoPerdido}</p>}
                  {n.textoSugerido && (
                    <div className="rounded border border-[#C9A961]/20 p-2 text-xs">
                      <p className="text-gray-400">Texto sugerido para VOCÊ enviar ao empreiteiro no grupo (a Dolores não envia):</p>
                      <p className="mt-1 select-all break-words">{n.textoSugerido}</p>
                      <Button size="sm" variant="outline" className={`${botaoSec} mt-2`} onClick={() => copiar(n.textoSugerido!)}><Copy className="mr-1 h-4 w-4" /> Copiar</Button>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {n.conciliacao?.podeConciliar && !n.conciliadaCom && (
                      <Button size="sm" variant="outline" className={botaoSec} disabled={conciliar.isPending} onClick={() => conciliar.mutate({ notaId: n.id })}>Propor ligar ao pagamento (fila)</Button>
                    )}
                    {!n.salvaNoDrive && !n.duplicadaDe && n.situacao !== "nao_e_nota" && (
                      <Button size="sm" variant="outline" className={botaoSec} disabled={salvar.isPending} onClick={() => salvar.mutate({ notaId: n.id })}>Propor salvar na pasta da obra (fila)</Button>
                    )}
                    {n.salvaNoDrive && <span className="text-xs text-emerald-300">arquivo na pasta da obra no Drive</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>}
      </CardContent>
    </Card>
  );
}
