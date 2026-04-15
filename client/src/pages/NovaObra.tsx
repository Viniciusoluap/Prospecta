import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, HardHat, Loader2 } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { getLoginUrl } from "@/const";
import { toast } from "sonner";

export default function NovaObra() {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const createMutation = trpc.construction.createProject.useMutation({
    onSuccess: data => {
      toast.success("Obra cadastrada com sucesso!");
      setLocation(`/obras/${data.id}`);
    },
    onError: error => {
      toast.error(`Erro ao cadastrar obra: ${error.message}`);
      setIsSubmitting(false);
    },
  });

  // Redirect para login se não autenticado
  if (!authLoading && !isAuthenticated) {
    window.location.href = getLoginUrl();
    return null;
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#1A2332] to-[#0F1419] flex items-center justify-center">
        <div className="text-center">
          <HardHat className="h-12 w-12 text-[#C9A961] animate-pulse mx-auto mb-4" />
          <p className="text-white">Carregando...</p>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    const formData = new FormData(e.currentTarget);
    const address = formData.get("address") as string;
    const city = formData.get("city") as string;
    const state = formData.get("state") as string;
    const fullAddress = `${address}, ${city} - ${state}`;

    const data = {
      title: formData.get("name") as string,
      description: (formData.get("description") as string) || undefined,
      address: fullAddress,
      status: formData.get("status") as
        | "planning"
        | "in_progress"
        | "paused"
        | "completed"
        | "cancelled",
      estimatedCost: formData.get("totalBudget")
        ? parseFloat(formData.get("totalBudget") as string)
        : undefined,
      startDate: formData.get("startDate")
        ? new Date(formData.get("startDate") as string)
        : undefined,
      estimatedEndDate: formData.get("estimatedEndDate")
        ? new Date(formData.get("estimatedEndDate") as string)
        : undefined,
    };

    createMutation.mutate(data);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1A2332] to-[#0F1419]">
      {/* Header */}
      <div className="bg-[#1A2332] border-b border-[#C9A961]/20">
        <div className="container mx-auto px-4 py-8">
          <Button
            variant="ghost"
            className="text-[#C9A961] hover:text-[#B89851] hover:bg-[#C9A961]/10 mb-4"
            onClick={() => setLocation("/obras")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar para Minhas Obras
          </Button>

          <h1 className="text-3xl font-bold text-[#C9A961] flex items-center gap-3">
            <HardHat className="h-8 w-8" />
            Cadastrar Nova Obra
          </h1>
          <p className="text-gray-400 mt-2">
            Preencha as informações da sua nova construção
          </p>
        </div>
      </div>

      {/* Formulário */}
      <div className="container mx-auto px-4 py-8">
        <Card className="bg-[#1A2332]/50 border-[#C9A961]/20 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-[#C9A961]">
              Informações da Obra
            </CardTitle>
            <CardDescription className="text-gray-400">
              Preencha todos os campos obrigatórios
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Nome da Obra */}
              <div className="space-y-2">
                <Label htmlFor="name" className="text-white">
                  Nome da Obra *
                </Label>
                <Input
                  id="name"
                  name="name"
                  required
                  placeholder="Ex: Casa Residencial - Rua das Flores"
                  className="bg-[#0F1419] border-[#C9A961]/30 text-white"
                />
              </div>

              {/* Descrição */}
              <div className="space-y-2">
                <Label htmlFor="description" className="text-white">
                  Descrição
                </Label>
                <Textarea
                  id="description"
                  name="description"
                  placeholder="Descreva os detalhes da obra..."
                  rows={4}
                  className="bg-[#0F1419] border-[#C9A961]/30 text-white"
                />
              </div>

              {/* Endereço */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="address" className="text-white">
                    Endereço *
                  </Label>
                  <Input
                    id="address"
                    name="address"
                    required
                    placeholder="Rua, número, complemento"
                    className="bg-[#0F1419] border-[#C9A961]/30 text-white"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="city" className="text-white">
                    Cidade *
                  </Label>
                  <Input
                    id="city"
                    name="city"
                    required
                    placeholder="Ex: Imperatriz"
                    className="bg-[#0F1419] border-[#C9A961]/30 text-white"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="state" className="text-white">
                    Estado *
                  </Label>
                  <Input
                    id="state"
                    name="state"
                    required
                    placeholder="Ex: MA"
                    maxLength={2}
                    className="bg-[#0F1419] border-[#C9A961]/30 text-white"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="zipCode" className="text-white">
                    CEP
                  </Label>
                  <Input
                    id="zipCode"
                    name="zipCode"
                    placeholder="00000-000"
                    className="bg-[#0F1419] border-[#C9A961]/30 text-white"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="status" className="text-white">
                    Status *
                  </Label>
                  <Select name="status" defaultValue="planning" required>
                    <SelectTrigger className="bg-[#0F1419] border-[#C9A961]/30 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="planning">Planejamento</SelectItem>
                      <SelectItem value="in_progress">Em Andamento</SelectItem>
                      <SelectItem value="paused">Pausada</SelectItem>
                      <SelectItem value="completed">Concluída</SelectItem>
                      <SelectItem value="cancelled">Cancelada</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Orçamento e Datas */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="totalBudget" className="text-white">
                    Orçamento Total (R$)
                  </Label>
                  <Input
                    id="totalBudget"
                    name="totalBudget"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    className="bg-[#0F1419] border-[#C9A961]/30 text-white"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="startDate" className="text-white">
                    Data de Início
                  </Label>
                  <Input
                    id="startDate"
                    name="startDate"
                    type="date"
                    className="bg-[#0F1419] border-[#C9A961]/30 text-white"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="estimatedEndDate" className="text-white">
                    Previsão de Término
                  </Label>
                  <Input
                    id="estimatedEndDate"
                    name="estimatedEndDate"
                    type="date"
                    className="bg-[#0F1419] border-[#C9A961]/30 text-white"
                  />
                </div>
              </div>

              {/* Botões */}
              <div className="flex gap-4 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 border-[#C9A961]/30 text-white hover:bg-[#C9A961]/10"
                  onClick={() => setLocation("/obras")}
                  disabled={isSubmitting}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  className="flex-1 bg-[#C9A961] hover:bg-[#B89851] text-[#1A2332] font-semibold"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Cadastrando...
                    </>
                  ) : (
                    "Cadastrar Obra"
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
