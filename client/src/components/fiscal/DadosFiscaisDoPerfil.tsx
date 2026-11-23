// EPIC-029 S-2 — "Dados fiscais do perfil": o complemento fiscal de cada perfil tributário que JÁ existe na aba.
// Empresa, CNPJ e regime NÃO se digitam aqui: vêm do perfil (mudou? "Configurar tributação"). Só o que o perfil não tem:
// município do emissor, inscrição municipal e série. O ambiente fica "desligado" até a homologação (S-4).
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencyInput } from "@/components/ui/currency-input";
import { formatCurrency } from "@/lib/format";
import { SEDE } from "@shared/empresa";

const REGIMES: Record<string, string> = {
  simples_nacional: "Simples Nacional", lucro_presumido: "Lucro Presumido", lucro_real: "Lucro Real", ret: "RET", outro: "Outro",
};
const AMBIENTE: Record<string, string> = { desligado: "desligado (sem emissão)", producao_restrita: "produção restrita", producao: "produção" };

const mesBr = (m: string | null) => (m ? m.split("-").reverse().join("/") : "—");
const dataBr = (d: string | null) => (d ? d.split("-").reverse().join("/") : "não informado");

function formatarCnpj(c: string) {
  return c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c;
}

export function DadosFiscaisDoPerfil({ podeEditar }: { podeEditar: boolean }) {
  const utils = trpc.useUtils();
  const { data: perfis = [] } = trpc.fiscal.emissores.listar.useQuery();
  const [form, setForm] = useState<{ cnpj: string; titulo: string; municipioNome: string; municipioUf: string; municipioIbge: string; inscricaoMunicipal: string; serieDps: string } | null>(null);
  const salvar = trpc.fiscal.emissores.salvar.useMutation({
    onSuccess: () => {
      toast.success("Dados fiscais salvos.");
      setForm(null);
      void utils.fiscal.emissores.listar.invalidate();
      void utils.fiscal.emissoresComPerfil.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  // S-8: folha dos 12 meses (Fator R) e início de atividade — da EMPRESA (raiz do CNPJ: vale para matriz e filiais).
  const [simples, setSimples] = useState<{ cnpj: string; titulo: string; folha: number; folhaAte: string; inicioAtividade: string } | null>(null);
  const salvarSimples = trpc.fiscal.emissores.salvarSimples.useMutation({
    onSuccess: () => {
      toast.success("Dados do Simples salvos.");
      setSimples(null);
      void utils.fiscal.emissores.listar.invalidate();
      void utils.fiscal.notas.aliquotaSimples.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  return (
    <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
      <CardHeader><CardTitle className="text-[#C9A961]">Dados fiscais do perfil</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {!perfis.length ? (
          <p className="text-sm text-gray-400">Cadastre o perfil tributário com o CNPJ da empresa ("Configurar tributação") para completar os dados fiscais.</p>
        ) : perfis.map(p => (
          <div key={p.cnpj} className="flex flex-wrap items-center justify-between gap-2 rounded bg-[#1A2332] p-3">
            <div>
              <p className="font-medium text-white">{p.razaoSocial} <span className="text-xs text-gray-400">{formatarCnpj(p.cnpj)} • {REGIMES[p.regime] ?? p.regime}</span></p>
              <p className="text-xs text-gray-400">
                {p.emissor
                  ? `Município ${p.emissor.municipioNome ?? "—"}/${p.emissor.municipioUf ?? ""} • inscrição municipal ${p.emissor.inscricaoMunicipal ?? "a preencher"} • série ${p.emissor.serieDps ?? "a preencher"} • ambiente ${AMBIENTE[p.emissor.ambiente] ?? p.emissor.ambiente}`
                  : "Dados fiscais ainda não preenchidos."}
              </p>
              {p.regime === "simples_nacional" && (
                <p className="text-xs text-gray-400">
                  Simples (empresa toda): folha dos 12 meses {p.simples?.folha12mCentavos != null ? `${formatCurrency(p.simples.folha12mCentavos / 100)} até ${mesBr(p.simples.folhaAte)}`
                    : p.simples?.folhaOculta ? `informada até ${mesBr(p.simples.folhaAte)}` : "a informar (Fator R usa o Anexo V)"}
                  {" • "}início de atividade {dataBr(p.simples?.inicioAtividade ?? null)}
                </p>
              )}
            </div>
            {podeEditar && (
              <Button size="sm" variant="outline" onClick={() => setForm({
                cnpj: p.cnpj, titulo: p.razaoSocial,
                municipioNome: p.emissor?.municipioNome ?? SEDE.cidade, municipioUf: p.emissor?.municipioUf ?? SEDE.uf,
                municipioIbge: p.emissor?.municipioIbge ?? "", inscricaoMunicipal: p.emissor?.inscricaoMunicipal ?? "", serieDps: p.emissor?.serieDps ?? "",
              })}>{p.emissor ? "Editar dados fiscais" : "Preencher dados fiscais"}</Button>
            )}
            {podeEditar && p.regime === "simples_nacional" && (
              <Button size="sm" variant="outline" onClick={() => setSimples({
                cnpj: p.cnpj, titulo: p.razaoSocial, folha: (p.simples?.folha12mCentavos ?? 0) / 100,
                folhaAte: p.simples?.folhaAte ?? "", inicioAtividade: p.simples?.inicioAtividade ?? "",
              })}>Folha e início (Simples)</Button>
            )}
          </div>
        ))}
      </CardContent>

      <Dialog open={Boolean(form)} onOpenChange={o => !o && setForm(null)}>
        <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white">
          <DialogHeader><DialogTitle className="text-[#C9A961]">Dados fiscais — {form?.titulo}</DialogTitle></DialogHeader>
          {form && (
            <div className="grid gap-3 sm:grid-cols-[1fr_5rem]">
              <p className="sm:col-span-2 text-xs text-gray-400">Empresa, CNPJ e regime vêm do perfil tributário (não se digitam de novo).</p>
              <div>
                <Label htmlFor="fiscal-em-mun">Município do emissor *</Label>
                <Input id="fiscal-em-mun" value={form.municipioNome} onChange={e => setForm({ ...form, municipioNome: e.target.value })} className="mt-1 bg-[#2C3E50]" />
              </div>
              <div>
                <Label htmlFor="fiscal-em-uf">UF *</Label>
                <Input id="fiscal-em-uf" maxLength={2} value={form.municipioUf} onChange={e => setForm({ ...form, municipioUf: e.target.value.toUpperCase() })} className="mt-1 bg-[#2C3E50]" />
              </div>
              <div>
                <Label htmlFor="fiscal-em-ibge">Código IBGE do município</Label>
                <Input id="fiscal-em-ibge" inputMode="numeric" maxLength={7} value={form.municipioIbge} onChange={e => setForm({ ...form, municipioIbge: e.target.value.replace(/\D/g, "") })} className="mt-1 bg-[#2C3E50]" />
              </div>
              <div>
                <Label htmlFor="fiscal-em-serie">Série</Label>
                <Input id="fiscal-em-serie" inputMode="numeric" maxLength={5} value={form.serieDps} onChange={e => setForm({ ...form, serieDps: e.target.value.replace(/\D/g, "") })} className="mt-1 bg-[#2C3E50]" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="fiscal-em-im">Inscrição municipal</Label>
                <Input id="fiscal-em-im" maxLength={30} value={form.inscricaoMunicipal} onChange={e => setForm({ ...form, inscricaoMunicipal: e.target.value })} className="mt-1 bg-[#2C3E50]" />
              </div>
              <p className="sm:col-span-2 text-xs text-gray-400">Ambiente: desligado até a homologação (nenhuma nota é emitida nesta etapa).</p>
              <Button className="sm:col-span-2 bg-[#C9A961] text-[#1A2332]" disabled={salvar.isPending || form.municipioNome.trim().length < 2 || form.municipioUf.length !== 2}
                onClick={() => salvar.mutate({
                  cnpj: form.cnpj, municipioNome: form.municipioNome, municipioUf: form.municipioUf,
                  municipioIbge: form.municipioIbge || null, inscricaoMunicipal: form.inscricaoMunicipal || null, serieDps: form.serieDps || null,
                })}>Salvar dados fiscais</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(simples)} onOpenChange={o => !o && setSimples(null)}>
        <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white">
          <DialogHeader><DialogTitle className="text-[#C9A961]">Simples — {simples?.titulo}</DialogTitle></DialogHeader>
          {simples && (
            <div className="grid gap-3 sm:grid-cols-2">
              <p className="sm:col-span-2 text-xs text-gray-400">
                Vale para a empresa toda (matriz e filiais). A folha decide o Fator R dos serviços de cAtvSN 9: 28% ou mais da receita dos 12 meses → Anexo III; abaixo → Anexo V.
                Sem folha (ou desatualizada), o sistema usa o Anexo V, o lado de pagar mais.
              </p>
              <div>
                <Label htmlFor="fiscal-sn-folha">Folha dos 12 meses (salários, pró-labore, FGTS e INSS patronal)</Label>
                <CurrencyInput id="fiscal-sn-folha" value={simples.folha} onChange={v => setSimples({ ...simples, folha: v })} className="mt-1 bg-[#2C3E50]" />
              </div>
              <div>
                <Label htmlFor="fiscal-sn-ate">Último mês incluído na folha</Label>
                <Input id="fiscal-sn-ate" type="month" value={simples.folhaAte} onChange={e => setSimples({ ...simples, folhaAte: e.target.value })} className="mt-1 bg-[#2C3E50]" />
              </div>
              <p className="sm:col-span-2 text-xs text-gray-400">A folha vale para as notas do mês seguinte ao último mês incluído (ex.: folha até 10/2026 → notas de 11/2026).</p>
              <div className="sm:col-span-2">
                <Label htmlFor="fiscal-sn-inicio">Início de atividade (para empresa com menos de 12 meses)</Label>
                <Input id="fiscal-sn-inicio" type="date" value={simples.inicioAtividade} onChange={e => setSimples({ ...simples, inicioAtividade: e.target.value })} className="mt-1 bg-[#2C3E50]" />
              </div>
              <Button className="sm:col-span-2 bg-[#C9A961] text-[#1A2332]" disabled={salvarSimples.isPending || (simples.folha > 0 && !simples.folhaAte)}
                onClick={() => {
                  const temFolha = Boolean(simples.folhaAte);
                  salvarSimples.mutate({
                    cnpj: simples.cnpj,
                    folha12mCentavos: temFolha ? Math.round(simples.folha * 100) : null,
                    folhaAte: temFolha ? simples.folhaAte : null,
                    inicioAtividade: simples.inicioAtividade || null,
                  });
                }}>Salvar</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
