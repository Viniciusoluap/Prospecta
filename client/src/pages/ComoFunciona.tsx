import Navbar from "@/components/Navbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Ticket, Coins, ShoppingBag, Trophy, Shield, FileText, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

export default function ComoFunciona() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
      <Navbar />
      
      <main className="flex-1">
        {/* Botão Voltar */}
        <div className="container pt-6">
          <Link href="/" className="inline-flex items-center gap-2 text-gray-400 hover:text-[#C9A961] transition-colors">
            <ArrowLeft className="h-5 w-5" />
            <span>Voltar</span>
          </Link>
        </div>

        {/* Hero */}
        <section className="py-20">
          <div className="container">
            <h1 className="text-5xl md:text-6xl font-bold text-center mb-6 text-[#C9A961]">
              Como funciona o <span className="text-[#00FF00]">Ecossistema Efficaz</span>
            </h1>
            <p className="text-xl text-center text-gray-300 max-w-3xl mx-auto">
              Entenda como participar dos sorteios, ganhar <span className="text-[#00FF00] font-semibold">UTEFs</span> e converter em produtos do ecossistema Grupo Efficaz
            </p>
          </div>
        </section>

        {/* Passo a Passo */}
        <section className="py-16 container">
          <h2 className="text-4xl font-bold text-center mb-12 text-[#C9A961]">Passo a Passo</h2>
          
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <Card className="bg-[#1A2332]/60 border-[#C9A961]/30 backdrop-blur-sm hover:border-[#C9A961]/60 transition-all hover:shadow-xl hover:shadow-[#C9A961]/10">
              <CardHeader>
                <div className="h-16 w-16 rounded-full bg-[#C9A961]/20 flex items-center justify-center mb-4">
                  <Ticket className="h-8 w-8 text-[#C9A961]" />
                </div>
                <CardTitle className="text-2xl text-[#C9A961]">1. Compre Bilhetes</CardTitle>
                <CardDescription className="text-gray-400 text-base">
                  Adquira bilhetes de participação por apenas R$ 2,00 cada via PIX
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="bg-[#1A2332]/60 border-[#00FF00]/30 backdrop-blur-sm hover:border-[#00FF00]/60 transition-all hover:shadow-xl hover:shadow-[#00FF00]/10">
              <CardHeader>
                <div className="h-16 w-16 rounded-full bg-[#00FF00]/20 flex items-center justify-center mb-4">
                  <Trophy className="h-8 w-8 text-[#00FF00]" />
                </div>
                <CardTitle className="text-2xl text-[#00FF00]">2. Participe do Sorteio</CardTitle>
                <CardDescription className="text-gray-400 text-base">
                  O sorteio é realizado com base nos resultados da Loteria Federal
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="bg-[#1A2332]/60 border-[#C9A961]/30 backdrop-blur-sm hover:border-[#C9A961]/60 transition-all hover:shadow-xl hover:shadow-[#C9A961]/10">
              <CardHeader>
                <div className="h-16 w-16 rounded-full bg-[#C9A961]/20 flex items-center justify-center mb-4">
                  <Coins className="h-8 w-8 text-[#C9A961]" />
                </div>
                <CardTitle className="text-2xl text-[#C9A961]">3. Ganhe UTEFs</CardTitle>
                <CardDescription className="text-gray-400 text-base">
                  O ganhador recebe <span className="text-[#00FF00] font-semibold">200.000 UTEFs</span> (créditos internos) para usar no ecossistema
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </section>

        {/* O que é UTEF */}
        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-4xl font-bold text-center mb-8 text-[#C9A961]">O que é UTEF?</h2>
            
            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-3 text-2xl text-[#C9A961]">
                  <Coins className="h-8 w-8" />
                  Utility Token Efficaz (UTEF)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <p className="text-gray-300 text-lg">
                  O <span className="text-[#00FF00] font-semibold">UTEF</span> é um <strong className="text-[#C9A961]">crédito interno de utilidade</strong> do Grupo Efficaz, utilizado exclusivamente 
                  para conversão em produtos e serviços do nosso ecossistema.
                </p>
                
                <div className="bg-[#2C3E50] p-6 rounded-lg border border-[#C9A961]/30">
                  <h4 className="font-bold mb-4 text-[#C9A961] text-lg">Características do UTEF:</h4>
                  <ul className="space-y-3 text-base text-gray-300">
                    <li className="flex items-start gap-2">
                      <span className="text-[#00FF00]">✓</span>
                      <span>Não possui valor monetário externo</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-[#00FF00]">✓</span>
                      <span>Não pode ser vendido ou transferido para terceiros</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-[#00FF00]">✓</span>
                      <span>Utilizado apenas para conversão em produtos Efficaz</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-[#00FF00]">✓</span>
                      <span>Sem promessa de rentabilidade ou liquidez</span>
                    </li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Produtos Disponíveis */}
        <section className="py-16 container">
          <h2 className="text-4xl font-bold text-center mb-12 text-[#C9A961]">Produtos Disponíveis</h2>
          
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm hover:border-[#C9A961]/60 transition-all">
              <CardHeader>
                <div className="h-16 w-16 rounded-full bg-[#C9A961]/20 flex items-center justify-center mb-4">
                  <ShoppingBag className="h-8 w-8 text-[#C9A961]" />
                </div>
                <CardTitle className="text-2xl text-[#C9A961]">Construção Civil</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-base text-gray-300">
                  Casas padrão de 47m² da Prospecta Construções por <span className="text-[#00FF00] font-semibold">180.000 UTEF</span>
                </p>
              </CardContent>
            </Card>

            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm hover:border-[#C9A961]/60 transition-all">
              <CardHeader>
                <div className="h-16 w-16 rounded-full bg-[#C9A961]/20 flex items-center justify-center mb-4">
                  <Coins className="h-8 w-8 text-[#C9A961]" />
                </div>
                <CardTitle className="text-2xl text-[#C9A961]">Financeira</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-base text-gray-300">
                  Crédito de <span className="text-[#00FF00] font-semibold">0,35%</span> em UTEF para financiamentos habitacionais
                </p>
              </CardContent>
            </Card>

            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm hover:border-[#C9A961]/60 transition-all">
              <CardHeader>
                <div className="h-16 w-16 rounded-full bg-[#C9A961]/20 flex items-center justify-center mb-4">
                  <ShoppingBag className="h-8 w-8 text-[#C9A961]" />
                </div>
                <CardTitle className="text-2xl text-[#C9A961]">Náutico</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-base text-gray-300">
                  Cotas de embarcações e jetskis da <span className="text-[#00FF00] font-semibold">Exclusive Clubitz</span>
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Transparência */}
        <section className="py-16">
          <div className="container max-w-4xl">
            <h2 className="text-4xl font-bold text-center mb-8 text-[#C9A961]">Transparência e Segurança</h2>
            
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm hover:border-[#C9A961]/60 transition-all">
                <CardHeader>
                  <Shield className="h-10 w-10 text-[#00FF00] mb-3" />
                  <CardTitle className="text-2xl text-[#C9A961]">Sorteio Justo</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-base text-gray-300">
                    Baseado nos resultados oficiais da <span className="text-[#00FF00] font-semibold">Loteria Federal</span>, garantindo total imparcialidade
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm hover:border-[#C9A961]/60 transition-all">
                <CardHeader>
                  <FileText className="h-10 w-10 text-[#00FF00] mb-3" />
                  <CardTitle className="text-2xl text-[#C9A961]">Estrutura Legal</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-base text-gray-300">
                    UTEF estruturado como <span className="text-[#00FF00] font-semibold">crédito interno de utilidade</span> do Grupo Efficaz, sem características de valor mobiliário
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
