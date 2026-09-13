import { useEffect, useRef, useState } from "react";
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

type Point = {
  id: number;
  title: string;
  latitude: string | null;
  longitude: string | null;
  price: string;
  hasCoordinates: boolean;
};
function PropertyMap({ points }: { points: Point[] }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    let map: import("leaflet").Map | undefined;
    setError("");
    void import("leaflet")
      .then(({ default: L }) => {
        if (disposed || !container.current) return;
        map = L.map(container.current).setView([-14.2, -51.9], 4);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        })
          .on("tileerror", () =>
            setError(
              "O mapa base está indisponível. A lista de imóveis continua acessível abaixo."
            )
          )
          .addTo(map);
        const located = points.filter(p => p.hasCoordinates);
        located.forEach(p => {
          const popup = document.createElement("div");
          const title = document.createElement("strong");
          title.textContent = p.title;
          const value = document.createElement("p");
          value.textContent = money(p.price);
          popup.append(title, value);
          L.circleMarker([Number(p.latitude), Number(p.longitude)], {
            radius: 8,
            color: "#906a25",
            fillOpacity: 0.8,
          })
            .bindPopup(popup)
            .addTo(map!);
        });
        if (located.length)
          map.fitBounds(
            L.latLngBounds(
              located.map(p => [Number(p.latitude), Number(p.longitude)])
            ),
            { padding: [30, 30], maxZoom: 15 }
          );
      })
      .catch(() =>
        setError("Não foi possível carregar o mapa. Consulte a lista abaixo.")
      );
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [points]);
  return (
    <section aria-label="Mapa dos imóveis">
      <div className="relative z-0 h-[420px] rounded border" ref={container} />
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
  const rows = (list.data || []).filter(
    p =>
      `${p.title} ${p.city} ${p.neighborhood} ${p.type}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!status || p.status === status)
  );
  return (
    <OperationalPage
      title="Mapa operacional"
      description="Imóveis disponíveis e reservados. Vendidos e alugados ficam fora deste mapa. Coordenadas ausentes não são inventadas."
      loading={list.isLoading}
      error={list.error}
      retry={() => void list.refetch()}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Buscar cidade, bairro, título ou tipo">
          <input
            className={inputClass}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </Field>
        <Choice
          label="Status"
          optional
          value={status}
          onChange={setStatus}
          options={[
            { value: "disponivel", label: "Disponível" },
            { value: "reservado", label: "Reservado" },
          ]}
        />
      </div>
      <p>
        {rows.filter(p => p.hasCoordinates).length} imóveis no mapa ·{" "}
        {rows.filter(p => !p.hasCoordinates).length} sem coordenadas válidas
      </p>
      <PropertyMap points={rows} />
      <Rows
        headers={["Imóvel", "Localização", "Valor", "Status", "Coordenadas"]}
        empty={!rows.length}
      >
        {rows.map(p => (
          <tr key={p.id}>
            <td>
              {p.title}
              <br />
              {p.type}
            </td>
            <td>
              {p.neighborhood} — {p.city}
            </td>
            <td>{money(p.price)}</td>
            <td>{p.status}</td>
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
