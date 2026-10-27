import { trpc } from "@/lib/trpc";
import { GaleriaMedicoes } from "./GaleriaMedicoes";

export function FotosObraAba({ projectId }: { projectId: number }) {
  const consulta = trpc.obraProgresso.galeria.useQuery({ projectId });
  if (consulta.isLoading) return <p role="status" className="text-slate-100">Carregando fotos…</p>;
  if (consulta.error) return <div role="alert" className="text-slate-100">{consulta.error.message}<button type="button" onClick={() => consulta.refetch()}>Tentar novamente</button></div>;
  const { fotos = [], medicoes = [] } = consulta.data ?? {};
  return <section className="space-y-6 rounded-xl border border-[#C9A961]/30 bg-[#1A2332] p-5 text-slate-100">
    <div><h2 className="text-xl font-semibold text-[#C9A961]">Galeria de Fotos</h2><p className="text-sm text-slate-300">Fotos organizadas por medição. Para adicionar ou alterar fotos, use a aba Progresso.</p></div>
    <GaleriaMedicoes fotos={fotos} medicoes={medicoes} />
  </section>;
}
