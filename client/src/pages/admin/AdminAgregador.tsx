import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowLeft, Plus, Search, CheckCircle2, ArrowUpRight, Archive, Rss, Loader2, ExternalLink } from "lucide-react";

const FONTE_LABELS: Record<string, string> = {
  olx: "OLX", zapimoveis: "Zap Imóveis", vivareal: "Viva Real", facebook: "Facebook",
  instagram: "Instagram", google: "Google", direto: "Direto", outro: "Outro",
};

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pendente: { label: "Pendente", className: "bg-yellow-600" },
  verificado: { label: "Verificado", className: "bg-blue-600" },
  importado: { label: "Importado", className: "bg-green-600" },
  arquivado: { label: "Arquivado", className: "bg-gray-600" },
};

const DOCUMENTO_LABELS: Record<string, string> = {
  nenhum: "Nenhum", escritura: "Escritura", contrato_gaveta: "Contrato de gaveta",
  inventario: "Inventário", heranca: "Herança", financiado: "Financiado",
  loteamento: "Loteamento", posse: "Posse", outros: "Outros",
};

const emptyForm = {
  url: "", titulo: "", descricao: "", preco: "", precoTexto: "", areaM2: "",
  tipo: "", bairro: "", cidade: "", estado: "", fonte: "direto" as string,
  imagens: [] as string[], documentoTipo: "nenhum", documentoObs: "",
  contatoNome: "", contatoTel: "", notas: "",
};

function formatCurrencyBR(value: number | string | null | undefined) {
  if (!value) return null;
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return null;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(num);
}

export default function AdminAgregador() {
  const [open, setOpen] = useState(false);
  const [filterFonte, setFilterFonte] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [form, setForm] = useState(emptyForm);

  const utils = trpc.useUtils();
  const { data: itens = [] } = trpc.agregador.list.useQuery({
    fonte: filterFonte !== "all" ? filterFonte : undefined,
    status: filterStatus !== "all" ? filterStatus : undefined,
  });

  const scrapeMutation = trpc.agregador.scrape.useMutation({
    onSuccess: (data) => {
      setForm((f) => ({
        ...f,
        titulo: data.title ?? f.titulo,
        descricao: data.description ?? f.descricao,
        precoTexto: data.priceText ?? f.precoTexto,
        preco: data.price ? String(data.price) : f.preco,
        imagens: data.images ?? f.imagens,
      }));
      toast.success("Dados extraídos da URL!");
    },
    onError: (e) => toast.error(e.message),
  });

  const createMutation = trpc.agregador.create.useMutation({
    onSuccess: () => { toast.success("Imóvel adicionado ao agregador!"); utils.agregador.list.invalidate(); setOpen(false); setForm(emptyForm); },
    onError: (e) => toast.error(e.message),
  });

  const updateStatusMutation = trpc.agregador.updateStatus.useMutation({
    onSuccess: () => { toast.success("Status atualizado!"); utils.agregador.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const importarMutation = trpc.agregador.importarParaCatalogo.useMutation({
    onSuccess: () => { toast.success("Importado para o catálogo (rascunho, ainda não publicado)!"); utils.agregador.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const total = itens.length;
  const pendentes = itens.filter((i: any) => i.status === "pendente").length;
  const verificados = itens.filter((i: any) => i.status === "verificado").length;
  const importados = itens.filter((i: any) => i.status === "importado").length;

  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <div className="bg-[#0F1923] border-b border-[#C9A961]/20 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4">
            <Link href="/admin">
              <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-[#C9A961]">Agregador / Feeds</h1>
              <p className="text-gray-400 text-sm">Imóveis captados em portais externos — verificação antes de publicar</p>
            </div>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
                <Plus className="h-4 w-4 mr-2" /> Adicionar Imóvel
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white max-h-[90vh] overflow-y-auto max-w-xl">
              <DialogHeader><DialogTitle className="text-[#C9A961]">Novo Imóvel Agregado</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="flex gap-2">
                  <Input
                    value={form.url}
                    onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                    placeholder="Cole a URL do anúncio para extrair dados..."
                    className="bg-[#2C3E50] border-[#C9A961]/30 text-white"
                  />
                  <Button
                    variant="outline"
                    onClick={() => scrapeMutation.mutate({ url: form.url })}
                    disabled={scrapeMutation.isPending || !form.url}
                    className="border-[#C9A961]/30 text-[#C9A961] shrink-0"
                  >
                    {scrapeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Label className="text-gray-300">Título *</Label>
                    <Input value={form.titulo} onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-gray-300">Descrição</Label>
                    <Textarea value={form.descricao} onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))} rows={2} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                  <div>
                    <Label className="text-gray-300">Fonte</Label>
                    <Select value={form.fonte} onValueChange={(v) => setForm((f) => ({ ...f, fonte: v }))}>
                      <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(FONTE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-gray-300">Tipo</Label>
                    <Input value={form.tipo} onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))} placeholder="casa, apartamento, terreno..." className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                  <div>
                    <Label className="text-gray-300">Preço (R$)</Label>
                    <Input type="number" value={form.preco} onChange={(e) => setForm((f) => ({ ...f, preco: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                  <div>
                    <Label className="text-gray-300">Área (m²)</Label>
                    <Input type="number" value={form.areaM2} onChange={(e) => setForm((f) => ({ ...f, areaM2: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                  <div>
                    <Label className="text-gray-300">Bairro</Label>
                    <Input value={form.bairro} onChange={(e) => setForm((f) => ({ ...f, bairro: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-gray-300">Cidade *</Label>
                      <Input value={form.cidade} onChange={(e) => setForm((f) => ({ ...f, cidade: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-gray-300">UF *</Label>
                      <Input value={form.estado} maxLength={2} onChange={(e) => setForm((f) => ({ ...f, estado: e.target.value.toUpperCase() }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-gray-300">Situação documental</Label>
                    <Select value={form.documentoTipo} onValueChange={(v) => setForm((f) => ({ ...f, documentoTipo: v }))}>
                      <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(DOCUMENTO_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-gray-300">Contato (nome)</Label>
                    <Input value={form.contatoNome} onChange={(e) => setForm((f) => ({ ...f, contatoNome: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                  <div>
                    <Label className="text-gray-300">Contato (telefone)</Label>
                    <Input value={form.contatoTel} onChange={(e) => setForm((f) => ({ ...f, contatoTel: e.target.value }))} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-gray-300">Notas internas</Label>
                    <Textarea value={form.notas} onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))} rows={2} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                  </div>
                </div>

                <Button
                  onClick={() => createMutation.mutate({
                    titulo: form.titulo,
                    descricao: form.descricao || undefined,
                    preco: form.preco ? parseFloat(form.preco) : undefined,
                    precoTexto: form.precoTexto || undefined,
                    areaM2: form.areaM2 ? parseFloat(form.areaM2) : undefined,
                    tipo: form.tipo || undefined,
                    bairro: form.bairro || undefined,
                    cidade: form.cidade,
                    estado: form.estado,
                    fonte: form.fonte as any,
                    urlFonte: form.url || undefined,
                    imagens: form.imagens,
                    documentoTipo: form.documentoTipo as any,
                    documentoObs: form.documentoObs || undefined,
                    contatoNome: form.contatoNome || undefined,
                    contatoTel: form.contatoTel || undefined,
                    notas: form.notas || undefined,
                  })}
                  disabled={createMutation.isPending || !form.titulo || !form.cidade || !form.estado}
                  className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold"
                >
                  Adicionar
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-[#2C3E50] border-[#C9A961]/20">
            <CardContent className="pt-6"><p className="text-gray-400 text-xs">Total</p><p className="text-2xl font-bold text-white">{total}</p></CardContent>
          </Card>
          <Card className="bg-[#2C3E50] border-[#C9A961]/20">
            <CardContent className="pt-6"><p className="text-gray-400 text-xs">Pendentes</p><p className="text-2xl font-bold text-yellow-400">{pendentes}</p></CardContent>
          </Card>
          <Card className="bg-[#2C3E50] border-[#C9A961]/20">
            <CardContent className="pt-6"><p className="text-gray-400 text-xs">Verificados</p><p className="text-2xl font-bold text-blue-400">{verificados}</p></CardContent>
          </Card>
          <Card className="bg-[#2C3E50] border-[#C9A961]/20">
            <CardContent className="pt-6"><p className="text-gray-400 text-xs">Importados</p><p className="text-2xl font-bold text-green-400">{importados}</p></CardContent>
          </Card>
        </div>

        <div className="flex gap-3 flex-wrap">
          <Select value={filterFonte} onValueChange={setFilterFonte}>
            <SelectTrigger className="w-48 bg-[#2C3E50] border-[#C9A961]/30 text-white"><SelectValue placeholder="Fonte" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as fontes</SelectItem>
              {Object.entries(FONTE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-48 bg-[#2C3E50] border-[#C9A961]/30 text-white"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {itens.length === 0 ? (
          <Card className="bg-[#2C3E50] border-[#C9A961]/20">
            <CardContent className="py-12 text-center text-gray-500">
              <Rss className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p>Nenhum imóvel agregado encontrado</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {itens.map((item: any) => {
              const statusCfg = STATUS_CONFIG[item.status] ?? { label: item.status, className: "bg-gray-600" };
              const preco = formatCurrencyBR(item.preco) ?? item.precoTexto;
              return (
                <Card key={item.id} className="bg-[#2C3E50] border-[#C9A961]/20">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex-1 min-w-[220px]">
                        <CardTitle className="text-white text-base flex items-center gap-2 flex-wrap">
                          {item.titulo}
                          <Badge className={`${statusCfg.className} text-white`}>{statusCfg.label}</Badge>
                          <Badge variant="outline" className="border-[#C9A961]/30 text-[#C9A961]">{FONTE_LABELS[item.fonte] ?? item.fonte}</Badge>
                        </CardTitle>
                        <p className="text-sm text-gray-400 mt-1">
                          {item.tipo ?? "—"} • {item.bairro ? `${item.bairro}, ` : ""}{item.cidade}/{item.estado}
                          {item.areaM2 ? ` • ${item.areaM2} m²` : ""}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {DOCUMENTO_LABELS[item.documentoTipo] ?? item.documentoTipo}
                          {item.urlFonte && (
                            <a href={item.urlFonte} target="_blank" rel="noopener noreferrer" className="text-[#C9A961] hover:underline ml-2 inline-flex items-center gap-1">
                              Ver anúncio <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        {preco && <span className="font-bold text-[#C9A961]">{preco}</span>}
                        <div className="flex gap-1">
                          {item.status === "pendente" && (
                            <Button size="sm" variant="outline" className="h-7 text-xs border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                              onClick={() => updateStatusMutation.mutate({ id: item.id, status: "verificado" })} disabled={updateStatusMutation.isPending}>
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Verificar
                            </Button>
                          )}
                          {item.status === "verificado" && (
                            <Button size="sm" variant="outline" className="h-7 text-xs border-green-500/30 text-green-400 hover:bg-green-500/10"
                              onClick={() => importarMutation.mutate({ id: item.id })} disabled={importarMutation.isPending}>
                              <ArrowUpRight className="h-3 w-3 mr-1" /> Importar
                            </Button>
                          )}
                          {(item.status === "pendente" || item.status === "verificado") && (
                            <Button size="sm" variant="outline" className="h-7 text-xs border-gray-500/30 text-gray-400 hover:bg-gray-500/10"
                              onClick={() => updateStatusMutation.mutate({ id: item.id, status: "arquivado" })} disabled={updateStatusMutation.isPending}>
                              <Archive className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
