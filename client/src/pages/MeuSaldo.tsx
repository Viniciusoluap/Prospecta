import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Navbar from "@/components/Navbar";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatUtef, formatDate, getLoginUrl } from "@/const";
import { Coins, TrendingUp, TrendingDown, Gift, ShoppingBag, Settings, AlertCircle, Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function MeuSaldo() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { data: balance, isLoading: balanceLoading } = trpc.utef.balance.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const { data: transactions, isLoading: transactionsLoading } = trpc.utef.transactions.useQuery(undefined, {
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
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Você precisa estar logado para ver seu saldo de UTEFs.
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

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case "prize":
        return <Gift className="h-4 w-4 text-green-600" />;
      case "conversion":
        return <ShoppingBag className="h-4 w-4 text-blue-600" />;
      case "adjustment":
        return <Settings className="h-4 w-4 text-gray-600" />;
      case "purchase":
        return <Coins className="h-4 w-4 text-accent-foreground" />;
      default:
        return <Coins className="h-4 w-4" />;
    }
  };

  const getTransactionLabel = (type: string) => {
    switch (type) {
      case "prize":
        return "Prêmio";
      case "conversion":
        return "Conversão";
      case "adjustment":
        return "Ajuste";
      case "purchase":
        return "Compra";
      default:
        return type;
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      
      <main className="flex-1 py-12">
        <div className="container max-w-4xl space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Meu Saldo UTEF</h1>
              <p className="text-muted-foreground mt-1">
                Acompanhe seu saldo e histórico de transações
              </p>
            </div>
            <div className="flex gap-2">
              <Button asChild>
                <Link href="/comprar-utef">
                  <Plus className="h-4 w-4 mr-2" />
                  Comprar UTEFs
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/produtos">
                  Ver Produtos
                </Link>
              </Button>
            </div>
          </div>

          {/* Saldo Atual */}
          <Card className="bg-gradient-to-br from-primary/10 to-accent/10">
            <CardHeader>
              <CardDescription>Saldo Disponível</CardDescription>
              <CardTitle className="text-4xl flex items-center gap-3">
                <Coins className="h-8 w-8 text-accent-foreground" />
                {balanceLoading ? (
                  <Skeleton className="h-10 w-48" />
                ) : (
                  <span className="text-accent-foreground">{formatUtef(balance || 0)}</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Use seus UTEFs para adquirir produtos do ecossistema Efficaz
              </p>
            </CardContent>
          </Card>

          {/* Histórico de Transações */}
          <Card>
            <CardHeader>
              <CardTitle>Histórico de Transações</CardTitle>
              <CardDescription>
                Todas as suas movimentações de UTEF
              </CardDescription>
            </CardHeader>
            <CardContent>
              {transactionsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center justify-between p-4 border rounded-lg">
                      <Skeleton className="h-4 w-1/3" />
                      <Skeleton className="h-4 w-1/4" />
                    </div>
                  ))}
                </div>
              ) : transactions && transactions.length > 0 ? (
                <div className="space-y-3">
                  {transactions.map((tx) => (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {getTransactionIcon(tx.type)}
                        <div>
                          <p className="font-medium">{tx.description}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-xs">
                              {getTransactionLabel(tx.type)}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {formatDate(tx.createdAt)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <p
                          className={`text-lg font-bold flex items-center gap-1 ${
                            tx.amount > 0 ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          {tx.amount > 0 ? (
                            <TrendingUp className="h-4 w-4" />
                          ) : (
                            <TrendingDown className="h-4 w-4" />
                          )}
                          {tx.amount > 0 ? "+" : ""}
                          {formatUtef(Math.abs(tx.amount))}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Coins className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-lg font-medium">Nenhuma transação ainda</p>
                  <p className="text-muted-foreground mt-2">
                    Participe dos sorteios para ganhar UTEFs!
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Informações sobre UTEF */}
          <Alert>
            <Coins className="h-4 w-4" />
            <AlertDescription>
              <p className="font-medium mb-1">O que são UTEFs?</p>
              <p className="text-sm">
                UTEFs (Utility Token Efficaz) são créditos internos que podem ser utilizados 
                exclusivamente para adquirir produtos e serviços dentro do ecossistema do Grupo Efficaz. 
                Não podem ser convertidos em dinheiro ou transferidos para terceiros.
              </p>
            </AlertDescription>
          </Alert>
        </div>
      </main>
    </div>
  );
}
