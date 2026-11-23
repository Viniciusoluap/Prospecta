// EPIC-025 E10 — seção "Cobranças automáticas" do cartão de operação da Dolores (só admin; o servidor confere o papel). Liga/desliga
// (nascem desligadas) a cobrança do colaborador e o pedido de documentos ao cliente, os tetos e mostra os últimos envios (texto do
// registro, com dados pessoais mascarados). O texto é sempre do sistema (sem IA).
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const botaoSec = "min-h-10 border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10";
const campo = "mt-1 bg-[#1A2332] border-[#C9A961]/30 text-white";
const quando = (d: string) => new Date(d).toLocaleString("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short", timeStyle: "short" });

type Campo = "colaboradorTetoDia" | "documentosTetoDia" | "maxItens" | "documentosIntervaloDias" | "respostasTetoDia";
const CAMPOS: Array<[Campo, string]> = [
  ["colaboradorTetoDia", "Cobranças a colaboradores por dia (total)"], ["maxItens", "Itens listados por mensagem"],
  ["respostasTetoDia", "Respostas encaminhadas por colaborador por dia"], ["documentosTetoDia", "Pedidos de documentos por dia (total)"],
  ["documentosIntervaloDias", "Intervalo entre pedidos ao mesmo cliente (dias)"],
];
const SITUACAO: Record<string, string> = { enviando: "enviando", enviada: "enviada", falhou: "não saiu", sem_confirmacao: "sem confirmação", sem_telefone: "sem telefone" };

export function DoloresCobrancasSecao({ pausada }: { pausada: boolean }) {
  const utils = trpc.useUtils();
  const dados = trpc.dolores.operacao.cobrancas.situacao.useQuery(undefined, { retry: false });
  const recarregar = () => utils.dolores.operacao.cobrancas.situacao.invalidate();
  const [edit, setEdit] = useState<Partial<Record<Campo, string>>>({});
  const salvar = trpc.dolores.operacao.cobrancas.salvar.useMutation({
    onSuccess: async () => { toast.success("Cobranças salvas."); setEdit({}); await recarregar(); }, onError: e => toast.error(e.message),
  });

  if (dados.isLoading) return <p className="text-xs text-gray-400">Carregando as cobranças…</p>;
  if (dados.error) return <p className="text-xs text-amber-200">{dados.error.message}</p>;
  const d = dados.data;
  if (!d || !d.disponivel) return <p className="text-xs text-amber-200">Cobranças automáticas indisponíveis: falta aplicar a migração 0169.</p>;
  const valor = (k: Campo) => edit[k] ?? String(d.config[k]);
  const mudou = Object.keys(edit).length > 0;
  const j = d.janela;

  return (
    <section className="space-y-3 rounded border border-[#C9A961]/20 p-3">
      <h3 className="text-sm font-semibold text-[#C9A961]">Cobranças automáticas</h3>
      <p className="text-xs text-gray-300">
        De {j.dias}, das {String(j.inicio).padStart(2, "0")}h às {j.fim}h (Fortaleza), pelo número da empresa, com texto do sistema (sem IA e sem valores).
        Às {j.resumo}h você recebe um resumo do que saiu. Mensagem de colaborador ou de cliente nunca é comando.
      </p>
      <div className="space-y-2">
        <label className="flex min-h-10 items-start gap-2 text-sm"><Switch checked={d.config.colaboradorLigado} disabled={salvar.isPending || pausada}
          onCheckedChange={v => salvar.mutate({ colaboradorLigado: v })} aria-label="Cobrar colaborador" />
          <span>Cobrar colaborador {d.config.colaboradorLigado ? <strong className="text-green-300">ligado</strong> : <strong className="text-gray-300">desligado</strong>}
            <br /><span className="text-xs text-gray-400">Uma mensagem por dia por colaborador com TODOS os itens atrasados dele (tarefas, regularização, obra, financiamento, CRM,
              avaliação). Sem telefone no cadastro: aparece no seu resumo. A resposta dele (até {j.diasResposta} dias depois) é registrada e encaminhada a você.</span></span></label>
        <label className="flex min-h-10 items-start gap-2 text-sm"><Switch checked={d.config.documentosLigado} disabled={salvar.isPending || pausada}
          onCheckedChange={v => salvar.mutate({ documentosLigado: v })} aria-label="Pedir documentos ao cliente" />
          <span>Pedir documentos ao cliente {d.config.documentosLigado ? <strong className="text-green-300">ligado</strong> : <strong className="text-gray-300">desligado</strong>}
            <br /><span className="text-xs text-gray-400">Só cliente com consentimento LGPD no cadastro, telefone de um único cadastro e documentos pendentes; no máximo 1 a cada
              {" "}{d.config.documentosIntervaloDias} dias. Não envia se a equipe respondeu ou assumiu a conversa. Fica no histórico do cliente e na Central WhatsApp.</span></span></label>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {CAMPOS.map(([k, rotulo]) => (
          <div key={k}><Label className="text-xs">{rotulo} — {d.faixas[k][0]} a {d.faixas[k][1]}</Label>
            <Input className={campo} inputMode="numeric" value={valor(k)} onChange={e => setEdit(s => ({ ...s, [k]: e.target.value }))} /></div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className={botaoSec} disabled={!mudou || salvar.isPending}
          onClick={() => salvar.mutate(Object.fromEntries(Object.entries(edit).map(([k, v]) => [k, Number(v)])))}>{salvar.isPending ? "Salvando…" : "Salvar limites"}</Button>
        {mudou && <Button size="sm" variant="outline" className={botaoSec} onClick={() => setEdit({})}>Desfazer</Button>}
      </div>
      <h4 className="pt-2 text-xs font-semibold text-gray-300">Últimas cobranças a colaboradores</h4>
      {!d.cobrancas.length ? <p className="text-xs text-gray-400">Nenhuma ainda.</p> : (
        <ul className="space-y-1 text-xs">{d.cobrancas.map(c => (
          <li key={c.id}><details><summary className="cursor-pointer">{quando(c.criadoEm)} · {c.nome ?? "(sem nome)"} · {c.itens} item(ns) · {SITUACAO[c.situacao] ?? c.situacao}</summary>
            {c.texto ? <pre className="mt-1 whitespace-pre-wrap break-words text-gray-200">{c.texto}</pre> : null}</details></li>
        ))}</ul>
      )}
      <h4 className="pt-2 text-xs font-semibold text-gray-300">Últimos pedidos de documentos</h4>
      {!d.pedidos.length ? <p className="text-xs text-gray-400">Nenhum ainda.</p> : (
        <ul className="space-y-1 text-xs">{d.pedidos.map(p => (
          <li key={p.id}><details><summary className="cursor-pointer">{quando(p.criadoEm)} · {p.nome} (cliente {p.leadId}) · {p.documentos} documento(s) · {SITUACAO[p.situacao] ?? p.situacao}</summary>
            {p.texto ? <pre className="mt-1 whitespace-pre-wrap break-words text-gray-200">{p.texto}</pre> : null}</details></li>
        ))}</ul>
      )}
      <h4 className="pt-2 text-xs font-semibold text-gray-300">Últimas respostas de colaboradores</h4>
      {!d.respostas.length ? <p className="text-xs text-gray-400">Nenhuma ainda.</p> : (
        <ul className="space-y-1 text-xs">{d.respostas.map(r => (
          <li key={r.id}>{quando(r.criadoEm)} · {r.nome ?? "(sem nome)"} · {r.encaminhada ? <span className="text-green-300">encaminhada a você</span> : <span className="text-amber-200">não encaminhada</span>}</li>
        ))}</ul>
      )}
    </section>
  );
}
