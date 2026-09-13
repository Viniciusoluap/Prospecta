import { useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Loader2, Printer } from "lucide-react";
import { LaudoAvaliacao } from "@/components/avaliacoes/LaudoAvaliacao";

const MAX_LOTE = 20;

export default function AdminAvaliacoesLaudosLote() {
  const search = useSearch();
  const [autoPrinted, setAutoPrinted] = useState(false);

  const ids = useMemo(() => {
    const raw = new URLSearchParams(search).get("ids") ?? "";
    return raw.split(",").map((v) => parseInt(v, 10)).filter((n) => !isNaN(n)).slice(0, MAX_LOTE);
  }, [search]);

  const { data: avaliacoes = [] } = trpc.avaliacoes.list.useQuery(undefined, { enabled: ids.length > 0 });
  const selecionadas = avaliacoes.filter((a: any) => ids.includes(a.id));

  useEffect(() => {
    if (!autoPrinted && selecionadas.length > 0) {
      const t = setTimeout(() => { window.print(); setAutoPrinted(true); }, 1200);
      return () => clearTimeout(t);
    }
  }, [autoPrinted, selecionadas.length]);

  if (ids.length === 0) {
    return <div className="min-h-screen bg-white flex items-center justify-center text-gray-500">Nenhuma avaliação selecionada.</div>;
  }

  if (selecionadas.length === 0) {
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
      <div className="no-print sticky top-0 max-w-3xl mx-auto mb-4 bg-white shadow rounded p-3 flex items-center justify-between">
        <p className="text-sm text-gray-700">{selecionadas.length} laudo(s) neste lote</p>
        <Button onClick={() => window.print()} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
          <Printer className="h-4 w-4 mr-2" /> Imprimir / Salvar PDF
        </Button>
      </div>
      <div className="max-w-3xl mx-auto space-y-0">
        {selecionadas.map((a: any, idx: number) => (
          <div key={a.id} className="bg-white shadow-lg p-8 print:shadow-none print:p-0 mb-6 print:mb-0">
            <LaudoAvaliacao avaliacao={a} quebrarAntes={idx > 0} />
          </div>
        ))}
      </div>
    </div>
  );
}
