// EPIC-025 (Dolores, etapa 6): operação contínua — só admin. PAUSA GERAL (um botão que para tudo, conferido no servidor em
// todas as portas), gasto do mês (tokens contra o limite e, com o preço informado, R$ estimado contra o teto do dono), estado de
// cada interruptor, rondas (varredura por código, sem IA), relatório diário (só para o número do dono) e eventos. Tudo nasce
// desligado. Layout em uma coluna no iPad em pé e em duas no computador; botões com área de toque de 40 px.
import { useState } from "react";
import { toast } from "sonner";
import { Activity, PauseCircle, PlayCircle } from "lucide-react";
import { HORAS_DO_RELATORIO } from "@shared/dolores/operacao";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const botaoSec = "min-h-10 border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10";
const campo = "mt-1 bg-[#1A2332] border-[#C9A961]/30 text-white";
const quando = (d: string | null | undefined) => (d ? new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—");
const n = (x: number) => x.toLocaleString("pt-BR");
const brl = (x: number) => x.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (uso: number, limite: number) => (limite > 0 ? Math.min(100, Math.round((uso / limite) * 100)) : 0);
const ligado = (v: boolean) => <strong className={v ? "text-green-300" : "text-gray-300"}>{v ? "ligado" : "desligado"}</strong>;

export function DoloresOperacaoCard() {
  const utils = trpc.useUtils();
  const dados = trpc.dolores.operacao.situacao.useQuery(undefined, { retry: false });
  const recarregar = () => utils.dolores.operacao.situacao.invalidate();
  const erro = (e: { message: string }) => toast.error(e.message);
  const [motivo, setMotivo] = useState("");
  const [precos, setPrecos] = useState<{ entrada?: string; saida?: string }>({});
  const pausar = trpc.dolores.operacao.pausar.useMutation({ onSuccess: async r => { toast.success(r.pausa?.pausada ? "Dolores pausada: tudo parado." : "Pausa geral desligada."); setMotivo(""); await recarregar(); }, onError: erro });
  const salvar = trpc.dolores.operacao.salvar.useMutation({ onSuccess: async () => { toast.success("Configuração salva."); setPrecos({}); await recarregar(); }, onError: erro });
  const ronda = trpc.dolores.operacao.rodarRonda.useMutation({
    onSuccess: async r => { toast.success(r.nova ? `Ronda feita${r.falhas.length ? ` (sem leitura: ${r.falhas.join(", ")})` : ""}.` : "Já houve uma ronda neste minuto."); await recarregar(); },
    onError: erro,
  });
  const reenvio = trpc.dolores.operacao.reenviarRelatorioDoDia.useMutation({
    onSuccess: async r => { if (r.ok) toast.success("Relatório de hoje reenviado ao número do dono."); else toast.error(`Relatório não reenviado: ${r.motivo ?? r.situacao}`); await recarregar(); },
    onError: erro,
  });
  const relatorio = trpc.dolores.operacao.enviarRelatorio.useMutation({
    onSuccess: async r => { if (r.ok) toast.success("Relatório enviado ao número do dono."); else toast.error(`Relatório não enviado: ${r.motivo ?? r.situacao}`); await recarregar(); },
    onError: erro,
  });
  const d = dados.data;
  const pausada = !!d?.pausa?.pausada;
  const numeroPreco = (s: string | undefined) => (s === undefined ? undefined : s.trim() === "" ? null : Number(s.replace(",", ".")));

  return (
    <Card className="border-[#C9A961]/20 bg-[#2C3E50] text-gray-100">
      <CardHeader><CardTitle className="flex items-center gap-2 text-[#C9A961]"><Activity className="h-5 w-5" /> Dolores — operação contínua</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-300">
          Rondas por código (sem IA, sem custo) que contam o que precisa de atenção, e o relatório diário enviado SÓ ao número do dono.
          Eventos só entram no relatório: nunca disparam ação. Tudo nasce desligado.
        </p>
        {dados.isLoading ? <p className="text-sm text-gray-300">Carregando…</p> : dados.error ? <p role="alert" className="text-sm text-red-300">{dados.error.message}</p> : d && <>
          {/* Pausa geral */}
          <section className={`space-y-2 rounded-lg border p-3 ${pausada ? "border-red-400/60 bg-red-500/10" : "border-[#C9A961]/20 bg-[#1A2332]"}`}>
            <h3 className="text-sm font-semibold text-[#C9A961]">Pausa geral</h3>
            <p className="text-sm">{d.pausa === null ? <span className="text-amber-200">Não consegui ler a pausa (tudo fica parado até ler).</span>
              : pausada ? <span className="text-red-200">PAUSADA{d.pausa.motivo ? ` — ${d.pausa.motivo}` : ""}: IA, ponte, aprovações, rondas, relatório, classificação, notas e resposta do empreiteiro estão parados.</span>
              : <span className="text-green-200">Em funcionamento (cada função ainda depende do próprio interruptor).</span>}</p>
            {!pausada && <div><Label htmlFor="dol-motivo" className="text-xs text-gray-300">Motivo (opcional)</Label>
              <Input id="dol-motivo" className={campo} maxLength={200} value={motivo} onChange={e => setMotivo(e.target.value)} /></div>}
            <Button className={`min-h-10 ${pausada ? "bg-green-700 hover:bg-green-600" : "bg-red-700 hover:bg-red-600"} text-white`} disabled={pausar.isPending}
              onClick={() => pausar.mutate({ pausada: !pausada, motivo: motivo || undefined })}>
              {pausada ? <><PlayCircle className="mr-1 h-4 w-4" /> Retomar a Dolores</> : <><PauseCircle className="mr-1 h-4 w-4" /> Pausar tudo agora</>}
            </Button>
          </section>

          <div className="grid gap-3 lg:grid-cols-2">
            {/* Gasto do mês */}
            <section className="space-y-2 rounded-lg border border-[#C9A961]/20 bg-[#1A2332] p-3 text-sm">
              <h3 className="text-sm font-semibold text-[#C9A961]">Gasto da IA em {d.gasto.mes}</h3>
              <p>Entrada: {n(d.gasto.uso.entrada)} de {n(d.gasto.limites.entrada)} tokens ({pct(d.gasto.uso.entrada, d.gasto.limites.entrada)}%)</p>
              <p>Saída: {n(d.gasto.uso.saida)} de {n(d.gasto.limites.saida)} tokens ({pct(d.gasto.uso.saida, d.gasto.limites.saida)}%)</p>
              {d.gasto.bloqueio && <p role="alert" className="text-xs text-amber-200">{d.gasto.bloqueio === "sem_limite" ? "Limite mensal não definido: a IA não roda." : "Limite mensal atingido: a IA não roda até o mês que vem."}</p>}
              <p>{d.gasto.reaisEstimados == null ? <span className="text-xs text-gray-400">Informe o preço por milhão de tokens abaixo para estimar em reais (o sistema não inventa preço).</span>
                : <>Estimado: <strong>{brl(d.gasto.reaisEstimados)}</strong>{d.gasto.limiteEmReais != null ? ` · limite configurado ≈ ${brl(d.gasto.limiteEmReais)}` : ""} · teto do dono {brl(d.gasto.tetoDonoReais)}</>}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div><Label htmlFor="dol-pe" className="text-xs text-gray-300">R$ por milhão — entrada</Label>
                  <Input id="dol-pe" inputMode="decimal" className={campo} placeholder={d.gasto.precos.entradaMilhao?.toString() ?? "vazio"} value={precos.entrada ?? ""} onChange={e => setPrecos({ ...precos, entrada: e.target.value })} /></div>
                <div><Label htmlFor="dol-ps" className="text-xs text-gray-300">R$ por milhão — saída</Label>
                  <Input id="dol-ps" inputMode="decimal" className={campo} placeholder={d.gasto.precos.saidaMilhao?.toString() ?? "vazio"} value={precos.saida ?? ""} onChange={e => setPrecos({ ...precos, saida: e.target.value })} /></div>
              </div>
              <Button size="sm" variant="outline" className={botaoSec} disabled={salvar.isPending || (precos.entrada === undefined && precos.saida === undefined)}
                onClick={() => salvar.mutate({ precoEntradaMilhao: numeroPreco(precos.entrada), precoSaidaMilhao: numeroPreco(precos.saida) })}>Salvar preços</Button>
            </section>

            {/* Interruptores */}
            <section className="space-y-1 rounded-lg border border-[#C9A961]/20 bg-[#1A2332] p-3 text-sm">
              <h3 className="text-sm font-semibold text-[#C9A961]">Estado dos interruptores</h3>
              <p>IA da conversa: {ligado(d.interruptores.iaLigada)} (chave e modelo: cartão "Dolores" acima)</p>
              <p>Conexão da Dolores: <strong>{d.interruptores.conexao}</strong> · número do dono: {d.interruptores.numeroDono ?? "não cadastrado"}</p>
              <p>Classificação dos documentos dos grupos: {ligado(d.interruptores.classificacaoLigada)}</p>
              <p>Leitura das notas de obra: {ligado(d.interruptores.leituraNotasLigada)}</p>
              <p>Resposta nos grupos quando marcada (geral): {ligado(d.interruptores.respostaGruposLigada)} (e o de cada grupo, no cartão dos grupos; com a pausa geral ligada, fica muda)</p>
              <p>Rondas: {ligado(d.interruptores.rondasLigadas)} · relatório diário: {ligado(d.interruptores.relatorioLigado)} · eventos: {ligado(d.interruptores.eventosLigados)}</p>
              <p className="text-xs text-gray-400">Eventos nas últimas 24 h: {Object.keys(d.eventos24h).length ? Object.entries(d.eventos24h).map(([k, v]) => `${k}: ${v}`).join(", ") : "nenhum"}</p>
            </section>
          </div>

          {/* Rondas e relatório */}
          <section className="space-y-2 rounded-lg border border-[#C9A961]/20 bg-[#1A2332] p-3 text-sm">
            <h3 className="text-sm font-semibold text-[#C9A961]">Rondas e relatório diário</h3>
            <div className="flex flex-wrap gap-4">
              <label className="flex min-h-10 items-center gap-2"><Switch checked={d.config.rondasLigadas} disabled={salvar.isPending} aria-label="Rondas ligadas"
                onCheckedChange={v => salvar.mutate(v ? { rondasLigadas: true } : { rondasLigadas: false, relatorioLigado: false })} /> Rondas</label>
              <label className="flex min-h-10 items-center gap-2"><Switch checked={d.config.relatorioLigado} disabled={salvar.isPending} aria-label="Relatório diário ligado"
                onCheckedChange={v => salvar.mutate({ relatorioLigado: v })} /> Relatório diário</label>
              <label className="flex min-h-10 items-center gap-2"><Switch checked={d.config.eventosLigados} disabled={salvar.isPending} aria-label="Eventos ligados"
                onCheckedChange={v => salvar.mutate({ eventosLigados: v })} /> Eventos</label>
              <label className="flex min-h-10 items-center gap-2">Relatório a partir das
                <select aria-label="Hora do relatório" className="min-h-10 rounded border border-[#C9A961]/30 bg-[#1A2332] px-2" value={d.config.relatorioHora} disabled={salvar.isPending}
                  onChange={e => salvar.mutate({ relatorioHora: Number(e.target.value) })}>
                  {HORAS_DO_RELATORIO.map(h => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
                </select></label>
            </div>
            <p className="text-xs text-gray-400">
              O cron da Vercel chama a rotina uma vez por dia às {d.agendamento.horarioBrasilia} (Brasília; {d.agendamento.horarioUtc} UTC). O relatório diário sai nessa
              execução se a hora escolhida já tiver chegado — por isso só dá para escolher até as {d.agendamento.horarioBrasilia} (uma hora depois disso faria o relatório
              nunca sair; para outro horário, a equipe técnica muda o agendamento). Sob demanda: o botão abaixo ou a mensagem
              "relatório" do dono no WhatsApp.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className={botaoSec} disabled={ronda.isPending || pausada} onClick={() => ronda.mutate()}>{ronda.isPending ? "Fazendo a ronda…" : "Fazer ronda agora"}</Button>
              <Button size="sm" variant="outline" className={botaoSec} disabled={relatorio.isPending || pausada || !d.config.relatorioLigado} onClick={() => relatorio.mutate()}>
                {relatorio.isPending ? "Enviando…" : "Enviar relatório agora ao dono"}</Button>
            </div>
            <h4 className="pt-2 text-xs font-semibold text-gray-300">Últimas rondas</h4>
            {!d.rondas.length ? <p className="text-xs text-gray-400">Nenhuma ronda ainda.</p> : (
              <ul className="space-y-1 text-xs">{d.rondas.map(r => (
                <li key={r.id}>{quando(r.criadoEm)} · {r.origem} · {r.duracaoMs ?? "?"} ms{r.falhas.length ? <span className="text-amber-200"> · sem leitura: {r.falhas.join(", ")}</span> : " · todas as seções lidas"}</li>
              ))}</ul>
            )}
            <h4 className="pt-2 text-xs font-semibold text-gray-300">Relatório diário de hoje</h4>
            {!d.relatorioDeHoje ? <p className="text-xs text-gray-400">Ainda não gerado hoje.</p> : d.relatorioDeHoje.situacao === "enviado" ? (
              <p className="text-xs">Gerado em {quando(d.relatorioDeHoje.criadoEm)} · <span className="text-green-300">enviado</span></p>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <p className="text-amber-200">Gerado em {quando(d.relatorioDeHoje.criadoEm)} · envio {d.relatorioDeHoje.situacao === "falhou" ? "FALHOU" : "sem registro"}
                  {d.relatorioDeHoje.motivo ? ` (${d.relatorioDeHoje.motivo})` : ""} — use “Enviar agora” (reenvia o mesmo texto, não monta outro relatório).</p>
                <Button size="sm" variant="outline" className={botaoSec} disabled={reenvio.isPending || pausada || !d.config.relatorioLigado} onClick={() => reenvio.mutate()}>
                  {reenvio.isPending ? "Enviando…" : "Enviar agora"}</Button>
              </div>
            )}
            <h4 className="pt-2 text-xs font-semibold text-gray-300">Último relatório</h4>
            {!d.ultimoRelatorio ? <p className="text-xs text-gray-400">Nenhum relatório ainda.</p> : (
              <div className="space-y-1 text-xs">
                <p>{quando(d.ultimoRelatorio.criadoEm)} · {d.ultimoRelatorio.tipo === "diario" ? "diário" : "sob demanda"} · {d.ultimoRelatorio.origem} · envio:{" "}
                  {d.ultimoRelatorio.envio ? (d.ultimoRelatorio.envio.resultado === "ok" ? <span className="text-green-300">enviado</span> : <span className="text-amber-200">não enviado{d.ultimoRelatorio.envio.motivo ? ` (${d.ultimoRelatorio.envio.motivo})` : ""}</span>) : "sem registro"}</p>
                <details><summary className="cursor-pointer text-gray-300">Texto (como ficou no registro, com dados pessoais mascarados)</summary>
                  <pre className="mt-1 whitespace-pre-wrap break-words text-gray-200">{d.ultimoRelatorio.texto}</pre></details>
              </div>
            )}
          </section>
        </>}
      </CardContent>
    </Card>
  );
}
