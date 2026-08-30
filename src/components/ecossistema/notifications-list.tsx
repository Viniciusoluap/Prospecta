"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

type Notification = { id: number; title: string; message: string; actionUrl: string | null; isRead: boolean; createdAt: string };

export function NotificationsList({ notifications }: { notifications: Notification[] }) {
  const router = useRouter();
  async function read(id?: number) {
    await fetch("/api/ecossistema/notificacoes/ler", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    router.refresh();
  }
  return <div className="space-y-3">
    {notifications.some((item) => !item.isRead) && <button onClick={() => void read()} className="text-sm font-bold text-[var(--brand-yellow-dark)]">Marcar todas como lidas</button>}
    {notifications.length === 0 ? <div className="bg-white p-8 text-gray-500">Nenhuma notificação.</div> : notifications.map((item) => <article key={item.id} className={`border p-5 ${item.isRead ? "bg-white border-gray-100" : "bg-amber-50 border-amber-100"}`}><div className="flex justify-between gap-3"><div><strong className="text-[var(--brand-dark)]">{item.title}</strong><p className="text-sm text-gray-600 mt-1">{item.message}</p><span className="text-xs text-gray-400 mt-2 block">{new Date(item.createdAt).toLocaleString("pt-BR")}</span></div>{!item.isRead && <button onClick={() => void read(item.id)} className="text-xs font-bold self-start">Marcar lida</button>}</div>{item.actionUrl && <Link href={item.actionUrl} className="inline-block mt-3 text-sm font-bold text-[var(--brand-yellow-dark)]">Ver detalhes</Link>}</article>)}
  </div>;
}
