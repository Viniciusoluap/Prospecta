// EPIC-025 (Dolores, etapa 3): fila de aprovação — só admin. Cada item mostra o código, o resumo montado pelo sistema, a
// situação e o vencimento. Aprovar executa uma única vez, revalidando tudo na hora; recusar não faz nada no sistema.
// O dono também decide pelo WhatsApp ("aprovar CÓDIGO" / "recusar CÓDIGO").
import { useState } from "react";
import { toast } from "sonner";
import { ListChecks } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const botaoSec = "border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10";
const quando = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleString("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short", timeStyle: "short" }) : "—");
const COR: Record<string, string> = { aguardando: "text-yellow-200", executada: "text-green-300", recusada: "text-gray-300", vencida: "text-gray-400", erro: "text-red-300", executando: "text-blue-200" };

export function DoloresFilaCard() {
  const utils = trpc.useUtils();
  const [filtro, setFiltro] = useState<"aguardando" | "todas">("aguardando");
  const fila = trpc.dolores.fila.listar.useQuery({ situacao: filtro, limite: 50 }, { retry: false });
  const [horas, setHoras] = useState("");
  const recarregar = () => utils.dolores.fila.listar.invalidate();
  const aoDecidir = async (r: { ok: boolean; texto: string }) => { (r.ok ? toast.success : toast.error)(r.texto); await recarregar(); };
  const aprovar = trpc.dolores.fila.aprovar.useMutation({ onSuccess: aoDecidir, onError: e => toast.error(e.message) });
  const recusar = trpc.dolores.fila.recusar.useMutation({ onSuccess: aoDecidir, onError: e => toast.error(e.message) });
  const validade = trpc.dolores.fila.salvarValidade.useMutation({
    onSuccess: async r => { toast.success(`Itens novos vencem em ${r.validadeHoras} h.`); setHoras(""); await recarregar(); },
    onError: e => toast.error(e.message),
  });
  const ocupado = aprovar.isPending || recusar.isPending;

  return (
    <Card className="border-[#C9A961]/20 bg-[#2C3E50] text-gray-100">
      <CardHeader><CardTitle className="flex items-center gap-2 text-[#C9A961]"><ListChecks className="h-5 w-5" /> Dolores — fila de aprovação</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-gray-300">
          Cobranças preparadas e documentos esperam aqui. Nada é enviado a clientes: a cobrança aprovada vai para o histórico do
          cliente e o texto fica pronto para a equipe. O dono também pode responder no WhatsApp "aprovar CÓDIGO" ou "recusar CÓDIGO".
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <Button size="sm" variant="outline" className={botaoSec} onClick={() => setFiltro(filtro === "aguardando" ? "todas" : "aguardando")}>
            {filtro === "aguardando" ? "Ver todos (histórico)" : "Ver só os que aguardam"}
          </Button>
          <div>
            <Label htmlFor="dolores-validade" className="text-xs text-gray-300">Validade dos itens novos (horas; hoje {fila.data?.validadeHoras ?? "—"})</Label>
            <Input id="dolores-validade" inputMode="numeric" value={horas} onChange={e => setHoras(e.target.value.replace(/\D/g, ""))}
              className="mt-1 w-28 bg-[#1A2332] border-[#C9A961]/30 text-white" placeholder="48" />
          </div>
          <Button size="sm" variant="outline" className={botaoSec} disabled={!horas || validade.isPending} onClick={() => validade.mutate({ horas: Number(horas) })}>Salvar validade</Button>
        </div>
        {fila.isLoading ? <p className="text-sm text-gray-300">Carregando…</p> : fila.error ? <p role="alert" className="text-sm text-red-300">{fila.error.message}</p>
          : !fila.data?.itens.length ? <p className="text-sm text-gray-300">{filtro === "aguardando" ? "Nenhum item aguardando aprovação." : "A fila está vazia."}</p> : (
            <ul className="space-y-2">
              {fila.data.itens.map(i => (
                <li key={i.id} className="rounded-lg border border-[#C9A961]/20 bg-[#1A2332] p-2 text-sm">
                  <p><code className="rounded bg-black/30 px-1 text-[#C9A961]">{i.codigo}</code> <span className={COR[i.situacao] ?? ""}>{i.rotuloSituacao}</span>
                    <span className="text-xs text-gray-400"> · pedido em {quando(i.criadoEm)}{i.situacao === "aguardando" ? ` · vence ${quando(i.venceEm)}` : i.decididoEm ? ` · decidido em ${quando(i.decididoEm)} (${i.decididoVia ?? "—"})` : ""}</span></p>
                  <p className="mt-1 text-gray-200">{i.resumo}</p>
                  {i.feitos.length > 0 && <p className="mt-1 text-xs text-green-200">Feito: {i.feitos.join("; ")}</p>}
                  {i.motivo && i.situacao !== "executada" && <p className="mt-1 text-xs text-gray-400">{i.motivo}</p>}
                  {i.situacao === "aguardando" && (
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" disabled={ocupado} className="bg-[#C9A961] font-bold text-[#1A2332] hover:bg-[#B8985A]"
                        onClick={() => { if (window.confirm(`Aprovar ${i.codigo}? A Dolores executa agora, uma única vez, conferindo tudo de novo.`)) aprovar.mutate({ codigo: i.codigo }); }}>Aprovar</Button>
                      <Button size="sm" variant="outline" className={botaoSec} disabled={ocupado} onClick={() => recusar.mutate({ codigo: i.codigo })}>Recusar</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
      </CardContent>
    </Card>
  );
}
