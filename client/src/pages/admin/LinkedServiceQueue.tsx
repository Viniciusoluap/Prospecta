import { Link } from "wouter";
import { trpc } from "@/lib/trpc";

type Module = "obras" | "tarefas" | "regularizacoes" | "comissoes" | "projetos" | "avaliacoes" | "financiamentos";

/** Vínculos persistidos no CRM ainda sem os dados técnicos para abrir um processo completo. */
export function LinkedServiceQueue({ module, title }: { module: Module; title: string }) {
  const { data = [], isLoading, error } = trpc.leadServices.listForModule.useQuery({ module });
  const pending = data.filter(({ service }) => service.operationalRecordId === null);
  return (
    <section className="rounded-lg border border-[#C9A961]/30 bg-[#243345] p-4 text-white" aria-label={`Vínculos CRM de ${title}`}>
      <h2 className="text-lg font-semibold text-[#E6CA88]">{title} vinculados pelo CRM</h2>
      <p className="mt-1 text-sm text-gray-200">Demandas aguardando configuração operacional. Nenhuma informação técnica foi presumida.</p>
      {isLoading && <p className="mt-3 text-sm">Carregando vínculos…</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-200">Não foi possível carregar os vínculos do CRM.</p>}
      {!isLoading && !error && pending.length === 0 && <p className="mt-3 text-sm text-gray-300">Nenhuma demanda pendente.</p>}
      {pending.length > 0 && (
        <ul className="mt-3 divide-y divide-white/15">
          {pending.map(({ service, lead }) => (
            <li key={service.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div><span className="font-medium">{lead.name}</span><span className="ml-2 text-xs text-[#E6CA88]">Aguardando configuração</span></div>
              <Link href={`/admin/crm/${lead.id}`} className="rounded border border-[#C9A961] px-3 py-1 text-sm text-[#E6CA88] hover:bg-[#C9A961]/20">Abrir cadastro CRM</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
