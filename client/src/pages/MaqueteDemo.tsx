// Maquete 3D (EPIC-028, Etapa 2) — PRÉVIA do gerador do JSON-fonte, sem banco: /maquete-demo/<planta> lê
// data/plantas/<planta>.json do repositório (só medidas; nenhum dado de cliente). Não é a página pública do lote
// (Etapa 4). Três modos: visão geral em corte (com o botão Telhado), tour por cômodo (olhos a 1,60 m do piso) e
// planta 2D com cotas. A planta aparece primeiro; o 3D é baixado sob demanda (lazy).
// Endereço com # escolhe o modo: #geral, #telhado, #planta ou o cômodo (#sala, #cozinha, #quarto-1…).
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { lerFonte, type FontePlanta } from "@shared/maquete-3d/fonte";
import { cenaDaFonte, legendaDasAberturas, pecasDaFonte } from "@shared/maquete-3d/fonte-cena";
import { conferirAreas, validarFonte } from "@shared/maquete-3d/validacao-fonte";
import { fmtM, planta2d } from "@shared/maquete-3d/planta2d";
import { ROTULOS_MOVEL_FONTE } from "@shared/maquete-3d/rotulos-itens";
import { Planta2D } from "@/components/maquete-3d/planta2d/Planta2D";

const VisualizadorFonte = lazy(() => import("@/components/maquete-3d/visualizador/VisualizadorFonte"));
const PLANTAS = import.meta.glob<{ default: unknown }>("../../../data/plantas/*.json");

type Estado = { tipo: "carregando" } | { tipo: "erro"; texto: string } | { tipo: "ok"; fonte: FontePlanta };

function usarFonte(nome: string | undefined): Estado {
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  useEffect(() => {
    const carregar = nome && /^[a-z0-9-]{1,80}$/.test(nome) ? PLANTAS[`../../../data/plantas/${nome}.json`] : undefined;
    if (!carregar) { setEstado({ tipo: "erro", texto: "Planta não encontrada." }); return; }
    let vivo = true;
    carregar().then(m => { if (vivo) setEstado({ tipo: "ok", fonte: lerFonte(m.default) }); })
      .catch(() => { if (vivo) setEstado({ tipo: "erro", texto: "Não foi possível ler o JSON da planta." }); });
    return () => { vivo = false; };
  }, [nome]);
  return estado;
}

const botao = "inline-flex min-h-[44px] flex-none items-center whitespace-nowrap rounded border border-[#E4E4E0] bg-white px-4 text-[15px] text-[#111] transition-colors hover:bg-[#F4F4F1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#111] aria-pressed:border-[#111] aria-pressed:bg-[#FFE600]";

function Pagina({ fonte }: { fonte: FontePlanta }) {
  const cena = useMemo(() => cenaDaFonte(fonte), [fonte]);
  const pecas = useMemo(() => pecasDaFonte(fonte), [fonte]);
  const problemas = useMemo(() => validarFonte(fonte), [fonte]);
  const areas = useMemo(() => conferirAreas(fonte), [fonte]);
  const p2d = useMemo(() => planta2d(fonte), [fonte]);
  const esquadrias = p2d.quadroEsquadrias, proporcao = p2d.viewBox[2] / p2d.viewBox[3];
  const ids = useMemo(() => new Set(["geral", "telhado", "planta", ...cena.vistas.map(v => v.id)]), [cena]);
  const inicial = () => {
    const h = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    if (ids.has(h)) return h;
    // Celular abre na planta (leve); o 3D só é baixado quando a pessoa escolhe uma vista.
    return typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches ? "planta" : "geral";
  };
  const [modo, setModo] = useState<string>(inicial);
  const [pronto, setPronto] = useState<string | null>(null);
  const ir = useCallback((id: string) => {
    setModo(id); setPronto(null);
    try { history.replaceState(null, "", `#${id}`); } catch { /* sem histórico */ }
  }, []);
  useEffect(() => {
    const aoMudar = () => { const h = window.location.hash.slice(1); if (ids.has(h)) { setModo(h); setPronto(null); } };
    window.addEventListener("hashchange", aoMudar);
    return () => window.removeEventListener("hashchange", aoMudar);
  }, [ids]);

  const planta = modo === "planta", telhado = modo === "telhado";
  const vista = cena.vistas.find(v => v.id === (telhado ? "geral" : modo)) ?? cena.vistas[0];
  const marcarPronto = useCallback(() => setPronto(modo), [modo]);
  const [titulo, ...resto] = fonte.nome.split(" — ");
  const area = areas.find(a => a.nome === vista.ambiente);
  const aberturas = vista.ambiente ? legendaDasAberturas(fonte, vista.ambiente) : [];
  const itens = vista.ambiente ? fonte.itens.filter(i => i.ambiente === vista.ambiente).map(i => ROTULOS_MOVEL_FONTE[i.tipo]) : [];
  const erros = problemas.filter(p => p.nivel === "erro").length, avisos = problemas.length - erros;

  return (
    <div className="min-h-[100dvh] bg-white pb-10 text-[16px] leading-[1.55] text-[#111]">
      <header className="flex flex-wrap items-baseline justify-between gap-4 px-[max(4vw,16px)] pb-3 pt-5">
        <h1 className="m-0 text-[clamp(22px,3vw,32px)] font-medium leading-tight">{titulo}</h1>
        <span className="text-sm text-[#6B6B66]">{resto.join(" — ")} · lote {fmtM(fonte.lote.w)} × {fmtM(fonte.lote.d)} m · prévia do gerador (Etapa 2)</span>
      </header>

      <div className={`relative mx-[max(4vw,16px)] overflow-hidden rounded-md ${planta ? "bg-white" : "h-[min(64vh,640px)] min-h-[340px] bg-[#D8D8D4]"}`}
        data-teste="figura" data-modo={modo} data-pronto={planta || pronto === modo ? "1" : "0"} style={{ touchAction: planta ? "auto" : "none" }}>
        {planta ? (
          <div className="mx-auto max-h-[86vh] w-full" style={{ aspectRatio: `${p2d.viewBox[2]} / ${p2d.viewBox[3]}`, maxWidth: `min(100%, ${Math.round(86 * proporcao)}vh)` }}>
            <Planta2D fonte={fonte} />
          </div>
        ) : (
          <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center bg-white"><div className="h-full w-full max-w-[40vh] opacity-60"><Planta2D fonte={fonte} /></div><span className="absolute bottom-3 left-3 rounded bg-white/90 px-2 py-1 text-[13px]">Preparando o 3D…</span></div>}>
            <VisualizadorFonte cena={cena} pecas={pecas} vista={vista} telhado={telhado} aoPronto={marcarPronto} />
          </Suspense>
        )}
        {!planta && (
          <>
            <div className="absolute right-2.5 top-2.5 flex gap-1.5">
              <button type="button" className={botao} aria-pressed={telhado} onClick={() => ir(telhado ? "geral" : "telhado")}>Telhado</button>
            </div>
            <div className="pointer-events-none absolute left-3 top-2.5 max-w-[calc(100%-8rem)] rounded-[3px] bg-white/80 px-2 py-0.5 text-[13px] text-[#111]">
              {vista.tipo === "geral" ? "Arraste para girar · pinça ou roda para aproximar" : `Olhos a 1,60 m do piso · arraste para olhar em volta`}
            </div>
          </>
        )}
      </div>

      <nav aria-label="Modos e cômodos" className="flex gap-2 overflow-x-auto px-[max(4vw,16px)] pb-1.5 pt-3.5 [scrollbar-width:none]">
        <button type="button" className={botao} aria-pressed={modo === "geral" || telhado} onClick={() => ir("geral")}>Visão geral</button>
        {cena.vistas.filter(v => v.tipo === "comodo").map(v => (
          <button key={v.id} type="button" className={botao} aria-pressed={modo === v.id} onClick={() => ir(v.id)}>{v.nome.split(" e ")[0]}</button>
        ))}
        <button type="button" className={botao} aria-pressed={planta} onClick={() => ir("planta")}>Planta 2D</button>
      </nav>

      <section className="grid gap-6 px-[max(4vw,16px)] pt-2.5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div>
          {planta ? (
            <>
              <span className="text-sm text-[#6B6B66]">Gerada do mesmo JSON-fonte da maquete 3D</span>
              <h2 className="mb-1 mt-1.5 text-2xl font-medium leading-tight">Planta baixa com cotas</h2>
              <p className="m-0 max-w-[60ch] text-[#6B6B66]">Paredes cortadas, aberturas com o giro das folhas, itens em contorno e as cadeias de cotas da prancha ({fmtM(fonte.estrutura.casa.w)} × {fmtM(fonte.estrutura.casa.d)} m).</p>
            </>
          ) : (
            <>
              <span className="text-sm text-[#6B6B66]">{area ? `${fmtM(area.quadro)} m² no quadro · ${fmtM(area.calculada)} m² pelo desenho` : vista.tipo === "geral" ? `Lote de ${fmtM(fonte.lote.w * fonte.lote.d)} m²` : vista.area ? `≈ ${fmtM(vista.area)} m²` : ""}</span>
              <h2 className="mb-1 mt-1.5 text-2xl font-medium leading-tight">{telhado ? "Visão geral com telhado" : vista.nome}</h2>
              {vista.tipo === "geral" ? (
                <p className="m-0 max-w-[60ch] text-[#6B6B66]">{telhado
                  ? `Cobertura de ${cena.cobertura.material} em duas águas a ${fmtM(cena.cobertura.inclinacao * 100, 0)}%, platibanda de ${fmtM(fonte.estrutura.cobertura.platibanda.altura)} m e forro de ${fonte.estrutura.cobertura.forro}.`
                  : "Maquete em corte, sem telhado. Toque num cômodo para entrar nele."}</p>
              ) : (
                <ul className="m-0 max-w-[60ch] list-none p-0 text-[#6B6B66]">
                  {aberturas.map(t => <li key={t}>{t}</li>)}
                  {itens.length > 0 && <li>Itens: {itens.join(", ")}</li>}
                </ul>
              )}
            </>
          )}
          {cena.cobertura.avisos.map(a => <p key={a} className="mt-2 text-[13px] text-[#8A5A00]">{a}</p>)}
        </div>
        <div>
          <table className="w-full border-collapse text-[15px]">
            <thead><tr className="text-left text-[13px] text-[#6B6B66]"><th className="pb-1 font-normal">Ambiente</th><th className="pb-1 text-right font-normal">Quadro</th><th className="pb-1 text-right font-normal">Desenho</th></tr></thead>
            <tbody>
              {areas.map(a => (
                <tr key={a.nome} className="border-b border-[#E4E4E0]">
                  <td className="py-[7px]">{a.nome}</td>
                  <td className="py-[7px] text-right tabular-nums">{fmtM(a.quadro)} m²</td>
                  <td className="py-[7px] text-right tabular-nums">{fmtM(a.calculada)} m²</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="mt-4 w-full border-collapse text-[14px]">
            <thead><tr className="text-left text-[13px] text-[#6B6B66]"><th className="pb-1 font-normal">Esquadria</th><th className="pb-1 text-right font-normal">L × A (peitoril)</th><th className="pb-1 text-right font-normal">Qtd.</th></tr></thead>
            <tbody>
              {esquadrias.map(e => (
                <tr key={e.codigo} className="border-b border-[#E4E4E0]">
                  <td className="py-[6px]">{e.codigo}</td>
                  <td className="py-[6px] text-right tabular-nums">{fmtM(e.larg)} × {fmtM(e.alt)}{e.peitoril > 0 ? ` (${fmtM(e.peitoril)})` : ""}</td>
                  <td className="py-[6px] text-right tabular-nums">{e.quantidade}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2.5 text-[13px] text-[#6B6B66]">
            Estrutura conforme o JSON-fonte (paredes, portas e janelas nas medidas da planta); itens ilustrativos.
            Conferência automática: {erros ? `${erros} erro(s)` : "nenhum erro"}{avisos ? `, ${avisos} aviso(s)` : ""}.
          </p>
        </div>
      </section>
    </div>
  );
}

export default function MaqueteDemo() {
  const [, params] = useRoute("/maquete-demo/:planta");
  const estado = usarFonte(params?.planta);
  useEffect(() => {
    // Prévia de desenvolvimento: fora dos buscadores.
    const meta = document.createElement("meta");
    meta.name = "robots"; meta.content = "noindex";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
  if (estado.tipo === "carregando") return <div className="flex min-h-[100dvh] items-center justify-center bg-white text-[#6B6B66]">Carregando a planta…</div>;
  if (estado.tipo === "erro") return <div className="flex min-h-[100dvh] items-center justify-center bg-white text-[#6B6B66]">{estado.texto}</div>;
  return <Pagina fonte={estado.fonte} />;
}
