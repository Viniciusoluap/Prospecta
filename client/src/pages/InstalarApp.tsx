import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Navbar from "@/components/Navbar";
import SEO from "@/components/SEO";
import {
  ArrowLeft,
  Download,
  Share,
  SquarePlus,
  CheckCircle2,
  Smartphone,
  Wifi,
  Lock,
  RefreshCw,
} from "lucide-react";
import {
  getInstallPrompt,
  isStandalone,
  onInstallPromptChange,
  promptInstall,
} from "@/lib/pwa";

export default function InstalarApp() {
  const [canInstall, setCanInstall] = useState(() => Boolean(getInstallPrompt()));
  const [installed, setInstalled] = useState(() => isStandalone());
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const unsubscribe = onInstallPromptChange(() => {
      setCanInstall(Boolean(getInstallPrompt()));
      setInstalled(isStandalone());
    });
    return () => { unsubscribe(); };
  }, []);

  async function handleInstallClick() {
    setInstalling(true);
    try {
      const outcome = await promptInstall();
      if (outcome === "accepted") setInstalled(true);
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
      <SEO
        title="Instale nosso aplicativo"
        description="Instale o aplicativo da Prospecta Construções na tela inicial do seu celular e acompanhe obras, financiamentos, documentos e serviços com mais rapidez."
        keywords="instalar aplicativo Prospecta, PWA Prospecta, app Prospecta Construções"
      />
      <Navbar />

      <main className="flex-1 py-12">
        <div className="container">
          <Link href="/" className="inline-flex items-center gap-2 text-gray-400 hover:text-[#C9A961] transition-colors mb-6">
            <ArrowLeft className="h-5 w-5" />
            <span>Voltar</span>
          </Link>

          <div className="mx-auto max-w-3xl space-y-10 text-center">
            <div className="space-y-4">
              <img src="/icon-192.png" alt="Ícone do aplicativo Prospecta Construções" className="mx-auto h-24 w-24 rounded-2xl shadow-lg shadow-black/40" />
              <p className="text-[#C9A961] font-bold text-xs tracking-widest uppercase">Seu aplicativo</p>
              <h1 className="text-4xl md:text-5xl font-bold text-[#C9A961]">Instale nosso aplicativo</h1>
              <p className="text-lg text-gray-300 max-w-2xl mx-auto">
                Tenha a Prospecta Construções sempre à mão. Instale nosso aplicativo na tela inicial do
                celular e acompanhe suas obras, financiamentos, documentos e serviços de forma rápida e prática.
              </p>
              <p className="text-sm uppercase tracking-wide text-[#C9A961]/80 font-semibold">Seu sistema sempre à mão.</p>
            </div>

            <div className="flex flex-col items-center gap-3">
              {installed ? (
                <Link href="/">
                  <Button size="lg" className="bg-[#C9A961] text-[#1A2332] font-bold hover:bg-[#B8985A]">
                    <CheckCircle2 className="mr-2 h-5 w-5" /> Abrir aplicativo
                  </Button>
                </Link>
              ) : canInstall ? (
                <Button size="lg" disabled={installing} onClick={handleInstallClick} className="bg-[#C9A961] text-[#1A2332] font-bold hover:bg-[#B8985A]">
                  <Download className="mr-2 h-5 w-5" /> {installing ? "Instalando…" : "Instalar aplicativo"}
                </Button>
              ) : (
                <p className="text-sm text-gray-400 max-w-md">
                  Seu navegador ainda não oferece a instalação automática. Siga as instruções abaixo
                  para adicionar o aplicativo à tela inicial manualmente.
                </p>
              )}
            </div>

            <div className="grid gap-6 text-left sm:grid-cols-2">
              <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-center gap-2 text-[#C9A961] font-bold">
                    <Smartphone className="h-5 w-5" /> iPhone (Safari ou Google Chrome)
                  </div>
                  <ol className="space-y-3 text-sm text-gray-300 list-decimal list-inside">
                    <li>Abra o endereço do sistema pelo Safari ou Google Chrome.</li>
                    <li className="flex items-start gap-2">
                      <Share className="mt-0.5 h-4 w-4 shrink-0 text-[#C9A961]" />
                      <span>Toque no ícone de compartilhamento (ou no menu disponível).</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <SquarePlus className="mt-0.5 h-4 w-4 shrink-0 text-[#C9A961]" />
                      <span>Selecione "Adicionar à Tela de Início", quando disponível.</span>
                    </li>
                    <li>Confirme a inclusão.</li>
                    <li>Abra o aplicativo pelo ícone criado na tela inicial.</li>
                  </ol>
                  <p className="text-xs text-gray-500">
                    O caminho exato pode variar conforme a versão do iOS e do Safari ou Google Chrome.
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-center gap-2 text-[#C9A961] font-bold">
                    <Smartphone className="h-5 w-5" /> Android (Google Chrome)
                  </div>
                  <ol className="space-y-3 text-sm text-gray-300 list-decimal list-inside">
                    <li>Abra o endereço do sistema no Google Chrome.</li>
                    <li>Use a opção "Instalar aplicativo" ou "Adicionar à tela inicial" (ou o botão acima, quando disponível).</li>
                    <li>Confirme a instalação.</li>
                    <li>Acesse o aplicativo pelo ícone criado.</li>
                  </ol>
                  <p className="text-xs text-gray-500">
                    Quando o Google Chrome oferece a instalação nativa, o botão "Instalar aplicativo" acima já aciona esse mecanismo.
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm text-left">
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center gap-2 text-[#C9A961] font-bold">
                  <CheckCircle2 className="h-5 w-5" /> Depois de instalar
                </div>
                <ul className="space-y-2 text-sm text-gray-300">
                  <li className="flex items-start gap-2"><Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#C9A961]" /> Seu login e suas permissões continuam exatamente iguais aos do navegador.</li>
                  <li className="flex items-start gap-2"><RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-[#C9A961]" /> As atualizações chegam automaticamente, sem precisar reinstalar.</li>
                  <li className="flex items-start gap-2"><Wifi className="mt-0.5 h-4 w-4 shrink-0 text-[#C9A961]" /> Dados financeiros e documentos nunca ficam salvos no aparelho — sempre vêm direto do sistema.</li>
                </ul>
              </CardContent>
            </Card>

            <p className="text-xs text-gray-500">
              Este não é um aplicativo publicado na App Store ou no Google Play — é o próprio sistema
              Prospecta Construções, instalado como aplicativo (PWA) direto do navegador.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
