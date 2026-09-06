import { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Upload, MapPinned, Ruler, Mountain, Loader2 } from "lucide-react";
import { MapaTerreno } from "./MapaTerreno";
import {
  declividadeGrade, declividadeMedia, distribuicaoDeclividade, celulaEmMetros,
} from "@shared/geo/relevo";
import type { Feature, Polygon } from "geojson";

interface GridElevacao {
  ncols: number; nrows: number; z: number[][]; min: number; max: number;
  cellsizeX: number; cellsizeY: number; west: number; south: number; fonte: string;
}

function hectares(m2: number) {
  if (!m2) return "—";
  return `${(m2 / 10_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ha`;
}

function bboxDoGeojson(geojson: string) {
  const f = JSON.parse(geojson) as Feature<Polygon>;
  const anel = f.geometry.coordinates[0];
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const [lng, lat] of anel) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { west, east, south, north };
}

function ElevationHeatmap({ grid }: { grid: GridElevacao }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = 280;

  useMemo(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = grid.ncols;
    canvas.height = grid.nrows;
    const range = grid.max - grid.min || 1;
    const img = ctx.createImageData(grid.ncols, grid.nrows);
    for (let r = 0; r < grid.nrows; r++) {
      for (let c = 0; c < grid.ncols; c++) {
        const t = (grid.z[r][c] - grid.min) / range;
        // Azul (baixo) -> verde -> amarelo -> marrom (alto), igual à legenda usada no Santa Fé
        const stops: [number, [number, number, number]][] = [
          [0, [44, 111, 187]], [0.35, [63, 157, 138]], [0.6, [99, 164, 95]],
          [0.8, [154, 165, 90]], [0.92, [179, 152, 95]], [1, [138, 106, 69]],
        ];
        let color: [number, number, number] = stops[0][1];
        for (let i = 0; i < stops.length - 1; i++) {
          if (t >= stops[i][0] && t <= stops[i + 1][0]) {
            const localT = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0] || 1);
            color = [0, 1, 2].map((k) =>
              Math.round(stops[i][1][k] + (stops[i + 1][1][k] - stops[i][1][k]) * localT)
            ) as [number, number, number];
            break;
          }
        }
        const idx = (r * grid.ncols + c) * 4;
        img.data[idx] = color[0];
        img.data[idx + 1] = color[1];
        img.data[idx + 2] = color[2];
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [grid]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, imageRendering: "pixelated" }}
      className="border border-[#C9A961]/20 rounded"
    />
  );
}

export function TerrenoTopografia({ estudoId, geojson, areaM2, perimeterM, elevationJson }: {
  estudoId: number;
  geojson: string | null;
  areaM2: string;
  perimeterM: string;
  elevationJson: string | null;
}) {
  const utils = trpc.useUtils();
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [grid, setGrid] = useState<GridElevacao | null>(elevationJson ? JSON.parse(elevationJson) : null);

  const uploadKmlMutation = trpc.incorporacao.uploadKml.useMutation({
    onSuccess: () => {
      toast.success("Terreno carregado!");
      utils.incorporacao.getById.invalidate({ id: estudoId });
    },
    onError: (e) => toast.error(e.message),
  });

  const fetchElevationMutation = trpc.incorporacao.fetchElevation.useMutation({
    onSuccess: (data) => {
      setGrid(data);
      toast.success("Topografia gerada!");
      utils.incorporacao.getById.invalidate({ id: estudoId });
    },
    onError: (e) => toast.error(e.message),
  });

  const handleKmlSelect = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      await uploadKmlMutation.mutateAsync({ id: estudoId, kmlContent: text });
    } finally {
      setBusy(false);
    }
  };

  const gerarTopografia = () => {
    if (!geojson) return;
    const bbox = bboxDoGeojson(geojson);
    fetchElevationMutation.mutate({ id: estudoId, ...bbox });
  };

  const latCentro = useMemo(() => {
    if (!geojson) return -5.526;
    const b = bboxDoGeojson(geojson);
    return (b.south + b.north) / 2;
  }, [geojson]);

  const slopes = useMemo(() => {
    if (!grid) return null;
    const { x, y } = celulaEmMetros(grid.cellsizeX, grid.cellsizeY, latCentro);
    return declividadeGrade(grid, x, y);
  }, [grid, latCentro]);

  const distribuicao = useMemo(() => (slopes ? distribuicaoDeclividade(slopes) : []), [slopes]);
  const declivMedia = useMemo(() => (slopes ? declividadeMedia(slopes) : 0), [slopes]);
  const amplitude = grid ? Math.round(grid.max - grid.min) : 0;

  const temTerreno = !!geojson;
  const centro = useMemo(() => {
    if (!geojson) return undefined;
    const b = bboxDoGeojson(geojson);
    return [(b.south + b.north) / 2, (b.west + b.east) / 2] as [number, number];
  }, [geojson]);

  return (
    <div className="space-y-6">
      <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-white text-lg">Terreno</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <input ref={inputRef} type="file" accept=".kml" className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) handleKmlSelect(e.target.files[0]); }} />
            <Button onClick={() => inputRef.current?.click()} disabled={busy}
              className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
              <Upload className="h-4 w-4 mr-2" />
              {busy ? "Processando..." : temTerreno ? "Trocar KML" : "Enviar KML do terreno"}
            </Button>
            <span className="text-xs text-gray-500">Formato .kml (polígono do terreno)</span>
          </div>

          {temTerreno ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Metric icon={MapPinned} label="Área" value={hectares(parseFloat(areaM2))} sub={`${parseFloat(areaM2).toLocaleString("pt-BR")} m²`} />
                <Metric icon={Ruler} label="Perímetro" value={`${parseFloat(perimeterM).toLocaleString("pt-BR")} m`} />
                <Metric icon={MapPinned} label="Centro" value={centro ? `${centro[0].toFixed(5)}, ${centro[1].toFixed(5)}` : "—"} />
              </div>
              <MapaTerreno geojson={geojson!} center={centro} estudoId={estudoId} />
            </>
          ) : (
            <div className="border border-dashed border-[#C9A961]/30 rounded-lg p-10 text-center">
              <MapPinned className="h-8 w-8 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400 font-medium">Nenhum terreno carregado</p>
              <p className="text-gray-500 text-sm mt-1">Envie o KML para desenhar o polígono e calcular área e perímetro.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-white text-lg">Topografia</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={gerarTopografia} disabled={!temTerreno || fetchElevationMutation.isPending}
            className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
            {fetchElevationMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mountain className="h-4 w-4 mr-2" />}
            {fetchElevationMutation.isPending ? "Processando relevo..." : grid ? "Regenerar topografia" : "Gerar topografia"}
          </Button>
          {!temTerreno && <p className="text-xs text-gray-500">Envie o KML do terreno primeiro.</p>}

          {grid ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Metric label="Cota mínima" value={`${Math.round(grid.min)} m`} />
                <Metric label="Cota máxima" value={`${Math.round(grid.max)} m`} />
                <Metric label="Desnível" value={`${amplitude} m`} />
                <Metric label="Declividade média" value={`${declivMedia.toFixed(1)}%`} />
              </div>
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                <ElevationHeatmap grid={grid} />
                <div className="flex-1 space-y-1.5 w-full">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Distribuição de declividades</p>
                  {distribuicao.map((f) => (
                    <div key={f.chave} className="flex items-center gap-2">
                      <span className="w-28 text-xs text-gray-400 shrink-0">{f.label}</span>
                      <div className="flex-1 bg-[#2C3E50] h-3 rounded overflow-hidden">
                        <div className="h-full" style={{ width: `${(f.pct * 100).toFixed(1)}%`, background: f.corHex }} />
                      </div>
                      <span className="w-12 text-right text-xs font-bold text-white">{(f.pct * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-[10px] text-gray-500">
                Fonte: {grid.fonte}. Mapa de calor da elevação (baixo → azul, alto → marrom). Declividade por diferenças centrais sobre o DEM.
                Visualização simplificada em 2D — sem viewer 3D interativo, para não depender de uma biblioteca gráfica pesada nova.
              </p>
            </>
          ) : (
            <div className="border border-dashed border-[#C9A961]/30 rounded-lg p-10 text-center">
              <Mountain className="h-8 w-8 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400 font-medium">Topografia ainda não gerada</p>
              <p className="text-gray-500 text-sm mt-1">Gere o relevo a partir do terreno carregado.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value, sub, icon: Icon }: { label: string; value: string; sub?: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="bg-[#0F1923] border border-[#C9A961]/10 rounded-lg p-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{label}</p>
        {Icon && <Icon className="h-3.5 w-3.5 text-gray-600" />}
      </div>
      <p className="font-black text-white text-base leading-none">{value}</p>
      {sub && <p className="text-[10px] text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}
