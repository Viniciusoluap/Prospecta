import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { NotificationsList } from "@/components/ecossistema/notifications-list";
import { getUserNotifications } from "@/lib/legacy/repository";
import { resolveLegacyUser } from "@/lib/legacy/session";

export const dynamic = "force-dynamic";

export default async function NotificacoesPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const user = await resolveLegacyUser(session);
  if (!user) redirect("/login");
  const notifications = await getUserNotifications(user.id);
  return <div className="bg-gray-50 py-14 min-h-[65vh]"><div className="max-w-4xl mx-auto px-4"><h1 className="text-4xl font-black text-[var(--brand-dark)] mb-8">Notificações</h1><NotificationsList notifications={notifications.map((item) => ({ id: item.id, title: item.title, message: item.message, actionUrl: item.actionUrl, isRead: item.isRead, createdAt: item.createdAt.toISOString() }))} /></div></div>;
}
