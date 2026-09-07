import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import Navbar from "@/components/Navbar";
import SEO from "@/components/SEO";
import { ArrowLeft, ArrowRight, Heart, TreePine, Users, Building2, HandHeart, CheckCircle2 } from "lucide-react";

const impacts = [
  { icon: Users, value: "Em breve", label: "Famílias apoiadas" },
  { icon: TreePine, value: "Em breve", label: "Ações ambientais" },
  { icon: Building2, value: "Em breve", label: "Projetos comunitários" },
  { icon: Heart, value: "Em breve", label: "Voluntários ativos" },
];

const actions = [
  "Apoio à educação e formação profissional",
  "Ações de preservação ambiental",
  "Apoio habitacional a famílias em vulnerabilidade",
  "Incentivo ao empreendedorismo local",
];

export default function Instituto() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
      <SEO
        title="Instituto Prospecta"
        description="Conheça o braço social da Prospecta Empreendimentos em Imperatriz-MA — ações sociais, ambientais e educacionais."
        keywords="Instituto Prospecta, responsabilidade social, ações sociais Imperatriz"
      />
      <Navbar />

      <main className="flex-1 py-12">
        <div className="container">
          <Link href="/" className="inline-flex items-center gap-2 text-gray-400 hover:text-[#C9A961] transition-colors mb-6">
            <ArrowLeft className="h-5 w-5" />
            <span>Voltar</span>
          </Link>

          <div className="max-w-5xl mx-auto space-y-10">
            <div className="text-center space-y-4">
              <p className="text-[#C9A961] font-bold text-xs tracking-widest uppercase">Impacto Social</p>
              <h1 className="text-4xl md:text-5xl font-bold text-[#C9A961]">Instituto Prospecta</h1>
              <p className="text-xl text-gray-300 max-w-2xl mx-auto">
                Um braço social em estruturação, dedicado a transformar vidas e comunidades em Imperatriz-MA
                através de ações sociais, ambientais e educacionais.
              </p>
            </div>

            <Card className="bg-[#C9A961]/10 border-[#C9A961]/30">
              <CardContent className="p-0">
                <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-[#C9A961]/20">
                  {impacts.map(({ icon: Icon, value, label }) => (
                    <div key={label} className="flex items-center gap-3 py-6 px-6">
                      <Icon className="h-6 w-6 text-[#C9A961] opacity-70" />
                      <div>
                        <p className="font-black text-lg text-[#C9A961] leading-none">{value}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{label}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
              <div>
                <p className="text-[#C9A961] font-bold text-xs tracking-widest uppercase mb-3">O que pretendemos fazer</p>
                <h2 className="text-2xl md:text-3xl font-bold text-white mb-4">Nossas Ações Sociais</h2>
                <p className="text-gray-400 leading-relaxed mb-6">
                  O Instituto Prospecta está em fase de estruturação para atuar em frentes de desenvolvimento
                  humano, preservação ambiental e qualidade de vida na comunidade de Imperatriz-MA.
                </p>
                <div className="space-y-3">
                  {actions.map((action) => (
                    <div key={action} className="flex items-start gap-3">
                      <CheckCircle2 className="h-4 w-4 text-[#C9A961] shrink-0 mt-0.5" />
                      <span className="text-gray-300 text-sm">{action}</span>
                    </div>
                  ))}
                </div>
              </div>
              <Card className="bg-[#0F1923] border-[#C9A961]/20">
                <CardContent className="p-8 flex flex-col items-center justify-center text-center min-h-[220px]">
                  <HandHeart className="h-12 w-12 text-[#C9A961]/40 mb-4" />
                  <p className="text-gray-400 text-sm">Galeria de ações e parcerias</p>
                  <p className="text-gray-600 text-xs mt-1">Conteúdo será adicionado conforme o instituto for estruturado</p>
                </CardContent>
              </Card>
            </div>

            <Card className="bg-[#C9A961] text-center">
              <CardContent className="p-10">
                <Heart className="h-10 w-10 text-[#1A2332] mx-auto mb-4 opacity-70" />
                <h2 className="text-[#1A2332] font-bold text-2xl md:text-3xl uppercase mb-4">Quer apoiar?</h2>
                <p className="text-[#1A2332]/80 mb-6 max-w-lg mx-auto">
                  As formas de doação e parceria ainda estão sendo definidas. Fale com nossa equipe para saber
                  como colaborar.
                </p>
                <Link href="/contato"
                  className="inline-flex items-center gap-2 bg-[#1A2332] text-[#C9A961] font-bold text-sm uppercase tracking-wider px-6 py-3 rounded hover:opacity-90 transition-opacity">
                  Falar com a equipe <ArrowRight className="h-4 w-4" />
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
