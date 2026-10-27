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
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { rotulo } from "@shared/rotulos";
import { CAMADAS_MAPA, CATEGORIAS_PONTO, categoriaDoPonto, coordenadaValida } from "@shared/mapa-alfinetes";
import { adicionarCamadas, alfinete, carregarLeaflet, criarGrupoDePontos, enquadrar } from "@/lib/mapa-leaflet";

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

/**
 * Lote 02, correção 05: satélite (Esri) com ruas e rótulos ou mapa (OSM),
 * alfinetes por tipo/status, agrupamento que se separa no zoom, pontos
 * sobrepostos em leque e enquadramento automático. Só pontos com coordenadas
 * válidas do cadastro entram no mapa (nada é inventado).
 */
function PropertyMap({ points }: { points: Point[] }) {
  const container = useRef<HTMLDivElement>(null);
  const motor = useRef<{ L: typeof import("leaflet"); map: import("leaflet").Map; grupo: import("leaflet").FeatureGroup } | null>(null);
  const [pronto, setPronto] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    void carregarLeaflet()
      .then(({ L, agrupa }) => {
        if (disposed || !container.current) return;
        const map = L.map(container.current, { maxZoom: CAMADAS_MAPA.maxZoom }).setView([-14.2, -51.9], 4);
        adicionarCamadas(L, map, () =>
          setError("Parte do mapa base está indisponível. A lista de imóveis continua acessível abaixo.")
        );
        const grupo = criarGrupoDePontos(L, agrupa).addTo(map);
        motor.current = { L, map, grupo };
        setPronto(true);
      })
      .catch(() =>
        setError("Não foi possível carregar o mapa. Consulte a lista abaixo.")
      );
    return () => {
      disposed = true;
      motor.current?.map.remove();
      motor.current = null;
    };
  }, []);
  useEffect(() => {
    const m = motor.current;
    if (!pronto || !m) return;
    m.grupo.clearLayers();
    const located = points.flatMap(p => {
      const c = p.hasCoordinates ? coordenadaValida(p.latitude, p.longitude) : null;
      return c ? [{ p, lat: c[0], lng: c[1] }] : [];
    });
    located.forEach(({ p, lat, lng }) => {
      const categoria = categoriaDoPonto(p);
      const popup = document.createElement("div");
      const tipo = document.createElement("small");
      tipo.textContent = CATEGORIAS_PONTO[categoria].rotulo + (p.kind === "obra" ? "" : ` · ${rotulo(p.type)}`);
      const title = document.createElement("strong");
      title.style.display = "block";
      title.textContent = p.title;
      const value = document.createElement("p");
      value.textContent = p.price === null ? "Valor não informado" : money(p.price);
      const endereco = document.createElement("p");
      endereco.textContent = p.address ?? "Endereço não informado";
      popup.append(tipo, title, value, endereco);
      m.grupo.addLayer(alfinete(m.L, { lat, lng, categoria, popup }));
    });
    enquadrar(m.L, m.map, located);
  }, [points, pronto]);
  return (
    <section aria-label="Mapa dos imóveis e obras" className="space-y-2">
      <div className="relative z-0 h-[420px] sm:h-[520px] rounded border" ref={container} />
      <ul className="flex flex-wrap gap-3 text-sm" aria-label="Legenda do mapa">
        {(["disponivel", "reservado", "obra"] as const).map(c => (
          <li key={c} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-3 w-3 rounded-full border border-white" style={{ background: CATEGORIAS_PONTO[c].cor }} />
            {CATEGORIAS_PONTO[c].rotulo}
          </li>
        ))}
        <li className="opacity-80">Números = pontos agrupados (aproxime para separar)</li>
      </ul>
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
