import { useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Building2,
  Camera,
  DollarSign,
  Home,
  LogOut,
  Plus,
  Upload,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const money = (value: string | number) =>
  Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fileBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export default function BrokerPortal() {
  const [path] = useLocation();
  const { user, logout } = useAuth();
  const utils = trpc.useUtils();
  const properties = trpc.brokerPortal.properties.useQuery(undefined, {
    enabled: path.includes("imoveis") || path === "/corretor",
  });
  const commissions = trpc.brokerPortal.commissions.useQuery(undefined, {
    enabled: path.includes("comissoes") || path === "/corretor",
  });
  const [creating, setCreating] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = trpc.brokerPortal.uploadPropertyImage.useMutation();
  const create = trpc.brokerPortal.createProperty.useMutation({
    onSuccess: async () => {
      toast.success("Imóvel enviado para revisão");
      setCreating(false);
      setImages([]);
      await utils.brokerPortal.properties.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  async function uploadImages(files: FileList | null) {
    if (!files) return;
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        if (
          !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
          file.size > 8 * 1024 * 1024
        ) {
          throw new Error("Use JPG, PNG ou WebP de até 8 MiB");
        }
        const result = await upload.mutateAsync({
          fileName: file.name,
          mimeType: file.type as "image/jpeg" | "image/png" | "image/webp",
          base64: await fileBase64(file),
        });
        urls.push(result.url);
      }
      setImages(current => [...current, ...urls].slice(0, 20));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao enviar imagem"
      );
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const optionalNumber = (name: string) =>
      data.get(name) ? Number(data.get(name)) : undefined;
    create.mutate({
      titulo: String(data.get("titulo") || ""),
      descricao: String(data.get("descricao") || "") || undefined,
      tipo: String(data.get("tipo") || ""),
      preco: Number(data.get("preco")),
      quartos: optionalNumber("quartos"),
      banheiros: optionalNumber("banheiros"),
      vagas: optionalNumber("vagas"),
      areaM2: optionalNumber("areaM2"),
      endereco: String(data.get("endereco") || "") || undefined,
      bairro: String(data.get("bairro") || "") || undefined,
      cidade: String(data.get("cidade") || ""),
      estado: String(data.get("estado") || "") || undefined,
      fotos: images,
    });
  }

  const nav = [
    ["/corretor", "Início", Home],
    ["/corretor/imoveis", "Imóveis", Building2],
    ["/corretor/comissoes", "Minhas Comissões", DollarSign],
  ] as const;

  return (
    <div className="min-h-screen bg-slate-100 text-[#1A2332]">
      <header className="border-b-4 border-[#C9A961] bg-[#1A2332] text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div>
            <div className="text-xl font-black text-[#C9A961]">PROSPECTA</div>
            <div className="text-xs text-slate-400">
              Portal do Corretor · {user?.name}
            </div>
          </div>
          <Button
            variant="ghost"
            className="text-white"
            onClick={() =>
              logout().then(() =>
                window.location.assign("/login?perfil=corretor")
              )
            }
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sair
          </Button>
        </div>
      </header>
      <nav className="overflow-x-auto border-b bg-white">
        <div className="mx-auto flex max-w-6xl min-w-max px-4">
          {nav.map(([href, label, Icon]) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold ${path === href ? "border-[#C9A961]" : "border-transparent text-slate-500"}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </div>
      </nav>
      <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
        {path === "/corretor" && (
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Imóveis disponíveis</CardTitle>
              </CardHeader>
              <CardContent className="text-4xl font-black text-[#C9A961]">
                {properties.data?.length ?? 0}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Minhas comissões</CardTitle>
              </CardHeader>
              <CardContent className="text-4xl font-black text-[#C9A961]">
                {commissions.data?.length ?? 0}
              </CardContent>
            </Card>
          </div>
        )}
        {path.includes("imoveis") && (
          <>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-black">Imóveis</h1>
                <p className="text-slate-500">
                  Consulte o catálogo e envie novos imóveis para revisão.
                </p>
              </div>
              <Button onClick={() => setCreating(value => !value)}>
                <Plus className="mr-2 h-4 w-4" />
                Novo imóvel
              </Button>
            </div>
            {creating && (
              <Card>
                <CardHeader>
                  <CardTitle>Cadastrar imóvel</CardTitle>
                </CardHeader>
                <CardContent>
                  <form className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
                    <Field name="titulo" label="Título" required />
                    <Field name="tipo" label="Tipo" required />
                    <Field name="preco" label="Preço" type="number" required />
                    <Field name="areaM2" label="Área (m²)" type="number" />
                    <Field name="quartos" label="Quartos" type="number" />
                    <Field name="banheiros" label="Banheiros" type="number" />
                    <Field name="vagas" label="Vagas" type="number" />
                    <Field name="cidade" label="Cidade" required />
                    <Field name="estado" label="UF" maxLength={2} />
                    <Field name="bairro" label="Bairro" />
                    <div className="md:col-span-2">
                      <Field name="endereco" label="Endereço" />
                    </div>
                    <div className="md:col-span-2">
                      <Label>Descrição</Label>
                      <Textarea name="descricao" />
                    </div>
                    <div className="md:col-span-2">
                      <input
                        ref={fileRef}
                        hidden
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,image/webp"
                        capture="environment"
                        onChange={event => uploadImages(event.target.files)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => fileRef.current?.click()}
                        disabled={upload.isPending}
                      >
                        <Camera className="mr-2 h-4 w-4" />
                        Câmera, biblioteca ou arquivo
                      </Button>
                      <span className="ml-3 text-sm text-slate-500">
                        {images.length} imagem(ns)
                      </span>
                    </div>
                    <Button
                      className="md:col-span-2"
                      disabled={create.isPending || upload.isPending}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      Enviar para revisão
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {properties.data?.map(property => (
                <Card key={property.id}>
                  <CardHeader>
                    <div className="flex justify-between gap-2">
                      <CardTitle className="text-lg">
                        {property.titulo}
                      </CardTitle>
                      {property.createdByMe && (
                        <Badge variant="outline">Meu cadastro</Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="font-bold text-[#C9A961]">
                      {money(property.preco)}
                    </p>
                    <p className="text-sm text-slate-500">
                      {property.bairro ? `${property.bairro}, ` : ""}
                      {property.cidade}/{property.estado}
                    </p>
                    {property.createdByMe && (
                      <p className="mt-2 text-xs">
                        Revisão:{" "}
                        {property.reviewStatus === "pending"
                          ? "Pendente"
                          : property.reviewStatus === "rejected"
                            ? "Reprovado"
                            : "Aprovado"}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
        {path.includes("comissoes") && (
          <>
            <div>
              <h1 className="text-2xl font-black">Minhas Comissões</h1>
              <p className="text-slate-500">
                Somente comissões vinculadas ao seu cadastro.
              </p>
            </div>
            <div className="space-y-3">
              {commissions.data?.map(item => (
                <Card key={item.id}>
                  <CardContent className="grid gap-3 p-4 md:grid-cols-4">
                    <div>
                      <p className="text-xs text-slate-500">Imóvel</p>
                      <p className="font-semibold">{item.property}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Valor</p>
                      <p className="font-semibold">{money(item.amount)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Vencimento</p>
                      <p>
                        {new Date(item.dueDate).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Status</p>
                      <Badge>{item.status}</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {commissions.data?.length === 0 && (
                <Card>
                  <CardContent className="p-10 text-center text-slate-500">
                    Nenhuma comissão vinculada ao seu cadastro.
                  </CardContent>
                </Card>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Field({
  label,
  ...props
}: React.ComponentProps<typeof Input> & { label: string }) {
  return (
    <div>
      <Label htmlFor={String(props.name)}>{label}</Label>
      <Input id={String(props.name)} {...props} />
    </div>
  );
}
