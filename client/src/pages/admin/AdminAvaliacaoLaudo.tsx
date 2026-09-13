import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Loader2, Printer } from "lucide-react";
import { LaudoAvaliacao } from "@/components/avaliacoes/LaudoAvaliacao";

export default function AdminAvaliacaoLaudo() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id, 10);
  const { data: avaliacao } = trpc.avaliacoes.getById.useQuery({ id }, { enabled: !isNaN(id) });

  if (!avaliacao) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-200 py-6 print:bg-white print:py-0">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { margin: 15mm 12mm; }
          .print-break-before { break-before: page; }
        }
      `}</style>
      <div className="no-print max-w-3xl mx-auto mb-4 flex justify-end">
        <Button onClick={() => window.print()} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
          <Printer className="h-4 w-4 mr-2" /> Imprimir / Salvar PDF
        </Button>
      </div>
      <div className="max-w-3xl mx-auto bg-white shadow-lg p-8 print:shadow-none print:p-0">
        <LaudoAvaliacao avaliacao={avaliacao} />
      </div>
    </div>
  );
}
