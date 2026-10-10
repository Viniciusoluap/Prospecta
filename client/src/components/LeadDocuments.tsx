import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const categories = [
  ["rg", "RG / CNH"], ["cnh", "CNH frente e verso"],
  ["address_proof", "Comprovante de endereço"],
  ["income_proof_formal", "Comprovante de renda"],
  ["income_proof_irpf", "Declaração IRPF"], ["fgts", "Extrato FGTS"],
  ["spouse_docs", "Documentos do cônjuge / segundo titular"],
  ["pis", "PIS"], ["other", "Outros"],
] as const;
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
  const availability = trpc.leadDocuments.available.useQuery();
  const services = trpc.leadServices.listByLead.useQuery({ leadId: leadId ?? 0 }, { enabled: admin && Boolean(leadId) });
  const upload = trpc.leadDocuments.upload.useMutation({
    onSuccess: result => { toast.success(result.duplicate ? "Arquivo já recebido" : "Documento enviado ao Google Drive"); void utils.leadDocuments.list.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const remove = trpc.leadDocuments.remove.useMutation({
    onSuccess: () => { toast.success("Documento removido da consulta"); void utils.leadDocuments.list.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const request = trpc.leadDocuments.request.useMutation({
    onSuccess: () => { toast.success("Documento solicitado"); void utils.leadDocuments.list.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Category>("rg");
  const [serviceId, setServiceId] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);

  async function filesSelected(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type) || !file.size || file.size > 3 * 1024 * 1024) {
          toast.error(`${file.name}: use PDF, JPG ou PNG de até 3 MiB`);
          continue;
        }
        const requestedService = list.data?.find(document => document.type === selected && document.status === "pending" && document.serviceId)?.serviceId;
        await upload.mutateAsync({ leadId, serviceId: serviceId ?? requestedService ?? undefined, type: selected, fileName: file.name, mimeType: file.type as "application/pdf" | "image/jpeg" | "image/png", base64: await readBase64(file) });
      }
    } finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
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

  return <div className="space-y-3 text-sm">
    {!availability.data?.configured && <p className="rounded border border-amber-500/40 p-3 text-amber-200" role="status">Envio temporariamente indisponível: conexão privada com Google Drive pendente.</p>}
    {admin && services.data && <label className="block">Serviço documental
      <select className="ml-2 rounded border border-[#C9A961]/30 bg-[#1A2332] p-2 text-white" value={serviceId ?? ""} onChange={event => setServiceId(event.target.value ? Number(event.target.value) : undefined)}>
        <option value="">CRM geral</option>
        {services.data.map(service => <option key={service.id} value={service.id}>{service.title || service.serviceType} (#{service.id})</option>)}
      </select>
    </label>}
    <input ref={inputRef} className="sr-only" type="file" multiple accept="application/pdf,image/jpeg,image/png" onChange={event => void filesSelected(event.target.files)} aria-label="Selecionar documentos" />
    {categories.map(([key, label]) => {
      const docs = list.data?.filter(document => document.type === key) ?? [];
      const pending = docs.some(document => document.status === "pending" && !document.canOpen);
      return <div key={key} className="rounded border border-[#C9A961]/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><strong>{label}</strong><span className="ml-2 text-xs text-gray-300">{pending ? "Solicitado" : docs.length ? `${docs.length} registro(s)` : "Pendente"}</span></div>
          <div className="flex gap-2">
            {admin && leadId && <Button size="sm" variant="outline" onClick={() => request.mutate({ leadId, serviceId, type: key })} disabled={request.isPending}>Solicitar</Button>}
            <Button size="sm" variant="outline" disabled={!availability.data?.configured || busy} onClick={() => { setSelected(key); inputRef.current?.click(); }}>Enviar</Button>
          </div>
        </div>
        {docs.map(document => <div key={document.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2 text-xs">
          <span>{document.fileName || "Solicitação documental"} · {document.status} · {document.uploadedAt ? new Date(document.uploadedAt).toLocaleString("pt-BR") : "Pendente"} {document.uploadedByUserId ? `· usuário #${document.uploadedByUserId}` : ""}</span>
          <div className="flex gap-2">
            {document.canOpen && <Button size="sm" variant="outline" onClick={() => void openDocument(document.id)}>Consultar</Button>}
            {admin && <Button size="sm" variant="outline" onClick={() => { if (window.confirm("Remover este registro da consulta?")) remove.mutate({ id: document.id }); }}>Remover</Button>}
          </div>
        </div>)}
      </div>;
    })}
  </div>;
}
