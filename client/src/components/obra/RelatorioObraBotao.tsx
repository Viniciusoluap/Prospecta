import { useState } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { gerarPdfRelatorioObra } from "@/lib/relatorio-obra-pdf";
import { montarRelatorioObra, progressoParaRelatorio, verificarCompletude } from "@shared/relatorio-obra";
import { calcularProgresso } from "@shared/financeiro/progresso";
import { obraStatusLabel } from "@shared/obra-status";

// EPIC-020 Lote 4 (item 29) — relatório executivo da obra em PDF, com a
// logomarca da Prospecta e somente dados reais da obra (admin).

export function RelatorioObraBotao({ projectId }: { projectId: number }) {
  const utils = trpc.useUtils();
  const [gerando, setGerando] = useState(false);

  const gerar = async () => {
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
      await gerarPdfRelatorioObra(
        relatorio,
        { empresa: "Prospecta", logoUrl: "/logo.webp", primaria: [201, 169, 97], escura: [26, 35, 50] },
        d.fotos.map((f) => ({ url: f.imageUrl, legenda: f.caption, data: f.takenAt })),
        `relatorio-executivo-${d.info.titulo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}.pdf`
      );
      toast.success("Relatório PDF gerado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setGerando(false);
    }
  };

  return (
    <Button onClick={gerar} disabled={gerando} className="w-full bg-[#C9A961] hover:bg-[#B8935A] text-[#1A2332]">
      {gerando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
      {gerando ? "Gerando..." : "Baixar PDF"}
    </Button>
  );
}
