import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Navbar from "@/components/Navbar";
import { Ticket, Coins, Building2, DollarSign, Anchor, ArrowRight } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      
      <main className="flex-1">
      {/* Hero Section */}
      <section className="relative py-24 overflow-hidden">
        {/* Gradient Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-accent/5 to-background" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(34,197,94,0.1),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_50%,rgba(234,179,8,0.1),transparent_50%)]" />
        
        <div className="container relative">
          <div className="max-w-4xl mx-auto text-center space-y-8">
            <div className="inline-block px-4 py-2 bg-primary/10 border border-primary/20 rounded-full text-sm font-medium text-primary mb-4">
              🌟 Ecossistema Integrado de Investimentos
            </div>
            <h1 className="text-5xl md:text-6xl font-bold bg-gradient-to-r from-primary via-primary to-accent bg-clip-text text-transparent leading-tight">
              Bem-vindo ao Grupo Efficaz
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Participe de sorteios, ganhe <span className="font-semibold text-accent">UTEFs</span> e converta em produtos do nosso ecossistema:
              Construção Civil, Financeira e Náutico.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <Button asChild size="lg" className="gap-2 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all">
                <Link href="/comprar-utef">
                  <Coins className="h-5 w-5" />
                  Comprar UTEFs
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="gap-2 border-2 hover:bg-primary/10">
                <Link href="/sorteios">
                  <Ticket className="h-5 w-5" />
                  Ver Sorteios
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="gap-2 border-2 hover:bg-accent/10">
                <Link href="/como-funciona">
                  Saiba Como Funciona
                  <ArrowRight className="h-5 w-5" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

        {/* Como Funciona */}
        <section className="py-16 bg-muted/30">
          <div className="container">
            <h2 className="text-3xl font-bold text-center mb-12">Como Funciona</h2>
            <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              <Card>
                <CardHeader>
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                    <Ticket className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle>1. Compre Bilhetes</CardTitle>
                  <CardDescription>
                    Adquira bilhetes de participação por apenas R$ 2,00 cada
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader>
                  <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mb-4">
                    <Coins className="h-6 w-6 text-accent-foreground" />
                  </div>
                  <CardTitle>2. Ganhe UTEFs</CardTitle>
                  <CardDescription>
                    Participe do sorteio e ganhe 200.000 UTEFs ou compre diretamente (1 UTEF = R$ 1,00)
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader>
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                    <Building2 className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle>3. Converta em Produtos</CardTitle>
                  <CardDescription>
                    Use seus UTEFs para adquirir imóveis, serviços financeiros ou embarcações
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </div>
        </section>

      {/* Ecossistema */}
      <section className="py-20 bg-gradient-to-b from-background to-muted/30">
        <div className="container">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4">Nosso Ecossistema</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Conheça as empresas do Grupo Efficaz que compõem nosso ecossistema integrado
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <Card className="hover:shadow-2xl hover:scale-105 transition-all duration-300 border-2 hover:border-primary/50 bg-gradient-to-br from-card to-primary/5">
                <CardHeader>
                  <Building2 className="h-12 w-12 text-primary mb-4" />
                  <CardTitle>Construção Civil</CardTitle>
                  <CardDescription>
                    Imóveis e projetos imobiliários de alta qualidade
                  </CardDescription>
                  <a href="https://www.prospectaconstrucoes.com" target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline mt-2 block">
                    → prospectaconstrucoes.com
                  </a>
                </CardHeader>
                <CardContent>
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/produtos?category=real_estate">
                      Ver Imóveis
                    </Link>
                  </Button>
                </CardContent>
              </Card>

            <Card className="hover:shadow-2xl hover:scale-105 transition-all duration-300 border-2 hover:border-accent/50 bg-gradient-to-br from-card to-accent/5">
              <CardHeader>
                <DollarSign className="h-12 w-12 text-accent mb-4" />
                  <CardTitle>Financeira</CardTitle>
                  <CardDescription>
                    Serviços financeiros e crédito para realizar seus sonhos
                  </CardDescription>
                  <a href="https://www.grupoefficaz.com.br" target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline mt-2 block">
                    → grupoefficaz.com.br
                  </a>
                </CardHeader>
                <CardContent>
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/produtos?category=financial">
                      Ver Serviços
                    </Link>
                  </Button>
                </CardContent>
              </Card>

            <Card className="hover:shadow-2xl hover:scale-105 transition-all duration-300 border-2 hover:border-primary/50 bg-gradient-to-br from-card to-primary/5">
              <CardHeader>
                <Anchor className="h-12 w-12 text-primary mb-4" />
                  <CardTitle>Náutico</CardTitle>
                  <CardDescription>
                    Embarcações e experiências náuticas exclusivas
                  </CardDescription>
                  <a href="https://www.exclusiveclubitz.com" target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline mt-2 block">
                    → exclusiveclubitz.com
                  </a>
                </CardHeader>
                <CardContent>
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/produtos?category=nautical">
                      Ver Embarcações
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* CTA Final */}
        <section className="relative py-24 overflow-hidden bg-gradient-to-br from-primary via-primary to-accent">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.1),transparent_70%)]" />
          
          <div className="container relative text-center space-y-8 text-primary-foreground">
            <h2 className="text-4xl md:text-5xl font-bold drop-shadow-lg">
              Pronto para Participar?
            </h2>
            <p className="text-xl opacity-95 max-w-2xl mx-auto leading-relaxed drop-shadow">
              Comece agora comprando seus bilhetes e concorra a <span className="font-bold">200.000 UTEFs</span>!
            </p>
            <Button asChild size="lg" variant="secondary" className="gap-2 shadow-2xl hover:scale-105 transition-all text-lg px-8 py-6">
              <Link href="/sorteios">
                <Ticket className="h-6 w-6" />
                Participar Agora
              </Link>
            </Button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t py-8 bg-muted/30">
        <div className="container text-center text-sm text-muted-foreground space-y-4">
          <div>
            <p className="font-semibold text-foreground mb-3">Conheça Nossas Empresas</p>
            <div className="flex justify-center gap-6 flex-wrap">
              <a href="https://www.prospectaconstrucoes.com" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors font-medium">
                Prospecta Construções
              </a>
              <a href="https://www.exclusiveclubitz.com" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors font-medium">
                Exclusive Clubitz
              </a>
              <a href="https://www.grupoefficaz.com.br" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors font-medium">
                Grupo Efficaz
              </a>
            </div>
          </div>
          <p>&copy; {new Date().getFullYear()} Grupo Efficaz. Todos os direitos reservados.</p>
          <div className="flex justify-center gap-4 mt-4">
            <Link href="/termos">
              <a className="hover:text-foreground transition-colors">Termos de Uso</a>
            </Link>
            <Link href="/privacidade">
              <a className="hover:text-foreground transition-colors">Privacidade</a>
            </Link>
            <Link href="/regulamento">
              <a className="hover:text-foreground transition-colors">Regulamento</a>
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
