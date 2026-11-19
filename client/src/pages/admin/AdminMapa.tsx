import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import {
  Choice,
  Field,
  inputClass,
  money,
  OperationalPage,
  Rows,
} from "./OperationalUI";
import type { Map as MapaMl } from "maplibre-gl";
import { rotulo } from "@shared/rotulos";
import { CATEGORIAS_PONTO, categoriaDoPonto, chaveDoMarcador, coordenadaValida, estiloAgrupamento, htmlAlfinete, limitesDosPontos } from "@shared/mapa-alfinetes";
import { aplicarBase, criarMapaBase, type BaseMapa } from "@/components/incorporacao/estudo/mapa-base-ml";

type Point = {
  id: number;
  kind: string;
  status: string;
  type: string;
  title: string;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  price: string | null;
  hasCoordinates: boolean;
};

/** Popup de um ponto, montado com textContent (nada do cadastro vira HTML). */
function cartaoDoPonto(p: Point): HTMLElement {
  const categoria = categoriaDoPonto(p);
  const caixa = document.createElement("div");
  caixa.style.cssText = "font:13px/1.35 sans-serif;color:#1A2332;min-width:170px";
  const tipo = document.createElement("small");
  tipo.style.cssText = `display:block;font-weight:700;color:${CATEGORIAS_PONTO[categoria].cor}`;
  tipo.textContent = CATEGORIAS_PONTO[categoria].rotulo + (p.kind === "obra" ? "" : ` · ${rotulo(p.type)}`);
  const titulo = document.createElement("strong");
  titulo.style.display = "block";
  titulo.textContent = p.title;
  const valor = document.createElement("div");
  valor.textContent = p.price === null ? "Valor não informado" : money(p.price);
  const endereco = document.createElement("div");
  endereco.style.color = "#4b5563";
  endereco.textContent = p.address ?? "Endereço não informado";
  caixa.append(tipo, titulo, valor, endereco);
  return caixa;
}

const BRASIL: [number, number, number, number] = [-74, -34, -34, 5.5];
const FONTE = "pontos";

/**
 * EPIC-023 (S-B, pedido do dono de 15/11): o Mapa operacional usa a mesma base nova da Incorporação
 * (MapLibre GL — satélite Mapbox quando há token, senão Esri no zoom nativo, tela retina). Mantém:
 * alfinetes por tipo/status, agrupamento que se separa ao aproximar, enquadramento automático e
 * Satélite/Ruas. Pontos no mesmo endereço abrem numa lista (no lugar do "leque" do Leaflet).
 * Só pontos com coordenadas válidas do cadastro entram no mapa (nada é inventado).
 */
function PropertyMap({ points }: { points: Point[] }) {
  const container = useRef<HTMLDivElement>(null);
  const motor = useRef<{ ml: typeof import("maplibre-gl"); map: MapaMl; limparMarcadores: () => void } | null>(null);
  // Geração dos dados da fonte: muda a cada setData (filtro/busca), para nenhum marcador antigo ser reaproveitado.
  const geracao = useRef(0);
  const porId = useRef(new Map<string, Point>());
  const [pronto, setPronto] = useState(false);
  const [base, setBase] = useState<BaseMapa>("satelite");
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelado = false;
    let limpar = () => {};
    void (async () => {
      const el = container.current;
      if (!el) return;
      const [criado, ml] = await Promise.all([
        criarMapaBase(el, BRASIL, { cancelado: () => cancelado }),
        import("maplibre-gl").then(m => (m.default ?? m) as typeof import("maplibre-gl")),
      ]);
      if (!criado || cancelado) { criado?.map.remove(); return; }
      const { map } = criado;
      setInfo(criado.info);
      const marcadores = new Map<string, import("maplibre-gl").Marker>();
      let popup: import("maplibre-gl").Popup | null = null;
      const abrir = (lngLat: [number, number], conteudo: HTMLElement) => {
        popup?.remove();
        popup = new ml.Popup({ offset: 18, maxWidth: "260px" }).setLngLat(lngLat).setDOMContent(conteudo).addTo(map);
      };
      const aoClicarNoGrupo = async (id: number, lngLat: [number, number], total: number) => {
        const fonte = map.getSource(FONTE) as import("maplibre-gl").GeoJSONSource;
        const zoom = await fonte.getClusterExpansionZoom(id);
        if (zoom <= map.getMaxZoom() && map.getZoom() < map.getMaxZoom() - 0.2) { map.easeTo({ center: lngLat, zoom: Math.min(zoom, map.getMaxZoom()) }); return; }
        // Mesmo endereço (não separa aproximando): lista todos os pontos do grupo.
        const folhas = await fonte.getClusterLeaves(id, Math.min(total, 60), 0);
        const lista = document.createElement("div");
        lista.style.cssText = "max-height:240px;overflow:auto;display:grid;gap:10px";
        for (const f of folhas) { const p = porId.current.get(String(f.properties?.chave)); if (p) lista.append(cartaoDoPonto(p)); }
        abrir(lngLat, lista);
      };
      const atualizar = () => {
        if (!map.getSource(FONTE) || !map.isSourceLoaded(FONTE)) return;
        const vistos = new Set<string>();
        for (const f of map.querySourceFeatures(FONTE)) {
          const geometria = f.geometry;
          if (geometria.type !== "Point") continue;
          const lngLat = geometria.coordinates as [number, number];
          const agrupado = !!f.properties?.cluster;
          const chave = chaveDoMarcador(f.properties, geracao.current);
          if (vistos.has(chave)) continue;
          vistos.add(chave);
          if (marcadores.has(chave)) continue;
          const el2 = document.createElement("button");
          el2.type = "button";
          el2.style.cssText = "background:none;border:0;padding:0;cursor:pointer";
          let ancora: "center" | "bottom" = "bottom";
          if (agrupado) {
            const total = Number(f.properties.point_count);
            const { texto, tamanho } = estiloAgrupamento(total);
            el2.setAttribute("aria-label", `${texto} pontos agrupados`);
            el2.style.cssText += `;width:${tamanho}px;height:${tamanho}px;border-radius:9999px;background:#1A2332;color:#fff;border:3px solid #C9A961;font:700 13px sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.45)`;
            el2.textContent = texto;
            el2.onclick = () => void aoClicarNoGrupo(Number(f.properties.cluster_id), lngLat, total);
            ancora = "center";
          } else {
            const p = porId.current.get(String(f.properties?.chave));
            if (!p) continue;
            el2.innerHTML = htmlAlfinete(categoriaDoPonto(p));
            el2.style.filter = "drop-shadow(0 2px 3px rgba(0,0,0,.45))";
            el2.onclick = () => abrir(lngLat, cartaoDoPonto(p));
          }
          marcadores.set(chave, new ml.Marker({ element: el2, anchor: ancora }).setLngLat(lngLat).addTo(map));
        }
        marcadores.forEach((m, chave) => { if (!vistos.has(chave)) { m.remove(); marcadores.delete(chave); } });
      };
      map.on("load", () => {
        map.addSource(FONTE, { type: "geojson", data: { type: "FeatureCollection", features: [] }, cluster: true, clusterRadius: 48, clusterMaxZoom: 22 });
        // Camada invisível: mantém os ladrilhos da fonte carregados para a consulta dos pontos visíveis.
        map.addLayer({ id: "pontos-base", type: "circle", source: FONTE, paint: { "circle-radius": 1, "circle-opacity": 0 } });
        motor.current = { ml, map, limparMarcadores: () => { marcadores.forEach(mk => mk.remove()); marcadores.clear(); } };
        setPronto(true);
      });
      map.on("render", atualizar);
      map.on("error", () => setError("Parte do mapa base está indisponível. A lista de imóveis continua acessível abaixo."));
      limpar = () => { popup?.remove(); marcadores.forEach(m => m.remove()); map.remove(); };
      if (cancelado) limpar();
    })().catch(() => setError("Não foi possível carregar o mapa. Consulte a lista abaixo."));
    return () => { cancelado = true; motor.current = null; limpar(); };
  }, []);

  useEffect(() => { if (pronto && motor.current) aplicarBase(motor.current.map, base); }, [base, pronto]);

  useEffect(() => {
    const m = motor.current;
    if (!pronto || !m) return;
    porId.current = new Map();
    // Revisão do PR #263 do Santa Fé: dados novos → marcadores do conjunto anterior saem (o cluster_id se repete).
    geracao.current += 1;
    m.limparMarcadores();
    const pontos = points.flatMap(p => {
      const c = p.hasCoordinates ? coordenadaValida(p.latitude, p.longitude) : null;
      if (!c) return [];
      const chave = `${p.kind}-${p.id}`;
      porId.current.set(chave, p);
      return [{ chave, lat: c[0], lng: c[1] }];
    });
    (m.map.getSource(FONTE) as import("maplibre-gl").GeoJSONSource).setData({
      type: "FeatureCollection",
      features: pontos.map(p => ({ type: "Feature" as const, properties: { chave: p.chave }, geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] } })),
    });
    const limites = limitesDosPontos(pontos);
    if (!limites) return;
    if (pontos.length === 1) m.map.easeTo({ center: [pontos[0].lng, pontos[0].lat], zoom: Math.min(17, m.map.getMaxZoom()) });
    else m.map.fitBounds([[limites[0], limites[1]], [limites[2], limites[3]]], { padding: 56, maxZoom: Math.min(17, m.map.getMaxZoom()) });
  }, [points, pronto]);

  return (
    <section aria-label="Mapa dos imóveis e obras" className="space-y-2">
      <div className="relative z-0">
        <div className="h-[60vh] min-h-[420px] overflow-hidden rounded border bg-gray-100" ref={container} data-testid="mapa-operacional" />
        <div className="absolute left-2 top-2 flex overflow-hidden rounded border border-gray-300 bg-white text-xs font-bold shadow-sm">
          {(["satelite", "ruas"] as const).map(b => (
            <button key={b} type="button" aria-pressed={base === b} onClick={() => setBase(b)}
              className={`px-3 py-1.5 ${base === b ? "bg-[#1A2332] text-[#C9A961]" : "text-gray-600 hover:bg-gray-50"}`}>
              {b === "satelite" ? "Satélite" : "Ruas"}
            </button>
          ))}
        </div>
      </div>
      <ul className="flex flex-wrap gap-3 text-sm" aria-label="Legenda do mapa">
        {(["disponivel", "reservado", "obra"] as const).map(c => (
          <li key={c} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-3 w-3 rounded-full border border-white" style={{ background: CATEGORIAS_PONTO[c].cor }} />
            {CATEGORIAS_PONTO[c].rotulo}
          </li>
        ))}
        <li className="opacity-80">Números = pontos agrupados (toque para aproximar; no mesmo endereço, abre a lista)</li>
      </ul>
      {info && <p className="text-xs opacity-70">{info}</p>}
      {error && (
        <p role="alert" className="p-3 text-amber-800">
          {error}
        </p>
      )}
    </section>
  );
}
export default function AdminMapa() {
  const list = trpc.mapa.list.useQuery();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  // Memorizado: o mapa só reenquadra quando a lista filtrada muda de fato.
  const rows = useMemo(() => (list.data || []).filter(
    p =>
      `${p.title} ${p.address ?? ""} ${p.city ?? ""} ${p.neighborhood ?? ""} ${p.type}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!status || p.status === status)
  ), [list.data, search, status]);
  return (
    <OperationalPage
      title="Mapa operacional"
      description="Imóveis disponíveis e reservados e obras com localização (do imóvel vinculado ou da PCI da CAIXA). Vendidos e alugados ficam fora deste mapa. Coordenadas ausentes não são inventadas."
      loading={list.isLoading}
      error={list.error}
      retry={() => void list.refetch()}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Buscar endereço, cidade, bairro, título ou tipo">
          <input
            className={inputClass}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </Field>
        <Choice
          label="Status"
          optional
          emptyLabel="Todos"
          value={status}
          onChange={setStatus}
          options={[
            { value: "disponivel", label: "Disponível" },
            { value: "reservado", label: "Reservado" },
            { value: "obra", label: "Obra (localização da PCI)" },
          ]}
        />
      </div>
      <p>
        {rows.filter(p => p.hasCoordinates).length} pontos no mapa ·{" "}
        {rows.filter(p => !p.hasCoordinates).length} sem coordenadas válidas
      </p>
      <PropertyMap points={rows} />
      <Rows
        headers={["Imóvel", "Endereço", "Valor", "Status", "Coordenadas"]}
        empty={!rows.length}
      >
        {rows.map(p => (
          <tr key={p.key}>
            <td>
              {p.obraId ? <Link href={`/admin/obras/${p.obraId}`} className="underline">{p.title}</Link> : p.title}
              <br />
              {p.kind === "obra" ? "Obra" : rotulo(p.type)}
            </td>
            <td>{p.address ?? "Endereço não informado"}</td>
            <td>{p.price === null ? "—" : money(p.price)}</td>
            <td>{p.kind === "obra" ? "Obra (PCI)" : rotulo(p.status)}</td>
            <td>
              {p.hasCoordinates
                ? `${p.latitude}, ${p.longitude}`
                : "Cadastrar no módulo Imóveis"}
            </td>
          </tr>
        ))}
      </Rows>
      <Link href="/admin/imoveis" className="inline-block underline">
        Gerenciar imóveis (requer permissão Imóveis)
      </Link>
    </OperationalPage>
  );
}
