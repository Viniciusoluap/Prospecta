// EPIC-029 S-7 (22/11/2026) — emissão e cancelamento de NFS-e pela Sefin Nacional, com IDEMPOTÊNCIA. Usada pela tela
// (router.ts) e pela Dolores (acoes/fiscal.ts), sempre com as MESMAS travas:
//   1. `EMISSAO_DISPONIVEL` (constante do código, hoje false);
//   2. `fiscal_emissores.emissao_liberada` (interruptor por emissor, falso por padrão, sem rota que o ligue);
//   3. ambiente do emissor `producao_restrita` ou `producao` ("producao" só pelo admin, com a frase "EMITIR EM PRODUÇÃO").
//   O gatilho da 0167 confere 2 e 3 de novo no banco.
// Idempotência (R10, PESQUISA §1.4): o Id da DPS de um rascunho é reservado UMA vez (FOR UPDATE no emissor e na nota) e nunca
// muda (gatilho + índice único); a nota fica EMITINDO durante o envio (trava) e, com resultado incerto (tempo esgotado, rede,
// 5xx, resposta ilegível), continua EMITINDO: a próxima tentativa CONSULTA `GET /dps/{id}` antes de reenviar.
// Sem log de XML, de corpo de resposta ou de dado pessoal: o retorno oficial fica no banco (fiscal_eventos), e o erro mostrado é
// uma frase fixa com o código da Sefin (retorno.ts#FRASES_ERRO).
import { and, eq, sql } from "drizzle-orm";
import { fiscalEmissores, fiscalEventos, fiscalNotas, fiscalTiposServico, type FiscalEmissor, type SituacaoEventoFiscal, type TipoEventoFiscal, type ViaFiscal } from "../../drizzle/schema-fiscal.js";
import { PARAMETROS_VAZIOS, type ParametrosContador } from "../../shared/fiscal/dps-campos.js";
import { AVISO_EMISSAO_INDISPONIVEL, EMISSAO_DISPONIVEL } from "../../shared/fiscal/status.js";
import type { DrizzleDb } from "../db.js";
import { resolverAliquotaIss, FONTES_ALIQUOTA } from "./aliquota.js";
import { ErroCertificado } from "./certificado.js";
import { entradaDaNota, ErroDps, idDps, montarDps } from "./dps.js";
import { dentroDoPrazo, ErroEvento, limparJustificativa, montarPedidoCancelamento, MOTIVOS_CANCELAMENTO, PRAZO_MAXIMO_CANCELAMENTO_DIAS, problemaDaJustificativa } from "./evento.js";
import { ErroLeiaute, exigirLeiaute } from "./leiaute.js";
import { carregarNota } from "./notas.js";
import { aliquotaMunicipalVigente } from "./parametros-municipais.js";
import { ibgeDoMunicipio } from "../../shared/fiscal/municipios.js";
import { SERIE_PADRAO_API } from "../../shared/fiscal/dps-campos.js";
import { conferirNfse, fraseDosCodigos, lerConsultaDps, lerConsultaNfse, lerRetornoEmissao, lerRetornoEvento, type NfseLida } from "./retorno.js";
import { caminhoDe, CAMPOS_JSON, compactarXml, ErroSefin, sessaoDoEmissor, type DepsSefin } from "./sefin.js";

/** Frase que o admin digita para virar um emissor para PRODUÇÃO (S-5 item 1). Conferida no servidor. */
export const FRASE_PRODUCAO = "EMITIR EM PRODUÇÃO";
/** Uma emissão iniciada há menos que isto trava o rascunho (outra aba, outro clique, a Dolores ao mesmo tempo). */
export const TRAVA_EMITINDO_MS = 90_000;

export class ErroEmissao extends Error {
  constructor(message: string, readonly tipo: "trava" | "dados" | "rejeitada" | "conflito" = "dados") { super(message); this.name = "ErroEmissao"; }
}

export type ResultadoEmissao = {
  situacao: "emitida" | "ja_emitida" | "rejeitada" | "incerta";
  notaId: number; mensagem: string; chave?: string; numero?: string; codigos?: string[];
};
export type ResultadoCancelamento = { situacao: "cancelada" | "ja_cancelada" | "incerta"; notaId: number; mensagem: string };

type Autor = { usuarioId: number | null; via: ViaFiscal };
type Sessao = Awaited<ReturnType<typeof sessaoDoEmissor>>;
export type DepsEmissao = DepsSefin & {
  /** Só para teste: a constante do código (`EMISSAO_DISPONIVEL`) é a que vale em produção. */
  emissaoDisponivel?: boolean;
  agoraFn?: () => Date;
  fontesAliquota?: typeof FONTES_ALIQUOTA;
  /** Só para teste: pasta dos XSD. */
  pastaXsd?: URL;
};

const linhas = (r: unknown) => (r as { rows?: Record<string, unknown>[] }).rows ?? [];
const agoraDe = (d: DepsEmissao) => (d.agoraFn ? d.agoraFn() : new Date());
const AMBIENTES_EMISSAO = ["producao_restrita", "producao"] as const;
type AmbienteEmissao = (typeof AMBIENTES_EMISSAO)[number];
const ehAmbienteEmissao = (a: string | null | undefined): a is AmbienteEmissao => a === "producao_restrita" || a === "producao";

export const FRASE_EMISSOR_DESLIGADO = "A emissão desta empresa emissora não está liberada (ambiente desligado ou interruptor de emissão desligado). Nada foi enviado.";
export const FRASE_INCERTA = "A Sefin não respondeu a tempo (resultado incerto). A nota ficou \"Emitindo\": tente de novo em alguns minutos — antes de reenviar, o sistema consulta se ela já foi gerada, para nunca emitir duas vezes.";

/** Erros conhecidos viram frase para a tela; o resto sobe (a rota transforma em frase genérica, sem detalhe). */
export function fraseDeErroConhecido(e: unknown): string | null {
  if (e instanceof ErroEmissao || e instanceof ErroLeiaute || e instanceof ErroEvento || e instanceof ErroSefin || e instanceof ErroCertificado) return e.message;
  if (e instanceof ErroDps) return e.message;
  return null;
}

async function registrarEvento(db: DrizzleDb, e: { notaId: number; tipo: TipoEventoFiscal; situacao: SituacaoEventoFiscal; ambiente: AmbienteEmissao; httpStatus?: number | null; codigos?: string[]; protocolo?: string | null; xml?: string | null } & Autor) {
  await db.insert(fiscalEventos).values({
    notaId: e.notaId, tipo: e.tipo, situacao: e.situacao, ambiente: e.ambiente, httpStatus: e.httpStatus ?? null, codigos: e.codigos ?? [],
    protocolo: e.protocolo ?? null, xml: e.xml ?? null, usuarioId: e.usuarioId, via: e.via,
  });
}

/** Parâmetros do contador: os da empresa (emissor) + os do serviço (tipo). Nada é preenchido por padrão. */
export function parametrosDaNota(emissor: Pick<FiscalEmissor, "parametrosDps">, tipo: { parametrosDps: unknown } | null): ParametrosContador {
  const pe = (emissor.parametrosDps ?? {}) as Record<string, string | null | undefined>;
  const ps = (tipo?.parametrosDps ?? {}) as Record<string, unknown>;
  const ib = (ps.ibscbs ?? {}) as Record<string, string | null | undefined>;
  const v = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
  return {
    ...PARAMETROS_VAZIOS,
    opSimpNac: v(pe.opSimpNac), regApTribSN: v(pe.regApTribSN), regEspTrib: v(pe.regEspTrib),
    tribIssqn: v(ps.tribIssqn), tpRetIssqn: v(ps.tpRetIssqn), indTotTrib: v(ps.indTotTrib),
    ibscbs: { indFinal: v(ib.indFinal), cIndOp: v(ib.cIndOp), indDest: v(ib.indDest), cst: v(ib.cst), cClassTrib: v(ib.cClassTrib) },
  };
}

/** Emissor e a liberação (travas 1–3). Lança ErroEmissao sem tocar em nada. */
async function emissorLiberado(db: DrizzleDb, emissorId: number | null, d: DepsEmissao): Promise<FiscalEmissor & { ambiente: AmbienteEmissao }> {
  if (!(d.emissaoDisponivel ?? EMISSAO_DISPONIVEL)) throw new ErroEmissao(AVISO_EMISSAO_INDISPONIVEL);
  if (emissorId == null) throw new ErroEmissao("Escolha a empresa emissora do rascunho antes de emitir.");
  const [em] = await db.select().from(fiscalEmissores).where(eq(fiscalEmissores.id, emissorId)).limit(1);
  if (!em || !em.ativo) throw new ErroEmissao("Empresa emissora não encontrada ou inativa.");
  if (!ehAmbienteEmissao(em.ambiente) || !em.emissaoLiberada) throw new ErroEmissao(FRASE_EMISSOR_DESLIGADO);
  return em as FiscalEmissor & { ambiente: AmbienteEmissao };
}

/** Grava EMITIDA (só a partir de EMITINDO) e o evento com o XML autorizado. */
async function concluirEmitida(db: DrizzleDb, notaId: number, r: { chave: string; xml: string; nfse: NfseLida; protocolo: string | null }, ambiente: AmbienteEmissao, autor: Autor, httpStatus: number | null, tipo: TipoEventoFiscal, agora: Date): Promise<ResultadoEmissao> {
  await db.transaction(async tx => {
    const [salva] = await tx.update(fiscalNotas).set({
      status: "EMITIDA", chaveAcesso: r.chave, numeroNfse: r.nfse.numero.slice(0, 15), xmlNfse: r.xml, protocolo: r.protocolo,
      ibscbs: r.nfse.valores.vTotNF || r.nfse.valores.vIBS || r.nfse.valores.vCBS ? { vIBS: r.nfse.valores.vIBS, vCBS: r.nfse.valores.vCBS, vTotNF: r.nfse.valores.vTotNF, fonte: "nfse_autorizada" } : null,
      emitidaEm: agora, emitidaPor: autor.usuarioId, ultimoErro: null, emitindoDesde: null,
      versao: sql`${fiscalNotas.versao} + 1`, atualizadoPor: autor.usuarioId, alteradoVia: autor.via,
    }).where(and(eq(fiscalNotas.id, notaId), eq(fiscalNotas.status, "EMITINDO"))).returning({ id: fiscalNotas.id });
    if (!salva) throw new ErroEmissao("A nota mudou durante a emissão. Atualize a tela.", "conflito");
    await registrarEvento(tx as unknown as DrizzleDb, { notaId, tipo, situacao: "autorizada", ambiente, httpStatus, protocolo: r.protocolo, xml: r.xml, ...autor });
  });
  return { situacao: "emitida", notaId, chave: r.chave, numero: r.nfse.numero, mensagem: `NFS-e nº ${r.nfse.numero} emitida${ambiente === "producao_restrita" ? " no AMBIENTE DE TESTES (sem valor fiscal)" : ""}.` };
}

/** Consulta a DPS e, se a NFS-e existir, busca o XML e conclui. "nao_gerada" → pode (re)enviar; "incerta" → não mexe. */
async function consultarERecuperar(db: DrizzleDb, sessao: Sessao, nota: { id: number; dpsId: string }, ambiente: AmbienteEmissao, autor: Autor, agora: Date): Promise<ResultadoEmissao | "nao_gerada" | "incerta"> {
  let r;
  try { r = await sessao.cliente.requisitar("GET", caminhoDe("consultarDps", { id: nota.dpsId })); }
  catch { return "incerta"; }
  const c = lerConsultaDps(r.status, r.corpo);
  if (c.tipo === "nao_gerada") { await registrarEvento(db, { notaId: nota.id, tipo: "consulta_dps", situacao: "nao_encontrada", ambiente, httpStatus: r.status, ...autor }); return "nao_gerada"; }
  if (c.tipo === "incerta") return "incerta";
  let x;
  try { x = await sessao.cliente.requisitar("GET", caminhoDe("consultarNfse", { chave: c.chave })); }
  catch { return "incerta"; }
  const xml = lerConsultaNfse(x.status, x.corpo);
  if (!xml) return "incerta";
  const conferida = conferirNfse(xml, nota.dpsId, c.chave, null);
  if (conferida.tipo !== "autorizada") return "incerta";
  return concluirEmitida(db, nota.id, conferida, ambiente, autor, x.status, "consulta_dps", agora);
}

/** Envia a DPS assinada (já gravada) e trata o retorno. */
async function enviarDps(db: DrizzleDb, sessao: Sessao, nota: { id: number; dpsId: string; xmlAssinado: string }, ambiente: AmbienteEmissao, autor: Autor, agora: Date): Promise<ResultadoEmissao> {
  let resposta;
  try { resposta = await sessao.cliente.requisitar("POST", caminhoDe("emitir"), { [CAMPOS_JSON.dps]: compactarXml(nota.xmlAssinado) }); }
  catch {
    await registrarEvento(db, { notaId: nota.id, tipo: "emissao", situacao: "incerta", ambiente, ...autor });
    return { situacao: "incerta", notaId: nota.id, mensagem: FRASE_INCERTA };
  }
  const r = lerRetornoEmissao(resposta.status, resposta.corpo, nota.dpsId);
  if (r.tipo === "autorizada") return concluirEmitida(db, nota.id, r, ambiente, autor, resposta.status, "emissao", agora);
  if (r.tipo === "incerta") {
    await registrarEvento(db, { notaId: nota.id, tipo: "emissao", situacao: "incerta", ambiente, httpStatus: resposta.status, ...autor });
    const consulta = resposta.status >= 200 && resposta.status < 300 ? await consultarERecuperar(db, sessao, nota, ambiente, autor, agora) : "incerta";
    if (typeof consulta === "object") return consulta;
    return { situacao: "incerta", notaId: nota.id, mensagem: FRASE_INCERTA };
  }
  // Rejeitada: a DPS pode ter sido aceita numa tentativa anterior (duplicidade). Consultar antes de marcar ERRO.
  await registrarEvento(db, { notaId: nota.id, tipo: "emissao", situacao: "rejeitada", ambiente, httpStatus: resposta.status, codigos: r.codigos, ...autor });
  const consulta = await consultarERecuperar(db, sessao, nota, ambiente, autor, agora);
  if (typeof consulta === "object") return consulta;
  if (consulta === "incerta") return { situacao: "incerta", notaId: nota.id, mensagem: FRASE_INCERTA, codigos: r.codigos };
  const frase = fraseDosCodigos(r.codigos, "emissao");
  await db.update(fiscalNotas).set({
    status: "ERRO", ultimoErro: { codigos: r.codigos, frase, quando: agora.toISOString() }, emitindoDesde: null,
    versao: sql`${fiscalNotas.versao} + 1`, atualizadoPor: autor.usuarioId, alteradoVia: autor.via,
  }).where(and(eq(fiscalNotas.id, nota.id), eq(fiscalNotas.status, "EMITINDO")));
  return { situacao: "rejeitada", notaId: nota.id, mensagem: frase, codigos: r.codigos };
}

/**
 * Emite um rascunho (A_DECIDIR, ADIADA ou ERRO) ou retoma um EMITINDO. Devolve a situação; lança ErroEmissao/ErroDps/
 * ErroLeiaute/ErroCertificado quando nada foi enviado.
 */
export async function emitirNota(db: DrizzleDb, e: { id: number; versao: number } & Autor, d: DepsEmissao = {}): Promise<ResultadoEmissao> {
  const autor: Autor = { usuarioId: e.usuarioId, via: e.via };
  const [atual] = await db.select().from(fiscalNotas).where(eq(fiscalNotas.id, e.id)).limit(1);
  if (!atual) throw new ErroEmissao("Rascunho de nota não encontrado.");
  if (atual.status === "EMITIDA") return { situacao: "ja_emitida", notaId: atual.id, chave: atual.chaveAcesso ?? undefined, numero: atual.numeroNfse ?? undefined, mensagem: `Esta nota já foi emitida (NFS-e nº ${atual.numeroNfse}).` };
  if (!["A_DECIDIR", "ADIADA", "ERRO", "EMITINDO"].includes(atual.status)) throw new ErroEmissao(`Uma nota "${atual.status}" não pode ser emitida.`);
  const emissor = await emissorLiberado(db, atual.emissorId, d);
  const agora = agoraDe(d);

  if (atual.status === "EMITINDO") return retomar(db, atual, emissor, autor, d, agora);
  if (atual.versao !== e.versao) throw new ErroEmissao("Este rascunho foi alterado por outra pessoa. Atualize a tela e tente de novo.", "conflito");

  // Tudo o que pode recusar SEM rede e SEM gravar vem antes da reserva do número.
  const nota = await carregarNota(db, atual.id);
  const [tipo] = nota.tipoServicoId ? await db.select().from(fiscalTiposServico).where(eq(fiscalTiposServico.id, nota.tipoServicoId)).limit(1) : [];
  const parametros = parametrosDaNota(emissor, tipo ?? null);
  // Município de incidência: o IBGE gravado no rascunho ou, pelo nome (obra 7.02/7.05 → o da obra; tomador; emissor), o da
  // lista da operação (shared/fiscal/municipios.ts). Fora da lista e sem IBGE → a DPS recusa (nada é presumido).
  const ibgeIncidencia = nota.municipioIncidenciaIbge ?? (nota.municipio.fonte === "emissor" ? emissor.municipioIbge : ibgeDoMunicipio(nota.municipio.nome, nota.municipio.uf));
  const aliq = await resolverAliquotaIss(nota.emissor?.regime ?? null, {
    emissorCnpj: emissor.cnpj, competencia: nota.dataEvento, municipioIncidenciaIbge: ibgeIncidencia,
    municipal: await aliquotaMunicipalVigente(db, ibgeIncidencia, nota.tipoServico?.codigoTributacaoNacional ?? null),
    tipoServico: nota.tipoServico ? { id: nota.tipoServico.id, itemLc116: nota.tipoServico.itemLc116, codigoAtividadeSimples: nota.tipoServico.codigoAtividadeSimples, aliquotaIss: nota.tipoServico.aliquotaIss } : null,
  }, d.fontesAliquota ?? FONTES_ALIQUOTA);
  // Série: a do emissor; sem série cadastrada, a padrão do aplicativo próprio ("1" = 00001, faixa 1–49999, regra E0010),
  // gravada no emissor na reserva (abaixo) para todas as notas seguirem a mesma.
  const serie = emissor.serieDps ?? SERIE_PADRAO_API;
  const previa = entradaDaNota(nota, { ...emissor, serieDps: serie }, { numero: atual.numeroDps ?? 1, emitidoEm: agora, parametros });
  previa.ambiente = emissor.ambiente;
  previa.servico.municipioIncidenciaIbge = ibgeIncidencia;
  if (aliq.aliquota == null) throw new ErroDps([aliq.falta]);
  previa.aliquotaIss = aliq.aliquota;
  montarDps(previa); // recusa com a lista do que falta, antes de abrir o certificado
  const sessao = await sessaoDoEmissor(db, { id: emissor.id, ambiente: emissor.ambiente }, d);

  // Reserva (FOR UPDATE no emissor e na nota): número e Id da DPS fixos deste rascunho, para sempre.
  const reservada = await db.transaction(async tx => {
    const t = tx as unknown as DrizzleDb;
    const [em] = linhas(await t.execute(sql`SELECT proximo_numero_dps, ambiente, emissao_liberada, serie_dps FROM fiscal_emissores WHERE id = ${emissor.id} FOR UPDATE`));
    const [n] = linhas(await t.execute(sql`SELECT status, versao, numero_dps, dps_id, emitindo_desde FROM fiscal_notas WHERE id = ${atual.id} FOR UPDATE`));
    if (!em || !n) throw new ErroEmissao("Rascunho de nota não encontrado.");
    if (em.ambiente !== emissor.ambiente || em.emissao_liberada !== true) throw new ErroEmissao(FRASE_EMISSOR_DESLIGADO);
    if (em.serie_dps != null && em.serie_dps !== serie) throw new ErroEmissao("A série da DPS da empresa emissora mudou. Atualize a tela e tente de novo.", "conflito");
    if (em.serie_dps == null) await t.execute(sql`UPDATE fiscal_emissores SET serie_dps = ${serie} WHERE id = ${emissor.id} AND serie_dps IS NULL`);
    if (n.status === "EMITINDO") throw new ErroEmissao("Esta nota já está sendo emitida. Aguarde um instante e atualize a tela.", "trava");
    if (Number(n.versao) !== e.versao || !["A_DECIDIR", "ADIADA", "ERRO"].includes(String(n.status))) throw new ErroEmissao("Este rascunho foi alterado por outra pessoa. Atualize a tela e tente de novo.", "conflito");
    let numero = n.numero_dps == null ? null : Number(n.numero_dps);
    if (numero == null) {
      numero = Number(em.proximo_numero_dps);
      await t.execute(sql`UPDATE fiscal_emissores SET proximo_numero_dps = proximo_numero_dps + 1 WHERE id = ${emissor.id}`);
    }
    const entrada = { ...previa, numero };
    const { id, xml } = montarDps(entrada);
    if (n.dps_id != null && n.dps_id !== id) throw new ErroEmissao("O identificador da DPS deste rascunho não confere. Nada foi enviado.");
    const assinado = sessao.assinar(xml, "infDPS");
    await exigirLeiaute(assinado, "dps", emissor.ambiente, { pastaBase: d.pastaXsd });
    const congelado = { tomador: { nome: nota.tomador.nome, documento: nota.tomador.documento }, valorCentavos: nota.valorCentavos, descricao: nota.descricao,
      emissor: { cnpj: emissor.cnpj, razaoSocial: nota.emissor?.razaoSocial ?? null, regime: nota.emissor?.regime ?? null }, aliquotaIss: aliq.aliquota, ambiente: emissor.ambiente };
    await t.update(fiscalNotas).set({
      status: "EMITINDO", dpsId: id, numeroDps: numero, xmlDps: assinado, ambienteEmissao: emissor.ambiente, emitindoDesde: agora, congelado,
      versao: sql`${fiscalNotas.versao} + 1`, atualizadoPor: autor.usuarioId, alteradoVia: autor.via,
    }).where(eq(fiscalNotas.id, atual.id));
    return { id: atual.id, dpsId: id, xmlAssinado: assinado };
  });
  return enviarDps(db, sessao, reservada, emissor.ambiente, autor, agora);
}

/** EMITINDO: com trava recente, recusa; senão consulta a DPS e só reenvia (o MESMO XML assinado) se ela não gerou nota. */
async function retomar(db: DrizzleDb, atual: typeof fiscalNotas.$inferSelect, emissor: FiscalEmissor & { ambiente: AmbienteEmissao }, autor: Autor, d: DepsEmissao, agora: Date): Promise<ResultadoEmissao> {
  const ambiente = ehAmbienteEmissao(atual.ambienteEmissao) ? atual.ambienteEmissao : emissor.ambiente;
  if (atual.emitindoDesde && agora.getTime() - new Date(atual.emitindoDesde).getTime() < TRAVA_EMITINDO_MS) {
    throw new ErroEmissao("Esta nota está sendo emitida agora. Aguarde um instante e atualize a tela.", "trava");
  }
  if (!atual.dpsId || !atual.xmlDps) throw new ErroEmissao("A emissão em andamento não tem a DPS guardada. Nada foi enviado.");
  // Reivindica a retomada (só um processo por vez): troca emitindo_desde pelo valor lido.
  const [dono] = await db.update(fiscalNotas).set({ emitindoDesde: agora })
    .where(and(eq(fiscalNotas.id, atual.id), eq(fiscalNotas.status, "EMITINDO"), atual.emitindoDesde ? eq(fiscalNotas.emitindoDesde, atual.emitindoDesde) : sql`emitindo_desde IS NULL`))
    .returning({ id: fiscalNotas.id });
  if (!dono) throw new ErroEmissao("Esta nota está sendo emitida agora. Aguarde um instante e atualize a tela.", "trava");
  const sessao = await sessaoDoEmissor(db, { id: emissor.id, ambiente }, d);
  const nota = { id: atual.id, dpsId: atual.dpsId, xmlAssinado: atual.xmlDps };
  const consulta = await consultarERecuperar(db, sessao, nota, ambiente, autor, agora);
  if (typeof consulta === "object") return consulta;
  if (consulta === "incerta") return { situacao: "incerta", notaId: atual.id, mensagem: FRASE_INCERTA };
  await exigirLeiaute(nota.xmlAssinado, "dps", ambiente, { pastaBase: d.pastaXsd });
  return enviarDps(db, sessao, nota, ambiente, autor, agora);
}

/**
 * Cancelamento (e101101). Só nota EMITIDA; motivo 1/2/9 e justificativa 15–255; prazo local de 730 dias (o município pode
 * ter prazo menor: a recusa E0822 volta em frase própria). Vai ao MESMO ambiente em que a nota foi emitida.
 * Trava: só `EMISSAO_DISPONIVEL` (o interruptor por emissor desliga emissões NOVAS; cancelar o que já saiu continua possível).
 */
export async function cancelarNota(db: DrizzleDb, e: { id: number; versao: number; motivo: number; justificativa: string } & Autor, d: DepsEmissao = {}): Promise<ResultadoCancelamento> {
  const autor: Autor = { usuarioId: e.usuarioId, via: e.via };
  if (!(d.emissaoDisponivel ?? EMISSAO_DISPONIVEL)) throw new ErroEmissao(AVISO_EMISSAO_INDISPONIVEL);
  const [n] = await db.select().from(fiscalNotas).where(eq(fiscalNotas.id, e.id)).limit(1);
  if (!n) throw new ErroEmissao("Nota não encontrada.");
  if (n.status === "CANCELADA") return { situacao: "ja_cancelada", notaId: n.id, mensagem: "Esta nota já está cancelada." };
  if (n.status !== "EMITIDA" || !n.chaveAcesso || !n.emitidaEm || !ehAmbienteEmissao(n.ambienteEmissao) || n.emissorId == null) throw new ErroEmissao("Só uma nota emitida pode ser cancelada.");
  if (n.versao !== e.versao) throw new ErroEmissao("Esta nota foi alterada por outra pessoa. Atualize a tela e tente de novo.", "conflito");
  if (!(e.motivo in MOTIVOS_CANCELAMENTO)) throw new ErroEmissao("Escolha o motivo do cancelamento: erro na emissão, serviço não prestado ou outros.");
  const problema = problemaDaJustificativa(e.justificativa);
  if (problema) throw new ErroEmissao(problema);
  const agora = agoraDe(d);
  if (!dentroDoPrazo(new Date(n.emitidaEm), agora)) throw new ErroEmissao(`A nota foi emitida há mais de ${PRAZO_MAXIMO_CANCELAMENTO_DIAS} dias (2 anos): o cancelamento só pela análise fiscal da prefeitura.`);
  const [em] = await db.select().from(fiscalEmissores).where(eq(fiscalEmissores.id, n.emissorId)).limit(1);
  if (!em) throw new ErroEmissao("Empresa emissora não encontrada.");
  const ambiente = n.ambienteEmissao;
  const { xml } = montarPedidoCancelamento({ chave: n.chaveAcesso, cnpjAutor: em.cnpj, ambiente, motivo: e.motivo, justificativa: e.justificativa, quando: agora });
  const sessao = await sessaoDoEmissor(db, { id: em.id, ambiente }, d);
  const assinado = sessao.assinar(xml, "infPedReg");
  await exigirLeiaute(assinado, "pedRegEvento", ambiente, { pastaBase: d.pastaXsd });

  const concluir = async (xmlEvento: string, protocolo: string | null, httpStatus: number) => {
    await db.transaction(async tx => {
      const [salva] = await tx.update(fiscalNotas).set({
        status: "CANCELADA", canceladaEm: agora, canceladaPor: autor.usuarioId, cancelamentoMotivo: e.motivo,
        cancelamentoJustificativa: limparJustificativa(e.justificativa), versao: sql`${fiscalNotas.versao} + 1`, atualizadoPor: autor.usuarioId, alteradoVia: autor.via,
      }).where(and(eq(fiscalNotas.id, n.id), eq(fiscalNotas.status, "EMITIDA"))).returning({ id: fiscalNotas.id });
      if (!salva) throw new ErroEmissao("A nota mudou durante o cancelamento. Atualize a tela.", "conflito");
      await registrarEvento(tx as unknown as DrizzleDb, { notaId: n.id, tipo: "cancelamento", situacao: "autorizada", ambiente, httpStatus, protocolo, xml: xmlEvento, ...autor });
    });
    return { situacao: "cancelada" as const, notaId: n.id, mensagem: `NFS-e nº ${n.numeroNfse} cancelada.` };
  };
  /** O evento já existe na Sefin (tentativa anterior)? Então só falta gravar aqui. */
  const eventoJaRegistrado = async () => {
    try {
      const c = await sessao.cliente.requisitar("GET", caminhoDe("consultarEvento", { chave: n.chaveAcesso!, tipo: "101101", seq: "1" }));
      const r = lerRetornoEvento(c.status, c.corpo, n.chaveAcesso!);
      return r.tipo === "registrado" ? { ...r, status: c.status } : null;
    } catch { return null; }
  };

  let resposta;
  try { resposta = await sessao.cliente.requisitar("POST", caminhoDe("eventos", { chave: n.chaveAcesso }), { [CAMPOS_JSON.pedidoEvento]: compactarXml(assinado) }); }
  catch {
    await registrarEvento(db, { notaId: n.id, tipo: "cancelamento", situacao: "incerta", ambiente, ...autor });
    return { situacao: "incerta", notaId: n.id, mensagem: "A Sefin não respondeu a tempo (resultado incerto). A nota continua \"Emitida\" aqui: tente cancelar de novo — o sistema confere antes se o cancelamento já foi registrado." };
  }
  const r = lerRetornoEvento(resposta.status, resposta.corpo, n.chaveAcesso);
  if (r.tipo === "registrado") return concluir(r.xml, r.protocolo, resposta.status);
  const ja = await eventoJaRegistrado();
  if (ja) return concluir(ja.xml, ja.protocolo, ja.status);
  if (r.tipo === "incerto") {
    await registrarEvento(db, { notaId: n.id, tipo: "cancelamento", situacao: "incerta", ambiente, httpStatus: resposta.status, ...autor });
    return { situacao: "incerta", notaId: n.id, mensagem: "A resposta da Sefin ao cancelamento não pôde ser conferida. A nota continua \"Emitida\" aqui: tente de novo em alguns minutos." };
  }
  await registrarEvento(db, { notaId: n.id, tipo: "cancelamento", situacao: "rejeitada", ambiente, httpStatus: resposta.status, codigos: r.codigos, ...autor });
  throw new ErroEmissao(fraseDosCodigos(r.codigos, "cancelamento"), "rejeitada");
}

/** Leitura para a tela: os eventos da nota, sem o XML (o XML sai só pelo download da própria nota). */
export async function eventosDaNota(db: DrizzleDb, notaId: number) {
  return db.select({ id: fiscalEventos.id, tipo: fiscalEventos.tipo, situacao: fiscalEventos.situacao, ambiente: fiscalEventos.ambiente,
    httpStatus: fiscalEventos.httpStatus, codigos: fiscalEventos.codigos, protocolo: fiscalEventos.protocolo, via: fiscalEventos.via, criadoEm: fiscalEventos.criadoEm })
    .from(fiscalEventos).where(eq(fiscalEventos.notaId, notaId)).orderBy(fiscalEventos.id);
}

/** Usado pela tela/teste: o Id da DPS que o rascunho teria (determinístico pelo emissor, série e número). */
export const idDpsDoRascunho = (emissor: Pick<FiscalEmissor, "municipioIbge" | "cnpj" | "serieDps">, numero: number) => idDps(emissor.municipioIbge ?? "", emissor.cnpj, emissor.serieDps ?? "", numero);
