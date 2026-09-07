import { useMemo } from "react";
import { Link, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import Navbar from "@/components/Navbar";
import SEO from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Bed, Bath, Car as CarIcon, Ruler, MapPin, Building2, MessageCircle, Phone } from "lucide-react";

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

function parseFotos(fotos?: string | null): string[] {
  if (!fotos) return [];
  try {
    const arr = JSON.parse(fotos);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export default function ImovelDetalhes() {
  const { slug } = useParams<{ slug: string }>();
  const { data: imovel, isLoading } = trpc.imoveis.getBySlug.useQuery({ slug: slug ?? "" }, { enabled: !!slug });

  const fotos = useMemo(() => parseFotos(imovel?.fotos), [imovel?.fotos]);

  const whatsappHref = useMemo(() => {
    if (!imovel) return "https://wa.me/5599981392210";
    const msg = encodeURIComponent(`Olá! Tenho interesse no imóvel "${imovel.titulo}" (${window.location.href}).`);
    return `https://wa.me/5599981392210?text=${msg}`;
  }, [imovel]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
        <Navbar />
        <main className="container py-12 max-w-5xl mx-auto space-y-6">
          <Skeleton className="h-8 w-40 bg-[#2C3E50]" />
          <Skeleton className="h-96 w-full bg-[#2C3E50] rounded-lg" />
          <Skeleton className="h-32 w-full bg-[#2C3E50] rounded-lg" />
        </main>
      </div>
    );
  }

  if (!imovel) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
        <Navbar />
        <main className="container py-20 max-w-2xl mx-auto text-center">
          <Building2 className="h-20 w-20 text-[#C9A961]/50 mx-auto mb-6" />
          <p className="text-2xl font-bold text-[#C9A961] mb-3">Imóvel não encontrado</p>
          <Button asChild className="mt-4 bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
            <Link href="/imoveis">Ver todos os imóveis</Link>
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
      <SEO
        title={imovel.titulo}
        description={imovel.descricao ?? `${imovel.titulo} em ${imovel.cidade} - Prospecta Empreendimentos`}
        image={fotos[0]}
        type="product"
      />
      <Navbar />

      <main className="flex-1 py-12">
        <div className="container">
          <Link href="/imoveis" className="inline-flex items-center gap-2 text-gray-400 hover:text-[#C9A961] transition-colors mb-6">
            <ArrowLeft className="h-5 w-5" />
            <span>Voltar para imóveis</span>
          </Link>

          <div className="max-w-5xl mx-auto grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              {fotos.length > 0 ? (
                <Carousel className="w-full">
                  <CarouselContent>
                    {fotos.map((foto, idx) => (
                      <CarouselItem key={idx}>
                        <div className="h-96 w-full rounded-lg overflow-hidden border border-[#C9A961]/20">
                          <img src={foto} alt={`${imovel.titulo} - foto ${idx + 1}`} className="w-full h-full object-cover" />
                        </div>
                      </CarouselItem>
                    ))}
                  </CarouselContent>
                  {fotos.length > 1 && (
                    <>
                      <CarouselPrevious className="left-2" />
                      <CarouselNext className="right-2" />
                    </>
                  )}
                </Carousel>
              ) : (
                <div className="h-96 w-full rounded-lg border border-[#C9A961]/20 bg-[#2C3E50] flex items-center justify-center">
                  <Building2 className="h-16 w-16 text-[#C9A961]/30" />
                </div>
              )}

              <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <h1 className="text-3xl font-bold text-[#C9A961]">{imovel.titulo}</h1>
                      <p className="text-gray-400 flex items-center gap-1 mt-2">
                        <MapPin className="h-4 w-4" />
                        {[imovel.endereco, imovel.bairro, imovel.cidade, imovel.estado].filter(Boolean).join(", ")}
                      </p>
                    </div>
                    <Badge className={STATUS_COLORS[imovel.status] ?? ""}>
                      {STATUS_LABELS[imovel.status] ?? imovel.status}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4 border-y border-[#C9A961]/10">
                    {imovel.areaM2 && (
                      <div className="flex flex-col items-center gap-1 text-gray-300">
                        <Ruler className="h-5 w-5 text-[#C9A961]" />
                        <span className="text-sm">{imovel.areaM2} m²</span>
                      </div>
                    )}
                    {imovel.quartos != null && (
                      <div className="flex flex-col items-center gap-1 text-gray-300">
                        <Bed className="h-5 w-5 text-[#C9A961]" />
                        <span className="text-sm">{imovel.quartos} quartos</span>
                      </div>
                    )}
                    {imovel.banheiros != null && (
                      <div className="flex flex-col items-center gap-1 text-gray-300">
                        <Bath className="h-5 w-5 text-[#C9A961]" />
                        <span className="text-sm">{imovel.banheiros} banheiros</span>
                      </div>
                    )}
                    {imovel.vagas != null && (
                      <div className="flex flex-col items-center gap-1 text-gray-300">
                        <CarIcon className="h-5 w-5 text-[#C9A961]" />
                        <span className="text-sm">{imovel.vagas} vagas</span>
                      </div>
                    )}
                  </div>

                  {imovel.descricao && (
                    <div>
                      <h2 className="text-lg font-semibold text-[#C9A961] mb-2">Descrição</h2>
                      <p className="text-gray-300 whitespace-pre-line">{imovel.descricao}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {imovel.latitude && imovel.longitude && (
                <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm overflow-hidden">
                  <iframe
                    title="Localização"
                    className="w-full h-72 border-0"
                    loading="lazy"
                    src={`https://www.google.com/maps?q=${imovel.latitude},${imovel.longitude}&output=embed`}
                  />
                </Card>
              )}
            </div>

            <div className="space-y-6">
              <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm sticky top-24">
                <CardContent className="p-6 space-y-4">
                  <div>
                    <span className="text-sm text-gray-400">Valor</span>
                    <p className="text-3xl font-bold text-[#00FF00]">{formatCurrencyBR(imovel.preco)}</p>
                  </div>
                  <Button asChild className="w-full bg-[#25D366] hover:bg-[#20BA5C] text-white font-bold">
                    <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                      <MessageCircle className="mr-2 h-5 w-5" />
                      Falar no WhatsApp
                    </a>
                  </Button>
                  <Button asChild variant="outline" className="w-full border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10">
                    <a href="tel:+5599981392210">
                      <Phone className="mr-2 h-5 w-5" />
                      Ligar agora
                    </a>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
