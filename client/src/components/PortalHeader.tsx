import { ArrowLeft, LogOut } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "./ui/button";
import { APP_LOGO } from "@/const";

/**
 * Cabeçalho único dos portais (Cliente, Corretor e Empreiteiro) — pedido de 18/10:
 * "Voltar" dentro do cabeçalho à esquerda, logo e nome da empresa no centro e
 * "Sair" à direita. O botão fixo global fica desligado nessas rotas.
 */
export function PortalHeader({
  subtitle,
  fallback,
  onLogout,
}: {
  subtitle: string;
  /** Destino do "Voltar" quando não há histórico (acesso direto pelo link). */
  fallback: string;
  onLogout: () => void;
}) {
  const [, setLocation] = useLocation();
  const goBack = () => {
    if (window.history.length > 1) window.history.back();
    else setLocation(fallback);
  };
  return (
    <header className="border-b-4 border-[#C9A961] bg-[#1A2332] text-white">
      <div className="mx-auto grid max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-3 sm:px-4 sm:py-4">
        <div className="flex justify-start">
          <Button
            type="button"
            variant="ghost"
            onClick={goBack}
            aria-label="Voltar à página anterior"
            className="h-9 gap-1 px-2 text-[#C9A961] hover:bg-white/10 hover:text-white sm:px-3"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Voltar</span>
          </Button>
        </div>
        <div className="min-w-0 text-center">
          <img src={APP_LOGO} alt="Prospecta" className="mx-auto mb-1 h-8 w-auto" />
          <div className="text-lg font-black leading-tight text-[#C9A961] sm:text-xl">PROSPECTA</div>
          <div className="truncate text-xs text-slate-300">{subtitle}</div>
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            className="h-9 gap-1 px-2 text-white hover:bg-white/10 hover:text-[#C9A961] sm:px-3"
            onClick={onLogout}
          >
            <LogOut className="h-4 w-4" />
            <span>Sair</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
