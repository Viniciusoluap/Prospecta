import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Navbar from "@/components/Navbar";
import SEO from "@/components/SEO";
import { ArrowLeft, ArrowRight, Home, Calculator, Wrench, ClipboardCheck, MapPin, FileCheck, CheckCircle2 } from "lucide-react";

const services = [
  {
    icon: Home,
    title: "Corretagem Imobiliária",
    description:
      "Assessoria completa para compra, venda e locação de imóveis residenciais e comerciais em Imperatriz-MA e Canaã dos Carajás-PA.",
    items: [
      "Catálogo de imóveis atualizado",
      "Visitas acompanhadas",
      "Negociação e fechamento",
      "Suporte documental",
    ],
    cta: { label: "Ver imóveis", href: "/imoveis" },
  },
  {
    icon: Calculator,
    title: "Financiamento Habitacional",
    description:
      "Simulação e orientação completa para o financiamento da sua casa própria, desde o terreno até a construção.",
    items: [
      "Simulador de financiamento gratuito",
      "Orientação sobre documentação",
      "Acompanhamento do processo",
      "Uso de FGTS e programas habitacionais",
    ],
    cta: { label: "Simular financiamento", href: "/simulador" },
  },
  {
    icon: Wrench,
    title: "Construção, Obras e Reformas",
    description:
      "Projetos e orçamentos de construção civil com acompanhamento profissional do início ao fim da obra.",
    items: [
      "Projetos e orçamentos sob medida",
      "Cronograma de obra",
      "Acompanhamento de execução",
      "Controle de medições",
    ],
    cta: { label: "Ver projetos e orçamentos", href: "/projetos-orcamentos" },
  },
  {
    icon: ClipboardCheck,
    title: "Avaliação Imobiliária",
    description:
      "Avaliação técnica de imóveis e terrenos com laudo detalhado, seguindo metodologia comparativa de mercado.",
    items: [
      "Avaliação de imóveis residenciais e terrenos",
      "Laudo técnico",
      "Suporte para venda ou financiamento",
    ],
    cta: { label: "Solicitar avaliação", href: "/contato" },
  },
  {
    icon: MapPin,
    title: "Loteamento e Terrenos",
    description:
      "Comercialização de lotes e terrenos com documentação organizada, para construção ou investimento.",
    items: [
      "Lotes residenciais e comerciais",
      "Assessoria de localização",
      "Suporte para financiamento direto",
    ],
    cta: { label: "Ver terrenos disponíveis", href: "/imoveis" },
  },
  {
    icon: FileCheck,
    title: "Regularização Imobiliária",
    description:
      "Serviço em estruturação para apoiar a regularização documental de imóveis junto a cartório e prefeitura.",
    items: ["Em breve — fale com a nossa equipe para mais informações"],
    cta: { label: "Falar com a equipe", href: "/contato" },
    emBreve: true,
  },
];

export default function Servicos() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
      <SEO
        title="Serviços"
        description="Conheça os serviços da Prospecta Empreendimentos: corretagem, financiamento habitacional, obras, avaliação e loteamento em Imperatriz-MA."
        keywords="serviços imobiliários, corretagem, financiamento habitacional, construção civil, avaliação de imóveis, Prospecta Empreendimentos"
      />
      <Navbar />

      <main className="flex-1 py-12">
        <div className="container">
          <Link href="/" className="inline-flex items-center gap-2 text-gray-400 hover:text-[#C9A961] transition-colors mb-6">
            <ArrowLeft className="h-5 w-5" />
            <span>Voltar</span>
          </Link>

          <div className="max-w-5xl mx-auto space-y-4 text-center mb-12">
            <p className="text-[#C9A961] font-bold text-xs tracking-widest uppercase">O que oferecemos</p>
            <h1 className="text-4xl md:text-5xl font-bold text-[#C9A961]">Soluções completas para o seu imóvel</h1>
            <p className="text-xl text-gray-300 max-w-2xl mx-auto">
              Da busca pelo imóvel ideal ao financiamento e construção — a Prospecta acompanha cada etapa.
            </p>
          </div>

          <div className="max-w-5xl mx-auto space-y-6">
            {services.map(({ icon: Icon, title, description, items, cta, emBreve }) => (
              <Card key={title} className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm overflow-hidden">
                <CardContent className="p-0 grid grid-cols-1 md:grid-cols-3">
                  <div className="bg-[#0F1923] p-8 flex flex-col justify-between gap-6">
                    <div>
                      <Icon className="h-9 w-9 text-[#C9A961]" />
                      <h2 className="text-xl font-bold text-white uppercase mt-4 leading-tight">{title}</h2>
                    </div>
                    <Button asChild size="sm" className="w-fit bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
                      <Link href={cta.href}>
                        {cta.label} <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                  <div className="md:col-span-2 p-8">
                    <p className="text-gray-300 leading-relaxed mb-5">{description}</p>
                    {emBreve ? (
                      <p className="text-sm text-[#C9A961]/80 italic">{items[0]}</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {items.map((item) => (
                          <div key={item} className="flex items-start gap-2">
                            <CheckCircle2 className="h-4 w-4 text-[#C9A961] shrink-0 mt-0.5" />
                            <span className="text-sm text-gray-400">{item}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="max-w-3xl mx-auto text-center mt-16">
            <h2 className="text-2xl md:text-3xl font-bold text-[#C9A961] mb-4">Pronto para começar?</h2>
            <p className="text-gray-300 mb-6">Entre em contato e receba orientação gratuita com nossa equipe.</p>
            <Button asChild size="lg" className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
              <Link href="/contato">Falar com a Equipe</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
