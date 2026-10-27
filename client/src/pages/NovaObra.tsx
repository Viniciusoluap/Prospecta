import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumeroInput } from "@/components/ui/numero-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, HardHat, Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { LeadPicker } from "@/components/admin/LeadPicker";
import { leadFullAddress } from "../../../shared/lead-snapshot";

export default function NovaObra() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();
  // EPIC-017 (story 1.4): obra nasce sempre de um lead do CRM.
  const [leadId, setLeadId] = useState<number | null>(null);
  const { data: leads = [], isLoading: leadsLoading } = trpc.construction.leadOptions.useQuery(undefined, {
    enabled: !loading && (user?.role === "admin" || user?.role === "colaborador"),
  });
  const create = trpc.construction.createAdminProject.useMutation({
    onSuccess: project => {
      toast.success("Obra cadastrada com sucesso");
      navigate(`/admin/obras/editar/${project.id}`);
    },
    onError: error => toast.error(error.message),
  });

  const selectedLead = leads.find(lead => lead.id === leadId);
  const leadAddress = selectedLead ? leadFullAddress(selectedLead) : "";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!leadId) {
      toast.error("Selecione o cliente no CRM");
      return;
    }
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) || "").trim();
    const startDate = value("startDate");
    const estimatedEndDate = value("estimatedEndDate");
    const totalArea = value("totalArea");
    create.mutate({
      title: value("title"),
      leadId,
      address: value("address") || undefined,
      projectType: value("projectType") || undefined,
      totalArea: totalArea ? Number(totalArea) : undefined,
      startDate: startDate ? new Date(`${startDate}T12:00:00`) : undefined,
      estimatedEndDate: estimatedEndDate ? new Date(`${estimatedEndDate}T12:00:00`) : undefined,
      notes: value("notes") || undefined,
    });
  }

  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <header className="border-b border-[#C9A961]/30 p-6">
        <div className="container">
          <Link href="/admin/obras"><Button variant="ghost" className="text-gray-200 hover:text-white"><ArrowLeft className="mr-2 h-4 w-4" />Voltar para Obras</Button></Link>
          <h1 className="mt-4 flex items-center gap-3 text-3xl font-bold text-[#C9A961]"><HardHat /> Nova Obra</h1>
        </div>
      </header>
      <main className="container max-w-3xl py-8">
        <Card className="border-[#C9A961]/30 bg-[#223246] text-white">
          <CardHeader><CardTitle className="text-[#C9A961]">Informações da Obra</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-5">
              <div className="space-y-2"><Label htmlFor="title">Título *</Label><Input id="title" name="title" minLength={2} maxLength={255} required className="bg-[#111B29] text-white placeholder:text-gray-400" /></div>
              <LeadPicker label="Cliente no CRM" leads={leads} loading={leadsLoading} value={leadId} onChange={setLeadId} />
              <div className="space-y-2"><Label htmlFor="address">Endereço da obra</Label><Input id="address" name="address" placeholder={leadAddress || "Se vazio, usa o endereço do lead"} className="bg-[#111B29] text-white placeholder:text-gray-400" />
                <p className="text-xs text-gray-300">{leadAddress ? `Deixe em branco para usar o endereço do cadastro do lead: ${leadAddress}.` : "Se o lote for diferente do endereço do cliente, informe aqui."}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="projectType">Tipo de projeto</Label><Input id="projectType" name="projectType" className="bg-[#111B29] text-white placeholder:text-gray-400" /></div>
                <div className="space-y-2"><Label htmlFor="totalArea">Área total (m²)</Label><NumeroInput id="totalArea" name="totalArea" sufixo="m²" negativo={false} className="bg-[#111B29] text-white" /></div>
                <div className="space-y-2"><Label htmlFor="startDate">Data de início</Label><Input id="startDate" name="startDate" type="date" className="bg-[#111B29] text-white" /></div>
                <div className="space-y-2"><Label htmlFor="estimatedEndDate">Previsão de término</Label><Input id="estimatedEndDate" name="estimatedEndDate" type="date" className="bg-[#111B29] text-white" /></div>
              </div>
              <div className="space-y-2"><Label htmlFor="notes">Observações</Label><Textarea id="notes" name="notes" className="bg-[#111B29] text-white placeholder:text-gray-400" /></div>
              <div className="flex flex-wrap gap-3"><Button type="submit" disabled={create.isPending || loading || !(user?.role === "admin" || user?.role === "colaborador") || !leadId} className="bg-[#C9A961] text-[#1A2332] hover:bg-[#E1BF78]">{create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Cadastrar Obra</Button><Link href="/admin/obras"><Button type="button" variant="outline" className="text-white">Cancelar</Button></Link></div>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
