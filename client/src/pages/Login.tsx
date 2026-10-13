import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { areaDoPerfil } from "@shared/perfis-acesso";

/** Item 02: rota de cada área (regra comum em shared/perfis-acesso.ts). */
function destinoDoPerfil(role: string | undefined): string {
  if (role === "user") return "/portal"; // contas antigas de cliente
  switch (areaDoPerfil(role)) {
    case "portal": return "/portal";
    case "corretor": return "/corretor";
    case "empreiteiro": return "/empreiteiro";
    case "painel": return role === "admin" ? "/admin" : "/admin/acesso";
    default: return "/";
  }
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email,
          password,
        }),
      });

      const text = await res.text();
      let data: {
        error?: string;
        id?: number;
        name?: string;
        email?: string;
        role?: string;
        permissions?: string;
      } = {};
      try {
        data = JSON.parse(text);
      } catch {
        setError(`Erro ${res.status}: servidor indisponível. Tente novamente.`);
        return;
      }

      if (!res.ok) {
        setError(data.error ?? "Erro ao fazer login");
        return;
      }

      const destination = destinoDoPerfil(data.role);

      // A full, single navigation starts the protected route with a fresh
      // auth query and avoids the setLocation + reload race seen on Safari.
      window.location.assign(destination);
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">VFX Capital</h1>
          <p className="text-muted-foreground">Prospecta Construções</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Minha Conta · Entrar</CardTitle>
            <CardDescription>
              Um só acesso para clientes, corretores, empreiteiros e equipe: o
              sistema reconhece seu perfil e abre a área certa.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  required
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Entrando...
                  </>
                ) : (
                  "Entrar"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Para criar sua conta, entre em contato com o administrador.
        </p>

      </div>
    </div>
  );
}
