// EPIC-027 C5-E4 — seção "Avisos automáticos" do cartão de operação da Dolores (só admin; o servidor confere o papel). Ligar/desligar
// (nasce desligado), IA no texto (só redige; sem ela sai o texto fixo), teto diário (até 6), limites N de cada regra, silenciar/religar
// cada tipo e os últimos avisos enviados (texto do registro, com dados pessoais mascarados). Quem decide o que avisar são as regras.
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const botaoSec = "min-h-10 border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10";
const campo = "mt-1 bg-[#1A2332] border-[#C9A961]/30 text-white";
const quando = (d: string) => new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

const CAMPOS: Array<[k: "obraAtrasoDias" | "tarefaVencidaDias" | "documentoPendenteDias" | "notaConfirmacaoDias" | "regularizacaoParadaDias" | "grupoAguardandoHoras", rotulo: string]> = [
  ["obraAtrasoDias", "Obra atrasada há (dias)"], ["tarefaVencidaDias", "Tarefa vencida parada há (dias)"], ["documentoPendenteDias", "Documento pendente há (dias)"],
  ["notaConfirmacaoDias", "Nota sem confirmação há (dias)"], ["regularizacaoParadaDias", "Regularização parada há (dias)"], ["grupoAguardandoHoras", "Grupo esperando há (horas)"],
];
type Campo = (typeof CAMPOS)[number][0] | "maxPorDia" | "reavisoDias";

export function DoloresAvisosSecao({ pausada }: { pausada: boolean }) {
  const utils = trpc.useUtils();
  const dados = trpc.dolores.operacao.avisos.situacao.useQuery(undefined, { retry: false });
  const recarregar = () => utils.dolores.operacao.avisos.situacao.invalidate();
  const erro = (e: { message: string }) => toast.error(e.message);
  const [edit, setEdit] = useState<Partial<Record<Campo, string>>>({});
  const salvar = trpc.dolores.operacao.avisos.salvar.useMutation({ onSuccess: async () => { toast.success("Avisos salvos."); setEdit({}); await recarregar(); }, onError: erro });
  const silenciar = trpc.dolores.operacao.avisos.silenciar.useMutation({ onSuccess: async (_r, v) => { toast.success(v.silenciado ? "Tipo silenciado." : "Tipo religado."); await recarregar(); }, onError: erro });

  if (dados.isLoading) return <p className="text-xs text-gray-400">Carregando os avisos…</p>;
  if (dados.error) return <p className="text-xs text-amber-200">{dados.error.message}</p>;
  const d = dados.data;
  if (!d || !d.disponivel) return <p className="text-xs text-amber-200">Avisos automáticos indisponíveis: falta aplicar a migração 0150.</p>;
  const valor = (k: Campo) => edit[k] ?? String(k === "maxPorDia" ? d.config.maxPorDia : k === "reavisoDias" ? d.config.reavisoDias : d.config.limites[k]);
  const mudou = Object.keys(edit).length > 0;
  const gravar = () => salvar.mutate(Object.fromEntries(Object.entries(edit).map(([k, v]) => [k, Number(v)])));

  return (
    <section className="space-y-3 rounded border border-[#C9A961]/20 p-3">
      <h3 className="text-sm font-semibold text-[#C9A961]">Avisos automáticos ao dono</h3>
      <p className="text-xs text-gray-300">
        A Dolores avisa você sozinha, no seu WhatsApp, do que as regras do sistema acharem relevante — de {d.janela.dias}, das
        {" "}{String(d.janela.inicio).padStart(2, "0")}h às {d.janela.fim}h (Brasília), no máximo {d.config.maxPorDia} por dia, tudo agrupado num aviso só.
        Fora do horário, acumula para a próxima janela. O mesmo achado só é avisado de novo quando piora de faixa ou depois de {d.config.reavisoDias || "—"} dia(s).
        Para silenciar um tipo, use a chave abaixo ou diga a ela no WhatsApp (ex.: "pare de me avisar de tarefas vencidas").
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex min-h-10 items-center gap-2 text-sm"><Switch checked={d.config.ligado} disabled={salvar.isPending || pausada} onCheckedChange={v => salvar.mutate({ ligado: v })} aria-label="Avisos automáticos" />
          Avisos {d.config.ligado ? <strong className="text-green-300">ligados</strong> : <strong className="text-gray-300">desligados</strong>}</label>
        <label className="flex min-h-10 items-center gap-2 text-sm"><Switch checked={d.config.iaNoTexto} disabled={salvar.isPending} onCheckedChange={v => salvar.mutate({ iaNoTexto: v })} aria-label="IA escreve o texto" />
          IA escreve o texto {d.config.iaNoTexto ? <strong className="text-green-300">sim</strong> : <strong className="text-gray-300">não (texto fixo)</strong>}</label>
      </div>
      <p className="text-xs text-gray-400">A IA só redige (parte "avisos" do gasto, 5%); sem ela, sem orçamento ou se falhar, sai o texto fixo. Ela nunca decide o que, quando nem para quem enviar.</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div><Label className="text-xs">Avisos por dia (1 a {d.maxAvisosDia})</Label>
          <Input className={campo} inputMode="numeric" value={valor("maxPorDia")} onChange={e => setEdit(s => ({ ...s, maxPorDia: e.target.value }))} /></div>
        <div><Label className="text-xs">Repetir o mesmo achado após (dias; 0 = nunca)</Label>
          <Input className={campo} inputMode="numeric" value={valor("reavisoDias")} onChange={e => setEdit(s => ({ ...s, reavisoDias: e.target.value }))} /></div>
        {CAMPOS.map(([k, rotulo]) => (
          <div key={k}><Label className="text-xs">{rotulo} — {d.faixas[k][0]} a {d.faixas[k][1]} (padrão {d.padrao[k]})</Label>
            <Input className={campo} inputMode="numeric" value={valor(k)} onChange={e => setEdit(s => ({ ...s, [k]: e.target.value }))} /></div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className={botaoSec} disabled={!mudou || salvar.isPending} onClick={gravar}>{salvar.isPending ? "Salvando…" : "Salvar limites"}</Button>
        {mudou && <Button size="sm" variant="outline" className={botaoSec} onClick={() => setEdit({})}>Desfazer</Button>}
      </div>
      <h4 className="pt-2 text-xs font-semibold text-gray-300">Tipos de aviso</h4>
      <ul className="space-y-2 text-xs">{d.tipos.map(t => (
        <li key={t.tipo} className="flex flex-wrap items-start gap-2">
          <Switch checked={!t.silenciado} disabled={silenciar.isPending} onCheckedChange={v => silenciar.mutate({ tipo: t.tipo, silenciado: !v })} aria-label={`Avisar de ${t.rotulo}`} />
          <span className="flex-1"><strong className={t.silenciado ? "text-gray-400 line-through" : "text-white"}>{t.rotulo}</strong>{t.silenciado ? " (silenciado)" : ""}
            {t.abertos ? <span className="text-amber-200"> · {t.abertos} em aberto</span> : null}<br /><span className="text-gray-400">{t.regra}</span></span>
        </li>
      ))}</ul>
      <h4 className="pt-2 text-xs font-semibold text-gray-300">Últimos avisos enviados</h4>
      {!d.envios.length ? <p className="text-xs text-gray-400">Nenhum aviso ainda.</p> : (
        <ul className="space-y-1 text-xs">{d.envios.map(e => (
          <li key={e.id}><details><summary className="cursor-pointer">{quando(e.criadoEm)} · {e.itens} achado(s) · {e.comIa ? "texto pela IA" : "texto fixo"} ·{" "}
            {e.situacao === "enviado" ? <span className="text-green-300">enviado</span> : e.situacao === "falhou" ? <span className="text-amber-200">não enviado{e.motivo ? ` (${e.motivo})` : ""}</span> : "enviando"}</summary>
            {e.texto ? <pre className="mt-1 whitespace-pre-wrap break-words text-gray-200">{e.texto}</pre> : null}</details></li>
        ))}</ul>
      )}
    </section>
  );
}
