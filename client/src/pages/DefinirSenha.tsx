import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { trpc } from "@/lib/trpc";
import { CaixaDoTermo } from "@/components/consentimento/CaixaDoTermo";
import { AVISO_SEM_ACEITE } from "../../../shared/termo-consentimento";

export default function DefinirSenha() {
  const { token } = useParams();
  const [, setLocation] = useLocation();
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // EPIC-024 S-12: caixa do termo SEMPRE começa desmarcada.
  const [aceitou, setAceitou] = useState(false);
  const [avisoTermo, setAvisoTermo] = useState<string | null>(null);

  const { data: validacao, isLoading, isError: falhaAoVerificar, refetch, isFetching } = trpc.primeiroAcesso.validarToken.useQuery(
    { token: token ?? "" },
    { enabled: !!token, retry: 1 },
  );
  const definir = trpc.primeiroAcesso.definirSenha.useMutation({
    onSuccess: () => {
      setDone(true);
      setTimeout(() => setLocation("/login"), 2000);
    },
    onError: (e) => setError(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (senha !== confirmar) {
      setError("As senhas não coincidem.");
      return;
    }
    if (!token) return;
    if (validacao?.termo === "obrigatorio" && !aceitou) {
      setAvisoTermo(AVISO_SEM_ACEITE);
      document.getElementById("aceite-termo")?.focus();
      return;
    }
    definir.mutate({
      token, novaSenha: senha,
      ...(validacao?.termo !== "aceito" && aceitou ? { aceitouTermo: true, versaoDoTermo: validacao?.versaoDoTermo } : {}),
    });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1A2332] px-4 text-gray-100">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-[#C9A961]">Prospecta Empreendimentos</h1>
          <p className="text-gray-400 text-xs uppercase tracking-[0.3em]">Definir senha</p>
        </div>

        <Card className="border-[#C9A961]/20 bg-[#2C3E50] text-white">
          {isLoading ? (
            <CardContent className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-[#C9A961]" />
            </CardContent>
          ) : done ? (
            <CardContent className="space-y-3 py-10 text-center">
              <CheckCircle2 size={40} className="mx-auto text-green-400" />
              <p className="text-sm text-gray-300">Senha definida! Redirecionando para o login…</p>
            </CardContent>
          ) : falhaAoVerificar ? (
            // QA S-12, achado 5: falha do servidor/banco não é "link inválido".
            <CardContent className="space-y-4 py-10 text-center">
              <AlertCircle size={36} className="mx-auto text-amber-300" />
              <p role="alert" className="text-sm text-gray-200">Não foi possível verificar agora; tente de novo em instantes.</p>
              <Button type="button" onClick={() => refetch()} disabled={isFetching} className="bg-[#C9A961] font-bold text-[#1A2332]">
                {isFetching ? "Verificando…" : "Tentar de novo"}
              </Button>
            </CardContent>
          ) : !validacao?.valido ? (
            <CardContent className="space-y-3 py-10 text-center">
              <AlertCircle size={36} className="mx-auto text-red-400" />
              <h2 className="text-lg font-bold uppercase tracking-wide text-[#C9A961]">Link inválido ou expirado</h2>
              <p className="text-sm text-gray-400">Peça ao administrador para gerar um novo link.</p>
            </CardContent>
          ) : (
            <>
              <CardHeader>
                <CardTitle className="text-[#C9A961]">Bem-vindo(a), {validacao.nome?.split(" ")[0]}</CardTitle>
                <CardDescription className="text-gray-400">Defina sua senha de acesso ao sistema.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  {error && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="senha">Nova senha</Label>
                    <div className="relative">
                      <Input
                        id="senha"
                        type={showPassword ? "text" : "password"}
                        value={senha}
                        onChange={(e) => setSenha(e.target.value)}
                        minLength={8}
                        required
                        autoComplete="new-password"
                        placeholder="••••••••"
                        className="border-[#C9A961]/30 bg-[#1A2332] pr-10"
                      />
                      <button
                        type="button"
                        aria-label={showPassword ? "Esconder senha" : "Mostrar senha"}
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmar">Confirmar senha</Label>
                    <Input
                      id="confirmar"
                      type={showPassword ? "text" : "password"}
                      value={confirmar}
                      onChange={(e) => setConfirmar(e.target.value)}
                      minLength={8}
                      required
                      autoComplete="new-password"
                      placeholder="••••••••"
                      className="border-[#C9A961]/30 bg-[#1A2332]"
                    />
                  </div>

                  {validacao.termo && validacao.termo !== "aceito" && (
                    <CaixaDoTermo
                      marcado={aceitou}
                      onChange={v => { setAceitou(v); if (v) setAvisoTermo(null); }}
                      aviso={avisoTermo}
                      opcional={validacao.termo === "opcional"}
                    />
                  )}

                  <Button
                    type="submit"
                    disabled={definir.isPending}
                    aria-disabled={validacao.termo === "obrigatorio" && !aceitou ? true : undefined}
                    className={`w-full bg-[#C9A961] font-bold text-[#1A2332] ${validacao.termo === "obrigatorio" && !aceitou ? "opacity-60" : ""}`}
                  >
                    {definir.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando...
                      </>
                    ) : (
                      <>
                        <KeyRound className="mr-2 h-4 w-4" /> Definir senha
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
