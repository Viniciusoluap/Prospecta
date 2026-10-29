// Lote 2, correção 03 (AD-06): aba "Gerador de PCI" do Editar Obra.
// Formulário por seções, pré-preenchido com os dados da obra/cliente/PCI vinculada,
// rascunho, geração da planilha (modelo oficial atual) + PDF e histórico com
// download das duas versões. Regras em shared/pci-gerador.ts; servidor em
// server/pci-gerador.ts. Gêmeo em Grupo-Santa-Fe/web/src/components/obras/gerador-pci.tsx.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Download, FileSpreadsheet, Loader2, RefreshCw, Save } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumeroInput } from "@/components/ui/numero-input";
import { comprimirImagem } from "@/lib/comprimir-imagem";
import { baixarArquivoEmPartes } from "@/lib/pci-gerador-arquivos";
import {
  CAMPOS_PCI,
  LIMITE_IMAGEM_PCI_BYTES,
  MAX_ETAPAS_PCI,
  SECOES_PCI,
  SERVICOS_CUSTO_PCI,
  SERVICO_OUTROS_PCI,
  analisarCronogramaPci,
  aplicarEngenheiroPci,
  calcularTotaisPci,
  errosPci,
  numeroPci,
  pendenciasPci,
  type CampoPci,
  type FormularioPci,
  type SecaoPci,
} from "@shared/pci-gerador";

const campoCls = "bg-[#1A2332] border-[#C9A961]/30 text-white placeholder:text-gray-500";
const botaoSec = "border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10";
const brl = (v: number, casas = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

type Engenheiro = { id: string; nome: string | null; email: string | null; telefone: string | null; crea: string | null; creaUf: string | null; engenheiro: boolean };

function Campo({ campo, valor, onChange }: { campo: CampoPci; valor: string | number | null; onChange: (v: string | number | null) => void }) {
  const id = `pci-${campo.id}`;
  let controle;
  if (campo.tipo === "lista") {
    // Lote 03, correção 07: lista do modelo oficial — grava a opção exata, mostra sem espaços nas pontas.
    const opcoes = campo.opcoes ?? [];
    const foraDaLista = valor !== null && valor !== "" && !opcoes.includes(String(valor));
    controle = (
      <select id={id} value={valor === null ? "" : String(valor)} onChange={(e) => onChange(e.target.value || null)} aria-invalid={foraDaLista || undefined}
        className={`w-full rounded-md border px-3 py-2 text-sm ${campoCls} ${foraDaLista ? "border-red-400" : ""}`}>
        <option value="">— selecione —</option>
        {foraDaLista && <option value={String(valor)} disabled>{String(valor)} (fora da lista oficial)</option>}
        {opcoes.map((o) => <option key={o} value={o}>{o.trim()}</option>)}
      </select>
    );
  } else if (campo.tipo === "numero" || campo.tipo === "inteiro") {
    controle = <NumeroInput id={id} value={numeroPci(valor)} onChange={onChange} casas={campo.tipo === "inteiro" ? 0 : 2} negativo={false} className={campoCls} />;
  } else if (campo.tipo === "data") {
    controle = <Input id={id} type="date" value={typeof valor === "string" ? valor : ""} onChange={(e) => onChange(e.target.value || null)} className={campoCls} />;
  } else {
    const placeholder = campo.tipo === "coordenada" ? (campo.id === "latitude" ? `05° 29' 18" S` : `47° 28' 30" W`) : campo.tipo === "cep" ? "00000-000" : undefined;
    controle = <Input id={id} value={valor === null ? "" : String(valor)} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={campoCls} />;
  }
  return (
    <div className={campo.largo ? "sm:col-span-2" : ""}>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-gray-300">{campo.rotulo}{campo.celula ? <span className="ml-1 text-[10px] text-gray-500">({campo.celula})</span> : null}</label>
      {controle}
    </div>
  );
}

function SeletorEngenheiro({ papel, form, setForm, engenheiros }: { papel: "rtp" | "rte"; form: FormularioPci; setForm: (f: FormularioPci) => void; engenheiros: Engenheiro[] }) {
  const atual = papel === "rtp" ? form.rtpEngenheiroId : form.rteEngenheiroId;
  return (
    <div className="sm:col-span-2">
      <label htmlFor={`pci-eng-${papel}`} className="mb-1 block text-xs font-semibold text-gray-300">Selecionar engenheiro (preenche nome, e-mail, telefone e CREA do perfil)</label>
      <select id={`pci-eng-${papel}`} value={atual ?? ""} className={`w-full rounded-md border px-3 py-2 text-sm ${campoCls}`}
        onChange={(e) => {
          const eng = engenheiros.find((x) => x.id === e.target.value) ?? null;
          setForm(aplicarEngenheiroPci(form, papel, eng?.id ?? null, eng));
          if (eng && !eng.crea) toast.warning(`${eng.nome ?? "Este usuário"} não tem CREA no perfil de Engenheiro: o registro ficou em branco. Complete em Configurações › Usuários.`);
        }}>
        <option value="">— digitar manualmente —</option>
        {engenheiros.map((e) => <option key={e.id} value={e.id}>{e.nome ?? e.email ?? `Usuário ${e.id}`}{e.crea ? ` — CREA${e.creaUf ? `-${e.creaUf}` : ""} ${e.crea}` : e.engenheiro ? " — sem CREA" : ""}</option>)}
      </select>
    </div>
  );
}

export function GeradorPciAba({ projectId }: { projectId: number }) {
  const utils = trpc.useUtils();
  const consulta = trpc.pciGerador.obter.useQuery({ projectId }, { refetchOnWindowFocus: false });
  const salvar = trpc.pciGerador.salvarRascunho.useMutation();
  const gerar = trpc.pciGerador.gerar.useMutation();
  const [form, setForm] = useState<FormularioPci | null>(null);
  const [carregandoAuto, setCarregandoAuto] = useState(false);
  const [baixando, setBaixando] = useState<string | null>(null);

  useEffect(() => {
    if (consulta.data && !form) setForm(consulta.data.formulario);
  }, [consulta.data, form]);

  const totais = useMemo(() => (form ? calcularTotaisPci(form) : null), [form]);
  const pendencias = useMemo(() => (form ? pendenciasPci(form) : []), [form]);
  // Lote 03, correção 06: validação do cronograma durante a digitação (o servidor valida de novo).
  const cronograma = useMemo(() => (form ? analisarCronogramaPci(form) : null), [form]);
  const erros = useMemo(() => (form ? errosPci(form, { paraGerar: false }) : []), [form]);

  if (consulta.isLoading || (!form && !consulta.error)) return <p role="status" className="text-slate-100">Carregando o Gerador de PCI…</p>;
  if (consulta.error || !consulta.data || !form) return <div role="alert" className="text-slate-100">{consulta.error?.message ?? "Erro ao carregar."} <button type="button" className="underline" onClick={() => consulta.refetch()}>Tentar novamente</button></div>;
  const d = consulta.data;

  const setCampo = (id: string, v: string | number | null) => setForm({ ...form, campos: { ...form.campos, [id]: v } });
  const prazo = Math.min(Math.max(Math.round(numeroPci(form.campos.prazoMeses) ?? 0), 0), MAX_ETAPAS_PCI);

  async function salvarRascunho() {
    try {
      await salvar.mutateAsync({ projectId, formulario: form });
      toast.success("Rascunho salvo.");
      await utils.pciGerador.obter.invalidate({ projectId });
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }

  async function recarregarAutomatico() {
    if (!confirm("Substituir o formulário pelos dados atuais da obra, do cliente e da PCI vinculada? O que foi digitado e não salvo será perdido.")) return;
    setCarregandoAuto(true);
    try {
      setForm(await utils.pciGerador.preencherAutomatico.fetch({ projectId }));
      toast.success("Dados automáticos carregados. Confira e salve o rascunho.");
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setCarregandoAuto(false); }
  }

  async function gerarPci() {
    try {
      const r = await gerar.mutateAsync({ projectId, formulario: form });
      toast.success("PCI gerada (planilha e PDF). Veja o histórico abaixo.");
      for (const a of r.avisos) toast.warning(a, { duration: 10000 });
      await utils.pciGerador.obter.invalidate({ projectId });
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }

  async function escolherImagem(arquivo: File | undefined) {
    if (!arquivo) return;
    try {
      const { dataUrl } = await comprimirImagem(arquivo, 1600, LIMITE_IMAGEM_PCI_BYTES);
      setForm((f) => (f ? { ...f, imagem: { tipo: "jpeg", base64: dataUrl.split(",")[1] } } : f));
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }

  async function baixar(id: number, tipo: "planilha" | "pdf", nome: string) {
    setBaixando(`${id}-${tipo}`);
    try { await baixarArquivoEmPartes(`/api/obras/${projectId}/pci-geradas/${id}/${tipo}`, nome); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBaixando(null); }
  }

  const secaoCampos = (secao: SecaoPci) => CAMPOS_PCI.filter((c) => c.secao === secao && (!c.visivel || c.visivel(form.campos))).map((c) => <Campo key={c.id} campo={c} valor={form.campos[c.id] ?? null} onChange={(v) => setCampo(c.id, v)} />);
  const podeGerar = !!d.modelo && d.modelo.formato !== "xlsb";

  return (
    <section className="space-y-4 rounded-xl border border-[#C9A961]/30 bg-[#1A2332] p-5 text-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-[#C9A961]"><FileSpreadsheet className="h-5 w-5" /> Gerador de PCI</h2>
          <p className="text-sm text-slate-300">
            {d.modelo ? `Modelo atual: v${d.modelo.versao} — ${d.modelo.arquivo} (.${d.modelo.formato})` : "Sem modelo cadastrado."}
            {" · "}{d.origem === "rascunho" ? `Rascunho salvo em ${new Date(d.rascunhoEm!).toLocaleString("pt-BR")}${d.rascunhoAutor ? ` por ${d.rascunhoAutor}` : ""}` : "Pré-preenchido com os dados da obra, do cliente e da PCI vinculada."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className={botaoSec} disabled={carregandoAuto} onClick={recarregarAutomatico}>
            {carregandoAuto ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />} Dados automáticos
          </Button>
          <Button size="sm" variant="outline" className={botaoSec} disabled={salvar.isPending} onClick={salvarRascunho}>
            {salvar.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />} Salvar rascunho
          </Button>
          <Button size="sm" disabled={!podeGerar || gerar.isPending} onClick={gerarPci} className="bg-[#C9A961] font-bold text-[#1A2332] hover:bg-[#B8985A]">
            {gerar.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-1 h-4 w-4" />} Gerar PCI (planilha + PDF)
          </Button>
        </div>
      </div>
      {d.avisoModelo && <p role="alert" className="flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-sm text-yellow-100"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {d.avisoModelo}</p>}
      {erros.length > 0 && (
        <div role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-100">
          <p className="font-semibold">Corrija antes de salvar ou gerar:</p>
          <ul className="ml-5 mt-1 list-disc">{erros.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      {pendencias.length > 0 && (
        <details className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-2 text-sm text-yellow-100">
          <summary className="cursor-pointer">{pendencias.length} pendência(s) para conferir antes de enviar à CAIXA (não impedem gerar)</summary>
          <ul className="ml-5 mt-1 list-disc">{pendencias.map((p) => <li key={p}>{p}</li>)}</ul>
        </details>
      )}

      {SECOES_PCI.map((s) => (
        <details key={s.id} open={s.id === "proponente"} className="rounded-lg border border-[#C9A961]/20 bg-[#2C3E50]/40 p-3">
          <summary className="cursor-pointer font-semibold text-[#C9A961]">{s.titulo}</summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(s.id === "rtp" || s.id === "rte") && <SeletorEngenheiro papel={s.id} form={form} setForm={setForm} engenheiros={d.engenheiros} />}
            {secaoCampos(s.id)}
            {s.id === "custos" && totais && (
              <div className="sm:col-span-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-gray-400"><th className="p-1">Item</th><th className="p-1">Serviço</th><th className="p-1">Custo (R$)</th><th className="p-1 text-right">Incid. (%)</th></tr></thead>
                  <tbody>
                    {SERVICOS_CUSTO_PCI.map((nome, i) => (
                      <tr key={nome} className="border-t border-white/10">
                        <td className="p-1">{i + 1}</td><td className="p-1">{nome}</td>
                        <td className="p-1 min-w-[140px]"><NumeroInput aria-label={`Custo ${nome}`} value={form.custos[i]} negativo={false} className={campoCls}
                          onChange={(v) => setForm({ ...form, custos: form.custos.map((c, k) => (k === i ? v : c)) })} /></td>
                        <td className="p-1 text-right">{brl(totais.incidencias[i], 2)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-white/10"><td className="p-1">20</td><td className="p-1">{SERVICO_OUTROS_PCI}</td><td className="p-1">{brl(totais.outros)}</td><td className="p-1 text-right">{brl(totais.incidencias[19], 2)}</td></tr>
                  </tbody>
                  <tfoot className="font-semibold">
                    <tr><td /><td className="p-1">Custo total de serviços</td><td className="p-1">{brl(totais.totalServicos)}</td><td /></tr>
                    <tr><td /><td className="p-1">Custo total com BDI</td><td className="p-1">{brl(totais.totalComBdi)}</td><td /></tr>
                  </tfoot>
                </table>
                <p className="mt-3 text-xs font-semibold text-gray-300">Serviços adicionais (somam no item 20 "Outros")</p>
                {form.adicionais.map((a, i) => (
                  <div key={i} className="mt-1 grid grid-cols-[1fr_160px] gap-2">
                    <Input aria-label={`Serviço adicional ${i + 1}`} value={a.descricao} placeholder={`Serviço adicional ${i + 1}`} className={campoCls}
                      onChange={(e) => setForm({ ...form, adicionais: form.adicionais.map((x, k) => (k === i ? { ...x, descricao: e.target.value } : x)) })} />
                    <NumeroInput aria-label={`Custo do serviço adicional ${i + 1}`} value={a.valor} negativo={false} className={campoCls}
                      onChange={(v) => setForm({ ...form, adicionais: form.adicionais.map((x, k) => (k === i ? { ...x, valor: v } : x)) })} />
                  </div>
                ))}
              </div>
            )}
            {s.id === "cronograma" && (
              <div className="sm:col-span-2">
                {prazo < 1 ? <p className="text-sm text-gray-300">Informe o prazo (meses) para montar o cronograma.</p> : (
                  <div className="overflow-x-auto">
                    <p className="mb-2 text-xs text-gray-300">Informe o % ACUMULADO da obra ao fim de cada etapa (0,00 a 100,00, sem diminuir; a última etapa termina em 100,00). A etapa 0 é o pré-executado. O incremental é a diferença entre etapas consecutivas.</p>
                    <table className="w-full text-sm">
                      <thead><tr className="text-left text-gray-400"><th className="p-1">Etapa</th><th className="p-1">% acumulado proposto</th><th className="p-1 text-right">% da etapa (incremental)</th><th className="p-1">Validação</th></tr></thead>
                      <tbody>
                        <tr className="border-t border-white/10"><td className="p-1">0</td><td className="p-1">{brl(cronograma?.etapa0 ?? 0)}% (pré-executado)</td><td className="p-1 text-right">{brl(cronograma?.etapa0 ?? 0)}</td><td /></tr>
                        {Array.from({ length: prazo }, (_, k) => {
                          const problemas = [...(cronograma?.erros.filter((e) => e.etapa === k + 1).map((e) => ({ m: e.mensagem, erro: e.tipo === "valor" })) ?? []), ...(cronograma?.avisos.filter((a) => a.etapa === k + 1).map((a) => ({ m: a.mensagem, erro: false })) ?? [])];
                          const inc = cronograma?.incrementais[k] ?? null;
                          return (
                            <tr key={k} className="border-t border-white/10 align-top">
                              <td className="p-1"><label htmlFor={`pci-etapa-${k}`}>{k + 1}</label></td>
                              <td className="p-1 min-w-[130px]">
                                <NumeroInput id={`pci-etapa-${k}`} value={form.cronograma[k] ?? null} negativo={false} casas={2} pontoDecimal sufixo="%" aria-invalid={problemas.some((p) => p.erro) || undefined}
                                  className={`${campoCls} ${problemas.some((p) => p.erro) ? "border-red-400" : ""}`}
                                  onChange={(v) => { const c = Array.from({ length: prazo }, (_, j) => form.cronograma[j] ?? null); c[k] = v; setForm({ ...form, cronograma: c }); }} />
                              </td>
                              <td className="p-1 text-right">{inc === null ? "—" : brl(inc)}</td>
                              <td className="p-1 text-xs">{problemas.map((p) => <span key={p.m} className={`block ${p.erro ? "text-red-300" : "text-yellow-200"}`}>{p.m}</span>)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            {s.id === "localizacao" && (
              <div className="sm:col-span-2 space-y-2">
                <p className="text-xs text-gray-300">Imagem da localização/poligonal do terreno (ex.: captura do Google Earth). No modelo .xls ela entra no quadro "Inserir Poligonal do Terreno"; sempre vai no PDF.</p>
                <input type="file" accept="image/png,image/jpeg" aria-label="Imagem de localização" onChange={(e) => void escolherImagem(e.target.files?.[0])} className="text-sm" />
                {form.imagem && (
                  <div className="space-y-1">
                    <img src={`data:image/${form.imagem.tipo};base64,${form.imagem.base64}`} alt="Imagem de localização" className="max-h-64 rounded border border-white/10" />
                    <Button size="sm" variant="outline" className={botaoSec} onClick={() => setForm({ ...form, imagem: null })}>Remover imagem</Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </details>
      ))}

      <div className="rounded-lg border border-[#C9A961]/20 p-3">
        <h3 className="mb-2 font-semibold text-[#C9A961]">Histórico de PCIs geradas</h3>
        {!d.historico.length ? <p className="text-sm text-gray-300">Nenhuma PCI gerada para esta obra.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-400"><th className="p-1">Gerada em</th><th className="p-1">Autor</th><th className="p-1">Modelo</th><th className="p-1">Arquivos</th></tr></thead>
              <tbody>
                {d.historico.map((h) => (
                  <tr key={h.id} className="border-t border-white/10 align-top">
                    <td className="p-1 whitespace-nowrap">{new Date(h.geradoEm).toLocaleString("pt-BR")}</td>
                    <td className="p-1">{h.autor ?? "—"}</td>
                    <td className="p-1">v{h.modeloVersao}{h.avisos.length ? <span title={h.avisos.join("\n")} className="ml-1 text-yellow-300">({h.avisos.length} aviso{h.avisos.length > 1 ? "s" : ""})</span> : null}</td>
                    <td className="p-1">
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="outline" className={botaoSec} disabled={baixando !== null} onClick={() => baixar(h.id, "planilha", h.planilha)} aria-label={`Baixar planilha .${h.formato}`}>
                          {baixando === `${h.id}-planilha` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}.{h.formato}
                        </Button>
                        <Button size="sm" variant="outline" className={botaoSec} disabled={baixando !== null} onClick={() => baixar(h.id, "pdf", h.pdf)} aria-label="Baixar PDF">
                          {baixando === `${h.id}-pdf` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}.pdf
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
