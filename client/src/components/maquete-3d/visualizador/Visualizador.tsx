// Maquete 3D (EPIC-022, etapa 2) — o visualizador: tela de apresentação comercial, a cena 3D e os controles
// (visão por fora / por dentro, telhado, estilo de decoração, horário, tour automático, som, tela cheia, voltar
// à entrada, ambiente atual, miniatura da planta). Teclado e mouse no computador; toque e joystick no celular.
// Tudo o que aparece vem do modelo validado e do cadastro: nenhum dado comercial é inventado.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import {
  Box, DoorOpen, Eye, Home, Maximize, MessageCircle, Pause, Play, RotateCcw, Volume2, VolumeX, Footprints, Layers,
} from "lucide-react";
import { limites, pontosDoPavimento, resumoModelo, type Edificacao, type ModeloMaquete } from "@shared/maquete-3d/modelo";
import { pavimentosOrdenados, topoDaEdificacao } from "@shared/maquete-3d/geometria3d";
import { Casa, Entorno } from "./Casa";
import { Ceu, horarioEm } from "./Ceu";
import { Mobilia, mobiliaDaEdificacao } from "./Mobilia";
import { Caminhada, Orbita, Tour, caixaDaEdificacao, comandoVazio, visitanteNaEntrada, type Comando, type InfoLocal, type LegendaTour, type Visitante } from "./Navegacao";
import { Implantacao, SITUACOES, limitesDaImplantacao, lotesDaCena, type LoteNaCena, type SituacaoLote, type UnidadeVenda } from "./Implantacao";
import { ESTILOS, ROTULOS_ESTILO, acender, materiaisDoEstilo, type Estilo } from "./materiais";
import { tocarTrilha, type Trilha } from "./som";

export type DadosComerciais = {
  nome: string; logo?: string | null; localizacao?: string | null;
  /** Preço de venda, só quando informado no cadastro. */
  preco?: number | null;
  /** Telefone do consultor com DDI/DDD, só dígitos. */
  whatsapp?: string | null;
};

type Modo = "capa" | "implantacao" | "externo" | "interno" | "tour";
type Qualidade = "alta" | "media" | "baixa";
const QUALIDADES: Record<Qualidade, { rotulo: string; dpr: [number, number]; sombras: boolean; mapa: number; luzes: number }> = {
  alta: { rotulo: "Alta", dpr: [1, 2], sombras: true, mapa: 2048, luzes: 10 },
  media: { rotulo: "Média", dpr: [1, 1.5], sombras: true, mapa: 1024, luzes: 6 },
  baixa: { rotulo: "Econômica", dpr: [1, 1], sombras: false, mapa: 512, luzes: 3 },
};
const HORARIOS = [{ t: 0, rotulo: "Manhã" }, { t: 0.5, rotulo: "Pôr do sol" }, { t: 1, rotulo: "Noite" }];

const btn = "pointer-events-auto inline-flex h-10 items-center gap-2 rounded-full border border-white/15 bg-black/55 px-4 text-sm font-medium text-white backdrop-blur transition hover:bg-black/75 disabled:opacity-40";
const btnAtivo = "border-[#C9A961] bg-[#C9A961] text-[#1A2332] hover:bg-[#C9A961]";
const m2 = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

function Cena({ modelo, unidades, noLoteamento, lote, onLote, edificacao, estilo, horario, qualidade, modo, telhado, pausado, reinicio, visitante, comando, onLocal, onLegenda, onFimTour, vistaDeCima, corteAte }: {
  modelo: ModeloMaquete; unidades: UnidadeVenda[];
  /** Mostra o empreendimento inteiro (implantação) em vez de uma edificação. */
  noLoteamento: boolean; lote: string | null; onLote: (l: LoteNaCena | null) => void;
  edificacao: Edificacao | null; estilo: Estilo; horario: number; qualidade: Qualidade; modo: Modo; telhado: boolean; pausado: boolean; reinicio: number;
  visitante: React.MutableRefObject<Visitante>; comando: React.MutableRefObject<Comando>;
  onLocal: (i: InfoLocal) => void; onLegenda: (l: LegendaTour) => void; onFimTour: () => void; vistaDeCima: boolean;
  /** Por fora, sem telhado: mostra só até este nível (para ver por cima um andar de baixo). */
  corteAte: number | null;
}) {
  const m = useMemo(() => materiaisDoEstilo(estilo), [estilo]);
  const pecas = useMemo(() => (edificacao ? mobiliaDaEdificacao(edificacao) : []), [edificacao]);
  const h = useMemo(() => horarioEm(horario), [horario]);
  useEffect(() => { acender(m, h.noite); }, [m, h.noite]);
  const caixa = useMemo(() => {
    if (noLoteamento && modelo.implantacao) return { ...limitesDaImplantacao(modelo.implantacao), topo: 6 };
    return edificacao ? caixaDaEdificacao(edificacao) : { x0: 0, x1: 10, z0: 0, z1: 10, topo: 3 };
  }, [noLoteamento, modelo.implantacao, edificacao]);
  const centro = useMemo(() => [(caixa.x0 + caixa.x1) / 2, 0, (caixa.z0 + caixa.z1) / 2] as [number, number, number], [caixa]);
  const raio = Math.max(caixa.x1 - caixa.x0, caixa.z1 - caixa.z0, caixa.topo, 6);
  const q = QUALIDADES[qualidade];
  // Por dentro e no tour o telhado fica (é o teto de quem está dentro); por fora o botão decide.
  const comTelhado = modo === "interno" || modo === "tour" ? !vistaDeCima : telhado;
  const corte = modo === "externo" && !telhado ? corteAte : null;
  return (
    <>
      <Ceu t={horario} raio={raio} centro={centro} sombras={q.sombras} mapaSombra={q.mapa} />
      {noLoteamento && modelo.implantacao ? (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[centro[0], -0.08, centro[2]]} material={m.grama} receiveShadow><planeGeometry args={[raio * 12, raio * 12]} /></mesh>
          <Implantacao implantacao={modelo.implantacao} edificacoes={modelo.edificacoes} unidades={unidades} m={m} selecionado={lote} onSelecionar={onLote} />
        </>
      ) : edificacao ? (
        <>
          <Entorno edificacao={edificacao} m={m} />
          <Casa edificacao={edificacao} m={m} mostrarTelhado={comTelhado} corteAte={corte} />
          <Mobilia pecas={pecas} m={m} estilo={estilo} noite={h.noite} luzesAte={q.luzes} corteAte={corte} />
        </>
      ) : null}
      {(modo === "externo" || modo === "capa" || modo === "implantacao") && <Orbita caixa={caixa} deCima={vistaDeCima} />}
      {edificacao && modo === "interno" && <Caminhada edificacao={edificacao} visitante={visitante} comando={comando} onLocal={onLocal} />}
      {edificacao && modo === "tour" && <Tour edificacao={edificacao} visitante={visitante} pausado={pausado} reinicio={reinicio} onLocal={onLocal} onLegenda={onLegenda} onFim={onFimTour} />}
    </>
  );
}

/** Joystick de toque: arrastar define a direção e a força da caminhada. */
function Joystick({ comando }: { comando: React.MutableRefObject<Comando> }) {
  const [pino, setPino] = useState({ x: 0, y: 0 });
  const base = useRef<HTMLDivElement>(null);
  const mover = (e: ReactPointerEvent) => {
    const r = base.current!.getBoundingClientRect(), raio = r.width / 2;
    let x = (e.clientX - r.left - raio) / raio, y = (e.clientY - r.top - raio) / raio;
    const mod = Math.hypot(x, y);
    if (mod > 1) { x /= mod; y /= mod; }
    setPino({ x, y });
    comando.current.lado = x; comando.current.frente = -y;
  };
  const soltar = () => { setPino({ x: 0, y: 0 }); comando.current.lado = 0; comando.current.frente = 0; };
  return (
    <div ref={base} className="pointer-events-auto absolute bottom-24 left-5 h-28 w-28 touch-none rounded-full border border-white/25 bg-black/35 backdrop-blur md:hidden"
      onPointerDown={e => { (e.target as Element).setPointerCapture(e.pointerId); mover(e); }} onPointerMove={e => { if (e.buttons || e.pointerType === "touch") mover(e); }}
      onPointerUp={soltar} onPointerCancel={soltar} aria-label="Joystick para caminhar">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-12 w-12 rounded-full bg-[#C9A961]/90" style={{ transform: `translate(calc(-50% + ${pino.x * 34}px), calc(-50% + ${pino.y * 34}px))` }} />
    </div>
  );
}

/** Miniatura da planta do pavimento atual, com a posição e a direção do visitante. */
function Miniatura({ edificacao, pavimentoId, visitante }: { edificacao: Edificacao; pavimentoId: string; visitante: React.MutableRefObject<Visitante> }) {
  const pv = edificacao.pavimentos.find(p => p.id === pavimentoId) ?? edificacao.pavimentos[0];
  const [pos, setPos] = useState({ x: 0, z: 0, giro: 0 });
  useEffect(() => {
    const id = window.setInterval(() => { const v = visitante.current; setPos(p => (Math.abs(p.x - v.x) + Math.abs(p.z - v.z) + Math.abs(p.giro - v.giro) > 0.02 ? { x: v.x, z: v.z, giro: v.giro } : p)); }, 120);
    return () => window.clearInterval(id);
  }, [visitante]);
  if (!pv) return null;
  const l = limites(pontosDoPavimento(pv)), margem = 0.6, u = Math.max(l.largura, l.altura) / 60;
  return (
    <svg viewBox={`${l.minX - margem} ${l.minY - margem} ${l.largura + margem * 2} ${l.altura + margem * 2}`} className="pointer-events-none absolute right-4 top-20 hidden h-36 w-36 rounded-xl border border-white/15 bg-black/55 p-1 backdrop-blur sm:block" role="img" aria-label="Planta com a sua posição">
      {pv.comodos.map(c => <polygon key={c.id} points={c.poligono.map(p => `${p.x},${p.y}`).join(" ")} fill="#ffffff14" />)}
      {pv.paredes.map(w => <line key={w.id} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="#E5E7EB" strokeWidth={Math.max(w.espessura, u)} />)}
      <g transform={`translate(${pos.x} ${pos.z}) rotate(${(-pos.giro * 180) / Math.PI})`}>
        <path d={`M0,${-u * 5} L${u * 3},${u * 3} L0,${u * 1.5} L${-u * 3},${u * 3} Z`} fill="#C9A961" />
      </g>
    </svg>
  );
}

export function Visualizador({ modelo, comercial, aoSair, unidades = [] }: {
  modelo: ModeloMaquete; comercial: DadosComerciais; aoSair?: () => void;
  /** Situação de venda das unidades (Incorporação), para colorir os lotes. */
  unidades?: UnidadeVenda[];
}) {
  const [edIdx, setEdIdx] = useState(0);
  const edificacao: Edificacao | null = modelo.edificacoes[Math.min(edIdx, modelo.edificacoes.length - 1)] ?? null;
  const temEdificacao = !!edificacao && edificacao.pavimentos.length > 0;
  const imp = modelo.implantacao;
  const temImplantacao = !!imp && (imp.lotes.length > 0 || imp.terreno.length >= 3);
  const [lote, setLote] = useState<LoteNaCena | null>(null);
  const contagem = useMemo(() => {
    const c = new Map<SituacaoLote, number>();
    if (imp) for (const l of lotesDaCena(imp, unidades)) c.set(l.situacao, (c.get(l.situacao) ?? 0) + 1);
    return Array.from(c.entries());
  }, [imp, unidades]);
  const resumo = useMemo(() => resumoModelo(modelo), [modelo]);

  const andares = useMemo(() => (edificacao ? pavimentosOrdenados(edificacao) : []), [edificacao]);
  const toque = useMemo(() => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches, []);
  const [modo, setModo] = useState<Modo>("capa");
  const [estilo, setEstilo] = useState<Estilo>("moderno");
  const [horario, setHorario] = useState(0.12);
  const [telhado, setTelhado] = useState(true);
  const [vistaDeCima, setVistaDeCima] = useState(false);
  const [andar, setAndar] = useState<string | null>(null);
  const [qualidade, setQualidade] = useState<Qualidade>(toque ? "media" : "alta");
  const [pausado, setPausado] = useState(false);
  const [reinicio, setReinicio] = useState(0);
  const [local, setLocal] = useState<InfoLocal | null>(null);
  const [legenda, setLegenda] = useState<LegendaTour>(null);
  const [menu, setMenu] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const visitante = useRef<Visitante>(edificacao ? visitanteNaEntrada(edificacao) : { x: 0, z: 0, y: 0, giro: 0, inclinacao: 0, pavimentoId: "" });
  const comando = useRef<Comando>(comandoVazio());
  const raiz = useRef<HTMLDivElement>(null);

  // Som: liga e desliga pelo botão; começa junto com o tour se o visitante não tiver desligado.
  const trilha = useRef<Trilha | null>(null);
  const [som, setSom] = useState(false);
  const ligarSom = useCallback((ligar: boolean) => {
    if (ligar && !trilha.current) trilha.current = tocarTrilha();
    if (!ligar && trilha.current) { trilha.current.parar(); trilha.current = null; }
    setSom(ligar && !!trilha.current);
  }, []);
  useEffect(() => () => { trilha.current?.parar(); }, []);

  const voltarEntrada = useCallback(() => { if (edificacao) visitante.current = visitanteNaEntrada(edificacao); }, [edificacao]);
  const entrar = (m: Modo) => {
    setVistaDeCima(false); setLegenda(null); setPausado(false); setMenu(false);
    setLote(null);
    if (m === "interno") voltarEntrada();
    if (m === "tour") { setReinicio(r => r + 1); if (!trilha.current) ligarSom(true); }
    setModo(m);
  };
  const fimDoTour = useCallback(() => { setModo("externo"); setVistaDeCima(true); setTelhado(false); setLegenda(null); }, []);
  const telaCheia = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void raiz.current?.requestFullscreen?.().catch(() => undefined); };

  if (!temEdificacao && !temImplantacao) {
    return <div className="flex h-full min-h-[60vh] items-center justify-center bg-[#0F1923] p-6 text-center text-gray-300">Esta maquete ainda não tem uma edificação para mostrar em 3D.</div>;
  }

  const whats = comercial.whatsapp ? `https://wa.me/${comercial.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(`Olá! Vi a maquete 3D de ${comercial.nome} e quero falar com um consultor.`)}` : null;
  const fatos = [
    resumo.lotes > 0 && { rotulo: "Lotes", valor: String(imp?.lotes.filter(l => l.tipo === "vendavel").length ?? resumo.lotes) },
    resumo.areaTotal > 0 && { rotulo: "Área construída", valor: `${m2(resumo.areaTotal)} m²` },
    resumo.quartos > 0 && { rotulo: "Quartos", valor: `${resumo.quartos}${resumo.suites ? ` (${resumo.suites} suíte${resumo.suites > 1 ? "s" : ""})` : ""}` },
    resumo.banheiros > 0 && { rotulo: "Banheiros", valor: String(resumo.banheiros) },
    resumo.vagas > 0 && { rotulo: "Vagas", valor: String(resumo.vagas) },
    resumo.pavimentos > 1 && { rotulo: "Pavimentos", valor: String(resumo.pavimentos) },
  ].filter(Boolean) as { rotulo: string; valor: string }[];

  return (
    <div ref={raiz} className="relative h-full min-h-[100dvh] w-full select-none overflow-hidden bg-[#0B1022] text-white">
      {erro ? (
        <div className="flex h-full min-h-[100dvh] items-center justify-center p-6 text-center text-gray-300">
          Não foi possível iniciar o 3D neste aparelho ({erro}). Tente outro navegador ou reduza a qualidade.
        </div>
      ) : (
        <Canvas shadows={QUALIDADES[qualidade].sombras ? "soft" : false} dpr={QUALIDADES[qualidade].dpr} camera={{ fov: 62, near: 0.08, far: 4000, position: [14, 10, 16] }}
          gl={{ antialias: true, powerPreference: "high-performance" }} style={{ position: "absolute", inset: 0, touchAction: "none" }}
          onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 0.76; gl.domElement.addEventListener("webglcontextlost", () => setErro("o navegador encerrou o contexto gráfico")); }}>
          <Cena modelo={modelo} unidades={unidades} noLoteamento={temImplantacao && (modo === "implantacao" || (modo === "capa") || !temEdificacao)} lote={lote?.id ?? null} onLote={setLote}
            edificacao={temEdificacao ? edificacao : null} estilo={estilo} horario={horario} qualidade={qualidade} modo={modo} telhado={telhado} pausado={pausado} reinicio={reinicio}
            visitante={visitante} comando={comando} onLocal={setLocal} onLegenda={setLegenda} onFimTour={fimDoTour} vistaDeCima={vistaDeCima}
            corteAte={andares.find(a => a.id === andar)?.nivel ?? null} />
        </Canvas>
      )}

      {/* ── Tela de apresentação ── */}
      {modo === "capa" && (
        <div className="absolute inset-0 flex items-end bg-gradient-to-t from-[#0B1022] via-[#0B1022]/75 to-[#0B1022]/10 p-5 sm:items-center sm:p-10">
          <div className="pointer-events-auto w-full max-w-xl space-y-5">
            {comercial.logo && <img src={comercial.logo} alt="" className="h-12 w-auto" />}
            <div>
              <h1 className="text-3xl font-bold leading-tight sm:text-5xl">{comercial.nome}</h1>
              {comercial.localizacao && <p className="mt-2 text-base text-gray-300">{comercial.localizacao}</p>}
            </div>
            {fatos.length > 0 && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                {fatos.map(f => <div key={f.rotulo}><dt className="text-xs uppercase tracking-wide text-gray-400">{f.rotulo}</dt><dd className="text-xl font-semibold">{f.valor}</dd></div>)}
              </dl>
            )}
            {comercial.preco ? <p className="text-2xl font-bold text-[#C9A961]">{comercial.preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p> : null}
            {modelo.edificacoes.length > 1 && (
              <label className="block text-sm text-gray-300">Modelo
                <select className="mt-1 block h-10 w-full rounded-md border border-white/20 bg-black/50 px-3 text-white" value={edIdx} onChange={e => setEdIdx(Number(e.target.value))}>
                  {modelo.edificacoes.map((e, i) => <option key={e.id} value={i}>{e.nome}</option>)}
                </select></label>
            )}
            <div className="flex flex-wrap gap-3">
              <button type="button" className={`${btn} ${btnAtivo} h-12 px-6 text-base`} onClick={() => entrar(temImplantacao ? "implantacao" : "externo")}><Eye className="h-5 w-5" />{temImplantacao ? "EXPLORAR EMPREENDIMENTO" : "EXPLORAR IMÓVEL"}</button>
              {temEdificacao && <button type="button" className={`${btn} h-12 px-6 text-base`} onClick={() => entrar("tour")}><Play className="h-5 w-5" />INICIAR TOUR</button>}
              {whats && <a className={`${btn} h-12 px-6 text-base`} href={whats} target="_blank" rel="noreferrer"><MessageCircle className="h-5 w-5" />FALAR COM CONSULTOR</a>}
            </div>
          </div>
        </div>
      )}

      {/* ── Controles ── */}
      {modo !== "capa" && (
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-4 right-4 top-4 flex items-start justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btn} onClick={() => { setModo("capa"); setVistaDeCima(false); setLegenda(null); }} aria-label="Voltar à apresentação"><Home className="h-4 w-4" /><span className="hidden sm:inline">{comercial.nome}</span></button>
              {aoSair && <button type="button" className={btn} onClick={aoSair}>Fechar</button>}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={btn} onClick={() => ligarSom(!som)} aria-label={som ? "Desligar o som" : "Ligar o som"}>{som ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}</button>
              <button type="button" className={btn} onClick={telaCheia} aria-label="Tela cheia"><Maximize className="h-4 w-4" /></button>
              <button type="button" className={`${btn} ${menu ? btnAtivo : ""}`} onClick={() => setMenu(v => !v)}><Layers className="h-4 w-4" />Menu</button>
            </div>
          </div>

          {modo === "implantacao" && (
            <div className="pointer-events-auto absolute left-4 top-16 max-w-[min(20rem,calc(100vw-2rem))] space-y-2 rounded-2xl border border-white/15 bg-black/65 p-3 text-sm backdrop-blur">
              {contagem.map(([s, n]) => (
                <p key={s} className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: SITUACOES[s].cor }} />{SITUACOES[s].rotulo}<span className="ml-auto pl-3 font-semibold">{n}</span></p>
              ))}
              {lote ? (
                <div className="border-t border-white/15 pt-2">
                  <p className="text-base font-semibold">{lote.rotulo}</p>
                  <p className="text-[#C9A961]">{m2(lote.area)} m² · {SITUACOES[lote.situacao].rotulo}</p>
                </div>
              ) : imp && imp.lotes.length > 0 ? <p className="border-t border-white/15 pt-2 text-xs text-gray-300">Toque em um lote para ver a área e a situação.</p> : null}
            </div>
          )}
          {local && modo !== "externo" && modo !== "implantacao" && (
            <div className="absolute left-1/2 top-16 -translate-x-1/2 rounded-full bg-black/55 px-4 py-1.5 text-sm backdrop-blur sm:top-4">
              {local.comodo ?? "Área externa"}{resumo.pavimentos > 1 ? ` · ${local.pavimento}` : ""}
            </div>
          )}
          {edificacao && modo !== "externo" && modo !== "implantacao" && local && <Miniatura edificacao={edificacao} pavimentoId={local.pavimentoId} visitante={visitante} />}

          {menu && (
            <div className="pointer-events-auto absolute right-4 top-16 w-72 max-w-[calc(100vw-2rem)] space-y-4 rounded-2xl border border-white/15 bg-black/75 p-4 backdrop-blur">
              <div>
                <p className="mb-2 text-xs uppercase tracking-wide text-gray-400">Estilo de decoração</p>
                <div className="flex flex-wrap gap-2">{ESTILOS.map(e => <button key={e} type="button" className={`${btn} h-9 px-3 ${estilo === e ? btnAtivo : ""}`} onClick={() => setEstilo(e)}>{ROTULOS_ESTILO[e]}</button>)}</div>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-gray-400">Horário</p>
                <input type="range" min={0} max={1} step={0.01} value={horario} onChange={e => setHorario(Number(e.target.value))} className="w-full accent-[#C9A961]" aria-label="Horário do dia" />
                <div className="flex justify-between text-xs text-gray-300">{HORARIOS.map(h => <button key={h.t} type="button" className="underline-offset-2 hover:underline" onClick={() => setHorario(h.t)}>{h.rotulo}</button>)}</div>
              </div>
              <div>
                <p className="mb-2 text-xs uppercase tracking-wide text-gray-400">Qualidade gráfica</p>
                <div className="flex gap-2">{(Object.keys(QUALIDADES) as Qualidade[]).map(q => <button key={q} type="button" className={`${btn} h-9 px-3 ${qualidade === q ? btnAtivo : ""}`} onClick={() => setQualidade(q)}>{QUALIDADES[q].rotulo}</button>)}</div>
              </div>
              {modelo.edificacoes.length > 1 && (
                <label className="block text-xs uppercase tracking-wide text-gray-400">Modelo
                  <select className="mt-1 block h-9 w-full rounded-md border border-white/20 bg-black/50 px-2 text-sm normal-case text-white" value={edIdx} onChange={e => { setEdIdx(Number(e.target.value)); setModo("externo"); }}>
                    {modelo.edificacoes.map((e, i) => <option key={e.id} value={i}>{e.nome}</option>)}
                  </select></label>
              )}
              {whats && <a className={`${btn} w-full justify-center`} href={whats} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" />Falar com consultor</a>}
              <p className="text-xs text-gray-400">{modo === "interno" ? (toque ? "Use o joystick para andar e arraste a tela para olhar." : "W A S D ou setas para andar · arraste o mouse para olhar · duplo clique trava o mouse (Esc solta) · Shift corre.") : "Arraste para girar · role ou use dois dedos para aproximar."}</p>
            </div>
          )}

          {/* Legenda do tour */}
          {modo === "tour" && legenda && (
            <div className="absolute bottom-[4.5rem] left-1/2 w-[min(92vw,26rem)] -translate-x-1/2 rounded-2xl border border-white/15 bg-black/60 px-4 py-2 text-center backdrop-blur sm:bottom-20">
              <p className="text-xl font-semibold leading-tight">{legenda.nome} <span className="text-base font-normal text-[#C9A961]">· {m2(legenda.area)} m²</span></p>
              <p className="text-xs text-gray-300">{legenda.destaque ? `${legenda.destaque} · ` : ""}{legenda.indice} de {legenda.total}</p>
            </div>
          )}

          {modo === "interno" && <Joystick comando={comando} />}

          {/* Barra de baixo */}
          <div className="absolute bottom-4 left-1/2 flex w-[min(96vw,44rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2">
            {temImplantacao && <button type="button" className={`${btn} ${modo === "implantacao" ? btnAtivo : ""}`} onClick={() => entrar("implantacao")}><Layers className="h-4 w-4" />Implantação</button>}
            {modo === "implantacao" && <button type="button" className={`${btn} ${vistaDeCima ? btnAtivo : ""}`} onClick={() => setVistaDeCima(v => !v)}>Vista de cima</button>}
            {temEdificacao && <button type="button" className={`${btn} ${modo === "externo" ? btnAtivo : ""}`} onClick={() => entrar("externo")}><Box className="h-4 w-4" />{temImplantacao ? `${edificacao!.nome} por fora` : "Por fora"}</button>}
            {temEdificacao && <button type="button" className={`${btn} ${modo === "interno" ? btnAtivo : ""}`} onClick={() => entrar("interno")}><Footprints className="h-4 w-4" />Por dentro</button>}
            {modo === "externo" && <button type="button" className={`${btn} ${!telhado ? btnAtivo : ""}`} onClick={() => setTelhado(v => !v)}><Layers className="h-4 w-4" />{telhado ? "Ocultar telhado" : "Mostrar telhado"}</button>}
            {modo === "externo" && <button type="button" className={`${btn} ${vistaDeCima ? btnAtivo : ""}`} onClick={() => { setVistaDeCima(v => !v); if (!vistaDeCima) setTelhado(false); }}>Vista de cima</button>}
            {modo === "externo" && !telhado && andares.length > 1 && andares.map((a, i) => {
              const ativo = andar === a.id || (andar === null && i === andares.length - 1);
              return <button key={a.id} type="button" className={`${btn} ${ativo ? btnAtivo : ""}`} onClick={() => setAndar(i === andares.length - 1 ? null : a.id)}>{a.nome}</button>;
            })}
            {modo === "interno" && <button type="button" className={btn} onClick={voltarEntrada}><DoorOpen className="h-4 w-4" />Voltar à entrada</button>}
            {modo === "tour" ? (
              <>
                <button type="button" className={`${btn} ${btnAtivo}`} onClick={() => setPausado(v => !v)}>{pausado ? <><Play className="h-4 w-4" />Continuar</> : <><Pause className="h-4 w-4" />Pausar</>}</button>
                <button type="button" className={btn} onClick={() => { setPausado(false); setReinicio(r => r + 1); }}><RotateCcw className="h-4 w-4" />Reiniciar</button>
              </>
            ) : temEdificacao ? <button type="button" className={btn} onClick={() => entrar("tour")}><Play className="h-4 w-4" />INICIAR TOUR VIRTUAL</button> : null}
          </div>
        </div>
      )}
    </div>
  );
}

export default Visualizador;

/** Lista de pavimentos em ordem (usada por quem embute o visualizador). */
export const pavimentosDoModelo = (m: ModeloMaquete) => m.edificacoes.flatMap(e => pavimentosOrdenados(e).map(p => p.nome));
