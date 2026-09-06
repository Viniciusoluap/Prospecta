import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { HeartHandshake, FileText, Download, Loader2, Plus, Trash2 } from "lucide-react";
import { resumoAtendimentoClientes, TIPOS_CHAMADO, type ChamadoAtendimento, type StatusChamado, type TipoChamado } from "@shared/incorporacao/atendimento-clientes";

const cardCls = "bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm";
const inputCls = "bg-[#2C3E50] border-[#C9A961]/30 text-white";
const selectCls = "bg-[#2C3E50] border border-[#C9A961]/30 text-white rounded-md px-2 h-9 text-sm w-full";

function Metric({ label, valor, destaque }: { label: string; valor: string; destaque?: boolean }) {
  return (
    <div className={`rounded-lg p-3 border ${destaque ? "bg-[#C9A961]/10 border-[#C9A961]/40" : "bg-[#0F1923] border-[#C9A961]/10"}`}>
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">{label}</p>
      <p className={`font-black text-base leading-tight ${destaque ? "text-[#C9A961]" : "text-white"}`}>{valor}</p>
    </div>
  );
}

interface EstudoParaRelatorio {
  id: number;
  name: string;
  city: string;
  state: string;
  areaM2: string;
  perimeterM: string;
  latitude: string | null;
  longitude: string | null;
  appAreaM2: string | null;
  cityResearchJson: string | null;
  marketStudyJson: string | null;
  massScenariosJson: string | null;
  selectedScenarioId: string | null;
}

export function AtendimentoRelatorio({ estudoId, customerServiceJson, estudo }: {
  estudoId: number; customerServiceJson: string | null; estudo: EstudoParaRelatorio;
}) {
  return (
    <div className="space-y-6">
      <AtendimentoClientes estudoId={estudoId} customerServiceJson={customerServiceJson} />
      <RelatorioPdf estudo={estudo} />
    </div>
  );
}

const STATUS_CHAMADO: { value: StatusChamado; label: string }[] = [
  { value: "aberto", label: "Aberto" },
  { value: "em_andamento", label: "Em andamento" },
  { value: "concluido", label: "Concluído" },
];
function novoChamado(): ChamadoAtendimento {
  return { id: Math.random().toString(36).slice(2), cliente: "", tipo: "Repasse Bancário", status: "aberto" };
}

function AtendimentoClientes({ estudoId, customerServiceJson }: { estudoId: number; customerServiceJson: string | null }) {
  const utils = trpc.useUtils();
  const [chamados, setChamados] = useState<ChamadoAtendimento[]>(() => {
    if (customerServiceJson) {
      try { return (JSON.parse(customerServiceJson) as { chamados?: ChamadoAtendimento[] }).chamados ?? []; } catch { /* vazio */ }
    }
    return [];
  });

  const saveMutation = trpc.incorporacao.saveAtendimentoClientes.useMutation({
    onSuccess: () => { toast.success("Atendimento salvo!"); utils.incorporacao.getById.invalidate({ id: estudoId }); },
    onError: (e) => toast.error(e.message),
  });

  const resumo = useMemo(() => resumoAtendimentoClientes(chamados), [chamados]);

  function addChamado() { setChamados((l) => [...l, novoChamado()]); }
  function removerChamado(id: string) { setChamados((l) => l.filter((c) => c.id !== id)); }
  function upd<K extends keyof ChamadoAtendimento>(id: string, campo: K, valor: ChamadoAtendimento[K]) {
    setChamados((l) => l.map((c) => (c.id === id ? { ...c, [campo]: valor } : c)));
  }

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <HeartHandshake className="h-5 w-5 text-[#C9A961]" /> Atendimento aos Clientes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-400 max-w-2xl">
          Central de atendimento pós-venda: repasses bancários, assembleias de condomínio, entrega de chaves,
          assistência técnica e documentação.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metric label="Chamados" valor={String(resumo.total)} />
          <Metric label="Abertos" valor={String(resumo.abertos)} />
          <Metric label="Em andamento" valor={String(resumo.emAndamento)} />
          <Metric label="Concluídos" valor={`${resumo.pctConcluido}%`} destaque />
        </div>

        <div className="overflow-x-auto">
          <table className="text-xs min-w-[680px] w-full">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-40">Cliente</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-28">Unidade</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-44">Tipo</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-32">Status</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-32">Abertura</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {chamados.map((c) => (
                <tr key={c.id}>
                  <td className="px-1 py-1"><Input value={c.cliente} onChange={(e) => upd(c.id, "cliente", e.target.value)} className={inputCls} placeholder="Nome do cliente" /></td>
                  <td className="px-1 py-1"><Input value={c.unidade ?? ""} onChange={(e) => upd(c.id, "unidade", e.target.value)} className={inputCls} placeholder="Ex.: Lote 12" /></td>
                  <td className="px-1 py-1">
                    <select value={c.tipo} onChange={(e) => upd(c.id, "tipo", e.target.value as TipoChamado)} className={selectCls}>
                      {TIPOS_CHAMADO.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <select value={c.status} onChange={(e) => upd(c.id, "status", e.target.value as StatusChamado)} className={selectCls}>
                      {STATUS_CHAMADO.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1"><Input type="date" value={c.dataAbertura ?? ""} onChange={(e) => upd(c.id, "dataAbertura", e.target.value)} className={inputCls} /></td>
                  <td className="px-1 py-1">
                    <button type="button" onClick={() => removerChamado(c.id)} className="text-gray-500 hover:text-red-400 flex justify-center"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={addChamado} className="flex items-center gap-1 text-xs font-bold text-[#C9A961]">
            <Plus className="h-3.5 w-3.5" /> Adicionar chamado
          </button>
          <Button onClick={() => saveMutation.mutate({ id: estudoId, dataJson: JSON.stringify({ chamados }) })}
            disabled={saveMutation.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold ml-auto">
            {saveMutation.isPending ? "Salvando..." : "Salvar atendimento"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RelatorioPdf({ estudo }: { estudo: EstudoParaRelatorio }) {
  const [busy, setBusy] = useState(false);

  const cidade = estudo.cityResearchJson ? JSON.parse(estudo.cityResearchJson) : null;
  const mercado = estudo.marketStudyJson ? JSON.parse(estudo.marketStudyJson) : null;
  const massa = estudo.massScenariosJson ? JSON.parse(estudo.massScenariosJson) : null;
  const cenario = massa?.cenarios?.find((c: { id: string }) => c.id === estudo.selectedScenarioId) ?? massa?.cenarios?.[0];

  const secoes = [
    { ok: !!estudo.areaM2 && parseFloat(estudo.areaM2) > 0, label: "Terreno (KML)" },
    { ok: !!estudo.appAreaM2, label: "APP automática" },
    { ok: !!cidade || !!mercado, label: "Cidade & Mercado" },
    { ok: !!cenario, label: "Estudo de massa" },
  ];

  async function gerarPdf() {
    setBusy(true);
    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const doc = new jsPDF();
      const pw = doc.internal.pageSize.getWidth();

      doc.setFillColor(15, 25, 35);
      doc.rect(0, 0, pw, 34, "F");
      doc.setTextColor(201, 169, 97).setFontSize(16).setFont("helvetica", "bold");
      doc.text("ESTUDO DE INCORPORAÇÃO", 14, 16);
      doc.setTextColor(255, 255, 255).setFontSize(9).setFont("helvetica", "normal");
      doc.text("Prospecta — relatório executivo consolidado", 14, 23);
      doc.text(new Date().toLocaleDateString("pt-BR"), 14, 29);

      let y = 44;
      doc.setTextColor(26, 26, 26).setFontSize(14).setFont("helvetica", "bold");
      doc.text(estudo.name, 14, y);
      doc.setFontSize(10).setFont("helvetica", "normal").setTextColor(90, 90, 90);
      doc.text(`${estudo.city}/${estudo.state}`, 14, y + 6);
      y += 14;

      const titulo = (txt: string, yy: number) => {
        if (yy > 260) { doc.addPage(); yy = 20; }
        doc.setFontSize(11).setFont("helvetica", "bold").setTextColor(26, 26, 26);
        doc.text(txt, 14, yy);
        doc.setDrawColor(201, 169, 97).setLineWidth(0.8);
        doc.line(14, yy + 1.5, 80, yy + 1.5);
        return yy + 5;
      };
      const fimTabela = (fallback: number) => {
        const d = doc as typeof doc & { lastAutoTable?: { finalY?: number } };
        return (d.lastAutoTable?.finalY ?? fallback) + 8;
      };

      if (secoes[0].ok) {
        y = titulo("1. TERRENO", y);
        autoTable(doc, {
          startY: y, theme: "grid", styles: { fontSize: 8 },
          headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97] },
          head: [["Área", "Perímetro", "Centro", "APP (automática)"]],
          body: [[
            `${parseFloat(estudo.areaM2).toLocaleString("pt-BR")} m² (${(parseFloat(estudo.areaM2) / 10000).toFixed(2)} ha)`,
            `${parseFloat(estudo.perimeterM).toLocaleString("pt-BR")} m`,
            estudo.latitude && estudo.longitude ? `${parseFloat(estudo.latitude).toFixed(5)}, ${parseFloat(estudo.longitude).toFixed(5)}` : "—",
            estudo.appAreaM2 ? `${Math.round(parseFloat(estudo.appAreaM2)).toLocaleString("pt-BR")} m²` : "—",
          ]],
        });
        y = fimTabela(y);
      }

      if (secoes[2].ok) {
        y = titulo("2. PESQUISA DA CIDADE & MERCADO", y);
        if (cidade?.resumo) {
          doc.setFontSize(8).setTextColor(60, 60, 60);
          const linhas = doc.splitTextToSize(cidade.resumo, pw - 28);
          doc.text(linhas, 14, y + 2);
          y += linhas.length * 4 + 4;
        }
        autoTable(doc, {
          startY: y, theme: "grid", styles: { fontSize: 8 },
          headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97] },
          head: [["População", "Renda média", "m² Lote", "m² Casa", "m² Apto"]],
          body: [[
            cidade?.populacao ? cidade.populacao.toLocaleString("pt-BR") : "—",
            cidade?.rendaMediaMensal ? `R$ ${cidade.rendaMediaMensal.toLocaleString("pt-BR")}` : "—",
            mercado?.precoM2Lote ? `R$ ${mercado.precoM2Lote.toLocaleString("pt-BR")}` : "—",
            mercado?.precoM2Casa ? `R$ ${mercado.precoM2Casa.toLocaleString("pt-BR")}` : "—",
            mercado?.precoM2Apartamento ? `R$ ${mercado.precoM2Apartamento.toLocaleString("pt-BR")}` : "—",
          ]],
        });
        y = fimTabela(y);
      }

      if (secoes[3].ok) {
        y = titulo("3. ESTUDO DE MASSA (CENÁRIO ESCOLHIDO)", y);
        autoTable(doc, {
          startY: y, theme: "grid", styles: { fontSize: 8 },
          headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97] },
          head: [["Lotes vendáveis", "Área vendável", "Aproveitamento", "VGV do cenário", "Lote típico", "Via"]],
          body: [[
            String(cenario.kpis.lotesVendaveis),
            `${cenario.kpis.areaVendavelM2.toLocaleString("pt-BR")} m²`,
            `${(cenario.kpis.aproveitamento * 100).toFixed(0)}%`,
            `R$ ${cenario.kpis.vgv.toLocaleString("pt-BR")}`,
            `${cenario.testadaLoteM}×${cenario.profundidadeLoteM} m`,
            `${cenario.larguraViaM} m`,
          ]],
        });
        y = fimTabela(y);
      }

      if (y > 270) { doc.addPage(); y = 20; }
      doc.setFontSize(7).setTextColor(150, 150, 150);
      doc.text(
        "Estudo preliminar de viabilidade e aproveitamento. Não substitui projeto urbanístico/engenharia aprovado, levantamento topográfico oficial, matrícula ou aprovação municipal.",
        14, Math.max(y + 6, 285), { maxWidth: pw - 28 }
      );

      doc.save(`estudo-incorporacao-${estudo.name.replace(/\s+/g, "-").toLowerCase()}.pdf`);
      toast.success("Relatório gerado!");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <FileText className="h-5 w-5 text-[#C9A961]" /> Relatório Executivo (PDF)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-400 max-w-2xl text-center mx-auto">
          Terreno (com APP automática), cidade &amp; mercado e estudo de massa consolidados em um único PDF. Seções sem
          dados são omitidas automaticamente. O motor de Viabilidade Econômica completo ainda não existe no Prospecta
          (S-13 no backlog do épico), então esse indicador não aparece no relatório por enquanto.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {secoes.map((s) => (
            <div key={s.label} className={`text-xs px-3 py-2 rounded-lg border text-center ${s.ok ? "border-green-900/50 bg-green-950/30 text-green-300" : "border-[#C9A961]/10 bg-[#0F1923] text-gray-500"}`}>
              {s.ok ? "✓" : "○"} {s.label}
            </div>
          ))}
        </div>

        <div className="text-center">
          <Button onClick={gerarPdf} disabled={busy} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            {busy ? "Gerando..." : "Baixar relatório (PDF)"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
