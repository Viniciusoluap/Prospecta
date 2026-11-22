// EPIC-027 C5-COM (mesa comercial ligada à maquete, aprovada pelo dono em 21/11) — leituras da maquete 3D por lote, SÓ na conversa
// direta do dono: achar o lote (busca tolerante), dizer se a página pública abre, o LINK completo, o status (só com unidade da
// Incorporação ligada) e, quando não abre, o motivo. E o rascunho de mensagem ao cliente: só TEXTO devolvido ao dono — nada é
// enviado nem gravado (a porta registra na auditoria que um rascunho foi gerado).
// Somente leitura (transação READ ONLY da porta). Nunca devolve comprador, preço nem dado pessoal: da unidade só sai o status.
// A conferência da planta (hash da estrutura do JSON-fonte, a mesma de server/maquete-3d/lotes.ts#lotePublico) vem de fora, por
// parâmetro (funcoes.ts), para esta pasta não importar o servidor da maquete.
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { incorporationUnits } from "../../../drizzle/schema.js";
import { maquete3dItens, maquete3dLotes, maquetes3d } from "../../../drizzle/schema-maquete-3d.js";
import { statusDaUnidade, type StatusLote } from "../../../shared/maquete-3d/lote-publico.js";
import {
  MOTIVO_PAGINA, MOTIVO_SEM_ENDERECO, TITULO_RASCUNHO, ditoPeloDono, lerBuscaDeLote, linkDoLote, loteCombina, motivoDaPagina, nomeCompletoDoLote,
  origemPublica, rascunhoDoLote, rotuloDoStatus, textoDoCadastro, textosDoLote, type LoteParaBusca, type TextosDoLoteDolores,
} from "../../../shared/dolores/maquete-lote.js";
import { type Resultado, db, idPositivo } from "./comum.js";
import type { CanalDoFiltro } from "../dados-pessoais.js";

/** Contexto das leituras da maquete (o mesmo de funcoes.ts#ContextoFuncao, sem importar de lá). */
export type ContextoMaquete = { agora: Date; canal: CanalDoFiltro; pedidoDoDono?: string | null; mensagemId?: number | null };
/** Hash da estrutura ATUAL da planta (JSON-fonte do repositório); null = planta que não existe no servidor. */
export type HashDaPlanta = (fonteSlug: string) => string | null;

export const FRASE_SO_CONVERSA_DO_DONO = "A maquete por lote (link, status e rascunho) só sai na conversa direta do dono no WhatsApp.";
/** Teto de lotes lidos (o cadastro de lotes com maquete é pequeno; a página devolvida é bem menor). */
const MAX_LOTES_LIDOS = 500;
const MAX_ESCOLHA = 8;

/** Origem pública dos links: PUBLIC_SITE_URL (a mesma de server/dolores/acoes/comum.ts#urlDoSistemaParaLinks). */
export const origemDosLinks = () => origemPublica(process.env.PUBLIC_SITE_URL);

export const entradaConsultarMaqueteLote = z.object({
  busca: z.string().trim().min(1).max(120).optional().describe("Como o dono disse: \"lote 4 da quadra 18\", \"qd18 lt4\", \"Vila Esmeralda\"."),
  loteId: idPositivo.optional().describe("O loteId de uma consulta anterior (quando ele escolheu um da lista)."),
}).strict().refine(a => a.busca !== undefined || a.loteId !== undefined, { message: "Informe busca ou loteId." });

export const entradaListarMaquetesLotes = z.object({
  busca: z.string().trim().min(1).max(120).optional().describe("Filtro opcional (empreendimento, quadra ou lote)."),
  limite: z.number().int().min(1).max(50).default(20).describe("Itens (até 50)."),
}).strict();

export const entradaRascunharMensagemLote = z.object({
  loteId: idPositivo.describe("O loteId que consultar_maquete_lote devolveu."),
  tom: z.enum(["proximo", "formal"]).default("proximo").describe("proximo (padrão) ou formal."),
  nome: z.string().trim().min(2).max(40).optional().describe("Nome do cliente, SÓ se o dono o disse nesta mensagem."),
  valor: z.string().trim().min(1).max(40).optional().describe("Valor, SÓ se o dono o ditou nesta mensagem, exatamente como ele escreveu."),
}).strict();

type LinhaLote = {
  id: number; empreendimentoSlug: string; loteSlug: string; empreendimentoNome: string | null; quadra: string | null; loteNumero: string | null;
  ativo: boolean; codigoLink: string | null; itensVersao: number | null; maqueteId: number | null; origem: string | null; fonteSlug: string | null;
  publicada: number | null; maqueteExcluida: Date | null; unitId: number | null; unidadeStatus: string | null;
};

export type LoteDaMaquete = {
  loteId: number; textos: TextosDoLoteDolores; nome: string; status: StatusLote | null; temUnidade: boolean;
  paginaAbre: boolean; motivo: string | null; link: string | null;
  /** Campos do cadastro para a busca (nunca vão ao modelo). */
  busca: LoteParaBusca;
};

/** Lê os lotes com maquete e o que cada um mostra hoje (mesmas condições da página pública). Só SELECT. */
async function lerLotes(hashDaPlanta: HashDaPlanta): Promise<LoteDaMaquete[]> {
  const linhas: LinhaLote[] = await db().select({
    id: maquete3dLotes.id, empreendimentoSlug: maquete3dLotes.empreendimentoSlug, loteSlug: maquete3dLotes.loteSlug,
    empreendimentoNome: maquete3dLotes.empreendimentoNome, quadra: maquete3dLotes.quadra, loteNumero: maquete3dLotes.loteNumero,
    ativo: maquete3dLotes.ativo, codigoLink: maquete3dLotes.codigoLink, itensVersao: maquete3dLotes.itensVersao,
    maqueteId: maquetes3d.id, origem: maquetes3d.origem, fonteSlug: maquetes3d.fonteSlug, publicada: maquetes3d.itensVersaoPublicada,
    maqueteExcluida: maquetes3d.deletedAt, unitId: maquete3dLotes.unitId,
    // da unidade, SÓ o status (nunca comprador nem preço)
    unidadeStatus: incorporationUnits.status,
  }).from(maquete3dLotes)
    .leftJoin(maquetes3d, eq(maquetes3d.id, maquete3dLotes.maqueteId))
    .leftJoin(incorporationUnits, and(eq(incorporationUnits.id, maquete3dLotes.unitId), isNull(incorporationUnits.deletedAt)))
    .orderBy(maquete3dLotes.empreendimentoSlug, maquete3dLotes.loteSlug).limit(MAX_LOTES_LIDOS);
  const maquetes = Array.from(new Set(linhas.map(l => l.maqueteId).filter((x): x is number => typeof x === "number")));
  const versoes = maquetes.length ? await db().select({ maqueteId: maquete3dItens.maqueteId, versao: maquete3dItens.versao, situacao: maquete3dItens.situacao, hash: maquete3dItens.estruturaHash })
    .from(maquete3dItens).where(and(inArray(maquete3dItens.maqueteId, maquetes), isNotNull(maquete3dItens.publicadaEm))) : [];
  const versao = new Map(versoes.map(v => [`${v.maqueteId}:${v.versao}`, v]));
  const hashes = new Map<string, string | null>();
  const hashAtual = (slug: string) => { if (!hashes.has(slug)) { let h: string | null = null; try { h = hashDaPlanta(slug); } catch { h = null; } hashes.set(slug, h); } return hashes.get(slug)!; };
  const origem = origemDosLinks();
  return linhas.map(l => {
    const maqueteOk = !!l.maqueteId && !l.maqueteExcluida && l.origem === "fonte" && !!l.fonteSlug && hashAtual(l.fonteSlug) !== null;
    const efetiva = l.itensVersao ?? l.publicada ?? null;
    const v = efetiva && l.maqueteId ? versao.get(`${l.maqueteId}:${efetiva}`) : undefined;
    const motivo = motivoDaPagina({
      ativo: l.ativo, codigoLink: l.codigoLink, maqueteOk, versaoEfetiva: efetiva,
      versaoPublicada: !!v && (v.situacao === "publicada" || v.situacao === "arquivada"),
      versaoValeParaPlanta: !!v && !!l.fonteSlug && v.hash === hashAtual(l.fonteSlug),
    });
    const link = motivo ? null : linkDoLote(origem, l.empreendimentoSlug, l.loteSlug, l.codigoLink);
    const textos = textosDoLote(l);
    return {
      loteId: Number(l.id), textos, nome: nomeCompletoDoLote(textos),
      status: l.unitId ? statusDaUnidade(l.unidadeStatus) : null, temUnidade: !!l.unitId && l.unidadeStatus !== null,
      paginaAbre: motivo === null, motivo: motivo ? MOTIVO_PAGINA[motivo] : !link ? MOTIVO_SEM_ENDERECO : null, link,
      busca: { empreendimentoSlug: l.empreendimentoSlug, loteSlug: l.loteSlug, empreendimentoNome: l.empreendimentoNome, quadra: l.quadra, loteNumero: l.loteNumero },
    };
  });
}

const doLote = (l: LoteDaMaquete) => ({
  loteId: l.loteId, lote: l.nome,
  status: rotuloDoStatus(l.status) ?? (l.temUnidade ? "não informado" : "sem status (lote não ligado a uma unidade da Incorporação)"),
});
const recusado = (motivo: string): Resultado => ({ dados: { recusado: motivo }, resumo: { recusado: true } });
/** Só a conversa direta do dono (a porta já confere; aqui é a segunda trava, para qualquer outro laço que a chame). */
const foraDaConversa = (ctx: ContextoMaquete) => ctx.canal !== "whatsapp";

function filtrar(lotes: LoteDaMaquete[], busca: string | undefined): LoteDaMaquete[] {
  if (!busca) return lotes;
  const b = lerBuscaDeLote(busca);
  return lotes.filter(l => loteCombina(l.busca, b));
}

export async function consultarMaqueteLote(a: z.infer<typeof entradaConsultarMaqueteLote>, ctx: ContextoMaquete, hashDaPlanta: HashDaPlanta): Promise<Resultado> {
  if (foraDaConversa(ctx)) return recusado(FRASE_SO_CONVERSA_DO_DONO);
  const todos = await lerLotes(hashDaPlanta);
  const achados = a.loteId !== undefined ? todos.filter(l => l.loteId === a.loteId) : filtrar(todos, a.busca);
  if (!achados.length) {
    return { dados: { encontrados: 0, lotesComMaquete: todos.length, aviso: todos.length ? "Nenhum lote com maquete combina com isso. Diga ao dono e, se ajudar, ofereça a lista dos lotes com maquete." : "Nenhum lote tem maquete 3D cadastrada ainda (o lote é ligado pela tela da maquete)." },
      resumo: { encontrados: 0 } };
  }
  if (achados.length > 1) {
    return { dados: { encontrados: achados.length, escolha: achados.slice(0, MAX_ESCOLHA).map(doLote), aviso: "Mais de um lote combina: pergunte ao dono qual, citando os nomes (até 3)." },
      resumo: { encontrados: achados.length } };
  }
  const l = achados[0];
  return {
    dados: {
      encontrados: 1,
      lote: { ...doLote(l), paginaAbre: l.paginaAbre, link: l.link, motivo: l.motivo },
      ...(l.link ? { aviso: "Se for passar o link, repita-o EXATAMENTE como está (o sistema confere e, se faltar, mostra ao dono)." } : {}),
      // o sistema garante o link intacto na resposta ao dono (cerebro.ts): se ela não o repetir exatamente, ele vai num quadro
      ...(l.link ? { paraODono: { texto: `Link da maquete 3D do ${l.nome}: ${l.link}`, seFaltar: l.link } } : {}),
    },
    resumo: { encontrados: 1, paginaAbre: l.paginaAbre, comLink: !!l.link, comStatus: !!l.status },
  };
}

export async function listarMaquetesLotes(a: z.infer<typeof entradaListarMaquetesLotes>, ctx: ContextoMaquete, hashDaPlanta: HashDaPlanta): Promise<Resultado> {
  if (foraDaConversa(ctx)) return recusado(FRASE_SO_CONVERSA_DO_DONO);
  const todos = filtrar(await lerLotes(hashDaPlanta), a.busca);
  const pagina = todos.slice(0, a.limite);
  return {
    dados: {
      total: todos.length, comPaginaAberta: todos.filter(l => l.paginaAbre).length,
      lotes: pagina.map(l => ({ ...doLote(l), temLink: !!l.link, paginaAbre: l.paginaAbre, ...(l.paginaAbre ? {} : { motivo: l.motivo }) })),
      ...(todos.length > pagina.length ? { aviso: `Há mais ${todos.length - pagina.length}; filtre ou aumente o limite.` } : {}),
    },
    resumo: { total: todos.length, mostrados: pagina.length },
  };
}

export const FRASE_VALOR_SO_DITADO = "O valor só entra no texto quando o dono o dita nesta mesma mensagem (exatamente como ele escreveu); sem isso, o texto vai sem valor.";
export const FRASE_NOME_SO_DITADO = "O nome do cliente só entra no texto quando o dono o diz nesta mesma mensagem.";

export async function rascunharMensagemLote(a: z.infer<typeof entradaRascunharMensagemLote>, ctx: ContextoMaquete, hashDaPlanta: HashDaPlanta): Promise<Resultado> {
  if (foraDaConversa(ctx)) return recusado(FRASE_SO_CONVERSA_DO_DONO);
  // nome e valor: só das palavras do DONO nesta mensagem (nunca de consulta, grupo ou texto colado — sem pedido do dono, nada)
  if (a.valor !== undefined && (!/\d/.test(a.valor) || !ditoPeloDono(a.valor, ctx.pedidoDoDono))) return recusado(FRASE_VALOR_SO_DITADO);
  if (a.nome !== undefined && !ditoPeloDono(a.nome, ctx.pedidoDoDono)) return recusado(FRASE_NOME_SO_DITADO);
  const l = (await lerLotes(hashDaPlanta)).find(x => x.loteId === a.loteId);
  if (!l) return recusado("Não achei esse lote entre os que têm maquete 3D. Consulte de novo.");
  if (!l.link) return { dados: { semRascunho: `Sem link para mandar: ${l.motivo ?? MOTIVO_SEM_ENDERECO}.` }, resumo: { rascunho: "sem_link" } };
  const nome = a.nome ? textoDoCadastro(a.nome, 40, "") : null;
  const valor = a.valor ? textoDoCadastro(a.valor, 40, "") : null;
  const rascunho = rascunhoDoLote({ ...l.textos, link: l.link, tom: a.tom, nome: nome || null, valor: valor || null });
  const atencao = l.status && l.status !== "disponivel" ? `\n(Atenção: no sistema este lote está ${rotuloDoStatus(l.status)}.)` : "";
  return {
    dados: {
      rascunho, statusDoLote: rotuloDoStatus(l.status),
      aviso: "NADA foi enviado. O sistema mostra este texto ao dono logo abaixo da sua resposta, do jeito que está: diga em uma frase que o texto está pronto para ele encaminhar; não o reescreva nem acrescente preço.",
      paraODono: { texto: `${TITULO_RASCUNHO}\n\n${rascunho}${atencao}`, seFaltar: rascunho },
    },
    // auditoria: só que um rascunho foi gerado (sem o texto, sem nome, sem valor)
    resumo: { rascunho: "gerado", tom: a.tom, comNome: !!nome, comValor: !!valor, status: l.status ?? null },
  };
}
