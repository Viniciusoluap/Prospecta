import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, AlertCircle, ArrowLeft } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function ConverterProduto() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [isConverting, setIsConverting] = useState(false);

  const { data: product, isLoading: productLoading } =
    trpc.products.getById.useQuery({ id: parseInt(id!) }, { enabled: !!id });

  const { data: balance } = trpc.utef.balance.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const convertMutation = trpc.products.convert.useMutation({
    onSuccess: () => {
      toast.success("Conversão realizada com sucesso!");
      setLocation("/minhas-conversoes");
    },
    onError: error => {
      toast.error(error.message || "Erro ao converter UTEF");
      setIsConverting(false);
    },
  });

  const handleConvert = () => {
    if (!product) return;

    setIsConverting(true);
    convertMutation.mutate({ productId: product.id });
  };

  if (authLoading || productLoading) {
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
              Você precisa estar logado para converter UTEFs em produtos.
            </AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 container py-12">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Produto não encontrado.</AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  const hasEnoughBalance = (balance || 0) >= product.priceUtef;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 container py-12">
        <Button
          variant="ghost"
          className="mb-6"
          onClick={() => setLocation("/produtos")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Voltar para Produtos
        </Button>

        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>Converter UTEF em Produto</CardTitle>
              <CardDescription>
                Confirme a conversão dos seus UTEFs para adquirir este produto
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Produto */}
              <div className="bg-muted/30 p-4 rounded-lg">
                <h3 className="font-semibold text-lg mb-2">{product.title}</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {product.description}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Categoria:
                  </span>
                  <span className="font-medium capitalize">
                    {product.category}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm text-muted-foreground">Preço:</span>
                  <span className="font-bold text-xl text-primary">
                    {product.priceUtef.toLocaleString("pt-BR")} UTEF
                  </span>
                </div>
              </div>

              {/* Saldo */}
              <div className="bg-accent/10 p-4 rounded-lg border border-accent/20">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Seu Saldo Atual:
                  </span>
                  <span className="font-bold text-lg text-accent">
                    {(balance || 0).toLocaleString("pt-BR")} UTEF
                  </span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm text-muted-foreground">
                    Saldo Após Conversão:
                  </span>
                  <span
                    className={`font-bold text-lg ${hasEnoughBalance ? "text-primary" : "text-destructive"}`}
                  >
                    {((balance || 0) - product.priceUtef).toLocaleString(
                      "pt-BR"
                    )}{" "}
                    UTEF
                  </span>
                </div>
              </div>

              {/* Alertas */}
              {!hasEnoughBalance && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Saldo insuficiente. Você precisa de{" "}
                    {product.priceUtef.toLocaleString("pt-BR")} UTEF para
                    adquirir este produto.
                  </AlertDescription>
                </Alert>
              )}

              {hasEnoughBalance && (
                <Alert className="border-primary/20 bg-primary/5">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <AlertDescription className="text-primary">
                    Você tem saldo suficiente para adquirir este produto!
                  </AlertDescription>
                </Alert>
              )}

              {/* Botão de Conversão */}
              <Button
                size="lg"
                className="w-full"
                disabled={!hasEnoughBalance || isConverting}
                onClick={handleConvert}
              >
                {isConverting ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Convertendo...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-5 w-5 mr-2" />
                    Confirmar Conversão
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
