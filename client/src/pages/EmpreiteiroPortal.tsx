import { useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { BarChart3, Building2, HardHat, Landmark, Loader2, TrendingUp, Wallet } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ListaObras } from "@/components/obra/ListaObras";
import { formatCurrency } from "@/lib/format";
import { PortalHeader } from "@/components/PortalHeader";
import { trpc } from "@/lib/trpc";
import { totaisDoEmpreiteiro } from "@shared/portal-empreiteiro";

// Portal do Empreiteiro (EPIC-020 itens 17.2/22; redesenho pedido em 15/10/2026).
// "Minhas Obras": a mesma lista do admin (filtros sem "Responsável", sem Excluir),
// só com as obras vinculadas a ele. "Relatórios": somas de todas essas obras —
// o lucro previsto DELE, o VGV e o valor a receber do banco.

const CORES = ["#C9A961", "#4F9DDE", "#5CC28F", "#E07A5F", "#9B8DE0", "#F2CC8F", "#81B29A", "#E0A458"];
const reais = (centavos: number) => formatCurrency(centavos / 100);
const reaisCurto = (v: number) => v.toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

export default function EmpreiteiroPortal() {
  const { user, loading, logout } = useAuth({ redirectOnUnauthenticated: true, redirectPath: "/login" });
  const [, navigate] = useLocation();
  const habilitado = !loading && user?.role === "empreiteiro";
  const obras = trpc.empreiteiro.minhasObras.useQuery(undefined, { enabled: habilitado });
  const totais = useMemo(() => totaisDoEmpreiteiro(obras.data ?? []), [obras.data]);

  useEffect(() => {
    if (!loading && user && user.role !== "empreiteiro") navigate(user.role === "admin" ? "/admin" : "/");
  }, [loading, user, navigate]);

  if (loading || !habilitado) {
    return <div className="min-h-screen grid place-items-center bg-[#1A2332] text-[#C9A961]">Verificando acesso...</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332] text-white">
      <PortalHeader
        subtitle={`Portal do Empreiteiro · ${user?.name ?? ""}`}
        fallback="/empreiteiro"
        onLogout={() => logout()}
      />
      <div className="container pt-6">
        <h1 className="flex items-center gap-3 text-2xl font-bold text-[#C9A961] sm:text-3xl"><HardHat className="h-8 w-8" /> Acesso do Empreiteiro</h1>
        <p className="mt-1 text-gray-300">Obras em que você é o empreiteiro vinculado à Prospecta Construções.</p>
      </div>

      <div className="container py-8">
        <Tabs defaultValue="obras" className="w-full">
          <TabsList className="grid h-auto w-full max-w-md grid-cols-2 gap-1 border border-[#C9A961]/20 bg-[#1A2332]/60 p-1 text-gray-100">
            <TabsTrigger value="obras" className="min-h-10 gap-2 text-gray-200 data-[state=active]:bg-[#C9A961] data-[state=active]:text-[#1A2332]">
              <Building2 className="h-4 w-4" aria-hidden /> Minhas Obras
            </TabsTrigger>
            <TabsTrigger value="relatorios" className="min-h-10 gap-2 text-gray-200 data-[state=active]:bg-[#C9A961] data-[state=active]:text-[#1A2332]">
              <BarChart3 className="h-4 w-4" aria-hidden /> Relatórios
            </TabsTrigger>
          </TabsList>

          <TabsContent value="obras" className="mt-6">
            {obras.isLoading && <Loader2 className="h-6 w-6 animate-spin text-[#C9A961]" />}
            {obras.error && <p className="text-red-300">Erro ao carregar obras: {obras.error.message}</p>}
            {obras.data?.length === 0 && <p className="text-gray-400">Nenhuma obra vinculada a você no momento.</p>}
            {!!obras.data?.length && (
              <ListaObras projects={obras.data} filtroResponsavel={false}
                caminhoEditar={(id) => `/empreiteiro/obras/editar/${id}`}
                caminhoDetalhes={(id) => `/empreiteiro/obras/${id}`} />
            )}
          </TabsContent>

          <TabsContent value="relatorios" className="mt-6 space-y-6">
            {obras.isLoading && <Loader2 className="h-6 w-6 animate-spin text-[#C9A961]" />}
            {obras.data && (
              <>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <Indicador Icone={TrendingUp} titulo="Seu lucro previsto" valor={reais(totais.lucro.centavos)}
                    nota={totais.lucro.pendentes ? `${totais.lucro.pendentes} obra(s) ainda sem dados para o cálculo` : "Somente a sua parte, em todas as obras"} destaque />
                  <Indicador Icone={Wallet} titulo="VGV total" valor={reais(totais.vgv.centavos)}
                    nota={totais.vgv.pendentes ? `${totais.vgv.pendentes} obra(s) sem VGV informado` : `${totais.quantidade} obra(s)`} />
                  <Indicador Icone={Landmark} titulo="A receber do banco" valor={reais(totais.receberBanco.centavos)}
                    nota={totais.receberBanco.pendentes ? `${totais.receberBanco.pendentes} obra(s) sem dados da CEF` : "Soma do saldo a receber da CEF por obra"} />
                </div>

                {totais.quantidade === 0 ? (
                  <p className="text-gray-400">Nenhuma obra vinculada a você no momento.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
                    <Card className="border-[#C9A961]/20 bg-[#1A2332]/60 xl:col-span-3 text-gray-100">
                      <CardHeader>
                        <CardTitle className="text-[#C9A961]">Por obra</CardTitle>
                        <CardDescription className="text-gray-400">VGV, valor a receber do banco e o seu lucro previsto em cada obra.</CardDescription>
                      </CardHeader>
                      <CardContent className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={totais.porObra} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff1a" />
                            <XAxis dataKey="nome" tick={{ fill: "#cbd5e1", fontSize: 11 }} interval={0} />
                            <YAxis tickFormatter={reaisCurto} tick={{ fill: "#cbd5e1", fontSize: 11 }} width={56} />
                            <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ background: "#1A2332", border: "1px solid #C9A96155", color: "#fff" }} />
                            <Legend wrapperStyle={{ color: "#cbd5e1", fontSize: 12 }} />
                            <Bar dataKey="vgv" name="VGV" fill="#4F9DDE" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="receberBanco" name="A receber do banco" fill="#5CC28F" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="lucro" name="Seu lucro previsto" fill="#C9A961" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                    <Card className="border-[#C9A961]/20 bg-[#1A2332]/60 xl:col-span-2 text-gray-100">
                      <CardHeader>
                        <CardTitle className="text-[#C9A961]">Seu lucro por obra</CardTitle>
                        <CardDescription className="text-gray-400">Participação de cada obra no seu lucro previsto.</CardDescription>
                      </CardHeader>
                      <CardContent className="h-80">
                        {totais.porObra.some((o) => o.lucro > 0) ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie data={totais.porObra.filter((o) => o.lucro > 0)} dataKey="lucro" nameKey="nome" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
                                {totais.porObra.filter((o) => o.lucro > 0).map((o, i) => <Cell key={o.id} fill={CORES[i % CORES.length]} />)}
                              </Pie>
                              <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ background: "#1A2332", border: "1px solid #C9A96155", color: "#fff" }} />
                              <Legend wrapperStyle={{ color: "#cbd5e1", fontSize: 12 }} />
                            </PieChart>
                          </ResponsiveContainer>
                        ) : (
                          <p className="text-sm text-gray-400">Ainda não há lucro previsto calculado nas suas obras.</p>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                )}
                <p className="text-xs text-gray-400">
                  Lucro previsto: estimativa sobre o lucro da operação após a participação dos investidores, com o seu percentual
                  definido pela empresa. A receber do banco: base contratual da CEF menos o que já foi recebido.
                </p>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function Indicador({ Icone, titulo, valor, nota, destaque = false }: {
  Icone: typeof TrendingUp; titulo: string; valor: string; nota: string; destaque?: boolean;
}) {
  return (
    <Card className={`border-[#C9A961]/20 bg-[#1A2332]/60 ${destaque ? "ring-1 ring-[#C9A961]/50" : ""}`}>
      <CardContent className="flex items-start gap-4 pt-6">
        <div className="rounded-lg bg-[#C9A961]/15 p-3"><Icone className="h-6 w-6 text-[#C9A961]" aria-hidden /></div>
        <div className="min-w-0">
          <p className="text-sm text-gray-400">{titulo}</p>
          <p className={`text-2xl font-bold ${destaque ? "text-[#F4D37D]" : "text-white"}`}>{valor}</p>
          <p className="mt-1 text-xs text-gray-400">{nota}</p>
        </div>
      </CardContent>
    </Card>
  );
}
