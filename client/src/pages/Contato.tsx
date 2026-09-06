import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import Navbar from "@/components/Navbar";
import SEO, { localBusinessSchema } from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ArrowLeft, Phone, MapPin, Clock, MessageCircle, CheckCircle2 } from "lucide-react";

const SERVICOS = [
  "Compra e Venda de Imóveis",
  "Financiamento Habitacional",
  "Obras e Construção",
  "Avaliação de Imóvel",
  "Lotes e Terrenos",
  "Outro",
];

export default function Contato() {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [servicos, setServicos] = useState<string[]>([]);
  const [mensagem, setMensagem] = useState("");
  const [enviado, setEnviado] = useState(false);

  const createLeadMutation = trpc.leads.createPublic.useMutation({
    onSuccess: () => setEnviado(true),
    onError: (e) => toast.error(e.message),
  });

  const toggleServico = (s: string) =>
    setServicos((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome || !telefone) {
      toast.error("Preencha nome e telefone.");
      return;
    }
    const notes = [
      servicos.length > 0 ? `Serviços de interesse: ${servicos.join(", ")}` : null,
      mensagem ? `Mensagem: ${mensagem}` : null,
    ].filter(Boolean).join("\n");
    createLeadMutation.mutate({
      name: nome,
      phone: telefone,
      email: email || undefined,
      sourceChannel: "site_contato",
      notes: notes || undefined,
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
      <SEO
        title="Contato"
        description="Entre em contato com a Prospecta Empreendimentos em Imperatriz-MA. Atendimento para financiamento, construção e imóveis."
        keywords="contato Prospecta, telefone Prospecta Empreendimentos, Imperatriz MA"
        schema={{ "@context": "https://schema.org", "@graph": [localBusinessSchema] }}
      />
      <Navbar />

      <main className="flex-1 py-12">
        <div className="container">
          <Link href="/" className="inline-flex items-center gap-2 text-gray-400 hover:text-[#C9A961] transition-colors mb-6">
            <ArrowLeft className="h-5 w-5" />
            <span>Voltar</span>
          </Link>

          <div className="max-w-5xl mx-auto space-y-8">
            <div className="text-center space-y-4">
              <p className="text-[#C9A961] font-bold text-xs tracking-widest uppercase">Fale conosco</p>
              <h1 className="text-4xl md:text-5xl font-bold text-[#C9A961]">Como podemos ajudar?</h1>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <Card className="lg:col-span-2 bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
                <CardContent className="p-8">
                  {enviado ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
                      <CheckCircle2 className="h-12 w-12 text-[#00FF00]" />
                      <h3 className="font-bold text-white text-xl uppercase">Mensagem enviada!</h3>
                      <p className="text-gray-400 text-sm max-w-sm">
                        Recebemos seu contato e retornaremos em breve.
                      </p>
                    </div>
                  ) : (
                    <form onSubmit={handleSubmit} className="space-y-5">
                      <h2 className="font-bold text-white text-xl uppercase mb-2">Envie sua mensagem</h2>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <Label className="text-gray-300">Nome completo *</Label>
                          <Input value={nome} onChange={(e) => setNome(e.target.value)} required
                            className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                        </div>
                        <div>
                          <Label className="text-gray-300">Telefone / WhatsApp *</Label>
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
                        <Label className="text-gray-300">Serviços de interesse</Label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                          {SERVICOS.map((s) => (
                            <label key={s} className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
                              <Checkbox checked={servicos.includes(s)} onCheckedChange={() => toggleServico(s)} />
                              {s}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div>
                        <Label className="text-gray-300">Mensagem</Label>
                        <Textarea value={mensagem} onChange={(e) => setMensagem(e.target.value)} rows={4}
                          placeholder="Conte-nos mais sobre o que você precisa..."
                          className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                      </div>
                      <Button type="submit" disabled={createLeadMutation.isPending}
                        className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
                        {createLeadMutation.isPending ? "Enviando..." : "Enviar Mensagem"}
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>

              <div className="space-y-5">
                <Card className="bg-[#0F1923] border-[#C9A961]/20">
                  <CardContent className="p-6 space-y-4">
                    <h3 className="text-[#C9A961] font-bold uppercase tracking-wide text-sm mb-2">
                      Informações de Contato
                    </h3>
                    <a href="tel:+5599981392210" className="flex items-start gap-3 text-gray-300 hover:text-[#C9A961] transition-colors">
                      <Phone className="h-4 w-4 text-[#C9A961] mt-0.5 shrink-0" />
                      <div>
                        <p className="font-bold text-sm">(99) 98139-2210</p>
                        <p className="text-xs text-gray-500">Telefone / WhatsApp</p>
                      </div>
                    </a>
                    <div className="flex items-start gap-3 text-gray-300">
                      <MapPin className="h-4 w-4 text-[#C9A961] mt-0.5 shrink-0" />
                      <div>
                        <p className="font-bold text-sm">Leôncio Pires Dourado, 840A — Bacuri</p>
                        <p className="text-xs text-gray-500">CEP 65900-000 · Imperatriz-MA</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 text-gray-300">
                      <Clock className="h-4 w-4 text-[#C9A961] mt-0.5 shrink-0" />
                      <div>
                        <p className="font-bold text-sm">Seg–Sex: 8h às 18h</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <a href="https://wa.me/5599981392210" target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-3 w-full bg-[#25D366] hover:bg-[#20BA5C] text-white font-bold text-sm uppercase tracking-wider py-4 rounded-lg transition-colors">
                  <MessageCircle className="h-5 w-5" />
                  Chamar no WhatsApp
                </a>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
