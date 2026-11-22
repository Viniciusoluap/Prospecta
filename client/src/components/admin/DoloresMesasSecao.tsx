// EPIC-027 C5 (criadora de mesas): seção "Mesas" DENTRO do cartão de operação da Dolores — só admin (o servidor confere o papel em cada
// rota). Mostra as propostas de função nova que o dono pediu e as que já existem (em operação), com a proposta completa e as versões. Para
// as aprovadas, "Copiar para o desenvolvimento" copia o texto em Markdown no formato de story (nada é escrito em disco). Pela tela só se muda
// para em construção, em operação ou arquivada; aprovar e recusar são do dono, na conversa. Mudar a situação não liga nada.
import { useState } from "react";
import { toast } from "sonner";
import { ROTULO_FAIXA_CUSTO, ROTULO_QUEM_APROVA, podeMudarPelaTela, type SituacaoDaTela, type SituacaoMesa } from "@shared/dolores/mesas";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

const botaoSec = "min-h-10 border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10";
const quando = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleString("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short", timeStyle: "short" }) : "—");
const FILTROS = [
  { valor: "todas", rotulo: "Todas" }, { valor: "abertas", rotulo: "Abertas" }, { valor: "aguardando_dono", rotulo: "Aguardando o dono" },
  { valor: "aprovada", rotulo: "Aprovadas" }, { valor: "em_construcao", rotulo: "Em construção" }, { valor: "em_operacao", rotulo: "Em operação" },
  { valor: "recusada", rotulo: "Recusadas" }, { valor: "arquivada", rotulo: "Arquivadas" },
] as const;
type Filtro = (typeof FILTROS)[number]["valor"];
const BOTOES: Array<{ para: SituacaoDaTela; rotulo: string }> = [
  { para: "em_construcao", rotulo: "Marcar em construção" }, { para: "em_operacao", rotulo: "Marcar em operação" }, { para: "arquivada", rotulo: "Arquivar" },
];
const COR: Partial<Record<SituacaoMesa, string>> = {
  aguardando_dono: "text-amber-200", aprovada: "text-sky-200", em_construcao: "text-sky-300", em_operacao: "text-green-300", recusada: "text-gray-400", arquivada: "text-gray-400",
};

function Lista({ titulo, itens }: { titulo: string; itens: readonly string[] }) {
  if (!itens.length) return null;
  return <div><p className="text-gray-300">{titulo}</p><ul className="ml-4 list-disc">{itens.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
}

export function DoloresMesasSecao() {
  const utils = trpc.useUtils();
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [aberta, setAberta] = useState<number | null>(null);
  const lista = trpc.dolores.mesas.listar.useQuery({ situacao: filtro, limite: 100 }, { retry: false });
  const versoes = trpc.dolores.mesas.versoes.useQuery({ id: aberta ?? 1 }, { enabled: aberta !== null, retry: false });
  const mudar = trpc.dolores.mesas.mudarSituacao.useMutation({
    onSuccess: async () => { toast.success("Situação da mesa atualizada (nada foi ligado)."); await utils.dolores.mesas.listar.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const copiar = async (texto: string) => {
    try { await navigator.clipboard.writeText(texto); toast.success("Proposta copiada em Markdown: cole numa story nova para o desenvolvimento."); }
    catch { toast.error("Não consegui copiar; selecione o texto abaixo e copie à mão."); }
  };

  return (
    <section className="space-y-2 rounded-lg border border-[#C9A961]/20 bg-[#1A2332] p-3 text-sm">
      <h3 className="text-sm font-semibold text-[#C9A961]">Mesas (funções novas pedidas à Dolores)</h3>
      <p className="text-xs text-gray-300">
        Quando o dono pede uma função nova, a Dolores só escreve a proposta. Aprovar (só o dono, respondendo “confirmo”) NÃO liga nada: a função é
        construída pelo processo normal de desenvolvimento. Aqui você acompanha e marca em construção, em operação ou arquivada.
      </p>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar mesas">
        {FILTROS.map(f => (
          <Button key={f.valor} size="sm" variant={filtro === f.valor ? "default" : "outline"} className={filtro === f.valor ? "min-h-10" : botaoSec} onClick={() => setFiltro(f.valor)}>{f.rotulo}</Button>
        ))}
      </div>
      {lista.isLoading ? <p className="text-xs text-gray-300">Carregando…</p> : lista.error ? <p role="alert" className="text-xs text-red-300">{lista.error.message}</p>
        : !lista.data?.length ? <p className="text-xs text-gray-400">Nenhuma mesa neste filtro.</p> : (
        <ul className="space-y-2">{lista.data.map(m => (
          <li key={m.id} className="rounded border border-[#C9A961]/20 p-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p><strong>Mesa {m.id}</strong> — {m.titulo} <span className="text-xs text-gray-400">(versão {m.versao}; {m.origem === "semente" ? "já existia no sistema" : "pedida pelo dono"})</span></p>
              <span className={`text-xs ${COR[m.situacao as SituacaoMesa] ?? "text-gray-200"}`}>{m.rotuloSituacao}</span>
            </div>
            <p className="text-xs text-gray-400">Criada {quando(m.criadoEm)} · atualizada {quando(m.atualizadoEm)}{m.aprovadaEm ? ` · aprovada ${quando(m.aprovadaEm)} (versão ${m.aprovadaVersao})` : ""}</p>
            <details className="mt-1 text-xs" onToggle={e => { if ((e.target as HTMLDetailsElement).open) setAberta(m.id); }}>
              <summary className="cursor-pointer text-gray-300">Proposta completa</summary>
              {m.proposta ? (
                <div className="mt-1 space-y-1">
                  {m.pedidoOriginal ? <p><span className="text-gray-300">Pedido original do dono:</span> {m.pedidoOriginal}</p> : null}
                  <p><span className="text-gray-300">Objetivo:</span> {m.proposta.objetivo}</p>
                  <p><span className="text-gray-300">Quando age:</span> {m.proposta.quandoAge}</p>
                  <p><span className="text-gray-300">Lê:</span> {m.le.length ? m.le.map(x => x.rotulo).join(", ") : "nada"}</p>
                  <p><span className="text-gray-300">Grava:</span> {m.escreve.length ? m.escreve.map(x => x.rotulo).join(", ") : "nada"}</p>
                  <Lista titulo="Precisa de função nova:" itens={m.proposta.funcoesNovas} />
                  <p><span className="text-gray-300">Quem aprova:</span> {ROTULO_QUEM_APROVA[m.proposta.quemAprova]}</p>
                  <Lista titulo="Deve fazer:" itens={m.proposta.exemplosBons} />
                  <Lista titulo="Não deve fazer:" itens={m.proposta.exemplosRuins} />
                  <Lista titulo="Riscos:" itens={m.proposta.riscos} />
                  <p><span className="text-gray-300">Custo mensal estimado:</span> {ROTULO_FAIXA_CUSTO[m.proposta.custo]}</p>
                  {m.falta.length ? <p className="text-amber-200">Falta para aprovar: {m.falta.join(", ")}</p> : null}
                  {aberta === m.id && versoes.data && versoes.data.length > 1 ? (
                    <p className="text-gray-400">Versões: {versoes.data.map(v => `${v.versao} (${quando(v.criadoEm)})`).join(" · ")}</p>
                  ) : null}
                  {m.markdown ? (
                    <details><summary className="cursor-pointer text-gray-300">Texto para o desenvolvimento (Markdown)</summary>
                      <pre className="mt-1 whitespace-pre-wrap break-words text-gray-200">{m.markdown}</pre></details>
                  ) : null}
                </div>
              ) : <p className="text-amber-200">Proposta sem versão legível.</p>}
            </details>
            <div className="mt-2 flex flex-wrap gap-2">
              {m.markdown ? <Button size="sm" className="min-h-10 bg-[#C9A961] text-[#1A2332] hover:bg-[#C9A961]/90" onClick={() => copiar(m.markdown!)}>Copiar para o desenvolvimento</Button> : null}
              {BOTOES.filter(b => podeMudarPelaTela(m.situacao, b.para)).map(b => (
                <Button key={b.para} size="sm" variant="outline" className={botaoSec} disabled={mudar.isPending} onClick={() => mudar.mutate({ id: m.id, para: b.para })}>{b.rotulo}</Button>
              ))}
            </div>
          </li>
        ))}</ul>
      )}
    </section>
  );
}
