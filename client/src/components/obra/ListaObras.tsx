import { formatarPercentual, progressoDaObra } from "@shared/financeiro/progresso";
import { obraStatusLabel, OBRA_STATUS_TODOS } from "@shared/obra-status";
import { FILTROS_OBRAS_VAZIOS, filtrarObras, filtrosAtivos, type FiltrosObras, type OrdemObras } from "@shared/obras-filtro";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AcoesExcluir } from "@/components/AcoesExcluir";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { Building2, Calendar, DollarSign, User } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";

// Lista de obras com filtros e cards (item 01). Usada pelo admin (/admin/obras) e,
// desde 15/10, pelo Portal do Empreiteiro — mesmos filtros (exceto "Responsável")
// e mesmos cards, sem o botão Excluir.

export type ObraDaLista = inferRouterOutputs<AppRouter>["construction"]["allProjects"][number];

function IntervaloDatas({ titulo, de, ate, onDe, onAte }: { titulo: string; de: string; ate: string; onDe: (v: string) => void; onAte: (v: string) => void }) {
  const campo = "mt-1 w-full min-w-0 bg-[#1A2332] border-[#C9A961]/30 text-white";
  return (
    <fieldset className="min-w-0">
      <legend>{titulo}</legend>
      <div className="grid grid-cols-2 gap-2">
        <label className="min-w-0 text-[11px] text-gray-400">De<Input type="date" aria-label={`${titulo}: de`} value={de} onChange={(e) => onDe(e.target.value)} className={campo} /></label>
        <label className="min-w-0 text-[11px] text-gray-400">Até<Input type="date" aria-label={`${titulo}: até`} value={ate} onChange={(e) => onAte(e.target.value)} className={campo} /></label>
      </div>
    </fieldset>
  );
}

const statusColors: Record<string, string> = {
  planning: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  in_progress: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  paused: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  completed: "bg-green-500/20 text-green-300 border-green-500/30",
  cancelled: "bg-red-500/20 text-red-300 border-red-500/30",
  alvara: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  art: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  assinatura_cef: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  vistoria_cef: "bg-teal-500/20 text-teal-300 border-teal-500/30",
  laudo_ok: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  cartorio: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  casa_pronta: "bg-green-600/20 text-green-300 border-green-600/30",
  disponivel: "bg-lime-500/20 text-lime-300 border-lime-500/30",
  reavaliar: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  distrato: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  aprovacao: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  contrato_prospecta: "bg-amber-600/20 text-amber-300 border-amber-600/30",
  laudo_cef: "bg-emerald-600/20 text-emerald-300 border-emerald-600/30",
  conformidade_cef: "bg-teal-600/20 text-teal-300 border-teal-600/30",
};

export function ListaObras({ projects, caminhoEditar, caminhoDetalhes, filtroResponsavel = true, onExcluir }: {
  projects: ObraDaLista[];
  caminhoEditar: (id: number) => string;
  caminhoDetalhes: (id: number) => string;
  /** O empreiteiro não filtra por responsável (pedido de 15/10). */
  filtroResponsavel?: boolean;
  /** Só o admin exclui obras. */
  onExcluir?: (obra: ObraDaLista) => Promise<void>;
}) {
  const [filtros, setFiltros] = useState<FiltrosObras>(FILTROS_OBRAS_VAZIOS);
  const set = <K extends keyof FiltrosObras>(campo: K, valor: FiltrosObras[K]) => setFiltros((f) => ({ ...f, [campo]: valor }));
  // Item 01: todos os filtros funcionam juntos (shared/obras-filtro, igual ao Santa Fé).
  const filtradas = useMemo(() => filtrarObras(projects.map((p) => ({
    ...p, codigo: `#${p.id}`, nome: p.title, cliente: p.clientName ?? "",
    responsaveis: [p.contractorName, p.crmResponsibleName, p.brokerName],
    criadoEm: p.createdAt, inicio: p.startDate, fim: p.actualEndDate ?? p.estimatedEndDate,
  })), filtros), [projects, filtros]);
  const ativos = filtrosAtivos(filtros);

  return (
          <div className="grid gap-6">
            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20">
              <CardContent className="pt-6 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs text-gray-300">
                  <label>Nome da obra<Input value={filtros.nome} onChange={(e) => set("nome", e.target.value)} placeholder="Buscar obra" className="mt-1 bg-[#1A2332] border-[#C9A961]/30 text-white" /></label>
                  <label>Cliente<Input value={filtros.cliente} onChange={(e) => set("cliente", e.target.value)} placeholder="Nome do cliente" className="mt-1 bg-[#1A2332] border-[#C9A961]/30 text-white" /></label>
                  <label>Código<Input value={filtros.codigo} onChange={(e) => set("codigo", e.target.value)} placeholder="#123" className="mt-1 bg-[#1A2332] border-[#C9A961]/30 text-white" /></label>
                  {filtroResponsavel && <label>Responsável<Input value={filtros.responsavel} onChange={(e) => set("responsavel", e.target.value)} placeholder="Empreiteiro, responsável ou corretor" className="mt-1 bg-[#1A2332] border-[#C9A961]/30 text-white" /></label>}
                </div>
                {/* Datas com espaço próprio: cada intervalo ocupa a sua coluna, com "De" e "Até"
                    lado a lado e encolhendo junto (pedido A3, 13/10/2026). */}
                <div className="grid grid-cols-1 gap-3 text-xs text-gray-300 md:grid-cols-2 xl:grid-cols-3">
                  <label className="min-w-0">Situação
                    <select value={filtros.status} onChange={(e) => set("status", e.target.value)} className="mt-1 h-9 w-full rounded-md border border-[#C9A961]/30 bg-[#1A2332] px-2 text-sm text-white">
                      <option value="">Todas</option>
                      {OBRA_STATUS_TODOS.map((s) => <option key={s} value={s}>{obraStatusLabel(s)} ({projects.filter((p) => p.status === s).length})</option>)}
                    </select>
                  </label>
                  <IntervaloDatas titulo="Período de execução" de={filtros.periodoDe} ate={filtros.periodoAte} onDe={(v) => set("periodoDe", v)} onAte={(v) => set("periodoAte", v)} />
                  <IntervaloDatas titulo="Data de criação" de={filtros.criadoDe} ate={filtros.criadoAte} onDe={(v) => set("criadoDe", v)} onAte={(v) => set("criadoAte", v)} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-300">
                  <label className="flex items-center gap-2">Ordenar
                    <select value={filtros.ordem} onChange={(e) => set("ordem", e.target.value as OrdemObras)} className="h-9 rounded-md border border-[#C9A961]/30 bg-[#1A2332] px-2 text-sm text-white">
                      <option value="recentes">Mais recentes</option><option value="antigas">Mais antigas</option><option value="az">Nome A–Z</option><option value="za">Nome Z–A</option>
                    </select>
                  </label>
                  <div className="flex items-center gap-3">
                    <span>{filtradas.length} de {projects.length} obra(s){ativos ? ` · ${ativos} filtro(s) ativo(s)` : ""}</span>
                    <Button type="button" variant="outline" size="sm" className="border-[#C9A961]/50 text-[#C9A961]" disabled={!ativos && filtros.ordem === "recentes"} onClick={() => setFiltros(FILTROS_OBRAS_VAZIOS)}>Limpar filtros</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
            {filtradas.length === 0 && <p className="text-center text-gray-400">Nenhuma obra encontrada com esses filtros.</p>}
            {filtradas.map((project) => (
              <Card key={project.id} className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm hover:border-[#C9A961]/40 transition-all">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-[#C9A961] text-xl mb-2">{project.title} <span className="text-xs font-mono text-gray-400">{project.codigo}</span></CardTitle>
                      <CardDescription className="text-gray-400">
                        {project.address || "Endereço não informado"}
                      </CardDescription>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-sm border ${statusColors[project.status]}`}>
                      {obraStatusLabel(project.status)}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                    <div className="flex items-center gap-2 text-gray-300">
                      <User className="h-4 w-4 text-[#C9A961]" />
                      <span className="text-sm">{project.clientName ?? (project.leadId ? `Cliente CRM #${project.leadId}` : project.userId ? `Conta #${project.userId}` : "Cliente ainda não vinculado")}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-300">
                      <Building2 className="h-4 w-4 text-[#C9A961]" />
                      <span className="text-sm">{project.projectType || "Tipo não definido"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-300">
                      <Calendar className="h-4 w-4 text-[#C9A961]" />
                      <span className="text-sm">
                        {project.startDate ? new Date(project.startDate).toLocaleDateString("pt-BR") : "Sem data"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-300">
                      <DollarSign className="h-4 w-4 text-[#C9A961]" />
                      <span className="text-sm">
                        {/* Mesmo campo "Orçamento Previsto" do editor da obra (Valores da Operação/Custos). */}
                        {project.contractValue
                          ? `Orçamento ${parseFloat(project.contractValue).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`
                          : "Orçamento não informado"}
                      </span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-400">Progresso</span>
                      <span className="text-sm font-semibold text-[#C9A961]">{formatarPercentual(progressoDaObra(project.progressMeasuredPct, project.progress))}</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2">
                      <div
                        className="bg-gradient-to-r from-[#C9A961] to-[#FFD700] h-2 rounded-full transition-all"
                        style={{ width: `${Math.min(100, progressoDaObra(project.progressMeasuredPct, project.progress))}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Link href={caminhoEditar(project.id)} className="flex-1">
                      <Button variant="outline" className="w-full border-[#C9A961] text-[#C9A961] hover:bg-[#C9A961]/10">
                        Editar Obra
                      </Button>
                    </Link>
                    <Link href={caminhoDetalhes(project.id)}>
                      <Button variant="ghost" className="text-gray-300 hover:text-[#C9A961]">
                        Ver Detalhes
                      </Button>
                    </Link>
                    {onExcluir && <AcoesExcluir rotulo={project.title} onExcluir={() => onExcluir(project)} />}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
  );
}
