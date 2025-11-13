import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Navbar from "@/components/Navbar";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatCurrency, formatDate, getLoginUrl } from "@/const";
import { Ticket, CheckCircle2, Clock, XCircle, ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function MeusBilhetes() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { data: tickets, isLoading } = trpc.tickets.myTickets.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 py-12">
          <div className="container max-w-4xl">
            <Skeleton className="h-64 w-full" />
          </div>
        </main>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 py-12">
          <div className="container max-w-4xl">
            <Alert>
              <AlertDescription>
                Você precisa estar logado para ver seus bilhetes.
              </AlertDescription>
            </Alert>
            <Button asChild className="mt-4">
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
          <Badge variant="default" className="gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Confirmado
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" />
            Pendente
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            Falhou
          </Badge>
        );
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      
      <main className="flex-1 py-12">
        <div className="container max-w-4xl space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Meus Bilhetes</h1>
              <p className="text-muted-foreground mt-1">
                Acompanhe seus bilhetes de participação nos sorteios
              </p>
            </div>
            <Button asChild variant="outline">
              <Link href="/sorteios">
                Ver Sorteios
              </Link>
            </Button>
          </div>

          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-6 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                  </CardHeader>
                </Card>
              ))}
            </div>
          ) : tickets && tickets.length > 0 ? (
            <div className="space-y-4">
              {tickets.map((ticket) => (
                <Card key={ticket.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <CardTitle className="flex items-center gap-2">
                          <Ticket className="h-5 w-5" />
                          Bilhete #{ticket.ticketNumber}
                        </CardTitle>
                        <CardDescription>
                          Comprado em {formatDate(ticket.createdAt)}
                        </CardDescription>
                      </div>
                      {getStatusBadge(ticket.paymentStatus)}
                    </div>
                  </CardHeader>
                  
                  <CardContent className="space-y-4">
                    <div className="grid md:grid-cols-3 gap-4 p-4 bg-muted/50 rounded-lg">
                      <div>
                        <p className="text-sm text-muted-foreground">Quantidade</p>
                        <p className="font-medium">{ticket.quantity} bilhete(s)</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Valor Pago</p>
                        <p className="font-medium">{formatCurrency(ticket.totalPaid)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Método</p>
                        <p className="font-medium uppercase">{ticket.paymentMethod}</p>
                      </div>
                    </div>

                    {ticket.paymentStatus === "pending" && ticket.pixCopyPaste && (
                      <Alert>
                        <AlertDescription>
                          <p className="font-medium mb-2">⏰ Pagamento Pendente</p>
                          <p className="text-sm">
                            Complete o pagamento via PIX para confirmar sua participação no sorteio.
                          </p>
                          <Button asChild size="sm" className="mt-3">
                            <Link href={`/comprar-bilhete/${ticket.drawId}`}>
                              Ver Código PIX
                            </Link>
                          </Button>
                        </AlertDescription>
                      </Alert>
                    )}

                    {ticket.paymentStatus === "confirmed" && (
                      <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                        <CheckCircle2 className="h-4 w-4" />
                        <span>Bilhete confirmado! Boa sorte no sorteio!</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Ticket className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-lg font-medium">Você ainda não comprou bilhetes</p>
                <p className="text-muted-foreground mt-2 mb-4">
                  Participe dos sorteios e concorra a prêmios incríveis!
                </p>
                <Button asChild>
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
