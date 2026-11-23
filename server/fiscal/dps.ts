// EPIC-029 S-4 (22/11/2026) — montagem da DPS (leiaute nacional) como função PURA: sem banco, sem rede, sem relógio
// implícito. Entrada = rascunho (fiscal_notas detalhada) + emissor + tipo de serviço + parâmetros do contador.
// Tags e códigos em shared/fiscal/dps-campos.ts. Formato [OFICIAL, PESQUISA §2]: UTF-8 com declaração (E1229), sem prefixo
// de namespace (E1228), sem espaços/quebras entre tags. Duas variantes de leiaute (produção restrita com a NT 009 ×
// produção de 09/02/2026), escolhidas pelo ambiente (S-7: as travas de produção ficam em server/fiscal/emissao.ts).
// Campo obrigatório nulo → ErroDps com a LISTA do que falta (S-4, item 2). S-7: o XML assinado é validado contra o XSD
// oficial do ambiente (server/fiscal/leiaute.ts) antes do envio; a validação achou e corrigiu aqui a ordem do cNBS, o
// cAtvSN (não existe no regTrib do XSD v1.01) e o formato do pAliq.
import type { FiscalEmissor } from "../../drizzle/schema-fiscal.js";
import {
  CODIGOS_ATIVIDADE_SIMPLES, FIN_NFSE_REGULAR, NAMESPACE_NFSE, OP_SIMPLES, PADRAO_ID_DPS, PADRAO_NUMERO_DPS, SERIE_MAX_API, SERIE_MIN_API, TIPO_INSCRICAO_ID, TP_AMB,
  TP_EMIT_PRESTADOR, VARIANTE_DO_AMBIENTE, VERSAO_APLICATIVO, VERSAO_LEIAUTE_DPS,
  type EntradaDps, type ParametrosContador, type VarianteLeiaute,
} from "../../shared/fiscal/dps-campos.js";
import type { NotaDetalhada } from "./notas.js";

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
/**
 * S-7: regimes com que a DPS pode ser montada (valores de tax_profiles.regime). "a_confirmar", "outro", vazio ou qualquer
 * valor desconhecido → a DPS é recusada (nada é presumido).
 */
export const REGIMES_CONHECIDOS = ["simples_nacional", "lucro_presumido", "lucro_real", "ret"] as const;

/** pAliq (TSDec1V2, XSD v1.01): "0" ou um dígito com duas casas ("5.00"). Alíquota com mais casas ou ≥ 10 → recusa. */
export function aliquotaDoLeiaute(v: string | null | undefined): string | null {
  if (vazio(v)) return null;
  const n = Number(String(v).trim());
  if (!Number.isFinite(n) || n < 0 || n >= 10 || Math.abs(Math.round(n * 100) - n * 100) > 1e-6) throw new ErroDps(["alíquota do ISS com até duas casas decimais e menor que 10% (formato do leiaute)"]);
  return n === 0 ? "0" : n.toFixed(2);
}

/** Limite do leiaute para nome/razão social (TSNomeRazaoSocial). */
export const MAX_NOME = 300;

export function faltasDps(e: EntradaDps): string[] {
  const f: string[] = [];
  if (e.ambiente !== "producao_restrita" && e.ambiente !== "producao") f.push("empresa emissora em produção restrita ou produção (o ambiente está desligado)");
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
  if (vazio(e.regimeTributario)) f.push("regime tributário do perfil da empresa emissora");
  else if (!(REGIMES_CONHECIDOS as readonly string[]).includes(e.regimeTributario!)) f.push("regime tributário confirmado no perfil da empresa emissora (hoje está a confirmar ou desconhecido)");
  else if (!vazio(p.opSimpNac)) {
    const optante = p.opSimpNac === OP_SIMPLES.mei || p.opSimpNac === OP_SIMPLES.meEpp;
    if (simples && !optante) f.push("opção do Simples (opSimpNac) coerente com o regime Simples Nacional do perfil — contador");
    if (!simples && optante) f.push("opção do Simples (opSimpNac) coerente com o regime do perfil (não optante) — contador");
    if (simples && p.opSimpNac === OP_SIMPLES.meEpp && vazio(p.regApTribSN)) f.push("regime de apuração do Simples (regApTribSN) — contador");
  }
  // cAtvSN (Anexo VIII; regra 449 do Anexo VI): S-7 — o XSD v1.01 (produção e produção restrita) NÃO tem cAtvSN no regTrib.
  // O campo continua no tipo de serviço (para quando o leiaute o trouxer), mas não é exigido nem enviado.
  if (CATVSN_EM_REGTRIB && simples && !(CODIGOS_ATIVIDADE_SIMPLES as readonly string[]).includes(e.servico.codigoAtividadeSimples ?? "")) {
    f.push("código da atividade do Simples (cAtvSN: 7, 9, 12 ou 13) no tipo de serviço — contador");
  }
  try { aliquotaDoLeiaute(e.aliquotaIss); } catch (x) { if (x instanceof ErroDps) f.push(...x.faltas); else throw x; }
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
  if (!(simples && semClassificacao && e.competencia < "2027-01-01")) {
    for (const [k, rotulo] of ib) if (vazio(p.ibscbs[k])) f.push(`${rotulo} — contador`);
    // XSD de produção (09/02/2026): cIndOp é obrigatório no grupo IBSCBS (na produção restrita, com a NT 009, é opcional).
    if (e.ambiente === "producao" && vazio(p.ibscbs.cIndOp)) f.push("código do indicador da operação (cIndOp) do IBS/CBS — contador");
  }
  return f;
}

/** Itens 7.02 / 7.05 da LC 116 (pelo item ou pelo código de tributação nacional 0702xx / 0705xx). */
export function exigeGrupoObra(e: Pick<EntradaDps, "servico">): boolean {
  const item = (e.servico.itemLc116 ?? "").trim().replace(/^0/, "");
  const ctn = e.servico.codigoTributacaoNacional ?? "";
  return item === "7.02" || item === "7.05" || /^070[25]/.test(ctn);
}

/**
 * cAtvSN: conferido no XSD oficial em 22/11/2026 (S-7) — NÃO existe em prest/regTrib (opSimpNac, regApTribSN, regEspTrib)
 * na v1.01 de produção nem na de produção restrita. Fica desligado até um leiaute que o traga.
 */
const CATVSN_EM_REGTRIB: boolean = false;

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
  const tpAmb = e.ambiente === "producao" ? TP_AMB.producao : TP_AMB.producao_restrita;
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
    `<toma>`, tomadorDoc.length === 11 ? tag("CPF", tomadorDoc) : tag("CNPJ", tomadorDoc), tag("xNome", cortarTexto((e.tomador!.nome ?? "").trim(), MAX_NOME)), `</toma>`,
    `<serv>`,
    `<locPrest>`, tag("cLocPrestacao", e.servico.municipioIncidenciaIbge), `</locPrest>`,
    `<cServ>`, tag("cTribNac", e.servico.codigoTributacaoNacional),
    // Ordem conferida no XSD: produção restrita (NT 009) = cNBS ANTES de xDescServ; produção (09/02/2026) = depois.
    nt009 ? tag("cNBS", e.servico.codigoNbs) : "", tag("xDescServ", cortarTexto(e.servico.descricao, 2000)), nt009 ? "" : tag("cNBS", e.servico.codigoNbs), `</cServ>`,
    vazio(e.servico.cno) ? "" : `<obra>${tag("cObra", e.servico.cno)}</obra>`,
    `</serv>`,
    `<valores>`,
    `<vServPrest>`, tag("vServ", valorDecimal(e.valorCentavos)), `</vServPrest>`,
    `<trib>`,
    `<tribMun>`, tag("tribISSQN", p.tribIssqn), tag("tpRetISSQN", p.tpRetIssqn), tag("pAliq", aliquotaDoLeiaute(e.aliquotaIss)), `</tribMun>`,
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
  const variante = VARIANTE_DO_AMBIENTE[e.ambiente === "producao" ? "producao" : "producao_restrita"];
  return { id, xml: serializarDps(e, id, variante), variante };
}

/**
 * Adaptador: rascunho detalhado + emissor + parâmetros → EntradaDps. Nada é copiado de novo: tomador, valor, descrição
 * e município vêm do rascunho (que lê as origens); série/IBGE/inscrição, do complemento do emissor; códigos, do tipo.
 */
export function entradaDaNota(nota: NotaDetalhada, emissor: FiscalEmissor, o: {
  numero: number | null; emitidoEm: Date; parametros: ParametrosContador; cno?: string | null;
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
    parametros: o.parametros,
  };
}
