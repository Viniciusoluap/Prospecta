// Central de Vendas (12/11/2026) — distribuição em rodízio entre os operadores da Central e SLA de primeira
// resposta humana (só conta minutos em horário de atendimento). Estouro → reatribuição automática + auditoria.
import { and, desc, eq, gt, isNotNull, isNull, notInArray } from "drizzle-orm";
import { leadActivities, leads, whatsappMessages } from "../../drizzle/schema.js";
import { centralVendasFila, centralVendasLeads } from "../../drizzle/schema-central-vendas.js";
import { emHorarioDeAtendimento, minutosUteisEntre, proximoOperador } from "../../shared/central-vendas/regras.js";
import { agora, avisar, avisarAdmins, carregarConfig, db, dadosDoLead, partesHoje, registrarEvento, usuariosAtivos } from "./base.js";

async function operadoresDisponiveis() {
  const config = await carregarConfig();
  const ativos = await usuariosAtivos(config.operadores);
  return { config, ids: ativos.map(u => u.id) };
}

async function ultimoAtribuido(): Promise<number | null> {
  const [r] = await db().select({ id: centralVendasLeads.operadorId }).from(centralVendasLeads)
    .where(isNotNull(centralVendasLeads.atribuidoEm)).orderBy(desc(centralVendasLeads.atribuidoEm), desc(centralVendasLeads.leadId)).limit(1);
  return r?.id ?? null;
}

/** Rodízio: próximo operador ativo depois do último que recebeu um atendimento. */
export async function atribuirOperador(leadId: number, excluir?: number | null): Promise<number | null> {
  const { config, ids } = await operadoresDisponiveis();
  const escolhido = proximoOperador(ids, await ultimoAtribuido(), excluir);
  if (!escolhido) {
    await registrarEvento({ tipo: "sem_operador", leadId, resultado: "erro", erro: "Nenhum operador ativo marcado na Central." });
    if (await registrarEvento({ tipo: "alerta_sem_operador", chave: `sem-operador:${partesHoje()}` })) {
      await avisarAdmins("Central de Vendas sem operadores", "Há atendimentos sem operador: marque os operadores em Central de Vendas › Configurações.", leadId);
    }
    return null;
  }
  await db().update(centralVendasLeads).set({ operadorId: escolhido, atribuidoEm: agora(), updatedAt: agora() }).where(eq(centralVendasLeads.leadId, leadId));
  // O responsável do CRM (campo já existente) recebe o operador quando ainda está vazio.
  await db().update(leads).set({ responsibleUserId: escolhido, updatedAt: agora() }).where(and(eq(leads.id, leadId), isNull(leads.responsibleUserId)));
  await registrarEvento({ tipo: excluir ? "reatribuido" : "atribuido", leadId, payload: { operadorId: escolhido, foraDoHorario: !emHorarioDeAtendimento(agora(), config.horarioAtendimento) } });
  return escolhido;
}

/** Primeira mensagem humana (não automática) enviada ao lead depois de `desde`. */
async function respostaHumanaDesde(leadId: number, desde: Date): Promise<Date | null> {
  const automaticas = db().select({ id: centralVendasFila.mensagemId }).from(centralVendasFila)
    .where(and(eq(centralVendasFila.leadId, leadId), isNotNull(centralVendasFila.mensagemId)));
  const [m] = await db().select({ em: whatsappMessages.createdAt }).from(whatsappMessages).where(and(
    eq(whatsappMessages.leadId, leadId), eq(whatsappMessages.direcao, "saida"), gt(whatsappMessages.createdAt, desde),
    notInArray(whatsappMessages.id, automaticas as never),
  )).orderBy(whatsappMessages.createdAt).limit(1);
  return m?.em ?? null;
}

/** Verifica o SLA de quem espera atendimento humano: respondeu → registra; estourou → reatribui. */
export async function verificarSla() {
  const { config, ids } = await operadoresDisponiveis();
  const esperando = await db().select().from(centralVendasLeads).where(and(
    eq(centralVendasLeads.statusAtendimento, "em_atendimento_humano"), isNotNull(centralVendasLeads.aguardandoHumanoDesde),
    isNull(centralVendasLeads.primeiraRespostaHumanaEm),
  ));
  const resumo = { respondidos: 0, reatribuidos: 0, estourados: 0 };
  for (const cv of esperando) {
    const desde = cv.aguardandoHumanoDesde!;
    const respondeu = await respostaHumanaDesde(cv.leadId, desde);
    if (respondeu) {
      await db().update(centralVendasLeads).set({ primeiraRespostaHumanaEm: respondeu, updatedAt: agora() }).where(eq(centralVendasLeads.leadId, cv.leadId));
      await registrarEvento({ tipo: "primeira_resposta_humana", leadId: cv.leadId, payload: { operadorId: cv.operadorId, minutosUteis: minutosUteisEntre(desde, respondeu, config.horarioAtendimento) } });
      resumo.respondidos++;
      continue;
    }
    if (minutosUteisEntre(desde, agora(), config.horarioAtendimento) < config.slaMinutos) continue;
    resumo.estourados++;
    const outro = proximoOperador(ids, cv.operadorId, cv.operadorId);
    if (!outro) {
      if (await registrarEvento({ tipo: "sla_estourado", leadId: cv.leadId, payload: { operadorId: cv.operadorId, semOutroOperador: true }, resultado: "erro", chave: `sla:${cv.leadId}:${desde.toISOString()}` })) {
        await avisarAdmins("Central de Vendas: SLA estourado", "Um atendimento passou do SLA de primeira resposta e não há outro operador para reatribuir.", cv.leadId);
      }
      continue;
    }
    // Reivindica pela data de espera: duas rodadas simultâneas não reatribuem duas vezes.
    const r = await db().update(centralVendasLeads).set({ operadorId: outro, atribuidoEm: agora(), aguardandoHumanoDesde: agora(), updatedAt: agora() })
      .where(and(eq(centralVendasLeads.leadId, cv.leadId), eq(centralVendasLeads.aguardandoHumanoDesde, desde))).returning({ id: centralVendasLeads.leadId });
    if (!r.length) continue;
    await db().update(leads).set({ responsibleUserId: outro, updatedAt: agora() }).where(eq(leads.id, cv.leadId));
    await registrarEvento({ tipo: "sla_reatribuido", leadId: cv.leadId, payload: { de: cv.operadorId, para: outro, slaMinutos: config.slaMinutos } });
    await db().insert(leadActivities).values({ leadId: cv.leadId, type: "handoff", description: `SLA de primeira resposta (${config.slaMinutos} min) estourado: atendimento reatribuído automaticamente.`, performedBy: "Central de Vendas" });
    const lead = await dadosDoLead(cv.leadId);
    await avisar([outro], "Central de Vendas: atendimento reatribuído para você", `${lead?.name ?? "Cliente"} aguarda resposta (SLA estourado com o operador anterior).${cv.resumoTransferencia ? `\n\nResumo: ${cv.resumoTransferencia}` : ""}`, cv.leadId);
    resumo.reatribuidos++;
  }
  return resumo;
}
