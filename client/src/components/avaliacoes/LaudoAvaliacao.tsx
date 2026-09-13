import { trpc } from "@/lib/trpc";

const TIPO_LABELS: Record<string, string> = {
  mercado: "Mercado",
  locacao: "Locação",
  judicial: "Judicial",
  parecer_tecnico: "Parecer Técnico",
};

const FINALIDADE_LABELS: Record<string, string> = {
  compra_venda: "Compra e Venda",
  locacao: "Locação",
  judicial: "Judicial",
  garantia: "Garantia",
  inventario: "Inventário",
};

const METODOLOGIA_LABELS: Record<string, string> = {
  comparativo: "Método Comparativo Direto de Dados de Mercado",
  renda: "Método da Renda",
  custo: "Método do Custo",
};

type ChecklistItemState = { ok: boolean | null; nota: string };
type ChecklistData = {
  tipoChecklist: "imovel" | "terreno";
  estadoGeral: string;
  items: Record<string, ChecklistItemState>;
  fotos: string[];
};
type Documento = { nome: string; url: string; tipo: string; tamanho: number };

function parseChecklist(raw: string | null | undefined): ChecklistData {
  if (!raw) return { tipoChecklist: "imovel", estadoGeral: "", items: {}, fotos: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<ChecklistData>;
    return {
      tipoChecklist: parsed.tipoChecklist ?? "imovel",
      estadoGeral: parsed.estadoGeral ?? "",
      items: parsed.items ?? {},
      fotos: parsed.fotos ?? [],
    };
  } catch {
    return { tipoChecklist: "imovel", estadoGeral: "", items: {}, fotos: [] };
  }
}

function parseDocumentos(raw: string | null | undefined): Documento[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatCurrencyBR(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(num);
}

function formatDateBR(value: string | Date | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

/** Renderiza o corpo completo (imprimível) do laudo de uma avaliação. Usado tanto na
 * emissão individual (/admin/avaliacoes/:id/laudo) quanto no lote (/admin/avaliacoes/laudos). */
export function LaudoAvaliacao({ avaliacao, quebrarAntes }: { avaliacao: any; quebrarAntes?: boolean }) {
  const checklist = parseChecklist(avaliacao.caracteristicas);
  const documentos = parseDocumentos(avaliacao.documentos);
  const sugestao = avaliacao.sugestaoJson ? safeParse(avaliacao.sugestaoJson) : null;

  const { data: catalog } = trpc.avaliacoes.getChecklistCatalog.useQuery({ tipo: checklist.tipoChecklist });
  const groups = catalog?.groups ?? [];
  const estadoOptions = catalog?.estadoGeralOptions ?? [];
  const estadoLabel = estadoOptions.find((o: any) => o.value === checklist.estadoGeral)?.label ?? "—";

  const resumo = `O imóvel situado em ${avaliacao.endereco}, ${avaliacao.bairro}, ${avaliacao.cidade}/${avaliacao.estado}` +
    `${avaliacao.areaConstruida ? `, com área construída de ${avaliacao.areaConstruida} m²` : ""}` +
    `${avaliacao.areaTerreno ? ` e área de terreno de ${avaliacao.areaTerreno} m²` : ""}` +
    `, foi avaliado pelo ${METODOLOGIA_LABELS[avaliacao.metodologia] ?? avaliacao.metodologia}` +
    ` para fins de ${(FINALIDADE_LABELS[avaliacao.finalidade] ?? avaliacao.finalidade).toLowerCase()}.` +
    `${checklist.estadoGeral ? ` O estado geral do imóvel foi classificado como "${estadoLabel}".` : ""}`;

  return (
    <div className={`laudo-avaliacao bg-white text-black ${quebrarAntes ? "print-break-before" : ""}`}>
      <div className="flex items-center justify-between border-b-4 border-[#C9A961] pb-3 mb-4">
        <div>
          <h1 className="text-xl font-black uppercase tracking-wide">Laudo de Avaliação Imobiliária</h1>
          <p className="text-xs text-gray-600">Prospecta — {avaliacao.numero}</p>
        </div>
        <p className="text-xs text-gray-600">{new Date().toLocaleDateString("pt-BR")}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4 text-sm">
        <p><span className="font-bold">Tipo:</span> {TIPO_LABELS[avaliacao.tipo] ?? avaliacao.tipo}</p>
        <p><span className="font-bold">Finalidade:</span> {FINALIDADE_LABELS[avaliacao.finalidade] ?? avaliacao.finalidade}</p>
      </div>

      <section className="mb-4">
        <h2 className="text-sm font-black uppercase text-[#8a7238] border-b border-gray-300 mb-2">Solicitante e Avaliador</h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <p><span className="text-gray-500">Cliente:</span> {avaliacao.clienteNome}</p>
          <p><span className="text-gray-500">CPF:</span> {avaliacao.clienteCpf ?? "—"}</p>
          <p><span className="text-gray-500">Telefone:</span> {avaliacao.clienteTel}</p>
          <p><span className="text-gray-500">Email:</span> {avaliacao.clienteEmail ?? "—"}</p>
          <p><span className="text-gray-500">Avaliador:</span> {avaliacao.avaliador}</p>
          <p><span className="text-gray-500">Data da vistoria:</span> {formatDateBR(avaliacao.dataVistoria)}</p>
          <p><span className="text-gray-500">Prazo de entrega:</span> {formatDateBR(avaliacao.prazoEntrega)}</p>
          <p><span className="text-gray-500">Data de entrega:</span> {formatDateBR(avaliacao.dataEntrega)}</p>
        </div>
      </section>

      <section className="mb-4">
        <h2 className="text-sm font-black uppercase text-[#8a7238] border-b border-gray-300 mb-2">Imóvel</h2>
        <div className="grid grid-cols-3 gap-x-6 gap-y-1 text-sm">
          <p className="col-span-3"><span className="text-gray-500">Endereço:</span> {avaliacao.endereco}, {avaliacao.bairro} — {avaliacao.cidade}/{avaliacao.estado}</p>
          <p><span className="text-gray-500">Área constr.:</span> {avaliacao.areaConstruida ?? "—"} m²</p>
          <p><span className="text-gray-500">Área terreno:</span> {avaliacao.areaTerreno ?? "—"} m²</p>
          <p><span className="text-gray-500">Estado geral:</span> {estadoLabel}</p>
          <p><span className="text-gray-500">Quartos:</span> {avaliacao.quartos ?? "—"}</p>
          <p><span className="text-gray-500">Banheiros:</span> {avaliacao.banheiros ?? "—"}</p>
          <p><span className="text-gray-500">Vagas:</span> {avaliacao.vagas ?? "—"}</p>
        </div>
      </section>

      {avaliacao.valorEstimado && (
        <section className="mb-4 bg-gray-100 rounded p-3 text-center">
          <p className="text-xs text-gray-600 uppercase">Valor Estimado</p>
          <p className="text-2xl font-black text-[#8a7238]">{formatCurrencyBR(avaliacao.valorEstimado)}</p>
        </section>
      )}

      <section className="mb-4">
        <h2 className="text-sm font-black uppercase text-[#8a7238] border-b border-gray-300 mb-2">Resumo</h2>
        <p className="text-sm text-gray-800">{resumo}</p>
      </section>

      {groups.length > 0 && (
        <section className="mb-4">
          <h2 className="text-sm font-black uppercase text-[#8a7238] border-b border-gray-300 mb-2">Checklist de Vistoria</h2>
          {groups.map((group: any) => {
            const itens = group.items.map((it: any) => ({ ...it, state: checklist.items[it.key] }));
            const conformes = itens.filter((it: any) => it.state?.ok === true).length;
            const naoConformes = itens.filter((it: any) => it.state?.ok === false);
            return (
              <div key={group.id} className="mb-2 text-sm">
                <p className="font-bold">{group.label} — {conformes} conforme(s), {naoConformes.length} não conforme(s)</p>
                {naoConformes.length > 0 && (
                  <ul className="list-disc list-inside text-red-700 ml-2">
                    {naoConformes.map((it: any) => (
                      <li key={it.key}>{it.label}{it.state?.nota ? ` — ${it.state.nota}` : ""}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </section>
      )}

      {avaliacao.observacoes && (
        <section className="mb-4">
          <h2 className="text-sm font-black uppercase text-[#8a7238] border-b border-gray-300 mb-2">Observações</h2>
          <p className="text-sm text-gray-800 whitespace-pre-line">{avaliacao.observacoes}</p>
        </section>
      )}

      {sugestao && (
        <section className="mb-4">
          <h2 className="text-sm font-black uppercase text-[#8a7238] border-b border-gray-300 mb-2">Análise de Mercado (IA)</h2>
          <div className="grid grid-cols-3 gap-3 text-sm mb-2">
            <p><span className="text-gray-500">Sugerido:</span> {formatCurrencyBR(sugestao.valorSugerido)}</p>
            <p><span className="text-gray-500">Faixa:</span> {formatCurrencyBR(sugestao.valorMin)} – {formatCurrencyBR(sugestao.valorMax)}</p>
            <p><span className="text-gray-500">Confiabilidade:</span> {sugestao.confiabilidade}</p>
          </div>
          {sugestao.comparaveis?.length > 0 && (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-400 text-left">
                  <th className="py-1">Comparável</th>
                  <th className="py-1 text-right">Preço</th>
                  <th className="py-1 text-right">Área</th>
                </tr>
              </thead>
              <tbody>
                {sugestao.comparaveis.map((c: any, i: number) => (
                  <tr key={i} className="border-b border-gray-200">
                    <td className="py-1">{c.descricao}</td>
                    <td className="py-1 text-right">{formatCurrencyBR(c.preco)}</td>
                    <td className="py-1 text-right">{c.area} m²</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {documentos.length > 0 && (
        <section className="mb-4">
          <h2 className="text-sm font-black uppercase text-[#8a7238] border-b border-gray-300 mb-2">Documentos Anexados</h2>
          <ul className="text-sm list-disc list-inside">
            {documentos.map((d, i) => <li key={i}>{d.nome}</li>)}
          </ul>
        </section>
      )}

      {checklist.fotos.length > 0 && (
        <section className="mb-4 print-break-before">
          <h2 className="text-sm font-black uppercase text-[#8a7238] border-b border-gray-300 mb-2">Fotos da Vistoria</h2>
          <div className="grid grid-cols-3 gap-2">
            {checklist.fotos.map((src, i) => (
              <img key={i} src={src} alt="" className="w-full h-32 object-cover rounded border border-gray-300" />
            ))}
          </div>
        </section>
      )}

      <div className="print-break-before" />
      <section className="mt-16 grid grid-cols-2 gap-12 text-center text-sm">
        <div>
          <div className="border-t border-black pt-1">{avaliacao.avaliador}</div>
          <p className="text-xs text-gray-500">Avaliador Responsável</p>
        </div>
        <div>
          <div className="border-t border-black pt-1">{avaliacao.clienteNome}</div>
          <p className="text-xs text-gray-500">Cliente / Solicitante</p>
        </div>
      </section>

      <p className="mt-6 text-[10px] text-gray-500">
        Laudo elaborado com base em vistoria e pesquisa de mercado. Não substitui perícia judicial, engenharia estrutural ou avaliação registrada em cartório quando exigido por lei.
      </p>
    </div>
  );
}

function safeParse(raw: string) {
  try { return JSON.parse(raw); } catch { return null; }
}
