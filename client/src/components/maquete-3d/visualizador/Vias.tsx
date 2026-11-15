// Maquete 3D (EPIC-023, S-G) — as vias em 3D, assentadas no relevo: pista de asfalto com abaulamento, sarjeta,
// meio-fio (com rebaixo junto das faixas de pedestres), faixa de serviço gramada, calçada de placas de concreto,
// sinalização pintada, árvores, postes (que acendem à noite), placas de PARE e semáforos.
// Tudo é desenhado por código: geometria e texturas em canvas, nenhum modelo nem imagem de fora. A descrição do
// sistema viário (onde fica cada coisa) vem de shared/maquete-3d/vias.ts; aqui só se monta a malha.
// Desempenho: cada material é UMA malha só (todas as vias juntas) e cada tipo de objeto é uma malha de instâncias;
// as texturas são criadas uma vez e compartilhadas. Copas detalhadas só perto da câmera (ou com "Aprimorar").
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries as juntarGeometrias } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Implantacao as DadosImplantacao } from "@shared/maquete-3d/modelo";
import { alturaNaMalha, caixaDoTerreno, ELEVACAO, semente, type Elemento, type MaterialVia, type SistemaViario } from "@shared/maquete-3d/vias";

// ── Texturas (desenhadas uma vez, compartilhadas por todas as vias) ──

function tela(lado: number, desenhar: (c: CanvasRenderingContext2D, l: number, r: () => number) => void, semeado: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = lado;
  desenhar(canvas.getContext("2d")!, lado, semente(semeado));
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Pontilhado de grãos (agregado do asfalto, areia do concreto). */
function graos(c: CanvasRenderingContext2D, l: number, r: () => number, n: number, cores: string[], tam: [number, number]) {
  for (let i = 0; i < n; i++) { c.fillStyle = cores[Math.floor(r() * cores.length)]; const s = tam[0] + r() * (tam[1] - tam[0]); c.fillRect(r() * l, r() * l, s, s); }
}
/** Manchas largas e suaves (desgaste, umidade). */
function manchas(c: CanvasRenderingContext2D, l: number, r: () => number, n: number, cor: string, raio: [number, number], alfa: number) {
  for (let i = 0; i < n; i++) {
    const x = r() * l, y = r() * l, rr = raio[0] + r() * (raio[1] - raio[0]);
    for (const [dx, dy] of [[0, 0], [l, 0], [-l, 0], [0, l], [0, -l]]) {
      const g = c.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rr);
      g.addColorStop(0, cor.replace("A", String(alfa))); g.addColorStop(1, cor.replace("A", "0"));
      c.fillStyle = g; c.fillRect(x + dx - rr, y + dy - rr, rr * 2, rr * 2);
    }
  }
}

type Texturas = Record<"asfalto" | "concreto" | "grama" | "piso" | "pare" | "poca", THREE.CanvasTexture>;
let texturas: Texturas | null = null;
function texturasDasVias(): Texturas {
  if (texturas) return texturas;
  texturas = {
    // 1 repetição = 8 m de asfalto.
    asfalto: tela(512, (c, l, r) => {
      c.fillStyle = "#3C3E42"; c.fillRect(0, 0, l, l);
      manchas(c, l, r, 14, "rgba(70,72,76,A)", [40, 110], 0.45);
      manchas(c, l, r, 6, "rgba(28,29,32,A)", [20, 60], 0.35);
      graos(c, l, r, 26000, ["#2E3034", "#4A4C51", "#55575C", "#34363A", "#6A6A68"], [1, 2.2]);
    }, "asfalto"),
    // Sarjeta e meio-fio: concreto moldado, 1 repetição = 2 m.
    concreto: tela(256, (c, l, r) => {
      c.fillStyle = "#B4AFA6"; c.fillRect(0, 0, l, l);
      manchas(c, l, r, 8, "rgba(150,145,136,A)", [20, 60], 0.5);
      graos(c, l, r, 6000, ["#A39E95", "#C2BDB4", "#9A958C"], [1, 2]);
      c.fillStyle = "#8F8A82"; c.fillRect(0, 0, 2, l); // junta a cada peça
    }, "concreto"),
    // Faixa de serviço gramada, 1 repetição = 3 m.
    grama: tela(256, (c, l, r) => {
      c.fillStyle = "#5C8743"; c.fillRect(0, 0, l, l);
      manchas(c, l, r, 10, "rgba(110,140,70,A)", [15, 45], 0.5);
      for (let i = 0; i < 5000; i++) { c.strokeStyle = ["#4E7838", "#6B9A4E", "#78A85A", "#456E33"][Math.floor(r() * 4)]; c.lineWidth = 1; const x = r() * l, y = r() * l; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 4); c.stroke(); }
    }, "grama"),
    // Calçada de placas de concreto 0,5 × 0,5 m; 1 repetição = 2 m.
    piso: tela(512, (c, l, r) => {
      const n = 4, p = l / n;
      c.fillStyle = "#8E8981"; c.fillRect(0, 0, l, l);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const v = Math.round(196 + (r() - 0.5) * 14);
        c.fillStyle = `rgb(${v},${v - 5},${v - 13})`; c.fillRect(i * p + 2, j * p + 2, p - 4, p - 4);
      }
      graos(c, l, r, 9000, ["rgba(150,145,136,0.6)", "rgba(220,215,206,0.6)", "rgba(120,116,110,0.4)"], [1, 2]);
    }, "piso"),
    // Placa R-1 (PARE): octógono vermelho, borda e letras brancas.
    pare: tela(256, c => {
      const oct = (rr: number) => { c.beginPath(); for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + (k * Math.PI) / 4; c.lineTo(128 + rr * Math.cos(a), 128 + rr * Math.sin(a)); } c.closePath(); };
      c.fillStyle = "#F4F4F2"; c.fillRect(0, 0, 256, 256);
      oct(126); c.fillStyle = "#F4F4F2"; c.fill();
      oct(114); c.fillStyle = "#C3161C"; c.fill();
      c.fillStyle = "#F4F4F2"; c.font = "bold 76px Arial, Helvetica, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("PARE", 128, 132);
    }, "pare"),
    // Poça de luz dos postes (degradê radial), somada ao chão à noite.
    poca: tela(128, c => {
      const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, "rgba(255,214,150,1)"); g.addColorStop(0.35, "rgba(255,200,130,0.55)"); g.addColorStop(1, "rgba(255,190,120,0)");
      c.fillStyle = g; c.fillRect(0, 0, 128, 128);
    }, "poca"),
  };
  texturas.pare.wrapS = texturas.pare.wrapT = THREE.ClampToEdgeWrapping;
  texturas.poca.wrapS = texturas.poca.wrapT = THREE.ClampToEdgeWrapping;
  return texturas;
}

type MateriaisVias = Record<MaterialVia | "tinta", THREE.MeshStandardMaterial>;
let materiais: MateriaisVias | null = null;
function materiaisDasVias(): MateriaisVias {
  if (materiais) return materiais;
  const t = texturasDasVias();
  // Asfalto e tinta "puxados" para a câmera: nunca piscam com o terreno nem entre si.
  const sobre = (fator: number) => ({ polygonOffset: true, polygonOffsetFactor: fator, polygonOffsetUnits: fator * 2 });
  materiais = {
    asfalto: new THREE.MeshStandardMaterial({ map: t.asfalto, roughness: 0.93, ...sobre(-1), side: THREE.DoubleSide }),
    sarjeta: new THREE.MeshStandardMaterial({ map: t.concreto, color: "#D8D4CC", roughness: 0.88, side: THREE.DoubleSide }),
    meioFio: new THREE.MeshStandardMaterial({ map: t.concreto, color: "#F2EFE8", roughness: 0.85, side: THREE.DoubleSide }),
    servico: new THREE.MeshStandardMaterial({ map: t.grama, roughness: 1, side: THREE.DoubleSide }),
    piso: new THREE.MeshStandardMaterial({ map: t.piso, roughness: 0.9, side: THREE.DoubleSide }),
    tinta: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, ...sobre(-2), side: THREE.DoubleSide }),
  };
  return materiais;
}

/** Escala da textura (metros por repetição) e se usa coordenadas do mundo (isotrópicas) ou ao longo da via. */
const ESCALA_UV: Record<MaterialVia, { m: number; mundo: boolean }> = {
  asfalto: { m: 8, mundo: true }, servico: { m: 3, mundo: true }, sarjeta: { m: 2, mundo: false }, meioFio: { m: 2, mundo: false }, piso: { m: 2, mundo: false },
};
const CORES_TINTA = { branca: new THREE.Color("#EDEDE8"), amarela: new THREE.Color("#E3B12C") };

type Acumulador = { pos: number[]; uv: number[]; cor: number[] };
const acumulador = (): Acumulador => ({ pos: [], uv: [], cor: [] });

/** Junta tudo por material, já na cota do terreno. */
function malhasDasVias(sv: SistemaViario, altura: (x: number, y: number) => number): Partial<Record<MaterialVia | "tinta", THREE.BufferGeometry>> {
  const acc: Record<MaterialVia | "tinta", Acumulador> = { asfalto: acumulador(), sarjeta: acumulador(), meioFio: acumulador(), servico: acumulador(), piso: acumulador(), tinta: acumulador() };
  const cache = new Map<string, number>();
  const chao = (x: number, y: number) => {
    const k = `${Math.round(x * 50)}|${Math.round(y * 50)}`;
    let h = cache.get(k);
    if (h === undefined) { h = altura(x, y) + ELEVACAO; cache.set(k, h); }
    return h;
  };
  // Triângulo com a face de cima voltada para cima (as faces verticais valem dos dois lados).
  const tri = (a: Acumulador, p: number[][], uv: number[][], cor?: THREE.Color) => {
    const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const area = Math.hypot(nx, ny, nz);
    if (area < 1e-7) return;
    const ordem = ny < 0 ? [0, 2, 1] : [0, 1, 2];
    for (const k of ordem) { a.pos.push(p[k][0], p[k][1], p[k][2]); a.uv.push(uv[k][0], uv[k][1]); if (cor) a.cor.push(cor.r, cor.g, cor.b); }
  };
  const uvDe = (mat: MaterialVia, x: number, y: number, u: number, v: number) => { const e = ESCALA_UV[mat]; return e.mundo ? [x / e.m, y / e.m] : [u / e.m, v / e.m]; };

  for (const vr of sv.varreduras) {
    const nC = vr.colunas.length, nI = vr.colunas[0]?.length ?? 0;
    const P = (c: number, i: number) => { const q = vr.colunas[c][i]; return [q.x, chao(q.x, q.y) + vr.alturas[c][i], q.y]; };
    for (let c = 0; c < nC - 1; c++) {
      const mat = vr.materiais[c];
      if (!mat) continue;
      for (let i = 0; i < nI - 1; i++) {
        const A = P(c, i), B = P(c, i + 1), C = P(c + 1, i + 1), D = P(c + 1, i);
        const uA = uvDe(mat, A[0], A[2], vr.u[c][i], vr.v[c][i]), uB = uvDe(mat, B[0], B[2], vr.u[c][i + 1], vr.v[c][i + 1]);
        const uC = uvDe(mat, C[0], C[2], vr.u[c + 1][i + 1], vr.v[c + 1][i + 1]), uD = uvDe(mat, D[0], D[2], vr.u[c + 1][i], vr.v[c + 1][i]);
        tri(acc[mat], [A, B, C], [uA, uB, uC]);
        tri(acc[mat], [A, C, D], [uA, uC, uD]);
      }
    }
    // Tampas nas pontas sem saída: fecha o perfil da calçada até o chão.
    for (const [usar, i] of [[vr.tampas?.inicio, 0], [vr.tampas?.fim, nI - 1]] as const) {
      if (!usar) continue;
      for (let c = 0; c < nC - 1; c++) {
        const A = P(c, i), B = P(c + 1, i), a2 = [A[0], A[1] - vr.alturas[c][i] - 0.08, A[2]], b2 = [B[0], B[1] - vr.alturas[c + 1][i] - 0.08, B[2]];
        tri(acc.meioFio, [A, B, b2], [[0, 0], [0.1, 0], [0.1, 0.1]]);
        tri(acc.meioFio, [A, b2, a2], [[0, 0], [0.1, 0.1], [0, 0.1]]);
      }
    }
  }

  // Placas de asfalto (miolo de cruzamento e balão): triangula e subdivide para acompanhar o relevo.
  for (const pl of sv.placas) {
    const contorno = pl.contorno.map(p => new THREE.Vector2(p.x, p.y));
    if (contorno.length < 3) continue;
    let tris: number[][][] = THREE.ShapeUtils.triangulateShape(contorno, []).map(t => t.map(k => [contorno[k].x, contorno[k].y]));
    for (let passo = 0; passo < 4; passo++) {
      const prox: number[][][] = [];
      let dividiu = false;
      for (const t of tris) {
        const lado = Math.max(Math.hypot(t[0][0] - t[1][0], t[0][1] - t[1][1]), Math.hypot(t[1][0] - t[2][0], t[1][1] - t[2][1]), Math.hypot(t[2][0] - t[0][0], t[2][1] - t[0][1]));
        if (lado <= 3) { prox.push(t); continue; }
        dividiu = true;
        const m = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const ab = m(t[0], t[1]), bc = m(t[1], t[2]), ca = m(t[2], t[0]);
        prox.push([t[0], ab, ca], [ab, t[1], bc], [ca, bc, t[2]], [ab, bc, ca]);
      }
      tris = prox;
      if (!dividiu) break;
    }
    for (const t of tris) tri(acc.asfalto, t.map(([x, y]) => [x, chao(x, y), y]), t.map(([x, y]) => [x / 8, y / 8]));
  }

  // Sinalização horizontal.
  for (const f of sv.pinturas) {
    const p = f.p.map((q, k) => [q.x, chao(q.x, q.y) + f.h[k], q.y]), cor = CORES_TINTA[f.cor];
    tri(acc.tinta, [p[0], p[1], p[2]], [[0, 0], [1, 0], [1, 1]], cor);
    tri(acc.tinta, [p[0], p[2], p[3]], [[0, 0], [1, 1], [0, 1]], cor);
  }

  const out: Partial<Record<MaterialVia | "tinta", THREE.BufferGeometry>> = {};
  for (const [k, a] of Object.entries(acc) as [MaterialVia | "tinta", Acumulador][]) {
    if (!a.pos.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(a.pos), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(a.uv), 2));
    if (a.cor.length) g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(a.cor), 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    out[k] = g;
  }
  return out;
}

// ── Objetos (geometrias locais; pé no chão em y = 0) ──

/** Junta geometrias (todas sem índice, para poderem ser somadas). */
const mergeGeometries = (gs: THREE.BufferGeometry[]) => juntarGeometrias(gs.map(g => (g.index ? g.toNonIndexed() : g)));

/** Copa orgânica: icosaedro com os vértices deslocados de forma fixa (a mesma em toda visita). */
function bolha(raio: number, detalhe: number, escY: number, x: number, y: number, z: number, chave: string) {
  const g = new THREE.IcosahedronGeometry(raio, detalhe), pos = g.getAttribute("position"), r = semente(chave);
  const desloc = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(3)}|${pos.getY(i).toFixed(3)}|${pos.getZ(i).toFixed(3)}`;
    if (!desloc.has(k)) desloc.set(k, 0.82 + r() * 0.3);
    const f = desloc.get(k)!;
    pos.setXYZ(i, pos.getX(i) * f + x, pos.getY(i) * f * escY + y, pos.getZ(i) * f + z);
  }
  // Normais "de bola" (do centro para fora): a copa fica macia, sem facetas de cristal.
  const nor = g.getAttribute("normal"), v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { v.set(pos.getX(i) - x, (pos.getY(i) - y) / (escY * escY), pos.getZ(i) - z).normalize(); nor.setXYZ(i, v.x, v.y, v.z); }
  return g;
}

/** Três formas de copa (redonda, alongada e em guarda-chuva), em versão simples (longe) e detalhada (perto). */
function copas(detalhada: boolean): THREE.BufferGeometry[] {
  // Perto: várias bolhas lapidadas; longe: uma bolha simples. "Aprimorar" detalha todas (não mais fino, para caber no celular).
  const d = detalhada ? 1 : 0;
  const juntar = (gs: THREE.BufferGeometry[]) => { const m = mergeGeometries(gs)!; gs.forEach(g => g.dispose()); return m; };
  if (!detalhada) return [
    juntar([bolha(2.2, d, 0.85, 0, 3.9, 0, "c0")]),
    juntar([bolha(1.4, d, 1.9, 0, 4.4, 0, "c1")]),
    juntar([bolha(3.0, d, 0.42, 0, 4.7, 0, "c2")]),
  ];
  return [
    juntar([bolha(2.0, d, 0.85, 0, 3.9, 0, "a"), bolha(1.4, d, 0.9, 1.1, 3.5, 0.4, "b"), bolha(1.3, d, 0.9, -1.0, 3.6, -0.5, "c"), bolha(1.2, d, 0.9, 0.2, 4.8, -0.6, "d"), bolha(1.1, d, 0.9, -0.4, 4.5, 0.9, "e")]),
    juntar([bolha(1.35, d, 1.7, 0, 4.2, 0, "f"), bolha(0.9, d, 1.4, 0.2, 6.0, 0.1, "g"), bolha(0.95, d, 1.2, -0.5, 3.2, 0.3, "h")]),
    juntar([bolha(2.9, d, 0.36, 0, 4.8, 0, "i"), bolha(1.5, d, 0.6, 1.5, 4.4, 0.6, "j"), bolha(1.5, d, 0.6, -1.4, 4.5, -0.7, "k"), bolha(1.3, d, 0.6, 0.3, 4.4, -1.6, "l"), bolha(1.3, d, 0.6, -0.4, 4.6, 1.6, "m")]),
  ];
}
function tronco() {
  const t = new THREE.CylinderGeometry(0.09, 0.15, 3.8, 7);
  t.translate(0, 1.9, 0);
  return t;
}
const ALTURA_POSTE = 8, BRACO_POSTE = 1.7;
function poste() {
  const fuste = new THREE.CylinderGeometry(0.065, 0.11, ALTURA_POSTE, 8); fuste.translate(0, ALTURA_POSTE / 2, 0);
  const base = new THREE.CylinderGeometry(0.15, 0.17, 0.5, 8); base.translate(0, 0.25, 0);
  const braco = new THREE.BoxGeometry(BRACO_POSTE + 0.1, 0.07, 0.07); braco.rotateZ(0.12); braco.translate(BRACO_POSTE / 2, ALTURA_POSTE - 0.15, 0);
  const cabeca = new THREE.BoxGeometry(0.7, 0.13, 0.32); cabeca.translate(BRACO_POSTE + 0.1, ALTURA_POSTE - 0.02, 0);
  return mergeGeometries([fuste, base, braco, cabeca])!;
}
function lenteDoPoste() { const g = new THREE.BoxGeometry(0.55, 0.03, 0.24); g.translate(BRACO_POSTE + 0.1, ALTURA_POSTE - 0.1, 0); return g; }
function placaPare() {
  const haste = new THREE.CylinderGeometry(0.03, 0.03, 2.55, 6); haste.translate(0, 1.275, 0);
  const forma = new THREE.Shape();
  for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + (k * Math.PI) / 4; const p = [0.33 * Math.cos(a), 0.33 * Math.sin(a)]; if (k) forma.lineTo(p[0], p[1]); else forma.moveTo(p[0], p[1]); }
  const verso = new THREE.ShapeGeometry(forma); verso.rotateY(-Math.PI / 2); verso.translate(-0.005, 2.3, 0);
  const frente = new THREE.ShapeGeometry(forma);
  // UV do octógono no quadrado da textura.
  const uv = frente.getAttribute("uv"), pos = frente.getAttribute("position");
  for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.5 + pos.getX(i) / 0.68, 0.5 + pos.getY(i) / 0.68);
  frente.rotateY(Math.PI / 2); frente.translate(0.005, 2.3, 0);
  return { suporte: mergeGeometries([haste, verso])!, frente };
}
const BRACO_SEMAFORO = 3.0;
function semaforo() {
  const coluna = new THREE.CylinderGeometry(0.09, 0.12, 5.7, 10); coluna.translate(0, 2.85, 0);
  const braco = new THREE.BoxGeometry(BRACO_SEMAFORO + 0.2, 0.1, 0.1); braco.translate(BRACO_SEMAFORO / 2, 5.55, 0);
  const caixa1 = new THREE.BoxGeometry(0.36, 1.05, 0.3); caixa1.translate(BRACO_SEMAFORO, 4.95, 0);
  const anteparo1 = new THREE.BoxGeometry(0.62, 1.3, 0.03); anteparo1.translate(BRACO_SEMAFORO, 4.95, 0.17);
  const caixa2 = new THREE.BoxGeometry(0.36, 1.05, 0.3); caixa2.translate(0, 3.0, -0.22);
  return mergeGeometries([coluna, braco, caixa1, anteparo1, caixa2])!;
}
/** Lentes do semáforo: 0 = vermelha (em cima), 1 = amarela, 2 = verde. Voltadas para −z (quem chega). */
function lente(qual: number) {
  const dy = 0.32 - qual * 0.32;
  const a = new THREE.CylinderGeometry(0.11, 0.11, 0.04, 14); a.rotateX(Math.PI / 2); a.translate(BRACO_SEMAFORO, 4.95 + dy, -0.16);
  const b = new THREE.CylinderGeometry(0.11, 0.11, 0.04, 14); b.rotateX(Math.PI / 2); b.translate(0, 3.0 + dy, -0.38);
  return mergeGeometries([a, b])!;
}

/** Malha de instâncias: posiciona cada elemento na cota dele, girado e na escala dele. */
function Instancias({ geometria, material, itens, cor, sombra = true }: {
  geometria: THREE.BufferGeometry; material: THREE.Material; itens: Elemento[]; cor?: (e: Elemento, i: number) => THREE.Color; sombra?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    itens.forEach((e, i) => {
      o.position.set(e.x, e.cota, e.y); o.rotation.set(0, e.giro, 0); o.scale.setScalar(e.escala); o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      if (cor) m.setColorAt(i, cor(e, i));
    });
    m.count = itens.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [itens, cor]);
  if (!itens.length) return null;
  return <instancedMesh key={itens.length} ref={ref} args={[geometria, material, itens.length]} castShadow={sombra} receiveShadow />;
}

// Cores das copas: verdes variados e, de vez em quando, um ipê florido (amarelo ou roxo).
const VERDES = ["#3E6B2E", "#4F7F35", "#5C8A3C", "#355E2B", "#6A9343"].map(c => new THREE.Color(c));
const IPE_AMARELO = new THREE.Color("#D9B02B"), IPE_ROXO = new THREE.Color("#B35C9C");
const corDaCopa = (e: Elemento) => {
  const t = e.tom ?? 0;
  if (t > 0.95) return IPE_AMARELO;
  if (t > 0.91) return IPE_ROXO;
  return VERDES[Math.floor(t * 5) % 5].clone().multiplyScalar(0.9 + ((t * 37) % 1) * 0.2);
};

const DISTANCIA_COPA_DETALHADA = 80;
const MAX_COPAS_DETALHADAS = 160;

/**
 * Vias em 3D. `noite` (0–1) acende as luminárias; `aprimorado` liga o nível máximo de detalhe (todas as copas
 * detalhadas e mais postes com luz de verdade).
 */
export function Vias({ implantacao: imp, sistema: sv, noite, aprimorado }: { implantacao: DadosImplantacao; sistema: SistemaViario; noite: number; aprimorado: boolean }) {
  const caixa = useMemo(() => caixaDoTerreno(imp), [imp]);
  const altura = useMemo(() => (x: number, y: number) => alturaNaMalha(imp.relevo, caixa, x, y), [imp.relevo, caixa]);
  const malhas = useMemo(() => malhasDasVias(sv, altura), [sv, altura]);
  useEffect(() => () => { Object.values(malhas).forEach(g => g?.dispose()); }, [malhas]);
  const mat = materiaisDasVias();

  // Objetos: geometrias e materiais (recriados só quando muda o nível de detalhe).
  const obj = useMemo(() => {
    const pare = placaPare();
    return {
      tronco: tronco(), poste: poste(), lentePoste: lenteDoPoste(), pareSuporte: pare.suporte, pareFrente: pare.frente, semaforo: semaforo(), lentes: [0, 1, 2].map(lente),
      poca: (() => { const g = new THREE.PlaneGeometry(15, 15); g.rotateX(-Math.PI / 2); return g; })(),
      mTronco: new THREE.MeshStandardMaterial({ color: "#5A4636", roughness: 1 }),
      mCopa: new THREE.MeshStandardMaterial({ color: "#FFFFFF", roughness: 0.92 }),
      mMetal: new THREE.MeshStandardMaterial({ color: "#8D9399", roughness: 0.55, metalness: 0.5 }),
      mSemaforo: new THREE.MeshStandardMaterial({ color: "#2B2E31", roughness: 0.6, metalness: 0.3 }),
      mPare: new THREE.MeshStandardMaterial({ map: texturasDasVias().pare, roughness: 0.6 }),
      mLuminaria: new THREE.MeshBasicMaterial({ color: "#DCE2E6", toneMapped: false }),
      mLente: new THREE.MeshBasicMaterial({ color: "#FFFFFF", toneMapped: false }),
      mPoca: new THREE.MeshBasicMaterial({ map: texturasDasVias().poca, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }),
    };
  }, []);
  const copasLonge = useMemo(() => copas(false), []);
  const copasPerto = useMemo(() => copas(true), []);
  useEffect(() => () => { copasPerto.forEach(g => g.dispose()); }, [copasPerto]);
  useEffect(() => () => { copasLonge.forEach(g => g.dispose()); }, [copasLonge]);
  useEffect(() => () => {
    for (const v of Object.values(obj)) if (Array.isArray(v)) v.forEach(g => g.dispose()); else (v as { dispose: () => void }).dispose();
  }, [obj]);

  // Noite: luminárias quentes e poças de luz no chão; de dia, lente apagada.
  useEffect(() => {
    obj.mLuminaria.color.set(noite > 0.25 ? "#FFE3B0" : "#DCE2E6").multiplyScalar(noite > 0.25 ? 1 + noite * 1.6 : 1);
    obj.mPoca.opacity = Math.max(0, (noite - 0.2) / 0.8) * 0.7;
    obj.mPoca.visible = noite > 0.2;
  }, [noite, obj]);

  const porTipo = useMemo(() => {
    const g: Record<Elemento["tipo"], Elemento[]> = { arvore: [], poste: [], pare: [], semaforo: [] };
    for (const e of sv.elementos) g[e.tipo].push(e);
    return g;
  }, [sv]);

  // Poças de luz: no chão, sob a luminária, inclinadas como o terreno.
  const pocas = useMemo(() => porTipo.poste.map(e => {
    const alcance = (BRACO_POSTE + 0.1) * e.escala, x = e.x + Math.cos(e.giro) * alcance, y = e.y - Math.sin(e.giro) * alcance;
    return { x, y, z: altura(x, y) + ELEVACAO + 0.2, dx: altura(x + 1, y) - altura(x - 1, y), dy: altura(x, y + 1) - altura(x, y - 1) };
  }), [porTipo, altura]);
  const refPoca = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = refPoca.current;
    if (!m) return;
    const o = new THREE.Object3D(), n = new THREE.Vector3();
    pocas.forEach((p, i) => {
      o.position.set(p.x, p.z, p.y);
      n.set(-p.dx / 2, 1, -p.dy / 2).normalize();
      o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      o.updateMatrix(); m.setMatrixAt(i, o.matrix);
    });
    m.count = pocas.length; m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere();
  }, [pocas]);

  // Copas detalhadas perto da câmera (confere duas vezes por segundo); com "Aprimorar", num raio bem maior.
  const [perto, setPerto] = useState<Set<number>>(() => new Set());
  const relogio = useRef(1);
  useFrame(({ camera }, dt) => {
    relogio.current += dt;
    if (relogio.current < 0.5) return;
    relogio.current = 0;
    const arv = porTipo.arvore;
    const alcance = aprimorado ? DISTANCIA_COPA_DETALHADA * 2.5 : DISTANCIA_COPA_DETALHADA, maximo = aprimorado ? MAX_COPAS_DETALHADAS * 4 : MAX_COPAS_DETALHADAS;
    const ids = arv.map((e, i) => ({ i, d: Math.hypot(e.x - camera.position.x, e.y - camera.position.z, e.cota - camera.position.y) }))
      .filter(c => c.d < alcance).sort((a, b) => a.d - b.d).slice(0, maximo).map(c => c.i).sort((a, b) => a - b);
    const chave = ids.join(",");
    if (chave !== Array.from(perto).join(",")) setPerto(new Set(ids));
  });
  const grupos = useMemo(() => {
    const perto3: Elemento[][] = [[], [], []], longe3: Elemento[][] = [[], [], []];
    porTipo.arvore.forEach((e, i) => (perto.has(i) ? perto3 : longe3)[e.variante % 3].push(e));
    return { perto3, longe3 };
  }, [porTipo, perto]);

  // Luz de verdade só nos postes mais próximos (poucas, para não pesar); o resto brilha pela luminária e pela poça.
  const qtdLuzes = aprimorado ? 8 : 4;
  const [luzes, setLuzes] = useState<number[]>([]);
  const relogioLuz = useRef(1);
  useFrame(({ camera }, dt) => {
    if (noite < 0.3) return;
    relogioLuz.current += dt;
    if (relogioLuz.current < 0.7) return;
    relogioLuz.current = 0;
    const ids = pocas.map((p, i) => ({ i, d: Math.hypot(p.x - camera.position.x, p.y - camera.position.z) })).sort((a, b) => a.d - b.d).slice(0, qtdLuzes).map(c => c.i);
    if (ids.join(",") !== luzes.join(",")) setLuzes(ids);
  });

  const corLente = useMemo(() => {
    const vermelho = new THREE.Color(1, 0.12, 0.08), verde = new THREE.Color(0.1, 1, 0.35), amarelo = new THREE.Color(0.16, 0.12, 0.04), apagada = new THREE.Color(0.1, 0.07, 0.06);
    return [
      (e: Elemento) => (e.estado === "vermelho" ? vermelho : apagada),
      () => amarelo,
      (e: Elemento) => (e.estado === "verde" ? verde : new THREE.Color(0.04, 0.09, 0.06)),
    ];
  }, []);

  return (
    <group>
      {(Object.keys(malhas) as (MaterialVia | "tinta")[]).map(k => <mesh key={k} geometry={malhas[k]} material={mat[k]} receiveShadow />)}
      {grupos.longe3.map((itens, v) => <Instancias key={`l${v}`} geometria={copasLonge[v]} material={obj.mCopa} itens={itens} cor={corDaCopa} />)}
      {grupos.perto3.map((itens, v) => <Instancias key={`p${v}`} geometria={copasPerto[v]} material={obj.mCopa} itens={itens} cor={corDaCopa} />)}
      <Instancias geometria={obj.tronco} material={obj.mTronco} itens={porTipo.arvore} />
      <Instancias geometria={obj.poste} material={obj.mMetal} itens={porTipo.poste} />
      <Instancias geometria={obj.lentePoste} material={obj.mLuminaria} itens={porTipo.poste} sombra={false} />
      <Instancias geometria={obj.pareSuporte} material={obj.mMetal} itens={porTipo.pare} />
      <Instancias geometria={obj.pareFrente} material={obj.mPare} itens={porTipo.pare} sombra={false} />
      <Instancias geometria={obj.semaforo} material={obj.mSemaforo} itens={porTipo.semaforo} />
      {obj.lentes.map((g, k) => <Instancias key={`s${k}`} geometria={g} material={obj.mLente} itens={porTipo.semaforo} cor={corLente[k]} sombra={false} />)}
      {pocas.length > 0 && <instancedMesh key={`poca${pocas.length}`} ref={refPoca} args={[obj.poca, obj.mPoca, pocas.length]} renderOrder={2} />}
      {noite >= 0.3 && Array.from({ length: qtdLuzes }, (_, k) => {
        const p = pocas[luzes[k] ?? -1];
        return <pointLight key={k} position={p ? [p.x, p.z + ALTURA_POSTE - 0.6, p.y] : [0, -100, 0]} color="#FFD7A0" intensity={p ? noite * 70 : 0} distance={30} decay={1.4} />;
      })}
    </group>
  );
}

/** Cor do asfalto para as ruas que não viraram via 3D (forma irreconhecível): continuam pintadas no terreno. */
export const COR_ASFALTO_PINTADO = "#3B3D42";
/** Leito das ruas que viraram via 3D: fica por baixo da malha, só aparece nas frestas — tom de concreto. */
export const COR_LEITO = "#9A958C";

/** Mesma semente para o pontilhado do terreno (a cena igual a cada abertura). */
export const sorteioDoTerreno = () => semente("terreno");
