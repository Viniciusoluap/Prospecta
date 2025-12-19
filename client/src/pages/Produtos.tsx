import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import Navbar from "@/components/Navbar";
import SEO from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import { formatUtef, PRODUCT_CATEGORIES } from "@/const";
import { Building2, DollarSign, Anchor, ShoppingBag } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Produtos() {
  const [category, setCategory] = useState<"real_estate" | "financial" | "nautical" | undefined>(undefined);
  
  const { data: products, isLoading } = trpc.products.list.useQuery({ category });

  const seoContent = (
    <SEO 
      title="Produtos"
      description="Converta seus UTEFs em produtos exclusivos: imóveis, serviços financeiros e embarcações. Descubra oportunidades únicas no Ecossistema Efficaz."
      keywords="produtos, imóveis, serviços financeiros, embarcações, UTEFs, conversão, Ecossistema Efficaz"
    />
  );

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case "real_estate":
        return <Building2 className="h-5 w-5" />;
      case "financial":
        return <DollarSign className="h-5 w-5" />;
      case "nautical":
        return <Anchor className="h-5 w-5" />;
      default:
        return <ShoppingBag className="h-5 w-5" />;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
      {seoContent}
      <Navbar />
      
      <main className="flex-1 py-12">
        <div className="container">
          <div className="max-w-6xl mx-auto space-y-8">
            {/* Header */}
            <div className="text-center space-y-4">
              <h1 className="text-5xl font-bold text-[#C9A961]">Produtos do Ecossistema</h1>
              <p className="text-xl text-gray-300 max-w-3xl mx-auto">
                Utilize seus <span className="text-[#00FF00] font-semibold">UTEFs</span> para adquirir produtos e serviços do Grupo Efficaz
              </p>
            </div>

            <Tabs defaultValue="all" className="w-full" onValueChange={(v) => setCategory(v === "all" ? undefined : v as any)}>
              <TabsList className="grid w-full grid-cols-4 bg-[#1A2332]/60 border border-[#C9A961]/20 p-1">
                <TabsTrigger 
                  value="all"
                  className="data-[state=active]:bg-[#C9A961] data-[state=active]:text-[#1A2332] text-gray-300"
                >
                  Todos
                </TabsTrigger>
                <TabsTrigger 
                  value="real_estate"
                  className="data-[state=active]:bg-[#C9A961] data-[state=active]:text-[#1A2332] text-gray-300"
                >
                  Construção Civil
                </TabsTrigger>
                <TabsTrigger 
                  value="financial"
                  className="data-[state=active]:bg-[#C9A961] data-[state=active]:text-[#1A2332] text-gray-300"
                >
                  Financeira
                </TabsTrigger>
                <TabsTrigger 
                  value="nautical"
                  className="data-[state=active]:bg-[#C9A961] data-[state=active]:text-[#1A2332] text-gray-300"
                >
                  Náutico
                </TabsTrigger>
              </TabsList>

              <TabsContent value="all" className="mt-8">
                <ProductGrid products={products} isLoading={isLoading} getCategoryIcon={getCategoryIcon} />
              </TabsContent>
              
              <TabsContent value="real_estate" className="mt-8">
                <ProductGrid products={products} isLoading={isLoading} getCategoryIcon={getCategoryIcon} />
              </TabsContent>
              
              <TabsContent value="financial" className="mt-8">
                <ProductGrid products={products} isLoading={isLoading} getCategoryIcon={getCategoryIcon} />
              </TabsContent>
              
              <TabsContent value="nautical" className="mt-8">
                <ProductGrid products={products} isLoading={isLoading} getCategoryIcon={getCategoryIcon} />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </main>
    </div>
  );
}

function ProductGrid({ 
  products, 
  isLoading, 
  getCategoryIcon 
}: { 
  products: any[] | undefined; 
  isLoading: boolean;
  getCategoryIcon: (cat: string) => React.ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Card key={i} className="bg-[#1A2332]/60 border-[#C9A961]/20">
            <CardHeader>
              <Skeleton className="h-6 w-3/4 bg-[#2C3E50]" />
              <Skeleton className="h-4 w-1/2 bg-[#2C3E50]" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-40 w-full bg-[#2C3E50]" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!products || products.length === 0) {
    return (
      <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
        <CardContent className="py-16 text-center">
          <ShoppingBag className="h-20 w-20 text-[#C9A961]/50 mx-auto mb-6" />
          <p className="text-2xl font-bold text-[#C9A961] mb-3">Nenhum produto disponível</p>
          <p className="text-gray-400 text-lg">
            Novos produtos serão adicionados em breve.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
      {products.map((product) => (
        <Card 
          key={product.id} 
          className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm hover:border-[#C9A961]/60 transition-all hover:shadow-xl hover:shadow-[#C9A961]/10 flex flex-col"
        >
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="w-14 h-14 rounded-full bg-[#C9A961]/20 flex items-center justify-center">
                <span className="text-[#C9A961]">
                  {getCategoryIcon(product.category)}
                </span>
              </div>
              <Badge className="bg-[#2C3E50] text-[#C9A961] border border-[#C9A961]/30 hover:bg-[#2C3E50]">
                {PRODUCT_CATEGORIES[product.category as keyof typeof PRODUCT_CATEGORIES]?.label}
              </Badge>
            </div>
            <CardTitle className="mt-4 text-[#C9A961] text-xl">{product.title}</CardTitle>
            <CardDescription className="text-gray-400">{product.description}</CardDescription>
          </CardHeader>
          
          <CardContent className="flex-1">
            {product.imageUrl && (
              <img 
                src={product.imageUrl} 
                alt={product.title}
                className="w-full h-48 object-cover rounded-lg mb-4 border border-[#C9A961]/20"
              />
            )}
            {product.details && (
              <div className="text-sm text-gray-400">
                {JSON.parse(product.details).description || ""}
              </div>
            )}
          </CardContent>
          
          <CardFooter className="flex-col gap-3">
            <div className="w-full flex justify-between items-center p-4 bg-[#2C3E50] rounded-lg border border-[#C9A961]/20">
              <span className="text-sm font-medium text-gray-400">Preço:</span>
              <span className="text-xl font-bold text-[#00FF00]">
                {formatUtef(product.priceUtef)}
              </span>
            </div>
            <Button asChild className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
              <Link href={`/converter-produto/${product.id}`}>
                Converter UTEFs
              </Link>
            </Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
