import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EcossistemaVfx } from "@/components/EcossistemaVfx";
import Navbar from "@/components/Navbar";
import SEO, { organizationSchema, localBusinessSchema } from "@/components/SEO";
import SocialProofSection from "@/components/SocialProofSection";
import { APP_LOGO } from "@/const";
import {
  Home as HomeIcon,
  Building2,
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
      <SEO 
        title="Início"
        description="VFX Capital / Prospecta Empreendimentos - Construímos a casa dos seus sonhos com financiamento desde o terreno até a construção. Participe do Ecossistema VFX Capital com sorteios, UTEFs e produtos exclusivos em Imperatriz - MA."
        keywords="construção civil, financiamento imobiliário, projetos arquitetônicos, sorteios, UTEFs, imóveis, Imperatriz MA, Prospecta Empreendimentos, casa própria"
        schema={{
          "@context": "https://schema.org",
          "@graph": [organizationSchema, localBusinessSchema]
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
                <Link href="/simulador">
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
              {/* Casa Compacta - Linha Smart */}
              <Card className="bg-white/10 border-primary/30 hover:border-primary transition-all hover:scale-105">
                <CardContent className="p-6">
                  <div className="aspect-video rounded-lg mb-4 overflow-hidden">
                    <img 
                      src="/casa-compacta-linha-smart.jpg"
                      alt="Casa Compacta - Linha Smart" 
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <h3 className="text-2xl font-bold mb-2 text-primary">Casa Compacta - Linha Smart</h3>
                  <p className="text-white/70 mb-4">2 quartos, sala, cozinha, banheiro</p>
                  <p className="text-3xl font-bold text-accent mb-4">Sob Consulta</p>
                  <Button asChild className="w-full bg-accent hover:bg-accent/90 text-secondary">
                    <Link href="/projetos-orcamentos">
                      Ver Detalhes
                    </Link>
                  </Button>
                </CardContent>
              </Card>

              {/* Casa Concept - Linha Plus */}
              <Card className="bg-white/10 border-primary/30 hover:border-primary transition-all hover:scale-105">
                <CardContent className="p-6">
                  <div className="aspect-video rounded-lg mb-4 overflow-hidden">
                    <img 
                      src="/casa-concept-linha-plus.jpg"
                      alt="Casa Concept - Linha Plus" 
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <h3 className="text-2xl font-bold mb-2 text-primary">Casa Concept - Linha Plus</h3>
                  <p className="text-white/70 mb-4">3 quartos, suíte, varanda</p>
                  <p className="text-3xl font-bold text-accent mb-4">Sob Consulta</p>
                  <Button asChild className="w-full bg-accent hover:bg-accent/90 text-secondary">
                    <Link href="/projetos-orcamentos">
                      Solicitar Orçamento
                    </Link>
                  </Button>
                </CardContent>
              </Card>

              {/* Casa Luxo - Linha Premium */}
              <Card className="bg-white/10 border-primary/30 hover:border-primary transition-all hover:scale-105">
                <CardContent className="p-6">
                  <div className="aspect-video rounded-lg mb-4 overflow-hidden">
                    <img 
                      src="/casa-luxo-linha-premium.jpg"
                      alt="Casa Luxo - Linha Premium" 
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <h3 className="text-2xl font-bold mb-2 text-primary">Casa Luxo - Linha Premium</h3>
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
                    Até 35 anos ou 420 meses para pagar, com parcelas que cabem no bolso
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
                  <h3 className="text-xl font-bold mb-2 text-primary">Subsídios</h3>
                  <p className="text-white/70">
                    Subsídios do MCMV podem chegar até R$ 55.000 e entram como entrada, reduzindo ou zerando seu investimento inicial
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
            </div>
          </div>
        </section>

        <SocialProofSection />

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
                  <p className="font-bold text-primary mt-2">Maysa Silva</p>
                  <p className="text-sm text-white/60">Canaã dos Carajás - PA</p>
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
                    "Esse é um dos nossos investidores e um verdadeiro case de sucesso! Ele investiu R$ 7.750,00 e, 
                    em apenas 5 meses, recebeu R$ 13.837,50! Isso representa um ROI de 78,5%, ou seja, 15,7% ao mês! 
                    Utilizamos um modelo de investimento estrategicamente financiado pela Caixa, garantindo segurança e alta rentabilidade!"
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
                  <p className="font-bold text-primary mt-2">Guilherme Amorim</p>
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
                    <p>Sim! Existem três situações que isso ocorre: a primeira é se você tiver saldo suficiente no FGTS, é possível utilizá-lo para cobrir toda a entrada; a segunda é se você for beneficiado com Subsídios do governo e esse valor cobrir toda sua entrada; e a terceira opção é se você já tiver um terreno quitado. Assim você começa a construir sem desembolsar dinheiro do bolso.</p>
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

        {/* Seção Ecossistema VFX Capital (componente compartilhado com a página de Sorteios) */}
        <EcossistemaVfx />
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
                  📍 R. Gonçalves Dias, 1993 - Juçara<br />
                  Imperatriz - MA, 65900-545
                </p>
                <p>
                  📍 Avenida JK, 103<br />
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
                <span className="block">📧 atendimento@prospectaconstrucoes.com</span>
              </p>
            </div>

            {/* Coluna 4: Links Rápidos */}
            <div>
              <h3 className="font-bold text-primary mb-4">Links Rápidos</h3>
              <div className="flex flex-col gap-y-3">
                <Link href="/" className="text-white/70 hover:text-primary text-sm leading-normal transition-colors">
                  Início
                </Link>
                <Link href="/projetos-orcamentos" className="text-white/70 hover:text-primary text-sm leading-normal transition-colors">
                  Projetos e Orçamentos
                </Link>
                <Link href="/sorteios" className="text-white/70 hover:text-primary text-sm leading-normal transition-colors">
                  Sorteios
                </Link>
                <Link href="/produtos" className="text-white/70 hover:text-primary text-sm leading-normal transition-colors">
                  Produtos
                </Link>
                <Link href="/como-funciona" className="text-white/70 hover:text-primary text-sm leading-normal transition-colors">
                  Como Funciona
                </Link>
              </div>
            </div>
          </div>

          {/* Copyright e Links Legais */}
          <div className="border-t border-white/10 pt-8">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-4">
              <div className="flex flex-wrap justify-center gap-4 text-sm">
                <Link href="/regulamento" className="text-white/60 hover:text-primary transition-colors">
                  Regulamento do Sorteio
                </Link>
                <span className="text-white/30">|</span>
                <Link href="/termos-de-uso" className="text-white/60 hover:text-primary transition-colors">
                  Termos de Uso
                </Link>
                <span className="text-white/30">|</span>
                <Link href="/politica-de-privacidade" className="text-white/60 hover:text-primary transition-colors">
                  Política de Privacidade
                </Link>
                <span className="text-white/30">|</span>
                <Link href="/faq" className="text-white/60 hover:text-primary transition-colors">
                  FAQ
                </Link>
              </div>
            </div>
            <div className="text-center text-white/60 text-sm">
              <p>&copy; 2025 Prospecta Construções. Todos os direitos reservados.</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
