import { Link } from "wouter";
import Navbar from "@/components/Navbar";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bell, Check, CheckCheck } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";

export default function Notificacoes() {
  const { isAuthenticated, loading } = useAuth();
  const { data: notifications = [], isLoading } = trpc.notifications.getAll.useQuery();
  const markAsReadMutation = trpc.notifications.markAsRead.useMutation({
    onSuccess: () => {
      window.location.reload();
    },
  });
  const markAllAsReadMutation = trpc.notifications.markAllAsRead.useMutation({
    onSuccess: () => {
      window.location.reload();
    },
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
        <Navbar />
        <div className="container py-12">
          <div className="text-center text-white">Carregando...</div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
        <Navbar />
        <div className="container py-12">
          <Card className="max-w-md mx-auto bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-[#C9A961] text-center">Acesso Restrito</CardTitle>
            </CardHeader>
            <CardContent className="text-center space-y-4">
              <p className="text-gray-300">Você precisa estar logado para ver suas notificações.</p>
              <Button asChild className="bg-[#C9A961] hover:bg-[#B8935F] text-white">
                <a href={getLoginUrl()}>Fazer Login</a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const unreadCount = notifications.filter(n => n.isRead === 0).length;

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "draw_result":
        return "🎉";
      case "utef_update":
        return "💰";
      case "construction_update":
        return "🏗️";
      case "promotional":
        return "🎁";
      default:
        return "📢";
    }
  };

  const handleNotificationClick = (id: number, isRead: number, actionUrl?: string | null) => {
    if (isRead === 0) {
      markAsReadMutation.mutate({ id });
    }
    if (actionUrl) {
      window.location.href = actionUrl;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
      <Navbar />
      
      <main className="container py-12">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold text-[#C9A961] flex items-center gap-3">
                <Bell className="h-10 w-10" />
                Notificações
              </h1>
              <p className="text-gray-300 mt-2">
                {unreadCount > 0 ? (
                  <span>Você tem <span className="text-[#00FF00] font-semibold">{unreadCount}</span> notificação(ões) não lida(s)</span>
                ) : (
                  <span>Você está em dia com suas notificações</span>
                )}
              </p>
            </div>
            {unreadCount > 0 && (
              <Button
                onClick={() => markAllAsReadMutation.mutate()}
                className="bg-[#C9A961] hover:bg-[#B8935F] text-white"
                disabled={markAllAsReadMutation.isPending}
              >
                <CheckCheck className="h-4 w-4 mr-2" />
                Marcar todas como lidas
              </Button>
            )}
          </div>

          {/* Lista de Notificações */}
          {isLoading ? (
            <div className="text-center text-gray-300 py-12">
              Carregando notificações...
            </div>
          ) : notifications.length === 0 ? (
            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
              <CardContent className="py-16 text-center">
                <Bell className="h-20 w-20 text-[#C9A961]/50 mx-auto mb-6" />
                <h3 className="text-xl font-semibold text-[#C9A961] mb-2">
                  Nenhuma notificação
                </h3>
                <p className="text-gray-400">
                  Você ainda não recebeu nenhuma notificação.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {notifications.map((notification) => (
                <Card
                  key={notification.id}
                  className={`
                    bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm
                    transition-all duration-200 cursor-pointer
                    ${notification.isRead === 0 ? 'border-[#00FF00]/40 shadow-lg shadow-[#00FF00]/10' : ''}
                    hover:border-[#C9A961]/40 hover:shadow-lg hover:shadow-[#C9A961]/10
                  `}
                  onClick={() => handleNotificationClick(notification.id, notification.isRead, notification.actionUrl)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      {/* Ícone */}
                      <div className="text-3xl flex-shrink-0">
                        {getNotificationIcon(notification.type)}
                      </div>
                      
                      {/* Conteúdo */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className={`font-semibold ${notification.isRead === 0 ? 'text-[#00FF00]' : 'text-[#C9A961]'}`}>
                            {notification.title}
                          </h3>
                          {notification.isRead === 0 && (
                            <span className="flex-shrink-0 px-2 py-1 bg-[#00FF00]/20 text-[#00FF00] text-xs font-medium rounded">
                              Nova
                            </span>
                          )}
                        </div>
                        <p className="text-gray-300 text-sm mt-1">
                          {notification.message}
                        </p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                          <span>
                            {new Date(notification.createdAt).toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: 'long',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          {notification.isRead === 1 && notification.readAt && (
                            <span className="flex items-center gap-1">
                              <Check className="h-3 w-3" />
                              Lida
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
