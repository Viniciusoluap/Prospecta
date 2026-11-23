// EPIC-029 S-4 (22/11/2026) — montagem da DPS (leiaute nacional) como função PURA: sem banco, sem rede, sem relógio
// implícito. Entrada = rascunho (fiscal_notas detalhada) + emissor + tipo de serviço + parâmetros do contador.
// Tags e códigos em shared/fiscal/dps-campos.ts. Formato [OFICIAL, PESQUISA §2]: UTF-8 com declaração (E1229), sem prefixo
// de namespace (E1228), sem espaços/quebras entre tags. Duas variantes de leiaute (produção restrita com a NT 009 ×
// produção de 09/02/2026), escolhidas pelo ambiente; produção continua bloqueada nesta etapa.
// Campo obrigatório nulo → ErroDps com a LISTA do que falta (S-4, item 2). A validação contra o XSD oficial fica para
// quando o XSD for obtido (não está no repositório).
import type { FiscalEmissor } from "../../drizzle/schema-fiscal.js";
import {
  CODIGOS_ATIVIDADE_SIMPLES, FIN_NFSE_REGULAR, NAMESPACE_NFSE, OP_SIMPLES, PADRAO_ID_DPS, PADRAO_NUMERO_DPS, SERIE_MAX_API, SERIE_MIN_API, TIPO_INSCRICAO_ID, TP_AMB,
  TP_EMIT_PRESTADOR, VARIANTE_DO_AMBIENTE, VERSAO_APLICATIVO, VERSAO_LEIAUTE_DPS,
  type AliquotaSimplesDps, type EntradaDps, type ParametrosContador, type VarianteLeiaute,
} from "../../shared/fiscal/dps-campos.js";
import { aliquotaTextoParaDps } from "../../shared/fiscal/simples.js";
import type { NotaDetalhada } from "./notas.js";
import { REGIMES_TRIBUTARIOS, regimeAConfirmar } from "../../shared/fiscal/regimes.js";

export class ErroDps extends Error {
  constructor(readonly faltas: string[]) {
    super(`A nota ainda não pode ser montada. Falta: ${faltas.join("; ")}.`);
    this.name = "ErroDps";
  }
}

const doc = (v: string | null | undefined) => (v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
const vazio = (v: string | null | undefined) => v == null || String(v).trim() === "";

/** Corta em `max` caracteres sem partir um caractere em dois (conta por code point, não por unidade UTF-16). */
export function cortarTexto(v: string, max: number): string {
  const pontos = Array.from(v);
  return pontos.length <= max ? v : pontos.slice(0, max).join("");
}

/** Escapa texto para conteúdo XML; remove caracteres de controle que o XML 1.0 não aceita. */
export function escaparXml(v: string): string {
  // QA S-4 (B4): fora também U+FFFE/U+FFFF e metades de par surrogate soltas (proibidos no XML 1.0).
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Centavos → "1234.56" (ponto decimal, duas casas). */
export function valorDecimal(centavos: number): string {
  if (!Number.isSafeInteger(centavos) || centavos <= 0) throw new ErroDps(["valor do serviço maior que zero"]);
  return `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, "0")}`;
}

/** Data e hora no fuso de Brasília com deslocamento explícito: "2026-11-22T10:00:00-03:00". */
export function dataHoraBrasilia(d: Date): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d).reduce<Record<string, string>>((a, x) => ({ ...a, [x.type]: x.value }), {});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}-03:00`;
}

/** Série do aplicativo próprio (API): 1 a 49999 [OFICIAL, E0010]. */
export function serieValida(serie: string | null | undefined): boolean {
  if (!serie || !/^\d{1,5}$/.test(serie)) return false;
  const n = Number(serie);
  return n >= SERIE_MIN_API && n <= SERIE_MAX_API;
}

/** Id da DPS (45) [OFICIAL]: "DPS" + IBGE (7) + tipo de inscrição (2 = CNPJ) + CNPJ (14) + série (5) + número (15). */
export function idDps(municipioIbge: string, cnpj: string, serie: string, numero: number): string {
  const c = doc(cnpj);
  if (!/^\d{7}$/.test(municipioIbge)) throw new ErroDps(["código IBGE do município do emissor (7 números)"]);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(c)) throw new ErroDps(["CNPJ do emissor válido"]);
  if (!serieValida(serie)) throw new ErroDps(["série da DPS entre 1 e 49999"]);
  if (!Number.isSafeInteger(numero) || !PADRAO_NUMERO_DPS.test(String(numero))) throw new ErroDps(["número da DPS (1 a 15 dígitos)"]);
  const id = `DPS${municipioIbge}${TIPO_INSCRICAO_ID.cnpj}${c}${serie.padStart(5, "0")}${String(numero).padStart(15, "0")}`;
  if (!PADRAO_ID_DPS.test(id)) throw new ErroDps(["identificador da DPS no padrão oficial"]);
  return id;
}

/** Tudo o que falta para montar a DPS (vazio = pode montar). */
export function faltasDps(e: EntradaDps): string[] {
  const f: string[] = [];
  if (e.ambiente !== "producao_restrita") f.push("empresa emissora em produção restrita (a produção fica bloqueada nesta etapa)");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.competencia)) f.push("data de competência");
  if (!serieValida(e.serie)) f.push("série da DPS da empresa emissora (1 a 49999)");
  if (e.numero == null) f.push("número da DPS");
  if (vazio(e.prestador.municipioIbge)) f.push("código IBGE do município da empresa emissora");
  if (vazio(doc(e.prestador.cnpj))) f.push("CNPJ da empresa emissora");
  const t = doc(e.tomador?.documento);
  if (!e.tomador || !(t.length === 11 || t.length === 14)) f.push("CPF ou CNPJ do tomador");
  if (vazio(e.tomador?.nome)) f.push("nome do tomador");
  if (vazio(e.servico.municipioIncidenciaIbge)) f.push("código IBGE do município de incidência");
  if (vazio(e.servico.codigoTributacaoNacional)) f.push("código de tributação nacional do tipo de serviço (contador)");
  if (vazio(e.servico.descricao)) f.push("descrição do serviço");
  if (!(Number.isSafeInteger(e.valorCentavos) && e.valorCentavos > 0)) f.push("valor do serviço maior que zero");
  if ((e.reembolsoCentavos ?? 0) > 0) {
    f.push("nota com reembolso/repasse de despesa: ainda não tratado na DPS (o campo muda entre os leiautes — vCalcReeRepRes × vCalcAjusteBCIBSCBS, NT 009 §2.3); emita sem o reembolso ou marque como \"sem nota\"");
  }
  const p = e.parametros;
  const contador: [keyof Omit<ParametrosContador, "ibscbs">, string][] = [
    ["opSimpNac", "situação no Simples Nacional (opSimpNac)"], ["regEspTrib", "regime especial de tributação (regEspTrib)"],
    ["tribIssqn", "tributação do ISSQN (tribISSQN)"], ["tpRetIssqn", "retenção do ISSQN (tpRetISSQN)"], ["indTotTrib", "indicador de total de tributos (indTotTrib)"],
  ];
  for (const [k, rotulo] of contador) if (vazio(p[k])) f.push(`${rotulo} — contador`);
  // Regime × opção do Simples (decisão do dono de 22/11: todas as empresas no Simples Nacional).
  const simples = e.regimeTributario === "simples_nacional";
  // QA2 S-6 (N3): "a confirmar" (ou regime que o sistema não reconhece) é FALTA — sem o contador dizer o regime, não se monta a DPS
  const reconhecido = !vazio(e.regimeTributario) && !regimeAConfirmar(e.regimeTributario) && (REGIMES_TRIBUTARIOS as readonly string[]).includes(e.regimeTributario!);
  if (!reconhecido) f.push(vazio(e.regimeTributario) ? "regime tributário do perfil da empresa emissora"
    : "regime tributário do perfil da empresa emissora (está \"a confirmar\" ou não reconhecido — o contador precisa definir)");
  else if (!vazio(p.opSimpNac)) {
    const optante = p.opSimpNac === OP_SIMPLES.mei || p.opSimpNac === OP_SIMPLES.meEpp;
    if (simples && !optante) f.push("opção do Simples (opSimpNac) coerente com o regime Simples Nacional do perfil — contador");
    if (!simples && optante) f.push("opção do Simples (opSimpNac) coerente com o regime do perfil (não optante) — contador");
    if (simples && p.opSimpNac === OP_SIMPLES.meEpp && vazio(p.regApTribSN)) f.push("regime de apuração do Simples (regApTribSN) — contador");
  }
  // cAtvSN (Anexo VIII; regra 449 do Anexo VI): obrigatório para optante do Simples, vem do tipo de serviço.
  const atv = e.servico.codigoAtividadeSimples;
  if (simples && !(CODIGOS_ATIVIDADE_SIMPLES as readonly string[]).includes(atv ?? "")) {
    f.push("código da atividade do Simples (cAtvSN: 7, 9, 12 ou 13) no tipo de serviço — contador");
  }
  // S-8: alíquota do Simples calculada pelo sistema (não o número fixo do tipo). Sem cálculo, a DPS do Simples não sai.
  if (simples) {
    const a = e.aliquotaSimples;
    if (!a) f.push("alíquota do Simples calculada pelo sistema (RBT12 × anexo do tipo de serviço)");
    else {
      if (a.falta) f.push(a.falta);
      if (e.ambiente === "producao" && !a.receitaCompleta) f.push("receita dos 12 meses completa para o RBT12 (contas bancárias por empresa — S-6)");
      if (e.ambiente === "producao" && a.inicioAtividadeInformado !== true) f.push("data de início de atividade da empresa (Dados fiscais do perfil › Folha e início)");
    }
  }
  // 7.02/7.05 (construção): ISS no local da obra e grupo "obra" obrigatório (Anexo I, MUN.INCID INFO.SERV.). Hoje o
  // sistema informa a obra pelo CNO; CIB ou endereço da obra ficam para quando houver onde guardá-los.
  if (exigeGrupoObra(e) && vazio(e.servico.cno)) f.push("CNO da obra (grupo \"obra\" obrigatório para os itens 7.02 e 7.05)");
  // Obrigatórios da classificação (PESQUISA §5). indFinal e cIndOp são opcionais no leiaute da produção restrita (o cIndOp
  // só é exigido quando o cClassTrib pede — E0860; a Sefin recusa e a mensagem dela volta para a tela).
  // Optante do Simples: o grupo IBSCBS só é obrigatório a partir de 2027 (Anexo I, PESQUISA §5) — sem classificação
  // nenhuma, o grupo fica fora; com parte dela, exige o resto.
  const ib: [keyof ParametrosContador["ibscbs"], string][] = [
    ["indDest", "indicador do destinatário (IBS/CBS)"], ["cst", "CST do IBS/CBS"], ["cClassTrib", "classificação tributária do IBS/CBS (cClassTrib)"],
  ];
  const semClassificacao = ib.every(([k]) => vazio(p.ibscbs[k])) && vazio(p.ibscbs.cIndOp) && vazio(p.ibscbs.indFinal);
  if (!(simples && semClassificacao && e.competencia < "2027-01-01")) for (const [k, rotulo] of ib) if (vazio(p.ibscbs[k])) f.push(`${rotulo} — contador`);
  return f;
}

/** Itens 7.02 / 7.05 da LC 116 (pelo item ou pelo código de tributação nacional 0702xx / 0705xx). */
export function exigeGrupoObra(e: Pick<EntradaDps, "servico">): boolean {
  const item = (e.servico.itemLc116 ?? "").trim().replace(/^0/, "");
  const ctn = e.servico.codigoTributacaoNacional ?? "";
  return item === "7.02" || item === "7.05" || /^070[25]/.test(ctn);
}

/**
 * Posição do cAtvSN no XML: [NÃO CONFIRMADO linha a linha no XSD] — vem do leiaute RTC (Anexo VI); colocado em
 * prest/regTrib, logo depois do regApTribSN. Ajustar só aqui quando conferido no XSD da produção restrita.
 */
const CATVSN_EM_REGTRIB = true;

/** pAliq: emissor do Simples usa a alíquota calculada (S-8); os outros regimes, a alíquota do tipo de serviço. */
export function aliquotaDaDps(e: Pick<EntradaDps, "regimeTributario" | "aliquotaIss" | "aliquotaSimples">): string | null {
  // QA S-8 (baixo): 2 casas no pAliq (CASAS_PALIQ, shared/fiscal/simples.ts), nos dois casos.
  return aliquotaTextoParaDps(e.regimeTributario === "simples_nacional" ? e.aliquotaSimples?.aliquotaIss ?? null : e.aliquotaIss);
}

const tag = (nome: string, valor: string | null | undefined) => (vazio(valor) ? "" : `<${nome}>${escaparXml(String(valor).trim())}</${nome}>`);

/**
 * Serializa a DPS numa variante de leiaute (sem validar faltas nem ambiente). Uso direto só em teste; o caminho normal é
 * `montarDps`, que recusa o que falta e a produção.
 */
export function serializarDps(e: EntradaDps, id: string, variante: VarianteLeiaute): string {
  const tomadorDoc = doc(e.tomador!.documento);
  const p = e.parametros;
  const ib = p.ibscbs;
  const nt009 = variante === "producao_restrita_20261020";
  const tpAmb = nt009 ? TP_AMB.producao_restrita : TP_AMB.producao;
  const classificacao = `${tag("CST", ib.cst)}${tag("cClassTrib", ib.cClassTrib)}`;
  const semIbsCbs = [ib.indDest, ib.cst, ib.cClassTrib, ib.cIndOp, ib.indFinal].every(vazio);
  const ibscbs = semIbsCbs ? "" : nt009
    // NT 009 (produção restrita, XSD 20/10/2026): CST/cClassTrib em IBSCBS/valores/trib; gIBSCBS facultativo (não enviado).
    ? `<IBSCBS>${tag("indFinal", ib.indFinal)}${tag("cIndOp", ib.cIndOp)}${tag("indDest", ib.indDest)}<valores><trib>${classificacao}</trib></valores></IBSCBS>`
    // Produção (XSD 09/02/2026): finNFSe dentro de IBSCBS; classificação em valores/trib/gIBSCBS [NÃO CONFIRMADO linha a linha].
    : `<IBSCBS>${tag("finNFSe", FIN_NFSE_REGULAR)}${tag("indFinal", ib.indFinal)}${tag("cIndOp", ib.cIndOp)}${tag("indDest", ib.indDest)}<valores><trib><gIBSCBS>${classificacao}</gIBSCBS></trib></valores></IBSCBS>`;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<DPS xmlns="${NAMESPACE_NFSE}" versao="${VERSAO_LEIAUTE_DPS}">`,
    `<infDPS Id="${id}">`,
    tag("tpAmb", tpAmb),
    tag("dhEmi", dataHoraBrasilia(e.emitidoEm)),
    tag("verAplic", VERSAO_APLICATIVO),
    tag("serie", String(Number(e.serie))),
    tag("nDPS", String(e.numero)),
    tag("dCompet", e.competencia),
    tag("tpEmit", TP_EMIT_PRESTADOR),
    nt009 ? tag("finNFSe", FIN_NFSE_REGULAR) : "",
    tag("cLocEmi", e.prestador.municipioIbge),
    // IM só quando o emissor tem (a prefeitura cadastrou): informar sem cadastro gera E0120.
    `<prest>`, tag("CNPJ", doc(e.prestador.cnpj)), tag("IM", e.prestador.inscricaoMunicipal),
    `<regTrib>`, tag("opSimpNac", p.opSimpNac), tag("regApTribSN", p.regApTribSN),
    CATVSN_EM_REGTRIB && e.regimeTributario === "simples_nacional" ? tag("cAtvSN", e.servico.codigoAtividadeSimples) : "", tag("regEspTrib", p.regEspTrib), `</regTrib>`, `</prest>`,
    `<toma>`, tomadorDoc.length === 11 ? tag("CPF", tomadorDoc) : tag("CNPJ", tomadorDoc), tag("xNome", e.tomador!.nome), `</toma>`,
    `<serv>`,
    `<locPrest>`, tag("cLocPrestacao", e.servico.municipioIncidenciaIbge), `</locPrest>`,
    `<cServ>`, tag("cTribNac", e.servico.codigoTributacaoNacional), tag("xDescServ", cortarTexto(e.servico.descricao, 2000)), tag("cNBS", e.servico.codigoNbs), `</cServ>`,
    vazio(e.servico.cno) ? "" : `<obra>${tag("cObra", e.servico.cno)}</obra>`,
    `</serv>`,
    `<valores>`,
    `<vServPrest>`, tag("vServ", valorDecimal(e.valorCentavos)), `</vServPrest>`,
    `<trib>`,
    `<tribMun>`, tag("tribISSQN", p.tribIssqn), tag("tpRetISSQN", p.tpRetIssqn), tag("pAliq", aliquotaDaDps(e)), `</tribMun>`,
    `<totTrib>`, tag("indTotTrib", p.indTotTrib), `</totTrib>`,
    `</trib>`,
    `</valores>`,
    ibscbs,
    `</infDPS>`,
    `</DPS>`,
  ].join("");
}

/** Monta o XML da DPS (sem assinatura), na variante do ambiente. Lança ErroDps com a lista do que falta. */
export function montarDps(e: EntradaDps): { id: string; xml: string; variante: VarianteLeiaute } {
  const faltas = faltasDps(e);
  if (faltas.length) throw new ErroDps(faltas);
  const id = idDps(e.prestador.municipioIbge!, e.prestador.cnpj, e.serie!, e.numero!);
  const variante = VARIANTE_DO_AMBIENTE.producao_restrita;
  return { id, xml: serializarDps(e, id, variante), variante };
}

/**
 * Adaptador: rascunho detalhado + emissor + parâmetros → EntradaDps. Nada é copiado de novo: tomador, valor, descrição
 * e município vêm do rascunho (que lê as origens); série/IBGE/inscrição, do complemento do emissor; códigos, do tipo.
 */
export function entradaDaNota(nota: NotaDetalhada, emissor: FiscalEmissor, o: {
  numero: number | null; emitidoEm: Date; parametros: ParametrosContador; cno?: string | null;
  /** S-8: resultado de `paraDps(aliquotaSimplesDaNota(...))` (server/fiscal/simples.ts). */
  aliquotaSimples?: AliquotaSimplesDps | null;
}): EntradaDps {
  return {
    ambiente: emissor.ambiente,
    emitidoEm: o.emitidoEm,
    competencia: nota.dataEvento,
    serie: emissor.serieDps,
    numero: o.numero,
    prestador: { cnpj: emissor.cnpj, inscricaoMunicipal: emissor.inscricaoMunicipal, municipioIbge: emissor.municipioIbge },
    tomador: nota.tomador.tipo === "nenhum" ? null : { documento: nota.tomador.documento, nome: nota.tomador.nome },
    servico: {
      municipioIncidenciaIbge: nota.municipioIncidenciaIbge ?? (nota.municipio.fonte === "emissor" ? emissor.municipioIbge : null),
      codigoTributacaoNacional: nota.tipoServico?.codigoTributacaoNacional ?? null,
      codigoNbs: nota.tipoServico?.codigoNbs ?? null,
      itemLc116: nota.tipoServico?.itemLc116 ?? null,
      codigoAtividadeSimples: nota.tipoServico?.codigoAtividadeSimples ?? null,
      descricao: nota.descricao,
      cno: o.cno ?? null,
    },
    valorCentavos: nota.valorCentavos,
    regimeTributario: nota.emissor?.regime ?? null,
    aliquotaIss: nota.tipoServico?.aliquotaIss ?? null,
    aliquotaSimples: o.aliquotaSimples ?? null,
    parametros: o.parametros,
  };
}
