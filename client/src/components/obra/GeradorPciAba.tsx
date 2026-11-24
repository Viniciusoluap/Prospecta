// Lote 2, correção 03 (AD-06): aba "Gerador de PCI" do Editar Obra.
// Formulário por seções, pré-preenchido com os dados da obra/cliente/PCI vinculada,
// rascunho, geração da planilha (modelo oficial atual) + PDF e histórico com
// download das duas versões. Regras em shared/pci-gerador.ts; servidor em
// server/pci-gerador.ts. Gêmeo em Grupo-Santa-Fe/web/src/components/obras/gerador-pci.tsx.
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Download, FilePlus, FileSpreadsheet, History, Library, Loader2, RefreshCw, Save, Trash2 } from "lucide-react";
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
  aplicarEscolhasPci,
  baseDosCustosPci,
  calcularTotaisPci,
  custoDaIncidenciaPci,
  custosDigitadosComoPercentualPci,
  incidenciaDoCustoPci,
  camposTrocadosPorEngenheiroPci,
  compararPreenchimentoPci,
  ORIGEM_CONFIRMADA_PCI,
  confirmarMesmaPessoaPci,
  definirCampoPci,
  errosPci,
  formatarCnpjPci,
  formularioPciVazio,
  fotoNoFormatoDoQuadroPci,
  recorteParaQuadroPci,
  localDataPci,
  misturaPessoaPci,
  numeroPci,
  pendenciasPci,
  sugestoesDoModeloPci,
  type CampoPci,
  type EmpresaPci,
  type FormularioPci,
  type ParteDaFotoPci,
  type PessoaPci,
  type ResultadoPreenchimentoPci,
  type SecaoPci,
} from "@shared/pci-gerador";

const campoCls = "bg-[#1A2332] border-[#C9A961]/30 text-white placeholder:text-gray-500";
const botaoSec = "border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10";
const brl = (v: number, casas = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

type Engenheiro = { id: string; nome: string | null; email: string | null; telefone: string | null; crea: string | null; creaUf: string | null; engenheiro: boolean };

function Campo({ campo, valor, onChange, dica }: { campo: CampoPci; valor: string | number | null; onChange: (v: string | number | null) => void; dica?: string }) {
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
    const placeholder = dica ?? (campo.tipo === "coordenada" ? (campo.id === "latitude" ? `05° 29' 18" S` : `47° 28' 30" W`) : campo.tipo === "cep" ? "00000-000" : undefined);
    controle = <Input id={id} value={valor === null ? "" : String(valor)} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={campoCls} />;
  }
  return (
    <div className={campo.largo ? "sm:col-span-2" : ""}>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-gray-300">{campo.rotulo}{campo.celula ? <span className="ml-1 text-[10px] text-gray-500">({campo.celula})</span> : null}</label>
      {controle}
    </div>
  );
}

const carregarImagem = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const el = new Image();
  el.onload = () => resolve(el);
  el.onerror = () => reject(new Error("Não foi possível ler a imagem."));
  el.src = src;
});

const OUTRA_EMPRESA = "__outra__";
const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/**
 * "Construtora": lista com as empresas do módulo fiscal (BPO › Contabilidade). Escolher uma preenche o nome e o CNPJ; "Outra" libera
 * a digitação. Sem empresa cadastrada, o campo continua de digitar.
 */
function CampoConstrutora({ campo, form, empresas, onEscolher }: { campo: CampoPci; form: FormularioPci; empresas: EmpresaPci[]; onEscolher: (nome: string | null, cnpj: string | null | undefined) => void }) {
  const nome = String(form.campos.construtora ?? "");
  const cnpj = soDigitos(form.campos.cnpjConstrutora);
  const daLista = empresas.find((e) => e.cnpj === cnpj && cnpj) ?? empresas.find((e) => e.nome === nome && nome) ?? null;
  const [outra, setOutra] = useState(false);
  const digitando = outra || (!daLista && nome !== "");
  const id = `pci-${campo.id}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-gray-300">{campo.rotulo}<span className="ml-1 text-[10px] text-gray-500">({campo.celula})</span></label>
      <select id={id} value={digitando ? OUTRA_EMPRESA : daLista ? daLista.cnpj : ""} className={`w-full rounded-md border px-3 py-2 text-sm ${campoCls}`}
        onChange={(e) => {
          const v = e.target.value;
          if (v === OUTRA_EMPRESA) { setOutra(true); if (daLista) onEscolher(null, null); return; }
          setOutra(false);
          const empresa = empresas.find((x) => x.cnpj === v);
          onEscolher(empresa ? empresa.nome : null, empresa ? formatarCnpjPci(empresa.cnpj) : null);
        }}>
        <option value="">— sem construtora —</option>
        {empresas.map((e) => <option key={e.cnpj} value={e.cnpj}>{e.nome} — {formatarCnpjPci(e.cnpj)}{e.certificado ? " (certificado digital)" : ""}</option>)}
        <option value={OUTRA_EMPRESA}>Outra (digitar)</option>
      </select>
      {digitando && <Input aria-label="Nome da construtora" value={nome} placeholder="Nome da construtora" onChange={(e) => onEscolher(e.target.value, undefined)} className={`mt-2 ${campoCls}`} />}
    </div>
  );
}

/**
 * EPIC-024 S-09: escolher o engenheiro busca no servidor os dados do perfil DELE (com CPF — a lista
 * não leva CPF) e preenche nome, CPF, e-mail, telefone, CREA e UF. Campos já preenchidos com outro
 * valor só trocam com confirmação. O mesmo profissional pode ser RTP e RTE.
 */
function SeletorEngenheiro({ papel, projectId, form, setForm, engenheiros }: { papel: "rtp" | "rte"; projectId: number; form: FormularioPci; setForm: (f: FormularioPci) => void; engenheiros: Engenheiro[] }) {
  const utils = trpc.useUtils();
  const [buscando, setBuscando] = useState(false);
  const atual = papel === "rtp" ? form.rtpEngenheiroId : form.rteEngenheiroId;
  const sigla = papel === "rtp" ? "RTP" : "RTE";

  async function escolher(id: string) {
    if (!id) { setForm(aplicarEngenheiroPci(form, papel, null, null)); return; }
    setBuscando(true);
    try {
      const eng = await utils.pciGerador.engenheiro.fetch({ projectId, userId: Number(id) });
      const trocados = camposTrocadosPorEngenheiroPci(form, papel, eng);
      if (trocados.length && !confirm(`Os campos do ${sigla} já preenchidos serão trocados pelos dados do perfil de ${eng.nome ?? "engenheiro"}: ${trocados.join(", ")}. Continuar?`)) return;
      setForm(aplicarEngenheiroPci(form, papel, eng.id, eng));
      for (const a of eng.avisos) toast.warning(a, { duration: 10000 });
      if (!eng.avisos.length) toast.success(`${sigla}: dados de ${eng.nome ?? "engenheiro"} preenchidos pelo perfil (nome, CPF, e-mail, telefone, CREA e UF).`);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBuscando(false); }
  }

  return (
    <div className="sm:col-span-2">
      <label htmlFor={`pci-eng-${papel}`} className="mb-1 block text-xs font-semibold text-gray-300">Selecionar engenheiro (preenche nome, CPF, e-mail, telefone, CREA e UF do perfil)</label>
      <div className="flex flex-wrap items-center gap-2">
        <select id={`pci-eng-${papel}`} value={atual ?? ""} disabled={buscando} className={`min-w-0 flex-1 rounded-md border px-3 py-2 text-sm ${campoCls}`}
          onChange={(e) => void escolher(e.target.value)}>
          <option value="">— digitar manualmente —</option>
          {engenheiros.map((e) => <option key={e.id} value={e.id}>{e.nome ?? e.email ?? `Usuário ${e.id}`}{e.crea ? ` — CREA${e.creaUf ? `-${e.creaUf}` : ""} ${e.crea}` : e.engenheiro ? " — sem CREA" : ""}</option>)}
        </select>
        {buscando && <Loader2 className="h-4 w-4 animate-spin text-[#C9A961]" aria-label="Buscando o perfil do engenheiro" />}
        {papel === "rte" && form.rtpEngenheiroId && form.rtpEngenheiroId !== atual && (
          <Button size="sm" variant="outline" className={botaoSec} disabled={buscando} onClick={() => void escolher(form.rtpEngenheiroId!)}>Mesmo profissional do RTP</Button>
        )}
      </div>
    </div>
  );
}

type PainelResultado = Omit<ResultadoPreenchimentoPci, "formulario"> & { titulo: string };
type EscolhasPainel = Parameters<typeof aplicarEscolhasPci>[1];

/**
 * EPIC-024 S-09: o que "Dados automáticos", a abertura ou o modelo fez — preencheu, igual, conflito,
 * faltou. Pessoa (proponente, RTP, RTE) é escolhida INTEIRA (manter ou trocar por uma opção), nunca
 * campo a campo; campos técnicos/do imóvel seguem com escolha por campo. As escolhas são aplicadas
 * por `aplicarEscolhasPci` (shared), que não deixa pessoa misturada.
 */
function ResultadoPreenchimento({ r, onAplicar, onFechar }: { r: PainelResultado; onAplicar: (e: EscolhasPainel, resolvidos: { conflitos: string[]; pessoas: PessoaPci[] }) => void; onFechar: () => void }) {
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [escolhaPessoa, setEscolhaPessoa] = useState<Partial<Record<PessoaPci, string>>>({});
  const alternar = (chave: string) => setMarcados((m) => { const n = new Set(m); if (n.has(chave)) n.delete(chave); else n.add(chave); return n; });
  const pendentes = r.conflitos.length + r.pessoas.length;

  function aplicar(todosOsCampos: boolean) {
    const conflitos = todosOsCampos ? r.conflitos : r.conflitos.filter((c) => marcados.has(c.chave));
    const pessoas: NonNullable<EscolhasPainel["pessoas"]> = {};
    const resolvidas: PessoaPci[] = [];
    for (const e of r.pessoas) {
      const id = escolhaPessoa[e.pessoa];
      if (!id) continue;
      resolvidas.push(e.pessoa);
      pessoas[e.pessoa] = id === "manter" ? null : e.opcoes.find((o) => o.id === id) ?? null;
    }
    onAplicar({ conflitos, pessoas }, { conflitos: conflitos.map((c) => c.chave), pessoas: resolvidas });
  }

  return (
    <div role="status" className="space-y-2 rounded-md border border-[#C9A961]/40 bg-[#2C3E50]/60 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-semibold text-[#C9A961]">{r.titulo}: {r.preenchidos.length} campo(s) preenchido(s), {r.pessoas.length} pessoa(s) para escolher, {r.conflitos.length} campo(s) diferente(s), {r.iguais.length} já igual(is), {r.naoEncontrados.length} não encontrado(s).</p>
        <Button size="sm" variant="outline" className={botaoSec} onClick={onFechar}>Fechar</Button>
      </div>
      {r.preenchidos.length > 0 && (
        <details open>
          <summary className="cursor-pointer font-semibold">Preenchidos agora (estavam vazios)</summary>
          <ul className="ml-5 mt-1 list-disc">{r.preenchidos.map((p) => <li key={p.chave}><b>{p.rotulo}</b>: {p.valor} <span className="text-gray-400">— {p.fonte}</span></li>)}</ul>
        </details>
      )}
      {r.pessoas.map((e) => (
        <fieldset key={e.pessoa} className="rounded border border-yellow-500/40 bg-yellow-500/10 p-2">
          <legend className="px-1 font-semibold text-yellow-100">{e.rotulo} — escolha quem é (a pessoa inteira; nada foi trocado)</legend>
          <p className="text-xs text-yellow-100">{e.motivo}</p>
          <label className="mt-1 flex items-start gap-2">
            <input type="radio" name={`pessoa-${e.pessoa}`} className="mt-1" checked={escolhaPessoa[e.pessoa] === "manter"} onChange={() => setEscolhaPessoa((s) => ({ ...s, [e.pessoa]: "manter" }))} />
            <span>{e.atualVazio ? "Deixar em branco (digitar depois)" : <>Manter o que está na tela: {e.atual}</>}</span>
          </label>
          {e.opcoes.map((o) => (
            <label key={o.id} className="mt-1 flex items-start gap-2">
              <input type="radio" name={`pessoa-${e.pessoa}`} className="mt-1" checked={escolhaPessoa[e.pessoa] === o.id} onChange={() => setEscolhaPessoa((s) => ({ ...s, [e.pessoa]: o.id }))} />
              <span>Usar {o.resumo} <span className="text-gray-400">— {o.fonte}</span>
                {o.origem === ORIGEM_CONFIRMADA_PCI && <span className="block text-xs text-yellow-200">Junta duas fontes: escolher esta opção vale como sua confirmação de que é a mesma pessoa (fica registrado quem confirmou e quando).</span>}
              </span>
            </label>
          ))}
        </fieldset>
      ))}
      {r.conflitos.length > 0 && (
        <div className="rounded border border-yellow-500/40 bg-yellow-500/10 p-2">
          <p className="font-semibold text-yellow-100">Campos já preenchidos com outro valor — nada foi trocado. Marque o que deve ser substituído:</p>
          <ul className="mt-1 space-y-1">
            {r.conflitos.map((c) => (
              <li key={c.chave}>
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={marcados.has(c.chave)} onChange={() => alternar(c.chave)} />
                  <span><b>{c.rotulo}</b>: atual "{c.atual}" → sugerido "{c.sugerido}" <span className="text-gray-400">— {c.fonte}</span></span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
      {pendentes > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className={botaoSec} disabled={!marcados.size && !Object.keys(escolhaPessoa).length} onClick={() => aplicar(false)}>Aplicar as escolhas</Button>
          {r.conflitos.length > 0 && <Button size="sm" variant="outline" className={botaoSec} onClick={() => { if (confirm(`Substituir os ${r.conflitos.length} campo(s) diferentes pelos valores sugeridos? (As pessoas seguem a escolha acima.)`)) aplicar(true); }}>Substituir todos os campos diferentes</Button>}
        </div>
      )}
      {r.avisos.length > 0 && <ul className="ml-5 list-disc text-xs text-gray-300">{r.avisos.map((a) => <li key={a}>{a}</li>)}</ul>}
      {r.naoEncontrados.length > 0 && (
        <details>
          <summary className="cursor-pointer font-semibold">Não encontrados ({r.naoEncontrados.length})</summary>
          <ul className="ml-5 mt-1 list-disc">{r.naoEncontrados.map((a) => <li key={a.chave}><b>{a.rotulo}</b>: {a.motivo}</li>)}</ul>
        </details>
      )}
      {r.iguais.length > 0 && (
        <details>
          <summary className="cursor-pointer">Já estavam iguais ({r.iguais.length})</summary>
          <ul className="ml-5 mt-1 list-disc">{r.iguais.map((p) => <li key={p.chave}>{p.rotulo} <span className="text-gray-400">— {p.fonte}</span></li>)}</ul>
        </details>
      )}
    </div>
  );
}

/**
 * EPIC-024 S-09: biblioteca de modelos de preenchimento. O modelo leva só os dados técnicos
 * (lista de permissão em shared/pci-gerador.ts); os dados pessoais desta obra ficam como estão.
 */
function ModelosPreenchimento({ projectId, form, setForm, mostrar }: { projectId: number; form: FormularioPci; setForm: (f: FormularioPci) => void; mostrar: (r: PainelResultado) => void }) {
  const utils = trpc.useUtils();
  const lista = trpc.pciGerador.modelosPreenchimento.useQuery(undefined, { refetchOnWindowFocus: false });
  const salvar = trpc.pciGerador.salvarModeloPreenchimento.useMutation();
  const excluir = trpc.pciGerador.excluirModeloPreenchimento.useMutation();
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const [verHistorico, setVerHistorico] = useState(false);
  const historico = trpc.pciGerador.historicoModeloPreenchimento.useQuery({ id: selecionado ?? 0 }, { enabled: verHistorico && !!selecionado });
  const [ocupado, setOcupado] = useState(false);
  const modelos = lista.data ?? [];
  const atual = modelos.find((m) => m.id === selecionado) ?? null;

  async function aplicar(id: number) {
    setOcupado(true);
    try {
      const m = await utils.pciGerador.modeloPreenchimento.fetch({ id });
      const fonte = `Modelo "${m.nome}" v${m.versao}`;
      const r = compararPreenchimentoPci(form, sugestoesDoModeloPci(m.dados, fonte));
      setForm({ ...r.formulario, modeloOrigem: { id: m.id, nome: m.nome, versao: m.versao } });
      mostrar({ ...r, titulo: `${fonte} aplicado (só dados técnicos; os dados pessoais desta obra não mudam)` });
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setOcupado(false); }
  }

  async function salvarModelo(novaVersao: boolean) {
    const nome = novaVersao && atual ? atual.nome : prompt("Nome do modelo (ex.: Casa padrão 70 m²). Só os dados técnicos são guardados — nunca CPF, nomes, endereço, matrícula ou coordenadas.")?.trim();
    if (!nome) return;
    if (novaVersao && atual && !confirm(`Salvar os dados técnicos desta obra como a versão ${atual.versao + 1} de "${atual.nome}"? A versão ${atual.versao} continua guardada no histórico.`)) return;
    try {
      const r = await salvar.mutateAsync({ projectId, nome, formulario: form, novaVersaoDe: novaVersao && atual ? atual.id : null });
      toast.success(`Modelo "${r.nome}" v${r.versao} salvo (só dados técnicos).`);
      for (const a of r.avisos) toast.warning(a, { duration: 12000 });
      await utils.pciGerador.modelosPreenchimento.invalidate();
      setSelecionado(r.id);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }

  async function excluirModelo() {
    if (!atual || !confirm(`Excluir o modelo "${atual.nome}" (todas as versões)? As obras que já usaram o modelo não mudam.`)) return;
    try {
      await excluir.mutateAsync({ id: atual.id, confirmar: true });
      toast.success("Modelo excluído.");
      setSelecionado(null);
      await utils.pciGerador.modelosPreenchimento.invalidate();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <details className="rounded-lg border border-[#C9A961]/20 bg-[#2C3E50]/40 p-3">
      <summary className="cursor-pointer font-semibold text-[#C9A961]">Modelos de preenchimento {modelos.length ? `(${modelos.length})` : ""}</summary>
      <div className="mt-3 space-y-2 text-sm">
        <p className="text-xs text-gray-300">Um modelo guarda só os dados técnicos de um projeto padrão (memorial, sistema construtivo, áreas da casa, executor/BDI, custos e cronograma). Proponente, RT, endereço, matrícula, coordenadas, valores do terreno e do imóvel e a imagem nunca vão para o modelo. Ao aplicar, campos já preenchidos com outro valor só trocam com confirmação.</p>
        {form.modeloOrigem && <p className="text-xs text-gray-300">Esta obra usou o modelo "{form.modeloOrigem.nome}" v{form.modeloOrigem.versao}.</p>}
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="pci-modelo-preenchimento" className="sr-only">Modelo de preenchimento</label>
          <select id="pci-modelo-preenchimento" value={selecionado ?? ""} onChange={(e) => { setSelecionado(e.target.value ? Number(e.target.value) : null); setVerHistorico(false); }}
            className={`min-w-0 flex-1 rounded-md border px-3 py-2 text-sm ${campoCls}`}>
            <option value="">{lista.isLoading ? "Carregando…" : modelos.length ? "— escolha um modelo —" : "Nenhum modelo salvo"}</option>
            {modelos.map((m) => <option key={m.id} value={m.id}>{m.nome} — v{m.versao} ({m.resumo})</option>)}
          </select>
          <Button size="sm" variant="outline" className={botaoSec} disabled={!atual || ocupado} onClick={() => atual && void aplicar(atual.id)}>
            {ocupado ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Library className="mr-1 h-4 w-4" />} Aplicar modelo
          </Button>
          <Button size="sm" variant="outline" className={botaoSec} disabled={!atual} onClick={() => setVerHistorico((v) => !v)}><History className="mr-1 h-4 w-4" /> Versões</Button>
          <Button size="sm" variant="outline" className={botaoSec} disabled={!atual || excluir.isPending} onClick={excluirModelo} aria-label="Excluir modelo"><Trash2 className="h-4 w-4" /></Button>
        </div>
        {lista.error && <p role="alert" className="text-red-300">{lista.error.message}</p>}
        {atual && <p className="text-xs text-gray-400">v{atual.versao} salva em {new Date(atual.criadoEm).toLocaleString("pt-BR")}{atual.autor ? ` por ${atual.autor}` : ""}{atual.obraOrigem ? `, a partir da obra "${atual.obraOrigem}"` : ""}.</p>}
        {verHistorico && atual && (
          <ul className="ml-5 list-disc text-xs">
            {historico.isLoading ? <li>Carregando…</li> : (historico.data ?? []).map((v) => (
              <li key={v.id}>v{v.versao} — {new Date(v.criadoEm).toLocaleString("pt-BR")}{v.autor ? ` por ${v.autor}` : ""} ({v.resumo}){" "}
                <button type="button" className="underline" disabled={ocupado} onClick={() => void aplicar(v.id)}>aplicar esta versão</button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className={botaoSec} disabled={salvar.isPending} onClick={() => void salvarModelo(false)}><FilePlus className="mr-1 h-4 w-4" /> Salvar como novo modelo</Button>
          <Button size="sm" variant="outline" className={botaoSec} disabled={!atual || salvar.isPending} onClick={() => void salvarModelo(true)}>Salvar como nova versão do modelo escolhido</Button>
          <Button size="sm" variant="outline" className={botaoSec} onClick={() => { if (confirm("Começar em branco? Todos os campos desta tela serão limpos (o rascunho salvo só muda quando você salvar).")) setForm(formularioPciVazio()); }}>Começar em branco</Button>
        </div>
      </div>
    </details>
  );
}

export function GeradorPciAba({ projectId }: { projectId: number }) {
  const utils = trpc.useUtils();
  const consulta = trpc.pciGerador.obter.useQuery({ projectId }, { refetchOnWindowFocus: false });
  const salvar = trpc.pciGerador.salvarRascunho.useMutation();
  const gerar = trpc.pciGerador.gerar.useMutation();
  const excluirGerada = trpc.pciGerador.excluirGerada.useMutation();
  const [form, setForm] = useState<FormularioPci | null>(null);
  const [carregandoAuto, setCarregandoAuto] = useState(false);
  const [baixando, setBaixando] = useState<string | null>(null);
  const [painel, setPainel] = useState<PainelResultado | null>(null);

  useEffect(() => {
    if (consulta.data && !form) {
      setForm(consulta.data.formulario);
      // EPIC-024 S-09: a abertura sem rascunho mostra as fontes e as escolhas de pessoa, como o botão.
      if (consulta.data.preenchimento) setPainel({ ...consulta.data.preenchimento, titulo: "Pré-preenchimento automático" });
    }
  }, [consulta.data, form]);

  const totais = useMemo(() => (form ? calcularTotaisPci(form) : null), [form]);
  const fotoInteira = useRef<string | null>(null);
  const [parteDaFoto, setParteDaFoto] = useState<ParteDaFotoPci>("baixo");
  const [fotoNoFormato, setFotoNoFormato] = useState(true);
  const pendencias = useMemo(() => (form ? pendenciasPci(form) : []), [form]);
  // Lote 03, correção 06: validação do cronograma durante a digitação (o servidor valida de novo).
  const cronograma = useMemo(() => (form ? analisarCronogramaPci(form) : null), [form]);
  const erros = useMemo(() => (form ? errosPci(form, { paraGerar: false }) : []), [form]);
  // EPIC-024 S-09: nome e CPF de fontes diferentes bloqueiam a geração (o servidor confere de novo).
  const misturas = useMemo(() => (form ? misturaPessoaPci(form) : []), [form]);

  if (consulta.isLoading || (!form && !consulta.error)) return <p role="status" className="text-slate-100">Carregando o Gerador de PCI…</p>;
  if (consulta.error || !consulta.data || !form) return <div role="alert" className="text-slate-100">{consulta.error?.message ?? "Erro ao carregar."} <button type="button" className="underline" onClick={() => consulta.refetch()}>Tentar novamente</button></div>;
  const d = consulta.data;

  const setCampo = (id: string, v: string | number | null) => setForm(definirCampoPci(form, id, v));
  const prazo = Math.min(Math.max(Math.round(numeroPci(form.campos.prazoMeses) ?? 0), 0), MAX_ETAPAS_PCI);

  async function salvarRascunho() {
    try {
      await salvar.mutateAsync({ projectId, formulario: form });
      toast.success("Rascunho salvo.");
      await utils.pciGerador.obter.invalidate({ projectId });
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }

  // EPIC-024 S-09: completa só o que está vazio e mostra fonte, conflitos/escolhas (com confirmação) e o que faltou.
  async function recarregarAutomatico() {
    if (!form) return;
    setCarregandoAuto(true);
    try {
      const s = await utils.pciGerador.sugestoesAutomaticas.fetch({ projectId, rtpEngenheiroId: form.rtpEngenheiroId, rteEngenheiroId: form.rteEngenheiroId });
      const r = compararPreenchimentoPci(form, s.sugestoes, s.ausencias);
      setForm(r.formulario);
      setPainel({ ...r, titulo: "Dados automáticos" });
      const pendentes = r.conflitos.length + r.pessoas.length;
      if (!r.preenchidos.length && !pendentes) toast.info("Dados automáticos: nada novo para preencher. Veja abaixo o que já estava igual e o que não foi encontrado.");
      else toast.success(`Dados automáticos: ${r.preenchidos.length} campo(s) preenchido(s)${pendentes ? `, ${pendentes} item(ns) aguardando sua escolha` : ""}. Confira e salve o rascunho.`);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setCarregandoAuto(false); }
  }

  function aplicarEscolhas(escolhas: Parameters<typeof aplicarEscolhasPci>[1], resolvidos: { conflitos: string[]; pessoas: PessoaPci[] }) {
    if (!form || !painel) return;
    setForm(aplicarEscolhasPci(form, escolhas));
    const chaves = new Set(resolvidos.conflitos);
    const trocados = painel.conflitos.filter((c) => chaves.has(c.chave)).map((c) => ({ chave: c.chave, rotulo: c.rotulo, valor: c.sugerido, fonte: c.fonte }));
    setPainel({ ...painel, preenchidos: [...painel.preenchidos, ...trocados], conflitos: painel.conflitos.filter((c) => !chaves.has(c.chave)), pessoas: painel.pessoas.filter((p) => !resolvidos.pessoas.includes(p.pessoa)) });
    toast.success("Escolhas aplicadas. Confira e salve o rascunho.");
  }

  async function gerarPci() {
    try {
      const origem = form?.imagem && `data:image/${form.imagem.tipo};base64,${form.imagem.base64}`;
      const imagem = origem ? await prepararFoto(origem, parteDaFoto) : null;
      const r = await gerar.mutateAsync({ projectId, formulario: { ...form, imagem } });
      toast.success("PCI gerada (planilha e PDF). Veja o histórico abaixo.");
      for (const a of r.avisos) toast.warning(a, { duration: 10000 });
      await utils.pciGerador.obter.invalidate({ projectId });
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }

  // Foto de localização: recortada na proporção do quadro da planilha (preenche o quadro, sem faixas e sem esticar). A foto inteira
  // fica guardada só enquanto a tela está aberta, para dar para trocar a parte que aparece (de cima, do meio, de baixo).
  async function prepararFoto(origem: string, parte: ParteDaFotoPci): Promise<NonNullable<FormularioPci["imagem"]>> {
    const img = await carregarImagem(origem);
    const existente = /^data:image\/(png|jpeg);base64,(.+)$/.exec(origem);
    if (existente && fotoNoFormatoDoQuadroPci(img.naturalWidth, img.naturalHeight)) {
      return { tipo: existente[1] === "png" ? "png" : "jpeg", base64: existente[2] };
    }
    const r = recorteParaQuadroPci(img.naturalWidth, img.naturalHeight, parte);
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(1600, r.largura);
    canvas.height = Math.max(1, Math.round(canvas.width / (r.largura / r.altura)));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Navegador sem suporte a canvas.");
    ctx.drawImage(img, r.x, r.y, r.largura, r.altura, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return { tipo: "jpeg", base64: dataUrl.split(",")[1] };
  }

  async function recortarFoto(origem: string, parte: ParteDaFotoPci) {
    const imagem = await prepararFoto(origem, parte);
    setForm((f) => (f ? { ...f, imagem } : f));
    setFotoNoFormato(true);
  }
  async function escolherImagem(arquivo: File | undefined) {
    if (!arquivo) return;
    try {
      const { dataUrl } = await comprimirImagem(arquivo, 1600, LIMITE_IMAGEM_PCI_BYTES);
      fotoInteira.current = dataUrl;
      setParteDaFoto("meio");
      await recortarFoto(dataUrl, "meio");
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }
  async function trocarParteDaFoto(parte: ParteDaFotoPci) {
    if (!form?.imagem) return;
    try {
      setParteDaFoto(parte);
      await recortarFoto(fotoInteira.current ?? `data:image/${form.imagem.tipo};base64,${form.imagem.base64}`, parte);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }

  async function excluirPciGerada(id: number, geradoEm: Date) {
    if (!window.confirm(`Excluir a PCI gerada em ${new Date(geradoEm).toLocaleString("pt-BR")}? A planilha e o PDF dessa geração serão removidos.`)) return;
    try {
      await excluirGerada.mutateAsync({ projectId, id, confirmar: true });
      await utils.pciGerador.obter.invalidate({ projectId });
      toast.success("PCI excluída do histórico.");
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }

  async function baixar(id: number, tipo: "planilha" | "pdf", nome: string) {
    setBaixando(`${id}-${tipo}`);
    try { await baixarArquivoEmPartes(`/api/obras/${projectId}/pci-geradas/${id}/${tipo}`, nome); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBaixando(null); }
  }

  const empresas: EmpresaPci[] = d.empresas ?? [];
  const secaoCampos = (secao: SecaoPci) => CAMPOS_PCI.filter((c) => c.secao === secao && (!c.visivel || c.visivel(form.campos))).map((c) => {
    if (c.id === "construtora" && empresas.length > 0) {
      return <CampoConstrutora key={c.id} campo={c} form={form} empresas={empresas} onEscolher={(nome, cnpj) => {
        let f = definirCampoPci(form, "construtora", nome);
        if (cnpj !== undefined) f = definirCampoPci(f, "cnpjConstrutora", cnpj);
        setForm(f);
      }} />;
    }
    // "Local e data" em branco sai sozinho na geração: a cidade do imóvel e o dia em que o documento é gerado.
    const dica = c.id === "localData" ? `Em branco, sai sozinho: ${localDataPci(form.campos.municipio, form.campos.uf, new Date())}` : undefined;
    return <Campo key={c.id} campo={c} valor={form.campos[c.id] ?? null} onChange={(v) => setCampo(c.id, v)} dica={dica} />;
  });
  // Área construída total = coberta padrão + acessória coberta (a mesma conta da planilha); tem de bater com a área cadastrada na obra.
  const areaObra: number | null = d.areaObra ?? null;
  const areaTotal = totais?.areaConstruida ?? null;
  const areaDiferente = areaTotal !== null && areaObra !== null && Math.abs(areaTotal - areaObra) > 0.005;
  const porM2 = (v: number) => (areaTotal ? brl(v / areaTotal) : "—");
  const baseCustos = baseDosCustosPci(form);
  const custosEmPercentual = custosDigitadosComoPercentualPci(form);
  const terreno = numeroPci(form.campos.valorTerreno) ?? 0;
  const areaTerreno = numeroPci(form.campos.areaTerreno);
  // Revisão do PR #180: .xlsm/.xlsb geram a partir da versão .xls compatível — o servidor informa se ela existe.
  const podeGerar = !!d.modelo && d.baseCompativelDisponivel;

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
          <Button size="sm" disabled={!podeGerar || gerar.isPending || misturas.length > 0} onClick={gerarPci} className="bg-[#C9A961] font-bold text-[#1A2332] hover:bg-[#B8985A]">
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

      {misturas.length > 0 && (
        <div role="alert" className="space-y-1 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-100">
          <p className="font-semibold">A PCI não pode ser gerada assim:</p>
          {misturas.map((m) => (
            <div key={m.pessoa} className="flex flex-wrap items-center gap-2">
              <span>{m.mensagem}</span>
              <Button size="sm" variant="outline" className={botaoSec} onClick={() => { if (confirm(`${m.motivo === "legado" ? "Rascunho anterior à conferência de origem. " : ""}Confirma que o nome e o CPF são da MESMA pessoa? (Fica registrado quem confirmou e quando.)`)) setForm(confirmarMesmaPessoaPci(form, m.pessoa)); }}>Confirmo que nome e CPF são da mesma pessoa</Button>
            </div>
          ))}
        </div>
      )}
      {painel && <ResultadoPreenchimento key={`${painel.titulo}-${painel.conflitos.length}-${painel.pessoas.length}`} r={painel} onAplicar={aplicarEscolhas} onFechar={() => setPainel(null)} />}
      <ModelosPreenchimento projectId={projectId} form={form} setForm={setForm} mostrar={setPainel} />

      {SECOES_PCI.map((s) => (
        <details key={s.id} open={s.id === "proponente"} className="rounded-lg border border-[#C9A961]/20 bg-[#2C3E50]/40 p-3">
          <summary className="cursor-pointer font-semibold text-[#C9A961]">{s.titulo}</summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(s.id === "rtp" || s.id === "rte") && <SeletorEngenheiro papel={s.id} projectId={projectId} form={form} setForm={setForm} engenheiros={d.engenheiros} />}
            {secaoCampos(s.id)}
            {s.id === "areas" && totais && (
              <div className="sm:col-span-2 space-y-2">
                <p className="text-sm text-slate-200">Área construída total (AC73): <strong>{areaTotal === null ? "—" : `${brl(areaTotal)} m²`}</strong> <span className="text-xs text-gray-400">= área coberta padrão + área acessória coberta</span></p>
                {areaDiferente && (
                  <p role="alert" className="flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-sm text-yellow-100">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> A área construída total da PCI ({brl(areaTotal!)} m²) é diferente da área cadastrada na obra ({brl(areaObra!)} m²). Ajuste a área coberta ou a acessória aqui, ou corrija a área em Editar obra.
                  </p>
                )}
                {areaObra === null && <p className="text-xs text-gray-400">A obra está sem área cadastrada (Editar obra): não dá para conferir a área total.</p>}
              </div>
            )}
            {s.id === "custos" && totais && (
              <div className="sm:col-span-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-gray-400"><th className="p-1">Item</th><th className="p-1">Serviço</th><th className="p-1">Incidência (%)</th><th className="p-1">Custo (R$)</th></tr></thead>
                  <tbody>
                    {SERVICOS_CUSTO_PCI.map((nome, i) => (
                      <tr key={nome} className="border-t border-white/10">
                        <td className="p-1">{i + 1}</td><td className="p-1">{nome}</td>
                        {/* Os dois campos são de digitar: o percentual calcula o valor em R$ (sobre a base), e o valor recalcula o percentual. */}
                        <td className="p-1 min-w-[110px]"><NumeroInput aria-label={`Incidência ${nome}`} value={incidenciaDoCustoPci(form, form.custos[i])} negativo={false} sufixo="%" disabled={baseCustos === null} className={campoCls}
                          onChange={(v) => { if (baseCustos !== null) setForm({ ...form, custos: form.custos.map((c, k) => (k === i ? custoDaIncidenciaPci(baseCustos, v) : c)) }); }} /></td>
                        <td className="p-1 min-w-[140px]"><NumeroInput aria-label={`Custo ${nome}`} value={form.custos[i]} negativo={false} className={campoCls}
                          onChange={(v) => setForm({ ...form, custos: form.custos.map((c, k) => (k === i ? v : c)) })} /></td>
                      </tr>
                    ))}
                    <tr className="border-t border-white/10"><td className="p-1">20</td><td className="p-1">{SERVICO_OUTROS_PCI}</td><td className="p-1">{brl(incidenciaDoCustoPci(form, totais.outros) ?? 0, 2)}%</td><td className="p-1">{brl(totais.outros)}</td></tr>
                  </tbody>
                  <tfoot className="font-semibold">
                    <tr><td /><td className="p-1">Custo total de serviços</td><td className="p-1">{brl(incidenciaDoCustoPci(form, totais.totalServicos) ?? 0, 2)}%</td><td className="p-1">{brl(totais.totalServicos)}</td></tr>
                    <tr><td /><td className="p-1">BDI ({brl(numeroPci(form.campos.bdi) ?? 0)}%)</td><td /><td className="p-1">{brl(totais.valorBdi)}</td></tr>
                    <tr><td /><td className="p-1">Custo total com BDI</td><td /><td className="p-1">{brl(totais.totalComBdi)}</td></tr>
                  </tfoot>
                </table>
                {baseCustos === null
                  ? <p className="mt-1 text-xs text-yellow-200">Para digitar pelo percentual, preencha o valor do imóvel e o valor do terreno em "Áreas e características" (o imóvel tem de valer mais que o terreno). Enquanto isso, digite os valores em R$.</p>
                  : <p className="mt-1 text-xs text-gray-400">Base dos percentuais: {brl(baseCustos)} = (valor do imóvel − valor do terreno) ÷ (1 + BDI). Com 100% preenchido, o custo de produção fecha no valor do imóvel{Math.abs(totais.totalServicos - baseCustos) > 0.05 ? ` — faltam ${brl(baseCustos - totais.totalServicos)} (${brl(100 - (incidenciaDoCustoPci(form, totais.totalServicos) ?? 0), 2)}%)` : ""}.</p>}
                {custosEmPercentual && (
                  <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-sm text-yellow-100">
                    <AlertTriangle className="h-4 w-4 shrink-0" /> Os custos somam exatamente 100,00: parecem percentuais digitados no campo de R$.
                    <Button size="sm" variant="outline" className={botaoSec} onClick={() => setForm({ ...form, custos: custosEmPercentual.custos, adicionais: custosEmPercentual.adicionais })}>Converter em R$ pela base de {brl(baseCustos!)}</Button>
                  </div>
                )}
                <table className="mt-3 w-full text-sm" aria-label="Resumo dos custos">
                  <thead><tr className="text-left text-gray-400"><th className="p-1">Resumo dos custos (como na planilha)</th><th className="p-1 text-right">Total (R$)</th><th className="p-1 text-right">Por m² (R$)</th></tr></thead>
                  <tbody>
                    <tr className="border-t border-white/10"><td className="p-1">Valor do terreno</td><td className="p-1 text-right">{brl(terreno)}</td><td className="p-1 text-right">{areaTerreno ? brl(terreno / areaTerreno) : "—"}</td></tr>
                    <tr className="border-t border-white/10"><td className="p-1">Custo total de serviços</td><td className="p-1 text-right">{brl(totais.totalServicos)}</td><td className="p-1 text-right">{porM2(totais.totalServicos)}</td></tr>
                    <tr className="border-t border-white/10"><td className="p-1">Custo total de serviços com BDI</td><td className="p-1 text-right">{brl(totais.totalComBdi)}</td><td className="p-1 text-right">{porM2(totais.totalComBdi)}</td></tr>
                    <tr className="border-t border-white/10 font-semibold"><td className="p-1">Custo total de produção (terreno + serviços com BDI)</td><td className="p-1 text-right">{brl(totais.custoProducao)}</td><td className="p-1 text-right">{porM2(totais.custoProducao)}</td></tr>
                  </tbody>
                </table>
                <p className="mt-1 text-xs text-gray-400">O terreno é dividido pela área do terreno; os demais, pela área construída total.</p>
                <p id="pci-servicos-adicionais" className="mt-3 text-xs font-semibold text-gray-300">Serviços adicionais (somam no item 20 "Outros")</p>
                <table aria-labelledby="pci-servicos-adicionais" className="w-full text-sm">
                  <thead className="text-left text-gray-400">
                    <tr><th className="py-1 pr-2">Serviço</th><th className="w-[28%] px-1 py-1">Incidência (%)</th><th className="w-[27%] py-1 pl-2">Valor (R$)</th></tr>
                  </thead>
                  <tbody>
                    {form.adicionais.map((a, i) => {
                      const atualizarValor = (valor: number | null) => setForm({
                        ...form,
                        adicionais: form.adicionais.map((servico, k) => k === i ? { ...servico, valor } : servico),
                      });
                      return (
                        <tr key={i}>
                          <td className="py-0.5 pr-2"><Input aria-label={`Serviço adicional ${i + 1}`} value={a.descricao} placeholder={`Serviço adicional ${i + 1}`} className={campoCls}
                            onChange={(e) => setForm({ ...form, adicionais: form.adicionais.map((x, k) => k === i ? { ...x, descricao: e.target.value } : x) })} /></td>
                          <td className="min-w-[110px] px-1 py-0.5"><NumeroInput aria-label={`Incidência do serviço adicional ${i + 1}`} value={incidenciaDoCustoPci(form, a.valor)} negativo={false} sufixo="%" disabled={baseCustos === null} className={campoCls}
                            onChange={(v) => { if (baseCustos !== null) atualizarValor(custoDaIncidenciaPci(baseCustos, v)); }} /></td>
                          <td className="min-w-[110px] py-0.5 pl-2"><NumeroInput aria-label={`Valor do serviço adicional ${i + 1}`} value={a.valor} negativo={false} className={campoCls} onChange={atualizarValor} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
                <p className="text-xs text-gray-300">Imagem da localização/poligonal do terreno (ex.: captura do Google Earth). Ela preenche o quadro "Inserir Poligonal do Terreno" da planilha e vai no PDF. O quadro é largo (3 por 1): a foto é recortada nessa proporção, sem esticar.</p>
                <input type="file" accept="image/png,image/jpeg" aria-label="Imagem de localização" onChange={(e) => void escolherImagem(e.target.files?.[0])} className="text-sm" />
                {form.imagem && (
                  <div className="space-y-2">
                    <img src={`data:image/${form.imagem.tipo};base64,${form.imagem.base64}`} alt="Imagem de localização" className="max-h-64 max-w-full rounded border border-white/10"
                      onLoad={(e) => setFotoNoFormato(fotoNoFormatoDoQuadroPci(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight))} />
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor="pci-parte-da-foto" className="text-xs font-semibold text-gray-300">Parte da foto que entra no quadro</label>
                      <select id="pci-parte-da-foto" value={fotoNoFormato && !fotoInteira.current ? "" : parteDaFoto} onChange={(e) => { if (e.target.value) void trocarParteDaFoto(e.target.value as ParteDaFotoPci); }}
                        className={`rounded-md border px-3 py-2 text-sm ${campoCls}`}>
                        {fotoNoFormato && !fotoInteira.current && <option value="">já recortada</option>}
                        <option value="cima">De cima</option>
                        <option value="meio">Do meio</option>
                        <option value="baixo">De baixo</option>
                      </select>
                      <Button size="sm" variant="outline" className={botaoSec} onClick={() => { fotoInteira.current = null; setForm({ ...form, imagem: null }); }}>Remover imagem</Button>
                    </div>
                    {fotoNoFormato
                      ? <p className="text-xs text-gray-400">A foto está no formato do quadro da planilha (largo, 3 por 1) e vai preencher o quadro inteiro. {fotoInteira.current ? "Se o lote ficou cortado, troque a parte acima." : "Para escolher outra parte, envie a foto de novo."}</p>
                      : <p role="alert" className="text-xs text-yellow-200">Esta foto ainda não está no formato do quadro da planilha (largo, 3 por 1): ao gerar, a foto será recortada para preencher o quadro. Escolha acima a parte que deve aparecer.</p>}
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
              <thead><tr className="text-left text-gray-400"><th className="p-1">Gerada em</th><th className="p-1">Autor</th><th className="p-1">Modelo</th><th className="p-1">Arquivos</th><th className="p-1"><span className="sr-only">Ações</span></th></tr></thead>
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
                    <td className="p-1 text-right">
                      <Button type="button" size="sm" variant="outline" className="border-red-400/30 text-red-300 hover:text-red-200" disabled={excluirGerada.isPending}
                        onClick={() => void excluirPciGerada(h.id, h.geradoEm)}>
                        <Trash2 className="h-3.5 w-3.5" /> Excluir
                      </Button>
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
