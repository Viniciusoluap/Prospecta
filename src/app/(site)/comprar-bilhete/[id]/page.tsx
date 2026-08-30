import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { TicketPurchaseForm } from "@/components/ecossistema/ticket-purchase-form";
import { getDrawById } from "@/lib/legacy/repository";

export const dynamic = "force-dynamic";

export default async function ComprarBilhetePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const { id } = await params;
  const drawId = Number(id);
  if (!Number.isInteger(drawId)) notFound();
  const draw = await getDrawById(drawId);
  if (!draw || draw.status !== "active") notFound();

  return (
    <div className="bg-gray-50 py-14 min-h-[65vh]">
      <div className="max-w-3xl mx-auto px-4">
        <h1 className="text-4xl font-black text-[var(--brand-dark)]">{draw.title}</h1>
        <p className="text-gray-500 my-4">{draw.description}</p>
        <TicketPurchaseForm drawId={draw.id} ticketPrice={draw.ticketPrice} />
      </div>
    </div>
  );
}
