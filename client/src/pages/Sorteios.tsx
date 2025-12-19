import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import Navbar from "@/components/Navbar";
import SEO from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatUtef, formatDate } from "@/const";
import { Ticket, Trophy, Calendar, Target, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Sorteios() {
  const { data: draws, isLoading } = trpc.draws.list.useQuery();

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
      <SEO 
        title="Sorteios"
        description="Participe dos sorteios do Ecossistema Efficaz e concorra a prêmios em UTEFs. Sorteios baseados na Loteria Federal com total transparência. Compre seus bilhetes agora!"
        keywords="sorteios, loteria, UTEFs, prêmios, bilhetes, Loteria Federal, Ecossistema Efficaz"
      />
      <Navbar />
      
      <main className="flex-1 py-12">
        <div className="container">
          <div className="max-w-6xl mx-auto space-y-8">
            {/* Header */}
            <div className="text-center space-y-4">
              <h1 className="text-5xl font-bold text-[#C9A961]">Sorteios Ativos</h1>
              <p className="text-xl text-gray-300 max-w-3xl mx-auto">
                Participe dos sorteios e concorra a <span className="text-[#00FF00] font-semibold">UTEFs</span> para converter em produtos do ecossistema Efficaz
              </p>
            </div>

            {isLoading ? (
              <div className="space-y-6">
                {[1, 2].map((i) => (
                  <Card key={i} className="bg-[#1A2332]/60 border-[#C9A961]/20">
                    <CardHeader>
                      <Skeleton className="h-6 w-3/4 bg-[#2C3E50]" />
                      <Skeleton className="h-4 w-1/2 bg-[#2C3E50]" />
                    </CardHeader>
                    <CardContent>
                      <Skeleton className="h-20 w-full bg-[#2C3E50]" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : draws && draws.length > 0 ? (
              <div className="space-y-6">
                {draws.map((draw) => {
                  const progress = (draw.currentAmount / draw.targetAmount) * 100;
                  
                  return (
                    <Card key={draw.id} className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm hover:border-[#C9A961]/60 transition-all hover:shadow-xl hover:shadow-[#C9A961]/10">
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div className="space-y-2">
                            <CardTitle className="text-3xl text-[#C9A961]">{draw.title}</CardTitle>
                            <CardDescription className="text-gray-400 text-base">{draw.description}</CardDescription>
                          </div>
                          <Badge 
                            variant={draw.status === "active" ? "default" : "secondary"}
                            className={
                              draw.status === "active" 
                                ? "bg-[#00FF00] text-black hover:bg-[#00dd00] border-0" 
                                : draw.status === "drawn"
                                ? "bg-[#C9A961] text-[#1A2332] hover:bg-[#B8985A] border-0"
                                : "bg-gray-600 text-white border-0"
                            }
                          >
                            {draw.status === "active" ? "Ativo" : draw.status === "closed" ? "Encerrado" : "Sorteado"}
                          </Badge>
                        </div>
                      </CardHeader>
                      
                      <CardContent className="space-y-6">
                        <div className="grid md:grid-cols-3 gap-6">
                          <div className="flex items-center gap-4 p-4 bg-[#2C3E50] rounded-lg border border-[#C9A961]/20">
                            <div className="w-12 h-12 rounded-full bg-[#C9A961]/20 flex items-center justify-center">
                              <Trophy className="h-6 w-6 text-[#C9A961]" />
                            </div>
                            <div>
                              <p className="text-sm text-gray-400">Prêmio</p>
                              <p className="font-bold text-[#00FF00] text-lg">{formatUtef(draw.prizeAmount)}</p>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-4 p-4 bg-[#2C3E50] rounded-lg border border-[#C9A961]/20">
                            <div className="w-12 h-12 rounded-full bg-[#C9A961]/20 flex items-center justify-center">
                              <Ticket className="h-6 w-6 text-[#C9A961]" />
                            </div>
                            <div>
                              <p className="text-sm text-gray-400">Valor do Bilhete</p>
                              <p className="font-bold text-white text-lg">{formatCurrency(draw.ticketPrice)}</p>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-4 p-4 bg-[#2C3E50] rounded-lg border border-[#C9A961]/20">
                            <div className="w-12 h-12 rounded-full bg-[#C9A961]/20 flex items-center justify-center">
                              <Calendar className="h-6 w-6 text-[#C9A961]" />
                            </div>
                            <div>
                              <p className="text-sm text-gray-400">Data do Sorteio</p>
                              <p className="font-bold text-white text-lg">
                                {draw.drawDate ? formatDate(draw.drawDate) : "A definir"}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-3 p-4 bg-[#2C3E50] rounded-lg border border-[#C9A961]/20">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-400 font-medium">Progresso da Meta</span>
                            <span className="font-bold text-[#C9A961]">
                              {formatCurrency(draw.currentAmount)} / {formatCurrency(draw.targetAmount)}
                            </span>
                          </div>
                          <Progress value={progress} className="h-3 bg-gray-700">
                            <div 
                              className="h-full bg-gradient-to-r from-[#C9A961] to-[#FFD700] transition-all rounded-full"
                              style={{ width: `${progress}%` }}
                            />
                          </Progress>
                          <p className="text-sm text-gray-400">
                            <span className="font-semibold text-[#00FF00]">{draw.ticketsSold}</span> bilhetes vendidos
                          </p>
                        </div>
                      </CardContent>
                      
                      <CardFooter>
                        {draw.status === "active" ? (
                          <Button asChild className="w-full gap-2 bg-[#00FF00] hover:bg-[#00dd00] text-black font-bold text-lg py-6 h-auto">
                            <Link href={`/comprar-bilhete/${draw.id}`}>
                              <Ticket className="h-5 w-5" />
                              Comprar Bilhetes
                            </Link>
                          </Button>
                        ) : draw.status === "drawn" && draw.winnerUserId ? (
                          <div className="w-full text-center p-6 bg-[#C9A961]/20 rounded-lg border border-[#C9A961]/40">
                            <p className="font-bold text-[#C9A961] text-lg">
                              🎉 Sorteio realizado! Ganhador: Usuário #{draw.winnerUserId}
                            </p>
                            <p className="text-sm text-gray-300 mt-2">
                              Resultado da Loteria Federal: <span className="font-semibold text-[#00FF00]">{draw.lotteryResult}</span>
                            </p>
                          </div>
                        ) : (
                          <Button disabled className="w-full bg-gray-600 text-gray-400 cursor-not-allowed">
                            Sorteio Encerrado
                          </Button>
                        )}
                      </CardFooter>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
                <CardContent className="py-16 text-center">
                  <Target className="h-20 w-20 text-[#C9A961]/50 mx-auto mb-6" />
                  <p className="text-2xl font-bold text-[#C9A961] mb-3">Nenhum sorteio ativo no momento</p>
                  <p className="text-gray-400 text-lg">
                    Fique atento! Novos sorteios serão anunciados em breve.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
