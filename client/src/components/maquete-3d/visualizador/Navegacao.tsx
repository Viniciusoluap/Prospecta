// Maquete 3D (EPIC-022, etapa 2) — as três formas de ver a casa: por fora (girar, aproximar, afastar), por dentro
// (caminhar com colisão, subindo e descendo escadas) e o tour automático (percurso pelas portas, pausa e
// panorâmica em cada cômodo, vista de cima no fim).
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { Edificacao, Ponto } from "@shared/maquete-3d/modelo";
import {
  apoio, comodoEm, cruzaParede, destaqueDoComodo, entrada, resolverColisao, rota, roteiroTour, segmentosDeColisao, topoDaEdificacao,
  type Seg,
} from "@shared/maquete-3d/geometria3d";

export const ALTURA_OLHOS = 1.6;
const RAIO_CORPO = 0.28;

/** Onde o visitante está. Vive fora do React (muda a cada quadro); a interface lê quando precisa. */
export type Visitante = { x: number; z: number; y: number; giro: number; inclinacao: number; pavimentoId: string };
/** Comandos vindos do teclado, do mouse e do toque. */
export type Comando = { frente: number; lado: number; correr: boolean; olharX: number; olharY: number };
export const comandoVazio = (): Comando => ({ frente: 0, lado: 0, correr: false, olharX: 0, olharY: 0 });

export type InfoLocal = { pavimentoId: string; pavimento: string; comodo: string | null };
export type LegendaTour = { nome: string; area: number; destaque: string | null; indice: number; total: number } | null;

/** Posição inicial: um passo para dentro da porta de entrada, olhando para dentro. */
export function visitanteNaEntrada(e: Edificacao): Visitante {
  const ent = entrada(e), pv = e.pavimentos.find(p => p.id === ent?.pavimentoId) ?? e.pavimentos[0];
  if (!ent || !pv) return { x: 0, z: 0, y: 0, giro: 0, inclinacao: 0, pavimentoId: pv?.id ?? "" };
  const dx = ent.dentro.x - ent.fora.x, dz = ent.dentro.y - ent.fora.y;
  return { x: ent.dentro.x, z: ent.dentro.y, y: pv.nivel, giro: Math.atan2(-dx, -dz), inclinacao: 0, pavimentoId: pv.id };
}

function aplicarNaCamera(camera: THREE.Camera, v: Visitante) {
  camera.position.set(v.x, v.y + ALTURA_OLHOS, v.z);
  camera.rotation.set(v.inclinacao, v.giro, 0, "YXZ");
}

function useSegmentos(e: Edificacao) {
  return useMemo(() => new Map<string, Seg[]>(e.pavimentos.map(p => [p.id, segmentosDeColisao(p)])), [e]);
}

function informar(e: Edificacao, v: Visitante, ultimo: MutableRefObject<string>, onLocal: (i: InfoLocal) => void) {
  const pv = e.pavimentos.find(p => p.id === v.pavimentoId);
  if (!pv) return;
  const c = comodoEm(pv, { x: v.x, y: v.z }), chave = `${pv.id}:${c?.id ?? ""}`;
  if (chave !== ultimo.current) { ultimo.current = chave; onLocal({ pavimentoId: pv.id, pavimento: pv.nome, comodo: c?.nome ?? null }); }
}

// ── Por dentro: caminhar ──

export function Caminhada({ edificacao: e, visitante, comando, onLocal }: {
  edificacao: Edificacao; visitante: MutableRefObject<Visitante>; comando: MutableRefObject<Comando>; onLocal: (i: InfoLocal) => void;
}) {
  const { camera, gl } = useThree();
  const segs = useSegmentos(e);
  const ultimo = useRef("");

  // Teclado (WASD e setas) e mouse: clique trava o ponteiro; Esc solta.
  useEffect(() => {
    const teclas = new Set<string>(), c = comando.current, el = gl.domElement;
    const atualizar = () => {
      c.frente = (teclas.has("KeyW") || teclas.has("ArrowUp") ? 1 : 0) - (teclas.has("KeyS") || teclas.has("ArrowDown") ? 1 : 0);
      c.lado = (teclas.has("KeyD") || teclas.has("ArrowRight") ? 1 : 0) - (teclas.has("KeyA") || teclas.has("ArrowLeft") ? 1 : 0);
      c.correr = teclas.has("ShiftLeft") || teclas.has("ShiftRight");
    };
    const baixo = (ev: KeyboardEvent) => { if ((ev.target as HTMLElement)?.tagName === "INPUT") return; teclas.add(ev.code); atualizar(); };
    const cima = (ev: KeyboardEvent) => { teclas.delete(ev.code); atualizar(); };
    const mover = (ev: MouseEvent) => {
      if (document.pointerLockElement === el) { c.olharX += ev.movementX * 0.0022; c.olharY += ev.movementY * 0.0022; }
      else if (ev.buttons === 1) { c.olharX -= ev.movementX * 0.004; c.olharY -= ev.movementY * 0.004; }
    };
    // Toque: arrastar um dedo sobre a cena gira o olhar (o joystick cuida da caminhada).
    let dedo: { id: number; x: number; y: number } | null = null;
    const toqueInicio = (ev: TouchEvent) => { const t = ev.changedTouches[0]; if (!dedo && t) dedo = { id: t.identifier, x: t.clientX, y: t.clientY }; };
    const toqueMove = (ev: TouchEvent) => {
      for (const t of Array.from(ev.changedTouches)) if (dedo && t.identifier === dedo.id) {
        c.olharX -= (t.clientX - dedo.x) * 0.006; c.olharY -= (t.clientY - dedo.y) * 0.006;
        dedo = { id: t.identifier, x: t.clientX, y: t.clientY };
      }
    };
    const toqueFim = (ev: TouchEvent) => { for (const t of Array.from(ev.changedTouches)) if (dedo && t.identifier === dedo.id) dedo = null; };
    el.addEventListener("touchstart", toqueInicio, { passive: true }); el.addEventListener("touchmove", toqueMove, { passive: true });
    el.addEventListener("touchend", toqueFim); el.addEventListener("touchcancel", toqueFim);
    const travar = () => { if (window.matchMedia("(pointer: fine)").matches) el.requestPointerLock?.(); };
    window.addEventListener("keydown", baixo); window.addEventListener("keyup", cima);
    el.addEventListener("mousemove", mover); el.addEventListener("dblclick", travar);
    return () => {
      window.removeEventListener("keydown", baixo); window.removeEventListener("keyup", cima);
      el.removeEventListener("mousemove", mover); el.removeEventListener("dblclick", travar);
      el.removeEventListener("touchstart", toqueInicio); el.removeEventListener("touchmove", toqueMove);
      el.removeEventListener("touchend", toqueFim); el.removeEventListener("touchcancel", toqueFim);
      if (document.pointerLockElement === el) document.exitPointerLock();
      c.frente = c.lado = 0;
    };
  }, [comando, gl]);

  useFrame((_, dtBruto) => {
    const dt = Math.min(dtBruto, 0.05), v = visitante.current, c = comando.current;
    v.giro -= c.olharX; v.inclinacao = THREE.MathUtils.clamp(v.inclinacao - c.olharY, -1.2, 1.2);
    c.olharX = c.olharY = 0;
    const mod = Math.hypot(c.frente, c.lado);
    if (mod > 0.01) {
      const vel = (c.correr ? 3.2 : 1.7) * Math.min(1, mod) * dt, f = c.frente / mod, l = c.lado / mod;
      const dx = (-Math.sin(v.giro) * f + Math.cos(v.giro) * l) * vel, dz = (-Math.cos(v.giro) * f - Math.sin(v.giro) * l) * vel;
      const paredes = segs.get(v.pavimentoId) ?? [];
      const de: Ponto = { x: v.x, y: v.z };
      let para = resolverColisao({ x: v.x + dx, y: v.z + dz }, RAIO_CORPO, paredes);
      if (cruzaParede(de, para, paredes)) para = de;
      v.x = para.x; v.z = para.y;
    }
    const a = apoio(e, v.pavimentoId, { x: v.x, y: v.z });
    v.pavimentoId = a.pavimentoId;
    v.y = THREE.MathUtils.damp(v.y, a.y, 14, dt);
    aplicarNaCamera(camera, v);
    informar(e, v, ultimo, onLocal);
  });
  return null;
}

// ── Por fora: órbita ──

/** Caixa do que se quer enquadrar (planta em x/z e a altura do topo). */
export type CaixaCena = { x0: number; x1: number; z0: number; z1: number; topo: number };

export function caixaDaEdificacao(e: Edificacao): CaixaCena {
  const pts = e.pavimentos.flatMap(p => p.paredes.flatMap(w => [w.a, w.b]));
  const xs = pts.map(p => p.x), zs = pts.map(p => p.y);
  return { x0: Math.min(0, ...xs), x1: Math.max(1, ...xs), z0: Math.min(0, ...zs), z1: Math.max(1, ...zs), topo: topoDaEdificacao(e) };
}

export function Orbita({ caixa, deCima }: { caixa: CaixaCena; deCima: boolean }) {
  const { camera } = useThree();
  const { centro, raio, topo } = useMemo(() => ({
    centro: new THREE.Vector3((caixa.x0 + caixa.x1) / 2, caixa.topo * 0.4, (caixa.z0 + caixa.z1) / 2),
    raio: Math.max(caixa.x1 - caixa.x0, caixa.z1 - caixa.z0, caixa.topo), topo: caixa.topo,
  }), [caixa.x0, caixa.x1, caixa.z0, caixa.z1, caixa.topo]);
  useEffect(() => {
    // Conjuntos grandes (loteamento) são enquadrados mais de perto, proporcionalmente.
    const k = raio > 40 ? 0.62 : 1;
    if (deCima) camera.position.set(centro.x, topo + raio * 1.5 * k, centro.z + raio * 0.35 * k);
    else camera.position.set(centro.x + raio * 0.95 * k, topo * 0.9 + raio * 0.55 * k, centro.z + raio * 1.25 * k);
    camera.lookAt(centro);
  }, [camera, centro, raio, topo, deCima]);
  return <OrbitControls makeDefault target={centro} enableDamping dampingFactor={0.08} minDistance={2.5} maxDistance={raio * 6} maxPolarAngle={Math.PI / 2 - 0.03} />;
}

// ── Tour automático ──

type Etapa =
  | { tipo: "andar"; de: Ponto; para: Ponto; yDe: number; yPara: number; pavimentoId: string }
  | { tipo: "parada"; indice: number };

const VEL_TOUR = 1.25, PAUSA = 0.9, PANORAMICA = 5.2, GIRO_PANORAMICA = Math.PI * 1.25, SUBIDA = 4.5;

export function Tour({ edificacao: e, visitante, pausado, reinicio, onLocal, onLegenda, onFim }: {
  edificacao: Edificacao; visitante: MutableRefObject<Visitante>; pausado: boolean;
  /** Muda de valor para recomeçar o tour do início. */
  reinicio: number;
  onLocal: (i: InfoLocal) => void; onLegenda: (l: LegendaTour) => void; onFim: () => void;
}) {
  const { camera } = useThree();
  const ultimo = useRef("");
  const { etapas, paradas } = useMemo(() => {
    const paradas = roteiroTour(e), nivel = new Map(e.pavimentos.map(p => [p.id, p.nivel]));
    const inicio = visitanteNaEntrada(e);
    let atual = { pavimentoId: inicio.pavimentoId, p: { x: inicio.x, y: inicio.z } as Ponto };
    const etapas: Etapa[] = [];
    paradas.forEach((parada, indice) => {
      const caminho = rota(e, atual, { pavimentoId: parada.pavimentoId, p: parada.ponto });
      for (let i = 1; i < caminho.length; i++) {
        const a = caminho[i - 1], b = caminho[i];
        if (Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y) < 0.05 && a.pavimentoId === b.pavimentoId) continue;
        etapas.push({ tipo: "andar", de: a.p, para: b.p, yDe: a.y ?? nivel.get(a.pavimentoId) ?? 0, yPara: b.y ?? nivel.get(b.pavimentoId) ?? 0, pavimentoId: b.pavimentoId });
      }
      etapas.push({ tipo: "parada", indice });
      atual = { pavimentoId: parada.pavimentoId, p: parada.ponto };
    });
    return { etapas, paradas };
  }, [e]);

  const estado = useRef({ i: 0, t: 0, giroBase: 0, fim: false, subida: 0, de: new THREE.Vector3(), olhar: new THREE.Vector3() });
  useEffect(() => {
    visitante.current = visitanteNaEntrada(e);
    estado.current = { i: 0, t: 0, giroBase: visitante.current.giro, fim: false, subida: 0, de: new THREE.Vector3(), olhar: new THREE.Vector3() };
    onLegenda(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e, reinicio]);

  const { alvoTopo, centro } = useMemo(() => {
    const pts = e.pavimentos.flatMap(p => p.paredes.flatMap(w => [w.a, w.b]));
    const xs = pts.map(p => p.x), zs = pts.map(p => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const raio = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 6);
    return { alvoTopo: new THREE.Vector3(cx, topoDaEdificacao(e) + raio * 1.5, cz + raio * 0.35), centro: new THREE.Vector3(cx, 0, cz) };
  }, [e]);

  useFrame((_, dtBruto) => {
    const s = estado.current, v = visitante.current;
    if (pausado) { if (!s.fim) aplicarNaCamera(camera, v); return; }
    const dt = Math.min(dtBruto, 0.05);
    if (s.fim) {
      // Encerramento: sobe devagar até a vista de cima da casa inteira.
      s.subida = Math.min(1, s.subida + dt / SUBIDA);
      const k = s.subida * s.subida * (3 - 2 * s.subida);
      camera.position.lerpVectors(s.de, alvoTopo, k);
      camera.lookAt(s.olhar.clone().lerp(centro, k));
      if (s.subida >= 1) onFim();
      return;
    }
    const etapa = etapas[s.i];
    if (!etapa) {
      s.fim = true; s.de.copy(camera.position);
      s.olhar.set(v.x - Math.sin(v.giro), v.y + ALTURA_OLHOS, v.z - Math.cos(v.giro));
      onLegenda(null);
      return;
    }
    if (etapa.tipo === "andar") {
      const comp = Math.hypot(etapa.para.x - etapa.de.x, etapa.para.y - etapa.de.y) + Math.abs(etapa.yPara - etapa.yDe);
      s.t += (VEL_TOUR * dt) / Math.max(comp, 0.05);
      const k = Math.min(1, s.t);
      v.x = etapa.de.x + (etapa.para.x - etapa.de.x) * k; v.z = etapa.de.y + (etapa.para.y - etapa.de.y) * k;
      v.y = etapa.yDe + (etapa.yPara - etapa.yDe) * k;
      if (k > 0.5) v.pavimentoId = etapa.pavimentoId;
      // Olha para onde anda, virando com suavidade.
      const alvo = Math.atan2(-(etapa.para.x - etapa.de.x), -(etapa.para.y - etapa.de.y));
      const dif = Math.atan2(Math.sin(alvo - v.giro), Math.cos(alvo - v.giro));
      v.giro += dif * Math.min(1, dt * 3.5);
      v.inclinacao = THREE.MathUtils.damp(v.inclinacao, etapa.yPara > etapa.yDe ? 0.12 : etapa.yPara < etapa.yDe ? -0.2 : -0.04, 3, dt);
      if (k >= 1) { s.i++; s.t = 0; s.giroBase = v.giro; }
    } else {
      const parada = paradas[etapa.indice];
      if (s.t === 0) {
        const pv = e.pavimentos.find(p => p.id === parada.pavimentoId);
        onLegenda({ nome: parada.comodo.nome, area: parada.area, destaque: pv ? destaqueDoComodo(pv, parada.comodo) : null, indice: etapa.indice + 1, total: paradas.length });
      }
      s.t += dt;
      const k = THREE.MathUtils.clamp((s.t - PAUSA) / PANORAMICA, 0, 1);
      v.giro = s.giroBase + GIRO_PANORAMICA * (k * k * (3 - 2 * k));
      v.inclinacao = THREE.MathUtils.damp(v.inclinacao, -0.06, 3, dt);
      if (s.t >= PAUSA + PANORAMICA + 0.4) { s.i++; s.t = 0; }
    }
    aplicarNaCamera(camera, v);
    informar(e, v, ultimo, onLocal);
  });
  return null;
}
