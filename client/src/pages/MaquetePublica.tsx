// Maquete 3D (EPIC-022, etapa 2) — página pública do link entregue ao cliente: /maquete/<token>.
// Só abre maquete publicada pelo administrador. O visualizador 3D é carregado sob demanda.
import { Suspense, lazy } from "react";
import { useRoute } from "wouter";
import { trpc } from "@/lib/trpc";

const Visualizador = lazy(() => import("@/components/maquete-3d/visualizador/Visualizador"));

function Aviso({ texto }: { texto: string }) {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-[#0B1022] p-6 text-center text-gray-300">{texto}</div>;
}

export default function MaquetePublica() {
  const [, params] = useRoute("/maquete/:token");
  const maquete = trpc.maquetePublica.porToken.useQuery({ token: params?.token ?? "" }, { enabled: !!params?.token, retry: false, refetchOnWindowFocus: false });
  if (maquete.isLoading) return <Aviso texto="Carregando a maquete…" />;
  if (!maquete.data) return <Aviso texto="Esta maquete não está disponível. Confira o link com o seu consultor." />;
  const c = maquete.data.comercial;
  return (
    <Suspense fallback={<Aviso texto="Preparando o 3D…" />}>
      <Visualizador modelo={maquete.data.modelo} unidades={maquete.data.unidades} comercial={{ nome: maquete.data.titulo, logo: "/logo.webp", localizacao: c.localizacao || null, preco: c.preco, whatsapp: c.whatsapp || null }} />
    </Suspense>
  );
}
