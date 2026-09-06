import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { HardHat, Stamp, Plus, Trash2, AlertTriangle } from "lucide-react";
import { resumoProjetistas, DISCIPLINAS, type Disciplina, type Projetista, type StatusProjetista } from "@shared/incorporacao/projetistas";
import { resumoAprovacaoProjeto, ORGAOS_APROVACAO, type OrgaoAprovacao, type ProcessoAprovacao, type StatusAprovacao } from "@shared/incorporacao/aprovacao-projeto";

const cardCls = "bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm";
const inputCls = "bg-[#2C3E50] border-[#C9A961]/30 text-white";
const selectCls = "bg-[#2C3E50] border border-[#C9A961]/30 text-white rounded-md px-2 h-9 text-sm w-full";

function Metric({ label, valor, destaque }: { label: string; valor: string; destaque?: boolean }) {
  return (
    <div className={`rounded-lg p-3 border ${destaque ? "bg-[#C9A961]/10 border-[#C9A961]/40" : "bg-[#0F1923] border-[#C9A961]/10"}`}>
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">{label}</p>
      <p className={`font-black text-base leading-tight ${destaque ? "text-[#C9A961]" : "text-white"}`}>{valor}</p>
    </div>
  );
}

export function ProjetistasAprovacao({ estudoId, designersJson, projectApprovalJson }: {
  estudoId: number; designersJson: string | null; projectApprovalJson: string | null;
}) {
  return (
    <div className="space-y-6">
      <Projetistas estudoId={estudoId} designersJson={designersJson} />
      <AprovacaoProjeto estudoId={estudoId} projectApprovalJson={projectApprovalJson} />
    </div>
  );
}

const STATUS_PROJETISTA: { value: StatusProjetista; label: string }[] = [
  { value: "nao_contratado", label: "Não contratado" },
  { value: "contratado", label: "Contratado" },
  { value: "em_desenvolvimento", label: "Em desenvolvimento" },
  { value: "entregue", label: "Entregue" },
  { value: "compatibilizado", label: "Compatibilizado" },
];

function novoProjetista(): Projetista {
  return { id: Math.random().toString(36).slice(2), disciplina: "Arquitetura", empresaOuProfissional: "", status: "nao_contratado" };
}

function Projetistas({ estudoId, designersJson }: { estudoId: number; designersJson: string | null }) {
  const utils = trpc.useUtils();
  const [projetistas, setProjetistas] = useState<Projetista[]>(() => {
    if (designersJson) {
      try { return (JSON.parse(designersJson) as { projetistas?: Projetista[] }).projetistas ?? []; } catch { /* vazio */ }
    }
    return [];
  });

  const saveMutation = trpc.incorporacao.saveProjetistas.useMutation({
    onSuccess: () => { toast.success("Projetistas salvos!"); utils.incorporacao.getById.invalidate({ id: estudoId }); },
    onError: (e) => toast.error(e.message),
  });

  const resumo = useMemo(() => resumoProjetistas(projetistas), [projetistas]);

  function addProjetista() { setProjetistas((l) => [...l, novoProjetista()]); }
  function removerProjetista(id: string) { setProjetistas((l) => l.filter((p) => p.id !== id)); }
  function upd<K extends keyof Projetista>(id: string, campo: K, valor: Projetista[K]) {
    setProjetistas((l) => l.map((p) => (p.id === id ? { ...p, [campo]: valor } : p)));
  }

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <HardHat className="h-5 w-5 text-[#C9A961]" /> Contratação de Projetistas
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-400 max-w-2xl">Um projetista por disciplina. A etapa fica concluída quando todos os projetistas cadastrados estiverem compatibilizados entre si.</p>

        {projetistas.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric label="Projetistas" valor={String(resumo.total)} />
            <Metric label="Contratados" valor={String(resumo.contratados)} />
            <Metric label="Entregues" valor={String(resumo.entregues)} />
            <Metric label="Compatibilizados" valor={`${resumo.pctCompatibilizado}%`} destaque />
          </div>
        )}

        {resumo.atrasados.length > 0 && (
          <div className="bg-red-950/40 border border-red-900/50 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-300">
              {resumo.atrasados.length} projetista(s) com prazo de entrega vencido: {resumo.atrasados.map((p) => p.empresaOuProfissional || p.disciplina).join(", ")}.
            </p>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="text-xs min-w-[720px] w-full">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-40">Disciplina</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-44">Empresa/Profissional</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-32">Contato</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-32">Prazo de entrega</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-40">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {projetistas.map((p) => (
                <tr key={p.id}>
                  <td className="px-1 py-1">
                    <select value={p.disciplina} onChange={(e) => upd(p.id, "disciplina", e.target.value as Disciplina)} className={selectCls}>
                      {DISCIPLINAS.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1"><Input value={p.empresaOuProfissional} onChange={(e) => upd(p.id, "empresaOuProfissional", e.target.value)} className={inputCls} placeholder="Nome" /></td>
                  <td className="px-1 py-1"><Input value={p.contato ?? ""} onChange={(e) => upd(p.id, "contato", e.target.value)} className={inputCls} placeholder="Telefone/e-mail" /></td>
                  <td className="px-1 py-1"><Input type="date" value={p.prazoEntrega ?? ""} onChange={(e) => upd(p.id, "prazoEntrega", e.target.value)} className={inputCls} /></td>
                  <td className="px-1 py-1">
                    <select value={p.status} onChange={(e) => upd(p.id, "status", e.target.value as StatusProjetista)} className={selectCls}>
                      {STATUS_PROJETISTA.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <button type="button" onClick={() => removerProjetista(p.id)} className="text-gray-500 hover:text-red-400 flex justify-center"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={addProjetista} className="flex items-center gap-1 text-xs font-bold text-[#C9A961]">
            <Plus className="h-3.5 w-3.5" /> Adicionar projetista
          </button>
          <Button onClick={() => saveMutation.mutate({ id: estudoId, dataJson: JSON.stringify({ projetistas }) })}
            disabled={saveMutation.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold ml-auto">
            {saveMutation.isPending ? "Salvando..." : "Salvar projetistas"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const STATUS_APROVACAO: { value: StatusAprovacao; label: string }[] = [
  { value: "nao_protocolado", label: "Não protocolado" },
  { value: "protocolado", label: "Protocolado" },
  { value: "em_analise", label: "Em análise" },
  { value: "exigencia", label: "Exigência" },
  { value: "aprovado", label: "Aprovado" },
  { value: "indeferido", label: "Indeferido" },
];

function novoProcesso(): ProcessoAprovacao {
  return { id: Math.random().toString(36).slice(2), orgao: "Prefeitura (projeto arquitetônico)", status: "nao_protocolado" };
}

function AprovacaoProjeto({ estudoId, projectApprovalJson }: { estudoId: number; projectApprovalJson: string | null }) {
  const utils = trpc.useUtils();
  const [processos, setProcessos] = useState<ProcessoAprovacao[]>(() => {
    if (projectApprovalJson) {
      try { return (JSON.parse(projectApprovalJson) as { processos?: ProcessoAprovacao[] }).processos ?? []; } catch { /* vazio */ }
    }
    return [];
  });

  const saveMutation = trpc.incorporacao.saveAprovacaoProjeto.useMutation({
    onSuccess: () => { toast.success("Aprovação do projeto salva!"); utils.incorporacao.getById.invalidate({ id: estudoId }); },
    onError: (e) => toast.error(e.message),
  });

  const resumo = useMemo(() => resumoAprovacaoProjeto(processos), [processos]);

  function addProcesso() { setProcessos((l) => [...l, novoProcesso()]); }
  function removerProcesso(id: string) { setProcessos((l) => l.filter((p) => p.id !== id)); }
  function upd<K extends keyof ProcessoAprovacao>(id: string, campo: K, valor: ProcessoAprovacao[K]) {
    setProcessos((l) => l.map((p) => (p.id === id ? { ...p, [campo]: valor } : p)));
  }

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <Stamp className="h-5 w-5 text-[#C9A961]" /> Projeto Aprovado
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-400 max-w-2xl">Um processo por órgão. A etapa fica concluída quando todos os processos cadastrados estiverem aprovados.</p>

        {processos.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric label="Processos" valor={String(resumo.total)} />
            <Metric label="Protocolados" valor={String(resumo.protocolados)} />
            <Metric label="Com exigência" valor={String(resumo.comExigencia.length)} />
            <Metric label="Aprovados" valor={`${resumo.pctAprovado}%`} destaque />
          </div>
        )}

        {resumo.atrasados.length > 0 && (
          <div className="bg-red-950/40 border border-red-900/50 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-300">
              {resumo.atrasados.length} processo(s) com prazo previsto vencido: {resumo.atrasados.map((p) => p.orgao).join(", ")}.
            </p>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="text-xs min-w-[760px] w-full">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-52">Órgão</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-32">Protocolo</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-32">Prazo previsto</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-32">Status</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-40">Observações</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {processos.map((p) => (
                <tr key={p.id}>
                  <td className="px-1 py-1">
                    <select value={p.orgao} onChange={(e) => upd(p.id, "orgao", e.target.value as OrgaoAprovacao)} className={selectCls}>
                      {ORGAOS_APROVACAO.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1"><Input value={p.numeroProtocolo ?? ""} onChange={(e) => upd(p.id, "numeroProtocolo", e.target.value)} className={inputCls} placeholder="Nº" /></td>
                  <td className="px-1 py-1"><Input type="date" value={p.prazoPrevisto ?? ""} onChange={(e) => upd(p.id, "prazoPrevisto", e.target.value)} className={inputCls} /></td>
                  <td className="px-1 py-1">
                    <select value={p.status} onChange={(e) => upd(p.id, "status", e.target.value as StatusAprovacao)} className={selectCls}>
                      {STATUS_APROVACAO.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1"><Input value={p.observacoes ?? ""} onChange={(e) => upd(p.id, "observacoes", e.target.value)} className={inputCls} placeholder="Observações" /></td>
                  <td className="px-1 py-1">
                    <button type="button" onClick={() => removerProcesso(p.id)} className="text-gray-500 hover:text-red-400 flex justify-center"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={addProcesso} className="flex items-center gap-1 text-xs font-bold text-[#C9A961]">
            <Plus className="h-3.5 w-3.5" /> Adicionar processo
          </button>
          <Button onClick={() => saveMutation.mutate({ id: estudoId, dataJson: JSON.stringify({ processos }) })}
            disabled={saveMutation.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold ml-auto">
            {saveMutation.isPending ? "Salvando..." : "Salvar aprovação"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
