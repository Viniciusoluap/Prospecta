import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Navbar from "@/components/Navbar";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatCurrency, formatUtef, getLoginUrl } from "@/const";
import { Settings, Plus, Ticket, ShoppingBag, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function Admin() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [drawForm, setDrawForm] = useState({
    title: "",
    description: "",
    prizeAmount: "200000",
    ticketPrice: "200",
    targetAmount: "200000000",
    drawDate: "",
  });

  const [productForm, setProductForm] = useState({
    category: "real_estate" as "real_estate" | "financial" | "nautical",
    title: "",
    description: "",
    priceUtef: "",
    imageUrl: "",
  });

  const createDrawMutation = trpc.draws.create.useMutation({
    onSuccess: () => {
      toast.success("Sorteio criado com sucesso!");
      setDrawForm({
        title: "",
        description: "",
        prizeAmount: "200000",
        ticketPrice: "200",
        targetAmount: "200000000",
        drawDate: "",
      });
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao criar sorteio");
    },
  });

  const createProductMutation = trpc.products.create.useMutation({
    onSuccess: () => {
      toast.success("Produto criado com sucesso!");
      setProductForm({
        category: "real_estate",
        title: "",
        description: "",
        priceUtef: "",
        imageUrl: "",
      });
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao criar produto");
    },
  });

  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 py-12">
          <div className="container max-w-4xl">
            <p>Carregando...</p>
          </div>
        </main>
      </div>
    );
  }

  if (!isAuthenticated || user?.role !== "admin") {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 py-12">
          <div className="container max-w-4xl">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Acesso negado. Apenas administradores podem acessar esta página.
              </AlertDescription>
            </Alert>
            {!isAuthenticated && (
              <Button asChild className="mt-4">
                <a href={getLoginUrl()}>Fazer Login</a>
              </Button>
            )}
          </div>
        </main>
      </div>
    );
  }

  const handleCreateDraw = (e: React.FormEvent) => {
    e.preventDefault();
    createDrawMutation.mutate({
      title: drawForm.title,
      description: drawForm.description,
      prizeAmount: parseInt(drawForm.prizeAmount),
      ticketPrice: parseInt(drawForm.ticketPrice),
      targetAmount: parseInt(drawForm.targetAmount),
      drawDate: drawForm.drawDate ? new Date(drawForm.drawDate) : undefined,
    });
  };

  const handleCreateProduct = (e: React.FormEvent) => {
    e.preventDefault();
    createProductMutation.mutate({
      category: productForm.category,
      title: productForm.title,
      description: productForm.description,
      priceUtef: parseInt(productForm.priceUtef),
      imageUrl: productForm.imageUrl || undefined,
    });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      
      <main className="flex-1 py-12">
        <div className="container max-w-4xl space-y-6">
          <div className="flex items-center gap-3">
            <Settings className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-3xl font-bold">Painel Administrativo</h1>
              <p className="text-muted-foreground">Gerencie sorteios e produtos do ecossistema</p>
            </div>
          </div>

          {/* Links Rápidos */}
          <Card>
            <CardHeader>
              <CardTitle>Links Rápidos</CardTitle>
              <CardDescription>Acesso rápido às principais funcionalidades administrativas</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Link href="/admin/dashboard">
                  <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                    <Settings className="h-5 w-5" />
                    <span>Dashboard Analytics</span>
                  </Button>
                </Link>
                <Link href="/admin/obras">
                  <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                    <Settings className="h-5 w-5" />
                    <span>Gerenciar Obras</span>
                  </Button>
                </Link>
                <Link href="/admin/orcamentos">
                  <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                    <Settings className="h-5 w-5" />
                    <span>Gerenciar Orçamentos</span>
                  </Button>
                </Link>
                <Link href="/admin/emails">
                  <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                    <Settings className="h-5 w-5" />
                    <span>Gerenciar Emails</span>
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="draws" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="draws">Sorteios</TabsTrigger>
              <TabsTrigger value="products">Produtos</TabsTrigger>
            </TabsList>

            {/* Gestão de Sorteios */}
            <TabsContent value="draws" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Plus className="h-5 w-5" />
                    Criar Novo Sorteio
                  </CardTitle>
                  <CardDescription>
                    Preencha os dados para criar um novo sorteio
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleCreateDraw} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="draw-title">Título do Sorteio</Label>
                      <Input
                        id="draw-title"
                        value={drawForm.title}
                        onChange={(e) => setDrawForm({ ...drawForm, title: e.target.value })}
                        placeholder="Ex: Sorteio Efficaz 2025"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="draw-description">Descrição</Label>
                      <Textarea
                        id="draw-description"
                        value={drawForm.description}
                        onChange={(e) => setDrawForm({ ...drawForm, description: e.target.value })}
                        placeholder="Descreva o sorteio..."
                        rows={3}
                      />
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="prize-amount">Prêmio (UTEFs)</Label>
                        <Input
                          id="prize-amount"
                          type="number"
                          value={drawForm.prizeAmount}
                          onChange={(e) => setDrawForm({ ...drawForm, prizeAmount: e.target.value })}
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="ticket-price">Preço do Bilhete (centavos)</Label>
                        <Input
                          id="ticket-price"
                          type="number"
                          value={drawForm.ticketPrice}
                          onChange={(e) => setDrawForm({ ...drawForm, ticketPrice: e.target.value })}
                          placeholder="200 = R$ 2,00"
                          required
                        />
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="target-amount">Meta de Arrecadação (centavos)</Label>
                        <Input
                          id="target-amount"
                          type="number"
                          value={drawForm.targetAmount}
                          onChange={(e) => setDrawForm({ ...drawForm, targetAmount: e.target.value })}
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="draw-date">Data do Sorteio</Label>
                        <Input
                          id="draw-date"
                          type="datetime-local"
                          value={drawForm.drawDate}
                          onChange={(e) => setDrawForm({ ...drawForm, drawDate: e.target.value })}
                        />
                      </div>
                    </div>

                    <Button type="submit" disabled={createDrawMutation.isPending} className="w-full">
                      <Ticket className="h-4 w-4 mr-2" />
                      {createDrawMutation.isPending ? "Criando..." : "Criar Sorteio"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Gestão de Produtos */}
            <TabsContent value="products" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Plus className="h-5 w-5" />
                    Criar Novo Produto
                  </CardTitle>
                  <CardDescription>
                    Adicione produtos ao ecossistema Efficaz
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleCreateProduct} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="product-category">Categoria</Label>
                      <Select
                        value={productForm.category}
                        onValueChange={(value: any) => setProductForm({ ...productForm, category: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="real_estate">Construção Civil</SelectItem>
                          <SelectItem value="financial">Financeira</SelectItem>
                          <SelectItem value="nautical">Náutico</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="product-title">Título do Produto</Label>
                      <Input
                        id="product-title"
                        value={productForm.title}
                        onChange={(e) => setProductForm({ ...productForm, title: e.target.value })}
                        placeholder="Ex: Casa Térrea 53m²"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="product-description">Descrição</Label>
                      <Textarea
                        id="product-description"
                        value={productForm.description}
                        onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                        placeholder="Descreva o produto..."
                        rows={3}
                      />
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="product-price">Preço (UTEFs)</Label>
                        <Input
                          id="product-price"
                          type="number"
                          value={productForm.priceUtef}
                          onChange={(e) => setProductForm({ ...productForm, priceUtef: e.target.value })}
                          placeholder="Ex: 180000"
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="product-image">URL da Imagem</Label>
                        <Input
                          id="product-image"
                          value={productForm.imageUrl}
                          onChange={(e) => setProductForm({ ...productForm, imageUrl: e.target.value })}
                          placeholder="https://..."
                        />
                      </div>
                    </div>

                    <Button type="submit" disabled={createProductMutation.isPending} className="w-full">
                      <ShoppingBag className="h-4 w-4 mr-2" />
                      {createProductMutation.isPending ? "Criando..." : "Criar Produto"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
