import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { APP_TITLE, APP_LOGO, getLoginUrl } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { trpc } from "@/lib/trpc";
import { User, LogOut, Ticket, Coins, ShoppingBag, Settings, Plus, Phone, MessageCircle, HardHat, Menu, Home as HomeIcon, FileText, DollarSign, Gift, Building2, Bell } from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function Navbar() {
  const { user, isAuthenticated } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      window.location.href = "/";
    },
  });

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  const closeMobileMenu = () => setMobileMenuOpen(false);

  return (
    <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <div className="container flex h-16 items-center justify-between px-4">
        {/* Menu Hambúrguer (Esquerda) */}
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="text-primary hover:bg-primary/10">
              <Menu className="h-6 w-6" />
              <span className="sr-only">Menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[300px] sm:w-[400px]">
            <SheetHeader>
              <SheetTitle className="text-primary">Menu</SheetTitle>
            </SheetHeader>
            <ScrollArea className="h-[calc(100vh-8rem)] mt-6">
              <div className="flex flex-col gap-4">
                {/* Início */}
                <Link href="/" onClick={closeMobileMenu}>
                  <Button variant="ghost" className="w-full justify-start text-base">
                    <HomeIcon className="mr-3 h-5 w-5" />
                    Início
                  </Button>
                </Link>

                {/* Projetos e Orçamentos */}
                <Link href="/projetos-orcamentos" onClick={closeMobileMenu}>
                  <Button variant="ghost" className="w-full justify-start text-base">
                    <FileText className="mr-3 h-5 w-5" />
                    Projetos e Orçamentos
                  </Button>
                </Link>

                {/* Obras (apenas autenticados) */}
                {isAuthenticated && (
                  <Link href="/obras" onClick={closeMobileMenu}>
                    <Button variant="ghost" className="w-full justify-start text-base">
                      <HardHat className="mr-3 h-5 w-5" />
                      Obras
                    </Button>
                  </Link>
                )}

                {/* Divisor */}
                <div className="border-t my-2" />

                {/* Ecossistema Efficaz */}
                <div className="px-3 py-2">
                  <h3 className="text-sm font-semibold text-muted-foreground mb-3">Ecossistema Efficaz</h3>
                  <div className="flex flex-col gap-2">
                    <Link href="/sorteios" onClick={closeMobileMenu}>
                      <Button variant="ghost" className="w-full justify-start">
                        <Gift className="mr-3 h-4 w-4" />
                        Sorteios
                      </Button>
                    </Link>
                    <Link href="/produtos" onClick={closeMobileMenu}>
                      <Button variant="ghost" className="w-full justify-start">
                        <ShoppingBag className="mr-3 h-4 w-4" />
                        Produtos
                      </Button>
                    </Link>
                    <Link href="/como-funciona" onClick={closeMobileMenu}>
                      <Button variant="ghost" className="w-full justify-start">
                        <FileText className="mr-3 h-4 w-4" />
                        Como Funciona
                      </Button>
                    </Link>
                    <Link href="/comprar-utef" onClick={closeMobileMenu}>
                      <Button variant="ghost" className="w-full justify-start">
                        <DollarSign className="mr-3 h-4 w-4" />
                        Comprar UTEFs
                      </Button>
                    </Link>
                  </div>
                </div>

                {/* Divisor */}
                <div className="border-t my-2" />

                {/* Minha Conta */}
                {isAuthenticated ? (
                  <div className="px-3 py-2">
                    <h3 className="text-sm font-semibold text-muted-foreground mb-3">Minha Conta</h3>
                    <div className="flex flex-col gap-2">
                      <Link href="/meus-bilhetes" onClick={closeMobileMenu}>
                        <Button variant="ghost" className="w-full justify-start">
                          <Ticket className="mr-3 h-4 w-4" />
                          Meus Bilhetes
                        </Button>
                      </Link>
                      <Link href="/meu-saldo" onClick={closeMobileMenu}>
                        <Button variant="ghost" className="w-full justify-start">
                          <Coins className="mr-3 h-4 w-4" />
                          Meu Saldo UTEF
                        </Button>
                      </Link>
                      <Link href="/minhas-conversoes" onClick={closeMobileMenu}>
                        <Button variant="ghost" className="w-full justify-start">
                          <ShoppingBag className="mr-3 h-4 w-4" />
                          Minhas Conversões
                        </Button>
                      </Link>
                      {user?.role === "admin" && (
                        <>
                          <div className="border-t my-2" />
                          <Link href="/admin" onClick={closeMobileMenu}>
                            <Button variant="ghost" className="w-full justify-start">
                              <Settings className="mr-3 h-4 w-4" />
                              Painel Admin
                            </Button>
                          </Link>
                          <Link href="/admin/dashboard" onClick={closeMobileMenu}>
                            <Button variant="ghost" className="w-full justify-start">
                              <Settings className="mr-3 h-4 w-4" />
                              Dashboard Analytics
                            </Button>
                          </Link>
                          <Link href="/admin/obras" onClick={closeMobileMenu}>
                            <Button variant="ghost" className="w-full justify-start">
                              <Building2 className="mr-3 h-4 w-4" />
                              Gerenciar Obras
                            </Button>
                          </Link>
                          <Link href="/admin/orcamentos" onClick={closeMobileMenu}>
                            <Button variant="ghost" className="w-full justify-start">
                              <FileText className="mr-3 h-4 w-4" />
                              Gerenciar Orçamentos
                            </Button>
                          </Link>
                        </>
                      )}
                      <div className="border-t my-2" />
                      <Button
                        variant="ghost"
                        className="w-full justify-start text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => {
                          handleLogout();
                          closeMobileMenu();
                        }}
                      >
                        <LogOut className="mr-3 h-4 w-4" />
                        Sair
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="default"
                    className="w-full"
                    onClick={() => {
                      window.location.href = getLoginUrl();
                      closeMobileMenu();
                    }}
                  >
                    <User className="mr-2 h-4 w-4" />
                    Entrar
                  </Button>
                )}
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>

        {/* Logo + Nome (Centro) */}
        <Link href="/" className="flex items-center gap-2 font-bold text-primary hover:opacity-80 transition-opacity absolute left-1/2 transform -translate-x-1/2">
          <img src={APP_LOGO} alt={APP_TITLE} className="h-8 w-auto" />
          <span className="hidden md:inline text-lg whitespace-nowrap">{APP_TITLE}</span>
        </Link>

        {/* Notificações (Direita) */}
        <div className="flex items-center gap-3">
          {/* Badge de Notificações (apenas para usuários logados) */}
          {isAuthenticated && <NotificationBell />}
        </div>
      </div>
    </nav>
  );
}

// Componente de Badge de Notificações
function NotificationBell() {
  const { data: unreadCount = 0 } = trpc.notifications.getUnreadCount.useQuery(undefined, {
    refetchInterval: 30000, // Atualizar a cada 30 segundos
  });
  
  const { data: unreadNotifications = [] } = trpc.notifications.getUnread.useQuery(undefined, {
    refetchInterval: 30000,
  });
  
  const markAsReadMutation = trpc.notifications.markAsRead.useMutation({
    onSuccess: () => {
      // Invalidar queries para atualizar contador
      window.location.reload();
    },
  });
  
  const markAllAsReadMutation = trpc.notifications.markAllAsRead.useMutation({
    onSuccess: () => {
      window.location.reload();
    },
  });

  const handleNotificationClick = (id: number, actionUrl?: string | null) => {
    markAsReadMutation.mutate({ id });
    if (actionUrl) {
      window.location.href = actionUrl;
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge 
              variant="destructive" 
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notificações</span>
          {unreadCount > 0 && (
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-auto p-1 text-xs"
              onClick={() => markAllAsReadMutation.mutate()}
            >
              Marcar todas como lidas
            </Button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ScrollArea className="h-[300px]">
          {unreadNotifications.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              Nenhuma notificação nova
            </div>
          ) : (
            unreadNotifications.slice(0, 5).map((notification) => (
              <DropdownMenuItem
                key={notification.id}
                className="flex flex-col items-start p-3 cursor-pointer"
                onClick={() => handleNotificationClick(notification.id, notification.actionUrl)}
              >
                <div className="font-medium text-sm">{notification.title}</div>
                <div className="text-xs text-muted-foreground mt-1">{notification.message}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {new Date(notification.createdAt).toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </DropdownMenuItem>
            ))
          )}
        </ScrollArea>
        {unreadNotifications.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/notificacoes" className="w-full text-center text-sm text-primary">
                Ver todas as notificações
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
