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
import { Coins, Copy, CheckCircle2, AlertCircle, Info, CreditCard, Smartphone, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

export default function ComprarUtef() {
  const { user, isAuthenticated } = useAuth();
  const [amount, setAmount] = useState(100); // Quantidade de UTEFs
  const [purchaseComplete, setPurchaseComplete] = useState(false);
  const [pixCode, setPixCode] = useState<string>("");
  const [pixQrCode, setPixQrCode] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<"pix" | "credit_card" | "boleto">("pix");

  const purchaseMutation = trpc.utef.purchase.useMutation({
    onSuccess: (data) => {
      // Pagamento via PIX
      if (data.pixCopyPaste && data.pixQrCode) {
        setPixCode(data.pixCopyPaste || "");
        setPixQrCode(data.pixQrCode || "");
        setPurchaseComplete(true);
        toast.success("PIX gerado com sucesso!");
      } else if (data.invoiceUrl) {
        // Pagamento via Boleto ou Cartão
        window.open(data.invoiceUrl, '_blank');
        toast.success("Redirecionando para pagamento...");
        setTimeout(() => {
          window.location.href = "/meu-saldo";
        }, 2000);
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
    <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
      <Navbar />
      
      <main className="flex-1 py-12">
        <div className="container max-w-2xl space-y-6">
          {/* Botão Voltar */}
          <Link href="/" className="inline-flex items-center gap-2 text-gray-400 hover:text-[#C9A961] transition-colors">
            <ArrowLeft className="h-5 w-5" />
            <span>Voltar</span>
          </Link>

          <div className="text-center space-y-4">
            <h1 className="text-5xl font-bold text-[#C9A961]">Comprar UTEFs</h1>
            <p className="text-xl text-gray-300">
              Adquira créditos <span className="text-[#00FF00] font-semibold">UTEF</span> para usar no ecossistema Efficaz
            </p>
          </div>

          {!purchaseComplete ? (
            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-3xl flex items-center gap-3 text-[#C9A961]">
                  <Coins className="h-8 w-8" />
                  Compra Direta de UTEFs
                </CardTitle>
                <CardDescription className="text-gray-400 text-base">
                  1 UTEF = R$ 1,00 | Use seus UTEFs para adquirir produtos do ecossistema
                </CardDescription>
              </CardHeader>
              
              <CardContent className="space-y-6">
                <Alert className="bg-[#2C3E50] border-[#C9A961]/30 text-gray-300">
                  <Info className="h-5 w-5 text-[#C9A961]" />
                  <AlertDescription className="text-gray-300">
                    <strong className="text-[#C9A961]">UTEF (Utility Token Efficaz)</strong> é o crédito interno do Grupo Efficaz. 
                    Você pode usá-lo para adquirir imóveis, serviços financeiros e embarcações.
                  </AlertDescription>
                </Alert>

                <Alert className="bg-[#00FF00]/10 border-[#00FF00]/30">
                  <Coins className="h-5 w-5 text-[#00FF00]" />
                  <AlertDescription className="text-gray-300">
                    <strong className="text-[#00FF00]">🎉 Bônus Especial:</strong> Compre 1.000 UTEFs ou mais e ganhe <strong className="text-[#00FF00]">10% de bônus</strong> grátis!
                  </AlertDescription>
                </Alert>

                <div className="space-y-3">
                  <Label htmlFor="amount" className="text-gray-300 text-base">Quantidade de UTEFs</Label>
                  <Input
                    id="amount"
                    type="number"
                    min="1"
                    max="1000000"
                    value={amount}
                    onChange={(e) => setAmount(Math.max(1, parseInt(e.target.value) || 1))}
                    className="bg-[#2C3E50] border-[#C9A961]/30 text-white text-lg h-12"
                  />
                  <p className="text-sm text-gray-400">
                    Mínimo: 1 UTEF | Sem limite máximo
                  </p>
                </div>

                <div className="space-y-3">
                  <Label className="text-gray-300 text-base">Método de Pagamento</Label>
                  <div className="grid grid-cols-2 gap-4">
                    <Button
                      type="button"
                      variant={paymentMethod === "credit_card" ? "default" : "outline"}
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

                <div className="p-6 bg-[#2C3E50] rounded-lg border border-[#C9A961]/20 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Quantidade:</span>
                    <span className="font-medium text-white text-lg">{amount.toLocaleString("pt-BR")} UTEF</span>
                  </div>
                  {bonusAmount > 0 && (
                    <>
                      <div className="flex justify-between items-center">
                        <span className="text-[#00FF00] font-medium">🎉 Bônus (10%):</span>
                        <span className="font-bold text-[#00FF00] text-lg">+{bonusAmount.toLocaleString("pt-BR")} UTEF</span>
                      </div>
                      <div className="flex justify-between items-center border-t border-[#C9A961]/20 pt-3">
                        <span className="font-medium text-gray-300">Total de UTEFs:</span>
                        <span className="font-bold text-[#00FF00] text-xl">{totalUtef.toLocaleString("pt-BR")} UTEF</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between items-center border-t border-[#C9A961]/20 pt-3">
                    <span className="text-lg font-medium text-gray-300">Total a Pagar:</span>
                    <span className="text-3xl font-bold text-[#C9A961]">{formatCurrency(totalPrice)}</span>
                  </div>
                </div>

                {!isAuthenticated && (
                  <Alert className="bg-red-500/10 border-red-500/30">
                    <AlertCircle className="h-5 w-5 text-red-400" />
                    <AlertDescription className="text-red-300">
                      Você precisa estar logado para comprar UTEFs
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
                  <Coins className="h-5 w-5" />
                  {purchaseMutation.isPending ? "Processando..." : paymentMethod === "credit_card" ? "Pagar com Cartão" : paymentMethod === "boleto" ? "Gerar Boleto" : "Gerar PIX para Pagamento"}
                </Button>
              </CardFooter>
            </Card>
          ) : (
            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-3xl flex items-center gap-3 text-[#00FF00]">
                  <CheckCircle2 className="h-8 w-8" />
                  PIX Gerado!
                </CardTitle>
                <CardDescription className="text-gray-400 text-base">
                  Pague via PIX para receber seus UTEFs
                </CardDescription>
              </CardHeader>
              
              <CardContent className="space-y-6">
                <Alert className="bg-[#2C3E50] border-[#C9A961]/30">
                  <AlertDescription className="text-gray-300">
                    <strong className="text-[#C9A961]">Importante:</strong> Após o pagamento, seus UTEFs serão creditados automaticamente em sua conta.
                  </AlertDescription>
                </Alert>

                {pixQrCode && (
                  <div className="flex justify-center p-6 bg-white rounded-lg border-2 border-[#C9A961]/30">
                    <img src={pixQrCode} alt="QR Code PIX" className="w-64 h-64" />
                  </div>
                )}

                <div className="space-y-3">
                  <Label className="text-gray-300 text-base">Código PIX (Copia e Cola)</Label>
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
                    Escaneie o QR Code acima ou copie o código e cole no app do seu banco
                  </p>
                </div>

                <div className="p-6 bg-[#2C3E50] rounded-lg border border-[#C9A961]/20 space-y-3">
                  <h3 className="font-bold text-[#C9A961] text-lg">Resumo da Compra</h3>
                  <div className="flex justify-between text-base">
                    <span className="text-gray-400">Quantidade:</span>
                    <span className="text-white font-medium">{amount.toLocaleString("pt-BR")} UTEF</span>
                  </div>
                  <div className="flex justify-between text-base border-t border-[#C9A961]/20 pt-3">
                    <span className="text-gray-400">Valor Total:</span>
                    <span className="font-bold text-[#C9A961] text-xl">{formatCurrency(totalPrice)}</span>
                  </div>
                </div>
              </CardContent>
              
              <CardFooter>
                <Button 
                  onClick={() => window.location.href = "/meu-saldo"}
                  className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold text-lg py-6 h-auto"
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
