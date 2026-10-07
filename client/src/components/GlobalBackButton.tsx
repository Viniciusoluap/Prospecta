import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "./ui/button";

/**
 * Retorno único para toda tela que não seja a página inicial ou de login.
 * Mantém a navegação pelo histórico; em acesso direto usa a área pai segura.
 */
export function GlobalBackButton() {
  const [location, setLocation] = useLocation();

  if (location === "/" || location === "/login") return null;

  const fallback = location.startsWith("/admin")
    ? "/admin"
    : location.startsWith("/portal")
      ? "/portal"
      : "/";

  const goBack = () => {
    if (window.history.length > 1) window.history.back();
    else setLocation(fallback);
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={goBack}
      aria-label="Voltar à página anterior"
      className="fixed bottom-5 left-5 z-50 h-10 gap-2 border-[#C9A961]/70 bg-[#1A2332]/95 px-3 text-[#C9A961] shadow-lg backdrop-blur hover:bg-[#2C3E50] hover:text-white"
    >
      <ArrowLeft className="h-4 w-4" />
      <span>Voltar</span>
    </Button>
  );
}
