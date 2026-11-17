// Maquete 3D (EPIC-024 S-05) — "Importar planta arquitetônica (PDF)" na revisão: o projeto profissional é lido
// (leitor próprio; IA só nas pranchas que ele não lê, com a mesma confirmação da leitura) numa planta CANDIDATA.
// A tela mostra a planta atual ao lado da candidata sobre o PDF original, deixa editar a candidata e aplicar no que
// a pessoa escolher. E o histórico das plantas, com restauração.
import { useEffect, useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { Check, FileUp, History, Play, RotateCcw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { AppRouter } from "../../../../server/routers";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { enviarPartes, LIMITE_DOCUMENTO } from "@/lib/documentos-partes";
import { EditorPlanta } from "./EditorPlanta";
import { perguntaAlemDoTeto, rotuloConfirmarIA } from "./rotulos-leitura";
import { ROTULOS_ORIGEM_REVISAO } from "@shared/maquete-3d/importacao";
import type { ModeloMaquete } from "@shared/maquete-3d/modelo";
import { escopoEnvioMaquete } from "@shared/maquete-3d/regras";

type Detalhe = inferRouterOutputs<AppRouter>["maquete3d"]["detalhe"];
type Passo = Detalhe["passos"][number];
const inputCls = "h-9 w-full rounded-md border border-[#C9A961]/30 bg-[#1A2332] px-2 text-sm text-white";
const btnOutline = "border-[#C9A961]/30 bg-transparent text-gray-200";
const btnOuro = "bg-[#C9A961] text-[#1A2332] hover:bg-[#C9A961]/90";
const falha = (e: unknown) => toast.error(e instanceof Error ? e.message : "Não foi possível concluir.");
const dataHora = (d: Date | string | null) => (d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

/** Uma linha por passo, dizendo quem leu cada prancha. */
export function ListaPassos({ passos }: { passos: Passo[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {passos.map(p => (
        <li key={p.chave} className="flex flex-wrap gap-2">
          <span className={p.estado === "feito" ? "text-emerald-400" : p.estado === "erro" ? "text-red-300" : p.estado === "aguardando" ? "text-amber-300" : "text-gray-400"}>{p.estado === "feito" ? "✓" : p.estado === "erro" ? "✕" : p.estado === "aguardando" ? "‖" : "○"}</span>
          <span>{p.rotulo}</span>
          {p.estado === "feito" && (p.tipo === "prancha" || p.tipo === "prancha_ia") && <span className="text-xs text-gray-400">
            {p.motor === "ia" ? `— lida pela IA (modelo ${p.modelo ?? "?"}${p.tokens ? `, ${p.tokens.entrada.toLocaleString("pt-BR")} + ${p.tokens.saida.toLocaleString("pt-BR")} tokens` : ""})`
              : p.motor === "pulada" ? "— sem a IA: ficou o que o leitor próprio leu" : "— lida pelo leitor próprio"}</span>}
          {p.estado === "pendente" && p.motivoIA && <span className="text-xs text-gray-400">— {p.motivoIA}</span>}
          {p.estado === "executando" && <span className="text-xs text-amber-300">— sendo lida pela IA agora (não feche a página)</span>}
          {p.erro && <span className={p.estado === "aguardando" ? "text-amber-300" : "text-red-300"}>— {p.erro}</span>}
        </li>
      ))}
    </ul>
  );
}

type Retorno = { erro: string | null; aguardando: { mensagem: string } | null; pronta: boolean };

export function ImportarPlanta({ d, admin, sujo, aoMudar }: { d: Detalhe; admin: boolean; sujo: boolean; aoMudar: () => void }) {
  const id = d.id;
  const utils = trpc.useUtils();
  const imp = d.importacao;
  const [aberto, setAberto] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [docLista, setDocLista] = useState<string>("");
  const [lendo, setLendo] = useState(false);
  const parar = useRef(false);
  useEffect(() => () => { parar.current = true; }, []);

  const importar = trpc.maquete3d.importarPlanta.useMutation();
  const avancar = trpc.maquete3d.avancarImportacao.useMutation();
  const confirmar = trpc.maquete3d.confirmarIAImportacao.useMutation();
  const pular = trpc.maquete3d.pularIAImportacao.useMutation();
  const salvarCand = trpc.maquete3d.salvarCandidata.useMutation();
  const descartar = trpc.maquete3d.descartarImportacao.useMutation({ onSuccess: () => { toast.success("Importação descartada. A planta atual não mudou."); aoMudar(); }, onError: falha });
  const aplicar = trpc.maquete3d.aplicarImportacao.useMutation();

  // Candidata em edição, local até salvar ou aplicar.
  const [cand, setCand] = useState<ModeloMaquete | null>(null);
  const [candSuja, setCandSuja] = useState(false);
  useEffect(() => { if (!candSuja) setCand(imp?.candidata ?? null); }, [imp?.candidata, candSuja]);
  const [destino, setDestino] = useState("padrao");
  const [pvCand, setPvCand] = useState("");
  const [motivo, setMotivo] = useState("");

  async function rodar(primeiro: () => Promise<Retorno>) {
    setLendo(true);
    try {
      let r = await primeiro();
      for (let i = 0; i < 80; i++) {
        await utils.maquete3d.detalhe.invalidate({ id });
        if (parar.current) return;
        if (r.erro) { toast.error(r.erro); break; }
        if (r.aguardando) { toast.warning(r.aguardando.mensagem, { duration: 12000 }); break; }
        if (r.pronta) { toast.success("Planta importada lida. Compare com a atual, corrija se precisar e aplique."); break; }
        r = await avancar.mutateAsync({ id });
      }
    } catch (e) { falha(e); } finally { setLendo(false); aoMudar(); }
  }
  async function comecar() {
    if (arquivo) {
      if (!/\.pdf$/i.test(arquivo.name)) return toast.error("Envie um arquivo PDF.");
      if (arquivo.size > LIMITE_DOCUMENTO) return toast.error("O PDF passa de 20 MB. Envie uma versão mais leve.");
      await rodar(async () => importar.mutateAsync({ id, uploadId: await enviarPartes(arquivo, escopoEnvioMaquete(id)), nome: arquivo.name }));
    } else if (docLista !== "") await rodar(() => importar.mutateAsync({ id, doc: Number(docLista) }));
    setArquivo(null); setAberto(false);
  }

  async function aplicarAgora() {
    if (!cand) return;
    if (sujo) return toast.error("Salve (ou descarte) as alterações da planta atual antes de aplicar a importada.");
    const [edificacaoId, pavimentoId] = destino.split("|");
    const alvo = destino === "padrao" ? (temPadrao ? "no lugar da construção padrão" : "como base do modelo") : `no lugar do pavimento "${d.modelo?.edificacoes.find(e => e.id === edificacaoId)?.pavimentos.find(p => p.id === pavimentoId)?.nome ?? pavimentoId}"`;
    const aviso = d.status === "publicada" ? "\n\nA maquete está publicada: ela sai do ar e volta para revisão até ser validada e publicada de novo." : d.status === "validada" ? "\n\nA maquete volta para revisão." : "";
    if (!window.confirm(`Aplicar a planta importada ${alvo}? As posições no terreno são mantidas e a planta de agora fica no histórico.${aviso}`)) return;
    try {
      if (candSuja) { await salvarCand.mutateAsync({ id, modelo: cand }); setCandSuja(false); }
      const r = await aplicar.mutateAsync({
        id, versao: d.modeloVersao, motivo,
        destino: destino === "padrao" ? { tipo: "padrao" } : { tipo: "pavimento", edificacaoId, pavimentoId, ...(pvCand ? { pavimentoCandidatoId: pvCand } : {}) },
      });
      toast.success(r.saiuDoAr ? "Planta aplicada. A maquete saiu do ar e voltou para revisão." : "Planta aplicada. Confira as pendências e valide.");
      setMotivo("");
    } catch (e) { falha(e); } finally { aoMudar(); utils.maquete3d.revisoes.invalidate({ id }); }
  }

  const aguardando = imp?.passos.find(p => p.estado === "aguardando");
  /** QA rodada 2, N1: com um passo sendo lido pela IA, confirmar, seguir sem a IA e descartar esperam ele terminar. */
  const emCurso = !!imp?.ia.emCurso;
  const temPadrao = !!d.modelo?.edificacoes.some(e => e.id === "padrao");
  const pavimentos = d.modelo?.edificacoes.flatMap(e => e.pavimentos.map(p => ({ valor: `${e.id}|${p.id}`, rotulo: `${e.nome} › ${p.nome}` }))) ?? [];
  useEffect(() => { if (!temPadrao && d.modelo?.edificacoes.length && destino === "padrao" && pavimentos[0]) setDestino(pavimentos[0].valor); }, [temPadrao, d.modelo, destino, pavimentos]);
  const erros = imp?.problemas.filter(p => p.nivel === "erro") ?? [];

  if (!imp) {
    return (
      <div className="space-y-2 border-t border-[#C9A961]/15 pt-3 text-sm">
        {!aberto ? (
          <Button variant="outline" className={btnOutline} disabled={lendo} onClick={() => setAberto(true)}><FileUp className="mr-1 h-4 w-4" />Importar planta arquitetônica (PDF)</Button>
        ) : (
          <div className="space-y-2 rounded-lg border border-[#C9A961]/20 p-3">
            <p className="text-gray-300">Envie o projeto profissional (PDF exportado do programa de desenho, ou escaneado). Ele é lido à parte, numa planta candidata: a planta atual só muda quando você aplicar.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-gray-300">PDF novo
                <input type="file" accept="application/pdf,.pdf" className="mt-1 block w-full text-xs text-gray-300" onChange={e => { setArquivo(e.target.files?.[0] ?? null); setDocLista(""); }} /></label>
              {d.documentos.length > 0 && <label className="text-xs text-gray-300">ou um PDF já deste pedido
                <select className={inputCls} value={docLista} onChange={e => { setDocLista(e.target.value); setArquivo(null); }}>
                  <option value="">—</option>{d.documentos.map((x, i) => <option key={`${x.fonte}:${x.id}`} value={i}>{x.nome}</option>)}
                </select></label>}
            </div>
            {d.status === "publicada" && !admin && <p className="text-xs text-amber-300">A maquete está publicada: só o administrador importa e aplica.</p>}
            <div className="flex flex-wrap gap-2">
              <Button className={btnOuro} disabled={lendo || (!arquivo && docLista === "") || (d.status === "publicada" && !admin)} onClick={comecar}><Play className="mr-1 h-4 w-4" />{lendo ? "Lendo…" : "Ler a planta importada"}</Button>
              <Button variant="outline" className={btnOutline} disabled={lendo} onClick={() => { setAberto(false); setArquivo(null); }}>Cancelar</Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t border-[#C9A961]/15 pt-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-[#C9A961]">Planta arquitetônica importada — {imp.documento.nome}</p>
        <Button size="sm" variant="outline" className="border-red-400/50 bg-transparent text-red-300" disabled={lendo || emCurso || descartar.isPending}
          onClick={() => { if (window.confirm("Descartar a planta importada? A planta atual não muda; o PDF continua na lista do pedido.")) descartar.mutate({ id }); }}><Trash2 className="mr-1 h-4 w-4" />Descartar</Button>
      </div>

      {!imp.candidata && (
        <>
          <ListaPassos passos={imp.passos} />
          {aguardando && (
            <div className="space-y-2 rounded-lg border border-amber-400/30 p-3">
              {aguardando.aguardando === "confirmacao" ? (
                <>
                  <p>{imp.ia.pendentes} prancha(s) deste PDF precisam da leitura por IA (paga). A confirmação vale só para esta importação e para as pranchas autorizadas (esta maquete já usou {imp.ia.lidasNaMaquete} de {imp.ia.teto ?? "—"} pela IA).</p>
                  {admin ? <Button className={btnOuro} disabled={lendo || emCurso} onClick={() => rodar(async () => { await confirmar.mutateAsync({ id, modeloVisto: aguardando.modeloAConfirmar ?? undefined }); return avancar.mutateAsync({ id }); })}><Check className="mr-1 h-4 w-4" />{rotuloConfirmarIA(aguardando.modeloAConfirmar, "Confirmar e ler pela IA")}</Button>
                    : <p className="text-xs text-gray-400">Só o administrador autoriza a leitura paga pela IA.</p>}
                </>
              ) : aguardando.aguardando === "teto" ? (
                <>
                  <p>{aguardando.erro}</p>
                  {admin ? <Button className={btnOuro} disabled={lendo || emCurso}
                    onClick={() => { if (window.confirm(perguntaAlemDoTeto(imp.ia.pendentes, imp.ia.teto, aguardando.modeloAConfirmar))) void rodar(async () => { await confirmar.mutateAsync({ id, alemDoTeto: true, modeloVisto: aguardando.modeloAConfirmar ?? undefined }); return avancar.mutateAsync({ id }); }); }}><Check className="mr-1 h-4 w-4" />{rotuloConfirmarIA(aguardando.modeloAConfirmar, "Autorizar além do teto")}</Button>
                    : <p className="text-xs text-gray-400">Só o administrador autoriza passar do teto de pranchas pela IA.</p>}
                </>
              ) : <p>Cadastre a chave em Integrações → Anthropic e continue: a leitura retoma deste passo.</p>}
              <Button variant="outline" className={btnOutline} disabled={lendo || emCurso} onClick={() => rodar(async () => { await pular.mutateAsync({ id }); return avancar.mutateAsync({ id }); })}>Continuar sem a IA</Button>
            </div>
          )}
          {!lendo && emCurso && <p className="text-amber-300">Um passo está sendo lido pela IA agora: aguarde terminar para confirmar, seguir sem a IA ou descartar.</p>}
          <Button className={btnOuro} disabled={lendo} onClick={() => rodar(() => avancar.mutateAsync({ id }))}><Play className="mr-1 h-4 w-4" />{lendo ? "Lendo… mantenha esta página aberta." : imp.progresso.proximo?.estado === "erro" ? "Tentar de novo este passo" : "Continuar a leitura do PDF importado"}</Button>
        </>
      )}

      {imp.candidata && cand && (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="space-y-1">
              <p className="font-semibold">Planta atual</p>
              {d.modelo ? <EditorPlanta modelo={d.modelo} onChange={() => undefined} somenteLeitura maqueteId={id} pranchas={d.pranchas} />
                : <p className="text-gray-400">A maquete ainda não tem planta: a importada vira a base do modelo.</p>}
            </div>
            <div className="space-y-1">
              <p className="font-semibold">Planta importada sobre o PDF original <span className="font-normal text-gray-400">(edite aqui antes de aplicar)</span></p>
              <EditorPlanta modelo={cand} onChange={m => { setCand(m); setCandSuja(true); }} maqueteId={id} pranchas={imp.pranchas} fundoInicial prefixoFundo="importacao:" />
            </div>
          </div>
          {imp.avisos.map(a => <p key={a} className="text-xs text-amber-300">{a}</p>)}
          {cand.pendencias.length > 0 && (
            <div className="text-xs"><p className="font-semibold text-amber-300">O que o leitor não garantiu nesta planta ({cand.pendencias.length}) — vira pendência ao aplicar</p>
              <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-gray-300">{cand.pendencias.map(p => <li key={p.id}>{p.descricao}</li>)}</ul></div>
          )}
          {erros.length > 0 && <p className="text-xs text-red-300">{erros.length} erro(s) na planta importada (ficam para corrigir na revisão depois de aplicar).</p>}
          {candSuja && <Button size="sm" variant="outline" className={btnOutline} disabled={salvarCand.isPending}
            onClick={() => salvarCand.mutate({ id, modelo: cand }, { onSuccess: () => { setCandSuja(false); toast.success("Edição da planta importada salva."); aoMudar(); }, onError: falha })}><Save className="mr-1 h-4 w-4" />Salvar a edição da planta importada</Button>}

          <div className="grid gap-2 rounded-lg border border-[#C9A961]/20 p-3 sm:grid-cols-3">
            <label className="text-xs text-gray-300">A planta importada substitui
              <select className={inputCls} value={destino} onChange={e => setDestino(e.target.value)}>
                {(temPadrao || !d.modelo?.edificacoes.length) && <option value="padrao">{temPadrao ? "A construção padrão (casa/prédio padrão)" : "A base do modelo (ainda não há construção)"}</option>}
                {pavimentos.map(p => <option key={p.valor} value={p.valor}>Só o pavimento: {p.rotulo}</option>)}
              </select></label>
            {destino !== "padrao" && <label className="text-xs text-gray-300">Pavimento da planta importada
              <select className={inputCls} value={pvCand} onChange={e => setPvCand(e.target.value)}>
                <option value="">{cand.edificacoes[0]?.pavimentos[0]?.nome ?? "—"} (o primeiro)</option>
                {cand.edificacoes[0]?.pavimentos.slice(1).map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select></label>}
            <label className="text-xs text-gray-300">Motivo (fica no histórico)
              <input className={inputCls} maxLength={400} value={motivo} placeholder="Ex.: projeto do arquiteto, revisão 2" onChange={e => setMotivo(e.target.value)} /></label>
            <div className="sm:col-span-3 flex flex-wrap items-center gap-2">
              <Button className={btnOuro} disabled={aplicar.isPending || (d.status === "publicada" && !admin)} onClick={aplicarAgora}><Check className="mr-1 h-4 w-4" />Aplicar a planta importada</Button>
              <span className="text-xs text-gray-400">As posições das construções no terreno ficam onde estão. {d.status === "publicada" ? "A maquete publicada sai do ar até ser validada e publicada de novo." : d.status === "validada" ? "A maquete volta para revisão." : ""}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Histórico das plantas: cada mudança do modelo, com quem fez, de onde veio e o botão de restaurar. */
export function HistoricoPlanta({ d, admin, sujo, aoMudar }: { d: Detalhe; admin: boolean; sujo: boolean; aoMudar: () => void }) {
  const id = d.id;
  const [aberto, setAberto] = useState(false);
  const lista = trpc.maquete3d.revisoes.useQuery({ id }, { enabled: aberto });
  const restaurar = trpc.maquete3d.restaurarRevisao.useMutation({
    onSuccess: r => { toast.success(r.saiuDoAr ? "Versão restaurada. A maquete saiu do ar e voltou para revisão." : "Versão restaurada."); lista.refetch(); aoMudar(); },
    onError: falha,
  });
  const podeRestaurar = ["liberada", "em_revisao", "validada", "publicada"].includes(d.status) && (d.status !== "publicada" || admin);
  return (
    <div className="space-y-2 border-t border-[#C9A961]/15 pt-3 text-sm">
      <Button size="sm" variant="outline" className={btnOutline} onClick={() => setAberto(v => !v)}><History className="mr-1 h-4 w-4" />{aberto ? "Esconder o histórico da planta" : "Histórico da planta"}</Button>
      {aberto && (lista.isLoading ? <p className="text-gray-400">Carregando…</p> : !lista.data?.length ? <p className="text-gray-400">Nenhuma mudança registrada ainda (o histórico começa a contar a partir de 16/11/2026).</p> : (
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {lista.data.map(r => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded border border-[#C9A961]/10 px-2 py-1">
              <span className="font-mono text-xs text-gray-400">v{r.versao}</span>
              <span>{ROTULOS_ORIGEM_REVISAO[r.origem] ?? r.origem}</span>
              {r.motivo && <span className="text-gray-300">— {r.motivo}</span>}
              {r.documento && <span className="text-xs text-gray-400">· PDF: {r.documento}</span>}
              <span className="text-xs text-gray-400">· {dataHora(r.createdAt)}{r.autor ? ` · ${r.autor}` : ""}</span>
              {r.versao === d.modeloVersao ? <span className="text-xs text-emerald-300">(em uso)</span> : podeRestaurar && (
                <Button size="sm" variant="outline" className={btnOutline} disabled={restaurar.isPending} onClick={() => {
                  if (sujo && !window.confirm("Há alterações não salvas na planta, que serão descartadas. Continuar?")) return;
                  if (window.confirm(`Restaurar a versão ${r.versao}? A planta de agora continua no histórico.${d.status === "publicada" ? " A maquete sai do ar e volta para revisão." : ""}`)) restaurar.mutate({ id, revisaoId: r.id, versao: d.modeloVersao });
                }}><RotateCcw className="mr-1 h-4 w-4" />Restaurar</Button>
              )}
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}
