// EPIC-027 C7 (20/11/2026) — campanhas pela API oficial (YCloud): prévia com contagem e custo, criação com confirmação da contagem,
// envio em LOTES retomáveis (cabe em 60 s por chamada; continua de onde parou), situação de cada envio e opt-out.
//
// Regras de segurança (prioridade do dono), todas no SERVIDOR:
// - destinatários só de cadastros do CRM (ids de leads; telefone e nome lidos do banco, nunca da tela);
// - o número do dono e o da própria empresa nunca recebem; quem pediu para não receber (ycloud_optout) nunca recebe;
// - limite diário = o menor entre o tier lido da YCloud (destinatários únicos em 24 h móveis) e o teto do painel; teto por campanha;
// - 5 mensagens/s (coexistência); a fila da YCloud (`POST /whatsapp/messages`) com `externalId` próprio;
// - idempotência: um envio por (campanha, telefone) e `external_id` único no banco; um envio é RESERVADO antes do POST e, se a
//   função encerrar sem resposta, vira "incerto" — NUNCA é reenviado sozinho (a documentação avisa que `externalId` não é chave de
//   idempotência da YCloud; o aviso de entrega, que traz o `externalId`, resolve o incerto);
// - nenhum telefone, chave ou texto vai para log/auditoria.
import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { leads, whatsappMessages } from "../../drizzle/schema.js";
import { ycloudCampanhas, ycloudConfig, ycloudEnvios, ycloudOptout, type StatusEnvioYcloud, type YcloudConfig } from "../../drizzle/schema-ycloud.js";
import { centralVendasLeads } from "../../drizzle/schema-central-vendas.js";
import { ehNumeroDoDono, normalizarNumeroDono } from "../../shared/dolores/whatsapp.js";
import {
  INTERVALO_MINIMO_ENVIO_MS, LOTE_ENVIO_YCLOUD, MAX_DESTINATARIOS_CAMPANHA, ORCAMENTO_LOTE_MS, RESERVA_EXPIRADA_MS, chaveCanonicaTelefone,
  nomeSeguroParaVariavel, preencherPosicionais, problemaDoParametro, situacaoConvergente, statusNaCentral, telefoneMascarado, telefoneE164,
  textoComparavel, type FonteVariavel,
} from "../../shared/whatsapp/ycloud.js";
import { ErroYcloud, criarDescadastroYcloud, enfileirarModeloYcloud } from "../_core/ycloud.js";
import { getDb } from "../db.js";
import { auditarYcloud, chaveYcloud, depsYcloud, lerConfigYcloud, segredoWebhookYcloud } from "./config.js";
import { conferirNumeroYcloud, modelosDaConta, type ConferenciaNumero, type ModeloNaTela } from "./conta.js";

export class RecusaYcloud extends Error {
  constructor(message: string) { super(message); this.name = "RecusaYcloud"; }
}

// ── Situação para disparar ──

export type SituacaoDisparo = { ok: boolean; motivo: string | null; conferencia: ConferenciaNumero | null; cfg: YcloudConfig; apiKey: string | null };

/** Confere AGORA (na YCloud) se dá para disparar. Qualquer dúvida → não dispara (falha fechada). */
export async function situacaoParaDisparo(): Promise<SituacaoDisparo> {
  const cfg = await lerConfigYcloud();
  const apiKey = await chaveYcloud();
  const nao = (motivo: string, conferencia: ConferenciaNumero | null = null): SituacaoDisparo => ({ ok: false, motivo, conferencia, cfg, apiKey });
  if (!apiKey) return nao("Nenhuma chave da YCloud salva (Configurações › Integrações › API oficial do WhatsApp).");
  if (!cfg.ligado) return nao("Os disparos pela API oficial estão DESLIGADOS (Configurações › Integrações › API oficial do WhatsApp).");
  if (!(await segredoWebhookYcloud())) return nao("Ative os avisos de entrega antes de disparar (Configurações › Integrações › API oficial do WhatsApp).");
  let c: ConferenciaNumero;
  try { c = await conferirNumeroYcloud(apiKey); }
  catch (e) { return nao(e instanceof Error ? e.message : "Não consegui conferir o número na YCloud."); }
  if (!c.numeroConfere || !c.numero) return nao(c.aviso ?? "O número da API não é o da empresa.", c);
  if (c.status !== "CONNECTED") return nao(`O número está "${c.statusRotulo ?? c.status ?? "sem situação"}" na YCloud: só dispara com o número Conectado.`, c);
  if (c.qualidade === "RED") return nao("A qualidade do número está BAIXA (vermelha) na Meta: disparos suspensos para proteger o número.", c);
  return { ok: true, motivo: null, conferencia: c, cfg, apiKey };
}

/** Destinatários únicos que já receberam (ou podem ter recebido) campanha pela API nas últimas 24 h móveis. */
export async function usadosNas24h(agora: Date): Promise<number> {
  const desde = new Date(agora.getTime() - 24 * 60 * 60_000);
  const [r] = await getDb().select({ n: sql<number>`count(distinct ${ycloudEnvios.chaveTelefone})`.mapWith(Number) }).from(ycloudEnvios)
    .where(and(
      inArray(ycloudEnvios.status, ["enviando", "aceita", "enviada", "entregue", "lida", "incerto"]),
      or(gte(ycloudEnvios.aceitoEm, desde), and(isNull(ycloudEnvios.aceitoEm), gte(ycloudEnvios.reservadoEm, desde))),
    ));
  return Number(r?.n ?? 0);
}

export function vagasDoDia(cfg: Pick<YcloudConfig, "tetoDia">, limiteDiario: number, usados: number) {
  const teto = Math.min(limiteDiario, cfg.tetoDia);
  return { limiteDiario, tetoDia: cfg.tetoDia, usados24h: usados, restante: Math.max(0, teto - usados) };
}

// ── Prévia ──

export type EntradaCampanha = {
  nome: string;
  modelo: { nome: string; idioma: string };
  variaveis: Record<string, FonteVariavel>;
  leadIds: number[];
};

/** `texto` = corpo preenchido (o que a pessoa lê; guardado no envio); `textoCompleto` = cabeçalho + corpo (prévia e Central). */
type Destino = { leadId: number; nome: string | null; telefone: string; chave: string; cabecalho: string[]; corpo: string[]; texto: string; textoCompleto: string };
export type Preparo = {
  modelo: ModeloNaTela;
  destinos: Destino[];
  contagem: {
    selecionados: number; aEnviar: number; optout: number; invalidos: number; duplicados: number; reservados: number;
    semNome: number; nomeRecusado: number; parametroInvalido: number; jaRecebeu: number; acimaDoLimite: number;
  };
  janelaRepeticaoDias: number;
  vagas: { limiteDiario: number | null; tetoDia: number; usados24h: number; restante: number; tetoCampanha: number };
  custo: { precoUnitario: number | null; estimado: number | null; moeda: string; base: "media_registrada" | "configurado" | null };
};

/**
 * Quem NÃO recebe: o opt-out da API oficial (pela forma canônica do telefone) e qualquer marca de descadastro que o sistema já tem —
 * hoje, `central_vendas_leads.opt_out` (quem disse SAIR na Central de Vendas, gravado em server/central-vendas/entrada.ts).
 * Falha ao conferir → lança (nada sai).
 */
export async function bloqueiosDeOptout(chaves: string[], leadIds: number[]): Promise<{ chaves: Set<string>; leads: Set<number> }> {
  const db = getDb();
  try {
    const [porTelefone, porLead] = await Promise.all([
      chaves.length ? db.select({ c: ycloudOptout.chaveTelefone }).from(ycloudOptout).where(inArray(ycloudOptout.chaveTelefone, chaves)) : Promise.resolve([]),
      leadIds.length ? db.select({ id: centralVendasLeads.leadId }).from(centralVendasLeads).where(and(inArray(centralVendasLeads.leadId, leadIds), eq(centralVendasLeads.optOut, true))) : Promise.resolve([]),
    ]);
    return { chaves: new Set(porTelefone.map(r => r.c)), leads: new Set(porLead.map(r => r.id)) };
  } catch {
    throw new RecusaYcloud("Não consegui conferir quem pediu para não receber; nada foi feito.");
  }
}

/** Consultas trocáveis nos testes (falha simulada). */
export const verificacoesYcloud = { jaReceberamOModelo: (...a: Parameters<typeof jaReceberamOModelo>) => jaReceberamOModelo(...a) };

const STATUS_JA_SAIU = ["enviando", "aceita", "enviada", "entregue", "lida", "incerto"] as const;

/** Telefones (forma canônica) que já receberam — ou estão para receber — o MESMO modelo em OUTRA campanha desde `desde`. */
export async function jaReceberamOModelo(chaves: string[], modelo: { nome: string; idioma: string }, desde: Date, o: { excetoCampanha?: number; incluirFila: boolean }): Promise<Set<string>> {
  if (!chaves.length) return new Set();
  const status: StatusEnvioYcloud[] = o.incluirFila ? [...STATUS_JA_SAIU, "na_fila"] : [...STATUS_JA_SAIU];
  const linhas = await getDb().select({ c: ycloudEnvios.chaveTelefone }).from(ycloudEnvios)
    .innerJoin(ycloudCampanhas, eq(ycloudCampanhas.id, ycloudEnvios.campanhaId))
    .where(and(
      inArray(ycloudEnvios.chaveTelefone, chaves), inArray(ycloudEnvios.status, status),
      eq(ycloudCampanhas.modeloNome, modelo.nome), eq(ycloudCampanhas.modeloIdioma, modelo.idioma),
      gte(sql`coalesce(${ycloudEnvios.aceitoEm}, ${ycloudEnvios.criadoEm})`, desde),
      o.excetoCampanha ? sql`${ycloudEnvios.campanhaId} <> ${o.excetoCampanha}` : undefined,
    ));
  return new Set(linhas.map(l => l.c));
}

/** Preço médio REAL (final) das últimas mensagens entregues/lidas pela API — melhor estimativa quando existe. */
async function precoMedioRegistrado(): Promise<{ preco: number; moeda: string } | null> {
  const linhas = await getDb().select({ preco: ycloudEnvios.preco, moeda: ycloudEnvios.moeda }).from(ycloudEnvios)
    .where(and(eq(ycloudEnvios.precoFinal, true))).orderBy(desc(ycloudEnvios.id)).limit(200);
  const validas = linhas.filter(l => l.preco !== null && l.moeda);
  if (!validas.length) return null;
  const moeda = validas[0].moeda!;
  const mesmas = validas.filter(l => l.moeda === moeda);
  return { preco: mesmas.reduce((s, l) => s + Number(l.preco), 0) / mesmas.length, moeda };
}

/** Texto fixo vem do administrador; nome vem do cadastro e só entra LIMPO (`nomeSeguroParaVariavel`). null = sem valor. */
function valorDaVariavel(f: FonteVariavel | undefined, nomeLimpo: string | null): string | null {
  if (!f) return null;
  if (f.fonte === "fixo") return f.texto;
  if (!nomeLimpo) return null;
  return f.fonte === "primeiro_nome" ? nomeLimpo.split(" ")[0] : nomeLimpo;
}

export async function prepararCampanha(entrada: EntradaCampanha, situacao: SituacaoDisparo): Promise<Preparo> {
  const d = depsYcloud();
  const modelos = await modelosDaConta();
  const modelo = modelos.find(m => m.nome === entrada.modelo.nome && m.idioma === entrada.modelo.idioma);
  if (!modelo) throw new RecusaYcloud("Modelo não encontrado na conta da YCloud. Clique em \"Atualizar modelos\" e escolha de novo.");
  if (modelo.status !== "APPROVED") throw new RecusaYcloud("Só modelo APROVADO pela Meta pode ser disparado.");
  if (!modelo.analise.compativel) throw new RecusaYcloud(modelo.analise.motivo ?? "Modelo não compatível com esta tela.");
  for (const k of Object.keys(entrada.variaveis)) {
    if (!modelo.analise.campos.some(c => c.chave === k)) throw new RecusaYcloud(`Variável "${k}" não existe neste modelo.`);
  }
  for (const c of modelo.analise.campos) {
    const f = entrada.variaveis[c.chave];
    if (!f) throw new RecusaYcloud(`Escolha o valor da variável {{${c.indice}}} do ${c.local === "corpo" ? "corpo" : "cabeçalho"}.`);
    if (f.fonte === "fixo") {
      const p = problemaDoParametro(f.texto, c.limite);
      if (p) throw new RecusaYcloud(`O texto fixo da variável {{${c.indice}}} ${p}.`);
    }
  }
  const ids = Array.from(new Set(entrada.leadIds));
  const cadastro = ids.length ? await getDb().select({ id: leads.id, nome: leads.name, telefone: leads.phone }).from(leads)
    .where(and(inArray(leads.id, ids), isNull(leads.deletedAt))) : [];
  const [dono, empresa] = await Promise.all([d.numeroDoDono().catch(() => undefined), d.numeroDaEmpresa().catch(() => undefined)]);
  if (dono === undefined || empresa === undefined) throw new RecusaYcloud("Não consegui conferir o número do dono e o da empresa; nada foi feito.");
  const reservados = [normalizarNumeroDono(dono), normalizarNumeroDono(empresa)].filter((x): x is string => !!x);
  const comTelefone = cadastro.map(l => { const e164 = telefoneE164(l.telefone); return { ...l, e164, chave: e164 ? chaveCanonicaTelefone(e164) : null }; });
  const chaves = comTelefone.map(l => l.chave).filter((x): x is string => !!x);
  const bloqueios = await bloqueiosDeOptout(chaves, cadastro.map(l => l.id));
  // mínimo 1 dia, também aqui (o banco já recusa 0): a proteção nunca some
  const janela = Math.max(1, situacao.cfg.janelaRepeticaoDias);
  const repetidos = await jaReceberamOModelo(chaves, modelo, new Date(d.agora().getTime() - janela * 24 * 60 * 60_000), { incluirFila: true });
  const usaNome = modelo.analise.campos.some(c => entrada.variaveis[c.chave]?.fonte !== "fixo");

  const contagem = { selecionados: ids.length, aEnviar: 0, optout: 0, invalidos: ids.length - cadastro.length, duplicados: 0, reservados: 0, semNome: 0, nomeRecusado: 0, parametroInvalido: 0, jaRecebeu: 0, acimaDoLimite: 0 };
  const vistos = new Set<string>();
  const validos: Destino[] = [];
  for (const l of comTelefone.sort((a, b) => a.id - b.id)) {
    if (!l.e164 || !l.chave) { contagem.invalidos++; continue; }
    const dig = l.e164.slice(1);
    if (reservados.some(r => ehNumeroDoDono(dig, r))) { contagem.reservados++; continue; }
    if (vistos.has(l.chave)) { contagem.duplicados++; continue; }
    vistos.add(l.chave);
    if (bloqueios.chaves.has(l.chave) || bloqueios.leads.has(l.id)) { contagem.optout++; continue; }
    if (repetidos.has(l.chave)) { contagem.jaRecebeu++; continue; }
    const nomeLimpo = nomeSeguroParaVariavel(l.nome);
    if (usaNome && !nomeLimpo) { if ((l.nome ?? "").trim()) contagem.nomeRecusado++; else contagem.semNome++; continue; }
    const cabecalho: string[] = [], corpo: string[] = [];
    const valores: Record<string, Record<number, string>> = { cabecalho: {}, corpo: {} };
    let falta = false;
    for (const c of modelo.analise.campos) {
      const v = valorDaVariavel(entrada.variaveis[c.chave], nomeLimpo);
      if (v === null || problemaDoParametro(v, c.limite)) { falta = true; break; }
      (c.local === "corpo" ? corpo : cabecalho)[c.indice - 1] = v;
      valores[c.local][c.indice] = v;
    }
    if (falta) { contagem.parametroInvalido++; continue; }
    const corpoPreenchido = preencherPosicionais(modelo.analise.corpo, valores.corpo).slice(0, 4000);
    const textoCompleto = [modelo.analise.cabecalho ? preencherPosicionais(modelo.analise.cabecalho, valores.cabecalho) : null, corpoPreenchido].filter(Boolean).join("\n");
    validos.push({ leadId: l.id, nome: nomeLimpo ?? null, telefone: l.e164, chave: l.chave, cabecalho, corpo, texto: corpoPreenchido, textoCompleto: textoCompleto.slice(0, 4000) });
  }
  const limiteDiario = situacao.conferencia?.limiteDiario ?? 0;
  const vagas = vagasDoDia(situacao.cfg, limiteDiario, await usadosNas24h(d.agora()));
  const cabe = Math.min(vagas.restante, situacao.cfg.tetoCampanha, MAX_DESTINATARIOS_CAMPANHA);
  const destinos = validos.slice(0, cabe);
  contagem.acimaDoLimite = validos.length - destinos.length;
  contagem.aEnviar = destinos.length;

  const media = await precoMedioRegistrado().catch(() => null);
  const configurado = situacao.cfg.precoEstimado !== null ? Number(situacao.cfg.precoEstimado) : null;
  const custo = media
    ? { precoUnitario: media.preco, estimado: media.preco * destinos.length, moeda: media.moeda, base: "media_registrada" as const }
    : configurado !== null
      ? { precoUnitario: configurado, estimado: configurado * destinos.length, moeda: situacao.cfg.moeda, base: "configurado" as const }
      : { precoUnitario: null, estimado: null, moeda: situacao.cfg.moeda, base: null };
  return {
    modelo, destinos, contagem, custo, janelaRepeticaoDias: janela,
    vagas: { limiteDiario: Number.isFinite(limiteDiario) ? limiteDiario : null, tetoDia: vagas.tetoDia, usados24h: vagas.usados24h, restante: vagas.restante, tetoCampanha: situacao.cfg.tetoCampanha },
  };
}

/** O que a tela recebe da prévia: contagens, custo e até 5 exemplos (nome + texto). Telefones não saem. */
export function previaParaTela(p: Preparo, chaveConfirmacao: string) {
  return {
    modelo: { nome: p.modelo.nome, idioma: p.modelo.idioma, categoria: p.modelo.categoria },
    contagem: p.contagem, vagas: p.vagas, custo: p.custo, janelaRepeticaoDias: p.janelaRepeticaoDias,
    exemplos: p.destinos.slice(0, 5).map(x => ({ nome: x.nome, texto: x.textoCompleto })),
    /** Exigida na confirmação: a mesma chave duas vezes = UMA campanha. */
    chaveConfirmacao,
  };
}

// ── Criação (confirmada pela contagem) ──

export async function criarCampanha(entrada: EntradaCampanha, confirmarQuantidade: number, chaveConfirmacao: string, userId: number) {
  const db = getDb();
  const existente = async () => {
    const [c] = await db.select({ id: ycloudCampanhas.id, total: ycloudCampanhas.total }).from(ycloudCampanhas).where(eq(ycloudCampanhas.chaveConfirmacao, chaveConfirmacao)).limit(1);
    return c ? { campanhaId: c.id, total: c.total, repetida: true as const } : null;
  };
  // segunda confirmação (duas abas, clique duplo, reenvio do pedido): devolve a MESMA campanha, nada novo é criado
  const ja = await existente();
  if (ja) return ja;
  const situacao = await situacaoParaDisparo();
  if (!situacao.ok) throw new RecusaYcloud(situacao.motivo ?? "Disparo indisponível.");
  const p = await prepararCampanha(entrada, situacao);
  if (p.contagem.aEnviar === 0) throw new RecusaYcloud("Nenhum destinatário pode receber agora (confira opt-out, telefones e o limite do dia).");
  if (p.contagem.aEnviar !== confirmarQuantidade) {
    throw new RecusaYcloud(`A contagem mudou: agora são ${p.contagem.aEnviar} destinatário(s), não ${confirmarQuantidade}. Revise a prévia e confirme de novo.`);
  }
  const d = depsYcloud();
  const [camp] = await db.insert(ycloudCampanhas).values({
    chaveConfirmacao, nome: entrada.nome.trim().slice(0, 120), modeloNome: p.modelo.nome, modeloIdioma: p.modelo.idioma, modeloCategoria: p.modelo.categoria,
    corpo: p.modelo.analise.corpo, variaveis: entrada.variaveis, status: "enviando", total: p.destinos.length,
    custoEstimado: p.custo.estimado !== null ? p.custo.estimado.toFixed(4) : null, moeda: p.custo.moeda, criadaPor: userId,
    criadaEm: d.agora(), atualizadoEm: d.agora(),
  }).onConflictDoNothing().returning({ id: ycloudCampanhas.id });
  if (!camp) { const outra = await existente(); if (outra) return outra; throw new RecusaYcloud("Não consegui criar a campanha."); }
  const linhas = p.destinos.map((x, i) => ({
    campanhaId: camp.id, leadId: x.leadId, telefone: x.telefone, chaveTelefone: x.chave, nome: x.nome?.slice(0, 255) ?? null,
    parametros: { cabecalho: x.cabecalho, corpo: x.corpo, textoCompleto: x.textoCompleto }, texto: x.texto,
    externalId: `prospecta-c${camp.id}-${i + 1}`, status: "na_fila" as const, criadoEm: d.agora(), atualizadoEm: d.agora(),
  }));
  for (let i = 0; i < linhas.length; i += 500) await db.insert(ycloudEnvios).values(linhas.slice(i, i + 500)).onConflictDoNothing();
  await auditarYcloud({ acao: "campanha_criada", usuarioId: userId, campanhaId: camp.id, modelo: `${p.modelo.nome} (${p.modelo.idioma})`, quantidade: linhas.length });
  return { campanhaId: camp.id, total: linhas.length, repetida: false as const };
}

// ── Envio em lotes ──

/** Falhas que são da CONTA/do número/do modelo (não de um destinatário): param a campanha inteira. */
const CODIGOS_DA_CONTA = new Set([
  "UNAUTHORIZED", "FORBIDDEN", "ACCOUNT_LIMITED", "ACCOUNT_UNAVAILABLE", "BALANCE_INSUFFICIENT", "WHATSAPP_PHONE_NUMBER_UNAVAILABLE",
  "WHATSAPP_TEMPLATE_UNAVAILABLE", "WHATSAPP_WABA_UNAVAILABLE", "CONTENT_PROHIBITED",
]);

export type ResultadoLote = {
  status: "enviando" | "pausada" | "concluida" | "cancelada";
  enviadas: number; falhas: number; incertas: number; restantes: number;
  aguardarSegundos: number | null; motivo: string | null;
};

async function contarRestantes(campanhaId: number) {
  const [r] = await getDb().select({
    fila: sql<number>`count(*) filter (where ${ycloudEnvios.status} = 'na_fila')`.mapWith(Number),
    enviando: sql<number>`count(*) filter (where ${ycloudEnvios.status} = 'enviando')`.mapWith(Number),
  }).from(ycloudEnvios).where(eq(ycloudEnvios.campanhaId, campanhaId));
  return { fila: Number(r?.fila ?? 0), enviando: Number(r?.enviando ?? 0) };
}

async function pausarCampanha(campanhaId: number, motivo: string) {
  await getDb().update(ycloudCampanhas).set({ status: "pausada", motivoPausa: motivo.slice(0, 300), atualizadoEm: depsYcloud().agora() })
    .where(and(eq(ycloudCampanhas.id, campanhaId), eq(ycloudCampanhas.status, "enviando")));
}

/** Reserva expirada (a função encerrou entre o POST e a resposta): "incerto" — nunca volta para a fila sozinho. */
export async function expirarReservas(agora: Date) {
  await getDb().update(ycloudEnvios).set({
    status: "incerto", motivo: "Sem resposta da YCloud (o envio pode ter saído). Não é reenviado automaticamente; o aviso de entrega confirma.",
    atualizadoEm: agora,
  }).where(and(eq(ycloudEnvios.status, "enviando"), lt(ycloudEnvios.reservadoEm, new Date(agora.getTime() - RESERVA_EXPIRADA_MS))));
}

async function devolverParaFila(ids: number[]) {
  if (!ids.length) return;
  await getDb().update(ycloudEnvios).set({ status: "na_fila", reservadoEm: null, tentativas: sql`greatest(${ycloudEnvios.tentativas} - 1, 0)`, atualizadoEm: depsYcloud().agora() })
    .where(and(inArray(ycloudEnvios.id, ids), eq(ycloudEnvios.status, "enviando")));
}

/** Mensagem da campanha na conversa da Central, marcada como automática (não cala a Dolores; o eco do mesmo texto casa com ela). */
async function registrarNaCentral(conexaoId: number | null, e: { leadId: number | null; telefone: string; nome: string | null; texto: string }): Promise<number | null> {
  if (!conexaoId) return null;
  try {
    const [m] = await getDb().insert(whatsappMessages).values({
      connectionId: conexaoId, leadId: e.leadId, destinatario: e.telefone.replace(/\D/g, ""), nomeDestinatario: e.nome,
      mensagem: e.texto, status: "enviada", direcao: "saida", lida: true, automatica: true,
    }).returning({ id: whatsappMessages.id });
    return m?.id ?? null;
  } catch { return null; }
}

/**
 * Grava a resposta do POST sem atropelar o aviso de entrega que pode ter chegado ANTES (corrida webhook × resposta): com o envio ainda
 * "enviando", grava tudo; se o aviso já mudou a situação, só completa o que falta (id, wamid, aceite, mensagem da Central) — nunca
 * rebaixa a situação nem troca um preço final pelo estimado.
 */
async function gravarAceite(envioId: number, r: { id?: string; wamid?: string; totalPrice?: number; currency?: string } | null, falhouNaHora: boolean, centralId: number | null) {
  const db = getDb();
  const agora = depsYcloud().agora();
  const ycloudId = typeof r?.id === "string" ? r.id.slice(0, 80) : null;
  const wamid = typeof r?.wamid === "string" ? r.wamid.slice(0, 255) : null;
  const preco = typeof r?.totalPrice === "number" && Number.isFinite(r.totalPrice) ? String(r.totalPrice) : null;
  const moeda = typeof r?.currency === "string" ? r.currency.slice(0, 3) : null;
  const feito = await db.update(ycloudEnvios).set({
    status: falhouNaHora ? "falhou" : "aceita", ycloudId, wamid, preco, moeda, aceitoEm: agora,
    ...(falhouNaHora ? { falhouEm: agora, motivo: "A YCloud recusou na hora." } : {}), mensagemCentralId: centralId, atualizadoEm: agora,
  }).where(and(eq(ycloudEnvios.id, envioId), eq(ycloudEnvios.status, "enviando"))).returning({ id: ycloudEnvios.id });
  if (feito.length) return;
  const [atual] = await db.select().from(ycloudEnvios).where(eq(ycloudEnvios.id, envioId)).limit(1);
  if (!atual) return;
  await db.update(ycloudEnvios).set({
    ycloudId: atual.ycloudId ?? ycloudId, wamid: atual.wamid ?? wamid, aceitoEm: atual.aceitoEm ?? agora,
    ...(atual.preco === null && preco !== null ? { preco, moeda } : {}),
    mensagemCentralId: atual.mensagemCentralId ?? centralId, atualizadoEm: agora,
  }).where(eq(ycloudEnvios.id, envioId));
  const situacao = situacaoConvergente(atual);
  if (centralId && !atual.mensagemCentralId) {
    await db.update(whatsappMessages).set({ status: statusNaCentral(situacao), updatedAt: agora }).where(and(eq(whatsappMessages.id, centralId), eq(whatsappMessages.automatica, true)));
  }
}

/**
 * UM lote por vez no sistema inteiro (duas abas, duas campanhas): o limite diário e as 5 mensagens/s são do NÚMERO. A trava vence
 * sozinha depois de 70 s (a função da Vercel tem 60 s), então uma função que morreu não prende os envios.
 */
async function travarLote(agora: Date): Promise<Date | null> {
  await lerConfigYcloud();
  const marca = new Date(agora.getTime() + 70_000);
  const r = await getDb().update(ycloudConfig).set({ loteAte: marca })
    .where(and(eq(ycloudConfig.id, 1), or(isNull(ycloudConfig.loteAte), lt(ycloudConfig.loteAte, agora)))).returning({ loteAte: ycloudConfig.loteAte });
  return r.length ? (r[0].loteAte ?? marca) : null;
}
/** Só solta a trava se ela ainda for a DESTE lote (a de outro lote, que assumiu depois de a nossa vencer, fica). */
async function destravarLote(marca: Date) {
  await getDb().update(ycloudConfig).set({ loteAte: null }).where(and(eq(ycloudConfig.id, 1), eq(ycloudConfig.loteAte, marca))).catch(() => undefined);
}

export async function enviarLote(campanhaId: number, userId: number): Promise<ResultadoLote> {
  const marca = await travarLote(depsYcloud().agora());
  if (!marca) {
    return { status: "enviando", enviadas: 0, falhas: 0, incertas: 0, restantes: (await contarRestantes(campanhaId)).fila, aguardarSegundos: 10, motivo: "Outro lote está sendo enviado agora; este continua em seguida." };
  }
  try { return await enviarLoteTravado(campanhaId, userId); }
  finally { await destravarLote(marca); }
}

async function enviarLoteTravado(campanhaId: number, userId: number): Promise<ResultadoLote> {
  const d = depsYcloud();
  const db = getDb();
  const inicio = d.agora().getTime();
  const relogio = () => d.agora().getTime();
  const res: ResultadoLote = { status: "enviando", enviadas: 0, falhas: 0, incertas: 0, restantes: 0, aguardarSegundos: null, motivo: null };
  const [camp] = await db.select().from(ycloudCampanhas).where(eq(ycloudCampanhas.id, campanhaId)).limit(1);
  if (!camp) throw new RecusaYcloud("Campanha não encontrada.");
  const fim = async (): Promise<ResultadoLote> => {
    const r = await contarRestantes(campanhaId);
    res.restantes = r.fila;
    const [atual] = await db.select({ status: ycloudCampanhas.status, motivo: ycloudCampanhas.motivoPausa }).from(ycloudCampanhas).where(eq(ycloudCampanhas.id, campanhaId)).limit(1);
    res.status = atual?.status ?? res.status;
    if (res.status === "enviando" && r.fila === 0 && r.enviando === 0) {
      await db.update(ycloudCampanhas).set({ status: "concluida", concluidaEm: d.agora(), atualizadoEm: d.agora() })
        .where(and(eq(ycloudCampanhas.id, campanhaId), eq(ycloudCampanhas.status, "enviando")));
      res.status = "concluida";
      await auditarYcloud({ acao: "campanha_concluida", usuarioId: userId, campanhaId, modelo: camp.modeloNome });
    }
    if (res.status === "pausada" && !res.motivo) res.motivo = atual?.motivo ?? null;
    return res;
  };
  if (camp.status !== "enviando") { res.motivo = camp.status === "pausada" ? (camp.motivoPausa ?? "Campanha pausada.") : null; return fim(); }

  await expirarReservas(d.agora());
  const situacao = await situacaoParaDisparo();
  if (!situacao.ok || !situacao.apiKey || !situacao.conferencia?.numero) {
    await pausarCampanha(campanhaId, situacao.motivo ?? "Disparo indisponível.");
    res.motivo = situacao.motivo;
    return fim();
  }
  const vagas = vagasDoDia(situacao.cfg, situacao.conferencia.limiteDiario, await usadosNas24h(d.agora()));
  if (vagas.restante <= 0) {
    await pausarCampanha(campanhaId, `Limite de ${Math.min(vagas.limiteDiario, vagas.tetoDia)} destinatários em 24 h atingido. Clique em "Continuar" depois que a janela de 24 h liberar vagas.`);
    return fim();
  }
  // reserva atômica (um lote por vez por linha; duas abas não pegam o mesmo envio)
  const sub = db.select({ id: ycloudEnvios.id }).from(ycloudEnvios)
    .where(and(eq(ycloudEnvios.campanhaId, campanhaId), eq(ycloudEnvios.status, "na_fila"))).orderBy(ycloudEnvios.id)
    .limit(Math.min(LOTE_ENVIO_YCLOUD, vagas.restante)).for("update", { skipLocked: true });
  const reservados = await db.update(ycloudEnvios).set({ status: "enviando", reservadoEm: d.agora(), tentativas: sql`${ycloudEnvios.tentativas} + 1`, atualizadoEm: d.agora() })
    .where(and(inArray(ycloudEnvios.id, sub), eq(ycloudEnvios.status, "na_fila"))).returning();
  reservados.sort((a, b) => a.id - b.id);

  // opt-out (API e Central de Vendas) e repetição do mesmo modelo conferidos de novo na hora do envio
  let bloqueios: Awaited<ReturnType<typeof bloqueiosDeOptout>>;
  try { bloqueios = await bloqueiosDeOptout(reservados.map(r => r.chaveTelefone), reservados.map(r => r.leadId).filter((x): x is number => x !== null)); }
  catch (e) {
    await devolverParaFila(reservados.map(r => r.id));
    await pausarCampanha(campanhaId, e instanceof Error ? e.message : "Não consegui conferir o opt-out.");
    return fim();
  }
  // "já recebeu este modelo": conferido DENTRO da trava de um lote por vez (travarLote — UPDATE atômico no banco), de novo para cada
  // envio logo antes do POST (cobre até a trava vencida de um lote que demorou), sempre com no mínimo 1 dia
  const janela = Math.max(1, situacao.cfg.janelaRepeticaoDias);
  const desdeRepeticao = new Date(d.agora().getTime() - janela * 24 * 60 * 60_000);
  const modeloDoLote = { nome: camp.modeloNome, idioma: camp.modeloIdioma };
  const conexaoId = await d.conexaoDaEmpresaId().catch(() => null);
  const origem = situacao.conferencia.numero;
  let ultimoEnvio = 0;
  let falhasSeguidas = 0;
  for (let i = 0; i < reservados.length; i++) {
    const e = reservados[i];
    const pendentes = () => reservados.slice(i).map(x => x.id);
    if (relogio() - inicio > ORCAMENTO_LOTE_MS) { await devolverParaFila(pendentes()); break; }
    if (i > 0 && i % 20 === 0) {
      const [st] = await db.select({ status: ycloudCampanhas.status }).from(ycloudCampanhas).where(eq(ycloudCampanhas.id, campanhaId)).limit(1);
      if (st?.status !== "enviando") { await devolverParaFila(pendentes()); break; }
    }
    if (bloqueios.chaves.has(e.chaveTelefone) || (e.leadId !== null && bloqueios.leads.has(e.leadId))) {
      await db.update(ycloudEnvios).set({ status: "falhou", erroCodigo: "OPTOUT", motivo: "Não enviada: a pessoa pediu para não receber.", falhouEm: d.agora(), atualizadoEm: d.agora() })
        .where(eq(ycloudEnvios.id, e.id));
      res.falhas++;
      continue;
    }
    let repetido: boolean;
    try { repetido = (await verificacoesYcloud.jaReceberamOModelo([e.chaveTelefone], modeloDoLote, desdeRepeticao, { excetoCampanha: campanhaId, incluirFila: false })).size > 0; }
    catch {
      // R2-2: mesma regra do opt-out — sem conferir, nada sai: este e os demais reservados voltam para a fila (nunca "incerto") e pausa
      await devolverParaFila(pendentes());
      await pausarCampanha(campanhaId, "Não consegui conferir quem já recebeu este modelo; nada foi enviado. Clique em \"Continuar envio\" para tentar de novo.");
      res.motivo = "Não consegui conferir quem já recebeu este modelo; campanha pausada.";
      break;
    }
    if (repetido) {
      await db.update(ycloudEnvios).set({ status: "falhou", erroCodigo: "REPETIDO", motivo: `Não enviada: já recebeu este modelo nos últimos ${janela} dia(s).`, falhouEm: d.agora(), atualizadoEm: d.agora() })
        .where(eq(ycloudEnvios.id, e.id));
      res.falhas++;
      continue;
    }
    const espera = ultimoEnvio + INTERVALO_MINIMO_ENVIO_MS - relogio();
    if (espera > 0) await d.esperar(espera);
    ultimoEnvio = relogio();
    const params = (e.parametros ?? {}) as { cabecalho?: string[]; corpo?: string[]; textoCompleto?: string };
    try {
      const r = await enfileirarModeloYcloud({ apiKey: situacao.apiKey, fetchImpl: d.fetch }, {
        from: origem, to: e.telefone, externalId: e.externalId, nome: camp.modeloNome, idioma: camp.modeloIdioma,
        cabecalho: (params.cabecalho ?? []).map(text => ({ type: "text" as const, text })),
        corpo: (params.corpo ?? []).map(text => ({ type: "text" as const, text })),
      });
      falhasSeguidas = 0;
      const falhouNaHora = r?.status === "failed";
      const centralId = falhouNaHora ? null : await registrarNaCentral(conexaoId, { ...e, texto: params.textoCompleto || e.texto });
      await gravarAceite(e.id, r, falhouNaHora, centralId);
      if (falhouNaHora) res.falhas++; else res.enviadas++;
    } catch (err) {
      // erro que não é resposta HTTP da YCloud (rede, exceção inesperada) e 5xx são AMBÍGUOS: o envio pode ter saído
      const x = err instanceof ErroYcloud ? err : new ErroYcloud("Falha inesperada no envio.", null, null);
      if (x.ambiguo || (x.status ?? 0) >= 500) {
        await db.update(ycloudEnvios).set({ status: "incerto", motivo: "Sem resposta clara da YCloud (o envio pode ter saído). Não é reenviado automaticamente; o aviso de entrega confirma.", atualizadoEm: d.agora() })
          .where(and(eq(ycloudEnvios.id, e.id), eq(ycloudEnvios.status, "enviando")));
        res.incertas++;
        continue;
      }
      if (x.status === 429) {
        await devolverParaFila(pendentes());
        res.aguardarSegundos = Math.max(1, Math.min(x.retryAfterS ?? 30, 3600));
        res.motivo = "A YCloud pediu para esperar (limite de ritmo). O envio continua depois da pausa.";
        break;
      }
      if (x.codigo && CODIGOS_DA_CONTA.has(x.codigo)) {
        await devolverParaFila(pendentes());
        await pausarCampanha(campanhaId, x.message);
        res.motivo = x.message;
        break;
      }
      {
        await db.update(ycloudEnvios).set({ status: "falhou", erroCodigo: x.codigo ?? (x.status ? `HTTP_${x.status}` : null), motivo: x.message.slice(0, 300), falhouEm: d.agora(), atualizadoEm: d.agora() })
          .where(eq(ycloudEnvios.id, e.id));
        if (x.codigo === "RECIPIENT_UNSUBSCRIBED") await registrarOptoutInterno(e.telefone, "ycloud_descadastro", e.leadId, null);
        res.falhas++;
        falhasSeguidas++;
      }
      if (falhasSeguidas >= 5) {
        await devolverParaFila(reservados.slice(i + 1).map(z => z.id));
        await pausarCampanha(campanhaId, "Cinco falhas seguidas: campanha pausada para conferir o modelo e a conta.");
        res.motivo = "Cinco falhas seguidas: campanha pausada.";
        break;
      }
    }
  }
  return fim();
}

// ── Pausar, continuar, cancelar ──

export async function mudarCampanha(campanhaId: number, acao: "pausar" | "continuar" | "cancelar", userId: number) {
  const d = depsYcloud();
  const db = getDb();
  const [c] = await db.select().from(ycloudCampanhas).where(eq(ycloudCampanhas.id, campanhaId)).limit(1);
  if (!c) throw new RecusaYcloud("Campanha não encontrada.");
  if (c.status === "concluida" || c.status === "cancelada") throw new RecusaYcloud("Campanha já encerrada.");
  if (acao === "pausar") await pausarCampanha(campanhaId, "Pausada pelo administrador.");
  if (acao === "continuar") {
    await db.update(ycloudCampanhas).set({ status: "enviando", motivoPausa: null, atualizadoEm: d.agora() }).where(and(eq(ycloudCampanhas.id, campanhaId), eq(ycloudCampanhas.status, "pausada")));
  }
  if (acao === "cancelar") {
    await db.update(ycloudCampanhas).set({ status: "cancelada", concluidaEm: d.agora(), atualizadoEm: d.agora() }).where(eq(ycloudCampanhas.id, campanhaId));
    await db.update(ycloudEnvios).set({ status: "falhou", erroCodigo: "CANCELADA", motivo: "Campanha cancelada antes do envio.", falhouEm: d.agora(), atualizadoEm: d.agora() })
      .where(and(eq(ycloudEnvios.campanhaId, campanhaId), eq(ycloudEnvios.status, "na_fila")));
  }
  await auditarYcloud({ acao: `campanha_${acao}`, usuarioId: userId, campanhaId, modelo: c.modeloNome });
}

// ── Painel ──

const totaisSql = {
  total: sql<number>`count(*)`.mapWith(Number),
  fila: sql<number>`count(*) filter (where ${ycloudEnvios.status} in ('na_fila', 'enviando'))`.mapWith(Number),
  aceitas: sql<number>`count(*) filter (where ${ycloudEnvios.status} = 'aceita')`.mapWith(Number),
  enviadas: sql<number>`count(*) filter (where ${ycloudEnvios.status} in ('enviada', 'entregue', 'lida'))`.mapWith(Number),
  entregues: sql<number>`count(*) filter (where ${ycloudEnvios.status} in ('entregue', 'lida'))`.mapWith(Number),
  lidas: sql<number>`count(*) filter (where ${ycloudEnvios.status} = 'lida')`.mapWith(Number),
  falhas: sql<number>`count(*) filter (where ${ycloudEnvios.status} = 'falhou')`.mapWith(Number),
  incertas: sql<number>`count(*) filter (where ${ycloudEnvios.status} = 'incerto')`.mapWith(Number),
  custoFinal: sql<string | null>`sum(${ycloudEnvios.preco}) filter (where ${ycloudEnvios.precoFinal})`,
  custoProvisorio: sql<string | null>`sum(${ycloudEnvios.preco}) filter (where not ${ycloudEnvios.precoFinal} and ${ycloudEnvios.status} <> 'falhou')`,
  moeda: sql<string | null>`max(${ycloudEnvios.moeda})`,
};
const numeroOuNulo = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v));

export async function painelCampanhas() {
  const db = getDb();
  const camps = await db.select().from(ycloudCampanhas).orderBy(desc(ycloudCampanhas.id)).limit(30);
  if (!camps.length) return [];
  const totais = await db.select({ campanhaId: ycloudEnvios.campanhaId, ...totaisSql }).from(ycloudEnvios)
    .where(inArray(ycloudEnvios.campanhaId, camps.map(c => c.id))).groupBy(ycloudEnvios.campanhaId);
  return camps.map(c => {
    const t = totais.find(x => x.campanhaId === c.id);
    return {
      id: c.id, nome: c.nome, modelo: `${c.modeloNome} (${c.modeloIdioma})`, status: c.status, motivoPausa: c.motivoPausa, criadaEm: c.criadaEm,
      concluidaEm: c.concluidaEm, custoEstimado: numeroOuNulo(c.custoEstimado), moedaEstimada: c.moeda,
      totais: {
        total: t?.total ?? 0, fila: t?.fila ?? 0, aceitas: t?.aceitas ?? 0, enviadas: t?.enviadas ?? 0, entregues: t?.entregues ?? 0, lidas: t?.lidas ?? 0,
        falhas: t?.falhas ?? 0, incertas: t?.incertas ?? 0,
      },
      custoRegistrado: numeroOuNulo(t?.custoFinal), custoProvisorio: numeroOuNulo(t?.custoProvisorio), moedaRegistrada: t?.moeda ?? null,
    };
  });
}

export async function detalheCampanha(campanhaId: number) {
  const db = getDb();
  const motivos = await db.select({ codigo: ycloudEnvios.erroCodigo, motivo: ycloudEnvios.motivo, n: sql<number>`count(*)`.mapWith(Number) }).from(ycloudEnvios)
    .where(and(eq(ycloudEnvios.campanhaId, campanhaId), eq(ycloudEnvios.status, "falhou"))).groupBy(ycloudEnvios.erroCodigo, ycloudEnvios.motivo)
    .orderBy(desc(sql`count(*)`)).limit(20);
  const falhas = await db.select({ id: ycloudEnvios.id, nome: ycloudEnvios.nome, telefone: ycloudEnvios.telefone, status: ycloudEnvios.status, motivo: ycloudEnvios.motivo, codigo: ycloudEnvios.erroCodigo })
    .from(ycloudEnvios).where(and(eq(ycloudEnvios.campanhaId, campanhaId), inArray(ycloudEnvios.status, ["falhou", "incerto"]))).orderBy(ycloudEnvios.id).limit(200);
  return {
    motivos: motivos.map(m => ({ codigo: m.codigo, motivo: m.motivo ?? "Sem motivo informado", quantidade: m.n })),
    falhas: falhas.map(f => ({ id: f.id, nome: f.nome, telefone: telefoneMascarado(f.telefone), status: f.status, motivo: f.motivo, codigo: f.codigo })),
  };
}

// ── Opt-out ──

async function registrarOptoutInterno(telefone: string, origem: "painel" | "whatsapp_preferencia" | "ycloud_descadastro", leadId: number | null, userId: number | null) {
  const chaveTelefone = chaveCanonicaTelefone(telefone);
  if (!chaveTelefone) return;
  await getDb().insert(ycloudOptout).values({ telefone: telefone.slice(0, 20), chaveTelefone, origem, leadId, registradoPor: userId, criadoEm: depsYcloud().agora() }).onConflictDoNothing();
}

/** Opt-out vindo do aviso da YCloud (preferência de marketing "stop"). Só telefone em E.164; nada sai daqui. */
export async function registrarOptoutDoAviso(telefoneBruto: unknown, origem: "whatsapp_preferencia" | "ycloud_descadastro") {
  const t = typeof telefoneBruto === "string" && /^\+?\d{10,15}$/.test(telefoneBruto) ? `+${telefoneBruto.replace(/\D/g, "")}` : null;
  if (t) await registrarOptoutInterno(t, origem, null, null);
}

/** Pelo painel: por lead do CRM ou por um envio de campanha (o telefone sai do banco, nunca da tela). */
export async function registrarOptoutPeloPainel(alvo: { leadId?: number; envioId?: number }, userId: number) {
  const db = getDb();
  let telefone: string | null = null;
  let leadId: number | null = null;
  if (alvo.envioId) {
    const [e] = await db.select({ telefone: ycloudEnvios.telefone, leadId: ycloudEnvios.leadId }).from(ycloudEnvios).where(eq(ycloudEnvios.id, alvo.envioId)).limit(1);
    telefone = e?.telefone ?? null; leadId = e?.leadId ?? null;
  } else if (alvo.leadId) {
    const [l] = await db.select({ telefone: leads.phone }).from(leads).where(eq(leads.id, alvo.leadId)).limit(1);
    telefone = telefoneE164(l?.telefone); leadId = alvo.leadId;
  }
  if (!telefone) throw new RecusaYcloud("Cadastro sem telefone válido.");
  await registrarOptoutInterno(telefone, "painel", leadId, userId);
  // envios ainda na fila deste telefone não saem mais (o lote confere de novo, mas já fica claro no painel)
  await db.update(ycloudEnvios).set({ status: "falhou", erroCodigo: "OPTOUT", motivo: "Não enviada: a pessoa pediu para não receber.", falhouEm: depsYcloud().agora(), atualizadoEm: depsYcloud().agora() })
    .where(and(eq(ycloudEnvios.chaveTelefone, chaveCanonicaTelefone(telefone) ?? "-"), eq(ycloudEnvios.status, "na_fila")));
  const apiKey = await chaveYcloud().catch(() => null);
  if (apiKey) await criarDescadastroYcloud({ apiKey, fetchImpl: depsYcloud().fetch }, telefone).catch(() => undefined); // melhor esforço
  await auditarYcloud({ acao: "optout_registrado", usuarioId: userId, quantidade: 1 });
  return { ok: true as const };
}

export async function totalOptout() {
  const [r] = await getDb().select({ n: sql<number>`count(*)`.mapWith(Number) }).from(ycloudOptout);
  return Number(r?.n ?? 0);
}

// ── Eco em coexistência (para o roteamento da Dolores ligar) ──

/** Só é eco se o envio da campanha ao mesmo número saiu há no máximo isso. */
export const JANELA_ECO_CAMPANHA_MS = 10 * 60_000;

/**
 * Em coexistência, a mensagem enviada pela API aparece no app e pode chegar pela Evolution como "enviada pela empresa" (fromMe).
 * Regra SEGURA, por código: é eco de campanha só se (1) houve envio de campanha pela API ao MESMO número (forma canônica, regra estrita
 * do número do dono) aceito há no máximo 10 min e (2) o texto do eco CONTÉM o corpo preenchido daquele envio (`ycloud_envios.texto`).
 * Qualquer dúvida (sem texto, texto diferente, fora da janela) → false = é mensagem da EQUIPE (o roteamento segue a regra de sempre).
 * Ligação pela frente da Dolores: ver a story C7, "Eco em coexistência".
 */
export async function ehEcoDeCampanhaOficial(numero: string, textoDoEco: string | null | undefined, agora: Date = depsYcloud().agora()): Promise<boolean> {
  const chave = chaveCanonicaTelefone(numero);
  const eco = textoComparavel(textoDoEco);
  if (!chave || !eco) return false;
  try {
    const desde = new Date(agora.getTime() - JANELA_ECO_CAMPANHA_MS);
    const linhas = await getDb().select({ texto: ycloudEnvios.texto }).from(ycloudEnvios)
      .where(and(eq(ycloudEnvios.chaveTelefone, chave), inArray(ycloudEnvios.status, ["aceita", "enviada", "entregue", "lida", "incerto"]),
        gte(ycloudEnvios.aceitoEm, desde), lt(ycloudEnvios.aceitoEm, new Date(agora.getTime() + 60_000)))).limit(20);
    return linhas.some(l => { const corpo = textoComparavel(l.texto); return corpo.length >= 3 && eco.includes(corpo); });
  } catch { return false; }
}
