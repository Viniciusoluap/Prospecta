import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { AvisoConsultaCadastral } from "@/components/AvisoConsultaCadastral";
import { useAutoPreenchimentoCnpj } from "@/hooks/useAutoPreenchimentoCadastral";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { PercentInput } from "@/components/ui/percent-input";
import { formatCurrency } from "@/lib/format";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  BadgeDollarSign,
  Building2,
  CalendarClock,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { rotulo } from "@shared/rotulos";
// EPIC-029 S-2: o fiscal vive DENTRO desta aba (decisão do dono k: "para não termos campos redundantes").
import { NotasADecidir } from "@/components/fiscal/NotasADecidir";
import { DadosFiscaisDoPerfil } from "@/components/fiscal/DadosFiscaisDoPerfil";
import { TiposServico } from "@/components/fiscal/TiposServico";
import { NotasReceitaMes } from "@/components/fiscal/NotasReceitaMes";

const regimes = {
  simples_nacional: "Simples Nacional",
  lucro_presumido: "Lucro Presumido",
  lucro_real: "Lucro Real",
  ret: "RET",
  outro: "Outro",
} as const;

function money(value: number | string | null | undefined) {
  return formatCurrency(Number(value || 0));
}

export default function TaxAccountingPanel() {
  const [profileOpen, setProfileOpen] = useState(false);
  const [obligationOpen, setObligationOpen] = useState(false);
  const [retOpen, setRetOpen] = useState(false);
  const [profile, setProfile] = useState({
    companyName: "",
    cnpj: "",
    regime: "simples_nacional",
    estimatedRate: "",
    effectiveFrom: "",
    notes: "",
  });
  const [obligation, setObligation] = useState({
    name: "",
    competency: "",
    dueDate: "",
    estimatedAmount: "",
    notes: "",
  });
  const [ret, setRet] = useState({
    name: "",
    cnpj: "",
    registrationNumber: "",
    affectedAssets: false,
    status: "analysis",
    retRate: "4",
    effectiveFrom: "",
    notes: "",
  });
  // EPIC-029 S-1: CNPJ completo e válido preenche o nome vazio e mostra o alerta se a empresa não estiver ATIVA.
  const consultaCnpjPerfil = useAutoPreenchimentoCnpj({
    valor: profile.cnpj,
    campos: { companyName: profile.companyName },
    mapear: d => ({ companyName: d.razaoSocial }),
    aplicar: patch => setProfile(p => ({ ...p, ...patch })),
  });
  const consultaCnpjRet = useAutoPreenchimentoCnpj({
    valor: ret.cnpj,
    campos: { name: ret.name },
    mapear: d => ({ name: d.nomeFantasia ?? d.razaoSocial }),
    aplicar: patch => setRet(r => ({ ...r, ...patch })),
  });
  const utils = trpc.useUtils();
  // EPIC-029 S-2: filtro "Empresa" (um por CNPJ de perfil tributário). Vazio = todas.
  const [empresa, setEmpresa] = useState("");
  const { data: empresas = [] } = trpc.fiscal.emissores.listar.useQuery();
  const empresaEscolhida = empresas.find(e => e.cnpj === empresa) ?? null;
  const emissorId = empresaEscolhida?.emissor?.id ?? null;
  const { data, isLoading } = trpc.tax.overview.useQuery(empresa ? { cnpj: empresa } : undefined);
  const { data: profiles = [] } = trpc.tax.profiles.list.useQuery();
  const { data: resumoFiscal } = trpc.fiscal.resumo.useQuery({ emissorId: emissorId ?? undefined });
  const podeDecidir = resumoFiscal?.podeDecidir ?? false;

  const refresh = () => {
    void utils.tax.overview.invalidate();
    void utils.tax.profiles.list.invalidate();
    void utils.fiscal.emissores.listar.invalidate();
  };
  const createProfile = trpc.tax.profiles.create.useMutation({
    onSuccess: () => {
      toast.success("Configuração tributária salva.");
      setProfileOpen(false);
      refresh();
    },
    onError: error => toast.error(error.message),
  });
  const createObligation = trpc.tax.obligations.create.useMutation({
    onSuccess: () => {
      toast.success("Obrigação tributária registrada.");
      setObligationOpen(false);
      refresh();
    },
    onError: error => toast.error(error.message),
  });
  const markPaid = trpc.tax.obligations.markPaid.useMutation({
    onSuccess: refresh,
    onError: error => toast.error(error.message),
  });
  // QA S-2 (M4): desativar um perfil vigente (só admin; não apaga nada; fica no histórico).
  const desativarPerfil = trpc.tax.profiles.desativar.useMutation({
    onSuccess: () => {
      toast.success("Perfil desativado (nada foi apagado).");
      refresh();
    },
    onError: error => toast.error(error.message),
  });
  const createRet = trpc.tax.ret.create.useMutation({
    onSuccess: () => {
      toast.success("Empreendimento RET registrado.");
      setRetOpen(false);
      refresh();
    },
    onError: error => toast.error(error.message),
  });

  if (isLoading || !data)
    return <p className="text-gray-400">Carregando gestão tributária...</p>;

  const activeProfileId =
    data.profile?.id ?? profiles.find(item => item.isActive)?.id;
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
        Estimativas usam a alíquota configurada e as movimentações pagas. Elas
        apoiam a decisão, mas não substituem a validação do contador nem o
        cálculo oficial do tributo.
      </div>

      {empresas.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem]">
            <Label>Empresa</Label>
            <Select value={empresa || "todas"} onValueChange={v => setEmpresa(v === "todas" ? "" : v)}>
              <SelectTrigger className="mt-1 bg-[#2C3E50]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as empresas</SelectItem>
                {empresas.map(e => (
                  <SelectItem key={e.cnpj} value={e.cnpj}>
                    {e.razaoSocial}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {empresaEscolhida && !empresaEscolhida.emissor && (
            <p className="text-xs text-amber-300">
              Preencha os "Dados fiscais do perfil" desta empresa para separar as notas dela.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
          <CardContent className="pt-6">
            <p className="text-xs text-gray-300">Regime vigente</p>
            <p className="mt-1 font-bold text-white">
              {data.profile
                ? regimes[data.profile.regime as keyof typeof regimes] ||
                  data.profile.regime
                : "Não configurado"}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-[#2C3E50] border-green-500/30 text-gray-100">
          <CardContent className="pt-6">
            <p className="text-xs text-gray-300">Receita realizada</p>
            <p className="mt-1 text-xl font-bold text-green-400">
              {money(data.revenue)}
            </p>
            {data.revenueBpo > 0 && (
              <p className="text-xs text-gray-400">
                inclui {money(data.revenueBpo)} do BPO/extrato bancário
              </p>
            )}
            {empresa && (
              <p className="text-xs text-gray-400">
                de todas as empresas (o lançamento não indica a empresa)
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="bg-[#2C3E50] border-amber-500/30 text-gray-100">
          <CardContent className="pt-6">
            <p className="text-xs text-gray-300">Tributos estimados</p>
            {data.estimatedTax == null ? (
              <p className="mt-1 text-sm text-amber-200">
                {data.estimativaIndisponivel}
              </p>
            ) : (
              <p className="mt-1 text-xl font-bold text-amber-300">
                {money(data.estimatedTax)}
              </p>
            )}
            <p className="text-xs text-gray-400">
              alíquota {data.rate.toFixed(2)}%
            </p>
          </CardContent>
        </Card>
        <Card className="bg-[#2C3E50] border-red-500/30 text-gray-100">
          <CardContent className="pt-6">
            <p className="text-xs text-gray-300">Obrigações vencidas</p>
            <p className="mt-1 text-xl font-bold text-red-300">
              {data.overdue}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-[#2C3E50] border-[#C9A961]/30 text-gray-100">
          <CardContent className="pt-6">
            <p className="text-xs text-gray-300">Notas a decidir</p>
            <p className="mt-1 text-xl font-bold text-[#C9A961]">
              {resumoFiscal?.aDecidir ?? 0}
            </p>
            <p className="text-xs text-gray-400">nenhuma é emitida sem você</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              className="border-[#C9A961]/40 text-[#C9A961]"
            >
              <Building2 className="mr-2 h-4 w-4" /> Configurar tributação
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-[#C9A961]">
                Configuração tributária
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Empresa *</Label>
                <Input
                  value={profile.companyName}
                  onChange={e =>
                    setProfile({ ...profile, companyName: e.target.value })
                  }
                  className="mt-1 bg-[#2C3E50]"
                />
              </div>
              <div>
                <Label>CNPJ</Label>
                <Input
                  value={profile.cnpj}
                  onChange={e =>
                    setProfile({ ...profile, cnpj: e.target.value })
                  }
                  className="mt-1 bg-[#2C3E50]"
                />
                <AvisoConsultaCadastral estado={consultaCnpjPerfil} rotulos={{ companyName: "Empresa" }} />
              </div>
              <div>
                <Label>Regime *</Label>
                <Select
                  value={profile.regime}
                  onValueChange={value =>
                    setProfile({ ...profile, regime: value })
                  }
                >
                  <SelectTrigger className="mt-1 bg-[#2C3E50]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(regimes).map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Alíquota estimada (%) *</Label>
                <PercentInput
                  maximumFractionDigits={4}
                  value={profile.estimatedRate ? Number(profile.estimatedRate) : 0}
                  onChange={v =>
                    setProfile({ ...profile, estimatedRate: v ? String(v) : "" })
                  }
                  className="mt-1 bg-[#2C3E50]"
                />
              </div>
              <div>
                <Label>Vigência inicial *</Label>
                <Input
                  type="date"
                  value={profile.effectiveFrom}
                  onChange={e =>
                    setProfile({ ...profile, effectiveFrom: e.target.value })
                  }
                  className="mt-1 bg-[#2C3E50]"
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Premissas/observações</Label>
                <Textarea
                  value={profile.notes}
                  onChange={e =>
                    setProfile({ ...profile, notes: e.target.value })
                  }
                  className="mt-1 bg-[#2C3E50]"
                />
              </div>
              <Button
                className="sm:col-span-2 bg-[#C9A961] text-[#1A2332]"
                disabled={
                  !profile.companyName ||
                  !profile.estimatedRate ||
                  !profile.effectiveFrom ||
                  createProfile.isPending
                }
                onClick={() =>
                  createProfile.mutate({
                    companyName: profile.companyName,
                    cnpj: profile.cnpj || undefined,
                    regime: profile.regime as keyof typeof regimes,
                    estimatedRate: Number(profile.estimatedRate),
                    effectiveFrom: new Date(profile.effectiveFrom),
                    notes: profile.notes || undefined,
                  })
                }
              >
                Salvar configuração
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={obligationOpen} onOpenChange={setObligationOpen}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              className="border-[#C9A961]/40 text-[#C9A961]"
            >
              <CalendarClock className="mr-2 h-4 w-4" /> Nova obrigação
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-[#C9A961]">
                Obrigação tributária
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Tributo/obrigação *</Label>
                <Input
                  value={obligation.name}
                  onChange={e =>
                    setObligation({ ...obligation, name: e.target.value })
                  }
                  className="mt-1 bg-[#2C3E50]"
                />
              </div>
              <div>
                <Label>Competência *</Label>
                <Input
                  placeholder="2026-10"
                  value={obligation.competency}
                  onChange={e =>
                    setObligation({ ...obligation, competency: e.target.value })
                  }
                  className="mt-1 bg-[#2C3E50]"
                />
              </div>
              <div>
                <Label>Vencimento *</Label>
                <Input
                  type="date"
                  value={obligation.dueDate}
                  onChange={e =>
                    setObligation({ ...obligation, dueDate: e.target.value })
                  }
                  className="mt-1 bg-[#2C3E50]"
                />
              </div>
              <div>
                <Label>Valor estimado *</Label>
                <CurrencyInput
                  value={obligation.estimatedAmount ? Number(obligation.estimatedAmount) : 0}
                  onChange={v =>
                    setObligation({
                      ...obligation,
                      estimatedAmount: v ? String(v) : "",
                    })
                  }
                  className="mt-1 bg-[#2C3E50]"
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Observações</Label>
                <Textarea
                  value={obligation.notes}
                  onChange={e =>
                    setObligation({ ...obligation, notes: e.target.value })
                  }
                  className="mt-1 bg-[#2C3E50]"
                />
              </div>
              <Button
                className="sm:col-span-2 bg-[#C9A961] text-[#1A2332]"
                disabled={
                  !obligation.name ||
                  !obligation.competency ||
                  !obligation.dueDate ||
                  !obligation.estimatedAmount ||
                  createObligation.isPending
                }
                onClick={() =>
                  createObligation.mutate({
                    profileId: activeProfileId,
                    name: obligation.name,
                    competency: obligation.competency,
                    dueDate: new Date(obligation.dueDate),
                    estimatedAmount: Number(obligation.estimatedAmount),
                    notes: obligation.notes || undefined,
                  })
                }
              >
                Registrar obrigação
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={retOpen} onOpenChange={setRetOpen}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              className="border-[#C9A961]/40 text-[#C9A961]"
            >
              <BadgeDollarSign className="mr-2 h-4 w-4" /> Novo RET
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-[#C9A961]">
                Empreendimento e RET
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Empreendimento *</Label>
                <Input
                  value={ret.name}
                  onChange={e => setRet({ ...ret, name: e.target.value })}
                  className="mt-1 bg-[#2C3E50]"
                />
              </div>
              <div>
                <Label>CNPJ/SPE</Label>
                <Input
                  value={ret.cnpj}
                  onChange={e => setRet({ ...ret, cnpj: e.target.value })}
                  className="mt-1 bg-[#2C3E50]"
                />
                <AvisoConsultaCadastral estado={consultaCnpjRet} rotulos={{ name: "Empreendimento" }} />
              </div>
              <div>
                <Label>Nº da inscrição/adesão</Label>
                <Input
                  value={ret.registrationNumber}
                  onChange={e =>
                    setRet({ ...ret, registrationNumber: e.target.value })
                  }
                  className="mt-1 bg-[#2C3E50]"
                />
              </div>
              <div>
                <Label>Status</Label>
                <Select
                  value={ret.status}
                  onValueChange={value => setRet({ ...ret, status: value })}
                >
                  <SelectTrigger className="mt-1 bg-[#2C3E50]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="analysis">Em análise</SelectItem>
                    <SelectItem value="eligible">Elegível</SelectItem>
                    <SelectItem value="active">Ativo</SelectItem>
                    <SelectItem value="inactive">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Alíquota RET estimada (%)</Label>
                <PercentInput
                  maximumFractionDigits={4}
                  value={ret.retRate ? Number(ret.retRate) : 0}
                  onChange={v => setRet({ ...ret, retRate: v ? String(v) : "" })}
                  className="mt-1 bg-[#2C3E50]"
                />
              </div>
              <label className="sm:col-span-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={ret.affectedAssets}
                  onChange={e =>
                    setRet({ ...ret, affectedAssets: e.target.checked })
                  }
                />{" "}
                Patrimônio de afetação confirmado documentalmente
              </label>
              <div>
                <Label>Vigência inicial</Label>
                <Input
                  type="date"
                  value={ret.effectiveFrom}
                  onChange={e =>
                    setRet({ ...ret, effectiveFrom: e.target.value })
                  }
                  className="mt-1 bg-[#2C3E50]"
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Observações</Label>
                <Textarea
                  value={ret.notes}
                  onChange={e => setRet({ ...ret, notes: e.target.value })}
                  className="mt-1 bg-[#2C3E50]"
                />
              </div>
              <Button
                className="sm:col-span-2 bg-[#C9A961] text-[#1A2332]"
                disabled={!ret.name || createRet.isPending}
                onClick={() =>
                  createRet.mutate({
                    profileId: activeProfileId,
                    name: ret.name,
                    cnpj: ret.cnpj || undefined,
                    registrationNumber: ret.registrationNumber || undefined,
                    affectedAssets: ret.affectedAssets,
                    status: ret.status as
                      | "analysis"
                      | "eligible"
                      | "active"
                      | "inactive",
                    retRate: Number(ret.retRate),
                    effectiveFrom: ret.effectiveFrom
                      ? new Date(ret.effectiveFrom)
                      : undefined,
                    notes: ret.notes || undefined,
                  })
                }
              >
                Salvar RET
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {podeDecidir && profiles.filter(p => p.isActive).length > 0 && (
        <div className="space-y-1 rounded bg-[#2C3E50] p-3 text-sm">
          <p className="text-xs text-gray-300">Perfis tributários vigentes</p>
          {profiles
            .filter(p => p.isActive)
            .map(p => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-gray-100">
                  {p.companyName} {p.cnpj ? `• ${p.cnpj}` : "• sem CNPJ"} •{" "}
                  {regimes[p.regime as keyof typeof regimes] || p.regime}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={desativarPerfil.isPending}
                  onClick={() => {
                    if (window.confirm(`Desativar o perfil "${p.companyName}"? Nada é apagado; fica no histórico.`))
                      desativarPerfil.mutate({ id: p.id });
                  }}
                >
                  Desativar perfil
                </Button>
              </div>
            ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
          <CardHeader>
            <CardTitle className="text-[#C9A961]">
              Adequações sugeridas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.suggestions.length ? (
              data.suggestions.map(item => (
                <div
                  key={item}
                  className="flex gap-2 rounded bg-[#1A2332] p-3 text-sm text-gray-200"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                  {item}
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-400">
                Nenhum alerta pelas regras cadastradas.
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
          <CardHeader>
            <CardTitle className="text-[#C9A961]">
              RET por empreendimento
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.rets.length ? (
              data.rets.map(item => (
                <div key={item.id} className="rounded bg-[#1A2332] p-3">
                  <p className="font-medium text-white">{item.name}</p>
                  <p className="text-xs text-gray-400">
                    {rotulo(item.status)} • alíquota informada{" "}
                    {Number(item.retRate).toFixed(2)}% • afetação:{" "}
                    {item.affectedAssets ? "confirmada" : "pendente"}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-400">
                Nenhum empreendimento RET cadastrado.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <NotasADecidir emissorId={emissorId} podeDecidir={podeDecidir} />
      <NotasReceitaMes emissorId={emissorId} />
      <div className="grid gap-4 lg:grid-cols-2">
        <DadosFiscaisDoPerfil podeEditar={podeDecidir} />
        <TiposServico podeEditar={podeDecidir} />
      </div>

      <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
        <CardHeader>
          <CardTitle className="text-[#C9A961]">
            Calendário de obrigações
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.obligations.length ? (
            data.obligations.map(item => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded bg-[#1A2332] p-3"
              >
                <div>
                  <p className="font-medium text-white">
                    {item.name} — {item.competency}
                  </p>
                  <p className="text-xs text-gray-400">
                    vence {new Date(item.dueDate).toLocaleDateString("pt-BR")} •{" "}
                    {money(item.estimatedAmount)}
                  </p>
                </div>
                {item.status === "paid" ? (
                  <span className="text-xs font-bold text-green-400">PAGO</span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => markPaid.mutate({ id: item.id })}
                  >
                    Marcar pago
                  </Button>
                )}
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-400">
              Nenhuma obrigação cadastrada.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
