import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { FileText, Download, Loader2 } from "lucide-react";
import { montarRelatorioExecutivo, type EstudoParaRelatorioExecutivo } from "@shared/incorporacao/relatorio-executivo";

// Relatório Executivo de Incorporação — Lote 6. Toda a REGRA de "o que
// entra em cada seção e o que é pendência" vive em
// `shared/incorporacao/relatorio-executivo.ts` (testada em
// server/incorporacao-relatorio-executivo.test.ts); este arquivo só decide
// COMO desenhar isso em PDF. Nenhuma seção é omitida: quando falta dado, ela
// aparece com uma linha/caixa de "Pendência: ..." em vez de desaparecer.

const cardCls = "bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm";

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function fmtM2(v: number) {
  return `${Math.round(v).toLocaleString("pt-BR")} m²`;
}
function fmtPct(v: number, casas = 1) {
  return `${(v * 100).toFixed(casas)}%`;
}
function fmtNum(v: number) {
  return v.toLocaleString("pt-BR");
}
function fmtDataHora(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR")}`;
}

export function RelatorioExecutivo({ estudo }: { estudo: EstudoParaRelatorioExecutivo }) {
  const [busy, setBusy] = useState(false);
  const modelo = montarRelatorioExecutivo(estudo);

  const secoesResumo: { label: string; ok: boolean }[] = [
    { label: "Terreno/APP", ok: modelo.terreno.status === "ok" },
    { label: "Cadastral/urbanístico", ok: modelo.dadosCadastraisUrbanisticos.status === "ok" },
    { label: "Mercado/referências", ok: modelo.mercadoReferencias.status === "ok" },
    { label: "Estudo de massa", ok: modelo.estudoMassa.status === "ok" },
    { label: "Quadro de áreas", ok: modelo.quadroAreas.status === "ok" },
    { label: "Mix de produtos", ok: modelo.mixProdutos.status === "ok" },
    { label: "Custos/VGV", ok: modelo.custosReceitasVgv.status === "ok" },
    { label: "VPL/TIR/ROI/fluxo", ok: modelo.viabilidadeEconomica.status === "ok" },
    { label: "Impostos/comissões", ok: modelo.impostosComissoesPermutas.status === "ok" },
    { label: "Negociações", ok: modelo.negociacoes.status === "ok" },
    { label: "Documentos/licenças", ok: modelo.documentosLicencas.status === "ok" },
    { label: "Cronograma", ok: modelo.cronograma.status === "ok" },
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
      doc.text("ESTUDO DE INCORPORAÇÃO — RELATÓRIO EXECUTIVO", 14, 16);
      doc.setTextColor(255, 255, 255).setFontSize(9).setFont("helvetica", "normal");
      doc.text("Prospecta — relatório executivo consolidado", 14, 23);
      doc.text(new Date().toLocaleDateString("pt-BR"), 14, 29);

      let y = 44;
      doc.setTextColor(26, 26, 26).setFontSize(14).setFont("helvetica", "bold");
      doc.text(estudo.name, 14, y);
      doc.setFontSize(10).setFont("helvetica", "normal").setTextColor(90, 90, 90);
      doc.text(`${estudo.city}/${estudo.state}`, 14, y + 6);
      y += 14;

      const titulo = (txt: string, yy: number): number => {
        if (yy > 258) {
          doc.addPage();
          yy = 20;
        }
        doc.setFontSize(11).setFont("helvetica", "bold").setTextColor(26, 26, 26);
        doc.text(txt, 14, yy);
        doc.setDrawColor(201, 169, 97).setLineWidth(0.8);
        doc.line(14, yy + 1.5, 80, yy + 1.5);
        return yy + 6;
      };
      const fimTabela = (fallback: number): number => {
        const d = doc as typeof doc & { lastAutoTable?: { finalY?: number } };
        return (d.lastAutoTable?.finalY ?? fallback) + 6;
      };
      /** Seção inteira sem dado: caixa com a mensagem de pendência — nunca omitida. */
      const pendenciaBox = (texto: string, yy: number): number => {
        if (yy > 262) {
          doc.addPage();
          yy = 20;
        }
        const linhas = doc.splitTextToSize(`Pendência: ${texto.replace(/^Pendência:\s*/i, "")}`, pw - 36);
        const altura = linhas.length * 4 + 6;
        doc.setDrawColor(201, 169, 97).setLineWidth(0.3);
        doc.setFillColor(250, 246, 237);
        doc.rect(14, yy, pw - 28, altura, "FD");
        doc.setFontSize(8).setFont("helvetica", "italic").setTextColor(120, 100, 40);
        doc.text(linhas, 18, yy + 5);
        return yy + altura + 6;
      };
      /** Pendências pontuais dentro de uma seção que tem dado (subitens faltando). */
      const pendenciasLista = (lista: string[], yy: number): number => {
        let yyy = yy;
        for (const p of lista) {
          if (yyy > 270) {
            doc.addPage();
            yyy = 20;
          }
          doc.setFontSize(7.5).setFont("helvetica", "italic").setTextColor(150, 120, 60);
          const linhas = doc.splitTextToSize(`• ${p}`, pw - 32);
          doc.text(linhas, 18, yyy);
          yyy += linhas.length * 3.6 + 1;
        }
        return yyy + (lista.length > 0 ? 3 : 0);
      };
      const paragrafo = (texto: string, yy: number): number => {
        doc.setFontSize(8).setTextColor(60, 60, 60).setFont("helvetica", "normal");
        const linhas = doc.splitTextToSize(texto, pw - 28);
        doc.text(linhas, 14, yy + 2);
        return yy + linhas.length * 4 + 4;
      };

      // ── 1. TERRENO, MAPAS, APP E RESTRIÇÕES ──────────────────────────────
      y = titulo("1. TERRENO, MAPAS, APP E RESTRIÇÕES", y);
      const terreno = modelo.terreno;
      if (terreno.status === "pendente") {
        y = pendenciaBox(terreno.pendencia, y);
      } else {
        const d = terreno.dado;
        autoTable(doc, {
          startY: y,
          theme: "grid",
          styles: { fontSize: 8 },
          headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97] },
          head: [["Área", "Perímetro", "Centro (lat, lng)", "APP (automática)"]],
          body: [[
            `${fmtM2(d.areaM2)} (${(d.areaM2 / 10000).toFixed(2)} ha)`,
            `${fmtNum(d.perimetroM)} m`,
            d.centro ? `${d.centro.lat.toFixed(5)}, ${d.centro.lng.toFixed(5)}` : "—",
            d.app ? fmtM2(d.app.areaM2) : "—",
          ]],
        });
        y = fimTabela(y);
        y = pendenciasLista(terreno.pendencias, y);
      }

      // ── 2. DADOS CADASTRAIS E URBANÍSTICOS ───────────────────────────────
      y = titulo("2. DADOS CADASTRAIS E URBANÍSTICOS", y);
      const cadastral = modelo.dadosCadastraisUrbanisticos;
      if (cadastral.status === "pendente") {
        y = pendenciaBox(cadastral.pendencia, y);
      } else {
        const d = cadastral.dado;
        autoTable(doc, {
          startY: y,
          theme: "grid",
          styles: { fontSize: 8 },
          headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97] },
          head: [["Zona", "Taxa ocupação", "Coef. aproveitamento", "Lote mínimo", "Gabarito"]],
          body: [[
            d.parametros.zona || "—",
            fmtPct(d.parametros.taxaOcupacao),
            d.parametros.coefAproveitamento.toFixed(2),
            fmtM2(d.parametros.loteMinimoM2),
            `${d.parametros.gabaritoPavimentos} pav.`,
          ]],
        });
        y = fimTabela(y);
        autoTable(doc, {
          startY: y,
          theme: "grid",
          styles: { fontSize: 8 },
          headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97] },
          head: [["Área edificável máx.", "Área loteável líquida", "Lotes máx.", "Unidades máx. (vertical)", "Vagas exigidas"]],
          body: [[
            fmtM2(d.potencial.areaEdificavelMaxM2),
            fmtM2(d.potencial.areaLoteavelLiquidaM2),
            fmtNum(d.potencial.lotesMax),
            d.potencial.unidadesMaxVertical != null ? fmtNum(d.potencial.unidadesMaxVertical) : "—",
            d.potencial.vagasExigidas != null ? fmtNum(d.potencial.vagasExigidas) : "—",
          ]],
        });
        y = fimTabela(y);
        const cadastro = [
          ["Matrícula", d.propertyRegistration], ["CAR", d.carRegistration],
          ["Zoneamento oficial", d.officialZoning], ["Fonte do zoneamento", d.zoningSource],
        ].filter((row): row is string[] => !!row[1]);
        if (cadastro.length) {
          autoTable(doc, { startY: y, theme: "grid", styles: { fontSize: 8 },
            headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97] },
            head: [["Dado cadastral", "Valor informado"]], body: cadastro });
          y = fimTabela(y);
        }
        if (d.opiniao) y = paragrafo(d.opiniao, y);
        y = pendenciasLista(cadastral.pendencias, y);
      }

      // ── 3. MERCADO / REFERÊNCIAS ──────────────────────────────────────────
      y = titulo("3. MERCADO E REFERÊNCIAS", y);
      const mercadoSec = modelo.mercadoReferencias;
      if (mercadoSec.status === "pendente") {
        y = pendenciaBox(mercadoSec.pendencia, y);
      } else {
        const d = mercadoSec.dado;
        if (d.cidade?.resumo) y = paragrafo(d.cidade.resumo, y);
        autoTable(doc, {
          startY: y,
          theme: "grid",
          styles: { fontSize: 8 },
          headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97] },
          head: [["População", "Renda média", "m² Lote", "m² Casa", "m² Apto"]],
          body: [[
            d.cidade?.populacao ? fmtNum(d.cidade.populacao) : "—",
            d.cidade?.rendaMediaMensal ? fmtBRL(d.cidade.rendaMediaMensal) : "—",
            d.mercado?.precoM2Lote ? fmtBRL(d.mercado.precoM2Lote) : "—",
            d.mercado?.precoM2Casa ? fmtBRL(d.mercado.precoM2Casa) : "—",
            d.mercado?.precoM2Apartamento ? fmtBRL(d.mercado.precoM2Apartamento) : "—",
          ]],
        });
        y = fimTabela(y);
        if (d.fontes && d.fontes.length > 0) {
          y = paragrafo(`Fontes: ${d.fontes.join("; ")}. Confiabilidade: ${d.confiabilidade ?? "não informada"}.`, y);
        }
        if (d.precificacao) {
          autoTable(doc, {
            startY: y,
            theme: "grid",
            styles: { fontSize: 8 },
            headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97] },
            head: [["Preço sugerido/m² (comparáveis)", "Nota ponderada — empreendimento", "Nota ponderada — mercado", "Concorrentes válidos"]],
            body: [[
              d.precificacao.precoSugeridoM2 > 0 ? fmtBRL(d.precificacao.precoSugeridoM2) : "—",
              d.precificacao.notaPonderadaNovo.toFixed(2),
              d.precificacao.notaPonderadaMediaComparaveis.toFixed(2),
              String(d.precificacao.comparaveisValidos),
            ]],
          });
          y = fimTabela(y);
        }
        if (d.pesquisaPrimaria) {
          autoTable(doc, {
            startY: y,
            theme: "grid",
            styles: { fontSize: 8 },
            headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97] },
            head: [["Entrevistados", "Interesse em comprar (12m)", "Tamanho ideal médio", "Quartos mais pedidos"]],
            body: [[
              String(d.pesquisaPrimaria.totalEntrevistados),
              `${d.pesquisaPrimaria.pctInteresseComprar12Meses}%`,
              `${d.pesquisaPrimaria.tamanhoIdealMedioM2} m²`,
              d.pesquisaPrimaria.quartosModaNecessarios ? String(d.pesquisaPrimaria.quartosModaNecessarios) : "—",
            ]],
          });
          y = fimTabela(y);
        }
        y = pendenciasLista(mercadoSec.pendencias, y);
      }

      // ── 4. ESTUDO DE MASSA / CENÁRIOS ─────────────────────────────────────
      y = titulo("4. ESTUDO DE MASSA (CENÁRIO)", y);
      const massaSec = modelo.estudoMassa;
      if (massaSec.status === "pendente") {
        y = pendenciaBox(massaSec.pendencia, y);
      } else {
        const d = massaSec.dado;
        autoTable(doc, {
          startY: y,
          theme: "grid",
          styles: { fontSize: 8 },
          headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97] },
          head: [["Lotes vendáveis", "Área vendável", "Aproveitamento", "VGV do cenário", "Lote típico", "Via"]],
          body: [[
            String(d.cenario.kpis.lotesVendaveis),
            fmtM2(d.cenario.kpis.areaVendavelM2),
            fmtPct(d.cenario.kpis.aproveitamento, 0),
            fmtBRL(d.cenario.kpis.vgv),
            `${d.cenario.testadaLoteM}×${d.cenario.profundidadeLoteM} m`,
            `${d.cenario.larguraViaM} m`,
          ]],
        });
        y = fimTabela(y);
        y = pendenciasLista(massaSec.pendencias, y);
      }

      // ── 5. QUADRO DE ÁREAS ────────────────────────────────────────────────
      y = titulo("5. QUADRO DE ÁREAS (NBR 12721)", y);
      const quadroSec = modelo.quadroAreas;
      if (quadroSec.status === "pendente") {
        y = pendenciaBox(quadroSec.pendencia, y);
      } else {
        const r = quadroSec.dado.resultado;
        autoTable(doc, {
          startY: y,
          theme: "grid",
          styles: { fontSize: 8 },
          headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97] },
          head: [["Área const. total", "Área privativa (APV)", "Área computável", "Índice APV/ACC", "Aproveitamento", "Excede coeficiente?"]],
          body: [[
            fmtM2(r.areaConstTotalM2),
            fmtM2(r.areaPrivativaTotalM2),
            `${fmtM2(r.areaComputavelTotalM2)} / ${fmtM2(r.areaComputavelMaximaM2)}`,
            fmtPct(r.indiceApvAcc),
            fmtPct(r.aproveitamentoPct),
            r.excedeCoeficiente ? "Sim" : "Não",
          ]],
        });
        y = fimTabela(y);
        y = pendenciasLista(quadroSec.pendencias, y);
      }

      // ── 6. MIX DE PRODUTOS ────────────────────────────────────────────────
      y = titulo("6. MIX DE PRODUTOS", y);
      const mixSec = modelo.mixProdutos;
      if (mixSec.status === "pendente") {
        y = pendenciaBox(mixSec.pendencia, y);
      } else {
        const r = mixSec.dado.resultado;
        autoTable(doc, {
          startY: y,
          theme: "grid",
          styles: { fontSize: 8 },
          headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97] },
          head: [["Produto", "Qtd.", "Área unid.", "Preço/m²", "VGV"]],
          body: [
            ...r.itens.map((i) => [i.nome, String(i.quantidade), fmtM2(i.areaUnidadeM2), fmtBRL(i.precoM2), fmtBRL(i.vgv)]),
            ["TOTAL", String(r.totalUnidades), fmtM2(r.areaVendidaM2), fmtBRL(r.precoMedioUnidade) + " (médio/un.)", fmtBRL(r.vgv)],
          ],
        });
        y = fimTabela(y);
        y = pendenciasLista(mixSec.pendencias, y);
      }

      // ── 7. CUSTOS, RECEITAS E VGV ──────────────────────────────────────────
      y = titulo("7. CUSTOS, RECEITAS E VGV", y);
      const custosSec = modelo.custosReceitasVgv;
      if (custosSec.status === "pendente") {
        y = pendenciaBox(custosSec.pendencia, y);
      } else {
        const d = custosSec.dado;
        autoTable(doc, {
          startY: y,
          theme: "grid",
          styles: { fontSize: 8 },
          headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97] },
          head: [["Orçamento parametrizado", "Orçamento preliminar", "Orçamento da obra (realizado)", "VGV bruto", "VGV líquido"]],
          body: [[
            d.parametrizado ? fmtBRL(d.parametrizado.custoTotal) : "—",
            d.preliminar ? fmtBRL(d.preliminar.totalOrcado) : "—",
            d.obra ? `${fmtBRL(d.obra.totalRealizado)} (${d.obra.pctExecutado}%)` : "—",
            d.vgvBruto != null ? fmtBRL(d.vgvBruto) : "—",
            d.vgvLiquido != null ? fmtBRL(d.vgvLiquido) : "—",
          ]],
        });
        y = fimTabela(y);
        if (d.origemVgv) {
          y = paragrafo(
            `VGV calculado a partir de: ${d.origemVgv === "viabilidade_economica" ? "Viabilidade Econômica (EVE)" : "Mix de Produtos (sem EVE calculada)"}.`,
            y
          );
        }
        y = pendenciasLista(custosSec.pendencias, y);
      }

      // ── 8. VPL / TIR / ROI / PAYBACK / FLUXO DE CAIXA ──────────────────────
      y = titulo("8. VIABILIDADE ECONÔMICA (VPL, TIR, ROI, PAYBACK E FLUXO DE CAIXA)", y);
      const eveSec = modelo.viabilidadeEconomica;
      if (eveSec.status === "pendente") {
        y = pendenciaBox(eveSec.pendencia, y);
      } else {
        const r = eveSec.dado.resultado;
        autoTable(doc, {
          startY: y,
          theme: "grid",
          styles: { fontSize: 8 },
          headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97] },
          head: [["VPL", "TIR (a.a.)", "ROI", "Margem líquida", "Payback", "Exposição máxima"]],
          body: [[
            fmtBRL(r.vpl),
            r.tirAnual != null ? fmtPct(r.tirAnual, 2) : "—",
            fmtPct(r.roi),
            fmtPct(r.margemLiquida),
            r.paybackMes != null ? `${r.paybackMes} meses` : "não recupera",
            `${fmtBRL(r.exposicaoMaxima)} (mês ${r.mesPico})`,
          ]],
        });
        y = fimTabela(y);
        y = pendenciasLista(eveSec.pendencias, y);
        y = titulo("Fluxo de caixa mensal (EVE)", y);
        autoTable(doc, {
          startY: y,
          theme: "grid",
          styles: { fontSize: 6.5 },
          headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97], fontSize: 6.5 },
          head: [["Mês", "Receita bruta", "Receita (você)", "Receita (terreneiro)", "Custo pré-venda", "Custo durante venda", "Saldo do mês", "Saldo acumulado"]],
          body: r.fluxo.map((f) => [
            String(f.mes),
            fmtBRL(f.receitaBruta),
            fmtBRL(f.receitaVoce),
            fmtBRL(f.receitaTerreneiro),
            fmtBRL(f.custoPreVenda),
            fmtBRL(f.custoDuranteVenda),
            fmtBRL(f.saldoMes),
            fmtBRL(f.saldoAcumulado),
          ]),
        });
        y = fimTabela(y);
      }

      // ── 9. IMPOSTOS, COMISSÕES E PERMUTAS ─────────────────────────────────
      y = titulo("9. IMPOSTOS, COMISSÕES E PERMUTAS", y);
      const impostosSec = modelo.impostosComissoesPermutas;
      if (impostosSec.status === "pendente") {
        y = pendenciaBox(impostosSec.pendencia, y);
      } else {
        const d = impostosSec.dado;
        y = paragrafo(`Valores em ${d.rotulo} (motor de Viabilidade Econômica), sobre VGV bruto de ${fmtBRL(d.vgvGross)}.`, y);
        autoTable(doc, {
          startY: y,
          theme: "grid",
          styles: { fontSize: 8 },
          headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97] },
          head: [["", "Impostos", "Comissão", "Despesas gerais", "Taxa de incorporação", "Permuta (terreneiro)"]],
          body: [
            [
              "% sobre VGV",
              fmtPct(d.percentuais.impostosPctVgv, 2),
              fmtPct(d.percentuais.comissaoPctVgv, 2),
              fmtPct(d.percentuais.despesasGeraisPctVgv, 2),
              fmtPct(d.percentuais.taxaIncorporacaoPctVgv, 2),
              fmtPct(d.percentuais.permutaPctVgv, 2),
            ],
            [
              "Valor estimado",
              fmtBRL(d.valores.impostos),
              fmtBRL(d.valores.comissao),
              fmtBRL(d.valores.despesasGerais),
              fmtBRL(d.valores.taxaIncorporacao),
              fmtBRL(d.valores.permuta),
            ],
          ],
        });
        y = fimTabela(y);
      }

      // ── 10. NEGOCIAÇÕES / PROPOSTA ACEITA ─────────────────────────────────
      y = titulo("10. NEGOCIAÇÃO DO TERRENO / PROPOSTA ACEITA", y);
      const negSec = modelo.negociacoes;
      if (negSec.status === "pendente") {
        y = pendenciaBox(negSec.pendencia, y);
      } else {
        const d = negSec.dado;
        autoTable(doc, {
          startY: y,
          theme: "grid",
          styles: { fontSize: 8 },
          headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97] },
          head: [["Proprietário", "Contato", "Total de propostas", "Status atual", "Valor estimado atual", "Fechada?"]],
          body: [[
            d.proprietarioNome || "—",
            d.proprietarioContato || "—",
            String(d.resumo.totalPropostas),
            d.resumo.propostaAtual?.status ?? "—",
            fmtBRL(d.resumo.valorEstimadoAtual),
            d.resumo.fechada ? "Sim" : "Não",
          ]],
        });
        y = fimTabela(y);
        y = pendenciasLista(negSec.pendencias, y);
      }

      // ── 11. DOCUMENTOS / LICENÇAS / PENDÊNCIAS ────────────────────────────
      y = titulo("11. DOCUMENTOS, LICENÇAS E PENDÊNCIAS", y);
      const docsSec = modelo.documentosLicencas;
      if (docsSec.status === "pendente") {
        y = pendenciaBox(docsSec.pendencia, y);
      } else {
        const d = docsSec.dado;
        if (d.registro) {
          autoTable(doc, {
            startY: y,
            theme: "grid",
            styles: { fontSize: 8 },
            headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97] },
            head: [["Registro da incorporação", "Total", "Obtidos", "Em providência", "% obtido"]],
            body: [[
              "Checklist art. 32, Lei 4.591/64",
              String(d.registro.total),
              String(d.registro.obtidos),
              String(d.registro.emProvidencia),
              `${d.registro.pctObtido}%`,
            ]],
          });
          y = fimTabela(y);
          if (d.registro.pendentes.length > 0) {
            y = paragrafo(`Documentos pendentes: ${d.registro.pendentes.map((p) => p.nome).join("; ")}.`, y);
          }
        }
        if (d.aprovacao) {
          autoTable(doc, {
            startY: y,
            theme: "grid",
            styles: { fontSize: 8 },
            headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97] },
            head: [["Aprovação de projeto", "Total", "Protocolados", "Aprovados", "% aprovado"]],
            body: [[
              "Órgãos competentes",
              String(d.aprovacao.total),
              String(d.aprovacao.protocolados),
              String(d.aprovacao.aprovados),
              `${d.aprovacao.pctAprovado}%`,
            ]],
          });
          y = fimTabela(y);
          if (d.aprovacao.comExigencia.length > 0) {
            y = paragrafo(`Com exigência: ${d.aprovacao.comExigencia.map((p) => p.orgao).join("; ")}.`, y);
          }
          if (d.aprovacao.atrasados.length > 0) {
            y = paragrafo(`Atrasados em relação ao prazo previsto: ${d.aprovacao.atrasados.map((p) => p.orgao).join("; ")}.`, y);
          }
        }
        y = pendenciasLista(docsSec.pendencias, y);
      }

      // ── 12. CRONOGRAMA / TAREFAS / RESPONSÁVEIS / RISCOS ──────────────────
      y = titulo("12. CRONOGRAMA, TAREFAS, RESPONSÁVEIS E RISCOS", y);
      const cronogramaSec = modelo.cronograma;
      if (cronogramaSec.status === "pendente") {
        y = pendenciaBox(cronogramaSec.pendencia, y);
      } else {
        const d = cronogramaSec.dado;
        if (d.obra) {
          autoTable(doc, {
            startY: y,
            theme: "grid",
            styles: { fontSize: 8 },
            headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97] },
            head: [["Avanço físico (curva S)", "Avanço financeiro projetado", "Desvio", "Obra concluída?"]],
            body: [[
              `${d.obra.avancoFisicoAtualPct}%`,
              d.obra.avancoFinanceiroProjetadoAtualPct != null ? `${d.obra.avancoFinanceiroProjetadoAtualPct}%` : "—",
              d.obra.desvioAtualPct != null ? `${d.obra.desvioAtualPct > 0 ? "+" : ""}${d.obra.desvioAtualPct}%` : "—",
              d.obra.obraConcluida ? "Sim" : "Não",
            ]],
          });
          y = fimTabela(y);
        }
        if (d.lancamento) {
          autoTable(doc, {
            startY: y,
            theme: "grid",
            styles: { fontSize: 8 },
            headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97] },
            head: [["Marcos de lançamento", "Concluídos", "% concluído", "Atrasados"]],
            body: [[
              String(d.lancamento.total),
              String(d.lancamento.concluidos),
              `${d.lancamento.pctConcluido}%`,
              d.lancamento.atrasados.length > 0 ? d.lancamento.atrasados.map((m) => m.nome).join("; ") : "—",
            ]],
          });
          y = fimTabela(y);
        }
        if (d.responsaveisPorTarefa.length) {
          autoTable(doc, { startY: y, theme: "grid", styles: { fontSize: 8 },
            headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97] },
            head: [["Tarefa", "Responsável"]],
            body: d.responsaveisPorTarefa.map((t) => [t.tarefa, t.responsavel]) });
          y = fimTabela(y);
        }
        if (d.riscosExecucao.length) {
          autoTable(doc, { startY: y, theme: "grid", styles: { fontSize: 8 },
            headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97] },
            head: [["Risco", "Impacto", "Mitigação", "Responsável", "Status"]],
            body: d.riscosExecucao.map((r) => [r.descricao, r.impacto, r.mitigacao, r.responsavel, r.status]) });
          y = fimTabela(y);
        }
        y = pendenciasLista(cronogramaSec.pendencias, y);
      }

      // ── 13. PREMISSAS, FONTES, DATA E VERSÃO ──────────────────────────────
      y = titulo("13. PREMISSAS, FONTES, DATA E VERSÃO", y);
      const premissasSec = modelo.premissasFontesDataVersao;
      if (premissasSec.status === "pendente") {
        y = pendenciaBox(premissasSec.pendencia, y);
      } else {
        const d = premissasSec.dado;
        y = paragrafo(`Relatório gerado em: ${fmtDataHora(d.geradoEm)}.`, y);
        if (d.versao) y = paragrafo(`Versão salva do estudo: ${d.versao}.`, y);
        if (d.premissasViabilidade) {
          autoTable(doc, {
            startY: y,
            theme: "grid",
            styles: { fontSize: 8 },
            headStyles: { fillColor: [15, 25, 35], textColor: [201, 169, 97] },
            head: [["Impostos (% VGV)", "Comissão (% VGV)", "Permuta (% VGV)", "Despesas gerais (% VGV)", "Taxa de desconto (VPL/TMA, a.a.)"]],
            body: [[
              `${d.premissasViabilidade.impostosPctVgv}%`,
              `${d.premissasViabilidade.comissaoPctVgv}%`,
              `${d.premissasViabilidade.permutaPctVgv}%`,
              `${d.premissasViabilidade.despesasGeraisPctVgv}%`,
              `${d.premissasViabilidade.taxaDescontoAnual}%`,
            ]],
          });
          y = fimTabela(y);
        }
        if (d.parametrosUrbanisticosRelevantes) {
          y = paragrafo(
            `Parâmetros urbanísticos: zona ${d.parametrosUrbanisticosRelevantes.zona || "não informada"}, taxa de ocupação ${fmtPct(d.parametrosUrbanisticosRelevantes.taxaOcupacao)}, coeficiente de aproveitamento ${d.parametrosUrbanisticosRelevantes.coefAproveitamento.toFixed(2)}, lote mínimo ${fmtM2(d.parametrosUrbanisticosRelevantes.loteMinimoM2)}.`,
            y
          );
        }
        if (d.fontesPesquisaMercado) {
          y = paragrafo(`Fontes da pesquisa de mercado: ${d.fontesPesquisaMercado.join("; ")}.`, y);
        }
        y = pendenciasLista(premissasSec.pendencias, y);
      }

      if (y > 270) {
        doc.addPage();
        y = 20;
      }
      doc.setFontSize(7).setTextColor(150, 150, 150);
      doc.text(
        "Estudo preliminar de viabilidade e aproveitamento. Não substitui projeto urbanístico/engenharia aprovado, levantamento topográfico oficial, matrícula ou aprovação municipal. Seções marcadas como \"Pendência\" indicam dado ainda não cadastrado neste sistema.",
        14,
        Math.max(y + 6, 285),
        { maxWidth: pw - 28 }
      );

      doc.save(`relatorio-executivo-${estudo.name.replace(/\s+/g, "-").toLowerCase()}.pdf`);
      toast.success("Relatório executivo gerado!");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <FileText className="h-5 w-5 text-[#C9A961]" /> Relatório Executivo de Incorporação (PDF)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-400 max-w-2xl text-center mx-auto">
          Consolida terreno/mapas/APP, dados cadastrais/urbanísticos, mercado/referências, estudo de massa, quadro de
          áreas, mix de produtos, custos/receitas/VGV, VPL/TIR/ROI/payback/fluxo de caixa, impostos/comissões/permutas,
          negociações, documentos/licenças, cronograma e premissas/fontes/data em um único PDF. Dados ainda não
          cadastrados aparecem como pendência explícita no relatório — nenhuma seção é omitida.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {secoesResumo.map((s) => (
            <div
              key={s.label}
              className={`text-xs px-3 py-2 rounded-lg border text-center ${
                s.ok ? "border-green-900/50 bg-green-950/30 text-green-300" : "border-[#C9A961]/10 bg-[#0F1923] text-gray-500"
              }`}
            >
              {s.ok ? "✓" : "○"} {s.label}
            </div>
          ))}
        </div>

        <div className="text-center">
          <Button onClick={gerarPdf} disabled={busy} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            {busy ? "Gerando..." : "Baixar relatório executivo (PDF)"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
