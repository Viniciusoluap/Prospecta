// Maquete 3D (EPIC-022, etapa 4) — implantação do empreendimento: terreno, ruas, lotes coloridos pela situação
// de venda da unidade e as construções posicionadas. A geometria vem do estudo de Incorporação (ou da prancha
// de implantação lida do PDF); a situação vem do inventário de unidades. Clicar num lote mostra os dados dele.
import { useMemo } from "react";
import * as THREE from "three";
import { areaPoligono, type Edificacao, type Implantacao as DadosImplantacao, type Ponto } from "@shared/maquete-3d/modelo";
import { Casa, geometriaPlana } from "./Casa";
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

const MAX_CONSTRUCOES = 24; // cada construção é uma casa inteira: limite para não pesar no celular

export function Implantacao({ implantacao: imp, edificacoes, unidades, m, selecionado, onSelecionar }: {
  implantacao: DadosImplantacao; edificacoes: Edificacao[]; unidades: UnidadeVenda[]; m: Materiais;
  selecionado: string | null; onSelecionar: (l: LoteNaCena | null) => void;
}) {
  const lotes = useMemo(() => lotesDaCena(imp, unidades), [imp, unidades]);
  const pecas = useMemo(() => {
    // polygonOffset: as camadas ficam quase coplanares; sem isso elas "piscam" quando vistas de longe.
    const mat = (cor: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: cor, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...extra });
    const cores = Object.fromEntries(Object.entries(SITUACOES).map(([k, v]) => [k, mat(v.cor)])) as Record<SituacaoLote, THREE.MeshStandardMaterial>;
    const valido = (p: Ponto[]) => p.length >= 3;
    return {
      cores, asfalto: mat("#3B3D42", { roughness: 0.95 }), terra: mat("#B9A27E", { polygonOffset: false }), destaque: mat("#FFFFFF", { emissive: "#C9A961", emissiveIntensity: 0.9 }),
      terreno: valido(imp.terreno) ? geometriaPlana(imp.terreno, 0, true) : null,
      ruas: imp.ruas.filter(valido).map(r => geometriaPlana(r, 0.12, true)),
      lotes: imp.lotes.map((l, i) => (valido(l.poligono) ? {
        dados: lotes[i], g: geometriaPlana(l.poligono, 0.25, true),
        borda: new THREE.BufferGeometry().setFromPoints([...l.poligono, l.poligono[0]].map(p => new THREE.Vector3(p.x, 0.6, p.y))),
      } : null)).filter((x): x is NonNullable<typeof x> => !!x),
    };
  }, [imp, lotes]);
  const linha = useMemo(() => new THREE.LineBasicMaterial({ color: "#FFFFFF", depthTest: false }), []);
  const construcoes = imp.posicoes.slice(0, MAX_CONSTRUCOES).map(p => ({ p, e: edificacoes.find(x => x.id === p.edificacaoId) })).filter((c): c is { p: typeof c.p; e: Edificacao } => !!c.e);

  return (
    <group>
      {pecas.terreno && <mesh geometry={pecas.terreno} material={pecas.terra} receiveShadow onClick={() => onSelecionar(null)} />}
      {pecas.ruas.map((g, i) => <mesh key={i} geometry={g} material={pecas.asfalto} receiveShadow />)}
      {pecas.lotes.map(l => (
        <group key={l.dados.id}>
          <mesh geometry={l.g} material={selecionado === l.dados.id ? pecas.destaque : pecas.cores[l.dados.situacao]} receiveShadow
            onClick={e => { e.stopPropagation(); onSelecionar(l.dados); }} />
          <primitive object={new THREE.Line(l.borda, linha)} renderOrder={5} />
        </group>
      ))}
      {construcoes.map(({ p, e }) => (
        <group key={p.id} position={[p.x, 0.27, p.y]} rotation={[0, -THREE.MathUtils.degToRad(p.rotacao), 0]}>
          <Casa edificacao={e} m={m} mostrarTelhado corteAte={null} />
        </group>
      ))}
    </group>
  );
}
