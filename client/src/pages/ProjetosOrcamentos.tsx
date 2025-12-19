import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExternalLink, Home, Ruler, DollarSign, CheckCircle, Loader2, Send } from "lucide-react";
import Navbar from "@/components/Navbar";
import SEO from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useState } from "react";
import { toast } from "sonner";

export default function ProjetosOrcamentos() {
  const { user } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [projectType, setProjectType] = useState("");
  const [hasLot, setHasLot] = useState<"yes" | "no" | "not_sure">("not_sure");
  const [message, setMessage] = useState("");

  const createMutation = trpc.budgetRequests.create.useMutation({
    onSuccess: () => {
      toast.success("Orçamento solicitado com sucesso! Entraremos em contato em breve.");
      // Limpar formulário
      setName(user?.name || "");
      setEmail(user?.email || "");
      setPhone("");
      setCity("");
      setProjectType("");
      setHasLot("not_sure");
      setMessage("");
    },
    onError: (error) => {
      toast.error(`Erro ao enviar orçamento: ${error.message}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email) {
      toast.error("Preencha nome e email");
      return;
    }
    createMutation.mutate({
      userId: user?.id,
      name,
      email,
      phone,
      city,
      projectType,
      hasLot,
      message,
    });
  };

  return (
    <div className="min-h-screen bg-[#1A2332]">
      <Navbar />
      
      {/* Hero Section */}
      <section className="py-20 px-4 bg-gradient-to-br from-[#1A2332] to-[#0f1621]">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h1 className="text-5xl md:text-6xl font-bold text-white mb-6">
              Projetos e <span className="text-[#C9A961]">Orçamentos</span>
            </h1>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto">
              Transforme seu terreno em um lar com qualidade, segurança e financiamento facilitado
            </p>
          </div>
        </div>
      </section>

      {/* Projeto Padrão 47m² */}
      <section className="py-16 px-4 bg-white">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-[#1A2332] mb-4">
              Casa Padrão 47m²
            </h2>
            <p className="text-xl text-gray-600">
              Projeto completo e otimizado para sua família
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 items-start">
            {/* Planta Baixa */}
            <Card className="border-2 border-[#C9A961]">
              <CardHeader>
                <CardTitle className="text-2xl text-[#1A2332]">Planta Baixa</CardTitle>
                <CardDescription>Layout funcional e bem distribuído</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="aspect-square bg-gray-100 rounded-lg flex items-center justify-center mb-4">
                  <div className="text-center p-8">
                    <Home className="h-24 w-24 text-[#C9A961] mx-auto mb-4" />
                    <p className="text-gray-600 font-medium">Planta Baixa 47m²</p>
                    <p className="text-sm text-gray-500 mt-2">
                      2 quartos • 1 banheiro<br />
                      Sala • Cozinha • Área de serviço
                    </p>
                  </div>
                </div>
                
                <a 
                  href="https://planner5d.com/view/?key=d5e4c3b2a1" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="w-full"
                >
                  <Button className="w-full bg-[#C9A961] hover:bg-[#b89851] text-white gap-2">
                    <ExternalLink className="h-4 w-4" />
                    Ver Projeto 3D Interativo (Planner5D)
                  </Button>
                </a>
                <p className="text-sm text-gray-500 mt-3 text-center">
                  Visualize o projeto em 3D, caminhe pela casa e personalize os ambientes
                </p>
              </CardContent>
            </Card>

            {/* Detalhes do Projeto */}
            <div className="space-y-6">
              <Card className="border-2 border-[#C9A961]">
                <CardHeader>
                  <CardTitle className="text-2xl text-[#1A2332] flex items-center gap-2">
                    <DollarSign className="h-6 w-6 text-[#C9A961]" />
                    Investimento
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-6">
                    <p className="text-5xl font-bold text-[#C9A961] mb-2">
                      R$ 160.000
                    </p>
                    <p className="text-gray-600">
                      ou <span className="font-bold text-[#1A2332]">160.000 UTEFs</span>
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-xl text-[#1A2332] flex items-center gap-2">
                    <Ruler className="h-5 w-5 text-[#C9A961]" />
                    Especificações
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-5 w-5 text-[#00FF00] flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700">Área construída: 47m²</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-5 w-5 text-[#00FF00] flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700">2 quartos com armários embutidos</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-5 w-5 text-[#00FF00] flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700">1 banheiro completo</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-5 w-5 text-[#00FF00] flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700">Sala de estar integrada</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-5 w-5 text-[#00FF00] flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700">Cozinha americana</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-5 w-5 text-[#00FF00] flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700">Área de serviço</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-5 w-5 text-[#00FF00] flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700">Acabamento padrão de qualidade</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-5 w-5 text-[#00FF00] flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700">Instalações elétricas e hidráulicas completas</span>
                    </li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Formulário de Orçamento */}
      <section className="py-16 px-4 bg-gradient-to-br from-[#1A2332] to-[#0f1621]">
        <div className="container mx-auto max-w-4xl">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-white mb-4">
              Solicite seu <span className="text-[#C9A961]">Orçamento</span>
            </h2>
            <p className="text-xl text-gray-300">
              Preencha o formulário e receba uma proposta personalizada
            </p>
          </div>

          <Card className="border-2 border-[#C9A961]">
            <CardContent className="p-8">
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-gray-700">Nome Completo *</Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      className="border-[#C9A961]/30"
                      placeholder="Seu nome"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-gray-700">E-mail *</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="border-[#C9A961]/30"
                      placeholder="seu@email.com"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="phone" className="text-gray-700">Telefone/WhatsApp</Label>
                    <Input
                      id="phone"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="border-[#C9A961]/30"
                      placeholder="(11) 98765-4321"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="city" className="text-gray-700">Cidade</Label>
                    <Input
                      id="city"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="border-[#C9A961]/30"
                      placeholder="Sua cidade"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="projectType" className="text-gray-700">Tipo de Projeto</Label>
                    <Select value={projectType} onValueChange={setProjectType}>
                      <SelectTrigger className="border-[#C9A961]/30">
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Casa 47m²">Casa 47m²</SelectItem>
                        <SelectItem value="Casa 60m²">Casa 60m²</SelectItem>
                        <SelectItem value="Casa 80m²">Casa 80m²</SelectItem>
                        <SelectItem value="Casa 100m²">Casa 100m²</SelectItem>
                        <SelectItem value="Personalizado">Projeto Personalizado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="hasLot" className="text-gray-700">Possui Terreno?</Label>
                    <Select value={hasLot} onValueChange={(value: any) => setHasLot(value)}>
                      <SelectTrigger className="border-[#C9A961]/30">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="yes">Sim, já tenho terreno</SelectItem>
                        <SelectItem value="no">Não, preciso comprar</SelectItem>
                        <SelectItem value="not_sure">Não tenho certeza</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="message" className="text-gray-700">Mensagem Adicional</Label>
                  <Textarea
                    id="message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="border-[#C9A961]/30"
                    placeholder="Conte-nos mais sobre seu projeto..."
                    rows={4}
                  />
                </div>

                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                  size="lg"
                  className="w-full bg-[#00FF00] hover:bg-[#00dd00] text-black font-bold text-lg py-6 h-auto"
                >
                  {createMutation.isPending ? (
                    <>
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    <>
                      <Send className="h-5 w-5 mr-2" />
                      Solicitar Orçamento Personalizado
                    </>
                  )}
                </Button>

                <div className="pt-6 border-t border-gray-200">
                  <p className="text-sm text-gray-500 text-center">
                    Ou entre em contato diretamente:<br />
                    <strong className="text-[#1A2332]">WhatsApp:</strong> (99) 98139-2210 | (94) 99304-4689<br />
                    <strong className="text-[#1A2332]">E-mail:</strong> contato@prospectaempreendimentos.com
                  </p>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Outros Projetos */}
      <section className="py-16 px-4 bg-white">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-[#1A2332] mb-4">
              Outros <span className="text-[#C9A961]">Projetos</span>
            </h2>
            <p className="text-xl text-gray-600">
              Temos diversas opções de plantas e tamanhos
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <Card className="border-2 border-gray-200 hover:border-[#C9A961] transition-colors">
              <CardHeader>
                <CardTitle className="text-xl text-[#1A2332]">Casa 60m²</CardTitle>
                <CardDescription>3 quartos • 1 banheiro</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-[#C9A961] mb-4">R$ 200.000</p>
                <Button variant="outline" className="w-full border-[#C9A961] text-[#C9A961] hover:bg-[#C9A961] hover:text-white">
                  Ver Detalhes
                </Button>
              </CardContent>
            </Card>

            <Card className="border-2 border-gray-200 hover:border-[#C9A961] transition-colors">
              <CardHeader>
                <CardTitle className="text-xl text-[#1A2332]">Casa 80m²</CardTitle>
                <CardDescription>3 quartos • 2 banheiros</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-[#C9A961] mb-4">R$ 280.000</p>
                <Button variant="outline" className="w-full border-[#C9A961] text-[#C9A961] hover:bg-[#C9A961] hover:text-white">
                  Ver Detalhes
                </Button>
              </CardContent>
            </Card>

            <Card className="border-2 border-gray-200 hover:border-[#C9A961] transition-colors">
              <CardHeader>
                <CardTitle className="text-xl text-[#1A2332]">Casa 100m²</CardTitle>
                <CardDescription>4 quartos • 2 banheiros</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-[#C9A961] mb-4">R$ 350.000</p>
                <Button variant="outline" className="w-full border-[#C9A961] text-[#C9A961] hover:bg-[#C9A961] hover:text-white">
                  Ver Detalhes
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#1A2332] text-white py-8 px-4">
        <div className="container mx-auto text-center">
          <p className="text-gray-400">
            © 2024 Prospecta Construções - Todos os direitos reservados
          </p>
        </div>
      </footer>
    </div>
  );
}
