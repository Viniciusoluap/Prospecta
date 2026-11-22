// Maquete 3D (EPIC-028, Etapa 3) — o toque e o arraste dos itens dentro do Canvas, e o contorno do item selecionado.
// O toque é decidido ANTES dos controles da câmera (escuta em captura no contêiner do canvas): se o raio acerta um
// item (só o grupo dos itens é testado — paredes, aberturas, piso e telhado ficam fora), o item é selecionado e o
// arraste com um dedo move o item no plano do piso, com a câmera parada; se não acerta, a câmera gira como sempre.
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { PecaFonte } from "@shared/maquete-3d/fonte-cena";
import type { Controles } from "../visualizador/VisualizadorFonte";

const AMARELO = "#FFE600";
const VERMELHO = "#E5484D";

export type Arraste = { id: string; x: number; z: number; gesto: number };

export function Interacao3D({ grupoItens, controles, pecas, editaveis, aoSelecionar, aoArrastar, aoSoltar }: {
  grupoItens: RefObject<THREE.Group | null>;
  controles: RefObject<Controles | null>;
  pecas: PecaFonte[];
  editaveis: ReadonlySet<string>;
  aoSelecionar: (id: string | null) => void;
  /** Posição pedida pelo dedo/mouse (sem encaixe: o encaixe é feito por quem recebe). */
  aoArrastar: (a: Arraste) => void;
  aoSoltar: () => void;
}) {
  const { camera, gl, invalidate } = useThree();
  const estado = useRef({ pecas, editaveis, aoSelecionar, aoArrastar, aoSoltar });
  estado.current = { pecas, editaveis, aoSelecionar, aoArrastar, aoSoltar };

  useEffect(() => {
    const alvo = (gl.domElement.parentElement ?? gl.domElement) as HTMLElement;
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plano = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ponto = new THREE.Vector3();
    let arraste: { pid: number; id: string; dx: number; dz: number; y: number; gesto: number } | null = null;
    let toque: { pid: number; x: number; y: number } | null = null;
    let gestos = 0;
    const mirar = (e: PointerEvent) => {
      const r = gl.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
    };
    const itemSob = (): string | null => {
      const g = grupoItens.current;
      if (!g) return null;
      for (const h of ray.intersectObjects(g.children, true)) {
        let o: THREE.Object3D | null = h.object;
        while (o && !o.userData?.itemId) o = o.parent;
        if (o) return o.userData.itemId as string;
      }
      return null;
    };
    const noPiso = (y: number) => { plano.constant = -y; return ray.ray.intersectPlane(plano, ponto) ? { x: ponto.x, z: ponto.z } : null; };
    const soltar = () => {
      if (!arraste) return;
      arraste = null;
      if (controles.current) controles.current.enabled = true;
      estado.current.aoSoltar();
    };

    const aoBaixar = (e: PointerEvent) => {
      if (!e.isPrimary) { soltar(); return; } // segundo dedo (pinça): o arraste para e a câmera volta
      mirar(e);
      const id = itemSob();
      if (!id) { toque = { pid: e.pointerId, x: e.clientX, y: e.clientY }; return; }
      // Item: a câmera não recebe este toque.
      e.stopPropagation();
      estado.current.aoSelecionar(id);
      invalidate();
      const p = estado.current.pecas.find(q => q.id === id);
      if (!p || !estado.current.editaveis.has(id)) return;
      const y = p.y;
      const em = noPiso(y);
      if (!em) return;
      arraste = { pid: e.pointerId, id, dx: p.x - em.x, dz: p.z - em.z, y, gesto: ++gestos };
      if (controles.current) controles.current.enabled = false;
      try { alvo.setPointerCapture(e.pointerId); } catch { /* sem captura */ }
    };
    const aoMover = (e: PointerEvent) => {
      if (!arraste || e.pointerId !== arraste.pid) return;
      e.preventDefault();
      mirar(e);
      const em = noPiso(arraste.y);
      if (em) estado.current.aoArrastar({ id: arraste.id, x: em.x + arraste.dx, z: em.z + arraste.dz, gesto: arraste.gesto });
    };
    const aoSubir = (e: PointerEvent) => {
      if (arraste && e.pointerId === arraste.pid) { soltar(); return; }
      // Toque curto fora dos itens (estrutura ou vazio): tira a seleção. Arrastar a câmera não tira.
      if (toque && e.pointerId === toque.pid && Math.hypot(e.clientX - toque.x, e.clientY - toque.y) < 6) estado.current.aoSelecionar(null);
      toque = null;
    };
    alvo.addEventListener("pointerdown", aoBaixar, { capture: true });
    window.addEventListener("pointermove", aoMover, { passive: false });
    window.addEventListener("pointerup", aoSubir);
    window.addEventListener("pointercancel", soltar);
    return () => {
      alvo.removeEventListener("pointerdown", aoBaixar, { capture: true });
      window.removeEventListener("pointermove", aoMover);
      window.removeEventListener("pointerup", aoSubir);
      window.removeEventListener("pointercancel", soltar);
      if (controles.current) controles.current.enabled = true;
    };
  }, [camera, gl, grupoItens, controles, invalidate]);
  return null;
}

/** Contorno destacado: moldura no piso e as arestas da caixa do item (amarelo = selecionado, vermelho = com erro). */
export function Contorno({ p, erro, selecionado }: { p: PecaFonte; erro: boolean; selecionado: boolean }) {
  const cor = erro ? VERMELHO : AMARELO;
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: cor, depthTest: false, transparent: true, opacity: 0.95, toneMapped: false }), [cor]);
  const linha = useMemo(() => new THREE.LineBasicMaterial({ color: cor, depthTest: false, transparent: true, toneMapped: false }), [cor]);
  const arestas = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(p.largura + 0.02, p.altura + 0.02, p.profundidade + 0.02)), [p.largura, p.altura, p.profundidade]);
  useEffect(() => () => { mat.dispose(); linha.dispose(); }, [mat, linha]);
  useEffect(() => () => arestas.dispose(), [arestas]);
  const e = selecionado ? 0.045 : 0.025, L = p.largura + e * 2, P = p.profundidade + e * 2, y = 0.012;
  return (
    <group position={[p.x, p.y, p.z]} rotation={[0, p.rot, 0]} renderOrder={10}>
      {/* Moldura no piso (quatro réguas). */}
      <mesh material={mat} position={[0, y, -P / 2 + e / 2]} renderOrder={10}><boxGeometry args={[L, 0.01, e]} /></mesh>
      <mesh material={mat} position={[0, y, P / 2 - e / 2]} renderOrder={10}><boxGeometry args={[L, 0.01, e]} /></mesh>
      <mesh material={mat} position={[-L / 2 + e / 2, y, 0]} renderOrder={10}><boxGeometry args={[e, 0.01, P]} /></mesh>
      <mesh material={mat} position={[L / 2 - e / 2, y, 0]} renderOrder={10}><boxGeometry args={[e, 0.01, P]} /></mesh>
      {selecionado && <lineSegments geometry={arestas} material={linha} position={[0, p.elevacao + p.altura / 2, 0]} renderOrder={11} />}
    </group>
  );
}

/** Zonas proibidas das portas bloqueadas, pintadas no piso. */
export function ZonasBloqueadas({ zonas, y }: { zonas: [number, number][][]; y: number }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry(), pos: number[] = [];
    for (const z of zonas) for (let k = 1; k + 1 < z.length; k++) pos.push(z[0][0], 0, z[0][1], z[k][0], 0, z[k][1], z[k + 1][0], 0, z[k + 1][1]);
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }, [zonas]);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: VERMELHO, transparent: true, opacity: 0.32, depthTest: false, side: THREE.DoubleSide, toneMapped: false }), []);
  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => () => mat.dispose(), [mat]);
  return zonas.length ? <mesh geometry={geo} material={mat} position={[0, y + 0.015, 0]} renderOrder={9} /> : null;
}
