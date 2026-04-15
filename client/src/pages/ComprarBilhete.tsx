import { useState } from "react";
import { useRoute, Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Navbar from "@/components/Navbar";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatCurrency, formatUtef, getLoginUrl } from "@/const";
import {
  Ticket,
  Copy,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  CreditCard,
  Smartphone,
} from "lucide-react";
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
  const [paymentMethod, setPaymentMethod] = useState<
    "pix" | "credit_card" | "boleto"
  >("pix");
  const [ticketId, setTicketId] = useState<number | null>(null);

  const { data: draw, isLoading } = trpc.draws.getById.useQuery({ id: drawId });

  const purchaseMutation = trpc.tickets.purchase.useMutation({
    onSuccess: data => {
      console.log("Purchase success:", data);
      // Pagamento via PIX
      if (data.pixCopyPaste && data.pixQrCode) {
        console.log("Setting PIX data:", {
          pixCopyPaste: data.pixCopyPaste?.substring(0, 50),
          pixQrCode: data.pixQrCode?.substring(0, 50),
          ticketId: data.ticket.id,
        });
        setPixCode(data.pixCopyPaste || "");
        setPixQrCode(data.pixQrCode || "");
        setTicketId(data.ticket.id);
        setPurchaseComplete(true);
        toast.success("Bilhete gerado com sucesso!");
      } else if (data.invoiceUrl) {
        // Pagamento via Boleto ou Cartão
        window.open(data.invoiceUrl, "_blank");
        toast.success("Redirecionando para pagamento...");
        setTimeout(() => {
          window.location.href = "/meus-bilhetes";
        }, 2000);
      }
    },
    onError: error => {
      console.error("Purchase error:", error);
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
      <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
        <Navbar />
        <main className="flex-1 py-12">
          <div className="container max-w-2xl">
            <Skeleton className="h-64 w-full bg-[#2C3E50]" />
          </div>
        </main>
      </div>
    );
  }

  if (!draw) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
        <Navbar />
        <main className="flex-1 py-12">
          <div className="container max-w-2xl">
            <Alert className="bg-red-500/10 border-red-500/30">
              <AlertCircle className="h-5 w-5 text-red-400" />
              <AlertDescription className="text-red-300">
                Sorteio não encontrado
              </AlertDescription>
            </Alert>
          </div>
        </main>
      </div>
    );
  }

  const totalPrice = draw.ticketPrice * quantity;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
      <Navbar />

      <main className="flex-1 py-12">
        <div className="container max-w-2xl space-y-6">
          <Button
            asChild
            variant="ghost"
            className="gap-2 text-[#C9A961] hover:text-[#B8985A] hover:bg-[#2C3E50]"
          >
            <Link href="/sorteios">
              <ArrowLeft className="h-4 w-4" />
              Voltar para Sorteios
            </Link>
          </Button>

          {!purchaseComplete ? (
            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-3xl text-[#C9A961]">
                  Comprar Bilhetes
                </CardTitle>
                <CardDescription className="text-gray-400 text-base">
                  {draw.title}
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-6">
                <div className="p-6 bg-[#2C3E50] rounded-lg border border-[#C9A961]/20 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Prêmio:</span>
                    <span className="font-bold text-[#00FF00] text-xl">
                      {formatUtef(draw.prizeAmount)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Valor por bilhete:</span>
                    <span className="font-bold text-[#C9A961] text-xl">
                      {formatCurrency(draw.ticketPrice)}
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label htmlFor="quantity" className="text-gray-300 text-base">
                    Quantidade de Bilhetes
                  </Label>
                  <Input
                    id="quantity"
                    type="number"
                    min="1"
                    value={quantity}
                    onChange={e =>
                      setQuantity(Math.max(1, parseInt(e.target.value) || 1))
                    }
                    className="bg-[#2C3E50] border-[#C9A961]/30 text-white text-lg h-12"
                  />
                  <p className="text-sm text-gray-400">
                    Mínimo: 1 bilhete | Sem limite máximo
                  </p>
                </div>

                <div className="space-y-3">
                  <Label className="text-gray-300 text-base">
                    Método de Pagamento
                  </Label>
                  <div className="grid grid-cols-2 gap-4">
                    <Button
                      type="button"
                      variant={
                        paymentMethod === "credit_card" ? "default" : "outline"
                      }
                      onClick={() => setPaymentMethod("credit_card")}
                      className={
                        paymentMethod === "credit_card"
                          ? "bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold h-14 gap-2"
                          : "bg-transparent border-[#C9A961]/30 text-gray-300 hover:bg-[#2C3E50] h-14 gap-2"
                      }
                    >
                      <CreditCard className="h-5 w-5" />
                      Cartão de Crédito
                    </Button>
                    <Button
                      type="button"
                      variant={paymentMethod === "pix" ? "default" : "outline"}
                      onClick={() => setPaymentMethod("pix")}
                      className={
                        paymentMethod === "pix"
                          ? "bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold h-14 gap-2"
                          : "bg-transparent border-[#C9A961]/30 text-gray-300 hover:bg-[#2C3E50] h-14 gap-2"
                      }
                    >
                      <Smartphone className="h-5 w-5" />
                      PIX
                    </Button>
                  </div>
                </div>

                <div className="p-6 bg-[#2C3E50] rounded-lg border border-[#C9A961]/20">
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-medium text-gray-300">
                      Total a Pagar:
                    </span>
                    <span className="text-3xl font-bold text-[#C9A961]">
                      {formatCurrency(totalPrice)}
                    </span>
                  </div>
                </div>

                {!isAuthenticated && (
                  <Alert className="bg-red-500/10 border-red-500/30">
                    <AlertCircle className="h-5 w-5 text-red-400" />
                    <AlertDescription className="text-red-300">
                      Você precisa estar logado para comprar bilhetes
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>

              <CardFooter>
                <Button
                  onClick={handlePurchase}
                  disabled={purchaseMutation.isPending || !isAuthenticated}
                  className="w-full gap-2 bg-[#00FF00] hover:bg-[#00dd00] text-black font-bold text-lg py-6 h-auto"
                >
                  <Ticket className="h-5 w-5" />
                  {purchaseMutation.isPending
                    ? "Processando..."
                    : paymentMethod === "credit_card"
                      ? "Pagar com Cartão"
                      : paymentMethod === "boleto"
                        ? "Gerar Boleto"
                        : "Gerar PIX para Pagamento"}
                </Button>
              </CardFooter>
            </Card>
          ) : (
            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-3xl flex items-center gap-3 text-[#00FF00]">
                  <CheckCircle2 className="h-8 w-8" />
                  Bilhete Gerado!
                </CardTitle>
                <CardDescription className="text-gray-400 text-base">
                  Pague via PIX para confirmar sua participação
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-6">
                <Alert className="bg-[#2C3E50] border-[#C9A961]/30">
                  <AlertDescription className="text-gray-300">
                    <strong className="text-[#C9A961]">Importante:</strong> O
                    pagamento deve ser realizado em até 30 minutos. Após o
                    pagamento, clique em "Confirmar Pagamento" abaixo.
                  </AlertDescription>
                </Alert>

                {pixQrCode && (
                  <div className="flex justify-center p-6 bg-white rounded-lg border-2 border-[#C9A961]/30">
                    <img
                      src={
                        pixQrCode.startsWith("data:")
                          ? pixQrCode
                          : `data:image/png;base64,${pixQrCode}`
                      }
                      alt="QR Code PIX"
                      className="w-64 h-64"
                    />
                  </div>
                )}

                <div className="space-y-3">
                  <Label className="text-gray-300 text-base">
                    Código PIX (Copia e Cola)
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      value={pixCode}
                      readOnly
                      className="font-mono text-sm bg-[#2C3E50] border-[#C9A961]/30 text-white"
                    />
                    <Button
                      onClick={handleCopyPix}
                      variant="outline"
                      size="icon"
                      className="border-[#C9A961]/30 text-[#C9A961] hover:bg-[#2C3E50] h-10 w-10"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-sm text-gray-400">
                    Escaneie o QR Code acima ou copie o código e cole no app do
                    seu banco
                  </p>
                </div>

                <div className="p-6 bg-[#2C3E50] rounded-lg border border-[#C9A961]/20 space-y-3">
                  <h3 className="font-bold text-[#C9A961] text-lg">
                    Resumo da Compra
                  </h3>
                  <div className="flex justify-between text-base">
                    <span className="text-gray-400">Quantidade:</span>
                    <span className="text-white font-medium">
                      {quantity} bilhete(s)
                    </span>
                  </div>
                  <div className="flex justify-between text-base border-t border-[#C9A961]/20 pt-3">
                    <span className="text-gray-400">Valor Total:</span>
                    <span className="font-bold text-[#C9A961] text-xl">
                      {formatCurrency(totalPrice)}
                    </span>
                  </div>
                </div>
              </CardContent>

              <CardFooter className="flex-col gap-3">
                <Button
                  onClick={handleConfirmPayment}
                  disabled={confirmPaymentMutation.isPending}
                  className="w-full bg-[#00FF00] hover:bg-[#00dd00] text-black font-bold text-lg py-6 h-auto"
                >
                  {confirmPaymentMutation.isPending
                    ? "Confirmando..."
                    : "Já Paguei - Confirmar Pagamento"}
                </Button>
                <p className="text-xs text-gray-400 text-center">
                  Simulação: Clique acima para confirmar o pagamento (em
                  produção, seria automático via webhook)
                </p>
              </CardFooter>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
