import { useEffect, useRef } from "react";
import type { Feature, Polygon, Position } from "geojson";
import type { LoteGerado } from "@shared/incorporacao/massa";

// Mapa Leaflet que desenha a gleba + os lotes do cenário de massa gerado.
// Lotes vendáveis em dourado (tema Prospecta); áreas públicas (doação) em verde.
// Porta direta de mapa-massa.tsx do Grupo Santa Fé.

export function MapaMassa({ geojson, lotes, height = 380 }: { geojson: string; lotes: LoteGerado[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !ref.current) return;

      if (!document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id = "leaflet-css";
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }

      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      let gleba: Feature<Polygon>;
      try {
        gleba = JSON.parse(geojson) as Feature<Polygon>;
      } catch {
        return;
      }

      const map = L.map(ref.current);
      mapRef.current = map;
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 19,
      }).addTo(map);

      const glebaLayer = L.geoJSON(gleba, {
        style: { color: "#C9A961", weight: 2, fillOpacity: 0.02 },
      }).addTo(map);

      for (const lote of lotes) {
        const latlngs = lote.anel.map((p: Position) => [p[1], p[0]] as [number, number]);
        L.polygon(latlngs, {
          color: lote.tipo === "vendavel" ? "#C9A961" : "#22c55e",
          weight: 1,
          fillColor: lote.tipo === "vendavel" ? "#C9A961" : "#22c55e",
          fillOpacity: 0.35,
        })
          .bindTooltip(`${lote.areaM2} m² · ${lote.tipo === "vendavel" ? "Lote" : "Área pública"}`)
          .addTo(map);
      }

      try {
        map.fitBounds(glebaLayer.getBounds(), { padding: [16, 16] });
      } catch { /* gleba sem bounds válidos ainda */ }
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [geojson, lotes]);

  return <div ref={ref} style={{ height, width: "100%" }} className="rounded-lg overflow-hidden" />;
}
