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
        <section className="bg-gradient-to-br from-primary/10 via-background to-accent/10 py-20">
          <div className="container">
            <div className="max-w-3xl mx-auto text-center space-y-6">
              <h1 className="text-4xl md:text-6xl font-bold text-primary">
                Bem-vindo ao Grupo Efficaz
              </h1>
              <p className="text-xl text-muted-foreground">
                Participe de sorteios, ganhe UTEFs e converta em produtos do nosso ecossistema: 
                Construção Civil, Financeira e Náutico.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button asChild size="lg" className="gap-2">
                  <Link href="/sorteios">
                    <Ticket className="h-5 w-5" />
                    Ver Sorteios Ativos
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="gap-2">
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
                    Participe do sorteio e ganhe 200.000 UTEFs (créditos internos)
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
        <section className="py-16">
          <div className="container">
            <h2 className="text-3xl font-bold text-center mb-12">Nosso Ecossistema</h2>
            <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              <Card className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <Building2 className="h-12 w-12 text-primary mb-4" />
                  <CardTitle>Construção Civil</CardTitle>
                  <CardDescription>
                    Imóveis e projetos imobiliários de alta qualidade
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/produtos?category=real_estate">
                      Ver Imóveis
                    </Link>
                  </Button>
                </CardContent>
              </Card>

              <Card className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <DollarSign className="h-12 w-12 text-primary mb-4" />
                  <CardTitle>Financeira</CardTitle>
                  <CardDescription>
                    Serviços financeiros e crédito para realizar seus sonhos
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/produtos?category=financial">
                      Ver Serviços
                    </Link>
                  </Button>
                </CardContent>
              </Card>

              <Card className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <Anchor className="h-12 w-12 text-primary mb-4" />
                  <CardTitle>Náutico</CardTitle>
                  <CardDescription>
                    Embarcações e experiências náuticas exclusivas
                  </CardDescription>
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
        <section className="py-20 bg-primary text-primary-foreground">
          <div className="container text-center space-y-6">
            <h2 className="text-3xl md:text-4xl font-bold">
              Pronto para Participar?
            </h2>
            <p className="text-lg opacity-90 max-w-2xl mx-auto">
              Comece agora comprando seus bilhetes e concorra a 200.000 UTEFs!
            </p>
            <Button asChild size="lg" variant="secondary" className="gap-2">
              <Link href="/sorteios">
                <Ticket className="h-5 w-5" />
                Participar Agora
              </Link>
            </Button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t py-8 bg-muted/30">
        <div className="container text-center text-sm text-muted-foreground">
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
