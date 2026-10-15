import { useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Building2, Camera, DollarSign, Home, LogOut, Plus, Upload, CalendarDays, MessageCircle, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { LEAD_PIPELINE_STAGES } from "@shared/lead-pipeline";
import { BROKER_PROPERTY_TYPES, MAX_BROKER_PHOTOS } from "@shared/broker-portal";

const money = (value: string | number) =>
  Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const STATUS_OBRA: Record<string, string> = {
  dados_incompletos: "Dados incompletos",
  pendente: "Pendente",
  parcial: "Paga parcialmente",
  paga: "Paga",
};

/** Reduz a foto no aparelho (máx. 1200 px, JPEG) — mesmo padrão do cadastro do admin. */
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX_DIM = 1200;
      let { width, height } = img;
      if (width > MAX_DIM || height > MAX_DIM) {
        const escala = MAX_DIM / Math.max(width, height);
        width = Math.round(width * escala);
        height = Math.round(height * escala);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível ler esta imagem"));
    };
    img.src = url;
  });
}

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
  const obraCommissions = trpc.brokerPortal.obraCommissions.useQuery(undefined, {
    enabled: path.includes("comissoes") || path === "/corretor",
  });
  const myLeads = trpc.brokerPortal.leads.useQuery(undefined, {
    enabled: path === "/corretor",
  });
  const [creating, setCreating] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const create = trpc.brokerPortal.createProperty.useMutation({
    onSuccess: async () => {
      toast.success("Imóvel enviado para revisão");
      setCreating(false);
      setImages([]);
      await utils.brokerPortal.properties.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  async function addImages(files: FileList | null) {
    if (!files?.length) return;
    setProcessing(true);
    try {
      const imgs = Array.from(files).filter(f => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
      if (imgs.length === 0) throw new Error("Escolha arquivos de imagem");
      const livres = MAX_BROKER_PHOTOS - images.length;
      if (livres <= 0) throw new Error(`Máximo de ${MAX_BROKER_PHOTOS} fotos`);
      const novas = await Promise.all(imgs.slice(0, livres).map(compressImage));
      setImages(current => [...current, ...novas].slice(0, MAX_BROKER_PHOTOS));
      if (imgs.length > livres) toast.info(`Só cabem ${MAX_BROKER_PHOTOS} fotos por imóvel`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar a imagem");
    } finally {
      setProcessing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (!(Number(data.get("preco")) > 0)) {
      toast.error("Informe o preço do imóvel");
      return;
    }
    const optionalNumber = (name: string) =>
      data.get(name) ? Number(data.get(name)) : undefined;
    create.mutate({
      titulo: String(data.get("titulo") || ""),
      descricao: String(data.get("descricao") || "") || undefined,
      tipo: String(data.get("tipo") || ""),
      preco: Number(data.get("preco") || 0),
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
    // Item 06: Agenda e WhatsApp do corretor (só os próprios registros, no servidor).
    ["/admin/agenda", "Agenda", CalendarDays],
    ["/admin/whatsapp", "WhatsApp", MessageCircle],
  ] as const;

  return (
    <div className="min-h-screen bg-slate-100 text-[#1A2332]">
      <header className="border-b-4 border-[#C9A961] bg-[#1A2332] text-white">
        {/* Logo e nome no centro: à esquerda fica o botão "Voltar" fixo da página. */}
        <div className="mx-auto grid max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-4">
          <div />
          <div className="text-center">
            <div className="text-xl font-black text-[#C9A961]">PROSPECTA</div>
            <div className="text-xs text-slate-400">
              Portal do Corretor · {user?.name}
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              variant="ghost"
              className="text-white"
              onClick={() =>
                logout().then(() =>
                  window.location.assign("/login")
                )
              }
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sair
            </Button>
          </div>
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
                {(commissions.data?.length ?? 0) + (obraCommissions.data?.length ?? 0)}
              </CardContent>
            </Card>
            <BrokerLeads
              loading={myLeads.isLoading}
              leads={myLeads.data ?? []}
            />
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
                    <div>
                      <Label htmlFor="tipo">Tipo</Label>
                      <select
                        id="tipo"
                        name="tipo"
                        required
                        defaultValue=""
                        className="border-input bg-transparent h-9 w-full rounded-md border px-3 text-base shadow-xs md:text-sm"
                      >
                        <option value="" disabled>
                          Selecione...
                        </option>
                        {BROKER_PROPERTY_TYPES.map(t => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="preco">Preço</Label>
                      <CurrencyInput id="preco" name="preco" required placeholder="0,00" />
                    </div>
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
                    <div className="md:col-span-2 space-y-3">
                      {/* Sem "capture": o iPad/celular oferece câmera, fotos e arquivos. */}
                      <input
                        ref={fileRef}
                        hidden
                        type="file"
                        multiple
                        accept="image/*"
                        onChange={event => addImages(event.target.files)}
                      />
                      <div className="flex flex-wrap items-center gap-3">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => fileRef.current?.click()}
                          disabled={processing || images.length >= MAX_BROKER_PHOTOS}
                        >
                          <Camera className="mr-2 h-4 w-4" />
                          {processing ? "Carregando fotos..." : "Câmera, biblioteca ou arquivo"}
                        </Button>
                        <span className="text-sm text-slate-500">
                          {images.length}/{MAX_BROKER_PHOTOS} foto(s)
                        </span>
                      </div>
                      {images.length > 0 && (
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                          {images.map((src, i) => (
                            <div key={i} className="relative aspect-square overflow-hidden rounded-md border">
                              <img src={src} alt={`Foto ${i + 1}`} className="h-full w-full object-cover" />
                              <button
                                type="button"
                                aria-label={`Remover foto ${i + 1}`}
                                onClick={() => setImages(list => list.filter((_, j) => j !== i))}
                                className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button
                      className="md:col-span-2"
                      disabled={create.isPending || processing}
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
              {/* Pedido de 15/10: comissões das obras (VGV × %), as mesmas do painel do admin. */}
              {obraCommissions.data?.map(item => (
                <Card key={`obra-${item.obraId}`}>
                  <CardContent className="grid gap-3 p-4 md:grid-cols-5">
                    <div>
                      <p className="text-xs text-slate-500">Obra · cliente</p>
                      <p className="font-semibold">{item.obra}</p>
                      <p className="text-xs text-slate-500">{item.cliente}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">VGV · %</p>
                      <p>{item.vgv ? money(item.vgv) : "VGV não informado"}</p>
                      <p className="text-xs text-slate-500">
                        {item.percentual ? `${Number(item.percentual).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%` : "sem percentual"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Comissão</p>
                      <p className="font-semibold">{item.valorCentavos === null ? "—" : money(item.valorCentavos / 100)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Pago · saldo</p>
                      <p>{money(item.pagoCentavos / 100)}</p>
                      <p className="text-xs text-slate-500">saldo {item.saldoCentavos === null ? "—" : money(item.saldoCentavos / 100)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Situação</p>
                      <Badge>{STATUS_OBRA[item.status] ?? item.status}</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
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
              {commissions.data?.length === 0 && obraCommissions.data?.length === 0 && (
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

type BrokerLead = {
  id: number;
  name: string;
  city: string | null;
  stage: string;
  stageLabel: string;
  stageIndex: number;
  updatedAt: string | Date;
};

/** Acompanhamento das etapas do CRM — somente leitura, só os leads deste corretor. */
function BrokerLeads({ leads, loading }: { leads: BrokerLead[]; loading: boolean }) {
  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle>Acompanhamento dos meus clientes</CardTitle>
        <p className="text-sm text-slate-500">
          Etapa atual de cada cliente vinculado a você no CRM. Somente consulta.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && <p className="text-sm text-slate-500">Carregando...</p>}
        {!loading && leads.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-500">
            Nenhum cliente vinculado a você no momento.
          </p>
        )}
        {leads.map(lead => (
          <div key={lead.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="font-semibold">{lead.name}</p>
                {lead.city && <p className="text-xs text-slate-500">{lead.city}</p>}
              </div>
              <Badge className="bg-[#1A2332] text-white">{lead.stageLabel}</Badge>
            </div>
            <ol className="mt-3 grid grid-cols-7 gap-1" aria-label={`Etapas de ${lead.name}`}>
              {LEAD_PIPELINE_STAGES.map((stage, i) => {
                const atual = i === lead.stageIndex;
                const feito = lead.stageIndex >= 0 && i < lead.stageIndex;
                return (
                  <li key={stage.key} className="min-w-0" aria-current={atual ? "step" : undefined}>
                    <div className={`h-2 rounded-full ${atual ? "bg-[#C9A961]" : feito ? "bg-[#1A2332]" : "bg-slate-200"}`} />
                    <p className={`mt-1 hidden text-[10px] leading-tight md:block ${atual ? "font-bold text-[#1A2332]" : "text-slate-500"}`}>
                      {stage.label}
                    </p>
                  </li>
                );
              })}
            </ol>
            <p className="mt-2 text-xs text-slate-500">
              Atualizado em {new Date(lead.updatedAt).toLocaleDateString("pt-BR")}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
