// EPIC-025 E9 (regra do dono de 20/11/2026, itens 3 e 5) — na Central › Templates, SÓ admin: campanhas de saudação (nome,
// empreendimento opcional, texto fixo; UMA ativa por vez) e os textos dos avisos de ligação e de áudio. Texto fixo, sem IA e sem
// variáveis ({{…}} é recusado no servidor); links fora da lista permitida saem no envio.
import { useState } from "react";
import { toast } from "sonner";
import { Megaphone } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const cardCls = "bg-[#2C3E50] border-[#C9A961]/20";
const inputCls = "bg-[#1A2332] border-[#C9A961]/30 text-white";
type Editor = { id?: number; nome: string; empreendimento: string; texto: string };

export function CampanhasEAvisos() {
  const utils = trpc.useUtils();
  const q = trpc.dolores.atendimento.status.useQuery(undefined, { retry: false });
  const [editor, setEditor] = useState<Editor | null>(null);
  const [avisos, setAvisos] = useState<{ avisoLigacao?: string; avisoAudio?: string }>({});
  const onError = (e: { message: string }) => toast.error(e.message);
  const ok = (msg: string) => async () => { toast.success(msg); await utils.dolores.atendimento.status.invalidate(); };
  const criar = trpc.dolores.atendimento.criarCampanha.useMutation({ onSuccess: async () => { setEditor(null); await ok("Campanha criada (inativa).")(); }, onError });
  const editar = trpc.dolores.atendimento.editarCampanha.useMutation({ onSuccess: async () => { setEditor(null); await ok("Campanha salva.")(); }, onError });
  const ativar = trpc.dolores.atendimento.ativarCampanha.useMutation({ onSuccess: ok("Campanha atualizada."), onError });
  const salvarAvisos = trpc.dolores.atendimento.salvarConfig.useMutation({ onSuccess: async () => { setAvisos({}); await ok("Avisos salvos.")(); }, onError });
  const d = q.data;
  if (q.error) return <p role="alert" className="text-sm text-red-300">{q.error.message}</p>;
  if (!d) return null;

  return (
    <Card className={cardCls}>
      <CardHeader><CardTitle className="flex items-center gap-2 text-sm text-[#C9A961]"><Megaphone className="h-4 w-4" /> Saudação de campanha e avisos automáticos (número da empresa)</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm text-gray-200">
        <p className="text-xs text-gray-300">A campanha ATIVA (uma por vez) é enviada UMA vez por número a quem escreve e não está cadastrado (nem cliente, nem usuário, nem o dono). Sem campanha ativa, nada sai. Até {d.config.saudacaoTetoDia} saudações por dia.</p>
        <div className="space-y-2">
          {d.campanhas.length === 0 && <p className="text-xs text-gray-400">Nenhuma campanha cadastrada.</p>}
          {d.campanhas.map(c => (
            <div key={c.id} className="rounded border border-[#C9A961]/20 bg-[#1A2332] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold text-white">{c.nome}{c.empreendimento ? <span className="font-normal text-gray-400"> — {c.empreendimento}</span> : null} {c.ativa && <span className="ml-1 rounded bg-green-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-green-300">ativa</span>}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditor({ id: c.id, nome: c.nome, empreendimento: c.empreendimento ?? "", texto: c.texto })}>Editar</Button>
                  <Button size="sm" disabled={ativar.isPending} className={c.ativa ? "bg-red-700 text-white hover:bg-red-800" : "bg-green-600 text-white hover:bg-green-700"}
                    onClick={() => { if (c.ativa || window.confirm("Ativar esta campanha? A ativa hoje (se houver) fica inativa.")) ativar.mutate({ id: c.id, ativa: !c.ativa }); }}>{c.ativa ? "Desativar" : "Ativar"}</Button>
                </div>
              </div>
              <p className="mt-2 whitespace-pre-line text-xs text-gray-300">{c.texto}</p>
              <p className="mt-1 text-[11px] text-gray-500">Saudações enviadas: {c.saudacoes}</p>
            </div>
          ))}
        </div>
        {editor ? (
          <div className="grid gap-2 rounded border border-[#C9A961]/20 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div><Label className="text-gray-300">Nome</Label><Input className={inputCls} value={editor.nome} onChange={e => setEditor({ ...editor, nome: e.target.value })} /></div>
              <div><Label className="text-gray-300">Empreendimento (opcional)</Label><Input className={inputCls} value={editor.empreendimento} onChange={e => setEditor({ ...editor, empreendimento: e.target.value })} /></div>
            </div>
            <div><Label className="text-gray-300">Texto da saudação (fixo, sem variáveis)</Label><textarea rows={4} maxLength={1000} className={`${inputCls} mt-1 w-full rounded-md px-3 py-2 text-sm`} value={editor.texto} onChange={e => setEditor({ ...editor, texto: e.target.value })} /></div>
            <div className="flex gap-2">
              <Button size="sm" disabled={criar.isPending || editar.isPending || editor.nome.trim().length < 2 || editor.texto.trim().length < 2} className="bg-green-600 hover:bg-green-700"
                onClick={() => { const dados = { nome: editor.nome, empreendimento: editor.empreendimento || undefined, texto: editor.texto }; if (editor.id) editar.mutate({ id: editor.id, ...dados }); else criar.mutate(dados); }}>Salvar</Button>
              <Button size="sm" variant="outline" onClick={() => setEditor(null)}>Cancelar</Button>
            </div>
          </div>
        ) : <Button size="sm" className="bg-[#C9A961] text-[#1A2332] hover:bg-[#B8985A]" onClick={() => setEditor({ nome: "", empreendimento: "", texto: "" })}>Nova campanha</Button>}

        <div className="grid gap-2 border-t border-[#C9A961]/10 pt-3">
          <p className="text-xs text-gray-300">Avisos automáticos (no máximo 1 a cada {d.config.avisoIntervaloHoras} h por número; em grupo, silêncio):</p>
          <div><Label className="text-gray-300">Quando alguém LIGA</Label><textarea rows={2} maxLength={500} className={`${inputCls} mt-1 w-full rounded-md px-3 py-2 text-sm`} value={avisos.avisoLigacao ?? d.config.avisoLigacao} onChange={e => setAvisos(a => ({ ...a, avisoLigacao: e.target.value }))} /></div>
          <div><Label className="text-gray-300">Quando o áudio não pôde ser ouvido (transcrição desligada, falhou ou longo demais)</Label><textarea rows={2} maxLength={500} className={`${inputCls} mt-1 w-full rounded-md px-3 py-2 text-sm`} value={avisos.avisoAudio ?? d.config.avisoAudio} onChange={e => setAvisos(a => ({ ...a, avisoAudio: e.target.value }))} /></div>
          <div><Button size="sm" disabled={salvarAvisos.isPending || !Object.keys(avisos).length} className="bg-green-600 hover:bg-green-700" onClick={() => salvarAvisos.mutate(avisos)}>Salvar avisos</Button></div>
        </div>
      </CardContent>
    </Card>
  );
}
