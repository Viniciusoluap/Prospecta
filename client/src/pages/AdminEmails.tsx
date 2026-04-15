import { useAuth } from "@/_core/hooks/useAuth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowLeft,
  Mail,
  Loader2,
  Eye,
  CheckCircle,
  XCircle,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function AdminEmails() {
  const [, setLocation] = useLocation();
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [selectedEmail, setSelectedEmail] = useState<number | null>(null);

  // Redirecionar se não autenticado ou não admin
  useEffect(() => {
    if (!authLoading && (!isAuthenticated || user?.role !== "admin")) {
      window.location.href = getLoginUrl();
    }
  }, [authLoading, isAuthenticated, user]);

  // Buscar emails
  const { data: emails, isLoading } = trpc.emails.getAll.useQuery();
  const { data: selectedEmailData } = trpc.emails.getById.useQuery(
    { id: selectedEmail! },
    { enabled: selectedEmail !== null }
  );

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#1A2332] via-[#2C3E50] to-[#1A2332] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#C9A961]" />
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    const styles = {
      pending: "bg-yellow-500/20 text-yellow-400",
      sent: "bg-green-500/20 text-green-400",
      failed: "bg-red-500/20 text-red-400",
    };
    const icons = {
      pending: <Clock className="h-3 w-3" />,
      sent: <CheckCircle className="h-3 w-3" />,
      failed: <XCircle className="h-3 w-3" />,
    };
    const labels = {
      pending: "Pendente",
      sent: "Enviado",
      failed: "Falhou",
    };

    return (
      <span
        className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 ${styles[status as keyof typeof styles] || styles.pending}`}
      >
        {icons[status as keyof typeof icons]}
        {labels[status as keyof typeof labels] || status}
      </span>
    );
  };

  const getTemplateLabel = (type: string) => {
    const labels: Record<string, string> = {
      welcome: "Boas-vindas",
      budget_confirmation: "Confirmação de Orçamento",
      budget_update: "Atualização de Orçamento",
      draw_winner: "Vencedor de Sorteio",
      promotional_campaign: "Campanha Promocional",
    };
    return labels[type] || type;
  };

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
          <h1 className="text-2xl font-bold text-[#C9A961]">
            Gerenciar Emails
          </h1>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-8">
        {/* Estatísticas */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card className="bg-[#1A2332]/60 border-[#C9A961]/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-[#C9A961] text-lg">
                Total de Emails
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white">
                {emails?.length || 0}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#1A2332]/60 border-[#C9A961]/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-[#C9A961] text-lg">
                Pendentes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-yellow-400">
                {emails?.filter(e => e.status === "pending").length || 0}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#1A2332]/60 border-[#C9A961]/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-[#C9A961] text-lg">Enviados</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-400">
                {emails?.filter(e => e.status === "sent").length || 0}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Lista de Emails */}
        <Card className="bg-[#1A2332]/60 border-[#C9A961]/20">
          <CardHeader>
            <CardTitle className="text-[#C9A961]">
              Histórico de Emails
            </CardTitle>
            <CardDescription className="text-gray-400">
              Todos os emails registrados no sistema
            </CardDescription>
          </CardHeader>
          <CardContent>
            {emails && emails.length > 0 ? (
              <div className="space-y-4">
                {emails.map(email => (
                  <div
                    key={email.id}
                    className="flex items-center justify-between p-4 bg-[#1A2332]/40 rounded-lg border border-[#C9A961]/10 hover:border-[#C9A961]/30 transition-colors"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Mail className="h-5 w-5 text-[#C9A961]" />
                        <h3 className="text-white font-semibold">
                          {email.subject}
                        </h3>
                      </div>
                      <div className="text-sm text-gray-400 space-y-1">
                        <p>
                          <strong>Para:</strong>{" "}
                          {email.recipientName || email.recipientEmail} (
                          {email.recipientEmail})
                        </p>
                        <p>
                          <strong>Tipo:</strong>{" "}
                          {getTemplateLabel(email.templateType)}
                        </p>
                        <p>
                          <strong>Data:</strong>{" "}
                          {new Date(email.createdAt).toLocaleString("pt-BR")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {getStatusBadge(email.status)}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedEmail(email.id)}
                        className="border-[#C9A961] text-[#C9A961] hover:bg-[#C9A961] hover:text-white"
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        Ver
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-400 text-center py-8">
                Nenhum email registrado ainda
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Dialog de Visualização */}
      <Dialog
        open={selectedEmail !== null}
        onOpenChange={() => setSelectedEmail(null)}
      >
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto bg-[#1A2332] border-[#C9A961]/20">
          <DialogHeader>
            <DialogTitle className="text-[#C9A961]">
              {selectedEmailData?.subject}
            </DialogTitle>
            <DialogDescription className="text-gray-400">
              Enviado para {selectedEmailData?.recipientEmail} em{" "}
              {selectedEmailData?.createdAt &&
                new Date(selectedEmailData.createdAt).toLocaleString("pt-BR")}
            </DialogDescription>
          </DialogHeader>
          {selectedEmailData && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-[#C9A961] mb-2">
                  Status
                </h3>
                {getStatusBadge(selectedEmailData.status)}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[#C9A961] mb-2">
                  Conteúdo HTML
                </h3>
                <div
                  className="bg-white p-4 rounded-lg"
                  dangerouslySetInnerHTML={{
                    __html: selectedEmailData.htmlContent,
                  }}
                />
              </div>
              {selectedEmailData.metadata && (
                <div>
                  <h3 className="text-sm font-semibold text-[#C9A961] mb-2">
                    Metadados
                  </h3>
                  <pre className="bg-[#1A2332]/60 p-4 rounded-lg text-gray-300 text-xs overflow-x-auto">
                    {JSON.stringify(
                      JSON.parse(selectedEmailData.metadata),
                      null,
                      2
                    )}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
