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
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import { constructionProjects, users } from "../../drizzle/schema.js";
import { obraNotas, obraNotasAdn } from "../../drizzle/schema-dolores-notas.js";
import { fiscalDistribuicaoEstado } from "../../drizzle/schema-fiscal.js";
import { numeroComparavel } from "../../shared/dolores/notas.js";
import { MAX_CARACTERES_XML, lerNfseRecebida, mapearNotaRecebida, vincularPorDocumento } from "./nfse-recebida.js";
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
  /** XML já descompactado (ver `xmlDoArquivoAdn`); null = documento sem XML (evento, por exemplo). */
  xml: string | null;
};
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

/** O ADN entrega o XML compactado em GZip e codificado em Base64 (oficial, MANINT §6.1.1-c). Para o cliente da S-4; com limite. */
export function xmlDoArquivoAdn(base64Gzip: string): string | null {
  try {
    return gunzipSync(Buffer.from(base64Gzip, "base64"), { maxOutputLength: MAX_CARACTERES_XML * 4 }).toString("utf8");
  } catch {
    return null;
  }
}

// ── Gravação de UM documento ──

export type ResultadoDocumento = "gravada" | "ja_existia" | "ignorada" | "ilegivel";

/** Grava uma NFS-e recebida (se for de fato recebida por `tomadorCnpj` e ainda não existir). Uma transação, travada. */
export async function gravarNotaRecebida(db: DrizzleDb, doc: DocumentoDistribuido, p: { tomadorCnpj: string; agora: Date }): Promise<ResultadoDocumento> {
  if (!doc.xml) return "ignorada";
  const lida = lerNfseRecebida(doc.xml);
  if (!lida.ok) return lida.motivo === "nao_e_nfse" ? "ignorada" : "ilegivel";
  const nota = lida.nota;
  if (doc.chave && doc.chave.toUpperCase().replace(/[^0-9A-Z]/g, "") !== nota.chave) return "ilegivel";
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
    // duplicidade: mesma regra das notas de grupo (mesmo emitente + mesmo número), a nota MAIS ANTIGA
    const numero = numeroComparavel(nota.numero);
    const colunaDoc = documento && /[A-Z]/.test(documento) ? obraNotas.emitenteCnpjAlfa : obraNotas.emitenteDocumento;
    const [anterior] = documento && numero ? await tx.select({ id: obraNotas.id }).from(obraNotas)
      .where(and(eq(colunaDoc, documento),
        sql`regexp_replace(regexp_replace(coalesce(${obraNotas.numero}, ''), '[^0-9]', '', 'g'), '^0+([0-9])', '\\1') = ${numero}`))
      .orderBy(asc(obraNotas.id)).limit(1) : [];
    const mapa = mapearNotaRecebida(nota, {
      tomadorCnpj: p.tomadorCnpj, nsu: doc.nsu, agora: p.agora, vinculo: vincularPorDocumento(candidatos, usuarios),
      duplicadaDe: anterior ? { id: anterior.id, motivo: `mesmo número e mesmo emitente da nota ${anterior.id}` } : null,
    });
    if (!mapa.gravar) return "ignorada";
    const [linha] = await tx.insert(obraNotas).values(mapa.linha).onConflictDoNothing().returning({ id: obraNotas.id });
    if (!linha) return "ja_existia";
    await tx.insert(obraNotasAdn).values({
      notaId: linha.id, tomadorCnpj: p.tomadorCnpj, xml: doc.xml!, xmlSha256: createHash("sha256").update(doc.xml!, "utf8").digest("hex"), capturadaEm: p.agora,
    });
    return "gravada";
  });
}

// ── Rotina (por NSU, com prazo) ──

export type ResultadoCaptura =
  | { executou: false; motivo: "sem_cliente" | "nenhum_cnpj_ligado" }
  | { executou: true; cnpjs: number; aguardando: number; gravadas: number; jaExistiam: number; ignoradas: number; ilegiveis: number; erros: number; parcial: boolean;
      /** QA S-5 (M4): NSUs dos documentos que não deram para ler (até 20), para o dono conferir. */
      nsusIlegiveis: number[] };

/** Quantos NSUs ilegíveis ficam guardados por CNPJ (os mais recentes). */
export const MAX_NSUS_ILEGIVEIS = 20;

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
    nsusIlegiveis: [] as number[] };
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
      try {
        for (const d of novos) {
          // QA S-5 (M2): o prazo é conferido também entre uma gravação e outra; o resto fica para a próxima vez
          if (resta() <= 0) { cortado = true; break; }
          const s = await gravarNotaRecebida(conexao, d, { tomadorCnpj: estado.cnpj, agora });
          if (s === "gravada") { r.gravadas++; gravadasAqui++; } else if (s === "ja_existia") r.jaExistiam++;
          else if (s === "ilegivel") { r.ilegiveis++; ilegiveisAqui.push(d.nsu); } else r.ignoradas++;
          maior = d.nsu;
        }
      } catch (e) {
        console.error("[fiscal/distribuicao] falha ao gravar nota recebida", e instanceof Error ? e.name : "falha");
        resultado = "erro"; r.erros++;
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
    if (ilegiveisAqui.length && resultado === "ok") resultado = "parcial";
    r.nsusIlegiveis.push(...ilegiveisAqui);
    const ilegiveisJson = JSON.stringify(ilegiveisAqui);
    await conexao.update(fiscalDistribuicaoEstado).set({
      ultimaConsultaEm: agora, ultimoResultado: resultado, atualizadoEm: new Date(),
      ...(vaziaEm ? { ultimaConsultaVaziaEm: vaziaEm } : {}),
      documentosGravados: sql`${fiscalDistribuicaoEstado.documentosGravados} + ${gravadasAqui}`,
      ...(ilegiveisAqui.length ? {
        nsusIlegiveis: sql`(SELECT coalesce(jsonb_agg(x ORDER BY (x)::bigint), '[]'::jsonb) FROM (SELECT x FROM jsonb_array_elements(${fiscalDistribuicaoEstado.nsusIlegiveis} || ${ilegiveisJson}::jsonb) AS t(x) ORDER BY (x)::bigint DESC LIMIT ${MAX_NSUS_ILEGIVEIS}) AS u)`,
      } : {}),
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

