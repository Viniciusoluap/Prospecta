import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Navbar from "@/components/Navbar";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatCurrency, formatDate, getLoginUrl } from "@/const";
import { Ticket, CheckCircle2, Clock, XCircle, AlertCircle, ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function MeusBilhetes() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { data: tickets, isLoading } = trpc.tickets.myTickets.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
        <Navbar />
        <main className="flex-1 py-12">
          <div className="container max-w-4xl">
            <Skeleton className="h-64 w-full bg-[#2C3E50]" />
          </div>
        </main>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
        <Navbar />
        <main className="flex-1 py-12">
          <div className="container max-w-4xl">
            <Alert className="bg-red-500/10 border-red-500/30">
              <AlertCircle className="h-5 w-5 text-red-400" />
              <AlertDescription className="text-red-300">
                Você precisa estar logado para ver seus bilhetes.
              </AlertDescription>
            </Alert>
            <Button asChild className="mt-4 bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
              <a href={getLoginUrl()}>Fazer Login</a>
            </Button>
          </div>
        </main>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "confirmed":
        return (
          <Badge className="gap-1 bg-[#00FF00] text-black hover:bg-[#00dd00] border-0">
            <CheckCircle2 className="h-3 w-3" />
            Confirmado
          </Badge>
        );
      case "pending":
        return (
          <Badge className="gap-1 bg-yellow-500/20 text-yellow-300 border-yellow-500/30 hover:bg-yellow-500/30">
            <Clock className="h-3 w-3" />
            Pendente
          </Badge>
        );
      case "failed":
        return (
          <Badge className="gap-1 bg-red-500/20 text-red-300 border-red-500/30 hover:bg-red-500/30">
            <XCircle className="h-3 w-3" />
            Falhou
          </Badge>
        );
      default:
        return <Badge className="bg-gray-600 text-white border-0">{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
      <Navbar />
      
      <main className="flex-1 py-12">
        <div className="container max-w-4xl space-y-6">
          {/* Botão Voltar */}
          <Link href="/" className="inline-flex items-center gap-2 text-gray-400 hover:text-[#C9A961] transition-colors">
            <ArrowLeft className="h-5 w-5" />
            <span>Voltar</span>
          </Link>

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-4xl font-bold text-[#C9A961]">Meus Bilhetes</h1>
              <p className="text-gray-300 mt-2 text-lg">
                Acompanhe seus bilhetes de participação nos sorteios
              </p>
            </div>
            <Button asChild variant="outline" className="border-[#C9A961]/30 text-[#C9A961] hover:bg-[#2C3E50]">
              <Link href="/sorteios">
                Ver Sorteios
              </Link>
            </Button>
          </div>

          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="bg-[#1A2332]/60 border-[#C9A961]/20">
                  <CardHeader>
                    <Skeleton className="h-6 w-3/4 bg-[#2C3E50]" />
                    <Skeleton className="h-4 w-1/2 bg-[#2C3E50]" />
                  </CardHeader>
                </Card>
              ))}
            </div>
          ) : tickets && tickets.length > 0 ? (
            <div className="space-y-4">
              {tickets.map((ticket) => (
                <Card key={ticket.id} className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm hover:border-[#C9A961]/40 transition-all">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="space-y-2">
                        <CardTitle className="flex items-center gap-3 text-[#C9A961] text-xl">
                          <Ticket className="h-6 w-6" />
                          Bilhete #{ticket.ticketNumber}
                        </CardTitle>
                        <CardDescription className="text-gray-400">
                          Comprado em {formatDate(ticket.createdAt)}
                        </CardDescription>
                      </div>
                      {getStatusBadge(ticket.paymentStatus)}
                    </div>
                  </CardHeader>
                  
                  <CardContent className="space-y-4">
                    <div className="grid md:grid-cols-3 gap-4 p-4 bg-[#2C3E50] rounded-lg border border-[#C9A961]/20">
                      <div>
                        <p className="text-sm text-gray-400">Quantidade</p>
                        <p className="font-medium text-white text-lg">{ticket.quantity} bilhete(s)</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-400">Valor Pago</p>
                        <p className="font-medium text-[#C9A961] text-lg">{formatCurrency(ticket.totalPaid)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-400">Método</p>
                        <p className="font-medium text-white text-lg uppercase">{ticket.paymentMethod}</p>
                      </div>
                    </div>

                    {ticket.paymentStatus === "pending" && ticket.pixCopyPaste && (
                      <Alert className="bg-yellow-500/10 border-yellow-500/30">
                        <Clock className="h-5 w-5 text-yellow-300" />
                        <AlertDescription className="text-yellow-200">
                          <p className="font-bold mb-2">⏰ Pagamento Pendente</p>
                          <p className="text-sm mb-3">
                            Complete o pagamento via PIX para confirmar sua participação no sorteio.
                          </p>
                          <Button asChild size="sm" className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
                            <Link href={`/comprar-bilhete/${ticket.drawId}`}>
                              Ver Código PIX
                            </Link>
                          </Button>
                        </AlertDescription>
                      </Alert>
                    )}

                    {ticket.paymentStatus === "confirmed" && (
                      <div className="flex items-center gap-2 text-base text-[#00FF00] p-3 bg-[#00FF00]/10 rounded-lg border border-[#00FF00]/30">
                        <CheckCircle2 className="h-5 w-5" />
                        <span className="font-medium">Bilhete confirmado! Boa sorte no sorteio!</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
              <CardContent className="py-16 text-center">
                <Ticket className="h-20 w-20 text-[#C9A961]/50 mx-auto mb-6" />
                <p className="text-2xl font-bold text-[#C9A961] mb-3">Você ainda não comprou bilhetes</p>
                <p className="text-gray-400 text-lg mb-6">
                  Participe dos sorteios e concorra a prêmios incríveis!
                </p>
                <Button asChild className="bg-[#00FF00] hover:bg-[#00dd00] text-black font-bold text-lg px-8 py-6 h-auto">
                  <Link href="/sorteios">
                    Ver Sorteios Ativos
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
