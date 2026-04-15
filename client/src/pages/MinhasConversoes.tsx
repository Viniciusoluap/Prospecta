import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import Navbar from "@/components/Navbar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  AlertCircle,
  ShoppingBag,
  Calendar,
  Coins,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function MinhasConversoes() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();

  const { data: conversions, isLoading } = trpc.products.myConversions.useQuery(
    undefined,
    {
      enabled: isAuthenticated,
    }
  );

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </main>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 container py-12">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Você precisa estar logado para ver suas conversões.
            </AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 container py-12">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2">Minhas Conversões</h1>
            <p className="text-muted-foreground">
              Histórico de produtos adquiridos com seus UTEFs
            </p>
          </div>

          {!conversions || conversions.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <ShoppingBag className="h-16 w-16 text-muted-foreground/50 mb-4" />
                <p className="text-lg font-medium text-muted-foreground mb-2">
                  Nenhuma conversão realizada
                </p>
                <p className="text-sm text-muted-foreground">
                  Você ainda não converteu UTEFs em produtos
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {conversions.map(conversion => (
                <Card
                  key={conversion.id}
                  className="hover:shadow-md transition-shadow"
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-xl mb-2">
                          {conversion.product?.title || "Produto"}
                        </CardTitle>
                        <CardDescription>
                          {conversion.product?.description || "Sem descrição"}
                        </CardDescription>
                      </div>
                      <Badge variant="secondary" className="ml-4">
                        {conversion.status === "pending" && "Pendente"}
                        {conversion.status === "completed" && "Concluído"}
                        {conversion.status === "cancelled" && "Cancelado"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid md:grid-cols-3 gap-4">
                      <div className="flex items-center gap-2 text-sm">
                        <Coins className="h-4 w-4 text-primary" />
                        <div>
                          <p className="text-muted-foreground">
                            Valor Convertido
                          </p>
                          <p className="font-semibold">
                            {conversion.utefAmount.toLocaleString("pt-BR")} UTEF
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-sm">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-muted-foreground">
                            Data da Conversão
                          </p>
                          <p className="font-semibold">
                            {formatDistanceToNow(
                              new Date(conversion.createdAt),
                              {
                                addSuffix: true,
                                locale: ptBR,
                              }
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-sm">
                        <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-muted-foreground">Categoria</p>
                          <p className="font-semibold capitalize">
                            {conversion.product?.category === "real_estate" &&
                              "Construção Civil"}
                            {conversion.product?.category === "financial" &&
                              "Financeira"}
                            {conversion.product?.category === "nautical" &&
                              "Náutico"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
