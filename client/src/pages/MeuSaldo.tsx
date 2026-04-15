import { Link } from "wouter";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Navbar from "@/components/Navbar";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatUtef, formatDate, getLoginUrl } from "@/const";
import {
  Coins,
  TrendingUp,
  TrendingDown,
  Gift,
  ShoppingBag,
  Settings,
  AlertCircle,
  Plus,
  ArrowLeft,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function MeuSaldo() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { data: balance, isLoading: balanceLoading } =
    trpc.utef.balance.useQuery(undefined, {
      enabled: isAuthenticated,
    });
  const { data: transactions, isLoading: transactionsLoading } =
    trpc.utef.transactions.useQuery(undefined, {
      enabled: isAuthenticated,
    });

  // Força redirecionamento se não autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      window.location.href = getLoginUrl();
    }
  }, [authLoading, isAuthenticated]);

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
                Você precisa estar logado para ver seu saldo de UTEFs.
              </AlertDescription>
            </Alert>
            <Button
              asChild
              className="mt-4 bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold"
            >
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
        return <Gift className="h-5 w-5 text-[#00FF00]" />;
      case "conversion":
        return <ShoppingBag className="h-5 w-5 text-[#C9A961]" />;
      case "adjustment":
        return <Settings className="h-5 w-5 text-gray-400" />;
      case "purchase":
        return <Coins className="h-5 w-5 text-[#00FF00]" />;
      default:
        return <Coins className="h-5 w-5" />;
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
    <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
      <Navbar />

      <main className="flex-1 py-12">
        <div className="container max-w-4xl space-y-6">
          {/* Botão Voltar */}
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-gray-400 hover:text-[#C9A961] transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
            <span>Voltar</span>
          </Link>

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-4xl font-bold text-[#C9A961]">
                Meu Saldo UTEF
              </h1>
              <p className="text-gray-300 mt-2 text-lg">
                Acompanhe seu saldo e histórico de transações
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                asChild
                className="bg-[#00FF00] hover:bg-[#00dd00] text-black font-bold gap-2"
              >
                <Link href="/comprar-utef">
                  <Plus className="h-4 w-4" />
                  Comprar UTEFs
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="border-[#C9A961]/30 text-[#C9A961] hover:bg-[#2C3E50]"
              >
                <Link href="/produtos">Ver Produtos</Link>
              </Button>
            </div>
          </div>

          {/* Saldo Atual */}
          <Card className="bg-gradient-to-br from-[#C9A961]/20 via-[#2C3E50] to-[#1A2332] border-[#C9A961]/30 backdrop-blur-sm">
            <CardHeader>
              <CardDescription className="text-gray-400 text-base">
                Saldo Disponível
              </CardDescription>
              <CardTitle className="text-5xl flex items-center gap-4">
                <Coins className="h-12 w-12 text-[#00FF00]" />
                {balanceLoading ? (
                  <Skeleton className="h-12 w-48 bg-[#2C3E50]" />
                ) : (
                  <span className="text-[#00FF00]">
                    {formatUtef(balance || 0)}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-300 text-base">
                Use seus{" "}
                <span className="text-[#00FF00] font-semibold">UTEFs</span> para
                adquirir produtos do ecossistema Efficaz
              </p>
            </CardContent>
          </Card>

          {/* Histórico de Transações */}
          <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-2xl text-[#C9A961]">
                Histórico de Transações
              </CardTitle>
              <CardDescription className="text-gray-400 text-base">
                Todas as suas movimentações de UTEF
              </CardDescription>
            </CardHeader>
            <CardContent>
              {transactionsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-4 border border-[#C9A961]/20 rounded-lg"
                    >
                      <Skeleton className="h-4 w-1/3 bg-[#2C3E50]" />
                      <Skeleton className="h-4 w-1/4 bg-[#2C3E50]" />
                    </div>
                  ))}
                </div>
              ) : transactions && transactions.length > 0 ? (
                <div className="space-y-3">
                  {transactions.map(tx => (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between p-4 border border-[#C9A961]/20 rounded-lg hover:bg-[#2C3E50] transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        {getTransactionIcon(tx.type)}
                        <div>
                          <p className="font-medium text-white text-base">
                            {tx.description}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge
                              variant="outline"
                              className="text-xs border-[#C9A961]/30 text-[#C9A961]"
                            >
                              {getTransactionLabel(tx.type)}
                            </Badge>
                            <span className="text-xs text-gray-400">
                              {formatDate(tx.createdAt)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <p
                          className={`text-xl font-bold flex items-center gap-2 ${
                            tx.amount > 0 ? "text-[#00FF00]" : "text-red-400"
                          }`}
                        >
                          {tx.amount > 0 ? (
                            <TrendingUp className="h-5 w-5" />
                          ) : (
                            <TrendingDown className="h-5 w-5" />
                          )}
                          {tx.amount > 0 ? "+" : ""}
                          {formatUtef(Math.abs(tx.amount))}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-16">
                  <Coins className="h-20 w-20 text-[#C9A961]/50 mx-auto mb-6" />
                  <p className="text-2xl font-bold text-[#C9A961] mb-3">
                    Nenhuma transação ainda
                  </p>
                  <p className="text-gray-400 text-lg">
                    Participe dos sorteios para ganhar UTEFs!
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Informações sobre UTEF */}
          <Alert className="bg-[#2C3E50] border-[#C9A961]/30">
            <Coins className="h-5 w-5 text-[#C9A961]" />
            <AlertDescription className="text-gray-300">
              <p className="font-bold mb-2 text-[#C9A961]">O que são UTEFs?</p>
              <p className="text-sm text-gray-400">
                UTEFs (Utility Token Efficaz) são créditos internos que podem
                ser utilizados exclusivamente para adquirir produtos e serviços
                dentro do ecossistema do Grupo Efficaz. Não podem ser
                convertidos em dinheiro ou transferidos para terceiros.
              </p>
            </AlertDescription>
          </Alert>
        </div>
      </main>
    </div>
  );
}
