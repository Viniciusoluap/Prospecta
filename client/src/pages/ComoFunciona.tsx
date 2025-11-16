import Navbar from "@/components/Navbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Ticket, Coins, ShoppingBag, Trophy, Shield, FileText } from "lucide-react";

export default function ComoFunciona() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      
      <main className="flex-1">
        {/* Hero */}
        <section className="bg-gradient-to-br from-primary/10 via-accent/5 to-background py-20">
          <div className="container">
            <h1 className="text-4xl md:text-5xl font-bold text-center mb-6">
              Como Funciona o <span className="text-primary">Efficaz Orbit</span>
            </h1>
            <p className="text-xl text-center text-muted-foreground max-w-3xl mx-auto">
              Entenda como participar dos sorteios, ganhar UTEFs e converter em produtos do ecossistema Grupo Efficaz
            </p>
          </div>
        </section>

        {/* Passo a Passo */}
        <section className="py-16 container">
          <h2 className="text-3xl font-bold text-center mb-12">Passo a Passo</h2>
          
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <Card className="border-2 hover:border-primary/50 transition-colors">
              <CardHeader>
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <Ticket className="h-6 w-6 text-primary" />
                </div>
                <CardTitle>1. Compre Bilhetes</CardTitle>
                <CardDescription>
                  Adquira bilhetes de participação por apenas R$ 2,00 cada via PIX
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-2 hover:border-accent/50 transition-colors">
              <CardHeader>
                <div className="h-12 w-12 rounded-full bg-accent/10 flex items-center justify-center mb-4">
                  <Trophy className="h-6 w-6 text-accent" />
                </div>
                <CardTitle>2. Participe do Sorteio</CardTitle>
                <CardDescription>
                  O sorteio é realizado com base nos resultados da Loteria Federal
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-2 hover:border-primary/50 transition-colors">
              <CardHeader>
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <Coins className="h-6 w-6 text-primary" />
                </div>
                <CardTitle>3. Ganhe UTEFs</CardTitle>
                <CardDescription>
                  O ganhador recebe 200.000 UTEFs (créditos internos) para usar no ecossistema
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </section>

        {/* O que é UTEF */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-bold text-center mb-8">O que é UTEF?</h2>
            
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Coins className="h-6 w-6 text-primary" />
                  Utility Token Efficaz (UTEF)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground">
                  O UTEF é um <strong>crédito interno de utilidade</strong> do Grupo Efficaz, utilizado exclusivamente 
                  para conversão em produtos e serviços do nosso ecossistema.
                </p>
                
                <div className="bg-accent/10 p-4 rounded-lg border border-accent/20">
                  <h4 className="font-semibold mb-2">Características do UTEF:</h4>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li>✓ Não possui valor monetário externo</li>
                    <li>✓ Não pode ser vendido ou transferido para terceiros</li>
                    <li>✓ Utilizado apenas para conversão em produtos Efficaz</li>
                    <li>✓ Sem promessa de rentabilidade ou liquidez</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Produtos Disponíveis */}
        <section className="py-16 container">
          <h2 className="text-3xl font-bold text-center mb-12">Produtos Disponíveis</h2>
          
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <Card>
              <CardHeader>
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <ShoppingBag className="h-6 w-6 text-primary" />
                </div>
                <CardTitle>Construção Civil</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Casas padrão de 47m² da Prospecta Construções por 180.000 UTEF
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="h-12 w-12 rounded-full bg-accent/10 flex items-center justify-center mb-4">
                  <Coins className="h-6 w-6 text-accent" />
                </div>
                <CardTitle>Financeira</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Crédito de 0,35% em UTEF para financiamentos habitacionais
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <ShoppingBag className="h-6 w-6 text-primary" />
                </div>
                <CardTitle>Náutico</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Cotas de embarcações e jetskis da Exclusive Clubitz
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Transparência */}
        <section className="py-16 bg-muted/30">
          <div className="container max-w-4xl">
            <h2 className="text-3xl font-bold text-center mb-8">Transparência e Segurança</h2>
            
            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <Shield className="h-8 w-8 text-primary mb-2" />
                  <CardTitle>Sorteio Justo</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Baseado nos resultados oficiais da Loteria Federal, garantindo total imparcialidade
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <FileText className="h-8 w-8 text-primary mb-2" />
                  <CardTitle>Estrutura Legal</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    UTEF estruturado como crédito interno de utilidade, sem características de valor mobiliário
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
