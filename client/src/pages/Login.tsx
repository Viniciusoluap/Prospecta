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
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  Loader2,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Link } from "wouter";

type LoginProfile = "cliente" | "corretor" | "admin";

const PROFILE_COPY: Record<
  LoginProfile,
  { title: string; description: string }
> = {
  cliente: {
    title: "Login Cliente",
    description: "Acompanhe sua obra, financiamento e benefícios",
  },
  corretor: {
    title: "Login Corretor",
    description: "Consulte imóveis e acompanhe suas comissões",
  },
  admin: {
    title: "Painel Admin",
    description: "Acesso administrativo da operação",
  },
};

export default function Login() {
  const requestedProfile = new URLSearchParams(window.location.search).get(
    "perfil"
  ) as LoginProfile | null;
  const profile =
    requestedProfile && PROFILE_COPY[requestedProfile]
      ? requestedProfile
      : null;
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
          profile: profile ?? undefined,
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

      const destination =
        data.role === "cliente" || data.role === "user"
          ? "/portal"
          : data.role === "corretor"
            ? "/corretor"
            : data.role === "admin"
              ? "/admin"
              : "/admin/acesso";

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
          <p className="text-muted-foreground">Prospecta Empreendimentos</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              {profile ? PROFILE_COPY[profile].title : "Entrar"}
            </CardTitle>
            <CardDescription>
              {profile
                ? PROFILE_COPY[profile].description
                : "Acesse sua conta com email e senha"}
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

        {!profile && (
          <div className="grid gap-2 sm:grid-cols-3">
            <Button asChild variant="outline">
              <Link href="/login?perfil=cliente">
                <UserRound className="mr-2 h-4 w-4" />
                Cliente
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/login?perfil=corretor">
                <Building2 className="mr-2 h-4 w-4" />
                Corretor
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/login?perfil=admin">
                <ShieldCheck className="mr-2 h-4 w-4" />
                Admin
              </Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
