// Maquete 3D (EPIC-022, S-04) — revisão da planta lida do PDF. Desenha um pavimento por vez (y para baixo, como
// na prancha) e deixa corrigir paredes, aberturas, cômodos, escadas, níveis, cobertura e pendências. Tracejado =
// medida estimada (sem cota); a pessoa confirma ou corrige antes de validar.
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Check, Plus, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { useFundoPdf } from "./fundo-pdf";
import { Button } from "@/components/ui/button";
import {
  FUNCOES_COMODO, ROTULOS_FUNCAO, TIPOS_ABERTURA, TIPOS_COBERTURA, TIPOS_ESCADA, areaPoligono, centroide, comprimento,
  limites, pontosDoPavimento, type Abertura, type Comodo, type Edificacao, type Escada, type ModeloMaquete,
  type OrigemMedida, type Parede, type Pavimento, type Ponto,
} from "@shared/maquete-3d/modelo";

const inputCls = "h-8 w-full rounded-md border border-[#C9A961]/30 bg-[#1A2332] px-2 text-sm text-white";
const r2 = (n: number) => Math.round(n * 100) / 100;
const grade = (n: number) => Math.round(n * 20) / 20; // encaixe de 5 cm ao arrastar
const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

const ROTULOS_ABERTURA: Record<(typeof TIPOS_ABERTURA)[number], string> = { porta: "Porta", janela: "Janela", porta_janela: "Porta-janela", vao: "Vão" };
const ROTULOS_ESCADA: Record<(typeof TIPOS_ESCADA)[number], string> = { reta: "Reta", em_l: "Em L", em_u: "Em U", caracol: "Caracol", rampa: "Rampa" };
const ROTULOS_COBERTURA: Record<(typeof TIPOS_COBERTURA)[number], string> = { laje: "Laje", platibanda: "Platibanda", uma_agua: "Uma água", duas_aguas: "Duas águas", quatro_aguas: "Quatro águas" };
const COR_ABERTURA: Record<string, string> = { porta: "#F59E0B", janela: "#38BDF8", porta_janela: "#A78BFA", vao: "#94A3B8" };

type Selecao = { tipo: "parede" | "abertura" | "comodo" | "escada"; id: string } | null;
type Arrasto = { alvo: "parede"; id: string; ponta: "a" | "b" } | { alvo: "comodo" | "escada"; id: string; indice: number };

function Num({ valor, onChange, passo = 0.01, min }: { valor: number; onChange: (n: number) => void; passo?: number; min?: number }) {
  return <input type="number" step={passo} min={min} className={inputCls} value={Number.isFinite(valor) ? valor : 0}
    onChange={e => { const n = parseFloat(e.target.value); if (Number.isFinite(n)) onChange(n); }} />;
}
function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return <label className="block text-xs text-gray-300"><span className="mb-1 block">{rotulo}</span>{children}</label>;
}
function Origem({ valor, onChange }: { valor: OrigemMedida; onChange: (o: OrigemMedida) => void }) {
  return valor === "confirmada"
    ? <button type="button" className="text-xs text-emerald-400 underline" onClick={() => onChange("estimada")}>Medida confirmada (desfazer)</button>
    : <Button type="button" size="sm" variant="outline" className="border-amber-400/50 bg-transparent text-amber-300" onClick={() => onChange("confirmada")}><Check className="mr-1 h-4 w-4" />Confirmar medida estimada</Button>;
}

/** Centro de uma abertura no desenho, a partir da parede e da distância até o ponto `a`. */
function trechoAbertura(w: Parede, a: Abertura): [Ponto, Ponto] {
  const c = comprimento(w) || 1;
  const ux = (w.b.x - w.a.x) / c, uy = (w.b.y - w.a.y) / c;
  const p = (d: number) => ({ x: w.a.x + ux * d, y: w.a.y + uy * d });
  return [p(a.posicao - a.largura / 2), p(a.posicao + a.largura / 2)];
}

const novoId = (prefixo: string, existentes: { id: string }[]) => {
  let n = existentes.length + 1;
  while (existentes.some(e => e.id === `${prefixo}${n}`)) n++;
  return `${prefixo}${n}`;
};

type Alinhamento = { x: number; y: number; larguraM: number; opacidade: number };
type Props = {
  modelo: ModeloMaquete; onChange: (m: ModeloMaquete) => void; somenteLeitura?: boolean;
  /** Para desenhar a prancha original ao fundo: id da maquete e a página de cada pavimento. */
  maqueteId?: number; pranchas?: { pavimentoId: string; doc: number; pagina: number }[];
};

export function EditorPlanta({ modelo, onChange, somenteLeitura = false, maqueteId, pranchas = [] }: Props) {
  const [edIdx, setEdIdx] = useState(0);
  const [pvIdx, setPvIdx] = useState(0);
  const [sel, setSel] = useState<Selecao>(null);
  const [verImplantacao, setVerImplantacao] = useState(!modelo.edificacoes.length && !!modelo.implantacao);
  const [zoom, setZoom] = useState(1);
  const [verFundo, setVerFundo] = useState(false);
  const [alinhamentos, setAlinhamentos] = useState<Record<string, Alinhamento>>({});
  const svgRef = useRef<SVGSVGElement>(null);
  const arrasto = useRef<Arrasto | null>(null);

  const ed: Edificacao | undefined = modelo.edificacoes[Math.min(edIdx, modelo.edificacoes.length - 1)];
  const pv: Pavimento | undefined = ed?.pavimentos[Math.min(pvIdx, (ed?.pavimentos.length ?? 1) - 1)];

  const mudarEd = (f: (e: Edificacao) => Edificacao) => onChange({ ...modelo, edificacoes: modelo.edificacoes.map(e => (e.id === ed!.id ? f(e) : e)) });
  const mudarPv = (f: (p: Pavimento) => Pavimento) => mudarEd(e => ({ ...e, pavimentos: e.pavimentos.map(p => (p.id === pv!.id ? f(p) : p)) }));
  const mudarParede = (id: string, f: (w: Parede) => Parede) => mudarPv(p => ({ ...p, paredes: p.paredes.map(w => (w.id === id ? f(w) : w)) }));
  const mudarAbertura = (id: string, f: (a: Abertura) => Abertura) => mudarPv(p => ({ ...p, aberturas: p.aberturas.map(a => (a.id === id ? f(a) : a)) }));
  const mudarComodo = (id: string, f: (c: Comodo) => Comodo) => mudarPv(p => ({ ...p, comodos: p.comodos.map(c => (c.id === id ? f(c) : c)) }));
  const mudarEscada = (id: string, f: (s: Escada) => Escada) => mudarPv(p => ({ ...p, escadas: p.escadas.map(s => (s.id === id ? f(s) : s)) }));

  const base = useMemo(() => {
    const pts = verImplantacao && modelo.implantacao
      ? [...modelo.implantacao.terreno, ...modelo.implantacao.lotes.flatMap(l => l.poligono), ...modelo.implantacao.vias.flatMap(v => v.eixo), ...modelo.implantacao.posicoes]
      : pv ? pontosDoPavimento(pv) : [];
    const l = limites(pts);
    const margem = Math.max(1, Math.max(l.largura, l.altura) * 0.08);
    return { x: l.minX - margem, y: l.minY - margem, w: Math.max(l.largura, 4) + margem * 2, h: Math.max(l.altura, 4) + margem * 2 };
  }, [pv, verImplantacao, modelo.implantacao]);
  // Zoom em torno do centro: afastar mostra a prancha inteira; aproximar ajuda no ajuste fino.
  const caixa = { x: base.x + (base.w - base.w / zoom) / 2, y: base.y + (base.h - base.h / zoom) / 2, w: base.w / zoom, h: base.h / zoom };
  const u = Math.max(caixa.w, caixa.h) / 100; // unidade visual: textos e alças proporcionais ao desenho

  // Prancha original ao fundo, com o alinhamento guardado no navegador por pavimento.
  const prancha = (!verImplantacao && pv && pranchas.find(p => p.pavimentoId === pv.id)) || null;
  const { fundo, carregando: carregandoFundo, erro: erroFundo } = useFundoPdf(maqueteId ?? 0, prancha, verFundo && !!maqueteId);
  const chaveFundo = `maquete3d:fundo:${maqueteId}:${pv?.id}`;
  useEffect(() => {
    if (!pv || alinhamentos[chaveFundo]) return;
    let salvo: Alinhamento | null = null;
    try { salvo = JSON.parse(localStorage.getItem(chaveFundo) || "null"); } catch { /* sem alinhamento salvo */ }
    setAlinhamentos(a => ({ ...a, [chaveFundo]: salvo ?? { x: r2(base.x - base.w * 0.25), y: r2(base.y - base.h * 0.25), larguraM: r2(base.w * 1.5), opacidade: 0.5 } }));
  }, [chaveFundo, pv, base, alinhamentos]);
  const alin = alinhamentos[chaveFundo];
  const mudarAlin = (parte: Partial<Alinhamento>) => {
    const novo = { ...alin, ...parte };
    setAlinhamentos(a => ({ ...a, [chaveFundo]: novo }));
    try { localStorage.setItem(chaveFundo, JSON.stringify(novo)); } catch { /* armazenamento indisponível */ }
  };

  function pontoDoEvento(e: ReactPointerEvent): Ponto | null {
    const svg = svgRef.current, ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: grade(p.x), y: grade(p.y) };
  }
  function aoMover(e: ReactPointerEvent) {
    const a = arrasto.current, p = a && pontoDoEvento(e);
    if (!a || !p) return;
    if (a.alvo === "parede") mudarParede(a.id, w => ({ ...w, [a.ponta]: p }));
    else if (a.alvo === "comodo") mudarComodo(a.id, c => ({ ...c, poligono: c.poligono.map((q, i) => (i === a.indice ? p : q)) }));
    else mudarEscada(a.id, s => ({ ...s, poligono: s.poligono.map((q, i) => (i === a.indice ? p : q)) }));
  }
  const alca = (p: Ponto, chave: string, a: Arrasto) => (
    <circle key={chave} cx={p.x} cy={p.y} r={u * 1.1} fill="#C9A961" stroke="#0F1923" strokeWidth={u * 0.25} style={{ cursor: "move" }}
      onPointerDown={e => { e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); arrasto.current = a; }} />
  );

  const parede = sel?.tipo === "parede" ? pv?.paredes.find(w => w.id === sel.id) : undefined;
  const abertura = sel?.tipo === "abertura" ? pv?.aberturas.find(a => a.id === sel.id) : undefined;
  const comodo = sel?.tipo === "comodo" ? pv?.comodos.find(c => c.id === sel.id) : undefined;
  const escada = sel?.tipo === "escada" ? pv?.escadas.find(s => s.id === sel.id) : undefined;
  const paredes = new Map((pv?.paredes ?? []).map(w => [w.id, w]));
  const imp = modelo.implantacao;

  function novaParede() {
    const id = novoId("p", pv!.paredes);
    mudarPv(p => ({ ...p, paredes: [...p.paredes, { id, a: { x: grade(caixa.x + caixa.w * 0.3), y: grade(caixa.y + caixa.h / 2) }, b: { x: grade(caixa.x + caixa.w * 0.7), y: grade(caixa.y + caixa.h / 2) }, espessura: 0.15, externa: false, origem: "estimada" }] }));
    setSel({ tipo: "parede", id });
  }
  function novaAbertura(tipo: Abertura["tipo"]) {
    if (!parede) return;
    const id = novoId("a", pv!.aberturas), janela = tipo === "janela";
    mudarPv(p => ({ ...p, aberturas: [...p.aberturas, { id, paredeId: parede.id, tipo, posicao: r2(comprimento(parede) / 2), largura: janela ? 1.2 : 0.8, altura: janela ? 1.2 : 2.1, peitoril: janela ? 1 : 0, entradaPrincipal: false, origem: "estimada" }] }));
    setSel({ tipo: "abertura", id });
  }
  function novoComodo() {
    const id = novoId("c", pv!.comodos), x = grade(caixa.x + caixa.w * 0.35), y = grade(caixa.y + caixa.h * 0.35);
    mudarPv(p => ({ ...p, comodos: [...p.comodos, { id, nome: "Novo ambiente", funcao: "outro", poligono: [{ x, y }, { x: x + 3, y }, { x: x + 3, y: y + 3 }, { x, y: y + 3 }], areaInformada: null, origem: "estimada" }] }));
    setSel({ tipo: "comodo", id });
  }
  function novaEscada() {
    const id = novoId("e", pv!.escadas), x = grade(caixa.x + caixa.w * 0.4), y = grade(caixa.y + caixa.h * 0.4);
    const acima = [...ed!.pavimentos].sort((a, b) => a.nivel - b.nivel).find(p => p.nivel > pv!.nivel);
    mudarPv(p => ({ ...p, escadas: [...p.escadas, { id, tipo: "reta", poligono: [{ x, y }, { x: x + 0.9, y }, { x: x + 0.9, y: y + 3 }, { x, y: y + 3 }], inicio: { x: x + 0.45, y: y + 3 }, fim: { x: x + 0.45, y }, largura: 0.9, degraus: null, destinoPavimentoId: acima?.id ?? null, origem: "estimada" }] }));
    setSel({ tipo: "escada", id });
  }
  function excluirSelecionado() {
    if (!sel) return;
    mudarPv(p => ({
      ...p,
      paredes: sel.tipo === "parede" ? p.paredes.filter(w => w.id !== sel.id) : p.paredes,
      aberturas: p.aberturas.filter(a => (sel.tipo === "abertura" ? a.id !== sel.id : sel.tipo === "parede" ? a.paredeId !== sel.id : true)),
      comodos: sel.tipo === "comodo" ? p.comodos.filter(c => c.id !== sel.id) : p.comodos,
      escadas: sel.tipo === "escada" ? p.escadas.filter(s => s.id !== sel.id) : p.escadas,
    }));
    setSel(null);
  }

  const aba = (ativo: boolean) => `rounded-md px-3 py-1 text-sm ${ativo ? "bg-[#C9A961] text-[#1A2332]" : "border border-[#C9A961]/30 text-gray-200"}`;
  const estilo = { pointerEvents: somenteLeitura ? "none" as const : undefined };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {modelo.edificacoes.length > 1 && modelo.edificacoes.map((e, i) => (
          <button key={e.id} type="button" className={aba(!verImplantacao && e.id === ed?.id)} onClick={() => { setEdIdx(i); setPvIdx(0); setSel(null); setVerImplantacao(false); }}>{e.nome}</button>
        ))}
        {imp && <button type="button" className={aba(verImplantacao)} onClick={() => { setVerImplantacao(true); setSel(null); }}>Implantação</button>}
      </div>
      {!verImplantacao && ed && (
        <div className="flex flex-wrap items-center gap-2">
          {ed.pavimentos.map((p, i) => (
            <button key={p.id} type="button" className={aba(p.id === pv?.id)} onClick={() => { setPvIdx(i); setSel(null); }}>
              {p.nome}{p.repeticoes > 1 ? ` ×${p.repeticoes}` : ""}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="rounded-lg border border-[#C9A961]/20 bg-[#0F1923] p-2">
          <svg ref={svgRef} viewBox={`${caixa.x} ${caixa.y} ${caixa.w} ${caixa.h}`} className="h-[60vh] w-full touch-none select-none"
            onPointerMove={aoMover} onPointerUp={() => { arrasto.current = null; }} onPointerDown={() => setSel(null)} role="img" aria-label="Planta do pavimento">
            {fundo && alin && !verImplantacao && <image href={fundo.url} x={alin.x} y={alin.y} width={alin.larguraM} height={alin.larguraM * fundo.altura / fundo.largura} opacity={alin.opacidade} preserveAspectRatio="none" style={{ pointerEvents: "none" }} />}
            {verImplantacao && imp ? (
              <g>
                {imp.terreno.length > 2 && <polygon points={imp.terreno.map(p => `${p.x},${p.y}`).join(" ")} fill="#14532D33" stroke="#4ADE80" strokeWidth={u * 0.3} />}
                {imp.vias.map(v => <polyline key={v.id} points={v.eixo.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#64748B" strokeWidth={v.largura} strokeLinejoin="round" strokeLinecap="round" opacity={0.7} />)}
                {imp.lotes.map(l => {
                  const c = centroide(l.poligono);
                  return <g key={l.id}><polygon points={l.poligono.map(p => `${p.x},${p.y}`).join(" ")} fill="#C9A96122" stroke="#C9A961" strokeWidth={u * 0.2} />
                    <text x={c.x} y={c.y} fontSize={u * 1.6} fill="#E5E7EB" textAnchor="middle">{[l.quadra, l.nome].filter(Boolean).join("-")}</text></g>;
                })}
                {imp.posicoes.map(p => <g key={p.id}><rect x={p.x} y={p.y} width={u * 4} height={u * 4} fill="#38BDF855" stroke="#38BDF8" strokeWidth={u * 0.2} transform={`rotate(${p.rotacao} ${p.x} ${p.y})`} />
                  <text x={p.x} y={p.y - u * 0.5} fontSize={u * 1.5} fill="#E5E7EB">{p.nome}</text></g>)}
              </g>
            ) : pv ? (
              <g style={estilo}>
                {pv.comodos.map(c => {
                  const centro = centroide(c.poligono), ativo = comodo?.id === c.id;
                  return (
                    <g key={c.id} onPointerDown={e => { e.stopPropagation(); setSel({ tipo: "comodo", id: c.id }); }} style={{ cursor: "pointer" }}>
                      <polygon points={c.poligono.map(p => `${p.x},${p.y}`).join(" ")} fill={ativo ? "#C9A96155" : "#C9A9611F"} stroke="#C9A961" strokeWidth={u * 0.12} strokeDasharray={c.origem === "estimada" ? `${u * 0.8} ${u * 0.6}` : undefined} />
                      <text x={centro.x} y={centro.y} fontSize={u * 1.8} fill="#F3F4F6" textAnchor="middle">{c.nome}</text>
                      <text x={centro.x} y={centro.y + u * 2.2} fontSize={u * 1.4} fill="#9CA3AF" textAnchor="middle">{fmt(areaPoligono(c.poligono))} m²</text>
                    </g>
                  );
                })}
                {pv.escadas.map(s => (
                  <g key={s.id} onPointerDown={e => { e.stopPropagation(); setSel({ tipo: "escada", id: s.id }); }} style={{ cursor: "pointer" }}>
                    <polygon points={s.poligono.map(p => `${p.x},${p.y}`).join(" ")} fill={escada?.id === s.id ? "#F472B655" : "#F472B622"} stroke="#F472B6" strokeWidth={u * 0.2} />
                    <line x1={s.inicio.x} y1={s.inicio.y} x2={s.fim.x} y2={s.fim.y} stroke="#F472B6" strokeWidth={u * 0.25} markerEnd="url(#seta)" />
                  </g>
                ))}
                <defs><marker id="seta" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#F472B6" /></marker></defs>
                {pv.paredes.map(w => (
                  <line key={w.id} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke={parede?.id === w.id ? "#C9A961" : w.externa ? "#F9FAFB" : "#9CA3AF"}
                    strokeWidth={Math.max(w.espessura, u * 0.5)} strokeDasharray={w.origem === "estimada" ? `${u * 1.2} ${u * 0.8}` : undefined} strokeLinecap="square" style={{ cursor: "pointer" }}
                    onPointerDown={e => { e.stopPropagation(); setSel({ tipo: "parede", id: w.id }); }} />
                ))}
                {pv.aberturas.map(a => {
                  const w = paredes.get(a.paredeId);
                  if (!w) return null;
                  const [p, q] = trechoAbertura(w, a);
                  return <line key={a.id} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={COR_ABERTURA[a.tipo]} strokeWidth={Math.max(w.espessura, u * 0.5) * (abertura?.id === a.id ? 1.8 : 1.2)}
                    style={{ cursor: "pointer" }} onPointerDown={e => { e.stopPropagation(); setSel({ tipo: "abertura", id: a.id }); }} />;
                })}
                {!somenteLeitura && parede && [alca(parede.a, "a", { alvo: "parede", id: parede.id, ponta: "a" }), alca(parede.b, "b", { alvo: "parede", id: parede.id, ponta: "b" })]}
                {!somenteLeitura && comodo && comodo.poligono.map((p, i) => alca(p, `c${i}`, { alvo: "comodo", id: comodo.id, indice: i }))}
                {!somenteLeitura && escada && escada.poligono.map((p, i) => alca(p, `e${i}`, { alvo: "escada", id: escada.id, indice: i }))}
              </g>
            ) : null}
          </svg>
          <div className="flex flex-wrap items-center gap-2 px-1 pt-2">
            <Button type="button" size="sm" variant="outline" className="border-[#C9A961]/30 bg-transparent text-gray-200" aria-label="Afastar" onClick={() => setZoom(z => Math.max(0.25, z / 1.25))}><ZoomOut className="h-4 w-4" /></Button>
            <Button type="button" size="sm" variant="outline" className="border-[#C9A961]/30 bg-transparent text-gray-200" aria-label="Aproximar" onClick={() => setZoom(z => Math.min(4, z * 1.25))}><ZoomIn className="h-4 w-4" /></Button>
            {maqueteId && prancha && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={verFundo} onChange={e => setVerFundo(e.target.checked)} />Mostrar a prancha original ao fundo</label>}
            {carregandoFundo && <span className="text-xs text-gray-400">Abrindo o PDF…</span>}
            {erroFundo && <span className="text-xs text-red-300">{erroFundo}</span>}
          </div>
          {verFundo && fundo && alin && (
            <div className="grid grid-cols-2 gap-2 px-1 pt-2 sm:grid-cols-4">
              <Campo rotulo="Transparência"><input type="range" min={0.1} max={1} step={0.05} className="w-full" value={alin.opacidade} onChange={e => mudarAlin({ opacidade: Number(e.target.value) })} /></Campo>
              <Campo rotulo="Largura da prancha (m)"><Num valor={alin.larguraM} passo={0.1} min={1} onChange={n => mudarAlin({ larguraM: Math.max(1, n) })} /></Campo>
              <Campo rotulo="Posição X (m)"><Num valor={alin.x} passo={0.1} onChange={n => mudarAlin({ x: n })} /></Campo>
              <Campo rotulo="Posição Y (m)"><Num valor={alin.y} passo={0.1} onChange={n => mudarAlin({ y: n })} /></Campo>
              <p className="col-span-full text-xs text-gray-400">Ajuste a largura e a posição até as paredes do PDF coincidirem com as paredes lidas. O ajuste fica guardado neste navegador.</p>
            </div>
          )}
          <p className="px-1 pt-1 text-xs text-gray-400">
            Linha cheia: medida confirmada por cota. Tracejada: estimada. <span className="text-amber-400">■</span> porta <span className="text-sky-400">■</span> janela <span className="text-violet-400">■</span> porta-janela <span className="text-pink-400">■</span> escada
          </p>
        </div>

        <fieldset disabled={somenteLeitura} className="space-y-3 text-sm">
          {verImplantacao && imp ? (
            <div className="space-y-1 rounded-lg border border-[#C9A961]/20 p-3">
              <p className="font-semibold text-[#C9A961]">Implantação</p>
              <p>{imp.lotes.length} lote(s), {imp.vias.length} via(s), {imp.posicoes.length} construção(ões).</p>
              <p className="text-xs text-gray-400">A edição da implantação entra com a etapa de Incorporação.</p>
            </div>
          ) : pv && ed ? (
            <>
              <div className="space-y-2 rounded-lg border border-[#C9A961]/20 p-3">
                <p className="font-semibold text-[#C9A961]">Pavimento</p>
                <Campo rotulo="Nome"><input className={inputCls} value={pv.nome} maxLength={60} onChange={e => mudarPv(p => ({ ...p, nome: e.target.value }))} /></Campo>
                <div className="grid grid-cols-3 gap-2">
                  <Campo rotulo="Nível (m)"><Num valor={pv.nivel} onChange={n => mudarPv(p => ({ ...p, nivel: n }))} /></Campo>
                  <Campo rotulo="Pé-direito"><Num valor={pv.peDireito} min={1.8} onChange={n => mudarPv(p => ({ ...p, peDireito: n }))} /></Campo>
                  <Campo rotulo="Repetições"><Num valor={pv.repeticoes} passo={1} min={1} onChange={n => mudarPv(p => ({ ...p, repeticoes: Math.max(1, Math.round(n)) }))} /></Campo>
                </div>
                <Origem valor={pv.origemPeDireito} onChange={o => mudarPv(p => ({ ...p, origemPeDireito: o }))} />
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button type="button" size="sm" variant="outline" className="border-[#C9A961]/30 bg-transparent text-gray-200" onClick={novaParede}><Plus className="mr-1 h-4 w-4" />Parede</Button>
                  <Button type="button" size="sm" variant="outline" className="border-[#C9A961]/30 bg-transparent text-gray-200" onClick={novoComodo}><Plus className="mr-1 h-4 w-4" />Cômodo</Button>
                  <Button type="button" size="sm" variant="outline" className="border-[#C9A961]/30 bg-transparent text-gray-200" onClick={novaEscada}><Plus className="mr-1 h-4 w-4" />Escada</Button>
                </div>
              </div>

              {parede && (
                <div className="space-y-2 rounded-lg border border-[#C9A961]/40 p-3">
                  <p className="font-semibold">Parede {parede.id} — {fmt(comprimento(parede))} m</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Campo rotulo="Início X"><Num valor={parede.a.x} onChange={n => mudarParede(parede.id, w => ({ ...w, a: { ...w.a, x: n } }))} /></Campo>
                    <Campo rotulo="Início Y"><Num valor={parede.a.y} onChange={n => mudarParede(parede.id, w => ({ ...w, a: { ...w.a, y: n } }))} /></Campo>
                    <Campo rotulo="Fim X"><Num valor={parede.b.x} onChange={n => mudarParede(parede.id, w => ({ ...w, b: { ...w.b, x: n } }))} /></Campo>
                    <Campo rotulo="Fim Y"><Num valor={parede.b.y} onChange={n => mudarParede(parede.id, w => ({ ...w, b: { ...w.b, y: n } }))} /></Campo>
                    <Campo rotulo="Espessura (m)"><Num valor={parede.espessura} min={0.03} onChange={n => mudarParede(parede.id, w => ({ ...w, espessura: n }))} /></Campo>
                    <label className="flex items-end gap-2 pb-1 text-xs"><input type="checkbox" checked={parede.externa} onChange={e => mudarParede(parede.id, w => ({ ...w, externa: e.target.checked }))} />Parede externa</label>
                  </div>
                  <Origem valor={parede.origem} onChange={o => mudarParede(parede.id, w => ({ ...w, origem: o }))} />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" className="border-[#C9A961]/30 bg-transparent text-gray-200" onClick={() => novaAbertura("porta")}><Plus className="mr-1 h-4 w-4" />Porta</Button>
                    <Button type="button" size="sm" variant="outline" className="border-[#C9A961]/30 bg-transparent text-gray-200" onClick={() => novaAbertura("janela")}><Plus className="mr-1 h-4 w-4" />Janela</Button>
                  </div>
                </div>
              )}

              {abertura && (
                <div className="space-y-2 rounded-lg border border-[#C9A961]/40 p-3">
                  <p className="font-semibold">{ROTULOS_ABERTURA[abertura.tipo]} {abertura.id}</p>
                  <Campo rotulo="Tipo"><select className={inputCls} value={abertura.tipo} onChange={e => mudarAbertura(abertura.id, a => ({ ...a, tipo: e.target.value as Abertura["tipo"] }))}>
                    {TIPOS_ABERTURA.map(t => <option key={t} value={t}>{ROTULOS_ABERTURA[t]}</option>)}</select></Campo>
                  <div className="grid grid-cols-2 gap-2">
                    <Campo rotulo="Posição na parede (m)"><Num valor={abertura.posicao} min={0} onChange={n => mudarAbertura(abertura.id, a => ({ ...a, posicao: n }))} /></Campo>
                    <Campo rotulo="Largura (m)"><Num valor={abertura.largura} min={0.2} onChange={n => mudarAbertura(abertura.id, a => ({ ...a, largura: n }))} /></Campo>
                    <Campo rotulo="Altura (m)"><Num valor={abertura.altura} min={0.2} onChange={n => mudarAbertura(abertura.id, a => ({ ...a, altura: n }))} /></Campo>
                    <Campo rotulo="Peitoril (m)"><Num valor={abertura.peitoril} min={0} onChange={n => mudarAbertura(abertura.id, a => ({ ...a, peitoril: n }))} /></Campo>
                  </div>
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={abertura.entradaPrincipal} onChange={e => mudarAbertura(abertura.id, a => ({ ...a, entradaPrincipal: e.target.checked }))} />Entrada principal (início do tour)</label>
                  <Origem valor={abertura.origem} onChange={o => mudarAbertura(abertura.id, a => ({ ...a, origem: o }))} />
                </div>
              )}

              {comodo && (
                <div className="space-y-2 rounded-lg border border-[#C9A961]/40 p-3">
                  <p className="font-semibold">Cômodo — {fmt(areaPoligono(comodo.poligono))} m² no desenho</p>
                  <Campo rotulo="Nome"><input className={inputCls} value={comodo.nome} maxLength={80} onChange={e => mudarComodo(comodo.id, c => ({ ...c, nome: e.target.value }))} /></Campo>
                  <Campo rotulo="Função (define a mobília)"><select className={inputCls} value={comodo.funcao} onChange={e => mudarComodo(comodo.id, c => ({ ...c, funcao: e.target.value as Comodo["funcao"] }))}>
                    {FUNCOES_COMODO.map(f => <option key={f} value={f}>{ROTULOS_FUNCAO[f]}</option>)}</select></Campo>
                  <Campo rotulo="Área escrita na prancha (m²)"><Num valor={comodo.areaInformada ?? 0} min={0} onChange={n => mudarComodo(comodo.id, c => ({ ...c, areaInformada: n > 0 ? n : null }))} /></Campo>
                  <p className="text-xs text-gray-400">Arraste os pontos dourados para ajustar o contorno.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" className="border-[#C9A961]/30 bg-transparent text-gray-200"
                      onClick={() => mudarComodo(comodo.id, c => { const a = c.poligono[c.poligono.length - 1], b = c.poligono[0]; return { ...c, poligono: [...c.poligono, { x: grade((a.x + b.x) / 2), y: grade((a.y + b.y) / 2) }] }; })}><Plus className="mr-1 h-4 w-4" />Ponto</Button>
                    {comodo.poligono.length > 3 && <Button type="button" size="sm" variant="outline" className="border-[#C9A961]/30 bg-transparent text-gray-200"
                      onClick={() => mudarComodo(comodo.id, c => ({ ...c, poligono: c.poligono.slice(0, -1) }))}>Remover último ponto</Button>}
                  </div>
                  <Origem valor={comodo.origem} onChange={o => mudarComodo(comodo.id, c => ({ ...c, origem: o }))} />
                </div>
              )}

              {escada && (
                <div className="space-y-2 rounded-lg border border-[#C9A961]/40 p-3">
                  <p className="font-semibold">Escada {escada.id}</p>
                  <Campo rotulo="Tipo"><select className={inputCls} value={escada.tipo} onChange={e => mudarEscada(escada.id, s => ({ ...s, tipo: e.target.value as Escada["tipo"] }))}>
                    {TIPOS_ESCADA.map(t => <option key={t} value={t}>{ROTULOS_ESCADA[t]}</option>)}</select></Campo>
                  <Campo rotulo="Sobe para"><select className={inputCls} value={escada.destinoPavimentoId ?? ""} onChange={e => mudarEscada(escada.id, s => ({ ...s, destinoPavimentoId: e.target.value || null }))}>
                    <option value="">— escolher —</option>{ed.pavimentos.filter(p => p.id !== pv.id).map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></Campo>
                  <div className="grid grid-cols-2 gap-2">
                    <Campo rotulo="Largura (m)"><Num valor={escada.largura} min={0.5} onChange={n => mudarEscada(escada.id, s => ({ ...s, largura: n }))} /></Campo>
                    <Campo rotulo="Degraus"><Num valor={escada.degraus ?? 0} passo={1} min={0} onChange={n => mudarEscada(escada.id, s => ({ ...s, degraus: n > 0 ? Math.round(n) : null }))} /></Campo>
                    <Campo rotulo="Partida X"><Num valor={escada.inicio.x} onChange={n => mudarEscada(escada.id, s => ({ ...s, inicio: { ...s.inicio, x: n } }))} /></Campo>
                    <Campo rotulo="Partida Y"><Num valor={escada.inicio.y} onChange={n => mudarEscada(escada.id, s => ({ ...s, inicio: { ...s.inicio, y: n } }))} /></Campo>
                    <Campo rotulo="Chegada X"><Num valor={escada.fim.x} onChange={n => mudarEscada(escada.id, s => ({ ...s, fim: { ...s.fim, x: n } }))} /></Campo>
                    <Campo rotulo="Chegada Y"><Num valor={escada.fim.y} onChange={n => mudarEscada(escada.id, s => ({ ...s, fim: { ...s.fim, y: n } }))} /></Campo>
                  </div>
                  <Origem valor={escada.origem} onChange={o => mudarEscada(escada.id, s => ({ ...s, origem: o }))} />
                </div>
              )}

              {sel && <Button type="button" size="sm" variant="outline" className="border-red-400/50 bg-transparent text-red-300" onClick={excluirSelecionado}><Trash2 className="mr-1 h-4 w-4" />Excluir selecionado</Button>}

              <div className="space-y-2 rounded-lg border border-[#C9A961]/20 p-3">
                <p className="font-semibold text-[#C9A961]">Cobertura — {ed.nome}</p>
                <Campo rotulo="Tipo"><select className={inputCls} value={ed.cobertura.tipo} onChange={e => mudarEd(x => ({ ...x, cobertura: { ...x.cobertura, tipo: e.target.value as Edificacao["cobertura"]["tipo"] } }))}>
                  {TIPOS_COBERTURA.map(t => <option key={t} value={t}>{ROTULOS_COBERTURA[t]}</option>)}</select></Campo>
                <div className="grid grid-cols-2 gap-2">
                  <Campo rotulo="Inclinação (%)"><Num valor={ed.cobertura.inclinacao} passo={1} min={0} onChange={n => mudarEd(x => ({ ...x, cobertura: { ...x.cobertura, inclinacao: n } }))} /></Campo>
                  <Campo rotulo="Beiral (m)"><Num valor={ed.cobertura.beiral} min={0} onChange={n => mudarEd(x => ({ ...x, cobertura: { ...x.cobertura, beiral: n } }))} /></Campo>
                </div>
                <Origem valor={ed.cobertura.origem} onChange={o => mudarEd(x => ({ ...x, cobertura: { ...x.cobertura, origem: o } }))} />
              </div>
            </>
          ) : <p className="text-gray-400">Nenhum pavimento lido.</p>}
        </fieldset>
      </div>
    </div>
  );
}
