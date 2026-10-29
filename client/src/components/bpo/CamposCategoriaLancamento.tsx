import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CATEGORIAS_DESPESA_OPERACIONAL, CATEGORIAS_RECEITA_OPERACIONAL,
  ROTULOS_CATEGORIA_OPERACIONAL, TIPOS_DESPESA_OBRA,
  catalogoDaCategoria, categoriaContabilDaOperacional, categoriaSemVinculo,
} from "@shared/financeiro/bpo-operacional";

export type ValorCategoriaLancamento = {
  categoriaOperacional: string;
  vinculoOperacionalId: string;
  tipoDespesaObra: string;
  etapaObra: string;
};

type Vinculo = { id: string; rotulo: string; clienteNome: string | null };
type Catalogo = Record<string, unknown> & { etapasObra?: { chave: string; nome: string }[] };

const campo = "bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1";

/**
 * Lote 3, item 12: o mesmo bloco de categoria no "Novo lançamento" e no "Editar lançamento".
 * Só "Tipo" (fora daqui) e "Categoria Operacional"; a classificação contábil é derivada no servidor
 * e o centro de custos não é mais editado. `opcional` permite manter lançamentos antigos sem categoria.
 */
export function CamposCategoriaLancamento({ tipo, valor, onChange, catalogo, opcional = false, onVinculo }: {
  tipo: "cobranca" | "despesa";
  valor: ValorCategoriaLancamento;
  onChange: (v: ValorCategoriaLancamento) => void;
  catalogo: Catalogo | undefined;
  opcional?: boolean;
  onVinculo?: (v: Vinculo | null) => void;
}) {
  const categorias = tipo === "cobranca" ? CATEGORIAS_RECEITA_OPERACIONAL : CATEGORIAS_DESPESA_OPERACIONAL;
  const semVinculo = categoriaSemVinculo(valor.categoriaOperacional);
  const opcoes = (valor.categoriaOperacional && !semVinculo
    ? (catalogo?.[catalogoDaCategoria(tipo, valor.categoriaOperacional)] ?? [])
    : []) as Vinculo[];
  const ehObra = tipo === "despesa" && valor.categoriaOperacional === "obras";
  return (
    <>
      <div className="col-span-2 sm:col-span-1">
        <Label className="text-gray-300">Categoria operacional{opcional ? "" : " *"}</Label>
        <Select
          value={valor.categoriaOperacional || "none"}
          onValueChange={v => onChange({ categoriaOperacional: v === "none" ? "" : v, vinculoOperacionalId: "", tipoDespesaObra: "", etapaObra: "" })}
        >
          <SelectTrigger className={campo}><SelectValue placeholder="Escolha" /></SelectTrigger>
          <SelectContent>
            {opcional && <SelectItem value="none">Sem categoria operacional</SelectItem>}
            {categorias.map(c => <SelectItem key={c} value={c}>{ROTULOS_CATEGORIA_OPERACIONAL[c]}</SelectItem>)}
          </SelectContent>
        </Select>
        {valor.categoriaOperacional && (
          <p className="mt-1 text-[11px] text-gray-400">
            Classificação contábil (automática): {categoriaContabilDaOperacional(tipo, valor.categoriaOperacional, valor.tipoDespesaObra)}
          </p>
        )}
      </div>
      {valor.categoriaOperacional && !semVinculo && (
        <div className="col-span-2">
          <Label className="text-gray-300">Registro vinculado *</Label>
          <Select
            value={valor.vinculoOperacionalId || undefined}
            onValueChange={v => { onChange({ ...valor, vinculoOperacionalId: v }); onVinculo?.(opcoes.find(o => o.id === v) ?? null); }}
          >
            <SelectTrigger className={campo}><SelectValue placeholder="Selecione um cadastro real" /></SelectTrigger>
            <SelectContent>
              {opcoes.map(o => <SelectItem key={o.id} value={o.id}>{o.rotulo}{o.clienteNome ? ` — ${o.clienteNome}` : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      {ehObra && (
        <>
          <div className="col-span-2 sm:col-span-1">
            <Label className="text-gray-300">Tipo de despesa *</Label>
            <Select value={valor.tipoDespesaObra || undefined} onValueChange={v => onChange({ ...valor, tipoDespesaObra: v })}>
              <SelectTrigger className={campo}><SelectValue placeholder="Escolha" /></SelectTrigger>
              <SelectContent>{TIPOS_DESPESA_OBRA.map(t => <SelectItem key={t} value={t}>{t.replaceAll("_", " ")}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <Label className="text-gray-300">Etapa da obra</Label>
            <Select value={valor.etapaObra || "none"} onValueChange={v => onChange({ ...valor, etapaObra: v === "none" ? "" : v })}>
              <SelectTrigger className={campo}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Não informada</SelectItem>
                {catalogo?.etapasObra?.map(e => <SelectItem key={e.chave} value={e.chave}>{e.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </>
      )}
    </>
  );
}

/** Validação de tela (o servidor revalida): categoria, vínculo quando exigido e tipo da despesa de obra. */
export function categoriaLancamentoCompleta(tipo: "cobranca" | "despesa", v: ValorCategoriaLancamento, opcional = false) {
  if (!v.categoriaOperacional) return opcional;
  if (!categoriaSemVinculo(v.categoriaOperacional) && !v.vinculoOperacionalId) return false;
  if (tipo === "despesa" && v.categoriaOperacional === "obras" && !v.tipoDespesaObra) return false;
  return true;
}
