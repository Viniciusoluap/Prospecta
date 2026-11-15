// Maquete 3D (EPIC-022, etapa 4) — aba do estudo de Incorporação: pedir a maquete do empreendimento (loteamento,
// condomínio ou prédio), acompanhar a situação e abrir o pedido. Não tem cobrança, mas só é gerada depois da
// autorização do administrador. A produção e a revisão acontecem no módulo Maquete 3D.
import { useState } from "react";
import { Link } from "wouter";
import { Box } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import type { EstudoData } from "@shared/incorporacao/estudo-data";
import { ROTULOS_TIPO, type TipoMaquete } from "@shared/maquete-3d/modelo";
import { ROTULOS_STATUS } from "@shared/maquete-3d/regras";

const TIPOS_DO_ESTUDO: TipoMaquete[] = ["loteamento", "condominio", "predio"];

export function Maquete3DTab({ estudo }: { estudo: EstudoData }) {
  const studyId = Number(estudo.id);
  const utils = trpc.useUtils();
  const lista = trpc.maquete3d.listar.useQuery({ studyId }, { enabled: Number.isFinite(studyId) });
  const [tipo, setTipo] = useState<TipoMaquete>(estudo.tipoIncorporacao === "vertical" ? "predio" : "loteamento");
  const criar = trpc.maquete3d.criar.useMutation({
    onSuccess: () => { toast.success("Pedido criado. Aguardando a autorização do administrador."); void utils.maquete3d.listar.invalidate(); },
    onError: e => toast.error(e.message),
  });
  return (
    <div className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 text-lg font-semibold"><Box className="h-5 w-5 text-[#C9A961]" />Maquete 3D do empreendimento</h3>
        <p className="text-sm text-muted-foreground">Implantação em 3D com as ruas e os lotes do estudo de massa, coloridos pela situação de venda das unidades. Sem cobrança; precisa da autorização do administrador.</p>
      </div>
      {lista.error && <p className="text-sm text-red-500">{lista.error.message}</p>}
      {lista.data?.map(m => (
        <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
          <div><p className="font-medium">{m.titulo}</p><p className="text-muted-foreground">{ROTULOS_TIPO[m.tipo as TipoMaquete]} · {ROTULOS_STATUS[m.status]}</p></div>
          <Link href={`/admin/maquete-3d/${m.id}`}><Button type="button" variant="outline" size="sm">Abrir o pedido</Button></Link>
        </div>
      ))}
      {lista.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma maquete pedida para este estudo.</p>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Tipo de maquete
          <select className="mt-1 block h-9 rounded-md border bg-background px-2" value={tipo} onChange={e => setTipo(e.target.value as TipoMaquete)}>
            {TIPOS_DO_ESTUDO.map(t => <option key={t} value={t}>{ROTULOS_TIPO[t]}</option>)}
          </select></label>
        <Button type="button" disabled={criar.isPending || !Number.isFinite(studyId)} onClick={() => criar.mutate({ origem: "incorporacao", alvoId: studyId, tipo, documentos: [] })}>Pedir maquete 3D</Button>
      </div>
    </div>
  );
}
