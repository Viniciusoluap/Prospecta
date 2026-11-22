// EPIC-027 C5 — "tarefa demorada sem travar a conversa" (plano aprovado pelo dono em 21–22/11/2026).
// Story: docs/stories/epics/epic-027-correcoes-20-11-noite/C5-TAREFA-DEMORADA.md.
//
// O pedido SÓ DE LEITURA do dono que não cabe numa resposta (cerebro.ts para com "virou_tarefa", por CÓDIGO: voltas e prazo) é
// gravado aqui; a Dolores responde na hora "Vou levantar isso e te mando em seguida" e a conversa segue livre. Um passo posterior —
// o próximo aviso da Evolution com tempo de sobra (whatsapp.ts) ou o cron da Dolores (rondas.ts), sem cron novo — retoma, conclui e
// manda o resultado SÓ ao número do dono.
//
// Travas (todas por código):
//  - só a conversa direta do dono cria (o único chamador de `criarTarefaDemorada` é whatsapp.ts#tratarComando, depois de conferir
//    o número; grupo, cliente e ponte HTTP nunca chegam lá);
//  - a retomada é SÓ LEITURA (`executarComando({ somenteLeitura: true })`: sem ferramenta de ação, a porta recusa ação, nada vira
//    proposta nem confirma nada; o "pode"/"confirmo" continua só em pendencia.ts, pela mensagem escrita do dono);
//  - pausa geral, interruptor da IA, limite do mês e a parte da conversa (bloqueioAtual + reserva de consumo.ts) valem igual;
//  - limites: MAX_TAREFAS_ABERTAS ao mesmo tempo, MAX_TAREFAS_POR_DIA, MAX_TENTATIVAS_TAREFA e validade (vence e avisa o dono);
//  - idempotência: uma linha por mensagem e cada troca de situação é um UPDATE condicional — só quem trocou segue; a retomada dupla
//    (dois avisos, aviso + cron) não manda duas respostas; quem morre no meio do ENVIO fica "incerta" e não reenvia;
//  - nada de texto nem dado pessoal em log ou auditoria (só ids, contagens e situação); o pedido guardado é apagado ao terminar.
import { and, asc, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { doloresTarefasDemoradas, type DoloresTarefaDemorada } from "../../drizzle/schema-dolores-tarefas.js";
import { doloresWhatsappConfig } from "../../drizzle/schema-dolores-whatsapp.js";
import type { ReferenciaConversa } from "../../drizzle/schema-dolores-conversa.js";
import { sanitizarTexto } from "../../shared/dolores/sanitizar.js";
import { vozDaDolores } from "../../shared/dolores/voz.js";
import { MAX_TEXTO_COMANDO, fraseDeBloqueio, type MotivoBloqueio } from "../../shared/dolores/whatsapp.js";
import { getDb } from "../db.js";
import { registrarAcao } from "./auditoria.js";
import { MAX_VOLTAS_TAREFA, NADA_ALTERADO, executarComando, type PedidoComando } from "./cerebro.js";
import { lerPausa } from "./consumo.js";
import { ehTabelaInexistente } from "./erro-de-banco.js";
import { erroParaLog } from "./erro-seguro.js";
import type { CredencialGrupo } from "./marcacao.js";
import { podeEnviarAvisoAgora } from "./pendencia.js";

/** A tarefa vence (e o dono é avisado) se não for concluída em 30 min. */
export const VALIDADE_TAREFA_MS = 30 * 60_000;
/** Tarefas abertas (aguardando, executando, enviando) ao mesmo tempo. */
export const MAX_TAREFAS_ABERTAS = 2;
/** Tarefas criadas por dia (Imperatriz). */
export const MAX_TAREFAS_POR_DIA = 10;
/** Tentativas de execução por tarefa (a função que morreu no meio conta uma). */
export const MAX_TENTATIVAS_TAREFA = 2;
/** Execução sem fim registrado há mais que isto = a função parou no meio (a da Vercel morre aos 60 s). */
export const EXECUCAO_VENCIDA_MS = 3 * 60_000;
/** Só retoma com ao menos isto de prazo pela frente (laço com várias voltas + envio). */
export const MINIMO_PARA_RETOMAR_MS = 35_000;

/** QA L1: fecho fixo de TODO resultado em segundo plano (a retomada é só leitura), por código — o modelo não o tira. */
export const FECHO_DA_TAREFA = NADA_ALTERADO;
export const FRASE_VOU_LEVANTAR = "Vou levantar isso e te mando em seguida. Pode continuar falando comigo enquanto isso.";
const ABERTAS = ["aguardando", "executando", "enviando"] as const;

const t = doloresTarefasDemoradas;
/** "AAAA-MM-DD" de Imperatriz (UTC−3 fixo). */
export const diaFortaleza = (d: Date) => new Date(d.getTime() - 3 * 60 * 60_000).toISOString().slice(0, 10);
/** "09:05" de Imperatriz (UTC−3 fixo). */
const horaFortaleza = (d: Date) => new Date(d.getTime() - 3 * 60 * 60_000).toISOString().slice(11, 16);

const auditar = (resultado: "ok" | "recusada" | "erro", motivo: string, tarefaId: number | null, resumo: Record<string, unknown> = {}, canal: "whatsapp" | "cron" = "whatsapp") =>
  registrarAcao({ funcao: "tarefa_demorada", resultado, motivo, autorUserId: null, canal, pedidoId: tarefaId ? `tarefa:${tarefaId}` : null, resumo })
    .catch(() => false);

// ── Criação (só whatsapp.ts#tratarComando, na conversa direta do dono) ────────────────────────────────────────────────────

export type ResultadoCriacao = { ok: true; id: number } | { ok: false; motivo: "abertas" | "dia" | "repetida" | "indisponivel" };
/** Frase ao dono quando a tarefa NÃO pôde ser gravada (ele recebe o que deu para levantar, com o porquê). */
export const FRASE_SEM_TAREFA: Record<Exclude<ResultadoCriacao, { ok: true }>["motivo"], string> = {
  abertas: `Já tenho ${MAX_TAREFAS_ABERTAS} levantamentos em andamento; quando terminarem, peça o resto de novo.`,
  dia: `Hoje já fiz ${MAX_TAREFAS_POR_DIA} levantamentos demorados; peça o resto amanhã ou em partes menores.`,
  repetida: "Esse pedido já está sendo levantado.",
  indisponivel: "Não consegui guardar o pedido para terminar depois; peça o resto em partes menores.",
};

/**
 * Grava a tarefa do pedido `mensagemId` (uma por mensagem). Os tetos (abertas ao mesmo tempo e por dia) são conferidos sob a trava
 * da linha de configuração da Dolores (a mesma da reserva do limite), então dois pedidos ao mesmo tempo não passam do teto.
 */
export async function criarTarefaDemorada(p: { mensagemId: number; comando: string; agora: Date }): Promise<ResultadoCriacao> {
  // o mesmo filtro do que vai à IA: sem senhas, tokens, chaves e dados bancários (CPF/telefone que o dono digitou ficam, como na busca)
  const comando = sanitizarTexto(p.comando, { mascararDadosPessoais: false }).trim().slice(0, MAX_TEXTO_COMANDO);
  if (!comando) return { ok: false, motivo: "indisponivel" };
  const dia = diaFortaleza(p.agora);
  try {
    const r = await getDb().transaction(async tx => {
      await tx.execute(sql`SELECT ${doloresWhatsappConfig.id} FROM ${doloresWhatsappConfig} WHERE ${doloresWhatsappConfig.id} = 1 FOR UPDATE`);
      const [abertas] = await tx.select({ n: count() }).from(t).where(inArray(t.situacao, [...ABERTAS]));
      if (Number(abertas?.n ?? 0) >= MAX_TAREFAS_ABERTAS) return { ok: false as const, motivo: "abertas" as const };
      const [hoje] = await tx.select({ n: count() }).from(t).where(eq(t.dia, dia));
      if (Number(hoje?.n ?? 0) >= MAX_TAREFAS_POR_DIA) return { ok: false as const, motivo: "dia" as const };
      const [linha] = await tx.insert(t).values({ mensagemId: p.mensagemId, comando, dia, criadoEm: p.agora, expiraEm: new Date(p.agora.getTime() + VALIDADE_TAREFA_MS) })
        .onConflictDoNothing().returning({ id: t.id });
      return linha ? { ok: true as const, id: linha.id } : { ok: false as const, motivo: "repetida" as const };
    });
    await auditar(r.ok ? "ok" : "recusada", r.ok ? "tarefa demorada criada (pedido só de leitura do dono)" : `tarefa demorada não criada: ${r.motivo}`, r.ok ? r.id : null, { caracteres: comando.length });
    return r;
  } catch (e) {
    // sem a 0153 (código publicado antes da migração) ou falha do banco: o dono recebe o que deu para levantar
    if (!ehTabelaInexistente(e)) console.error("[dolores/tarefa-demorada] falha ao gravar a tarefa", erroParaLog(e));
    return { ok: false, motivo: "indisponivel" };
  }
}

// ── Retomada (próximo aviso da Evolution com tempo, ou o cron) ─────────────────────────────────────────────────────────────

export type DependenciasRetomada = {
  prazoFinal: number;
  canal: "whatsapp" | "cron";
  agora: () => Date;
  ms: () => number;
  /** A porta da chave (whatsapp.ts#bloqueioAtual com a função "dolores_whatsapp": pausa, IA, chave, modelo, limite, parte da conversa). */
  credencial: () => Promise<CredencialGrupo>;
  /** Resposta com o resultado, SÓ ao número do dono (whatsapp.ts#responderAoDono: destino conferido de novo, filtros de saída). */
  responder: (texto: string, ctx: { mensagemId: number; tarefaId: number; referencias: ReferenciaConversa[]; resumo: Record<string, unknown>;
    /** QA L1: fecho fixo do sistema, enviado como quadro (nunca cortado, fora do texto do modelo). */
    fecho: string }) => Promise<boolean>;
  /**
   * A conversa recente do dono (sem a mensagem do pedido) e as lembranças ativas, como no pedido original. Quem lê a memória continua
   * sendo só whatsapp.ts (fronteira de c5-e1-qa-r4 e c5-memoria-longa): este módulo só recebe o que foi lido.
   */
  contexto: (mensagemId: number, agora: Date) => Promise<{ historico: NonNullable<PedidoComando["historico"]>; memoriaLonga: string | null }>;
  /** Aviso curto ao dono (whatsapp.ts#enviarAvisoAoDono: pausa, conexão, número do dono). */
  avisar: (texto: string, ctx: { funcao: string; pedidoId: string; autor: number | null; resumo: Record<string, unknown> }) => Promise<{ ok: boolean }>;
};

export type ResultadoRetomada =
  | "nada" | "sem-tempo" | "pausada" | "proposta-aberta" | "concorrente" | "concluida" | "falhou" | "bloqueada" | "devolvida" | "indisponivel";

const fimDoPedido = (horas: string[]) => (horas.length === 1 ? `que você pediu às ${horas[0]}` : `que você pediu às ${horas.join(", ")}`);
const horasDe = (linhas: Array<{ criadoEm: Date }>) => Array.from(new Set(linhas.map(l => horaFortaleza(new Date(l.criadoEm))))).slice(0, 5);

/**
 * Manutenção (barata, a cada chamada): execução que parou no meio volta para a fila (ou falha, na 2ª tentativa); envio que parou no
 * meio fica "incerta" (não reenvia: pode ter chegado); aguardando que passou da validade vence. Cada troca é um UPDATE condicional
 * que devolve as linhas trocadas: só quem trocou avisa o dono (uma vez).
 */
async function manutencao(d: DependenciasRetomada): Promise<void> {
  const agora = d.agora();
  const db = getDb();
  const vencidaExec = new Date(agora.getTime() - EXECUCAO_VENCIDA_MS);
  await db.update(t).set({ situacao: "aguardando", motivo: "a execução parou no meio; volta para a fila" })
    .where(and(eq(t.situacao, "executando"), lt(t.iniciadaEm, vencidaExec), lt(t.tentativas, MAX_TENTATIVAS_TAREFA)));
  const falharam = await db.update(t).set({ situacao: "falhou", comando: null, concluidaEm: agora, motivo: "a execução parou no meio nas duas tentativas" })
    .where(and(eq(t.situacao, "executando"), lt(t.iniciadaEm, vencidaExec), gte(t.tentativas, MAX_TENTATIVAS_TAREFA)))
    .returning({ id: t.id, criadoEm: t.criadoEm });
  const incertas = await db.update(t).set({ situacao: "incerta", concluidaEm: agora, motivo: "a função parou no meio do envio; não reenviado" })
    .where(and(eq(t.situacao, "enviando"), lt(t.iniciadaEm, vencidaExec))).returning({ id: t.id });
  const vencidas = await db.update(t).set({ situacao: "expirada", comando: null, concluidaEm: agora, motivo: "passou da validade sem ser concluída" })
    .where(and(eq(t.situacao, "aguardando"), lt(t.expiraEm, agora))).returning({ id: t.id, criadoEm: t.criadoEm });
  for (const i of incertas) await auditar("erro", "envio do resultado interrompido: não reenviado (pode ter chegado)", i.id, {}, d.canal);
  for (const f of falharam) await auditar("erro", "tarefa demorada falhou nas duas tentativas", f.id, {}, d.canal);
  for (const v of vencidas) await auditar("erro", "tarefa demorada venceu sem ser concluída", v.id, {}, d.canal);
  const perdidas = [...falharam, ...vencidas];
  if (perdidas.length) {
    await d.avisar(`Dolores: não consegui terminar a tempo o levantamento ${fimDoPedido(horasDe(perdidas))}. Nada foi alterado no sistema; peça de novo, se puder em partes menores.`,
      { funcao: "tarefa_demorada_aviso", pedidoId: `tarefa:${perdidas[0].id}`, autor: null, resumo: { tarefas: perdidas.length, motivo: falharam.length ? "falhou" : "expirada" } });
  }
}

/** Bloqueios que não passam sozinhos em minutos: a tarefa para e o dono é avisado. Os demais (pausa, falha de leitura) esperam. */
const BLOQUEIO_DEFINITIVO: ReadonlySet<string> = new Set(["ia_desligada", "sem_chave", "sem_modelo", "sem_limite", "limite_mensal", "limite_da_funcao", "usuaria_desativada"]);

async function bloquearAguardando(d: DependenciasRetomada, motivo: MotivoBloqueio): Promise<void> {
  const agora = d.agora();
  const linhas = await getDb().update(t).set({ situacao: "bloqueada", comando: null, concluidaEm: agora, motivo: `bloqueada: ${motivo}` })
    .where(eq(t.situacao, "aguardando")).returning({ id: t.id, criadoEm: t.criadoEm });
  if (!linhas.length) return;
  for (const l of linhas) await auditar("recusada", `tarefa demorada bloqueada: ${motivo}`, l.id, {}, d.canal);
  const frase = fraseDeBloqueio(motivo).replace(/^Dolores:\s*/, "");
  await d.avisar(`Dolores: não fiz o levantamento ${fimDoPedido(horasDe(linhas))}. ${frase}`,
    { funcao: "tarefa_demorada_aviso", pedidoId: `tarefa:${linhas[0].id}`, autor: null, resumo: { tarefas: linhas.length, motivo } });
}

/** Devolve a tarefa à fila (ou falha, sem mais tentativas) — só se ainda for a execução DESTA chamada. */
async function devolver(d: DependenciasRetomada, tarefa: DoloresTarefaDemorada, motivo: string, opcoes: { naoConta?: boolean; falhar?: boolean } = {}): Promise<ResultadoRetomada> {
  const agora = d.agora();
  const esgotou = opcoes.falhar === true || (!opcoes.naoConta && tarefa.tentativas >= MAX_TENTATIVAS_TAREFA);
  const [linha] = await getDb().update(t).set(esgotou
    ? { situacao: "falhou", comando: null, concluidaEm: agora, motivo }
    : { situacao: "aguardando", motivo, ...(opcoes.naoConta ? { tentativas: Math.max(0, tarefa.tentativas - 1) } : {}) })
    .where(and(eq(t.id, tarefa.id), eq(t.situacao, "executando"), eq(t.tentativas, tarefa.tentativas))).returning({ id: t.id });
  if (!linha) return "concorrente";
  await auditar("erro", esgotou ? `tarefa demorada falhou: ${motivo}` : `tarefa demorada devolvida à fila: ${motivo}`, tarefa.id, {}, d.canal);
  if (esgotou) {
    await d.avisar(`Dolores: não consegui terminar o levantamento ${fimDoPedido([horaFortaleza(new Date(tarefa.criadoEm))])}. Nada foi alterado no sistema; peça de novo, se puder em partes menores.`,
      { funcao: "tarefa_demorada_aviso", pedidoId: `tarefa:${tarefa.id}`, autor: null, resumo: { motivo: "falhou" } });
    return "falhou";
  }
  return "devolvida";
}

/**
 * Retoma no máximo UMA tarefa nesta chamada. Ordem: manutenção → há tarefa? → prazo → pausa geral → proposta aberta e confirmável
 * na conversa do dono (espera, para não tirar o "pode" de ordem) → porta da chave → reivindica a linha (UPDATE condicional) → laço
 * SÓ DE LEITURA → reivindica o envio (UPDATE condicional) → manda SÓ ao dono. Nunca lança.
 */
export async function retomarTarefaDemorada(d: DependenciasRetomada): Promise<ResultadoRetomada> {
  try {
    await manutencao(d);
    const [proxima] = await getDb().select({ id: t.id }).from(t)
      .where(and(eq(t.situacao, "aguardando"), lt(t.tentativas, MAX_TENTATIVAS_TAREFA))).orderBy(asc(t.id)).limit(1);
    if (!proxima) return "nada";
    if (d.prazoFinal - d.ms() < MINIMO_PARA_RETOMAR_MS) return "sem-tempo";
    const pausa = await lerPausa().catch(() => null);
    if (!pausa || pausa.pausada) return "pausada";
    if (!(await podeEnviarAvisoAgora(d.agora()))) return "proposta-aberta";
    const cred = await d.credencial();
    if (cred.motivo !== null) {
      if (BLOQUEIO_DEFINITIVO.has(cred.motivo)) { await bloquearAguardando(d, cred.motivo as MotivoBloqueio); return "bloqueada"; }
      return cred.motivo === "pausada" ? "pausada" : "indisponivel";
    }
    const agora = d.agora();
    // reivindica a mais antiga: só quem trocar "aguardando" → "executando" segue (dois avisos ao mesmo tempo: um só executa)
    const [tarefa] = await getDb().update(t).set({ situacao: "executando", tentativas: sql`${t.tentativas} + 1`, iniciadaEm: agora, motivo: null })
      .where(and(eq(t.id, proxima.id), eq(t.situacao, "aguardando"), lt(t.tentativas, MAX_TENTATIVAS_TAREFA))).returning();
    if (!tarefa) return "concorrente";
    if (!tarefa.mensagemId || !tarefa.comando) return devolver(d, tarefa, "sem o pedido guardado", { falhar: true });
    await auditar("ok", "tarefa demorada retomada", tarefa.id, { tentativa: tarefa.tentativas }, d.canal);

    let r: Awaited<ReturnType<typeof executarComando>>;
    try {
      // a conversa recente do dono (sem a mensagem do pedido, que vai como o comando) e as lembranças ativas — como no pedido original
      const { historico, memoriaLonga } = await d.contexto(tarefa.mensagemId, agora);
      r = await executarComando({
        comando: tarefa.comando, mensagemId: tarefa.mensagemId, apiKey: cred.apiKey, modelo: cred.modelo, limites: cred.limites, mes: cred.mes,
        prazoFinal: d.prazoFinal, relogio: d.ms, historico, memoriaLonga,
        // SÓ LEITURA: nenhuma ferramenta de ação, a porta recusa ação, nada vira proposta, nada confirma (cerebro.ts)
        somenteLeitura: true, maxVoltas: MAX_VOLTAS_TAREFA,
      });
    } catch (e) {
      console.error("[dolores/tarefa-demorada] falha no laço", erroParaLog(e));
      return devolver(d, tarefa, "falha ao montar o resultado");
    }
    // nada foi feito por causa do limite: outro pedido ocupa a reserva → volta sem contar; limite do mês/da conversa → bloqueia
    if (r.voltas === 0 && r.parou === "outro_pedido") return devolver(d, tarefa, "outro pedido em andamento", { naoConta: true });
    if (r.voltas === 0 && (r.parou === "limite_mensal" || r.parou === "limite_da_conversa")) {
      const motivo: MotivoBloqueio = r.parou === "limite_mensal" ? "limite_mensal" : "limite_da_funcao";
      const back = await devolver(d, tarefa, "limite", { naoConta: true });
      if (back === "devolvida") await bloquearAguardando(d, motivo);
      return back === "devolvida" ? "bloqueada" : back;
    }
    // QA M2: a IA falhou (ou o tempo acabou) sem devolver texto nenhum → volta à fila (respeitando as 2 tentativas); o dono nunca recebe
    // "aqui está o levantamento… não consegui concluir"
    if (!r.respondeu && (r.parou === "erro_modelo" || r.parou === "tempo")) return devolver(d, tarefa, r.parou === "tempo" ? "o tempo acabou sem resposta" : "a IA não respondeu");
    // pausa ligada no meio: não envia; volta (sem contar) para a próxima retomada, se ainda valer
    const pausaAgora = await lerPausa().catch(() => null);
    if (!pausaAgora || pausaAgora.pausada) { await devolver(d, tarefa, "pausa geral no meio da execução", { naoConta: true }); return "pausada"; }
    // reivindica o ENVIO: só esta execução (mesma tentativa, ainda "executando") manda; o pedido guardado sai agora
    const [enviar] = await getDb().update(t).set({ situacao: "enviando", comando: null, voltas: r.voltas, tokensEntrada: r.tokens.entrada, tokensSaida: r.tokens.saida })
      .where(and(eq(t.id, tarefa.id), eq(t.situacao, "executando"), eq(t.tentativas, tarefa.tentativas))).returning({ id: t.id });
    if (!enviar) return "concorrente";
    const voz = vozDaDolores(r.texto);
    const pedido = fimDoPedido([horaFortaleza(new Date(tarefa.criadoEm))]);
    // sem texto do modelo (ex.: recusa), nunca "aqui está o levantamento": vai o aviso fixo do laço
    const texto = r.respondeu ? `Dolores: aqui está o levantamento ${pedido}.\n\n${voz.texto}` : `Dolores: sobre o levantamento ${pedido}: ${voz.texto.replace(/^Dolores:\s*/, "")}`;
    const resumo = { tarefa: tarefa.id, voltas: r.voltas, consultas: r.consultas.length, parou: r.parou, tokensEntrada: r.tokens.entrada, tokensSaida: r.tokens.saida };
    let ok = false;
    try { ok = await d.responder(texto, { mensagemId: tarefa.mensagemId, tarefaId: tarefa.id, referencias: r.referencias, resumo,
      // integração 2 (C5-COM): link/rascunho da maquete que o modelo não repetiu exatamente vão intactos, antes do fecho fixo
      fecho: [...r.anexos, FECHO_DA_TAREFA].join("\n\n") }); }
    catch (e) { console.error("[dolores/tarefa-demorada] falha no envio", erroParaLog(e)); ok = false; }
    // envio com erro pode ter chegado em parte: não reenvia (falhou), o dono pede de novo se faltar
    await getDb().update(t).set({ situacao: ok ? "concluida" : "falhou", concluidaEm: d.agora(), motivo: ok ? null : "o envio do resultado falhou" })
      .where(and(eq(t.id, tarefa.id), eq(t.situacao, "enviando")));
    await auditar(ok ? "ok" : "erro", ok ? "tarefa demorada concluída e enviada ao dono" : "tarefa demorada: o envio do resultado falhou", tarefa.id, resumo, d.canal);
    return ok ? "concluida" : "falhou";
  } catch (e) {
    // sem a 0153 (código antes da migração): nada a retomar, em silêncio
    if (!ehTabelaInexistente(e)) console.error("[dolores/tarefa-demorada] falha na retomada", erroParaLog(e));
    return "indisponivel";
  }
}
