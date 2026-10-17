import { useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, Loader2, Pencil, Trash2, Upload, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { comprimirImagem, enviarJsonComProgresso, mensagemErroEnvio, pareceImagem } from "@/lib/comprimir-imagem";
import { LIMITE_LEGENDA } from "@shared/obra-fotos";
import { publicarEnvio } from "@/lib/envio-progresso";

// EPIC-020 Lote 4 (item 28) — galeria de fotos da obra. Envio de várias fotos
// em sequência, com progresso por arquivo; a tela nunca fica presa em
// "Enviando": cada envio termina em sucesso ou erro (com tempo-limite).

export interface FotoObra {
  id: number;
  imageUrl: string;
  caption: string | null;
  takenAt: string | Date;
  includeInReport: boolean;
}

type Envio = { nome: string; estado: "preparando" | "enviando" | "ok" | "erro"; fracao: number; erro?: string };

export function FotosObraAba({ projectId, fotos, onMudou }: { projectId: number; fotos: FotoObra[]; onMudou: () => void }) {
  const [legenda, setLegenda] = useState("");
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [editando, setEditando] = useState<{ id: number; texto: string } | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  // Marcação "no relatório" otimista: muda na hora e volta se o servidor recusar.
  const [noRelatorio, setNoRelatorio] = useState<Record<number, boolean>>({});
  const atualizar = trpc.obraProgresso.atualizarFoto.useMutation();
  const excluir = trpc.obraProgresso.excluirFoto.useMutation();

  const marcar = (i: number, parcial: Partial<Envio>) => setEnvios((lista) => lista.map((e, j) => (j === i ? { ...e, ...parcial } : e)));

  const enviar = async (arquivos: File[]) => {
    if (!arquivos.length) return;
    setOcupado(true);
    setEnvios(arquivos.map((f) => ({ nome: f.name, estado: "preparando", fracao: 0 })));
    let enviados = 0;
    try {
      for (let i = 0; i < arquivos.length; i++) {
        const f = arquivos[i];
        try {
          if (!pareceImagem(f)) throw new Error("Não é uma imagem.");
          const { dataUrl } = await comprimirImagem(f);
          marcar(i, { estado: "enviando" });
          const { status, dados } = await enviarJsonComProgresso(
            `/api/obras/${projectId}/fotos`,
            { image: dataUrl, caption: legenda.trim() || null, takenAt: new Date(f.lastModified || Date.now()).toISOString(), includeInReport: true },
            (fracao) => {
              marcar(i, { fracao });
              publicarEnvio({ item: "foto", atual: i + 1, total: arquivos.length, fracao });
            }
          );
          if (status < 200 || status >= 300) throw new Error(mensagemErroEnvio(status, dados));
          marcar(i, { estado: "ok", fracao: 1 });
          enviados++;
        } catch (e) {
          marcar(i, { estado: "erro", erro: e instanceof Error ? e.message : String(e) });
        }
      }
    } finally {
      publicarEnvio(null);
      setOcupado(false);
      if (entrada.current) entrada.current.value = "";
      if (enviados) {
        setLegenda("");
        onMudou();
        toast.success(enviados === 1 ? "Foto enviada." : `${enviados} fotos enviadas.`);
      }
      if (enviados < arquivos.length) toast.error(`${arquivos.length - enviados} foto(s) não foram enviadas. Veja o motivo abaixo.`);
    }
  };

  const salvarFoto = async (foto: FotoObra, parcial: { caption?: string | null; includeInReport?: boolean }) => {
    const incluir = parcial.includeInReport ?? noRelatorio[foto.id] ?? foto.includeInReport;
    if (parcial.includeInReport !== undefined) setNoRelatorio((m) => ({ ...m, [foto.id]: incluir }));
    try {
      await atualizar.mutateAsync({
        photoId: foto.id,
        caption: parcial.caption !== undefined ? parcial.caption : foto.caption,
        includeInReport: incluir,
      });
      setEditando(null);
      onMudou();
    } catch (e) {
      setNoRelatorio((m) => { const { [foto.id]: _descartado, ...resto } = m; void _descartado; return resto; });
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const apagar = async (foto: FotoObra) => {
    if (!window.confirm("Excluir esta foto definitivamente?")) return;
    try {
      await excluir.mutateAsync({ photoId: foto.id });
      toast.success("Foto excluída.");
      onMudou();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-[#C9A961]">Galeria de Fotos</CardTitle>
        <CardDescription className="text-gray-400">Fotos do andamento da obra. Marque quais entram no relatório executivo.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="border-2 border-dashed border-[#C9A961]/30 rounded-lg p-6 bg-[#1A2332]/40 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="photo-caption" className="text-gray-300">Legenda (opcional, vale para as fotos deste envio)</Label>
            <Input id="photo-caption" maxLength={LIMITE_LEGENDA} placeholder="Ex: Fundação concluída" value={legenda} onChange={(e) => setLegenda(e.target.value)} className="bg-[#1A2332]/60 border-[#C9A961]/20 text-white" disabled={ocupado} />
          </div>
          <div className="flex items-center justify-center">
            <label htmlFor="photo-upload" className={ocupado ? "cursor-wait" : "cursor-pointer"}>
              <div className="flex flex-col items-center gap-2 px-6 py-4 bg-[#C9A961]/10 hover:bg-[#C9A961]/20 rounded-lg border border-[#C9A961]/30 transition-colors">
                {ocupado ? <Loader2 className="h-8 w-8 text-[#C9A961] animate-spin" /> : <Upload className="h-8 w-8 text-[#C9A961]" />}
                <span className="text-sm text-gray-300">{ocupado ? "Enviando..." : "Selecionar fotos (uma ou várias)"}</span>
                <span className="text-xs text-gray-400">JPG, PNG, WEBP ou HEIC do iPhone — reduzidas automaticamente</span>
              </div>
              <input id="photo-upload" ref={entrada} type="file" accept="image/*" multiple className="hidden" disabled={ocupado} onChange={(e) => enviar(Array.from(e.target.files ?? []))} />
            </label>
          </div>
          {envios.length > 0 && (
            <ul className="space-y-1 text-sm" aria-live="polite">
              {envios.map((e, i) => (
                <li key={`${e.nome}-${i}`} className="flex items-center gap-2 text-gray-300">
                  {e.estado === "ok" ? <CheckCircle2 className="h-4 w-4 text-green-400" /> : e.estado === "erro" ? <XCircle className="h-4 w-4 text-red-400" /> : <Loader2 className="h-4 w-4 animate-spin text-[#C9A961]" />}
                  <span className="truncate max-w-[45%]">{e.nome}</span>
                  <span className="text-xs text-gray-400">
                    {e.estado === "preparando" ? "preparando…" : e.estado === "enviando" ? `${Math.round(e.fracao * 100)}%` : e.estado === "ok" ? "enviada" : e.erro}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {fotos.length === 0 ? (
          <p className="text-gray-400 text-center py-8">Nenhuma foto enviada ainda.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {fotos.map((foto) => (
              <figure key={foto.id} className="rounded-lg overflow-hidden border border-[#C9A961]/20 bg-[#1A2332]/40">
                <a href={foto.imageUrl} target="_blank" rel="noreferrer" title="Abrir em tamanho original">
                  <img src={foto.imageUrl} alt={foto.caption || "Foto da obra"} loading="lazy" className="w-full aspect-[4/3] object-cover" />
                </a>
                <figcaption className="p-3 space-y-2 text-sm">
                  {editando?.id === foto.id ? (
                    <div className="flex gap-2">
                      <Input value={editando.texto} maxLength={LIMITE_LEGENDA} onChange={(e) => setEditando({ id: foto.id, texto: e.target.value })} className="h-8 bg-[#2C3E50] border-[#C9A961]/30 text-white" aria-label="Legenda" />
                      <Button size="sm" onClick={() => salvarFoto(foto, { caption: editando.texto.trim() || null })} disabled={atualizar.isPending}>OK</Button>
                    </div>
                  ) : (
                    <p className="text-gray-200">{foto.caption || <span className="text-gray-400">Sem legenda</span>}</p>
                  )}
                  <p className="text-xs text-gray-400">{new Date(foto.takenAt).toLocaleDateString("pt-BR")}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1 text-xs text-gray-300">
                      <input type="checkbox" checked={noRelatorio[foto.id] ?? foto.includeInReport} onChange={(e) => salvarFoto(foto, { includeInReport: e.target.checked })} />
                      No relatório
                    </label>
                    <a href={foto.imageUrl} target="_blank" rel="noreferrer" className="text-xs text-[#C9A961] inline-flex items-center gap-1"><ExternalLink className="h-3 w-3" />Abrir</a>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-gray-300" onClick={() => setEditando({ id: foto.id, texto: foto.caption ?? "" })}><Pencil className="h-3 w-3" /></Button>
                    <Button size="sm" variant="destructive" className="h-7 px-2" onClick={() => apagar(foto)} disabled={excluir.isPending} aria-label="Excluir foto"><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
