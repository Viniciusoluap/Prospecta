// EPIC-025 E9 (regra do dono de 20/11/2026, itens 3 e 5) — na Central › Templates, SÓ admin: campanhas de saudação (nome,
// empreendimento opcional, texto fixo; UMA ativa por vez) e os textos dos avisos de ligação e de áudio. Texto fixo, sem IA e sem
// variáveis ({{…}} é recusado no servidor); links fora da lista permitida saem no envio.
// EPIC-026 C3: cada campanha pode ter UMA imagem (JPG/PNG, até 5 MB; vai com o texto como legenda) e UM áudio (OGG, MP3 ou M4A,
// até 2 minutos e 5 MB; vai em seguida como mensagem de voz). A tela confere antes de enviar; o servidor confere de novo pelos bytes.
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ImageIcon, Megaphone, Mic, Trash2, Upload } from "lucide-react";
import { enviarPartes } from "@/lib/documentos-partes";
import {
  ACCEPT_AUDIO_SAUDACAO, ACCEPT_IMAGEM_SAUDACAO, LIMITE_AUDIO_SAUDACAO, LIMITE_IMAGEM_SAUDACAO, conferirMidiaSaudacao, escopoMidiaSaudacao, type TipoMidiaSaudacao,
} from "@shared/whatsapp/saudacao-midia";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const cardCls = "bg-[#2C3E50] border-[#C9A961]/20";
const inputCls = "bg-[#1A2332] border-[#C9A961]/30 text-white";
type Editor = { id?: number; nome: string; empreendimento: string; texto: string };
type MetaMidia = { tipo: TipoMidiaSaudacao; mime: string; nome: string; tamanho: number; duracaoS: number | null; versao: string };

const tamanhoLegivel = (n: number) => n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const duracaoLegivel = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Imagem ou áudio de UMA campanha: pré-visualização (do arquivo salvo, lido só pelo administrador), trocar e remover. */
function MidiaDaCampanha({ campanhaId, tipo, meta }: { campanhaId: number; tipo: TipoMidiaSaudacao; meta: MetaMidia | null }) {
  const utils = trpc.useUtils();
  const entrada = useRef<HTMLInputElement>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const salvar = trpc.dolores.atendimento.salvarMidia.useMutation();
  const remover = trpc.dolores.atendimento.removerMidia.useMutation({
    onSuccess: async () => { toast.success(tipo === "imagem" ? "Imagem removida." : "Áudio removido."); await utils.dolores.atendimento.status.invalidate(); },
    onError: e => setErro(e.message),
  });
  const rotulo = tipo === "imagem" ? "Imagem (vai junto com o texto, como legenda)" : "Áudio (vai depois do texto, como mensagem de voz)";
  const regra = tipo === "imagem" ? "JPG ou PNG, até 5 MB." : "OGG (o do WhatsApp), MP3 ou M4A, até 2 minutos e 5 MB.";

  // pré-visualização do arquivo SALVO: lida em pedaços pelo tRPC (sem URL pública)
  useEffect(() => {
    if (!meta) { setPrevia(null); return; }
    let cancelado = false;
    let url: string | null = null;
    (async () => {
      const partes: Uint8Array[] = [];
      let offset = 0;
      while (offset < meta.tamanho) {
        const r = await utils.dolores.atendimento.midiaDaCampanha.fetch({ campanhaId, tipo, offset }, { staleTime: 0 });
        const bytes = Uint8Array.from(atob(r.base64), c => c.charCodeAt(0));
        if (!bytes.length) break;
        partes.push(bytes);
        offset += bytes.length;
      }
      if (cancelado) return;
      url = URL.createObjectURL(new Blob(partes as BlobPart[], { type: meta.mime }));
      setPrevia(url);
    })().catch(() => { if (!cancelado) setErro("Não consegui carregar a pré-visualização."); });
    return () => { cancelado = true; if (url) URL.revokeObjectURL(url); };
  }, [campanhaId, tipo, meta?.versao]); // eslint-disable-line react-hooks/exhaustive-deps

  async function escolher(file: File | undefined) {
    if (!file) return;
    setErro(null);
    try {
      // acima do teto nem lê o arquivo inteiro: só o começo basta para a mensagem de tamanho
      const teto = tipo === "imagem" ? LIMITE_IMAGEM_SAUDACAO : LIMITE_AUDIO_SAUDACAO;
      if (file.size > teto) { setErro(`O arquivo passa de ${teto / (1024 * 1024)} MB. ${tipo === "imagem" ? "Diminua a foto" : "Envie um áudio menor"} e tente de novo.`); return; }
      const conferido = conferirMidiaSaudacao(tipo, new Uint8Array(await file.arrayBuffer()));
      if (!conferido.ok) { setErro(conferido.erro); return; }
      setEnviando(true);
      const uploadId = await enviarPartes(file, escopoMidiaSaudacao(campanhaId, tipo));
      await salvar.mutateAsync({ campanhaId, tipo, uploadId, nome: file.name });
      toast.success(tipo === "imagem" ? "Imagem salva na campanha." : "Áudio salvo na campanha.");
      await utils.dolores.atendimento.status.invalidate();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui enviar o arquivo. Tente de novo.");
    } finally {
      setEnviando(false);
      if (entrada.current) entrada.current.value = "";
    }
  }

  return (
    <div className="rounded border border-[#C9A961]/20 bg-[#1A2332] p-2">
      <p className="flex items-center gap-1 text-xs font-bold text-gray-200">{tipo === "imagem" ? <ImageIcon className="h-3 w-3" /> : <Mic className="h-3 w-3" />} {rotulo}</p>
      <p className="text-[11px] text-gray-400">{regra}</p>
      {meta && (
        <div className="mt-2 space-y-1">
          {previa && (tipo === "imagem"
            ? <img src={previa} alt="Imagem da saudação" className="max-h-40 rounded border border-[#C9A961]/20" />
            : <audio src={previa} controls className="w-full" />)}
          <p className="text-[11px] text-gray-400">{meta.nome} — {tamanhoLegivel(meta.tamanho)}{meta.duracaoS ? ` — ${duracaoLegivel(meta.duracaoS)}` : ""}</p>
        </div>
      )}
      {erro && <p role="alert" className="mt-1 text-xs text-red-300">{erro}</p>}
      <input ref={entrada} type="file" className="hidden" accept={tipo === "imagem" ? ACCEPT_IMAGEM_SAUDACAO : ACCEPT_AUDIO_SAUDACAO} onChange={e => void escolher(e.target.files?.[0])} />
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="outline" disabled={enviando || remover.isPending} onClick={() => entrada.current?.click()}>
          <Upload className="mr-1 h-3 w-3" />{enviando ? "Enviando…" : meta ? "Trocar" : tipo === "imagem" ? "Anexar imagem" : "Anexar áudio"}
        </Button>
        {meta && (
          <Button size="sm" variant="outline" disabled={enviando || remover.isPending} className="text-red-300"
            onClick={() => { if (window.confirm(tipo === "imagem" ? "Remover a imagem desta campanha?" : "Remover o áudio desta campanha?")) remover.mutate({ campanhaId, tipo }); }}>
            <Trash2 className="mr-1 h-3 w-3" />Remover
          </Button>
        )}
      </div>
    </div>
  );
}

export function CampanhasEAvisos() {
  const utils = trpc.useUtils();
  const q = trpc.dolores.atendimento.status.useQuery(undefined, { retry: false });
  const [editor, setEditor] = useState<Editor | null>(null);
  const [avisos, setAvisos] = useState<{ avisoLigacao?: string; avisoAudio?: string }>({});
  const onError = (e: { message: string }) => toast.error(e.message);
  const ok = (msg: string) => async () => { toast.success(msg); await utils.dolores.atendimento.status.invalidate(); };
  // EPIC-026 C3: depois de criar, o editor fica aberto com a campanha nova para anexar imagem e áudio
  const criar = trpc.dolores.atendimento.criarCampanha.useMutation({ onSuccess: async r => { setEditor(e => e ? { ...e, id: r.criadaId } : e); await ok("Campanha criada (inativa). Se quiser, anexe imagem e áudio.")(); }, onError });
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
              {(c.imagem || c.audio) && <p className="mt-1 text-[11px] text-gray-400">{[c.imagem && "com imagem", c.audio && `com áudio (${duracaoLegivel(c.audio.duracaoS ?? 0)})`].filter(Boolean).join(" e ")}</p>}
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
            {editor.id ? (() => {
              const atual = d.campanhas.find(c => c.id === editor.id);
              return (
                <div className="grid gap-2 sm:grid-cols-2">
                  <MidiaDaCampanha campanhaId={editor.id} tipo="imagem" meta={atual?.imagem ?? null} />
                  <MidiaDaCampanha campanhaId={editor.id} tipo="audio" meta={atual?.audio ?? null} />
                </div>
              );
            })() : <p className="text-[11px] text-gray-400">Depois de salvar, você pode anexar uma imagem (JPG/PNG, até 5 MB) e um áudio (até 2 minutos).</p>}
            <p className="text-[11px] text-gray-400">Ordem do envio: a imagem com o texto como legenda (sem imagem, só o texto); depois o áudio, como mensagem de voz. Se a imagem falhar, o texto sai sozinho.</p>
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
