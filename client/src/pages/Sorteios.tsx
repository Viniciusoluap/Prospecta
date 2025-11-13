import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import Navbar from "@/components/Navbar";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatUtef, formatDate } from "@/const";
import { Ticket, Trophy, Calendar, Target } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Sorteios() {
  const { data: draws, isLoading } = trpc.draws.list.useQuery();

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      
      <main className="flex-1 py-12">
        <div className="container">
          <div className="max-w-4xl mx-auto space-y-8">
            <div className="text-center space-y-4">
              <h1 className="text-4xl font-bold text-primary">Sorteios Ativos</h1>
              <p className="text-lg text-muted-foreground">
                Participe dos sorteios e concorra a UTEFs para converter em produtos do ecossistema Efficaz
              </p>
            </div>

            {isLoading ? (
              <div className="space-y-4">
                {[1, 2].map((i) => (
                  <Card key={i}>
                    <CardHeader>
                      <Skeleton className="h-6 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                    </CardHeader>
                    <CardContent>
                      <Skeleton className="h-20 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : draws && draws.length > 0 ? (
              <div className="space-y-6">
                {draws.map((draw) => {
                  const progress = (draw.currentAmount / draw.targetAmount) * 100;
                  
                  return (
                    <Card key={draw.id} className="hover:shadow-lg transition-shadow">
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <CardTitle className="text-2xl">{draw.title}</CardTitle>
                            <CardDescription>{draw.description}</CardDescription>
                          </div>
                          <Badge variant={draw.status === "active" ? "default" : "secondary"}>
                            {draw.status === "active" ? "Ativo" : draw.status === "closed" ? "Encerrado" : "Sorteado"}
                          </Badge>
                        </div>
                      </CardHeader>
                      
                      <CardContent className="space-y-6">
                        <div className="grid md:grid-cols-3 gap-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
                              <Trophy className="h-5 w-5 text-accent-foreground" />
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">Prêmio</p>
                              <p className="font-bold">{formatUtef(draw.prizeAmount)}</p>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                              <Ticket className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">Valor do Bilhete</p>
                              <p className="font-bold">{formatCurrency(draw.ticketPrice)}</p>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                              <Calendar className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">Data do Sorteio</p>
                              <p className="font-bold">
                                {draw.drawDate ? formatDate(draw.drawDate) : "A definir"}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Progresso da Meta</span>
                            <span className="font-medium">
                              {formatCurrency(draw.currentAmount)} / {formatCurrency(draw.targetAmount)}
                            </span>
                          </div>
                          <Progress value={progress} className="h-2" />
                          <p className="text-xs text-muted-foreground">
                            {draw.ticketsSold} bilhetes vendidos
                          </p>
                        </div>
                      </CardContent>
                      
                      <CardFooter>
                        {draw.status === "active" ? (
                          <Button asChild className="w-full gap-2">
                            <Link href={`/comprar-bilhete/${draw.id}`}>
                              <Ticket className="h-4 w-4" />
                              Comprar Bilhetes
                            </Link>
                          </Button>
                        ) : draw.status === "drawn" && draw.winnerUserId ? (
                          <div className="w-full text-center p-4 bg-accent/10 rounded-lg">
                            <p className="font-medium text-accent-foreground">
                              Sorteio realizado! Ganhador: Usuário #{draw.winnerUserId}
                            </p>
                            <p className="text-sm text-muted-foreground mt-1">
                              Resultado da Loteria Federal: {draw.lotteryResult}
                            </p>
                          </div>
                        ) : (
                          <Button disabled className="w-full">
                            Sorteio Encerrado
                          </Button>
                        )}
                      </CardFooter>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <Target className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-lg font-medium">Nenhum sorteio ativo no momento</p>
                  <p className="text-muted-foreground mt-2">
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
