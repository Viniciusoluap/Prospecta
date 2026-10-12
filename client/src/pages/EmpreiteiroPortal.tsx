import { useEffect } from "react";
import { formatarPercentual, progressoDaObra } from "@shared/financeiro/progresso";
import { useLocation } from "wouter";
import { HardHat, Loader2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

// Acesso do Empreiteiro (EPIC-020 Lote 2, itens 17.2 e 22): somente as obras
// em que ele é o empreiteiro vinculado, com o próprio percentual e lucro.
// Nada é editável aqui; percentuais são definidos pela empresa.
export default function EmpreiteiroPortal() {
  const { user, loading } = useAuth({ redirectOnUnauthenticated: true, redirectPath: "/login" });
  const [, navigate] = useLocation();
  const habilitado = !loading && user?.role === "empreiteiro";
  const obras = trpc.empreiteiro.minhasObras.useQuery(undefined, { enabled: habilitado });

  useEffect(() => {
    if (!loading && user && user.role !== "empreiteiro") navigate(user.role === "admin" ? "/admin" : "/");
  }, [loading, user, navigate]);

  if (loading || !habilitado) {
    return <div className="min-h-screen grid place-items-center bg-[#1A2332] text-[#C9A961]">Verificando acesso...</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332] text-white">
      <div className="container py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-[#C9A961] flex items-center gap-3"><HardHat className="h-8 w-8" /> Minhas Obras</h1>
          <p className="text-gray-400 mt-1">Obras em que você é o empreiteiro vinculado à Prospecta Construções.</p>
        </div>
        {obras.isLoading && <Loader2 className="h-6 w-6 animate-spin text-[#C9A961]" />}
        {obras.data?.length === 0 && <p className="text-gray-400">Nenhuma obra vinculada a você no momento.</p>}
        <div className="grid gap-4 md:grid-cols-2">
          {obras.data?.map((o) => (
            <Card key={o.id} className="bg-[#1A2332]/60 border-[#C9A961]/20">
              <CardHeader>
                <CardTitle className="text-[#C9A961]">{o.title}</CardTitle>
                <p className="text-sm text-gray-400">{[o.address, o.city].filter(Boolean).join(" · ") || "Endereço não informado"}</p>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p><span className="text-gray-400">Andamento da obra:</span> {formatarPercentual(progressoDaObra(o.progressMeasuredPct, o.progress))}</p>
                <p><span className="text-gray-400">Sua participação:</span> {o.percentualEmpreiteiro ? `${Number(o.percentualEmpreiteiro).toLocaleString("pt-BR", { maximumFractionDigits: 6 })}%` : "não definida"}</p>
                <p>
                  <span className="text-gray-400">Seu lucro estimado:</span>{" "}
                  {o.lucroEmpreiteiro.ok
                    ? <strong className="text-[#F4D37D]">{(o.lucroEmpreiteiro.centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong>
                    : <span className="text-amber-300">{o.lucroEmpreiteiro.motivo}</span>}
                </p>
                <p className="text-xs text-gray-500">Estimativa calculada sobre o lucro da operação após a participação dos investidores.</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
