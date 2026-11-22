// EPIC-027 C5 (memória de longo prazo): "Memória da Dolores" — só admin (o servidor confere o papel em cada rota). Lista as coisas que o
// dono pediu para ela lembrar (ou que o administrador cadastrou), com busca e filtro por categoria; criar, corrigir, arquivar e restaurar.
// "Apagar" arquiva (o registro fica, com quem e quando). O texto passa pela mesma regra da conversa: senha, código de acesso, chave,
// dado bancário e link são recusados; CPF, telefone e e-mail ficam mascarados. Só a conversa direta do dono usa essas lembranças.
import { useState } from "react";
import { toast } from "sonner";
import { Brain } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const botaoSec = "border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10";
const campo = "mt-1 bg-[#1A2332] border-[#C9A961]/30 text-white";
const quando = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleString("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short", timeStyle: "short" }) : "—");
const CATEGORIAS = [
  { valor: "preferencia_dono", rotulo: "Preferência do dono" },
  { valor: "fato_negocio", rotulo: "Fato do negócio" },
  { valor: "regra_trabalho", rotulo: "Regra de trabalho" },
  { valor: "pessoa", rotulo: "Pessoa" },
] as const;
type Categoria = (typeof CATEGORIAS)[number]["valor"];
const rotulo = (c: string) => CATEGORIAS.find(x => x.valor === c)?.rotulo ?? c;
const MAX = 300;

type Rascunho = { id: number | null; texto: string; categoria: Categoria; leadId: string; obraId: string };
const VAZIO: Rascunho = { id: null, texto: "", categoria: "preferencia_dono", leadId: "", obraId: "" };
const numeroOuNulo = (s: string) => (s.trim() ? Number(s) : null);

export function DoloresMemoriaCard() {
  const utils = trpc.useUtils();
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState<Categoria | "">("");
  const [situacao, setSituacao] = useState<"ativa" | "arquivada" | "todas">("ativa");
  const [rascunho, setRascunho] = useState<Rascunho>(VAZIO);
  const lista = trpc.dolores.memoriaLonga.listar.useQuery(
    { busca: busca.trim() || undefined, categoria: categoria || undefined, situacao, limite: 100 }, { retry: false });
  const recarregar = () => utils.dolores.memoriaLonga.listar.invalidate();
  const aoGravar = async (r: { mascarou?: boolean }, msg: string) => {
    toast.success(r.mascarou ? `${msg} CPF, telefone ou e-mail ficaram mascarados.` : msg);
    setRascunho(VAZIO);
    await recarregar();
  };
  const criar = trpc.dolores.memoriaLonga.criar.useMutation({ onSuccess: r => aoGravar(r, "Lembrança guardada."), onError: e => toast.error(e.message) });
  const editar = trpc.dolores.memoriaLonga.editar.useMutation({ onSuccess: r => aoGravar(r, "Lembrança corrigida."), onError: e => toast.error(e.message) });
  const arquivar = trpc.dolores.memoriaLonga.arquivar.useMutation({ onSuccess: async () => { toast.success("Lembrança arquivada (dá para restaurar)."); await recarregar(); }, onError: e => toast.error(e.message) });
  const restaurar = trpc.dolores.memoriaLonga.restaurar.useMutation({ onSuccess: async () => { toast.success("Lembrança restaurada."); await recarregar(); }, onError: e => toast.error(e.message) });
  const ocupado = criar.isPending || editar.isPending || arquivar.isPending || restaurar.isPending;
  const ctx = lista.data?.contexto;

  const salvar = () => {
    const dados = { texto: rascunho.texto, categoria: rascunho.categoria, leadId: numeroOuNulo(rascunho.leadId), obraId: numeroOuNulo(rascunho.obraId) };
    if (rascunho.id) editar.mutate({ id: rascunho.id, ...dados }); else criar.mutate(dados);
  };

  return (
    <Card className="border-[#C9A961]/20 bg-[#2C3E50] text-gray-100">
      <CardHeader><CardTitle className="flex items-center gap-2 text-[#C9A961]"><Brain className="h-5 w-5" /> Memória da Dolores</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-gray-300">
          Fatos e preferências permanentes que o dono pediu para a Dolores lembrar ("lembra que…" no WhatsApp, com o "pode" dele) ou que
          o administrador cadastrou aqui. Entram só na conversa direta do dono com ela — nunca em grupo nem para cliente. Senha, código de
          acesso, chave, dado bancário e link não são aceitos; CPF, telefone e e-mail ficam mascarados. Arquivar tira da memória sem apagar.
        </p>
        {ctx && (
          <p className="text-xs text-gray-200" aria-live="polite">
            Em uso na conversa: <strong>{ctx.usadas}</strong> de {ctx.ativas} ativas ({ctx.caracteres.toLocaleString("pt-BR")} caracteres; teto de {ctx.tetoFatos} lembranças e {ctx.tetoCaracteres.toLocaleString("pt-BR")} caracteres).
            {ctx.usadas < ctx.ativas ? " Passou do teto: entram as mais recentes e as do cliente ou obra de que se está falando." : ""}
          </p>
        )}

        <div className="rounded-lg border border-[#C9A961]/20 bg-[#1A2332] p-2 space-y-2">
          <p className="text-sm font-semibold text-[#C9A961]">{rascunho.id ? `Corrigir a lembrança nº ${rascunho.id}` : "Nova lembrança"}</p>
          <div>
            <Label htmlFor="memoria-texto" className="text-xs text-gray-300">Texto ({rascunho.texto.length}/{MAX})</Label>
            <Input id="memoria-texto" value={rascunho.texto} maxLength={MAX} onChange={e => setRascunho({ ...rascunho, texto: e.target.value })} className={campo}
              placeholder="Ex.: Prefere receber o resumo das obras às segundas de manhã" />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="memoria-categoria" className="text-xs text-gray-300">Categoria</Label>
              <select id="memoria-categoria" value={rascunho.categoria} onChange={e => setRascunho({ ...rascunho, categoria: e.target.value as Categoria })}
                className={`${campo} block rounded-md border px-2 py-2 text-sm`}>
                {CATEGORIAS.map(c => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="memoria-lead" className="text-xs text-gray-300">Nº do cliente (opcional)</Label>
              <Input id="memoria-lead" inputMode="numeric" value={rascunho.leadId} onChange={e => setRascunho({ ...rascunho, leadId: e.target.value.replace(/\D/g, ""), obraId: "" })} className={`${campo} w-32`} />
            </div>
            <div>
              <Label htmlFor="memoria-obra" className="text-xs text-gray-300">Nº da obra (opcional)</Label>
              <Input id="memoria-obra" inputMode="numeric" value={rascunho.obraId} onChange={e => setRascunho({ ...rascunho, obraId: e.target.value.replace(/\D/g, ""), leadId: "" })} className={`${campo} w-32`} />
            </div>
            <Button size="sm" disabled={ocupado || rascunho.texto.trim().length < 3} className="bg-[#C9A961] font-bold text-[#1A2332] hover:bg-[#B8985A]" onClick={salvar}>
              {rascunho.id ? "Salvar correção" : "Guardar"}
            </Button>
            {rascunho.id && <Button size="sm" variant="outline" className={botaoSec} onClick={() => setRascunho(VAZIO)}>Cancelar</Button>}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="memoria-busca" className="text-xs text-gray-300">Buscar</Label>
            <Input id="memoria-busca" value={busca} onChange={e => setBusca(e.target.value)} className={`${campo} w-56`} placeholder="palavra do texto" />
          </div>
          <div>
            <Label htmlFor="memoria-filtro" className="text-xs text-gray-300">Categoria</Label>
            <select id="memoria-filtro" value={categoria} onChange={e => setCategoria(e.target.value as Categoria | "")} className={`${campo} block rounded-md border px-2 py-2 text-sm`}>
              <option value="">Todas</option>
              {CATEGORIAS.map(c => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="memoria-situacao" className="text-xs text-gray-300">Situação</Label>
            <select id="memoria-situacao" value={situacao} onChange={e => setSituacao(e.target.value as typeof situacao)} className={`${campo} block rounded-md border px-2 py-2 text-sm`}>
              <option value="ativa">Ativas</option>
              <option value="arquivada">Arquivadas</option>
              <option value="todas">Todas</option>
            </select>
          </div>
        </div>

        {lista.isLoading ? <p className="text-sm text-gray-300">Carregando…</p> : lista.error ? <p role="alert" className="text-sm text-red-300">{lista.error.message}</p>
          : !lista.data?.itens.length ? <p className="text-sm text-gray-300">Nenhuma lembrança {situacao === "arquivada" ? "arquivada" : "encontrada"}.</p> : (
            <ul className="space-y-2">
              {lista.data.itens.map(m => (
                <li key={m.id} className="rounded-lg border border-[#C9A961]/20 bg-[#1A2332] p-2 text-sm">
                  <p className="text-xs text-gray-400">
                    nº {m.id} · {rotulo(m.categoria)}{m.leadId ? ` · cliente nº ${m.leadId}` : m.obraId ? ` · obra nº ${m.obraId}` : ""}
                    {" · "}{m.origem === "conversa" ? "pedida pelo dono no WhatsApp" : "cadastrada na tela"} em {quando(m.criadoEm)}
                    {m.atualizadoEm && new Date(m.atualizadoEm).getTime() !== new Date(m.criadoEm).getTime() ? ` · alterada em ${quando(m.atualizadoEm)}` : ""}
                    {m.situacao === "arquivada" ? ` · arquivada em ${quando(m.arquivadoEm)}` : ""}
                  </p>
                  <p className={`mt-1 ${m.situacao === "arquivada" ? "text-gray-400 line-through" : "text-gray-100"}`}>{m.texto}</p>
                  <div className="mt-2 flex gap-2">
                    {m.situacao === "ativa" ? <>
                      <Button size="sm" variant="outline" className={botaoSec} disabled={ocupado}
                        onClick={() => setRascunho({ id: m.id, texto: m.texto, categoria: m.categoria as Categoria, leadId: m.leadId ? String(m.leadId) : "", obraId: m.obraId ? String(m.obraId) : "" })}>Corrigir</Button>
                      <Button size="sm" variant="outline" className={botaoSec} disabled={ocupado}
                        onClick={() => { if (window.confirm("Arquivar esta lembrança? A Dolores deixa de usá-la; dá para restaurar depois.")) arquivar.mutate({ id: m.id }); }}>Arquivar</Button>
                    </> : <Button size="sm" variant="outline" className={botaoSec} disabled={ocupado} onClick={() => restaurar.mutate({ id: m.id })}>Restaurar</Button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </CardContent>
    </Card>
  );
}
