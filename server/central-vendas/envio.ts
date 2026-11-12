// Central de Vendas (12/11/2026) — fila de envio e reprocessamento (central_vendas_fila). Toda mensagem
// automática passa por aqui: idempotência pela chave única, proteções (opt-out, modo de teste, janela 8h–20h,
// limite diário, intervalo aleatório) e nova tentativa com backoff. Nunca reenvia o que já saiu.
import { and, asc, count, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { users, whatsappConnections, whatsappMessages } from "../../drizzle/schema.js";
import { centralVendasFila, centralVendasLeads, type CentralVendasJob } from "../../drizzle/schema-central-vendas.js";
import type { ConfigCentral } from "../../shared/central-vendas/config.js";
import {
  MAX_TENTATIVAS, backoffMinutos, bloqueioEnvio, inicioDoDiaFortaleza, preencher, proximaAberturaJanela,
} from "../../shared/central-vendas/regras.js";
import {
  agora, avisarAdmins, carregarConfig, dadosDoLead, db, dependencias, erroSeguro, primeiroNome, registrarEvento,
  registroCentral, segredo, textoTemplate, type ResultadoEnvio,
} from "./base.js";

type PayloadMensagem = { texto: string; template?: string; ignorarOptOut?: boolean };

export async function enfileirar(p: { chave: string; tipo?: "mensagem" | "ia"; leadId: number | null; numero?: string | null; proativa?: boolean; payload: Record<string, unknown>; quando?: Date }) {
  const [job] = await db().insert(centralVendasFila).values({
    chave: p.chave.slice(0, 200), tipo: p.tipo ?? "mensagem", leadId: p.leadId, numero: p.numero?.replace(/\D/g, "") ?? null,
    proativa: Boolean(p.proativa), payload: JSON.stringify(p.payload), proximaTentativaEm: p.quando ?? agora(), createdAt: agora(), updatedAt: agora(),
  }).onConflictDoNothing().returning();
  return job ?? null;
}

/** Monta o texto do template para o lead (nome, operador, documentos) e põe na fila. */
export async function enfileirarTemplate(p: { leadId: number; slug: string; chave: string; proativa: boolean; documentos?: string; ignorarOptOut?: boolean }) {
  const lead = await dadosDoLead(p.leadId);
  if (!lead || lead.deletedAt) return null;
  const cv = await registroCentral(p.leadId);
  const modelo = await textoTemplate(p.slug);
  if (!modelo) {
    await registrarEvento({ tipo: "template_ausente", leadId: p.leadId, payload: { template: p.slug }, resultado: "erro" });
    return null;
  }
  const opId = cv?.operadorId ?? lead.responsibleUserId;
  const [op] = opId ? await db().select({ nome: users.name }).from(users).where(eq(users.id, opId)).limit(1) : [];
  const texto = preencher(modelo, { nome: primeiroNome(lead.name), corretor: op?.nome?.split(/\s+/)[0] || "nossa equipe", documentos: p.documentos ?? "" })
    .replace(/^,\s*/, "").replace(/^([a-zà-ú])/, c => c.toUpperCase());
  return enfileirar({ chave: p.chave, leadId: p.leadId, numero: lead.phone, proativa: p.proativa, payload: { texto, template: p.slug, ignorarOptOut: p.ignorarOptOut } satisfies PayloadMensagem });
}

/** Envio padrão: Logyca (se ligada para envio) ou a conexão Evolution (QR code) da empresa. */
async function enviarPadrao(p: { numero: string; texto: string; connectionId: number | null; config: ConfigCentral }): Promise<ResultadoEnvio> {
  const { logyca } = p.config;
  if (logyca.ativo && logyca.usarParaEnvio) {
    const token = segredo(p.config, "tokenLogycaEnvio");
    if (!logyca.endpointEnvio || !token) return { ok: false, externalId: null, connectionId: null, erro: "Logyca sem endpoint/token de envio." };
    const { enviarLogyca } = await import("./logyca.js");
    const r = await enviarLogyca({ endpoint: logyca.endpointEnvio, token }, p.numero, p.texto);
    return { ok: r.ok, externalId: null, connectionId: null, erro: r.erro };
  }
  const conns = await db().select().from(whatsappConnections).where(and(eq(whatsappConnections.provider, "evolution"), eq(whatsappConnections.status, "conectado")));
  const conn = conns.find(c => c.id === p.connectionId) ?? conns[0];
  if (!conn?.instancia) return { ok: false, externalId: null, connectionId: null, erro: "Nenhuma conexão de WhatsApp (QR code) conectada." };
  const { configEvolution } = await import("../whatsapp-router.js");
  const { enviarTextoEvolution } = await import("../_core/evolution.js");
  const c = await configEvolution();
  if (!c) return { ok: false, externalId: null, connectionId: conn.id, erro: "Servidor da Evolution não configurado." };
  const id = await enviarTextoEvolution(c, conn.instancia, p.numero, p.texto);
  return { ok: Boolean(id), externalId: id, connectionId: conn.id, erro: id ? undefined : "A Evolution não aceitou a mensagem." };
}

async function enviadosHoje(numero: string): Promise<number> {
  const [r] = await db().select({ n: count() }).from(centralVendasFila).where(and(
    eq(centralVendasFila.tipo, "mensagem"), eq(centralVendasFila.status, "concluido"), eq(centralVendasFila.numero, numero),
    gte(centralVendasFila.concluidoEm, inicioDoDiaFortaleza(agora())),
  ));
  return Number(r?.n ?? 0);
}

const adiar = (job: CentralVendasJob, quando: Date, motivo: string) => db().update(centralVendasFila)
  .set({ status: "pendente", tentativas: Math.max(0, job.tentativas - 1), proximaTentativaEm: quando, ultimoErro: motivo, updatedAt: agora() })
  .where(eq(centralVendasFila.id, job.id));

async function falhar(job: CentralVendasJob, erro: string) {
  if (job.tentativas >= MAX_TENTATIVAS) {
    await db().update(centralVendasFila).set({ status: "falhou", ultimoErro: erro, updatedAt: agora() }).where(eq(centralVendasFila.id, job.id));
    await registrarEvento({ tipo: `falha_${job.tipo}`, leadId: job.leadId, payload: { job: job.id, tentativas: job.tentativas }, resultado: "erro", erro, chave: `falha-fila:${job.id}` });
    await avisarAdmins("Central de Vendas: falha após várias tentativas", `Um envio automático falhou ${job.tentativas} vezes e parou. Veja a fila na Central de Vendas.`, job.leadId);
    if (job.tipo === "ia" && job.leadId) {
      const { transferirParaHumano } = await import("./ia.js");
      await transferirParaHumano(job.leadId, "ia_indisponivel");
    }
    return;
  }
  const quando = new Date(agora().getTime() + backoffMinutos(job.tentativas) * 60_000);
  await db().update(centralVendasFila).set({ status: "pendente", proximaTentativaEm: quando, ultimoErro: erro, updatedAt: agora() }).where(eq(centralVendasFila.id, job.id));
  await registrarEvento({ tipo: `reprocessar_${job.tipo}`, leadId: job.leadId, payload: { job: job.id, tentativa: job.tentativas }, resultado: "erro", erro });
}

async function processarMensagem(job: CentralVendasJob, config: ConfigCentral, aguardar: boolean): Promise<"enviada" | "adiada" | "descartada" | "falhou"> {
  const p = JSON.parse(job.payload || "{}") as PayloadMensagem;
  const cv = job.leadId ? await registroCentral(job.leadId) : null;
  const numero = job.numero ?? "";
  const bloqueio = bloqueioEnvio({
    ativo: config.ativo, optOut: Boolean(cv?.optOut), ignorarOptOut: p.ignorarOptOut, modoTeste: config.modoTeste,
    numerosTeste: config.numerosTeste, numero, proativa: job.proativa, agora: agora(), janela: config.janelaEnvio,
    enviadosHoje: await enviadosHoje(numero), limiteDiario: config.limiteDiarioPorNumero,
  });
  if (bloqueio === "desligado") { await adiar(job, new Date(agora().getTime() + 15 * 60_000), "Central desligada"); return "adiada"; }
  if (bloqueio === "fora_horario" || bloqueio === "limite_diario") {
    const espalhar = Math.floor(dependencias().aleatorio() * 30) * 60_000; // não sai tudo no mesmo minuto
    // Fora do horário: próxima abertura da janela. Limite do dia: abertura de amanhã (ou de hoje, se ainda não abriu).
    const abre = proximaAberturaJanela(agora(), config.janelaEnvio);
    await adiar(job, new Date(abre.getTime() + espalhar), bloqueio);
    await registrarEvento({ tipo: "envio_adiado", leadId: job.leadId, payload: { job: job.id, motivo: bloqueio }, resultado: "bloqueado" });
    return "adiada";
  }
  if (bloqueio) {
    await db().update(centralVendasFila).set({ status: "descartado", ultimoErro: bloqueio, updatedAt: agora() }).where(eq(centralVendasFila.id, job.id));
    await registrarEvento({ tipo: "envio_bloqueado", leadId: job.leadId, payload: { job: job.id, motivo: bloqueio, template: p.template ?? null }, resultado: "bloqueado" });
    return "descartada";
  }
  // Intervalo aleatório entre envios seguidos (reduz o risco de bloqueio do número; QR code não é a API oficial).
  if (aguardar) {
    const { intervaloMinSeg: min, intervaloMaxSeg: max } = config;
    await dependencias().dormir(Math.round((min + dependencias().aleatorio() * Math.max(0, max - min)) * 1000));
  }
  let r: ResultadoEnvio;
  try { r = await (dependencias().enviar ?? enviarPadrao)({ numero, texto: p.texto, connectionId: cv?.connectionId ?? null, config }); }
  catch (e) { r = { ok: false, externalId: null, connectionId: null, erro: erroSeguro(e) }; }
  if (!r.ok) { await falhar(job, r.erro ?? "Falha no envio."); return "falhou"; }
  let mensagemId: number | null = null;
  if (r.connectionId) {
    const [m] = await db().insert(whatsappMessages).values({
      connectionId: r.connectionId, leadId: job.leadId, destinatario: numero, mensagem: p.texto.slice(0, 4000), externalId: r.externalId,
      status: "enviada", direcao: "saida", lida: true, createdAt: agora(), updatedAt: agora(),
    }).returning({ id: whatsappMessages.id });
    mensagemId = m?.id ?? null;
  }
  await db().update(centralVendasFila).set({ status: "concluido", mensagemId, concluidoEm: agora(), ultimoErro: null, updatedAt: agora() }).where(eq(centralVendasFila.id, job.id));
  if (job.leadId) {
    await db().update(centralVendasLeads).set({
      ultimaMensagemEnviadaEm: agora(), primeiraRespostaEm: sql`COALESCE(${centralVendasLeads.primeiraRespostaEm}, ${agora()})`,
      ...(r.connectionId && !cv?.connectionId ? { connectionId: r.connectionId } : {}), updatedAt: agora(),
    }).where(eq(centralVendasLeads.leadId, job.leadId));
  }
  await registrarEvento({ tipo: "mensagem_enviada", leadId: job.leadId, payload: { job: job.id, template: p.template ?? "ia", proativa: job.proativa } });
  return "enviada";
}

async function reivindicar(ids?: number[]): Promise<CentralVendasJob | null> {
  const [cand] = await db().select({ id: centralVendasFila.id }).from(centralVendasFila).where(and(
    eq(centralVendasFila.status, "pendente"), lte(centralVendasFila.proximaTentativaEm, agora()),
    ids ? inArray(centralVendasFila.id, ids.length ? ids : [-1]) : undefined,
  )).orderBy(asc(centralVendasFila.proximaTentativaEm), asc(centralVendasFila.id)).limit(1);
  if (!cand) return null;
  const [job] = await db().update(centralVendasFila)
    .set({ status: "processando", tentativas: sql`${centralVendasFila.tentativas} + 1`, updatedAt: agora() })
    .where(and(eq(centralVendasFila.id, cand.id), eq(centralVendasFila.status, "pendente"))).returning();
  return job ?? (await reivindicar(ids));
}

/**
 * Processa a fila (ou só `ids`). Intervalo aleatório entre envios (configurável) e limite de tempo para caber
 * na função da Vercel; o que sobrar fica para a próxima rodada.
 */
export async function processarFila(opcoes: { ids?: number[]; limiteMs?: number } = {}) {
  const inicio = Date.now();
  const config = await carregarConfig();
  const resumo = { enviadas: 0, adiadas: 0, descartadas: 0, falhas: 0, ia: 0 };
  let enviouAntes = false;
  for (let i = 0; i < 200; i++) {
    if (Date.now() - inicio > (opcoes.limiteMs ?? 40_000)) break;
    const job = await reivindicar(opcoes.ids);
    if (!job) break;
    try {
      if (job.tipo === "ia") {
        const { processarJobIA } = await import("./ia.js");
        await processarJobIA(job);
        await db().update(centralVendasFila).set({ status: "concluido", concluidoEm: agora(), updatedAt: agora() }).where(eq(centralVendasFila.id, job.id));
        resumo.ia++;
        continue;
      }
      const r = await processarMensagem(job, config, enviouAntes);
      if (r === "enviada") { resumo.enviadas++; enviouAntes = true; }
      else if (r === "adiada") resumo.adiadas++;
      else if (r === "descartada") resumo.descartadas++;
      else resumo.falhas++;
    } catch (e) {
      await falhar(job, erroSeguro(e));
      resumo.falhas++;
    }
  }
  return resumo;
}

/** Item que ficou "processando" (queda no meio do envio) vira "incerto": nunca é reenviado sozinho. */
export async function marcarIncertos() {
  const limite = new Date(agora().getTime() - 10 * 60_000);
  const r = await db().update(centralVendasFila).set({ status: "incerto", updatedAt: agora() })
    .where(and(eq(centralVendasFila.status, "processando"), lt(centralVendasFila.updatedAt, limite)))
    .returning({ id: centralVendasFila.id, leadId: centralVendasFila.leadId });
  for (const j of r) await registrarEvento({ tipo: "envio_incerto", leadId: j.leadId, payload: { job: j.id }, resultado: "erro", chave: `incerto:${j.id}` });
  return r.length;
}

/** Cancela o que ainda não saiu para o lead (opt-out). */
export async function cancelarPendentes(leadId: number, motivo: string) {
  await db().update(centralVendasFila).set({ status: "descartado", ultimoErro: motivo, updatedAt: agora() })
    .where(and(eq(centralVendasFila.leadId, leadId), eq(centralVendasFila.status, "pendente"), eq(centralVendasFila.tipo, "mensagem")));
}
