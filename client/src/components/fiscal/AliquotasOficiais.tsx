// EPIC-029 S-7 — "Buscar alíquotas oficiais" de um tipo de serviço: consulta os parâmetros municipais da Sefin Nacional com a
// conexão segura (mTLS) da empresa emissora, só leitura, e grava a alíquota por município com data e origem "Sefin".
// Nunca troca em silêncio a alíquota digitada: quando a oficial é diferente, mostra as duas e o admin escolhe.
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { MUNICIPIOS_CONHECIDOS } from "@shared/fiscal/municipios";

const nomeDe = (ibge: string) => MUNICIPIOS_CONHECIDOS.find(m => m.ibge === ibge)?.nome ?? ibge;
const pct = (v: string | null) => (v == null ? "—" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`);

export function AliquotasOficiais({ tipoServicoId, emissorId, podeEditar }: { tipoServicoId: number; emissorId: number | null; podeEditar: boolean }) {
  const utils = trpc.useUtils();
  const { data: linhas = [] } = trpc.fiscal.parametrosMunicipais.listar.useQuery({ tipoServicoId });
  const invalidar = () => void utils.fiscal.parametrosMunicipais.listar.invalidate();
  const buscar = trpc.fiscal.parametrosMunicipais.buscar.useMutation({
    onSuccess: r => { toast.success(`${r.filter(x => x.consulta === "aliquota").length} município(s) consultado(s).`); invalidar(); },
    onError: e => toast.error(e.message),
  });
  const escolher = trpc.fiscal.parametrosMunicipais.escolher.useMutation({ onSuccess: () => { toast.success("Escolha gravada."); invalidar(); }, onError: e => toast.error(e.message) });
  // A mais recente por município (é a que vale na nota)
  // (a lista vem do mais novo para o mais antigo: fica o PRIMEIRO de cada município — revisão do Codex no #324)
  const porMunicipio = new Map<string, (typeof linhas)[number]>();
  for (const l of linhas) if (l.consulta === "aliquota" && !porMunicipio.has(l.municipioIbge)) porMunicipio.set(l.municipioIbge, l);
  const vigentes = Array.from(porMunicipio.values());
  return (
    <div className="mt-2 rounded border border-[#C9A961]/20 p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-gray-300">Alíquotas oficiais (Sefin)</span>
        {podeEditar && (
          <Button size="sm" variant="outline" disabled={!emissorId || buscar.isPending} title={emissorId ? undefined : "Escolha a empresa emissora padrão do tipo"}
            onClick={() => emissorId && buscar.mutate({ emissorId, tipoServicoId })}>{buscar.isPending ? "Buscando..." : "Buscar alíquotas oficiais"}</Button>
        )}
      </div>
      {!vigentes.length ? <p className="mt-1 text-gray-500">Nenhuma consulta ainda.</p> : (
        <ul className="mt-1 space-y-1">
          {vigentes.map(l => (
            <li key={l.id} className="flex flex-wrap items-center gap-2">
              <span className="text-white">{nomeDe(l.municipioIbge)}</span>
              <span>oficial {pct(l.aliquota)}</span>
              {l.aliquotaDigitada != null && <span className="text-gray-400">digitada {pct(l.aliquotaDigitada)}</span>}
              <span className="text-gray-400">• {new Date(l.consultadoEm).toLocaleString("pt-BR")} • origem Sefin ({l.ambiente === "producao" ? "produção" : "testes"})</span>
              {l.situacao === "pendente" ? (podeEditar ? (
                <>
                  <Button size="sm" variant="outline" disabled={escolher.isPending} onClick={() => escolher.mutate({ id: l.id, escolha: "sefin" })}>Usar a oficial</Button>
                  <Button size="sm" variant="outline" disabled={escolher.isPending} onClick={() => escolher.mutate({ id: l.id, escolha: "digitada" })}>Manter a digitada</Button>
                </>
              ) : <span className="text-amber-300">a escolher</span>)
                : <span className="text-[#C9A961]">{l.situacao === "aceita" ? "vale na nota" : l.situacao === "recusada" ? "mantida a digitada" : "sem alíquota única no retorno"}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
