// EPIC-027 C7 (20/11/2026) — Configurações › Integrações › "API oficial do WhatsApp (YCloud)". Só administrador.
// Chave digitada pelo dono (nunca exibida de volta: só "terminando em …"), Testar (número, nome verificado, situação, qualidade e
// limite), avisos de entrega, interruptor geral (desligado por padrão), tetos e preço estimado.
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const botaoSec = "border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10";
const campoCls = "mt-1 bg-[#1A2332] border-[#C9A961]/30 text-white placeholder:text-gray-500";
const limiteLegivel = (n: number | null | undefined) => (n === null || n === undefined ? "sem limite da Meta (valem os tetos abaixo)" : `${n.toLocaleString("pt-BR")} clientes em 24 h`);

export function YcloudCard() {
  const utils = trpc.useUtils();
  const status = trpc.whatsappOficial.status.useQuery(undefined, { retry: false });
  const recarregar = () => utils.whatsappOficial.status.invalidate();
  const onError = (e: { message: string }) => toast.error(e.message);
  const testar = trpc.whatsappOficial.testar.useMutation({ onSuccess: () => recarregar(), onError });
  const salvarChave = trpc.whatsappOficial.salvarChave.useMutation({
    onSuccess: async r => { toast.success(r.numeroConfere ? "Chave salva e número conferido." : "Chave salva — atenção ao aviso do número."); setChave(""); setTrocando(false); await recarregar(); testar.mutate(); },
    onError,
  });
  const removerChave = trpc.whatsappOficial.removerChave.useMutation({ onSuccess: async () => { toast.success("Chave removida; disparos desligados."); await recarregar(); }, onError });
  const ativarAvisos = trpc.whatsappOficial.ativarAvisos.useMutation({
    onSuccess: async r => { toast.success(r.jaAtivo ? "Os avisos de entrega já estavam ativos." : r.precisaSegredo ? "Endpoint criado, mas a YCloud não devolveu o segredo: cole-o no campo abaixo." : "Avisos de entrega ativados."); await recarregar(); },
    onError,
  });
  const salvarSegredo = trpc.whatsappOficial.salvarSegredoAvisos.useMutation({ onSuccess: async () => { toast.success("Segredo salvo."); setSegredo(""); await recarregar(); }, onError });
  const salvarConfig = trpc.whatsappOficial.salvarConfig.useMutation({ onSuccess: async () => { toast.success("Salvo."); setTetos({}); await recarregar(); }, onError });
  const [trocando, setTrocando] = useState(false);
  const [chave, setChave] = useState("");
  const [segredo, setSegredo] = useState("");
  const [tetos, setTetos] = useState<{ tetoDia?: string; tetoCampanha?: string; precoEstimado?: string; moeda?: string }>({});
  const s = status.data;
  const t = testar.data;

  if (status.error) return null; // não é administrador por papel
  return (
    <Card className="border-[#C9A961]/20 bg-[#2C3E50] text-gray-100">
      <CardHeader><CardTitle className="text-[#C9A961]">API oficial do WhatsApp (YCloud) — disparos de campanha</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="rounded-lg border border-[#C9A961]/20 bg-[#1A2332] p-3 text-xs text-gray-300 space-y-1">
          <p className="flex items-start gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0 text-[#C9A961]" /> Os <b>disparos de campanha</b> saem pela API oficial da Meta (YCloud), com modelos aprovados — sem arriscar o número.</p>
          <p className="pl-6">As <b>conversas, os grupos e a Dolores continuam pelo WhatsApp Web</b> (Evolution), como hoje. Grupos não passam pela API.</p>
          <p className="pl-6">O número da API precisa ser o <b>mesmo</b> número da empresa (coexistência). Se for outro, os disparos ficam bloqueados.</p>
        </div>
        {!s ? <p className="flex items-center gap-2 text-gray-300"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p> : <>
          <p>{s.configurado ? `Chave salva terminando em ${s.final}.` : "Nenhuma chave salva."}</p>
          {(t ?? s.conferencia) && (() => {
            const c = t ?? s.conferencia!;
            return (
              <div className="space-y-1 rounded-lg bg-[#1A2332] p-3">
                {!c.numeroConfere && <p role="alert" className="flex items-start gap-2 rounded border border-red-500/50 bg-red-500/15 p-2 font-bold text-red-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {t?.aviso ?? "O número da API não confere com o número da empresa: disparos bloqueados."}</p>}
                <p>Número: <b>{c.numero ?? "—"}</b>{c.numeroConfere ? <span className="ml-2 text-green-300">(é o número da empresa)</span> : null}</p>
                <p>Nome verificado: {c.nomeVerificado ?? "—"}</p>
                <p>Situação: <span className={c.status === "CONNECTED" ? "text-green-300" : "text-yellow-200"}>{c.statusRotulo ?? "—"}</span> · Qualidade: {c.qualidadeRotulo ?? "—"}</p>
                <p>Limite de mensagens: {limiteLegivel(c.limiteDiario)} ({c.tier ?? "—"})</p>
              </div>
            );
          })()}
          {testar.isPending && <p className="flex items-center gap-2 text-gray-300"><Loader2 className="h-4 w-4 animate-spin" /> Testando na YCloud…</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className={botaoSec} disabled={!s.configurado || testar.isPending} onClick={() => testar.mutate()}>Testar</Button>
            <Button size="sm" variant="outline" className={botaoSec} onClick={() => { setTrocando(v => !v); setChave(""); }}>{trocando ? "Cancelar" : s.configurado ? "Trocar chave" : "Adicionar chave"}</Button>
            {s.configurado && <Button size="sm" variant="outline" className={botaoSec} disabled={removerChave.isPending} onClick={() => { if (window.confirm("Remover a chave da YCloud? Os disparos ficam desligados.")) removerChave.mutate(); }}>Remover chave</Button>}
          </div>
          {trocando && (
            <form className="space-y-2 rounded-lg bg-[#1A2332] p-3" onSubmit={e => { e.preventDefault(); salvarChave.mutate({ apiKey: chave }); }}>
              <Label className="text-gray-300">Chave de API da YCloud (Developers › API key)</Label>
              <Input type="password" autoComplete="off" value={chave} onChange={e => setChave(e.target.value)} className={campoCls} />
              <Button type="submit" size="sm" disabled={!chave.trim() || salvarChave.isPending} className="bg-[#C9A961] font-bold text-[#1A2332] hover:bg-[#B8985A]">{salvarChave.isPending ? "Validando…" : "Validar e salvar"}</Button>
            </form>
          )}

          <div className="space-y-2 border-t border-[#C9A961]/10 pt-3">
            <p className="font-semibold text-gray-200">Avisos de entrega (situação de cada mensagem)</p>
            <p className="text-xs text-gray-300">{s.avisos.configurado ? `Ativos — segredo terminando em ${s.avisos.final}${s.avisos.status ? ` (endpoint ${s.avisos.status})` : ""}.` : "Ainda não ativados."} Endereço: <code className="break-all">{s.avisos.url}</code></p>
            <p className="text-[11px] text-gray-400">Só os eventos de situação de mensagem enviada e de revisão de modelo. Mensagens recebidas NÃO passam pela YCloud (continuam pela Evolution).</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className={botaoSec} disabled={!s.configurado || ativarAvisos.isPending} onClick={() => ativarAvisos.mutate()}>{ativarAvisos.isPending ? "Ativando…" : "Ativar avisos de entrega"}</Button>
            </div>
            <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); salvarSegredo.mutate({ segredo }); }}>
              <div className="min-w-[240px] flex-1"><Label className="text-xs text-gray-400">Segredo do aviso (só se o endpoint foi criado no painel da YCloud)</Label>
                <Input type="password" autoComplete="off" value={segredo} onChange={e => setSegredo(e.target.value)} className={campoCls} /></div>
              <Button type="submit" size="sm" variant="outline" className={botaoSec} disabled={!segredo.trim() || salvarSegredo.isPending}>Salvar segredo</Button>
            </form>
          </div>

          <div className="space-y-2 border-t border-[#C9A961]/10 pt-3">
            <p className="font-semibold text-gray-200">Disparos pela API oficial</p>
            <p className={s.ligado ? "flex items-center gap-2 text-green-300" : "flex items-center gap-2 text-gray-300"}>{s.ligado ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />} {s.ligado ? "LIGADOS." : "DESLIGADOS (padrão)."}</p>
            <p className="text-xs text-gray-300">Usados nas últimas 24 h: {s.usados24h}{s.restanteHoje !== null ? ` · ainda cabem ${s.restanteHoje}` : ""}. Quem pediu para não receber: {s.optout}.</p>
            <div className="grid gap-2 sm:grid-cols-4">
              <div><Label className="text-xs text-gray-400">Teto por dia (24 h)</Label><Input inputMode="numeric" className={campoCls} value={tetos.tetoDia ?? String(s.tetoDia)} onChange={e => setTetos(v => ({ ...v, tetoDia: e.target.value }))} /></div>
              <div><Label className="text-xs text-gray-400">Teto por campanha</Label><Input inputMode="numeric" className={campoCls} value={tetos.tetoCampanha ?? String(s.tetoCampanha)} onChange={e => setTetos(v => ({ ...v, tetoCampanha: e.target.value }))} /></div>
              <div><Label className="text-xs text-gray-400">Preço estimado por mensagem</Label><Input inputMode="decimal" placeholder="ex.: 0,0625" className={campoCls} value={tetos.precoEstimado ?? (s.precoEstimado === null ? "" : String(s.precoEstimado).replace(".", ","))} onChange={e => setTetos(v => ({ ...v, precoEstimado: e.target.value }))} /></div>
              <div><Label className="text-xs text-gray-400">Moeda</Label><Input className={campoCls} maxLength={3} value={tetos.moeda ?? s.moeda} onChange={e => setTetos(v => ({ ...v, moeda: e.target.value.toUpperCase() }))} /></div>
            </div>
            <p className="text-[11px] text-gray-400">O limite real da conta (lido da YCloud a cada lote) sempre vale: o sistema usa o menor entre ele e o teto por dia. O preço estimado é só para a prévia — confira o valor no painel da YCloud; depois dos primeiros envios a prévia passa a usar a média registrada.</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className={botaoSec} disabled={!Object.keys(tetos).length || salvarConfig.isPending} onClick={() => {
                const n = (v?: string) => (v === undefined ? undefined : Number(v.replace(",", ".")));
                salvarConfig.mutate({
                  ...(tetos.tetoDia !== undefined ? { tetoDia: n(tetos.tetoDia) } : {}),
                  ...(tetos.tetoCampanha !== undefined ? { tetoCampanha: n(tetos.tetoCampanha) } : {}),
                  ...(tetos.precoEstimado !== undefined ? { precoEstimado: tetos.precoEstimado.trim() ? n(tetos.precoEstimado) : null } : {}),
                  ...(tetos.moeda !== undefined ? { moeda: tetos.moeda } : {}),
                });
              }}>Salvar tetos</Button>
              <Button size="sm" disabled={salvarConfig.isPending} className={s.ligado ? "bg-red-700 text-white hover:bg-red-800" : "bg-green-600 text-white hover:bg-green-700"}
                onClick={() => { if (s.ligado || window.confirm("Ligar os disparos de campanha pela API oficial? Cada disparo ainda pede confirmação com a contagem.")) salvarConfig.mutate({ ligado: !s.ligado }); }}>
                {s.ligado ? "Desligar disparos" : "Ligar disparos"}
              </Button>
            </div>
          </div>
        </>}
      </CardContent>
    </Card>
  );
}
