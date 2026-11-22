// Maquete 3D (EPIC-028, Etapa 4) — página pública do lote: /maquete/<empreendimento>/<lote>-<código>. Sem login.
// O servidor entrega só a versão de itens PUBLICADA do lote, o status (só leitura, da Incorporação/Central de Vendas)
// e os textos; código errado, lote que não existe ou sem publicação dão a mesma mensagem. Leve no celular: abre na
// planta 2D e o 3D só é baixado quando a pessoa escolhe uma vista. Botão de WhatsApp da empresa com o lote na mensagem.
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { cenaDaFonte, pecasDaFonte } from "@shared/maquete-3d/fonte-cena";
import { fmtM, planta2d } from "@shared/maquete-3d/planta2d";
import { ROTULO_STATUS, linkWhatsAppDoLote, nomeDoLote, type DadosLotePublico, type StatusLote } from "@shared/maquete-3d/lote-publico";
import { Planta2D } from "@/components/maquete-3d/planta2d/Planta2D";
import { trpc } from "@/lib/trpc";

const VisualizadorFonte = lazy(() => import("@/components/maquete-3d/visualizador/VisualizadorFonte"));

const botao = "inline-flex min-h-[44px] flex-none items-center whitespace-nowrap rounded border border-[#E4E4E0] bg-white px-4 text-[15px] text-[#111] transition-colors hover:bg-[#F4F4F1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#111] aria-pressed:border-[#111] aria-pressed:bg-[#FFE600]";
const COR_STATUS: Record<StatusLote, string> = {
  disponivel: "border-[#1F7A45] bg-[#E8F5EC] text-[#14532D]",
  reservado: "border-[#A16207] bg-[#FEF6E4] text-[#713F12]",
  vendido: "border-[#6B6B66] bg-[#EFEFEC] text-[#3F3F3B]",
};

function IconeWhats() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 flex-none" fill="currentColor">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4a.5.5 0 0 0 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.4-.3Z" />
    </svg>
  );
}

function BotaoWhats({ href, className = "" }: { href: string; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" data-teste="whatsapp"
      className={`inline-flex min-h-[48px] items-center justify-center gap-2 rounded bg-[#1F7A45] px-5 text-[16px] font-medium text-white transition-colors hover:bg-[#17633A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#111] ${className}`}>
      <IconeWhats /> Falar sobre este lote no WhatsApp
    </a>
  );
}

/** A página (sem buscar dados): usada pela rota e pelo harness das capturas. */
export function VistaDoLote({ dados }: { dados: DadosLotePublico }) {
  const { fonte } = dados;
  const cena = useMemo(() => cenaDaFonte(fonte), [fonte]);
  const pecas = useMemo(() => pecasDaFonte(fonte), [fonte]);
  const p2d = useMemo(() => planta2d(fonte), [fonte]);
  const proporcao = p2d.viewBox[2] / p2d.viewBox[3];
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
  const marcarPronto = useCallback(() => setPronto(modo), [modo]);

  const planta = modo === "planta", telhado = modo === "telhado";
  const vista = cena.vistas.find(v => v.id === (telhado ? "geral" : modo)) ?? cena.vistas[0];
  const nome = nomeDoLote(dados);
  const whats = linkWhatsAppDoLote(dados);
  const comodos = cena.vistas.filter(v => v.tipo === "comodo");

  useEffect(() => { document.title = `${nome} · ${dados.empreendimento} · Maquete 3D`; }, [nome, dados.empreendimento]);

  return (
    <div className="min-h-[100dvh] bg-white pb-28 text-[16px] leading-[1.55] text-[#111] md:pb-10">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-[max(4vw,16px)] pb-3 pt-5">
        <div>
          <span className="text-sm text-[#6B6B66]">{dados.empreendimento} · maquete 3D</span>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="m-0 text-[clamp(24px,3vw,34px)] font-medium leading-tight" data-teste="nome-lote">{nome}</h1>
            {dados.status && (
              <span data-teste="status" data-status={dados.status}
                className={`inline-flex min-h-[28px] items-center rounded-full border px-3 text-[14px] font-medium ${COR_STATUS[dados.status]}`}>
                {ROTULO_STATUS[dados.status]}
              </span>
            )}
          </div>
          <span className="text-sm text-[#6B6B66]">Lote de {fmtM(fonte.lote.w)} × {fmtM(fonte.lote.d)} m · casa de {fmtM(fonte.estrutura.casa.w)} × {fmtM(fonte.estrutura.casa.d)} m</span>
        </div>
        {/* Computador: no cabeçalho; celular: fixo no rodapé (um botão só por tela). */}
        <div className="hidden md:block"><BotaoWhats href={whats} /></div>
      </header>

      <div className={`relative mx-[max(4vw,16px)] overflow-hidden rounded-md ${planta ? "bg-white" : "h-[min(64vh,640px)] min-h-[340px] bg-[#D8D8D4]"}`}
        data-teste="figura" data-modo={modo} data-pronto={planta || pronto === modo ? "1" : "0"} style={{ touchAction: planta ? "auto" : "none" }}>
        {planta ? (
          <div className="mx-auto w-full" style={{ aspectRatio: `${p2d.viewBox[2]} / ${p2d.viewBox[3]}`, maxWidth: `min(100%, ${Math.round(110 * proporcao)}vh)` }}>
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
              {vista.tipo === "geral" ? "Arraste para girar · pinça ou roda para aproximar" : "Olhos a 1,60 m do piso · arraste para olhar em volta"}
            </div>
          </>
        )}
      </div>

      <nav aria-label="Vistas da maquete" className="flex gap-2 overflow-x-auto px-[max(4vw,16px)] pb-1.5 pt-3.5 [scrollbar-width:none]">
        <button type="button" className={botao} aria-pressed={planta} onClick={() => ir("planta")}>Planta 2D</button>
        <button type="button" className={botao} aria-pressed={modo === "geral" || telhado} onClick={() => ir("geral")}>Ver em 3D</button>
        {comodos.map(v => (
          <button key={v.id} type="button" className={botao} aria-pressed={modo === v.id} onClick={() => ir(v.id)}>{v.nome.split(" e ")[0]}</button>
        ))}
      </nav>

      <section className="grid gap-6 px-[max(4vw,16px)] pt-2.5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div>
          <h2 className="mb-1 mt-1.5 text-2xl font-medium leading-tight">{planta ? "Planta baixa com medidas" : telhado ? "Visão geral com telhado" : vista.nome}</h2>
          <p className="m-0 max-w-[60ch] text-[#6B6B66]">
            {planta ? "Toque em “Ver em 3D” ou num cômodo para ver a casa por dentro e por fora."
              : vista.tipo === "geral" ? "Maquete em corte, sem o telhado, para ver a divisão dos cômodos." : "Vista de dentro do cômodo, na altura dos olhos."}
          </p>
          <p className="mt-3 text-[13px] text-[#6B6B66]">Imagens ilustrativas: móveis, cores e acabamentos podem mudar. Paredes, portas e janelas nas medidas do projeto.</p>
        </div>
        <div>
          <table className="w-full border-collapse text-[15px]">
            <thead><tr className="text-left text-[13px] text-[#6B6B66]"><th className="pb-1 font-normal">Cômodo</th><th className="pb-1 text-right font-normal">Área</th></tr></thead>
            <tbody>
              {comodos.map(v => (
                <tr key={v.id} className="border-b border-[#E4E4E0]">
                  <td className="py-[7px]">{v.nome}</td>
                  <td className="py-[7px] text-right tabular-nums">{(v.areaPlanta ?? v.area) ? `${fmtM((v.areaPlanta ?? v.area)!)} m²` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Celular: o botão do WhatsApp fica sempre à mão, no rodapé. */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-[#E4E4E0] bg-white/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 md:hidden">
        <BotaoWhats href={whats} className="w-full" />
      </div>
    </div>
  );
}

function Aviso({ texto }: { texto: string }) {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-white p-6 text-center text-[#6B6B66]">{texto}</div>;
}

export default function MaqueteLote() {
  const [, params] = useRoute("/maquete/:empreendimento/:lote");
  const dados = trpc.maquetePublica.porLote.useQuery(
    { empreendimento: params?.empreendimento ?? "", lote: params?.lote ?? "" },
    { enabled: !!params?.empreendimento && !!params?.lote, retry: false, refetchOnWindowFocus: false },
  );
  useEffect(() => {
    // Link entregue ao cliente: fora dos buscadores (o servidor também manda X-Robots-Tag).
    const meta = document.createElement("meta");
    meta.name = "robots"; meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
  if (dados.isLoading) return <Aviso texto="Carregando a maquete…" />;
  if (!dados.data) return <Aviso texto="Esta maquete não está disponível. Confira o link com o seu consultor." />;
  return <VistaDoLote dados={dados.data as DadosLotePublico} />;
}
