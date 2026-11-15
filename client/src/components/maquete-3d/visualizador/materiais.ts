// Maquete 3D (EPIC-022, etapa 2) — materiais dos três estilos de decoração. As texturas (veio de madeira, trama
// de tecido, veios de pedra, rejunte de cerâmica, telha) são desenhadas por código em um canvas: nenhum arquivo
// externo, nenhum pacote comprado. Cada estilo é um conjunto de cores e acabamentos sobre os mesmos nomes de
// material, então trocar de estilo não muda a geometria da casa nem dos móveis.
import * as THREE from "three";

export const ESTILOS = ["moderno", "escandinavo", "luxo"] as const;
export type Estilo = (typeof ESTILOS)[number];
export const ROTULOS_ESTILO: Record<Estilo, string> = { moderno: "Moderno", escandinavo: "Escandinavo", luxo: "Luxo aconchegante" };

/** Nomes de material que os móveis e a casa usam. Todo estilo fornece todos. */
export const NOMES_MATERIAL = [
  // arquitetura
  "parede", "paredeExterna", "teto", "pisoSeco", "pisoMolhado", "pisoExterno", "rodape", "esquadria", "porta", "vidro",
  "telha", "laje", "grama", "calcada", "degrau",
  // móveis
  "madeira", "madeiraEscura", "laminado", "tecido", "tecidoAlt", "roupaDeCama", "travesseiro", "tapete", "cortina",
  "metal", "metalEscuro", "cromado", "inox", "pedra", "louca", "espelho", "tela", "plastico",
  "folha", "terra", "vasoPlanta", "moldura", "arte", "luz",
] as const;
export type NomeMaterial = (typeof NOMES_MATERIAL)[number];
export type Materiais = Record<NomeMaterial, THREE.MeshStandardMaterial>;

type Cor = string;
type Paleta = {
  parede: Cor; paredeExterna: Cor; teto: Cor; piso: { tipo: "madeira" | "porcelanato"; cor: Cor; veio: Cor }; pisoMolhado: Cor; pisoExterno: Cor;
  esquadria: Cor; porta: Cor; telha: Cor;
  madeira: Cor; madeiraVeio: Cor; madeiraEscura: Cor; laminado: Cor; tecido: Cor; tecidoAlt: Cor; roupaDeCama: Cor; tapete: Cor; tapeteDetalhe: Cor;
  cortina: Cor; metal: Cor; metalEscuro: Cor; pedra: Cor; pedraVeio: Cor; vasoPlanta: Cor; moldura: Cor; arte: [Cor, Cor, Cor]; luz: Cor;
};

const PALETAS: Record<Estilo, Paleta> = {
  moderno: {
    parede: "#ECEAE6", paredeExterna: "#E4E2DD", teto: "#F7F6F3", piso: { tipo: "porcelanato", cor: "#CFCBC4", veio: "#B9B4AB" }, pisoMolhado: "#D9D7D2", pisoExterno: "#A9A59E",
    esquadria: "#2B2D30", porta: "#3A3C40", telha: "#4A4C50",
    madeira: "#8A6B4F", madeiraVeio: "#6E5239", madeiraEscura: "#3B2F27", laminado: "#F2F1EE", tecido: "#6F747A", tecidoAlt: "#C9A24B", roupaDeCama: "#F1F0EC",
    tapete: "#B9B6B0", tapeteDetalhe: "#8D8A84", cortina: "#E6E4DF", metal: "#2A2C2F", metalEscuro: "#17181A", pedra: "#2F3033", pedraVeio: "#55575B",
    vasoPlanta: "#3A3C40", moldura: "#1D1E20", arte: ["#2F3033", "#C9A24B", "#E9E7E2"], luz: "#FFE9C4",
  },
  escandinavo: {
    parede: "#F4F1EA", paredeExterna: "#EFEBE2", teto: "#FBFAF6", piso: { tipo: "madeira", cor: "#D6B98F", veio: "#BC9C6F" }, pisoMolhado: "#E7E3DA", pisoExterno: "#C2B8A6",
    esquadria: "#F3F1EC", porta: "#E9E2D3", telha: "#8B4A3A",
    madeira: "#D9BE94", madeiraVeio: "#BFA074", madeiraEscura: "#A9875C", laminado: "#FAF8F3", tecido: "#C9C3B6", tecidoAlt: "#8FA69A", roupaDeCama: "#F6F3EC",
    tapete: "#E6DFD0", tapeteDetalhe: "#B9AE98", cortina: "#F5F1E8", metal: "#C8C3B8", metalEscuro: "#6F6A60", pedra: "#EDEAE3", pedraVeio: "#CFC9BC",
    vasoPlanta: "#E9E2D3", moldura: "#D9BE94", arte: ["#8FA69A", "#D9BE94", "#F4F1EA"], luz: "#FFEBCB",
  },
  luxo: {
    parede: "#E9E1D4", paredeExterna: "#DDD3C2", teto: "#F5F0E6", piso: { tipo: "madeira", cor: "#6B4A33", veio: "#4E3423" }, pisoMolhado: "#E4DCCD", pisoExterno: "#8C8273",
    esquadria: "#33291F", porta: "#4A3626", telha: "#3C2E26",
    madeira: "#6E4B32", madeiraVeio: "#4F3421", madeiraEscura: "#2E1F16", laminado: "#3A2C22", tecido: "#8C7A66", tecidoAlt: "#7A2E2A", roupaDeCama: "#EFE6D6",
    tapete: "#8E7B63", tapeteDetalhe: "#5E4F3E", cortina: "#CDBFA7", metal: "#B08D4F", metalEscuro: "#6E5630", pedra: "#EFEAE0", pedraVeio: "#A8946F",
    vasoPlanta: "#B08D4F", moldura: "#B08D4F", arte: ["#7A2E2A", "#B08D4F", "#2E1F16"], luz: "#FFDDA8",
  },
};

// ── Texturas desenhadas por código ──

/** Gerador pseudoaleatório fixo: a mesma textura em toda visita. */
function sorteio(semente: number) {
  let s = semente >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function tela(lado: number, desenhar: (c: CanvasRenderingContext2D, l: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = lado;
  desenhar(canvas.getContext("2d")!, lado);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const clarear = (cor: Cor, f: number) => `#${new THREE.Color(cor).multiplyScalar(f).getHexString()}`;

function texturaMadeira(cor: Cor, veio: Cor, semente: number, tabuas = 0): THREE.CanvasTexture {
  return tela(512, (c, l) => {
    const r = sorteio(semente);
    c.fillStyle = cor; c.fillRect(0, 0, l, l);
    const faixas = tabuas || 1, h = l / faixas;
    for (let f = 0; f < faixas; f++) {
      c.fillStyle = clarear(cor, 0.92 + r() * 0.16); c.fillRect(0, f * h, l, h);
      for (let i = 0; i < 46; i++) {
        const y = f * h + r() * h, onda = 2 + r() * 5;
        c.strokeStyle = veio; c.globalAlpha = 0.08 + r() * 0.22; c.lineWidth = 0.6 + r() * 1.8;
        c.beginPath(); c.moveTo(0, y);
        for (let x = 0; x <= l; x += 32) c.lineTo(x, y + Math.sin(x / 70 + i) * onda);
        c.stroke();
      }
      c.globalAlpha = 1;
      if (tabuas) { c.fillStyle = clarear(veio, 0.6); c.fillRect(0, f * h, l, 2); c.fillRect((r() * l) | 0, f * h, 2, h); }
    }
  });
}

function texturaTecido(cor: Cor, semente: number): THREE.CanvasTexture {
  return tela(256, (c, l) => {
    const r = sorteio(semente);
    c.fillStyle = cor; c.fillRect(0, 0, l, l);
    for (let y = 0; y < l; y += 2) for (let x = 0; x < l; x += 2) {
      const trama = (x / 2 + y / 2) % 2 === 0 ? 1.06 : 0.94;
      c.fillStyle = clarear(cor, trama * (0.95 + r() * 0.1)); c.fillRect(x, y, 2, 2);
    }
  });
}

function texturaPedra(cor: Cor, veio: Cor, semente: number): THREE.CanvasTexture {
  return tela(512, (c, l) => {
    const r = sorteio(semente);
    c.fillStyle = cor; c.fillRect(0, 0, l, l);
    for (let i = 0; i < 900; i++) { c.fillStyle = clarear(cor, 0.94 + r() * 0.1); c.globalAlpha = 0.5; c.fillRect(r() * l, r() * l, 2 + r() * 6, 2 + r() * 6); }
    for (let i = 0; i < 9; i++) {
      let x = r() * l, y = r() * l, ang = r() * Math.PI * 2;
      c.strokeStyle = veio; c.globalAlpha = 0.25 + r() * 0.35; c.lineWidth = 0.6 + r() * 2.2;
      c.beginPath(); c.moveTo(x, y);
      for (let k = 0; k < 40; k++) { ang += (r() - 0.5) * 0.7; x += Math.cos(ang) * 14; y += Math.sin(ang) * 14; c.lineTo(x, y); }
      c.stroke();
    }
    c.globalAlpha = 1;
  });
}

function texturaCeramica(cor: Cor, veio: Cor, semente: number, pecas: number): THREE.CanvasTexture {
  return tela(512, (c, l) => {
    const r = sorteio(semente), p = l / pecas;
    for (let i = 0; i < pecas; i++) for (let j = 0; j < pecas; j++) {
      c.fillStyle = clarear(cor, 0.97 + r() * 0.06); c.fillRect(i * p, j * p, p, p);
      for (let k = 0; k < 5; k++) { c.fillStyle = veio; c.globalAlpha = 0.05 + r() * 0.07; c.fillRect(i * p + r() * p, j * p + r() * p, p * 0.4 * r(), 1 + r() * 2); }
      c.globalAlpha = 1;
    }
    c.strokeStyle = clarear(cor, 0.72); c.lineWidth = 2;
    for (let i = 0; i <= pecas; i++) { c.beginPath(); c.moveTo(i * p, 0); c.lineTo(i * p, l); c.moveTo(0, i * p); c.lineTo(l, i * p); c.stroke(); }
  });
}

function texturaTelha(cor: Cor, semente: number): THREE.CanvasTexture {
  return tela(256, (c, l) => {
    const r = sorteio(semente), n = 8, h = l / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const g = c.createLinearGradient(i * h, 0, (i + 1) * h, 0), base = clarear(cor, 0.9 + r() * 0.2);
      g.addColorStop(0, clarear(base, 0.75)); g.addColorStop(0.5, base); g.addColorStop(1, clarear(base, 0.75));
      c.fillStyle = g; c.fillRect(i * h, j * h, h, h);
      c.fillStyle = "rgba(0,0,0,0.28)"; c.fillRect(i * h, (j + 1) * h - 3, h, 3);
    }
  });
}

function texturaRuido(cor: Cor, semente: number, grao = 0.08): THREE.CanvasTexture {
  return tela(256, (c, l) => {
    const r = sorteio(semente);
    c.fillStyle = cor; c.fillRect(0, 0, l, l);
    for (let i = 0; i < 6000; i++) { c.fillStyle = clarear(cor, 1 - grao + r() * grao * 2); c.fillRect(r() * l, r() * l, 1 + r() * 2, 1 + r() * 2); }
  });
}

function texturaTapete(cor: Cor, detalhe: Cor, semente: number): THREE.CanvasTexture {
  return tela(512, (c, l) => {
    const r = sorteio(semente);
    c.fillStyle = cor; c.fillRect(0, 0, l, l);
    for (let i = 0; i < 9000; i++) { c.fillStyle = clarear(cor, 0.9 + r() * 0.2); c.fillRect(r() * l, r() * l, 2, 2); }
    c.strokeStyle = detalhe; c.lineWidth = 10; c.globalAlpha = 0.8; c.strokeRect(28, 28, l - 56, l - 56);
    c.lineWidth = 3; c.strokeRect(52, 52, l - 104, l - 104); c.globalAlpha = 1;
  });
}

function texturaArte(cores: [Cor, Cor, Cor], semente: number): THREE.CanvasTexture {
  return tela(256, (c, l) => {
    const r = sorteio(semente);
    c.fillStyle = cores[2]; c.fillRect(0, 0, l, l);
    for (let i = 0; i < 7; i++) {
      c.fillStyle = cores[i % 2]; c.globalAlpha = 0.55 + r() * 0.4;
      c.beginPath();
      if (r() > 0.5) c.arc(r() * l, r() * l, 20 + r() * 70, 0, Math.PI * 2); else c.rect(r() * l, r() * l, 30 + r() * 110, 20 + r() * 90);
      c.fill();
    }
    c.globalAlpha = 1;
  });
}

// ── Montagem ──

function padrao(p: THREE.MeshStandardMaterialParameters & { repetir?: [number, number] }): THREE.MeshStandardMaterial {
  const { repetir, ...resto } = p;
  if (repetir && resto.map) { resto.map.repeat.set(repetir[0], repetir[1]); resto.bumpMap = resto.map; resto.bumpScale = resto.bumpScale ?? 0.6; }
  return new THREE.MeshStandardMaterial(resto);
}

const cache = new Map<Estilo, Materiais>();

/** Materiais do estilo (criados uma vez e reaproveitados em toda a cena). */
export function materiaisDoEstilo(estilo: Estilo): Materiais {
  const pronto = cache.get(estilo);
  if (pronto) return pronto;
  const p = PALETAS[estilo], n = ESTILOS.indexOf(estilo) * 100;
  const pisoSeco = p.piso.tipo === "madeira"
    ? padrao({ map: texturaMadeira(p.piso.cor, p.piso.veio, n + 1, 6), roughness: 0.55, repetir: [0.5, 0.5] })
    : padrao({ map: texturaCeramica(p.piso.cor, p.piso.veio, n + 1, 2), roughness: 0.28, repetir: [0.6, 0.6], bumpScale: 0.15 });
  const m: Materiais = {
    parede: padrao({ map: texturaRuido(p.parede, n + 2, 0.025), roughness: 0.92, repetir: [0.5, 0.5], bumpScale: 0.2 }),
    paredeExterna: padrao({ map: texturaRuido(p.paredeExterna, n + 3, 0.05), roughness: 0.95, repetir: [0.4, 0.4], bumpScale: 0.5 }),
    teto: padrao({ color: p.teto, roughness: 0.95 }),
    pisoSeco,
    pisoMolhado: padrao({ map: texturaCeramica(p.pisoMolhado, clarear(p.pisoMolhado, 0.85), n + 4, 4), roughness: 0.35, repetir: [0.8, 0.8], bumpScale: 0.2 }),
    pisoExterno: padrao({ map: texturaCeramica(p.pisoExterno, clarear(p.pisoExterno, 0.8), n + 5, 3), roughness: 0.85, repetir: [0.5, 0.5] }),
    rodape: padrao({ color: estilo === "luxo" ? p.madeiraEscura : "#F4F3F0", roughness: 0.6 }),
    esquadria: padrao({ color: p.esquadria, roughness: 0.45, metalness: 0.35 }),
    porta: padrao({ map: texturaMadeira(p.porta, clarear(p.porta, 0.8), n + 6), roughness: 0.6, repetir: [1, 1], bumpScale: 0.3 }),
    vidro: padrao({ color: "#CFE3EA", roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    telha: padrao({ map: texturaTelha(p.telha, n + 7), roughness: 0.85, repetir: [0.6, 0.6], side: THREE.DoubleSide, bumpScale: 1.2 }),
    laje: padrao({ color: "#D8D6D1", roughness: 0.95, side: THREE.DoubleSide }),
    grama: padrao({ map: texturaRuido("#5E8D4A", n + 8, 0.2), roughness: 1, repetir: [0.25, 0.25], bumpScale: 0.8 }),
    calcada: padrao({ map: texturaCeramica("#B7B2A8", "#9A958B", n + 9, 4), roughness: 0.9, repetir: [0.5, 0.5] }),
    degrau: padrao({ map: texturaMadeira(p.madeira, p.madeiraVeio, n + 10), roughness: 0.5, repetir: [1, 1] }),

    madeira: padrao({ map: texturaMadeira(p.madeira, p.madeiraVeio, n + 11), roughness: 0.55, repetir: [1, 1], bumpScale: 0.35 }),
    madeiraEscura: padrao({ map: texturaMadeira(p.madeiraEscura, clarear(p.madeiraEscura, 0.7), n + 12), roughness: 0.5, repetir: [1, 1], bumpScale: 0.35 }),
    laminado: padrao({ color: p.laminado, roughness: estilo === "luxo" ? 0.35 : 0.5 }),
    tecido: padrao({ map: texturaTecido(p.tecido, n + 13), roughness: 0.98, repetir: [3, 3], bumpScale: 0.9 }),
    tecidoAlt: padrao({ map: texturaTecido(p.tecidoAlt, n + 14), roughness: 0.98, repetir: [3, 3], bumpScale: 0.9 }),
    roupaDeCama: padrao({ map: texturaTecido(p.roupaDeCama, n + 15), roughness: 0.95, repetir: [4, 4], bumpScale: 0.5 }),
    travesseiro: padrao({ map: texturaTecido("#FAF9F6", n + 16), roughness: 0.95, repetir: [2, 2], bumpScale: 0.4 }),
    tapete: padrao({ map: texturaTapete(p.tapete, p.tapeteDetalhe, n + 17), roughness: 1, bumpScale: 1.2 }),
    cortina: padrao({ map: texturaTecido(p.cortina, n + 18), roughness: 0.95, repetir: [2, 4], side: THREE.DoubleSide, transparent: true, opacity: 0.93 }),
    metal: padrao({ color: p.metal, roughness: 0.35, metalness: 0.85 }),
    metalEscuro: padrao({ color: p.metalEscuro, roughness: 0.45, metalness: 0.8 }),
    cromado: padrao({ color: "#D9DCDF", roughness: 0.12, metalness: 1 }),
    inox: padrao({ color: "#B9BDC1", roughness: 0.3, metalness: 0.9 }),
    pedra: padrao({ map: texturaPedra(p.pedra, p.pedraVeio, n + 19), roughness: 0.22, repetir: [1, 1], bumpScale: 0.05 }),
    louca: padrao({ color: "#FBFBF9", roughness: 0.12 }),
    espelho: padrao({ color: "#E9EEF0", roughness: 0.03, metalness: 1 }),
    tela: padrao({ color: "#0B0C0E", roughness: 0.08, metalness: 0.6 }),
    plastico: padrao({ color: "#F1F1EF", roughness: 0.4 }),
    folha: padrao({ map: texturaRuido("#3F7A45", n + 20, 0.18), roughness: 0.7, side: THREE.DoubleSide }),
    terra: padrao({ color: "#3A2A1E", roughness: 1 }),
    vasoPlanta: padrao({ color: p.vasoPlanta, roughness: 0.5, metalness: estilo === "luxo" ? 0.7 : 0 }),
    moldura: padrao({ color: p.moldura, roughness: 0.4, metalness: estilo === "luxo" ? 0.7 : 0.1 }),
    arte: padrao({ map: texturaArte(p.arte, n + 21), roughness: 0.9 }),
    luz: padrao({ color: "#FFF6E6", emissive: p.luz, emissiveIntensity: 0.15, roughness: 0.6 }),
  };
  cache.set(estilo, m);
  return m;
}

/** Acende as luminárias à noite: `noite` vai de 0 (dia) a 1 (noite fechada). */
export function acender(m: Materiais, noite: number) {
  m.luz.emissiveIntensity = 0.15 + noite * 3.2;
  m.tela.emissive.set(noite > 0.5 ? "#1B2A44" : "#000000");
  m.tela.emissiveIntensity = noite * 0.6;
}

/** Cor da luz das luminárias no estilo (para as luzes pontuais da noite). */
export const corDaLuz = (estilo: Estilo) => PALETAS[estilo].luz;
