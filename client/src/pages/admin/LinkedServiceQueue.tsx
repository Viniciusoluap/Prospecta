import { useEffect, useRef } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { AcoesExcluir } from "@/components/AcoesExcluir";

type Module = "obras" | "tarefas" | "regularizacoes" | "comissoes" | "projetos" | "avaliacoes" | "financiamentos";

/**
 * Módulos em que o vínculo com o lead já cria o registro real (EPIC-017).
 * Financiamentos entram pelo pedido A7: vínculos antigos viram registros ao abrir a fila.
 */
const AUTO_RECORD_MODULES = ["projetos", "regularizacoes", "financiamentos", "tarefas"] as const;
type AutoRecordModule = (typeof AUTO_RECORD_MODULES)[number];
const isAutoRecordModule = (module: Module): module is AutoRecordModule =>
  (AUTO_RECORD_MODULES as readonly string[]).includes(module);

/**
 * Demandas vinculadas no CRM que ainda não têm registro operacional.
 * - Projetos/Regularizações/Financiamentos: o registro é criado automaticamente com os dados
 *   do lead (inclusive para demandas antigas), sem cadastro manual.
 * - Avaliações: `onStart` abre o formulário já com o lead
 *   escolhido; o profissional informa só os dados técnicos do serviço.
 */
export function LinkedServiceQueue({
  module,
  title,
  onStart,
  startLabel = "Iniciar com dados do CRM",
  onRecordsCreated,
  hideCRM = false,
  allowDeletePending = false,
}: {
  module: Module;
  title: string;
  onStart?: (leadId: number) => void;
  startLabel?: string;
  onRecordsCreated?: () => void;
  hideCRM?: boolean;
  allowDeletePending?: boolean;
}) {
  const { data = [], isLoading, error, refetch } = trpc.leadServices.listForModule.useQuery({ module });
  const materialize = trpc.leadServices.materializePending.useMutation();
  const remove = trpc.leadServices.remove.useMutation();
  const pending = data.filter(({ service }) => service.operationalRecordId === null);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current || !isAutoRecordModule(module) || isLoading || pending.length === 0) return;
    attempted.current = true;
    materialize.mutateAsync({ module })
      .then(async result => {
        await refetch();
        if (result.created > 0) onRecordsCreated?.();
      })
      .catch(() => undefined);
  }, [module, isLoading, pending.length]);

  return (
    <section className="rounded-lg border border-[#C9A961]/30 bg-[#243345] p-4 text-white" aria-label={`Vínculos CRM de ${title}`}>
      <h2 className="text-lg font-semibold text-[#E6CA88]">{title} vinculados pelo CRM</h2>
      <p className="mt-1 text-sm text-gray-200">
        {isAutoRecordModule(module)
          ? "Ao vincular o serviço no lead, o registro é criado aqui com os dados do cliente. Complete apenas os dados técnicos."
          : "Demandas do CRM aguardando início. Os dados do cliente são migrados do lead automaticamente."}
      </p>
      {isLoading && <p className="mt-3 text-sm">Carregando vínculos…</p>}
      {materialize.isPending && <p className="mt-3 text-sm" role="status">Criando registros a partir do CRM…</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-200">Não foi possível carregar os vínculos do CRM.</p>}
      {!isLoading && !error && pending.length === 0 && <p className="mt-3 text-sm text-gray-300">Nenhuma demanda pendente.</p>}
      {pending.length > 0 && (
        <ul className="mt-3 divide-y divide-white/15">
          {pending.map(({ service, lead }) => (
            <li key={service.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div><span className="font-medium">{lead.name}</span><span className="ml-2 text-xs text-[#E6CA88]">Aguardando início</span></div>
              <div className="flex flex-wrap gap-2">
                {onStart && (
                  <button
                    type="button"
                    onClick={() => onStart(lead.id)}
                    className="rounded bg-[#C9A961] px-3 py-1 text-sm font-semibold text-[#1A2332] hover:bg-[#B8985A]"
                  >
                    {startLabel}
                  </button>
                )}
                {!hideCRM && <Link href={`/admin/crm/${lead.id}`} className="rounded border border-[#C9A961] px-3 py-1 text-sm text-[#E6CA88] hover:bg-[#C9A961]/20">Ver lead</Link>}
                {allowDeletePending && <AcoesExcluir rotulo={`Solicitação de ${title}: ${lead.name}`} onExcluir={async () => { await remove.mutateAsync({ id: service.id }); await refetch(); }} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
