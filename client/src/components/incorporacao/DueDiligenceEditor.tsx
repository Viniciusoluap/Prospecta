import { useEffect, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { lerDueDiligence, progressoDueDiligence, type DueDiligence } from "../../../../shared/incorporacao/due-diligence";

type Etapa = DueDiligence["etapas"][number];
const novaEtapa = (): Etapa => ({ id: crypto.randomUUID(), nome: "Nova etapa", procedimentos: "", observacoes: "", tarefas: [], documentos: [] });

export function DueDiligenceEditor({ estudoId, json }: { estudoId: number; json: string | null }) {
  const utils = trpc.useUtils();
  const { data: attachments = [] } = trpc.incorporacao.documents.list.useQuery({ studyId: estudoId });
  const { data: available } = trpc.incorporacao.documents.available.useQuery();
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const upload = trpc.incorporacao.documents.upload.useMutation({ onSuccess: () => { void utils.incorporacao.documents.list.invalidate({ studyId: estudoId }); }, onError: (e) => toast.error(e.message), onSettled: () => setBusyItem(null) });
  const unlink = trpc.incorporacao.documents.unlink.useMutation({ onSuccess: () => { void utils.incorporacao.documents.list.invalidate({ studyId: estudoId }); }, onError: (e) => toast.error(e.message), onSettled: () => setBusyItem(null) });
  const [salvo, setSalvo] = useState<string | null>(json);
  const [dados, setDados] = useState<DueDiligence>(() => lerDueDiligence(json));
  const [alterado, setAlterado] = useState(false);
  const save = trpc.incorporacao.dueDiligence.save.useMutation({
    onSuccess: ({ json: next }) => { setSalvo(next); setAlterado(false); toast.success("Due Diligence salva"); },
    onError: (error) => toast.error(error.message),
  });
  useEffect(() => { if (!alterado) { setSalvo(json); setDados(lerDueDiligence(json)); } }, [json, alterado]);
  function change(fn: (current: DueDiligence) => DueDiligence) { setDados(fn); setAlterado(true); }
  function edit(id: string, fn: (etapa: Etapa) => Etapa) {
    change((current) => ({ ...current, etapas: current.etapas.map((e) => e.id === id ? fn(e) : e) }));
  }
  function move(index: number, offset: number) {
    change((current) => { const etapas = [...current.etapas]; const [etapa] = etapas.splice(index, 1); etapas.splice(index + offset, 0, etapa); return { ...current, etapas }; });
  }
  const progresso = progressoDueDiligence(dados);
  async function attach(itemId: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    if (alterado) { toast.error("Salve as etapas antes de anexar arquivos."); return; }
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type) || file.size > 3 * 1024 * 1024) { toast.error("Envie PDF, JPG ou PNG de até 3 MiB"); return; }
    if (attachments.some((d) => d.itemId === itemId) && !window.confirm("Substituir o anexo? O histórico permanece.")) return;
    setBusyItem(itemId);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer()); let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      await upload.mutateAsync({ studyId: estudoId, itemId, fileName: file.name, mimeType: file.type as "application/pdf" | "image/jpeg" | "image/png", base64: btoa(binary) });
    } catch { setBusyItem(null); }
  }
  async function open(itemId: string) {
    setBusyItem(itemId);
    try {
      const { base64, mimeType } = await utils.incorporacao.documents.content.fetch({ studyId: estudoId, itemId });
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { toast.error("Não foi possível abrir o documento."); }
    finally { setBusyItem(null); }
  }
  return <section className="space-y-4 text-gray-100" aria-label="Due Diligence">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-bold">Due Diligence</h2><p className="text-sm text-gray-300">{progresso.concluidos}/{progresso.total} tarefas e documentos concluídos ({progresso.percentual}%).</p></div>
      <div className="flex gap-2"><button type="button" onClick={() => change((d) => ({ ...d, etapas: [...d.etapas, novaEtapa()] }))} className="rounded border border-[#C9A961] px-3 py-2">Adicionar etapa</button>
        <button type="button" disabled={!alterado || save.isPending} onClick={() => save.mutate({ studyId: estudoId, expectedJson: salvo, next: { ...dados, versao: dados.versao + 1 } })} className="rounded bg-[#C9A961] text-[#1A2332] px-3 py-2 font-bold disabled:opacity-50">{save.isPending ? "Salvando..." : "Salvar"}</button></div>
    </div>
    {alterado && <p role="status" className="text-amber-200 text-sm">Há alterações não salvas.</p>}
    <div aria-label="Fluxograma das etapas" className="space-y-2">
      {dados.etapas.map((etapa, index) => <div key={etapa.id}>
        {index > 0 && <p className="text-[#C9A961] text-center" aria-hidden="true">↓</p>}
        <article className="rounded border border-[#C9A961]/40 bg-[#0F1923] p-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[#C9A961] font-bold">{index + 1}.</span>
            <input aria-label={`Nome da etapa ${index + 1}`} value={etapa.nome} maxLength={180} onChange={(e) => edit(etapa.id, (old) => ({ ...old, nome: e.target.value }))} className="min-w-0 flex-1 bg-[#2C3E50] p-2 text-white" />
            <button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Mover etapa para cima">↑</button>
            <button type="button" disabled={index === dados.etapas.length - 1} onClick={() => move(index, 1)} aria-label="Mover etapa para baixo">↓</button>
            <button type="button" onClick={() => { if (window.confirm("Excluir esta etapa e seus itens?")) change((d) => ({ ...d, etapas: d.etapas.filter((e) => e.id !== etapa.id) })); }} className="text-red-300">Excluir</button>
          </div>
          <label className="block text-sm">Procedimentos<textarea value={etapa.procedimentos} maxLength={12000} onChange={(e) => edit(etapa.id, (old) => ({ ...old, procedimentos: e.target.value }))} className="block w-full bg-[#2C3E50] p-2 mt-1 text-white" rows={2} /></label>
          <label className="block text-sm">Observações<textarea value={etapa.observacoes} maxLength={12000} onChange={(e) => edit(etapa.id, (old) => ({ ...old, observacoes: e.target.value }))} className="block w-full bg-[#2C3E50] p-2 mt-1 text-white" rows={2} /></label>
          <div className="grid gap-3 md:grid-cols-2">
            <div><div className="flex justify-between"><strong>Tarefas</strong><button type="button" onClick={() => edit(etapa.id, (old) => ({ ...old, tarefas: [...old.tarefas, { id: crypto.randomUUID(), titulo: "Nova tarefa", concluida: false }] }))}>+ Tarefa</button></div>
              {etapa.tarefas.map((t) => <div key={t.id} className="flex gap-2 items-center mt-2"><input type="checkbox" checked={t.concluida} aria-label={`Concluir ${t.titulo}`} onChange={(e) => edit(etapa.id, (old) => ({ ...old, tarefas: old.tarefas.map((v) => v.id === t.id ? { ...v, concluida: e.target.checked } : v) }))} /><input value={t.titulo} maxLength={300} aria-label="Tarefa" className="min-w-0 flex-1 bg-[#2C3E50] p-1" onChange={(e) => edit(etapa.id, (old) => ({ ...old, tarefas: old.tarefas.map((v) => v.id === t.id ? { ...v, titulo: e.target.value } : v) }))} /><button type="button" aria-label="Excluir tarefa" onClick={() => edit(etapa.id, (old) => ({ ...old, tarefas: old.tarefas.filter((v) => v.id !== t.id) }))}>×</button></div>)}</div>
            <div><div className="flex justify-between"><strong>Documentos exigidos</strong><button type="button" onClick={() => edit(etapa.id, (old) => ({ ...old, documentos: [...old.documentos, { id: crypto.randomUUID(), nome: "Novo documento", obtido: false }] }))}>+ Documento</button></div>
              {etapa.documentos.map((doc) => { const itemId = `dd_${etapa.id}_${doc.id}`; const current = attachments.find((a) => a.itemId === itemId); return <div key={doc.id} className="mt-2"><div className="flex gap-2 items-center"><input type="checkbox" checked={doc.obtido} aria-label={`Documento obtido: ${doc.nome}`} onChange={(e) => edit(etapa.id, (old) => ({ ...old, documentos: old.documentos.map((v) => v.id === doc.id ? { ...v, obtido: e.target.checked } : v) }))} /><input value={doc.nome} maxLength={300} aria-label="Documento exigido" className="min-w-0 flex-1 bg-[#2C3E50] p-1" onChange={(e) => edit(etapa.id, (old) => ({ ...old, documentos: old.documentos.map((v) => v.id === doc.id ? { ...v, nome: e.target.value } : v) }))} /><button type="button" aria-label="Excluir documento" onClick={() => edit(etapa.id, (old) => ({ ...old, documentos: old.documentos.filter((v) => v.id !== doc.id) }))}>×</button></div>
                <div className="flex flex-wrap gap-2 text-xs text-[#E8C879] mt-1 pl-6">{current && <button type="button" onClick={() => void open(itemId)}>{current.fileName} ↗</button>}{available?.configured && <label className="cursor-pointer underline">{current ? "Substituir" : "Anexar"}<input type="file" className="sr-only" accept=".pdf,.jpg,.jpeg,.png" disabled={alterado || busyItem !== null} onChange={(e) => void attach(itemId, e)} /></label>}{current && <button type="button" className="text-red-300" disabled={busyItem !== null} onClick={() => { if (window.confirm("Desvincular arquivo? O histórico permanece.")) { setBusyItem(itemId); unlink.mutate({ studyId: estudoId, itemId }); } }}>Desvincular</button>}</div>
              </div>; })}</div>
          </div>
        </article>
      </div>)}
    </div>
  </section>;
}
