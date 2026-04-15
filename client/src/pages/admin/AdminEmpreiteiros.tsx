import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft, HardHat, Plus, Phone, MapPin } from "lucide-react";

export default function AdminEmpreiteiros() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "", phone: "", city: "", specialties: "",
    contractType: "labor" as any, notes: "",
  });

  const { data: contractors = [], refetch } = trpc.contractors.list.useQuery({});

  const createMutation = trpc.contractors.create.useMutation({
    onSuccess: () => { toast.success("Empreiteiro cadastrado!"); refetch(); setOpen(false); setForm({ name: "", phone: "", city: "", specialties: "", contractType: "labor", notes: "" }); },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.contractors.update.useMutation({
    onSuccess: () => { toast.success("Atualizado!"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const CONTRACT_LABELS: Record<string, string> = {
    labor: "Mão de obra",
    complete: "Empreitada completa",
    material_labor: "Material + MO",
  };

  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <div className="bg-[#0F1923] border-b border-[#C9A961]/20 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin">
              <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-[#C9A961]">Empreiteiros</h1>
              <p className="text-gray-400 text-sm">Cadastro de parceiros de obra</p>
            </div>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
                <Plus className="h-4 w-4 mr-2" /> Novo Empreiteiro
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white">
              <DialogHeader>
                <DialogTitle className="text-[#C9A961]">Cadastrar Empreiteiro</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label className="text-gray-300">Nome</Label>
                    <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                  <div>
                    <Label className="text-gray-300">Telefone</Label>
                    <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                  <div>
                    <Label className="text-gray-300">Cidade</Label>
                    <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-gray-300">Especialidades</Label>
                    <Input value={form.specialties} onChange={e => setForm(f => ({ ...f, specialties: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" placeholder="ex: alvenaria, fundação, acabamento" />
                  </div>
                  <div>
                    <Label className="text-gray-300">Tipo de Contrato</Label>
                    <Select value={form.contractType} onValueChange={v => setForm(f => ({ ...f, contractType: v }))}>
                      <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="labor">Mão de obra</SelectItem>
                        <SelectItem value="complete">Empreitada completa</SelectItem>
                        <SelectItem value="material_labor">Material + MO</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-gray-300">Observações</Label>
                  <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" rows={2} />
                </div>
                <Button
                  onClick={() => createMutation.mutate(form)}
                  disabled={createMutation.isPending || !form.name}
                  className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold"
                >
                  Cadastrar
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {contractors.length === 0 ? (
          <Card className="bg-[#2C3E50] border-[#C9A961]/20">
            <CardContent className="py-12 text-center text-gray-500">
              <HardHat className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p>Nenhum empreiteiro cadastrado</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {contractors.map((c: any) => (
              <Card key={c.id} className={`bg-[#2C3E50] ${c.status === "active" ? "border-[#C9A961]/20" : "border-gray-600/20 opacity-60"}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-white text-base">{c.name}</CardTitle>
                    <div className="flex gap-1">
                      <Badge className={c.status === "active" ? "bg-green-600 text-white" : "bg-gray-600 text-white"}>
                        {c.status === "active" ? "Ativo" : "Inativo"}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {c.phone && (
                    <div className="flex items-center gap-2 text-gray-300">
                      <Phone className="h-3 w-3 text-[#C9A961]" />
                      {c.phone}
                    </div>
                  )}
                  {c.city && (
                    <div className="flex items-center gap-2 text-gray-300">
                      <MapPin className="h-3 w-3 text-[#C9A961]" />
                      {c.city}
                    </div>
                  )}
                  {c.contractType && (
                    <div className="text-gray-400 text-xs">
                      Contrato: {CONTRACT_LABELS[c.contractType] || c.contractType}
                    </div>
                  )}
                  {c.specialties && <p className="text-gray-400 text-xs">{c.specialties}</p>}
                  {c.notes && <p className="text-gray-500 text-xs italic">{c.notes}</p>}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => updateMutation.mutate({ id: c.id, status: c.status === "active" ? "inactive" : "active" })}
                    className="w-full mt-2 border-[#C9A961]/30 text-gray-300 hover:bg-[#1A2332] h-7 text-xs"
                  >
                    {c.status === "active" ? "Desativar" : "Reativar"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
