// EPIC-025 (Dolores, etapa 4): grupos de clientes — só admin. O administrador cadastra o grupo de WhatsApp em que o número da
// Dolores está (escolhendo da lista da Evolution ou digitando o id "…@g.us") e o liga a um cliente do CRM, a uma obra ou a
// nenhum ainda. Só grupos cadastrados e ATIVOS são lidos; a Dolores nunca fala no grupo. Nada é excluído: desativa-se.
// Também mostra a configuração da classificação (desligada por padrão) e os documentos que esperam classificação.
import { useState } from "react";
import { toast } from "sonner";
import { Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { jidDeGrupoParaExibir } from "@shared/dolores/grupos";
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
      <CardHeader><CardTitle className="flex items-center gap-2 text-[#C9A961]"><Users className="h-5 w-5" /> Dolores — grupos de clientes</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-300">
          A Dolores só lê os grupos cadastrados aqui e ativos; os outros continuam ignorados. Ela nunca responde, reage nem manda nada
          no grupo, e nada escrito no grupo é comando (nem quando é o dono quem escreve lá). Criar o card do cliente e salvar os
          documentos no card e no Drive só acontecem com a aprovação do dono, pela fila. Para a Dolores entrar no grupo, o dono a
          adiciona pelo celular, fora do sistema.
        </p>
        {dados.isLoading ? <p className="text-sm text-gray-300">Carregando…</p> : dados.error ? <p role="alert" className="text-sm text-red-300">{dados.error.message}</p> : <>
          {/* Cadastro */}
          <section className="space-y-2 rounded-lg border border-[#C9A961]/20 bg-[#1A2332] p-3">
            <h3 className="text-sm font-semibold text-[#C9A961]">Cadastrar grupo</h3>
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
          </section>

          {/* Grupos cadastrados */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-[#C9A961]">Grupos cadastrados</h3>
            {!dados.data?.grupos.length ? <p className="text-sm text-gray-300">Nenhum grupo cadastrado.</p> : (
              <ul className="space-y-2">
                {dados.data.grupos.map(g => (
                  <li key={g.id} className="rounded-lg border border-[#C9A961]/20 bg-[#1A2332] p-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="min-w-0 break-words"><strong>{g.nome}</strong> <span className="text-xs text-gray-400">(grupo {g.id}) · {g.leadId ? `cliente #${g.leadId}${g.cliente ? ` — ${g.cliente}` : ""}` : g.obraId ? `obra #${g.obraId}${g.obra ? ` — ${g.obra}` : ""}` : "sem card ainda"}</span></p>
                      <label className="flex items-center gap-2 text-xs text-gray-300">
                        <Switch checked={g.ativo} disabled={atualizar.isPending} onCheckedChange={v => atualizar.mutate({ id: g.id, ativo: v })} aria-label={`Grupo ${g.nome} ativo`} />
                        {g.ativo ? "lendo" : "desativado"}
                      </label>
                    </div>
                    <p className="mt-1 text-xs text-gray-300">
                      {g.mensagens} mensagens · a classificar {g.documentos.aClassificar} · classificados {g.documentos.classificados} · a conferir {g.documentos.confira} · salvos no card {g.documentos.salvos}
                      {g.documentos.naoBaixados ? ` · não baixados ${g.documentos.naoBaixados}` : ""} · cadastrado em {quando(g.criadoEm)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

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
