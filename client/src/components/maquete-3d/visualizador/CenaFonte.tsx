// Maquete 3D (EPIC-028, Etapa 2) — a cena do JSON-fonte em react-three-fiber. Tudo vem de `cenaDaFonte` (puro,
// testado em shared/maquete-3d/fonte-cena.ts): aqui só se transforma número em malha. Paredes, muros, platibanda,
// calhas, forro e soleiras viram poucas geometrias mescladas (uma chamada de desenho por material); pisos são
// extrusões dos polígonos dos ambientes; móveis vêm do catálogo procedural (moveis/).
import { memo, useEffect, useMemo, type ReactNode, type RefObject } from "react";
import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { BlocoCena, CaixaCena, CenaFonte, EsquadriaCena, PecaFonte } from "@shared/maquete-3d/fonte-cena";
import { ESPESSURA_FORRO } from "@shared/maquete-3d/fonte-cena";
import { materiaisDaFonte, type MateriaisFonte } from "./materiais-fonte";
import { CATALOGO } from "./moveis";
import type { Materiais } from "./materiais";
import { materiaisDoItem } from "./materiais-itens";

// ── Geometria mesclada de caixas (coordenadas de textura em metros) ──

type Caixa = { cx: number; cz: number; comp: number; esp: number; ang: number; y0: number; y1: number };
const deCaixaCena = (c: CaixaCena): Caixa => ({ cx: (c.x0 + c.x1) / 2, cz: (c.z0 + c.z1) / 2, comp: c.x1 - c.x0, esp: c.z1 - c.z0, ang: 0, y0: c.y0, y1: c.y1 });

/** Caixas orientadas numa só BufferGeometry. `faces`: os quatro lados, só o topo, ou tudo. A base só com `comBase`
 *  (o que fica no chão não precisa dela; o forro e as calhas, vistos de baixo, precisam). */
function geometriaDeCaixas(lista: Caixa[], faces: "lados" | "topo" | "tudo", comBase = false): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const face = (c: THREE.Vector3[], n: THREE.Vector3, uvDe: (p: THREE.Vector3) => [number, number]) => {
    const b = pos.length / 3;
    const ab = c[1].clone().sub(c[0]), ac = c[2].clone().sub(c[0]);
    const inverte = ab.cross(ac).dot(n) < 0;
    for (const p of c) { pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); uv.push(...uvDe(p)); }
    if (inverte) idx.push(b, b + 2, b + 1, b, b + 3, b + 2); else idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  for (const k of lista) {
    const ex = new THREE.Vector3(Math.cos(k.ang), 0, -Math.sin(k.ang)), ez = new THREE.Vector3(Math.sin(k.ang), 0, Math.cos(k.ang));
    const centro = new THREE.Vector3(k.cx, 0, k.cz), hx = k.comp / 2, hz = k.esp / 2;
    const P = (sx: number, y: number, sz: number) => centro.clone().addScaledVector(ex, sx * hx).addScaledVector(ez, sz * hz).setY(y);
    const ao = (eixo: THREE.Vector3) => (p: THREE.Vector3): [number, number] => [p.x * eixo.x + p.z * eixo.z, p.y];
    if (faces !== "topo") {
      face([P(-1, k.y0, 1), P(1, k.y0, 1), P(1, k.y1, 1), P(-1, k.y1, 1)], ez, ao(ex));
      face([P(1, k.y0, -1), P(-1, k.y0, -1), P(-1, k.y1, -1), P(1, k.y1, -1)], ez.clone().negate(), ao(ex));
      face([P(1, k.y0, 1), P(1, k.y0, -1), P(1, k.y1, -1), P(1, k.y1, 1)], ex, ao(ez));
      face([P(-1, k.y0, -1), P(-1, k.y0, 1), P(-1, k.y1, 1), P(-1, k.y1, -1)], ex.clone().negate(), ao(ez));
    }
    if (faces !== "lados") face([P(-1, k.y1, 1), P(1, k.y1, 1), P(1, k.y1, -1), P(-1, k.y1, -1)], new THREE.Vector3(0, 1, 0), p => [p.x, -p.z]);
    if (comBase) face([P(-1, k.y0, -1), P(1, k.y0, -1), P(1, k.y0, 1), P(-1, k.y0, 1)], new THREE.Vector3(0, -1, 0), p => [p.x, p.z]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function Malha({ geo, material, sombra = true }: { geo: THREE.BufferGeometry; material: THREE.Material; sombra?: boolean }) {
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} material={material} castShadow={sombra} receiveShadow />;
}

// ── Ambiente de reflexos (RoomEnvironment do three, montado localmente, sem HDR de CDN) ──

export function AmbienteSala({ intensidade = 0.55 }: { intensidade?: number }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const sala = new RoomEnvironment();
    const env = pm.fromScene(sala, 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = intensidade;
    return () => { scene.environment = null; env.dispose(); pm.dispose(); sala.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } }); };
  }, [gl, scene, intensidade]);
  return null;
}

// ── Pisos ──

function Piso({ poligono, y0, y1, material }: { poligono: [number, number][]; y0: number; y1: number; material: THREE.Material }) {
  const geo = useMemo(() => {
    const forma = new THREE.Shape(poligono.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(forma, { depth: Math.max(0.005, y1 - y0), bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, y0, 0);
    return g;
  }, [poligono, y0, y1]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} material={material} receiveShadow />;
}

// ── Esquadrias ──

type V3 = [number, number, number];
function Caixote({ s, p, m, r, sombra = true }: { s: V3; p: V3; m: THREE.Material; r?: V3; sombra?: boolean }) {
  return <mesh position={p} rotation={r} material={m} castShadow={sombra} receiveShadow><boxGeometry args={s} /></mesh>;
}

/** Marco (requadro) do vão: quatro perfis. */
function Marco({ larg, alt, prof, perfil, m, comBase = true }: { larg: number; alt: number; prof: number; perfil: number; m: THREE.Material; comBase?: boolean }) {
  return (
    <>
      <Caixote s={[perfil, alt, prof]} p={[-larg / 2 + perfil / 2, alt / 2, 0]} m={m} />
      <Caixote s={[perfil, alt, prof]} p={[larg / 2 - perfil / 2, alt / 2, 0]} m={m} />
      <Caixote s={[larg, perfil, prof]} p={[0, alt - perfil / 2, 0]} m={m} />
      {comBase && <Caixote s={[larg, perfil, prof]} p={[0, perfil / 2, 0]} m={m} />}
    </>
  );
}

/** Folha com vidro: quadro de perfil e o vidro no meio. */
function FolhaVidro({ w, h, x, z, perfil, m }: { w: number; h: number; x: number; z: number; perfil: number; m: MateriaisFonte }) {
  const e = 0.03;
  return (
    <group position={[x, 0, z]}>
      <Caixote s={[perfil, h, e]} p={[-w / 2 + perfil / 2, h / 2, 0]} m={m.aluminio} />
      <Caixote s={[perfil, h, e]} p={[w / 2 - perfil / 2, h / 2, 0]} m={m.aluminio} />
      <Caixote s={[w, perfil, e]} p={[0, h - perfil / 2, 0]} m={m.aluminio} />
      <Caixote s={[w, perfil * 1.4, e]} p={[0, (perfil * 1.4) / 2, 0]} m={m.aluminio} />
      <Caixote s={[w - perfil * 2, h - perfil * 2.4, 0.006]} p={[0, perfil * 1.4 + (h - perfil * 2.4) / 2, 0]} m={m.vidro} sombra={false} />
    </group>
  );
}

function Esquadria({ e, m }: { e: EsquadriaCena; m: MateriaisFonte }) {
  const { larg: L, alt: A, esp } = e;
  let corpo: React.ReactNode = null;
  if (e.modelo === "janela_correr" || e.modelo === "porta_correr") {
    const n = e.folhas, perfil = e.modelo === "janela_correr" ? 0.035 : 0.05, marco = 0.035, vao = L - marco * 2;
    const passo = vao / n, sobra = 0.03;
    corpo = (
      <>
        <Marco larg={L} alt={A} prof={0.07} perfil={marco} m={m.aluminio} />
        {Array.from({ length: n }, (_, k) => {
          // Duas folhas das pontas no trilho de fora, as do meio no de dentro (correr de 4 folhas); com 2, uma em cada.
          // Com folha fixa declarada (2 folhas): a fixa no trilho de fora; a que corre no de dentro, com o puxador.
          const lado = k < n / 2 ? -1 : 1;
          const fora = e.fixa && n === 2 ? lado === e.fixa : n >= 4 ? k === 0 || k === n - 1 : k % 2 === 0;
          const corre = !!e.fixa && n === 2 && lado !== e.fixa;
          const w = passo + (k > 0 ? sobra / 2 : 0) + (k < n - 1 ? sobra / 2 : 0);
          const x = -vao / 2 + passo * (k + 0.5) + (k > 0 ? -sobra / 4 : 0) + (k < n - 1 ? sobra / 4 : 0);
          const z = fora ? -0.016 : 0.016;
          return (
            <group key={k} position={[0, marco, 0]}>
              <FolhaVidro w={w} h={A - marco * 2} x={x} z={z} perfil={perfil} m={m} />
              {corre && [-1, 1].map(f => (
                <Caixote key={f} s={[0.022, 0.6, 0.022]} p={[x + lado * (w / 2 - perfil - 0.04), 1.05, z + f * 0.03]} m={m.ferragem} />
              ))}
            </group>
          );
        })}
      </>
    );
  } else if (e.modelo === "abrir") {
    const d = e.dobradica ?? -1, g = e.giro ?? 1, ef = 0.035, W = L - 0.02, H = A - 0.01;
    const giro = g * d * (Math.PI / 2);
    corpo = (
      <>
        {/* Batente de madeira na espessura da parede e a folha aberta a 90° para o lado do giro. */}
        <Marco larg={L} alt={A} prof={esp + 0.01} perfil={0.03} m={m.madeiraPorta} comBase={false} />
        <group position={[d * (L / 2 - 0.03), 0.005, g * (esp / 2 - 0.02)]} rotation={[0, giro, 0]}>
          <Caixote s={[W - 0.03, H, ef]} p={[-d * (W - 0.03) / 2, H / 2, g * ef / 2]} m={m.madeiraPorta} />
          {[-1, 1].map(lado => (
            <group key={lado} position={[-d * (W - 0.1), 1.02, g * ef / 2 + lado * (ef / 2 + 0.03)]}>
              <mesh material={m.ferragem} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.009, 0.009, 0.06, 10]} /></mesh>
              <mesh material={m.ferragem} position={[d * 0.05, 0, lado * 0.03]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.009, 0.009, 0.11, 10]} /></mesh>
            </group>
          ))}
        </group>
      </>
    );
  } else if (e.modelo === "pivotante") {
    const W = L - 0.04, H = A - 0.02, ef = 0.045;
    corpo = (
      <>
        <Marco larg={L} alt={A} prof={esp + 0.01} perfil={0.02} m={m.madeiraPorta} comBase={false} />
        <Caixote s={[W, H, ef]} p={[0, 0.01 + H / 2, 0]} m={m.madeiraPorta} />
        {[0.55, 1.1, 1.65, 2.2].filter(y => y < H - 0.1).map(y => (
          [-1, 1].map(lado => <Caixote key={`${y}${lado}`} s={[W - 0.12, 0.006, 0.004]} p={[0, y, lado * (ef / 2 + 0.001)]} m={m.aco} sombra={false} />)
        ))}
        {[-1, 1].map(lado => <Caixote key={lado} s={[0.025, 1.2, 0.025]} p={[(e.dobradica ?? 1) * -(W / 2 - 0.12), 1.05, lado * (ef / 2 + 0.035)]} m={m.ferragem} />)}
      </>
    );
  } else if (e.modelo === "portao_correr") {
    // Portão de correr: folha única de aço (chapa embaixo, gradil simples em cima) sobre o trilho no chão, com as
    // roldanas e a guia no alto. Desenhado fechado, no vão.
    const n = Math.max(2, Math.floor((L - 0.1) / 0.15)), chapa = Math.min(1.0, A * 0.42), H = A - 0.03;
    corpo = (
      <>
        <Caixote s={[L + 0.3, 0.025, 0.05]} p={[0, 0.0125, 0]} m={m.aco} />
        {[-1, 1].map(l => (
          <mesh key={l} material={m.ferragem} position={[l * (L / 2 - 0.3), 0.06, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.04, 0.04, 0.03, 14]} /></mesh>
        ))}
        <group position={[0, 0.06, 0]}>
          <Marco larg={L} alt={H - 0.06} prof={0.05} perfil={0.05} m={m.aco} />
          <Caixote s={[L - 0.1, chapa - 0.05, 0.012]} p={[0, 0.05 + (chapa - 0.05) / 2, 0]} m={m.aco} />
          <Caixote s={[L - 0.1, 0.04, 0.04]} p={[0, chapa, 0]} m={m.aco} />
          {Array.from({ length: n }, (_, k) => (
            <Caixote key={k} s={[0.02, H - 0.06 - chapa - 0.05, 0.02]} p={[-L / 2 + 0.05 + ((L - 0.1) * (k + 0.5)) / n, chapa + (H - 0.06 - chapa - 0.05) / 2, 0]} m={m.aco} />
          ))}
        </group>
        <Caixote s={[L + 0.3, 0.04, 0.08]} p={[0, A - 0.02, 0]} m={m.aco} />
      </>
    );
  } else {
    // Portão gradeado: quadro de aço, travessa no meio e barras verticais a cada 12 cm (como o protótipo).
    const n = Math.max(2, Math.floor((L - 0.1) / 0.12));
    corpo = (
      <>
        <Marco larg={L} alt={A} prof={0.06} perfil={0.05} m={m.aco} />
        <Caixote s={[L - 0.1, 0.04, 0.04]} p={[0, A * 0.5, 0]} m={m.aco} />
        {Array.from({ length: n }, (_, k) => (
          <Caixote key={k} s={[0.022, A - 0.1, 0.022]} p={[-L / 2 + 0.05 + ((L - 0.1) * (k + 0.5)) / n, A / 2, 0]} m={m.aco} />
        ))}
      </>
    );
  }
  return <group position={[e.cx, e.y0, e.cz]} rotation={[0, e.ang, 0]}>{corpo}</group>;
}

// ── Itens (móveis do JSON), cada um com a cor e o material dele ──

/** Um item do JSON: o desenho do catálogo com a cor do item. `userData.itemId` deixa o editor achar o item tocado. */
const ItemDesenhado = memo(function ItemDesenhado({ p, base, aprimorado }: { p: PecaFonte; base: Materiais; aprimorado: boolean }) {
  const Desenho = CATALOGO[p.tipo];
  const m = materiaisDoItem(base, p.material, p.cor);
  // O carro escolhe a pintura pela opção `cor`: a cor do item vale quando a opção não diz outra.
  const peca = useMemo(() => (p.tipo === "carro" && p.material === "pintura" && p.cor && p.opcoes.cor === undefined ? { ...p, opcoes: { ...p.opcoes, cor: p.cor } } : p), [p]);
  if (!Desenho) return null;
  return (
    <group position={[p.x, p.y + p.elevacao, p.z]} rotation={[0, p.rot, 0]} userData={{ itemId: p.id }}>
      <Desenho peca={peca} m={m} estilo="moderno" aprimorado={aprimorado} />
    </group>
  );
});

// ── Cena ──

export type OpcoesCena = { sombras: boolean; mapaSombra: number; aprimorado: boolean };

export function CenaFonte({ cena, pecas, telhado, corte, rotulos, opcoes, grupoItens, children }: {
  cena: CenaFonte; pecas: PecaFonte[];
  /** Grupo dos itens (o editor procura neles o item tocado; a estrutura fica fora e não é selecionável). */
  grupoItens?: RefObject<THREE.Group | null>;
  /** Camadas a mais dentro da cena (contorno do item selecionado, no editor). */
  children?: ReactNode;
  /** Forro, platibanda, telhas e calhas. */
  telhado: boolean;
  /** Visão geral em corte: topo das paredes da casa pintado de cinza escuro. */
  corte: boolean;
  rotulos: boolean;
  opcoes: OpcoesCena;
}) {
  const m = useMemo(() => materiaisDaFonte(), []);
  const casa = useMemo(() => cena.blocos.filter(b => !b.muro), [cena]);
  const muros = useMemo(() => cena.blocos.filter(b => b.muro), [cena]);
  const g = useMemo(() => ({
    casaLados: geometriaDeCaixas(casa, "lados"),
    casaTopoCorte: geometriaDeCaixas(casa.filter(b => b.topoCortado), "topo"),
    casaTopoResto: geometriaDeCaixas(casa.filter(b => !b.topoCortado), "topo"),
    muros: geometriaDeCaixas(muros, "tudo"),
    granito: geometriaDeCaixas([...cena.soleiras, ...cena.pingadeiras] as BlocoCena[], "tudo", true),
    platibanda: geometriaDeCaixas(cena.cobertura.platibanda.map(deCaixaCena), "tudo"),
    rufo: geometriaDeCaixas(cena.cobertura.platibanda.map(c => ({ ...deCaixaCena(c), comp: c.x1 - c.x0 + 0.03, esp: c.z1 - c.z0 + 0.03, y0: c.y1, y1: c.y1 + 0.02 })), "tudo", true),
    calhas: geometriaDeCaixas(cena.cobertura.calhas.map(deCaixaCena), "tudo", true),
    forro: geometriaDeCaixas(cena.cobertura.forro.map(([x0, z0, x1, z1]) => ({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, comp: x1 - x0, esp: z1 - z0, ang: 0, y0: cena.cobertura.yForro, y1: cena.cobertura.yForro + ESPESSURA_FORRO })), "tudo", true),
    telhas: (() => {
      const t = new THREE.BufferGeometry();
      t.setAttribute("position", new THREE.Float32BufferAttribute(cena.cobertura.telhas.posicoes, 3));
      t.setAttribute("uv", new THREE.Float32BufferAttribute(cena.cobertura.telhas.uvs, 2));
      t.computeVertexNormals();
      return t;
    })(),
    entorno: {
      solo: geometriaDeCaixas([deCaixaCena(cena.entorno.solo)], "topo"),
      calcada: geometriaDeCaixas([deCaixaCena(cena.entorno.calcada)], "tudo"),
      rua: geometriaDeCaixas([deCaixaCena(cena.entorno.rua)], "topo"),
    },
  }), [cena, casa, muros]);
  const sol = useMemo(() => {
    const c = cena.casa, centro = new THREE.Vector3((c.x0 + c.x1) / 2, 0, (cena.entorno.lote.z0 + cena.entorno.lote.z1) / 2);
    const alcance = Math.max(c.x1 - c.x0, cena.entorno.lote.z1 - cena.entorno.lote.z0) / 2 + 3;
    return { centro, alcance, pos: centro.clone().add(new THREE.Vector3(-14, 22, 8)) };
  }, [cena]);
  const alvoSol = useMemo(() => { const o = new THREE.Object3D(); o.position.copy(sol.centro); return o; }, [sol]);

  return (
    <>
      <color attach="background" args={["#E3E8EC"]} />
      <fog attach="fog" args={["#E3E8EC", 45, 140]} />
      <AmbienteSala intensidade={0.5} />
      <hemisphereLight args={["#E4EEF7", "#8C8070", 0.45]} />
      <primitive object={alvoSol} />
      <directionalLight
        position={sol.pos} target={alvoSol} color="#FFF1DC" intensity={2.4} castShadow={opcoes.sombras}
        shadow-mapSize={[opcoes.mapaSombra, opcoes.mapaSombra]} shadow-radius={4} shadow-bias={-0.0003} shadow-normalBias={0.025}
        shadow-camera-left={-sol.alcance} shadow-camera-right={sol.alcance} shadow-camera-top={sol.alcance} shadow-camera-bottom={-sol.alcance}
        shadow-camera-near={1} shadow-camera-far={90}
      />
      {/* Uma luz por cômodo, logo abaixo do forro: luz quente e contida (não estoura o branco). */}
      {cena.luzes.map(l => <pointLight key={l.ambiente} position={[l.x, l.y, l.z]} color="#FFE6C4" intensity={2.2} distance={5.5} decay={2} />)}

      <Malha geo={g.entorno.solo} material={m.solo} sombra={false} />
      <Malha geo={g.entorno.calcada} material={m.calcada} sombra={false} />
      <Malha geo={g.entorno.rua} material={m.asfalto} sombra={false} />
      {cena.pisos.map((p, k) => <Piso key={`${p.nome}-${k}`} poligono={p.poligono} y0={p.y0} y1={p.y1} material={m.pisos[p.acabamento]} />)}

      <Malha geo={g.casaLados} material={m.parede} />
      <Malha geo={g.casaTopoCorte} material={corte && !telhado ? m.corte : m.parede} />
      <Malha geo={g.casaTopoResto} material={m.parede} />
      <Malha geo={g.muros} material={m.muro} />
      <Malha geo={g.granito} material={m.granito} />
      {cena.esquadrias.map(e => <Esquadria key={e.id} e={e} m={m} />)}

      <group ref={grupoItens}>
        {pecas.map(p => <ItemDesenhado key={p.id} p={p} base={m.base} aprimorado={opcoes.aprimorado} />)}
      </group>
      {children}

      <group visible={telhado}>
        <Malha geo={g.forro} material={m.forro} />
        <Malha geo={g.platibanda} material={m.platibanda} />
        <Malha geo={g.rufo} material={m.rufo} />
        <Malha geo={g.calhas} material={m.calha} />
        <Malha geo={g.telhas} material={m.telha} />
      </group>

      {rotulos && cena.rotulos.map(r => (
        <Html key={r.ambiente} position={[r.x, r.y, r.z]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <span className="whitespace-nowrap rounded-[3px] bg-white/90 px-2 py-0.5 text-[13px] font-medium text-[#111] shadow-sm">{r.texto}</span>
        </Html>
      ))}
    </>
  );
}
