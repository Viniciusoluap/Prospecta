import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "./ui/button";

interface BackButtonProps {
  /** URL para voltar. Se não fornecido, volta para a página anterior ou Home */
  to?: string;
  /** Texto do botão. Padrão: "Voltar" */
  label?: string;
  /** Variante do botão */
  variant?: "default" | "outline" | "ghost" | "link";
  /** Classe CSS adicional */
  className?: string;
}

export function BackButton({
  to,
  label = "Voltar",
  variant = "ghost",
  className = "",
}: BackButtonProps) {
  const [, setLocation] = useLocation();

  const handleBack = () => {
    if (to) {
      setLocation(to);
    } else if (window.history.length > 1) {
      window.history.back();
    } else {
      setLocation("/");
    }
  };

  return (
    <Button
      variant={variant}
      onClick={handleBack}
      className={`gap-2 text-muted-foreground hover:text-foreground ${className}`}
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </Button>
  );
}
