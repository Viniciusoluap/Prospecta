// EPIC-027 C2 — grupos do WhatsApp na Central (aba Conversas › Grupos). Decisão do dono de 20/11/2026 (noite): veem o admin e o
// colaborador com a permissão "Grupos do WhatsApp"; aparecem todos os grupos; dá para escrever "exatamente igual faz na conversa".
// O servidor confere tudo de novo (rotas whatsappGrupos.*); classificar usa a rota da Dolores (dolores.grupos.definirTipo, EPIC-027 C3).
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Bot, Hand, Send, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { CATEGORIAS_GRUPO, categoriaDoTipo, type TipoGrupo } from "@shared/dolores/grupos-tipo";
import { TEXTO_GRUPOS } from "@shared/whatsapp/grupos-central";
import { TEXTO_MODO } from "@shared/dolores/modo-conversa";

const hora = (d: string | Date) => new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const botaoSec = "h-7 text-xs border-[#C9A961]/30 text-[#C9A961]";

type TipoDaTela = (typeof CATEGORIAS_GRUPO)[number]["tipo"];
type GrupoDaLista = { id: number; nome: string; tipo: TipoGrupo; leadId: number | null; obraId: number | null; semProvaDoDono: boolean };

/**
 * "Definir tipo" dentro da Central — SÓ para o administrador (regra do dono de 21/11/2026: o colaborador com "Grupos do WhatsApp"
 * vê e escreve, mas não classifica). A mesma lista de categorias e a mesma rota do cartão da Dolores em Integrações; o servidor
 * confere de novo (só admin) e o dono recebe aviso no WhatsApp.
 */
function DefinirTipo({ g, onFeito }: { g: GrupoDaLista; onFeito: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<string>("");
  const [numero, setNumero] = useState("");
  const definir = trpc.dolores.grupos.definirTipo.useMutation({
    onSuccess: r => {
      toast.success(r.texto);
      if (r.aviso === "pendente") toast.message("O aviso ao dono ficou pendente (teto de avisos do dia); a mudança entra no relatório diário.");
      setAberto(false); onFeito();
    },
    onError: e => toast.error(e.message),
  });
  // grupo em que o dono ainda não provou quem colocou a empresa: só o dono aceita, pelo WhatsApp (a tela nunca aceita)
  if (g.semProvaDoDono) return null;
  const precisaNumero = tipo === "cliente" || tipo === "pos_atendimento";
  if (!aberto) {
    return (
      <Button size="sm" variant="outline" className={botaoSec} onClick={() => {
        setTipo(g.tipo !== "indefinido" && CATEGORIAS_GRUPO.some(c => c.tipo === g.tipo) ? g.tipo : CATEGORIAS_GRUPO[0].tipo);
        setNumero(String(g.leadId ?? g.obraId ?? "")); setAberto(true);
      }}>Definir tipo</Button>
    );
  }
  return (
    <div className="w-full flex flex-wrap items-end gap-2 rounded border border-[#C9A961]/20 p-2">
      <div><Label htmlFor={`tipo-central-${g.id}`} className="text-xs text-gray-300">Tipo</Label>
        <select id={`tipo-central-${g.id}`} value={tipo} onChange={e => setTipo(e.target.value)}
          className="mt-1 block rounded border border-[#C9A961]/30 bg-[#1A2332] p-1 text-xs text-white">
          {CATEGORIAS_GRUPO.map(c => <option key={c.tipo} value={c.tipo}>{c.opcao}. {c.rotulo}</option>)}
        </select>
        <p className="mt-1 max-w-xs text-[11px] text-gray-400">{categoriaDoTipo(tipo)?.explica ?? ""}</p>
        <p className="mt-1 max-w-xs text-[11px] text-gray-400">O dono recebe um aviso no WhatsApp com a mudança.</p></div>
      {(precisaNumero || tipo === "engenharia") && (
        <div><Label htmlFor={`numero-central-${g.id}`} className="text-xs text-gray-300">{precisaNumero ? "Nº do cliente no CRM" : "Nº da obra (opcional)"}</Label>
          <Input id={`numero-central-${g.id}`} inputMode="numeric" value={numero} onChange={e => setNumero(e.target.value.replace(/\D/g, ""))} className="mt-1 h-8 w-32 bg-[#1A2332] border-[#C9A961]/30 text-white" /></div>
      )}
      <Button size="sm" className="h-7 bg-[#C9A961] text-xs font-bold text-[#1A2332] hover:bg-[#B8985A]"
        disabled={definir.isPending || (precisaNumero && !numero)}
        onClick={() => definir.mutate({ grupoId: g.id, tipo: tipo as TipoDaTela, numero: numero ? Number(numero) : null })}>Salvar</Button>
      <Button size="sm" variant="outline" className={botaoSec} onClick={() => setAberto(false)}>Cancelar</Button>
    </div>
  );
}

/** "Assumir (humano)" / "Devolver para a Dolores" no grupo. Nunca envia nada ao grupo. */
function AtendimentoDoGrupo({ grupoId }: { grupoId: number }) {
  const utils = trpc.useUtils();
  const q = trpc.whatsappGrupos.atendimento.useQuery({ grupoId }, { refetchInterval: 30_000 });
  const mudar = trpc.whatsappGrupos.mudarAtendimento.useMutation({
    onSuccess: (r, v) => { utils.whatsappGrupos.atendimento.setData({ grupoId }, r); toast.success(v.acao === "assumir" ? "Grupo assumido pela equipe." : "Grupo devolvido para a Dolores."); },
    onError: e => toast.error(e.message),
  });
  const a = q.data;
  if (!a) return null;
  const assumida = a.estado === "assumida";
  return (
    <div className="w-full flex flex-wrap items-center gap-2 text-xs">
      <span role="status" className={`inline-flex items-center gap-1 rounded px-2 py-1 font-bold ${assumida ? "bg-amber-500/15 text-amber-200" : "bg-green-600/20 text-green-300"}`}>
        {assumida ? <Hand className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
        {assumida ? `${TEXTO_MODO.assumida}${a.alteradoPor ? ` por ${a.alteradoPor}` : ""}${a.alteradoEm ? ` em ${hora(a.alteradoEm)}` : ""}` : "Dolores responde quando marcada (se a resposta no grupo estiver ligada)"}
      </span>
      <Button size="sm" variant="outline" disabled={mudar.isPending} className={botaoSec} onClick={() => mudar.mutate({ grupoId, acao: assumida ? "devolver" : "assumir" })}>
        {assumida ? <Bot className="h-3 w-3 mr-1" /> : <Hand className="h-3 w-3 mr-1" />}{assumida ? TEXTO_MODO.devolver : TEXTO_MODO.assumir}
      </Button>
      <span className="text-gray-400">{assumida ? TEXTO_GRUPOS.ajudaDevolver : TEXTO_GRUPOS.ajudaAssumir}</span>
    </div>
  );
}

export function GruposWhatsApp() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const ehAdmin = user?.role === "admin";
  const [grupoId, setGrupoId] = useState<number | null>(null);
  const [texto, setTexto] = useState("");
  const [busca, setBusca] = useState("");

  const fim = useRef<HTMLDivElement>(null);
  const grupos = trpc.whatsappGrupos.listar.useQuery(undefined, { refetchInterval: 8000 });
  const mensagens = trpc.whatsappGrupos.mensagens.useQuery({ grupoId: grupoId ?? 0 }, { enabled: Boolean(grupoId), refetchInterval: 5000 });
  // páginas mais antigas carregadas por "Ver mensagens anteriores" (a página mais nova se atualiza sozinha)
  type Pagina = { mensagens: NonNullable<typeof mensagens.data>["mensagens"]; temMais: boolean; maisAntiga: Date | string | null };
  const [antigas, setAntigas] = useState<Pagina | null>(null);
  const [carregando, setCarregando] = useState(false);
  const enviar = trpc.whatsappGrupos.enviar.useMutation({
    onSuccess: r => { if (r.aviso) toast.warning(r.aviso); setTexto(""); utils.whatsappGrupos.mensagens.invalidate(); utils.whatsappGrupos.listar.invalidate(); },
    onError: e => toast.error(e.message),
  });
  useEffect(() => { setAntigas(null); setTexto(""); }, [grupoId]);
  async function verAnteriores(id: number, cursor: Date | string) {
    setCarregando(true);
    try {
      const r = await utils.whatsappGrupos.mensagens.fetch({ grupoId: id, antes: new Date(cursor) });
      setAntigas(p => ({ mensagens: [...r.mensagens, ...(p?.mensagens ?? [])], temMais: r.temMais, maisAntiga: r.maisAntiga }));
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não consegui carregar as mensagens anteriores."); }
    finally { setCarregando(false); }
  }
  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [mensagens.data?.mensagens.length, grupoId]);

  const lista = (grupos.data?.grupos ?? []).filter(g => !busca || g.nome.toLowerCase().includes(busca.toLowerCase()));
  const atual = (grupos.data?.grupos ?? []).find(g => g.id === grupoId) ?? null;
  const recentes = mensagens.data?.mensagens ?? [];
  const chavesRecentes = new Set(recentes.map(m => m.chave));
  const todas = [...(antigas?.mensagens ?? []).filter(m => !chavesRecentes.has(m.chave)), ...recentes];
  const temMais = antigas ? antigas.temMais : mensagens.data?.temMais;
  const cursor = antigas ? antigas.maisAntiga : mensagens.data?.maisAntiga;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4 min-h-[520px]">
      <div className="rounded-lg border border-[#C9A961]/20 bg-[#2C3E50] flex flex-col">
        <div className="p-3 border-b border-[#C9A961]/10">
          <Input placeholder="Buscar grupo..." value={busca} onChange={e => setBusca(e.target.value)} className="bg-[#1A2332] border-[#C9A961]/30 text-white" />
        </div>
        <div className="flex-1 overflow-y-auto max-h-[560px]">
          {grupos.error && <p className="p-4 text-sm text-red-300">{grupos.error.message}</p>}
          {grupos.data && !grupos.data.conectada && <p className="p-4 text-xs text-amber-200">WhatsApp da empresa desconectado: dá para ler, não para escrever.</p>}
          {grupos.data && lista.length === 0 && <p className="p-4 text-sm text-gray-300">{TEXTO_GRUPOS.semGrupos}</p>}
          {lista.map(g => (
            <button key={g.id} onClick={() => setGrupoId(g.id)} className={`w-full text-left px-3 py-3 border-b border-white/5 hover:bg-white/5 ${g.id === grupoId ? "bg-[#C9A961]/10" : ""}`}>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 shrink-0 text-[#C9A961]" aria-label="Grupo" />
                <p className="min-w-0 flex-1 truncate font-bold text-sm text-white">{g.nome}</p>
              </div>
              <p className="text-[11px] text-gray-300">
                Grupo · {g.rotuloTipo}{g.cliente ? ` · ${g.cliente}` : g.obra ? ` · ${g.obra}` : ""}
                {g.aguardandoDono && <span className="ml-1 rounded bg-yellow-300/15 px-1 font-bold text-yellow-200">{TEXTO_GRUPOS.aguardando}</span>}
              </p>
              {g.ultima && <p className="text-xs text-gray-300 truncate">{g.ultima.texto}</p>}
              {g.ultima && <p className="text-[11px] text-gray-400">{hora(g.ultima.quando)}</p>}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-[#C9A961]/20 bg-[#2C3E50] flex flex-col">
        {!atual ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-300 p-6">Escolha um grupo à esquerda.</div>
        ) : (
          <>
            <div className="p-3 border-b border-[#C9A961]/10 flex items-center justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <p className="font-bold text-white break-words"><Users className="mr-1 inline h-4 w-4 text-[#C9A961]" />{atual.nome}</p>
                <p className="text-xs text-gray-300">
                  Grupo · {atual.rotuloTipo}{atual.leadId ? ` · cliente nº ${atual.leadId}${atual.cliente ? ` — ${atual.cliente}` : ""}` : atual.obraId ? ` · obra nº ${atual.obraId}${atual.obra ? ` — ${atual.obra}` : ""}` : ""}
                  {atual.codigo ? ` · código ${atual.codigo}` : ""}
                  {atual.aguardandoDono ? ` · ${TEXTO_GRUPOS.aguardando}` : ""}
                </p>
              </div>
              {ehAdmin && <DefinirTipo key={atual.id} g={atual} onFeito={() => utils.whatsappGrupos.listar.invalidate()} />}
              <AtendimentoDoGrupo grupoId={atual.id} />
              <p className="w-full text-[11px] text-gray-400">{TEXTO_GRUPOS.limitacao}</p>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[460px] p-3 space-y-2">
              {temMais && cursor && (
                <div className="text-center">
                  <Button size="sm" variant="outline" className={botaoSec} disabled={carregando} onClick={() => verAnteriores(atual.id, cursor)}>Ver mensagens anteriores</Button>
                </div>
              )}
              {todas.map(m => (
                <div key={m.chave} className={`flex ${m.origem === "participante" ? "justify-start" : "justify-end"}`}>
                  <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${m.origem === "equipe" ? "bg-green-800 text-white" : m.origem === "dolores" ? "bg-[#3B4A5E] text-white" : "bg-[#1A2332] text-gray-100"}`}>
                    <p className={`text-[11px] font-bold ${m.origem === "participante" ? "text-gray-300" : "text-[#C9A961]"}`}>
                      {m.origem === "dolores" ? <Bot className="mr-1 inline h-3 w-3" /> : m.origem === "equipe" ? <Hand className="mr-1 inline h-3 w-3" /> : null}
                      {m.autor}{m.origem === "participante" ? " · participante" : ""}
                    </p>
                    {m.texto}
                    <div className="text-[10px] text-gray-300 mt-1 text-right">{hora(m.quando)}{m.situacao ? ` • ${m.situacao}` : ""}</div>
                  </div>
                </div>
              ))}
              <div ref={fim} />
            </div>
            {atual.podeEscrever ? (
              <form className="p-3 border-t border-[#C9A961]/10 space-y-1" onSubmit={e => { e.preventDefault(); if (texto.trim()) enviar.mutate({ grupoId: atual.id, texto }); }}>
                <div className="flex gap-2">
                  <Input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Escreva no grupo..." className="bg-[#1A2332] border-[#C9A961]/30 text-white" />
                  <Button type="submit" disabled={enviar.isPending || !texto.trim()} className="bg-green-600 hover:bg-green-700 text-white" aria-label="Enviar ao grupo"><Send className="h-4 w-4" /></Button>
                </div>
                <p className="text-[11px] text-gray-400">{TEXTO_GRUPOS.naoEhComando}</p>
              </form>
            ) : (
              <p role="status" className="p-3 border-t border-[#C9A961]/10 text-sm text-amber-200">
                {atual.semProvaDoDono ? TEXTO_GRUPOS.semEscrita : "WhatsApp da empresa desconectado: não dá para escrever agora."}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
