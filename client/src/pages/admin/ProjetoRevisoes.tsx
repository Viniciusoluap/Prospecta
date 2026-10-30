// Lote 23/10, etapa 2C — "Solicitar revisão" de projeto: pedido, histórico e entrega
// da versão revisada no próprio card.
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { uploadProjectDocument } from "@/lib/project-upload";
import { LIMITE_PEDIDO_REVISAO, ROTULO_SITUACAO_REVISAO, rotuloCanal, validarPedidoRevisao, type SituacaoRevisao } from "@shared/projeto-revisao";
import { inputClass } from "./OperationalUI";

const dataHora = (v: string | Date | null | undefined) => (v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

export function SolicitarRevisaoModal({ projeto, onClose }: { projeto: { id: number; name: string; engineer: string }; onClose: () => void }) {
  const [texto, setTexto] = useState("");
  const solicitar = trpc.projetos.solicitarRevisao.useMutation();
  const utils = trpc.useUtils();
  return (
    <Dialog open onOpenChange={aberto => { if (!aberto && !solicitar.isPending) onClose(); }}>
      <DialogContent aria-label="Solicitar revisão" className="bg-white text-slate-900 sm:max-w-xl">
      <form
        className="space-y-3"
        onSubmit={async e => {
          e.preventDefault();
          try {
            validarPedidoRevisao(texto);
            const r = await solicitar.mutateAsync({ projectId: projeto.id, texto });
            (r.mensagem.tipo === "ok" ? toast.success : toast.warning)(r.mensagem.texto);
            await utils.projetos.revisoes.invalidate({ projectId: projeto.id });
            onClose();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Não foi possível salvar o pedido.");
          }
        }}
      >
        <DialogTitle className="text-xl font-bold">Solicitar revisão — {projeto.name}</DialogTitle>
        <DialogDescription className="text-sm text-slate-600">Colaborador vinculado: {projeto.engineer.trim() || "nenhum (o pedido será salvo, mas ninguém será notificado)"}</DialogDescription>
        <label className="block text-sm font-semibold" htmlFor="pedido-revisao">Modificação solicitada</label>
        <textarea id="pedido-revisao" className={`${inputClass} min-h-40`} maxLength={LIMITE_PEDIDO_REVISAO} value={texto} onChange={e => setTexto(e.target.value)} required />
        <p className="text-xs text-slate-500">{texto.length}/{LIMITE_PEDIDO_REVISAO}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={solicitar.isPending}>{solicitar.isPending ? "Salvando…" : "Enviar pedido"}</Button>
        </div>
      </form>
      </DialogContent>
    </Dialog>
  );
}

export function RevisoesProjeto({ projectId }: { projectId: number }) {
  const revisoes = trpc.projetos.revisoes.useQuery({ projectId });
  const [enviando, setEnviando] = useState<string | null>(null);
  const [progresso, setProgresso] = useState(0);
  return (
    <section className="space-y-2">
      <h3 className="font-semibold">Revisões</h3>
      {revisoes.isLoading && <p className="text-sm">Carregando…</p>}
      {revisoes.error && <p className="text-sm text-red-700">Não foi possível carregar as revisões.</p>}
      {revisoes.data && !revisoes.data.length && <p className="text-sm text-slate-600">Nenhuma revisão solicitada.</p>}
      {revisoes.data?.map(r => (
        <article key={r.id} className="space-y-1 rounded border p-3 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${r.status === "entregue" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>{ROTULO_SITUACAO_REVISAO[r.status as SituacaoRevisao] ?? r.status}</span>
            <span>Pedido por {r.requestedByName} em {dataHora(r.createdAt)}</span>
          </p>
          <p className="whitespace-pre-wrap">{r.requestText}</p>
          <p className="text-xs text-slate-600">{rotuloCanal("notificacao", r.notificationStatus)} · {rotuloCanal("email", r.emailStatus)}</p>
          {r.deliveries.length > 0 && (
            <ul className="space-y-0.5">
              {r.deliveries.map(d => <li key={d.driveFileId}><a className="underline" href={d.url} target="_blank" rel="noopener noreferrer">{d.tipo === "pdf" ? "PDF" : "Editável"}: {d.nome}</a> — entregue por {d.enviadoPor} em {dataHora(d.enviadoEm)}</li>)}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            {(["editable", "pdf"] as const).map(kind => (
              <label key={kind} className="cursor-pointer rounded border px-3 py-1.5 text-xs">
                {kind === "pdf" ? "Entregar PDF revisado" : "Entregar editável revisado"}
                <input className="hidden" type="file" accept={kind === "pdf" ? ".pdf,application/pdf" : undefined} disabled={!!enviando} onChange={async e => {
                  const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
                  setEnviando(`${r.id}-${kind}`); setProgresso(0);
                  try {
                    await uploadProjectDocument(`/api/projetos/${projectId}/documentos`, file, `revisao-${r.id}`, kind, setProgresso, { revisionId: r.id });
                    await revisoes.refetch();
                    toast.success("Versão revisada salva no Google Drive.");
                  } catch (error) { toast.error(error instanceof Error ? error.message : "Falha no envio."); }
                  finally { setEnviando(null); }
                }} />
              </label>
            ))}
          </div>
        </article>
      ))}
      {enviando && <p role="status" className="text-sm">Enviando ao Google Drive: {progresso}%</p>}
    </section>
  );
}
