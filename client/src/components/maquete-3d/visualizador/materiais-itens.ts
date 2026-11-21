// Maquete 3D (EPIC-028, Etapa 3) — cor e material de cada item do JSON-fonte aplicados ao desenho do catálogo. O
// material do item escolhe quais materiais do móvel recebem a cor (ex.: "tecido" pinta estofado e roupa de cama,
// "granito" pinta o tampo); o resto do móvel (ferragens, pés, louças de outro tipo) continua como no estilo. A cor
// fica lisa e o relevo da textura continua (vira mapa de relevo). Um conjunto por (material, cor), reaproveitado.
import * as THREE from "three";
import { COR_HEX, type MaterialItem } from "@shared/maquete-3d/edicao";
import type { Materiais, NomeMaterial } from "./materiais";

const ALVOS: Record<MaterialItem, NomeMaterial[]> = {
  madeira: ["madeira", "madeiraEscura", "laminado"],
  laminado: ["laminado", "madeira"],
  tecido: ["tecido", "tecidoAlt", "roupaDeCama"],
  granito: ["pedra"],
  pedra: ["pedra"],
  "aço inox": ["inox"],
  metal: ["metal", "inox", "plastico"],
  "louça": ["louca"],
  vidro: ["vidro"],
  pintura: ["laminado", "metal"],
  "plástico": ["plastico", "vasoPlanta"],
};

const porBase = new WeakMap<Materiais, Map<string, Materiais>>();

/** Materiais do móvel com a cor do item. Material ou cor fora da lista: os do estilo, sem mudança. */
export function materiaisDoItem(base: Materiais, material: string | undefined, cor: string | undefined): Materiais {
  const alvos = material ? ALVOS[material as MaterialItem] : undefined;
  if (!alvos || !cor || !COR_HEX.test(cor)) return base;
  let cache = porBase.get(base);
  if (!cache) { cache = new Map(); porBase.set(base, cache); }
  const chave = `${material}|${cor.toLowerCase()}`;
  const pronto = cache.get(chave);
  if (pronto) return pronto;
  const m: Materiais = { ...base };
  for (const n of alvos) {
    const c = base[n].clone();
    c.color = new THREE.Color(cor);
    if (c.map && n !== "vidro") { c.bumpMap = c.bumpMap ?? c.map; c.bumpScale = Math.min(c.bumpScale ?? 0.4, 0.4); c.map = null; }
    c.needsUpdate = true;
    m[n] = c;
  }
  cache.set(chave, m);
  return m;
}
