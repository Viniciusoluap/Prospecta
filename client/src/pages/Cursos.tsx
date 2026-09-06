import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Navbar from "@/components/Navbar";
import SEO from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ArrowLeft, GraduationCap, Clock, Users, Calculator, Home, CheckCircle2 } from "lucide-react";

const AREAS_INTERESSE = [
  {
    icon: Home,
    title: "Corretagem Imobiliária",
    description: "Formação voltada a quem quer atuar com intermediação e vendas de imóveis.",
  },
  {
    icon: Calculator,
    title: "Financiamento Habitacional",
    description: "Capacitação sobre o processo de financiamento da casa própria, do zero à assinatura.",
  },
];

export default function Cursos() {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [area, setArea] = useState("");
  const [enviado, setEnviado] = useState(false);

  const createLeadMutation = trpc.leads.createPublic.useMutation({
    onSuccess: () => setEnviado(true),
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome || !telefone || !area) {
      toast.error("Preencha nome, telefone e área de interesse.");
      return;
    }
    createLeadMutation.mutate({
      name: nome,
      phone: telefone,
      email: email || undefined,
      sourceChannel: "site_cursos",
      notes: `Interesse em curso: ${area}`,
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
      <SEO
        title="Cursos"
        description="Formação profissional da Prospecta Empreendimentos em construção civil e mercado imobiliário. Cadastre seu interesse."
        keywords="cursos Prospecta, formação profissional, corretor de imóveis, financiamento habitacional"
      />
      <Navbar />

      <main className="flex-1 py-12">
        <div className="container">
          <Link href="/" className="inline-flex items-center gap-2 text-gray-400 hover:text-[#C9A961] transition-colors mb-6">
            <ArrowLeft className="h-5 w-5" />
            <span>Voltar</span>
          </Link>

          <div className="max-w-4xl mx-auto space-y-8">
            <div className="text-center space-y-4">
              <p className="text-[#C9A961] font-bold text-xs tracking-widest uppercase">Formação Profissional</p>
              <h1 className="text-4xl md:text-5xl font-bold text-[#C9A961]">Cursos em estruturação</h1>
              <p className="text-xl text-gray-300 max-w-2xl mx-auto">
                Estamos organizando cursos de capacitação nas áreas em que já atuamos. Cadastre seu interesse
                e avisaremos assim que as turmas forem abertas.
              </p>
              <div className="flex flex-wrap justify-center gap-6 pt-2">
                {[
                  { icon: GraduationCap, label: "Conteúdo prático" },
                  { icon: Clock, label: "Horários flexíveis" },
                  { icon: Users, label: "Turmas reduzidas" },
                ].map(({ icon: Icon, label }) => (
                  <div key={label} className="flex items-center gap-2 text-gray-300 text-sm">
                    <Icon className="h-4 w-4 text-[#C9A961]" />
                    {label}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {AREAS_INTERESSE.map(({ icon: Icon, title, description }) => (
                <Card key={title} className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
                  <CardContent className="p-6 space-y-3">
                    <Icon className="h-8 w-8 text-[#C9A961]" />
                    <h3 className="font-bold text-white uppercase">{title}</h3>
                    <p className="text-gray-400 text-sm leading-relaxed">{description}</p>
                    <p className="flex items-center gap-2 text-xs text-[#C9A961]/80">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Turmas em breve
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
              <CardContent className="p-8">
                {enviado ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center gap-4">
                    <CheckCircle2 className="h-12 w-12 text-[#00FF00]" />
                    <h3 className="font-bold text-white text-xl uppercase">Interesse registrado!</h3>
                    <p className="text-gray-400 text-sm max-w-sm">
                      Avisaremos assim que as turmas forem abertas.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <h2 className="font-bold text-white text-xl uppercase text-center mb-2">Garanta seu lugar na lista de espera</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <Label className="text-gray-300">Nome completo *</Label>
                        <Input value={nome} onChange={(e) => setNome(e.target.value)} required
                          className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                      </div>
                      <div>
                        <Label className="text-gray-300">WhatsApp *</Label>
                        <Input value={telefone} onChange={(e) => setTelefone(e.target.value)} required
                          placeholder="(99) 9 9999-9999"
                          className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                      </div>
                    </div>
                    <div>
                      <Label className="text-gray-300">E-mail</Label>
                      <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                        className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-gray-300">Área de interesse *</Label>
                      <Select value={area} onValueChange={setArea}>
                        <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1">
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                        <SelectContent>
                          {AREAS_INTERESSE.map((a) => (
                            <SelectItem key={a.title} value={a.title}>{a.title}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button type="submit" disabled={createLeadMutation.isPending}
                      className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
                      {createLeadMutation.isPending ? "Enviando..." : "Registrar Interesse"}
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
