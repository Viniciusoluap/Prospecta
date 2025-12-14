import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Navbar from "@/components/Navbar";
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
  Quote
} from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      
      <main className="flex-1">
        {/* Hero Section - Imagem de fundo com overlay */}
        <section className="relative h-[600px] flex items-center justify-center text-white overflow-hidden">
          {/* Background Image com overlay escuro */}
          <div 
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: "url('https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1920&h=1080&fit=crop')",
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
              <Button asChild size="lg" className="bg-accent hover:bg-accent/90 text-secondary font-semibold text-lg px-8">
                <Link href="/projetos-orcamentos">
                  Quero financiar minha casa
                  <ChevronRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-2 border-primary text-white hover:bg-primary/20 font-semibold text-lg px-8">
                <Link href="/projetos-orcamentos">
                  Ver Projetos
                </Link>
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
                Usando apenas seu <span className="font-bold text-primary">CPF</span> e um investimento mínimo de <span className="font-bold text-primary">5% do valor do imóvel</span>, risco zero!
              </p>
              <div className="flex justify-center">
                <Button asChild size="lg" className="bg-accent hover:bg-accent/90 text-secondary font-semibold text-lg px-8">
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
                    <h3 className="font-bold text-lg mb-2">500+ Casas</h3>
                    <p className="text-muted-foreground">Entregues em todo o Maranhão</p>
                  </CardContent>
                </Card>
                <Card className="border-primary/30 hover:border-primary transition-colors">
                  <CardContent className="pt-6 text-center">
                    <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                      <Shield className="h-8 w-8 text-primary" />
                    </div>
                    <h3 className="font-bold text-lg mb-2">Garantia Total</h3>
                    <p className="text-muted-foreground">Qualidade certificada e seguro</p>
                  </CardContent>
                </Card>
                <Card className="border-primary/30 hover:border-primary transition-colors">
                  <CardContent className="pt-6 text-center">
                    <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                      <DollarSign className="h-8 w-8 text-primary" />
                    </div>
                    <h3 className="font-bold text-lg mb-2">Financiamento</h3>
                    <p className="text-muted-foreground">Caixa Econômica Federal</p>
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
                Projetos modernos e funcionais, desenvolvidos por arquitetos especializados
              </p>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
              {/* Planta Padrão 47m² */}
              <Card className="bg-white/10 border-primary/30 hover:border-primary transition-all hover:scale-105">
                <CardContent className="p-6">
                  <div className="aspect-video bg-white/5 rounded-lg mb-4 flex items-center justify-center">
                    <HomeIcon className="h-16 w-16 text-primary" />
                  </div>
                  <h3 className="text-2xl font-bold mb-2 text-primary">Casa Padrão 47m²</h3>
                  <p className="text-white/70 mb-4">2 quartos, sala, cozinha, banheiro</p>
                  <p className="text-3xl font-bold text-accent mb-4">R$ 160.000</p>
                  <Button asChild className="w-full bg-accent hover:bg-accent/90 text-secondary">
                    <Link href="/projetos-orcamentos">
                      Ver Detalhes
                    </Link>
                  </Button>
                </CardContent>
              </Card>

              {/* Placeholder para mais plantas */}
              <Card className="bg-white/10 border-primary/30 hover:border-primary transition-all hover:scale-105">
                <CardContent className="p-6">
                  <div className="aspect-video bg-white/5 rounded-lg mb-4 flex items-center justify-center">
                    <HomeIcon className="h-16 w-16 text-primary" />
                  </div>
                  <h3 className="text-2xl font-bold mb-2 text-primary">Casa 60m²</h3>
                  <p className="text-white/70 mb-4">3 quartos, suíte, varanda</p>
                  <p className="text-3xl font-bold text-accent mb-4">Sob Consulta</p>
                  <Button asChild className="w-full bg-accent hover:bg-accent/90 text-secondary">
                    <Link href="/projetos-orcamentos">
                      Solicitar Orçamento
                    </Link>
                  </Button>
                </CardContent>
              </Card>

              <Card className="bg-white/10 border-primary/30 hover:border-primary transition-all hover:scale-105">
                <CardContent className="p-6">
                  <div className="aspect-video bg-white/5 rounded-lg mb-4 flex items-center justify-center">
                    <HomeIcon className="h-16 w-16 text-primary" />
                  </div>
                  <h3 className="text-2xl font-bold mb-2 text-primary">Projeto Personalizado</h3>
                  <p className="text-white/70 mb-4">Desenvolvemos o projeto dos seus sonhos</p>
                  <p className="text-3xl font-bold text-accent mb-4">Sob Medida</p>
                  <Button asChild className="w-full bg-accent hover:bg-accent/90 text-secondary">
                    <Link href="/projetos-orcamentos">
                      Fale Conosco
                    </Link>
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
                <h3 className="text-xl font-bold mb-2 text-secondary">Preço Justo</h3>
                <p className="text-muted-foreground">
                  Valores competitivos e transparência total no orçamento
                </p>
              </div>
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                  <span className="text-4xl font-bold text-primary">2</span>
                </div>
                <h3 className="text-xl font-bold mb-2 text-secondary">Financiamento Facilitado</h3>
                <p className="text-muted-foreground">
                  Parceria com Caixa Econômica Federal - taxas a partir de 4,5% ao ano
                </p>
              </div>
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                  <span className="text-4xl font-bold text-primary">3</span>
                </div>
                <h3 className="text-xl font-bold mb-2 text-secondary">Acompanhamento Total</h3>
                <p className="text-muted-foreground">
                  Relatórios mensais com fotos e medições da evolução da obra
                </p>
              </div>
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                  <span className="text-4xl font-bold text-primary">4</span>
                </div>
                <h3 className="text-xl font-bold mb-2 text-secondary">Garantia de Qualidade</h3>
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
                  <h3 className="text-xl font-bold mb-2 text-primary">Taxas Baixas</h3>
                  <p className="text-white/70">
                    A partir de 4,5% ao ano + TR, as menores do mercado
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-white/10 border-primary/30">
                <CardContent className="pt-6">
                  <CheckCircle2 className="h-12 w-12 text-accent mb-4" />
                  <h3 className="text-xl font-bold mb-2 text-primary">Prazo Longo</h3>
                  <p className="text-white/70">
                    Até 30 anos para pagar, com parcelas que cabem no bolso
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-white/10 border-primary/30">
                <CardContent className="pt-6">
                  <CheckCircle2 className="h-12 w-12 text-accent mb-4" />
                  <h3 className="text-xl font-bold mb-2 text-primary">Use FGTS</h3>
                  <p className="text-white/70">
                    Utilize seu FGTS como entrada ou para amortizar parcelas
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-white/10 border-primary/30">
                <CardContent className="pt-6">
                  <CheckCircle2 className="h-12 w-12 text-accent mb-4" />
                  <h3 className="text-xl font-bold mb-2 text-primary">Sem Burocracia</h3>
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
            <div className="flex justify-center items-center gap-12 flex-wrap">
              {/* Logo Caixa */}
              <div className="grayscale hover:grayscale-0 transition-all">
                <img 
                  src="https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Caixa_Econ%C3%B4mica_Federal_logo.svg/320px-Caixa_Econ%C3%B4mica_Federal_logo.svg.png" 
                  alt="Caixa Econômica Federal" 
                  className="h-16 object-contain"
                />
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
              <Card className="bg-white/10 border-primary/30">
                <CardContent className="pt-6">
                  <Quote className="h-10 w-10 text-accent mb-4" />
                  <p className="text-white/80 mb-4 italic">
                    "A Prospecta realizou meu sonho! Construíram minha casa com qualidade e no prazo. 
                    Recomendo de olhos fechados!"
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
                  <p className="font-bold text-primary mt-2">Bruna Silva</p>
                  <p className="text-sm text-white/60">São Luís - MA</p>
                </CardContent>
              </Card>

              <Card className="bg-white/10 border-primary/30">
                <CardContent className="pt-6">
                  <Quote className="h-10 w-10 text-accent mb-4" />
                  <p className="text-white/80 mb-4 italic">
                    "Excelente atendimento desde o orçamento até a entrega das chaves. 
                    Equipe profissional e comprometida!"
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
                  <p className="font-bold text-primary mt-2">Weeber Santos</p>
                  <p className="text-sm text-white/60">Imperatriz - MA</p>
                </CardContent>
              </Card>

              <Card className="bg-white/10 border-primary/30">
                <CardContent className="pt-6">
                  <Quote className="h-10 w-10 text-accent mb-4" />
                  <p className="text-white/80 mb-4 italic">
                    "Consegui financiar pela Caixa com a ajuda da Prospecta. 
                    Hoje tenho minha casa própria e pago menos que aluguel!"
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
                  <p className="font-bold text-primary mt-2">Madson Oliveira</p>
                  <p className="text-sm text-white/60">Açailândia - MA</p>
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
                <Button asChild size="lg" className="bg-accent hover:bg-accent/90 text-secondary font-semibold text-lg px-8">
                  <Link href="/projetos-orcamentos">
                    Solicitar Orçamento Grátis
                    <ChevronRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="border-2 border-primary hover:bg-primary/10 font-semibold text-lg px-8">
                  <a href="https://wa.me/5599981392210" target="_blank" rel="noopener noreferrer">
                    Falar no WhatsApp
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Seção Portfólio */}
        <section className="py-20 bg-background">
          <div className="container">
            <div className="text-center mb-12">
              <h2 className="text-4xl md:text-5xl font-bold mb-4 text-secondary">
                Conheça nosso portfólio
              </h2>
              <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
                Mais de 500 casas construídas com qualidade e excelência
              </p>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">
              {/* Imagem 1 */}
              <div className="group relative aspect-square overflow-hidden rounded-lg border-2 border-primary/30 hover:border-primary transition-all">
                <img 
                  src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=500&h=500&fit=crop" 
                  alt="Casa construída pela Prospecta" 
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-secondary/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                  <p className="text-white font-semibold">Casa 47m² - Imperatriz</p>
                </div>
              </div>

              {/* Imagem 2 */}
              <div className="group relative aspect-square overflow-hidden rounded-lg border-2 border-primary/30 hover:border-primary transition-all">
                <img 
                  src="https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=500&h=500&fit=crop" 
                  alt="Casa construída pela Prospecta" 
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-secondary/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                  <p className="text-white font-semibold">Casa 60m² - Canaã dos Carajás</p>
                </div>
              </div>

              {/* Imagem 3 */}
              <div className="group relative aspect-square overflow-hidden rounded-lg border-2 border-primary/30 hover:border-primary transition-all">
                <img 
                  src="https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=500&h=500&fit=crop" 
                  alt="Casa construída pela Prospecta" 
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-secondary/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                  <p className="text-white font-semibold">Casa 80m² - Parauapebas</p>
                </div>
              </div>

              {/* Imagem 4 */}
              <div className="group relative aspect-square overflow-hidden rounded-lg border-2 border-primary/30 hover:border-primary transition-all">
                <img 
                  src="https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=500&h=500&fit=crop" 
                  alt="Casa construída pela Prospecta" 
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-secondary/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                  <p className="text-white font-semibold">Casa 100m² - Imperatriz</p>
                </div>
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
                    <p>Não necessariamente! A Prospecta oferece financiamento completo que inclui a compra do terreno e a construção da casa. Você pode financiar tudo junto pela Caixa Econômica Federal.</p>
                  </div>
                </details>

                {/* Pergunta 2 */}
                <details className="group bg-white border-2 border-primary/30 rounded-lg overflow-hidden hover:border-primary transition-colors">
                  <summary className="cursor-pointer p-6 font-semibold text-lg text-secondary flex justify-between items-center">
                    <span>Preciso de DINHEIRO para construir minha casa?</span>
                    <ChevronRight className="h-5 w-5 text-primary group-open:rotate-90 transition-transform" />
                  </summary>
                  <div className="px-6 pb-6 text-muted-foreground">
                    <p>Você precisa apenas de 5% do valor total do imóvel como entrada. Esse valor pode ser parcelado ou pago com FGTS. O restante é financiado com taxas a partir de 4,5% ao ano.</p>
                  </div>
                </details>

                {/* Pergunta 3 */}
                <details className="group bg-white border-2 border-primary/30 rounded-lg overflow-hidden hover:border-primary transition-colors">
                  <summary className="cursor-pointer p-6 font-semibold text-lg text-secondary flex justify-between items-center">
                    <span>É possível ZERAR a entrada?</span>
                    <ChevronRight className="h-5 w-5 text-primary group-open:rotate-90 transition-transform" />
                  </summary>
                  <div className="px-6 pb-6 text-muted-foreground">
                    <p>Sim! Se você tiver saldo suficiente no FGTS, é possível utilizá-lo para cobrir toda a entrada. Assim você começa a construir sem desembolsar dinheiro do bolso.</p>
                  </div>
                </details>

                {/* Pergunta 4 */}
                <details className="group bg-white border-2 border-primary/30 rounded-lg overflow-hidden hover:border-primary transition-colors">
                  <summary className="cursor-pointer p-6 font-semibold text-lg text-secondary flex justify-between items-center">
                    <span>Os 20% de ENTRADA tem que ser pago ao banco?</span>
                    <ChevronRight className="h-5 w-5 text-primary group-open:rotate-90 transition-transform" />
                  </summary>
                  <div className="px-6 pb-6 text-muted-foreground">
                    <p>Não! Com a Prospecta você precisa de apenas 5% de entrada, não 20%. E esse valor pode ser pago diretamente para a construtora de forma parcelada ou com FGTS, facilitando ainda mais o processo.</p>
                  </div>
                </details>
              </div>

              <div className="text-center mt-12">
                <Button asChild size="lg" className="bg-accent hover:bg-accent/90 text-secondary font-semibold text-lg px-8">
                  <a href="https://wa.me/5599981392210" target="_blank" rel="noopener noreferrer">
                    Ainda tem dúvidas? Fale conosco
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Seção Ecossistema Efficaz */}
        <section className="py-20 bg-secondary text-white">
          <div className="container">
            <div className="text-center mb-12">
              <h2 className="text-4xl md:text-5xl font-bold mb-4 text-primary">
                Ecossistema Efficaz
              </h2>
              <p className="text-xl text-white/80 max-w-3xl mx-auto">
                Além da construção, oferecemos um ecossistema completo de investimentos e benefícios
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              <Card className="bg-white/10 border-primary/30 hover:border-primary transition-colors">
                <CardContent className="pt-6 text-center">
                  <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center mx-auto mb-4">
                    <DollarSign className="h-8 w-8 text-accent" />
                  </div>
                  <h3 className="text-xl font-bold mb-2 text-primary">Sorteios</h3>
                  <p className="text-white/70 mb-4">
                    Participe de sorteios e ganhe 200.000 UTEFs
                  </p>
                  <Button asChild variant="outline" className="border-primary text-white hover:bg-primary/20">
                    <Link href="/sorteios">
                      Ver Sorteios
                    </Link>
                  </Button>
                </CardContent>
              </Card>

              <Card className="bg-white/10 border-primary/30 hover:border-primary transition-colors">
                <CardContent className="pt-6 text-center">
                  <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center mx-auto mb-4">
                    <Building2 className="h-8 w-8 text-accent" />
                  </div>
                  <h3 className="text-xl font-bold mb-2 text-primary">Produtos</h3>
                  <p className="text-white/70 mb-4">
                    Converta UTEFs em casas, serviços e embarcações
                  </p>
                  <Button asChild variant="outline" className="border-primary text-white hover:bg-primary/20">
                    <Link href="/produtos">
                      Ver Produtos
                    </Link>
                  </Button>
                </CardContent>
              </Card>

              <Card className="bg-white/10 border-primary/30 hover:border-primary transition-colors">
                <CardContent className="pt-6 text-center">
                  <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center mx-auto mb-4">
                    <Clock className="h-8 w-8 text-accent" />
                  </div>
                  <h3 className="text-xl font-bold mb-2 text-primary">Como Funciona</h3>
                  <p className="text-white/70 mb-4">
                    Entenda o sistema de UTEFs e conversões
                  </p>
                  <Button asChild variant="outline" className="border-primary text-white hover:bg-primary/20">
                    <Link href="/como-funciona">
                      Saiba Mais
                    </Link>
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
                <img src={APP_LOGO} alt="Prospecta Construções" className="h-12 mb-3" />
              </div>
              <h3 className="font-bold text-primary mb-2">PROSPECTA CONSTRUCOES E AVALIACAO IMOBILIARIA LTDA</h3>
              <p className="text-white/70 text-sm">
                CNPJ: 41.865.900/0001-89<br />
                CRECI: 4326
              </p>
            </div>

            {/* Coluna 2: Endereços */}
            <div>
              <h3 className="font-bold text-primary mb-4">Endereços</h3>
              <div className="text-white/70 text-sm space-y-3">
                <p>
                  📍 Leôncio Pires Dourado, 840A<br />
                  Bacuri - Imperatriz - MA
                </p>
                <p>
                  📍 Avenida JK, 103<br />
                  Centro - Canaã dos Carajás
                </p>
                <p>
                  📍 Rua F, 22<br />
                  União - Parauapebas
                </p>
              </div>
            </div>

            {/* Coluna 3: Contato */}
            <div>
              <h3 className="font-bold text-primary mb-4">Contato</h3>
              <p className="text-white/70 text-sm space-y-2">
                <span className="block">📞 (99) 98139-2210</span>
                <span className="block">📞 (94) 99304-4689</span>
                <span className="block">📧 contato@prospectaconstrucoes.com</span>
              </p>
            </div>

            {/* Coluna 4: Links Rápidos */}
            <div>
              <h3 className="font-bold text-primary mb-4">Links Rápidos</h3>
              <div className="flex flex-col gap-2">
                <Link href="/" className="text-white/70 hover:text-primary text-sm transition-colors">
                  Início
                </Link>
                <Link href="/projetos-orcamentos" className="text-white/70 hover:text-primary text-sm transition-colors">
                  Projetos e Orçamentos
                </Link>
                <Link href="/sorteios" className="text-white/70 hover:text-primary text-sm transition-colors">
                  Sorteios
                </Link>
                <Link href="/produtos" className="text-white/70 hover:text-primary text-sm transition-colors">
                  Produtos
                </Link>
                <Link href="/como-funciona" className="text-white/70 hover:text-primary text-sm transition-colors">
                  Como Funciona
                </Link>
              </div>
            </div>
          </div>

          {/* Copyright */}
          <div className="border-t border-white/10 pt-8 text-center text-white/60 text-sm">
            <p>&copy; 2025 Prospecta Construções. Todos os direitos reservados.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
