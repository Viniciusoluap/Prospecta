// Maquete 3D (EPIC-028, Etapa 2) — materiais do gerador do JSON-fonte: um piso por acabamento (porcelanato, cerâmica,
// cimentado, concreto, grama), calçada, asfalto, telha de fibrocimento ondulada, granito das soleiras e o cinza do
// corte. Texturas desenhadas por código em canvas (custo zero: nenhum arquivo, nenhum serviço). Todas as coordenadas
// de textura da cena estão em METROS, então `repeat` = 1 / (tamanho em metros que um canvas representa).
import * as THREE from "three";
import type { AcabamentoPiso } from "@shared/maquete-3d/fonte";
import { clarear, sorteio, tela, texturaCeramica, texturaPedra, texturaRuido, materiaisDoEstilo, type Materiais } from "./materiais";

export type MateriaisFonte = {
  base: Materiais;
  pisos: Record<AcabamentoPiso, THREE.MeshStandardMaterial>;
  parede: THREE.MeshStandardMaterial; muro: THREE.MeshStandardMaterial; corte: THREE.MeshStandardMaterial;
  platibanda: THREE.MeshStandardMaterial; rufo: THREE.MeshStandardMaterial; forro: THREE.MeshStandardMaterial;
  telha: THREE.MeshStandardMaterial; calha: THREE.MeshStandardMaterial; granito: THREE.MeshStandardMaterial;
  calcada: THREE.MeshStandardMaterial; asfalto: THREE.MeshStandardMaterial; solo: THREE.MeshStandardMaterial;
  aluminio: THREE.MeshStandardMaterial; madeiraPorta: THREE.MeshStandardMaterial; aco: THREE.MeshStandardMaterial;
  vidro: THREE.MeshStandardMaterial; ferragem: THREE.MeshStandardMaterial;
};

/** Textura com `metros` de lado por canvas (as coordenadas de textura da cena estão em metros). */
function emMetros(t: THREE.Texture, metros: number) { t.repeat.set(1 / metros, 1 / metros); return t; }
function mat(p: THREE.MeshStandardMaterialParameters & { relevo?: number }) {
  const { relevo, ...r } = p;
  if (relevo && r.map) { r.bumpMap = r.map; r.bumpScale = relevo; }
  return new THREE.MeshStandardMaterial(r);
}

function texturaGrama(semente: number) {
  return tela(512, (c, l) => {
    const r = sorteio(semente);
    c.fillStyle = "#5F8A43"; c.fillRect(0, 0, l, l);
    for (let i = 0; i < 9000; i++) { c.fillStyle = clarear("#5F8A43", 0.75 + r() * 0.5); c.fillRect(r() * l, r() * l, 1 + r() * 2, 1 + r() * 2); }
    // Folhas finas, em todas as direções, mais claras e mais escuras.
    for (let i = 0; i < 2600; i++) {
      const x = r() * l, y = r() * l, a = r() * Math.PI, h = 3 + r() * 7;
      c.strokeStyle = clarear(r() > 0.5 ? "#7FA857" : "#476E32", 0.85 + r() * 0.3); c.globalAlpha = 0.55; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * h, y - Math.sin(a) * h); c.stroke();
    }
    c.globalAlpha = 1;
  });
}

function texturaCimentado(cor: string, semente: number, junta: number) {
  return tela(512, (c, l) => {
    const r = sorteio(semente);
    c.fillStyle = cor; c.fillRect(0, 0, l, l);
    // Manchas largas de desempeno e grão fino.
    for (let i = 0; i < 60; i++) {
      const g = c.createRadialGradient(r() * l, r() * l, 0, r() * l, r() * l, 40 + r() * 120);
      g.addColorStop(0, `rgba(${r() > 0.5 ? "255,255,255" : "0,0,0"},0.05)`); g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g; c.fillRect(0, 0, l, l);
    }
    for (let i = 0; i < 12000; i++) { c.fillStyle = clarear(cor, 0.9 + r() * 0.2); c.globalAlpha = 0.5; c.fillRect(r() * l, r() * l, 1, 1); }
    c.globalAlpha = 1;
    if (junta > 0) {
      c.strokeStyle = clarear(cor, 0.62); c.lineWidth = 3;
      for (let k = 0; k <= junta; k++) { const p = (k * l) / junta; c.beginPath(); c.moveTo(p, 0); c.lineTo(p, l); c.moveTo(0, p); c.lineTo(l, p); c.stroke(); }
    }
  });
}

function texturaAsfalto(semente: number) {
  return tela(512, (c, l) => {
    const r = sorteio(semente);
    c.fillStyle = "#4B4C4E"; c.fillRect(0, 0, l, l);
    for (let i = 0; i < 26000; i++) { c.fillStyle = clarear("#4B4C4E", 0.6 + r() * 0.9); c.fillRect(r() * l, r() * l, 1 + r() * 1.5, 1 + r() * 1.5); }
  });
}

/** Fibrocimento ondulado: ondas ao longo de u (largura), 8 ondas por canvas. */
function texturaFibrocimento(semente: number) {
  return tela(256, (c, l) => {
    const r = sorteio(semente), n = 8, w = l / n;
    for (let i = 0; i < n; i++) {
      const g = c.createLinearGradient(i * w, 0, (i + 1) * w, 0);
      g.addColorStop(0, "#7E807D"); g.addColorStop(0.3, "#A9ABA7"); g.addColorStop(0.55, "#B9BBB7"); g.addColorStop(1, "#7E807D");
      c.fillStyle = g; c.fillRect(i * w, 0, w, l);
    }
    for (let i = 0; i < 2500; i++) { c.fillStyle = `rgba(${r() > 0.5 ? "255,255,255" : "40,40,40"},0.06)`; c.fillRect(r() * l, r() * l, 1 + r() * 3, 1); }
  });
}

const cache = new Map<string, MateriaisFonte>();

export function materiaisDaFonte(): MateriaisFonte {
  const pronto = cache.get("padrao");
  if (pronto) return pronto;
  const base = materiaisDoEstilo("moderno");
  const porcelanato = emMetros(texturaCeramica("#D8D3CA", "#BDB6AA", 501, 2), 1.2);
  const ceramica = emMetros(texturaCeramica("#E4E6E4", "#C9CCCA", 502, 4), 1.2);
  const parede = emMetros(texturaRuido("#EEEBE5", 503, 0.025), 2);
  const muro = emMetros(texturaRuido("#D9D3C7", 504, 0.06), 1.6);
  const m: MateriaisFonte = {
    base,
    pisos: {
      porcelanato: mat({ map: porcelanato, roughness: 0.3, metalness: 0, relevo: 0.08 }),
      ceramica: mat({ map: ceramica, roughness: 0.38, relevo: 0.1 }),
      cimentado: mat({ map: emMetros(texturaCimentado("#B9B5AD", 505, 2), 2), roughness: 0.92, relevo: 0.25 }),
      concreto: mat({ map: emMetros(texturaCimentado("#A9A69F", 506, 1), 2.5), roughness: 0.95, relevo: 0.3 }),
      grama: mat({ map: emMetros(texturaGrama(507), 1.5), roughness: 1, relevo: 0.9 }),
    },
    parede: mat({ map: parede, roughness: 0.92, relevo: 0.15 }),
    muro: mat({ map: muro, roughness: 0.96, relevo: 0.4 }),
    corte: mat({ color: "#4A4A47", roughness: 1 }),
    platibanda: mat({ map: emMetros(texturaRuido("#E6E2DA", 508, 0.05), 1.6), roughness: 0.95, relevo: 0.3 }),
    rufo: mat({ color: "#A7ACAF", roughness: 0.4, metalness: 0.7 }),
    forro: mat({ color: "#F6F5F1", roughness: 0.96 }),
    telha: mat({ map: emMetros(texturaFibrocimento(509), 1.42), roughness: 0.85, relevo: 1.5, side: THREE.DoubleSide }),
    calha: mat({ color: "#9AA0A4", roughness: 0.38, metalness: 0.75 }),
    granito: mat({ map: emMetros(texturaPedra("#B8B3AA", "#8A857C", 510), 0.8), roughness: 0.3 }),
    calcada: mat({ map: emMetros(texturaCeramica("#B4AFA5", "#9A958B", 511, 4), 1.6), roughness: 0.9, relevo: 0.3 }),
    asfalto: mat({ map: emMetros(texturaAsfalto(512), 2), roughness: 0.97, relevo: 0.4 }),
    solo: mat({ map: emMetros(texturaRuido("#BFB49C", 513, 0.12), 2), roughness: 1 }),
    aluminio: mat({ color: "#3A3D41", roughness: 0.38, metalness: 0.6 }),
    madeiraPorta: base.porta,
    aco: mat({ color: "#2A2C2E", roughness: 0.5, metalness: 0.7 }),
    vidro: mat({ color: "#CFE3EA", roughness: 0.04, metalness: 0.15, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6 }),
    ferragem: base.cromado,
  };
  cache.set("padrao", m);
  return m;
}
