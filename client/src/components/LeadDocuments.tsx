import { CLIENT_DOCUMENT_CHECKLIST } from "@shared/client-document-checklist";
import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { DriveDiagnostico } from "@/components/DriveDiagnostico";
import { rotulo } from "@shared/rotulos";
import { mutarComProgresso } from "@/lib/envio-progresso";

const categories = CLIENT_DOCUMENT_CHECKLIST;
type Category = typeof categories[number][0];

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Falha na leitura do arquivo"));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

export function LeadDocuments({ leadId, admin = false }: { leadId?: number; admin?: boolean }) {
  const utils = trpc.useUtils();
  const list = trpc.leadDocuments.list.useQuery(leadId ? { leadId } : undefined);
  const visibility = trpc.leadDocuments.visibility.useQuery(leadId ? { leadId } : undefined);
  const setVisibility = trpc.leadDocuments.setVisibility.useMutation({ onSuccess: () => { void visibility.refetch(); void list.refetch(); }, onError: error => toast.error(error.message) });
  const services = trpc.leadServices.listByLead.useQuery({ leadId: leadId ?? 0 }, { enabled: admin && Boolean(leadId) });
  type ResultadoUpload = { duplicate?: boolean; storage?: string; storageNote?: string | null };
  const avisarResultado = (result: ResultadoUpload) => {
    if (result.duplicate) toast.success("Arquivo já recebido");
    else if (result.storage === "banco") {
      toast.success("Documento salvo no sistema");
      if (admin && result.storageNote) toast.warning(`Google Drive indisponível: ${result.storageNote}`, { duration: 15000 });
    } else toast.success("Documento salvo no Google Drive");
  };
  const remove = trpc.leadDocuments.remove.useMutation({
    onSuccess: () => { toast.success("Documento removido da consulta"); void utils.leadDocuments.list.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const request = trpc.leadDocuments.request.useMutation({
    onSuccess: result => { toast.success("Documento solicitado no portal do cliente"); if (result.emailWarning) toast.warning(result.emailWarning); void utils.leadDocuments.list.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Category>("rg");
  const [serviceId, setServiceId] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);

  async function filesSelected(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    const lista = Array.from(files);
    try {
      for (let i = 0; i < lista.length; i++) {
        const file = lista[i];
        if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type) || !file.size || file.size > 3 * 1024 * 1024) {
          toast.error(`${file.name}: use PDF, JPG ou PNG de até 3 MiB`);
          continue;
        }
        const requestedService = list.data?.find(document => document.type === selected && document.status === "pending" && document.serviceId)?.serviceId;
        // Item 4 (18/10): progresso real de cada arquivo ("Enviando documento 2 de 4 — 65%").
        try {
          const result = await mutarComProgresso<ResultadoUpload>(
            "leadDocuments.upload",
            { leadId, serviceId: serviceId ?? requestedService ?? undefined, type: selected, fileName: file.name, mimeType: file.type as "application/pdf" | "image/jpeg" | "image/png", base64: await readBase64(file) },
            { item: "documento", atual: i + 1, total: lista.length }
          );
          avisarResultado(result);
        } catch (error) {
          toast.error(`${file.name}: ${error instanceof Error ? error.message : "falha no envio"}`);
        }
      }
    } finally {
      setBusy(false);
      void utils.leadDocuments.list.invalidate();
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function openDocument(id: number) {
    try {
      const content = await utils.leadDocuments.content.fetch({ id });
      const bytes = Uint8Array.from(atob(content.base64), char => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: content.mimeType }));
      const link = document.createElement("a");
      link.href = url;
      link.download = content.fileName || "documento";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao consultar documento"); }
  }

  // Item 17 (18/10): no Portal do Cliente o fundo é claro — textos escuros; no admin, claros.
  const suave = admin ? "text-gray-300" : "text-slate-600";
  return <div className={`space-y-3 text-sm ${admin ? "" : "text-[#1A2332]"}`}>
    {admin && <DriveDiagnostico />}
    {admin && services.data && <label className="block">Serviço documental
      <select className="ml-2 rounded border border-[#C9A961]/30 bg-[#1A2332] p-2 text-white" value={serviceId ?? ""} onChange={event => setServiceId(event.target.value ? Number(event.target.value) : undefined)}>
        <option value="">CRM geral</option>
        {services.data.map(service => <option key={service.id} value={service.id}>{service.title || service.serviceType} (#{service.id})</option>)}
      </select>
    </label>}
    <input ref={inputRef} className="sr-only" type="file" multiple accept="application/pdf,image/jpeg,image/png" onChange={event => void filesSelected(event.target.files)} aria-label="Selecionar documentos" />
    {categories.map(([key, label]) => {
      const visible = visibility.data?.find(row => row.type === key)?.visibleToClient ?? true;
      if (!admin && !visible) return null;
      const docs = list.data?.filter(document => document.type === key) ?? [];
      const pending = docs.some(document => document.status === "pending" && !document.canOpen);
      return <div key={key} className="rounded border border-[#C9A961]/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><strong>{label}</strong><span className={`ml-2 text-xs ${suave}`}>{pending ? "Solicitado" : docs.length ? `${docs.length} registro(s)` : "Pendente"}</span></div>
          <div className="flex gap-2">
            {admin && leadId && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={visible} onChange={event => setVisibility.mutate({ leadId, type: key, visibleToClient: event.target.checked })} />Visível ao cliente</label>}
            {admin && leadId && <Button size="sm" variant="outline" onClick={() => request.mutate({ leadId, serviceId, type: key })} disabled={request.isPending || !visible}>Solicitar</Button>}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => { setSelected(key); inputRef.current?.click(); }}>Enviar</Button>
          </div>
        </div>
        {docs.map(document => <div key={document.id} className={`mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs ${admin ? "border-white/10" : "border-slate-200"}`}>
          <span className="min-w-0 break-words">{document.fileName || "Solicitação documental"} · {rotulo(document.status)} · {document.uploadedAt ? new Date(document.uploadedAt).toLocaleString("pt-BR") : "Pendente"} {document.uploadedByUserId ? `· usuário #${document.uploadedByUserId}` : ""}</span>
          <div className="flex gap-2">
            {document.canOpen && <Button size="sm" variant="outline" onClick={() => void openDocument(document.id)}>Consultar</Button>}
            {admin && <Button size="sm" variant="outline" onClick={() => { if (window.confirm("Remover este registro da consulta?")) remove.mutate({ id: document.id }); }}>Remover</Button>}
          </div>
        </div>)}
      </div>;
    })}
    {admin && list.data?.some(doc => !categories.some(([key]) => key === doc.type)) && <details className="rounded border border-white/20 p-3"><summary>Documentos anteriores</summary>{list.data.filter(doc => !categories.some(([key]) => key === doc.type)).map(doc => <div key={doc.id} className="mt-2 flex items-center justify-between gap-2"><span>{doc.fileName || doc.type}</span>{doc.canOpen && <Button size="sm" variant="outline" onClick={() => void openDocument(doc.id)}>Consultar</Button>}</div>)}</details>}
  </div>;
}
