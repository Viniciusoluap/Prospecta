// EPIC-029 S-7 (22/11/2026) — DANFSe (Documento Auxiliar da NFS-e) gerado pelo próprio sistema, como manda a NT 008 v1.02
// (a API de DANFSe do ADN foi suspensa em 03/08/2026). Sempre a partir do XML AUTORIZADO devolvido pela Sefin (nunca do
// rascunho): a função só recebe esse XML e recusa o que não for uma NFS-e com chave válida.
// NT 008 seguida aqui: uma página A4 retrato; cabeçalho "DANFSe v2.0" / "Documento Auxiliar da NFS-e"; em produção restrita
// (tpAmb 2) "NFS-e SEM VALIDADE JURÍDICA" em vermelho; município do emitente, ambiente gerador e tipo de ambiente à direita;
// QR Code com "https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=" + chave (mínimo 1,52 cm, na posição X 17,48 / Y 1,67 cm)
// e o texto de autenticidade abaixo; blocos de prestador, tomador, serviço, tributação municipal, valores e informações
// complementares. Fonte helvetica (equivalente métrico da Arial no jspdf). Mesma biblioteca da prévia (previa-pdf.ts).
// Nota cancelada leva a marca "CANCELADA".
import { GState, jsPDF } from "jspdf";
import QRCode from "qrcode";
import { lerNfse, type NfseLida, type Pessoa } from "./retorno.js";

export const URL_CONSULTA_PUBLICA = "https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=";
export const FRASE_SEM_VALIDADE = "NFS-e SEM VALIDADE JURÍDICA";
export const FRASE_AUTENTICIDADE = "A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta da chave de acesso no portal nacional da NFS-e";

export class ErroDanfse extends Error {
  constructor(message: string) { super(message); this.name = "ErroDanfse"; }
}

const TP_EMIT: Record<string, string> = { "1": "Prestador", "2": "Tomador", "3": "Intermediário" };
const AMB_GER: Record<string, string> = { "1": "Prefeitura", "2": "Sefin Nacional NFS-e" };
const TP_AMB: Record<string, string> = { "1": "Produção", "2": "Produção restrita (homologação)" };
const TRIB_ISSQN: Record<string, string> = { "1": "Operação tributável", "2": "Imunidade", "3": "Exportação de serviço", "4": "Não incidência" };
const RET_ISSQN: Record<string, string> = { "1": "Não retido", "2": "Retido pelo tomador", "3": "Retido pelo intermediário" };
const FIN: Record<string, string> = { "0": "NFS-e regular" };

const doc = (v: string | null | undefined) => {
  const d = (v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return v || "—";
};
const dataBr = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10).split("-").reverse().join("/") : "—");
const dataHoraBr = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v) ? `${dataBr(v)} ${v.slice(11, 19)}` : "—");
const reais = (v: string | null | undefined) => (v == null || v === "" ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const pct = (v: string | null | undefined) => (v == null || v === "" ? "—" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);
const corta = (t: string, max: number) => (Array.from(t).length > max ? `${Array.from(t).slice(0, max - 3).join("")}...` : t);

/** Gera o DANFSe (1 página) do XML AUTORIZADO. Lança ErroDanfse se o XML não for uma NFS-e legível. */
/**
 * QA S-7 (B4): `ambienteEmissao` (o gravado na nota) é a RESERVA do aviso "SEM VALIDADE JURÍDICA": sai quando o XML diz tpAmb 2
 * OU quando a nota foi emitida em produção restrita (XML sem tpAmb legível, ou contraditório: na dúvida, o aviso aparece).
 */
export type OpcoesDanfse = {
  cancelada?: boolean; ambienteEmissao?: string | null;
  /**
   * QA S-7 (B5): pela Dolores o DANFSe segue o MESMO interruptor da prévia (DOLORES_MASCARAR_DADOS_PESSOAIS): `campo` decide o
   * CPF/CNPJ, telefone e e-mail do TOMADOR, e `texto` filtra os textos livres (descrição, informações complementares). A tela
   * (admin) não passa nada: o documento sai como autorizado.
   */
  dadosPessoais?: { campo: (v: string, tipo: "cpf" | "cnpj" | "telefone" | "email") => string | null | undefined; texto: (t: string) => string };
};
export const semValidadeJuridica = (tpAmb: string | null | undefined, ambienteEmissao?: string | null) => tpAmb === "2" || ambienteEmissao === "producao_restrita";

/** Aplica o filtro de dados pessoais ao que o DANFSe desenha do tomador e aos textos livres. */
function filtrarDadosPessoais(n: NfseLida, f: NonNullable<OpcoesDanfse["dadosPessoais"]>): NfseLida {
  const t = (v: string | null) => (v == null ? v : f.texto(v));
  const c = (v: string | null, tipo: "cpf" | "cnpj" | "telefone" | "email") => (v == null ? v : f.campo(v, tipo) ?? null);
  const tom = n.tomador;
  const docTipo = (d: string) => (d.replace(/[^0-9A-Za-z]/g, "").length === 11 ? "cpf" : "cnpj");
  return {
    ...n,
    tomador: tom ? { ...tom, documento: tom.documento ? c(tom.documento, docTipo(tom.documento)) : null, fone: c(tom.fone, "telefone"), email: c(tom.email, "email"),
      nome: t(tom.nome), endereco: t(tom.endereco) } : null,
    servico: { ...n.servico, descricao: t(n.servico.descricao) },
    xOutInf: t(n.xOutInf),
  };
}
export function gerarDanfsePdf(xmlAutorizado: string, o: OpcoesDanfse = {}): Uint8Array {
  const n = lerNfse(xmlAutorizado);
  if (!n) throw new ErroDanfse("O XML autorizado da nota não pôde ser lido: o DANFSe não foi gerado.");
  return desenhar(o.dadosPessoais ? filtrarDadosPessoais(n, o.dadosPessoais) : n, o);
}

function desenhar(n: NfseLida, o: OpcoesDanfse): Uint8Array {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const L = 210, M = 3, W = L - 2 * M; // margens de 0,2 cm (NT 008 §2.2.2: 0,15 a 0,20 cm)
  let y = M;
  pdf.setLineWidth(0.35); pdf.rect(M - 0.5, M - 0.5, W + 1, 297 - 2 * M + 1); // borda de 1 ponto
  pdf.setLineWidth(0.18); // linhas divisórias de 0,5 ponto

  const cinza = (x: number, yy: number, w: number, h: number) => { pdf.setFillColor(242, 242, 242); pdf.rect(x, yy, w, h, "F"); };
  const rotulo = (t: string, x: number, yy: number) => { pdf.setFont("helvetica", "bold"); pdf.setFontSize(6); pdf.setTextColor(0, 0, 0); pdf.text(t, x, yy); };
  const valor = (t: string, x: number, yy: number, w: number) => {
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7); pdf.setTextColor(0, 0, 0);
    pdf.text(pdf.splitTextToSize(t, w)[0] ?? "", x, yy);
  };
  const campos = (lista: [string, string][], colunas: number, x0 = M, largura = W) => {
    const w = largura / colunas;
    lista.forEach(([r, v], i) => {
      const cx = x0 + (i % colunas) * w + 1.5, cy = y + Math.floor(i / colunas) * 6.4;
      rotulo(r, cx, cy + 2.6); valor(v, cx, cy + 5.6, w - 3);
    });
    y += Math.ceil(lista.length / colunas) * 6.4;
  };
  const bloco = (t: string) => {
    pdf.line(M, y, M + W, y); cinza(M, y, W, 4.2);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(7); pdf.setTextColor(0, 0, 0); pdf.text(t.toUpperCase(), M + 1.5, y + 3); y += 4.2;
  };

  // ── Cabeçalho (1,16 cm) ──
  cinza(M, y, W, 11.6);
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(10); pdf.setTextColor(31, 56, 100); pdf.text("NFS-e", M + 3, y + 7);
  pdf.setTextColor(0, 0, 0); pdf.setFontSize(9);
  pdf.text("DANFSe v2.0", L / 2, y + 4, { align: "center" });
  pdf.text("Documento Auxiliar da NFS-e", L / 2, y + 7.5, { align: "center" });
  if (semValidadeJuridica(n.tpAmb, o.ambienteEmissao)) { pdf.setTextColor(230, 0, 0); pdf.text(FRASE_SEM_VALIDADE, L / 2, y + 10.8, { align: "center" }); pdf.setTextColor(0, 0, 0); }
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(8);
  if (!(n.servico.cTribNac ?? "").startsWith("99")) pdf.text(`Município: ${n.xLocEmi ?? "—"}${n.emitente.uf ? ` / ${n.emitente.uf}` : ""}`, L - M - 1.5, y + 4, { align: "right" });
  pdf.setFontSize(6);
  pdf.text(`Ambiente gerador: ${AMB_GER[n.ambGer ?? ""] ?? n.ambGer ?? "—"}`, L - M - 1.5, y + 7.2, { align: "right" });
  pdf.text(`Tipo de ambiente: ${TP_AMB[n.tpAmb ?? ""] ?? n.tpAmb ?? "—"}`, L - M - 1.5, y + 9.7, { align: "right" });
  y += 11.6;

  // ── Dados da NFS-e + QR Code ──
  pdf.line(M, y, M + W, y);
  const yDados = y;
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(7); pdf.text("CHAVE DE ACESSO DA NFS-E", M + 1.5, y + 2.8);
  pdf.setFont("helvetica", "normal"); pdf.text(n.chave, M + 1.5, y + 6.2); y += 7.7;
  const larguraDados = 153;
  campos([
    ["NÚMERO DA NFS-E", n.numero], ["COMPETÊNCIA DA NFS-E", dataBr(n.dps.dCompet)], ["DATA E HORA DA EMISSÃO DA NFS-E", dataHoraBr(n.dhProc)],
    ["NÚMERO DA DPS", n.dps.nDPS ?? "—"], ["SÉRIE DA DPS", n.dps.serie ?? "—"], ["DATA E HORA DA EMISSÃO DA DPS", dataHoraBr(n.dps.dhEmi)],
    ["EMITENTE DA NFS-E", TP_EMIT[n.dps.tpEmit ?? ""] ?? "—"], ["SITUAÇÃO DA NFS-E", o.cancelada ? "Cancelada" : corta(n.cStat === "100" ? "NFS-e gerada" : `Situação ${n.cStat ?? "—"}`, 37)],
    ["FINALIDADE", corta(FIN[n.dps.finNFSe ?? "0"] ?? `Finalidade ${n.dps.finNFSe}`, 37)],
  ], 3, M, larguraDados);
  // QR Code (posição da NT 008: X 17,48 cm, Y 1,67 cm; 1,52 cm de lado no mínimo — aqui 2,0 cm para leitura fácil)
  const qr = QRCode.create(`${URL_CONSULTA_PUBLICA}${n.chave}`, { errorCorrectionLevel: "M" });
  const lado = 20, qx = 174.8 - 2, qy = Math.max(16.7, yDados + 1);
  const modulo = lado / qr.modules.size;
  pdf.setFillColor(0, 0, 0);
  for (let r = 0; r < qr.modules.size; r++) for (let c = 0; c < qr.modules.size; c++) {
    if (qr.modules.get(r, c)) pdf.rect(qx + c * modulo, qy + r * modulo, modulo + 0.01, modulo + 0.01, "F");
  }
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(5.5);
  pdf.text(pdf.splitTextToSize(FRASE_AUTENTICIDADE, 34).slice(0, 4), qx - 7, qy + lado + 2.2);
  y = Math.max(y, qy + lado + 9);

  const pessoaCampos = (p: Pessoa): [string, string][] => [
    ["CNPJ / CPF / NIF", doc(p.documento)], ["Inscrição Municipal", p.im ?? "—"], ["Telefone", p.fone ?? "—"],
    ["Nome / Nome Empresarial", corta(p.nome ?? "—", 77)], ["E-mail", p.email ?? "—"], ["Município / UF", [p.municipio, p.uf].filter(Boolean).join(" / ") || "—"],
    ["Endereço", corta(p.endereco ?? "—", 77)], ["Código IBGE / CEP", [p.municipio, p.cep].filter(Boolean).join(" / ") || "—"],
  ];
  bloco("Prestador / Fornecedor");
  campos(pessoaCampos(n.emitente), 3);
  bloco("Tomador / Adquirente da operação");
  if (n.tomador) campos(pessoaCampos(n.tomador), 3);
  else { valor("TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e", M + 1.5, y + 4, W); y += 6; }
  bloco("Destinatário da operação");
  valor("O DESTINATÁRIO É O PRÓPRIO TOMADOR/ADQUIRENTE DA OPERAÇÃO", M + 1.5, y + 4, W); y += 6;
  bloco("Intermediário da operação");
  valor("INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e", M + 1.5, y + 4, W); y += 6;

  bloco("Serviço prestado");
  campos([
    ["Código de Tributação Nacional", corta(`${n.servico.cTribNac ?? "—"}${n.xTribNac ? ` - ${n.xTribNac}` : ""}`, 80)], ["Código NBS", n.servico.cNBS ?? "—"],
    ["Local da Prestação", n.xLocPrestacao ?? n.servico.cLocPrestacao ?? "—"], ["Município de Incidência do ISSQN", n.xLocIncid ?? "—"],
  ], 2);
  rotulo("Descrição do Serviço", M + 1.5, y + 2.6);
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(7);
  const desc = pdf.splitTextToSize(n.servico.descricao ?? "—", W - 3) as string[];
  const linhasDesc = desc.slice(0, 10);
  if (desc.length > 10) linhasDesc[9] = `${linhasDesc[9]!.slice(0, -3)}...`;
  pdf.text(linhasDesc, M + 1.5, y + 5.6);
  y += 4 + linhasDesc.length * 3;

  bloco("Tributação municipal (ISSQN)");
  campos([
    ["Tributação do ISSQN", TRIB_ISSQN[n.valores.tribISSQN ?? ""] ?? "—"], ["Retenção do ISSQN", RET_ISSQN[n.valores.tpRetISSQN ?? ""] ?? "—"],
    ["Base de Cálculo do ISSQN", reais(n.valores.vBC)], ["Alíquota Aplicada", pct(n.valores.pAliqAplic)], ["ISSQN Apurado", reais(n.valores.vISSQN)],
  ], 3);

  bloco("Valor total da NFS-e");
  campos([
    ["Valor da Operação / Serviço", reais(n.valores.vServ)], ["Desconto Incondicionado", reais(n.valores.vDescIncond)], ["Desconto Condicionado", reais(n.valores.vDescCond)],
    ["Total das Retenções (ISSQN / Federais)", reais(n.valores.vTotalRet)], ["Valor Líquido da NFS-e", reais(n.valores.vLiq)],
    ["Total do IBS/CBS", n.valores.vIBS || n.valores.vCBS ? reais(String(Number(n.valores.vIBS ?? 0) + Number(n.valores.vCBS ?? 0))) : "—"],
  ], 3);
  cinza(M, y, W, 7);
  rotulo("Valor Líquido da NFS-e + IBS/CBS", M + 1.5, y + 2.6);
  valor(reais(n.valores.vTotNF ?? n.valores.vLiq), M + 1.5, y + 5.8, W); y += 7;

  bloco("Informações complementares");
  const compl = [n.servico.cObra ? `Obra (CNO): ${n.servico.cObra}` : null, n.xOutInf].filter(Boolean).join(" • ") || "—";
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(7);
  pdf.text((pdf.splitTextToSize(compl, W - 3) as string[]).slice(0, 4), M + 1.5, y + 3.5);

  if (o.cancelada) {
    pdf.saveGraphicsState();
    pdf.setGState(new GState({ opacity: 0.25 }));
    pdf.setTextColor(200, 0, 0); pdf.setFont("helvetica", "bold"); pdf.setFontSize(70);
    pdf.text("CANCELADA", L / 2, 160, { angle: 35, align: "center", baseline: "middle" });
    pdf.restoreGraphicsState();
  }
  return new Uint8Array(pdf.output("arraybuffer"));
}
