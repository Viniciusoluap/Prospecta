// EPIC-029 S-2 — "Tipos de serviço": códigos e alíquotas do contador (nascem "a preencher") e o que fazer com cada origem.
// Regra só "sempre perguntar" ou "nunca gerar rascunho" (decisão h: "automático" não existe nesta etapa). Edição só do admin.
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PercentInput } from "@/components/ui/percent-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ROTULO_ORIGEM, type OrigemNota } from "@shared/fiscal/origens";

const A_PREENCHER = "a preencher pelo contador";
const REGRA = { sempre_perguntar: "Sempre perguntar", nunca_gerar: "Nunca gerar rascunho" } as const;

function rotuloOrigem(chave: string) {
  const [origem, sub] = chave.split(":");
  const base = ROTULO_ORIGEM[origem as OrigemNota] ?? origem;
  return sub && sub !== "*" ? `${base} (${sub.replace(/_/g, " ")})` : base;
}

type Form = {
  id: number; nome: string; emissorId: string; codigoTributacaoNacional: string; codigoNbs: string; itemLc116: string;
  descricaoPadrao: string; aliquotaIss: number | null; regra: keyof typeof REGRA; origens: string[]; ativo: boolean;
};

export function TiposServico({ podeEditar }: { podeEditar: boolean }) {
  const utils = trpc.useUtils();
  const { data: tipos = [] } = trpc.fiscal.tipos.listar.useQuery();
  const { data: emissores = [] } = trpc.fiscal.emissoresComPerfil.useQuery();
  const [form, setForm] = useState<Form | null>(null);
  const salvar = trpc.fiscal.tipos.salvar.useMutation({
    onSuccess: () => { toast.success("Tipo de serviço salvo."); setForm(null); void utils.fiscal.tipos.listar.invalidate(); },
    onError: e => toast.error(e.message),
  });

  return (
    <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
      <CardHeader><CardTitle className="text-[#C9A961]">Tipos de serviço</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-gray-400">Códigos e alíquotas são validados pelo contador. Sem eles a nota não poderá ser emitida (etapa de homologação).</p>
        {tipos.map(t => (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-[#1A2332] p-3">
            <div className="min-w-0">
              <p className="font-medium text-white">{t.nome}{!t.ativo && <span className="ml-2 text-xs text-gray-400">(inativo)</span>}</p>
              <p className="text-xs text-gray-400">
                {REGRA[t.regra]} • trib. nacional {t.codigoTributacaoNacional ?? A_PREENCHER} • LC 116 {t.itemLc116 ?? A_PREENCHER} • NBS {t.codigoNbs ?? A_PREENCHER} •
                ISS {t.aliquotaIss != null ? `${Number(t.aliquotaIss).toLocaleString("pt-BR")}%` : A_PREENCHER}
              </p>
              <p className="text-xs text-gray-500">Origens: {(t.origens ?? []).map(rotuloOrigem).join(", ") || "nenhuma"}</p>
            </div>
            {podeEditar && (
              <Button size="sm" variant="outline" onClick={() => setForm({
                id: t.id, nome: t.nome, emissorId: t.emissorId ? String(t.emissorId) : "", codigoTributacaoNacional: t.codigoTributacaoNacional ?? "",
                codigoNbs: t.codigoNbs ?? "", itemLc116: t.itemLc116 ?? "", descricaoPadrao: t.descricaoPadrao ?? "",
                aliquotaIss: t.aliquotaIss != null ? Number(t.aliquotaIss) : null, regra: t.regra, origens: t.origens ?? [], ativo: t.ativo,
              })}>Editar</Button>
            )}
          </div>
        ))}
      </CardContent>

      <Dialog open={Boolean(form)} onOpenChange={o => !o && setForm(null)}>
        <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white sm:max-w-2xl">
          <DialogHeader><DialogTitle className="text-[#C9A961]">Tipo de serviço</DialogTitle></DialogHeader>
          {form && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="fiscal-tipo-nome">Nome *</Label>
                <Input id="fiscal-tipo-nome" maxLength={120} value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} className="mt-1 bg-[#2C3E50]" />
              </div>
              <div>
                <Label>O que fazer com cada recebimento</Label>
                <Select value={form.regra} onValueChange={v => setForm({ ...form, regra: v as Form["regra"] })}>
                  <SelectTrigger className="mt-1 bg-[#2C3E50]"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(REGRA).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Empresa emissora padrão</Label>
                <Select value={form.emissorId || "nenhum"} onValueChange={v => setForm({ ...form, emissorId: v === "nenhum" ? "" : v })}>
                  <SelectTrigger className="mt-1 bg-[#2C3E50]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nenhum">Escolher em cada nota</SelectItem>
                    {emissores.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.razaoSocial ?? e.cnpj}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="fiscal-tipo-ctn">Código de tributação nacional</Label>
                <Input id="fiscal-tipo-ctn" inputMode="numeric" maxLength={6} placeholder={A_PREENCHER} value={form.codigoTributacaoNacional} onChange={e => setForm({ ...form, codigoTributacaoNacional: e.target.value.replace(/\D/g, "") })} className="mt-1 bg-[#2C3E50]" />
              </div>
              <div>
                <Label htmlFor="fiscal-tipo-lc">Item da LC 116</Label>
                <Input id="fiscal-tipo-lc" maxLength={5} placeholder="ex.: 7.02" value={form.itemLc116} onChange={e => setForm({ ...form, itemLc116: e.target.value })} className="mt-1 bg-[#2C3E50]" />
              </div>
              <div>
                <Label htmlFor="fiscal-tipo-nbs">Código NBS</Label>
                <Input id="fiscal-tipo-nbs" inputMode="numeric" maxLength={9} placeholder={A_PREENCHER} value={form.codigoNbs} onChange={e => setForm({ ...form, codigoNbs: e.target.value.replace(/\D/g, "") })} className="mt-1 bg-[#2C3E50]" />
              </div>
              <div>
                <Label>Alíquota de ISS (%)</Label>
                <PercentInput maximumFractionDigits={4} value={form.aliquotaIss ?? 0} onChange={v => setForm({ ...form, aliquotaIss: v ? Number(v) : null })} className="mt-1 bg-[#2C3E50]" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="fiscal-tipo-desc">Descrição padrão</Label>
                <Textarea id="fiscal-tipo-desc" maxLength={2000} value={form.descricaoPadrao} onChange={e => setForm({ ...form, descricaoPadrao: e.target.value })} className="mt-1 bg-[#2C3E50]" />
              </div>
              <label className="sm:col-span-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.ativo} onChange={e => setForm({ ...form, ativo: e.target.checked })} /> Ativo
              </label>
              <p className="sm:col-span-2 text-xs text-gray-400">Origens ligadas: {form.origens.map(rotuloOrigem).join(", ") || "nenhuma"}.</p>
              <Button className="sm:col-span-2 bg-[#C9A961] text-[#1A2332]" disabled={salvar.isPending || form.nome.trim().length < 2}
                onClick={() => salvar.mutate({
                  id: form.id, nome: form.nome, emissorId: form.emissorId ? Number(form.emissorId) : null,
                  codigoTributacaoNacional: form.codigoTributacaoNacional || null, codigoNbs: form.codigoNbs || null, itemLc116: form.itemLc116.trim() || null,
                  descricaoPadrao: form.descricaoPadrao || null, aliquotaIss: form.aliquotaIss, regra: form.regra, origens: form.origens, ativo: form.ativo,
                })}>Salvar tipo de serviço</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
