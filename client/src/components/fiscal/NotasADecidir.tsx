// EPIC-029 S-2 — seção "Notas a decidir" da aba Contabilidade do BPO.
// S-7: Emitir/Cancelar/DANFSe/XML. "Emitir" só fica ativo com as três travas abertas (EMISSAO_DISPONIVEL no código, interruptor
// de emissão da empresa e ambiente de testes/produção); o servidor confere tudo de novo.
// As colunas vêm da origem e dos cadastros (nada digitado aqui). Editar só ajusta valor, descrição, município, empresa
// e tipo de serviço; CNPJ/endereço do tomador se corrigem NO CADASTRO (botão "Abrir cadastro do tomador").
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Calculator, FileText, History, RefreshCw } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyInput } from "@/components/ui/currency-input";
import { AliquotaSimples } from "./AliquotaSimples";
import { MOTIVOS_SEM_NOTA, ROTULO_MOTIVO, problemaDoMotivo, type MotivoSemNota } from "@shared/fiscal/motivos";
import { ALERTA_TOMADOR_MUDOU } from "@shared/fiscal/origens";
import { motivoSemEmissao, ROTULO_STATUS, type StatusNota } from "@shared/fiscal/status";

const MOTIVOS_CANCELAMENTO = [[1, "Erro na emissão"], [2, "Serviço não prestado"], [9, "Outros"]] as const;
/** Por que o botão Emitir está desligado (null = pode emitir): o motivo real (sistema, ambiente ou empresa não liberada). */
const bloqueioDeEmissao = (n: Nota) => motivoSemEmissao(n.emissor);

type Nota = inferRouterOutputs<AppRouter>["fiscal"]["notas"]["listar"]["itens"][number];

const dinheiro = (c: number) => formatCurrency(c / 100);
const dataBr = (d: string | null | undefined) => (d ? d.split("-").reverse().join("/") : "—");
const FONTE_MUNICIPIO = { ajuste: "ajustado", obra: "da obra", tomador: "do tomador", emissor: "do emissor", nenhum: "" } as const;
const TODOS = "todos";

function baixar(nome: string, bytes: Uint8Array, tipo: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: tipo }));
  const a = document.createElement("a");
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function NotasADecidir({ emissorId, podeDecidir }: { emissorId: number | null; podeDecidir: boolean }) {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<string>("pendentes");
  const [cliente, setCliente] = useState<string>(TODOS);
  const [obra, setObra] = useState<string>(TODOS);
  const [municipio, setMunicipio] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const filtroStatus: StatusNota[] | undefined = status === "pendentes" ? ["A_DECIDIR", "ADIADA"] : status === TODOS ? undefined : [status as StatusNota];
  const [bpoClientId, leadId] = cliente.startsWith("b:") ? [Number(cliente.slice(2)), undefined] : cliente.startsWith("l:") ? [undefined, Number(cliente.slice(2))] : [undefined, undefined];
  // Revisão do PR #302 (1): todos os filtros valem no servidor, antes do limite; a lista vem em páginas ("Carregar mais").
  const lista = trpc.fiscal.notas.listar.useInfiniteQuery({
    emissorId: emissorId ?? undefined, status: filtroStatus, bpoClientId, leadId, obraId: obra === TODOS ? undefined : Number(obra),
    municipio: municipio || undefined, de: de || undefined, ate: ate || undefined,
  }, { getNextPageParam: pagina => pagina.proximoCursor ?? undefined });
  const notas: Nota[] = useMemo(() => (lista.data?.pages ?? []).flatMap(p => p.itens), [lista.data]);
  const isLoading = lista.isLoading;
  // Opções dos filtros sobre TODOS os rascunhos (não só a página carregada), para não sumirem ao filtrar.
  const { data: opcoes } = trpc.fiscal.notas.opcoesFiltro.useQuery({ emissorId: emissorId ?? undefined });
  const { data: resumo } = trpc.fiscal.resumo.useQuery({ emissorId: emissorId ?? undefined });
  const { data: emissores = [] } = trpc.fiscal.emissoresComPerfil.useQuery();
  const { data: tipos = [] } = trpc.fiscal.tipos.listar.useQuery();

  const clientes = useMemo(() => [
    ...(opcoes?.clientesBpo ?? []).map(c => [`b:${c.id}`, c.nome || `Cliente ${c.id}`] as const),
    ...(opcoes?.cards ?? []).map(c => [`l:${c.id}`, c.nome || `Card ${c.id}`] as const),
  ].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")), [opcoes]);
  const obras = useMemo(() => (opcoes?.obras ?? []).map(o => [o.id, o.nome] as const), [opcoes]);

  const invalidar = () => {
    void utils.fiscal.notas.listar.invalidate();
    void utils.fiscal.notas.opcoesFiltro.invalidate();
    void utils.fiscal.resumo.invalidate();
    void utils.fiscal.relatorio.mensal.invalidate();
  };
  const erro = (e: { message: string }) => toast.error(e.message);
  const atualizar = trpc.fiscal.notas.atualizar.useMutation({
    onSuccess: r => {
      const n = Object.values(r.criados).reduce((a, b) => a + b, 0);
      toast.success(n ? `${n} rascunho(s) novo(s).` : "Nenhum recebimento novo para rascunho.");
      invalidar();
    },
    onError: erro,
  });
  const salvarConfig = trpc.fiscal.config.salvar.useMutation({ onSuccess: () => { toast.success("Configuração salva."); invalidar(); }, onError: erro });

  const [semNota, setSemNota] = useState<{ nota: Nota; motivo: MotivoSemNota | ""; texto: string } | null>(null);
  const [depois, setDepois] = useState<{ nota: Nota; ate: string } | null>(null);
  const [edicao, setEdicao] = useState<{ nota: Nota; valor: number; descricao: string; municipioNome: string; municipioUf: string; emissorId: string; tipoServicoId: string } | null>(null);
  const [historico, setHistorico] = useState<Nota | null>(null);
  // S-8: "Alíquota do Simples — como foi calculada" (só para emissor do Simples).
  const [simples, setSimples] = useState<Nota | null>(null);
  const hist = trpc.fiscal.notas.historico.useQuery({ id: historico?.id ?? 0 }, { enabled: Boolean(historico) });

  const naoEmitir = trpc.fiscal.notas.naoEmitir.useMutation({ onSuccess: () => { setSemNota(null); toast.success("Marcada como sem nota."); invalidar(); }, onError: erro });
  const adiar = trpc.fiscal.notas.adiar.useMutation({ onSuccess: () => { setDepois(null); toast.success("Deixada para depois."); invalidar(); }, onError: erro });
  const reabrir = trpc.fiscal.notas.reabrir.useMutation({ onSuccess: () => { toast.success("Reaberta."); invalidar(); }, onError: erro });
  const editar = trpc.fiscal.notas.editar.useMutation({ onSuccess: () => { setEdicao(null); toast.success("Rascunho atualizado."); invalidar(); }, onError: erro });

  const [emitirConf, setEmitirConf] = useState<Nota | null>(null);
  const [cancelar, setCancelar] = useState<{ nota: Nota; motivo: 1 | 2 | 9 | 0; justificativa: string } | null>(null);
  const emitir = trpc.fiscal.notas.emitir.useMutation({
    onSuccess: r => { setEmitirConf(null); (r.situacao === "emitida" || r.situacao === "ja_emitida" ? toast.success : toast.warning)(r.mensagem); invalidar(); },
    onError: e => { erro(e); invalidar(); },
  });
  const cancelarM = trpc.fiscal.notas.cancelar.useMutation({
    onSuccess: r => { setCancelar(null); (r.situacao === "incerta" ? toast.warning : toast.success)(r.mensagem); invalidar(); },
    onError: e => { erro(e); invalidar(); },
  });
  // QA S-7 (B1): nota presa em "Emitindo" → verificar manualmente (só admin; não envia nem apaga; fica no histórico).
  const verificarManual = trpc.fiscal.notas.verificarManualmente.useMutation({
    onSuccess: r => { toast.success(r.mensagem); invalidar(); },
    onError: e => { erro(e); invalidar(); },
  });
  const danfse = async (n: Nota) => {
    try {
      const r = await utils.fiscal.notas.danfse.fetch({ id: n.id });
      baixar(r.nomeArquivo, Uint8Array.from(atob(r.base64), c => c.charCodeAt(0)), "application/pdf");
    } catch (e) { erro(e as Error); }
  };
  const xml = async (n: Nota) => {
    try {
      const r = await utils.fiscal.notas.xml.fetch({ id: n.id });
      baixar(r.nomeArquivo, new TextEncoder().encode(r.xml), "application/xml");
    } catch (e) { erro(e as Error); }
  };
  const justificativaLen = cancelar ? cancelar.justificativa.trim().length : 0;

  const previa = async (n: Nota) => {
    try {
      const r = await utils.fiscal.notas.previa.fetch({ id: n.id });
      baixar(r.nomeArquivo, Uint8Array.from(atob(r.base64), c => c.charCodeAt(0)), "application/pdf");
    } catch (e) { erro(e as Error); }
  };

  const [inicio, setInicio] = useState<string | null>(null);
  const inicioMostrado = inicio ?? resumo?.config.inicioEm ?? "";
  const problemaSemNota = semNota ? problemaDoMotivo(semNota.motivo || undefined, semNota.texto) : null;

  return (
    <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-[#C9A961]">Notas a decidir</CardTitle>
        {podeDecidir && (
          <Button size="sm" variant="outline" className="border-[#C9A961]/40 text-[#C9A961]" disabled={atualizar.isPending} onClick={() => atualizar.mutate()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Atualizar
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-400">
          Cada recebimento de serviço vira um rascunho para você decidir: emitir, não emitir (com motivo) ou decidir depois.
          Emitir só fica disponível quando a empresa emissora tem a emissão liberada e o ambiente ligado (Dados fiscais do perfil).
          {resumo?.config.ultimaVarreduraEm ? ` Última atualização: ${new Date(resumo.config.ultimaVarreduraEm).toLocaleString("pt-BR")}.` : ""}
        </p>

        {podeDecidir && resumo && (
          <div className="flex flex-wrap items-end gap-4 rounded bg-[#1A2332] p-3 text-sm">
            <label className="flex items-center gap-2">
              <Switch checked={resumo.config.ligado} onCheckedChange={v => salvarConfig.mutate({ ligado: v, inicioEm: inicioMostrado })} />
              Gerar rascunhos sozinho (todo dia e de hora em hora, nos horários que o sistema já roda)
            </label>
            <div>
              <Label htmlFor="fiscal-inicio">Só recebimentos a partir de</Label>
              <div className="mt-1 flex gap-2">
                <Input id="fiscal-inicio" type="date" value={inicioMostrado} onChange={e => setInicio(e.target.value)} className="bg-[#2C3E50]" />
                <Button size="sm" variant="outline" disabled={!inicio || salvarConfig.isPending}
                  onClick={() => inicio && salvarConfig.mutate({ ligado: resumo.config.ligado, inicioEm: inicio })}>Salvar data</Button>
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <div>
            <Label>Situação</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="mt-1 bg-[#1A2332]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pendentes">A decidir e depois</SelectItem>
                <SelectItem value="A_DECIDIR">A decidir</SelectItem>
                <SelectItem value="ADIADA">Depois</SelectItem>
                <SelectItem value="SEM_NOTA">Sem nota</SelectItem>
                <SelectItem value={TODOS}>Todas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Cliente</Label>
            <Select value={cliente} onValueChange={setCliente}>
              <SelectTrigger className="mt-1 bg-[#1A2332]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos</SelectItem>
                {clientes.map(([k, nome]) => <SelectItem key={k} value={k}>{nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Obra</Label>
            <Select value={obra} onValueChange={setObra}>
              <SelectTrigger className="mt-1 bg-[#1A2332]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todas</SelectItem>
                {obras.map(([idObra, titulo]) => <SelectItem key={idObra} value={String(idObra)}>{titulo}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="fiscal-municipio">Município</Label>
            <Input id="fiscal-municipio" value={municipio} onChange={e => setMunicipio(e.target.value)} placeholder="ex.: Parauapebas" className="mt-1 bg-[#1A2332]" />
          </div>
          <div>
            <Label htmlFor="fiscal-de">De</Label>
            <Input id="fiscal-de" type="date" value={de} onChange={e => setDe(e.target.value)} className="mt-1 bg-[#1A2332]" />
          </div>
          <div>
            <Label htmlFor="fiscal-ate">Até</Label>
            <Input id="fiscal-ate" type="date" value={ate} onChange={e => setAte(e.target.value)} className="mt-1 bg-[#1A2332]" />
          </div>
        </div>

        {isLoading ? <p className="text-sm text-gray-400">Carregando rascunhos...</p> : !notas.length ? (
          <p className="text-sm text-gray-400">Nenhum rascunho com estes filtros.</p>
        ) : (
          <div className="space-y-2">
            {notas.map(n => (
              <div key={n.id} className="rounded bg-[#1A2332] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-white">
                      {n.tomador.nome ?? "Sem tomador ligado"} — {dinheiro(n.valorCentavos)}
                      {n.valorAjustadoCentavos != null && <span className="ml-1 text-xs text-amber-300">(ajustado; origem {dinheiro(n.valorSugeridoCentavos)})</span>}
                    </p>
                    <p className="text-xs text-gray-400">
                      {n.origemRotulo} de {dataBr(n.dataEvento)} • {n.emissor?.razaoSocial ?? "empresa a escolher"} • {n.tipoServico?.nome ?? "tipo a classificar"}
                      {n.obra ? ` • obra ${n.obra.titulo}` : ""} • município {n.municipio.nome ? `${n.municipio.nome}/${n.municipio.uf ?? ""} (${FONTE_MUNICIPIO[n.municipio.fonte]})` : "a definir"}
                      {n.origem?.centroCustos ? ` • ${n.origem.centroCustos}` : ""}
                    </p>
                    <p className="mt-1 text-sm text-gray-200">{n.descricao || "—"}</p>
                    <p className="mt-1 text-xs">
                      <span className="rounded bg-[#2C3E50] px-2 py-0.5 text-[#C9A961]">{ROTULO_STATUS[n.status]}</span>
                      {n.status === "SEM_NOTA" && n.motivoSemNota && <span className="ml-2 text-gray-300">{ROTULO_MOTIVO[n.motivoSemNota]}{n.motivoTexto ? `: ${n.motivoTexto}` : ""}</span>}
                      {n.status === "ADIADA" && n.adiadaAte && <span className="ml-2 text-gray-300">até {dataBr(n.adiadaAte)}</span>}
                      {n.status !== "SEM_NOTA" && n.motivoSugerido && <span className="ml-2 text-amber-300">sugestão: {ROTULO_MOTIVO[n.motivoSugerido]}</span>}
                    </p>
                    {n.tomadorMudouNaOrigem && (
                      <p role="alert" className="mt-1 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-100">{ALERTA_TOMADOR_MUDOU}</p>
                    )}
                    {n.alerta && <p role="alert" className="mt-1 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-100">{n.alerta}</p>}
                    {n.motivoSemEmissor && <p className="mt-1 text-xs text-amber-200">{n.motivoSemEmissor}</p>}
                    {n.status === "ERRO" && n.ultimoErro && <p role="alert" className="mt-1 rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-100">{n.ultimoErro.frase}</p>}
                    {(n.status === "EMITIDA" || n.status === "CANCELADA") && (
                      <p className="mt-1 text-xs text-gray-300">NFS-e nº {n.numeroNfse} • chave {n.chaveAcesso}
                        {n.ambienteEmissao === "producao_restrita" && <span className="ml-2 rounded bg-amber-500/20 px-1 text-amber-200">AMBIENTE DE TESTES — SEM VALOR FISCAL</span>}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" onClick={() => void previa(n)}><FileText className="mr-1 h-4 w-4" /> Prévia</Button>
                    <Button size="sm" variant="outline" onClick={() => setHistorico(n)}><History className="mr-1 h-4 w-4" /> Histórico</Button>
                    {podeDecidir && ["A_DECIDIR", "ADIADA", "ERRO", "EMITINDO"].includes(n.status) && (() => {
                      const bloqueio = bloqueioDeEmissao(n);
                      return <Button size="sm" disabled={Boolean(bloqueio) || emitir.isPending} title={bloqueio?.frase} onClick={() => setEmitirConf(n)}>
                        {bloqueio ? `Emitir (${bloqueio.rotulo})` : n.status === "EMITINDO" ? "Conferir emissão" : n.status === "ERRO" ? "Tentar emitir de novo" : "Emitir"}
                      </Button>;
                    })()}
                    {podeDecidir && n.status === "EMITINDO" && (
                      <Button size="sm" variant="outline" disabled={verificarManual.isPending}
                        title="Não envia nada e não apaga nada: libera a empresa emissora e registra no histórico. Ao tentar emitir de novo, o sistema consulta a DPS antes de reenviar."
                        onClick={() => { if (window.confirm("Marcar esta nota para verificar manualmente? Nada é enviado nem apagado; confira no Emissor Nacional se a NFS-e desta DPS existe antes de emitir de novo.")) verificarManual.mutate({ id: n.id, versao: n.versao }); }}>
                        Marcar como verificar manualmente
                      </Button>
                    )}
                    {podeDecidir && (n.status === "EMITIDA" || n.status === "CANCELADA") && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => void danfse(n)}><FileText className="mr-1 h-4 w-4" /> DANFSe</Button>
                        <Button size="sm" variant="outline" onClick={() => void xml(n)}>XML</Button>
                        {n.status === "EMITIDA" && (() => {
                          // QA S-7 (B8): com a emissão da empresa desligada, nada sai à Sefin — nem cancelamento (o servidor também recusa).
                          const bloqueio = bloqueioDeEmissao(n);
                          return <Button size="sm" variant="outline" className="border-red-500/40 text-red-200" disabled={Boolean(bloqueio)} title={bloqueio ? `Cancelamento indisponível: ${bloqueio.frase}` : undefined}
                            onClick={() => setCancelar({ nota: n, motivo: 0, justificativa: "" })}>{bloqueio ? `Cancelar nota (${bloqueio.rotulo})` : "Cancelar nota"}</Button>;
                        })()}
                      </>
                    )}
                    {n.emissor?.regime === "simples_nacional" && (
                      <Button size="sm" variant="outline" onClick={() => setSimples(n)}><Calculator className="mr-1 h-4 w-4" /> Alíquota do Simples</Button>
                    )}
                    {podeDecidir && (n.status === "A_DECIDIR" || n.status === "ADIADA") && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setEdicao({
                          nota: n, valor: n.valorCentavos / 100, descricao: n.descricao, municipioNome: n.municipioIncidenciaNome ?? "",
                          municipioUf: n.municipioIncidenciaUf ?? "", emissorId: n.emissorId ? String(n.emissorId) : "", tipoServicoId: n.tipoServicoId ? String(n.tipoServicoId) : "",
                        })}>Editar</Button>
                        <Button size="sm" variant="outline" onClick={() => setSemNota({ nota: n, motivo: n.motivoSugerido ?? "", texto: "" })}>Não emitir</Button>
                        <Button size="sm" variant="outline" onClick={() => setDepois({ nota: n, ate: "" })}>Depois</Button>
                      </>
                    )}
                    {podeDecidir && n.status === "SEM_NOTA" && (
                      <Button size="sm" variant="outline" disabled={reabrir.isPending} onClick={() => reabrir.mutate({ id: n.id, versao: n.versao })}>Reabrir</Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {lista.hasNextPage && (
              <Button size="sm" variant="outline" className="w-full" disabled={lista.isFetchingNextPage} onClick={() => void lista.fetchNextPage()}>
                {lista.isFetchingNextPage ? "Carregando..." : "Carregar mais"}
              </Button>
            )}
          </div>
        )}
      </CardContent>

      <Dialog open={Boolean(semNota)} onOpenChange={o => !o && setSemNota(null)}>
        <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white">
          <DialogHeader><DialogTitle className="text-[#C9A961]">Não emitir nota</DialogTitle></DialogHeader>
          {semNota && (
            <div className="space-y-3">
              <p className="text-sm text-gray-300">{semNota.nota.tomador.nome ?? "Sem tomador"} — {dinheiro(semNota.nota.valorCentavos)}</p>
              {semNota.nota.motivoSugerido && <p className="text-xs text-amber-300">Sugestão pela origem: {ROTULO_MOTIVO[semNota.nota.motivoSugerido]} (só vale quando você confirmar).</p>}
              <div>
                <Label>Motivo *</Label>
                <Select value={semNota.motivo} onValueChange={v => setSemNota({ ...semNota, motivo: v as MotivoSemNota })}>
                  <SelectTrigger className="mt-1 bg-[#2C3E50]"><SelectValue placeholder="Escolha o motivo" /></SelectTrigger>
                  <SelectContent>{MOTIVOS_SEM_NOTA.map(m => <SelectItem key={m} value={m}>{ROTULO_MOTIVO[m]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {semNota.motivo === "outro" && (
                <div>
                  <Label htmlFor="fiscal-motivo-texto">Qual o motivo? *</Label>
                  <Textarea id="fiscal-motivo-texto" maxLength={500} value={semNota.texto} onChange={e => setSemNota({ ...semNota, texto: e.target.value })} className="mt-1 bg-[#2C3E50]" />
                </div>
              )}
              {problemaSemNota && <p className="text-xs text-gray-400">{problemaSemNota}</p>}
              <Button className="w-full bg-[#C9A961] text-[#1A2332]" disabled={Boolean(problemaSemNota) || naoEmitir.isPending}
                onClick={() => semNota.motivo && naoEmitir.mutate({ id: semNota.nota.id, versao: semNota.nota.versao, motivo: semNota.motivo, texto: semNota.texto || null })}>
                Confirmar: não emitir
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(emitirConf)} onOpenChange={o => !o && setEmitirConf(null)}>
        <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white">
          <DialogHeader><DialogTitle className="text-[#C9A961]">Emitir NFS-e</DialogTitle></DialogHeader>
          {emitirConf && (
            <div className="space-y-3">
              {emitirConf.emissor?.ambiente === "producao_restrita"
                ? <p role="alert" className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-amber-100">AMBIENTE DE TESTES — SEM VALOR FISCAL</p>
                : <p role="alert" className="rounded border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-100">PRODUÇÃO: a nota sai com valor fiscal pela API Nacional.</p>}
              <p className="text-sm text-gray-300">{emitirConf.tomador.nome ?? "Sem tomador"} — {dinheiro(emitirConf.valorCentavos)} — {emitirConf.emissor?.razaoSocial ?? ""}</p>
              <p className="text-xs text-gray-400">Clicar de novo nunca gera outra nota: o sistema consulta a Sefin antes de reenviar.</p>
              <Button className="w-full bg-[#C9A961] text-[#1A2332]" disabled={emitir.isPending}
                onClick={() => emitir.mutate({ id: emitirConf.id, versao: emitirConf.versao, ambienteEsperado: emitirConf.emissor?.ambiente === "producao" ? "producao" : "producao_restrita" })}>{emitir.isPending ? "Emitindo..." : "Confirmar emissão"}</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(cancelar)} onOpenChange={o => !o && setCancelar(null)}>
        <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white">
          <DialogHeader><DialogTitle className="text-[#C9A961]">Cancelar NFS-e</DialogTitle></DialogHeader>
          {cancelar && (
            <div className="space-y-3">
              <p className="text-sm text-gray-300">NFS-e nº {cancelar.nota.numeroNfse} — {cancelar.nota.tomador.nome ?? "Sem tomador"} — {dinheiro(cancelar.nota.valorCentavos)}</p>
              <p className="text-xs text-gray-400">Prazo definido pela prefeitura (até 2 anos). O cancelamento não se desfaz.</p>
              <div>
                <Label>Motivo *</Label>
                <Select value={cancelar.motivo ? String(cancelar.motivo) : ""} onValueChange={v => setCancelar({ ...cancelar, motivo: Number(v) as 1 | 2 | 9 })}>
                  <SelectTrigger className="mt-1 bg-[#2C3E50]"><SelectValue placeholder="Escolha o motivo" /></SelectTrigger>
                  <SelectContent>{MOTIVOS_CANCELAMENTO.map(([v, r]) => <SelectItem key={v} value={String(v)}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="fiscal-cancelar-just">Justificativa * (15 a 255 caracteres)</Label>
                <Textarea id="fiscal-cancelar-just" maxLength={255} value={cancelar.justificativa} onChange={e => setCancelar({ ...cancelar, justificativa: e.target.value })} className="mt-1 bg-[#2C3E50]" />
                <p className="mt-1 text-xs text-gray-400">{justificativaLen}/255</p>
              </div>
              <Button className="w-full bg-red-700 text-white" disabled={!cancelar.motivo || justificativaLen < 15 || cancelarM.isPending}
                onClick={() => cancelar.motivo && cancelarM.mutate({ id: cancelar.nota.id, versao: cancelar.nota.versao, motivo: cancelar.motivo, justificativa: cancelar.justificativa.trim() })}>
                Confirmar cancelamento
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(depois)} onOpenChange={o => !o && setDepois(null)}>
        <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white">
          <DialogHeader><DialogTitle className="text-[#C9A961]">Decidir depois</DialogTitle></DialogHeader>
          {depois && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="fiscal-depois">Lembrar a partir de (opcional)</Label>
                <Input id="fiscal-depois" type="date" value={depois.ate} onChange={e => setDepois({ ...depois, ate: e.target.value })} className="mt-1 bg-[#2C3E50]" />
              </div>
              <Button className="w-full bg-[#C9A961] text-[#1A2332]" disabled={adiar.isPending}
                onClick={() => adiar.mutate({ id: depois.nota.id, versao: depois.nota.versao, ate: depois.ate || null })}>Deixar para depois</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(edicao)} onOpenChange={o => !o && setEdicao(null)}>
        <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white sm:max-w-2xl">
          <DialogHeader><DialogTitle className="text-[#C9A961]">Editar rascunho</DialogTitle></DialogHeader>
          {edicao && (
            <div className="grid gap-3 sm:grid-cols-2">
              <p className="sm:col-span-2 text-xs text-gray-400">
                Tomador: {edicao.nota.tomador.nome ?? "sem cadastro ligado"}. CNPJ, CPF e endereço do tomador se corrigem no cadastro
                dele — a nota lê de lá.{" "}
                {edicao.nota.bpoClientId ? <a href="/admin/bpo?aba=clientes" className="text-[#C9A961] underline">Abrir cadastro do tomador</a>
                  : edicao.nota.leadId ? <Link href={`/admin/crm/${edicao.nota.leadId}`} className="text-[#C9A961] underline">Abrir cadastro do tomador</Link> : null}
              </p>
              <div>
                <Label>Valor do serviço</Label>
                <CurrencyInput value={edicao.valor} onChange={v => setEdicao({ ...edicao, valor: v })} className="mt-1 bg-[#2C3E50]" />
                <p className="mt-1 text-xs text-gray-400">Valor da origem: {dinheiro(edicao.nota.valorSugeridoCentavos)}</p>
              </div>
              <div>
                <Label>Empresa emissora</Label>
                <Select value={edicao.emissorId || "nenhum"} onValueChange={v => setEdicao({ ...edicao, emissorId: v === "nenhum" ? "" : v })}>
                  <SelectTrigger className="mt-1 bg-[#2C3E50]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nenhum">A escolher</SelectItem>
                    {emissores.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.razaoSocial ?? e.cnpj}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Tipo de serviço</Label>
                <Select value={edicao.tipoServicoId || "nenhum"} onValueChange={v => setEdicao({ ...edicao, tipoServicoId: v === "nenhum" ? "" : v })}>
                  <SelectTrigger className="mt-1 bg-[#2C3E50]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nenhum">A classificar</SelectItem>
                    {tipos.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-[1fr_5rem] gap-2">
                <div>
                  <Label htmlFor="fiscal-ed-mun">Município de incidência</Label>
                  <Input id="fiscal-ed-mun" value={edicao.municipioNome} placeholder={edicao.nota.municipio.nome ?? ""} onChange={e => setEdicao({ ...edicao, municipioNome: e.target.value })} className="mt-1 bg-[#2C3E50]" />
                </div>
                <div>
                  <Label htmlFor="fiscal-ed-uf">UF</Label>
                  <Input id="fiscal-ed-uf" maxLength={2} value={edicao.municipioUf} placeholder={edicao.nota.municipio.uf ?? ""} onChange={e => setEdicao({ ...edicao, municipioUf: e.target.value.toUpperCase() })} className="mt-1 bg-[#2C3E50]" />
                </div>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="fiscal-ed-desc">Descrição do serviço</Label>
                <Textarea id="fiscal-ed-desc" maxLength={2000} value={edicao.descricao} onChange={e => setEdicao({ ...edicao, descricao: e.target.value })} className="mt-1 bg-[#2C3E50]" />
              </div>
              <Button className="sm:col-span-2 bg-[#C9A961] text-[#1A2332]" disabled={editar.isPending || edicao.valor <= 0}
                onClick={() => {
                  const n = edicao.nota;
                  const valorCentavos = Math.round(edicao.valor * 100);
                  editar.mutate({
                    id: n.id, versao: n.versao,
                    valorCentavos: valorCentavos === n.valorSugeridoCentavos ? null : valorCentavos,
                    descricao: edicao.descricao.trim() === n.descricaoSugerida.trim() ? null : edicao.descricao,
                    municipioNome: edicao.municipioNome.trim() || null,
                    municipioUf: edicao.municipioUf.trim() || null,
                    emissorId: edicao.emissorId ? Number(edicao.emissorId) : null,
                    tipoServicoId: edicao.tipoServicoId ? Number(edicao.tipoServicoId) : null,
                  });
                }}>Salvar ajustes</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(simples)} onOpenChange={o => !o && setSimples(null)}>
        <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white sm:max-w-2xl">
          <DialogHeader><DialogTitle className="text-[#C9A961]">Alíquota do Simples — {simples?.emissor?.razaoSocial ?? "empresa"}</DialogTitle></DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto">{simples && <AliquotaSimples notaId={simples.id} />}</div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(historico)} onOpenChange={o => !o && setHistorico(null)}>
        <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white sm:max-w-2xl">
          <DialogHeader><DialogTitle className="text-[#C9A961]">Histórico do rascunho</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto text-sm">
            {(hist.data ?? []).map(h => (
              <div key={h.id} className="rounded bg-[#2C3E50] p-2">
                <p className="text-white">{new Date(h.quando).toLocaleString("pt-BR")} — {h.acao.replace("_", " ")} — {h.usuarioNome ?? (h.via === "sistema" ? "sistema" : "usuário")} ({h.via})</p>
                {h.mudancas.map(m => (
                  <p key={m.campo} className="text-xs text-gray-300">{m.campo.replace(/_/g, " ")}: {String(m.antes ?? "—")} → {String(m.depois ?? "—")}</p>
                ))}
              </div>
            ))}
            {hist.isLoading && <p className="text-gray-400">Carregando...</p>}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
