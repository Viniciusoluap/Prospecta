// EPIC-025 (Dolores, etapa 4): grupos de clientes — só admin. O administrador cadastra o grupo de WhatsApp em que o número da
// Dolores está (escolhendo da lista da Evolution ou digitando o id "…@g.us") e o liga a um cliente do CRM, a uma obra ou a
// nenhum ainda. Só grupos cadastrados e ATIVOS são lidos. Nada é excluído: desativa-se.
// Também mostra a configuração da classificação (desligada por padrão) e os documentos que esperam classificação.
// Etapa 4b: "Responder no grupo quando marcada" — interruptor geral e por grupo (os dois desligados por padrão), tetos e a lista
// das marcações com a resposta dada. Sem marcação real, ela nunca fala no grupo.
// Etapa 7 (regra do dono de 19/11/2026): os grupos ENTRAM SOZINHOS, com o tipo descoberto pelo nome. Esta tela passa a servir para
// VER os grupos em que ela está, CORRIGIR o tipo/vínculo, desativar e "Atualizar grupos"; o cadastro manual fica recolhido.
import { useState } from "react";
import { toast } from "sonner";
import { Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { jidDeGrupoParaExibir } from "@shared/dolores/grupos";
import { ROTULO_SITUACAO_CONFIRMACAO, ROTULO_TIPO_GRUPO, type SituacaoConfirmacao, type TipoGrupo } from "@shared/dolores/grupos-tipo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const botaoSec = "border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10";
const campo = "mt-1 bg-[#1A2332] border-[#C9A961]/30 text-white";
const quando = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleString("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short", timeStyle: "short" }) : "—");
const numero = (s: string) => (s.trim() ? Number(s.replace(/\D/g, "")) || null : null);

const ROTULO_SITUACAO: Record<string, string> = {
  a_classificar: "a classificar", classificando: "classificando", erro: "não consegui classificar (tenta de novo)", confira: "classificado — confira",
  classificado: "classificado",
};

export function DoloresGruposCard() {
  const utils = trpc.useUtils();
  const dados = trpc.dolores.grupos.listar.useQuery(undefined, { retry: false });
  const [verWhatsapp, setVerWhatsapp] = useState(false);
  const doWhatsapp = trpc.dolores.grupos.gruposDoWhatsapp.useQuery(undefined, { enabled: verWhatsapp, retry: false });
  const [novo, setNovo] = useState({ grupoJid: "", nome: "", leadId: "", obraId: "" });
  const [tetos, setTetos] = useState<Record<string, string>>({});
  const recarregar = () => utils.dolores.grupos.listar.invalidate();
  const erro = (e: { message: string }) => toast.error(e.message);
  const cadastrar = trpc.dolores.grupos.cadastrar.useMutation({
    onSuccess: async () => { toast.success("Grupo cadastrado. A Dolores passa a ler o que chega nele (sem responder)."); setNovo({ grupoJid: "", nome: "", leadId: "", obraId: "" }); await recarregar(); await utils.dolores.grupos.gruposDoWhatsapp.invalidate(); },
    onError: erro,
  });
  const atualizar = trpc.dolores.grupos.atualizar.useMutation({ onSuccess: async () => { toast.success("Grupo atualizado."); await recarregar(); }, onError: erro });
  const atualizarGrupos = trpc.dolores.grupos.atualizarGrupos.useMutation({
    onSuccess: async r => {
      toast.message(r.entradaDesligada ? "A entrada automática está desligada: nenhum grupo novo entrou."
        : `${r.novos} grupo(s) novo(s), ${r.jaNaLista} já na lista${r.foraPeloTeto ? `, ${r.foraPeloTeto} fora pelo teto do dia` : ""}${r.erros ? `, ${r.erros} com falha` : ""}.`);
      await recarregar();
    },
    onError: erro,
  });
  const salvarConfig = trpc.dolores.grupos.salvarConfig.useMutation({ onSuccess: async () => { toast.success("Configuração salva."); setTetos({}); await recarregar(); }, onError: erro });
  const classificar = trpc.dolores.grupos.classificarPendentes.useMutation({
    onSuccess: async r => { const t = Object.entries(r.contagem).map(([k, v]) => `${k}: ${v}`).join(", "); toast.message(t ? `Classificação: ${t}` : "Nenhum documento a classificar."); await recarregar(); },
    onError: erro,
  });
  const cfg = dados.data?.config;

  const salvarTetos = () => {
    const n = (k: string) => (tetos[k] !== undefined && tetos[k] !== "" ? Number(tetos[k]) : undefined);
    salvarConfig.mutate({
      tetoClassificacoesDia: n("dia"), tetoClassificacoesGrupoDia: n("grupo"), maxMensagensGrupoDia: n("mensagens"), tamanhoMaximoMb: n("mb"), retencaoDias: n("retencao"),
      orcamentoClassificacaoPct: n("orcamento"),
    });
  };

  return (
    <Card className="border-[#C9A961]/20 bg-[#2C3E50] text-gray-100">
      <CardHeader><CardTitle className="flex items-center gap-2 text-[#C9A961]"><Users className="h-5 w-5" /> Dolores — grupos</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-300">
          Não é preciso cadastrar grupo: quando o número da Dolores é colocado num grupo, ele entra sozinho nesta lista na primeira
          mensagem (ou ao clicar em "Atualizar grupos"). O tipo é descoberto pelo NOME do grupo: com Jurídico, Administrativo,
          Parceiros ou Engenharia no nome, é um grupo interno daquele tipo; com o nome de um único cliente do CRM, é grupo de cliente
          (ou de pós-atendimento, se tiver "pós" no nome). Ela avisa você no WhatsApp o que entendeu; se não reconhecer o nome, pergunta
          e só observa até você responder. Mudar o nome do grupo depois não muda o tipo. Ela só responde num grupo quando alguém a
          MARCA nele, com o "responder quando marcada" ligado (abaixo); nada escrito no grupo é comando.
        </p>
        {dados.isLoading ? <p className="text-sm text-gray-300">Carregando…</p> : dados.error ? <p role="alert" className="text-sm text-red-300">{dados.error.message}</p> : <>
          {/* Etapa 7: grupos em que ela está */}
          <GruposSecao grupos={dados.data?.grupos ?? []} cfg={cfg} atualizando={atualizarGrupos.isPending} onAtualizar={() => atualizarGrupos.mutate()}
            onAtivo={(id, ativo) => atualizar.mutate({ id, ativo })} ocupado={atualizar.isPending}
            onConfig={c => salvarConfig.mutate(c)} salvando={salvarConfig.isPending} />

          {/* Cadastro manual (raro: os grupos entram sozinhos) */}
          <details className="rounded-lg border border-[#C9A961]/20 bg-[#1A2332] p-3">
            <summary className="cursor-pointer text-sm font-semibold text-[#C9A961]">Cadastrar um grupo à mão (raro)</summary>
            <div className="mt-2 space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <div><Label htmlFor="grupo-jid" className="text-xs text-gray-300">Id do grupo (termina em @g.us)</Label>
                <Input id="grupo-jid" value={novo.grupoJid} onChange={e => setNovo({ ...novo, grupoJid: e.target.value.trim() })} className={campo} placeholder="120363000000000000@g.us" /></div>
              <div><Label htmlFor="grupo-nome" className="text-xs text-gray-300">Rótulo (como a equipe chama o grupo)</Label>
                <Input id="grupo-nome" value={novo.nome} maxLength={120} onChange={e => setNovo({ ...novo, nome: e.target.value })} className={campo} placeholder="Documentação — Maria Souza" /></div>
              <div><Label htmlFor="grupo-lead" className="text-xs text-gray-300">Nº do cliente no CRM (opcional)</Label>
                <Input id="grupo-lead" inputMode="numeric" value={novo.leadId} onChange={e => setNovo({ ...novo, leadId: e.target.value.replace(/\D/g, ""), obraId: "" })} className={campo} placeholder="sem card ainda" /></div>
              <div><Label htmlFor="grupo-obra" className="text-xs text-gray-300">ou Nº da obra (opcional)</Label>
                <Input id="grupo-obra" inputMode="numeric" value={novo.obraId} onChange={e => setNovo({ ...novo, obraId: e.target.value.replace(/\D/g, ""), leadId: "" })} className={campo} /></div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={cadastrar.isPending || !novo.grupoJid || novo.nome.trim().length < 2} className="bg-[#C9A961] font-bold text-[#1A2332] hover:bg-[#B8985A]"
                onClick={() => cadastrar.mutate({ grupoJid: novo.grupoJid, nome: novo.nome, leadId: numero(novo.leadId), obraId: numero(novo.obraId) })}>Cadastrar</Button>
              <Button size="sm" variant="outline" className={botaoSec} onClick={() => { setVerWhatsapp(true); void doWhatsapp.refetch(); }}>Ver os grupos em que a Dolores está</Button>
            </div>
            {verWhatsapp && (doWhatsapp.isFetching ? <p className="text-xs text-gray-300">Consultando a Evolution…</p>
              : doWhatsapp.error ? <p role="alert" className="text-xs text-red-300">{doWhatsapp.error.message}</p>
              : !doWhatsapp.data?.length ? <p className="text-xs text-gray-300">A Dolores não está em nenhum grupo.</p> : (
                <ul className="max-h-56 space-y-1 overflow-y-auto text-xs">
                  {doWhatsapp.data.map(g => (
                    <li key={g.grupoJid} className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 p-2">
                      <span className="min-w-0 break-all"><span className="text-gray-100">{g.nomeNoWhatsapp ?? "(sem nome)"}</span> <code className="text-gray-400">{jidDeGrupoParaExibir(g.grupoJid)}</code>{g.participantes != null ? ` · ${g.participantes} pessoas` : ""}</span>
                      {g.cadastrado ? <span className="text-green-300">já cadastrado</span>
                        : <Button size="sm" variant="outline" className={botaoSec} onClick={() => setNovo({ ...novo, grupoJid: g.grupoJid })}>Usar este id</Button>}
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </details>

          {/* Classificação */}
          {cfg && (
            <section className="space-y-2 rounded-lg border border-[#C9A961]/20 bg-[#1A2332] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[#C9A961]">Classificação dos documentos pela IA</h3>
                <label className="flex items-center gap-2 text-xs text-gray-300">
                  <Switch checked={cfg.classificacaoLigada} disabled={salvarConfig.isPending} onCheckedChange={v => salvarConfig.mutate({ classificacaoLigada: v })} aria-label="Classificação ligada" />
                  {cfg.classificacaoLigada ? "ligada" : "desligada"}
                </label>
              </div>
              {dados.data?.desligamentoPorFalha && (
                <p role="alert" className="rounded border border-red-400/40 bg-red-500/10 p-2 text-xs text-red-200">
                  A Dolores desligou a classificação sozinha{dados.data.desligamentoPorFalha.em ? ` em ${quando(dados.data.desligamentoPorFalha.em)}` : ""}
                  {dados.data.desligamentoPorFalha.soNestaInstancia ? " (só neste servidor: nem o desligamento pôde ser gravado no banco)" : ""}: {dados.data.desligamentoPorFalha.motivo}.
                  Sem esse registro o orçamento da classificação ficaria sem a conta. Confira o banco e religue quando estiver normal.
                </p>
              )}
              <p className="text-xs text-gray-300">
                Só documentos e fotos são classificados (texto nunca chama a IA), um por vez, com o modelo da função "Dolores — classificação de
                documentos" (Integrações › Anthropic). Também precisa do interruptor da IA da Dolores ligado e de limite mensal: a classificação
                tem orçamento próprio (uma parte do limite mensal, 20% se você não mudar) e nunca passa de 80% do limite somando tudo, para
                sobrar para os comandos do dono. Uma classificação por vez; antes de mandar o arquivo, a Dolores pede à Anthropic a contagem
                de tokens e, se passar da reserva, classifica só pelo nome e pela legenda (com "confira"). Desligada, o documento fica
                "a classificar".
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {([["dia", "Classificações por dia", cfg.tetoClassificacoesDia], ["grupo", "Por grupo por dia", cfg.tetoClassificacoesGrupoDia],
                  ["mensagens", "Mensagens por grupo/dia", cfg.maxMensagensGrupoDia], ["mb", "Tamanho máximo (MB)", Math.round(cfg.tamanhoMaximoBytes / 1_048_576)],
                  ["retencao", "Pendente vale (dias)", cfg.retencaoDias], ["orcamento", "Orçamento da classificação (% do limite, 1 a 50)", cfg.orcamentoClassificacaoPct]] as const).map(([k, rot, atual]) => (
                  <div key={k}><Label htmlFor={`grupos-${k}`} className="text-xs text-gray-300">{rot} (hoje {atual})</Label>
                    <Input id={`grupos-${k}`} inputMode="numeric" value={tetos[k] ?? ""} onChange={e => setTetos({ ...tetos, [k]: e.target.value.replace(/\D/g, "") })} className={campo} /></div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className={botaoSec} disabled={salvarConfig.isPending || !Object.values(tetos).some(Boolean)} onClick={salvarTetos}>Salvar tetos</Button>
                <Button size="sm" variant="outline" className={botaoSec} disabled={classificar.isPending || !cfg.classificacaoLigada} onClick={() => classificar.mutate({ maximo: 3 })}>
                  {classificar.isPending ? "Classificando…" : "Classificar pendentes agora (até 3)"}</Button>
              </div>
            </section>
          )}

          <MarcacoesSecao grupos={dados.data?.grupos ?? []} />

          {/* Pendências */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-[#C9A961]">Documentos esperando classificação ou conferência</h3>
            {!dados.data?.pendencias.length ? <p className="text-sm text-gray-300">Nenhum documento pendente.</p> : (
              <ul className="space-y-1 text-xs">
                {dados.data.pendencias.map(p => (
                  <li key={p.id} className="rounded border border-white/10 bg-[#1A2332] p-2">
                    <span className="break-all text-gray-100">{p.nome ?? "(sem nome)"}</span> <span className="text-gray-400">· documento {p.id} · {p.grupo} · {quando(p.criadoEm)}</span>
                    <span className={p.situacao === "confira" ? " text-yellow-200" : p.situacao === "erro" ? " text-red-300" : " text-gray-300"}> · {ROTULO_SITUACAO[p.situacao] ?? p.situacao}</span>
                    {p.classificacao ? <span className="text-gray-300"> · {p.classificacao}{p.confianca != null ? ` (${Math.round(p.confianca * 100)}%)` : ""}</span> : null}
                    {p.motivo ? <p className="mt-1 text-gray-400">{p.motivo}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>}
      </CardContent>
    </Card>
  );
}

const ROTULO_MARCACAO: Record<string, string> = {
  processando: "respondendo…", respondida: "respondida", fora_de_escopo: "fora de escopo (frase fixa)", silencio: "sem resposta", erro: "não respondida (falha)",
};

/** Etapa 4b — responder no grupo quando marcada (consulta própria: sem a migração 0129, só esta seção mostra o aviso). */
function MarcacoesSecao({ grupos }: { grupos: Array<{ id: number; nome: string; ativo: boolean }> }) {
  const utils = trpc.useUtils();
  const dados = trpc.dolores.grupos.marcacoes.useQuery(undefined, { retry: false });
  const [tetos, setTetos] = useState<Record<string, string>>({});
  const recarregar = () => utils.dolores.grupos.marcacoes.invalidate();
  const erro = (e: { message: string }) => toast.error(e.message);
  const salvar = trpc.dolores.grupos.salvarMarcacoes.useMutation({ onSuccess: async () => { toast.success("Configuração salva."); setTetos({}); await recarregar(); }, onError: erro });
  const ligar = trpc.dolores.grupos.ligarMarcacaoGrupo.useMutation({
    onSuccess: async r => { toast.success(r.lid ? `Grupo atualizado. ${r.lid.motivo}.` : "Grupo atualizado."); await recarregar(); }, onError: erro,
  });
  const conferir = trpc.dolores.grupos.conferirLidDolores.useMutation({ onSuccess: async r => { toast.message(r.motivo); await recarregar(); }, onError: erro });
  if (dados.isLoading) return <p className="text-sm text-gray-300">Carregando a resposta quando marcada…</p>;
  if (dados.error) return <p role="alert" className="text-sm text-red-300">{dados.error.message}</p>;
  const d = dados.data!;
  const ligado = new Map(d.grupos.map(g => [g.grupoId, g.ligado]));
  const n = (k: string) => (tetos[k] !== undefined && tetos[k] !== "" ? Number(tetos[k]) : undefined);
  return (
    <section className="space-y-2 rounded-lg border border-[#C9A961]/40 bg-[#1A2332] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[#C9A961]">Responder no grupo quando marcada</h3>
        <label className="flex items-center gap-2 text-xs text-gray-300">
          <Switch checked={d.config.responderLigado} disabled={salvar.isPending} onCheckedChange={v => salvar.mutate({ responderLigado: v })} aria-label="Responder quando marcada (geral)" />
          {d.config.responderLigado ? "ligado" : "desligado"}
        </label>
      </div>
      {d.desligamentoPorFalha && (
        <p role="alert" className="rounded border border-red-400/40 bg-red-500/10 p-2 text-xs text-red-200">
          A Dolores desligou a resposta quando marcada sozinha{d.desligamentoPorFalha.em ? ` em ${quando(d.desligamentoPorFalha.em)}` : ""}
          {d.desligamentoPorFalha.soNestaInstancia ? " (só neste servidor: nem o desligamento pôde ser gravado no banco)" : ""}: {d.desligamentoPorFalha.motivo}.
          Sem esse registro o limite mensal ficaria sem a conta. Confira o banco e religue quando estiver normal.
        </p>
      )}
      <p role="note" className="rounded border border-yellow-300/40 bg-yellow-300/10 p-2 text-xs text-yellow-100">
        Atenção: o que ela escreve no grupo é lido por todos os participantes.
      </p>
      <p className="text-xs text-gray-300">
        Ela só responde quando alguém marca o número dela no grupo (a marcação de verdade do WhatsApp; escrever o nome não conta), com
        este interruptor e o do grupo ligados (o do grupo já vem ligado nos grupos que ela reconheceu). O que ela pode responder depende
        do tipo do grupo: cliente/pós-atendimento — só aquele cliente (andamento, etapas e documentos que faltam); administrativo — a
        operação toda, sem senhas, chaves nem dados bancários e com CPF/telefone mascarados; jurídico — processos, regularizações e
        documentos; engenharia — obras, medições e notas; parceiros — só o andamento dos clientes de quem a marcou. Em grupo que ela não
        reconheceu, fica calada. Nunca faz nada a partir do grupo — nesses casos responde "Isso a equipe responde por aqui." (ninguém
        é avisado: a pergunta aparece na lista abaixo). Usa o modelo da função
        "Dolores — resposta em grupo quando marcada" (Integrações › Anthropic), o interruptor da IA e o limite mensal da Dolores.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {([["grupo", "Respostas por grupo/dia", d.config.tetoGrupoDia], ["remetente", "Por pessoa/hora", d.config.tetoRemetenteHora],
          ["janela", "Responde até (segundos)", d.config.janelaFrescorSegundos]] as const).map(([k, rot, atual]) => (
          <div key={k}><Label htmlFor={`marcacoes-${k}`} className="text-xs text-gray-300">{rot} (hoje {atual})</Label>
            <Input id={`marcacoes-${k}`} inputMode="numeric" value={tetos[k] ?? ""} onChange={e => setTetos({ ...tetos, [k]: e.target.value.replace(/\D/g, "") })} className={campo} /></div>
        ))}
      </div>
      <Button size="sm" variant="outline" className={botaoSec} disabled={salvar.isPending || !Object.values(tetos).some(Boolean)}
        onClick={() => salvar.mutate({ tetoGrupoDia: n("grupo"), tetoRemetenteHora: n("remetente"), janelaFrescorSegundos: n("janela") })}>Salvar tetos</Button>
      <p className="text-xs text-gray-400">
        Marcação por @lid (grupos novos do WhatsApp): {d.config.lid ? `conferida (final ${d.config.lid.final}, ${quando(d.config.lid.conferidoEm)})` : "ainda não conferida — ligue um grupo ou use o botão do grupo"}.
      </p>
      {!grupos.length ? <p className="text-xs text-gray-300">Nenhum grupo ainda: eles aparecem aqui sozinhos quando a Dolores entra.</p> : (
        <ul className="space-y-1 text-xs">
          {grupos.map(g => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 p-2">
              <span className="min-w-0 break-words">{g.nome} <span className="text-gray-400">(grupo {g.id}{g.ativo ? "" : ", desativado"})</span></span>
              <span className="flex items-center gap-2">
                <Button size="sm" variant="outline" className={botaoSec} disabled={conferir.isPending || !g.ativo} onClick={() => conferir.mutate({ grupoId: g.id })}>Conferir @lid</Button>
                <label className="flex items-center gap-2 text-gray-300">
                  <Switch checked={ligado.get(g.id) === true} disabled={ligar.isPending || (!g.ativo && ligado.get(g.id) !== true)}
                    onCheckedChange={v => ligar.mutate({ grupoId: g.id, ligado: v })} aria-label={`Responder quando marcada no grupo ${g.nome}`} />
                  {ligado.get(g.id) ? "responde quando marcada" : "não responde"}
                </label>
              </span>
            </li>
          ))}
        </ul>
      )}
      <h4 className="pt-1 text-xs font-semibold text-[#C9A961]">Últimas marcações</h4>
      {!d.marcacoes.length ? <p className="text-xs text-gray-300">Ninguém marcou a Dolores ainda.</p> : (
        <ul className="max-h-80 space-y-1 overflow-y-auto text-xs">
          {d.marcacoes.map(m => (
            <li key={m.id} className="rounded border border-white/10 p-2">
              <p><span className="text-gray-400">{quando(m.criadoEm)} · {m.grupo} · {m.remetente ?? "participante"}</span>
                <span className={m.foraDeEscopo ? " text-yellow-200" : m.situacao === "erro" ? " text-red-300" : " text-gray-300"}> · {ROTULO_MARCACAO[m.situacao] ?? m.situacao}</span></p>
              <p className="mt-1 break-words text-gray-100">Pergunta: {m.pergunta ?? "(sem texto)"}</p>
              {m.resposta ? <p className="mt-1 break-words text-gray-300">Ela respondeu: {m.resposta}</p> : null}
              {m.motivo ? <p className="mt-1 text-gray-400">{m.motivo}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type GrupoDaTela = {
  id: number; nome: string; ativo: boolean; leadId: number | null; obraId: number | null; cliente: string | null; obra: string | null;
  tipo: TipoGrupo; origem: string; situacaoConfirmacao: SituacaoConfirmacao; nomeWhatsapp: string | null; codigo: string | null;
  criadoEm: string | Date; mensagens: number;
  documentos: { aClassificar: number; classificados: number; confira: number; salvos: number; naoBaixados: number };
};
type ConfigEntrada = { entradaAutomaticaLigada: boolean; tetoGruposNovosDia: number; tetoAvisosGruposDia: number } | undefined;

const TIPOS_DA_TELA = ["cliente", "pos_atendimento", "juridico", "administrativo", "parceiros", "engenharia"] as const;

/** Etapa 7 — a lista dos grupos em que ela está, com tipo, vínculo e situação, e a correção (só admin, decisão gravada). */
function GruposSecao(p: {
  grupos: GrupoDaTela[]; cfg: ConfigEntrada; atualizando: boolean; onAtualizar: () => void; onAtivo: (id: number, ativo: boolean) => void; ocupado: boolean;
  onConfig: (c: { entradaAutomaticaLigada?: boolean; tetoGruposNovosDia?: number; tetoAvisosGruposDia?: number }) => void; salvando: boolean;
}) {
  const utils = trpc.useUtils();
  const [editando, setEditando] = useState<{ id: number; tipo: string; numero: string } | null>(null);
  const [tetos, setTetos] = useState<Record<string, string>>({});
  const definir = trpc.dolores.grupos.definirTipo.useMutation({
    onSuccess: async r => { toast.success(r.texto); setEditando(null); await utils.dolores.grupos.listar.invalidate(); },
    onError: (e: { message: string }) => toast.error(e.message),
  });
  const aguardando = p.grupos.filter(g => g.ativo && g.situacaoConfirmacao === "aguardando_dono").length;
  const precisaNumero = (t: string) => t === "cliente" || t === "pos_atendimento";
  const n = (k: string) => (tetos[k] !== undefined && tetos[k] !== "" ? Number(tetos[k]) : undefined);
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[#C9A961]">Grupos em que a Dolores está</h3>
        <Button size="sm" variant="outline" className={botaoSec} disabled={p.atualizando} onClick={p.onAtualizar}>{p.atualizando ? "Atualizando…" : "Atualizar grupos"}</Button>
      </div>
      {p.cfg && (
        <div className="space-y-2 rounded-lg border border-[#C9A961]/20 bg-[#1A2332] p-3 text-xs text-gray-300">
          <label className="flex items-center gap-2">
            <Switch checked={p.cfg.entradaAutomaticaLigada} disabled={p.salvando} onCheckedChange={v => p.onConfig({ entradaAutomaticaLigada: v })} aria-label="Entrada automática de grupos" />
            Entrada automática de grupos: {p.cfg.entradaAutomaticaLigada ? "ligada" : "desligada (grupo novo é ignorado)"}
          </label>
          <p>Por segurança, no máximo {p.cfg.tetoGruposNovosDia} grupos novos e {p.cfg.tetoAvisosGruposDia} avisos a você por dia; passou disso, os grupos novos do dia ficam de fora e você recebe um aviso.</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {([["novos", "Grupos novos por dia (0 a 200)", p.cfg.tetoGruposNovosDia], ["avisos", "Avisos de grupo novo por dia (0 a 200)", p.cfg.tetoAvisosGruposDia]] as const).map(([k, rot, atual]) => (
              <div key={k}><Label htmlFor={`entrada-${k}`} className="text-xs text-gray-300">{rot} (hoje {atual})</Label>
                <Input id={`entrada-${k}`} inputMode="numeric" value={tetos[k] ?? ""} onChange={e => setTetos({ ...tetos, [k]: e.target.value.replace(/\D/g, "") })} className={campo} /></div>
            ))}
            <div className="flex items-end"><Button size="sm" variant="outline" className={botaoSec} disabled={p.salvando || !Object.values(tetos).some(Boolean)}
              onClick={() => { p.onConfig({ tetoGruposNovosDia: n("novos"), tetoAvisosGruposDia: n("avisos") }); setTetos({}); }}>Salvar tetos</Button></div>
          </div>
        </div>
      )}
      {aguardando > 0 && (
        <p role="status" className="rounded border border-yellow-300/40 bg-yellow-300/10 p-2 text-xs text-yellow-100">
          {aguardando} grupo(s) esperando você dizer de que tipo são. Enquanto isso, ela só observa (não fala nem quando é marcada).
        </p>
      )}
      {!p.grupos.length ? <p className="text-sm text-gray-300">Nenhum grupo ainda. Coloque o número da Dolores no grupo pelo celular e clique em "Atualizar grupos".</p> : (
        <ul className="space-y-2">
          {p.grupos.map(g => (
            <li key={g.id} className="rounded-lg border border-[#C9A961]/20 bg-[#1A2332] p-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 break-words"><strong>{g.nomeWhatsapp ?? g.nome}</strong>{" "}
                  <span className="text-xs text-gray-400">(código {g.codigo ?? "—"} · {g.origem === "automatico" ? "entrou sozinho" : "cadastrado à mão"})</span></p>
                <label className="flex items-center gap-2 text-xs text-gray-300">
                  <Switch checked={g.ativo} disabled={p.ocupado} onCheckedChange={v => p.onAtivo(g.id, v)} aria-label={`Grupo ${g.nome} ativo`} />
                  {g.ativo ? "lendo" : "desativado"}
                </label>
              </div>
              <p className="mt-1 text-xs text-gray-200">
                Tipo: <strong>{ROTULO_TIPO_GRUPO[g.tipo] ?? g.tipo}</strong>
                {g.leadId ? ` · cliente nº ${g.leadId}${g.cliente ? ` — ${g.cliente}` : ""}` : g.obraId ? ` · obra nº ${g.obraId}${g.obra ? ` — ${g.obra}` : ""}` : ""}
                {" · "}<span className={g.situacaoConfirmacao === "aguardando_dono" ? "text-yellow-200" : "text-gray-300"}>{ROTULO_SITUACAO_CONFIRMACAO[g.situacaoConfirmacao] ?? g.situacaoConfirmacao}</span>
              </p>
              <p className="mt-1 text-xs text-gray-400">
                {g.mensagens} mensagens · a classificar {g.documentos.aClassificar} · classificados {g.documentos.classificados} · a conferir {g.documentos.confira} · salvos no card {g.documentos.salvos}
                {g.documentos.naoBaixados ? ` · não baixados ${g.documentos.naoBaixados}` : ""} · desde {quando(g.criadoEm)}
              </p>
              {editando?.id === g.id ? (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div><Label htmlFor={`tipo-${g.id}`} className="text-xs text-gray-300">Tipo</Label>
                    <select id={`tipo-${g.id}`} value={editando.tipo} onChange={e => setEditando({ ...editando, tipo: e.target.value })}
                      className="mt-1 block rounded border border-[#C9A961]/30 bg-[#1A2332] p-1 text-xs text-white">
                      {TIPOS_DA_TELA.map(t => <option key={t} value={t}>{ROTULO_TIPO_GRUPO[t]}</option>)}
                    </select></div>
                  {(precisaNumero(editando.tipo) || editando.tipo === "engenharia") && (
                    <div><Label htmlFor={`numero-${g.id}`} className="text-xs text-gray-300">{precisaNumero(editando.tipo) ? "Nº do cliente no CRM" : "Nº da obra (opcional)"}</Label>
                      <Input id={`numero-${g.id}`} inputMode="numeric" value={editando.numero} onChange={e => setEditando({ ...editando, numero: e.target.value.replace(/\D/g, "") })} className={campo} /></div>
                  )}
                  <Button size="sm" className="bg-[#C9A961] font-bold text-[#1A2332] hover:bg-[#B8985A]" disabled={definir.isPending || (precisaNumero(editando.tipo) && !editando.numero)}
                    onClick={() => definir.mutate({ grupoId: g.id, tipo: editando.tipo as (typeof TIPOS_DA_TELA)[number], numero: editando.numero ? Number(editando.numero) : null })}>Salvar</Button>
                  <Button size="sm" variant="outline" className={botaoSec} onClick={() => setEditando(null)}>Cancelar</Button>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className={botaoSec} onClick={() => setEditando({ id: g.id, tipo: g.tipo === "indefinido" ? "cliente" : g.tipo, numero: String(g.leadId ?? g.obraId ?? "") })}>Corrigir tipo ou vínculo</Button>
                  {g.ativo && <Button size="sm" variant="outline" className={botaoSec} disabled={definir.isPending} onClick={() => definir.mutate({ grupoId: g.id, tipo: "ignorar" })}>Ignorar este grupo</Button>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
