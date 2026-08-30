import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { UtefPurchaseForm } from "@/components/ecossistema/utef-purchase-form";

export default async function ComprarUtefPage() {
  if (!(await auth())) redirect("/login");
  return <div className="bg-gray-50 py-14 min-h-[65vh]"><div className="max-w-2xl mx-auto px-4"><h1 className="text-4xl font-black text-[var(--brand-dark)] mb-3">Comprar UTEF</h1><p className="text-gray-500 mb-8">A cobrança é processada com segurança pelo Asaas. O saldo é creditado após a confirmação do pagamento.</p><UtefPurchaseForm /></div></div>;
}
