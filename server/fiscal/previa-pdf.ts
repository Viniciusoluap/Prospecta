// EPIC-029 S-2 (22/11/2026) — prévia em PDF do rascunho de nota, gerada no servidor com o jspdf que o projeto já usa
// (server/caixa/medicao-pdf.ts). Marca d'água diagonal "RASCUNHO — SEM VALOR FISCAL" em TODAS as páginas.
// O mesmo arquivo servirá à Dolores (S-3). Nada sai do sistema: o PDF só volta para quem pediu na tela.
import { GState, jsPDF } from "jspdf";
import { ROTULO_MOTIVO } from "../../shared/fiscal/motivos.js";
import { ALERTA_TOMADOR_MUDOU } from "../../shared/fiscal/origens.js";
import { ROTULO_STATUS } from "../../shared/fiscal/status.js";
import type { NotaDetalhada } from "./notas.js";

export const MARCA_DAGUA = "RASCUNHO — SEM VALOR FISCAL";

const REGIMES: Record<string, string> = {
  simples_nacional: "Simples Nacional", lucro_presumido: "Lucro Presumido", lucro_real: "Lucro Real", ret: "RET", outro: "Outro",
};
const A_PREENCHER = "a preencher pelo contador";

const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (d: string | null | undefined) => (d ? d.split("-").reverse().join("/") : "—");

function formatarDocumento(doc: string | null): string {
  const d = (doc ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return doc?.trim() || "não cadastrado (corrija no cadastro do tomador)";
}

function marcaDagua(pdf: jsPDF) {
  const largura = pdf.internal.pageSize.getWidth();
  const altura = pdf.internal.pageSize.getHeight();
  const total = pdf.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    pdf.setPage(p);
    pdf.saveGraphicsState();
    pdf.setGState(new GState({ opacity: 0.18 }));
    pdf.setTextColor(200, 30, 30);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(40);
    pdf.text(MARCA_DAGUA, largura / 2, altura / 2, { angle: 35, align: "center", baseline: "middle" });
    pdf.restoreGraphicsState();
    // Repetida em letra pequena no topo: continua legível mesmo impressa em preto e branco.
    pdf.setTextColor(180, 30, 30);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text(MARCA_DAGUA, largura / 2, 8, { align: "center" });
  }
}

/** Monta a prévia. Devolve os bytes do PDF. */
export function gerarPreviaPdf(nota: NotaDetalhada, agora: Date = new Date()): Uint8Array {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const margem = 15;
  const largura = pdf.internal.pageSize.getWidth() - margem * 2;
  const limite = pdf.internal.pageSize.getHeight() - 18;
  let y = 20;

  const quebra = (altura: number) => {
    if (y + altura > limite) { pdf.addPage(); y = 20; }
  };
  const titulo = (t: string) => {
    quebra(10);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.setTextColor(31, 56, 100);
    pdf.text(t, margem, y); y += 6;
  };
  const campo = (rotulo: string, valor: string) => {
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(9.5); pdf.setTextColor(20, 20, 20);
    const linhas = pdf.splitTextToSize(`${rotulo}: ${valor}`, largura) as string[];
    for (const l of linhas) { quebra(5); pdf.text(l, margem, y); y += 4.8; }
  };

  pdf.setFont("helvetica", "bold"); pdf.setFontSize(14); pdf.setTextColor(31, 56, 100);
  pdf.text("Prévia de Nota Fiscal de Serviço (NFS-e)", margem, y); y += 6;
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(90, 90, 90);
  pdf.text(`Rascunho nº ${nota.id} — situação: ${ROTULO_STATUS[nota.status]} — gerada em ${agora.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`, margem, y);
  y += 8;

  titulo("Prestador (emissor)");
  campo("Razão social", nota.emissor?.razaoSocial ?? "empresa emissora não escolhida");
  campo("CNPJ", nota.emissor ? formatarDocumento(nota.emissor.cnpj) : "—");
  campo("Regime", nota.emissor?.regime ? REGIMES[nota.emissor.regime] ?? nota.emissor.regime : "—");
  campo("Município do emissor", nota.emissor?.municipioNome ? `${nota.emissor.municipioNome}/${nota.emissor.municipioUf ?? ""}` : "—");
  y += 2;

  titulo("Tomador");
  campo("Nome", nota.tomador.nome ?? "sem cadastro ligado");
  campo("CPF/CNPJ", formatarDocumento(nota.tomador.documento));
  if (nota.tomador.cidade) campo("Cidade", `${nota.tomador.cidade}/${nota.tomador.uf ?? ""}`);
  if (nota.tomadorMudouNaOrigem) campo("Aviso", ALERTA_TOMADOR_MUDOU);
  y += 2;

  titulo("Serviço");
  campo("Tipo de serviço", nota.tipoServico?.nome ?? "não classificado");
  campo("Código de tributação nacional", nota.tipoServico?.codigoTributacaoNacional ?? A_PREENCHER);
  campo("Item da LC 116", nota.tipoServico?.itemLc116 ?? A_PREENCHER);
  campo("Código NBS", nota.tipoServico?.codigoNbs ?? A_PREENCHER);
  // S-8: no Simples a alíquota é calculada pelo sistema (RBT12 × anexo), nunca o número fixo do tipo.
  campo("Alíquota de ISS", nota.emissor?.regime === "simples_nacional"
    ? "calculada pelo Simples (ver \"Alíquota do Simples\" na tela)"
    : nota.tipoServico?.aliquotaIss ? `${Number(nota.tipoServico.aliquotaIss).toLocaleString("pt-BR")}%` : A_PREENCHER);
  campo("Município de incidência", nota.municipio.nome ? `${nota.municipio.nome}/${nota.municipio.uf ?? ""}` : "a definir");
  if (nota.obra) campo("Obra", `${nota.obra.titulo}${nota.obra.cidade ? ` (${nota.obra.cidade}/${nota.obra.uf ?? ""})` : ""}`);
  campo("Competência", nota.origem?.competencia || nota.dataEvento.slice(0, 7));
  campo("Descrição", nota.descricao || "—");
  y += 2;

  titulo("Valores");
  campo("Valor do serviço", reais(nota.valorCentavos));
  if (nota.valorAjustadoCentavos != null) campo("Valor da origem (antes do ajuste)", reais(nota.valorSugeridoCentavos));
  y += 2;

  titulo("Origem");
  campo("Registro", `${nota.origemRotulo} nº ${nota.origemId} de ${dataBr(nota.dataEvento)}`);
  if (nota.origem?.centroCustos) campo("Centro de custo", nota.origem.centroCustos);
  if (nota.status === "SEM_NOTA" && nota.motivoSemNota) {
    campo("Decisão", `não emitir — ${ROTULO_MOTIVO[nota.motivoSemNota]}${nota.motivoTexto ? `: ${nota.motivoTexto}` : ""}`);
  }
  y += 4;
  quebra(12);
  pdf.setFont("helvetica", "italic"); pdf.setFontSize(8.5); pdf.setTextColor(120, 40, 40);
  for (const l of pdf.splitTextToSize("Este documento é só uma prévia para conferência. Não é nota fiscal, não foi enviado a nenhum órgão e não tem valor fiscal.", largura) as string[]) {
    quebra(5); pdf.text(l, margem, y); y += 4.5;
  }

  marcaDagua(pdf);
  return new Uint8Array(pdf.output("arraybuffer"));
}
