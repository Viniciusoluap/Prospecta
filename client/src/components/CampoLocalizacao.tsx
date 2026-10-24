import { useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { EXEMPLOS_LOCALIZACAO, interpretarLocalizacao } from "@shared/geo/localizacao";

/**
 * Pedido de 18/10 (item 7): marca o ponto colando coordenadas em qualquer
 * formato ou o link do mapa (Google, Waze, Apple, OpenStreetMap, Plus Code).
 * Link curto do Google é aberto pelo servidor.
 */
export function CampoLocalizacao({
  coords,
  onChange,
  onResolvendo,
  className = "",
}: {
  coords: { lat: number; lng: number } | null;
  onChange: (coords: { lat: number; lng: number } | null) => void;
  /** Avisa o formulário enquanto um link curto é aberto, para não salvar o ponto antigo. */
  onResolvendo?: (resolvendo: boolean) => void;
  className?: string;
}) {
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const resolver = trpc.geo.resolverLinkCurto.useMutation();
  // Sair do campo e clicar em "Marcar" disparam juntos: o link curto é resolvido uma vez só.
  const resolvendo = useRef(false);

  const aplicar = async () => {
    const lido = interpretarLocalizacao(texto);
    if (lido.ok) {
      setErro(null);
      setTexto("");
      onChange({ lat: lido.lat, lng: lido.lng });
      return;
    }
    if ("linkCurto" in lido) {
      if (resolvendo.current) return;
      resolvendo.current = true;
      onResolvendo?.(true);
      try {
        const ponto = await resolver.mutateAsync({ url: lido.linkCurto });
        setErro(null);
        setTexto("");
        onChange(ponto);
        toast.success("Localização lida do link do mapa.");
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível abrir o link.");
      } finally {
        resolvendo.current = false;
        onResolvendo?.(false);
      }
      return;
    }
    setErro(lido.erro);
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={texto}
          onChange={e => {
            const valor = e.target.value;
            setTexto(valor);
            setErro(null);
            // Pedido de 23/10: o ponto colado vale na hora, sem depender do botão "Marcar".
            const lido = interpretarLocalizacao(valor);
            if (lido.ok) onChange({ lat: lido.lat, lng: lido.lng });
          }}
          onBlur={() => {
            // Link curto do Google (maps.app.goo.gl) precisa ser aberto pelo servidor.
            if (texto.trim() && !interpretarLocalizacao(texto).ok) void aplicar();
          }}
          onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault();
              void aplicar();
            }
          }}
          aria-label="Localização: coordenadas ou link do mapa"
          placeholder="Cole coordenadas, link do Google Maps, Waze, Apple Maps ou Plus Code"
          className={`min-w-0 flex-1 bg-[#2C3E50] text-white placeholder:text-gray-400 ${erro ? "border-red-500" : "border-[#C9A961]/30"}`}
        />
        <Button
          type="button"
          onClick={() => void aplicar()}
          disabled={!texto.trim() || resolver.isPending}
          className="bg-[#C9A961] font-bold text-[#1A2332] hover:bg-[#B8985A]"
        >
          {resolver.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Marcar"}
        </Button>
      </div>
      {erro ? (
        <p className="text-xs text-red-300" role="alert">{erro}</p>
      ) : (
        <p className="text-xs text-gray-300">Aceita, por exemplo: {EXEMPLOS_LOCALIZACAO.join(" · ")}</p>
      )}
      {coords && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-gray-200">
          <MapPin className="h-3.5 w-3.5 text-[#C9A961]" />
          {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
          <a
            className="ml-1 text-[#C9A961] underline"
            href={`https://www.google.com/maps?q=${coords.lat},${coords.lng}`}
            target="_blank"
            rel="noreferrer"
          >
            Conferir no mapa
          </a>
          <button type="button" onClick={() => onChange(null)} className="ml-1 text-red-300 underline hover:text-red-200">
            Remover
          </button>
        </p>
      )}
    </div>
  );
}
