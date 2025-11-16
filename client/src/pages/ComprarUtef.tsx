import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Navbar from "@/components/Navbar";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatCurrency, getLoginUrl } from "@/const";
import { Coins, Copy, CheckCircle2, AlertCircle, Info } from "lucide-react";
import { toast } from "sonner";

export default function ComprarUtef() {
  const { user, isAuthenticated } = useAuth();
  const [amount, setAmount] = useState(100); // Quantidade de UTEFs
  const [purchaseComplete, setPurchaseComplete] = useState(false);
  const [pixCode, setPixCode] = useState<string>("");
  const [pixQrCode, setPixQrCode] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<"pix" | "stripe">("pix");

  const purchaseMutation = trpc.utef.purchase.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        // Pagamento via Stripe
        window.open(data.checkoutUrl, '_blank');
        toast.success("Redirecionando para pagamento...");
        setTimeout(() => {
          window.location.href = "/dashboard";
        }, 2000);
      } else {
        // Pagamento via PIX
        setPixCode(data.pixCopyPaste || "");
        setPixQrCode(data.pixQrCode || "");
        setPurchaseComplete(true);
        toast.success("PIX gerado com sucesso!");
      }
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao gerar pagamento");
    },
  });

  const handlePurchase = () => {
    if (!isAuthenticated) {
      window.location.href = getLoginUrl();
      return;
    }
    
    purchaseMutation.mutate({
      amount,
      paymentMethod,
    });
  };

  const handleCopyPix = () => {
    navigator.clipboard.writeText(pixCode);
    toast.success("Código PIX copiado!");
  };

  // Preço em centavos (1 UTEF = R$ 1,00 = 100 centavos)
  const totalPrice = amount * 100;
  
  // Calcular bônus (10% para compras acima de 1000 UTEFs)
  const bonusAmount = amount >= 1000 ? Math.floor(amount * 0.1) : 0;
  const totalUtef = amount + bonusAmount;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      
      <main className="flex-1 py-12">
        <div className="container max-w-2xl space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold text-primary">Comprar UTEFs</h1>
            <p className="text-muted-foreground">
              Adquira créditos UTEF para usar no ecossistema Efficaz
            </p>
          </div>

          {!purchaseComplete ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl flex items-center gap-2">
                  <Coins className="h-6 w-6 text-accent" />
                  Compra Direta de UTEFs
                </CardTitle>
                <CardDescription>
                  1 UTEF = R$ 1,00 | Use seus UTEFs para adquirir produtos do ecossistema
                </CardDescription>
              </CardHeader>
              
              <CardContent className="space-y-6">
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    <strong>UTEF (Utility Token Efficaz)</strong> é o crédito interno do Grupo Efficaz. 
                    Você pode usá-lo para adquirir imóveis, serviços financeiros e embarcações.
                  </AlertDescription>
                </Alert>

                <Alert className="bg-accent/10 border-accent">
                  <Coins className="h-4 w-4 text-accent-foreground" />
                  <AlertDescription>
                    <strong>🎉 Bônus Especial:</strong> Compre 1.000 UTEFs ou mais e ganhe <strong>10% de bônus</strong> grátis!
                  </AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <Label htmlFor="amount">Quantidade de UTEFs</Label>
                  <Input
                    id="amount"
                    type="number"
                    min="1"
                    max="1000000"
                    value={amount}
                    onChange={(e) => setAmount(Math.max(1, parseInt(e.target.value) || 1))}
                  />
                  <p className="text-sm text-muted-foreground">
                    Mínimo: 1 UTEF | Sem limite máximo
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Método de Pagamento</Label>
                  <div className="flex gap-4">
                    <Button
                      type="button"
                      variant={paymentMethod === "stripe" ? "default" : "outline"}
                      onClick={() => setPaymentMethod("stripe")}
                      className="flex-1"
                    >
                      Cartão de Crédito
                    </Button>
                    <Button
                      type="button"
                      variant={paymentMethod === "pix" ? "default" : "outline"}
                      onClick={() => setPaymentMethod("pix")}
                      className="flex-1"
                    >
                      PIX
                    </Button>
                  </div>
                </div>

                <div className="p-4 bg-primary/10 rounded-lg space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Quantidade:</span>
                    <span className="font-medium">{amount.toLocaleString("pt-BR")} UTEF</span>
                  </div>
                  {bonusAmount > 0 && (
                    <>
                      <div className="flex justify-between items-center text-accent-foreground">
                        <span className="text-sm font-medium">🎉 Bônus (10%):</span>
                        <span className="font-bold">+{bonusAmount.toLocaleString("pt-BR")} UTEF</span>
                      </div>
                      <div className="flex justify-between items-center border-t pt-2">
                        <span className="text-sm font-medium">Total de UTEFs:</span>
                        <span className="font-bold text-accent-foreground">{totalUtef.toLocaleString("pt-BR")} UTEF</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between items-center border-t pt-2">
                    <span className="text-lg font-medium">Total a Pagar:</span>
                    <span className="text-2xl font-bold text-primary">{formatCurrency(totalPrice)}</span>
                  </div>
                </div>

                {!isAuthenticated && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Você precisa estar logado para comprar UTEFs
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
              
              <CardFooter>
                <Button 
                  onClick={handlePurchase} 
                  disabled={purchaseMutation.isPending || !isAuthenticated}
                  className="w-full gap-2"
                >
                  <Coins className="h-4 w-4" />
                  {purchaseMutation.isPending ? "Processando..." : paymentMethod === "stripe" ? "Pagar com Cartão" : "Gerar PIX para Pagamento"}
                </Button>
              </CardFooter>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl flex items-center gap-2">
                  <CheckCircle2 className="h-6 w-6 text-green-600" />
                  PIX Gerado!
                </CardTitle>
                <CardDescription>
                  Pague via PIX para receber seus UTEFs
                </CardDescription>
              </CardHeader>
              
              <CardContent className="space-y-6">
                <Alert>
                  <AlertDescription>
                    <strong>Importante:</strong> Após o pagamento, seus UTEFs serão creditados automaticamente em sua conta.
                  </AlertDescription>
                </Alert>

                {pixQrCode && (
                  <div className="flex justify-center p-6 bg-white rounded-lg">
                    <img src={pixQrCode} alt="QR Code PIX" className="w-64 h-64" />
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Código PIX (Copia e Cola)</Label>
                  <div className="flex gap-2">
                    <Input value={pixCode} readOnly className="font-mono text-sm" />
                    <Button onClick={handleCopyPix} variant="outline" size="icon">
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Escaneie o QR Code acima ou copie o código e cole no app do seu banco
                  </p>
                </div>

                <div className="p-4 bg-muted rounded-lg space-y-2">
                  <h3 className="font-medium">Resumo da Compra</h3>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Quantidade:</span>
                    <span>{amount.toLocaleString("pt-BR")} UTEF</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Valor Total:</span>
                    <span className="font-bold">{formatCurrency(totalPrice)}</span>
                  </div>
                </div>
              </CardContent>
              
              <CardFooter>
                <Button 
                  onClick={() => window.location.href = "/dashboard"}
                  className="w-full"
                >
                  Ir para Meu Painel
                </Button>
              </CardFooter>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
