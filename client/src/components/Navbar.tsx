import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { APP_TITLE, APP_LOGO, getLoginUrl } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";
import { User, LogOut, Ticket, Coins, ShoppingBag, Settings, Plus } from "lucide-react";

export default function Navbar() {
  const { user, isAuthenticated } = useAuth();
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      window.location.href = "/";
    },
  });

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  return (
    <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 font-bold text-xl text-primary hover:opacity-80 transition-opacity">
            <img src={APP_LOGO} alt={APP_TITLE} className="h-8 w-8" />
            <span>{APP_TITLE}</span>
          </Link>
          
          <div className="hidden md:flex items-center gap-4">
            <Link href="/sorteios" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Sorteios
            </Link>
            <Link href="/produtos" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Produtos
            </Link>
            <Link href="/como-funciona" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Como Funciona
            </Link>
            <Link href="/comprar-utef">
              <Button variant="default" size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                Comprar UTEFs
              </Button>
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {isAuthenticated && user ? (
            <>
              <Link href="/meus-bilhetes">
                <Button variant="ghost" size="sm" className="hidden md:flex gap-2">
                  <Ticket className="h-4 w-4" />
                  Meus Bilhetes
                </Button>
              </Link>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <User className="h-4 w-4" />
                    <span className="hidden md:inline">{user.name || "Minha Conta"}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Minha Conta</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <Link href="/meus-bilhetes">
                    <DropdownMenuItem>
                      <Ticket className="mr-2 h-4 w-4" />
                      Meus Bilhetes
                    </DropdownMenuItem>
                  </Link>
                  <Link href="/meu-saldo">
                    <DropdownMenuItem>
                      <Coins className="mr-2 h-4 w-4" />
                      Meu Saldo UTEF
                    </DropdownMenuItem>
                  </Link>
                  <Link href="/comprar-utef">
                    <DropdownMenuItem>
                      <Plus className="mr-2 h-4 w-4" />
                      Comprar UTEFs
                    </DropdownMenuItem>
                  </Link>
                  <Link href="/minhas-conversoes">
                    <DropdownMenuItem>
                      <ShoppingBag className="mr-2 h-4 w-4" />
                      Minhas Conversões
                    </DropdownMenuItem>
                  </Link>
                  {user.role === "admin" && (
                    <>
                      <DropdownMenuSeparator />
                      <Link href="/admin">
                        <DropdownMenuItem>
                          <Settings className="mr-2 h-4 w-4" />
                          Painel Admin
                        </DropdownMenuItem>
                      </Link>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Sair
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <Button asChild size="sm">
              <a href={getLoginUrl()}>Entrar</a>
            </Button>
          )}
        </div>
      </div>
    </nav>
  );
}
