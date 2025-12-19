import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { 
  ArrowLeft, 
  TrendingUp, 
  FileText, 
  Building2, 
  Gift, 
  Coins, 
  Users,
  Loader2 
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";

export default function AdminDashboard() {
  const [, setLocation] = useLocation();
  const { user, loading: authLoading, isAuthenticated } = useAuth();

  // Redirecionar se não autenticado ou não admin
  useEffect(() => {
    if (!authLoading && (!isAuthenticated || user?.role !== "admin")) {
      window.location.href = getLoginUrl();
    }
  }, [authLoading, isAuthenticated, user]);

  // Buscar estatísticas
  const { data: stats, isLoading: statsLoading } = trpc.analytics.getStats.useQuery();
  const { data: budgetsByStatus } = trpc.analytics.getBudgetRequestsByStatus.useQuery();
  const { data: projectsByStatus } = trpc.analytics.getProjectsByStatus.useQuery();
  const { data: recentBudgets } = trpc.analytics.getRecentBudgetRequests.useQuery({ limit: 5 });

  if (authLoading || statsLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#1A2332] via-[#2C3E50] to-[#1A2332] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#C9A961]" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#1A2332] via-[#2C3E50] to-[#1A2332] flex items-center justify-center">
        <p className="text-gray-400">Erro ao carregar estatísticas</p>
      </div>
    );
  }

  // Cores para gráficos
  const COLORS = ["#C9A961", "#00FF00", "#3B82F6", "#EF4444", "#8B5CF6"];

  // Dados para gráfico de orçamentos
  const budgetChartData = budgetsByStatus?.map((item) => ({
    name: {
      pending: "Pendente",
      contacted: "Contatado",
      in_negotiation: "Em Negociação",
      converted: "Convertido",
      cancelled: "Cancelado"
    }[item.status] || item.status,
    value: Number(item.count)
  })) || [];

  // Dados para gráfico de obras
  const projectChartData = projectsByStatus?.map((item) => ({
    name: {
      planning: "Planejamento",
      in_progress: "Em Andamento",
      completed: "Concluída",
      on_hold: "Pausada",
      cancelled: "Cancelada",
      paused: "Pausada"
    }[item.status as string] || item.status,
    value: Number(item.count)
  })) || [];

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
      {/* Header */}
      <div className="bg-[#1A2332]/80 backdrop-blur-sm border-b border-[#C9A961]/20 sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/admin">
            <a className="text-[#C9A961] hover:text-[#B8935A] transition-colors flex items-center gap-2">
              <ArrowLeft className="h-5 w-5" />
              Voltar para Admin
            </a>
          </Link>
          <h1 className="text-2xl font-bold text-[#C9A961]">Dashboard Analytics</h1>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-8">
        {/* Cards de Métricas Principais */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {/* Orçamentos */}
          <Card className="bg-[#1A2332]/60 border-[#C9A961]/20">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-[#C9A961] text-lg">Orçamentos</CardTitle>
                <FileText className="h-5 w-5 text-[#C9A961]" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white mb-2">{stats.budgetRequests.total}</div>
              <div className="text-sm text-gray-400">
                {stats.budgetRequests.pending} pendentes • {stats.budgetRequests.conversionRate}% conversão
              </div>
            </CardContent>
          </Card>

          {/* Obras */}
          <Card className="bg-[#1A2332]/60 border-[#C9A961]/20">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-[#C9A961] text-lg">Obras</CardTitle>
                <Building2 className="h-5 w-5 text-[#C9A961]" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white mb-2">{stats.projects.total}</div>
              <div className="text-sm text-gray-400">
                {stats.projects.active} ativas • {stats.projects.completed} concluídas
              </div>
            </CardContent>
          </Card>

          {/* Sorteios */}
          <Card className="bg-[#1A2332]/60 border-[#C9A961]/20">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-[#C9A961] text-lg">Sorteios</CardTitle>
                <Gift className="h-5 w-5 text-[#C9A961]" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white mb-2">{stats.draws.total}</div>
              <div className="text-sm text-gray-400">
                {stats.draws.active} ativos • {stats.tickets.total} bilhetes vendidos
              </div>
            </CardContent>
          </Card>

          {/* UTEFs */}
          <Card className="bg-[#1A2332]/60 border-[#C9A961]/20">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-[#C9A961] text-lg">UTEFs</CardTitle>
                <Coins className="h-5 w-5 text-[#C9A961]" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white mb-2">
                {(stats.utef.totalBalance / 100).toLocaleString("pt-BR")}
              </div>
              <div className="text-sm text-gray-400">
                {stats.utef.totalTransactions} transações
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Gráficos */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Gráfico de Orçamentos */}
          <Card className="bg-[#1A2332]/60 border-[#C9A961]/20">
            <CardHeader>
              <CardTitle className="text-[#C9A961]">Orçamentos por Status</CardTitle>
              <CardDescription className="text-gray-400">
                Distribuição de orçamentos por status atual
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={budgetChartData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {budgetChartData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Gráfico de Obras */}
          <Card className="bg-[#1A2332]/60 border-[#C9A961]/20">
            <CardHeader>
              <CardTitle className="text-[#C9A961]">Obras por Status</CardTitle>
              <CardDescription className="text-gray-400">
                Distribuição de obras por status atual
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={projectChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#C9A961" opacity={0.1} />
                  <XAxis dataKey="name" stroke="#C9A961" />
                  <YAxis stroke="#C9A961" />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: "#1A2332", 
                      border: "1px solid #C9A961",
                      borderRadius: "8px"
                    }} 
                  />
                  <Bar dataKey="value" fill="#C9A961" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Orçamentos Recentes */}
        <Card className="bg-[#1A2332]/60 border-[#C9A961]/20">
          <CardHeader>
            <CardTitle className="text-[#C9A961]">Orçamentos Recentes</CardTitle>
            <CardDescription className="text-gray-400">
              Últimos 5 orçamentos solicitados
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentBudgets && recentBudgets.length > 0 ? (
                recentBudgets.map((budget) => (
                  <div key={budget.id} className="flex items-center justify-between p-4 bg-[#1A2332]/40 rounded-lg border border-[#C9A961]/10">
                    <div>
                      <p className="text-white font-semibold">{budget.name}</p>
                      <p className="text-sm text-gray-400">{budget.email} • {budget.phone}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {budget.city} • {budget.projectType} • {budget.hasLot ? "Tem lote" : "Não tem lote"}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                        budget.status === "converted" ? "bg-green-500/20 text-green-400" :
                        budget.status === "in_negotiation" ? "bg-blue-500/20 text-blue-400" :
                        budget.status === "contacted" ? "bg-yellow-500/20 text-yellow-400" :
                        budget.status === "cancelled" ? "bg-red-500/20 text-red-400" :
                        "bg-gray-500/20 text-gray-400"
                      }`}>
                        {budget.status === "converted" ? "Convertido" :
                         budget.status === "in_negotiation" ? "Em Negociação" :
                         budget.status === "contacted" ? "Contatado" :
                         budget.status === "cancelled" ? "Cancelado" :
                         "Pendente"}
                      </span>
                      <p className="text-xs text-gray-500 mt-2">
                        {new Date(budget.createdAt).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-gray-400 text-center py-8">Nenhum orçamento encontrado</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Card de Usuários */}
        <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 mt-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-[#C9A961]">Usuários Cadastrados</CardTitle>
                <CardDescription className="text-gray-400">
                  Total de usuários na plataforma
                </CardDescription>
              </div>
              <Users className="h-8 w-8 text-[#C9A961]" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-white">{stats.users.total}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
