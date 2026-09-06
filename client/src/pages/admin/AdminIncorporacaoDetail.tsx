import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Construction } from "lucide-react";
import { TerrenoTopografia } from "@/components/incorporacao/TerrenoTopografia";
import { EstudoMercado } from "@/components/incorporacao/EstudoMercado";

const STATUS_OPTIONS = [
  { value: "draft", label: "Rascunho" },
  { value: "in_study", label: "Em estudo" },
  { value: "completed", label: "Concluído" },
];

const FUTURE_MODULES = [
  "Parâmetros urbanísticos e potencial construtivo",
  "Massa e quadro de áreas (NBR 12721)",
  "Orçamento parametrizado e negociação do terreno",
  "Business plan e investidores",
  "Projetistas e aprovação do projeto",
  "Registro da incorporação e orçamento preliminar",
  "Planejamento de lançamento, fornecedores e material publicitário",
  "Projetos executivos, orçamento e cronograma de obra",
  "Atendimento aos clientes",
];

export default function AdminIncorporacaoDetail() {
  const { id } = useParams<{ id: string }>();
  const utils = trpc.useUtils();

  const { data: estudo, isLoading } = trpc.incorporacao.getById.useQuery({ id: Number(id) });

  const [form, setForm] = useState({ name: "", city: "", state: "", address: "", responsible: "", status: "draft" });

  useEffect(() => {
    if (estudo) {
      setForm({
        name: estudo.name ?? "",
        city: estudo.city ?? "",
        state: estudo.state ?? "",
        address: estudo.address ?? "",
        responsible: estudo.responsible ?? "",
        status: estudo.status ?? "draft",
      });
    }
  }, [estudo]);

  const updateMutation = trpc.incorporacao.update.useMutation({
    onSuccess: () => {
      toast.success("Estudo atualizado!");
      utils.incorporacao.getById.invalidate({ id: Number(id) });
      utils.incorporacao.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSave = () => {
    updateMutation.mutate({
      id: Number(id),
      name: form.name,
      city: form.city,
      state: form.state || undefined,
      address: form.address || undefined,
      responsible: form.responsible || undefined,
      status: form.status as "draft" | "in_study" | "completed",
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#1A2332] text-white flex items-center justify-center">
        <p className="text-gray-400">Carregando...</p>
      </div>
    );
  }

  if (!estudo) {
    return (
      <div className="min-h-screen bg-[#1A2332] text-white flex items-center justify-center">
        <p className="text-gray-400">Estudo não encontrado.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <div className="bg-[#0F1923] border-b border-[#C9A961]/20 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <Link href="/admin/incorporacao">
            <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold text-[#C9A961] truncate">{estudo.name}</h1>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
        <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-white text-lg">Dados Gerais</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Label className="text-gray-300">Nome do estudo</Label>
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
                <Input value={form.responsible} onChange={(e) => setForm((f) => ({ ...f, responsible: e.target.value }))}
                  className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Situação</Label>
                <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                  <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={handleSave} disabled={updateMutation.isPending}
              className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
              {updateMutation.isPending ? "Salvando..." : "Salvar Alterações"}
            </Button>
          </CardContent>
        </Card>

        <TerrenoTopografia
          estudoId={estudo.id}
          geojson={estudo.geojson}
          areaM2={estudo.areaM2}
          perimeterM={estudo.perimeterM}
          elevationJson={estudo.elevationJson}
        />

        <EstudoMercado
          estudoId={estudo.id}
          city={estudo.city}
          state={estudo.state}
          cityResearchJson={estudo.cityResearchJson}
          marketStudyJson={estudo.marketStudyJson}
          comparablePricingJson={estudo.comparablePricingJson}
          primaryResearchJson={estudo.primaryResearchJson}
        />

        <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-white text-lg flex items-center gap-2">
              <Construction className="h-5 w-5 text-[#C9A961]" /> Em construção
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-400 text-sm mb-4">
              Este estudo já está cadastrado no sistema. Os módulos abaixo (viabilidade, urbanismo,
              massa, orçamentos, lançamento, obra) fazem parte do epic de Incorporação e serão
              adicionados em stories futuras — o schema no banco já reserva o espaço para todos eles.
            </p>
            <ul className="space-y-1.5">
              {FUTURE_MODULES.map((m) => (
                <li key={m} className="text-sm text-gray-500 flex items-start gap-2">
                  <span className="text-[#C9A961]/60">—</span> {m}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
