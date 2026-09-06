import { useState, useEffect } from "react";
import { Link, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { toast } from "sonner";
import {
  ArrowLeft, Home, TreePine, CheckCircle2, XCircle, MinusCircle,
  Sparkles, Loader2, Paperclip, X, FileText, FileImage, Trash2,
} from "lucide-react";

type ItemState = { ok: boolean | null; nota: string };
type ChecklistData = {
  tipoChecklist: "imovel" | "terreno";
  estadoGeral: string;
  items: Record<string, ItemState>;
  fotos: string[];
};

type Documento = { nome: string; url: string; tipo: string; tamanho: number };

const STATUS_LABELS: Record<string, string> = {
  solicitada: "Solicitada", vistoria: "Vistoria", elaboracao: "Elaboração",
  revisao: "Revisão", entregue: "Entregue", cancelada: "Cancelada",
};

function parseChecklist(raw: string | null | undefined): ChecklistData {
  if (!raw) return { tipoChecklist: "imovel", estadoGeral: "", items: {}, fotos: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<ChecklistData>;
    return {
      tipoChecklist: parsed.tipoChecklist ?? "imovel",
      estadoGeral: parsed.estadoGeral ?? "",
      items: parsed.items ?? {},
      fotos: parsed.fotos ?? [],
    };
  } catch {
    return { tipoChecklist: "imovel", estadoGeral: "", items: {}, fotos: [] };
  }
}

function parseDocumentos(raw: string | null | undefined): Documento[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX_WIDTH = 800;
        let { width, height } = img;
        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("canvas context failed")); return; }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.6));
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const MAX_FOTOS = 15;
const MAX_DOCUMENTOS = 5;
const MAX_DOCUMENTOS_BYTES = 15 * 1024 * 1024;

export default function AdminAvaliacaoDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id, 10);

  const { data: avaliacao, refetch } = trpc.avaliacoes.getById.useQuery({ id }, { enabled: !isNaN(id) });
  const { data: catalog } = trpc.avaliacoes.getChecklistCatalog.useQuery(
    { tipo: parseChecklist(avaliacao?.caracteristicas).tipoChecklist },
    { enabled: !!avaliacao }
  );

  const [checklist, setChecklist] = useState<ChecklistData>({ tipoChecklist: "imovel", estadoGeral: "", items: {}, fotos: [] });
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [laudo, setLaudo] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [valorEstimado, setValorEstimado] = useState("");
  const [sugestao, setSugestao] = useState<any>(null);

  useEffect(() => {
    if (avaliacao) {
      setChecklist(parseChecklist(avaliacao.caracteristicas));
      setDocumentos(parseDocumentos(avaliacao.documentos));
      setLaudo(avaliacao.laudo ?? "");
      setObservacoes(avaliacao.observacoes ?? "");
      setValorEstimado(avaliacao.valorEstimado?.toString() ?? "");
      if (avaliacao.sugestaoJson) {
        try { setSugestao(JSON.parse(avaliacao.sugestaoJson)); } catch { /* ignore */ }
      }
    }
  }, [avaliacao?.id]);

  const updateMutation = trpc.avaliacoes.update.useMutation({
    onSuccess: () => { toast.success("Avaliação atualizada!"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const updateChecklistMutation = trpc.avaliacoes.updateChecklist.useMutation({
    onSuccess: () => { toast.success("Checklist salvo!"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const sugerirValorMutation = trpc.avaliacoes.sugerirValor.useMutation({
    onSuccess: (data) => { setSugestao(data); toast.success("Sugestão gerada!"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  if (!avaliacao) {
    return (
      <div className="min-h-screen bg-[#1A2332] text-white flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#C9A961]" />
      </div>
    );
  }

  const groups = catalog?.groups ?? [];
  const estadoOptions = catalog?.estadoGeralOptions ?? [];
  const totalItems = groups.reduce((acc: number, g: any) => acc + g.items.length, 0);
  const verifiedCount = Object.values(checklist.items).filter((v) => v.ok !== null).length;
  const progressPct = totalItems > 0 ? Math.round((verifiedCount / totalItems) * 100) : 0;

  function setItemOk(key: string, val: boolean | null) {
    setChecklist((prev) => ({ ...prev, items: { ...prev.items, [key]: { ok: val, nota: prev.items[key]?.nota ?? "" } } }));
  }
  function setItemNota(key: string, nota: string) {
    setChecklist((prev) => ({ ...prev, items: { ...prev.items, [key]: { ok: prev.items[key]?.ok ?? null, nota } } }));
  }

  async function handleFotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const remaining = MAX_FOTOS - checklist.fotos.length;
    const toProcess = files.slice(0, remaining);
    const compressed: string[] = [];
    for (const file of toProcess) compressed.push(await compressImage(file));
    setChecklist((prev) => ({ ...prev, fotos: [...prev.fotos, ...compressed] }));
    e.target.value = "";
  }

  function removeFoto(idx: number) {
    setChecklist((prev) => ({ ...prev, fotos: prev.fotos.filter((_, i) => i !== idx) }));
  }

  function saveChecklist() {
    updateChecklistMutation.mutate({ id, ...checklist });
  }

  async function handleDocumentoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const currentTotal = documentos.reduce((acc, d) => acc + d.tamanho, 0);
    const remaining = MAX_DOCUMENTOS - documentos.length;
    const toProcess = files.slice(0, remaining);
    const novos: Documento[] = [];
    let runningTotal = currentTotal;
    for (const file of toProcess) {
      if (runningTotal + file.size > MAX_DOCUMENTOS_BYTES) {
        toast.error("Limite total de documentos (15MB) atingido");
        break;
      }
      const url = await fileToDataUrl(file);
      novos.push({ nome: file.name, url, tipo: file.type, tamanho: file.size });
      runningTotal += file.size;
    }
    const updated = [...documentos, ...novos];
    setDocumentos(updated);
    updateMutation.mutate({ id, documentos: JSON.stringify(updated) });
    e.target.value = "";
  }

  function removeDocumento(idx: number) {
    const updated = documentos.filter((_, i) => i !== idx);
    setDocumentos(updated);
    updateMutation.mutate({ id, documentos: JSON.stringify(updated) });
  }

  function formatSize(bytes: number) {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
  }

  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <div className="bg-[#0F1923] border-b border-[#C9A961]/20 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin/avaliacoes">
              <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold text-[#C9A961]">{avaliacao.numero}</h1>
              <p className="text-gray-400 text-sm">{avaliacao.clienteNome} • {avaliacao.endereco}, {avaliacao.bairro} — {avaliacao.cidade}/{avaliacao.estado}</p>
            </div>
          </div>
          <Select
            value={avaliacao.status}
            onValueChange={(v) => updateMutation.mutate({ id, status: v as any })}
          >
            <SelectTrigger className="w-44 bg-[#2C3E50] border-[#C9A961]/30 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* Dados gerais */}
        <Card className="bg-[#2C3E50] border-[#C9A961]/20">
          <CardHeader><CardTitle className="text-[#C9A961] text-base">Dados Gerais</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div><p className="text-gray-400 text-xs">Tipo</p><p className="text-white">{avaliacao.tipo}</p></div>
            <div><p className="text-gray-400 text-xs">Finalidade</p><p className="text-white">{avaliacao.finalidade}</p></div>
            <div><p className="text-gray-400 text-xs">Metodologia</p><p className="text-white">{avaliacao.metodologia}</p></div>
            <div><p className="text-gray-400 text-xs">Avaliador</p><p className="text-white">{avaliacao.avaliador}</p></div>
            <div><p className="text-gray-400 text-xs">Telefone</p><p className="text-white">{avaliacao.clienteTel}</p></div>
            <div><p className="text-gray-400 text-xs">Email</p><p className="text-white">{avaliacao.clienteEmail ?? "—"}</p></div>
            <div><p className="text-gray-400 text-xs">Área constr.</p><p className="text-white">{avaliacao.areaConstruida ?? "—"} m²</p></div>
            <div><p className="text-gray-400 text-xs">Área terreno</p><p className="text-white">{avaliacao.areaTerreno ?? "—"} m²</p></div>
          </CardContent>
        </Card>

        {/* Checklist de vistoria */}
        <Card className="bg-[#2C3E50] border-[#C9A961]/20">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-[#C9A961] text-base">Checklist de Vistoria</CardTitle>
              <div className="flex gap-2">
                <Button
                  size="sm" variant={checklist.tipoChecklist === "imovel" ? "default" : "outline"}
                  onClick={() => setChecklist((prev) => ({ ...prev, tipoChecklist: "imovel", estadoGeral: "", items: {} }))}
                  className={checklist.tipoChecklist === "imovel" ? "bg-[#C9A961] text-[#1A2332]" : "border-[#C9A961]/30 text-gray-300"}
                >
                  <Home className="h-3.5 w-3.5 mr-1" /> Imóvel
                </Button>
                <Button
                  size="sm" variant={checklist.tipoChecklist === "terreno" ? "default" : "outline"}
                  onClick={() => setChecklist((prev) => ({ ...prev, tipoChecklist: "terreno", estadoGeral: "", items: {} }))}
                  className={checklist.tipoChecklist === "terreno" ? "bg-[#C9A961] text-[#1A2332]" : "border-[#C9A961]/30 text-gray-300"}
                >
                  <TreePine className="h-3.5 w-3.5 mr-1" /> Terreno
                </Button>
              </div>
            </div>
            <p className="text-xs text-gray-400">{verifiedCount} de {totalItems} itens verificados ({progressPct}%)</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-gray-300 text-xs uppercase tracking-wide">Estado geral</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {estadoOptions.map((opt: any) => (
                  <button
                    key={opt.value}
                    onClick={() => setChecklist((prev) => ({ ...prev, estadoGeral: opt.value }))}
                    className={`px-3 py-1.5 text-xs font-bold uppercase border rounded transition-colors ${
                      checklist.estadoGeral === opt.value
                        ? "bg-[#C9A961] text-[#1A2332] border-[#C9A961]"
                        : "bg-transparent text-gray-400 border-gray-600 hover:border-gray-400"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <Accordion type="multiple" className="space-y-1">
              {groups.map((group: any) => {
                const groupVerified = group.items.filter((it: any) => (checklist.items[it.key]?.ok ?? null) !== null).length;
                const groupNC = group.items.filter((it: any) => checklist.items[it.key]?.ok === false).length;
                return (
                  <AccordionItem key={group.id} value={group.id} className="border border-gray-700 rounded px-3">
                    <AccordionTrigger className="text-sm text-white hover:no-underline">
                      <div className="flex items-center gap-2 flex-1">
                        <span className="font-bold uppercase text-xs tracking-wide text-[#C9A961]">{group.label}</span>
                        <span className="text-xs text-gray-500 ml-auto mr-2">
                          {groupNC > 0 && <span className="text-red-400 mr-2">{groupNC} NC</span>}
                          {groupVerified}/{group.items.length}
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-2">
                        {group.items.map((item: any) => {
                          const state = checklist.items[item.key] ?? { ok: null, nota: "" };
                          return (
                            <div key={item.key} className="flex items-start gap-2 py-1">
                              <button onClick={() => setItemOk(item.key, state.ok === true ? null : true)} className="shrink-0 mt-0.5">
                                <CheckCircle2 className={`h-4 w-4 ${state.ok === true ? "text-green-500" : "text-gray-600"}`} />
                              </button>
                              <button onClick={() => setItemOk(item.key, state.ok === false ? null : false)} className="shrink-0 mt-0.5">
                                <XCircle className={`h-4 w-4 ${state.ok === false ? "text-red-400" : "text-gray-600"}`} />
                              </button>
                              {state.ok === null && <MinusCircle className="h-4 w-4 text-gray-700 shrink-0 mt-0.5" />}
                              <div className="flex-1">
                                <p className={`text-sm ${state.ok === false ? "text-red-300" : "text-gray-300"}`}>{item.label}</p>
                                {state.ok === false && (
                                  <Input
                                    placeholder="Observação..."
                                    value={state.nota}
                                    onChange={(e) => setItemNota(item.key, e.target.value)}
                                    className="bg-[#1A2332] border-gray-700 text-white text-xs h-7 mt-1"
                                  />
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>

            {/* Fotos */}
            <div>
              <Label className="text-gray-300 text-xs uppercase tracking-wide">Fotos da vistoria ({checklist.fotos.length}/{MAX_FOTOS})</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {checklist.fotos.map((src, idx) => (
                  <div key={idx} className="relative w-20 h-20 rounded overflow-hidden bg-gray-800">
                    <img src={src} alt="" className="w-full h-full object-cover" />
                    <button onClick={() => removeFoto(idx)} className="absolute top-0.5 right-0.5 bg-black/70 rounded-full p-0.5">
                      <X className="h-3 w-3 text-white" />
                    </button>
                  </div>
                ))}
                {checklist.fotos.length < MAX_FOTOS && (
                  <label className="w-20 h-20 border border-dashed border-gray-600 rounded flex items-center justify-center cursor-pointer hover:border-[#C9A961] text-gray-500">
                    <Paperclip className="h-4 w-4" />
                    <input type="file" accept="image/*" multiple className="hidden" onChange={handleFotoChange} />
                  </label>
                )}
              </div>
            </div>

            <Button onClick={saveChecklist} disabled={updateChecklistMutation.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
              {updateChecklistMutation.isPending ? "Salvando..." : "Salvar checklist"}
            </Button>
          </CardContent>
        </Card>

        {/* Sugestão de valor via IA */}
        <Card className="bg-[#2C3E50] border-[#C9A961]/20">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-[#C9A961] text-base">Sugestão de Valor (IA)</CardTitle>
              <Button
                size="sm"
                onClick={() => sugerirValorMutation.mutate({ id })}
                disabled={sugerirValorMutation.isPending}
                className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold"
              >
                {sugerirValorMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
                Gerar sugestão
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {!sugestao ? (
              <p className="text-gray-500 text-sm">Nenhuma sugestão gerada ainda. Preencha o checklist antes para um resultado mais preciso.</p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div><p className="text-gray-400 text-xs">Valor sugerido</p><p className="text-[#C9A961] font-bold text-xl">{formatCurrencyBR(sugestao.valorSugerido)}</p></div>
                  <div><p className="text-gray-400 text-xs">Faixa</p><p className="text-white text-sm">{formatCurrencyBR(sugestao.valorMin)} – {formatCurrencyBR(sugestao.valorMax)}</p></div>
                  <div><p className="text-gray-400 text-xs">Confiabilidade</p><Badge className="bg-blue-600 text-white">{sugestao.confiabilidade}</Badge></div>
                </div>
                {sugestao.comparaveis?.length > 0 && (
                  <div>
                    <p className="text-gray-400 text-xs mb-1">Comparáveis</p>
                    <div className="space-y-1">
                      {sugestao.comparaveis.map((c: any, i: number) => (
                        <p key={i} className="text-xs text-gray-300">{c.descricao} — {formatCurrencyBR(c.preco)} ({c.area}m²)</p>
                      ))}
                    </div>
                  </div>
                )}
                {sugestao.metodologia && <p className="text-xs text-gray-400 italic">{sugestao.metodologia}</p>}
                <Button
                  size="sm" variant="outline"
                  onClick={() => setValorEstimado(String(sugestao.valorSugerido))}
                  className="border-[#C9A961]/30 text-[#C9A961]"
                >
                  Usar como valor estimado
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Laudo e observações */}
        <Card className="bg-[#2C3E50] border-[#C9A961]/20">
          <CardHeader><CardTitle className="text-[#C9A961] text-base">Laudo e Observações</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-gray-300">Valor estimado (R$)</Label>
              <Input type="number" value={valorEstimado} onChange={(e) => setValorEstimado(e.target.value)} className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1" />
            </div>
            <div>
              <Label className="text-gray-300">Laudo</Label>
              <Textarea value={laudo} onChange={(e) => setLaudo(e.target.value)} rows={6} className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1" />
            </div>
            <div>
              <Label className="text-gray-300">Observações</Label>
              <Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={3} className="bg-[#1A2332] border-[#C9A961]/30 text-white mt-1" />
            </div>
            <Button
              onClick={() => updateMutation.mutate({
                id,
                laudo,
                observacoes,
                valorEstimado: valorEstimado ? parseFloat(valorEstimado) : undefined,
              })}
              disabled={updateMutation.isPending}
              className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold"
            >
              Salvar laudo
            </Button>
          </CardContent>
        </Card>

        {/* Documentos */}
        <Card className="bg-[#2C3E50] border-[#C9A961]/20">
          <CardHeader><CardTitle className="text-[#C9A961] text-base">Documentos ({documentos.length}/{MAX_DOCUMENTOS})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {documentos.map((doc, idx) => (
              <div key={idx} className="flex items-center gap-2 bg-[#1A2332] rounded px-3 py-2">
                {doc.tipo.startsWith("image/") ? <FileImage className="h-4 w-4 text-blue-400 shrink-0" /> : <FileText className="h-4 w-4 text-gray-400 shrink-0" />}
                <a href={doc.url} download={doc.nome} className="text-sm text-white flex-1 truncate hover:underline">{doc.nome}</a>
                <span className="text-xs text-gray-500">{formatSize(doc.tamanho)}</span>
                <button onClick={() => removeDocumento(idx)} className="text-gray-500 hover:text-red-400">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {documentos.length < MAX_DOCUMENTOS && (
              <label className="flex items-center gap-2 border border-dashed border-gray-600 rounded px-3 py-2 cursor-pointer hover:border-[#C9A961] text-gray-500 text-sm w-fit">
                <Paperclip className="h-4 w-4" /> Anexar documento
                <input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={handleDocumentoChange} />
              </label>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function formatCurrencyBR(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(num);
}
