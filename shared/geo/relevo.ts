// Cálculos de relevo a partir de uma grade de elevações (DEM): declividade por
// célula, declividade média e distribuição por faixas. Funções puras, portadas
// do Grupo Santa Fé sem alteração de lógica.

export interface GridElevacaoLike {
  ncols: number;
  nrows: number;
  z: number[][];
  min: number;
  max: number;
}

export interface FaixaDeclividade {
  chave: "plano" | "leve" | "moderado" | "ingreme" | "inviavel";
  label: string;
  corHex: string;
  min: number;
  max: number;
}

export const FAIXAS_DECLIVIDADE: FaixaDeclividade[] = [
  { chave: "plano", label: "Plano (0–5%)", corHex: "#16a34a", min: 0, max: 5 },
  { chave: "leve", label: "Leve (5–10%)", corHex: "#84cc16", min: 5, max: 10 },
  { chave: "moderado", label: "Moderado (10–18%)", corHex: "#eab308", min: 10, max: 18 },
  { chave: "ingreme", label: "Íngreme (18–25%)", corHex: "#f97316", min: 18, max: 25 },
  { chave: "inviavel", label: "Inviável (>25%)", corHex: "#dc2626", min: 25, max: Infinity },
];

export function indiceFaixa(declividadePct: number): number {
  for (let i = 0; i < FAIXAS_DECLIVIDADE.length; i++) {
    const f = FAIXAS_DECLIVIDADE[i];
    if (declividadePct >= f.min && declividadePct < f.max) return i;
  }
  return FAIXAS_DECLIVIDADE.length - 1;
}

export function declividadeGrade(grid: GridElevacaoLike, cellMetersX: number, cellMetersY: number): number[][] {
  const { ncols, nrows, z } = grid;
  const dx = Math.max(1e-6, cellMetersX);
  const dy = Math.max(1e-6, cellMetersY);
  const out: number[][] = [];

  for (let r = 0; r < nrows; r++) {
    const linha: number[] = [];
    for (let c = 0; c < ncols; c++) {
      const zl = z[r]?.[Math.max(0, c - 1)] ?? z[r]?.[c] ?? 0;
      const zr = z[r]?.[Math.min(ncols - 1, c + 1)] ?? z[r]?.[c] ?? 0;
      const zu = z[Math.max(0, r - 1)]?.[c] ?? z[r]?.[c] ?? 0;
      const zd = z[Math.min(nrows - 1, r + 1)]?.[c] ?? z[r]?.[c] ?? 0;
      const spanX = c === 0 || c === ncols - 1 ? dx : 2 * dx;
      const spanY = r === 0 || r === nrows - 1 ? dy : 2 * dy;
      const gx = (zr - zl) / spanX;
      const gy = (zd - zu) / spanY;
      const slope = Math.sqrt(gx * gx + gy * gy) * 100;
      linha.push(slope);
    }
    out.push(linha);
  }
  return out;
}

export function declividadeMedia(slopes: number[][]): number {
  let soma = 0;
  let n = 0;
  for (const linha of slopes) for (const s of linha) { soma += s; n++; }
  return n ? soma / n : 0;
}

export interface DistribuicaoFaixa extends FaixaDeclividade {
  celulas: number;
  pct: number;
}

export function distribuicaoDeclividade(slopes: number[][]): DistribuicaoFaixa[] {
  const contagem = new Array(FAIXAS_DECLIVIDADE.length).fill(0);
  let total = 0;
  for (const linha of slopes) {
    for (const s of linha) {
      contagem[indiceFaixa(s)]++;
      total++;
    }
  }
  return FAIXAS_DECLIVIDADE.map((f, i) => ({
    ...f,
    celulas: contagem[i],
    pct: total ? contagem[i] / total : 0,
  }));
}

export function celulaEmMetros(cellsizeXGraus: number, cellsizeYGraus: number, latitudeGraus: number): { x: number; y: number } {
  const latRad = (latitudeGraus * Math.PI) / 180;
  const metrosPorGrauLat = 111_132;
  const metrosPorGrauLng = 111_320 * Math.cos(latRad);
  return {
    x: Math.abs(cellsizeXGraus * metrosPorGrauLng),
    y: Math.abs(cellsizeYGraus * metrosPorGrauLat),
  };
}
