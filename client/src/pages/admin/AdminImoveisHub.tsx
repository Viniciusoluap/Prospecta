import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Building2, Rss } from "lucide-react";
import { Button } from "@/components/ui/button";
import AdminAgregador from "./AdminAgregador";
import AdminImoveis from "./AdminImoveis";

type View = "catalogo" | "captacao";

export default function AdminImoveisHub({
  initialView,
}: {
  initialView?: View;
}) {
  const queryView = new URLSearchParams(window.location.search).get(
    "aba"
  ) as View | null;
  const [view, setView] = useState<View>(
    queryView === "captacao" || queryView === "catalogo"
      ? queryView
      : initialView || "catalogo"
  );
  const tabClass = (item: View) =>
    `rounded-lg px-4 py-2 text-sm font-bold ${view === item ? "bg-[#C9A961] text-[#1A2332]" : "bg-[#2C3E50] text-gray-300"}`;
  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <header className="border-b border-[#C9A961]/20 bg-[#0F1923] px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center gap-4">
          <Link href="/admin">
            <Button variant="ghost" size="icon" className="text-gray-400">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[#C9A961]">Imóveis</h1>
            <p className="text-sm text-gray-400">
              Catálogo, captação externa e publicação em feeds
            </p>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <div className="flex gap-2">
          <button
            className={tabClass("catalogo")}
            onClick={() => setView("catalogo")}
          >
            <Building2 className="mr-1 inline h-4 w-4" /> Catálogo
          </button>
          <button
            className={tabClass("captacao")}
            onClick={() => setView("captacao")}
          >
            <Rss className="mr-1 inline h-4 w-4" /> Captação e feeds
          </button>
        </div>
        {view === "catalogo" ? (
          <AdminImoveis embedded />
        ) : (
          <AdminAgregador embedded />
        )}
      </div>
    </div>
  );
}
