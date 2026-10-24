import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Navbar from "@/components/Navbar";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatCurrency, formatUtef, getLoginUrl } from "@/const";
import {
  Settings,
  Plus,
  Ticket,
  ShoppingBag,
  AlertCircle,
  Users,
  CheckSquare,
  HardHat,
  UserCheck,
  FileCheck2,
  ClipboardCheck,
  Building2,
  Mountain,
  MessageCircle,
  Receipt,
  Landmark,
  Scale,
  Shield,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  parsePermissions,
  type AdminModule,
} from "../../../shared/admin-permissions";

/** As 15 opções do painel, na ordem do Painel Administrativo (pedido de 17/10/2026). */
const MODULOS_DO_PAINEL: {
  modulo: AdminModule;
  href: string;
  rotulo: string;
  Icone: typeof Users;
  cor: string;
  corIcone: string;
}[] = [
  { modulo: "crm", href: "/admin/crm", rotulo: "CRM / Pipeline", Icone: Users, cor: "border-blue-500/30 hover:bg-blue-500/10", corIcone: "text-blue-400" },
  { modulo: "obras", href: "/admin/obras", rotulo: "Obras", Icone: HardHat, cor: "border-orange-500/30 hover:bg-orange-500/10", corIcone: "text-orange-400" },
  { modulo: "agenda", href: "/admin/tarefas-agenda", rotulo: "Tarefas e Agenda", Icone: CheckSquare, cor: "border-purple-500/30 hover:bg-purple-500/10", corIcone: "text-purple-400" },
  { modulo: "corretores", href: "/admin/corretores", rotulo: "Corretores", Icone: UserCheck, cor: "border-pink-500/30 hover:bg-pink-500/10", corIcone: "text-pink-400" },
  { modulo: "regularizacao", href: "/admin/regularizacoes", rotulo: "Regularizações", Icone: FileCheck2, cor: "border-teal-500/30 hover:bg-teal-500/10", corIcone: "text-teal-400" },
  { modulo: "comissoes", href: "/admin/comissoes", rotulo: "Comissões", Icone: CheckSquare, cor: "border-[#C9A961]/30", corIcone: "text-[#C9A961]" },
  { modulo: "projetos", href: "/admin/projetos", rotulo: "Projetos", Icone: CheckSquare, cor: "border-[#C9A961]/30", corIcone: "text-[#C9A961]" },
  { modulo: "mapa", href: "/admin/mapa", rotulo: "Mapa operacional", Icone: CheckSquare, cor: "border-[#C9A961]/30", corIcone: "text-[#C9A961]" },
  { modulo: "avaliacoes", href: "/admin/avaliacoes", rotulo: "Avaliações", Icone: ClipboardCheck, cor: "border-cyan-500/30 hover:bg-cyan-500/10", corIcone: "text-cyan-400" },
  { modulo: "imoveis", href: "/admin/imoveis", rotulo: "Imóveis", Icone: Building2, cor: "border-amber-500/30 hover:bg-amber-500/10", corIcone: "text-amber-400" },
  { modulo: "incorporacao", href: "/admin/incorporacao", rotulo: "Incorporação", Icone: Mountain, cor: "border-orange-500/30 hover:bg-orange-500/10", corIcone: "text-orange-400" },
  { modulo: "whatsapp", href: "/admin/whatsapp", rotulo: "WhatsApp", Icone: MessageCircle, cor: "border-green-500/30 hover:bg-green-500/10", corIcone: "text-green-400" },
  { modulo: "bpo", href: "/admin/bpo", rotulo: "BPO Financeiro", Icone: Receipt, cor: "border-[#C9A961]/30 hover:bg-[#C9A961]/10", corIcone: "text-[#C9A961]" },
  { modulo: "financiamentos", href: "/admin/financiamentos", rotulo: "Financiamentos", Icone: Landmark, cor: "border-blue-500/30 hover:bg-blue-500/10", corIcone: "text-blue-400" },
  { modulo: "juridico", href: "/admin/juridico", rotulo: "Jurídico", Icone: Scale, cor: "border-purple-500/30 hover:bg-purple-500/10", corIcone: "text-purple-400" },
];

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
  });
  const [productImage, setProductImage] = useState<File | null>(null);
  const [productImagePreview, setProductImagePreview] = useState("");

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
    onError: error => {
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
      });
    },
    onError: error => {
      toast.error(error.message || "Erro ao criar produto");
    },
  });
  const uploadProductImageMutation = trpc.products.uploadImage.useMutation();

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

  const ehAdmin = user?.role === "admin";
  const permissoes = ehAdmin ? null : parsePermissions(user?.permissions);
  const liberado = (m: AdminModule) => ehAdmin || !!permissoes?.includes(m);
  const modulosVisiveis = MODULOS_DO_PAINEL.filter(item => liberado(item.modulo));
  const podeSorteios = liberado("sorteios");

  // Pedido de 17/10/2026: o colaborador ativo usa o mesmo Painel Administrativo,
  // só com os módulos que o admin liberou para ele.
  if (!isAuthenticated || !(ehAdmin || (user?.role === "colaborador" && user?.active !== false))) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 py-12">
          <div className="container max-w-4xl">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Acesso negado. Apenas a equipe administrativa pode acessar esta página.
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

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let imageUrl: string | undefined;
      if (productImage) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () =>
            reject(new Error("Não foi possível ler a imagem"));
          reader.readAsDataURL(productImage);
        });
        const uploaded = await uploadProductImageMutation.mutateAsync({
          fileName: productImage.name,
          mimeType: productImage.type as
            | "image/jpeg"
            | "image/png"
            | "image/webp"
            | "image/heic"
            | "image/heif",
          base64,
        });
        imageUrl = uploaded.url;
      }
      await createProductMutation.mutateAsync({
        category: productForm.category,
        title: productForm.title,
        description: productForm.description,
        priceUtef: parseInt(productForm.priceUtef),
        imageUrl,
      });
      if (productImagePreview) URL.revokeObjectURL(productImagePreview);
      setProductImage(null);
      setProductImagePreview("");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Erro ao enviar imagem do produto"
      );
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 py-12">
        <div className="container max-w-4xl space-y-6">
          <div className="flex items-center gap-3">
            <Settings className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-3xl font-bold text-white">Painel Administrativo</h1>
              <p className="text-gray-300">
                {podeSorteios
                  ? "Gerencie sorteios e produtos do ecossistema"
                  : `Olá, ${user?.name ?? ""}. Estes são os seus módulos liberados.`}
              </p>
            </div>
          </div>

          {/* Links Rápidos — Prospecta */}
          <Card>
            <CardHeader>
              <CardTitle>
                Módulos Principais — VFX Capital / Prospecta
              </CardTitle>
              <CardDescription>Acesso rápido às operações</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {modulosVisiveis.map(item => (
                  <Link key={item.href} href={item.href}>
                    <Button
                      variant="outline"
                      className={`w-full h-20 flex flex-col gap-2 ${item.cor}`}
                    >
                      <item.Icone className={`h-5 w-5 ${item.corIcone}`} />
                      <span>{item.rotulo}</span>
                    </Button>
                  </Link>
                ))}
              </div>
              {modulosVisiveis.length === 0 && (
                <p className="text-sm text-gray-300">
                  Nenhum módulo liberado. Peça ao administrador para liberar o acesso.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Links Secundários — API Contas e Usuários e Acessos são só do admin */}
          {ehAdmin && (
          <Card>
            <CardHeader>
              <CardTitle>Outras Ferramentas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Link href="/admin/configuracoes-pagamento">
                  <Button
                    variant="outline"
                    className="w-full h-14 flex flex-col gap-1 text-sm"
                  >
                    <Settings className="h-4 w-4" />
                    <span>API Contas</span>
                  </Button>
                </Link>
                <Link href="/admin/configuracoes">
                  <Button
                    variant="outline"
                    className="w-full h-14 flex flex-col gap-1 text-sm"
                  >
                    <Shield className="h-4 w-4" />
                    <span>Usuários e Acessos</span>
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
          )}

          {podeSorteios && (
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
                        onChange={e =>
                          setDrawForm({ ...drawForm, title: e.target.value })
                        }
                        placeholder="Ex: Sorteio Efficaz 2025"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="draw-description">Descrição</Label>
                      <Textarea
                        id="draw-description"
                        value={drawForm.description}
                        onChange={e =>
                          setDrawForm({
                            ...drawForm,
                            description: e.target.value,
                          })
                        }
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
                          onChange={e =>
                            setDrawForm({
                              ...drawForm,
                              prizeAmount: e.target.value,
                            })
                          }
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="ticket-price">
                          Preço do Bilhete (centavos)
                        </Label>
                        <Input
                          id="ticket-price"
                          type="number"
                          value={drawForm.ticketPrice}
                          onChange={e =>
                            setDrawForm({
                              ...drawForm,
                              ticketPrice: e.target.value,
                            })
                          }
                          placeholder="200 = R$ 2,00"
                          required
                        />
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="target-amount">
                          Meta de Arrecadação (centavos)
                        </Label>
                        <Input
                          id="target-amount"
                          type="number"
                          value={drawForm.targetAmount}
                          onChange={e =>
                            setDrawForm({
                              ...drawForm,
                              targetAmount: e.target.value,
                            })
                          }
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="draw-date">Data do Sorteio</Label>
                        <Input
                          id="draw-date"
                          type="datetime-local"
                          value={drawForm.drawDate}
                          onChange={e =>
                            setDrawForm({
                              ...drawForm,
                              drawDate: e.target.value,
                            })
                          }
                        />
                      </div>
                    </div>

                    <Button
                      type="submit"
                      disabled={createDrawMutation.isPending}
                      className="w-full"
                    >
                      <Ticket className="h-4 w-4 mr-2" />
                      {createDrawMutation.isPending
                        ? "Criando..."
                        : "Criar Sorteio"}
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
                        onValueChange={(value: any) =>
                          setProductForm({ ...productForm, category: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="real_estate">
                            Construção Civil
                          </SelectItem>
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
                        onChange={e =>
                          setProductForm({
                            ...productForm,
                            title: e.target.value,
                          })
                        }
                        placeholder="Ex: Casa Térrea 53m²"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="product-description">Descrição</Label>
                      <Textarea
                        id="product-description"
                        value={productForm.description}
                        onChange={e =>
                          setProductForm({
                            ...productForm,
                            description: e.target.value,
                          })
                        }
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
                          onChange={e =>
                            setProductForm({
                              ...productForm,
                              priceUtef: e.target.value,
                            })
                          }
                          placeholder="Ex: 180000"
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="product-image">Imagem do produto</Label>
                        <Input
                          id="product-image"
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                          onChange={event => {
                            const file = event.target.files?.[0] ?? null;
                            if (file && file.size > 10 * 1024 * 1024) {
                              toast.error("A imagem deve ter no máximo 10 MB");
                              event.target.value = "";
                              return;
                            }
                            if (productImagePreview)
                              URL.revokeObjectURL(productImagePreview);
                            setProductImage(file);
                            setProductImagePreview(
                              file ? URL.createObjectURL(file) : ""
                            );
                          }}
                        />
                        <p className="text-xs text-gray-400">
                          Escolha pela câmera, biblioteca ou arquivos do
                          dispositivo. Máximo: 10 MB.
                        </p>
                      </div>
                    </div>

                    {productImagePreview && (
                      <div className="relative w-fit rounded-lg border p-2">
                        <img
                          src={productImagePreview}
                          alt="Prévia da imagem do produto"
                          className="h-32 max-w-full rounded object-cover"
                        />
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute -right-3 -top-3 h-7 w-7"
                          aria-label="Remover imagem selecionada"
                          onClick={() => {
                            URL.revokeObjectURL(productImagePreview);
                            setProductImage(null);
                            setProductImagePreview("");
                            const input = document.getElementById(
                              "product-image"
                            ) as HTMLInputElement | null;
                            if (input) input.value = "";
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    )}

                    <Button
                      type="submit"
                      disabled={
                        createProductMutation.isPending ||
                        uploadProductImageMutation.isPending
                      }
                      className="w-full"
                    >
                      {uploadProductImageMutation.isPending ? (
                        <Upload className="h-4 w-4 mr-2 animate-pulse" />
                      ) : (
                        <ShoppingBag className="h-4 w-4 mr-2" />
                      )}
                      {uploadProductImageMutation.isPending
                        ? "Enviando imagem..."
                        : createProductMutation.isPending
                          ? "Criando..."
                          : "Criar Produto"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
          )}
        </div>
      </main>
    </div>
  );
}
