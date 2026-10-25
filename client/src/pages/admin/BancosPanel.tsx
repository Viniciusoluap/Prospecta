// Pedido de 25/10: BPO › Bancos — contas por API (Asaas, Pluggy/Meu Pluggy) e importação de
// extrato (planilha, OFX, PDF) com prévia, sempre respeitando a data inicial de cada conta.
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/format";
import { toast } from "sonner";
import { FileUp, Landmark, Link2, Plus, RefreshCw, Trash2, ListOrdered } from "lucide-react";

const campo = "bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1";
const botaoSec = "h-7 text-xs border-[#C9A961]/30 text-[#C9A961]";
const dataBR = (d?: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const PROVEDOR: Record<string, string> = { asaas: "API do Asaas", pluggy: "Pluggy (Meu Pluggy)", manual: "Importação de extrato" };

type LinhaPrevia = { data: string; descricao: string; valor: number; tipo: "credito" | "debito"; jaImportada: boolean };
type Previa = { formato: string; linhas: LinhaPrevia[]; ignoradas: number; antesDaDataInicial: number; dataInicial: string | null };

function arquivoBase64(f: File): Promise<string> {
  return new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] ?? "");
    r.onerror = () => falha(new Error("Não foi possível ler o arquivo."));
    r.readAsDataURL(f);
  });
}

export default function BancosPanel() {
  const utils = trpc.useUtils();
  const { data: contas = [] } = trpc.bancario.contas.list.useQuery();
  const { data: pluggy } = trpc.pluggySettings.status.useQuery();
  const invalidar = () => utils.bancario.contas.list.invalidate();

  // Pluggy
  const [pluggyForm, setPluggyForm] = useState({ clientId: "", clientSecret: "" });
  const [itemForm, setItemForm] = useState({ itemId: "", dataInicial: "" });
  const salvarPluggy = trpc.pluggySettings.save.useMutation({
    onSuccess: () => { toast.success("Credenciais da Pluggy salvas."); setPluggyForm({ clientId: "", clientSecret: "" }); utils.pluggySettings.status.invalidate(); },
    onError: e => toast.error(e.message),
  });
  const testarPluggy = trpc.pluggySettings.testar.useMutation({ onSuccess: r => (r.ok ? toast.success(r.mensagem) : toast.error(r.mensagem)) });
  const importarItem = trpc.pluggySettings.importarItem.useMutation({
    onSuccess: r => { toast.success(`${r.encontradas} conta(s) encontrada(s), ${r.criadas} cadastrada(s).`); setItemForm({ itemId: "", dataInicial: "" }); invalidar(); },
    onError: e => toast.error(e.message),
  });
  const connectToken = trpc.pluggySettings.connectToken.useMutation();
  async function conectarMeuPluggy() {
    try {
      const { accessToken } = await connectToken.mutateAsync();
      const { PluggyConnect } = await import("pluggy-connect-sdk");
      const pc = new PluggyConnect({
        connectToken: accessToken,
        includeSandbox: false,
        onSuccess: ({ item }) => importarItem.mutate({ itemId: item.id, dataInicial: itemForm.dataInicial || null }),
        onError: e => { toast.error(e.message); },
      });
      await pc.init();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir a Pluggy.");
    }
  }

  // Nova conta (Asaas ou importação)
  const vazio = { provedor: "asaas" as "asaas" | "manual", banco: "Asaas", conta: "", descricao: "", apiKey: "", dataInicial: "" };
  const [novaOpen, setNovaOpen] = useState(false);
  const [nova, setNova] = useState(vazio);
  const criar = trpc.bancario.contas.create.useMutation({
    onSuccess: () => { toast.success("Conta cadastrada."); setNovaOpen(false); setNova(vazio); invalidar(); },
    onError: e => toast.error(e.message),
  });

  // Editar data inicial / chave
  const [edit, setEdit] = useState<{ id: number; dataInicial: string; apiKey: string; provedor: string } | null>(null);
  const atualizar = trpc.bancario.contas.update.useMutation({
    onSuccess: () => { toast.success("Conta atualizada."); setEdit(null); invalidar(); },
    onError: e => toast.error(e.message),
  });
  const remover = trpc.bancario.contas.delete.useMutation({ onSuccess: () => { toast.success("Conta removida."); invalidar(); } });
  const sincronizar = trpc.bancario.sincronizar.useMutation({
    onSuccess: r => { r.ok ? toast.success(r.mensagem) : toast.error(r.mensagem); invalidar(); utils.bancario.transacoes.listByConta.invalidate(); },
    onError: e => toast.error(e.message),
  });

  // Transações
  const [verConta, setVerConta] = useState<number | null>(null);
  const { data: transacoes = [] } = trpc.bancario.transacoes.listByConta.useQuery({ accountId: verConta ?? 0 }, { enabled: verConta !== null });

  // Importação
  const [imp, setImp] = useState<{ contaId: number; nome: string } | null>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [anoPadrao, setAnoPadrao] = useState("");
  const [previa, setPrevia] = useState<Previa | null>(null);
  const lerPrevia = trpc.bancario.importar.previa.useMutation({ onSuccess: setPrevia, onError: e => toast.error(e.message) });
  const confirmar = trpc.bancario.importar.confirmar.useMutation({
    onSuccess: r => {
      toast.success(`${r.novos} lançamento(s) importado(s).${r.recebidos - r.novos > 0 ? ` ${r.recebidos - r.novos} já existiam.` : ""}`);
      fecharImportacao(); invalidar(); utils.bancario.transacoes.listByConta.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  function fecharImportacao() { setImp(null); setArquivo(null); setPrevia(null); setAnoPadrao(""); }
  async function lerArquivo() {
    if (!imp || !arquivo) return;
    if (arquivo.size > 10 * 1024 * 1024) return toast.error("Arquivo acima de 10 MB.");
    lerPrevia.mutate({ contaId: imp.contaId, nome: arquivo.name, base64: await arquivoBase64(arquivo), anoPadrao: anoPadrao ? Number(anoPadrao) : undefined });
  }
  const novas = previa?.linhas.filter(l => !l.jaImportada).length ?? 0;

  return (
    <div className="space-y-6">
      <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-[#C9A961]">Contas Bancárias ({contas.length})</CardTitle>
          <Button onClick={() => setNovaOpen(true)} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
            <Plus className="h-4 w-4 mr-2" /> Conta Bancária
          </Button>
        </CardHeader>
        <CardContent>
          {contas.length === 0 ? (
            <div className="text-center py-12 text-gray-300">
              <Landmark className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p>Nenhuma conta bancária cadastrada</p>
            </div>
          ) : (
            <div className="space-y-2">
              {contas.map((c: any) => (
                <div key={c.id} className="p-3 bg-[#1A2332] rounded-lg space-y-2">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-white font-medium">{c.banco}{c.descricao ? ` — ${c.descricao}` : ""}{c.conta && c.conta !== "—" ? ` • ${c.conta}` : ""}</p>
                      <p className="text-xs text-gray-300">
                        {PROVEDOR[c.provedor] ?? c.provedor} • a partir de {dataBR(c.dataInicial)}
                        {c.ultimaSincronizacao ? ` • última sinc. ${new Date(c.ultimaSincronizacao).toLocaleString("pt-BR")}` : ""}
                      </p>
                      {c.ultimoErro && <p className="text-xs text-red-300 mt-1">Último erro: {c.ultimoErro}</p>}
                    </div>
                    <span className="font-bold text-[#C9A961]">{formatCurrency(Number(c.saldoAtual ?? 0))}</span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {(c.provedor === "asaas" || c.provedor === "pluggy") && (
                      <Button size="sm" variant="outline" className={botaoSec} disabled={sincronizar.isPending} onClick={() => sincronizar.mutate({ contaId: c.id })}>
                        <RefreshCw className="h-3 w-3 mr-1" /> Sincronizar
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className={botaoSec} onClick={() => setImp({ contaId: c.id, nome: c.descricao || c.banco })}>
                      <FileUp className="h-3 w-3 mr-1" /> Importar extrato
                    </Button>
                    <Button size="sm" variant="outline" className={botaoSec} onClick={() => setVerConta(verConta === c.id ? null : c.id)}>
                      <ListOrdered className="h-3 w-3 mr-1" /> {verConta === c.id ? "Ocultar" : "Movimentações"}
                    </Button>
                    <Button size="sm" variant="outline" className={botaoSec} onClick={() => setEdit({ id: c.id, dataInicial: c.dataInicial ?? "", apiKey: "", provedor: c.provedor })}>
                      Data inicial{c.provedor === "asaas" ? " / chave" : ""}
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs border-red-400/40 text-red-300" onClick={() => confirm(`Remover a conta ${c.banco}? As movimentações já gravadas continuam no histórico.`) && remover.mutate({ id: c.id })}>
                      <Trash2 className="h-3 w-3 mr-1" /> Remover
                    </Button>
                  </div>
                  {verConta === c.id && (
                    <div className="max-h-80 overflow-y-auto border-t border-[#C9A961]/10 pt-2">
                      {transacoes.length === 0 ? <p className="text-xs text-gray-300">Nenhuma movimentação.</p> : (
                        <table className="w-full text-xs">
                          <tbody>
                            {transacoes.slice(0, 300).map((t: any) => (
                              <tr key={t.id} className="border-b border-white/5">
                                <td className="py-1 pr-2 text-gray-300 whitespace-nowrap">{new Date(t.data).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</td>
                                <td className="py-1 pr-2 text-gray-100">{t.descricao}</td>
                                <td className={`py-1 text-right whitespace-nowrap font-bold ${t.tipo === "credito" ? "text-green-300" : "text-red-300"}`}>
                                  {t.tipo === "debito" ? "-" : ""}{formatCurrency(Number(t.valor))}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
        <CardHeader><CardTitle className="text-[#C9A961]">Pluggy — contas conectadas pelo Meu Pluggy (gratuito)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-300">
            {pluggy?.configured ? "Credenciais da Pluggy salvas." : "Informe o Client ID e o Client Secret da aplicação criada no painel da Pluggy."}
            {" "}As contas conectadas no Meu Pluggy são lidas sem custo e sincronizadas todo dia.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><Label className="text-gray-300">Client ID</Label><Input value={pluggyForm.clientId} onChange={e => setPluggyForm(f => ({ ...f, clientId: e.target.value }))} className={campo} autoComplete="off" /></div>
            <div><Label className="text-gray-300">Client Secret</Label><Input type="password" value={pluggyForm.clientSecret} onChange={e => setPluggyForm(f => ({ ...f, clientSecret: e.target.value }))} className={campo} autoComplete="off" /></div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" disabled={!pluggyForm.clientId || !pluggyForm.clientSecret || salvarPluggy.isPending} onClick={() => salvarPluggy.mutate(pluggyForm)} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">Salvar credenciais</Button>
            {pluggy?.configured && <Button size="sm" variant="outline" className={botaoSec} disabled={testarPluggy.isPending} onClick={() => testarPluggy.mutate()}>Testar conexão</Button>}
          </div>
          {pluggy?.configured && (
            <div className="border-t border-[#C9A961]/10 pt-4 space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div><Label className="text-gray-300">Considerar movimentações a partir de</Label><Input type="date" value={itemForm.dataInicial} onChange={e => setItemForm(f => ({ ...f, dataInicial: e.target.value }))} className={campo} /></div>
                <div><Label className="text-gray-300">ID da conexão (itemId), se já tiver</Label><Input value={itemForm.itemId} onChange={e => setItemForm(f => ({ ...f, itemId: e.target.value.trim() }))} className={campo} placeholder="opcional" /></div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" className={botaoSec} disabled={connectToken.isPending} onClick={conectarMeuPluggy}><Link2 className="h-3 w-3 mr-1" /> Conectar banco (Meu Pluggy)</Button>
                <Button size="sm" variant="outline" className={botaoSec} disabled={itemForm.itemId.length < 8 || importarItem.isPending} onClick={() => importarItem.mutate({ itemId: itemForm.itemId, dataInicial: itemForm.dataInicial || null })}>Buscar contas deste ID</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={novaOpen} onOpenChange={setNovaOpen}>
        <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-[#C9A961]">Nova conta bancária</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <Label className="text-gray-300">Como as movimentações chegam</Label>
              <Select value={nova.provedor} onValueChange={(v: "asaas" | "manual") => setNova(n => ({ ...n, provedor: v, banco: v === "asaas" ? "Asaas" : "" }))}>
                <SelectTrigger className={campo}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="asaas">API do Asaas (automático)</SelectItem>
                  <SelectItem value="manual">Importação de extrato (Cora, C6, Inter ou outro)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-300 mt-1">Contas do Meu Pluggy entram pelo quadro "Pluggy" abaixo.</p>
            </div>
            <div><Label className="text-gray-300">Banco *</Label><Input value={nova.banco} onChange={e => setNova(n => ({ ...n, banco: e.target.value }))} className={campo} placeholder="ex.: Cora" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-gray-300">Conta</Label><Input value={nova.conta} onChange={e => setNova(n => ({ ...n, conta: e.target.value }))} className={campo} /></div>
              <div><Label className="text-gray-300">Descrição</Label><Input value={nova.descricao} onChange={e => setNova(n => ({ ...n, descricao: e.target.value }))} className={campo} placeholder="ex.: Conta PJ" /></div>
            </div>
            {nova.provedor === "asaas" && (
              <div><Label className="text-gray-300">Chave de API do Asaas *</Label><Input type="password" value={nova.apiKey} onChange={e => setNova(n => ({ ...n, apiKey: e.target.value }))} className={campo} autoComplete="off" placeholder="$aact_prod_..." /></div>
            )}
            <div>
              <Label className="text-gray-300">Considerar movimentações a partir de</Label>
              <Input type="date" value={nova.dataInicial} onChange={e => setNova(n => ({ ...n, dataInicial: e.target.value }))} className={campo} />
              <p className="text-xs text-gray-300 mt-1">Movimentações anteriores a esta data não são gravadas (não pertencem a esta empresa).</p>
            </div>
            <Button className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold" disabled={criar.isPending || !nova.banco || (nova.provedor === "asaas" && !nova.apiKey)}
              onClick={() => criar.mutate({ provedor: nova.provedor, banco: nova.banco, conta: nova.conta || undefined, descricao: nova.descricao || undefined, apiKey: nova.apiKey || undefined, dataInicial: nova.dataInicial || null })}>
              {criar.isPending ? "Validando..." : "Cadastrar conta"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={edit !== null} onOpenChange={o => !o && setEdit(null)}>
        <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white">
          <DialogHeader><DialogTitle className="text-[#C9A961]">Ajustar conta</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-3 mt-2">
              <div>
                <Label className="text-gray-300">Considerar movimentações a partir de</Label>
                <Input type="date" value={edit.dataInicial} onChange={e => setEdit({ ...edit, dataInicial: e.target.value })} className={campo} />
                <p className="text-xs text-gray-300 mt-1">Vale para as próximas sincronizações e importações. O que já foi gravado continua.</p>
              </div>
              {edit.provedor === "asaas" && (
                <div><Label className="text-gray-300">Nova chave de API (deixe em branco para manter)</Label><Input type="password" value={edit.apiKey} onChange={e => setEdit({ ...edit, apiKey: e.target.value })} className={campo} autoComplete="off" /></div>
              )}
              <Button className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold" disabled={atualizar.isPending}
                onClick={() => atualizar.mutate({ id: edit.id, dataInicial: edit.dataInicial || null, apiKey: edit.apiKey || undefined })}>Salvar</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={imp !== null} onOpenChange={o => !o && fecharImportacao()}>
        <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-[#C9A961]">Importar extrato — {imp?.nome}</DialogTitle></DialogHeader>
          {!previa ? (
            <div className="space-y-3 mt-2">
              <p className="text-sm text-gray-300">Aceita planilha (CSV, Excel), OFX ou PDF. Prefira OFX ou CSV quando o banco oferecer: a leitura é mais precisa que a do PDF.</p>
              <Input type="file" accept=".csv,.txt,.xlsx,.xls,.ofx,.pdf" onChange={e => { setArquivo(e.target.files?.[0] ?? null); setPrevia(null); }} className={campo} />
              {arquivo?.name.toLowerCase().endsWith(".pdf") && (
                <div><Label className="text-gray-300">Ano do extrato (se as datas do PDF vierem sem ano)</Label><Input type="number" value={anoPadrao} onChange={e => setAnoPadrao(e.target.value)} className={campo} placeholder={String(new Date().getFullYear())} /></div>
              )}
              <Button className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold" disabled={!arquivo || lerPrevia.isPending} onClick={lerArquivo}>
                {lerPrevia.isPending ? "Lendo..." : "Ler arquivo e mostrar prévia"}
              </Button>
            </div>
          ) : (
            <div className="space-y-3 mt-2">
              <p className="text-sm text-gray-200">
                {previa.formato}: <b>{novas}</b> lançamento(s) novo(s){previa.linhas.length - novas ? `, ${previa.linhas.length - novas} já importado(s)` : ""}
                {previa.antesDaDataInicial ? `, ${previa.antesDaDataInicial} anterior(es) a ${dataBR(previa.dataInicial)} (descartados)` : ""}
                {previa.ignoradas ? `, ${previa.ignoradas} linha(s) não reconhecida(s)` : ""}.
              </p>
              <div className="max-h-96 overflow-y-auto border border-[#C9A961]/10 rounded">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[#1A2332]"><tr className="text-gray-300"><th className="text-left p-1">Data</th><th className="text-left p-1">Descrição</th><th className="text-right p-1">Valor</th></tr></thead>
                  <tbody>
                    {previa.linhas.slice(0, 500).map((l, i) => (
                      <tr key={i} className={`border-b border-white/5 ${l.jaImportada ? "opacity-50" : ""}`}>
                        <td className="p-1 whitespace-nowrap">{dataBR(l.data)}</td>
                        <td className="p-1">{l.descricao}{l.jaImportada ? " (já importado)" : ""}</td>
                        <td className={`p-1 text-right whitespace-nowrap font-bold ${l.tipo === "credito" ? "text-green-300" : "text-red-300"}`}>{l.tipo === "debito" ? "-" : ""}{formatCurrency(l.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {previa.linhas.length > 500 && <p className="text-xs text-gray-300">Mostrando 500 de {previa.linhas.length}; todos serão importados.</p>}
              <div className="flex gap-2">
                <Button variant="outline" className="border-[#C9A961]/30 text-[#C9A961]" onClick={() => setPrevia(null)}>Escolher outro arquivo</Button>
                <Button className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold" disabled={!novas || confirmar.isPending}
                  onClick={() => imp && confirmar.mutate({ contaId: imp.contaId, linhas: previa.linhas.map(({ jaImportada: _j, ...l }) => l) })}>
                  {confirmar.isPending ? "Importando..." : `Importar ${novas} lançamento(s)`}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
