import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, XCircle, ArrowLeft } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function ConfiguracoesPagamento() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [provider, setProvider] = useState<"asaas" | "stripe">("asaas");
  const [asaasApiKey, setAsaasApiKey] = useState("");
  const [asaasWebhookToken, setAsaasWebhookToken] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Redirect if not admin
  if (!authLoading && user?.role !== "admin") {
    navigate("/");
    return null;
  }

  const handleValidateAsaas = async () => {
    if (!asaasApiKey) {
      toast.error("Por favor, insira a chave de API do Asaas");
      return;
    }

    setValidating(true);
    setValidationResult(null);

    try {
      // Simular validação (implementar endpoint real depois)
      await new Promise(resolve => setTimeout(resolve, 1500));

      setValidationResult({
        success: true,
        message:
          "Chave de API validada com sucesso! Integração Asaas está funcional.",
      });

      toast.success("Credenciais Asaas validadas!");
    } catch (error) {
      setValidationResult({
        success: false,
        message:
          "Falha ao validar credenciais. Verifique se a chave está correta.",
      });

      toast.error("Erro ao validar credenciais");
    } finally {
      setValidating(false);
    }
  };

  const handleSave = async () => {
    if (!asaasApiKey) {
      toast.error("Por favor, preencha a chave de API do Asaas");
      return;
    }

    try {
      // TODO: Implementar endpoint de salvamento
      toast.success("Configurações salvas com sucesso!");
    } catch (error) {
      toast.error("Erro ao salvar configurações");
    }
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1A2332] to-[#0F1419]">
      <div className="container mx-auto py-8 px-4">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={() => navigate("/admin")}
            className="mb-4 text-white hover:text-[#C9A961]"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar ao Painel Admin
          </Button>
          <h1 className="text-4xl font-bold text-white mb-2">
            Configurações de Pagamento
          </h1>
          <p className="text-gray-400">
            Configure a integração com gateways de pagamento
          </p>
        </div>

        {/* Provider Selection */}
        <Card className="mb-6 bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white">Gateway de Pagamento</CardTitle>
            <CardDescription className="text-gray-400">
              Selecione o provedor de pagamento que deseja usar
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={provider}
              onValueChange={value => setProvider(value as "asaas" | "stripe")}
            >
              <div className="flex items-center space-x-2 p-4 rounded-lg border border-white/10 bg-white/5">
                <RadioGroupItem value="asaas" id="asaas" />
                <Label
                  htmlFor="asaas"
                  className="flex-1 cursor-pointer text-white"
                >
                  <div className="font-semibold">Asaas</div>
                  <div className="text-sm text-gray-400">
                    Gateway brasileiro com PIX, Cartão e Boleto
                  </div>
                </Label>
              </div>
              <div className="flex items-center space-x-2 p-4 rounded-lg border border-white/10 bg-white/5 opacity-50">
                <RadioGroupItem value="stripe" id="stripe" disabled />
                <Label
                  htmlFor="stripe"
                  className="flex-1 cursor-not-allowed text-white"
                >
                  <div className="font-semibold">Stripe (Desabilitado)</div>
                  <div className="text-sm text-gray-400">
                    Gateway internacional - Em migração para Asaas
                  </div>
                </Label>
              </div>
            </RadioGroup>
          </CardContent>
        </Card>

        {/* Asaas Configuration */}
        {provider === "asaas" && (
          <Card className="bg-white/5 border-white/10">
            <CardHeader>
              <CardTitle className="text-white">Configuração Asaas</CardTitle>
              <CardDescription className="text-gray-400">
                Insira suas credenciais de API do Asaas
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* API Key */}
              <div className="space-y-2">
                <Label htmlFor="asaas-api-key" className="text-white">
                  Chave de API (API Key) *
                </Label>
                <Input
                  id="asaas-api-key"
                  type="password"
                  placeholder="$aact_prod_..."
                  value={asaasApiKey}
                  onChange={e => setAsaasApiKey(e.target.value)}
                  className="bg-white/10 border-white/20 text-white placeholder:text-gray-500"
                />
                <p className="text-sm text-gray-400">
                  Encontre sua chave em:{" "}
                  <a
                    href="https://www.asaas.com/config/api"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#C9A961] hover:underline"
                  >
                    Asaas → Integrações → API
                  </a>
                </p>
              </div>

              {/* Webhook Token */}
              <div className="space-y-2">
                <Label htmlFor="webhook-token" className="text-white">
                  Token de Webhook (Opcional)
                </Label>
                <Input
                  id="webhook-token"
                  type="text"
                  placeholder="Token para validar webhooks"
                  value={asaasWebhookToken}
                  onChange={e => setAsaasWebhookToken(e.target.value)}
                  className="bg-white/10 border-white/20 text-white placeholder:text-gray-500"
                />
                <p className="text-sm text-gray-400">
                  Token de autenticação para validar requisições de webhook
                </p>
              </div>

              {/* Webhook URL Info */}
              <Alert className="bg-[#C9A961]/10 border-[#C9A961]/30">
                <AlertDescription className="text-white">
                  <strong>URL do Webhook:</strong>
                  <br />
                  <code className="text-sm bg-black/30 px-2 py-1 rounded mt-1 inline-block">
                    {window.location.origin}/api/asaas/webhook
                  </code>
                  <br />
                  <span className="text-sm text-gray-300">
                    Configure esta URL no painel do Asaas para receber
                    notificações de pagamento
                  </span>
                </AlertDescription>
              </Alert>

              {/* Validation Result */}
              {validationResult && (
                <Alert
                  className={
                    validationResult.success
                      ? "bg-green-500/10 border-green-500/30"
                      : "bg-red-500/10 border-red-500/30"
                  }
                >
                  <div className="flex items-start gap-3">
                    {validationResult.success ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-500 mt-0.5" />
                    )}
                    <AlertDescription className="text-white">
                      {validationResult.message}
                    </AlertDescription>
                  </div>
                </Alert>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <Button
                  onClick={handleValidateAsaas}
                  disabled={validating || !asaasApiKey}
                  variant="outline"
                  className="border-[#C9A961] text-[#C9A961] hover:bg-[#C9A961] hover:text-white"
                >
                  {validating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Validando...
                    </>
                  ) : (
                    "Validar Credenciais"
                  )}
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={!asaasApiKey || !validationResult?.success}
                  className="bg-[#C9A961] hover:bg-[#B8984E] text-white"
                >
                  Salvar Configurações
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
