// Maquete 3D (EPIC-028, Etapa 3) — MODO EDIÇÃO dos itens (só admin; pedaço lazy, baixado só por quem edita). O 3D
// (vista geral em corte) e a planta 2D mostram o mesmo estado: tocar/clicar num item seleciona (contorno), arrastar
// move no plano do piso com encaixe de 5 cm e na face da parede, o painel de campos muda o item na hora, o catálogo
// adiciona e remove, desfazer/refazer, restaurar o padrão. As regras são as de `validarFonte` (Etapa 1): qualquer erro
// fica em vermelho e BLOQUEIA salvar e publicar; o servidor confere tudo de novo. Salvar grava só os itens (rascunho);
// "Publicar" troca o que o cliente vê.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as THREE from "three";
import type { FontePlanta, ItemFonte } from "@shared/maquete-3d/fonte";
import { ambienteEm, cenaDaFonte, ehAuxiliar, pecasDaFonte, type PecaFonte } from "@shared/maquete-3d/fonte-cena";
import type { TipoMovel } from "@shared/maquete-3d/mobilia";
import {
  alterarItem, ambientesEditaveis, canonico, comTravaDaFonte, converterTipo, criarHistorico, desfazer, fecharGesto, girar, itensDoProblema, novoItem,
  portasBloqueadas, posicaoArrastada, problemasDaEdicao, refazer, registrar, rotuloDoTipo, vistaDoAmbiente, type Historico,
} from "@shared/maquete-3d/edicao";
import { Planta2D } from "../planta2d/Planta2D";
import VisualizadorFonte, { type Controles } from "../visualizador/VisualizadorFonte";
import { BarraEdicao } from "./BarraEdicao";
import { Catalogo } from "./Catalogo";
import { lerErro, type ConexaoEditor, type DadosEdicao } from "./conexao";
import { Contorno, Interacao3D, ZonasBloqueadas, type Arraste } from "./Interacao3D";
import { PainelItem, botao } from "./PainelItem";

type Mensagem = { tipo: "ok" | "erro"; texto: string; conflito?: boolean };

/** Peça do catálogo de cada item, refeita só quando o item muda (o resto da cena não redesenha). */
function usarPecas(fonte: FontePlanta, itens: ItemFonte[]): PecaFonte[] {
  const cache = useRef(new WeakMap<ItemFonte, PecaFonte>());
  return useMemo(() => itens.map(i => {
    let p = cache.current.get(i);
    if (!p) { p = pecasDaFonte({ ...fonte, itens: [i] })[0]; cache.current.set(i, p); }
    return p;
  }), [fonte, itens]);
}

/** Computador (o enquadramento no ambiente e a planta grande valem só aí; no celular, 3D e planta já ocupam a tela). */
function usarComputador() {
  const consulta = "(min-width: 768px)";
  const [sim, setSim] = useState(() => typeof window !== "undefined" && window.matchMedia(consulta).matches);
  useEffect(() => {
    const m = window.matchMedia(consulta), mudou = () => setSim(m.matches);
    m.addEventListener("change", mudou);
    return () => m.removeEventListener("change", mudou);
  }, []);
  return sim;
}

const ehCampoDeTexto = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName));

/** `aoPublicar`: avisa quem está ao lado (o painel de lotes) que uma versão acabou de ser publicada. */
export default function EditorItens({ planta, conexao, aoSair, aoPublicar }: {
  planta: string; conexao: ConexaoEditor; aoSair: (itens: ItemFonte[] | null) => void; aoPublicar?: (versao: number) => void;
}) {
  const [dados, setDados] = useState<DadosEdicao | null>(null);
  const [erroAbrir, setErroAbrir] = useState<string | null>(null);
  const [h, setH] = useState<Historico<ItemFonte[]> | null>(null);
  const [salvos, setSalvos] = useState<ItemFonte[]>([]);
  const [versaoBase, setVersaoBase] = useState(0);
  const [versaoPublicada, setVersaoPublicada] = useState<number | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [aba, setAba] = useState<"3d" | "planta">("3d");
  const [ambCat, setAmbCat] = useState("Sala");
  const [ocupado, setOcupado] = useState<null | "salvar" | "publicar">(null);
  const [msg, setMsg] = useState<Mensagem | null>(null);
  const [pronto, setPronto] = useState(false);
  /** Ambiente em que o 3D está enquadrado (computador); null = visão geral. */
  const [foco, setFoco] = useState<string | null>(null);
  const [plantaGrande, setPlantaGrande] = useState(false);
  /** A versão carregada é de outra estrutura da planta: Salvar fica liberado mesmo sem mudança nos itens. */
  const [precisaRegravar, setPrecisaRegravar] = useState(false);
  const computador = usarComputador();

  const abrir = useCallback(async () => {
    setErroAbrir(null);
    try {
      const d = await conexao.abrir(planta);
      // A trava de cada item é a da planta (servidor), nunca a que veio gravada na versão.
      const carregados = comTravaDaFonte(d.padrao, d.fonte.itens);
      setDados(d); setH(criarHistorico(carregados)); setSalvos(carregados);
      setVersaoBase(d.versaoBase); setVersaoPublicada(d.versaoPublicada); setSel(null);
      setPrecisaRegravar(!!d.precisaRegravar);
      setMsg(d.precisaRegravar ? { tipo: "erro", texto: "A planta mudou desde o último salvar. Salve de novo para poder publicar." } : null);
    } catch (e) { setErroAbrir(lerErro(e).mensagem); }
  }, [conexao, planta]);
  useEffect(() => { void abrir(); }, [abrir]);

  const base = dados?.fonte ?? null;
  const itens = h?.presente ?? [];
  const cena = useMemo(() => (base ? cenaDaFonte(base) : null), [base]);
  const geral = cena?.vistas.find(v => v.tipo === "geral") ?? cena?.vistas[0] ?? null;
  const vista = useMemo(() => (base && geral && foco && computador ? vistaDoAmbiente(base, geral, foco) ?? geral : geral), [base, geral, foco, computador]);
  const fonte = useMemo(() => (base ? { ...base, itens } : null), [base, itens]);
  const pecas = usarPecas(base ?? ({ estrutura: { ambientes: [] } } as unknown as FontePlanta), base ? itens : []);
  const problemas = useMemo(() => (base ? problemasDaEdicao(base, itens, dados?.padrao ?? base.itens) : []), [base, itens, dados]);
  const erros = useMemo(() => problemas.filter(p => p.nivel === "erro"), [problemas]);
  const avisos = useMemo(() => problemas.filter(p => p.nivel === "aviso"), [problemas]);
  const comErro = useMemo(() => new Set(erros.flatMap(p => itensDoProblema(p, itens))), [erros, itens]);
  const bloqueadas = useMemo(() => (base ? portasBloqueadas(base, itens) : []), [base, itens]);
  const zonas = useMemo(() => bloqueadas.flatMap(b => b.zonas), [bloqueadas]);
  const ambientes = useMemo(() => (base ? ambientesEditaveis(base).map(a => a.nome) : []), [base]);
  const editaveis = useMemo(() => new Set(comTravaDaFonte(dados?.padrao ?? [], itens).filter(i => i.editavel).map(i => i.id)), [itens, dados]);
  const sujo = useMemo(() => canonico(itens) !== canonico(salvos), [itens, salvos]);
  const item = itens.find(i => i.id === sel) ?? null;
  const itensRef = useRef(itens);
  itensRef.current = itens;
  /** Enquadra o 3D no ambiente do item (o contorno amarelo fica visível); a câmera não volta sozinha ao desmarcar. */
  const focar = useCallback((id: string) => { const i = itensRef.current.find(q => q.id === id); if (i) setFoco(i.ambiente); }, []);

  // ── Mudanças (todas passam pelo histórico) ──
  const mudar = useCallback((f: (lista: ItemFonte[]) => ItemFonte[], chave: string | null = null) => {
    setH(x => (x ? registrar(x, f(x.presente), chave) : x));
  }, []);
  const mover = useCallback((id: string, x: number, z: number, chave: string) => {
    if (!base) return;
    mudar(lista => {
      const i = lista.find(q => q.id === id);
      if (!i) return lista;
      const pos = posicaoArrastada(base, i, x, z);
      if (Math.abs(pos.x - i.x) < 1e-9 && Math.abs(pos.z - i.z) < 1e-9) return lista;
      // Atravessou para outro ambiente: o item passa a ser dele (menos quando o ambiente já está em "alcança").
      const amb = ambienteEm(base, pos.x, pos.z);
      const novoAmb = amb && !ehAuxiliar(amb) && amb.nome !== i.ambiente && !(i.alcanca ?? []).includes(amb.nome) ? amb.nome : null;
      return lista.map(q => (q.id === id ? { ...q, x: pos.x, z: pos.z, ...(novoAmb ? { ambiente: novoAmb } : {}) } : q));
    }, chave);
  }, [base, mudar]);

  // Arraste: no máximo uma mudança por quadro.
  const pendente = useRef<Arraste | null>(null), quadro = useRef(0);
  const aoArrastar = useCallback((a: Arraste) => {
    pendente.current = a;
    if (quadro.current) return;
    quadro.current = requestAnimationFrame(() => {
      quadro.current = 0;
      const p = pendente.current;
      if (p) mover(p.id, p.x, p.z, `arrastar:${p.id}:${p.gesto}`);
    });
  }, [mover]);
  const aoSoltar = useCallback(() => {
    setH(x => (x ? fecharGesto(x) : x));
    const id = focoPendente.current;
    focoPendente.current = null;
    // Depois do quadro: o item já está no ambiente para onde foi arrastado.
    if (id) requestAnimationFrame(() => focar(id));
  }, [focar]);
  useEffect(() => () => cancelAnimationFrame(quadro.current), []);

  const doItem = (m: Partial<ItemFonte>, campo: string) => {
    if (!base || !sel) return;
    mudar(lista => alterarItem(base, lista, sel, m), `campo:${sel}:${campo}`);
  };
  const girarSel = (g: number) => sel && mudar(lista => lista.map(i => (i.id === sel ? girar(i, g) : i)));
  const converter = (t: TipoMovel) => sel && mudar(lista => lista.map(i => (i.id === sel ? converterTipo(i, t) : i)));
  const remover = () => { if (!sel) return; const id = sel; setSel(null); mudar(lista => lista.filter(i => i.id !== id)); };
  const adicionar = (t: TipoMovel) => {
    if (!base) return;
    const novo = novoItem(base, t, ambCat, itens);
    mudar(lista => [...lista, novo]);
    setSel(novo.id);
  };
  const selecionar = useCallback((id: string | null, enquadrar = true) => {
    setSel(id);
    if (id) {
      const i = h?.presente.find(q => q.id === id);
      if (i && ambientes.includes(i.ambiente)) setAmbCat(i.ambiente);
      if (enquadrar) focar(id);
    }
  }, [h, ambientes, focar]);
  // No 3D o toque num item já pode virar arraste: a câmera só se move quando o dedo/mouse sobe (aoSoltar).
  const focoPendente = useRef<string | null>(null);
  const selecionar3d = useCallback((id: string | null) => {
    selecionar(id, false);
    if (id && itensRef.current.find(q => q.id === id)?.editavel) focoPendente.current = id;
    else if (id) focar(id);
  }, [selecionar, focar]);
  const restaurar = () => { if (!dados) return; mudar(() => dados.padrao); setSel(null); setMsg({ tipo: "ok", texto: "Itens padrão da planta de volta. Salve para gravar (ou desfaça)." }); };
  const desfazerUm = useCallback(() => setH(x => (x ? desfazer(x) : x)), []);
  const refazerUm = useCallback(() => setH(x => (x ? refazer(x) : x)), []);

  // Atalhos: Ctrl+Z / Ctrl+Shift+Z (e Ctrl+Y); Esc tira a seleção. Dentro de um campo vale o desfazer do próprio campo.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (ehCampoDeTexto(e.target)) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); if (e.shiftKey) refazerUm(); else desfazerUm(); }
      else if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); refazerUm(); }
      else if (k === "escape") setSel(null);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [desfazerUm, refazerUm]);

  // ── Planta 2D: tocar e arrastar ──
  const svg = useRef<SVGSVGElement | null>(null);
  const arraste2d = useRef<{ pid: number; id: string; dx: number; dz: number; gesto: number } | null>(null);
  const gestos2d = useRef(1_000_000);
  const pontoSvg = (e: { clientX: number; clientY: number }) => {
    const s = svg.current, m = s?.getScreenCTM();
    if (!s || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, z: p.y };
  };
  const aoApontarItem = (id: string, e: React.PointerEvent<SVGElement>) => {
    selecionar(id);
    const i = itens.find(q => q.id === id), p = pontoSvg(e);
    if (!i || !i.editavel || !p) return;
    arraste2d.current = { pid: e.pointerId, id, dx: i.x - p.x, dz: i.z - p.z, gesto: ++gestos2d.current };
    try { svg.current?.setPointerCapture(e.pointerId); } catch { /* sem captura */ }
  };
  useEffect(() => {
    const mov = (e: PointerEvent) => {
      const a = arraste2d.current;
      if (!a || e.pointerId !== a.pid) return;
      e.preventDefault();
      const p = pontoSvg(e);
      if (p) aoArrastar({ id: a.id, x: p.x + a.dx, z: p.z + a.dz, gesto: a.gesto });
    };
    const fim = (e: PointerEvent) => { if (arraste2d.current && e.pointerId === arraste2d.current.pid) { arraste2d.current = null; aoSoltar(); } };
    window.addEventListener("pointermove", mov, { passive: false });
    window.addEventListener("pointerup", fim);
    window.addEventListener("pointercancel", fim);
    return () => { window.removeEventListener("pointermove", mov); window.removeEventListener("pointerup", fim); window.removeEventListener("pointercancel", fim); };
  }, [aoArrastar, aoSoltar]);

  // ── Salvar e publicar ──
  const salvar = async () => {
    setOcupado("salvar"); setMsg(null);
    try {
      const r = await conexao.salvar(planta, versaoBase, itens);
      setVersaoBase(r.versao); setSalvos(itens); setPrecisaRegravar(false);
      setMsg({ tipo: "ok", texto: `Rascunho salvo (versão ${r.versao}). O cliente continua vendo a versão publicada até você publicar.` });
    } catch (e) { const x = lerErro(e); setMsg({ tipo: "erro", texto: x.mensagem, conflito: x.conflito }); }
    finally { setOcupado(null); }
  };
  const publicar = async () => {
    setOcupado("publicar"); setMsg(null);
    try {
      const r = await conexao.publicar(planta, versaoBase, versaoPublicada);
      setVersaoPublicada(r.versao);
      setMsg({ tipo: "ok", texto: `Publicado: o cliente passa a ver a versão ${r.versao}.` });
      aoPublicar?.(r.versao);
    } catch (e) { const x = lerErro(e); setMsg({ tipo: "erro", texto: x.mensagem, conflito: x.conflito }); }
    finally { setOcupado(null); }
  };

  const grupoItens = useRef<THREE.Group | null>(null);
  const controles = useRef<Controles | null>(null);
  const marcarPronto = useCallback(() => setPronto(true), []);

  if (erroAbrir) return (
    <div className="grid gap-3 p-6 text-[#111]" role="alert">
      <p className="m-0">Não foi possível abrir o editor: {erroAbrir}</p>
      <div className="flex gap-2"><button type="button" className={botao} onClick={() => void abrir()}>Tentar de novo</button><button type="button" className={botao} onClick={() => aoSair(null)}>Voltar</button></div>
    </div>
  );
  if (!dados || !h || !cena || !vista || !fonte) return <div className="p-6 text-[#6B6B66]">Abrindo o editor…</div>;

  const semNada = versaoBase === 0;
  const estado = sujo ? "Alterações não salvas"
    : precisaRegravar ? "A planta mudou: salve de novo para poder publicar"
    : semNada ? "Itens padrão da planta (nada salvo ainda)"
    : versaoBase !== versaoPublicada ? `Rascunho não publicado (versão ${versaoBase})${versaoPublicada ? ` · o cliente vê a versão ${versaoPublicada}` : " · nada publicado ainda"}`
    : `Publicado · versão ${versaoPublicada}`;
  const motivo = erros.length ? `${erros.length} problema${erros.length > 1 ? "s" : ""} em vermelho: corrija para salvar ou publicar.` : null;
  const selPeca = pecas.find(p => p.id === sel);

  return (
    <div className="grid gap-3" data-teste="editor" data-pronto={pronto ? "1" : "0"} data-erros={erros.length}>
      <BarraEdicao
        e={{
          podeDesfazer: h.passado.length > 0, podeRefazer: h.futuro.length > 0,
          podeSalvar: !ocupado && (sujo || precisaRegravar) && !erros.length, podePublicar: !ocupado && !sujo && !precisaRegravar && !semNada && versaoBase !== versaoPublicada && !erros.length,
          ocupado, estado, tomEstado: sujo || precisaRegravar || (!semNada && versaoBase !== versaoPublicada) ? "pendente" : !semNada ? "ok" : "neutro", motivoBloqueio: motivo,
        }}
        aoDesfazer={desfazerUm} aoRefazer={refazerUm} aoRestaurar={restaurar} aoSalvar={() => void salvar()} aoPublicar={() => void publicar()}
        aoSair={() => aoSair(itens)} />
      {msg && (
        <div role={msg.tipo === "erro" ? "alert" : "status"} className={`flex flex-wrap items-center gap-2 rounded border px-3 py-2 text-[15px] ${msg.tipo === "erro" ? "border-[#F4B4AE] bg-[#FDECEA] text-[#8F1D14]" : "border-[#B5DEC2] bg-[#E7F6EC] text-[#1E5B32]"}`}>
          <span>{msg.texto}</span>
          {msg.conflito && <button type="button" className={botao} onClick={() => void abrir()}>Recarregar a versão mais nova (perde o que não foi salvo)</button>}
        </div>
      )}

      {/* Celular: 3D ou planta (mesmo estado); computador: os dois lado a lado. */}
      <div className="flex gap-2 md:hidden" role="tablist" aria-label="Vista do editor">
        {(["3d", "planta"] as const).map(a => (
          <button key={a} type="button" role="tab" aria-selected={aba === a} className={`${botao} flex-1 aria-selected:border-[#111] aria-selected:bg-[#FFE600]`} onClick={() => setAba(a)}>
            {a === "3d" ? "3D" : "Planta 2D"}
          </button>
        ))}
      </div>
      {/* Computador: 3D à esquerda e planta + painel à direita; "Ampliar planta" troca o 3D pela planta grande. */}
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(360px,460px)] md:grid-rows-[auto_1fr]">
        <div className={`${aba === "3d" ? "block" : "hidden"} relative h-[46vh] min-h-[300px] overflow-hidden rounded-md bg-[#D8D8D4] md:row-span-2 md:h-[min(78vh,760px)] ${plantaGrande ? "md:hidden" : "md:block"}`} data-teste="editor-3d" style={{ touchAction: "none" }}>
          <VisualizadorFonte cena={cena} pecas={pecas} vista={vista} telhado={false} aoPronto={marcarPronto} grupoItens={grupoItens} controlesRef={controles} semRotulos>
            <Interacao3D grupoItens={grupoItens} controles={controles} pecas={pecas} editaveis={editaveis} aoSelecionar={selecionar3d} aoArrastar={aoArrastar} aoSoltar={aoSoltar} />
            <ZonasBloqueadas zonas={zonas} y={0.4} />
            {pecas.filter(p => comErro.has(p.id) && p.id !== sel).map(p => <Contorno key={`e-${p.id}`} p={p} erro selecionado={false} />)}
            {selPeca && <Contorno p={selPeca} erro={comErro.has(selPeca.id)} selecionado />}
          </VisualizadorFonte>
          <div className="pointer-events-none absolute left-2.5 top-2.5 max-w-[calc(100%-1.25rem)] rounded-[3px] bg-white/85 px-2 py-0.5 text-[13px] text-[#111]">
            Toque num item para selecionar · arraste o item para mover (encaixe de 5 cm e na parede) · fora dos itens, arraste para girar a vista
          </div>
          {foco && computador && (
            <button type="button" className={`${botao} absolute bottom-2.5 right-2.5 bg-white`} onClick={() => setFoco(null)} data-teste="ver-casa">Ver a casa toda</button>
          )}
        </div>
        <div className={`${aba === "planta" ? "block" : "hidden"} relative rounded-md border border-[#E4E4E0] bg-white md:block ${plantaGrande ? "md:col-start-1 md:row-span-2 md:row-start-1" : "md:col-start-2 md:row-start-1"}`} data-teste="editor-planta">
          <div className={`mx-auto h-[46vh] min-h-[300px] w-full ${plantaGrande ? "md:h-[min(78vh,760px)] md:max-w-none" : "max-w-[560px] md:h-[min(52vh,520px)]"}`}>
            <Planta2D fonte={fonte} edicao={{ selecionado: sel, comErro, zonas, aoApontarItem, aoApontarFundo: () => setSel(null), svgRef: svg }} />
          </div>
          <div className="absolute right-2 top-2 hidden md:block">
            <button type="button" className={botao} aria-pressed={plantaGrande} onClick={() => setPlantaGrande(v => !v)} data-teste="ampliar-planta">
              {plantaGrande ? "Voltar ao 3D" : "Ampliar planta"}
            </button>
          </div>
        </div>
        <div className={`grid content-start gap-3 md:col-start-2 ${plantaGrande ? "md:row-span-2 md:row-start-1" : "md:row-start-2"}`}>
          {(erros.length > 0 || avisos.length > 0) && (
            <section aria-label="Avisos" className="grid gap-1.5" data-teste="avisos">
              {erros.map((p, k) => {
                const ids = itensDoProblema(p, itens);
                return (
                  <button key={`e${k}`} type="button" onClick={() => ids[0] && selecionar(ids[0])}
                    className="min-h-[44px] rounded border border-[#F4B4AE] bg-[#FDECEA] px-3 py-2 text-left text-[15px] font-medium text-[#B42318]">
                    {p.mensagem}
                  </button>
                );
              })}
              {avisos.map((p, k) => <p key={`a${k}`} className="m-0 rounded border border-[#F2D58A] bg-[#FFF4D6] px-3 py-2 text-[14px] text-[#7A4B00]">{p.mensagem}</p>)}
            </section>
          )}
          <div className="rounded-md border border-[#E4E4E0] bg-white p-3">
            {item ? (
              <PainelItem item={item} ambientes={ambientes} aoMudar={doItem} aoGirar={girarSel} aoConverter={converter} aoRemover={remover} />
            ) : (
              <p className="m-0 text-[15px] text-[#55554F]">Toque num item no 3D ou na planta para mudar posição, giro, medidas, material e cor. Paredes, portas, janelas, piso e telhado não se editam aqui.</p>
            )}
          </div>
        </div>
      </div>
      <div className="rounded-md border border-[#E4E4E0] bg-white p-3">
        <Catalogo ambientes={ambientes} ambiente={ambientes.includes(ambCat) ? ambCat : ambientes[0]} aoEscolherAmbiente={setAmbCat} aoAdicionar={adicionar} />
      </div>
      <p className="m-0 text-[13px] text-[#6B6B66]">
        {itens.length} itens · {rotuloDoTipo("balcao")} e bancadas são itens (nunca parede) · as mesmas regras são conferidas de novo pelo servidor ao salvar e ao publicar.
      </p>
    </div>
  );
}
