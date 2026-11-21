// Maquete 3D (EPIC-028, Etapa 2) — visualizador do JSON-fonte: o Canvas, a câmera de cada vista (visão geral em
// corte e tour por cômodo, com os olhos a 1,60 m do piso) e a transição suave entre elas (instantânea com
// `prefers-reduced-motion`). Carregado sob demanda (lazy) pela página: quem só olha a planta 2D não baixa o 3D.
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { CenaFonte as Cena, PecaFonte, VistaCena } from "@shared/maquete-3d/fonte-cena";
import { CenaFonte, type OpcoesCena } from "./CenaFonte";

export type Controles = { target: THREE.Vector3; update: () => void; minDistance: number; maxDistance: number; enablePan: boolean; enabled: boolean };

const QUADROS_ATE_PRONTO = 6;
const suave = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

/** Posição final da câmera para a vista, afastando a visão geral em telas estreitas (celular em pé). */
function enquadrar(v: VistaCena, aspecto: number) {
  const p = new THREE.Vector3(...v.pos), t = new THREE.Vector3(...v.alvo);
  if (v.tipo === "geral" && aspecto < 1.25) p.sub(t).multiplyScalar(Math.min(2.1, Math.pow(1.25 / aspecto, 0.85))).add(t);
  const fov = v.tipo === "geral" ? 45 : aspecto < 1 ? 75 : 68;
  return { p, t, fov };
}

function Diretor({ vista, controles, aoPronto }: { vista: VistaCena; controles: React.RefObject<Controles | null>; aoPronto?: () => void }) {
  const { camera, size, invalidate } = useThree();
  const anim = useRef<{ p0: THREE.Vector3; t0: THREE.Vector3; p: THREE.Vector3; t: THREE.Vector3; s: number } | null>(null);
  const quadros = useRef(0), primeira = useRef(true);
  const reduzir = useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  useEffect(() => {
    const c = controles.current, cam = camera as THREE.PerspectiveCamera;
    if (!c) return;
    const { p, t, fov } = enquadrar(vista, size.width / Math.max(1, size.height));
    cam.fov = fov; cam.updateProjectionMatrix();
    const externo = vista.tipo === "comodo" && !vista.interno;
    c.minDistance = vista.tipo === "geral" ? 2 : 0.05;
    c.maxDistance = vista.tipo === "geral" ? 60 : externo ? 14 : 4;
    c.enablePan = vista.tipo === "geral";
    if (reduzir || primeira.current) { cam.position.copy(p); c.target.copy(t); c.update(); anim.current = null; }
    else anim.current = { p0: cam.position.clone(), t0: c.target.clone(), p, t, s: performance.now() };
    primeira.current = false;
    quadros.current = 0;
    invalidate();
  }, [vista, size.width, size.height, camera, controles, reduzir, invalidate]);
  // Quadros só sob demanda (bateria do celular): durante a transição e nos primeiros quadros depois dela (sombras e
  // texturas assentarem); depois, só quando a pessoa mexe (OrbitControls pede o quadro).
  useFrame(() => {
    const c = controles.current;
    if (!c) return;
    const a = anim.current;
    if (a) {
      const k = Math.min(1, (performance.now() - a.s) / 1100), e = suave(k);
      camera.position.lerpVectors(a.p0, a.p, e); c.target.lerpVectors(a.t0, a.t, e); c.update();
      if (k >= 1) anim.current = null;
      invalidate();
      return;
    }
    if (quadros.current < QUADROS_ATE_PRONTO) {
      quadros.current++;
      if (quadros.current === QUADROS_ATE_PRONTO) aoPronto?.();
      else invalidate();
    }
  });
  return null;
}

export default function VisualizadorFonte({ cena, pecas, vista, telhado, aoPronto, grupoItens, controlesRef, semRotulos, children }: {
  cena: Cena; pecas: PecaFonte[]; vista: VistaCena; telhado: boolean; aoPronto?: () => void;
  /** Editor (EPIC-028, Etapa 3): grupo dos itens, controles da câmera e camadas a mais dentro do Canvas. */
  grupoItens?: RefObject<THREE.Group | null>; controlesRef?: RefObject<Controles | null>; semRotulos?: boolean; children?: ReactNode;
}) {
  const toque = useMemo(() => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches, []);
  // Celular: sombras com mapa menor e móveis no desenho enxuto; computador: o desenho detalhado.
  const opcoes: OpcoesCena = useMemo(() => (toque ? { sombras: true, mapaSombra: 1024, aprimorado: false } : { sombras: true, mapaSombra: 2048, aprimorado: true }), [toque]);
  const proprios = useRef<Controles | null>(null);
  const controles = controlesRef ?? proprios;
  const [erro, setErro] = useState<string | null>(null);
  const geral = vista.tipo === "geral";
  // No tour o forro fica (é o teto de quem está dentro); na visão geral, o botão Telhado decide.
  const comTelhado = geral ? telhado : true;
  if (erro) return <div className="flex h-full items-center justify-center p-6 text-center text-sm text-[#333]">Não foi possível iniciar o 3D neste aparelho ({erro}). A planta 2D continua disponível.</div>;
  return (
    <Canvas
      frameloop="demand" shadows="percentage" dpr={[1, Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1)]}
      camera={{ fov: 45, near: 0.05, far: 300, position: vista.pos }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      style={{ position: "absolute", inset: 0, touchAction: "none" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 0.95;
        gl.domElement.addEventListener("webglcontextlost", () => setErro("o navegador encerrou o contexto gráfico"));
      }}>
      <CenaFonte cena={cena} pecas={pecas} telhado={comTelhado} corte={geral} rotulos={geral && !telhado && !semRotulos} opcoes={opcoes} grupoItens={grupoItens}>{children}</CenaFonte>
      <OrbitControls ref={controles as never} makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI * 0.495} rotateSpeed={0.7} zoomSpeed={0.8} />
      <Diretor vista={vista} controles={controles} aoPronto={aoPronto} />
    </Canvas>
  );
}
