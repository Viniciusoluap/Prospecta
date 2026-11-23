// EPIC-029 S-6 — "Limites de receita por empresa" (aba Contabilidade): por empresa (raiz do CNPJ: matriz + filiais), o regime vigente,
// as contas vinculadas, a receita registrada no ano e a barra do limite do regime (Simples: ME, sublimite, teto; Presumido: R$ 78 mi;
// Real: sem limite; "a confirmar": sem conta). Contas sem empresa e receita sem conta aparecem como pendência.
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatarCnpj } from "@shared/fiscal/regimes";

const dinheiro = (c: number) => formatCurrency(c / 100);
const pct = (n: number) => `${String(n).replace(".", ",")}%`;
const corDaFaixa = (faixa: number, informativo: boolean) =>
  informativo ? "bg-sky-400" : faixa >= 100 ? "bg-red-500" : faixa >= 95 ? "bg-red-400" : faixa >= 85 ? "bg-amber-400" : faixa >= 70 ? "bg-yellow-300" : "bg-green-400";

export function LimitesReceita() {
  const { data, isLoading, error } = trpc.fiscal.limitesReceita.useQuery();
  return (
    <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
      <CardHeader>
        <CardTitle className="text-[#C9A961]">Limites de receita por empresa {data ? `— ${data.ano}` : ""}</CardTitle>
        <p className="text-xs text-gray-300">
          Receita registrada no sistema (entradas pagas nas contas de cada empresa, somando matriz e filiais, sem transferências entre contas
          da mesma empresa e sem estornos). A apuração oficial da receita bruta é do contador.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-gray-300">Carregando…</p>}
        {error && <p className="text-sm text-red-300">{error.message}</p>}
        {data && !data.empresas.length && (
          <p className="text-sm text-gray-300">Nenhuma empresa com CNPJ no perfil tributário. Cadastre em "Configurar tributação".</p>
        )}
        {data?.empresas.map(e => (
          <div key={e.raiz} className="rounded-lg bg-[#1A2332] p-3 space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="font-semibold text-white">{e.nome}</p>
                <p className="text-xs text-gray-300">
                  {e.regimeRotulo} • {e.estabelecimentos.map(x => `${x.matriz ? "matriz" : "filial"} ${formatarCnpj(x.cnpj)}`).join(" • ")}
                  {e.perfilAtivo ? "" : " • perfil inativo"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-green-400">{dinheiro(e.receitaCentavos)}</p>
                <p className="text-xs text-gray-400">
                  projeção do ano: {dinheiro(e.projecaoCentavos)}{e.projecaoConfiavel ? "" : " (pouco confiável no começo do ano)"}
                </p>
              </div>
            </div>
            <p className="text-xs text-gray-300">
              Contas: {e.contas.length ? e.contas.map(c => c.nome).join(", ") : "nenhuma conta vinculada"}
            </p>
            {e.foraDaSoma.transferencias > 0 && (
              <p className="text-xs text-gray-300">
                {e.foraDaSoma.transferencias} entrada(s) ({dinheiro(e.foraDaSoma.transferenciasCentavos)}) fora da soma como transferência entre contas da
                empresa (entrada e saída marcadas como "Transferência interna", mesmo valor, até 2 dias). Marcadas por:{" "}
                {e.transferenciasPorQuem.map(x => `${x.quem} — ${x.entradas} (${dinheiro(x.centavos)})`).join("; ")}.
              </p>
            )}
            {e.possiveisTransferencias.entradas > 0 && (
              <p className="text-xs text-amber-200">
                Conferir: {e.possiveisTransferencias.entradas} entrada(s) ({dinheiro(e.possiveisTransferencias.centavos)}) podem ser transferência (marcadas
                como "Transferência interna" sem a saída correspondente numa conta desta empresa, ou com uma saída de mesmo valor ainda sem par). Elas
                CONTAM na receita; só saem quando entrada e saída estiverem marcadas, em contas da empresa, em{" "}
                <Link href="/admin/bpo" className="underline">BPO › A classificar</Link>.
              </p>
            )}
            {e.aClassificar.movimentos > 0 && (
              <p className="text-xs text-amber-200">
                Pendência: {e.aClassificar.movimentos} entrada(s) nas contas desta empresa ainda a classificar ({dinheiro(e.aClassificar.centavos)}) — fora da
                soma até alguém classificar. Contando com elas, a receita pode chegar a {dinheiro(e.receitaPossivelCentavos)}
                {e.limites.length ? ` (${e.limites.map(l => `${pct(l.percentualPossivel)} do ${l.rotulo}`).join("; ")})` : ""}. Classifique em{" "}
                <Link href="/admin/bpo" className="underline">BPO › A classificar</Link>.
              </p>
            )}
            {(e.reembolsosCentavos > 0 || e.foraDaSoma.transferencias > 0 || e.foraDaSoma.estornos > 0) && (
              <p className="text-xs text-gray-400">
                {e.reembolsosCentavos > 0 ? `inclui ${dinheiro(e.reembolsosCentavos)} de reembolsos` : ""}
                {e.foraDaSoma.transferencias > 0 ? ` • fora da soma: ${dinheiro(e.foraDaSoma.transferenciasCentavos)} em transferências entre contas da empresa` : ""}
                {e.foraDaSoma.estornos > 0 ? ` • fora da soma: ${dinheiro(e.foraDaSoma.estornosCentavos)} em estornos/devoluções` : ""}
              </p>
            )}
            {e.situacao !== "com_limite" ? (
              <p className={`text-sm ${e.situacao === "sem_limite" ? "text-gray-200" : "text-amber-200"}`}>
                {e.situacao === "sem_limite" ? "Sem limite de receita" : "Regime a confirmar"} — {e.explicacao}
              </p>
            ) : (
              e.limites.map(l => (
                <div key={l.chave} title={`${l.consequencia} (${l.fonte})`}>
                  <div className="flex justify-between text-xs text-gray-300">
                    <span>{l.rotulo}{l.informativo ? " — informativo" : ""}</span>
                    <span>{pct(l.percentual)} de {dinheiro(l.valorCentavos)} • falta {dinheiro(l.faltaCentavos)}</span>
                  </div>
                  <div className="h-2 w-full rounded bg-white/10" role="progressbar" aria-valuenow={Math.min(100, l.percentual)} aria-valuemin={0} aria-valuemax={100} aria-label={l.rotulo}>
                    <div className={`h-2 rounded ${corDaFaixa(l.faixa, l.informativo)}`} style={{ width: `${Math.min(100, l.percentual)}%` }} />
                  </div>
                  {l.faixa >= 70 && <p className="text-xs text-amber-200 mt-1">{l.consequencia}.</p>}
                </div>
              ))
            )}
          </div>
        ))}
        {data && (data.semEmpresa.contas.length > 0 || data.semConta.lancamentos > 0 || data.financeiro.lancamentos > 0) && (
          <div className="rounded border border-amber-500/30 p-3 text-xs text-amber-200 space-y-1">
            {data.semEmpresa.contas.length > 0 && (
              <p>
                Pendência: {data.semEmpresa.contas.length} conta(s) sem empresa definida ({data.semEmpresa.contas.map(c => c.nome).join(", ")}) —
                {" "}{dinheiro(data.semEmpresa.receitaCentavos)} no ano fora da soma de qualquer empresa
                {data.semEmpresa.aClassificarCentavos > 0 ? ` (e mais ${dinheiro(data.semEmpresa.aClassificarCentavos)} a classificar)` : ""}. Vincule em{" "}
                <Link href="/admin/bpo" className="underline">BPO › Bancos</Link> (Editar conta).
              </p>
            )}
            {data.semConta.lancamentos > 0 && (
              <p>{data.semConta.lancamentos} recebimento(s) sem conta bancária ({dinheiro(data.semConta.receitaCentavos)}): não dá para dizer de que empresa são.</p>
            )}
            {data.financeiro.lancamentos > 0 && (
              <p>
                {data.financeiro.lancamentos} receita(s) do Financeiro ({dinheiro(data.financeiro.receitaCentavos)}) entram na "Receita realizada", mas não têm
                conta bancária: não dá para dizer de que empresa são e ficam fora da soma por empresa.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
