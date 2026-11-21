// Maquete 3D (EPIC-028, Etapa 2) — planta 2D com cotas, em SVG, desenhada a partir de `planta2d` (puro, testado em
// shared/maquete-3d/planta2d.ts), que lê o MESMO JSON-fonte da cena 3D. Leve: aparece antes do 3D e não usa WebGL.
import { useMemo } from "react";
import type { FontePlanta } from "@shared/maquete-3d/fonte";
import { fmtM, planta2d, type LinhaCota } from "@shared/maquete-3d/planta2d";

const TINTA = "#1B1B1A";
const MUDO = "#6B6B66";

function Cota({ c }: { c: LinhaCota }) {
  const [ax, az] = c.a, [bx, bz] = c.b, horizontal = Math.abs(az - bz) < 1e-6;
  const t = 0.07, mx = (ax + bx) / 2, mz = (az + bz) / 2, curta = Math.hypot(bx - ax, bz - az) < 0.42;
  const tique = (x: number, z: number) => `M${x - t} ${z + t}L${x + t} ${z - t}`;
  return (
    <g>
      <path d={`M${ax} ${az}L${bx} ${bz}`} stroke={TINTA} strokeWidth={0.012} />
      <path d={tique(ax, az) + tique(bx, bz)} stroke={TINTA} strokeWidth={0.024} />
      {horizontal
        ? <text x={mx} y={mz - 0.07} fontSize={curta ? 0.12 : 0.16} textAnchor="middle" fill={TINTA}>{c.texto}</text>
        : <text x={mx + 0.07} y={mz} fontSize={curta ? 0.12 : 0.16} textAnchor="middle" fill={TINTA} transform={`rotate(-90 ${mx + 0.07} ${mz})`} dy={0}>{c.texto}</text>}
    </g>
  );
}

export function Planta2D({ fonte, destaque }: { fonte: FontePlanta; destaque?: string | null }) {
  const p = useMemo(() => planta2d(fonte), [fonte]);
  const [vx, vz, vw, vh] = p.viewBox;
  return (
    <figure className="m-0 flex h-full w-full flex-col">
      <svg viewBox={`${vx} ${vz} ${vw} ${vh}`} className="h-full w-full" role="img" aria-label={`Planta baixa com cotas — ${fonte.nome}`} style={{ fontFamily: "inherit" }}>
        <rect x={vx} y={vz} width={vw} height={vh} fill="#FFFFFF" />
        {/* Ambientes: piso claro; o cômodo em destaque em amarelo-obra. */}
        {p.ambientes.map(a => (
          <polygon key={a.nome} points={a.poligono.map(q => q.join(",")).join(" ")}
            fill={a.nome === destaque ? "#FFF6A6" : a.interno ? "#F7F6F2" : /quintal/i.test(a.nome) ? "#EEF3E7" : "#F1F0EC"} />
        ))}
        {/* Itens em contorno (tracejado = estimado). */}
        {p.itens.map(i => (
          <g key={i.id}>
            <polygon points={i.poligono.map(q => q.join(",")).join(" ")} fill="#FFFFFF" fillOpacity={0.6} stroke={MUDO} strokeWidth={0.014} strokeDasharray={i.estimado ? "0.05 0.035" : undefined} />
            {i.mostrarRotulo && <text x={i.x} y={i.z + 0.035} fontSize={0.1} textAnchor="middle" fill={MUDO}>{i.rotulo}</text>}
          </g>
        ))}
        {/* Paredes cortadas: casa em preto, muros em cinza. */}
        {p.paredes.map(w => w.poligonos.map((pol, k) => (
          <polygon key={`${w.id}-${k}`} points={pol.map(q => q.join(",")).join(" ")} fill={w.muro ? "#8E8D88" : TINTA} />
        )))}
        {/* Aberturas. */}
        {p.aberturas.map(a => (
          <g key={a.id}>
            <polygon points={a.vao.map(q => q.join(",")).join(" ")} fill="#FFFFFF" stroke={TINTA} strokeWidth={0.008} />
            <path d={a.tracos} fill="none" stroke={TINTA} strokeWidth={0.014} />
            {a.arco && <path d={a.arco} fill="none" stroke={TINTA} strokeWidth={0.01} strokeDasharray="0.04 0.03" />}
            <text x={a.rotulo.x} y={a.rotulo.z + 0.04} fontSize={0.11} textAnchor="middle" fill={TINTA} fontWeight={600}>{a.rotulo.texto}</text>
          </g>
        ))}
        {/* Nome, área e medidas de cada ambiente. */}
        {p.ambientes.map(a => (
          <g key={`t-${a.nome}`}>
            <text x={a.x} y={a.z - 0.06} fontSize={0.17} textAnchor="middle" fill={TINTA} fontWeight={600}>{a.nome}</text>
            <text x={a.x} y={a.z + 0.14} fontSize={0.13} textAnchor="middle" fill={TINTA}>
              {a.areaPlanta != null ? `${fmtM(a.areaPlanta)} m²` : `≈ ${fmtM(a.area)} m²`}{a.estimado ? " *" : ""}
            </text>
            {a.medidas && <text x={a.x} y={a.z + 0.31} fontSize={0.11} textAnchor="middle" fill={MUDO}>{a.medidas}</text>}
          </g>
        ))}
        {p.cotas.map((c, k) => <Cota key={k} c={c} />)}
        {/* Norte e escala. */}
        {p.norte && (
          <g transform={`translate(${p.norte.x} ${p.norte.z}) rotate(${-p.norte.angulo})`}>
            <circle r={0.28} fill="none" stroke={TINTA} strokeWidth={0.012} />
            <path d="M0 0.24L0.1 -0.12L0 -0.04L-0.1 -0.12Z" fill={TINTA} />
            <text x={0} y={0.47} fontSize={0.14} textAnchor="middle" fill={TINTA} fontWeight={700}>N{p.norte.estimado ? "*" : ""}</text>
          </g>
        )}
        <g transform={`translate(${p.escala.x} ${p.escala.z})`}>
          {Array.from({ length: p.escala.metros }, (_, k) => <rect key={k} x={k} y={0} width={1} height={0.06} fill={k % 2 ? "#FFFFFF" : TINTA} stroke={TINTA} strokeWidth={0.01} />)}
          {Array.from({ length: p.escala.metros + 1 }, (_, k) => <text key={k} x={k} y={0.22} fontSize={0.12} textAnchor="middle" fill={TINTA}>{k} m</text>)}
        </g>
        <g>
          {p.legenda.map((l, k) => <text key={k} x={p.escala.x} y={p.escala.z + 0.42 + k * 0.15} fontSize={0.1} fill={MUDO}>{l}</text>)}
        </g>
      </svg>
    </figure>
  );
}

export default Planta2D;
