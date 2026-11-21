// EPIC-025 (Dolores, etapa 6): operação contínua — só admin. PAUSA GERAL (um botão que para tudo, conferido no servidor em
// todas as portas), gasto do mês (tokens contra o limite e, com o preço informado, R$ estimado contra o teto do dono), estado de
// cada interruptor, rondas (varredura por código, sem IA), relatório diário (só para o número do dono) e eventos. Tudo nasce
// desligado. Layout em uma coluna no iPad em pé e em duas no computador; botões com área de toque de 40 px.
import { useState } from "react";
import { toast } from "sonner";
import { Activity, PauseCircle, PlayCircle } from "lucide-react";
import { HORAS_DO_RELATORIO } from "@shared/dolores/operacao";
import { FUNCOES_DO_GASTO, ROTULO_FUNCAO_CONSUMO, erroDasPartes, type FuncaoDoConsumo } from "@shared/dolores/custo";
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
const usd = (x: number) => `US$ ${x.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: x < 1 ? 4 : 2 })}`;
const dinheiro = (dolares: number | null, reais: number | null) =>
  dolares == null && reais == null ? "sem preço" : `${dolares != null ? usd(dolares) : "US$ —"} · ${reais != null ? brl(reais) : "R$ — (falta a cotação)"}`;
type CamposPreco = { entrada?: string; saida?: string; cacheEscrita?: string; cacheLeitura?: string };
const CAMPOS_PRECO: Array<[keyof CamposPreco, string]> = [["entrada", "entrada"], ["saida", "saída"], ["cacheEscrita", "escrita de cache"], ["cacheLeitura", "leitura de cache"]];
const precoTxt = (x: number | null) => (x == null ? "—" : x.toLocaleString("pt-BR", { maximumFractionDigits: 4 }));
const pct = (uso: number, limite: number) => (limite > 0 ? Math.min(100, Math.round((uso / limite) * 100)) : 0);
/** Barra de uso (gasto × parte): até 100% preenchida; amarela a partir de 80%, vermelha em 100%. */
function Barra({ valor, rotulo }: { valor: number; rotulo: string }) {
  const v = Number.isFinite(valor) ? Math.max(0, valor) : 100;
  const cor = v >= 100 ? "bg-red-500" : v >= 80 ? "bg-amber-400" : "bg-[#C9A961]";
  return (
    <div role="progressbar" aria-label={rotulo} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(v))} className="h-2 w-full overflow-hidden rounded bg-[#C9A961]/10">
      <div className={`h-2 ${cor}`} style={{ width: `${Math.min(100, v)}%` }} />
    </div>
  );
}
const ROTULO_ALVO = (alvo: string) => (alvo === "total" ? "Total" : ROTULO_FUNCAO_CONSUMO[alvo as FuncaoDoConsumo] ?? alvo);
const ligado = (v: boolean) => <strong className={v ? "text-green-300" : "text-gray-300"}>{v ? "ligado" : "desligado"}</strong>;

export function DoloresOperacaoCard() {
  const utils = trpc.useUtils();
  const dados = trpc.dolores.operacao.situacao.useQuery(undefined, { retry: false });
  const recarregar = () => utils.dolores.operacao.situacao.invalidate();
  const erro = (e: { message: string }) => toast.error(e.message);
  const [motivo, setMotivo] = useState("");
  const [precos, setPrecos] = useState<{ entrada?: string; saida?: string }>({});
  // Etapa 8 — preços por modelo (US$ por milhão) e cotação, editados na tela
  const [precosModelo, setPrecosModelo] = useState<Record<string, CamposPreco>>({});
  const [cotacao, setCotacao] = useState<string | undefined>(undefined);
  // EPIC-027 C5-E5 — divisão do limite por função (só o admin vê este cartão; o servidor confere de novo)
  const [partes, setPartes] = useState<Partial<Record<FuncaoDoConsumo, string>>>({});
  const pausar = trpc.dolores.operacao.pausar.useMutation({ onSuccess: async r => { toast.success(r.pausa?.pausada ? "Dolores pausada: tudo parado." : "Pausa geral desligada."); setMotivo(""); await recarregar(); }, onError: erro });
  const salvar = trpc.dolores.operacao.salvar.useMutation({ onSuccess: async () => { toast.success("Configuração salva."); setPrecos({}); await recarregar(); }, onError: erro });
  const salvarPrecoModelo = trpc.dolores.operacao.salvarPrecoModelo.useMutation({ onSuccess: async (_r, v) => { toast.success(`Preço de ${v.modelo} salvo.`); setPrecosModelo(p => { const { [v.modelo]: _x, ...resto } = p; return resto; }); await recarregar(); }, onError: erro });
  const usarSugerido = trpc.dolores.operacao.usarPrecoSugerido.useMutation({ onSuccess: async (_r, v) => { toast.success(`Preço sugerido gravado para ${v.modelo}.`); await recarregar(); }, onError: erro });
  const salvarPartes = trpc.dolores.operacao.salvarPartes.useMutation({ onSuccess: async () => { toast.success("Divisão do gasto salva."); setPartes({}); await recarregar(); }, onError: erro });
  const salvarCotacao = trpc.dolores.operacao.salvarCotacao.useMutation({ onSuccess: async () => { toast.success("Cotação salva."); setCotacao(undefined); await recarregar(); }, onError: erro });
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
            {/* Gasto do mês — Etapa 8: por modelo e por tipo de token */}
            <section className="space-y-2 rounded-lg border border-[#C9A961]/20 bg-[#1A2332] p-3 text-sm lg:col-span-2">
              <h3 className="text-sm font-semibold text-[#C9A961]">Gasto da IA em {d.gasto.mes}</h3>
              <p className="text-xs text-gray-300">Limite mensal (a trava de segurança, em tokens). O cache conta pelo peso do preço: cada token de escrita de cache vale 1,25 e cada token de leitura de cache vale 0,1.</p>
              <p>Entrada contada no limite: {n(d.gasto.uso.entrada)} de {n(d.gasto.limites.entrada)} tokens ({pct(d.gasto.uso.entrada, d.gasto.limites.entrada)}%)
                {d.gasto.custo && (d.gasto.custo.tokensNoLimite.entrada > 0) ? <span className="text-xs text-gray-400"> — sem cache: {n(d.gasto.custo.porModelo.reduce((s, m) => s + m.uso.entrada, 0))}; cache: {n(d.gasto.custo.porModelo.reduce((s, m) => s + m.uso.cacheEscrita + m.uso.cacheLeitura, 0))}</span> : null}</p>
              <p>Saída: {n(d.gasto.uso.saida)} de {n(d.gasto.limites.saida)} tokens ({pct(d.gasto.uso.saida, d.gasto.limites.saida)}%)</p>
              {d.gasto.bloqueio && <p role="alert" className="text-xs text-amber-200">{d.gasto.bloqueio === "sem_limite" ? "Limite mensal não definido: a IA não roda." : "Limite mensal atingido: a IA não roda até o mês que vem."}</p>}

              <h4 className="pt-1 text-xs font-semibold text-gray-300">Custo real estimado (pelo preço de cada modelo)</h4>
              {!d.gasto.custo ? <p className="text-xs text-amber-200">Não consegui calcular o custo agora.</p> : !d.gasto.custo.porModelo.length ? <p className="text-xs text-gray-400">Nada gasto neste mês.</p> : <>
                <p>Total do mês: <strong>{d.gasto.custo.total.completo ? dinheiro(d.gasto.custo.total.dolares, d.gasto.custo.total.reais) : "incompleto (há modelo sem preço)"}</strong> · teto do dono {brl(d.gasto.tetoDonoReais)}</p>
                <ul className="space-y-1 text-xs">{d.gasto.custo.porModelo.map(m => (
                  <li key={m.modelo}><strong>{m.modelo}</strong>: {dinheiro(m.dolares, m.reais)}
                    {m.fonte === "reserva" ? <span className="text-amber-200"> (sem preço cadastrado: usou o preço de reserva)</span> : m.fonte === "sem_preco" ? <span className="text-amber-200"> (sem preço: informe abaixo)</span> : null}
                    <span className="text-gray-400"> · entrada {n(m.uso.entrada)}, saída {n(m.uso.saida)}, escrita de cache {n(m.uso.cacheEscrita)}, leitura de cache {n(m.uso.cacheLeitura)}</span></li>
                ))}</ul>
                {d.gasto.custo.cacheAssumido && <p className="text-xs text-gray-400">Cache sem preço informado: assumi {String(d.gasto.fatoresCache.escrita).replace(".", ",")}× (escrita) e {String(d.gasto.fatoresCache.leitura).replace(".", ",")}× (leitura) do preço de entrada.</p>}
              </>}

              {/* EPIC-027 C5-E5 — gasto por função: cada uma com a sua parte do limite; ao bater a parte, só ela para */}
              <h4 className="pt-1 text-xs font-semibold text-gray-300">Gasto por função (cada função com a sua parte do limite)</h4>
              {!d.gastoPorFuncao ? <p className="text-xs text-amber-200">Não consegui calcular o gasto por função agora.</p> : (() => {
                const g = d.gastoPorFuncao;
                const valores = Object.fromEntries(FUNCOES_DO_GASTO.map(f => [f, partes[f] !== undefined ? Number(partes[f]) : g.partes[f]])) as Record<FuncaoDoConsumo, number>;
                const editou = FUNCOES_DO_GASTO.some(f => partes[f] !== undefined);
                const problema = editou ? erroDasPartes(valores) : null;
                const soma = FUNCOES_DO_GASTO.reduce((s, f) => s + (Number.isFinite(valores[f]) ? valores[f] : 0), 0);
                return <>
                  <div className="space-y-1">
                    <p className="text-xs">Total: <strong>{g.total.pct.toLocaleString("pt-BR")}%</strong>{g.total.reais != null ? ` · ${brl(g.total.reais)} de ${brl(g.total.limiteReais)}` : " · sem preço completo: contado pelos tokens"}</p>
                    <Barra valor={g.total.pct} rotulo="Gasto total do mês" />
                  </div>
                  <ul className="space-y-2 text-xs">{g.funcoes.map(f => (
                    <li key={f.funcao} className="space-y-1">
                      <p><strong>{f.rotulo}</strong> — parte de {f.parte}% · {f.pct.toLocaleString("pt-BR")}% usado
                        {f.reais != null ? ` · ${brl(f.reais)} de ${brl(f.limiteReais)}` : ""}
                        <span className="text-gray-400"> · tokens: {n(f.tokens.entrada)} de {n(f.limiteTokens.entrada)} (entrada), {n(f.tokens.saida)} de {n(f.limiteTokens.saida)} (saída)</span>
                        {f.tokensPct >= 100 ? <span className="font-semibold text-red-300"> — parte atingida: só esta função está sem IA</span> : f.pct >= 80 ? <span className="text-amber-200"> — passou de 80%</span> : null}</p>
                      <Barra valor={f.pct} rotulo={`Gasto de ${f.rotulo}`} />
                    </li>
                  ))}</ul>
                  <p className="text-xs text-gray-400">
                    Alertas ao dono neste mês (WhatsApp, uma vez por limite, em 80% e em 100%):{" "}
                    {!g.alertas.disponivel ? "indisponíveis até a migração 0148 ser aplicada."
                      : !g.alertas.alertas.length ? "nenhum ainda."
                      : g.alertas.alertas.map(a => `${ROTULO_ALVO(a.alvo)} ${a.nivel}% (${a.enviado ? "enviado" : "enviando"} em ${quando(a.criadoEm)})`).join(" · ")}
                  </p>
                  <div className="space-y-1 rounded border border-[#C9A961]/10 p-2">
                    <p className="text-xs font-semibold text-gray-300">Divisão do limite (% por função; soma 100, cada uma de {g.minimo} a {g.maximo})</p>
                    {!g.partesDisponiveis && <p className="text-xs text-amber-200">A migração 0148 ainda não foi aplicada: vale a divisão padrão e não dá para salvar.</p>}
                    <div className="grid gap-2 sm:grid-cols-5">
                      {FUNCOES_DO_GASTO.map(f => (
                        <div key={f}><Label htmlFor={`dol-parte-${f}`} className="text-xs text-gray-300">{ROTULO_FUNCAO_CONSUMO[f]}</Label>
                          <Input id={`dol-parte-${f}`} inputMode="numeric" className={campo} value={partes[f] ?? String(g.partes[f])}
                            onChange={e => setPartes(p => ({ ...p, [f]: e.target.value.replace(/\D/g, "").slice(0, 3) }))} /></div>
                      ))}
                    </div>
                    <p className={`text-xs ${problema ? "text-amber-200" : "text-gray-400"}`} role={problema ? "alert" : undefined}>Soma: {soma}%{problema ? ` — ${problema}` : ""}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" className={botaoSec} disabled={salvarPartes.isPending || !editou || !!problema || !g.partesDisponiveis}
                        onClick={() => salvarPartes.mutate(valores)}>Salvar divisão</Button>
                      <Button size="sm" variant="outline" className={botaoSec} disabled={salvarPartes.isPending || !g.partesDisponiveis}
                        onClick={() => salvarPartes.mutate({ ...g.padrao })}>Voltar à divisão do dono (55 · 20 · 10 · 10 · 5)</Button>
                    </div>
                  </div>
                </>;
              })()}

              {/* EPIC-026 C5 — previsão em reais para acompanhar o mês */}
              <h4 className="pt-1 text-xs font-semibold text-gray-300">Previsão em reais</h4>
              <ul className="space-y-1 text-xs">
                <li>Gasto até agora: <strong>{d.gasto.previsao.gastoMesReais != null ? brl(d.gasto.previsao.gastoMesReais) : "sem como calcular (falta preço ou cotação)"}</strong></li>
                <li>Projeção até o fim do mês, pelo ritmo atual: <strong>{d.gasto.previsao.projecaoFimDoMesReais != null ? brl(d.gasto.previsao.projecaoFimDoMesReais) : "—"}</strong></li>
                <li>O máximo que os limites permitem (pior caso, tudo no modelo mais caro em uso): <strong>{d.gasto.previsao.limite?.piorCaso?.reais != null ? `${brl(d.gasto.previsao.limite.piorCaso.reais)} (${d.gasto.previsao.limite.piorCaso.modelo})` : "—"}</strong>
                  {d.gasto.previsao.limite?.daConversa?.reais != null ? <span className="text-gray-400"> · só o modelo da conversa: {brl(d.gasto.previsao.limite.daConversa.reais)}</span> : null}</li>
                <li className="text-gray-400">Teto do dono: {brl(d.gasto.tetoDonoReais)} por mês.</li>
              </ul>
              {d.gasto.previsao.limite?.semPreco.length ? <p className="text-xs text-amber-200">Sem preço cadastrado: {d.gasto.previsao.limite.semPreco.join(", ")} — a previsão pode ficar abaixo do real.</p> : null}
              {d.gasto.previsao.limite?.acimaDoTeto && <p role="alert" className="text-xs font-semibold text-red-300">Atenção: os limites permitem gastar mais que o teto do dono. Diminua os limites no cartão "Dolores — WhatsApp".</p>}
              {d.gasto.previsao.limite?.suspeita && <p role="alert" className="text-xs text-yellow-200">{d.gasto.previsao.limite.suspeita}</p>}
              {d.gasto.previsao.projecaoFimDoMesReais != null && d.gasto.previsao.projecaoFimDoMesReais > d.gasto.tetoDonoReais && <p role="alert" className="text-xs font-semibold text-red-300">No ritmo atual, o mês passa do teto do dono.</p>}

              <h4 className="pt-1 text-xs font-semibold text-gray-300">Preços por modelo (US$ por milhão de tokens) — o sistema não inventa preço</h4>
              {!d.gasto.precosDisponiveis ? <p className="text-xs text-amber-200">Preços por modelo indisponíveis: a migração 0134 ainda não foi aplicada (a estimativa usa só a reserva).</p> : <>
                <div className="flex flex-wrap items-end gap-2">
                  <div><Label htmlFor="dol-cot" className="text-xs text-gray-300">Cotação do dólar (R$ por US$)</Label>
                    <Input id="dol-cot" inputMode="decimal" className={`${campo} w-32`} placeholder={d.gasto.cotacao?.toString().replace(".", ",") ?? "vazio"} value={cotacao ?? ""} onChange={e => setCotacao(e.target.value)} /></div>
                  <Button size="sm" variant="outline" className={botaoSec} disabled={salvarCotacao.isPending || cotacao === undefined}
                    onClick={() => salvarCotacao.mutate({ cotacao: numeroPreco(cotacao) ?? null })}>Salvar cotação</Button>
                  {d.gasto.cotacao == null && <Button size="sm" variant="outline" className={botaoSec} disabled={salvarCotacao.isPending}
                    onClick={() => salvarCotacao.mutate({ cotacao: d.gasto.sugestao.cotacao })}>Usar a sugerida (R$ {precoTxt(d.gasto.sugestao.cotacao)})</Button>}
                </div>
                {!d.gasto.precosPorModelo.length ? <p className="text-xs text-gray-400">Nenhum modelo em uso nem escolhido em Integrações › Anthropic.</p> : d.gasto.precosPorModelo.map(({ modelo, preco, sugerido }) => {
                  const ed = precosModelo[modelo] ?? {};
                  const mudou = CAMPOS_PRECO.some(([k]) => ed[k] !== undefined);
                  return (
                    <div key={modelo} className="space-y-1 rounded border border-[#C9A961]/10 p-2">
                      <p className="text-xs font-semibold">{modelo}{!preco || preco.entrada == null || preco.saida == null ? <span className="font-normal text-amber-200"> — sem preço (usa a reserva)</span> : null}</p>
                      <div className="grid gap-2 sm:grid-cols-4">
                        {CAMPOS_PRECO.map(([k, rotulo]) => (
                          <div key={k}><Label htmlFor={`dol-p-${modelo}-${k}`} className="text-xs text-gray-300">{rotulo}</Label>
                            <Input id={`dol-p-${modelo}-${k}`} inputMode="decimal" className={campo} value={ed[k] ?? ""}
                              placeholder={preco?.[k] != null ? String(preco[k]).replace(".", ",") : k === "cacheEscrita" ? "vazio = 1,25× entrada" : k === "cacheLeitura" ? "vazio = 0,1× entrada" : "vazio"}
                              onChange={e => setPrecosModelo(p => ({ ...p, [modelo]: { ...ed, [k]: e.target.value } }))} /></div>
                        ))}
                      </div>
                      {sugerido && (!preco || preco.entrada == null || preco.saida == null) && (
                        <div className="flex flex-wrap items-center gap-2 rounded bg-[#C9A961]/10 p-2 text-xs">
                          <span>Preço sugerido ({d.gasto.sugestao.fonte}): entrada {precoTxt(sugerido.entrada)}, saída {precoTxt(sugerido.saida)}, escrita de cache {precoTxt(sugerido.cacheEscrita)}, leitura de cache {precoTxt(sugerido.cacheLeitura)}. Só entra na conta depois de gravado.</span>
                          <Button size="sm" variant="outline" className={botaoSec} disabled={usarSugerido.isPending} onClick={() => usarSugerido.mutate({ modelo })}>Usar o sugerido</Button>
                        </div>
                      )}
                      <Button size="sm" variant="outline" className={botaoSec} disabled={salvarPrecoModelo.isPending || !mudou}
                        onClick={() => {
                          const v = (k: keyof CamposPreco) => (ed[k] !== undefined ? numeroPreco(ed[k]) ?? null : preco?.[k] ?? null);
                          salvarPrecoModelo.mutate({ modelo, entrada: v("entrada"), saida: v("saida"), cacheEscrita: v("cacheEscrita"), cacheLeitura: v("cacheLeitura") });
                        }}>Salvar preço de {modelo}</Button>
                    </div>
                  );
                })}
              </>}

              <h4 className="pt-1 text-xs font-semibold text-gray-300">Preço de reserva (R$ por milhão, preço único) — só para modelo sem preço cadastrado</h4>
              <div className="grid gap-2 sm:grid-cols-2">
                <div><Label htmlFor="dol-pe" className="text-xs text-gray-300">R$ por milhão — entrada</Label>
                  <Input id="dol-pe" inputMode="decimal" className={campo} placeholder={d.gasto.precos.entradaMilhao?.toString() ?? "vazio"} value={precos.entrada ?? ""} onChange={e => setPrecos({ ...precos, entrada: e.target.value })} /></div>
                <div><Label htmlFor="dol-ps" className="text-xs text-gray-300">R$ por milhão — saída</Label>
                  <Input id="dol-ps" inputMode="decimal" className={campo} placeholder={d.gasto.precos.saidaMilhao?.toString() ?? "vazio"} value={precos.saida ?? ""} onChange={e => setPrecos({ ...precos, saida: e.target.value })} /></div>
              </div>
              {d.gasto.limiteEmReais != null && <p className="text-xs text-gray-400">Limite configurado pelo preço de reserva ≈ {brl(d.gasto.limiteEmReais)}.</p>}
              <Button size="sm" variant="outline" className={botaoSec} disabled={salvar.isPending || (precos.entrada === undefined && precos.saida === undefined)}
                onClick={() => salvar.mutate({ precoEntradaMilhao: numeroPreco(precos.entrada), precoSaidaMilhao: numeroPreco(precos.saida) })}>Salvar preços de reserva</Button>
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
                onCheckedChange={v => salvar.mutate({ relatorioLigado: v })} /> Relatório diário
                <span className={d.config.relatorioLigado && !d.config.rondasLigadas ? "text-xs font-semibold text-amber-300" : "text-xs text-gray-400"}>
                  {d.config.relatorioLigado && !d.config.rondasLigadas
                    ? "(rondas desligadas: nada sai — o relatório depende das rondas ligadas)"
                    : "(o relatório depende das rondas ligadas)"}
                </span></label>
              <label className="flex min-h-10 items-center gap-2"><Switch checked={d.config.eventosLigados} disabled={salvar.isPending} aria-label="Eventos ligados"
                onCheckedChange={v => salvar.mutate({ eventosLigados: v })} /> Eventos</label>
              <label className="flex min-h-10 items-center gap-2">Relatório a partir das
                <select aria-label="Hora do relatório" className="min-h-10 rounded border border-[#C9A961]/30 bg-[#1A2332] px-2" value={d.config.relatorioHora} disabled={salvar.isPending}
                  onChange={e => salvar.mutate({ relatorioHora: Number(e.target.value) })}>
                  {HORAS_DO_RELATORIO.map(h => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
                </select></label>
            </div>
            <p className="text-xs text-gray-400">
              Horário de Brasília. A ronda do dia é feita uma vez, às {d.agendamento.horarioBrasilia}. O relatório diário sai uma vez por dia, na hora escolhida
              (de 07:00 a 14:00); se a hora escolhida for depois das {d.agendamento.horarioBrasilia}, a ronda é refeita na hora do relatório para ir com os números
              do momento. Sob demanda: o botão abaixo ou a mensagem "relatório" do dono no WhatsApp.
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
