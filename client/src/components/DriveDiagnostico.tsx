import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

/** Teste real do Google Drive (admin): mostra cada etapa e o motivo exato da falha. */
export function DriveDiagnostico() {
  const diagnose = trpc.leadDocuments.diagnoseDrive.useMutation();
  const [aberto, setAberto] = useState(false);
  const r = diagnose.data;
  return <div className="space-y-2 text-xs">
    <Button size="sm" variant="outline" disabled={diagnose.isPending} onClick={() => { setAberto(true); diagnose.mutate(); }}>
      {diagnose.isPending ? "Testando Google Drive…" : "Testar Google Drive"}
    </Button>
    {aberto && r && <div role="status" className={`rounded border p-3 ${r.ok ? "border-emerald-500/40 text-emerald-200" : "border-amber-500/40 text-amber-200"}`}>
      {r.ok ? <p>Google Drive funcionando: os próximos arquivos serão gravados no Drive.</p>
        : <p>Google Drive indisponível. Os arquivos continuam sendo guardados com segurança no banco do sistema.</p>}
      {r.etapas.length > 0 && <ul className="mt-1 list-disc pl-4">{r.etapas.map(e => <li key={e.etapa}>{e.etapa}: ok</li>)}</ul>}
      {r.explicacao && <p className="mt-1">{r.explicacao}</p>}
      {r.driveCompartilhado === false && !r.ok && <p className="mt-1">A pasta configurada está no "Meu Drive" (fora de um Drive compartilhado).</p>}
    </div>}
    {diagnose.error && <p className="text-red-300">{diagnose.error.message}</p>}
  </div>;
}
