export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { hasRole } from "@/lib/auth/rbac";
import { AdminShell } from "./_components/admin-shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  if (!hasRole(session, "admin", "corretor", "colaborador")) redirect("/portal");

  return <AdminShell>{children}</AdminShell>;
}
