import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ProfileForm } from "@/components/ecossistema/profile-form";
import { resolveLegacyUser } from "@/lib/legacy/session";

export const dynamic = "force-dynamic";

export default async function PerfilPage() {
  const session = await auth(); if (!session) redirect("/login");
  const user = await resolveLegacyUser(session); if (!user) redirect("/login");
  return <div className="bg-gray-50 py-14 min-h-[65vh]"><div className="max-w-3xl mx-auto px-4"><h1 className="text-4xl font-black text-[var(--brand-dark)] mb-8">Meu perfil</h1><ProfileForm profile={{ name: user.name ?? "", email: user.email ?? "", cpf: user.cpf ?? "", phone: user.phone ?? "", address: user.address ?? "", city: user.city ?? "", state: user.state ?? "", zipCode: user.zipCode ?? "" }} /></div></div>;
}
