// EPIC-029 S-5 (22/11/2026) — captura das NFS-e RECEBIDAS pela distribuição do ADN (por NSU) para "obra_notas" (origem 'adn').
//
// PREPARADA E DESLIGADA. Esta etapa NÃO conecta em lugar nenhum:
// - o cliente mTLS do ADN (certificado A1 do emissor, `GET {adn}/contribuintes/DFe/{NSU}` [NÃO CONFIRMADO]) vem da S-4 e é
//   INJETADO por `registrarClienteDistribuicao`. Sem cliente registrado, a rotina volta na hora sem tocar no banco nem na rede;
// - mesmo com cliente, só consulta o CNPJ que tiver linha em "fiscal_distribuicao_estado" com `ligada = true` (desligada por
//   padrão; nenhuma linha nasce sozinha).
// Garantias:
// - IDEMPOTENTE por chave: a mesma NFS-e (chave de 50) entra uma vez só (índice único da 0163 + conferência na transação);
//   rodar de novo, ou reler NSUs já lidos, não cria nada;
// - o último NSU lido fica gravado por CNPJ e nunca volta para trás (gatilho da 0163);
// - com prazo: roda dentro de um cron que JÁ existe (`/api/cron/lead-card-due`), nunca passa do tempo dado;
// - nenhuma nota recebida vira ação: grava só o rascunho interno (como as notas de grupo); a conciliação com o BPO só APONTA
//   (`server/dolores/leitura/notas.ts`) e a divergência chega ao dono pelo aviso `nota_obra` que já existe;
// - nada de dado pessoal em log (só nomes de erro e contagens).
// S-5b (revisão independente do #315):
// - EVENTO do ADN (raiz que não é NFS-e) não é mais ignorado: o cancelamento (101101, 105102, 105104, 305101) é lido com as
//   mesmas proteções, guardado em "obra_notas_eventos_adn" e marca a nota (e a mesma nota da outra origem) como CANCELADA — se
//   a nota ainda não chegou, ela já nasce cancelada; evento de outro tipo, ou raiz desconhecida, fica "a conferir" (NSU guardado);
// - a NFS-e igual a uma nota de GRUPO (mesmo emitente + número) é a "mesma nota por outra origem", não duplicada;
// - exceção ao gravar um documento não trava o CNPJ: o NSU é registrado e, na 3ª tentativa, vai para os ilegíveis;
// - GZip quebrado/acima do teto é ilegível (não "sem XML").
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { and, asc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { constructionProjects, users } from "../../drizzle/schema.js";
import { obraNotas, obraNotasAdn, obraNotasEventosAdn } from "../../drizzle/schema-dolores-notas.js";
import { fiscalDistribuicaoEstado, fiscalNotas } from "../../drizzle/schema-fiscal.js";
import { numeroComparavel } from "../../shared/dolores/notas.js";
import {
  EVENTOS_DE_CANCELAMENTO, MAX_CARACTERES_XML, divergenciasEntreOrigens, ehCancelamento, eventoDeNotaEmitida, lerEventoNfse, lerNfseRecebida, mapearNotaRecebida, vincularPorDocumento,
} from "./nfse-recebida.js";
import type { DrizzleDb } from "../db.js";

/** Mesmo status de obra encerrada da leitura de obras da Dolores (`server/dolores/leitura/obras.ts`). */
const STATUS_OBRA_ENCERRADA = ["completed", "cancelled", "distrato"] as const;

/** Mesma trava da gravação das notas de grupo (`server/dolores/notas-obra.ts`): uma gravação de nota por vez. */
const TRAVA_NOTAS = 250005;

// ── Interface do cliente (implementado na S-4, com mTLS e o certificado do emissor) ──

export type DocumentoDistribuido = {
  nsu: number;
  /** Chave informada pelo ADN junto do documento (conferida com a do XML quando vier). */
  chave?: string | null;
  /**
   * XML já descompactado (ver `xmlDoArquivoAdn`): a NFS-e ou um EVENTO dela (cancelamento etc.). null = o ADN não mandou XML.
   * S-5b: arquivo que veio mas não deu para abrir (GZip quebrado, acima do teto) = `ArquivoIlegivel` — vai para os ilegíveis.
   */
  xml: string | null | ArquivoIlegivel;
};
export type ArquivoIlegivel = { ilegivel: "gzip_invalido" | "grande_demais" };
export type PaginaDistribuicao = { documentos: DocumentoDistribuido[] };
export interface ClienteDistribuicaoAdn {
  /** Documentos com NSU MAIOR que `ultimoNsu` para o CNPJ (até ~50 por chamada [NÃO CONFIRMADO]). */
  buscarDesde(p: { cnpj: string; ultimoNsu: number; sinal: AbortSignal }): Promise<PaginaDistribuicao>;
}

let clienteRegistrado: ClienteDistribuicaoAdn | null = null;
/** Ponto de injeção da S-4 (cliente mTLS real). Até lá, ninguém chama: a captura fica desligada. */
export function registrarClienteDistribuicao(cliente: ClienteDistribuicaoAdn | null) { clienteRegistrado = cliente; }
export const clienteDistribuicaoAtual = () => clienteRegistrado;

/**
 * Nomes de campos e parâmetros JSON do ADN que só aparecem em fontes de TERCEIROS (PESQUISA.md §1.2/§1.3: nfelib e outros
 * dois projetos) — isolados aqui para a S-4 conferir no Swagger oficial e trocar num lugar só.
 */
export const NOMES_ADN_TERCEIROS = {
  /** Parâmetro para consultar um CNPJ diferente do CNPJ do certificado (mesma raiz). */
  cnpjConsulta: "cnpjConsulta",
  /** Parâmetro para pedir o lote (`lote=true`). */
  lote: "lote",
  /** XML da NFS-e (GZip + Base64) dentro do JSON. */
  nfseXml: "nfseXmlGZipB64",
  /** XML de evento (GZip + Base64) dentro do JSON. */
  eventoXml: "eventoXmlGZipB64",
} as const;

/** Base da API de contribuintes do ADN (oficial, MAN-ADN §1.1.1): `GET /DFe/{NSU}` e `GET /NFSe/{chave}/Eventos`. */
export const BASE_ADN_CONTRIBUINTES = {
  producao: "https://adn.nfse.gov.br/contribuintes",
  producao_restrita: "https://adn.producaorestrita.nfse.gov.br/contribuintes",
} as const;

/** O ADN pede no mínimo 1 hora de espera depois de uma consulta sem documento novo (FAQ 19.2; PESQUISA.md §1.3). */
export const ESPERA_DEPOIS_DE_CONSULTA_VAZIA_MS = 60 * 60_000;

/** Até 50 documentos por chamada (confirmado, MANINT §17.2.2). */
export const DOCUMENTOS_POR_CHAMADA = 50;

/**
 * O ADN entrega o XML compactado em GZip e codificado em Base64 (oficial, MANINT §6.1.1-c). Para o cliente da S-4; com limite.
 * S-5b: falha NÃO vira null (null é "sem XML"): volta `ArquivoIlegivel`, para o NSU entrar na lista de ilegíveis do dono.
 */
export function xmlDoArquivoAdn(base64Gzip: string): string | ArquivoIlegivel {
  try {
    return gunzipSync(Buffer.from(base64Gzip, "base64"), { maxOutputLength: MAX_CARACTERES_XML * 4 }).toString("utf8");
  } catch (e) {
    return { ilegivel: (e as { code?: string } | null)?.code === "ERR_BUFFER_TOO_LARGE" ? "grande_demais" : "gzip_invalido" };
  }
}

// ── Gravação de UM documento ──

/**
 * S-5b: "cancelamento" = evento de cancelamento lido e guardado (casado com a nota, se ela já existe); "a_conferir" = documento
 * que não é NFS-e nem evento conhecido, ou evento de tipo que o sistema não sabe tratar — o NSU fica para o dono conferir.
 */
export type ResultadoDocumento = "gravada" | "ja_existia" | "ignorada" | "ilegivel" | "cancelamento" | "a_conferir";

type Tx = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];
const chaveDoAdn = (c: string) => c.toUpperCase().replace(/[^0-9A-Z]/g, "");

/**
 * S-5b: marca como CANCELADA a nota e a(s) mesma(s) nota(s) da outra origem ligadas a ela (o vínculo com o BPO, se houver, NÃO é
 * desfeito: o dono recebe o aviso e decide). Só preenche o que está vazio (o gatilho da 0166 impede trocar depois).
 */
async function cancelarNota(tx: Tx, nota: { id: number; outraOrigemDe: number | null }, em: Date, tipo: string) {
  await tx.update(obraNotas).set({ canceladaEm: em, cancelamentoTipo: tipo })
    .where(and(isNull(obraNotas.canceladaEm), or(eq(obraNotas.id, nota.id), eq(obraNotas.outraOrigemDe, nota.id),
      nota.outraOrigemDe ? eq(obraNotas.id, nota.outraOrigemDe) : undefined)));
}

/** S-5b: evento da NFS-e (cancelamento). Mesmas proteções do leitor da nota; só o cancelamento é gravado. */
async function gravarEvento(db: DrizzleDb, doc: DocumentoDistribuido, xml: string, p: { tomadorCnpj: string; agora: Date }): Promise<ResultadoDocumento> {
  const lido = lerEventoNfse(xml);
  if (!lido.ok) return lido.motivo === "nao_e_evento" ? "a_conferir" : "ilegivel";
  const ev = lido.evento;
  if (doc.chave && chaveDoAdn(doc.chave) !== ev.chave) return "ilegivel";
  if (ev.ambiente === "producao_restrita") return "ignorada";
  if (ev.ambiente === null) return "ilegivel";
  // evento que não cancela (pedido de análise, indeferido, outro): não é descartado em silêncio — o dono confere o NSU
  if (!ehCancelamento(ev.tipo)) return "a_conferir";
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${TRAVA_NOTAS})`);
    const [nota] = await tx.select({ id: obraNotas.id, outraOrigemDe: obraNotas.outraOrigemDe }).from(obraNotas).where(eq(obraNotas.chaveNfse, ev.chave)).limit(1);
    // revisão do Codex (#318): cancelamento de nota que a PRÓPRIA empresa emitiu (autor/inscrição da chave = CNPJ consultado, ou a
    // chave já está nas notas emitidas) fica guardado como "emitida" — nunca vira "nota recebida faltando"; a S-7 casa com fiscal_notas
    const [emitidaAqui] = nota ? [] : await tx.select({ id: fiscalNotas.id }).from(fiscalNotas).where(eq(fiscalNotas.chaveAcesso, ev.chave)).limit(1);
    const papel = !nota && (emitidaAqui || eventoDeNotaEmitida(ev, p.tomadorCnpj)) ? "emitida" as const : "recebida" as const;
    const [novo] = await tx.insert(obraNotasEventosAdn).values({
      chaveNfse: ev.chave, tipoEvento: ev.tipo, nsu: doc.nsu, tomadorCnpj: p.tomadorCnpj, xml, recebidoEm: p.agora, papel,
      xmlSha256: createHash("sha256").update(xml, "utf8").digest("hex"),
    }).onConflictDoNothing().returning({ id: obraNotasEventosAdn.id });
    if (!novo) return "ja_existia";
    // a nota ainda não chegou: o evento fica guardado e é casado quando ela chegar (gravarNotaRecebida)
    if (!nota) return "cancelamento";
    await cancelarNota(tx, nota, p.agora, ev.tipo);
    await tx.update(obraNotasEventosAdn).set({ notaId: nota.id, casadoEm: p.agora }).where(eq(obraNotasEventosAdn.id, novo.id));
    return "cancelamento";
  });
}

/** Grava uma NFS-e recebida (se for de fato recebida por `tomadorCnpj` e ainda não existir). Uma transação, travada. */
export async function gravarNotaRecebida(db: DrizzleDb, doc: DocumentoDistribuido, p: { tomadorCnpj: string; agora: Date }): Promise<ResultadoDocumento> {
  if (doc.xml === null || doc.xml === undefined) return "ignorada";
  // S-5b: arquivo que veio e não abriu (GZip quebrado ou acima do teto) não é "sem XML"
  if (typeof doc.xml !== "string") return "ilegivel";
  const xml = doc.xml;
  const lida = lerNfseRecebida(xml);
  // S-5b: raiz que não é NFS-e (evento, por exemplo) não é mais ignorada: vai ao leitor de eventos
  if (!lida.ok) return lida.motivo === "nao_e_nfse" ? gravarEvento(db, doc, xml, p) : "ilegivel";
  const nota = lida.nota;
  if (doc.chave && chaveDoAdn(doc.chave) !== nota.chave) return "ilegivel";
  // a distribuição também traz as notas que a própria empresa emitiu e as de teste: essas não entram (sem tocar no banco)
  const previa = mapearNotaRecebida(nota, { tomadorCnpj: p.tomadorCnpj, nsu: doc.nsu, agora: p.agora, vinculo: { obraId: null, empreiteiroUserId: null, duvida: null } });
  // sem ambiente no XML (QA S-5 B2) não é gravada, mas fica como ilegível para o dono conferir o NSU
  if (!previa.gravar) return previa.motivo === "ambiente_desconhecido" ? "ilegivel" : "ignorada";
  const documento = previa.documentoEmitente;
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${TRAVA_NOTAS})`);
    const [existe] = await tx.select({ id: obraNotas.id }).from(obraNotas).where(eq(obraNotas.chaveNfse, nota.chave)).limit(1);
    if (existe) return "ja_existia";
    // vínculo POR CÓDIGO: empreiteiro cadastrado (ativo, papel empreiteiro) com o MESMO documento, em obra não encerrada
    const candidatos = documento ? await tx.select({ obraId: constructionProjects.id, empreiteiroUserId: users.id })
      .from(constructionProjects).innerJoin(users, eq(users.id, constructionProjects.contractorUserId))
      .where(and(eq(users.active, true), eq(users.role, "empreiteiro"), notInArray(constructionProjects.status, [...STATUS_OBRA_ENCERRADA]),
        sql`regexp_replace(upper(coalesce(${users.cpf}, '')), '[^0-9A-Z]', '', 'g') = ${documento}`))
      .orderBy(asc(constructionProjects.id)).limit(20) : [];
    // QA S-5 (B3): quantos empreiteiros ativos têm esse documento, com ou sem obra ativa (dois → nenhum vínculo)
    const [{ usuarios }] = documento ? await tx.select({ usuarios: sql<number>`count(*)`.mapWith(Number) }).from(users)
      .where(and(eq(users.active, true), eq(users.role, "empreiteiro"),
        sql`regexp_replace(upper(coalesce(${users.cpf}, '')), '[^0-9A-Z]', '', 'g') = ${documento}`)) : [{ usuarios: 0 }];
    // duplicidade: mesma regra das notas de grupo (mesmo emitente + mesmo número), a nota MAIS ANTIGA. S-5b: só é DUPLICADA
    // dentro da MESMA origem (outra NFS-e do ADN); a nota de GRUPO igual é a "mesma nota por outra origem" (não trava o arquivo)
    const numero = numeroComparavel(nota.numero);
    const colunaDoc = documento && /[A-Z]/.test(documento) ? obraNotas.emitenteCnpjAlfa : obraNotas.emitenteDocumento;
    const anteriorDa = (origem: "adn" | "grupo") => documento && numero ? tx.select({ id: obraNotas.id, valorCentavos: obraNotas.valorCentavos,
      dataEmissao: obraNotas.dataEmissao, bpoLancamentoId: obraNotas.bpoLancamentoId }).from(obraNotas).where(and(eq(colunaDoc, documento), eq(obraNotas.origem, origem),
        sql`regexp_replace(regexp_replace(coalesce(${obraNotas.numero}, ''), '[^0-9]', '', 'g'), '^0+([0-9])', '\\1') = ${numero}`))
      .orderBy(asc(obraNotas.id)).limit(1) : Promise.resolve([]);
    const [anterior] = await anteriorDa("adn");
    const [doGrupo] = anterior ? [] : await anteriorDa("grupo");
    // QA S-5b (médio): a do grupo diverge da oficial (valor/data)? Sem divergência, segue como antes (esta é a "outra origem" e a
    // conciliação fica na do grupo). Com divergência, a conciliação passa para ESTA, a oficial — salvo se a do grupo já foi
    // ligada a um pagamento (aí esta fica como "outra origem", em "confira", e o dono confere o pagamento).
    const divergencias = doGrupo ? divergenciasEntreOrigens({ valorCentavos: nota.valorServicoCentavos, dataEmissao: nota.dataEmissao }, doGrupo) : [];
    const passaParaOficial = !!doGrupo && divergencias.length > 0 && doGrupo.bpoLancamentoId === null;
    // S-5b: os cancelamentos que chegaram ANTES da nota (eventos guardados) já valem na gravação — QA S-5b: TODOS são casados
    const pendentes = await tx.select({ id: obraNotasEventosAdn.id, tipo: obraNotasEventosAdn.tipoEvento }).from(obraNotasEventosAdn)
      .where(and(eq(obraNotasEventosAdn.chaveNfse, nota.chave), isNull(obraNotasEventosAdn.notaId), eq(obraNotasEventosAdn.papel, "recebida"), inArray(obraNotasEventosAdn.tipoEvento, [...EVENTOS_DE_CANCELAMENTO])))
      .orderBy(asc(obraNotasEventosAdn.id));
    const pendente = pendentes[0];
    const mapa = mapearNotaRecebida(nota, {
      tomadorCnpj: p.tomadorCnpj, nsu: doc.nsu, agora: p.agora, vinculo: vincularPorDocumento(candidatos, usuarios),
      duplicadaDe: anterior ? { id: anterior.id, motivo: `mesmo número e mesmo emitente da nota ${anterior.id}` } : null,
      outraOrigemDe: doGrupo && !passaParaOficial ? { id: doGrupo.id, motivo: `mesmo número e mesmo emitente da nota ${doGrupo.id}, lida no grupo` } : null,
      divergenciaComGrupo: doGrupo && divergencias.length ? { notaId: doGrupo.id, divergencias, conciliadaNoGrupo: !passaParaOficial } : null,
      cancelamento: pendente ? { em: p.agora, tipo: pendente.tipo } : null,
    });
    if (!mapa.gravar) return "ignorada";
    const [linha] = await tx.insert(obraNotas).values(mapa.linha).onConflictDoNothing().returning({ id: obraNotas.id });
    if (!linha) return "ja_existia";
    await tx.insert(obraNotasAdn).values({
      notaId: linha.id, tomadorCnpj: p.tomadorCnpj, xml, xmlSha256: createHash("sha256").update(xml, "utf8").digest("hex"), capturadaEm: p.agora,
    });
    // QA S-5b: a nota do grupo (ainda não conciliada) passa a ser a "outra origem" desta; ela continua com o arquivo para o Drive
    // (o gatilho da 0166 só deixa preencher isso uma vez, de nota de grupo para a NFS-e oficial do ADN)
    if (passaParaOficial) {
      await tx.update(obraNotas).set({ outraOrigemDe: linha.id })
        .where(and(eq(obraNotas.id, doGrupo!.id), isNull(obraNotas.outraOrigemDe), isNull(obraNotas.bpoLancamentoId)));
    }
    if (pendente) {
      await tx.update(obraNotasEventosAdn).set({ notaId: linha.id, casadoEm: p.agora }).where(inArray(obraNotasEventosAdn.id, pendentes.map(e => e.id)));
      // a nota de grupo igual (a que é conciliada) também fica cancelada
      await cancelarNota(tx, { id: linha.id, outraOrigemDe: mapa.linha.outraOrigemDe }, p.agora, pendente.tipo);
    }
    return "gravada";
  });
}

// ── Rotina (por NSU, com prazo) ──

export type ResultadoCaptura =
  | { executou: false; motivo: "sem_cliente" | "nenhum_cnpj_ligado" }
  | { executou: true; cnpjs: number; aguardando: number; gravadas: number; jaExistiam: number; ignoradas: number; ilegiveis: number; erros: number; parcial: boolean;
      /** QA S-5 (M4): NSUs dos documentos que não deram para ler (até 20), para o dono conferir. */
      nsusIlegiveis: number[];
      /** S-5b: eventos de cancelamento guardados (casados com a nota ou à espera dela). */
      cancelamentos: number;
      /** S-5b: documentos que não são NFS-e nem evento conhecido (o dono confere o NSU). */
      aConferir: number; nsusAConferir: number[] };

/** Quantos NSUs ilegíveis ficam guardados por CNPJ (os mais recentes). */
export const MAX_NSUS_ILEGIVEIS = 20;
/** S-5b: o mesmo documento que dá exceção ao gravar é tentado até 3 vezes (uma por rodada); na 3ª, vira ilegível e a captura segue. */
export const MAX_TENTATIVAS_POR_NSU = 3;

/** Junta NSUs novos a uma lista jsonb, ficando só os MAX_NSUS_ILEGIVEIS mais recentes, em ordem crescente. */
const juntarNsus = (coluna: typeof fiscalDistribuicaoEstado.nsusIlegiveis | typeof fiscalDistribuicaoEstado.nsusAConferir, nsus: number[]) =>
  sql`(SELECT coalesce(jsonb_agg(x ORDER BY (x)::bigint), '[]'::jsonb) FROM (SELECT x FROM jsonb_array_elements(${coluna} || ${JSON.stringify(nsus)}::jsonb) AS t(x) ORDER BY (x)::bigint DESC LIMIT ${MAX_NSUS_ILEGIVEIS}) AS u)`;

/** QA S-5 (M2): a chamada ao cliente nunca passa do prazo, mesmo que ele ignore o AbortSignal. */
class PrazoEsgotado extends Error { name = "PrazoEsgotado"; }
function comPrazo<T>(promessa: Promise<T>, ms: number, aoEsgotar: () => void): Promise<T> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, rejeitar) => { relogio = setTimeout(() => { aoEsgotar(); rejeitar(new PrazoEsgotado()); }, Math.max(0, ms)); });
  promessa.catch(() => undefined); // a resposta que chegar depois do prazo é descartada (sem rejeição solta)
  return Promise.race([promessa, limite]).finally(() => clearTimeout(relogio));
}

const PRAZO_POR_CHAMADA_MS = 20_000;
const FOLGA_MS = 2_000;

export async function capturarNotasRecebidas(db: () => DrizzleDb, opcoes: {
  cliente: ClienteDistribuicaoAdn | null; prazoEm: number; agora?: Date; maxPaginas?: number;
}): Promise<ResultadoCaptura> {
  // sem cliente (até a S-4), nada: nem banco, nem rede
  if (!opcoes.cliente) return { executou: false, motivo: "sem_cliente" };
  const conexao = db();
  const estados = await conexao.select().from(fiscalDistribuicaoEstado).where(eq(fiscalDistribuicaoEstado.ligada, true)).orderBy(asc(fiscalDistribuicaoEstado.cnpj));
  if (!estados.length) return { executou: false, motivo: "nenhum_cnpj_ligado" };
  const r = { executou: true as const, cnpjs: estados.length, aguardando: 0, gravadas: 0, jaExistiam: 0, ignoradas: 0, ilegiveis: 0, erros: 0, parcial: false,
    nsusIlegiveis: [] as number[], cancelamentos: 0, aConferir: 0, nsusAConferir: [] as number[] };
  const maxPaginas = opcoes.maxPaginas ?? 10;
  const agora = opcoes.agora ?? new Date();
  const resta = () => opcoes.prazoEm - Date.now() - FOLGA_MS;
  for (const estado of estados) {
    // regra do ADN: depois de uma consulta sem documento novo, no mínimo 1 hora até a próxima (nada é chamado antes disso)
    if (estado.ultimaConsultaVaziaEm && agora.getTime() - estado.ultimaConsultaVaziaEm.getTime() < ESPERA_DEPOIS_DE_CONSULTA_VAZIA_MS) {
      r.aguardando++;
      continue;
    }
    if (resta() <= 0) { r.parcial = true; break; }
    let vaziaEm: Date | null = null;
    let ultimo = estado.ultimoNsu;
    let gravadasAqui = 0;
    const ilegiveisAqui: number[] = [];
    const aConferirAqui: number[] = [];
    // S-5b: NSU que deu exceção ao gravar em rodada anterior (e quantas vezes)
    let falha: { nsu: number | null; tentativas: number } = { nsu: estado.nsuComFalha ?? null, tentativas: estado.tentativasNsuComFalha ?? 0 };
    let resultado: "ok" | "parcial" | "erro" = "ok";
    for (let pagina = 0; ; pagina++) {
      if (pagina >= maxPaginas || resta() <= 0) { resultado = "parcial"; r.parcial = true; break; }
      const controle = new AbortController();
      let documentos: DocumentoDistribuido[];
      try {
        const prazo = Math.min(PRAZO_POR_CHAMADA_MS, resta());
        documentos = (await comPrazo(opcoes.cliente.buscarDesde({ cnpj: estado.cnpj, ultimoNsu: ultimo, sinal: controle.signal }), prazo, () => controle.abort())).documentos ?? [];
      } catch (e) {
        if (e instanceof PrazoEsgotado) { resultado = "parcial"; r.parcial = true; break; }
        console.error("[fiscal/distribuicao] falha ao consultar o ADN", e instanceof Error ? e.name : "falha");
        resultado = "erro"; r.erros++;
        break;
      }
      const novos = documentos.filter(d => Number.isSafeInteger(d.nsu) && d.nsu > ultimo).sort((a, b) => a.nsu - b.nsu);
      if (!novos.length) { vaziaEm = agora; break; }
      let maior = ultimo;
      let cortado = false;
      for (const d of novos) {
        // QA S-5 (M2): o prazo é conferido também entre uma gravação e outra; o resto fica para a próxima vez
        if (resta() <= 0) { cortado = true; break; }
        let s: ResultadoDocumento;
        try {
          s = await gravarNotaRecebida(conexao, d, { tomadorCnpj: estado.cnpj, agora });
        } catch (e) {
          console.error("[fiscal/distribuicao] falha ao gravar nota recebida", e instanceof Error ? e.name : "falha");
          // S-5b: a exceção não trava o CNPJ para sempre — o NSU que falhou é registrado; na 3ª vez, vai para os ilegíveis e segue
          const tentativas = (falha.nsu === d.nsu ? falha.tentativas : 0) + 1;
          if (tentativas < MAX_TENTATIVAS_POR_NSU) {
            falha = { nsu: d.nsu, tentativas };
            resultado = "erro"; r.erros++;
            break;
          }
          s = "ilegivel";
        }
        if (falha.nsu !== null && d.nsu >= falha.nsu) falha = { nsu: null, tentativas: 0 };
        if (s === "gravada") { r.gravadas++; gravadasAqui++; } else if (s === "ja_existia") r.jaExistiam++;
        else if (s === "ilegivel") { r.ilegiveis++; ilegiveisAqui.push(d.nsu); }
        else if (s === "a_conferir") { r.aConferir++; aConferirAqui.push(d.nsu); }
        else if (s === "cancelamento") r.cancelamentos++;
        else r.ignoradas++;
        maior = d.nsu;
      }
      // o NSU avança só até o último documento tratado (o resto é relido na próxima vez; a chave impede duplicar).
      // QA S-5 (M3): GREATEST — se outra captura do mesmo CNPJ já foi mais longe, nada volta e nada lança; segue do maior
      if (maior > ultimo) {
        const [g] = await conexao.update(fiscalDistribuicaoEstado)
          .set({ ultimoNsu: sql`greatest(${fiscalDistribuicaoEstado.ultimoNsu}, ${maior})`, atualizadoEm: new Date() })
          .where(eq(fiscalDistribuicaoEstado.cnpj, estado.cnpj)).returning({ ultimoNsu: fiscalDistribuicaoEstado.ultimoNsu });
        ultimo = Math.max(maior, Number(g?.ultimoNsu ?? maior));
      }
      if (resultado === "erro") break;
      if (cortado) { resultado = "parcial"; r.parcial = true; break; }
    }
    // QA S-5 (M4): documento ilegível não some — a rodada fica "parcial" e o NSU fica guardado (lista curta) para o dono
    // S-5b: o mesmo vale para o documento "a conferir" (evento de tipo desconhecido, raiz desconhecida)
    if ((ilegiveisAqui.length || aConferirAqui.length) && resultado === "ok") resultado = "parcial";
    r.nsusIlegiveis.push(...ilegiveisAqui);
    r.nsusAConferir.push(...aConferirAqui);
    await conexao.update(fiscalDistribuicaoEstado).set({
      ultimaConsultaEm: agora, ultimoResultado: resultado, atualizadoEm: new Date(),
      ...(vaziaEm ? { ultimaConsultaVaziaEm: vaziaEm } : {}),
      documentosGravados: sql`${fiscalDistribuicaoEstado.documentosGravados} + ${gravadasAqui}`,
      nsuComFalha: falha.nsu, tentativasNsuComFalha: falha.tentativas,
      ...(ilegiveisAqui.length ? { nsusIlegiveis: juntarNsus(fiscalDistribuicaoEstado.nsusIlegiveis, ilegiveisAqui) } : {}),
      ...(aConferirAqui.length ? { nsusAConferir: juntarNsus(fiscalDistribuicaoEstado.nsusAConferir, aConferirAqui) } : {}),
    }).where(eq(fiscalDistribuicaoEstado.cnpj, estado.cnpj));
  }
  return r;
}

/** Mínimo de tempo para começar no cron (abaixo disso, pula). */
export const MINIMO_MS_CAPTURA_NO_CRON = 5_000;

/** Para o cron diário que já existe: nunca lança nem muda a resposta dele. Sem cliente registrado (hoje), volta na hora. */
export async function capturarRecebidasNoCron(db: () => DrizzleDb, limiteMs: number, cliente: ClienteDistribuicaoAdn | null = clienteDistribuicaoAtual()) {
  if (!cliente) return { desligada: true as const };
  if (!(limiteMs >= MINIMO_MS_CAPTURA_NO_CRON)) return { pulado: true as const };
  try {
    return await capturarNotasRecebidas(db, { cliente, prazoEm: Date.now() + limiteMs });
  } catch (e) {
    console.error("[cron/fiscal-recebidas]", e instanceof Error ? e.name : "falha");
    return { erro: true as const };
  }
}

