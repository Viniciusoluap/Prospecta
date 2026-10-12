import { useEffect, useRef, type RefObject } from "react";
import type { Feature, Polygon, Position } from "geojson";
import type { LoteGerado } from "@shared/incorporacao/massa";

// Mapa Leaflet que desenha a gleba + os lotes do cenário de massa gerado.
// Lotes vendáveis em dourado (tema Prospecta); áreas públicas (doação) em verde.
// Porta direta de mapa-massa.tsx do Grupo Santa Fé.
//
// Ciclo de vida: a instância do Leaflet só é criada depois que o cleanup do
// efeito anterior (se houver) já rodou — React sempre executa o cleanup do
// efeito anterior antes do próximo efeito, então `mapRef` nunca aponta para
// duas instâncias vivas ao mesmo tempo. `removerMapaComSeguranca` é chamada
// tanto no cleanup quanto antes de criar uma nova instância; ela é
// idempotente (não faz nada se já não houver mapa) e nunca deixa uma
// exceção do Leaflet escapar do efeito — o que, sem isso, seria capturado
// pelo ErrorBoundary de topo da aplicação e derrubaria a página inteira ao
// regenerar um cenário.
function removerMapaComSeguranca(mapRef: RefObject<import("leaflet").Map | null>) {
  if (!mapRef.current) return;
  try {
    mapRef.current.remove();
  } catch (e) {
    console.error("Falha ao remover instância do mapa de massa (ignorada):", e);
  } finally {
    mapRef.current = null;
  }
}

export function MapaMassa({ geojson, lotes, height = 380 }: { geojson: string; lotes: LoteGerado[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const L = (await import("leaflet")).default;
        if (cancelled || !ref.current) return;

        if (!document.getElementById("leaflet-css")) {
          const link = document.createElement("link");
          link.id = "leaflet-css";
          link.rel = "stylesheet";
          link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
          document.head.appendChild(link);
        }

        // Garante que só existe uma instância viva por montagem: remove
        // qualquer mapa remanescente antes de criar o novo (idempotente —
        // não faz nada se o cleanup anterior já tiver removido).
        removerMapaComSeguranca(mapRef);
        if (cancelled || !ref.current) return;

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
      } catch (e) {
        // Qualquer falha inesperada ao desenhar o mapa (ex.: geometria de
        // lote degenerada) não deve propagar para fora do efeito — isso
        // derrubaria a página inteira via ErrorBoundary ao regenerar um
        // cenário. O card continua utilizável mesmo sem o mapa.
        console.error("Erro ao desenhar o mapa de massa:", e);
        removerMapaComSeguranca(mapRef);
      }
    })();

    return () => {
      cancelled = true;
      removerMapaComSeguranca(mapRef);
    };
  }, [geojson, lotes]);

  return <div ref={ref} style={{ height, width: "100%" }} className="rounded-lg overflow-hidden" />;
}
