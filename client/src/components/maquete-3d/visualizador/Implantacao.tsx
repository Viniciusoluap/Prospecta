// Maquete 3D (EPIC-022, etapa 4) — implantação do empreendimento: terreno, ruas, lotes coloridos pela situação
// de venda da unidade e as construções posicionadas. A geometria vem do estudo de Incorporação (ou da prancha
// de implantação lida do PDF); a situação vem do inventário de unidades. Clicar num lote mostra os dados dele.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { alturaDoRelevo, areaPoligono, type Edificacao, type Implantacao as DadosImplantacao, type Ponto } from "@shared/maquete-3d/modelo";
import { contornoDoPavimento, dentroDoPoligono, pavimentosOrdenados, telhado, topoDaEdificacao } from "@shared/maquete-3d/geometria3d";
import { limites } from "@shared/maquete-3d/modelo";
import { Casa } from "./Casa";
import type { Materiais } from "./materiais";

export type UnidadeVenda = { codigo: string; status: string };
export type SituacaoLote = "disponivel" | "reservada" | "vendida" | "sem_cadastro" | "area_publica" | "nao_parcelavel";
export const SITUACOES: Record<SituacaoLote, { rotulo: string; cor: string }> = {
  disponivel: { rotulo: "Disponível", cor: "#3FA35B" },
  reservada: { rotulo: "Reservado", cor: "#E0A526" },
  vendida: { rotulo: "Vendido", cor: "#C2493D" },
  sem_cadastro: { rotulo: "Lote", cor: "#8DB596" },
  area_publica: { rotulo: "Área pública", cor: "#5B8FB9" },
  nao_parcelavel: { rotulo: "Área não parcelável", cor: "#8A8F98" },
};
export type LoteNaCena = { id: string; rotulo: string; area: number; situacao: SituacaoLote; unidade: string | null };

/** Mesma normalização do inventário comercial (shared/incorporacao/unidades.ts). */
const chave = (codigo: string) => codigo.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR");

export function lotesDaCena(imp: DadosImplantacao, unidades: UnidadeVenda[]): LoteNaCena[] {
  const status = new Map(unidades.map(u => [chave(u.codigo), u.status]));
  return imp.lotes.map(l => {
    const s = l.unidade ? status.get(chave(l.unidade)) : undefined;
    const situacao: SituacaoLote = l.tipo !== "vendavel" ? l.tipo : s === "disponivel" || s === "reservada" || s === "vendida" ? s : "sem_cadastro";
    return { id: l.id, rotulo: [l.quadra && `Quadra ${l.quadra}`, l.nome && `Lote ${l.nome}`].filter(Boolean).join(" · ") || l.id, area: l.areaInformada ?? Math.round(areaPoligono(l.poligono) * 100) / 100, situacao, unidade: l.unidade };
  });
}

export function limitesDaImplantacao(imp: DadosImplantacao) {
  const pts: Ponto[] = [...imp.terreno, ...imp.lotes.flatMap(l => l.poligono), ...imp.ruas.flat(), ...imp.posicoes.map(p => ({ x: p.x, y: p.y }))];
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { x0: Math.min(0, ...xs), x1: Math.max(1, ...xs), z0: Math.min(0, ...ys), z1: Math.max(1, ...ys) };
}

// Cada construção detalhada é uma casa inteira (paredes, esquadrias e mobília): só as mais próximas da câmera
// entram com detalhe. Todas as outras aparecem como volume com telhado, desenhadas de uma vez (instâncias),
// para o empreendimento inteiro caber no celular (EPIC-023, S-C).
const MAX_DETALHADAS = 12;
const DISTANCIA_DETALHE = 85; // metros da câmera

/** Volume simples da edificação (paredes e cobertura), no referencial dela, com cor por vértice. */
function geometriaDoVolume(e: Edificacao): THREE.BufferGeometry | null {
  const pavs = pavimentosOrdenados(e);
  if (!pavs.length) return null;
  const l = limites(pavs.flatMap(pv => contornoDoPavimento(pv)));
  if (l.largura < 0.5 || l.altura < 0.5) return null;
  const topo = topoDaEdificacao(e), pos: number[] = [], cor: number[] = [];
  const parede = new THREE.Color("#E9E2D3"), faixa = new THREE.Color("#B9C4CC"), cobertura = new THREE.Color("#9C4F3A"), lajeCor = new THREE.Color("#C9C6BF");
  const tri = (c: THREE.Color, ...v: number[]) => { pos.push(...v); for (let i = 0; i < v.length / 3; i++) cor.push(c.r, c.g, c.b); };
  const quad = (c: THREE.Color, a: number[], b: number[], d: number[], f: number[]) => tri(c, ...a, ...b, ...d, ...a, ...d, ...f);
  const cantos: [number, number][] = [[l.minX, l.minY], [l.maxX, l.minY], [l.maxX, l.maxY], [l.minX, l.maxY]];
  // Paredes em faixas por andar: uma fita de "janelas" em cada pavimento dá a leitura de casa ou de prédio de longe.
  const andares: [number, number][] = [];
  for (const pv of pavs) for (let k = 0; k < pv.repeticoes; k++) { const base = pv.nivel + k * (pv.peDireito + 0.15); andares.push([base, base + pv.peDireito + 0.15]); }
  cantos.forEach(([x0, z0], i) => {
    const [x1, z1] = cantos[(i + 1) % 4];
    for (const [y0, y1] of andares) {
      const a = y0 + (y1 - y0) * 0.38, b = y0 + (y1 - y0) * 0.78;
      quad(parede, [x0, y0, z0], [x0, a, z0], [x1, a, z1], [x1, y0, z1]);
      quad(faixa, [x0, a, z0], [x0, b, z0], [x1, b, z1], [x1, a, z1]);
      quad(parede, [x0, b, z0], [x0, y1, z0], [x1, y1, z1], [x1, b, z1]);
    }
  });
  const t = telhado(e);
  if (t && !t.plano) tri(cobertura, ...t.triangulos);
  else quad(lajeCor, [l.minX, topo, l.minY], [l.minX, topo, l.maxY], [l.maxX, topo, l.maxY], [l.maxX, topo, l.minY]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(cor), 3));
  g.computeVertexNormals();
  return g;
}

type Construcao = { p: DadosImplantacao["posicoes"][number]; e: Edificacao };

/** Todas as construções de uma mesma edificação que não estão detalhadas, numa única chamada de desenho. */
function Volumes({ edificacao, itens, relevo }: { edificacao: Edificacao; itens: Construcao[]; relevo: DadosImplantacao["relevo"] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometria = useMemo(() => geometriaDoVolume(edificacao), [edificacao]);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), []);
  useEffect(() => () => { geometria?.dispose(); }, [geometria]);
  useEffect(() => () => { material.dispose(); }, [material]);
  useLayoutEffect(() => {
    const malha = ref.current;
    if (!malha) return;
    const o = new THREE.Object3D();
    itens.forEach(({ p }, i) => {
      o.position.set(p.x, alturaDoRelevo(relevo, p.x, p.y) + 0.02, p.y);
      o.rotation.set(0, -THREE.MathUtils.degToRad(p.rotacao), 0);
      o.updateMatrix();
      malha.setMatrixAt(i, o.matrix);
    });
    malha.count = itens.length;
    malha.instanceMatrix.needsUpdate = true;
    malha.computeBoundingSphere();
  }, [itens, relevo]);
  if (!geometria || !itens.length) return null;
  // A chave força uma malha nova quando a quantidade cresce (a capacidade de instâncias é fixa).
  return <instancedMesh key={itens.length} ref={ref} args={[geometria, material, itens.length]} castShadow receiveShadow />;
}
const LADO_MALHA = 96;      // divisões da malha do terreno por lado
const LADO_MAPA = 2048;     // pixels do mapa pintado sobre o terreno

/** Caixa da malha: o conjunto com folga (ou a própria grade do relevo, quando há). */
function caixaDoTerreno(imp: DadosImplantacao) {
  if (imp.relevo) {
    const r = imp.relevo;
    return { x0: r.x0, z0: r.y0, largura: r.dx * (r.colunas - 1), comprimento: r.dy * (r.linhas - 1) };
  }
  const l = limitesDaImplantacao(imp), folga = Math.max(6, Math.max(l.x1 - l.x0, l.z1 - l.z0) * 0.06);
  return { x0: l.x0 - folga, z0: l.z0 - folga, largura: l.x1 - l.x0 + folga * 2, comprimento: l.z1 - l.z0 + folga * 2 };
}

/**
 * Implantação como um terreno só: uma malha que acompanha a topografia do estudo, com o mapa (divisa, ruas e
 * lotes coloridos pela situação) pintado por cima. Assim nada "flutua" nem pisca, em qualquer relevo.
 */
export function Implantacao({ implantacao: imp, edificacoes, unidades, m, selecionado, onSelecionar }: {
  implantacao: DadosImplantacao; edificacoes: Edificacao[]; unidades: UnidadeVenda[]; m: Materiais;
  selecionado: string | null; onSelecionar: (l: LoteNaCena | null) => void;
}) {
  const lotes = useMemo(() => lotesDaCena(imp, unidades), [imp, unidades]);
  const caixa = useMemo(() => caixaDoTerreno(imp), [imp]);

  const malha = useMemo(() => {
    const n = LADO_MALHA, pos = new Float32Array((n + 1) * (n + 1) * 3), uv = new Float32Array((n + 1) * (n + 1) * 2), idx: number[] = [];
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const x = caixa.x0 + (caixa.largura * i) / n, z = caixa.z0 + (caixa.comprimento * j) / n, k = j * (n + 1) + i;
      pos.set([x, alturaDoRelevo(imp.relevo, x, z), z], k * 3);
      uv.set([i / n, 1 - j / n], k * 2);
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, [imp.relevo, caixa]);

  // Mapa pintado: grama em volta, terra dentro da divisa, asfalto nas ruas, lotes pela situação, divisas em branco.
  const mapa = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = LADO_MAPA;
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return { canvas, textura: t, material: new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }) };
  }, []);
  useEffect(() => {
    const c = mapa.canvas.getContext("2d")!, ex = LADO_MAPA / caixa.largura, ez = LADO_MAPA / caixa.comprimento;
    const tracar = (pts: Ponto[]) => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo((p.x - caixa.x0) * ex, (p.y - caixa.z0) * ez) : c.moveTo((p.x - caixa.x0) * ex, (p.y - caixa.z0) * ez))); c.closePath(); };
    c.fillStyle = "#5E8D4A"; c.fillRect(0, 0, LADO_MAPA, LADO_MAPA);
    for (let i = 0; i < 9000; i++) { c.fillStyle = i % 2 ? "#557F43" : "#689651"; c.fillRect(Math.random() * LADO_MAPA, Math.random() * LADO_MAPA, 3, 3); }
    if (imp.terreno.length >= 3) { tracar(imp.terreno); c.fillStyle = "#B9A27E"; c.fill(); c.lineWidth = 3; c.strokeStyle = "#7A6A4E"; c.stroke(); }
    c.fillStyle = "#3B3D42";
    for (const r of imp.ruas) if (r.length >= 3) { tracar(r); c.fill(); }
    imp.lotes.forEach((l, i) => {
      if (l.poligono.length < 3) return;
      tracar(l.poligono);
      c.fillStyle = selecionado === l.id ? "#F5E6B8" : SITUACOES[lotes[i].situacao].cor; c.fill();
      c.lineWidth = selecionado === l.id ? 6 : 2.5; c.strokeStyle = selecionado === l.id ? "#C9A961" : "#FFFFFF"; c.stroke();
    });
    mapa.textura.needsUpdate = true;
  }, [imp, lotes, selecionado, caixa, mapa]);
  useEffect(() => () => { mapa.textura.dispose(); mapa.material.dispose(); }, [mapa]);
  useEffect(() => () => { malha.dispose(); }, [malha]);

  /** Toque no terreno: acha o lote daquele ponto (o menor, se houver sobreposição). */
  const aoTocar = (x: number, z: number) => {
    const dentro = imp.lotes.map((l, i) => ({ l, dados: lotes[i] })).filter(({ l }) => l.poligono.length >= 3 && dentroDoPoligono({ x, y: z }, l.poligono));
    onSelecionar(dentro.sort((p, q) => areaPoligono(p.l.poligono) - areaPoligono(q.l.poligono))[0]?.dados ?? null);
  };

  const construcoes = useMemo(() => imp.posicoes.map(p => ({ p, e: edificacoes.find(x => x.id === p.edificacaoId) })).filter((c): c is Construcao => !!c.e && c.e.pavimentos.length > 0), [imp.posicoes, edificacoes]);
  // Detalhe só perto da câmera: confere duas vezes por segundo quais são as mais próximas.
  const [detalhadas, setDetalhadas] = useState<string[]>([]);
  const relogio = useRef(0);
  useFrame(({ camera }, dt) => {
    relogio.current += dt;
    if (relogio.current < 0.5) return;
    relogio.current = 0;
    const perto = construcoes.map(c => ({ id: c.p.id, d: Math.hypot(c.p.x - camera.position.x, c.p.y - camera.position.z, camera.position.y) }))
      .filter(c => c.d < DISTANCIA_DETALHE).sort((a, b) => a.d - b.d).slice(0, MAX_DETALHADAS).map(c => c.id).sort();
    if (perto.join("|") !== detalhadas.join("|")) setDetalhadas(perto);
  });
  const { comDetalhe, volumes } = useMemo(() => {
    const ids = new Set(detalhadas), porEdificacao = new Map<string, Construcao[]>();
    for (const c of construcoes) if (!ids.has(c.p.id)) porEdificacao.set(c.e.id, [...(porEdificacao.get(c.e.id) ?? []), c]);
    return { comDetalhe: construcoes.filter(c => ids.has(c.p.id)), volumes: Array.from(porEdificacao.values()) };
  }, [construcoes, detalhadas]);
  // Saia: fecha as bordas do terreno até o chão, para o relevo não parecer uma folha solta.
  const saia = useMemo(() => {
    const n = LADO_MALHA, borda: [number, number][] = [];
    for (let i = 0; i <= n; i++) borda.push([i, 0]);
    for (let j = 1; j <= n; j++) borda.push([n, j]);
    for (let i = n - 1; i >= 0; i--) borda.push([i, n]);
    for (let j = n - 1; j >= 1; j--) borda.push([0, j]);
    const pos: number[] = [];
    const pt = ([i, j]: [number, number]) => { const x = caixa.x0 + (caixa.largura * i) / n, z = caixa.z0 + (caixa.comprimento * j) / n; return [x, alturaDoRelevo(imp.relevo, x, z), z] as const; };
    borda.forEach((b, k) => {
      const a = pt(b), c2 = pt(borda[(k + 1) % borda.length]);
      pos.push(a[0], a[1], a[2], c2[0], c2[1], c2[2], a[0], -0.5, a[2], c2[0], c2[1], c2[2], c2[0], -0.5, c2[2], a[0], -0.5, a[2]);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.computeVertexNormals();
    return g;
  }, [imp.relevo, caixa]);
  const terra = useMemo(() => new THREE.MeshStandardMaterial({ color: "#6E5B43", roughness: 1, side: THREE.DoubleSide }), []);

  return (
    <group>
      <mesh geometry={malha} material={mapa.material} receiveShadow onClick={e => { e.stopPropagation(); aoTocar(e.point.x, e.point.z); }} />
      {imp.relevo && <mesh geometry={saia} material={terra} />}
      {volumes.map(itens => <Volumes key={itens[0].e.id} edificacao={itens[0].e} itens={itens} relevo={imp.relevo} />)}
      {comDetalhe.map(({ p, e }) => (
        // A casa é girada em torno do próprio canto de origem e assentada na cota do terreno naquele ponto.
        <group key={p.id} position={[p.x, alturaDoRelevo(imp.relevo, p.x, p.y) + 0.02, p.y]} rotation={[0, -THREE.MathUtils.degToRad(p.rotacao), 0]}>
          <Casa edificacao={e} m={m} mostrarTelhado corteAte={null} />
        </group>
      ))}
    </group>
  );
}
