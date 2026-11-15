// Maquete 3D (EPIC-022, etapa 2) — a construção em 3D a partir do modelo validado: pisos, paredes recortadas
// pelas aberturas, esquadrias com vidro, portas, lajes com o furo da escada, escadas e cobertura.
// Convenção: X = x da planta, Z = y da planta, Y = altura (metros).
import { useMemo } from "react";
import * as THREE from "three";
import { comprimento, type Abertura, type Edificacao, type FuncaoComodo, type Parede, type Pavimento, type Ponto } from "@shared/maquete-3d/modelo";
import {
  ESPESSURA_LAJE, blocosDaParede, contornoDoPavimento, pavimentosOrdenados, pontoNaParede, telhado, vaosDaParede,
} from "@shared/maquete-3d/geometria3d";
import { eixoDaCaracol, trechosDaEscada } from "@shared/maquete-3d/escadas";
import type { Materiais, NomeMaterial } from "./materiais";

const MOLHADOS: FuncaoComodo[] = ["banheiro", "lavabo", "cozinha", "area_servico"];
const EXTERNOS: FuncaoComodo[] = ["varanda", "garagem", "area_gourmet", "area_externa"];
export const pisoDaFuncao = (f: FuncaoComodo): NomeMaterial => (MOLHADOS.includes(f) ? "pisoMolhado" : EXTERNOS.includes(f) ? "pisoExterno" : "pisoSeco");

/** Polígono horizontal em y, com furos, olhando para cima ou para baixo. UV em metros (a textura repete). */
export function geometriaPlana(pts: Ponto[], y: number, paraCima: boolean, furos: Ponto[][] = []): THREE.BufferGeometry {
  const v2 = (p: Ponto) => new THREE.Vector2(p.x, p.y);
  const horario = (l: THREE.Vector2[]) => THREE.ShapeUtils.isClockWise(l);
  const contorno = pts.map(v2), buracos = furos.map(f => f.map(v2));
  if (horario(contorno)) contorno.reverse();
  buracos.forEach(b => { if (!horario(b)) b.reverse(); });
  const faces = THREE.ShapeUtils.triangulateShape(contorno, buracos);
  const todos = [...contorno, ...buracos.flat()];
  const pos = new Float32Array(todos.length * 3), uv = new Float32Array(todos.length * 2), nor = new Float32Array(todos.length * 3);
  todos.forEach((p, i) => { pos.set([p.x, y, p.y], i * 3); uv.set([p.x, p.y], i * 2); nor.set([0, paraCima ? 1 : -1, 0], i * 3); });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  // No plano XZ o sentido anti-horário da planta fica voltado para baixo: inverte para olhar para cima.
  g.setIndex(faces.flatMap(f => (paraCima ? [f[0], f[2], f[1]] : f)));
  return g;
}

/** Posição e giro de uma caixa deitada sobre o trecho a→b da planta. */
function sobreTrecho(a: Ponto, b: Ponto) {
  return { x: (a.x + b.x) / 2, z: (a.y + b.y) / 2, giro: -Math.atan2(b.y - a.y, b.x - a.x), comp: Math.hypot(b.x - a.x, b.y - a.y) };
}

function ParedeCheia({ w, pv, m }: { w: Parede; pv: Pavimento; m: Materiais }) {
  const blocos = useMemo(() => {
    const c = comprimento(w);
    return blocosDaParede(w, pv.aberturas, pv.peDireito).map(b => {
      // Estica meia espessura nas pontas da parede para fechar os cantos.
      const noInicio = Math.hypot(b.a.x - w.a.x, b.a.y - w.a.y) < 0.01, noFim = Math.hypot(b.b.x - w.b.x, b.b.y - w.b.y) < 0.01;
      const ux = (w.b.x - w.a.x) / c, uy = (w.b.y - w.a.y) / c, e = w.espessura / 2;
      const a = noInicio ? { x: b.a.x - ux * e, y: b.a.y - uy * e } : b.a, bb = noFim ? { x: b.b.x + ux * e, y: b.b.y + uy * e } : b.b;
      return { ...sobreTrecho(a, bb), base: b.base, altura: b.altura };
    });
  }, [w, pv.aberturas, pv.peDireito]);
  return (
    <>
      {blocos.map((b, i) => (
        <mesh key={i} position={[b.x, b.base + b.altura / 2, b.z]} rotation={[0, b.giro, 0]} material={w.externa ? m.paredeExterna : m.parede} castShadow receiveShadow>
          <boxGeometry args={[b.comp, b.altura, w.espessura]} />
        </mesh>
      ))}
    </>
  );
}

function Esquadria({ w, a, m }: { w: Parede; a: Abertura; m: Materiais }) {
  const v = vaosDaParede(w, [a])[0];
  if (!v) return null;
  const t = sobreTrecho(pontoNaParede(w, v.de), pontoNaParede(w, v.ate));
  const larg = t.comp, alt = a.altura, perfil = 0.05, fundo = Math.min(0.09, w.espessura * 0.6);
  if (a.tipo === "vao") return null;
  const porta = a.tipo === "porta", folhas = Math.max(1, Math.round(larg / 0.75));
  return (
    <group position={[t.x, a.peitoril, t.z]} rotation={[0, t.giro, 0]}>
      {/* Marco: dois montantes e a travessa de cima (e a de baixo nas janelas). */}
      {[-1, 1].map(s => (
        <mesh key={s} position={[(s * (larg - perfil)) / 2, alt / 2, 0]} material={m.esquadria} castShadow>
          <boxGeometry args={[perfil, alt, w.espessura + 0.02]} />
        </mesh>
      ))}
      <mesh position={[0, alt - perfil / 2, 0]} material={m.esquadria} castShadow><boxGeometry args={[larg, perfil, w.espessura + 0.02]} /></mesh>
      {!porta && <mesh position={[0, perfil / 2, 0]} material={m.esquadria} castShadow><boxGeometry args={[larg, perfil, w.espessura + 0.04]} /></mesh>}
      {porta ? (
        // Folha aberta a 80°, presa no montante esquerdo.
        <group position={[-larg / 2 + perfil, 0, 0]} rotation={[0, -1.4, 0]}>
          <mesh position={[(larg - perfil * 2) / 2, (alt - perfil) / 2, 0]} material={m.porta} castShadow receiveShadow>
            <boxGeometry args={[larg - perfil * 2, alt - perfil, 0.04]} />
          </mesh>
          <mesh position={[larg - perfil * 2 - 0.09, 1.02, 0.045]} rotation={[0, 0, Math.PI / 2]} material={m.cromado}>
            <cylinderGeometry args={[0.012, 0.012, 0.13, 10]} />
          </mesh>
        </group>
      ) : (
        <>
          {/* Folhas com vidro: montante central e baguetes finas. */}
          <mesh position={[0, alt / 2, 0]} material={m.vidro}><boxGeometry args={[larg - perfil * 2, alt - perfil * 2, 0.012]} /></mesh>
          {Array.from({ length: folhas - 1 }, (_, i) => (
            <mesh key={i} position={[-larg / 2 + (larg / folhas) * (i + 1), alt / 2, 0]} material={m.esquadria}>
              <boxGeometry args={[0.035, alt - perfil * 2, fundo]} />
            </mesh>
          ))}
          {/* Peitoril de pedra nas janelas. */}
          {a.tipo === "janela" && <mesh position={[0, -0.015, 0]} material={m.pedra} castShadow><boxGeometry args={[larg + 0.08, 0.03, w.espessura + 0.1]} /></mesh>}
        </>
      )}
    </group>
  );
}

function EscadaSolida({ pv, e, m }: { pv: Pavimento; e: Edificacao; m: Materiais }) {
  // Cada escada vira lances de degraus e patamares, seguindo a forma real (reta, em L, em U, caracol, rampa).
  const pecas = useMemo(() => pv.escadas.flatMap(s => {
    const destino = e.pavimentos.find(p => p.id === s.destinoPavimentoId);
    if (!destino) return [];
    const subida = destino.nivel - pv.nivel, trechos = trechosDaEscada(s);
    const total = s.tipo === "rampa" ? 40 : s.degraus && s.degraus > 1 ? s.degraus : Math.max(2, Math.round(Math.abs(subida) / 0.175));
    const blocos: { chave: string; x: number; z: number; giro: number; comp: number; largura: number; topo: number; base: number }[] = [];
    const caracol = s.tipo === "caracol";
    trechos.forEach((t, i) => {
      const dx = t.b.x - t.a.x, dz = t.b.y - t.a.y, comp = Math.hypot(dx, dz) || 0.01, giro = -Math.atan2(dz, dx);
      if (t.patamar) {
        // Patamar: plataforma na altura em que o lance anterior terminou; cobre a quina inteira.
        blocos.push({ chave: `${s.id}-p${i}`, x: (t.a.x + t.b.x) / 2, z: (t.a.y + t.b.y) / 2, giro, comp: comp + s.largura / 2, largura: s.largura, topo: subida * t.de, base: 0 });
        return;
      }
      const n = Math.max(1, Math.round(total * (t.ate - t.de)));
      for (let k = 0; k < n; k++) {
        const f = (k + 0.5) / n, topo = subida * (t.de + ((t.ate - t.de) * (k + 1)) / n);
        // A caracol é vazada: cada degrau é uma laje apoiada no mastro. As outras são maciças até o piso.
        blocos.push({ chave: `${s.id}-${i}-${k}`, x: t.a.x + dx * f, z: t.a.y + dz * f, giro, comp: comp / n + 0.012, largura: s.largura, topo, base: caracol ? Math.max(0, topo - 0.06) : 0 });
      }
    });
    return [{ id: s.id, blocos, mastro: eixoDaCaracol(s), altura: Math.abs(subida) }];
  }), [pv, e]);
  return (
    <>
      {pecas.map(peca => (
        <group key={peca.id}>
          {peca.blocos.map(d => (
            <mesh key={d.chave} position={[d.x, (d.topo + d.base) / 2, d.z]} rotation={[0, d.giro, 0]} material={m.degrau} castShadow receiveShadow>
              <boxGeometry args={[d.comp, Math.max(0.03, d.topo - d.base), d.largura]} />
            </mesh>
          ))}
          {peca.mastro && (
            <mesh position={[peca.mastro.x, (peca.altura + 1) / 2, peca.mastro.y]} material={m.metal} castShadow>
              <cylinderGeometry args={[0.06, 0.06, peca.altura + 1, 14]} />
            </mesh>
          )}
        </group>
      ))}
    </>
  );
}

function Andar({ pv, e, m, comTeto }: { pv: Pavimento; e: Edificacao; m: Materiais; comTeto: boolean }) {
  const contorno = useMemo(() => contornoDoPavimento(pv), [pv]);
  const pisos = useMemo(() => pv.comodos.filter(c => c.poligono.length >= 3).map(c => ({ id: c.id, material: pisoDaFuncao(c.funcao), g: geometriaPlana(c.poligono, 0.004, true) })), [pv.comodos]);
  // A laje deste andar é furada onde chega a escada de baixo; o teto, onde parte a escada daqui para cima.
  const chegam = useMemo(() => e.pavimentos.flatMap(p => p.escadas.filter(s => s.destinoPavimentoId === pv.id && s.poligono.length >= 3).map(s => s.poligono)), [e, pv.id]);
  const sobem = useMemo(() => pv.escadas.filter(s => s.poligono.length >= 3).map(s => s.poligono), [pv.escadas]);
  const base = useMemo(() => (contorno.length >= 3 ? geometriaPlana(contorno, 0, true, chegam) : null), [contorno, chegam]);
  const teto = useMemo(() => (contorno.length >= 3 ? geometriaPlana(contorno, pv.peDireito, false, sobem) : null), [contorno, pv.peDireito, sobem]);
  const cima = useMemo(() => (contorno.length >= 3 ? geometriaPlana(contorno, pv.peDireito + ESPESSURA_LAJE, true, sobem) : null), [contorno, pv.peDireito, sobem]);
  return (
    <>
      {base && <mesh geometry={base} material={m.laje} receiveShadow />}
      {pisos.map(p => <mesh key={p.id} geometry={p.g} material={m[p.material]} receiveShadow />)}
      {pv.paredes.map(w => <ParedeCheia key={w.id} w={w} pv={pv} m={m} />)}
      {pv.aberturas.map(a => { const w = pv.paredes.find(x => x.id === a.paredeId); return w ? <Esquadria key={a.id} w={w} a={a} m={m} /> : null; })}
      <EscadaSolida pv={pv} e={e} m={m} />
      {comTeto && teto && <mesh geometry={teto} material={m.teto} receiveShadow />}
      {comTeto && cima && <mesh geometry={cima} material={m.laje} castShadow />}
    </>
  );
}

function Cobertura({ e, m }: { e: Edificacao; m: Materiais }) {
  const g = useMemo(() => {
    const t = telhado(e);
    if (!t) return null;
    const pos = new Float32Array(t.triangulos), uv = new Float32Array((pos.length / 3) * 2);
    for (let i = 0; i < pos.length / 3; i++) uv.set([pos[i * 3] + pos[i * 3 + 2] * 0.0001, pos[i * 3 + 2] + pos[i * 3 + 1]], i * 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    return { geo, plano: t.plano };
  }, [e]);
  if (!g) return null;
  return <mesh geometry={g.geo} material={g.plano ? m.laje : m.telha} castShadow receiveShadow />;
}

export type PropsCasa = {
  edificacao: Edificacao; m: Materiais; mostrarTelhado: boolean;
  /** Corte para a vista de cima: esconde os andares acima deste nível e o teto dele. `null` mostra tudo. */
  corteAte: number | null;
};

/** A edificação inteira: andares empilhados (pavimento-tipo repetido), cobertura e o entorno imediato. */
export function Casa({ edificacao: e, m, mostrarTelhado, corteAte }: PropsCasa) {
  const andares = useMemo(() => pavimentosOrdenados(e).flatMap(pv =>
    Array.from({ length: pv.repeticoes }, (_, k) => ({ pv, chave: `${pv.id}-${k}`, y: pv.nivel + k * (pv.peDireito + ESPESSURA_LAJE) }))), [e]);
  const visiveis = corteAte === null ? andares : andares.filter(a => a.y <= corteAte + 0.01);
  const topo = visiveis.at(-1);
  return (
    <group>
      {visiveis.map(a => (
        <group key={a.chave} position={[0, a.y, 0]}>
          <Andar pv={a.pv} e={e} m={m} comTeto={corteAte === null ? mostrarTelhado || a !== topo : a !== topo} />
        </group>
      ))}
      {mostrarTelhado && corteAte === null && <Cobertura e={e} m={m} />}
    </group>
  );
}

/** Terreno em volta: gramado e uma calçada sob a projeção da casa. */
export function Entorno({ edificacao: e, m }: { edificacao: Edificacao; m: Materiais }) {
  const { grama, calcada } = useMemo(() => {
    const terreo = pavimentosOrdenados(e)[0];
    const c = terreo ? contornoDoPavimento(terreo) : [];
    const xs = c.map(p => p.x), ys = c.map(p => p.y);
    const x0 = Math.min(0, ...xs), x1 = Math.max(1, ...xs), y0 = Math.min(0, ...ys), y1 = Math.max(1, ...ys);
    const ret = (f: number, y: number) => geometriaPlana([{ x: x0 - f, y: y0 - f }, { x: x1 + f, y: y0 - f }, { x: x1 + f, y: y1 + f }, { x: x0 - f, y: y1 + f }], y, true);
    return { grama: ret(400, -0.06), calcada: ret(1.2, -0.02) };
  }, [e]);
  return (
    <>
      <mesh geometry={grama} material={m.grama} receiveShadow />
      <mesh geometry={calcada} material={m.calcada} receiveShadow />
    </>
  );
}
