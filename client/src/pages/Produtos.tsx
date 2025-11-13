import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import Navbar from "@/components/Navbar";
import { trpc } from "@/lib/trpc";
import { formatUtef, PRODUCT_CATEGORIES } from "@/const";
import { Building2, DollarSign, Anchor, ShoppingBag } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Produtos() {
  const [category, setCategory] = useState<"real_estate" | "financial" | "nautical" | undefined>(undefined);
  
  const { data: products, isLoading } = trpc.products.list.useQuery({ category });

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
    <div className="min-h-screen flex flex-col">
      <Navbar />
      
      <main className="flex-1 py-12">
        <div className="container">
          <div className="max-w-6xl mx-auto space-y-8">
            <div className="text-center space-y-4">
              <h1 className="text-4xl font-bold text-primary">Produtos do Ecossistema</h1>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Utilize seus UTEFs para adquirir produtos e serviços do Grupo Efficaz
              </p>
            </div>

            <Tabs defaultValue="all" className="w-full" onValueChange={(v) => setCategory(v === "all" ? undefined : v as any)}>
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="all">Todos</TabsTrigger>
                <TabsTrigger value="real_estate">Construção Civil</TabsTrigger>
                <TabsTrigger value="financial">Financeira</TabsTrigger>
                <TabsTrigger value="nautical">Náutico</TabsTrigger>
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
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-40 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!products || products.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <ShoppingBag className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-lg font-medium">Nenhum produto disponível</p>
          <p className="text-muted-foreground mt-2">
            Novos produtos serão adicionados em breve.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
      {products.map((product) => (
        <Card key={product.id} className="hover:shadow-lg transition-shadow flex flex-col">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                {getCategoryIcon(product.category)}
              </div>
              <Badge variant="secondary">
                {PRODUCT_CATEGORIES[product.category as keyof typeof PRODUCT_CATEGORIES]?.label}
              </Badge>
            </div>
            <CardTitle className="mt-4">{product.title}</CardTitle>
            <CardDescription>{product.description}</CardDescription>
          </CardHeader>
          
          <CardContent className="flex-1">
            {product.imageUrl && (
              <img 
                src={product.imageUrl} 
                alt={product.title}
                className="w-full h-48 object-cover rounded-lg mb-4"
              />
            )}
            {product.details && (
              <div className="text-sm text-muted-foreground">
                {JSON.parse(product.details).description || ""}
              </div>
            )}
          </CardContent>
          
          <CardFooter className="flex-col gap-2">
            <div className="w-full flex justify-between items-center p-3 bg-accent/10 rounded-lg">
              <span className="text-sm font-medium">Preço:</span>
              <span className="text-lg font-bold text-accent-foreground">
                {formatUtef(product.priceUtef)}
              </span>
            </div>
            <Button asChild className="w-full">
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
