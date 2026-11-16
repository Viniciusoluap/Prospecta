// EPIC-024 S-10 (16/11): Anthropic — Inteligência Artificial. Só cadastro: guardar a chave (criptografada no
// servidor), testar quando o admin pedir, listar os modelos que a chave tem e guardar o preferencial.
// A IA da Anthropic NÃO é ativada por esta tela: a chave só é usada pela leitura da Maquete 3D (com confirmação) e pela Dolores (com o interruptor dela).
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const botaoSec = "border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10";
const FAMILIA: Record<string, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", fable: "Fable", outro: "Outros" };

export function AnthropicCard() {
  const utils = trpc.useUtils();
  const status = trpc.integracoes.statusAnthropic.useQuery();
  const [trocando, setTrocando] = useState(false);
  const [chave, setChave] = useState("");
  const [escolhido, setEscolhido] = useState("");
  const onError = (e: { message: string }) => toast.error(e.message);
  const recarregar = () => utils.integracoes.statusAnthropic.invalidate();
  const teste = trpc.integracoes.testarAnthropic.useMutation({ onError });
  const modelos = trpc.integracoes.modelosAnthropic.useMutation({ onError });
  const salvar = trpc.integracoes.salvarAnthropic.useMutation({
    onSuccess: async r => { toast.success(r.mensagem); setChave(""); setTrocando(false); teste.reset(); modelos.reset(); await recarregar(); },
    onError,
  });
  const remover = trpc.integracoes.removerAnthropic.useMutation({
    onSuccess: async () => { toast.success("Chave da Anthropic removida."); teste.reset(); modelos.reset(); await recarregar(); },
    onError,
  });
  const salvarModelo = trpc.integracoes.salvarModeloAnthropic.useMutation({
    onSuccess: async r => { toast.success(`Modelo preferencial: ${r.modelo.nome}.`); await recarregar(); },
    onError,
  });
  const s = status.data;
  const lista = modelos.data ?? [];
  const familias = Array.from(new Set(lista.map(m => m.familia)));
  const nomePreferido = lista.find(m => m.id === s?.modeloPreferencial)?.nome;

  return (
    <Card className="border-[#C9A961]/20 bg-[#2C3E50] text-gray-100">
      <CardHeader><CardTitle className="text-[#C9A961]">Anthropic — Inteligência Artificial</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {teste.isPending ? <p className="flex items-center gap-2 text-sm text-gray-300"><Loader2 className="h-4 w-4 animate-spin" /> Testando…</p>
          : teste.data && <p className={`flex items-start gap-2 text-sm ${teste.data.ok ? "text-green-300" : "text-red-300"}`}>{teste.data.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />} {teste.data.mensagem}</p>}
        <p className="flex items-center gap-2 text-sm text-gray-300">
          <span className={`inline-block h-2 w-2 rounded-full ${s?.configurado ? "bg-green-400" : s?.ilegivel ? "bg-yellow-400" : "bg-gray-500"}`} />
          {status.isLoading ? "Carregando…" : s?.configurado ? `Chave configurada, terminando em ${s.final} (salva nesta tela, criptografada).` : s?.ilegivel ? "" : "Nenhuma chave salva."}
        </p>
        {s?.ilegivel && <p role="alert" className="flex items-start gap-2 text-sm text-yellow-200"><XCircle className="mt-0.5 h-4 w-4 shrink-0" /> {s.aviso}</p>}
        {s?.configurado && <p className="text-sm text-gray-300">Modelo preferencial: {s.modeloPreferencial ? <code className="rounded bg-black/30 px-1">{nomePreferido ? `${nomePreferido} (${s.modeloPreferencial})` : s.modeloPreferencial}</code> : "nenhum escolhido."}</p>}
        <p className="flex items-start gap-2 rounded-lg border border-[#C9A961]/30 bg-[#C9A961]/10 p-2 text-xs text-gray-200">
          <Info className="mt-0.5 h-3 w-3 shrink-0" /> A chave não é usada automaticamente. Só dois lugares a usam: a leitura de plantas da Maquete 3D, quando o admin confirma o custo, e a Dolores, somente com o interruptor dela ligado (cartão Dolores, abaixo). Testar e listar modelos não consome tokens.
        </p>
        <div className="flex flex-wrap gap-2">
          {s?.configurado && <Button size="sm" variant="outline" className={botaoSec} disabled={teste.isPending} onClick={() => teste.mutate()}>Testar conexão</Button>}
          <Button size="sm" variant="outline" className={botaoSec} onClick={() => { setTrocando(t => !t); setChave(""); }}>{trocando ? "Cancelar" : s?.configurado ? "Trocar chave" : "Adicionar chave"}</Button>
          {s?.configurado && <Button size="sm" variant="outline" className={botaoSec} disabled={modelos.isPending} onClick={() => modelos.mutate()}>{modelos.isPending ? "Consultando…" : lista.length ? "Atualizar modelos" : "Escolher modelo"}</Button>}
          {(s?.configurado || s?.ilegivel) && <Button size="sm" variant="outline" className={botaoSec} disabled={remover.isPending}
            onClick={() => { if (window.confirm("Remover a chave da Anthropic e o modelo preferencial?")) remover.mutate(); }}>Remover</Button>}
        </div>
        {trocando && (
          <form className="space-y-3 rounded-lg bg-[#1A2332] p-3" onSubmit={e => { e.preventDefault(); salvar.mutate({ apiKey: chave }); }}>
            <div>
              <Label className="text-gray-300">Chave de API da Anthropic</Label>
              <Input type="password" autoComplete="off" placeholder="sk-ant-..." value={chave} onChange={e => setChave(e.target.value)} className="mt-1 bg-[#1A2332] border-[#C9A961]/30 text-white placeholder:text-gray-500" />
            </div>
            <p className="text-xs text-gray-400">A chave é conferida na Anthropic antes de salvar e nunca volta para a tela.</p>
            <Button type="submit" size="sm" disabled={!chave.trim() || salvar.isPending} className="bg-[#C9A961] font-bold text-[#1A2332] hover:bg-[#B8985A]">{salvar.isPending ? "Validando…" : "Validar e salvar"}</Button>
          </form>
        )}
        {s?.configurado && modelos.data && (
          <form className="space-y-2 rounded-lg bg-[#1A2332] p-3" onSubmit={e => { e.preventDefault(); salvarModelo.mutate({ modelo: escolhido || s.modeloPreferencial || "" }); }}>
            <Label className="text-gray-300" htmlFor="modelo-anthropic">Modelo de IA preferencial ({lista.length} disponível(is) para esta chave)</Label>
            {lista.length === 0 ? <p className="text-sm text-gray-300">A Anthropic não listou nenhum modelo para esta chave.</p> : (
              <select id="modelo-anthropic" value={escolhido || s.modeloPreferencial || ""} onChange={e => setEscolhido(e.target.value)}
                className="w-full rounded-md border border-[#C9A961]/30 bg-[#1A2332] px-2 py-2 text-sm text-white">
                <option value="" disabled>Escolha um modelo</option>
                {familias.map(f => (
                  <optgroup key={f} label={FAMILIA[f] ?? f}>
                    {lista.filter(m => m.familia === f).map(m => <option key={m.id} value={m.id}>{m.nome} — {m.id}</option>)}
                  </optgroup>
                ))}
              </select>
            )}
            {s.modeloPreferencial && lista.length > 0 && !lista.some(m => m.id === s.modeloPreferencial) && <p className="text-xs text-yellow-200">O modelo salvo não aparece mais na lista desta chave — escolha outro.</p>}
            <Button type="submit" size="sm" disabled={!(escolhido || s.modeloPreferencial) || salvarModelo.isPending || lista.length === 0} className="bg-[#C9A961] font-bold text-[#1A2332] hover:bg-[#B8985A]">{salvarModelo.isPending ? "Salvando…" : "Salvar preferência"}</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
