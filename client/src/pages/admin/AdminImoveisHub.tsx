import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import AdminImoveis from "./AdminImoveis";

export default function AdminImoveisHub() {
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
            <p className="text-sm text-gray-400">Catálogo de imóveis</p>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <AdminImoveis embedded />
      </div>
    </div>
  );
}
