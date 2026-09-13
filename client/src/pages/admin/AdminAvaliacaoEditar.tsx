import { useEffect, useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";

const emptyForm = {
  tipo: "mercado", finalidade: "compra_venda", metodologia: "comparativo", avaliador: "",
  clienteNome: "", clienteCpf: "", clienteTel: "", clienteEmail: "",
  endereco: "", bairro: "", cidade: "", estado: "",
  areaConstruida: "", areaTerreno: "", quartos: "", banheiros: "", vagas: "",
  dataVistoria: "", prazoEntrega: "", valorServico: "", observacoes: "",
  leadId: "none",
};

export default function AdminAvaliacaoEditar() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id, 10);
  const [, navigate] = useLocation();

  const { data: avaliacao } = trpc.avaliacoes.getById.useQuery({ id }, { enabled: !isNaN(id) });
  const { data: leadOptions = [] } = trpc.avaliacoes.leadOptions.useQuery();
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (avaliacao) {
      setForm({
        tipo: avaliacao.tipo, finalidade: avaliacao.finalidade, metodologia: avaliacao.metodologia, avaliador: avaliacao.avaliador,
        clienteNome: avaliacao.clienteNome, clienteCpf: avaliacao.clienteCpf ?? "", clienteTel: avaliacao.clienteTel, clienteEmail: avaliacao.clienteEmail ?? "",
        endereco: avaliacao.endereco, bairro: avaliacao.bairro, cidade: avaliacao.cidade, estado: avaliacao.estado,
        areaConstruida: avaliacao.areaConstruida?.toString() ?? "", areaTerreno: avaliacao.areaTerreno?.toString() ?? "",
        quartos: avaliacao.quartos?.toString() ?? "", banheiros: avaliacao.banheiros?.toString() ?? "", vagas: avaliacao.vagas?.toString() ?? "",
        dataVistoria: avaliacao.dataVistoria ? new Date(avaliacao.dataVistoria).toISOString().slice(0, 10) : "",
        prazoEntrega: avaliacao.prazoEntrega ? new Date(avaliacao.prazoEntrega).toISOString().slice(0, 10) : "",
        valorServico: avaliacao.valorServico?.toString() ?? "",
        observacoes: avaliacao.observacoes ?? "",
        leadId: avaliacao.leadId ? String(avaliacao.leadId) : "none",
      });
    }
  }, [avaliacao?.id]);

  const updateMutation = trpc.avaliacoes.update.useMutation({
    onSuccess: () => { toast.success("Avaliação atualizada!"); navigate(`/admin/avaliacoes/${id}`); },
    onError: (e) => toast.error(e.message),
  });

  if (!avaliacao) {
    return (
      <div className="min-h-screen bg-[#1A2332] text-white flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#C9A961]" />
      </div>
    );
  }

  function handleSave() {
    updateMutation.mutate({
      id,
      tipo: form.tipo,
      finalidade: form.finalidade,
      metodologia: form.metodologia,
      avaliador: form.avaliador,
      clienteNome: form.clienteNome,
      clienteCpf: form.clienteCpf || undefined,
      clienteTel: form.clienteTel,
      clienteEmail: form.clienteEmail || undefined,
      endereco: form.endereco,
      bairro: form.bairro,
      cidade: form.cidade,
      estado: form.estado,
      areaConstruida: form.areaConstruida ? parseFloat(form.areaConstruida) : undefined,
      areaTerreno: form.areaTerreno ? parseFloat(form.areaTerreno) : undefined,
      quartos: form.quartos ? parseInt(form.quartos) : undefined,
      banheiros: form.banheiros ? parseInt(form.banheiros) : undefined,
      vagas: form.vagas ? parseInt(form.vagas) : undefined,
      dataVistoria: form.dataVistoria || undefined,
      prazoEntrega: form.prazoEntrega || undefined,
      valorServico: form.valorServico ? parseFloat(form.valorServico) : undefined,
      observacoes: form.observacoes,
      leadId: form.leadId !== "none" ? parseInt(form.leadId) : undefined,
    });
  }

  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <div className="bg-[#0F1923] border-b border-[#C9A961]/20 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <Link href={`/admin/avaliacoes/${id}`}>
            <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-[#C9A961]">Editar Avaliação {avaliacao.numero}</h1>
            <p className="text-gray-400 text-sm">Dados gerais, cliente e imóvel</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6">
        <Card className="bg-[#2C3E50] border-[#C9A961]/20">
          <CardHeader><CardTitle className="text-[#C9A961] text-base">Dados Gerais</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-gray-300">Tipo</Label>
                <Select value={form.tipo} onValueChange={(v) => setForm((f) => ({ ...f, tipo: v }))}>
                  <SelectTrigger className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mercado">Mercado</SelectItem>
                    <SelectItem value="locacao">Locação</SelectItem>
                    <SelectItem value="judicial">Judicial</SelectItem>
                    <SelectItem value="parecer_tecnico">Parecer Técnico</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-gray-300">Finalidade</Label>
                <Select value={form.finalidade} onValueChange={(v) => setForm((f) => ({ ...f, finalidade: v }))}>
                  <SelectTrigger className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="compra_venda">Compra e Venda</SelectItem>
                    <SelectItem value="locacao">Locação</SelectItem>
                    <SelectItem value="judicial">Judicial</SelectItem>
                    <SelectItem value="garantia">Garantia</SelectItem>
                    <SelectItem value="inventario">Inventário</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-gray-300">Metodologia</Label>
                <Select value={form.metodologia} onValueChange={(v) => setForm((f) => ({ ...f, metodologia: v }))}>
                  <SelectTrigger className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="comparativo">Comparativo</SelectItem>
                    <SelectItem value="renda">Renda</SelectItem>
                    <SelectItem value="custo">Custo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-gray-300">Avaliador</Label>
                <Input value={form.avaliador} onChange={(e) => setForm((f) => ({ ...f, avaliador: e.target.value }))} className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div className="col-span-2">
                <Label className="text-gray-300">Lead vinculado</Label>
                <Select value={form.leadId} onValueChange={(v) => setForm((f) => ({ ...f, leadId: v }))}>
                  <SelectTrigger className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem vínculo</SelectItem>
                    {leadOptions.map((l: any) => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-gray-300">Cliente</Label>
                <Input value={form.clienteNome} onChange={(e) => setForm((f) => ({ ...f, clienteNome: e.target.value }))} className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">CPF</Label>
                <Input value={form.clienteCpf} onChange={(e) => setForm((f) => ({ ...f, clienteCpf: e.target.value }))} className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Telefone</Label>
                <Input value={form.clienteTel} onChange={(e) => setForm((f) => ({ ...f, clienteTel: e.target.value }))} className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Email</Label>
                <Input value={form.clienteEmail} onChange={(e) => setForm((f) => ({ ...f, clienteEmail: e.target.value }))} className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-gray-300">Endereço</Label>
                <Input value={form.endereco} onChange={(e) => setForm((f) => ({ ...f, endereco: e.target.value }))} className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Bairro</Label>
                <Input value={form.bairro} onChange={(e) => setForm((f) => ({ ...f, bairro: e.target.value }))} className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-gray-300">Cidade</Label>
                  <Input value={form.cidade} onChange={(e) => setForm((f) => ({ ...f, cidade: e.target.value }))} className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1" />
                </div>
                <div>
                  <Label className="text-gray-300">UF</Label>
                  <Input value={form.estado} maxLength={2} onChange={(e) => setForm((f) => ({ ...f, estado: e.target.value.toUpperCase() }))} className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-gray-300">Área const. (m²)</Label>
                <Input type="number" value={form.areaConstruida} onChange={(e) => setForm((f) => ({ ...f, areaConstruida: e.target.value }))} className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Área terreno (m²)</Label>
                <Input type="number" value={form.areaTerreno} onChange={(e) => setForm((f) => ({ ...f, areaTerreno: e.target.value }))} className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Quartos</Label>
                <Input type="number" value={form.quartos} onChange={(e) => setForm((f) => ({ ...f, quartos: e.target.value }))} className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Banheiros</Label>
                <Input type="number" value={form.banheiros} onChange={(e) => setForm((f) => ({ ...f, banheiros: e.target.value }))} className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Vagas</Label>
                <Input type="number" value={form.vagas} onChange={(e) => setForm((f) => ({ ...f, vagas: e.target.value }))} className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Valor do serviço (R$)</Label>
                <Input type="number" value={form.valorServico} onChange={(e) => setForm((f) => ({ ...f, valorServico: e.target.value }))} className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-gray-300">Data da vistoria</Label>
                <Input type="date" value={form.dataVistoria} onChange={(e) => setForm((f) => ({ ...f, dataVistoria: e.target.value }))} className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Prazo de entrega</Label>
                <Input type="date" value={form.prazoEntrega} onChange={(e) => setForm((f) => ({ ...f, prazoEntrega: e.target.value }))} className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1" />
              </div>
            </div>

            <div>
              <Label className="text-gray-300">Observações</Label>
              <Textarea value={form.observacoes} onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))} rows={3} className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1" />
            </div>

            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending || !form.clienteNome || !form.clienteTel || !form.endereco || !form.cidade || !form.estado || !form.avaliador}
              className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold"
            >
              {updateMutation.isPending ? "Salvando..." : "Salvar alterações"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
