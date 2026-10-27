import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { IncorporacaoDetail } from "@/components/incorporacao/estudo/incorporacao-detail";
import { registrarRecarregamentoEstudo } from "@/components/incorporacao/estudo/compat/acoes";
import { paraEstudoData } from "@shared/incorporacao/estudo-data";

const STATUS_OPTIONS = [
  { value: "in_study", label: "Em estudo" },
  { value: "unfeasible", label: "Inviável" },
  { value: "in_progress", label: "Em andamento" },
  { value: "completed", label: "Concluído" },
];
const TIPOS = [
  { value: "desmembramento_simples", label: "Desmembramento Simples" },
  { value: "residencial", label: "Residencial" },
  { value: "vertical", label: "Vertical" },
  { value: "loteamento", label: "Loteamento" },
] as const;

const SEM_RESPONSAVEL = "nenhum";

function papelResponsavel(u: { role: string; engenheiro?: boolean; active: boolean }) {
  const papel = u.engenheiro ? "Engenheiro" : u.role === "admin" ? "Administrador" : "Colaborador";
  return u.active ? papel : `${papel} (inativo)`;
}

export default function AdminIncorporacaoDetail() {
  const { id } = useParams<{ id: string }>();
  const utils = trpc.useUtils();

  const { data: estudo, isLoading } = trpc.incorporacao.getById.useQuery({ id: Number(id) });
  const { data: versoes = [] } = trpc.incorporacao.versions.useQuery({ id: Number(id) }, { enabled: !!Number(id) });
  const { data: equipe = [] } = trpc.incorporacao.staff.useQuery();
  const [erroVersao, setErroVersao] = useState("");
  // As abas do estudo (portadas do Santa Fé) recarregam o estudo depois de cada gravação.
  useEffect(() => { registrarRecarregamentoEstudo(() => utils.incorporacao.getById.invalidate({ id: Number(id) })); }, [id, utils]);
  const estudoSf = useMemo(() => estudo ? {
    ...paraEstudoData(estudo),
    versaoNumero: versoes[0]?.revision ?? null,
    colaboradores: equipe.filter((u) => u.active).map((u) => ({ id: String(u.id), nome: u.name ?? "" })),
  } : null, [estudo, versoes, equipe]);

  async function baixarVersao(revision: number) {
    setErroVersao("");
    try {
      const version = await utils.incorporacao.versionSnapshot.fetch({ id: Number(id), revision });
      const url = URL.createObjectURL(new Blob([version.snapshot], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `estudo-${id}-versao-${revision}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) { setErroVersao(e instanceof Error ? e.message : "Falha ao obter a versão"); }
  }

  // Correção 08: Matrícula, CAR e Zoneamento saíram do formulário (colunas e
  // relatório preservados); o responsável é escolhido entre os usuários e salvo por ID.
  const [form, setForm] = useState({ name: "", city: "", state: "", address: "", responsibleUserId: SEM_RESPONSAVEL, status: "in_study", incorporationType: "" });

  useEffect(() => {
    if (estudo) {
      setForm({
        name: estudo.name ?? "",
        city: estudo.city ?? "",
        state: estudo.state ?? "",
        address: estudo.address ?? "",
        responsibleUserId: estudo.responsibleUserId != null ? String(estudo.responsibleUserId) : SEM_RESPONSAVEL,
        status: STATUS_OPTIONS.some((option) => option.value === estudo.status) ? estudo.status : "",
        incorporationType: estudo.incorporationType ?? "",
      });
    }
  }, [estudo]);

  // Usuários ativos admin/colaborador (+ o responsável atual, mesmo inativo, para não sumir da tela).
  const opcoesResponsavel = equipe.filter((u) => u.active || (estudo?.responsibleUserId != null && u.id === estudo.responsibleUserId));

  const updateMutation = trpc.incorporacao.update.useMutation({
    onSuccess: () => {
      toast.success("Estudo atualizado!");
      utils.incorporacao.getById.invalidate({ id: Number(id) });
      utils.incorporacao.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSave = () => {
    const responsavelEscolhido = form.responsibleUserId === SEM_RESPONSAVEL ? null : Number(form.responsibleUserId);
    if (!form.status) {
      toast.error("Classifique a situação antiga deste estudo antes de salvar.");
      return;
    }
    updateMutation.mutate({
      id: Number(id),
      name: form.name,
      city: form.city,
      state: form.state || undefined,
      address: form.address || undefined,
      // só envia quando o responsável mudou (estudos antigos mantêm o texto legado
      // até alguém escolher um usuário; responsável inativo não é revalidado)
      ...(responsavelEscolhido !== (estudo?.responsibleUserId ?? null) ? { responsibleUserId: responsavelEscolhido } : {}),
      status: form.status as "in_study" | "unfeasible" | "in_progress" | "completed",
      incorporationType: form.incorporationType ? form.incorporationType as (typeof TIPOS)[number]["value"] : undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#1A2332] text-white flex items-center justify-center">
        <p className="text-gray-400">Carregando...</p>
      </div>
    );
  }

  if (!estudo || !estudoSf) {
    return (
      <div className="min-h-screen bg-[#1A2332] text-white flex items-center justify-center">
        <p className="text-gray-400">Estudo não encontrado.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <div className="bg-[#0F1923] border-b border-[#C9A961]/20 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <Link href="/admin/incorporacao">
            <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold text-[#C9A961] truncate">{estudo.name}</h1>
        </div>
      </div>

      {/* Estrutura, cálculos e gráficos idênticos ao Grupo Santa Fé (item 10); só as cores são as da Prospecta. */}
      <div className="bg-[#F4F4F2] text-[var(--brand-dark)] min-h-screen" style={{ "--brand-dark": "#1A2332", "--brand-yellow": "#C9A961" } as React.CSSProperties}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <IncorporacaoDetail estudo={estudoSf} dadosGerais={
        <div className="space-y-6">
        <Card className="bg-[#1A2332] border-[#C9A961]/20 text-white">
          <CardHeader>
            <CardTitle className="text-white text-lg">Dados Gerais</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Label className="text-gray-300">Nome do empreendimento</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Cidade</Label>
                <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                  className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">UF</Label>
                <Input value={form.state} maxLength={2}
                  onChange={(e) => setForm((f) => ({ ...f, state: e.target.value.toUpperCase() }))}
                  className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-gray-300">Endereço do terreno</Label>
                <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Responsável</Label>
                <Select value={form.responsibleUserId} onValueChange={(v) => setForm((f) => ({ ...f, responsibleUserId: v }))}>
                  <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"><SelectValue placeholder="Selecione o responsável" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_RESPONSAVEL}>Sem responsável definido</SelectItem>
                    {opcoesResponsavel.map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>{u.name ?? `Usuário ${u.id}`} — {papelResponsavel(u)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {estudo.responsibleUserId == null && estudo.responsible && (
                  <p className="text-xs text-gray-400 mt-1">Registrado antes como texto: “{estudo.responsible}”. Selecione o usuário correspondente.</p>
                )}
              </div>
              <div>
                <Label className="text-gray-300">Situação</Label>
                <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                  <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1">
                    <SelectValue placeholder="Classificar situação antiga" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-gray-300">Tipo de incorporação</Label>
                <Select value={form.incorporationType} onValueChange={(value) => setForm((f) => ({ ...f, incorporationType: value }))}>
                  <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"><SelectValue placeholder="Classificar estudo legado" /></SelectTrigger>
                  <SelectContent>{TIPOS.map((tipo) => <SelectItem key={tipo.value} value={tipo.value}>{tipo.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={handleSave} disabled={updateMutation.isPending}
              className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
              {updateMutation.isPending ? "Salvando..." : "Salvar Alterações"}
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-[#1A2332] border-[#C9A961]/20 text-white">
          <CardHeader><CardTitle>Histórico de versões</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-gray-300">Cada alteração salva um retrato. O período anterior à ativação deste histórico não pode ser reconstruído.</p>
            {erroVersao && <p role="alert" className="text-red-300">{erroVersao}</p>}
            {versoes.map((versao) => (
              <div key={versao.revision} className="flex items-center justify-between gap-3 border-t border-white/10 py-2">
                <span>Versão {versao.revision} · {new Date(versao.createdAt).toLocaleString("pt-BR")}</span>
                <Button type="button" variant="outline" onClick={() => baixarVersao(versao.revision)}>Baixar snapshot</Button>
              </div>
            ))}
          </CardContent>
        </Card>
        </div>
        } />
      </div>
      </div>
    </div>
  );
}
