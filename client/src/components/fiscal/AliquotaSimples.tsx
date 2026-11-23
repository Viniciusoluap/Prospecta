// EPIC-029 S-8 — "Alíquota do Simples — como foi calculada": RBT12 da empresa (matriz + filiais), anexo do tipo de serviço,
// faixa, alíquota nominal, parcela a deduzir, efetiva, parte do ISS (o que vai na nota) e Fator R. Só leitura: o admin confere;
// a folha e o início de atividade se corrigem em "Dados fiscais do perfil".
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/format";
import { ROTULO_TRIBUTO, TRIBUTOS, percentualTexto } from "@shared/fiscal/simples";

const dinheiro = (c: number) => formatCurrency(c / 100);
const dataBr = (d: string) => d.split("-").reverse().join("/");
const mesBr = (m: string) => m.split("-").reverse().join("/");
const REGRA = {
  doze_meses: "soma dos 12 meses anteriores",
  primeiro_mes: "1º mês de atividade: receita do mês × 12",
  media_dos_meses: "média dos meses de atividade × 12",
} as const;
const FOLHA = {
  nao_se_aplica: "não se aplica a este tipo de serviço",
  a_informar: "a informar",
  desatualizada: "desatualizada",
  valida: "informada",
} as const;

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/5 py-1">
      <span className="text-gray-400">{rotulo}</span>
      <span className="text-right text-white">{valor}</span>
    </div>
  );
}

export function AliquotaSimples({ notaId }: { notaId: number }) {
  const { data: r, isLoading, error } = trpc.fiscal.notas.aliquotaSimples.useQuery({ id: notaId });
  if (isLoading) return <p className="text-sm text-gray-400">Calculando...</p>;
  if (error) return <p role="alert" className="text-sm text-red-300">{error.message}</p>;
  if (!r) return null;
  if (!r.aplica) return <p className="text-sm text-gray-300">Não se aplica: {r.motivo}.</p>;
  const c = r.calculo;
  return (
    <div className="space-y-3 text-sm">
      {c ? (
        <div className="rounded border border-[#C9A961]/40 bg-[#C9A961]/10 p-3">
          <p className="text-xs text-gray-300">Vai na nota (alíquota do ISS)</p>
          <p className="text-2xl font-semibold text-[#C9A961]">{r.aliquotaDps ? `${r.aliquotaDps.replace(".", ",")}%` : "—"}</p>
          <p className="text-xs text-gray-300">
            {c.iss != null ? `Parte do ISS dentro do DAS (alíquota efetiva ${percentualTexto(c.efetiva)}).` : "ISS fora do DAS: alíquota municipal do tipo de serviço."}
          </p>
        </div>
      ) : (
        <p role="alert" className="rounded border border-red-500/40 bg-red-500/10 p-2 text-red-100">Não calculado: {r.erro}. A nota não pode ser montada assim.</p>
      )}

      <div>
        <p className="mb-1 font-medium text-[#C9A961]">Como foi calculada</p>
        <Linha rotulo="Competência da nota" valor={mesBr(r.competencia)} />
        <Linha rotulo="Período da receita" valor={`${dataBr(r.periodo.de)} a ${dataBr(r.periodo.ate)}`} />
        <Linha rotulo="RBT12 (matriz + filiais)" valor={`${dinheiro(r.rbt12.centavos)} — ${REGRA[r.rbt12.regra]}`} />
        <Linha rotulo="… notas emitidas" valor={dinheiro(r.receita.notasEmitidas)} />
        <Linha rotulo="… receitas do BPO" valor={r.receita.bpo == null ? "não disponível ainda" : dinheiro(r.receita.bpo)} />
        {r.sublimite && (
          <Linha rotulo="Sublimite do ISS (ano-calendário)" valor={`${r.competencia.slice(0, 4)}: ${dinheiro(r.sublimite.rbaAnoAtual)} até o mês anterior; ano anterior ${dinheiro(r.sublimite.rbaAnoAnterior)} — ${r.sublimite.motivo}`} />
        )}
        {c && (
          <>
            <Linha rotulo="Anexo" valor={`${c.anexo.anexo} — ${c.anexo.motivo}`} />
            <Linha rotulo="Faixa" valor={`${c.faixa}ª`} />
            <Linha rotulo="Alíquota nominal" valor={percentualTexto(c.nominal)} />
            <Linha rotulo="Parcela a deduzir" valor={dinheiro(c.deduzirCentavos)} />
            <Linha rotulo="Alíquota efetiva" valor={`${percentualTexto(c.efetiva)} = (RBT12 × nominal − parcela) ÷ RBT12`} />
            {c.reparticao.tetoAplicado && <Linha rotulo="Teto do ISS" valor="5% (5ª faixa): o excedente foi para os tributos federais" />}
            <Linha rotulo="Tabela" valor={c.tabela.fonte} />
          </>
        )}
        <Linha rotulo="Folha dos 12 meses (Fator R)" valor={
          r.folha.situacao === "nao_se_aplica" ? FOLHA.nao_se_aplica
            : `${FOLHA[r.folha.situacao]}${r.folha.folha12mCentavos != null ? ` — ${dinheiro(r.folha.folha12mCentavos)} até ${mesBr(r.folha.folhaAte ?? "")}`
              : r.folha.folhaOculta ? ` até ${mesBr(r.folha.folhaAte ?? "")} (valor só para o administrador)` : ""}`
        } />
        {r.fatorR && <Linha rotulo="Fator r" valor={r.fatorR.r != null ? `${percentualTexto(r.fatorR.r)} (${r.fatorR.motivo})` : r.fatorR.motivo} />}
      </div>

      {c && (
        <div>
          <p className="mb-1 font-medium text-[#C9A961]">Repartição da alíquota efetiva</p>
          <div className="grid grid-cols-3 gap-1 text-xs">
            {TRIBUTOS.filter(t => c.reparticao.partes[t] != null).map(t => (
              <span key={t} className="rounded bg-[#2C3E50] px-2 py-1">{ROTULO_TRIBUTO[t]}: {percentualTexto(c.reparticao.partes[t]!)}</span>
            ))}
          </div>
        </div>
      )}

      {r.avisos.length > 0 && (
        <ul className="space-y-1">
          {r.avisos.map(a => <li key={a} role="alert" className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-100">{a}</li>)}
        </ul>
      )}
      <p className="text-xs text-gray-400">Orientação técnica (LC 123/2006), não parecer contábil: confira com o extrato do PGDAS-D. Folha e início de atividade se corrigem em "Dados fiscais do perfil".</p>
    </div>
  );
}
