import { useMemo, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  ArrowLeft, Home, Users, Landmark, ClipboardCheck, TrendingUp, DollarSign, Download,
} from "lucide-react";

const PIE_COLORS = ["#C9A961", "#1A2332", "#6B7280", "#D1D5DB", "#4B5563", "#9CA3AF", "#374151", "#E5E7EB"];

const STAGE_LABELS: Record<string, string> = {
  lead_new: "Lead Novo", attending: "Em Atendimento", waiting_docs: "Aguardando Docs",
  analysis: "Em Análise", caixa_register: "Cadastro Caixa", approval: "Em Aprovação",
  approved: "Aprovado", rejected: "Reprovado", followup: "Follow-up",
  in_process: "Cliente em Processo", done: "Concluído",
};

const AVALIACAO_STATUS_LABELS: Record<string, string> = {
  solicitada: "Solicitada", vistoria: "Vistoria", elaboracao: "Elaboração",
  revisao: "Revisão", entregue: "Entregue", cancelada: "Cancelada",
};

function formatCurrencyBR(value: number | string | null | undefined) {
  if (value === null || value === undefined) return "R$ 0,00";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "R$ 0,00";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(num);
}

function isoToInputDate(iso: string) {
  return iso.slice(0, 10);
}

export default function AdminRelatorios() {
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);

  const { data, isLoading } = trpc.relatorios.overview.useQuery({
    from: from || undefined,
    to: to || undefined,
  });

  const exportQuery = trpc.relatorios.exportComissoesCsv.useQuery(undefined, { enabled: false });

  const funilTotal = useMemo(() => {
    if (!data) return 1;
    return data.leadsPorStage.reduce((s, l) => s + l.n, 0) || 1;
  }, [data]);

  async function exportarCsv() {
    const result = await exportQuery.refetch();
    const rows = result.data ?? [];
    const header = "Origem;Data;Corretor;Referência;Valor Total;Pago;Status";
    const linhas = rows.map((r) =>
      [r.origem, r.data, r.corretor, r.referencia ?? "", r.valorTotal.toFixed(2), r.pago.toFixed(2), r.status].join(";")
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
    <div className="min-h-screen bg-[#1A2332] text-white">
      <div className="bg-[#0F1923] border-b border-[#C9A961]/20 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4">
            <Link href="/admin">
              <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-[#C9A961]">Relatórios e Exportações</h1>
              <p className="text-gray-400 text-sm">Indicadores consolidados — imóveis, leads, avaliações, financiamentos e financeiro</p>
            </div>
          </div>
          <Button onClick={exportarCsv} variant="outline" className="border-[#C9A961]/30 text-[#C9A961]">
            <Download className="h-4 w-4 mr-2" /> Exportar CSV (Comissões)
          </Button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <div className="flex gap-3 items-end flex-wrap">
          <div>
            <Label className="text-gray-300 text-xs">De</Label>
            <Input type="date" value={from ? isoToInputDate(from) : (data ? isoToInputDate(data.from) : "")}
              onChange={(e) => setFrom(e.target.value ? new Date(e.target.value).toISOString() : null)}
              className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
          </div>
          <div>
            <Label className="text-gray-300 text-xs">Até</Label>
            <Input type="date" value={to ? isoToInputDate(to) : (data ? isoToInputDate(data.to) : "")}
              onChange={(e) => setTo(e.target.value ? new Date(e.target.value).toISOString() : null)}
              className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
          </div>
        </div>

        {isLoading || !data ? (
          <p className="text-gray-500">Carregando indicadores...</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <Card className="bg-[#2C3E50] border-[#C9A961]/20">
                <CardContent className="pt-6 flex items-center gap-2">
                  <Home className="h-6 w-6 text-[#C9A961]" />
                  <div><p className="text-gray-400 text-xs">Imóveis</p><p className="text-xl font-bold text-white">{data.totalImoveis}</p></div>
                </CardContent>
              </Card>
              <Card className="bg-[#2C3E50] border-[#C9A961]/20">
                <CardContent className="pt-6 flex items-center gap-2">
                  <Users className="h-6 w-6 text-blue-400" />
                  <div><p className="text-gray-400 text-xs">Leads</p><p className="text-xl font-bold text-white">{data.totalLeads}</p></div>
                </CardContent>
              </Card>
              <Card className="bg-[#2C3E50] border-[#C9A961]/20">
                <CardContent className="pt-6 flex items-center gap-2">
                  <Landmark className="h-6 w-6 text-purple-400" />
                  <div><p className="text-gray-400 text-xs">Financiamentos</p><p className="text-xl font-bold text-white">{data.totalFinanciamentos}</p></div>
                </CardContent>
              </Card>
              <Card className="bg-[#2C3E50] border-[#C9A961]/20">
                <CardContent className="pt-6 flex items-center gap-2">
                  <ClipboardCheck className="h-6 w-6 text-yellow-400" />
                  <div>
                    <p className="text-gray-400 text-xs">Avaliações</p>
                    <p className="text-xl font-bold text-white">{data.avaliacoes.total}</p>
                    {data.avaliacoes.mediaValorEstimado != null && (
                      <p className="text-[10px] text-gray-500">média {formatCurrencyBR(data.avaliacoes.mediaValorEstimado)}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-[#2C3E50] border-[#C9A961]/20">
                <CardContent className="pt-6 flex items-center gap-2">
                  <TrendingUp className="h-6 w-6 text-green-400" />
                  <div><p className="text-gray-400 text-xs">Ticket médio</p><p className="text-lg font-bold text-white">{formatCurrencyBR(data.ticketMedio)}</p></div>
                </CardContent>
              </Card>
              <Card className={`bg-[#2C3E50] ${data.resultado >= 0 ? "border-green-500/30" : "border-red-500/30"}`}>
                <CardContent className="pt-6 flex items-center gap-2">
                  <DollarSign className={`h-6 w-6 ${data.resultado >= 0 ? "text-green-400" : "text-red-400"}`} />
                  <div><p className="text-gray-400 text-xs">Resultado (DRE)</p><p className={`text-lg font-bold ${data.resultado >= 0 ? "text-green-400" : "text-red-400"}`}>{formatCurrencyBR(data.resultado)}</p></div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="bg-[#2C3E50] border-[#C9A961]/20">
                <CardHeader><CardTitle className="text-[#C9A961] text-sm">Receitas Realizadas por Competência</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={data.dreMensal}>
                      <defs>
                        <linearGradient id="gradReceitas" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#C9A961" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#C9A961" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="mes" tick={{ fill: "#9CA3AF", fontSize: 11 }} />
                      <YAxis tick={{ fill: "#9CA3AF", fontSize: 11 }} />
                      <Tooltip formatter={(v) => formatCurrencyBR(Number(v))} contentStyle={{ background: "#0F1923", border: "1px solid #C9A96140" }} />
                      <Area type="monotone" dataKey="receitas" stroke="#C9A961" fill="url(#gradReceitas)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="bg-[#2C3E50] border-[#C9A961]/20">
                <CardHeader><CardTitle className="text-[#C9A961] text-sm">DRE — Receitas x Despesas</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data.dreMensal}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="mes" tick={{ fill: "#9CA3AF", fontSize: 11 }} />
                      <YAxis tick={{ fill: "#9CA3AF", fontSize: 11 }} />
                      <Tooltip formatter={(v) => formatCurrencyBR(Number(v))} contentStyle={{ background: "#0F1923", border: "1px solid #C9A96140" }} />
                      <Legend />
                      <Bar dataKey="receitas" fill="#22C55E" name="Receitas" />
                      <Bar dataKey="despesas" fill="#EF4444" name="Despesas" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="bg-[#2C3E50] border-[#C9A961]/20">
                <CardHeader><CardTitle className="text-[#C9A961] text-sm">Imóveis por Tipo</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={data.imoveisPorTipo} dataKey="n" nameKey="tipo" cx="50%" cy="50%" outerRadius={80} label>
                        {data.imoveisPorTipo.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: "#0F1923", border: "1px solid #C9A96140" }} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="bg-[#2C3E50] border-[#C9A961]/20">
                <CardHeader><CardTitle className="text-[#C9A961] text-sm">Avaliações por Status</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={data.avaliacoes.porStatus.map((s) => ({ ...s, label: AVALIACAO_STATUS_LABELS[s.status] ?? s.status }))}
                        dataKey="n" nameKey="label" cx="50%" cy="50%" outerRadius={80} label
                      >
                        {data.avaliacoes.porStatus.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: "#0F1923", border: "1px solid #C9A96140" }} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="bg-[#2C3E50] border-[#C9A961]/20">
                <CardHeader><CardTitle className="text-[#C9A961] text-sm">Funil de Leads</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {data.leadsPorStage.map((s) => {
                    const pct = Math.round((s.n / funilTotal) * 100);
                    return (
                      <div key={s.stage}>
                        <div className="flex justify-between text-xs text-gray-300 mb-0.5">
                          <span>{STAGE_LABELS[s.stage] ?? s.stage}</span>
                          <span>{s.n} ({pct}%)</span>
                        </div>
                        <div className="h-2 bg-[#1A2332] rounded-full overflow-hidden">
                          <div className="h-full bg-[#C9A961]" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              <Card className="bg-[#2C3E50] border-[#C9A961]/20">
                <CardHeader><CardTitle className="text-[#C9A961] text-sm">Ranking de Corretores (comissão paga)</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {data.corretorRanking.length === 0 ? (
                    <p className="text-gray-500 text-sm">Nenhuma comissão registrada ainda.</p>
                  ) : (
                    data.corretorRanking.map((c, i) => (
                      <div key={c.nome} className="flex items-center justify-between text-sm bg-[#1A2332] rounded px-3 py-2">
                        <span className="text-white">{i + 1}. {c.nome}</span>
                        <span className="text-[#C9A961] font-bold">{formatCurrencyBR(c.totalPago)}</span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
