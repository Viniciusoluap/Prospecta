import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Navbar from "@/components/Navbar";
import SEO, { organizationSchema, localBusinessSchema } from "@/components/SEO";
import { APP_LOGO } from "@/const";
import {
  Home as HomeIcon,
  Building2,
  Shield,
  Clock,
  DollarSign,
  CheckCircle2,
  ChevronRight,
  Star,
  Quote,
} from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <SEO
        title="Início"
        description="VFX Capital / Prospecta Empreendimentos - Construímos a casa dos seus sonhos com financiamento desde o terreno até a construção. Participe do Ecossistema VFX Capital com sorteios, UTEFs e produtos exclusivos em Imperatriz - MA."
        keywords="construção civil, financiamento imobilário, projetos arquitetônicos, sorteios, UTEFs, imóveis, Imperatriz MA, Prospecta Empreendimentos, casa própria"
        schema={{
          "@context": "https://schema.org",
          "@graph": [organizationSchema, localBusinessSchema],
        }}
      />
      <Navbar />

      <main className="flex-1">
        {/* Hero Section - Imagem de fundo com overlay */}
        <section className="relative h-[600px] flex items-center justify-center text-white overflow-hidden">
          {/* Background Image com overlay escuro */}
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage:
                "url('https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1920&h=1080&fit=crop')",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-secondary/95 via-secondary/85 to-secondary/75" />

          {/* Content */}
          <div className="container relative z-10 text-center">
            <h1 className="text-5xl md:text-7xl font-bold mb-6 text-primary drop-shadow-lg">
              Construímos a casa dos seus sonhos!
            </h1>
            <p className="text-xl md:text-2xl mb-8 max-w-3xl mx-auto text-white/90">
              Financiamento desde o terreno até a construção
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                asChild
                size="lg"
                className="bg-accent hover:bg-accent/90 text-secondary font-semibold text-lg px-8"
              >
                <Link href="/simulador">
                  Quero financiar minha casa
                  <ChevronRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-2 border-primary text-white hover:bg-primary/20 font-semibold text-lg px-8"
              >
                <Link href="/projetos-orcamentos">Ver Projetos</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Seção Dourada - Investimento Imobiliário */}
        <section className="py-20 bg-gradient-to-br from-primary/20 via-primary/10 to-background">
          <div className="container">
            <div className="max-w-4xl mx-auto text-center">
              <h2 className="text-4xl md:text-5xl font-bold mb-6 text-secondary">
                Invista no ramo imobiliário!
              </h2>
              <p className="text-xl text-foreground/80 mb-8 leading-relaxed">
                Usando apenas seu{" "}
                <span className="font-bold text-primary">CPF</span> e um
                investimento mínimo de{" "}
                <span className="font-bold text-primary">
                  5% do valor do imóvel
                </span>
                , risco zero!
              </p>
              <div className="flex justify-center">
                <Button
                  asChild
                  size="lg"
                  className="bg-accent hover:bg-accent/90 text-secondary font-semibold text-lg px-8"
                >
                  <Link href="/projetos-orcamentos">
                    Quero investir nesse ramo
                    <ChevronRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
              </div>
              <div className="grid md:grid-cols-3 gap-6 mt-12">
                <Card className="border-primary/30 hover:border-primary transition-colors">
                  <CardContent className="pt-6 text-center">
                    <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                      <Building2 className="h-8 w-8 text-primary" />
                    </div>
                    <h3 className="font-bold text-lg mb-2">100+ Casas</h3>
                    <p className="text-muted-foreground">
                      Entregues em todo o Maranhão e Pará
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-primary/30 hover:border-primary transition-colors">
                  <CardContent className="pt-6 text-center">
                    <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                      <Shield className="h-8 w-8 text-primary" />
                    </div>
                    <h3 className="font-bold text-lg mb-2">Garantia Total</h3>
                    <p className="text-muted-foreground">
                      Qualidade certificada e seguro
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-primary/30 hover:border-primary transition-colors">
                  <CardContent className="pt-6 text-center">
                    <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                      <DollarSign className="h-8 w-8 text-primary" />
                    </div>
                    <h3 className="font-bold text-lg mb-2">Financiamento</h3>
                    <p className="text-muted-foreground">
                      Caixa Econômica Federal e todos os bancos
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </section>

        {/* Seção Azul Escuro - Modelos de Plantas */}
        <section className="py-20 bg-secondary text-white">
          <div className="container">
            <div className="text-center mb-12">
              <h2 className="text-4xl md:text-5xl font-bold mb-4 text-primary">
                Modelos de Plantas
              </h2>
              <p className="text-xl text-white/80 max-w-3xl mx-auto">
                Projetos modernos e funcionais, desenvolvidos por arquitetos
                especializados
              </p>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
              {/* Casa Compacta - Linha Smart */}
              <Card className="bg-white/10 border-primary/30 hover:border-primary transition-all hover:scale-105">
                <CardContent className="p-6">
                  <div className="aspect-video rounded-lg mb-4 overflow-hidden">
                    <img
                      src="/casa-compacta-47m2.jpg"
                      alt="Casa Compacta - Linha Smart"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <h3 className="text-2xl font-bold mb-2 text-primary">
                    Casa Compacta - Linha Smart
                  </h3>
                  <p className="text-white/70 mb-4">
                    2 quartos, sala, cozinha, banheiro
                  </p>
                  <p className="text-3xl font-bold text-accent mb-4">
                    Sob Consulta
                  </p>
                  <Button
                    asChild
                    className="w-full bg-accent hover:bg-accent/90 text-secondary"
                  >
                    <Link href="/projetos-orcamentos">Ver Detalhes</Link>
                  </Button>
                </CardContent>
              </Card>

              {/* Casa Concept - Linha Plus */}
              <Card className="bg-white/10 border-primary/30 hover:border-primary transition-all hover:scale-105">
                <CardContent className="p-6">
                  <div className="aspect-video rounded-lg mb-4 overflow-hidden">
                    <img
                      src="https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=600&h=400&fit=crop"
                      alt="Casa Concept - Linha Plus"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <h3 className="text-2xl font-bold mb-2 text-primary">
                    Casa Concept - Linha Plus
                  </h3>
                  <p className="text-white/70 mb-4">
                    3 quartos, suíte, varanda
                  </p>
                  <p className="text-3xl font-bold text-accent mb-4">
                    Sob Consulta
                  </p>
                  <Button
                    asChild
                    className="w-full bg-accent hover:bg-accent/90 text-secondary"
                  >
                    <Link href="/projetos-orcamentos">Solicitar Orçamento</Link>
                  </Button>
                </CardContent>
              </Card>

              {/* Casa Luxo - Linha Premium */}
              <Card className="bg-white/10 border-primary/30 hover:border-primary transition-all hover:scale-105">
                <CardContent className="p-6">
                  <div className="aspect-video rounded-lg mb-4 overflow-hidden">
                    <img
                      src="https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=600&h=400&fit=crop"
                      alt="Casa Luxo - Linha Premium"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <h3 className="text-2xl font-bold mb-2 text-primary">
                    Casa Luxo - Linha Premium
                  </h3>
                  <p className="text-white/70 mb-4">
                    Desenvolvemos o projeto dos seus sonhos
                  </p>
                  <p className="text-3xl font-bold text-accent mb-4">
                    Sob Medida
                  </p>
                  <Button
                    asChild
                    className="w-full bg-accent hover:bg-accent/90 text-secondary"
                  >
                    <Link href="/projetos-orcamentos">Fale Conosco</Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Seção Branca - Casas na Planta (4 Vantagens) */}
        <section className="py-20 bg-background">
          <div className="container">
            <div className="text-center mb-12">
              <h2 className="text-4xl md:text-5xl font-bold mb-4 text-secondary">
                Por Que Construir na Planta?
              </h2>
              <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
                Vantagens exclusivas para quem constrói com a Prospecta
              </p>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-6xl mx-auto">
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                  <span className="text-4xl font-bold text-primary">1</span>
                </div>
                <h3 className="text-xl font-bold mb-2 text-secondary">
                  Preço Justo
                </h3>
                <p className="text-muted-foreground">
                  Valores competitivos e transparência total no orçamento
                </p>
              </div>
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                  <span className="text-4xl font-bold text-primary">2</span>
                </div>
                <h3 className="text-xl font-bold mb-2 text-secondary">
                  Financiamento Facilitado
                </h3>
                <p className="text-muted-foreground">
                  Parceria com Caixa Econômica Federal - taxas a partir de 4,5%
                  ao ano
                </p>
              </div>
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                  <span className="text-4xl font-bold text-primary">3</span>
                </div>
                <h3 className="text-xl font-bold mb-2 text-secondary">
                  Acompanhamento Total
                </h3>
                <p className="text-muted-foreground">
                  Relatórios mensais com fotos e medições da evolução da obra
                </p>
              </div>
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                  <span className="text-4xl font-bold text-primary">4</span>
                </div>
                <h3 className="text-xl font-bold mb-2 text-secondary">
                  Garantia de Qualidade
                </h3>
                <p className="text-muted-foreground">
                  Materiais de primeira linha e mão de obra qualificada
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Seção Azul Escuro - Vantagens de Construção Financiada */}
        <section className="py-20 bg-secondary text-white">
          <div className="container">
            <div className="text-center mb-12">
              <h2 className="text-4xl md:text-5xl font-bold mb-4 text-primary">
                Vantagens de Construir Financiado
              </h2>
              <p className="text-xl text-white/80 max-w-3xl mx-auto">
                Realize o sonho da casa própria sem comprometer seu orçamento
              </p>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
              <Card className="bg-white/10 border-primary/30">
                <CardContent className="pt-6">
                  <CheckCircle2 className="h-12 w-12 text-accent mb-4" />
                  <h3 className="text-xl font-bold mb-2 text-primary">
                    Taxas Baixas
                  </h3>
                  <p className="text-white/70">
                    A partir de 4,5% ao ano + TR, as menores do mercado
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-white/10 border-primary/30">
                <CardContent className="pt-6">
                  <CheckCircle2 className="h-12 w-12 text-accent mb-4" />
                  <h3 className="text-xl font-bold mb-2 text-primary">
                    Prazo Longo
                  </h3>
                  <p className="text-white/70">
                    Até 35 anos ou 420 meses para pagar, com parcelas que cabem
                    no bolso
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-white/10 border-primary/30">
                <CardContent className="pt-6">
                  <CheckCircle2 className="h-12 w-12 text-accent mb-4" />
                  <h3 className="text-xl font-bold mb-2 text-primary">
                    Use FGTS
                  </h3>
                  <p className="text-white/70">
                    Utilize seu FGTS como entrada ou para amortizar parcelas
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-white/10 border-primary/30">
                <CardContent className="pt-6">
                  <CheckCircle2 className="h-12 w-12 text-accent mb-4" />
                  <h3 className="text-xl font-bold mb-2 text-primary">
                    Subsídios
                  </h3>
                  <p className="text-white/70">
                    Subsídios do MCMV podem chegar até R$ 55.000 e entram como
                    entrada, reduzindo ou zerando seu investimento inicial
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-white/10 border-primary/30">
                <CardContent className="pt-6">
                  <CheckCircle2 className="h-12 w-12 text-accent mb-4" />
                  <h3 className="text-xl font-bold mb-2 text-primary">
                    Sem Burocracia
                  </h3>
                  <p className="text-white/70">
                    Cuidamos de toda a documentação e aprovação do financiamento
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Seção Branca - Parceiros */}
        <section className="py-20 bg-background">
          <div className="container">
            <div className="text-center mb-12">
              <h2 className="text-4xl md:text-5xl font-bold mb-4 text-secondary">
                Nossos Parceiros
              </h2>
              <p className="text-xl text-muted-foreground">
                Trabalhamos com as melhores instituições financeiras do país
              </p>
            </div>
            <div className="flex justify-center items-center gap-8 md:gap-12 flex-wrap">
              {/* Logo Caixa */}
              <div className="grayscale hover:grayscale-0 transition-all">
                <img
                  src="/logo-caixa.png"
                  alt="Caixa Econômica Federal"
                  className="h-12 md:h-16 object-contain"
                />
              </div>
              {/* Logo Inter */}
              <div className="grayscale hover:grayscale-0 transition-all">
                <img
                  src="/logo-inter.png"
                  alt="Banco Inter"
                  className="h-12 md:h-16 object-contain"
                />
              </div>
              {/* Logo Bradesco */}
              <div className="grayscale hover:grayscale-0 transition-all">
                <img
                  src="/logo-bradesco.png"
                  alt="Bradesco"
                  className="h-12 md:h-16 object-contain"
                />
              </div>
              {/* Logo Santander */}
              <div className="grayscale hover:grayscale-0 transition-all">
                <img
                  src="/logo-santander.png"
                  alt="Santander"
                  className="h-12 md:h-16 object-contain"
                />
              </div>
              {/* Logo Itaú */}
              <div className="grayscale hover:grayscale-0 transition-all">
                <img
                  src="/logo-itau.png"
                  alt="Itaú"
                  className="h-12 md:h-16 object-contain"
                />
              </div>
              {/* Logo Exclusive Club */}
              <div className="grayscale hover:grayscale-0 transition-all flex items-center gap-2">
                <img
                  src="https://d2xsxph8kpxj0f.cloudfront.net/310419663028705863/XKiYeWQckm4y8ZFAdaZbRn/exclusive-club-logo_7a4d7eae.png"
                  alt="Exclusive Club"
                  className="h-12 md:h-16 object-contain"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Seção Redes Sociais - Portfólio Digital */}
        <section className="py-16 bg-gradient-to-br from-background via-primary/5 to-background">
          <div className="container">
            <div className="text-center mb-10">
              <h2 className="text-3xl md:text-4xl font-bold mb-3 text-secondary">
                Veja Com Seus Próprios Olhos
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Mais de{" "}
                <span className="text-primary font-bold">
                  100 casas entregues
                </span>{" "}
                documentadas em vídeo. Cada projeto conta uma história de
                transformação.
              </p>
            </div>

            <div className="max-w-5xl mx-auto">
              {/* Texto PNL */}
              <div className="text-center mb-8 px-4">
                <p className="text-muted-foreground leading-relaxed">
                  <span className="text-secondary font-semibold">Imagine</span>{" "}
                  poder acompanhar cada etapa da construção, ver os detalhes do
                  acabamento e ouvir diretamente de quem já realizou o sonho da
                  casa própria.
                  <span className="text-primary font-semibold">
                    Agora você pode.
                  </span>
                </p>
                <p className="text-muted-foreground mt-3">
                  Nossos canais mostram{" "}
                  <span className="font-semibold">tudo</span>: obras em
                  andamento, casas finalizadas, depoimentos reais e dicas
                  exclusivas sobre financiamento.
                  <span className="text-secondary font-semibold">
                    A transparência que você merece.
                  </span>
                </p>
              </div>

              {/* Cards das Redes Sociais */}
              <div className="grid md:grid-cols-2 gap-6">
                {/* YouTube */}
                <a
                  href="https://youtube.com/@vinigfreitas"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block"
                >
                  <div className="bg-white rounded-xl border-2 border-red-500/30 hover:border-red-500 transition-all p-6 hover:shadow-lg hover:shadow-red-500/10">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-14 h-14 bg-red-500 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                        <svg
                          className="w-7 h-7 text-white"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-secondary group-hover:text-red-500 transition-colors">
                          YouTube
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          @vinigfreitas
                        </p>
                      </div>
                    </div>
                    <p className="text-muted-foreground text-sm mb-4">
                      <span className="font-semibold text-secondary">
                        Vídeos completos
                      </span>{" "}
                      de todas as obras, tours pelas casas finalizadas e
                      conteúdo exclusivo sobre investimentos imobiliários.
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        Clique para conhecer o canal
                      </span>
                      <ChevronRight className="h-5 w-5 text-red-500 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                </a>

                {/* Instagram */}
                <a
                  href="https://www.instagram.com/imoveiscomvinifreitas"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block"
                >
                  <div className="bg-white rounded-xl border-2 border-pink-500/30 hover:border-pink-500 transition-all p-6 hover:shadow-lg hover:shadow-pink-500/10">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-14 h-14 bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                        <svg
                          className="w-7 h-7 text-white"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-secondary group-hover:text-pink-500 transition-colors">
                          Instagram
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          @imoveiscomvinifreitas
                        </p>
                      </div>
                    </div>
                    <p className="text-muted-foreground text-sm mb-4">
                      <span className="font-semibold text-secondary">
                        Bastidores das obras
                      </span>
                      , stories diários, reels com dicas rápidas e interação
                      direta com nossa equipe.
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        Clique para seguir
                      </span>
                      <ChevronRight className="h-5 w-5 text-pink-500 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                </a>
              </div>

              {/* Vídeos em Destaque do YouTube */}
              <div className="mt-12">
                <h3 className="text-xl font-bold text-secondary text-center mb-6">
                  <span className="text-red-500">Vídeos</span> em Destaque
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {/* Vídeo 1 */}
                  <a
                    href="https://www.youtube.com/watch?v=u2aKrBnq_dU"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative aspect-video rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-all"
                  >
                    <img
                      src="https://img.youtube.com/vi/u2aKrBnq_dU/mqdefault.jpg"
                      alt="Casa própria em Imperatriz"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <div className="w-12 h-12 bg-red-500 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                        <svg
                          className="w-5 h-5 text-white ml-1"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                      <p className="text-white text-xs font-medium truncate">
                        Casa própria em Imperatriz
                      </p>
                      <p className="text-white/70 text-xs">1K views</p>
                    </div>
                  </a>

                  {/* Vídeo 2 */}
                  <a
                    href="https://www.youtube.com/shorts/sUKLiYMfFaE"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative aspect-video rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-all"
                  >
                    <img
                      src="https://img.youtube.com/vi/sUKLiYMfFaE/mqdefault.jpg"
                      alt="Casa 45m² Imperatriz"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <div className="w-12 h-12 bg-red-500 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                        <svg
                          className="w-5 h-5 text-white ml-1"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                      <p className="text-white text-xs font-medium truncate">
                        Casa 45m² Imperatriz
                      </p>
                      <p className="text-white/70 text-xs">Shorts</p>
                    </div>
                  </a>

                  {/* Vídeo 3 */}
                  <a
                    href="https://www.youtube.com/shorts/ILCOWiUJTBM"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative aspect-video rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-all"
                  >
                    <img
                      src="https://img.youtube.com/vi/ILCOWiUJTBM/mqdefault.jpg"
                      alt="Casa 50m² Canaã"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <div className="w-12 h-12 bg-red-500 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                        <svg
                          className="w-5 h-5 text-white ml-1"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                      <p className="text-white text-xs font-medium truncate">
                        Casa 50m² Canaã
                      </p>
                      <p className="text-white/70 text-xs">Shorts</p>
                    </div>
                  </a>

                  {/* Vídeo 4 */}
                  <a
                    href="https://www.youtube.com/shorts/5wQWuppuLwM"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative aspect-video rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-all"
                  >
                    <img
                      src="https://img.youtube.com/vi/5wQWuppuLwM/mqdefault.jpg"
                      alt="Investidor ROI 78,5%"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <div className="w-12 h-12 bg-red-500 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                        <svg
                          className="w-5 h-5 text-white ml-1"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                      <p className="text-white text-xs font-medium truncate">
                        Investidor ROI 78,5%
                      </p>
                      <p className="text-white/70 text-xs">Shorts</p>
                    </div>
                  </a>
                </div>
              </div>

              {/* Feed do Instagram - Preview */}
              <div className="mt-12">
                <h3 className="text-xl font-bold text-secondary text-center mb-6">
                  <span className="bg-gradient-to-r from-purple-500 via-pink-500 to-orange-400 bg-clip-text text-transparent">
                    Instagram
                  </span>{" "}
                  Feed
                </h3>
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                  {/* Post 1 */}
                  <a
                    href="https://www.instagram.com/imoveiscomvinifreitas"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative aspect-square rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-all"
                  >
                    <img
                      src="https://img.youtube.com/vi/sUKLiYMfFaE/mqdefault.jpg"
                      alt="Post Instagram"
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <svg
                        className="w-8 h-8 text-white"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073z" />
                      </svg>
                    </div>
                  </a>
                  {/* Post 2 */}
                  <a
                    href="https://www.instagram.com/imoveiscomvinifreitas"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative aspect-square rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-all"
                  >
                    <img
                      src="https://img.youtube.com/vi/ILCOWiUJTBM/mqdefault.jpg"
                      alt="Post Instagram"
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <svg
                        className="w-8 h-8 text-white"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073z" />
                      </svg>
                    </div>
                  </a>
                  {/* Post 3 */}
                  <a
                    href="https://www.instagram.com/imoveiscomvinifreitas"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative aspect-square rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-all"
                  >
                    <img
                      src="https://img.youtube.com/vi/5wQWuppuLwM/mqdefault.jpg"
                      alt="Post Instagram"
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <svg
                        className="w-8 h-8 text-white"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073z" />
                      </svg>
                    </div>
                  </a>
                  {/* Post 4 */}
                  <a
                    href="https://www.instagram.com/imoveiscomvinifreitas"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative aspect-square rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-all"
                  >
                    <img
                      src="https://img.youtube.com/vi/u2aKrBnq_dU/mqdefault.jpg"
                      alt="Post Instagram"
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <svg
                        className="w-8 h-8 text-white"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073z" />
                      </svg>
                    </div>
                  </a>
                  {/* Post 5 */}
                  <a
                    href="https://www.instagram.com/imoveiscomvinifreitas"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative aspect-square rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-all hidden md:block"
                  >
                    <div className="w-full h-full bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center">
                      <div className="text-center text-white p-2">
                        <svg
                          className="w-8 h-8 mx-auto mb-1"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073z" />
                        </svg>
                        <p className="text-xs font-bold">Ver mais</p>
                      </div>
                    </div>
                  </a>
                  {/* Post 6 - Ver mais */}
                  <a
                    href="https://www.instagram.com/imoveiscomvinifreitas"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative aspect-square rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-all hidden md:block"
                  >
                    <div className="w-full h-full bg-secondary flex items-center justify-center">
                      <div className="text-center text-white p-2">
                        <ChevronRight className="w-8 h-8 mx-auto mb-1" />
                        <p className="text-xs font-bold">Seguir</p>
                      </div>
                    </div>
                  </a>
                </div>
              </div>

              {/* CTA Final */}
              <div className="text-center mt-8">
                <p className="text-sm text-muted-foreground">
                  <span className="text-primary font-semibold">Dica:</span> Siga
                  nossos canais para receber novidades em primeira mão e não
                  perder nenhuma oportunidade!
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Seção Azul Escuro - Depoimentos */}
        <section className="py-20 bg-secondary text-white">
          <div className="container">
            <div className="text-center mb-12">
              <h2 className="text-4xl md:text-5xl font-bold mb-4 text-primary">
                O Que Nossos Clientes Dizem
              </h2>
              <p className="text-xl text-white/80">
                Histórias reais de quem realizou o sonho da casa própria
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
              {/* Depoimento 1 - Aberione Sousa */}
              <Card className="bg-white/10 border-primary/30">
                <CardContent className="pt-6">
                  <div className="mb-4 rounded-lg overflow-hidden aspect-[9/16] max-h-[280px]">
                    <iframe
                      src="https://www.youtube.com/embed/sUKLiYMfFaE"
                      title="Depoimento Aberione Sousa"
                      className="w-full h-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                  <p className="text-white/80 mb-4 italic text-sm">
                    "A Prospecta realizou meu sonho! Construíram minha casa com
                    qualidade e no prazo. Recomendo de olhos fechados!"
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="flex text-accent">
                      <Star className="h-4 w-4 fill-current" />
                      <Star className="h-4 w-4 fill-current" />
                      <Star className="h-4 w-4 fill-current" />
                      <Star className="h-4 w-4 fill-current" />
                      <Star className="h-4 w-4 fill-current" />
                    </div>
                  </div>
                  <p className="font-bold text-primary mt-2">Aberione Sousa</p>
                  <p className="text-sm text-white/60">Imperatriz - MA</p>
                </CardContent>
              </Card>

              {/* Depoimento 2 - Maysa Silva */}
              <Card className="bg-white/10 border-primary/30">
                <CardContent className="pt-6">
                  <div className="mb-4 rounded-lg overflow-hidden aspect-[9/16] max-h-[280px]">
                    <iframe
                      src="https://www.youtube.com/embed/ILCOWiUJTBM"
                      title="Depoimento Maysa Silva"
                      className="w-full h-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                  <p className="text-white/80 mb-4 italic text-sm">
                    "Excelente atendimento desde o orçamento até a entrega das
                    chaves. Equipe profissional e comprometida!"
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="flex text-accent">
                      <Star className="h-4 w-4 fill-current" />
                      <Star className="h-4 w-4 fill-current" />
                      <Star className="h-4 w-4 fill-current" />
                      <Star className="h-4 w-4 fill-current" />
                      <Star className="h-4 w-4 fill-current" />
                    </div>
                  </div>
                  <p className="font-bold text-primary mt-2">Maysa Silva</p>
                  <p className="text-sm text-white/60">
                    Canaã dos Carajás - PA
                  </p>
                </CardContent>
              </Card>

              {/* Depoimento 3 - Guilherme Amorim (Investidor) */}
              <Card className="bg-white/10 border-primary/30">
                <CardContent className="pt-6">
                  <div className="mb-4 rounded-lg overflow-hidden aspect-[9/16] max-h-[280px]">
                    <iframe
                      src="https://www.youtube.com/embed/5wQWuppuLwM"
                      title="Depoimento Guilherme Amorim"
                      className="w-full h-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                  <p className="text-white/80 mb-4 italic text-sm">
                    "Esse é um dos nossos investidores e um verdadeiro case de
                    sucesso! Ele investiu R$ 7.750,00 e, em apenas 5 meses,
                    recebeu R$ 13.837,50! Isso representa um ROI de 78,5%, ou
                    seja, 15,7% ao mês! Utilizamos um modelo de investimento
                    estrategicamente financiado pela Caixa, garantindo segurança
                    e alta rentabilidade!"
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="flex text-accent">
                      <Star className="h-4 w-4 fill-current" />
                      <Star className="h-4 w-4 fill-current" />
                      <Star className="h-4 w-4 fill-current" />
                      <Star className="h-4 w-4 fill-current" />
                      <Star className="h-4 w-4 fill-current" />
                    </div>
                  </div>
                  <p className="font-bold text-primary mt-2">
                    Guilherme Amorim
                  </p>
                  <p className="text-sm text-white/60">São Paulo - SP</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* CTA Final */}
        <section className="py-20 bg-gradient-to-br from-primary/20 via-primary/10 to-background">
          <div className="container">
            <div className="max-w-4xl mx-auto text-center">
              <h2 className="text-4xl md:text-5xl font-bold mb-6 text-secondary">
                Pronto Para Construir Seu Sonho?
              </h2>
              <p className="text-xl text-muted-foreground mb-8">
                Entre em contato e solicite um orçamento sem compromisso
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button
                  asChild
                  size="lg"
                  className="bg-accent hover:bg-accent/90 text-secondary font-semibold text-lg px-8"
                >
                  <Link href="/projetos-orcamentos">
                    Solicitar Orçamento Grátis
                    <ChevronRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-2 border-primary hover:bg-primary/10 font-semibold text-lg px-8"
                >
                  <a
                    href="https://wa.me/5599981392210"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Falar no WhatsApp
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Seção FAQ */}
        <section className="py-20 bg-gradient-to-br from-primary/20 via-primary/10 to-background">
          <div className="container">
            <div className="max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-4xl md:text-5xl font-bold mb-4 text-secondary">
                  Perguntas Frequentes
                </h2>
                <p className="text-xl text-muted-foreground">
                  Tire suas dúvidas sobre financiamento e construção
                </p>
              </div>

              <div className="space-y-4">
                {/* Pergunta 1 */}
                <details className="group bg-white border-2 border-primary/30 rounded-lg overflow-hidden hover:border-primary transition-colors">
                  <summary className="cursor-pointer p-6 font-semibold text-lg text-secondary flex justify-between items-center">
                    <span>Preciso ter terreno para construir minha casa?</span>
                    <ChevronRight className="h-5 w-5 text-primary group-open:rotate-90 transition-transform" />
                  </summary>
                  <div className="px-6 pb-6 text-muted-foreground">
                    <p>
                      Não necessariamente! A Prospecta oferece financiamento
                      completo que inclui a compra do terreno e a construção da
                      casa. Você pode financiar tudo junto pela Caixa Econômica
                      Federal.
                    </p>
                  </div>
                </details>

                {/* Pergunta 2 */}
                <details className="group bg-white border-2 border-primary/30 rounded-lg overflow-hidden hover:border-primary transition-colors">
                  <summary className="cursor-pointer p-6 font-semibold text-lg text-secondary flex justify-between items-center">
                    <span>Preciso de DINHEIRO para construir minha casa?</span>
                    <ChevronRight className="h-5 w-5 text-primary group-open:rotate-90 transition-transform" />
                  </summary>
                  <div className="px-6 pb-6 text-muted-foreground">
                    <p>
                      Você precisa apenas de 5% do valor total do imóvel como
                      entrada. Esse valor pode ser parcelado ou pago com FGTS. O
                      restante é financiado com taxas a partir de 4,5% ao ano.
                    </p>
                  </div>
                </details>

                {/* Pergunta 3 */}
                <details className="group bg-white border-2 border-primary/30 rounded-lg overflow-hidden hover:border-primary transition-colors">
                  <summary className="cursor-pointer p-6 font-semibold text-lg text-secondary flex justify-between items-center">
                    <span>É possível ZERAR a entrada?</span>
                    <ChevronRight className="h-5 w-5 text-primary group-open:rotate-90 transition-transform" />
                  </summary>
                  <div className="px-6 pb-6 text-muted-foreground">
                    <p>
                      Sim! Existem três situações que isso ocorre: a primeira é
                      se você tiver saldo suficiente no FGTS, é possível
                      utilizá-lo para cobrir toda a entrada; a segunda é se você
                      for beneficiado com Subsídios do governo e esse valor
                      cobrir toda sua entrada; e a terceira opção é se você já
                      tiver um terreno quitado. Assim você começa a construir
                      sem desembolsar dinheiro do bolso.
                    </p>
                  </div>
                </details>
              </div>

              <div className="text-center mt-12">
                <Button
                  asChild
                  size="lg"
                  className="bg-accent hover:bg-accent/90 text-secondary font-semibold text-lg px-8"
                >
                  <a
                    href="https://wa.me/5599981392210"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Ainda tem dúvidas? Fale conosco
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Seção Ecossistema VFX Capital */}
        <section className="py-20 bg-secondary text-white">
          <div className="container">
            <div className="text-center mb-12">
              <h2 className="text-4xl md:text-5xl font-bold mb-4 text-primary">
                Ecossistema VFX Capital
              </h2>
              <p className="text-xl text-white/80 max-w-3xl mx-auto">
                Além da construção, oferecemos um ecossistema completo de
                investimentos e benefícios
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              <Card className="bg-white/10 border-primary/30 hover:border-primary transition-colors">
                <CardContent className="pt-6 text-center">
                  <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center mx-auto mb-4">
                    <DollarSign className="h-8 w-8 text-accent" />
                  </div>
                  <h3 className="text-xl font-bold mb-2 text-primary">
                    Sorteios
                  </h3>
                  <p className="text-white/70 mb-4">
                    Participe de sorteios e ganhe 200.000 UTEFs
                  </p>
                  <Button
                    asChild
                    variant="outline"
                    className="border-primary text-white hover:bg-primary/20"
                  >
                    <Link href="/sorteios">Ver Sorteios</Link>
                  </Button>
                </CardContent>
              </Card>

              <Card className="bg-white/10 border-primary/30 hover:border-primary transition-colors">
                <CardContent className="pt-6 text-center">
                  <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center mx-auto mb-4">
                    <Building2 className="h-8 w-8 text-accent" />
                  </div>
                  <h3 className="text-xl font-bold mb-2 text-primary">
                    Produtos
                  </h3>
                  <p className="text-white/70 mb-4">
                    Converta UTEFs em casas, serviços e embarcações
                  </p>
                  <Button
                    asChild
                    variant="outline"
                    className="border-primary text-white hover:bg-primary/20"
                  >
                    <Link href="/produtos">Ver Produtos</Link>
                  </Button>
                </CardContent>
              </Card>

              <Card className="bg-white/10 border-primary/30 hover:border-primary transition-colors">
                <CardContent className="pt-6 text-center">
                  <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center mx-auto mb-4">
                    <Clock className="h-8 w-8 text-accent" />
                  </div>
                  <h3 className="text-xl font-bold mb-2 text-primary">
                    Como Funciona
                  </h3>
                  <p className="text-white/70 mb-4">
                    Entenda o sistema de UTEFs e conversões
                  </p>
                  <Button
                    asChild
                    variant="outline"
                    className="border-primary text-white hover:bg-primary/20"
                  >
                    <Link href="/como-funciona">Saiba Mais</Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-secondary text-white py-12">
        <div className="container">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            {/* Coluna 1: Sobre a Prospecta */}
            <div>
              <div className="mb-4">
                <img
                  src={APP_LOGO}
                  alt="Prospecta Construções"
                  className="h-12 mb-3"
                />
              </div>
              <h3 className="font-bold text-primary mb-2">
                PROSPECTA CONSTRUCOES E AVALIACAO IMOBILIARIA LTDA
              </h3>
              <p className="text-white/70 text-sm">
                CNPJ: 41.865.900/0001-89
                <br />
                CRECI: 4326
              </p>
            </div>

            {/* Coluna 2: Endereços */}
            <div>
              <h3 className="font-bold text-primary mb-4">Endereços</h3>
              <div className="text-white/70 text-sm space-y-3">
                <p>
                  📍 Leôncio Pires Dourado, 840A
                  <br />
                  Bacuri - Imperatriz - MA
                </p>
                <p>
                  📍 Avenida JK, 103
                  <br />
                  Centro - Canaã dos Carajás
                </p>
              </div>
            </div>

            {/* Coluna 3: Contato */}
            <div>
              <h3 className="font-bold text-primary mb-4">Contato</h3>
              <p className="text-white/70 text-sm space-y-2">
                <span className="block">📞 (99) 98139-2210</span>
                <span className="block">📞 (94) 99304-4689</span>
                <span className="block">
                  📧 atendimento@prospectaconstrucoes.com
                </span>
              </p>
            </div>

            {/* Coluna 4: Links Rápidos */}
            <div>
              <h3 className="font-bold text-primary mb-4">Links Rápidos</h3>
              <div className="flex flex-col gap-2">
                <Link
                  href="/"
                  className="text-white/70 hover:text-primary text-sm transition-colors"
                >
                  Início
                </Link>
                <Link
                  href="/projetos-orcamentos"
                  className="text-white/70 hover:text-primary text-sm transition-colors"
                >
                  Projetos e Orçamentos
                </Link>
                <Link
                  href="/sorteios"
                  className="text-white/70 hover:text-primary text-sm transition-colors"
                >
                  Sorteios
                </Link>
                <Link
                  href="/produtos"
                  className="text-white/70 hover:text-primary text-sm transition-colors"
                >
                  Produtos
                </Link>
                <Link
                  href="/como-funciona"
                  className="text-white/70 hover:text-primary text-sm transition-colors"
                >
                  Como Funciona
                </Link>
              </div>
            </div>
          </div>

          {/* Copyright e Links Legais */}
          <div className="border-t border-white/10 pt-8">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-4">
              <div className="flex flex-wrap justify-center gap-4 text-sm">
                <Link
                  href="/regulamento"
                  className="text-white/60 hover:text-primary transition-colors"
                >
                  Regulamento do Sorteio
                </Link>
                <span className="text-white/30">|</span>
                <Link
                  href="/termos-de-uso"
                  className="text-white/60 hover:text-primary transition-colors"
                >
                  Termos de Uso
                </Link>
                <span className="text-white/30">|</span>
                <Link
                  href="/politica-de-privacidade"
                  className="text-white/60 hover:text-primary transition-colors"
                >
                  Política de Privacidade
                </Link>
                <span className="text-white/30">|</span>
                <Link
                  href="/faq"
                  className="text-white/60 hover:text-primary transition-colors"
                >
                  FAQ
                </Link>
              </div>
            </div>
            <div className="text-center text-white/60 text-sm">
              <p>
                &copy; 2025 Prospecta Construções. Todos os direitos reservados.
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
