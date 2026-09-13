import { Link } from "wouter";
import { BookOpen, Building2, CheckSquare, ClipboardCheck, FileCheck2, HardHat, Landmark, LayoutDashboard, Map, MessageCircle, Mountain, Receipt, Scale, UserCheck, Users } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parsePermissions, type AdminModule } from "../../../../shared/admin-permissions";

const modules: { id: AdminModule; label: string; href: string; icon: typeof Users }[] = [
  { id: "dashboard", label: "Painel", href: "/admin/dashboard", icon: LayoutDashboard },
  { id: "crm", label: "CRM / Leads", href: "/admin/crm", icon: Users },
  { id: "imoveis", label: "Imóveis", href: "/admin/imoveis", icon: Building2 },
  { id: "obras", label: "Obras", href: "/admin/obras", icon: HardHat },
  { id: "projetos", label: "Projetos", href: "/admin/incorporacao", icon: Mountain },
  { id: "regularizacao", label: "Regularização", href: "/admin/regularizacoes", icon: FileCheck2 },
  { id: "financiamentos", label: "Financiamentos", href: "/admin/financiamentos", icon: Landmark },
  { id: "juridico", label: "Jurídico", href: "/admin/juridico", icon: Scale },
  { id: "corretores", label: "Corretores", href: "/admin/corretores", icon: UserCheck },
  { id: "avaliacoes", label: "Avaliações", href: "/admin/avaliacoes", icon: ClipboardCheck },
  { id: "bpo", label: "BPO Financeiro", href: "/admin/bpo", icon: Receipt },
  { id: "contabilidade", label: "Contabilidade", href: "/admin/contabilidade", icon: BookOpen },
  { id: "whatsapp", label: "WhatsApp", href: "/admin/whatsapp", icon: MessageCircle },
  { id: "agregador", label: "Agregador", href: "/mercado", icon: Map },
  { id: "dashboard", label: "Tarefas", href: "/admin/tarefas", icon: CheckSquare },
];

export default function AdminAcesso() {
  const { user } = useAuth();
  const permissions = user?.role === "admin" ? null : parsePermissions(user?.permissions);
  const allowed = modules.filter(item => !permissions || permissions.includes(item.id));
  return <div className="min-h-screen bg-[#1A2332] p-4 text-white md:p-8"><div className="mx-auto max-w-6xl space-y-6"><div><h1 className="text-3xl font-bold text-[#C9A961]">Central Administrativa</h1><p className="text-gray-400">Olá, {user?.name}. Estes são os seus módulos autorizados.</p></div><Card className="border-[#C9A961]/20 bg-[#2C3E50]"><CardHeader><CardTitle>Acessos disponíveis</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">{allowed.map(({ id, label, href, icon: Icon }, index) => <Link key={`${id}-${index}`} href={href}><div className="flex h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-[#C9A961]/20 bg-[#1A2332] hover:border-[#C9A961]"><Icon className="h-6 w-6 text-[#C9A961]" /><span>{label}</span></div></Link>)}{allowed.length === 0 && <p className="col-span-full py-10 text-center text-gray-500">Nenhum módulo foi liberado. Procure o administrador.</p>}</CardContent></Card></div></div>;
}
