// EPIC-027 C7 (20/11/2026) — Central WhatsApp › Enviar mensagem › "Campanha pela API oficial".
// C7.1 (21/11/2026): quem OPERA é o admin ou o colaborador com o módulo WhatsApp (decisão do dono); a configuração (chave, interruptor,
// tetos, preço, avisos de entrega) continua só do admin, em Integrações. O colaborador vê só se a API está pronta para uso.
// Escolher modelo APROVADO, preencher as variáveis, ver a prévia (contagens, vagas do dia e custo estimado), confirmar com a contagem
// e acompanhar o envio em lotes (retomável: "Continuar" segue de onde parou). Também: lista dos modelos e painel das campanhas.
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Loader2, Megaphone, RefreshCw, Send } from "lucide-react";
import { ROTULO_CATEGORIA_MODELO, ROTULO_STATUS_MODELO, type FonteVariavel } from "@shared/whatsapp/ycloud";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const cardCls = "bg-[#2C3E50] border-[#C9A961]/20";
const inputCls = "bg-[#1A2332] border-[#C9A961]/30 text-white";
const dinheiro = (v: number | null | undefined, moeda: string | null | undefined) =>
  v === null || v === undefined ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: moeda || "USD", maximumFractionDigits: 4 });
const ROTULO_CAMPANHA: Record<string, string> = { enviando: "Enviando", pausada: "Pausada", concluida: "Concluída", cancelada: "Cancelada" };
const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));

type Modelo = { nome: string; idioma: string; categoria: string | null; status: string | null; motivoRecusa: string | null;
  analise: { compativel: boolean; motivo: string | null; campos: Array<{ chave: string; local: "cabecalho" | "corpo"; indice: number }>; corpo: string; cabecalho: string | null } };

/** Modelos da conta da YCloud, com situação de aprovação (Templates da Central). */
export function ModelosApiOficial() {
  const modelos = trpc.whatsappOficial.modelos.useMutation({ onError: e => toast.error(e.message) });
  return (
    <Card className={cardCls}>
      <CardHeader><CardTitle className="flex items-center gap-2 text-sm text-[#C9A961]"><Megaphone className="h-4 w-4" /> Modelos da API oficial (YCloud)</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm text-gray-200">
        <p className="text-xs text-gray-300">Campanha pela API oficial só usa modelo APROVADO pela Meta. Os modelos são criados e enviados para aprovação no painel da YCloud (passo a passo na story C7); aqui você confere a situação.</p>
        <Button size="sm" variant="outline" disabled={modelos.isPending} onClick={() => modelos.mutate()}><RefreshCw className={`mr-1 h-3 w-3 ${modelos.isPending ? "animate-spin" : ""}`} /> {modelos.data ? "Atualizar modelos" : "Carregar modelos"}</Button>
        {modelos.data && (modelos.data.length === 0 ? <p className="text-xs text-gray-400">Nenhum modelo na conta.</p> : (
          <div className="space-y-2">
            {modelos.data.map(m => (
              <div key={`${m.nome}:${m.idioma}`} className="rounded border border-[#C9A961]/20 bg-[#1A2332] p-2">
                <p className="text-xs"><b className="text-white">{m.nome}</b> <span className="text-gray-400">({m.idioma})</span> · {ROTULO_CATEGORIA_MODELO[m.categoria ?? ""] ?? m.categoria ?? "—"} ·{" "}
                  <span className={m.status === "APPROVED" ? "text-green-300" : m.status === "REJECTED" ? "text-red-300" : "text-yellow-200"}>{ROTULO_STATUS_MODELO[m.status ?? ""] ?? m.status ?? "—"}</span>
                  {!m.analise.compativel && <span className="text-orange-200"> · não dá para disparar por aqui: {m.analise.motivo}</span>}</p>
                {m.motivoRecusa && <p className="text-[11px] text-red-200">Motivo da recusa: {m.motivoRecusa}</p>}
                <p className="mt-1 whitespace-pre-line text-[11px] text-gray-400">{m.analise.cabecalho ? `${m.analise.cabecalho}\n` : ""}{m.analise.corpo}</p>
              </div>
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Formulário da campanha (os destinatários vêm da lista da esquerda, os mesmos leads do CRM). */
export function CampanhaApiOficial({ leadIds, aoCriar }: { leadIds: number[]; aoCriar: (campanhaId: number) => void }) {
  const utils = trpc.useUtils();
  const modelos = trpc.whatsappOficial.modelos.useMutation({ onError: e => toast.error(e.message) });
  const previa = trpc.whatsappOficial.previa.useMutation({ onError: e => toast.error(e.message) });
  const criar = trpc.whatsappOficial.criarCampanha.useMutation({ onError: e => toast.error(e.message) });
  const [chaveModelo, setChaveModelo] = useState("");
  const [nome, setNome] = useState("");
  const [variaveis, setVariaveis] = useState<Record<string, FonteVariavel>>({});
  const carregou = useRef(false);
  useEffect(() => { if (!carregou.current) { carregou.current = true; modelos.mutate(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const aprovados = (modelos.data ?? []).filter((m: Modelo) => m.status === "APPROVED" && m.analise.compativel);
  const modelo = aprovados.find((m: Modelo) => `${m.nome}:${m.idioma}` === chaveModelo) ?? null;
  // qualquer mudança invalida a prévia (a confirmação usa a contagem vista)
  useEffect(() => { previa.reset(); }, [chaveModelo, JSON.stringify(variaveis), nome, leadIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const entrada = modelo ? { nome: nome.trim(), modelo: { nome: modelo.nome, idioma: modelo.idioma }, variaveis, leadIds } : null;
  const completo = !!modelo && nome.trim().length >= 2 && leadIds.length > 0 && modelo.analise.campos.every(c => {
    const v = variaveis[c.chave];
    return v && (v.fonte !== "fixo" || v.texto.trim());
  });
  const p = previa.data;
  const pronta = trpc.whatsappOficial.prontidao.useQuery(undefined, { retry: false, refetchOnWindowFocus: true });

  async function confirmar() {
    if (!entrada || !p) return;
    const custo = p.custo.estimado !== null ? ` Custo estimado: ${dinheiro(p.custo.estimado, p.custo.moeda)}.` : "";
    if (!window.confirm(`Disparar a campanha "${entrada.nome}" para ${p.contagem.aEnviar} contato(s) pela API oficial?${custo}\n\nEssa ação envia mensagens de verdade.`)) return;
    const r = await criar.mutateAsync({ ...entrada, confirmarQuantidade: p.contagem.aEnviar, chaveConfirmacao: p.chaveConfirmacao }).catch(() => null);
    if (!r) return;
    toast.success(r.repetida ? "Essa campanha já tinha sido confirmada: nada novo foi criado." : `Campanha criada com ${r.total} destinatário(s). O envio começou.`);
    await utils.whatsappOficial.campanhas.invalidate();
    aoCriar(r.campanhaId);
    setChaveModelo(""); setNome(""); setVariaveis({});
  }

  return (
    <Card className={cardCls}>
      <CardHeader><CardTitle className="text-sm text-gray-300">Campanha pela API oficial (modelo aprovado)</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm text-gray-200">
        <p className="text-xs text-gray-300">Sai pela API oficial da Meta (YCloud), com fila, limite diário da conta e opt-out respeitados. Conversas e grupos continuam pelo WhatsApp Web.</p>
        {pronta.data && (pronta.data.pronta
          ? <p role="status" className="text-xs text-green-300">Pronta para uso{pronta.data.restanteHoje !== null ? ` · ainda cabem ${pronta.data.restanteHoje} envio(s) hoje` : ""} · até {pronta.data.tetoCampanha} por campanha.</p>
          : <p role="alert" className="flex items-start gap-2 rounded border border-orange-500/30 bg-orange-500/10 p-2 text-xs text-orange-100"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{pronta.data.motivo}</p>)}
        <div><Label className="text-gray-300">Nome da campanha</Label><Input className={inputCls} maxLength={120} value={nome} onChange={e => setNome(e.target.value)} placeholder="ex.: Lançamento Jardim — novembro" /></div>
        <div>
          <Label className="text-gray-300">Modelo aprovado</Label>
          <div className="mt-1 flex gap-2">
            <select value={chaveModelo} onChange={e => { setChaveModelo(e.target.value); setVariaveis({}); }} className={`${inputCls} w-full rounded-md px-3 py-2 text-sm`}>
              <option value="">{modelos.isPending ? "Carregando modelos…" : aprovados.length ? "— Escolha um modelo —" : "Nenhum modelo aprovado e compatível"}</option>
              {aprovados.map((m: Modelo) => <option key={`${m.nome}:${m.idioma}`} value={`${m.nome}:${m.idioma}`}>{m.nome} ({m.idioma}) — {ROTULO_CATEGORIA_MODELO[m.categoria ?? ""] ?? m.categoria}</option>)}
            </select>
            <Button size="sm" variant="outline" disabled={modelos.isPending} onClick={() => modelos.mutate()} aria-label="Atualizar modelos"><RefreshCw className={`h-3 w-3 ${modelos.isPending ? "animate-spin" : ""}`} /></Button>
          </div>
        </div>
        {modelo && (
          <div className="space-y-2 rounded border border-[#C9A961]/20 bg-[#1A2332] p-2">
            <p className="whitespace-pre-line text-xs text-gray-300">{modelo.analise.cabecalho ? `${modelo.analise.cabecalho}\n` : ""}{modelo.analise.corpo}</p>
            {modelo.analise.campos.map(c => {
              const v = variaveis[c.chave];
              return (
                <div key={c.chave} className="grid gap-1 sm:grid-cols-2">
                  <select aria-label={`Valor de {{${c.indice}}}`} value={v?.fonte ?? ""} className={`${inputCls} rounded-md px-2 py-1.5 text-xs`}
                    onChange={e => { const f = e.target.value; setVariaveis(x => ({ ...x, [c.chave]: f === "fixo" ? { fonte: "fixo", texto: "" } : { fonte: f as "primeiro_nome" | "nome_completo" } })); }}>
                    <option value="">{`{{${c.indice}}} do ${c.local === "corpo" ? "corpo" : "cabeçalho"} — escolha`}</option>
                    <option value="primeiro_nome">Primeiro nome do contato</option>
                    <option value="nome_completo">Nome completo do contato</option>
                    <option value="fixo">Texto fixo</option>
                  </select>
                  {v?.fonte === "fixo" && <Input className={`${inputCls} text-xs`} maxLength={c.local === "corpo" ? 1024 : 60} value={v.texto} placeholder="Texto (sem quebra de linha)"
                    onChange={e => setVariaveis(x => ({ ...x, [c.chave]: { fonte: "fixo", texto: e.target.value } }))} />}
                </div>
              );
            })}
          </div>
        )}
        <Button size="sm" variant="outline" disabled={!completo || previa.isPending} onClick={() => entrada && previa.mutate(entrada)}>
          {previa.isPending ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Conferindo…</> : `Ver prévia e custo (${leadIds.length} selecionado${leadIds.length === 1 ? "" : "s"})`}
        </Button>
        {p && (
          <div className="space-y-2 rounded border border-[#C9A961]/30 bg-[#C9A961]/5 p-3 text-xs">
            <p className="text-sm font-bold text-white">Vão receber: {p.contagem.aEnviar} de {p.contagem.selecionados}</p>
            <ul className="list-inside list-disc text-gray-300">
              {p.contagem.optout > 0 && <li>{p.contagem.optout} pediram para não receber (ficam de fora sempre)</li>}
              {p.contagem.invalidos > 0 && <li>{p.contagem.invalidos} sem telefone válido ou fora do CRM</li>}
              {p.contagem.duplicados > 0 && <li>{p.contagem.duplicados} telefone repetido (cada número recebe uma vez)</li>}
              {p.contagem.reservados > 0 && <li>{p.contagem.reservados} é o número do dono ou da empresa</li>}
              {p.contagem.jaRecebeu > 0 && <li>{p.contagem.jaRecebeu} já receberam este modelo {p.janelaRepeticaoDias !== undefined ? `nos últimos ${p.janelaRepeticaoDias} dia(s)` : "recentemente"} (não recebem de novo)</li>}
              {p.contagem.semNome > 0 && <li>{p.contagem.semNome} sem nome no cadastro (a variável usa o nome)</li>}
              {p.contagem.nomeRecusado > 0 && <li>{p.contagem.nomeRecusado} com nome que não pode ir na mensagem (link, "@", números ou símbolos) — corrija o cadastro</li>}
              {p.contagem.parametroInvalido > 0 && <li>{p.contagem.parametroInvalido} com nome que a Meta não aceita como variável</li>}
              {p.contagem.acimaDoLimite > 0 && <li className="text-yellow-200">{p.contagem.acimaDoLimite} acima do limite de hoje / da campanha (não entram)</li>}
            </ul>
            {/* C7.1: tier, teto do painel, usados em 24 h e base do preço só chegam para o admin; o colaborador vê o que ainda cabe */}
            {p.vagas.tetoDia !== undefined
              ? <p className="text-gray-300">Limite em 24 h: {p.vagas.limiteDiario === null || p.vagas.limiteDiario === undefined ? "sem limite da Meta" : p.vagas.limiteDiario} (teto do painel {p.vagas.tetoDia}) · já usados {p.vagas.usados24h ?? 0} · ainda cabem {p.vagas.restante} · teto por campanha {p.vagas.tetoCampanha}</p>
              : <p className="text-gray-300">Ainda cabem hoje: {p.vagas.restante} · teto por campanha {p.vagas.tetoCampanha}</p>}
            <p className="text-gray-300">Custo estimado: <b className="text-white">{dinheiro(p.custo.estimado, p.custo.moeda)}</b>
              {p.custo.estimado === null ? " — sem preço estimado (o administrador informa em Integrações › API oficial do WhatsApp)"
                : p.custo.base === "media_registrada" ? " (média real das últimas mensagens)" : p.custo.base === "configurado" ? " (preço informado em Integrações)" : ""}</p>
            <p className="text-gray-300">Prévia:</p>
            {p.exemplos.map((x, i) => <div key={i} className="whitespace-pre-wrap rounded bg-[#1A2332] p-2 text-gray-100"><b className="text-[#C9A961]">{x.nome}: </b>{x.texto}</div>)}
            <Button disabled={criar.isPending || p.contagem.aEnviar === 0} onClick={() => void confirmar()} className="bg-green-600 font-bold text-white hover:bg-green-700">
              <Send className="mr-2 h-4 w-4" /> {criar.isPending ? "Criando…" : `Confirmar disparo para ${p.contagem.aEnviar} contato(s)`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Painel das campanhas: totais, custo estimado × registrado, falhas e o envio em lotes (Continuar / Pausar / Cancelar). */
export function PainelCampanhasApiOficial({ iniciar }: { iniciar: number }) {
  const utils = trpc.useUtils();
  const lista = trpc.whatsappOficial.campanhas.useQuery(undefined, { refetchInterval: 30_000 });
  const lote = trpc.whatsappOficial.enviarLote.useMutation();
  const mudar = trpc.whatsappOficial.mudarCampanha.useMutation({ onSuccess: () => utils.whatsappOficial.campanhas.invalidate(), onError: e => toast.error(e.message) });
  const optout = trpc.whatsappOficial.registrarOptout.useMutation({ onSuccess: () => { toast.success("Registrado: essa pessoa não recebe mais campanhas pela API."); void utils.whatsappOficial.detalheCampanha.invalidate(); }, onError: e => toast.error(e.message) });
  const [enviando, setEnviando] = useState<number | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aberta, setAberta] = useState<number | null>(null);
  const detalhe = trpc.whatsappOficial.detalheCampanha.useQuery({ campanhaId: aberta ?? 0 }, { enabled: aberta !== null });
  const parar = useRef(false);

  async function rodar(campanhaId: number) {
    if (enviando !== null) return;
    parar.current = false;
    setEnviando(campanhaId); setAviso(null);
    try {
      for (let i = 0; i < 500 && !parar.current; i++) {
        const r = await lote.mutateAsync({ campanhaId });
        await utils.whatsappOficial.campanhas.invalidate();
        if (r.status !== "enviando") { if (r.motivo) setAviso(r.motivo); break; }
        if (r.aguardarSegundos) {
          if (r.aguardarSegundos > 120) { setAviso(`${r.motivo ?? "A YCloud pediu para esperar."} Clique em "Continuar" depois de ${Math.ceil(r.aguardarSegundos / 60)} min.`); break; }
          setAviso(`${r.motivo ?? "Aguardando a YCloud."} (${r.aguardarSegundos} s)`);
          await esperar(r.aguardarSegundos * 1000);
          continue;
        }
        if (r.restantes === 0) break;
      }
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "O envio parou. Clique em Continuar para seguir de onde parou.");
    } finally {
      setEnviando(null);
      await utils.whatsappOficial.campanhas.invalidate();
    }
  }
  // campanha recém-criada: começa a enviar
  useEffect(() => { if (iniciar > 0) void rodar(iniciar); }, [iniciar]); // eslint-disable-line react-hooks/exhaustive-deps

  const cs = lista.data ?? [];
  return (
    <Card className={cardCls}>
      <CardHeader><CardTitle className="text-sm text-gray-300">Campanhas pela API oficial</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm text-gray-200">
        {aviso && <p role="status" className="flex items-start gap-2 rounded border border-orange-500/30 bg-orange-500/10 p-2 text-xs text-orange-100"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{aviso}</p>}
        {lista.error && <p role="alert" className="text-xs text-red-300">{lista.error.message}</p>}
        {!cs.length && !lista.isLoading && <p className="text-xs text-gray-400">Nenhuma campanha ainda.</p>}
        {cs.map(c => (
          <div key={c.id} className="rounded border border-[#C9A961]/20 bg-[#1A2332] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold text-white">{c.nome} <span className="font-normal text-gray-400">— {c.modelo}{c.disparadaPor ? ` · disparada por ${c.disparadaPor.nome}${c.disparadaPor.papel === "colaborador" ? " (colaborador)" : c.disparadaPor.papel === "admin" ? " (administrador)" : ""}` : ""}</span> <span className="ml-1 rounded bg-[#C9A961]/20 px-2 py-0.5 text-[10px] font-bold uppercase text-[#C9A961]">{ROTULO_CAMPANHA[c.status] ?? c.status}</span></p>
              <div className="flex flex-wrap gap-2">
                {(c.status === "enviando" || c.status === "pausada") && (
                  <Button size="sm" disabled={enviando !== null} className="bg-green-600 text-white hover:bg-green-700" onClick={async () => {
                    // C7.1: pausa do admin (ou trava do sistema) o colaborador não continua — o servidor recusa e o aviso aparece
                    if (c.status === "pausada" && !(await mudar.mutateAsync({ campanhaId: c.id, acao: "continuar" }).then(() => true, () => false))) return;
                    void rodar(c.id);
                  }}>{enviando === c.id ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Enviando…</> : "Continuar envio"}</Button>
                )}
                {c.status === "enviando" && <Button size="sm" variant="outline" onClick={() => { parar.current = true; mudar.mutate({ campanhaId: c.id, acao: "pausar" }); }}>Pausar</Button>}
                {(c.status === "enviando" || c.status === "pausada") && <Button size="sm" variant="outline" className="text-red-300" disabled={enviando === c.id}
                  onClick={() => { if (window.confirm("Cancelar a campanha? Quem ainda está na fila não recebe.")) mudar.mutate({ campanhaId: c.id, acao: "cancelar" }); }}>Cancelar</Button>}
                <Button size="sm" variant="outline" onClick={() => setAberta(a => (a === c.id ? null : c.id))}>{aberta === c.id ? "Fechar" : "Falhas"}</Button>
              </div>
            </div>
            {c.motivoPausa && c.status === "pausada" && <p className="mt-1 text-xs text-yellow-200">{c.motivoPausa}</p>}
            <p className="mt-2 text-xs text-gray-300">
              Total {c.totais.total} · na fila {c.totais.fila} · aceitas {c.totais.aceitas} · enviadas {c.totais.enviadas} · entregues {c.totais.entregues} · lidas {c.totais.lidas} ·{" "}
              <span className={c.totais.falhas ? "text-red-300" : ""}>falhas {c.totais.falhas}</span>{c.totais.incertas ? <span className="text-yellow-200"> · incertas {c.totais.incertas}</span> : null}
            </p>
            <p className="text-xs text-gray-400">Custo estimado {dinheiro(c.custoEstimado, c.moedaEstimada)} × registrado {dinheiro(c.custoRegistrado, c.moedaRegistrada ?? c.moedaEstimada)}{c.custoProvisorio ? ` (+ ${dinheiro(c.custoProvisorio, c.moedaRegistrada)} ainda provisório)` : ""}</p>
            {aberta === c.id && (
              <div className="mt-2 space-y-2 border-t border-[#C9A961]/10 pt-2 text-xs">
                {detalhe.isLoading && <p className="text-gray-400">Carregando…</p>}
                {detalhe.data && <>
                  {detalhe.data.motivos.length === 0 ? <p className="text-gray-400">Nenhuma falha.</p> : (
                    <ul className="space-y-1">{detalhe.data.motivos.map((m, i) => <li key={i}><b className="text-red-200">{m.quantidade}×</b> {m.motivo}{m.codigo ? ` (${m.codigo})` : ""}</li>)}</ul>
                  )}
                  {detalhe.data.falhas.length > 0 && (
                    <div className="max-h-60 space-y-1 overflow-y-auto">
                      {detalhe.data.falhas.map(f => (
                        <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-black/20 px-2 py-1">
                          <span>{f.nome ?? "(sem nome)"} · {f.telefone} · {f.status === "incerto" ? "incerto (conferir na YCloud)" : f.motivo}</span>
                          {f.codigo !== "OPTOUT" && <button className="text-[11px] text-red-300 hover:underline" disabled={optout.isPending}
                            onClick={() => { if (window.confirm("Registrar que essa pessoa não quer mais receber campanhas? Não há como desfazer pela tela.")) optout.mutate({ envioId: f.id }); }}>Não enviar mais</button>}
                        </div>
                      ))}
                    </div>
                  )}
                </>}
              </div>
            )}
          </div>
        ))}
        <p className="text-[11px] text-gray-500">O envio segue em lotes enquanto esta tela estiver aberta (5 mensagens por segundo, limite do número em coexistência). Se fechar a tela ou a conexão cair, nada se perde: "Continuar envio" retoma de onde parou, e nenhum número recebe duas vezes.</p>
      </CardContent>
    </Card>
  );
}
