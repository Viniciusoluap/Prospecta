import { useState } from "react";
import { useRoute, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Navbar from "@/components/Navbar";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatCurrency, formatUtef, getLoginUrl } from "@/const";
import { Ticket, Copy, CheckCircle2, AlertCircle, ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

export default function ComprarBilhete() {
  const [, params] = useRoute("/comprar-bilhete/:id");
  const drawId = params?.id ? parseInt(params.id) : 0;
  
  const { user, isAuthenticated } = useAuth();
  const [quantity, setQuantity] = useState(1);
  const [purchaseComplete, setPurchaseComplete] = useState(false);
  const [pixCode, setPixCode] = useState<string>("");
  const [pixQrCode, setPixQrCode] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<"pix" | "stripe">("stripe");
  const [ticketId, setTicketId] = useState<number | null>(null);

  const { data: draw, isLoading } = trpc.draws.getById.useQuery({ id: drawId });
  
  const purchaseMutation = trpc.tickets.purchase.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        // Pagamento via Stripe - abrir checkout em nova aba
        window.open(data.checkoutUrl, '_blank');
        toast.success("Redirecionando para pagamento...");
        setTimeout(() => {
          window.location.href = "/meus-bilhetes";
        }, 2000);
      } else {
        // Pagamento via PIX
        setPixCode(data.pixCopyPaste || "");
        setPixQrCode(data.pixQrCode || "");
        setTicketId(data.ticket.id);
        setPurchaseComplete(true);
        toast.success("Bilhete gerado com sucesso!");
      }
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao gerar bilhete");
    },
  });

  const confirmPaymentMutation = trpc.tickets.confirmPayment.useMutation({
    onSuccess: () => {
      toast.success("Pagamento confirmado! Boa sorte no sorteio!");
      setTimeout(() => {
        window.location.href = "/meus-bilhetes";
      }, 2000);
    },
  });

  const handlePurchase = () => {
    if (!isAuthenticated) {
      window.location.href = getLoginUrl();
      return;
    }
    
    purchaseMutation.mutate({
      drawId,
      quantity,
      paymentMethod,
    });
  };

  const handleCopyPix = () => {
    navigator.clipboard.writeText(pixCode);
    toast.success("Código PIX copiado!");
  };

  const handleConfirmPayment = () => {
    if (ticketId) {
      confirmPaymentMutation.mutate({ ticketId });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 py-12">
          <div className="container max-w-2xl">
            <Skeleton className="h-64 w-full" />
          </div>
        </main>
      </div>
    );
  }

  if (!draw) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 py-12">
          <div className="container max-w-2xl">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Sorteio não encontrado</AlertDescription>
            </Alert>
          </div>
        </main>
      </div>
    );
  }

  const totalPrice = draw.ticketPrice * quantity;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      
      <main className="flex-1 py-12">
        <div className="container max-w-2xl space-y-6">
          <Button asChild variant="ghost" className="gap-2">
            <Link href="/sorteios">
              <ArrowLeft className="h-4 w-4" />
              Voltar para Sorteios
            </Link>
          </Button>

          {!purchaseComplete ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl">Comprar Bilhetes</CardTitle>
                <CardDescription>{draw.title}</CardDescription>
              </CardHeader>
              
              <CardContent className="space-y-6">
                <div className="p-4 bg-accent/10 rounded-lg space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Prêmio:</span>
                    <span className="font-bold text-accent-foreground">{formatUtef(draw.prizeAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Valor por bilhete:</span>
                    <span className="font-bold">{formatCurrency(draw.ticketPrice)}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="quantity">Quantidade de Bilhetes</Label>
                  <Input
                    id="quantity"
                    type="number"
                    min="1"
                    max="100"
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                  />
                  <p className="text-sm text-muted-foreground">
                    Mínimo: 1 bilhete | Máximo: 100 bilhetes
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

                <div className="p-4 bg-primary/10 rounded-lg">
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-medium">Total a Pagar:</span>
                    <span className="text-2xl font-bold text-primary">{formatCurrency(totalPrice)}</span>
                  </div>
                </div>

                {!isAuthenticated && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Você precisa estar logado para comprar bilhetes
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
                  <Ticket className="h-4 w-4" />
                  {purchaseMutation.isPending ? "Processando..." : paymentMethod === "stripe" ? "Pagar com Cartão" : "Gerar PIX para Pagamento"}
                </Button>
              </CardFooter>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl flex items-center gap-2">
                  <CheckCircle2 className="h-6 w-6 text-green-600" />
                  Bilhete Gerado!
                </CardTitle>
                <CardDescription>
                  Pague via PIX para confirmar sua participação
                </CardDescription>
              </CardHeader>
              
              <CardContent className="space-y-6">
                <Alert>
                  <AlertDescription>
                    <strong>Importante:</strong> O pagamento deve ser realizado em até 30 minutos. 
                    Após o pagamento, clique em "Confirmar Pagamento" abaixo.
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
                    <span>{quantity} bilhete(s)</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Valor Total:</span>
                    <span className="font-bold">{formatCurrency(totalPrice)}</span>
                  </div>
                </div>
              </CardContent>
              
              <CardFooter className="flex-col gap-2">
                <Button 
                  onClick={handleConfirmPayment}
                  disabled={confirmPaymentMutation.isPending}
                  className="w-full"
                >
                  {confirmPaymentMutation.isPending ? "Confirmando..." : "Já Paguei - Confirmar Pagamento"}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  Simulação: Clique acima para confirmar o pagamento (em produção, seria automático via webhook)
                </p>
              </CardFooter>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
