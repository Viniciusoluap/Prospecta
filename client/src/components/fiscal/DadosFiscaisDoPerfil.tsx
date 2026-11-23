// EPIC-029 S-2 — "Dados fiscais do perfil": o complemento fiscal de cada perfil tributário que JÁ existe na aba.
// Empresa, CNPJ e regime NÃO se digitam aqui: vêm do perfil (mudou? "Configurar tributação"). Só o que o perfil não tem:
// município do emissor, inscrição municipal e série. S-7: troca do ambiente (produção só com a frase "EMITIR EM PRODUÇÃO",
// conferida no servidor) e os códigos da empresa para a nota (opSimpNac, regApTribSN, regEspTrib).
// 23/11/2026: "Liberar emissão desta empresa" (só admin; frase "LIBERAR EMISSÃO" digitada, conferida no servidor) e
// "Desligar emissão" (um clique com confirmação simples). QA 23/11: trocar o ambiente desliga a emissão; liberar em produção
// pede também "EMITIR EM PRODUÇÃO"; o diálogo mostra as últimas mudanças (quem/quando) do histórico imutável (0172).
const CAMPO_HIST: Record<string, string> = { emissao_liberada: "emissão", ambiente: "ambiente", ativo: "ativa" };
const valorHist = (campo: string, v: string | null) =>
  campo === "ambiente" ? (AMBIENTE_CURTO[v ?? ""] ?? v ?? "—") : v === "true" ? (campo === "ativo" ? "sim" : "liberada") : v === "false" ? (campo === "ativo" ? "não" : "desligada") : "—";
const AMBIENTE_CURTO: Record<string, string> = { desligado: "desligado", producao_restrita: "produção restrita", producao: "produção" };
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
import { FRASE_LIBERAR_EMISSAO, FRASE_PRODUCAO, fraseConfere } from "@shared/fiscal/status";

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
  const [amb, setAmb] = useState<{ emissorId: number; titulo: string; ambiente: "desligado" | "producao_restrita" | "producao"; frase: string } | null>(null);
  const [cod, setCod] = useState<{ emissorId: number; titulo: string; opSimpNac: string; regApTribSN: string; regEspTrib: string } | null>(null);
  const invalidarTudo = () => { void utils.fiscal.emissores.listar.invalidate(); void utils.fiscal.emissoresComPerfil.invalidate(); void utils.fiscal.notas.listar.invalidate(); void utils.fiscal.emissores.historico.invalidate(); };
  const trocarAmbiente = trpc.fiscal.emissores.ambiente.useMutation({ onSuccess: () => { toast.success("Ambiente trocado. A emissão desta empresa foi desligada: libere de novo para emitir."); setAmb(null); invalidarTudo(); }, onError: e => toast.error(e.message) });
  // Interruptor da emissão da empresa (2ª trava). Ligar pede a frase; desligar, só a confirmação.
  const [liberar, setLiberar] = useState<{ emissorId: number; titulo: string; ambiente: string; frase: string; fraseProducao: string } | null>(null);
  const historico = trpc.fiscal.emissores.historico.useQuery({ emissorId: liberar?.emissorId ?? 0 }, { enabled: Boolean(liberar) });
  const liberarEmissao = trpc.fiscal.emissores.liberarEmissao.useMutation({
    onSuccess: r => { toast.success(r.emissaoLiberada ? "Emissão desta empresa liberada." : "Emissão desta empresa desligada."); setLiberar(null); invalidarTudo(); },
    onError: e => toast.error(e.message),
  });
  const salvarCod = trpc.fiscal.emissores.parametros.useMutation({ onSuccess: () => { toast.success("Códigos salvos."); setCod(null); invalidarTudo(); }, onError: e => toast.error(e.message) });
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
                  ? `Município ${p.emissor.municipioNome ?? "—"}/${p.emissor.municipioUf ?? ""} • inscrição municipal ${p.emissor.inscricaoMunicipal ?? "a preencher"} • série ${p.emissor.serieDps ?? "1 (padrão do aplicativo próprio)"} • ambiente ${AMBIENTE[p.emissor.ambiente] ?? p.emissor.ambiente} • emissão ${p.emissor.emissaoLiberada ? "liberada" : "não liberada"}`
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
            {podeEditar && p.emissor && (
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="outline" onClick={() => setAmb({ emissorId: p.emissor!.id, titulo: p.razaoSocial, ambiente: p.emissor!.ambiente, frase: "" })}>Ambiente</Button>
                {p.emissor.emissaoLiberada ? (
                  <Button size="sm" variant="outline" className="border-red-500/40 text-red-200" disabled={liberarEmissao.isPending}
                    onClick={() => {
                      if (window.confirm(`Desligar a emissão de notas de ${p.razaoSocial}? Envios já em andamento terminam; depois disso, enquanto estiver desligada, nenhuma nota desta empresa é emitida nem cancelada.`)) {
                        liberarEmissao.mutate({ emissorId: p.emissor!.id, liberar: false });
                      }
                    }}>Desligar emissão</Button>
                ) : (
                  <Button size="sm" variant="outline" className="border-[#C9A961]/40 text-[#C9A961]"
                    onClick={() => setLiberar({ emissorId: p.emissor!.id, titulo: p.razaoSocial, ambiente: p.emissor!.ambiente, frase: "", fraseProducao: "" })}>Liberar emissão desta empresa</Button>
                )}
                <Button size="sm" variant="outline" onClick={() => {
                  const c = (p.emissor!.parametrosDps ?? {}) as Record<string, string | null>;
                  setCod({ emissorId: p.emissor!.id, titulo: p.razaoSocial, opSimpNac: c.opSimpNac ?? "", regApTribSN: c.regApTribSN ?? "", regEspTrib: c.regEspTrib ?? "" });
                }}>Códigos da empresa</Button>
              </div>
            )}
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
              <p className="sm:col-span-2 text-xs text-gray-400">Série vazia = "1", a padrão do aplicativo próprio (faixa 1 a 49999). O ambiente se troca no botão "Ambiente".</p>
              <Button className="sm:col-span-2 bg-[#C9A961] text-[#1A2332]" disabled={salvar.isPending || form.municipioNome.trim().length < 2 || form.municipioUf.length !== 2}
                onClick={() => salvar.mutate({
                  cnpj: form.cnpj, municipioNome: form.municipioNome, municipioUf: form.municipioUf,
                  municipioIbge: form.municipioIbge || null, inscricaoMunicipal: form.inscricaoMunicipal || null, serieDps: form.serieDps || null,
                })}>Salvar dados fiscais</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(amb)} onOpenChange={o => !o && setAmb(null)}>
        <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white">
          <DialogHeader><DialogTitle className="text-[#C9A961]">Ambiente de emissão — {amb?.titulo}</DialogTitle></DialogHeader>
          {amb && (
            <div className="space-y-3">
              <select aria-label="Ambiente" value={amb.ambiente} onChange={e => setAmb({ ...amb, ambiente: e.target.value as typeof amb.ambiente, frase: "" })} className="w-full rounded border border-gray-600 bg-[#2C3E50] p-2 text-sm text-white">
                <option value="desligado">Desligado (nada sai do sistema)</option>
                <option value="producao_restrita">Produção restrita — AMBIENTE DE TESTES, SEM VALOR FISCAL</option>
                <option value="producao">Produção — notas COM valor fiscal</option>
              </select>
              {amb.ambiente === "producao" && (
                <div>
                  <p role="alert" className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-100">As notas passam a valer de verdade. Para confirmar, digite: <b>EMITIR EM PRODUÇÃO</b></p>
                  <Input aria-label="Frase de confirmação" value={amb.frase} onChange={e => setAmb({ ...amb, frase: e.target.value })} className="mt-2 bg-[#2C3E50]" />
                </div>
              )}
              <p role="alert" className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-100">Ao trocar o ambiente, a emissão desta empresa é desligada; libere de novo depois ("Liberar emissão desta empresa").</p>
              <Button className="w-full bg-[#C9A961] text-[#1A2332]" disabled={trocarAmbiente.isPending || (amb.ambiente === "producao" && !fraseConfere(amb.frase, FRASE_PRODUCAO))}
                onClick={() => trocarAmbiente.mutate({ emissorId: amb.emissorId, ambiente: amb.ambiente, ...(amb.ambiente === "producao" ? { frase: amb.frase.trim() } : {}) })}>Salvar ambiente</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(liberar)} onOpenChange={o => !o && setLiberar(null)}>
        <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white">
          <DialogHeader><DialogTitle className="text-[#C9A961]">Liberar emissão — {liberar?.titulo}</DialogTitle></DialogHeader>
          {liberar && (
            <div className="space-y-3">
              <p className="text-sm text-gray-200">Com a emissão liberada, o botão "Emitir" das notas desta empresa passa a enviar a nota para a Sefin Nacional.</p>
              <p className="text-xs text-gray-400">
                Ambiente desta empresa agora: <b>{AMBIENTE[liberar.ambiente] ?? liberar.ambiente}</b>.
                {liberar.ambiente === "desligado" ? " Enquanto o ambiente estiver desligado, nada sai, mesmo com a emissão liberada." : liberar.ambiente === "producao" ? " Em produção as notas valem de verdade (têm valor fiscal)." : " Em produção restrita as notas são de teste, sem valor fiscal."}
              </p>
              <div>
                <p role="alert" className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-100">Para confirmar, digite: <b>{FRASE_LIBERAR_EMISSAO}</b></p>
                <Input aria-label="Frase para liberar a emissão" value={liberar.frase} onChange={e => setLiberar({ ...liberar, frase: e.target.value })} className="mt-2 bg-[#2C3E50]" />
              </div>
              {liberar.ambiente === "producao" && (
                <div>
                  <p role="alert" className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-100">Esta empresa está em PRODUÇÃO: as notas saem COM VALOR FISCAL. Para confirmar, digite também: <b>{FRASE_PRODUCAO}</b></p>
                  <Input aria-label="Frase de produção" value={liberar.fraseProducao} onChange={e => setLiberar({ ...liberar, fraseProducao: e.target.value })} className="mt-2 bg-[#2C3E50]" />
                </div>
              )}
              <p className="text-xs text-gray-400">Para parar depois, use "Desligar emissão" (não pede frase). Trocar o ambiente também desliga a emissão: aí é preciso liberar de novo.</p>
              <Button className="w-full bg-[#C9A961] text-[#1A2332]"
                disabled={liberarEmissao.isPending || !fraseConfere(liberar.frase, FRASE_LIBERAR_EMISSAO) || (liberar.ambiente === "producao" && !fraseConfere(liberar.fraseProducao, FRASE_PRODUCAO))}
                onClick={() => liberarEmissao.mutate({
                  emissorId: liberar.emissorId, liberar: true, frase: liberar.frase.trim(),
                  ...(liberar.ambiente === "producao" ? { fraseProducao: liberar.fraseProducao.trim() } : {}),
                })}>Liberar emissão desta empresa</Button>
              {Boolean(historico.data?.length) && (
                <div className="border-t border-gray-700 pt-2">
                  <p className="text-xs font-medium text-gray-300">Últimas mudanças</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-gray-400">
                    {historico.data!.map(h => (
                      <li key={h.id}>{new Date(h.criadoEm).toLocaleString("pt-BR")} — {h.quem ?? "sistema"}: {CAMPO_HIST[h.campo] ?? h.campo} {valorHist(h.campo, h.de)} → {valorHist(h.campo, h.para)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(cod)} onOpenChange={o => !o && setCod(null)}>
        <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white">
          <DialogHeader><DialogTitle className="text-[#C9A961]">Códigos da empresa para a nota — {cod?.titulo}</DialogTitle></DialogHeader>
          {cod && (
            <div className="grid gap-3">
              <p className="text-xs text-gray-400">Códigos do leiaute nacional definidos pelo contador (só números).</p>
              {([["opSimpNac", "Situação no Simples (opSimpNac)"], ["regApTribSN", "Apuração do Simples (regApTribSN)"], ["regEspTrib", "Regime especial (regEspTrib)"]] as const).map(([k, r]) => (
                <div key={k}>
                  <Label htmlFor={`fiscal-cod-${k}`}>{r}</Label>
                  <Input id={`fiscal-cod-${k}`} inputMode="numeric" maxLength={1} value={cod[k]} onChange={e => setCod({ ...cod, [k]: e.target.value.replace(/\D/g, "") })} className="mt-1 bg-[#2C3E50]" />
                </div>
              ))}
              <Button className="bg-[#C9A961] text-[#1A2332]" disabled={salvarCod.isPending}
                onClick={() => salvarCod.mutate({ emissorId: cod.emissorId, opSimpNac: cod.opSimpNac || null, regApTribSN: cod.regApTribSN || null, regEspTrib: cod.regEspTrib || null })}>Salvar códigos</Button>
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
