// EPIC-029 S-5 (22/11/2026) — NFS-e RECEBIDA (XML do ADN, leiaute nacional) → linha de "obra_notas" com origem 'adn'.
// PURO: sem banco, sem rede, sem relógio próprio (o "agora" vem de fora). Testado por fixture
// (server/fiscal/fixtures/nfse-nacional-recebida.xml).
//
// Campos lidos (leiaute nacional NFS-e v1.00; nomes conferidos com PESQUISA.md §1 — os marcados [NÃO CONFIRMADO] precisam ser
// conferidos com um XML real do ADN na S-4):
//   NFSe/infNFSe@Id = "NFS" + chave de 50 posições (`[0-9]{6}[0-9A-Z]{14}[0-9]{30}`, XSD oficial: a inscrição pode ter letras); infNFSe/nNFSe (número); infNFSe/emit/(CNPJ|CPF), emit/xNome;
//   infNFSe/valores/vLiq [NÃO CONFIRMADO]; infNFSe/DPS/infDPS: tpAmb (1 = produção, 2 = produção restrita), dhEmi, dCompet,
//   toma/(CNPJ|CPF), toma/xNome, serv/cServ/cTribNac, serv/cServ/xDescServ, valores/vServPrest/vServ.
// Sem emit, o prestador da DPS (infDPS/prest) vale como emitente.
//
// Regras fixas:
// - XML com DOCTYPE/ENTITY é recusado (nada de entidade externa); acima de 300 000 caracteres, recusado.
// - CPF/CNPJ só entram conferidos pelo validador único (shared/fiscal/documento.ts, aceita o CNPJ alfanumérico).
// - Nome e descrição passam pelo MESMO filtro das notas de grupo (textoLido: dados bancários nunca, links fora).
// - Nada aqui decide ação: o resultado é um rascunho interno da Dolores (nunca lançamento), como as notas de grupo.
import { DOMParser } from "@xmldom/xmldom";
import { ALERTA_BANCARIO, TETO_VALOR_NOTA_CENTAVOS, textoLido } from "../../shared/dolores/notas.js";
import { documentoFiscalConferido, normalizarDocumento, type DocumentoConferido } from "../../shared/fiscal/documento.js";

export const MAX_CARACTERES_XML = 300_000;

/** Chave de acesso da NFS-e (50 posições; XSD oficial `tiposSimples_v1.01.xsd`, PESQUISA.md §1.4). */
export const FORMA_CHAVE_NFSE = /^[0-9]{6}[0-9A-Z]{14}[0-9]{30}$/;
/** Namespace do leiaute nacional (PESQUISA.md §1). A leitura procura os elementos pelo nome local. */
export const NAMESPACE_NFSE = "http://www.sped.fazenda.gov.br/nfse";

export type NfseRecebida = {
  chave: string;
  numero: string | null;
  /** AAAA-MM-DD da emissão (dhEmi, no fuso de quem emitiu). */
  dataEmissao: string | null;
  competencia: string | null;
  ambiente: "producao" | "producao_restrita" | null;
  emitente: { documento: DocumentoConferido | null; documentoLido: boolean; nome: string | null };
  tomador: { documento: DocumentoConferido | null; nome: string | null };
  valorServicoCentavos: number | null;
  valorLiquidoCentavos: number | null;
  descricao: string | null;
  codigoTributacaoNacional: string | null;
};

export type LeituraNfse = { ok: true; nota: NfseRecebida } | { ok: false; motivo: string };

// ── XML ──

type No = { localName?: string | null; nodeType: number; childNodes?: ArrayLike<No>; textContent?: string | null; getAttribute?: (n: string) => string | null };

const filhos = (el: No | null | undefined, nome: string): No[] => {
  const r: No[] = [];
  const lista = el?.childNodes;
  if (!lista) return r;
  for (let i = 0; i < lista.length; i++) if (lista[i].nodeType === 1 && lista[i].localName === nome) r.push(lista[i]);
  return r;
};
const filho = (el: No | null | undefined, ...caminho: string[]): No | null => {
  let atual: No | null | undefined = el;
  for (const nome of caminho) { atual = filhos(atual, nome)[0]; if (!atual) return null; }
  return atual ?? null;
};
const texto = (el: No | null | undefined, ...caminho: string[]): string | null => {
  const t = filho(el, ...caminho)?.textContent?.trim();
  return t ? t : null;
};

/** "1234.56" → 123456 (sem ponto flutuante). Fora do formato, negativo, zero ou acima do teto das notas: null. */
export function centavosDoXml(v: string | null): number | null {
  if (!v || !/^\d{1,13}(\.\d{1,2})?$/.test(v)) return null;
  const [inteiro, frac = ""] = v.split(".");
  const c = Number(inteiro) * 100 + Number(frac.padEnd(2, "0"));
  return c > 0 && c <= TETO_VALOR_NOTA_CENTAVOS ? c : null;
}

/** Número da NFS-e: só dígitos (1 a 15, leiaute nacional). Fora disso, null (vira dúvida, nunca é gravado cru). */
export function numeroDaNfse(v: string | null): string | null {
  return v && /^\d{1,15}$/.test(v) ? v : null;
}

/** QA S-5 (B1): tira marcação HTML/XML (e qualquer "<" ou ">" que sobrar) antes do filtro de texto das notas. */
export function semMarcacao(v: string | null): string | null {
  if (!v) return v;
  const t = v.replace(/<[^>]*>/g, " ").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
  return t || null;
}

/** AAAA-MM-DD de "2026-11-10T09:00:00-03:00" ou "2026-11-10", só se for uma data de verdade. */
export function dataDoXml(v: string | null): string | null {
  const m = v?.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === m[1] ? m[1] : null;
}

function documentoDe(el: No | null): { documento: DocumentoConferido | null; lido: boolean } {
  const bruto = texto(el, "CNPJ") ?? texto(el, "CPF");
  return { documento: bruto ? documentoFiscalConferido(bruto) : null, lido: !!bruto };
}

/** As MESMAS proteções para a NFS-e e para o evento: vazio, teto, DOCTYPE/ENTITY e XML malformado são recusados. */
function raizDoXml(xml: string): { ok: true; raiz: No } | { ok: false; motivo: string } {
  if (typeof xml !== "string" || !xml.trim()) return { ok: false, motivo: "xml_vazio" };
  if (xml.length > MAX_CARACTERES_XML) return { ok: false, motivo: "xml_grande_demais" };
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return { ok: false, motivo: "xml_com_doctype" };
  try {
    let erro = false;
    const doc = new DOMParser({ onError: (nivel: string) => { if (nivel !== "warning") erro = true; } }).parseFromString(xml, "text/xml");
    const raiz = doc.documentElement as unknown as No | null;
    if (erro || !raiz) return { ok: false, motivo: "xml_invalido" };
    return { ok: true, raiz };
  } catch {
    return { ok: false, motivo: "xml_invalido" };
  }
}

/** Lê o XML da NFS-e nacional. Nunca lança: o que não der para ler volta com o motivo. */
export function lerNfseRecebida(xml: string): LeituraNfse {
  const r = raizDoXml(xml);
  if (!r.ok) return r;
  const raiz = r.raiz;
  if (raiz.localName !== "NFSe") return { ok: false, motivo: "nao_e_nfse" };
  const inf = filho(raiz, "infNFSe");
  const id = inf?.getAttribute?.("Id") ?? "";
  const m = id.match(/^NFS([0-9]{6}[0-9A-Z]{14}[0-9]{30})$/);
  if (!inf || !m) return { ok: false, motivo: "chave_invalida" };
  const dps = filho(inf, "DPS", "infDPS");
  const emitEl = filho(inf, "emit") ?? filho(dps, "prest");
  const emit = documentoDe(emitEl);
  const toma = documentoDe(filho(dps, "toma"));
  const tpAmb = texto(dps, "tpAmb");
  return {
    ok: true,
    nota: {
      chave: m[1],
      // QA S-5 (M1): o número da NFS-e é só dígitos no leiaute (1 a 15); qualquer outra coisa (texto, marcação, conta) → null
      numero: numeroDaNfse(texto(inf, "nNFSe")),
      dataEmissao: dataDoXml(texto(dps, "dhEmi")) ?? dataDoXml(texto(inf, "dhProc")),
      competencia: dataDoXml(texto(dps, "dCompet")),
      ambiente: tpAmb === "1" ? "producao" : tpAmb === "2" ? "producao_restrita" : null,
      emitente: { documento: emit.documento, documentoLido: emit.lido, nome: texto(emitEl, "xNome") },
      tomador: { documento: toma.documento, nome: texto(filho(dps, "toma"), "xNome") },
      valorServicoCentavos: centavosDoXml(texto(dps, "valores", "vServPrest", "vServ")),
      valorLiquidoCentavos: centavosDoXml(texto(inf, "valores", "vLiq")),
      descricao: texto(dps, "serv", "cServ", "xDescServ"),
      codigoTributacaoNacional: texto(dps, "serv", "cServ", "cTribNac"),
    },
  };
}

// ── Evento da NFS-e (EPIC-029 S-5b) ──

/**
 * Eventos que CANCELAM a NFS-e (PESQUISA.md §1.5, Anexo II oficial): 101101 cancelamento; 105102 cancelamento por
 * substituição; 105104 cancelamento deferido em análise fiscal; 305101 cancelamento de ofício. Qualquer outro tipo (ex.:
 * 101103 pedido de análise, 105105 indeferido) não cancela e vai para o dono conferir.
 */
export const EVENTOS_DE_CANCELAMENTO = ["101101", "105102", "105104", "305101"] as const;
export type TipoCancelamento = (typeof EVENTOS_DE_CANCELAMENTO)[number];
export const ehCancelamento = (tipo: string): tipo is TipoCancelamento => (EVENTOS_DE_CANCELAMENTO as readonly string[]).includes(tipo);

export type EventoNfse = { chave: string; tipo: string; ambiente: "producao" | "producao_restrita" | null };
export type LeituraEvento = { ok: true; evento: EventoNfse } | { ok: false; motivo: string };

/**
 * Lê o XML de um EVENTO da NFS-e (leiaute nacional, XSD `tiposEventos_v1.01.xsd`): `evento/infEvento/pedRegEvento/infPedReg`
 * (o evento distribuído pelo ADN) ou `pedRegEvento/infPedReg` (só o pedido) [NÃO CONFIRMADO com um XML real do ADN — S-4].
 * Do `infPedReg`: `tpAmb`, `chNFSe` (50) e o grupo do tipo (`e101101`, ...; exatamente um). O `Id` (`PRE` + chave + tipo +
 * nº do pedido) e o `Id` de `infEvento` (`EVT` + chave + tipo + sequência), quando vierem, têm de bater com a chave e o tipo.
 * Mesmas proteções da NFS-e (DOCTYPE/ENTITY, teto, XML malformado). Raiz que não é evento → "nao_e_evento".
 */
export function lerEventoNfse(xml: string): LeituraEvento {
  const r = raizDoXml(xml);
  if (!r.ok) return r;
  const raiz = r.raiz;
  let inf: No | null = null;
  let infEvento: No | null = null;
  if (raiz.localName === "evento") { infEvento = filho(raiz, "infEvento"); inf = filho(infEvento, "pedRegEvento", "infPedReg"); }
  else if (raiz.localName === "pedRegEvento") inf = filho(raiz, "infPedReg");
  else return { ok: false, motivo: "nao_e_evento" };
  if (!inf) return { ok: false, motivo: "evento_sem_pedido" };
  const chave = texto(inf, "chNFSe")?.toUpperCase() ?? "";
  if (!FORMA_CHAVE_NFSE.test(chave)) return { ok: false, motivo: "chave_invalida" };
  const grupos: string[] = [];
  const lista = inf.childNodes;
  if (lista) for (let i = 0; i < lista.length; i++) {
    const nome = lista[i].nodeType === 1 ? lista[i].localName ?? "" : "";
    const m = nome.match(/^e(\d{6})$/);
    if (m) grupos.push(m[1]);
  }
  if (grupos.length !== 1) return { ok: false, motivo: "tipo_do_evento_invalido" };
  const tipo = grupos[0];
  const idPedido = inf.getAttribute?.("Id") ?? "";
  if (idPedido && idPedido !== `PRE${chave}${tipo}${idPedido.slice(-3)}`) return { ok: false, motivo: "id_do_evento_nao_confere" };
  if (idPedido && !/^PRE[0-9A-Z]{50}\d{9}$/.test(idPedido)) return { ok: false, motivo: "id_do_evento_nao_confere" };
  const idEvento = infEvento?.getAttribute?.("Id") ?? "";
  if (idEvento && (!/^EVT[0-9A-Z]{50}\d{9}$/.test(idEvento) || idEvento.slice(3, 59) !== `${chave}${tipo}`)) return { ok: false, motivo: "id_do_evento_nao_confere" };
  const tpAmb = texto(inf, "tpAmb");
  return { ok: true, evento: { chave, tipo, ambiente: tpAmb === "1" ? "producao" : tpAmb === "2" ? "producao_restrita" : null } };
}

// ── Mesma nota por outra origem: valor e data (EPIC-029 S-5b, portão de QA) ──

type ValorEData = { valorCentavos: number | null; dataEmissao: string | null };
const brl = (c: number | null) => (c === null ? "não lido" : (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const dataBr = (d: string | null) => (d ? d.split("-").reverse().join("/") : "não lida");

/**
 * Diferenças entre a NFS-e OFICIAL (ADN) e a mesma nota lida no grupo (mesmo emitente + número): valor ao centavo e data de
 * emissão. Valor/data que só um dos lados tem também conta (a leitura do grupo pode ter falhado). Puro; sem diferença → [].
 */
export function divergenciasEntreOrigens(oficial: ValorEData, grupo: ValorEData): string[] {
  const r: string[] = [];
  if (oficial.valorCentavos !== grupo.valorCentavos) r.push(`valor: oficial ${brl(oficial.valorCentavos)} × grupo ${brl(grupo.valorCentavos)}`);
  if (oficial.dataEmissao !== grupo.dataEmissao) r.push(`data de emissão: oficial ${dataBr(oficial.dataEmissao)} × grupo ${dataBr(grupo.dataEmissao)}`);
  return r;
}

// ── Vínculo com obra e empreiteiro (por CNPJ/CPF, por código) ──

/** Obra ativa cujo empreiteiro cadastrado (usuário ativo, papel empreiteiro) tem o MESMO documento do emitente. */
export type CandidatoVinculo = { obraId: number; empreiteiroUserId: number };

export type Vinculo = { obraId: number | null; empreiteiroUserId: number | null; duvida: string | null };

/**
 * Uma obra só → vinculada (obra e empreiteiro). Mesmo empreiteiro em mais de uma obra ativa → só o empreiteiro, sem obra
 * (o dono diz qual). Documento em mais de um usuário → nenhum vínculo. Nenhum → sem vínculo (fornecedor ou terceiro).
 */
export function vincularPorDocumento(candidatos: readonly CandidatoVinculo[], usuariosComDocumento = 0): Vinculo {
  const obras = Array.from(new Set(candidatos.map(c => c.obraId)));
  const usuarios = Array.from(new Set(candidatos.map(c => c.empreiteiroUserId)));
  // QA S-5 (B3): `usuariosComDocumento` conta TODOS os empreiteiros ativos com esse documento, com ou sem obra ativa —
  // documento em dois usuários nunca vincula, mesmo que só um deles tenha obra
  if (usuarios.length > 1 || usuariosComDocumento > 1) {
    return { obraId: null, empreiteiroUserId: null, duvida: "o CPF/CNPJ do emitente está no cadastro de mais de um empreiteiro: confira o cadastro e diga a obra" };
  }
  if (!candidatos.length) return { obraId: null, empreiteiroUserId: null, duvida: null };
  if (obras.length === 1) return { obraId: obras[0], empreiteiroUserId: usuarios[0], duvida: null };
  return { obraId: null, empreiteiroUserId: usuarios[0], duvida: `o empreiteiro desta nota tem ${obras.length} obras ativas: diga a qual obra ela pertence` };
}

// ── Linha de obra_notas ──

export type LinhaNotaRecebida = {
  origem: "adn"; grupoId: null; mensagemId: null; arquivoSha256: null; tipo: "nfse";
  obraId: number | null; empreiteiroUserId: number | null;
  situacao: "rascunho" | "confira";
  emitenteNome: string | null; emitenteDocumento: string | null; emitenteCnpjAlfa: string | null;
  numero: string | null; dataEmissao: string | null; valorCentavos: number | null; descricao: string | null;
  itens: []; chaveNfse: string; nsu: number; categoria: "empreiteiro" | null; etapa: null;
  confianca: Record<string, number>; duvidas: string[]; alertas: string[]; duplicadaDe: number | null; modelo: null; lidaEm: Date;
  /** S-5b: a mesma nota já registrada pela OUTRA origem (grupo da obra); só a primeira é conciliada. */
  outraOrigemDe: number | null;
  /** S-5b: o cancelamento já tinha chegado antes da nota (evento guardado): a nota já nasce cancelada. */
  canceladaEm: Date | null; cancelamentoTipo: string | null;
};

export type MapeamentoNota =
  | { gravar: true; linha: LinhaNotaRecebida; documentoEmitente: string | null }
  | { gravar: false; motivo: "outro_tomador" | "emitida_pela_empresa" | "producao_restrita" | "ambiente_desconhecido" };

/**
 * Nota lida → linha de obra_notas (origem 'adn'). `tomadorCnpj` é o CNPJ do grupo cuja distribuição trouxe o documento: a
 * nota só é gravada se ele for o TOMADOR (a distribuição também traz as notas que o próprio CNPJ emitiu).
 */
export function mapearNotaRecebida(nota: NfseRecebida, p: {
  tomadorCnpj: string; nsu: number; agora: Date; vinculo: Vinculo; duplicadaDe?: { id: number; motivo: string } | null;
  outraOrigemDe?: { id: number; motivo: string } | null; cancelamento?: { em: Date; tipo: string } | null;
  /**
   * QA S-5b: a mesma nota lida no grupo diverge desta (valor/data). `conciliadaNoGrupo` = a do grupo já foi ligada a um
   * pagamento (aí esta fica como "outra origem" e o dono confere); senão a conciliação passa para ESTA (a oficial).
   */
  divergenciaComGrupo?: { notaId: number; divergencias: string[]; conciliadaNoGrupo: boolean } | null;
}): MapeamentoNota {
  const tomador = normalizarDocumento(p.tomadorCnpj);
  if (nota.ambiente === "producao_restrita") return { gravar: false, motivo: "producao_restrita" };
  // QA S-5 (B2): sem tpAmb não dá para saber se é nota de verdade ou de teste → não grava
  if (nota.ambiente === null) return { gravar: false, motivo: "ambiente_desconhecido" };
  if (nota.emitente.documento?.valor === tomador) return { gravar: false, motivo: "emitida_pela_empresa" };
  if (nota.tomador.documento?.valor !== tomador) return { gravar: false, motivo: "outro_tomador" };

  const duvidas: string[] = [];
  const alertas: string[] = [];
  let bancario = false;
  const lerTexto = (s: string | null, max: number) => { const r = textoLido(semMarcacao(s), max); bancario ||= r.bancario; return r.texto; };
  const doc = nota.emitente.documento;
  if (!doc) duvidas.push(nota.emitente.documentoLido ? "CPF/CNPJ do emitente no XML: o dígito verificador não confere — não gravado" : "o XML não traz o CPF/CNPJ do emitente");
  if (!nota.numero) duvidas.push("o XML não traz um número de nota válido (só dígitos)");
  if (!nota.dataEmissao) duvidas.push("data de emissão ausente ou inválida no XML");
  const valor = nota.valorServicoCentavos;
  if (valor === null) duvidas.push("valor do serviço ausente ou inválido no XML");
  if (valor !== null && nota.valorLiquidoCentavos !== null && nota.valorLiquidoCentavos !== valor) {
    alertas.push(`valor líquido da nota: ${(nota.valorLiquidoCentavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} (com retenções); o pagamento pode ser esse valor`);
  }
  if (p.vinculo.duvida) duvidas.push(p.vinculo.duvida);
  if (p.duplicadaDe) alertas.push(`nota DUPLICADA: ${p.duplicadaDe.motivo} (não é conciliada)`);
  const outraOrigem = p.duplicadaDe ? null : p.outraOrigemDe ?? null;
  if (outraOrigem) alertas.push(`mesma nota já registrada pelo grupo da obra: ${outraOrigem.motivo} (a conciliação fica na nota ${outraOrigem.id})`);
  if (p.cancelamento) alertas.push(`NFS-e CANCELADA (evento ${p.cancelamento.tipo} do ADN): não pode ser paga nem conciliada`);
  const div = p.duplicadaDe ? null : p.divergenciaComGrupo?.divergencias.length ? p.divergenciaComGrupo : null;
  if (div) {
    alertas.push(`DIVERGE da nota ${div.notaId} lida no grupo (${div.divergencias.join("; ")}): `
      + (div.conciliadaNoGrupo ? `a do grupo já foi ligada a um pagamento — confira esse pagamento` : `a conciliação passa para esta, a nota oficial`));
  }
  const emitenteNome = lerTexto(nota.emitente.nome, 160);
  const descricao = lerTexto(nota.descricao, 400);
  if (bancario) alertas.push(ALERTA_BANCARIO);
  return {
    gravar: true,
    documentoEmitente: doc?.valor ?? null,
    linha: {
      origem: "adn", grupoId: null, mensagemId: null, arquivoSha256: null, tipo: "nfse",
      obraId: p.vinculo.obraId, empreiteiroUserId: p.vinculo.empreiteiroUserId,
      situacao: duvidas.length || p.duplicadaDe || p.cancelamento || div ? "confira" : "rascunho",
      emitenteNome, emitenteDocumento: doc && !doc.alfanumerico ? doc.valor : null, emitenteCnpjAlfa: doc?.alfanumerico ? doc.valor : null,
      numero: nota.numero, dataEmissao: nota.dataEmissao, valorCentavos: valor, descricao,
      itens: [], chaveNfse: nota.chave, nsu: p.nsu, categoria: p.vinculo.empreiteiroUserId ? "empreiteiro" : null, etapa: null,
      confianca: {}, duvidas: duvidas.slice(0, 20), alertas: alertas.slice(0, 12), duplicadaDe: p.duplicadaDe?.id ?? null, modelo: null, lidaEm: p.agora,
      outraOrigemDe: outraOrigem?.id ?? null, canceladaEm: p.cancelamento?.em ?? null, cancelamentoTipo: p.cancelamento?.tipo ?? null,
    },
  };
}
