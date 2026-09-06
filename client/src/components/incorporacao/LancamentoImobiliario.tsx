import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { LayoutList, PartyPopper, Plus, Trash2 } from "lucide-react";
import { calcularMix, type ItemMixProduto } from "@shared/incorporacao/mix-produtos";
import { resumoLancamentoImobiliario, type VendaLancamento } from "@shared/incorporacao/lancamento-imobiliario";

const cardCls = "bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm";
const inputCls = "bg-[#2C3E50] border-[#C9A961]/30 text-white";

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function Metric({ label, valor, destaque }: { label: string; valor: string; destaque?: boolean }) {
  return (
    <div className={`rounded-lg p-3 border ${destaque ? "bg-[#C9A961]/10 border-[#C9A961]/40" : "bg-[#0F1923] border-[#C9A961]/10"}`}>
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">{label}</p>
      <p className={`font-black text-base leading-tight ${destaque ? "text-[#C9A961]" : "text-white"}`}>{valor}</p>
    </div>
  );
}

export function LancamentoImobiliario({ estudoId, productMixJson, realEstateLaunchJson }: {
  estudoId: number; productMixJson: string | null; realEstateLaunchJson: string | null;
}) {
  const [mixAtual, setMixAtual] = useState<ItemMixProduto[]>(() => {
    if (productMixJson) {
      try { return JSON.parse(productMixJson) as ItemMixProduto[]; } catch { /* vazio */ }
    }
    return [];
  });

  return (
    <div className="space-y-6">
      <MixProdutos estudoId={estudoId} mixAtual={mixAtual} onChange={setMixAtual} />
      <LancamentoVendas estudoId={estudoId} realEstateLaunchJson={realEstateLaunchJson} mixAtual={mixAtual} />
    </div>
  );
}

function novoItemMix(): ItemMixProduto {
  return { nome: "", quantidade: 0, areaUnidadeM2: 0, precoM2: 0 };
}

function MixProdutos({ estudoId, mixAtual, onChange }: { estudoId: number; mixAtual: ItemMixProduto[]; onChange: (itens: ItemMixProduto[]) => void }) {
  const utils = trpc.useUtils();
  const saveMutation = trpc.incorporacao.saveMixProdutos.useMutation({
    onSuccess: () => { toast.success("Mix de produtos salvo!"); utils.incorporacao.getById.invalidate({ id: estudoId }); },
    onError: (e) => toast.error(e.message),
  });

  const resultado = useMemo(() => calcularMix(mixAtual), [mixAtual]);

  function addItem() { onChange([...mixAtual, novoItemMix()]); }
  function removerItem(i: number) { onChange(mixAtual.filter((_, j) => j !== i)); }
  function upd(i: number, campo: keyof ItemMixProduto, valor: string) {
    const itens = [...mixAtual];
    itens[i] = { ...itens[i], [campo]: campo === "nome" ? valor : (parseFloat(valor) || 0) };
    onChange(itens);
  }

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <LayoutList className="h-5 w-5 text-[#C9A961]" /> Mix de Produtos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-400 max-w-2xl">
          Um produto por linha (lotes, casas, apartamentos, comercial). O total de unidades e o VGV projetado abaixo
          alimentam automaticamente a comparação do Lançamento Imobiliário.
        </p>

        <div className="overflow-x-auto">
          <table className="text-xs min-w-[560px] w-full">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-44">Produto</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-28">Quantidade</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-28">Área/unidade (m²)</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-28">Preço/m² (R$)</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-28">VGV do item</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {mixAtual.map((it, i) => {
                const r = resultado.itens[i];
                return (
                  <tr key={i}>
                    <td className="px-1 py-1"><Input value={it.nome} onChange={(e) => upd(i, "nome", e.target.value)} className={inputCls} placeholder="Ex.: Lote 300m²" /></td>
                    <td className="px-1 py-1"><Input type="number" value={it.quantidade || ""} onChange={(e) => upd(i, "quantidade", e.target.value)} className={`${inputCls} text-right`} /></td>
                    <td className="px-1 py-1"><Input type="number" value={it.areaUnidadeM2 || ""} onChange={(e) => upd(i, "areaUnidadeM2", e.target.value)} className={`${inputCls} text-right`} /></td>
                    <td className="px-1 py-1"><Input type="number" value={it.precoM2 || ""} onChange={(e) => upd(i, "precoM2", e.target.value)} className={`${inputCls} text-right`} /></td>
                    <td className="px-1 py-1 text-right text-white font-bold">{r ? fmtBRL(r.vgv) : "—"}</td>
                    <td className="px-1 py-1">
                      <button type="button" onClick={() => removerItem(i)} className="text-gray-500 hover:text-red-400 flex justify-center"><Trash2 className="h-4 w-4" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={addItem} className="flex items-center gap-1 text-xs font-bold text-[#C9A961]">
          <Plus className="h-3.5 w-3.5" /> Adicionar produto
        </button>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-[#C9A961]/10">
          <Metric label="Total de unidades" valor={String(resultado.totalUnidades)} />
          <Metric label="Área vendida" valor={`${resultado.areaVendidaM2.toLocaleString("pt-BR")} m²`} />
          <Metric label="VGV total" valor={fmtBRL(resultado.vgv)} destaque />
          <Metric label="Preço médio/unidade" valor={fmtBRL(resultado.precoMedioUnidade)} />
        </div>

        <Button onClick={() => saveMutation.mutate({ id: estudoId, dataJson: JSON.stringify(mixAtual) })}
          disabled={saveMutation.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
          {saveMutation.isPending ? "Salvando..." : "Salvar mix de produtos"}
        </Button>
      </CardContent>
    </Card>
  );
}

function novaVenda(): VendaLancamento {
  return { id: Math.random().toString(36).slice(2), unidade: "", valorVenda: 0 };
}

function LancamentoVendas({ estudoId, realEstateLaunchJson, mixAtual }: { estudoId: number; realEstateLaunchJson: string | null; mixAtual: ItemMixProduto[] }) {
  const utils = trpc.useUtils();
  const [vendas, setVendas] = useState<VendaLancamento[]>(() => {
    if (realEstateLaunchJson) {
      try { return (JSON.parse(realEstateLaunchJson) as { vendas?: VendaLancamento[] }).vendas ?? []; } catch { /* vazio */ }
    }
    return [];
  });

  const saveMutation = trpc.incorporacao.saveLancamentoImobiliario.useMutation({
    onSuccess: () => { toast.success("Lançamento salvo!"); utils.incorporacao.getById.invalidate({ id: estudoId }); },
    onError: (e) => toast.error(e.message),
  });

  const projecao = useMemo(() => {
    const r = calcularMix(mixAtual);
    return { totalUnidades: r.totalUnidades > 0 ? r.totalUnidades : null, vgv: r.vgv > 0 ? r.vgv : null };
  }, [mixAtual]);

  const resumo = useMemo(() => resumoLancamentoImobiliario(vendas, projecao.totalUnidades, projecao.vgv), [vendas, projecao]);

  function addVenda() { setVendas((l) => [...l, novaVenda()]); }
  function removerVenda(id: string) { setVendas((l) => l.filter((v) => v.id !== id)); }
  function upd<K extends keyof VendaLancamento>(id: string, campo: K, valor: VendaLancamento[K]) {
    setVendas((l) => l.map((v) => (v.id === id ? { ...v, [campo]: valor } : v)));
  }

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <PartyPopper className="h-5 w-5 text-[#C9A961]" /> Lançamento Imobiliário
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-400 max-w-2xl">
          Registre as vendas realizadas no evento de lançamento. A comparação com o mix projetado acima vem
          automaticamente{projecao.totalUnidades ? `: ${projecao.totalUnidades} unidades / ${fmtBRL(projecao.vgv ?? 0)}` : ", quando o mix estiver preenchido"}.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metric label="Unidades vendidas" valor={String(resumo.unidadesVendidas)} />
          <Metric label="VGV vendido" valor={fmtBRL(resumo.vgvVendido)} />
          <Metric label="% unidades vs. projetado" valor={resumo.pctUnidadesVendidas != null ? `${resumo.pctUnidadesVendidas}%` : "—"} />
          <Metric label="% VGV vs. projetado" valor={resumo.pctVgvVendido != null ? `${resumo.pctVgvVendido}%` : "—"} destaque />
        </div>

        <div className="overflow-x-auto">
          <table className="text-xs min-w-[600px] w-full">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-32">Unidade</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-44">Comprador</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-32">Valor (R$)</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-32">Data</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {vendas.map((v) => (
                <tr key={v.id}>
                  <td className="px-1 py-1"><Input value={v.unidade} onChange={(e) => upd(v.id, "unidade", e.target.value)} className={inputCls} placeholder="Ex.: Lote 12" /></td>
                  <td className="px-1 py-1"><Input value={v.comprador ?? ""} onChange={(e) => upd(v.id, "comprador", e.target.value)} className={inputCls} placeholder="Nome do comprador" /></td>
                  <td className="px-1 py-1"><Input type="number" value={v.valorVenda || ""} onChange={(e) => upd(v.id, "valorVenda", parseFloat(e.target.value) || 0)} className={`${inputCls} text-right`} /></td>
                  <td className="px-1 py-1"><Input type="date" value={v.data ?? ""} onChange={(e) => upd(v.id, "data", e.target.value)} className={inputCls} /></td>
                  <td className="px-1 py-1">
                    <button type="button" onClick={() => removerVenda(v.id)} className="text-gray-500 hover:text-red-400 flex justify-center"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={addVenda} className="flex items-center gap-1 text-xs font-bold text-[#C9A961]">
            <Plus className="h-3.5 w-3.5" /> Adicionar venda
          </button>
          <Button onClick={() => saveMutation.mutate({ id: estudoId, dataJson: JSON.stringify({ vendas }) })}
            disabled={saveMutation.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold ml-auto">
            {saveMutation.isPending ? "Salvando..." : "Salvar lançamento"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
