import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import Navbar from "@/components/Navbar";
import SEO from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Bed, Bath, Car, Ruler, MapPin, Search, Building2 } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

type Imovel = inferRouterOutputs<AppRouter>["imoveis"]["list"][number];

const STATUS_LABELS: Record<string, string> = {
  disponivel: "Disponível",
  reservado: "Reservado",
  vendido: "Vendido",
  alugado: "Alugado",
};

const STATUS_COLORS: Record<string, string> = {
  disponivel: "bg-[#00FF00]/20 text-[#00FF00] border border-[#00FF00]/40",
  reservado: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/40",
  vendido: "bg-red-500/20 text-red-400 border border-red-500/40",
  alugado: "bg-blue-500/20 text-blue-400 border border-blue-500/40",
};

function formatCurrencyBR(value: string | number): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(n)) return "Sob consulta";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n);
}

function firstFoto(fotos?: string | null): string | undefined {
  if (!fotos) return undefined;
  try {
    const arr = JSON.parse(fotos);
    return Array.isArray(arr) && arr.length > 0 ? arr[0] : undefined;
  } catch {
    return undefined;
  }
}

export default function Imoveis() {
  const [tipo, setTipo] = useState<string>("todos");
  const [busca, setBusca] = useState("");
  const [quartosMin, setQuartosMin] = useState<string>("qualquer");
  const [precoMax, setPrecoMax] = useState("");

  const { data: imoveis, isLoading } = trpc.imoveis.list.useQuery({
    tipo: tipo === "todos" ? undefined : tipo,
  });

  const tipos = useMemo(() => {
    const set = new Set((imoveis ?? []).map((i) => i.tipo));
    return Array.from(set);
  }, [imoveis]);

  const filtrados = useMemo(() => {
    return (imoveis ?? []).filter((i: Imovel) => {
      if (busca.trim()) {
        const termo = busca.trim().toLowerCase();
        const alvo = `${i.titulo} ${i.bairro ?? ""} ${i.cidade}`.toLowerCase();
        if (!alvo.includes(termo)) return false;
      }
      if (quartosMin !== "qualquer" && (i.quartos ?? 0) < Number(quartosMin)) return false;
      if (precoMax.trim() && Number.isFinite(Number(precoMax))) {
        const preco = parseFloat(i.preco);
        if (preco > Number(precoMax)) return false;
      }
      return true;
    });
  }, [imoveis, busca, quartosMin, precoMax]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
      <SEO
        title="Imóveis"
        description="Confira os imóveis disponíveis da Prospecta Empreendimentos em Imperatriz - MA."
        keywords="imóveis à venda, imóveis Imperatriz, apartamentos, casas, terrenos, Prospecta Empreendimentos"
      />
      <Navbar />

      <main className="flex-1 py-12">
        <div className="container">
          <Link href="/" className="inline-flex items-center gap-2 text-gray-400 hover:text-[#C9A961] transition-colors mb-6">
            <ArrowLeft className="h-5 w-5" />
            <span>Voltar</span>
          </Link>

          <div className="max-w-6xl mx-auto space-y-8">
            <div className="text-center space-y-4">
              <h1 className="text-5xl font-bold text-[#C9A961]">Imóveis</h1>
              <p className="text-xl text-gray-300 max-w-3xl mx-auto">
                Confira as oportunidades disponíveis
              </p>
            </div>

            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
              <CardContent className="p-6 grid gap-4 md:grid-cols-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                  <Input
                    placeholder="Buscar por título, bairro, cidade..."
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    className="pl-9 bg-[#2C3E50] border-[#C9A961]/20 text-gray-200 placeholder:text-gray-500"
                  />
                </div>
                <Select value={tipo} onValueChange={setTipo}>
                  <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-200">
                    <SelectValue placeholder="Tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os tipos</SelectItem>
                    {tipos.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={quartosMin} onValueChange={setQuartosMin}>
                  <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-200">
                    <SelectValue placeholder="Quartos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="qualquer">Quartos (qualquer)</SelectItem>
                    <SelectItem value="1">1+</SelectItem>
                    <SelectItem value="2">2+</SelectItem>
                    <SelectItem value="3">3+</SelectItem>
                    <SelectItem value="4">4+</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  placeholder="Preço máximo (R$)"
                  value={precoMax}
                  onChange={(e) => setPrecoMax(e.target.value)}
                  className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-200 placeholder:text-gray-500"
                />
              </CardContent>
            </Card>

            {isLoading ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <Card key={i} className="bg-[#1A2332]/60 border-[#C9A961]/20">
                    <Skeleton className="h-48 w-full bg-[#2C3E50] rounded-t-lg" />
                    <CardContent className="p-4 space-y-2">
                      <Skeleton className="h-5 w-3/4 bg-[#2C3E50]" />
                      <Skeleton className="h-4 w-1/2 bg-[#2C3E50]" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : filtrados.length === 0 ? (
              <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
                <CardContent className="py-16 text-center">
                  <Building2 className="h-20 w-20 text-[#C9A961]/50 mx-auto mb-6" />
                  <p className="text-2xl font-bold text-[#C9A961] mb-3">Nenhum imóvel encontrado</p>
                  <p className="text-gray-400 text-lg">
                    Ajuste os filtros ou volte em breve para novas oportunidades.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filtrados.map((imovel: Imovel) => {
                  const foto = firstFoto(imovel.fotos);
                  return (
                    <Link key={imovel.id} href={`/imoveis/${imovel.slug}`}>
                      <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm hover:border-[#C9A961]/60 transition-all hover:shadow-xl hover:shadow-[#C9A961]/10 overflow-hidden cursor-pointer h-full flex flex-col">
                        <div className="relative h-48 bg-[#2C3E50]">
                          {foto ? (
                            <img src={foto} alt={imovel.titulo} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Building2 className="h-12 w-12 text-[#C9A961]/30" />
                            </div>
                          )}
                          <Badge className={`absolute top-3 right-3 ${STATUS_COLORS[imovel.status] ?? ""}`}>
                            {STATUS_LABELS[imovel.status] ?? imovel.status}
                          </Badge>
                        </div>
                        <CardContent className="p-4 flex-1 flex flex-col gap-3">
                          <div>
                            <h3 className="text-lg font-bold text-[#C9A961] line-clamp-1">{imovel.titulo}</h3>
                            <p className="text-sm text-gray-400 flex items-center gap-1 mt-1">
                              <MapPin className="h-3.5 w-3.5" />
                              {[imovel.bairro, imovel.cidade].filter(Boolean).join(", ")}
                            </p>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-gray-400">
                            {imovel.quartos != null && (
                              <span className="flex items-center gap-1"><Bed className="h-4 w-4" />{imovel.quartos}</span>
                            )}
                            {imovel.banheiros != null && (
                              <span className="flex items-center gap-1"><Bath className="h-4 w-4" />{imovel.banheiros}</span>
                            )}
                            {imovel.vagas != null && (
                              <span className="flex items-center gap-1"><Car className="h-4 w-4" />{imovel.vagas}</span>
                            )}
                            {imovel.areaM2 && (
                              <span className="flex items-center gap-1"><Ruler className="h-4 w-4" />{imovel.areaM2}m²</span>
                            )}
                          </div>
                          <div className="mt-auto pt-2 border-t border-[#C9A961]/10">
                            <span className="text-xl font-bold text-[#00FF00]">{formatCurrencyBR(imovel.preco)}</span>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
