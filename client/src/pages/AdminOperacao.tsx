import { ArrowRight, CheckCircle2, CircleDashed, ExternalLink, LayoutDashboard, Building2, ClipboardList, FileCheck2, Landmark, Map, MessageCircle, Scale, Ship, Users, WalletCards } from "lucide-react";
import { Link } from "wouter";
import Navbar from "@/components/Navbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const modules = [
  { title: "Dashboard", description: "Indicadores administrativos e visão geral da Prospecta.", href: "/admin/dashboard", status: "available", icon: LayoutDashboard },
  { title: "CRM e Leads", description: "Pipeline, documentos, follow-ups, visitas e conversões.", href: "/admin/crm", status: "available", icon: Users },
  { title: "Obras", description: "Obras, etapas, medições, empreiteiros e custos.", href: "/admin/obras", status: "available", icon: Building2 },
  { title: "Orçamentos", description: "Solicitações e oportunidades de construção.", href: "/admin/orcamentos", status: "available", icon: ClipboardList },
  { title: "Tarefas e SLA", description: "Pendências, responsáveis e prazos operacionais.", href: "/admin/tarefas", status: "available", icon: FileCheck2 },
  { title: "Lotes e Projetos", description: "Lotes, investidores, corretores e distribuição.", href: "/admin/lotes", status: "available", icon: Map },
  { title: "Financeiro Prospecta", description: "Transações próprias da Prospecta, sem misturar Exclusive.", href: "/admin/financeiro", status: "available", icon: WalletCards },
  { title: "WhatsApp e Comunicações", description: "Canal de comunicação a ser conectado à Dolores 9A.", href: "/admin/emails", status: "available", icon: MessageCircle },
  { title: "Regularização", description: "Processos imobiliários, documentos e prazos do Maranhão.", href: null, status: "planned", icon: Scale },
  { title: "Incorporação", description: "Viabilidade, terreno, orçamento, projetos e lançamento.", href: null, status: "planned", icon: Landmark },
  { title: "Avaliações e Feeds", description: "Avaliações, comparáveis e divulgação imobiliária.", href: null, status: "planned", icon: ExternalLink },
  { title: "Exclusive Club", description: "Integração futura somente leitura; BPO e financeiro permanecem independentes.", href: null, status: "protected", icon: Ship },
];

export default function AdminOperacao() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 py-12">
        <div className="container max-w-6xl space-y-8">
          <header className="space-y-3">
            <p className="text-sm font-semibold uppercase tracking-wider text-primary">Paridade Dolores 9A</p>
            <h1 className="text-3xl font-bold">Centro de Operação da Prospecta</h1>
            <p className="max-w-3xl text-muted-foreground">
              Esta área organiza a paridade funcional com o Grupo Santa Fé sem substituir a landing page pública, o UTEF ou os dados existentes da Prospecta. Os módulos marcados como planejados serão portados em etapas.
            </p>
          </header>

          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <CardTitle>Regra de independência</CardTitle>
              <CardDescription>
                A Prospecta mantém seu próprio banco Neon, regras e operações. O Centro de Operações recebe apenas leituras e eventos; não escreve no Grupo Santa Fé, Exclusive Club, Factoring ou AuditX nesta fase.
              </CardDescription>
            </CardHeader>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((module) => {
              const Icon = module.icon;
              const isAvailable = module.status === "available";
              const isProtected = module.status === "protected";
              const content = (
                <Card className="h-full transition-colors hover:border-primary/50">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <Icon className="h-5 w-5 text-primary" />
                      {isAvailable ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-label="Disponível" />
                      ) : (
                        <CircleDashed className="h-4 w-4 text-muted-foreground" aria-label={isProtected ? "Protegido" : "Planejado"} />
                      )}
                    </div>
                    <CardTitle className="text-lg">{module.title}</CardTitle>
                    <CardDescription>{module.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{isAvailable ? "Disponível" : isProtected ? "Fronteira protegida" : "Em adaptação"}</span>
                      {isAvailable && <ArrowRight className="h-4 w-4" />}
                    </div>
                  </CardContent>
                </Card>
              );

              return module.href ? (
                <Link key={module.title} href={module.href} className="block">
                  {content}
                </Link>
              ) : (
                <div key={module.title}>{content}</div>
              );
            })}
          </div>

          <p className="text-sm text-muted-foreground">
            A próxima etapa de implementação prioriza Regularização e Incorporação, pois são os domínios que completam a operação da Prospecta no Maranhão. A integração com a Exclusive será sempre somente leitura e nunca alterará o BPO ou o financeiro da empresa.
          </p>
        </div>
      </main>
    </div>
  );
}
