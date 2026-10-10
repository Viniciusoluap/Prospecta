import { useEffect } from "react";
import { useLocation } from "wouter";

export function LegacyRedirect({ to }: { to: string }) {
  const [, navigate] = useLocation();
  useEffect(() => navigate(to, { replace: true }), [navigate, to]);
  return (
    <div className="min-h-screen grid place-items-center bg-[#1A2332] text-[#C9A961]">
      Redirecionando...
    </div>
  );
}
