import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Navbar from "@/components/Navbar";
import SEO, { organizationSchema } from "@/components/SEO";
import { ArrowLeft, ArrowRight, ShieldCheck, Heart, Target, Users } from "lucide-react";

const values = [
  {
    icon: ShieldCheck,
    title: "Transparência",
    description: "Comunicação clara em todas as etapas, sem surpresas para quem confia em nós.",
  },
  {
    icon: Heart,
    title: "Compromisso",
    description: "Tratamos cada negócio com dedicação, do primeiro contato à entrega das chaves.",
  },
  {
    icon: Target,
    title: "Excelência",
    description: "Padrão elevado em cada serviço prestado, do financiamento à construção.",
  },
  {
    icon: Users,
    title: "Relacionamento",
    description: "Clientes são parceiros de longo prazo — mantemos contato antes, durante e depois do negócio.",
  },
];

export default function Sobre() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
      <SEO
        title="Sobre Nós"
        description="Conheça a Prospecta Empreendimentos — construção civil e financiamento imobiliário em Imperatriz-MA."
        keywords="sobre a Prospecta, Prospecta Empreendimentos, construção civil Imperatriz"
        schema={{ "@context": "https://schema.org", "@graph": [organizationSchema] }}
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
              <p className="text-[#C9A961] font-bold text-xs tracking-widest uppercase">Nossa história</p>
              <h1 className="text-4xl md:text-5xl font-bold text-[#C9A961]">Construindo a casa dos seus sonhos</h1>
              <p className="text-xl text-gray-300 max-w-2xl mx-auto">
                A Prospecta Empreendimentos nasceu para ser um parceiro completo de quem quer construir,
                comprar ou financiar um imóvel em Imperatriz-MA e região.
              </p>
            </div>

            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
              <CardContent className="p-8 grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                {[
                  { value: "2020", label: "Ano de fundação" },
                  { value: "Em breve", label: "Imóveis negociados" },
                  { value: "Em breve", label: "Clientes atendidos" },
                  { value: "Em breve", label: "Obras acompanhadas" },
                ].map(({ value, label }) => (
                  <div key={label} className="border border-[#C9A961]/10 rounded-lg p-4">
                    <p className="text-[#C9A961] font-black text-2xl">{value}</p>
                    <p className="text-gray-400 text-xs mt-1">{label}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="bg-[#C9A961]/10 border-[#C9A961]/30">
              <CardContent className="p-8 text-center">
                <h2 className="text-2xl md:text-3xl font-bold text-[#C9A961] mb-4">Nossa Missão</h2>
                <p className="text-gray-300 max-w-2xl mx-auto leading-relaxed">
                  Transformar o sonho da casa própria em realidade, oferecendo soluções imobiliárias e de
                  construção completas, com transparência e comprometimento com cada cliente.
                </p>
              </CardContent>
            </Card>

            <div>
              <div className="text-center mb-8">
                <p className="text-[#C9A961] font-bold text-xs tracking-widest uppercase mb-2">O que nos guia</p>
                <h2 className="text-2xl md:text-3xl font-bold text-white">Nossos Valores</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                {values.map(({ icon: Icon, title, description }) => (
                  <Card key={title} className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm text-center">
                    <CardContent className="p-6">
                      <div className="w-12 h-12 bg-[#C9A961] rounded-full flex items-center justify-center mx-auto mb-4">
                        <Icon className="h-5 w-5 text-[#1A2332]" />
                      </div>
                      <h3 className="font-bold text-white uppercase tracking-wide mb-2 text-sm">{title}</h3>
                      <p className="text-gray-400 text-sm leading-relaxed">{description}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            <div>
              <div className="text-center mb-8">
                <p className="text-[#C9A961] font-bold text-xs tracking-widest uppercase mb-2">Quem faz acontecer</p>
                <h2 className="text-2xl md:text-3xl font-bold text-white">Nossa Equipe</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                {["Administrativo", "Equipe Comercial", "Engenharia e Obras", "Financiamento"].map((name) => (
                  <Card key={name} className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm text-center">
                    <CardContent className="p-6">
                      <div className="w-14 h-14 bg-[#C9A961] rounded-full flex items-center justify-center mx-auto mb-3">
                        <span className="text-[#1A2332] font-black text-xl">{name[0]}</span>
                      </div>
                      <p className="text-white font-bold text-sm">{name}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            <div className="text-center pt-4">
              <h2 className="text-2xl md:text-3xl font-bold text-[#C9A961] mb-4">Vamos trabalhar juntos?</h2>
              <Button asChild size="lg" className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
                <Link href="/contato">
                  Falar Conosco <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
