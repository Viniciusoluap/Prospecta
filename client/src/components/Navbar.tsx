import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { APP_TITLE, APP_LOGO } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { trpc } from "@/lib/trpc";
import {
  User,
  LogOut,
  ShoppingBag,
  Settings,
  Phone,
  Menu,
  Home as HomeIcon,
  FileText,
  DollarSign,
  Gift,
  Building2,
  Bell,
  Wrench,
  Info,
  GraduationCap,
  HandHeart,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
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
      <div className="container px-4">
        <div className="flex h-16 items-center justify-between md:justify-center">
          {/* Menu hambúrguer: somente em telas pequenas */}
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-primary hover:bg-primary/10 md:hidden"
              >
                <Menu className="h-6 w-6" />
                <span className="sr-only">Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[300px] sm:w-[400px] gap-0">
              <SheetHeader>
                <SheetTitle className="text-primary">Menu</SheetTitle>
              </SheetHeader>
              <ScrollArea className="flex-1 min-h-0">
                <div className="flex flex-col gap-4 px-1 pb-8">
                  {/* Início */}
                  <Link href="/" onClick={closeMobileMenu}>
                    <Button
                      variant="ghost"
                      className="w-full justify-start text-base"
                    >
                      <HomeIcon className="mr-3 h-5 w-5" />
                      Início
                    </Button>
                  </Link>

                  {/* Jornada imobiliária consolidada */}
                  <Link href="/imoveis" onClick={closeMobileMenu}>
                    <Button
                      variant="ghost"
                      className="w-full justify-start text-base"
                    >
                      <Building2 className="mr-3 h-5 w-5" />
                      Imóveis
                    </Button>
                  </Link>

                  {/* Institucional */}
                  <div className="px-3 py-2">
                    <h3 className="text-sm font-semibold text-muted-foreground mb-3">
                      Institucional
                    </h3>
                    <div className="flex flex-col gap-2">
                      <Link href="/servicos" onClick={closeMobileMenu}>
                        <Button
                          variant="ghost"
                          className="w-full justify-start"
                        >
                          <Wrench className="mr-3 h-4 w-4" />
                          Serviços
                        </Button>
                      </Link>
                      <Link href="/sobre" onClick={closeMobileMenu}>
                        <Button
                          variant="ghost"
                          className="w-full justify-start"
                        >
                          <Info className="mr-3 h-4 w-4" />
                          Sobre Nós
                        </Button>
                      </Link>
                      <Link href="/cursos" onClick={closeMobileMenu}>
                        <Button
                          variant="ghost"
                          className="w-full justify-start"
                        >
                          <GraduationCap className="mr-3 h-4 w-4" />
                          Cursos
                        </Button>
                      </Link>
                      <Link href="/instituto" onClick={closeMobileMenu}>
                        <Button
                          variant="ghost"
                          className="w-full justify-start"
                        >
                          <HandHeart className="mr-3 h-4 w-4" />
                          Instituto
                        </Button>
                      </Link>
                      <Link href="/contato" onClick={closeMobileMenu}>
                        <Button
                          variant="ghost"
                          className="w-full justify-start"
                        >
                          <Phone className="mr-3 h-4 w-4" />
                          Contato
                        </Button>
                      </Link>
                    </div>
                  </div>

                  {/* Divisor */}
                  <div className="border-t my-2" />

                  {/* Ecossistema VFX Capital */}
                  <div className="px-3 py-2">
                    <h3 className="text-sm font-semibold text-muted-foreground mb-3">
                      Ecossistema VFX Capital
                    </h3>
                    <div className="flex flex-col gap-2">
                      <Link href="/sorteios" onClick={closeMobileMenu}>
                        <Button
                          variant="ghost"
                          className="w-full justify-start"
                        >
                          <Gift className="mr-3 h-4 w-4" />
                          Sorteios
                        </Button>
                      </Link>
                      <Link href="/produtos" onClick={closeMobileMenu}>
                        <Button
                          variant="ghost"
                          className="w-full justify-start"
                        >
                          <ShoppingBag className="mr-3 h-4 w-4" />
                          Produtos
                        </Button>
                      </Link>
                      <Link href="/como-funciona" onClick={closeMobileMenu}>
                        <Button
                          variant="ghost"
                          className="w-full justify-start"
                        >
                          <FileText className="mr-3 h-4 w-4" />
                          Como Funciona
                        </Button>
                      </Link>
                      <Link href="/comprar-utef" onClick={closeMobileMenu}>
                        <Button
                          variant="ghost"
                          className="w-full justify-start"
                        >
                          <DollarSign className="mr-3 h-4 w-4" />
                          Comprar UTEFs
                        </Button>
                      </Link>
                    </div>
                  </div>

                  {/* Divisor */}
                  <div className="border-t my-2" />

                  {/* Minha Conta: entradas por perfil, sem expor módulos internos no menu global. */}
                  <div className="px-3 py-2">
                    <h3 className="text-sm font-semibold text-muted-foreground mb-3">
                      Minha Conta
                    </h3>
                    <div className="flex flex-col gap-2">
                      {!isAuthenticated && (
                        <>
                          <AccountLink
                            href="/login?perfil=cliente"
                            label="Login Cliente"
                            icon={User}
                            onClick={closeMobileMenu}
                          />
                          <AccountLink
                            href="/login?perfil=corretor"
                            label="Login Corretor"
                            icon={Building2}
                            onClick={closeMobileMenu}
                          />
                          <AccountLink
                            href="/login?perfil=admin"
                            label="Painel Admin"
                            icon={Settings}
                            onClick={closeMobileMenu}
                          />
                        </>
                      )}
                      {user?.role === "cliente" && (
                        <AccountLink
                          href="/portal"
                          label="Portal do Cliente"
                          icon={User}
                          onClick={closeMobileMenu}
                        />
                      )}
                      {user?.role === "corretor" && (
                        <AccountLink
                          href="/corretor"
                          label="Portal do Corretor"
                          icon={Building2}
                          onClick={closeMobileMenu}
                        />
                      )}
                      {user?.role === "admin" && (
                        <AccountLink
                          href="/admin"
                          label="Painel Admin"
                          icon={Settings}
                          onClick={closeMobileMenu}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </ScrollArea>
              <SheetFooter className="border-t">
                {isAuthenticated ? (
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
                ) : (
                  <span className="px-4 py-3 text-center text-xs text-muted-foreground">
                    Escolha acima o seu tipo de acesso
                  </span>
                )}
              </SheetFooter>
            </SheetContent>
          </Sheet>

          {/* Logo + Nome */}
          <Link
            href="/"
            className="flex items-center gap-2 font-bold text-primary hover:opacity-80 transition-opacity"
          >
            <img src={APP_LOGO} alt={APP_TITLE} className="h-8 w-auto" />
            <span className="hidden md:inline text-lg whitespace-nowrap">
              {APP_TITLE}
            </span>
          </Link>

          {/* Notificações (Direita) */}
          <div className="flex w-10 items-center justify-end gap-3 md:absolute md:right-4 md:w-auto">
            {/* Badge de Notificações (apenas para usuários logados) */}
            {isAuthenticated && <NotificationBell />}
          </div>
        </div>

        {/* Navegação completa em tablet/desktop, seguindo a lógica do Santa Fé */}
        <div className="hidden md:flex min-h-12 flex-wrap items-center justify-center gap-1 border-t py-1">
          <DesktopNavLink href="/">Início</DesktopNavLink>
          <DesktopNavLink href="/imoveis">Imóveis</DesktopNavLink>
          <DesktopNavLink href="/servicos">Serviços</DesktopNavLink>
          <DesktopNavLink href="/sobre">Sobre Nós</DesktopNavLink>
          <DesktopNavLink href="/cursos">Cursos</DesktopNavLink>
          <DesktopNavLink href="/instituto">Instituto</DesktopNavLink>
          <DesktopNavLink href="/contato">Contato</DesktopNavLink>
          <DesktopNavLink href="/sorteios">Sorteios</DesktopNavLink>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="px-3 py-2 text-sm font-medium text-foreground/75 hover:bg-primary/10 hover:text-primary"
              >
                <User className="mr-2 h-4 w-4" />
                Minha Conta
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {!isAuthenticated && (
                <>
                  <DropdownMenuItem asChild>
                    <Link href="/login?perfil=cliente">
                      <User className="mr-2 h-4 w-4" />
                      Login Cliente
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/login?perfil=corretor">
                      <Building2 className="mr-2 h-4 w-4" />
                      Login Corretor
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/login?perfil=admin">
                      <Settings className="mr-2 h-4 w-4" />
                      Painel Admin
                    </Link>
                  </DropdownMenuItem>
                </>
              )}
              {user?.role === "cliente" && (
                <DropdownMenuItem asChild>
                  <Link href="/portal">
                    <User className="mr-2 h-4 w-4" />
                    Portal do Cliente
                  </Link>
                </DropdownMenuItem>
              )}
              {user?.role === "corretor" && (
                <DropdownMenuItem asChild>
                  <Link href="/corretor">
                    <Building2 className="mr-2 h-4 w-4" />
                    Portal do Corretor
                  </Link>
                </DropdownMenuItem>
              )}
              {user?.role === "admin" && (
                <DropdownMenuItem asChild>
                  <Link href="/admin">
                    <Settings className="mr-2 h-4 w-4" />
                    Painel Admin
                  </Link>
                </DropdownMenuItem>
              )}
              {isAuthenticated && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-red-600 focus:text-red-600"
                    onSelect={handleLogout}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Sair
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </nav>
  );
}

function AccountLink({
  href,
  label,
  icon: Icon,
  onClick,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <Link href={href} onClick={onClick}>
      <Button variant="ghost" className="w-full justify-start">
        <Icon className="mr-3 h-4 w-4" />
        {label}
      </Button>
    </Link>
  );
}

function DesktopNavLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-2 text-sm font-medium text-foreground/75 transition-colors hover:bg-primary/10 hover:text-primary"
    >
      {children}
    </Link>
  );
}

// Componente de Badge de Notificações
function NotificationBell() {
  const { data: unreadCount = 0 } = trpc.notifications.getUnreadCount.useQuery(
    undefined,
    {
      refetchInterval: 30000, // Atualizar a cada 30 segundos
    }
  );

  const { data: unreadNotifications = [] } =
    trpc.notifications.getUnread.useQuery(undefined, {
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
              {unreadCount > 9 ? "9+" : unreadCount}
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
            unreadNotifications.slice(0, 5).map(notification => (
              <DropdownMenuItem
                key={notification.id}
                className="flex flex-col items-start p-3 cursor-pointer"
                onClick={() =>
                  handleNotificationClick(
                    notification.id,
                    notification.actionUrl
                  )
                }
              >
                <div className="font-medium text-sm">{notification.title}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {notification.message}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {new Date(notification.createdAt).toLocaleDateString(
                    "pt-BR",
                    {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    }
                  )}
                </div>
              </DropdownMenuItem>
            ))
          )}
        </ScrollArea>
        {unreadNotifications.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link
                href="/notificacoes"
                className="w-full text-center text-sm text-primary"
              >
                Ver todas as notificações
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
