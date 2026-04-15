import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import {
  Calendar,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Trash2,
  User,
} from "lucide-react";
import { useLocation } from "wouter";
import { getLoginUrl } from "@/const";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export default function AdminOrcamentos() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [adminNotes, setAdminNotes] = useState("");

  const {
    data: requests,
    isLoading,
    refetch,
  } = trpc.budgetRequests.getAll.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === "admin",
  });

  const updateMutation = trpc.budgetRequests.update.useMutation({
    onSuccess: () => {
      toast.success("Orçamento atualizado com sucesso!");
      refetch();
      setDialogOpen(false);
    },
    onError: error => {
      toast.error(`Erro ao atualizar: ${error.message}`);
    },
  });

  const deleteMutation = trpc.budgetRequests.delete.useMutation({
    onSuccess: () => {
      toast.success("Orçamento deletado com sucesso!");
      refetch();
    },
    onError: error => {
      toast.error(`Erro ao deletar: ${error.message}`);
    },
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      window.location.href = getLoginUrl();
    }
  }, [authLoading, isAuthenticated]);

  useEffect(() => {
    if (!authLoading && isAuthenticated && user?.role !== "admin") {
      setLocation("/");
    }
  }, [authLoading, isAuthenticated, user, setLocation]);

  const handleOpenDialog = (request: any) => {
    setSelectedRequest(request);
    setStatus(request.status);
    setAdminNotes(request.adminNotes || "");
    setDialogOpen(true);
  };

  const handleUpdate = () => {
    if (!selectedRequest) return;
    updateMutation.mutate({
      id: selectedRequest.id,
      status: status as any,
      adminNotes,
    });
  };

  const handleDelete = (id: number) => {
    if (confirm("Tem certeza que deseja deletar este orçamento?")) {
      deleteMutation.mutate({ id });
    }
  };

  if (authLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
        <Loader2 className="h-8 w-8 animate-spin text-[#C9A961]" />
      </div>
    );
  }

  if (user?.role !== "admin") {
    return null;
  }

  const statusColors = {
    pending: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    contacted: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    in_negotiation: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    converted: "bg-green-500/20 text-green-300 border-green-500/30",
    cancelled: "bg-red-500/20 text-red-300 border-red-500/30",
  };

  const statusLabels = {
    pending: "Pendente",
    contacted: "Contatado",
    in_negotiation: "Em Negociação",
    converted: "Convertido",
    cancelled: "Cancelado",
  };

  const hasLotLabels = {
    yes: "Sim, já tem terreno",
    no: "Não, precisa comprar",
    not_sure: "Não tem certeza",
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
      {/* Header */}
      <div className="border-b border-[#C9A961]/20 bg-[#1A2332]/80 backdrop-blur-sm">
        <div className="container py-8">
          <div>
            <h1 className="text-3xl font-bold text-[#C9A961] mb-2">
              Painel Admin - Orçamentos
            </h1>
            <p className="text-gray-400">
              Gerencie todas as solicitações de orçamento
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[#C9A961]" />
          </div>
        ) : !requests || requests.length === 0 ? (
          <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
            <CardContent className="pt-6 text-center py-12">
              <MessageSquare className="h-16 w-16 text-[#C9A961]/50 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-[#C9A961] mb-2">
                Nenhum orçamento recebido
              </h3>
              <p className="text-gray-400">
                As solicitações de orçamento aparecerão aqui.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6">
            {requests.map(request => (
              <Card
                key={request.id}
                className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm hover:border-[#C9A961]/40 transition-all"
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-[#C9A961] text-xl mb-2">
                        {request.name}
                      </CardTitle>
                      <CardDescription className="text-gray-400">
                        Solicitado em{" "}
                        {new Date(request.createdAt).toLocaleDateString(
                          "pt-BR",
                          {
                            day: "2-digit",
                            month: "long",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          }
                        )}
                      </CardDescription>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-sm border ${statusColors[request.status]}`}
                    >
                      {statusLabels[request.status]}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div className="flex items-center gap-2 text-gray-300">
                      <Mail className="h-4 w-4 text-[#C9A961]" />
                      <span className="text-sm">{request.email}</span>
                    </div>
                    {request.phone && (
                      <div className="flex items-center gap-2 text-gray-300">
                        <Phone className="h-4 w-4 text-[#C9A961]" />
                        <span className="text-sm">{request.phone}</span>
                      </div>
                    )}
                    {request.city && (
                      <div className="flex items-center gap-2 text-gray-300">
                        <MapPin className="h-4 w-4 text-[#C9A961]" />
                        <span className="text-sm">{request.city}</span>
                      </div>
                    )}
                    {request.projectType && (
                      <div className="flex items-center gap-2 text-gray-300">
                        <User className="h-4 w-4 text-[#C9A961]" />
                        <span className="text-sm">{request.projectType}</span>
                      </div>
                    )}
                  </div>

                  {request.hasLot && (
                    <div className="mb-4 p-3 bg-[#2C3E50] rounded-lg border border-[#C9A961]/20">
                      <p className="text-sm text-gray-300">
                        <strong className="text-[#C9A961]">
                          Possui terreno:
                        </strong>{" "}
                        {hasLotLabels[request.hasLot]}
                      </p>
                    </div>
                  )}

                  {request.message && (
                    <div className="mb-4 p-3 bg-[#2C3E50] rounded-lg border border-[#C9A961]/20">
                      <p className="text-sm text-gray-400 mb-1 font-semibold">
                        Mensagem:
                      </p>
                      <p className="text-sm text-gray-300">{request.message}</p>
                    </div>
                  )}

                  {request.adminNotes && (
                    <div className="mb-4 p-3 bg-blue-500/10 rounded-lg border border-blue-500/30">
                      <p className="text-sm text-blue-300 mb-1 font-semibold">
                        Observações do Admin:
                      </p>
                      <p className="text-sm text-blue-200">
                        {request.adminNotes}
                      </p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleOpenDialog(request)}
                      variant="outline"
                      className="flex-1 border-[#C9A961] text-[#C9A961] hover:bg-[#C9A961]/10"
                    >
                      Gerenciar
                    </Button>
                    <Button
                      onClick={() => handleDelete(request.id)}
                      variant="ghost"
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Dialog de Gerenciamento */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-[#C9A961]">
              Gerenciar Orçamento
            </DialogTitle>
            <DialogDescription className="text-gray-400">
              {selectedRequest?.name} - {selectedRequest?.email}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <Label htmlFor="status" className="text-gray-300">
                Status
              </Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pendente</SelectItem>
                  <SelectItem value="contacted">Contatado</SelectItem>
                  <SelectItem value="in_negotiation">Em Negociação</SelectItem>
                  <SelectItem value="converted">Convertido</SelectItem>
                  <SelectItem value="cancelled">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="adminNotes" className="text-gray-300">
                Observações do Admin
              </Label>
              <Textarea
                id="adminNotes"
                value={adminNotes}
                onChange={e => setAdminNotes(e.target.value)}
                className="bg-[#2C3E50] border-[#C9A961]/30 text-white"
                placeholder="Adicione observações internas sobre este orçamento..."
                rows={4}
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button
                variant="ghost"
                onClick={() => setDialogOpen(false)}
                className="text-gray-400 hover:text-white"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleUpdate}
                disabled={updateMutation.isPending}
                className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332]"
              >
                {updateMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  "Salvar Alterações"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
