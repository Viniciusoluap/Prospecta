// Maquete 3D (EPIC-024, S-04) — muro de divisa em 3D: corpo de alvenaria com o acabamento escolhido (reboco
// pintado, bloco, tijolo ou pedra), capa de concreto no topo, pilares e portão de gradil. A geometria vem pronta
// de shared/maquete-3d/muro.ts (já assentada no relevo); aqui só se montam as malhas — uma por material, para o
// muro inteiro ser três chamadas de desenho. Texturas desenhadas por código, sem arquivo de fora.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { AcabamentoMuro, Implantacao as DadosImplantacao, Muro as DadosMuro } from "@shared/maquete-3d/modelo";
import { geometriaDoMuro, type MaterialMuro } from "@shared/maquete-3d/muro";
import { alturaNaMalha, caixaDoTerreno, semente, type SistemaViario } from "@shared/maquete-3d/vias";

const clarear = (cor: string, f: number) => `#${new THREE.Color(cor).multiplyScalar(f).getHexString()}`;

function tela(lado: number, desenhar: (c: CanvasRenderingContext2D, l: number, r: () => number) => void, chave: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = lado;
  desenhar(canvas.getContext("2d")!, lado, semente(chave));
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function graos(c: CanvasRenderingContext2D, l: number, r: () => number, n: number, cor: string, var_: number) {
  for (let i = 0; i < n; i++) { c.fillStyle = clarear(cor, 1 - var_ + r() * var_ * 2); const s = 1 + r() * 2; c.fillRect(r() * l, r() * l, s, s); }
}

/** Metros por repetição da textura de cada acabamento. */
const ESCALA: Record<AcabamentoMuro, number> = { reboco: 2, bloco: 1.6, tijolo: 1.2, pedra: 2.4 };

/** Textura da face do muro (1 repetição = ESCALA m), com a cor escolhida como base. */
function texturaDoMuro(acabamento: AcabamentoMuro, cor: string): THREE.CanvasTexture {
  return tela(512, (c, l, r) => {
    const junta = clarear(cor, 0.62);
    if (acabamento === "reboco") {
      c.fillStyle = cor; c.fillRect(0, 0, l, l);
      for (let i = 0; i < 18; i++) {
        const x = r() * l, y = r() * l, rr = 30 + r() * 90, g = c.createRadialGradient(x, y, 0, x, y, rr);
        g.addColorStop(0, `${clarear(cor, 0.9 + r() * 0.16)}55`); g.addColorStop(1, `${cor}00`);
        c.fillStyle = g; c.fillRect(x - rr, y - rr, rr * 2, rr * 2);
      }
      graos(c, l, r, 26000, cor, 0.07);
      return;
    }
    c.fillStyle = junta; c.fillRect(0, 0, l, l);
    if (acabamento === "bloco" || acabamento === "tijolo") {
      // Assentamento em amarração (meia peça de deslocamento a cada fiada).
      const [cols, fiadas] = acabamento === "bloco" ? [4, 8] : [6, 18];
      const w = l / cols, h = l / fiadas, j = acabamento === "bloco" ? 3 : 2.5;
      for (let f = 0; f < fiadas; f++) for (let k = -1; k < cols; k++) {
        const x = k * w + (f % 2 ? w / 2 : 0);
        c.fillStyle = clarear(cor, 0.86 + r() * 0.26); c.fillRect(x + j, f * h + j, w - j * 2, h - j * 2);
      }
      graos(c, l, r, 14000, cor, 0.1);
      return;
    }
    // Pedra: fiadas de alturas diferentes, pedras de comprimentos diferentes.
    let y = 0;
    while (y < l) {
      const h = Math.min(l - y, 40 + r() * 50);
      let x = -r() * 60;
      while (x < l) {
        const w = 50 + r() * 90;
        c.fillStyle = clarear(cor, 0.78 + r() * 0.36);
        c.beginPath(); c.moveTo(x + 4 + r() * 4, y + 4); c.lineTo(x + w - 4, y + 3 + r() * 5); c.lineTo(x + w - 3 - r() * 5, y + h - 4); c.lineTo(x + 4, y + h - 3 - r() * 4); c.closePath(); c.fill();
        x += w;
      }
      y += h;
    }
    graos(c, l, r, 20000, cor, 0.14);
  }, `muro-${acabamento}-${cor}`);
}

type MateriaisMuro = Record<MaterialMuro, THREE.MeshStandardMaterial>;
function materiaisDoMuro(acabamento: AcabamentoMuro, cor: string): MateriaisMuro {
  const mapa = texturaDoMuro(acabamento, cor);
  mapa.repeat.set(1 / ESCALA[acabamento], 1 / ESCALA[acabamento]);
  const capa = tela(256, (c, l, r) => { c.fillStyle = "#AEAAA2"; c.fillRect(0, 0, l, l); graos(c, l, r, 7000, "#AEAAA2", 0.1); }, "capa");
  capa.repeat.set(0.5, 0.5);
  return {
    muro: new THREE.MeshStandardMaterial({ vertexColors: true, map: mapa, bumpMap: mapa, bumpScale: acabamento === "reboco" ? 0.4 : 1.2, roughness: acabamento === "pedra" ? 0.85 : 0.93 }),
    capa: new THREE.MeshStandardMaterial({ vertexColors: true, map: capa, bumpMap: capa, bumpScale: 0.3, roughness: 0.88 }),
    portao: new THREE.MeshStandardMaterial({ vertexColors: true, color: "#2B2F33", roughness: 0.45, metalness: 0.6 }),
  };
}

/** Muro de divisa do empreendimento, assentado na mesma malha do terreno. */
export function Muro({ implantacao: imp, muro, sistema }: { implantacao: DadosImplantacao; muro: DadosMuro; sistema?: SistemaViario }) {
  const caixa = useMemo(() => caixaDoTerreno(imp), [imp]);
  const geo = useMemo(() => geometriaDoMuro(imp, muro, { sistema, altura: (x, y) => alturaNaMalha(imp.relevo, caixa, x, y) }), [imp, muro, sistema, caixa]);
  const malhas = useMemo(() => {
    const out: [MaterialMuro, THREE.BufferGeometry][] = [];
    for (const [k, m] of Object.entries(geo?.malhas ?? {}) as [MaterialMuro, NonNullable<NonNullable<typeof geo>["malhas"][MaterialMuro]>][]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(m.posicoes, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(m.normais, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(m.uvs, 2));
      // Tom por vértice (cinza): escurece o pé do muro, como sombra de contato.
      const cor = new Float32Array(m.tons.length * 3);
      m.tons.forEach((t, i) => cor.fill(t, i * 3, i * 3 + 3));
      g.setAttribute("color", new THREE.BufferAttribute(cor, 3));
      g.setIndex(new THREE.BufferAttribute(m.indices, 1));
      g.computeBoundingSphere();
      out.push([k, g]);
    }
    return out;
  }, [geo]);
  useEffect(() => () => { malhas.forEach(([, g]) => g.dispose()); }, [malhas]);
  const mat = useMemo(() => materiaisDoMuro(muro.acabamento, muro.cor), [muro.acabamento, muro.cor]);
  useEffect(() => () => { for (const m of Object.values(mat)) { m.map?.dispose(); m.dispose(); } }, [mat]);
  return <group>{malhas.map(([k, g]) => <mesh key={k} geometry={g} material={mat[k]} castShadow receiveShadow />)}</group>;
}
