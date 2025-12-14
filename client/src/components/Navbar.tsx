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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { trpc } from "@/lib/trpc";
import { User, LogOut, Ticket, Coins, ShoppingBag, Settings, Plus, Phone, MessageCircle, HardHat, Menu, Home as HomeIcon, FileText, DollarSign } from "lucide-react";
import { useState } from "react";

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
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 font-bold text-xl text-primary hover:opacity-80 transition-opacity">
            <img src={APP_LOGO} alt={APP_TITLE} className="h-8 w-8" />
            <span className="hidden sm:inline">{APP_TITLE}</span>
          </Link>
          
          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-4">
            <Link href="/projetos-orcamentos" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Projetos e Orçamentos
            </Link>
            
            {isAuthenticated && (
              <Link href="/obras" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                <HardHat className="h-4 w-4" />
                Obras
              </Link>
            )}
            
            <DropdownMenu>
              <DropdownMenuTrigger className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Ecossistema Efficaz
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <Link href="/sorteios">
                  <DropdownMenuItem>
                    <Ticket className="mr-2 h-4 w-4" />
                    Sorteios
                  </DropdownMenuItem>
                </Link>
                <Link href="/produtos">
                  <DropdownMenuItem>
                    <ShoppingBag className="mr-2 h-4 w-4" />
                    Produtos
                  </DropdownMenuItem>
                </Link>
                <Link href="/como-funciona">
                  <DropdownMenuItem>
                    Como Funciona
                  </DropdownMenuItem>
                </Link>
                <Link href="/comprar-utef">
                  <DropdownMenuItem>
                    <Plus className="mr-2 h-4 w-4" />
                    Comprar UTEFs
                  </DropdownMenuItem>
                </Link>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Telefones - Desktop */}
          <div className="hidden lg:flex items-center gap-3 mr-2 text-sm text-muted-foreground">
            <a href="tel:+5599981392210" className="flex items-center gap-1 hover:text-primary transition-colors">
              <Phone className="h-4 w-4" />
              (99) 98139-2210
            </a>
            <span className="text-muted-foreground/50">|</span>
            <a href="tel:+5594993044689" className="flex items-center gap-1 hover:text-primary transition-colors">
              <Phone className="h-4 w-4" />
              (94) 99304-4689
            </a>
          </div>
          
          {/* Botão Fale Conosco - Desktop */}
          <Button asChild size="sm" variant="outline" className="hidden md:flex gap-2 border-primary text-primary hover:bg-primary/10">
            <a href="https://wa.me/5599981392210" target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4" />
              Fale Conosco
            </a>
          </Button>

          {/* User Menu - Desktop */}
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
                  <Button variant="outline" size="sm" className="hidden md:flex gap-2">
                    <User className="h-4 w-4" />
                    <span>{user.name || "Minha Conta"}</span>
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
            <Button asChild size="sm" className="hidden md:flex">
              <a href={getLoginUrl()}>Entrar</a>
            </Button>
          )}

          {/* Mobile Menu Hamburguer */}
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm" className="md:hidden">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-80 overflow-y-auto">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 text-primary">
                  <img src={APP_LOGO} alt={APP_TITLE} className="h-8 w-8" />
                  {APP_TITLE}
                </SheetTitle>
              </SheetHeader>
              
              <div className="mt-8 flex flex-col gap-4 pb-8">
                {/* Botão de Login/Conta */}
                {isAuthenticated && user ? (
                  <div className="pb-4 border-b">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                        <User className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold">{user.name || "Usuário"}</p>
                        <p className="text-sm text-muted-foreground">{user.email}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <Button asChild size="lg" className="w-full">
                    <a href={getLoginUrl()} onClick={closeMobileMenu}>
                      <User className="mr-2 h-5 w-5" />
                      Entrar / Cadastrar
                    </a>
                  </Button>
                )}

                {/* Links de Navegação */}
                <Link href="/" onClick={closeMobileMenu}>
                  <Button variant="ghost" className="w-full justify-start text-base" size="lg">
                    <HomeIcon className="mr-3 h-5 w-5" />
                    Início
                  </Button>
                </Link>

                <Link href="/projetos-orcamentos" onClick={closeMobileMenu}>
                  <Button variant="ghost" className="w-full justify-start text-base" size="lg">
                    <FileText className="mr-3 h-5 w-5" />
                    Projetos e Orçamentos
                  </Button>
                </Link>

                {isAuthenticated && (
                  <Link href="/obras" onClick={closeMobileMenu}>
                    <Button variant="ghost" className="w-full justify-start text-base" size="lg">
                      <HardHat className="mr-3 h-5 w-5" />
                      Minhas Obras
                    </Button>
                  </Link>
                )}

                {/* Ecossistema Efficaz */}
                <div className="pt-4 border-t">
                  <p className="text-sm font-semibold text-muted-foreground mb-3 px-3">Ecossistema Efficaz</p>
                  
                  <Link href="/sorteios" onClick={closeMobileMenu}>
                    <Button variant="ghost" className="w-full justify-start" size="lg">
                      <Ticket className="mr-3 h-5 w-5" />
                      Sorteios
                    </Button>
                  </Link>

                  <Link href="/produtos" onClick={closeMobileMenu}>
                    <Button variant="ghost" className="w-full justify-start" size="lg">
                      <ShoppingBag className="mr-3 h-5 w-5" />
                      Produtos
                    </Button>
                  </Link>

                  <Link href="/como-funciona" onClick={closeMobileMenu}>
                    <Button variant="ghost" className="w-full justify-start" size="lg">
                      <DollarSign className="mr-3 h-5 w-5" />
                      Como Funciona
                    </Button>
                  </Link>

                  <Link href="/comprar-utef" onClick={closeMobileMenu}>
                    <Button variant="ghost" className="w-full justify-start" size="lg">
                      <Plus className="mr-3 h-5 w-5" />
                      Comprar UTEFs
                    </Button>
                  </Link>
                </div>

                {/* Minha Conta - Mobile */}
                {isAuthenticated && user && (
                  <div className="pt-4 border-t">
                    <p className="text-sm font-semibold text-muted-foreground mb-3 px-3">Minha Conta</p>
                    
                    <Link href="/meus-bilhetes" onClick={closeMobileMenu}>
                      <Button variant="ghost" className="w-full justify-start" size="lg">
                        <Ticket className="mr-3 h-5 w-5" />
                        Meus Bilhetes
                      </Button>
                    </Link>

                    <Link href="/meu-saldo" onClick={closeMobileMenu}>
                      <Button variant="ghost" className="w-full justify-start" size="lg">
                        <Coins className="mr-3 h-5 w-5" />
                        Meu Saldo UTEF
                      </Button>
                    </Link>

                    <Link href="/minhas-conversoes" onClick={closeMobileMenu}>
                      <Button variant="ghost" className="w-full justify-start" size="lg">
                        <ShoppingBag className="mr-3 h-5 w-5" />
                        Minhas Conversões
                      </Button>
                    </Link>

                    {user.role === "admin" && (
                      <Link href="/admin" onClick={closeMobileMenu}>
                        <Button variant="ghost" className="w-full justify-start" size="lg">
                          <Settings className="mr-3 h-5 w-5" />
                          Painel Admin
                        </Button>
                      </Link>
                    )}

                    <Button 
                      variant="ghost" 
                      className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10 mt-2" 
                      size="lg"
                      onClick={() => {
                        handleLogout();
                        closeMobileMenu();
                      }}
                    >
                      <LogOut className="mr-3 h-5 w-5" />
                      Sair
                    </Button>
                  </div>
                )}

                {/* Contato - Mobile */}
                <div className="pt-4 border-t">
                  <p className="text-sm font-semibold text-muted-foreground mb-3 px-3">Contato</p>
                  
                  <Button asChild variant="outline" className="w-full justify-start border-primary text-primary" size="lg">
                    <a href="https://wa.me/5599981392210" target="_blank" rel="noopener noreferrer" onClick={closeMobileMenu}>
                      <MessageCircle className="mr-3 h-5 w-5" />
                      Fale Conosco
                    </a>
                  </Button>

                  <div className="mt-4 space-y-2 px-3">
                    <a href="tel:+5599981392210" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary">
                      <Phone className="h-4 w-4" />
                      (99) 98139-2210
                    </a>
                    <a href="tel:+5594993044689" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary">
                      <Phone className="h-4 w-4" />
                      (94) 99304-4689
                    </a>
                  </div>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </nav>
  );
}
