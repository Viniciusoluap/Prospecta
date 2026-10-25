import { useState } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { gerarPdfRelatorioObra } from "@/lib/relatorio-obra-pdf";
import { gerarExcelRelatorioObra } from "@/lib/relatorio-obra-xlsx";
import { montarRelatorioObra, progressoParaRelatorio, verificarCompletude } from "@shared/relatorio-obra";
import { calcularProgresso } from "@shared/financeiro/progresso";
import { obraStatusLabel } from "@shared/obra-status";

// EPIC-020 Lote 4 (item 29) — relatório executivo da obra em PDF, com a
// logomarca da Prospecta e somente dados reais da obra (admin).

export function RelatorioObraBotao({ projectId }: { projectId: number }) {
  const utils = trpc.useUtils();
  const [gerando, setGerando] = useState(false);

  const gerar = async (formato: "pdf" | "xlsx") => {
    setGerando(true);
    try {
      const d = await utils.obraProgresso.relatorio.fetch({ projectId });
      const r = d.resumo;
      const relatorio = montarRelatorioObra({
        empresa: "Prospecta",
        geradoEm: new Date(),
        info: { ...d.info, status: obraStatusLabel(d.info.status) },
        valores: {
          vgv: r.valores.vgv,
          financiamento: r.valores.financiamento,
          fgts: r.valores.fgts,
          subsidio: r.valores.subsidio,
          custoTerreno: r.valores.custoTerreno,
          comissao: r.valores.comissao,
          orcamentoPrevisto: r.valores.orcamentoPrevisto,
          taxaMensalPct: r.valores.taxaMensalPct,
          parcelas: r.valores.parcelas,
          percentualEmpreiteiro: r.valores.percentualEmpreiteiro,
          incluirProSolutoBaseEmpreiteiro: r.valores.incluirProSolutoBaseEmpreiteiro,
        },
        calculo: r.calculo,
        empreiteiro: r.empreiteiro?.name ?? null,
        investidores: r.investidores.map((i) => ({ nome: i.nome, percentual: i.percentual, lucro: i.lucro })),
        comissao: r.corretor ? r.comissaoCalculada : null,
        movimentos: r.movimentos.map((m) => ({
          data: m.data, natureza: m.natureza, categoria: m.categoria, descricao: m.descricao,
          valor: m.valor, status: m.status, origem: m.origem,
        })),
        progresso: progressoParaRelatorio(calcularProgresso(d.progresso.itens), d.progresso.medido, d.progresso.progressoLegado),
        fotos: d.fotos.map((f) => ({ legenda: f.caption, data: f.takenAt })),
      });
      const faltas = verificarCompletude(relatorio);
      if (faltas.length) throw new Error(`Relatório incompleto: ${faltas.join("; ")}`);
      const fotos = d.fotos.map((f) => ({ url: f.imageUrl, legenda: f.caption, data: f.takenAt }));
      const nome = `relatorio-executivo-${d.info.titulo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`;
      if (formato === "pdf") await gerarPdfRelatorioObra(
        relatorio,
        { empresa: "Prospecta", logoUrl: "/logo.webp", primaria: [201, 169, 97], escura: [26, 35, 50] },
        fotos,
        `${nome}.pdf`
      );
      else await gerarExcelRelatorioObra(relatorio, fotos, `${nome}.xlsx`);
      toast.success(`Relatório ${formato === "pdf" ? "PDF" : "Excel"} gerado.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setGerando(false);
    }
  };

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {(["pdf", "xlsx"] as const).map(formato => (
        <Button key={formato} onClick={() => void gerar(formato)} disabled={gerando} className="w-full bg-[#C9A961] hover:bg-[#B8935A] text-[#1A2332]">
          {gerando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          {gerando ? "Gerando..." : `Baixar ${formato === "pdf" ? "PDF" : "Excel"}`}
        </Button>
      ))}
    </div>
  );
}
