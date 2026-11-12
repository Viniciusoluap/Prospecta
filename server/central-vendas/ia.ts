// Central de Vendas (12/11/2026) — agente de IA de atendimento inicial: saudação, consentimento LGPD e
// qualificação. Regras proibidas garantidas por código (verificação da saída antes de enviar; campos aceitos
// em lista fechada; nada aqui grava status de análise) e por testes. Transferência para humano com resumo.
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { leadActivities, leads, whatsappMessages } from "../../drizzle/schema.js";
import {
  centralVendasLeads, centralVendasProdutos, centralVendasTokensMes, type CentralVendasJob,
} from "../../drizzle/schema-central-vendas.js";
import type { ConfigCentral } from "../../shared/central-vendas/config.js";
import {
  ROTULOS_MOTIVO, etapaAvancada, motivoTransferencia, partesFortaleza, violacoesResposta, type MotivoTransferencia,
} from "../../shared/central-vendas/regras.js";
import { ENV } from "../_core/env.js";
import {
  agora, avisar, avisarAdmins, carregarConfig, dadosDoLead, db, dependencias, erroSeguro, registrarEvento, registroCentral,
  segredo, type ClienteIA,
} from "./base.js";
import { atribuirOperador } from "./distribuicao.js";
import { enfileirar, enfileirarTemplate, processarFila } from "./envio.js";

/** Falha que não adianta repetir (sem chave, sem orçamento): vai direto para humano. */
export class IAIndisponivel extends Error {}

const clientePadrao: ClienteIA = async ({ sistema, mensagens, maxTokens, config }) => {
  const chave = segredo(config, "chaveAnthropic") || ENV.anthropicApiKey;
  if (!chave) throw new IAIndisponivel("Chave da IA não configurada.");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const r = await new Anthropic({ apiKey: chave }).messages.create({ model: config.modeloIA, max_tokens: maxTokens, system: sistema, messages: mensagens });
  const texto = r.content.map(b => (b.type === "text" ? b.text : "")).join("");
  return { texto, entrada: r.usage?.input_tokens ?? 0, saida: r.usage?.output_tokens ?? 0 };
};
const cliente = () => dependencias().ia ?? clientePadrao;

// ── Orçamento de tokens ──

async function tokensDoMes(mes: string) {
  const [r] = await db().select({ t: centralVendasTokensMes.tokens }).from(centralVendasTokensMes).where(eq(centralVendasTokensMes.mes, mes)).limit(1);
  return r?.t ?? 0;
}

async function registrarConsumo(leadId: number | null, tokens: number) {
  const mes = partesFortaleza(agora()).mes;
  await db().insert(centralVendasTokensMes).values({ mes, tokens, updatedAt: agora() })
    .onConflictDoUpdate({ target: centralVendasTokensMes.mes, set: { tokens: sql`${centralVendasTokensMes.tokens} + ${tokens}`, updatedAt: agora() } });
  if (leadId) await db().update(centralVendasLeads).set({ tokensConsumidos: sql`${centralVendasLeads.tokensConsumidos} + ${tokens}` }).where(eq(centralVendasLeads.leadId, leadId));
}

/** Ao atingir o limite mensal, a IA para e tudo segue para humano, com alerta (uma vez por mês) ao admin. */
export async function orcamentoEsgotado(config: ConfigCentral): Promise<boolean> {
  const mes = partesFortaleza(agora()).mes;
  if (config.limiteMensalTokens > 0 && (await tokensDoMes(mes)) < config.limiteMensalTokens) return false;
  if (await registrarEvento({ tipo: "limite_tokens_atingido", payload: { mes, limite: config.limiteMensalTokens }, resultado: "bloqueado", chave: `alerta-tokens:${mes}` })) {
    await avisarAdmins("Central de Vendas: limite de tokens da IA atingido", `O limite mensal (${config.limiteMensalTokens} tokens) foi atingido em ${mes}. A IA parou e os atendimentos seguem para a equipe.`);
  }
  return true;
}

async function chamarIA(leadId: number | null, config: ConfigCentral, p: Omit<Parameters<ClienteIA>[0], "config">) {
  if (await orcamentoEsgotado(config)) throw new IAIndisponivel("limite_tokens");
  const r = await cliente()({ ...p, config });
  await registrarConsumo(leadId, r.entrada + r.saida);
  return r;
}

// ── Base de conhecimento: só o que está cadastrado ──

export async function baseConhecimento() {
  const produtos = await db().select().from(centralVendasProdutos).where(eq(centralVendasProdutos.ativo, true)).orderBy(centralVendasProdutos.nome);
  const fmt = (v: string | null) => (v ? `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : null);
  const blocos = produtos.map(p => [
    `- ${p.nome} (código ${p.slug}, ${p.tipo}${p.cidade ? `, ${p.cidade}` : ""})`,
    p.descricao && `  Descrição: ${p.descricao}`,
    (p.precoMin || p.precoMax) && `  Faixa de preço: ${[fmt(p.precoMin), fmt(p.precoMax)].filter(Boolean).join(" a ")}`,
    p.requisitos && `  Requisitos: ${p.requisitos}`,
    p.condicoes && `  Condições comerciais cadastradas: ${p.condicoes}`,
  ].filter(Boolean).join("\n"));
  const texto = blocos.join("\n") || "(nenhum produto ou empreendimento cadastrado)";
  // Números que a IA pode citar: os do cadastro, nos dois formatos (1.234,56 e 1234.56).
  const numeros = produtos.flatMap(p => [p.descricao, p.requisitos, p.condicoes, p.precoMin ?? "", p.precoMax ?? "", fmt(p.precoMin) ?? "", fmt(p.precoMax) ?? ""]).join(" ");
  return { produtos, texto, numeros };
}

// ── Saída estruturada da IA (lista fechada de campos; qualquer outro campo é descartado) ──

const saidaSchema = z.object({
  resposta: z.string().trim().max(2000).catch(""),
  confianca: z.number().min(0).max(1).catch(0),
  transferir: z.boolean().catch(false),
  campos: z.object({
    lgpdConsentimento: z.boolean().nullish().catch(null),
    nome: z.string().trim().min(2).max(255).nullish().catch(null),
    cidade: z.string().trim().min(2).max(100).nullish().catch(null),
    renda: z.number().min(0).max(10_000_000).nullish().catch(null),
    tipoRenda: z.enum(["formal", "informal", "irpf"]).nullish().catch(null),
    fgts: z.number().min(0).max(100_000_000).nullish().catch(null),
    estadoCivil: z.enum(["solteiro", "casado", "uniao_estavel", "divorciado", "viuvo"]).nullish().catch(null),
    composicaoRenda: z.boolean().nullish().catch(null),
    produto: z.string().trim().max(80).nullish().catch(null),
  }).catch({}),
});
export type SaidaIA = z.infer<typeof saidaSchema>;

export function lerSaidaIA(texto: string): SaidaIA | null {
  const m = /\{[\s\S]*\}/.exec(texto);
  if (!m) return null;
  try { return saidaSchema.parse(JSON.parse(m[0])); } catch { return null; }
}

export const CAMPOS_QUALIFICACAO = ["nome", "cidade", "renda", "tipoRenda", "fgts", "estadoCivil", "composicaoRenda", "produto"] as const;
type Qualificacao = Partial<Record<(typeof CAMPOS_QUALIFICACAO)[number], unknown>>;
const lerQualificacao = (json: string | null | undefined): Qualificacao => { try { return JSON.parse(json || "{}"); } catch { return {}; } };

function promptSistema(base: string, lgpd: boolean, qual: Qualificacao) {
  const faltando = CAMPOS_QUALIFICACAO.filter(c => qual[c] === undefined);
  return `Você é a assistente virtual de atendimento inicial da Prospecta Construções no WhatsApp. Escreva em português do Brasil, frases curtas e cordiais, uma pergunta por vez.

Objetivo: ${lgpd ? "o cliente já deu o consentimento LGPD." : "PRIMEIRO peça o consentimento do cliente para usar os dados pessoais só neste atendimento (LGPD). Sem consentimento, não pergunte dados pessoais."}
Depois, qualifique coletando o que falta: ${faltando.length ? faltando.join(", ") : "nada (qualificação completa; agradeça e diga que vai enviar a lista de documentos)"}.
(nome; cidade; renda mensal em reais; tipo de renda formal/informal/irpf; saldo de FGTS — 0 se não tem; estado civil; se vai compor renda com outra pessoa; empreendimento ou produto de interesse pelo código.)

Produtos e empreendimentos cadastrados (a ÚNICA fonte de informação que você pode usar):
${base}

Regras obrigatórias:
- Nunca prometa, sugira ou garanta aprovação de financiamento ou crédito. A análise é feita pela equipe.
- Nunca informe taxa, juros, parcela, entrada, subsídio, prazo ou valor que não esteja escrito acima.
- Nunca decida nada financeiro e nunca diga que o cliente foi aprovado ou reprovado.
- Se não souber, diga que um consultor vai confirmar. Se o cliente pedir atendente, reclamar, falar de assunto jurídico ou quiser negociar valor, marque "transferir": true.

Responda SOMENTE com um JSON, sem texto fora dele:
{"resposta":"mensagem ao cliente","confianca":0.0-1.0,"transferir":false,"campos":{"lgpdConsentimento":null,"nome":null,"cidade":null,"renda":null,"tipoRenda":null,"fgts":null,"estadoCivil":null,"composicaoRenda":null,"produto":null}}
Preencha em "campos" apenas o que o cliente informou nesta conversa (null no resto).`;
}

async function historico(leadId: number) {
  const msgs = await db().select({ direcao: whatsappMessages.direcao, texto: whatsappMessages.mensagem }).from(whatsappMessages)
    .where(eq(whatsappMessages.leadId, leadId)).orderBy(asc(whatsappMessages.createdAt), asc(whatsappMessages.id));
  const ultimas = msgs.slice(-20);
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of ultimas) {
    const role = m.direcao === "entrada" ? "user" : "assistant";
    const prev = out[out.length - 1];
    if (prev?.role === role) prev.content += `\n${m.texto}`;
    else out.push({ role, content: m.texto });
  }
  while (out[0]?.role === "assistant") out.shift();
  if (!out.length || out[out.length - 1].role !== "user") out.push({ role: "user", content: "(continue o atendimento)" });
  return out;
}

/** Aplica só os campos permitidos no lead; devolve quantos dados novos chegaram (progresso). */
async function aplicarCampos(leadId: number, saida: SaidaIA, qualAntes: Qualificacao, lgpdAntes: boolean, produtos: { id: number; slug: string; checklistId: number | null }[]) {
  const c = saida.campos;
  const lgpd = lgpdAntes || c.lgpdConsentimento === true;
  let novos = !lgpdAntes && lgpd ? 1 : 0;
  if (!lgpd) return { novos, qual: qualAntes, lgpd };
  const qual: Qualificacao = { ...qualAntes };
  const setLead: Partial<typeof leads.$inferInsert> = {};
  const setCv: Partial<typeof centralVendasLeads.$inferInsert> = {};
  if (!lgpdAntes) { setLead.lgpdConsent = true; setLead.lgpdConsentAt = agora(); }
  const marcar = (k: keyof Qualificacao) => { if (qual[k] === undefined) novos++; qual[k] = true; };
  if (c.nome) { setLead.name = c.nome; marcar("nome"); }
  if (c.cidade) { setLead.city = c.cidade; marcar("cidade"); }
  if (c.renda != null) { setLead.income = c.renda.toFixed(2); marcar("renda"); }
  if (c.tipoRenda) { setLead.incomeType = c.tipoRenda; marcar("tipoRenda"); }
  if (c.fgts != null) { setLead.fgtsAmount = c.fgts.toFixed(2); marcar("fgts"); }
  if (c.estadoCivil) { setCv.estadoCivil = c.estadoCivil; setLead.hasSpouse = c.estadoCivil === "casado" || c.estadoCivil === "uniao_estavel"; marcar("estadoCivil"); }
  if (c.composicaoRenda != null) { setLead.incomeComposition = c.composicaoRenda; marcar("composicaoRenda"); }
  const produto = c.produto ? produtos.find(p => p.slug === c.produto!.toLowerCase()) : undefined;
  if (produto) { setCv.produtoId = produto.id; if (produto.checklistId) setCv.checklistId = produto.checklistId; marcar("produto"); }
  if (Object.keys(setLead).length) await db().update(leads).set({ ...setLead, updatedAt: agora() }).where(eq(leads.id, leadId));
  await db().update(centralVendasLeads).set({ ...setCv, qualificacao: JSON.stringify(qual), updatedAt: agora() }).where(eq(centralVendasLeads.leadId, leadId));
  return { novos, qual, lgpd };
}

export const qualificacaoCompleta = (q: Qualificacao, lgpd: boolean) => lgpd && CAMPOS_QUALIFICACAO.every(c => q[c] !== undefined);

/** Job "ia" da fila: responde a mensagem recebida (payload.messageId). Falha transitória → backoff da fila. */
export async function processarJobIA(job: CentralVendasJob) {
  const leadId = job.leadId!;
  const { messageId } = JSON.parse(job.payload || "{}") as { messageId: number };
  const config = await carregarConfig();
  const cv = await registroCentral(leadId);
  const lead = await dadosDoLead(leadId);
  if (!cv || !lead || lead.deletedAt || cv.optOut) return;
  if (cv.statusAtendimento === "em_atendimento_humano" || cv.statusAtendimento === "encerrado") return;
  const [msg] = await db().select({ texto: whatsappMessages.mensagem }).from(whatsappMessages).where(eq(whatsappMessages.id, messageId)).limit(1);
  const textoCliente = msg?.texto ?? "";

  // Gatilhos detectados por código no texto do cliente: nem chama a IA.
  const gatilho = motivoTransferencia({ textoCliente, confianca: 1, limiar: 0, semProgresso: 0 });
  if (gatilho) { await transferirParaHumano(leadId, gatilho); return; }

  const { produtos, texto: base, numeros } = await baseConhecimento();
  const qualAntes = lerQualificacao(cv.qualificacao);
  const lgpdAntes = Boolean(lead.lgpdConsent);
  let resposta;
  try {
    resposta = await chamarIA(leadId, config, { sistema: promptSistema(base, lgpdAntes, qualAntes), mensagens: await historico(leadId), maxTokens: 700 });
  } catch (e) {
    if (e instanceof IAIndisponivel) { await transferirParaHumano(leadId, e.message === "limite_tokens" ? "limite_tokens" : "ia_indisponivel"); return; }
    throw e; // a fila tenta de novo com backoff; esgotadas as tentativas, vai para humano
  }
  const saida = lerSaidaIA(resposta.texto);
  const { novos, qual, lgpd } = saida ? await aplicarCampos(leadId, saida, qualAntes, lgpdAntes, produtos) : { novos: 0, qual: qualAntes, lgpd: lgpdAntes };
  // A saudação (primeira resposta) não conta como mensagem sem progresso.
  const semProgresso = novos > 0 || cv.mensagensIa === 0 ? 0 : cv.semProgresso + 1;
  await db().update(centralVendasLeads).set({ semProgresso, mensagensIa: sql`${centralVendasLeads.mensagensIa} + 1`, statusAtendimento: "em_atendimento_ia", updatedAt: agora() })
    .where(eq(centralVendasLeads.leadId, leadId));
  const etapa = etapaAvancada(lead.stage, "attending");
  if (etapa) await db().update(leads).set({ stage: etapa, updatedAt: agora() }).where(eq(leads.id, leadId));

  const violacoes = saida?.resposta ? violacoesResposta(saida.resposta, numeros) : [];
  if (violacoes.length) await registrarEvento({ tipo: "resposta_ia_bloqueada", leadId, payload: { violacoes }, resultado: "bloqueado" });
  const motivo: MotivoTransferencia | null = !saida || !saida.resposta ? "baixa_confianca"
    : violacoes.length ? "resposta_bloqueada"
    : motivoTransferencia({ textoCliente, confianca: saida.confianca, limiar: config.limiarConfianca, semProgresso, pedidoModelo: saida.transferir });
  if (motivo) { await transferirParaHumano(leadId, motivo); return; }

  const resp = await enfileirar({ chave: `ia-resposta:${messageId}`, leadId, numero: lead.phone, proativa: false, payload: { texto: saida!.resposta, template: "ia" } });
  if (resp) await processarFila({ ids: [resp.id] });
  await registrarEvento({ tipo: "ia_respondeu", leadId, payload: { novosDados: novos, confianca: saida!.confianca, tokens: resposta.entrada + resposta.saida } });

  if (qualificacaoCompleta(qual, lgpd)) {
    const marcou = await db().update(centralVendasLeads).set({ qualificadoEm: agora(), updatedAt: agora() })
      .where(and(eq(centralVendasLeads.leadId, leadId), isNull(centralVendasLeads.qualificadoEm))).returning({ id: centralVendasLeads.leadId });
    if (marcou.length) {
      await registrarEvento({ tipo: "qualificado", leadId });
      await db().update(leads).set({ temperature: "warm", updatedAt: agora() }).where(and(eq(leads.id, leadId), eq(leads.temperature, "cold")));
      if (config.automacoes.documentos) {
        const { solicitarDocumentos } = await import("./documentos.js");
        await solicitarDocumentos(leadId, "qualificacao");
      }
    }
  }
}

function resumoSemIA(lead: { name: string; city: string | null }, qual: Qualificacao, motivo: MotivoTransferencia, produto: string | null) {
  const respondidos = CAMPOS_QUALIFICACAO.filter(c => qual[c] !== undefined);
  return `Motivo: ${ROTULOS_MOTIVO[motivo]}. Cliente: ${lead.name}${lead.city ? ` (${lead.city})` : ""}. ` +
    `Qualificação: ${respondidos.length}/${CAMPOS_QUALIFICACAO.length} respondidos${produto ? `; interesse: ${produto}` : ""}. Veja a conversa no WhatsApp.`;
}

async function resumir(leadId: number, motivo: MotivoTransferencia, config: ConfigCentral): Promise<string> {
  const lead = await dadosDoLead(leadId);
  const cv = await registroCentral(leadId);
  const [prod] = cv?.produtoId ? await db().select({ nome: centralVendasProdutos.nome }).from(centralVendasProdutos).where(eq(centralVendasProdutos.id, cv.produtoId)).limit(1) : [];
  const reserva = resumoSemIA(lead ?? { name: "Cliente", city: null }, lerQualificacao(cv?.qualificacao), motivo, prod?.nome ?? null);
  if (!config.automacoes.ia || motivo === "limite_tokens" || motivo === "ia_indisponivel" || motivo === "ia_desligada") return reserva;
  try {
    const r = await chamarIA(leadId, config, {
      sistema: "Resuma em até 4 linhas, em português, para o atendente humano que vai assumir esta conversa: o que o cliente quer, dados já informados e o motivo da transferência. Não invente nada. Responda só o texto do resumo.",
      mensagens: [...(await historico(leadId)).slice(-10), { role: "user" as const, content: `(motivo da transferência: ${ROTULOS_MOTIVO[motivo]}) — gere o resumo` }].reduce<{ role: "user" | "assistant"; content: string }[]>((acc, m) => {
        const prev = acc[acc.length - 1];
        if (prev?.role === m.role) prev.content += `\n${m.content}`; else acc.push({ ...m });
        return acc;
      }, []),
      maxTokens: 300,
    });
    const t = r.texto.trim();
    return t ? `${t.slice(0, 1500)}\n(${ROTULOS_MOTIVO[motivo]})` : reserva;
  } catch { return reserva; }
}

/** Transfere para o operador atribuído, com resumo; uma vez por espera (atômico). */
export async function transferirParaHumano(leadId: number, motivo: MotivoTransferencia) {
  const desde = agora();
  const r = await db().update(centralVendasLeads).set({
    statusAtendimento: "em_atendimento_humano", aguardandoHumanoDesde: desde, primeiraRespostaHumanaEm: null, motivoTransferencia: motivo, updatedAt: desde,
  }).where(and(eq(centralVendasLeads.leadId, leadId), sql`${centralVendasLeads.statusAtendimento} <> 'em_atendimento_humano'`)).returning();
  if (!r.length) return false;
  const config = await carregarConfig();
  const operador = r[0].operadorId ?? (await atribuirOperador(leadId));
  let resumo: string;
  try { resumo = await resumir(leadId, motivo, config); } catch (e) { resumo = `Motivo: ${ROTULOS_MOTIVO[motivo]}.`; await registrarEvento({ tipo: "erro_resumo", leadId, resultado: "erro", erro: erroSeguro(e) }); }
  await db().update(centralVendasLeads).set({ resumoTransferencia: resumo, updatedAt: agora() }).where(eq(centralVendasLeads.leadId, leadId));
  await db().insert(leadActivities).values({ leadId, type: "handoff", description: `Atendimento transferido para humano pela Central de Vendas — ${ROTULOS_MOTIVO[motivo]}.`, performedBy: "Central de Vendas", metadata: JSON.stringify({ motivo }) });
  const lead = await dadosDoLead(leadId);
  await avisar([operador], `Central de Vendas: ${lead?.name ?? "cliente"} precisa de você`, resumo, leadId);
  await registrarEvento({ tipo: "transferido_humano", leadId, payload: { motivo, operadorId: operador } });
  if (motivo !== "reprovado") {
    const job = await enfileirarTemplate({ leadId, slug: "cv-transferencia-humano", chave: `transferencia:${leadId}:${desde.toISOString()}`, proativa: false });
    if (job) await processarFila({ ids: [job.id] });
  }
  return true;
}

/** Classificação de documento pela IA usando só metadados (nome do arquivo, tipo e legenda). */
export async function classificarDocumentoIA(meta: { nome: string | null; mime: string | null; legenda: string }, itens: { chave: string; nome: string }[], leadId: number) {
  const config = await carregarConfig();
  if (!config.automacoes.ia || !itens.length) return null;
  try {
    const r = await chamarIA(leadId, config, {
      sistema: `Classifique um documento recebido por WhatsApp, usando APENAS os metadados. Opções (chave: nome): ${itens.map(i => `${i.chave}: ${i.nome}`).join("; ")}. Responda só JSON {"chave": "<chave ou null>", "confianca": 0.0-1.0}.`,
      mensagens: [{ role: "user", content: `Arquivo: ${meta.nome ?? "(sem nome)"}; tipo: ${meta.mime ?? "?"}; legenda: ${meta.legenda || "(sem legenda)"}` }],
      maxTokens: 100,
    });
    const m = /\{[\s\S]*\}/.exec(r.texto);
    const p = z.object({ chave: z.string().nullish(), confianca: z.number().min(0).max(1).catch(0) }).safeParse(m ? JSON.parse(m[0]) : null);
    if (!p.success || !p.data.chave || !itens.some(i => i.chave === p.data.chave)) return null;
    return { chave: p.data.chave, confianca: p.data.confianca };
  } catch { return null; }
}
