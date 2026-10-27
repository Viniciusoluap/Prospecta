import { agruparFotos, type FotoGaleria, type MedicaoGaleria } from "@shared/galeria-medicoes";

/**
 * Galeria de fotos agrupadas por medição (nº da medição, % na medição, % acumulado,
 * quantidade de fotos e fotos com legenda). Componente único usado em Editar Obra
 * (FotosObraAba) e em Detalhes da Obra (Lote 02, correção 02). Só exibe: a gestão
 * das fotos continua no fluxo Progresso/Medições.
 */
export function GaleriaMedicoes({ fotos, medicoes, vazio = "Nenhuma foto adicionada às medições desta obra." }: {
  fotos: FotoGaleria[];
  medicoes: MedicaoGaleria[];
  vazio?: string;
}) {
  const { grupos, antigas } = agruparFotos(fotos, medicoes);
  const pct = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  const renderFotos = (lista: FotoGaleria[]) => <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{lista.map(f => <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-current/20 overflow-hidden" aria-label={f.legenda || "Abrir foto da obra"}>
    {/* URLs autenticadas; carregamento sob demanda mantém a galeria leve. */}
    <img src={f.url} alt={f.legenda || "Foto da obra"} loading="lazy" className="h-40 w-full object-cover" />
    {f.legenda && <p className="p-2 text-sm break-words">{f.legenda}</p>}
  </a>)}</div>;
  return <div className="space-y-6">
    {grupos.map(g => <section key={g.id} className="space-y-3"><h3 className="font-semibold">{g.titulo} — {pct(g.avancou)}% nesta medição</h3><p className="text-sm text-slate-300">{pct(g.progresso)}% acumulado · Lote de {g.fotos.length} foto(s)</p>{renderFotos(g.fotos)}</section>)}
    {antigas.length > 0 && <section className="space-y-3"><h3 className="font-semibold">Fotos anteriores — sem medição vinculada</h3>{renderFotos(antigas)}</section>}
    {!grupos.length && !antigas.length && <p className="text-sm text-slate-300">{vazio}</p>}
  </div>;
}
