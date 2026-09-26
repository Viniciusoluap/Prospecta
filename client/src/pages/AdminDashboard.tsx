import { useMemo, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowLeft,
  BarChart3,
  CircleDollarSign,
  Gauge,
  Loader2,
  Save,
  ShieldAlert,
  Users,
  WalletCards,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const MONEY = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const NUMBER = new Intl.NumberFormat("pt-BR");
const TABS = [
  ["executivo", "Executivo", Gauge],
  ["vendas", "Vendas", BarChart3],
  ["financeiro", "Financeiro", WalletCards],
  ["cobranca", "Cobrança", CircleDollarSign],
  ["crise", "Crise", ShieldAlert],
  ["pessoas", "Pessoas", Users],
] as const;
type Tab = (typeof TABS)[number][0];

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function monthKey(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function daysLate(value: Date | string | null | undefined) {
  if (!value) return 0;
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000)
  );
}

function Metric({
  label,
  value,
  detail,
  tone = "gold",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "gold" | "green" | "red" | "blue";
}) {
  const tones = {
    gold: "text-[#C9A961]",
    green: "text-emerald-400",
    red: "text-red-400",
    blue: "text-sky-400",
  };
  return (
    <Card className="bg-[#172231] border-white/10">
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-widest text-slate-400">
          {label}
        </p>
        <p className={`mt-2 text-2xl font-black ${tones[tone]}`}>{value}</p>
        {detail ? (
          <p className="mt-1 text-xs text-slate-500">{detail}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="bg-[#172231] border-white/10">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm uppercase tracking-wider text-white">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-48 grid place-items-center text-center text-sm text-slate-500 border border-dashed border-white/10">
      {children}
    </div>
  );
}
function Ranking({ rows }: { rows: { name: string; value: number }[] }) {
  return rows.length ? (
    <div className="divide-y divide-white/10">
      {rows.map((row, index) => (
        <div key={row.name} className="flex justify-between gap-3 py-3 text-sm">
          <span>
            {index + 1}. {row.name}
          </span>
          <b>{MONEY.format(row.value)}</b>
        </div>
      ))}
    </div>
  ) : (
    <Empty>Sem dados pagos no mês.</Empty>
  );
}

export default function AdminDashboard() {
  const [tab, setTab] = useState<Tab>("executivo");
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [goalDraft, setGoalDraft] = useState("");
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.analytics.getManagementDashboard.useQuery();
  const persistedGoal = number(
    data?.settings.find(item => item.key === "monthly_sales_goal")?.value
  );
  const saveGoal = trpc.analytics.saveMonthlyGoal.useMutation({
    onSuccess: () => utils.analytics.getManagementDashboard.invalidate(),
  });

  const metrics = useMemo(() => {
    if (!data) return null;
    const goal = persistedGoal;
    const incomeTypes = new Set(["income", "commission"]);
    const expenseTypes = new Set(["expense", "salary", "contractor_payment"]);
    const paid = data.transactions.filter(item => item.status === "paid");
    const monthlyPaid = paid.filter(
      item => monthKey(item.paidAt ?? item.createdAt) === month
    );
    const revenue = monthlyPaid
      .filter(item => incomeTypes.has(item.type))
      .reduce((sum, item) => sum + number(item.amount), 0);
    const costs = monthlyPaid
      .filter(item => expenseTypes.has(item.type))
      .reduce((sum, item) => sum + number(item.amount), 0);
    const result = revenue - costs;
    const cash = data.accounts.reduce(
      (sum, account) => sum + number(account.saldoAtual),
      0
    );
    const bankMonth = data.bankTx.filter(
      item => monthKey(item.data) === month && item.status !== "ignorado"
    );
    const entries = bankMonth
      .filter(item => item.tipo === "credito")
      .reduce((sum, item) => sum + number(item.valor), 0);
    const exits = bankMonth
      .filter(item => item.tipo === "debito")
      .reduce((sum, item) => sum + Math.abs(number(item.valor)), 0);
    const now = Date.now();
    const in30 = now + 30 * 86_400_000;
    const pending = data.transactions.filter(item => item.status === "pending");
    const receivable = pending.filter(item => incomeTypes.has(item.type));
    const payable = pending.filter(item => expenseTypes.has(item.type));
    const receive30 = receivable
      .filter(
        item =>
          item.dueDate &&
          new Date(item.dueDate).getTime() >= now &&
          new Date(item.dueDate).getTime() <= in30
      )
      .reduce((sum, item) => sum + number(item.amount), 0);
    const pay30 = payable
      .filter(
        item =>
          item.dueDate &&
          new Date(item.dueDate).getTime() >= now &&
          new Date(item.dueDate).getTime() <= in30
      )
      .reduce((sum, item) => sum + number(item.amount), 0);
    const closedStages = new Set(["aprovado", "entregue"]);
    const monthProjects = data.projects.filter(
      item => monthKey(item.createdAt) === month
    );
    const closedProjects = monthProjects.filter(item =>
      closedStages.has(item.status)
    );
    const salesRevenue =
      closedProjects.reduce((sum, item) => sum + number(item.value), 0) ||
      revenue;
    const ticket = closedProjects.length
      ? salesRevenue / closedProjects.length
      : 0;
    const stages = [
      "lead_new",
      "contacted",
      "documentation",
      "analysis",
      "approved",
      "contract_signed",
    ];
    const stageLabels: Record<string, string> = {
      lead_new: "Novos",
      contacted: "Contato",
      documentation: "Documentos",
      analysis: "Análise",
      approved: "Aprovados",
      contract_signed: "Fechados",
    };
    const funnelRows = stages.map(stage => ({
      name: stageLabels[stage],
      value: data.leads.filter(lead => lead.stage === stage).length,
    }));
    const monthly = Array.from({ length: 6 }, (_, index) => {
      const base = new Date(`${month}-01T12:00:00`);
      base.setMonth(base.getMonth() - (5 - index));
      const key = monthKey(base);
      const rows = paid.filter(
        item => monthKey(item.paidAt ?? item.createdAt) === key
      );
      const monthEnd = new Date(
        base.getFullYear(),
        base.getMonth() + 1,
        0,
        23,
        59,
        59
      ).getTime();
      const dueIncome = data.transactions.filter(
        item =>
          incomeTypes.has(item.type) &&
          item.status !== "cancelled" &&
          item.dueDate &&
          new Date(item.dueDate).getTime() <= monthEnd
      );
      const dueTotal = dueIncome.reduce(
        (sum, item) => sum + number(item.amount),
        0
      );
      const outstanding = dueIncome
        .filter(
          item =>
            item.status !== "paid" ||
            !item.paidAt ||
            new Date(item.paidAt).getTime() > monthEnd
        )
        .reduce((sum, item) => sum + number(item.amount), 0);
      return {
        month: base.toLocaleDateString("pt-BR", { month: "short" }),
        receita: rows
          .filter(item => incomeTypes.has(item.type))
          .reduce((sum, item) => sum + number(item.amount), 0),
        custos: rows
          .filter(item => expenseTypes.has(item.type))
          .reduce((sum, item) => sum + number(item.amount), 0),
        meta: goal,
        inadimplencia: dueTotal > 0 ? (outstanding / dueTotal) * 100 : 0,
      };
    });
    const debtors = receivable
      .map(item => ({
        name: item.vendor || item.responsible || item.description,
        value: number(item.amount),
        days: daysLate(item.dueDate),
      }))
      .filter(item => item.days > 0)
      .sort((a, b) => b.value - a.value);
    const aging = [
      {
        name: "Até 30",
        value: debtors
          .filter(d => d.days <= 30)
          .reduce((s, d) => s + d.value, 0),
        color: "#22c55e",
      },
      {
        name: "31–60",
        value: debtors
          .filter(d => d.days > 30 && d.days <= 60)
          .reduce((s, d) => s + d.value, 0),
        color: "#eab308",
      },
      {
        name: "61–90",
        value: debtors
          .filter(d => d.days > 60 && d.days <= 90)
          .reduce((s, d) => s + d.value, 0),
        color: "#f97316",
      },
      {
        name: "90+",
        value: debtors
          .filter(d => d.days > 90)
          .reduce((s, d) => s + d.value, 0),
        color: "#ef4444",
      },
    ];
    const overdue = debtors.reduce((sum, item) => sum + item.value, 0);
    const recovered = monthlyPaid
      .filter(item => incomeTypes.has(item.type))
      .reduce((sum, item) => sum + number(item.amount), 0);
    const recoveryRate =
      recovered + overdue ? (recovered / (recovered + overdue)) * 100 : 0;
    const averageCosts =
      monthly.slice(-3).reduce((sum, item) => sum + item.custos, 0) / 3;
    const runway = averageCosts > 0 ? cash / averageCosts : null;
    const contribution =
      revenue > 0 ? ((revenue - costs) / revenue) * 100 : null;
    const costByCategory = new Map<string, number>();
    monthlyPaid
      .filter(item => expenseTypes.has(item.type))
      .forEach(item =>
        costByCategory.set(
          item.category || "Sem categoria",
          (costByCategory.get(item.category || "Sem categoria") || 0) +
            number(item.amount)
        )
      );
    const rankedCosts = Array.from(costByCategory)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
    const userNames = new Map(data.users.map(user => [user.id, user.name]));
    const monthCommissions = data.commissions.filter(
      item => item.paidAt && monthKey(item.paidAt) === month
    );
    const rank = (
      keyOf: (item: (typeof monthCommissions)[number]) => string
    ) => {
      const totals = new Map<string, number>();
      monthCommissions.forEach(item => {
        const key = keyOf(item);
        totals.set(key, (totals.get(key) || 0) + number(item.amount));
      });
      return Array.from(totals)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);
    };
    const sellerRanking = rank(item =>
      item.brokerId
        ? userNames.get(item.brokerId) || "Corretor não identificado"
        : "Empresa"
    );
    const productRanking = rank(
      item => item.businessType || item.property || "Sem categoria"
    );
    const categoryRows = new Map<string, { revenue: number; costs: number }>();
    monthlyPaid.forEach(item => {
      const key = item.category || "Sem categoria";
      const row = categoryRows.get(key) || { revenue: 0, costs: 0 };
      if (incomeTypes.has(item.type)) row.revenue += number(item.amount);
      if (expenseTypes.has(item.type)) row.costs += number(item.amount);
      categoryRows.set(key, row);
    });
    const categoryMargins = Array.from(categoryRows)
      .filter(([, row]) => row.revenue > 0)
      .map(([name, row]) => ({
        name,
        value: ((row.revenue - row.costs) / row.revenue) * 100,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
    const activePeople = data.users.filter(
      user =>
        user.active && ["admin", "funcionario", "corretor"].includes(user.role)
    );
    return {
      goal,
      goalPct: goal > 0 ? (salesRevenue / goal) * 100 : null,
      revenue,
      costs,
      result,
      cash,
      projectedCash: cash + receive30 - pay30,
      entries,
      exits,
      receive30,
      pay30,
      salesRevenue,
      ticket,
      closedCount: closedProjects.length,
      funnelRows,
      monthly,
      debtors,
      aging,
      overdue,
      recoveryRate,
      runway,
      contribution,
      rankedCosts,
      categoryMargins,
      sellerRanking,
      productRanking,
      activePeople: activePeople.length,
      revenuePerPerson: activePeople.length ? revenue / activePeople.length : 0,
    };
  }, [data, month, persistedGoal]);

  if (isLoading || !metrics)
    return (
      <div className="min-h-screen bg-[#101923] grid place-items-center">
        <Loader2 className="animate-spin text-[#C9A961]" />
      </div>
    );
  const m = metrics;
  const light = (score: number) =>
    score >= 70
      ? "bg-emerald-400"
      : score >= 40
        ? "bg-amber-400"
        : "bg-red-400";

  return (
    <div className="min-h-screen bg-[#101923] text-white">
      <header className="border-b border-white/10 bg-[#101923]/95 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-wrap items-center gap-4 justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin">
              <Button size="icon" variant="ghost">
                <ArrowLeft />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-black text-[#C9A961]">
                Central de Gestão
              </h1>
              <p className="text-xs text-slate-400">
                Decisões com dados reais do sistema
              </p>
            </div>
          </div>
          <Input
            type="month"
            value={month}
            onChange={event => setMonth(event.target.value)}
            className="w-44 bg-[#172231] border-white/10"
          />
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6 space-y-5">
        <nav
          className="flex overflow-x-auto border-b border-white/10"
          aria-label="Áreas do dashboard"
        >
          {TABS.map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-bold whitespace-nowrap border-b-2 ${tab === key ? "border-[#C9A961] text-[#C9A961]" : "border-transparent text-slate-400"}`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
        {tab === "executivo" ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {[
                ["Vendas", MONEY.format(m.salesRevenue), m.goalPct ?? 0],
                ["Caixa", MONEY.format(m.cash), m.cash > 0 ? 100 : 0],
                [
                  "Cobrança",
                  MONEY.format(m.overdue),
                  m.overdue === 0 ? 100 : m.recoveryRate,
                ],
                ["Resultado", MONEY.format(m.result), m.result > 0 ? 100 : 0],
                [
                  "Pessoas",
                  NUMBER.format(m.activePeople),
                  m.activePeople > 0 ? 100 : 0,
                ],
              ].map(([label, value, score]) => (
                <Card
                  key={String(label)}
                  className="bg-[#172231] border-white/10"
                >
                  <CardContent className="p-4">
                    <div className="flex justify-between items-center">
                      <p className="text-xs text-slate-400 uppercase">
                        {label}
                      </p>
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${light(Number(score))}`}
                      />
                    </div>
                    <p className="text-xl font-black mt-4">{value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Panel title="3 destaques do mês">
              <div className="grid md:grid-cols-3 gap-4 text-sm">
                <p>
                  <b className="text-[#C9A961]">1.</b> Vendas em{" "}
                  {m.goalPct == null
                    ? "meta não configurada"
                    : `${m.goalPct.toFixed(0)}% da meta`}
                  .
                </p>
                <p>
                  <b className="text-[#C9A961]">2.</b> Resultado do mês:{" "}
                  {MONEY.format(m.result)}.
                </p>
                <p>
                  <b className="text-[#C9A961]">3.</b> {MONEY.format(m.overdue)}{" "}
                  vencidos para cobrar.
                </p>
              </div>
            </Panel>
          </>
        ) : null}
        {tab === "vendas" ? (
          <>
            <div className="grid md:grid-cols-4 gap-3">
              <Metric
                label="Receita do mês"
                value={MONEY.format(m.salesRevenue)}
                tone="blue"
                detail={
                  m.goalPct == null
                    ? "Defina a meta"
                    : `${m.goalPct.toFixed(1)}% da meta`
                }
              />
              <Metric
                label="Meta do mês"
                value={m.goal ? MONEY.format(m.goal) : "Não definida"}
              />
              <Metric
                label="Ticket médio"
                value={m.ticket ? MONEY.format(m.ticket) : "—"}
              />
              <Metric
                label="Negócios fechados"
                value={NUMBER.format(m.closedCount)}
                tone="green"
              />
            </div>
            <Panel title="Definir meta mensal">
              <div className="flex gap-2 max-w-md">
                <Input
                  type="number"
                  min="0"
                  placeholder={String(m.goal || 0)}
                  value={goalDraft}
                  onChange={e => setGoalDraft(e.target.value)}
                  className="bg-[#101923] border-white/10"
                />
                <Button
                  onClick={() => saveGoal.mutate({ value: number(goalDraft) })}
                  disabled={!goalDraft || saveGoal.isPending}
                  className="bg-[#C9A961] text-[#101923]"
                >
                  <Save size={16} className="mr-2" />
                  Salvar
                </Button>
              </div>
            </Panel>
            <div className="grid lg:grid-cols-2 gap-4">
              <Panel title="Receita mensal x meta">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={m.monthly}>
                    <CartesianGrid stroke="#ffffff12" />
                    <XAxis dataKey="month" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip formatter={v => MONEY.format(number(v))} />
                    <Bar dataKey="receita" fill="#3b82f6" />
                    <Bar dataKey="meta" fill="#C9A961" opacity={0.35} />
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
              <Panel title="Funil de vendas">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={m.funnelRows} layout="vertical">
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={85}
                      stroke="#94a3b8"
                    />
                    <Tooltip />
                    <Bar dataKey="value" fill="#3b82f6" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
              <Panel title="Ranking de vendedores">
                <Ranking rows={m.sellerRanking} />
              </Panel>
              <Panel title="Ranking de produtos / serviços">
                <Ranking rows={m.productRanking} />
              </Panel>
            </div>
          </>
        ) : null}
        {tab === "financeiro" ? (
          <>
            <div className="grid md:grid-cols-5 gap-3">
              <Metric
                label="Caixa hoje"
                value={MONEY.format(m.cash)}
                tone={m.cash >= 0 ? "green" : "red"}
              />
              <Metric
                label="Caixa projetado 30d"
                value={MONEY.format(m.projectedCash)}
                tone={m.projectedCash >= 0 ? "green" : "red"}
              />
              <Metric
                label="Entradas do mês"
                value={MONEY.format(m.entries)}
                tone="green"
              />
              <Metric
                label="Saídas do mês"
                value={MONEY.format(m.exits)}
                tone="red"
              />
              <Metric
                label="Resultado DRE"
                value={MONEY.format(m.result)}
                tone={m.result >= 0 ? "green" : "red"}
              />
            </div>
            <div className="grid lg:grid-cols-2 gap-4">
              <Panel title="Fluxo realizado">
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={m.monthly}>
                    <CartesianGrid stroke="#ffffff12" />
                    <XAxis dataKey="month" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip formatter={v => MONEY.format(number(v))} />
                    <Area dataKey="receita" stroke="#22c55e" fill="#22c55e22" />
                    <Area dataKey="custos" stroke="#ef4444" fill="#ef444422" />
                  </AreaChart>
                </ResponsiveContainer>
              </Panel>
              <Panel title="Próximos 30 dias">
                <div className="grid grid-cols-2 gap-4 mt-8">
                  <Metric
                    label="A receber"
                    value={MONEY.format(m.receive30)}
                    tone="green"
                  />
                  <Metric
                    label="A pagar"
                    value={MONEY.format(m.pay30)}
                    tone="red"
                  />
                </div>
                <div className="mt-5 p-4 bg-[#101923] text-sm">
                  <div className="flex justify-between">
                    <span>Receita</span>
                    <b>{MONEY.format(m.revenue)}</b>
                  </div>
                  <div className="flex justify-between mt-2">
                    <span>Custos e despesas</span>
                    <b>{MONEY.format(m.costs)}</b>
                  </div>
                  <div className="flex justify-between border-t border-white/10 mt-3 pt-3">
                    <span>Resultado</span>
                    <b
                      className={
                        m.result >= 0 ? "text-emerald-400" : "text-red-400"
                      }
                    >
                      {MONEY.format(m.result)}
                    </b>
                  </div>
                </div>
              </Panel>
            </div>
          </>
        ) : null}
        {tab === "cobranca" ? (
          <>
            <div className="grid md:grid-cols-3 gap-3">
              <Metric
                label="Total vencido"
                value={MONEY.format(m.overdue)}
                tone="red"
              />
              <Metric
                label="Acima de 90 dias"
                value={MONEY.format(m.aging[3].value)}
                tone="red"
              />
              <Metric
                label="Taxa de recuperação"
                value={`${m.recoveryRate.toFixed(1)}%`}
              />
            </div>
            <div className="grid lg:grid-cols-2 gap-4">
              <Panel title="Aging da carteira">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={m.aging}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={90}
                    >
                      {m.aging.map(item => (
                        <Cell key={item.name} fill={item.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={v => MONEY.format(number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              </Panel>
              <Panel title="Evolução da inadimplência">
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={m.monthly}>
                    <CartesianGrid stroke="#ffffff12" />
                    <XAxis dataKey="month" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" unit="%" />
                    <Tooltip formatter={v => `${number(v).toFixed(1)}%`} />
                    <Area
                      dataKey="inadimplencia"
                      stroke="#ef4444"
                      fill="#ef444422"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </Panel>
              <Panel title="Quem cobrar primeiro">
                {m.debtors.length ? (
                  <div className="divide-y divide-white/10">
                    {m.debtors.slice(0, 10).map((item, index) => (
                      <div
                        key={`${item.name}-${index}`}
                        className="py-3 flex justify-between gap-3"
                      >
                        <div>
                          <p className="font-bold">
                            {index + 1}. {item.name}
                          </p>
                          <p className="text-xs text-red-400">
                            {item.days} dias em atraso
                          </p>
                        </div>
                        <b>{MONEY.format(item.value)}</b>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty>Nenhum recebível vencido.</Empty>
                )}
              </Panel>
            </div>
          </>
        ) : null}
        {tab === "crise" ? (
          <>
            <div className="grid md:grid-cols-3 gap-3">
              <Metric
                label="Break-even mensal"
                value={MONEY.format(m.costs)}
                tone="red"
                detail="Receita necessária para empatar"
              />
              <Metric
                label="Runway"
                value={
                  m.runway == null ? "Sem base" : `${m.runway.toFixed(1)} meses`
                }
                tone={m.runway != null && m.runway >= 6 ? "green" : "red"}
              />
              <Metric
                label="Margem de contribuição"
                value={
                  m.contribution == null
                    ? "Sem receita"
                    : `${m.contribution.toFixed(1)}%`
                }
                tone={
                  m.contribution != null && m.contribution > 0 ? "green" : "red"
                }
              />
            </div>
            <div className="grid lg:grid-cols-2 gap-4">
              <Panel title="Custos ranqueados">
                {m.rankedCosts.length ? (
                  <ResponsiveContainer
                    width="100%"
                    height={Math.max(220, m.rankedCosts.length * 38)}
                  >
                    <BarChart data={m.rankedCosts} layout="vertical">
                      <XAxis type="number" hide />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={120}
                        stroke="#94a3b8"
                      />
                      <Tooltip formatter={v => MONEY.format(number(v))} />
                      <Bar
                        dataKey="value"
                        fill="#ef4444"
                        radius={[0, 6, 6, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty>Cadastre despesas pagas para formar o ranking.</Empty>
                )}
              </Panel>
              <Panel title="Margem por categoria">
                {m.categoryMargins.length ? (
                  <div className="divide-y divide-white/10">
                    {m.categoryMargins.map(item => (
                      <div
                        key={item.name}
                        className="flex justify-between py-3 text-sm"
                      >
                        <span>{item.name}</span>
                        <b
                          className={
                            item.value >= 0
                              ? "text-emerald-400"
                              : "text-red-400"
                          }
                        >
                          {item.value.toFixed(1)}%
                        </b>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty>
                    Associe receitas e despesas às mesmas categorias.
                  </Empty>
                )}
              </Panel>
            </div>
          </>
        ) : null}
        {tab === "pessoas" ? (
          <>
            <div className="grid md:grid-cols-4 gap-3">
              <Metric
                label="Pessoas ativas"
                value={NUMBER.format(m.activePeople)}
                tone="blue"
              />
              <Metric
                label="Receita por pessoa"
                value={m.activePeople ? MONEY.format(m.revenuePerPerson) : "—"}
              />
              <Metric
                label="Turnover (12m)"
                value="Sem registro"
                detail="Exige data de desligamento"
              />
              <Metric
                label="Absenteísmo"
                value="Sem registro"
                detail="Exige controle de ponto"
              />
            </div>
            <Panel title="Leitura gerencial">
              <div className="grid md:grid-cols-2 gap-4 text-sm text-slate-300">
                <p>
                  O headcount soma administradores, funcionários e corretores
                  ativos.
                </p>
                <p>
                  Horas extras, faltas e turnover aparecerão quando houver
                  eventos de RH registrados; o painel não estima números.
                </p>
              </div>
            </Panel>
          </>
        ) : null}
      </main>
    </div>
  );
}
