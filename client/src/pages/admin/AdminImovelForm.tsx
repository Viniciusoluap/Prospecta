import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, ImagePlus, X, MapPin } from "lucide-react";

const TIPOS = ["casa", "apartamento", "lote", "terreno", "comercial", "chacara"];
const TIPO_LABELS: Record<string, string> = {
  casa: "Casa", apartamento: "Apartamento", lote: "Lote",
  terreno: "Terreno", comercial: "Comercial", chacara: "Chácara",
};
const STATUS_OPTIONS = [
  { value: "disponivel", label: "Disponível" },
  { value: "reservado", label: "Reservado" },
  { value: "vendido", label: "Vendido" },
  { value: "alugado", label: "Alugado" },
];
const MAX_FOTOS = 15;

function slugify(text: string): string {
  return text
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function compressImage(file: File): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX_DIM = 1200;
      let { width, height } = img;
      if (width > MAX_DIM || height > MAX_DIM) {
        if (width >= height) { height = Math.round((height * MAX_DIM) / width); width = MAX_DIM; }
        else { width = Math.round((width * MAX_DIM) / height); height = MAX_DIM; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.src = url;
  });
}

function parseMapsInput(input: string): { lat: number; lng: number } | null {
  const s = input.trim();
  const bare = s.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
  if (bare) {
    const lat = parseFloat(bare[1]);
    const lng = parseFloat(bare[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
  }
  const at = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (at) return { lat: parseFloat(at[1]), lng: parseFloat(at[2]) };
  const q = s.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (q) return { lat: parseFloat(q[1]), lng: parseFloat(q[2]) };
  return null;
}

interface FormState {
  titulo: string;
  slug: string;
  tipo: string;
  status: string;
  preco: string;
  areaM2: string;
  quartos: string;
  banheiros: string;
  vagas: string;
  endereco: string;
  bairro: string;
  cidade: string;
  estado: string;
  descricao: string;
  destaque: boolean;
  publicadoSite: boolean;
  publicadoZap: boolean;
  publicadoOlx: boolean;
  publicadoViva: boolean;
  publicadoChavesNaMao: boolean;
}

const EMPTY_FORM: FormState = {
  titulo: "", slug: "", tipo: "", status: "disponivel", preco: "", areaM2: "",
  quartos: "", banheiros: "", vagas: "", endereco: "", bairro: "", cidade: "",
  estado: "", descricao: "", destaque: false, publicadoSite: true,
  publicadoZap: false, publicadoOlx: false, publicadoViva: false, publicadoChavesNaMao: false,
};

export default function AdminImovelForm() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = !!id;
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const { data: imovel, isLoading } = trpc.imoveis.getById.useQuery(
    { id: Number(id) },
    { enabled: isEdit }
  );

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [slugTocado, setSlugTocado] = useState(false);
  const [fotos, setFotos] = useState<string[]>([]);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [pasteValue, setPasteValue] = useState("");
  const [parseError, setParseError] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    if (isEdit && imovel && !hydrated.current) {
      hydrated.current = true;
      setForm({
        titulo: imovel.titulo ?? "",
        slug: imovel.slug ?? "",
        tipo: imovel.tipo ?? "",
        status: imovel.status ?? "disponivel",
        preco: imovel.preco ?? "",
        areaM2: imovel.areaM2 ?? "",
        quartos: imovel.quartos?.toString() ?? "",
        banheiros: imovel.banheiros?.toString() ?? "",
        vagas: imovel.vagas?.toString() ?? "",
        endereco: imovel.endereco ?? "",
        bairro: imovel.bairro ?? "",
        cidade: imovel.cidade ?? "",
        estado: imovel.estado ?? "",
        descricao: imovel.descricao ?? "",
        destaque: !!imovel.destaque,
        publicadoSite: !!imovel.publicadoSite,
        publicadoZap: !!imovel.publicadoZap,
        publicadoOlx: !!imovel.publicadoOlx,
        publicadoViva: !!imovel.publicadoViva,
        publicadoChavesNaMao: !!imovel.publicadoChavesNaMao,
      });
      setSlugTocado(true);
      if (imovel.fotos) {
        try { setFotos(JSON.parse(imovel.fotos)); } catch { setFotos([]); }
      }
      if (imovel.latitude && imovel.longitude) {
        setCoords({ lat: parseFloat(imovel.latitude), lng: parseFloat(imovel.longitude) });
      }
    }
  }, [isEdit, imovel]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleTituloChange = (value: string) => {
    set("titulo", value);
    if (!slugTocado) set("slug", slugify(value));
  };

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"));
    const compressed = await Promise.all(imgs.slice(0, MAX_FOTOS - fotos.length).map(compressImage));
    setFotos((prev) => [...prev, ...compressed].slice(0, MAX_FOTOS));
  }, [fotos.length]);

  const removeFoto = (i: number) => setFotos((p) => p.filter((_, j) => j !== i));

  const handleApplyPaste = () => {
    const parsed = parseMapsInput(pasteValue);
    if (!parsed) { setParseError(true); return; }
    setParseError(false);
    setPasteValue("");
    setCoords(parsed);
  };

  const createMutation = trpc.imoveis.create.useMutation({
    onSuccess: () => {
      toast.success("Imóvel cadastrado!");
      utils.imoveis.list.invalidate();
      navigate("/admin/imoveis");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.imoveis.update.useMutation({
    onSuccess: () => {
      toast.success("Imóvel atualizado!");
      utils.imoveis.list.invalidate();
      navigate("/admin/imoveis");
    },
    onError: (e) => toast.error(e.message),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.titulo || !form.tipo || !form.cidade || !form.preco) {
      toast.error("Preencha os campos obrigatórios: título, tipo, cidade e preço.");
      return;
    }
    const payload = {
      titulo: form.titulo,
      descricao: form.descricao || undefined,
      tipo: form.tipo,
      status: form.status as "disponivel" | "reservado" | "vendido" | "alugado",
      preco: Number(form.preco),
      quartos: form.quartos ? Number(form.quartos) : undefined,
      banheiros: form.banheiros ? Number(form.banheiros) : undefined,
      vagas: form.vagas ? Number(form.vagas) : undefined,
      areaM2: form.areaM2 ? Number(form.areaM2) : undefined,
      endereco: form.endereco || undefined,
      bairro: form.bairro || undefined,
      cidade: form.cidade,
      estado: form.estado || undefined,
      latitude: coords?.lat,
      longitude: coords?.lng,
      fotos: JSON.stringify(fotos),
      destaque: form.destaque,
      publicadoSite: form.publicadoSite,
      publicadoZap: form.publicadoZap,
      publicadoOlx: form.publicadoOlx,
      publicadoViva: form.publicadoViva,
      publicadoChavesNaMao: form.publicadoChavesNaMao,
    };
    if (isEdit) {
      updateMutation.mutate({ id: Number(id), ...payload });
    } else {
      createMutation.mutate({ slug: form.slug || slugify(form.titulo), ...payload });
    }
  };

  if (isEdit && isLoading) {
    return (
      <div className="min-h-screen bg-[#1A2332] text-white flex items-center justify-center">
        <p className="text-gray-400">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <div className="bg-[#0F1923] border-b border-[#C9A961]/20 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <Link href="/admin/imoveis">
            <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold text-[#C9A961]">{isEdit ? "Editar Imóvel" : "Novo Imóvel"}</h1>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="space-y-3">
            <p className="text-xs font-bold text-[#C9A961]/80 uppercase tracking-widest">Dados Básicos</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Label className="text-gray-300">Título do Anúncio *</Label>
                <Input value={form.titulo} onChange={(e) => handleTituloChange(e.target.value)} required
                  placeholder="Ex.: Casa 3 Quartos — Centro"
                  className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-gray-300">Slug (URL)</Label>
                <Input value={form.slug} onChange={(e) => { setSlugTocado(true); set("slug", slugify(e.target.value)); }}
                  placeholder="casa-3-quartos-centro"
                  className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Tipo *</Label>
                <Select value={form.tipo} onValueChange={(v) => set("tipo", v)}>
                  <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS.map((t) => <SelectItem key={t} value={t}>{TIPO_LABELS[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-gray-300">Situação *</Label>
                <Select value={form.status} onValueChange={(v) => set("status", v)}>
                  <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-gray-300">Bairro</Label>
                <Input value={form.bairro} onChange={(e) => set("bairro", e.target.value)}
                  className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Cidade *</Label>
                <Input value={form.cidade} onChange={(e) => set("cidade", e.target.value)} required
                  className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Estado (UF)</Label>
                <Input value={form.estado} onChange={(e) => set("estado", e.target.value.toUpperCase().slice(0, 2))}
                  placeholder="MA" maxLength={2}
                  className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-gray-300">Endereço</Label>
                <Input value={form.endereco} onChange={(e) => set("endereco", e.target.value)}
                  className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <p className="text-xs font-bold text-[#C9A961]/80 uppercase tracking-widest">Valores</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-gray-300">Preço (R$) *</Label>
                <Input type="number" min={0} value={form.preco} onChange={(e) => set("preco", e.target.value)} required
                  className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Área (m²)</Label>
                <Input type="number" min={0} value={form.areaM2} onChange={(e) => set("areaM2", e.target.value)}
                  className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <p className="text-xs font-bold text-[#C9A961]/80 uppercase tracking-widest">Características</p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label className="text-gray-300">Quartos</Label>
                <Input type="number" min={0} value={form.quartos} onChange={(e) => set("quartos", e.target.value)}
                  className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1 text-center" />
              </div>
              <div>
                <Label className="text-gray-300">Banheiros</Label>
                <Input type="number" min={0} value={form.banheiros} onChange={(e) => set("banheiros", e.target.value)}
                  className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1 text-center" />
              </div>
              <div>
                <Label className="text-gray-300">Vagas</Label>
                <Input type="number" min={0} value={form.vagas} onChange={(e) => set("vagas", e.target.value)}
                  className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1 text-center" />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <p className="text-xs font-bold text-[#C9A961]/80 uppercase tracking-widest">Fotos</p>
            <div
              onClick={() => fotos.length < MAX_FOTOS && inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
              className={`border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 py-8 transition-colors ${
                fotos.length >= MAX_FOTOS ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
              } ${drag ? "border-[#C9A961] bg-[#C9A961]/10" : "border-[#C9A961]/30 bg-[#2C3E50]/40 hover:border-[#C9A961]/60"}`}
            >
              <ImagePlus className="h-7 w-7 text-gray-400" />
              <p className="text-sm text-gray-300 font-medium">Clique ou arraste as fotos aqui</p>
              <p className="text-xs text-gray-500">{fotos.length}/{MAX_FOTOS} fotos</p>
              <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
                onChange={(e) => e.target.files && addFiles(e.target.files)} />
            </div>
            {fotos.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {fotos.map((src, i) => (
                  <div key={i} className="relative group aspect-square bg-[#2C3E50] rounded overflow-hidden">
                    <img src={src} alt="" className="w-full h-full object-cover" />
                    {i === 0 && (
                      <span className="absolute top-1 left-1 bg-[#C9A961] text-[#1A2332] text-[9px] font-black px-1.5 py-0.5 uppercase leading-none rounded">
                        Capa
                      </span>
                    )}
                    <button type="button" onClick={(e) => { e.stopPropagation(); removeFoto(i); }}
                      className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <p className="text-xs font-bold text-[#C9A961]/80 uppercase tracking-widest">Localização Exata</p>
            <div className="flex gap-2">
              <Input
                value={pasteValue}
                onChange={(e) => { setPasteValue(e.target.value); setParseError(false); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleApplyPaste(); } }}
                placeholder="Cole: -6.4854, -49.8935 ou link do Google Maps"
                className={`flex-1 bg-[#2C3E50] text-white ${parseError ? "border-red-500" : "border-[#C9A961]/30"}`}
              />
              <Button type="button" onClick={handleApplyPaste} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
                Marcar
              </Button>
            </div>
            {parseError && <p className="text-xs text-red-400">Não foi possível identificar as coordenadas.</p>}
            {coords && (
              <p className="text-xs text-gray-400 flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-[#C9A961]" />
                {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
                <button type="button" onClick={() => setCoords(null)} className="ml-1 text-red-400 hover:text-red-300 underline">Remover</button>
              </p>
            )}
          </section>

          <section className="space-y-3">
            <p className="text-xs font-bold text-[#C9A961]/80 uppercase tracking-widest">Publicação</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {([
                ["destaque", "Destaque na home"],
                ["publicadoSite", "Publicado no site"],
                ["publicadoZap", "Feed Zap Imóveis"],
                ["publicadoOlx", "Feed OLX"],
                ["publicadoViva", "Feed Viva Real"],
                ["publicadoChavesNaMao", "Feed Chaves na Mão"],
              ] as [keyof FormState, string][]).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
                  <Checkbox checked={form[key] as boolean} onCheckedChange={(v) => set(key, !!v as any)} />
                  {label}
                </label>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <Label className="text-gray-300">Descrição</Label>
            <Textarea value={form.descricao} onChange={(e) => set("descricao", e.target.value)} rows={4}
              placeholder="Descreva o imóvel, características, diferenciais..."
              className="bg-[#2C3E50] border-[#C9A961]/30 text-white" />
          </section>

          <div className="flex gap-3 pt-2 border-t border-[#C9A961]/10">
            <Button type="submit" disabled={isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
              {isPending ? "Salvando..." : isEdit ? "Salvar Alterações" : "Cadastrar Imóvel"}
            </Button>
            <Link href="/admin/imoveis">
              <Button type="button" variant="outline" className="border-[#C9A961]/30 text-gray-300 hover:bg-[#C9A961]/10">
                Cancelar
              </Button>
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
