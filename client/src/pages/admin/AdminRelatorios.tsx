import { useMemo, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  ArrowLeft,
  Home,
  Users,
  Landmark,
  HardHat,
  TrendingUp,
  DollarSign,
  Download,
  Info,
} from "lucide-react";
import {
  AJUDA_VGV_DE_OBRAS,
  MENSAGEM_RANKING_VAZIO,
  NOTA_NUMEROS_DE_OBRA,
} from "@shared/financeiro/relatorios-indicadores";

const CORES_NUMEROS_OBRA = ["#C9A961", "#3B82F6", "#22C55E", "#A855F7"];

function formatCurrencyBR(value: number | string | null | undefined) {
  if (value === null || value === undefined) return "R$ 0,00";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "R$ 0,00";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(num);
}

function isoToInputDate(iso: string) {
  return iso.slice(0, 10);
}

export default function AdminRelatorios({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);

  const { data, isLoading } = trpc.relatorios.overview.useQuery({
    from: from || undefined,
    to: to || undefined,
  });

  const exportQuery = trpc.relatorios.exportComissoesCsv.useQuery(undefined, {
    enabled: false,
  });

  const numerosObraGrafico = useMemo(
    () => (data ? data.numerosDeObra.filter(f => f.fatia > 0) : []),
    [data]
  );

  async function exportarCsv() {
    const result = await exportQuery.refetch();
    const rows = result.data ?? [];
    const header = "Origem;Data;Corretor;Referência;Valor Total;Pago;Status";
    const linhas = rows.map(r =>
      [
        r.origem,
        r.data,
        r.corretor,
        r.referencia ?? "",
        r.valorTotal.toFixed(2),
        r.pago.toFixed(2),
        r.status,
      ].join(";")
    );
    const csv = "﻿" + [header, ...linhas].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `comissoes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className={
        embedded ? "text-white" : "min-h-screen bg-[#1A2332] text-white"
      }
    >
      {!embedded && (
        <div className="bg-[#0F1923] border-b border-[#C9A961]/20 px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4">
              <Link href="/admin">
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-gray-400 hover:text-white"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-[#C9A961]">
                  Relatórios e Exportações
                </h1>
                <p className="text-gray-400 text-sm">
                  Indicadores consolidados — imóveis, leads, obras,
                  financiamentos e financeiro
                </p>
              </div>
            </div>
            <Button
              onClick={exportarCsv}
              variant="outline"
              className="border-[#C9A961]/30 text-[#C9A961]"
            >
              <Download className="h-4 w-4 mr-2" /> Exportar CSV (Comissões)
            </Button>
          </div>
        </div>
      )}

      <div
        className={
          embedded ? "space-y-6" : "max-w-7xl mx-auto px-6 py-6 space-y-6"
        }
      >
        <div className="flex gap-3 items-end flex-wrap">
          <div>
            <Label className="text-gray-300 text-xs">De</Label>
            <Input
              type="date"
              value={
                from
                  ? isoToInputDate(from)
                  : data
                    ? isoToInputDate(data.from)
                    : ""
              }
              onChange={e =>
                setFrom(
                  e.target.value ? new Date(e.target.value).toISOString() : null
                )
              }
              className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
            />
          </div>
          <div>
            <Label className="text-gray-300 text-xs">Até</Label>
            <Input
              type="date"
              value={
                to ? isoToInputDate(to) : data ? isoToInputDate(data.to) : ""
              }
              onChange={e =>
                setTo(
                  e.target.value ? new Date(e.target.value).toISOString() : null
                )
              }
              className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1"
            />
          </div>
        </div>

        {isLoading || !data ? (
          <p className="text-gray-400">Carregando indicadores...</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
                <CardContent className="pt-6 flex items-center gap-2">
                  <Home className="h-6 w-6 text-[#C9A961]" />
                  <div>
                    <p className="text-gray-300 text-xs">Imóveis</p>
                    <p className="text-xl font-bold text-white">
                      {data.totalImoveis}
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
                <CardContent className="pt-6 flex items-center gap-2">
                  <Users className="h-6 w-6 text-blue-400" />
                  <div>
                    <p className="text-gray-300 text-xs">Leads no período</p>
                    <p className="text-xl font-bold text-white">
                      {data.totalLeads}
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
                <CardContent className="pt-6 flex items-center gap-2">
                  <Landmark className="h-6 w-6 text-purple-400" />
                  <div>
                    <p className="text-gray-300 text-xs">Financiamentos</p>
                    <p className="text-xl font-bold text-white">
                      {data.totalFinanciamentos}
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
                <CardContent className="pt-6 flex items-center gap-2">
                  <HardHat className="h-6 w-6 text-yellow-400" />
                  <div>
                    <p className="text-gray-300 text-xs flex items-center gap-1">
                      VGV de Obras
                      <span title={AJUDA_VGV_DE_OBRAS} aria-label={AJUDA_VGV_DE_OBRAS}>
                        <Info className="h-3 w-3 text-gray-400" />
                      </span>
                    </p>
                    <p className="text-lg font-bold text-white">
                      {formatCurrencyBR(data.vgvObras.vgvTotal)}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {data.vgvObras.obrasElegiveis} obra(s) · data de início
                      (ou de criação, sem início)
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
                <CardContent className="pt-6 flex items-center gap-2">
                  <TrendingUp className="h-6 w-6 text-green-400" />
                  <div>
                    <p className="text-gray-300 text-xs">Ticket médio</p>
                    <p className="text-lg font-bold text-white">
                      {data.ticketMedio === null
                        ? "—"
                        : formatCurrencyBR(data.ticketMedio)}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      VGV total ÷ nº de obras
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card
                className={`bg-[#2C3E50] ${data.resultado >= 0 ? "border-green-500/30" : "border-red-500/30"}`}
              >
                <CardContent className="pt-6 flex items-center gap-2">
                  <DollarSign
                    className={`h-6 w-6 ${data.resultado >= 0 ? "text-green-400" : "text-red-400"}`}
                  />
                  <div>
                    <p className="text-gray-300 text-xs">Resultado (DRE)</p>
                    <p
                      className={`text-lg font-bold ${data.resultado >= 0 ? "text-green-400" : "text-red-400"}`}
                    >
                      {formatCurrencyBR(data.resultado)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
                <CardHeader>
                  <CardTitle className="text-[#C9A961] text-sm">
                    Receitas Realizadas por Competência
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={data.dreMensal}>
                      <defs>
                        <linearGradient
                          id="gradReceitas"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#C9A961"
                            stopOpacity={0.4}
                          />
                          <stop
                            offset="100%"
                            stopColor="#C9A961"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="mes"
                        tick={{ fill: "#9CA3AF", fontSize: 11 }}
                      />
                      <YAxis tick={{ fill: "#9CA3AF", fontSize: 11 }} />
                      <Tooltip
                        formatter={v => formatCurrencyBR(Number(v))}
                        contentStyle={{
                          background: "#0F1923",
                          border: "1px solid #C9A96140",
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="receitas"
                        stroke="#C9A961"
                        fill="url(#gradReceitas)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
                <CardHeader>
                  <CardTitle className="text-[#C9A961] text-sm">
                    DRE — Receitas x Despesas
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {/* LOTE C (25/10): o "bloco cinza" era o cursor padrão do Tooltip de barras
                      do Recharts (retângulo #ccc em toda a faixa do mês; com um só mês cobre o
                      gráfico inteiro e no celular fica preso após o toque). Cursor discreto,
                      barras com largura máxima e aviso quando não há dados. */}
                  {data.dreMensal.length === 0 ? (
                    <div className="flex h-[220px] items-center justify-center text-sm text-gray-400">
                      Sem receitas ou despesas pagas no período
                    </div>
                  ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data.dreMensal} barGap={4}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis
                        dataKey="mes"
                        tick={{ fill: "#9CA3AF", fontSize: 11 }}
                      />
                      <YAxis
                        width={70}
                        tick={{ fill: "#9CA3AF", fontSize: 11 }}
                        tickFormatter={v =>
                          Number(v).toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 1 })
                        }
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(201, 169, 97, 0.08)" }}
                        formatter={v => formatCurrencyBR(Number(v))}
                        contentStyle={{
                          background: "#0F1923",
                          border: "1px solid #C9A96140",
                        }}
                        labelStyle={{ color: "#E5E7EB" }}
                      />
                      <Legend />
                      <Bar dataKey="receitas" fill="#22C55E" name="Receitas" maxBarSize={48} />
                      <Bar dataKey="despesas" fill="#EF4444" name="Despesas" maxBarSize={48} />
                    </BarChart>
                  </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
                <CardHeader>
                  <CardTitle className="text-[#C9A961] text-sm">
                    Números de Obra
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {numerosObraGrafico.length === 0 ? (
                    <div className="flex h-[220px] items-center justify-center text-sm text-gray-400">
                      Nenhuma obra com VGV no período
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={numerosObraGrafico}
                          dataKey="fatia"
                          nameKey="nome"
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                        >
                          {numerosObraGrafico.map(f => (
                            <Cell
                              key={f.chave}
                              fill={
                                CORES_NUMEROS_OBRA[
                                  data.numerosDeObra.findIndex(
                                    n => n.chave === f.chave
                                  )
                                ]
                              }
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={v => formatCurrencyBR(Number(v))}
                          contentStyle={{
                            background: "#0F1923",
                            border: "1px solid #C9A96140",
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                  <ul className="mt-2 space-y-1 text-xs">
                    {data.numerosDeObra.map((f, i) => (
                      <li key={f.chave} className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-gray-300">
                          <span
                            className="inline-block h-3 w-3 rounded-sm"
                            style={{ backgroundColor: CORES_NUMEROS_OBRA[i] }}
                          />
                          {f.nome}
                        </span>
                        <span className="font-bold text-white">
                          {formatCurrencyBR(f.valor)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px] text-gray-400">
                    {NOTA_NUMEROS_DE_OBRA}
                    {data.vgvObras.obrasSemEntrada > 0 &&
                      ` A entrada não inclui ${data.vgvObras.obrasSemEntrada} obra(s) sem financiamento, FGTS ou subsídio informados.`}
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
                <CardHeader>
                  <CardTitle className="text-[#C9A961] text-sm">
                    Unidades Disponíveis
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data.unidadesDisponiveis.barras}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis
                        dataKey="nome"
                        tick={{ fill: "#9CA3AF", fontSize: 10 }}
                        interval={0}
                        tickFormatter={v =>
                          String(v)
                            .replace("Incorporação", "Incorp.")
                            .replace("reservados + vendidos", "res. + vend.")
                        }
                      />
                      <YAxis allowDecimals={false} tick={{ fill: "#9CA3AF", fontSize: 11 }} />
                      <Tooltip
                        cursor={{ fill: "rgba(201, 169, 97, 0.08)" }}
                        contentStyle={{
                          background: "#0F1923",
                          border: "1px solid #C9A96140",
                        }}
                        labelStyle={{ color: "#E5E7EB" }}
                      />
                      <Legend />
                      <Bar dataKey="disponiveis" stackId="u" fill="#22C55E" name="Disponível" maxBarSize={56} />
                      <Bar dataKey="reservados" stackId="u" fill="#F59E0B" name="Reservado" maxBarSize={56} />
                      <Bar dataKey="vendidos" stackId="u" fill="#EF4444" name="Vendido" maxBarSize={56} />
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="mt-2 text-[11px] text-gray-400">
                    Situação atual (não depende do período). Unidades excluídas
                    ficam fora. Catálogo: só imóveis aprovados, sem os pontos de
                    localização de obras. Não há vínculo entre imóvel do
                    catálogo e unidade de incorporação, então nenhuma unidade
                    é contada nos dois grupos.
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
                <CardHeader>
                  <CardTitle className="text-[#C9A961] text-sm">
                    Funil de Leads
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {data.funilLeads.etapas.map(s => (
                    <div key={s.key}>
                      <div className="flex justify-between text-xs text-gray-300 mb-0.5">
                        <span>{s.label}</span>
                        <span>
                          {s.n} ({s.pct}%)
                        </span>
                      </div>
                      <div className="h-2 bg-[#1A2332] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#C9A961]"
                          style={{ width: `${s.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  <p className="pt-1 text-xs text-gray-300">
                    Total: <span className="font-bold text-white">{data.funilLeads.total}</span> lead(s)
                  </p>
                  <p className="text-[11px] text-gray-400">
                    Leads ativos do CRM (excluídos ficam fora) criados no
                    período, pela etapa atual do pipeline.
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
                <CardHeader>
                  <CardTitle className="text-[#C9A961] text-sm">
                    Ranking de Corretores (comissão paga no período)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {data.corretorRanking.length === 0 ? (
                    <p className="text-gray-400 text-sm">
                      {MENSAGEM_RANKING_VAZIO}.
                    </p>
                  ) : (
                    data.corretorRanking.map((c, i) => (
                      <div
                        key={c.nome}
                        className="flex items-center justify-between text-sm bg-[#1A2332] rounded px-3 py-2"
                      >
                        <span className="text-white">
                          {i + 1}. {c.nome}
                        </span>
                        <span className="text-[#C9A961] font-bold">
                          {formatCurrencyBR(c.totalPago)}
                        </span>
                      </div>
                    ))
                  )}
                  <p className="text-[11px] text-gray-400">
                    Valor efetivamente pago, pela data do pagamento:
                    pagamentos de comissão das obras (corretor do lead da obra)
                    e comissões cadastradas como pagas, sem contar duas vezes a
                    mesma obra.
                  </p>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
