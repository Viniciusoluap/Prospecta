// EPIC-027 C5 (E2, "a Dolores resolve") — a proposta que espera a resposta do DONO na conversa direta dele com a Dolores.
// Pedido do dono: "eu espero que eu posso falar com ela e resolver problemas dentro do meu negócio". Decisão dele (21/11): registro
// → ela propõe e faz com um "pode"; ação séria → só com "confirmo".
//
// Como um "sim" solto nunca confirma a coisa errada (tudo por CÓDIGO, nunca pela IA):
//  (a) só existe UMA proposta aberta (índice único parcial da 0145); proposta nova substitui a anterior, e isso fica registrado;
//  (b) o "pode" só vale se a pergunta for a ÚLTIMA coisa que o dono recebeu ("adjacente"): qualquer outra mensagem enviada a ele
//      depois (resposta de outro pedido, aviso de grupo, relatório) desliga — aí o sistema mostra de novo o que espera e pede o
//      "pode" de novo. QA C5-E2 (A1): a proposta NASCE não confirmável (adjacente = false); só passa a aceitar resposta quando a
//      pergunta foi de fato enviada (`marcarPerguntaEnviada`, com a hora do envio), e a resposta só vale se o dono a ESCREVEU depois
//      dessa hora (messageTimestamp, em segundos, estritamente maior) — um "pode" atrasado, escrito para a proposta anterior, nunca
//      confirma a nova;
//  (c) vence em 15 min (registro) ou 10 min (séria) e é de uso único (UPDATE condicional aberta → confirmada);
//  (d) o que executa é o item gravado na fila e conferido por hash (`decidir`), nunca uma reinterpretação do modelo;
//  (e) a séria exige "confirmo"; o nível é recalculado pelo código na hora (função + argumentos guardados);
//  (f) só chega aqui mensagem do número do dono, na conversa direta, não encaminhada e sem mídia (whatsapp.ts). Mensagem de grupo,
//      de cliente ou de terceiro nunca chega; texto de consulta ou de ferramenta nunca é lido como resposta.
// Nesta tabela não há texto nem dado pessoal: só ids, nível, situação e horas. Os resumos mostrados vêm de dolores_aprovacoes.
import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { doloresAprovacoes } from "../../drizzle/schema-dolores-fila.js";
import { doloresConversaPendencia, type DoloresConversaPendencia } from "../../drizzle/schema-dolores-pendencia.js";
import {
  FRASE_JA_FEITO, FRASE_JA_RECUSADA, FRASE_RECUSADA, FRASE_SEM_TEMPO, FRASE_VENCIDA, MAX_ITENS_PENDENCIA, VALIDADE_PENDENCIA_MS,
  fraseFaltaConfirmo, fraseForaDeOrdem, nivelDoConjunto, nivelDoItem, perguntaDaPendencia, type Confirmacao, type NivelConfirmacao,
} from "../../shared/dolores/confirmacao.js";
import { ALFABETO_CODIGO, textoDeDado } from "../../shared/dolores/fila.js";
import { MAX_CARACTERES_WHATSAPP } from "../../shared/dolores/whatsapp.js";
import { getDb } from "../db.js";
import { decidir, type ResultadoDecisao } from "./aprovacoes.js";
import { registrarAcao } from "./auditoria.js";
import { erroParaLog } from "./erro-seguro.js";

/** Espaço da pergunta na primeira mensagem (o texto do modelo fica com o resto, no mínimo ~300 caracteres). */
export const MAX_CARACTERES_PERGUNTA = MAX_CARACTERES_WHATSAPP - 400;
/** Depois de decidida, um "pode" repetido nesta janela recebe "já fiz" (idempotente); depois, segue como conversa comum. */
export const JANELA_JA_DECIDIDA_MS = 15 * 60_000;
/** Proposta vencida há menos que isto: o "pode" recebe "venceu"; mais antiga, segue como conversa comum. */
export const JANELA_VENCIDA_MS = 60 * 60_000;

type ItemDaPendencia = { id: number; codigo: string; funcao: string; argumentos: unknown; resumo: string; situacao: string; venceEm: Date };

const auditar = (resultado: "ok" | "recusada" | "erro", motivo: string, resumo: Record<string, unknown>, c: { mensagemId: number | null; autor: number | null; pedidoId?: string }) =>
  registrarAcao({ funcao: "dolores_pendencia", resultado, motivo, canal: "whatsapp", pedidoId: c.pedidoId ?? `wa:${c.mensagemId}`, autorUserId: c.autor, resumo }).catch(() => false);

const CODIGO_ENTRE_COLCHETES = new RegExp(`\\[[${ALFABETO_CODIGO}]{5}\\]\\s*`, "g");
const PEDIDO_COM_CODIGO = new RegExp(`"?(?:aprovar|recusar) [${ALFABETO_CODIGO}]{5}"?`, "gi");
/** Texto do sistema sobre um item, sem o código dele (o dono responde "pode"; o modelo e a memória nunca veem código). */
export const semCodigoDoItem = (t: string) => t.replace(CODIGO_ENTRE_COLCHETES, "").replace(PEDIDO_COM_CODIGO, "\"pode\"").trim();

async function itens(ids: readonly number[]): Promise<ItemDaPendencia[]> {
  if (!ids.length) return [];
  return getDb().select({ id: doloresAprovacoes.id, codigo: doloresAprovacoes.codigo, funcao: doloresAprovacoes.funcao, argumentos: doloresAprovacoes.argumentos,
    resumo: doloresAprovacoes.resumo, situacao: doloresAprovacoes.situacao, venceEm: doloresAprovacoes.venceEm })
    .from(doloresAprovacoes).where(inArray(doloresAprovacoes.id, ids.slice(0, MAX_ITENS_PENDENCIA))).orderBy(doloresAprovacoes.id);
}

const paraMotivo = (i: ItemDaPendencia) => ({ funcao: i.funcao, argumentos: i.argumentos });
const nivelDosItens = (l: readonly ItemDaPendencia[]) => nivelDoConjunto(l.map(i => nivelDoItem(i.funcao, i.argumentos)));
const resumoMostrado = (i: ItemDaPendencia) => textoDeDado(i.resumo, Number.MAX_SAFE_INTEGER);

/**
 * Grava a proposta (substituindo a que estava aberta). Duas abertas ao mesmo tempo o banco não deixa (índice único): uma
 * segunda tentativa resolve a corrida entre dois pedidos simultâneos.
 */
async function gravar(p: { ids: number[]; nivel: NivelConfirmacao; venceEm: Date; mensagemId: number | null; agora: Date }): Promise<{ id: number; substituidas: number }> {
  for (let tentativa = 0; ; tentativa++) {
    try {
      return await getDb().transaction(async tx => {
        const velhas = await tx.update(doloresConversaPendencia).set({ situacao: "substituida", decididaEm: p.agora })
          .where(eq(doloresConversaPendencia.situacao, "aberta")).returning({ id: doloresConversaPendencia.id });
        // QA C5-E2 (A1): nasce NÃO confirmável — só depois que a pergunta sai (marcarPerguntaEnviada)
        const [nova] = await tx.insert(doloresConversaPendencia).values({ venceEm: p.venceEm, mensagemId: p.mensagemId, aprovacaoIds: p.ids, nivel: p.nivel, criadoEm: p.agora, adjacente: false, perguntaEnviadaEm: null })
          .returning({ id: doloresConversaPendencia.id });
        return { id: nova.id, substituidas: velhas.length };
      });
    } catch (e) {
      if (tentativa >= 1) throw e;
    }
  }
}

export type PendenciaAberta = { id: number; pergunta: string; memoria: string; nivel: NivelConfirmacao; itens: number };

/**
 * Depois do laço: os itens que ESTE pedido do dono deixou esperando viram UMA proposta, com a pergunta do sistema (o resumo exato
 * de cada item, sem código). Só itens inteiros que cabem na mensagem entram (o dono lê tudo o que confirma); os que não cabem ficam
 * para a tela. Sem item → null.
 */
export async function abrirPendencia(p: { mensagemId: number; codigos: readonly string[]; agora: Date; autor: number | null }): Promise<PendenciaAberta | null> {
  const codigos = p.codigos.slice(0, 30);
  const candidatos = await getDb().select({ id: doloresAprovacoes.id, codigo: doloresAprovacoes.codigo, funcao: doloresAprovacoes.funcao, argumentos: doloresAprovacoes.argumentos,
    resumo: doloresAprovacoes.resumo, situacao: doloresAprovacoes.situacao, venceEm: doloresAprovacoes.venceEm })
    .from(doloresAprovacoes).where(and(eq(doloresAprovacoes.situacao, "aguardando"), sql`${doloresAprovacoes.venceEm} > ${p.agora}`,
      codigos.length ? sql`(${doloresAprovacoes.mensagemId} = ${p.mensagemId} OR ${inArray(doloresAprovacoes.codigo, codigos)})` : eq(doloresAprovacoes.mensagemId, p.mensagemId)))
    .orderBy(doloresAprovacoes.id).limit(30);
  if (!candidatos.length) return null;
  return abrirComItens(candidatos, { ...p, restantesFora: 0 });
}

async function abrirComItens(candidatos: ItemDaPendencia[], p: { mensagemId: number | null; agora: Date; autor: number | null; venceEm?: Date; restantesFora: number; pedidoId?: string }): Promise<PendenciaAberta | null> {
  // entram itens INTEIROS enquanto a pergunta couber (nível e funções recalculados a cada item: a frase muda com o nível)
  const escolhidos: ItemDaPendencia[] = [];
  for (const i of candidatos.slice(0, MAX_ITENS_PENDENCIA)) {
    const teste = [...escolhidos, i];
    if (perguntaDaPendencia(teste.map(resumoMostrado), nivelDosItens(teste), teste.map(paraMotivo), candidatos.length - teste.length).length > MAX_CARACTERES_PERGUNTA) break;
    escolhidos.push(i);
  }
  if (!escolhidos.length) return null;
  const nivel = nivelDosItens(escolhidos);
  const itensMotivo = escolhidos.map(paraMotivo);
  // Revisão automática (2): a proposta nunca vale mais que o item da fila que ela confirma (item reaproveitado de um pedido anterior
  // vence antes): o prazo é o MENOR, e a pergunta diz a validade real — confirmar dentro dela executa de fato.
  const padrao = p.venceEm ?? new Date(p.agora.getTime() + VALIDADE_PENDENCIA_MS[nivel]);
  const venceEm = new Date(Math.min(padrao.getTime(), ...escolhidos.map(i => i.venceEm.getTime())));
  const minutos = Math.floor((venceEm.getTime() - p.agora.getTime()) / 60_000);
  const { id, substituidas } = await gravar({ ids: escolhidos.map(i => i.id), nivel, venceEm, mensagemId: p.mensagemId, agora: p.agora });
  const fora = candidatos.length - escolhidos.length + p.restantesFora;
  const pergunta = perguntaDaPendencia(escolhidos.map(resumoMostrado), nivel, itensMotivo, fora, minutos);
  await auditar("ok", "proposta aberta: espera a resposta do dono", { pendenciaId: id, itens: escolhidos.length, nivel, substituidas, foraDaPergunta: fora }, p);
  const memoria = `(O sistema perguntou ao dono se pode fazer${nivel === "serio" ? ", pedindo \"confirmo\"" : ""}: ${escolhidos.slice(0, 3).map(i => resumoMostrado(i).slice(0, 200)).join("; ")}${escolhidos.length > 3 ? "; …" : ""})`;
  return { id, pergunta: substituidas ? `(A proposta anterior ficou de lado.)\n${pergunta}` : pergunta, memoria, nivel, itens: escolhidos.length };
}

/**
 * EPIC-027 C5 (E3): o pedido de REGISTRO que o dono fez dentro de um grupo vira a mesma proposta, mas pelos códigos dos itens (não há
 * mensagem da conversa direta: `mensagem_id` fica vazio). A pergunta vai a ele no privado (`enviarAvisoAoDono` com o id da proposta);
 * só o "pode" dele na conversa direta confirma — nunca uma mensagem de grupo.
 */
export async function abrirPendenciaDosCodigos(p: { codigos: readonly string[]; agora: Date; autor: number | null; pedidoId: string }): Promise<PendenciaAberta | null> {
  const codigos = p.codigos.slice(0, MAX_ITENS_PENDENCIA);
  if (!codigos.length) return null;
  const candidatos = await getDb().select({ id: doloresAprovacoes.id, codigo: doloresAprovacoes.codigo, funcao: doloresAprovacoes.funcao, argumentos: doloresAprovacoes.argumentos,
    resumo: doloresAprovacoes.resumo, situacao: doloresAprovacoes.situacao, venceEm: doloresAprovacoes.venceEm })
    .from(doloresAprovacoes).where(and(eq(doloresAprovacoes.situacao, "aguardando"), sql`${doloresAprovacoes.venceEm} > ${p.agora}`, inArray(doloresAprovacoes.codigo, codigos)))
    .orderBy(doloresAprovacoes.id).limit(MAX_ITENS_PENDENCIA);
  if (!candidatos.length) return null;
  return abrirComItens(candidatos, { mensagemId: null, agora: p.agora, autor: p.autor, restantesFora: 0, pedidoId: p.pedidoId });
}

/**
 * Qualquer mensagem enviada ao dono que NÃO é a pergunta desta proposta (resposta de outro pedido, aviso de grupo, relatório,
 * recuperação) tira a proposta aberta da "ordem": um "pode" solto depois disso não confirma. Nunca lança (falha vai só para o log).
 */
export async function marcarForaDeOrdem(excetoId: number | null): Promise<void> {
  try {
    await getDb().update(doloresConversaPendencia).set({ adjacente: false })
      .where(and(eq(doloresConversaPendencia.situacao, "aberta"), eq(doloresConversaPendencia.adjacente, true), ...(excetoId ? [ne(doloresConversaPendencia.id, excetoId)] : [])));
  } catch (e) { console.error("[dolores/pendencia] falha ao marcar a proposta fora de ordem", erroParaLog(e)); }
}

/**
 * QA C5 (achado B2) — PONTO ÚNICO da regra "posso mandar agora um aviso AUTOMÁTICO ao dono (que não é resposta a ele)?".
 * Não, enquanto houver uma proposta ABERTA e ainda CONFIRMÁVEL na conversa do dono: aberta, dentro da validade e com a pergunta
 * como a última coisa que ele recebeu (`adjacente`) — ou ainda saindo (pergunta não enviada). Um aviso no meio tiraria a proposta
 * "de ordem" (marcarForaDeOrdem) e o "pode" dele não confirmaria. O aviso ESPERA: fica pendente e sai quando a proposta for
 * decidida ou vencer (fim do próximo aviso do WhatsApp, ou o cron).
 * Quem usa: os alertas de gasto (operacao-gasto.ts#enviarAlertasPendentes) e os avisos proativos (avisos.ts#executarAvisos, antes da
 * vaga e de novo logo antes do envio). Qualquer aviso automático novo (lembretes) que vá ao dono pelo `enviarAvisoAoDono` deve conferir AQUI antes, e não reescrever a regra. NÃO vale para a resposta
 * a uma mensagem dele (ele pediu outra coisa: aí a proposta sai de ordem de propósito) nem para a pergunta da própria proposta.
 * Sem a tabela (0145 não aplicada) não há proposta → true. Falha ao ler → false (espera: um alerta atrasado é melhor que um "pode"
 * perdido).
 */
export async function podeEnviarAvisoAgora(agora: Date): Promise<boolean> {
  try {
    const existe = await getDb().execute(sql`SELECT to_regclass('public.dolores_conversa_pendencia') IS NOT NULL AS existe`);
    if ((existe as unknown as { rows: Array<{ existe: boolean }> }).rows[0]?.existe !== true) return true;
    const [aberta] = await getDb().select({ id: doloresConversaPendencia.id }).from(doloresConversaPendencia)
      .where(and(eq(doloresConversaPendencia.situacao, "aberta"), gt(doloresConversaPendencia.venceEm, agora),
        or(eq(doloresConversaPendencia.adjacente, true), isNull(doloresConversaPendencia.perguntaEnviadaEm)))).limit(1);
    return !aberta;
  } catch (e) {
    console.error("[dolores/pendencia] falha ao conferir se há proposta aberta", erroParaLog(e));
    return false;
  }
}

/**
 * QA C5-E2 (A1): a pergunta (ou a repetição dela) desta proposta CHEGOU ao dono: a partir de agora ela aceita resposta, e só
 * resposta escrita depois desta hora. Nunca lança (falha vai só para o log; sem a marca, o "pode" só faz mostrar a proposta de novo).
 */
export async function marcarPerguntaEnviada(id: number, agora: Date): Promise<void> {
  try {
    await getDb().update(doloresConversaPendencia).set({ adjacente: true, perguntaEnviadaEm: agora })
      .where(and(eq(doloresConversaPendencia.id, id), eq(doloresConversaPendencia.situacao, "aberta")));
  } catch (e) { console.error("[dolores/pendencia] falha ao marcar a pergunta como enviada", erroParaLog(e)); }
}

/** Segundo inteiro (o messageTimestamp do WhatsApp vem em segundos). */
const segundo = (d: Date) => Math.floor(d.getTime() / 1000);
/**
 * QA C5-E2 (A1): a resposta vale para ESTA proposta? Só se a pergunta ainda é a última coisa que ele recebeu, já foi enviada, e a
 * mensagem dele foi escrita num segundo POSTERIOR ao do envio (sem hora da mensagem → não vale: lado seguro).
 */
export function respostaDepoisDaPergunta(p: Pick<DoloresConversaPendencia, "adjacente" | "perguntaEnviadaEm">, enviadaEm: Date | null | undefined): boolean {
  if (!p.adjacente || !p.perguntaEnviadaEm || !enviadaEm || Number.isNaN(enviadaEm.getTime())) return false;
  return segundo(enviadaEm) > segundo(p.perguntaEnviadaEm);
}

/** A pergunta não chegou ao dono (envio falhou): a proposta não vale (nada fica esperando um "pode" que ele não viu). */
export async function cancelarPendencia(id: number, agora: Date): Promise<void> {
  try {
    await getDb().update(doloresConversaPendencia).set({ situacao: "vencida", decididaEm: agora })
      .where(and(eq(doloresConversaPendencia.id, id), eq(doloresConversaPendencia.situacao, "aberta")));
  } catch (e) { console.error("[dolores/pendencia] falha ao cancelar a proposta", erroParaLog(e)); }
}

export type RespostaDaConfirmacao = {
  texto: string;
  /** A resposta É a pergunta desta proposta (continua "na ordem"). */
  pendenciaId: number | null;
  situacao: "confirmada" | "recusada" | "vencida" | "ja_feita" | "ja_recusada" | "falta_confirmo" | "fora_de_ordem" | "erro";
  /** Códigos citados (para a memória tirar). */
  codigos: string[];
};

type Contexto = { mensagemId: number; agora: Date; autor: number | null; prazoFinal?: number; relogio?: () => number;
  /** QA C5-E2 (A1): hora em que o dono escreveu a resposta (messageTimestamp). */
  enviadaEm?: Date | null };

/**
 * A resposta curta do dono ("pode", "sim", "confirmo", "não"), já reconhecida por código (`lerConfirmacao`). null = não há
 * proposta a que ela responda: a mensagem segue o caminho comum (a IA, com a memória, no máximo PROPÕE de novo).
 */
export async function tratarConfirmacao(c: Confirmacao, ctx: Contexto): Promise<RespostaDaConfirmacao | null> {
  let p: DoloresConversaPendencia | undefined;
  try {
    [p] = await getDb().select().from(doloresConversaPendencia).orderBy(desc(doloresConversaPendencia.id)).limit(1);
  } catch (e) {
    // sem a tabela (0145 não aplicada) ou banco fora: a confirmação natural não existe — segue o caminho comum
    console.error("[dolores/pendencia] propostas indisponíveis", erroParaLog(e));
    return null;
  }
  if (!p) return null;
  const agora = ctx.agora.getTime();
  const base = { pendenciaId: null, codigos: [] as string[] };
  if (p.situacao !== "aberta") {
    const recente = p.decididaEm && agora - p.decididaEm.getTime() <= JANELA_JA_DECIDIDA_MS;
    if (c.tipo !== "nao" && p.situacao === "confirmada" && recente) return { ...base, texto: FRASE_JA_FEITO, situacao: "ja_feita" };
    if (c.tipo !== "nao" && p.situacao === "recusada" && recente) return { ...base, texto: FRASE_JA_RECUSADA, situacao: "ja_recusada" };
    if (c.tipo !== "nao" && p.situacao === "vencida" && agora - p.venceEm.getTime() <= JANELA_VENCIDA_MS && p.venceEm.getTime() <= agora) return { ...base, texto: FRASE_VENCIDA, situacao: "vencida" };
    return null;
  }
  if (p.venceEm.getTime() <= agora) {
    await getDb().update(doloresConversaPendencia).set({ situacao: "vencida", decididaEm: ctx.agora })
      .where(and(eq(doloresConversaPendencia.id, p.id), eq(doloresConversaPendencia.situacao, "aberta"))).catch(() => undefined);
    await auditar("recusada", "resposta depois do prazo: proposta vencida, nada foi feito", { pendenciaId: p.id }, ctx);
    if (c.tipo === "nao" || agora - p.venceEm.getTime() > JANELA_VENCIDA_MS) return null;
    return { ...base, texto: FRASE_VENCIDA, situacao: "vencida" };
  }
  const lista = await itens(p.aprovacaoIds);
  const nivel = nivelDoConjunto([p.nivel, nivelDosItens(lista)]);
  const funcoes = lista.map(paraMotivo);
  const valida = respostaDepoisDaPergunta(p, ctx.enviadaEm);
  const resumos = lista.map(resumoMostrado);
  const codigos = lista.map(i => i.codigo);

  if (c.tipo === "nao") {
    // "não" solto depois de outra mensagem: pode ser resposta a outra coisa — segue como conversa comum (recusar não é urgente)
    if (!valida) return null;
    const [r] = await getDb().update(doloresConversaPendencia).set({ situacao: "recusada", decididaEm: ctx.agora, decididaMensagemId: ctx.mensagemId })
      .where(and(eq(doloresConversaPendencia.id, p.id), eq(doloresConversaPendencia.situacao, "aberta"))).returning({ id: doloresConversaPendencia.id });
    if (!r) return { ...base, texto: FRASE_JA_FEITO, situacao: "ja_feita" };
    const aguardando = lista.filter(i => i.situacao === "aguardando").map(i => i.codigo);
    if (aguardando.length) await decidir(aguardando, "recusar", { via: "whatsapp", userId: null, agora: ctx.agora, mensagemId: ctx.mensagemId, motivo: "o dono respondeu \"não\" à proposta" });
    await auditar("ok", "o dono recusou a proposta", { pendenciaId: p.id, itens: lista.length }, ctx);
    return { ...base, codigos, texto: FRASE_RECUSADA, situacao: "recusada" };
  }
  // a pergunta não é mais a última coisa que ele recebeu, ainda não tinha saído, ou a resposta foi escrita ANTES dela (QA A1):
  // mostra de novo o que espera (vira a pergunta; a marca de "enviada" é gravada depois do envio) e pede a resposta de novo
  if (!valida) {
    await auditar("recusada", p.adjacente ? "resposta escrita antes da pergunta (ou sem hora): o sistema mostrou de novo a proposta; nada foi feito"
      : "resposta solta depois de outra mensagem: o sistema mostrou de novo a proposta; nada foi feito", { pendenciaId: p.id }, ctx);
    return { pendenciaId: p.id, codigos, texto: fraseForaDeOrdem(resumos, nivel), situacao: "fora_de_ordem" };
  }
  if (nivel === "serio" && c.tipo !== "confirmo") {
    await auditar("recusada", "proposta séria respondida sem \"confirmo\"; nada foi feito", { pendenciaId: p.id }, ctx);
    return { pendenciaId: p.id, codigos, texto: fraseFaltaConfirmo(funcoes), situacao: "falta_confirmo" };
  }
  // uso ÚNICO: só uma resposta passa daqui (duas ao mesmo tempo: a outra recebe "já fiz")
  const [dono] = await getDb().update(doloresConversaPendencia).set({ situacao: "confirmada", decididaEm: ctx.agora, decididaMensagemId: ctx.mensagemId })
    .where(and(eq(doloresConversaPendencia.id, p.id), eq(doloresConversaPendencia.situacao, "aberta"), sql`${doloresConversaPendencia.venceEm} > ${ctx.agora}`,
      // QA C5-E2 (A1): ainda "na ordem" e com a MESMA hora de envio que foi conferida acima (outra mensagem no meio → não vale)
      eq(doloresConversaPendencia.adjacente, true), eq(doloresConversaPendencia.perguntaEnviadaEm, p.perguntaEnviadaEm!)))
    .returning({ id: doloresConversaPendencia.id });
  if (!dono) {
    const [agoraP] = await getDb().select({ situacao: doloresConversaPendencia.situacao }).from(doloresConversaPendencia).where(eq(doloresConversaPendencia.id, p.id)).limit(1);
    if (agoraP?.situacao === "aberta") return { pendenciaId: p.id, codigos, texto: fraseForaDeOrdem(resumos, nivel), situacao: "fora_de_ordem" };
    return { ...base, texto: FRASE_JA_FEITO, situacao: "ja_feita" };
  }
  await auditar("ok", `o dono respondeu "${c.tipo === "confirmo" ? "confirmo" : "pode"}": executando a proposta`, { pendenciaId: p.id, itens: lista.length, nivel }, ctx);
  const resultados = await decidir(codigos, "aprovar", { via: "whatsapp", userId: null, agora: ctx.agora, mensagemId: ctx.mensagemId, prazoFinal: ctx.prazoFinal, relogio: ctx.relogio, confirmado: c.tipo === "confirmo" });
  const r = await respostaDoResultado(lista, resultados, { ...ctx, venceEm: p.venceEm });
  return { pendenciaId: r.novaId, codigos, texto: r.texto, situacao: "confirmada" };
}

/**
 * A resposta ao dono depois de executar, em voz natural e sem código: "Pronto: …" com o que foi feito; o que não deu, com o motivo.
 * O que ficou esperando por falta de tempo (ou pausa) volta a ser proposta (mesma validade, sem prorrogar).
 */
async function respostaDoResultado(lista: ItemDaPendencia[], rs: ResultadoDecisao[], ctx: Contexto & { venceEm: Date }): Promise<{ texto: string; novaId: number | null }> {
  const porCodigo = new Map(lista.map(i => [i.codigo, i]));
  const feitos: string[] = [];
  const falhas: string[] = [];
  const deNovo: ItemDaPendencia[] = [];
  for (const r of rs) {
    const item = porCodigo.get(r.codigo);
    const natural = semCodigoDoItem(r.natural ?? r.texto);
    if (r.ok) feitos.push(natural.replace(/\.$/, ""));
    else if ((r.situacao === "aguardando" || r.situacao === "bloqueada") && item) deNovo.push(item);
    else falhas.push(`${item ? `"${resumoMostrado(item).slice(0, 120)}"` : "um item"}: ${natural}`);
  }
  const partes: string[] = [];
  let novaId: number | null = null;
  if (feitos.length) partes.push(`Pronto: ${feitos.join("; ")}.`);
  if (falhas.length) partes.push(`Não consegui: ${falhas.join(" ")}`);
  if (deNovo.length) {
    const motivo = rs.find(r => r.situacao === "bloqueada" && porCodigo.has(r.codigo));
    const nova = await abrirComItens(deNovo, { mensagemId: ctx.mensagemId, agora: ctx.agora, autor: ctx.autor, venceEm: ctx.venceEm, restantesFora: 0 }).catch(e => {
      console.error("[dolores/pendencia] falha ao reabrir a proposta", erroParaLog(e)); return null;
    });
    partes.push(motivo ? `${semCodigoDoItem(motivo.natural ?? motivo.texto)}` : FRASE_SEM_TEMPO.replace(" Responda \"pode\" de novo.", ""));
    if (nova) { partes.push(nova.pergunta); novaId = nova.id; }
  }
  return { texto: partes.join("\n") || "Nada foi feito.", novaId };
}
