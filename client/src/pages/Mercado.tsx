import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import Navbar from "@/components/Navbar";
import SEO from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Search, MapPin, ExternalLink, CheckCircle2, Home, MessageCircle } from "lucide-react";

const FONTE_LABELS: Record<string, string> = {
  olx: "OLX",
  zapimoveis: "Zap Imóveis",
  vivareal: "Viva Real",
  facebook: "Facebook",
  instagram: "Instagram",
  google: "Google",
  direto: "Direto",
  outro: "Outro",
};

const DOC_LABELS: Record<string, string> = {
  nenhum: "Não informado",
  escritura: "Escritura",
  contrato_gaveta: "Contrato de Gaveta",
  inventario: "Inventário",
  heranca: "Herança",
  financiado: "Financiado",
  loteamento: "Loteamento",
  posse: "Posse",
  outros: "Outros",
};

function firstFoto(imagens?: string | null): string | undefined {
  if (!imagens) return undefined;
  try {
    const arr = JSON.parse(imagens);
    return Array.isArray(arr) && arr.length > 0 ? arr[0] : undefined;
  } catch {
    return undefined;
  }
}

function formatCurrencyBR(value?: string | null): string | null {
  if (!value) return null;
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return null;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n);
}

export default function Mercado() {
  const [busca, setBusca] = useState("");
  const [fonte, setFonte] = useState("todas");
  const [tipo, setTipo] = useState("todos");

  const { data: listings, isLoading } = trpc.agregador.listPublic.useQuery();

  const tipos = useMemo(() => Array.from(new Set((listings ?? []).map((l) => l.tipo).filter(Boolean))), [listings]);
  const fontes = useMemo(() => Array.from(new Set((listings ?? []).map((l) => l.fonte))), [listings]);

  const filtrados = useMemo(() => {
    return (listings ?? []).filter((l) => {
      if (fonte !== "todas" && l.fonte !== fonte) return false;
      if (tipo !== "todos" && l.tipo !== tipo) return false;
      if (busca.trim()) {
        const q = busca.trim().toLowerCase();
        if (!`${l.titulo} ${l.bairro ?? ""} ${l.cidade}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [listings, busca, fonte, tipo]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
      <SEO
        title="Mercado de Imóveis"
        description="Todos os imóveis disponíveis em Imperatriz-MA reunidos de OLX, Zap, Facebook e anúncios diretos, verificados pela equipe Prospecta."
        keywords="mercado de imóveis, imóveis Imperatriz, anúncios verificados"
      />
      <Navbar />

      <main className="flex-1 py-12">
        <div className="container">
          <Link href="/" className="inline-flex items-center gap-2 text-gray-400 hover:text-[#C9A961] transition-colors mb-6">
            <ArrowLeft className="h-5 w-5" />
            <span>Voltar</span>
          </Link>

          <div className="max-w-5xl mx-auto space-y-8">
            <div className="text-center space-y-4">
              <p className="text-[#C9A961] font-bold text-xs tracking-widest uppercase">Imperatriz — MA</p>
              <h1 className="text-4xl md:text-5xl font-bold text-[#C9A961]">Mercado de Imóveis</h1>
              <p className="text-xl text-gray-300 max-w-2xl mx-auto">
                Imóveis disponíveis na cidade — reunidos de diversas fontes e verificados pela equipe Prospecta.
              </p>
            </div>

            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
              <CardContent className="p-6 grid gap-4 md:grid-cols-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                  <Input placeholder="Buscar por título, bairro..." value={busca} onChange={(e) => setBusca(e.target.value)}
                    className="pl-9 bg-[#2C3E50] border-[#C9A961]/20 text-gray-200 placeholder:text-gray-500" />
                </div>
                <Select value={fonte} onValueChange={setFonte}>
                  <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-200">
                    <SelectValue placeholder="Fonte" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas as fontes</SelectItem>
                    {fontes.map((f) => <SelectItem key={f} value={f}>{FONTE_LABELS[f] ?? f}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={tipo} onValueChange={setTipo}>
                  <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-200">
                    <SelectValue placeholder="Tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os tipos</SelectItem>
                    {tipos.map((t) => <SelectItem key={t} value={t!}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {isLoading ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-64 w-full bg-[#2C3E50] rounded-lg" />)}
              </div>
            ) : filtrados.length === 0 ? (
              <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
                <CardContent className="py-16 text-center">
                  <Search className="h-16 w-16 text-[#C9A961]/40 mx-auto mb-4" />
                  <p className="text-gray-400">Nenhum imóvel verificado encontrado no momento.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filtrados.map((l) => {
                  const foto = firstFoto(l.imagens);
                  const preco = formatCurrencyBR(l.preco);
                  return (
                    <Card key={l.id} className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm overflow-hidden hover:border-[#C9A961]/60 transition-all">
                      <div className="relative h-40 bg-[#2C3E50]">
                        {foto ? (
                          <img src={foto} alt={l.titulo} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Home className="h-10 w-10 text-[#C9A961]/30" />
                          </div>
                        )}
                        <Badge className="absolute top-2 left-2 bg-[#2C3E50] text-[#C9A961] border border-[#C9A961]/30">
                          {FONTE_LABELS[l.fonte] ?? l.fonte}
                        </Badge>
                        <Badge className="absolute top-2 right-2 bg-[#00FF00]/20 text-[#00FF00] border border-[#00FF00]/40 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Verificado
                        </Badge>
                      </div>
                      <CardContent className="p-4 space-y-2">
                        <h3 className="font-bold text-white text-sm leading-snug line-clamp-2">{l.titulo}</h3>
                        <p className="flex items-center gap-1 text-xs text-gray-400">
                          <MapPin className="h-3 w-3" />
                          {[l.bairro, l.cidade].filter(Boolean).join(", ")}
                        </p>
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-[#00FF00] text-lg">{preco ?? l.precoTexto ?? "Consultar"}</span>
                          {l.areaM2 && <span className="text-xs text-gray-400">{l.areaM2}m²</span>}
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 bg-[#2C3E50] text-gray-400 rounded">
                            {DOC_LABELS[l.documentoTipo] ?? l.documentoTipo}
                          </span>
                          {l.urlFonte && (
                            <a href={l.urlFonte} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 text-xs text-gray-400 hover:text-[#C9A961] transition-colors">
                              <ExternalLink className="h-3 w-3" /> Ver anúncio
                            </a>
                          )}
                        </div>
                        {l.contatoTel && (
                          <a href={`https://wa.me/55${l.contatoTel.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer"
                            className="mt-2 flex items-center justify-center gap-2 w-full bg-[#25D366] hover:bg-[#20BA5C] text-white font-bold text-xs uppercase py-2 rounded transition-colors">
                            <MessageCircle className="h-3.5 w-3.5" /> Falar no WhatsApp
                          </a>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            <Card className="bg-[#0F1923] border-[#C9A961]/20 text-center">
              <CardContent className="p-8">
                <p className="text-[#C9A961] text-xs font-bold uppercase tracking-widest mb-2">Não encontrou o que procura?</p>
                <h2 className="text-white font-bold text-xl uppercase mb-4">Fale com a equipe Prospecta</h2>
                <a href="https://wa.me/5599981392210" target="_blank" rel="noopener noreferrer"
                  className="inline-block bg-[#C9A961] text-[#1A2332] font-bold text-xs uppercase px-6 py-2.5 rounded hover:opacity-90 transition-opacity">
                  WhatsApp — (99) 98139-2210
                </a>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
