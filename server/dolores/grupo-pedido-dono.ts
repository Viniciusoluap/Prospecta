// EPIC-027 C5 (E3, "registrar a partir do grupo") — o DONO pede, dentro de um grupo, para a Dolores REGISTRAR algo (anotação no
// cliente do grupo, nota de obra, documento ou orçamento do grupo). Decisão do dono (CLAUDE.md, 21/11/2026, itens 4 e 5): "A partir
// de grupo: só quando o número do dono pede, e só para REGISTRAR; o grupo vê uma frase curta ('Anotado.')". Chamado por
// `tratarMarcacao` (marcacao.ts) logo depois de achar o grupo cadastrado e ativo, ANTES do escopo e dos interruptores do grupo.
//
// Regras fixas (todas por CÓDIGO; nunca pela IA, que nem é chamada aqui):
// - Precisa estar MARCANDO a Dolores (menção real) E ser o dono: `key.participant` = número do dono, ou um @lid que a lista de
//   participantes do SERVIDOR do WhatsApp (Evolution) liga ao número do dono. Nome exibido, participantPn/Alt, texto: nunca.
//   Sem prova → `null` (segue a marcação comum, como qualquer participante: o pedido nunca vira comando).
// - Só a lista fechada de registros (`ACOES_DO_GRUPO`), com o alvo travado no próprio grupo (o cliente/obra dele; a mensagem citada
//   ou a última mídia DESTE grupo). Texto de outras pessoas do grupo é DADO: pode virar o conteúdo da anotação, nunca instrução,
//   destino ou ação. Pedido sério (dinheiro, mensagem a terceiro, configuração de grupo, apagar, tarefa) → recusa curta no grupo e
//   orientação no privado; nada é feito.
// - Nada executa aqui: o pedido vira a MESMA proposta da E2 (dolores_aprovacoes + dolores_conversa_pendencia) e a pergunta vai ao
//   dono no PRIVADO; só o "pode" dele na conversa direta executa (um "pode" escrito em grupo nunca chega a `tratarConfirmacao`). Se
//   alguém conseguir se passar pelo dono, ele recebe uma pergunta que não fez — e nada acontece sem a resposta dele.
// - O grupo vê só "Anotado." (frase fixa, sem dado), e só com a resposta da Dolores ligada naquele grupo; o detalhe (o que, onde)
//   vai só ao dono. Com a resposta desligada, o pedido continua valendo (a proposta vai ao privado) e o grupo não vê nada.
// - Grupo recusado, aguardando o dono, sem tipo ou sem vínculo: nada é registrado e o dono é avisado no privado.
// - Pausa geral / conta da Dolores desativada: nada (nem frase, nem aviso). Tetos: 20 pedidos/dia (todos os grupos) e o teto diário
//   de marcações do grupo. Reentrega do mesmo aviso: uma vez só (chave por id da mensagem). Auditoria `grupo_pedido_do_dono` (grupo,
//   tipo do pedido, desfecho — sem texto nem número).
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { doloresGrupoMensagens, type DoloresGrupo } from "../../drizzle/schema-dolores-grupos.js";
import { doloresMarcacoesContagem, type SituacaoMarcacao } from "../../drizzle/schema-dolores-marcacoes.js";
import { obraNotas } from "../../drizzle/schema-dolores-notas.js";
import type { DoloresWhatsappConfig } from "../../drizzle/schema-dolores-whatsapp.js";
import { nivelDoItem, VALIDADE_ITEM_CONFIRMAVEL_MS } from "../../shared/dolores/confirmacao.js";
import {
  FRASE_ANOTADO, FRASE_SO_NO_PRIVADO, JANELA_MIDIA_MS, MAX_CONSULTAS_LID_DONO_HORA, MAX_PEDIDOS_DONO_DIA, idDaMensagemCitada, lerPedidoDoDono, remetenteDoGrupo,
  type PedidoDoDono,
} from "../../shared/dolores/grupo-pedido-dono.js";
import { diaDeImperatriz, diaHoraCurta } from "../../shared/dolores/grupos.js";
import { lerParticipante, tipoEfetivo } from "../../shared/dolores/grupos-tipo.js";
import { marcacaoFresca, MAX_PERGUNTA } from "../../shared/dolores/marcacao.js";
import { ehNumeroDoDono } from "../../shared/dolores/whatsapp.js";
import { metadadoDoGrupoEvolution, participantesDoGrupoEvolution } from "../_core/evolution.js";
import { getDb } from "../db.js";
import { porNaFila } from "./aprovacoes.js";
import { RecusaAcao, resumoDaFila, type ContextoAcao, type Preparo } from "./acoes/comum.js";
import { mostrar } from "./acoes/grupos.js";
import { acaoPorNome } from "./acoes/registro.js";
import { registrarAcao } from "./auditoria.js";
import { erroParaLog } from "./erro-seguro.js";
import { podeFalarNoGrupo } from "./operacao.js";
import { abrirPendenciaDosCodigos, cancelarPendencia } from "./pendencia.js";
import { funcaoLiberada } from "./permissoes.js";
import { usuarioDolores } from "./perfil.js";

/** Os ÚNICOS registros que o dono pode pedir a partir de um grupo (todos de nível "registro": um "pode" no privado). */
export const ACOES_DO_GRUPO = ["registrar_acompanhamento", "salvar_documentos_grupo", "salvar_nota_obra"] as const;
/** Tempo mínimo que precisa sobrar no aviso para tratar o pedido (preparar + perguntar no privado + frase no grupo). */
export const MINIMO_PEDIDO_DONO_MS = 8_000;

export type MarcacaoDoDono = { externalId: string; grupoJid: string; pergunta: string; enviadaEm: Date | null };
/** O que só `tratarMarcacao` sabe fazer: gravar a linha em dolores_marcacoes e o envio único ao grupo (`responderNoGrupo`). */
export type GanchosDoGrupo = {
  registrar: (situacao: SituacaoMarcacao, motivo: string) => Promise<number | null>;
  falar: (marcacaoId: number, texto: string) => Promise<boolean>;
};

// ── Contadores (a mesma tabela e a mesma forma atômica de marcacao.ts) ──

async function vagaNoContador(chave: string, teto: number): Promise<boolean> {
  const [r] = await getDb().insert(doloresMarcacoesContagem).values({ chave, total: 1 })
    .onConflictDoUpdate({ target: doloresMarcacoesContagem.chave, set: { total: sql`${doloresMarcacoesContagem.total} + 1`, ultimaEm: sql`now()` },
      setWhere: sql`${doloresMarcacoesContagem.total} < ${teto}` })
    .returning({ total: doloresMarcacoesContagem.total });
  return !!r;
}
async function primeiraVez(chave: string): Promise<boolean> {
  const r = await getDb().insert(doloresMarcacoesContagem).values({ chave, total: 1 }).onConflictDoNothing().returning({ chave: doloresMarcacoesContagem.chave });
  return r.length === 1;
}

// ── Quem pediu: o dono, provado pelo servidor ──

/** Prova do @lid do dono vale por 10 min nesta instância (só positiva; muda o número do dono ou o grupo → outra chave). */
const PROVA_DO_LID_MS = 10 * 60_000;
const provasDoLid = new Map<string, number>();
/** Só para testes: esquece as provas de @lid guardadas. */
export function esquecerProvasDoLid() { provasDoLid.clear(); }

/**
 * O remetente desta mensagem de grupo é o DONO? Número: comparação estrita (a mesma da conversa direta) e nunca o número da própria
 * Dolores. @lid: só se a lista de participantes da Evolution (fonte do servidor do WhatsApp; primeiro `/group/participants`, depois
 * os dados do grupo) trouxer esse @lid com UM número e ele for o do dono. Grupo recusado: só o número (não consulta participantes
 * de grupo que ela não lê). Na dúvida, não.
 */
export async function remetenteEhODono(cfg: DoloresWhatsappConfig, grupo: DoloresGrupo, item: unknown, o: { prazoFinal: number; ms: () => number; agora: Date }): Promise<boolean> {
  const r = remetenteDoGrupo(item);
  if (!r || !cfg.numeroDono || !cfg.instancia) return false;
  if (r.numero) return ehNumeroDoDono(r.numero, cfg.numeroDono) && !ehNumeroDoDono(r.numero, cfg.numeroDolores);
  if (grupo.situacaoConfirmacao === "recusado") return false;
  // prova recente (desta instância) do mesmo @lid para o MESMO número do dono: não consulta de novo (e um terceiro que gaste as
  // consultas da hora não cala o dono)
  const chaveDaProva = `${cfg.numeroDono}|${grupo.id}|${r.lid}`;
  const provada = provasDoLid.get(chaveDaProva);
  if (provada && o.ms() - provada < PROVA_DO_LID_MS) return true;
  const restante = o.prazoFinal - o.ms() - MINIMO_PEDIDO_DONO_MS;
  if (restante < 1_500) return false;
  if (!(await vagaNoContador(`pd-lid:${grupo.id}:${o.agora.toISOString().slice(0, 13)}`, MAX_CONSULTAS_LID_DONO_HORA).catch(() => false))) return false;
  const { configEvolution } = await import("../whatsapp-router.js");
  const configurada = await configEvolution().catch(() => null);
  if (!configurada) return false;
  // QA E4 r2 N4: a chamada recusa redirecionamento (o apikey não vai a outro host)
  const evo = { ...configurada, semRedirecionamento: true };
  const fim = o.ms() + Math.min(5_000, restante);
  const numeros = new Set<string>();
  try {
    for (const p of await participantesDoGrupoEvolution(evo, cfg.instancia, grupo.grupoJid, fetch, Math.max(1_000, fim - o.ms()))) if (p.lid === r.lid && p.numero) numeros.add(p.numero);
  } catch { /* tenta a outra rota */ }
  if (!numeros.size && fim - o.ms() >= 1_000) {
    try {
      const meta = await metadadoDoGrupoEvolution(evo, cfg.instancia, grupo.grupoJid, fetch, Math.max(1_000, fim - o.ms()));
      for (const p of (meta?.participantes ?? []).map(lerParticipante)) if (p.lid === r.lid && p.numero) numeros.add(p.numero);
    } catch { /* sem prova */ }
  }
  if (numeros.size !== 1) return false;
  const [n] = Array.from(numeros);
  const ok = ehNumeroDoDono(n, cfg.numeroDono) && !ehNumeroDoDono(n, cfg.numeroDolores);
  if (ok) { if (provasDoLid.size > 500) provasDoLid.clear(); provasDoLid.set(chaveDaProva, o.ms()); } else provasDoLid.delete(chaveDaProva);
  return ok;
}

// ── O alvo, travado no próprio grupo ──

type MensagemDoGrupo = typeof doloresGrupoMensagens.$inferSelect;
const ehMidia = (x: Pick<MensagemDoGrupo, "tipo">) => x.tipo === "imagem" || x.tipo === "documento";

/** A mensagem citada (só se for DESTE grupo), a própria mensagem (se for mídia com legenda) ou a última mídia do grupo nas últimas 2 h. */
async function alvoDoPedido(grupo: DoloresGrupo, item: unknown, m: MarcacaoDoDono, agora: Date): Promise<{ alvo: MensagemDoGrupo } | { erro: string }> {
  const db = getDb();
  const citada = idDaMensagemCitada(item);
  if (citada) {
    const [c] = await db.select().from(doloresGrupoMensagens)
      .where(and(eq(doloresGrupoMensagens.grupoId, grupo.id), eq(doloresGrupoMensagens.instancia, grupo.instancia), eq(doloresGrupoMensagens.externalId, citada))).limit(1);
    return c ? { alvo: c } : { erro: "não achei a mensagem que você respondeu entre as mensagens deste grupo que eu guardei" };
  }
  const [propria] = await db.select().from(doloresGrupoMensagens)
    .where(and(eq(doloresGrupoMensagens.grupoId, grupo.id), eq(doloresGrupoMensagens.instancia, grupo.instancia), eq(doloresGrupoMensagens.externalId, m.externalId))).limit(1);
  if (propria && ehMidia(propria)) return { alvo: propria };
  const [ultima] = await db.select().from(doloresGrupoMensagens)
    .where(and(eq(doloresGrupoMensagens.grupoId, grupo.id), inArray(doloresGrupoMensagens.tipo, ["imagem", "documento"]), gte(doloresGrupoMensagens.criadoEm, new Date(agora.getTime() - JANELA_MIDIA_MS))))
    .orderBy(desc(doloresGrupoMensagens.id)).limit(1);
  return ultima ? { alvo: ultima } : { erro: "não achei nenhum arquivo recente neste grupo; responda à mensagem do arquivo com o pedido" };
}

type Escolha = { funcao: (typeof ACOES_DO_GRUPO)[number]; argumentos: Record<string, unknown>; rotulo: string } | { erro: string };

/** Qual registro e com quais argumentos — o cliente/obra vêm do GRUPO (servidor), nunca do texto. */
async function escolherAcao(grupo: DoloresGrupo, pedido: Extract<PedidoDoDono, { tipo: "anotar" | "salvar" }>, item: unknown, m: MarcacaoDoDono, agora: Date): Promise<Escolha> {
  const semCliente = "esse grupo não está ligado a um cliente do CRM (a anotação fica no histórico do cliente)";
  const anotacao = (texto: string): Escolha => (grupo.leadId
    ? { funcao: "registrar_acompanhamento", argumentos: { leadId: grupo.leadId, texto, tipo: "anotacao" }, rotulo: "anotação" } : { erro: semCliente });
  if (pedido.tipo === "anotar") {
    if (pedido.texto) return anotacao(pedido.texto);
    // "anota isso" respondendo a uma mensagem: o texto citado (de quem for) é o CONTEÚDO da anotação — dado, nunca instrução
    const citada = idDaMensagemCitada(item);
    if (!citada) return { erro: "faltou o texto: escreva \"anota:\" e o que anotar, ou responda à mensagem que quer anotar" };
    const r = await alvoDoPedido(grupo, item, m, agora);
    if ("erro" in r) return r;
    if (ehMidia(r.alvo)) return { erro: "a mensagem que você respondeu é um arquivo; para guardar, peça \"salva esse documento\"" };
    if (!r.alvo.texto?.trim()) return { erro: "a mensagem que você respondeu não tem texto que eu possa anotar" };
    return anotacao(`Mensagem do grupo de ${diaHoraCurta(r.alvo.enviadaEm ?? r.alvo.criadoEm)}: "${r.alvo.texto.trim().slice(0, 900)}"`);
  }
  const r = await alvoDoPedido(grupo, item, m, agora);
  if ("erro" in r) return r;
  const alvo = r.alvo;
  if (!ehMidia(alvo)) {
    if (alvo.texto?.trim()) return anotacao(`Mensagem do grupo de ${diaHoraCurta(alvo.enviadaEm ?? alvo.criadoEm)}: "${alvo.texto.trim().slice(0, 900)}"`);
    return { erro: "a mensagem que você respondeu não é um arquivo" };
  }
  const [nota] = await getDb().select({ id: obraNotas.id }).from(obraNotas).where(and(eq(obraNotas.mensagemId, alvo.id), eq(obraNotas.grupoId, grupo.id))).limit(1);
  if (nota) return { funcao: "salvar_nota_obra", argumentos: { notaId: nota.id }, rotulo: "nota de obra" };
  if (grupo.leadId && !grupo.obraId) {
    return { funcao: "salvar_documentos_grupo", argumentos: { grupoId: grupo.id, mensagemIds: [alvo.id] }, rotulo: pedido.objeto === "orcamento" ? "orçamento" : "documento" };
  }
  if (grupo.obraId) return { erro: "ainda não li esse arquivo como nota da obra (ou ele não é nota); peça de novo daqui a alguns minutos" };
  return { erro: semCliente };
}

// ── A proposta (a mesma da E2; nada executa aqui) ──

type Proposta = { pendenciaId: number; pergunta: string } | { erro: string };

async function proporRegistro(e: Extract<Escolha, { funcao: string }>, nomeGrupo: string, o: { agora: Date; pedidoId: string }): Promise<Proposta> {
  const acao = acaoPorNome(e.funcao);
  if (!acao || !funcaoLiberada(e.funcao) || !(ACOES_DO_GRUPO as readonly string[]).includes(acao.nome)) return { erro: "esse registro não está liberado agora" };
  const args = acao.entrada.safeParse(e.argumentos);
  if (!args.success) return { erro: "o texto não serve para anotação (de 3 a 1.000 caracteres)" };
  const autorId = await usuarioDolores();
  const ctx: ContextoAcao = { agora: o.agora, autorId, mensagemId: null, pedidoId: o.pedidoId, aprovacaoId: null, motivoContaminacao: null, validadeFilaMs: VALIDADE_ITEM_CONFIRMAVEL_MS };
  let preparo: Preparo;
  try {
    preparo = acao.nivel === "direto" ? { itens: [await acao.paraFila!(args.data as never, ctx)], recusados: [] } : await acao.preparar!(args.data as never, ctx);
  } catch (x) {
    if (x instanceof RecusaAcao) return { erro: x.message.replace(/\s*Nada foi posto na fila\.?/g, "").slice(0, 300) };
    throw x;
  }
  // de onde veio o pedido, no começo do resumo que ele confirma (o nome do grupo na forma mostrada; o hash cobre o resumo inteiro)
  const itens = preparo.itens.slice(0, 3).map(i => ({ ...i, resumo: resumoDaFila(`Pedido seu no grupo "${nomeGrupo}": ${i.resumo}`) }));
  // defesa em profundidade: só registro (um "pode"); qualquer coisa que o código considere séria não sai daqui
  if (itens.some(i => nivelDoItem(acao.nome, i.argumentos) !== "registro")) return { erro: "isso precisa de confirmação por escrito; peça na nossa conversa" };
  if (!itens.length) return { erro: preparo.recusados.map(r => r.motivo).join("; ").slice(0, 300) || "não havia o que registrar" };
  const criados = await porNaFila(acao.nome, { itens, recusados: preparo.recusados }, ctx);
  const p = await abrirPendenciaDosCodigos({ codigos: criados.map(c => c.codigo), agora: o.agora, autor: autorId, pedidoId: o.pedidoId });
  if (!p) return { erro: "não consegui montar a proposta agora; peça de novo" };
  return { pendenciaId: p.id, pergunta: p.pergunta };
}

// ── O pedido ──

const TEXTO_PEDIDO = "você me pediu para registrar algo";

/**
 * Trata o possível pedido do DONO dentro de um grupo. Devolve a chave do desfecho (para o quadro do aviso) ou null = não é pedido
 * do dono (ou não dá para provar): `tratarMarcacao` segue o caminho comum, como para qualquer participante.
 */
export async function tratarPedidoDoDono(cfg: DoloresWhatsappConfig, item: unknown, grupo: DoloresGrupo, m: MarcacaoDoDono,
  o: { autor: number | null; prazoFinal: number; agora: Date; ms: () => number }, g: GanchosDoGrupo): Promise<string | null> {
  const pedido = lerPedidoDoDono(m.pergunta);
  if (!pedido || !cfg.instancia || !cfg.numeroDono) return null;
  if (o.prazoFinal - o.ms() < MINIMO_PEDIDO_DONO_MS) return null;
  if (!(await remetenteEhODono(cfg, grupo, item, o).catch(() => false))) return null;

  const marcacao = await import("./marcacao.js");
  const conf = await marcacao.lerConfigMarcacoes();
  if (!marcacaoFresca(m.enviadaEm, o.agora, conf.janelaFrescorSegundos)) return "pedido-dono-antigo";
  // reentrega do mesmo aviso (ou dois avisos ao mesmo tempo): só o primeiro trata
  if (!(await primeiraVez(`pd:${grupo.instancia}:${m.externalId.slice(0, 120)}`))) return "pedido-dono-repetido";

  const pedidoId = `grupo:${grupo.id}:pedido-dono:${m.externalId.slice(0, 60)}`;
  const nomeGrupo = mostrar(grupo.nome, 60, `grupo ${grupo.id}`);
  const auditar = (resultado: "ok" | "recusada" | "erro", desfecho: string, motivo: string) =>
    registrarAcao({ funcao: "grupo_pedido_do_dono", resultado, motivo, autorUserId: o.autor, canal: "whatsapp", pedidoId,
      resumo: { grupoId: grupo.id, pedido: pedido.tipo, desfecho } }).catch(() => false);
  const { enviarAvisoAoDono } = await import("./whatsapp.js");
  const avisar = (texto: string, pendenciaId: number | null = null) =>
    enviarAvisoAoDono(texto, { funcao: "pedido_no_grupo", pedidoId, autor: o.autor, prazoFinal: o.prazoFinal, canal: "whatsapp", resumo: { grupoId: grupo.id }, pendenciaId })
      .catch(e => { console.error("[dolores/grupo-pedido-dono] falha ao avisar o dono", erroParaLog(e)); return { ok: false, motivo: "erro" }; });
  const respostaLigada = async () => !marcacao.marcacaoPausadaPorFalha() && conf.responderLigado && (await marcacao.grupoLigado(grupo).catch(() => false));
  const nada = async (desfecho: string, motivo: string, aviso: string | null, situacao: SituacaoMarcacao | null = "silencio") => {
    if (situacao) await g.registrar(situacao, `pedido do dono no grupo: ${motivo}`.slice(0, 200)).catch(() => null);
    if (aviso) await avisar(aviso);
    await auditar("recusada", desfecho, motivo);
    return `pedido-dono-${desfecho}`;
  };

  // pausa geral / conta da Dolores desativada: nada (nem frase, nem aviso)
  if (!(await podeFalarNoGrupo())) return nada("pausada", "Dolores pausada (pausa geral ou conta desativada)", null);
  // grupo que ela não lê, ou que ainda não sabe de quem é: nada registrado, só o aviso no privado
  if (grupo.situacaoConfirmacao === "recusado") {
    return nada("grupo-recusado", "grupo recusado (outra pessoa colocou a Dolores)",
      `No grupo "${nomeGrupo}" ${TEXTO_PEDIDO}, mas eu não leio esse grupo: não foi você quem me colocou nele. Se quiser que eu passe a ler, me peça aqui para aceitar o grupo. Nada foi registrado.`, null);
  }
  if (grupo.situacaoConfirmacao === "aguardando_dono" || tipoEfetivo(grupo) === "indefinido") {
    return nada("grupo-aguardando", "grupo aguardando o dono definir o tipo",
      `No grupo "${nomeGrupo}" ${TEXTO_PEDIDO}, mas ainda não sei de quem é esse grupo. Me diga aqui de qual cliente ou obra ele é e depois peça de novo. Nada foi registrado.`);
  }
  if (pedido.tipo === "serio") {
    const id = await g.registrar("fora_de_escopo", `pedido do dono no grupo que só se faz na conversa direta (${pedido.motivo})`).catch(() => null);
    if (id && (await respostaLigada())) await g.falar(id, FRASE_SO_NO_PRIVADO).catch(() => false);
    await avisar(`No grupo "${nomeGrupo}" você me pediu algo que eu não faço a partir de grupo (${pedido.motivo}). Lá eu só registro o que você pedir: anotação no cliente, nota, documento ou orçamento. Se quiser, me peça aqui na nossa conversa. Nada foi feito.`);
    await auditar("recusada", "serio", `pedido sério feito no grupo: ${pedido.motivo}; nada foi feito`);
    return "pedido-dono-serio";
  }
  if (pedido.tipo === "nao_entendi") {
    return nada("nao-entendi", "pedido de registro sem dizer o quê",
      `No grupo "${nomeGrupo}" não entendi o que registrar. Lá eu entendo, por exemplo, "anota: o cliente entregou a matrícula" ou, respondendo à foto do recibo, "salva essa nota". Nada foi registrado.`);
  }
  // o texto do grupo chega cortado em MAX_PERGUNTA (+1 de sentinela): pedido maior viraria registro incompleto. Recusa e avisa.
  if (m.pergunta.length > MAX_PERGUNTA) {
    return nada("texto-longo", `pedido de registro com mais de ${MAX_PERGUNTA} caracteres`,
      `No grupo "${nomeGrupo}" ${TEXTO_PEDIDO}, mas o texto passou de ${MAX_PERGUNTA} caracteres e eu não leria até o fim. Mande mais curto lá, ou me peça aqui na nossa conversa. Nada foi registrado.`);
  }
  // tetos: pedidos do dono por dia (todos os grupos) e o teto diário de marcações do grupo
  const dia = diaDeImperatriz(o.agora);
  if (!(await vagaNoContador(`pd-dia:${dia}`, MAX_PEDIDOS_DONO_DIA))) {
    return nada("teto-dia", `teto de ${MAX_PEDIDOS_DONO_DIA} pedidos do dono por dia pelos grupos`,
      `Hoje já recebi ${MAX_PEDIDOS_DONO_DIA} pedidos seus pelos grupos, o meu limite do dia. O de "${nomeGrupo}" ficou sem registrar; se quiser, me peça aqui.`);
  }
  if (!(await vagaNoContador(`g:${grupo.id}:${dia}`, conf.tetoGrupoDia))) {
    return nada("teto-grupo", `teto de ${conf.tetoGrupoDia} marcações no grupo hoje`,
      `O grupo "${nomeGrupo}" já passou do limite de pedidos de hoje. O seu ficou sem registrar; se quiser, me peça aqui.`);
  }
  try {
    const e = await escolherAcao(grupo, pedido, item, m, o.agora);
    if ("erro" in e) return nada("sem-registro", "não deu para montar o registro", `No grupo "${nomeGrupo}" ${TEXTO_PEDIDO}, mas não deu: ${e.erro}. Nada foi registrado.`);
    const p = await proporRegistro(e, nomeGrupo, { agora: o.agora, pedidoId });
    if ("erro" in p) return nada("sem-registro", `registro recusado (${e.funcao})`, `No grupo "${nomeGrupo}" ${TEXTO_PEDIDO}, mas não deu: ${p.erro.replace(/[.\s]+$/, "")}. Nada foi registrado.`);
    const ligada = await respostaLigada();
    const enviado = await avisar(`No grupo "${nomeGrupo}" você me pediu para registrar isto (${ligada ? `lá eu só respondi "${FRASE_ANOTADO}"` : "lá eu não respondi nada: a minha resposta está desligada nesse grupo"}; o detalhe fica aqui):\n${p.pergunta}`, p.pendenciaId);
    if (!enviado.ok) {
      // a pergunta não chegou: a proposta não vale (nada fica esperando um "pode" que ele não viu) e o grupo não ouve "Anotado."
      await cancelarPendencia(p.pendenciaId, o.agora);
      await g.registrar("erro", "pedido do dono no grupo: a pergunta não chegou ao privado; nada foi registrado").catch(() => null);
      await auditar("erro", "sem-aviso", `a pergunta ao dono não foi enviada (${e.funcao}); proposta cancelada`);
      return "pedido-dono-sem-aviso";
    }
    const id = await g.registrar("respondida", `pedido do dono no grupo: ${e.rotulo} proposto no privado (espera o "pode")`).catch(() => null);
    if (id && ligada) await g.falar(id, FRASE_ANOTADO).catch(() => false);
    await auditar("ok", "proposto", `${e.funcao}: proposta aberta no privado do dono; nada executa sem o "pode" dele`);
    return "pedido-dono-proposto";
  } catch (x) {
    console.error("[dolores/grupo-pedido-dono] falha ao tratar o pedido do dono", erroParaLog(x));
    await auditar("erro", "erro", `falha inesperada (${erroParaLog(x)}); nada foi registrado`);
    return "pedido-dono-erro";
  }
}
