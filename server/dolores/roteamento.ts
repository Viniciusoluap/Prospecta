// EPIC-025 (Dolores, etapa 9) — o lado do SERVIDOR do roteamento do número da empresa (regra do dono de 20/11/2026: "eu quero uma
// conexão só"). A decisão é pura (shared/dolores/roteamento.ts); aqui ficam as consultas e os registros:
// - quem é o remetente, pelo número que veio do servidor do WhatsApp (nunca pelo texto), contra os telefones dos cadastros, com a
//   MESMA comparação estrita do dono (`ehNumeroDoDono`: número completo com 55, só a variação do 9º dígito);
// - a mensagem na Central (conexão efetiva da empresa, sem a conversa do dono e sem grupo);
// - a reentrega do aviso (uma mensagem é roteada UMA vez: whatsapp_roteamento_vistos);
// - as mensagens que o número da empresa enviou (fromMe): a da equipe cala a Dolores naquela conversa por N horas;
// - o ÚNICO envio a um contato na conversa direta que não é o dono (`enviarAoContato`): saudação, avisos e a resposta ao cliente;
// - a saudação de campanha (uma ativa; uma vez por número por campanha; só a desconhecido; teto diário);
// - os avisos de ligação e de áudio (no máximo 1 a cada N horas por número).
// Nada aqui é comando: comando continua só do número do dono, por texto, em server/dolores/whatsapp.ts.
import { createHmac } from "node:crypto";
import { and, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { avaliacoes, financiamentos, leads, operationalProjects, regularizacoes, users, whatsappMessages } from "../../drizzle/schema.js";
import {
  whatsappAtendimentoConfig, whatsappAtendimentoContagem, whatsappAvisosNumero, whatsappCampanhas, whatsappRoteamentoVistos, whatsappSaudacoes,
  whatsappSilencio, whatsappLidNumeros, whatsappAtendimentoModo, type WhatsappAtendimentoConfig, AVISO_AUDIO_PADRAO, AVISO_LIGACAO_PADRAO,
} from "../../drizzle/schema-whatsapp-atendimento.js";
import { estadoDoAtendimento, silencioValeDepoisDeDevolver, type EstadoDoAtendimento } from "../../shared/dolores/modo-conversa.js";
import type { DoloresWhatsappConfig } from "../../drizzle/schema-dolores-whatsapp.js";
import { diaDeImperatriz } from "../../shared/dolores/grupos.js";
import { tratarLinksDaResposta } from "../../shared/dolores/links.js";
import { formaCanonicaDoNumero, textoFixoInvalido, type Categoria } from "../../shared/dolores/roteamento.js";
import { sanitizarTexto } from "../../shared/dolores/sanitizar.js";
import { cortarResposta, ehNumeroDoDono, mascararNumero, normalizarNumeroDono } from "../../shared/dolores/whatsapp.js";
import { ENV } from "../_core/env.js";
import { ehEcoDeCampanhaOficial } from "../ycloud/campanhas.js";
import { enviarAudioEvolution, enviarImagemEvolution, enviarTextoEvolution, numeroDoLidEvolution } from "../_core/evolution.js";
import { getDb } from "../db.js";
import { finalDoTelefone, gravarItemNaCentral, type LeadCandidato } from "../whatsapp-evolution-webhook.js";
import type { ConexaoDaEmpresa } from "../whatsapp-conexao-empresa.js";
import { urlDoSistemaParaLinks } from "./acoes/comum.js";
import { registrarAcao } from "./auditoria.js";
import { filtroDaSaida } from "./dados-pessoais.js";
import { erroParaLog } from "./erro-seguro.js";
import { podeFalarNoGrupo } from "./operacao.js";
import { midiasParaEnvio, type MidiaParaEnvio } from "./saudacao-midia.js";

// ── Dependências substituíveis nos testes ──

/** Envio a um contato (conversa direta). Devolve o id da mensagem na Evolution, ou null se não foi aceita. */
export type EnvioAoContato = (p: { instancia: string; numero: string; texto: string; prazoMs: number }) => Promise<string | null>;
const envioPadrao: EnvioAoContato = async ({ instancia, numero, texto, prazoMs }) => {
  const { configEvolution } = await import("../whatsapp-router.js");
  const c = await configEvolution();
  if (!c) return null;
  const comPrazo: typeof fetch = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(prazoMs) });
  // sem prévia de link; a chave da Evolution nunca segue redirecionamento para outro host
  return enviarTextoEvolution({ ...c, semRedirecionamento: true }, instancia, numero, texto, comPrazo, { linkPreview: false });
};
/**
 * EPIC-026 C3: envio de mídia a um contato (imagem com legenda ou áudio como mensagem de voz). O arquivo vai em base64 no pedido,
 * nunca por URL. Devolve o id da mensagem na Evolution, ou null se não foi aceita.
 */
export type EnvioDeMidiaAoContato = (p: { instancia: string; numero: string; midia: MidiaParaEnvio; legenda: string; prazoMs: number }) => Promise<string | null>;
const envioDeMidiaPadrao: EnvioDeMidiaAoContato = async ({ instancia, numero, midia, legenda, prazoMs }) => {
  const { configEvolution } = await import("../whatsapp-router.js");
  const c = await configEvolution();
  if (!c) return null;
  const comPrazo: typeof fetch = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(prazoMs) });
  const conf = { ...c, semRedirecionamento: true };
  return midia.tipo === "imagem"
    ? enviarImagemEvolution(conf, instancia, numero, { base64: midia.base64, mime: midia.mime, nome: midia.nome, legenda }, comPrazo)
    : enviarAudioEvolution(conf, instancia, numero, midia.base64, comPrazo);
};
/** EPIC-026 C2: o número real de um "@lid" consultado na Evolution (só leitura, prazo curto). null = não deu para saber. */
export type ResolverLid = (p: { instancia: string; lid: string; prazoMs: number }) => Promise<string | null>;
const resolverLidPadrao: ResolverLid = async ({ instancia, lid, prazoMs }) => {
  const { configEvolution } = await import("../whatsapp-router.js");
  const c = await configEvolution();
  if (!c) return null;
  const comPrazo: typeof fetch = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(prazoMs) });
  return numeroDoLidEvolution({ ...c, semRedirecionamento: true }, instancia, lid, comPrazo, prazoMs);
};
type Dependencias = { agora: () => Date; ms: () => number; enviar: EnvioAoContato; enviarMidia: EnvioDeMidiaAoContato; resolverLid: ResolverLid };
const padrao: Dependencias = { agora: () => new Date(), ms: () => Date.now(), enviar: envioPadrao, enviarMidia: envioDeMidiaPadrao, resolverLid: resolverLidPadrao };
let deps: Dependencias = { ...padrao };
/** Só para testes. Sem argumento, volta ao padrão. */
export function definirDependenciasRoteamento(d?: Partial<Dependencias>) { deps = d ? { ...deps, ...d } : { ...padrao }; }
export const agoraDoRoteamento = () => deps.agora();

const PRAZO_ENVIO_MS = 8_000;
/** EPIC-026 C3: a mídia (até 5 MB em base64) leva mais tempo para subir à Evolution e ao WhatsApp. */
export const PRAZO_ENVIO_MIDIA_MS = 15_000;
/** Mídia só é tentada com pelo menos isto até o fim do prazo do aviso (senão estouraria e ficaria sem confirmação). */
export const MINIMO_PARA_ENVIAR_MIDIA_MS = 6_000;
/** QA-SEG C3 achado 1: o eco de uma MÍDIA automática só casa com envio EM ANDAMENTO, criado há no máximo isto (relógio do banco). */
export const JANELA_ECO_MIDIA_MS = PRAZO_ENVIO_MIDIA_MS + 15_000;
/** Com menos que isto até o fim do prazo do aviso, nada é enviado. */
export const MINIMO_PARA_ENVIAR_CONTATO_MS = 1_500;
/** Tamanho máximo do que vai a um contato numa mensagem (curta). */
export const MAX_CARACTERES_CONTATO = 1_000;

// ── Número: resumo (nunca o número inteiro em tabela, log ou auditoria) ──

/** Resumo HMAC (segredo do servidor) da forma canônica do número; sem segredo, null (quem chama não grava nada). */
export function chaveDoNumero(numero: string | null | undefined): string | null {
  const c = formaCanonicaDoNumero(numero);
  if (!c || !ENV.cookieSecret) return null;
  return createHmac("sha256", ENV.cookieSecret).update(`whatsapp-numero:${c}`).digest("hex").slice(0, 32);
}

// ── Configuração ──

export const CONFIG_ATENDIMENTO_PADRAO: Omit<WhatsappAtendimentoConfig, "atualizadoEm" | "atualizadoPor"> = {
  id: 1, clienteLigado: false, clienteTetoDia: 10, clienteTetoGlobalDia: 100, silencioHoras: 6, saudacaoTetoDia: 50,
  transcricaoLigada: false, transcricaoDuracaoMaxS: 120, transcricaoTetoNumeroDia: 10, transcricaoTetoGlobalDia: 100,
  avisoIntervaloHoras: 3, avisoLigacao: AVISO_LIGACAO_PADRAO, avisoAudio: AVISO_AUDIO_PADRAO,
  // sem a linha/migração: avisos DESLIGADOS (falha fechada); no banco o padrão é ligado (pedido do dono), com teto
  avisosLigados: false, avisoTetoGlobalDia: 50,
};

/** A configuração da etapa 9. Sem a linha ou sem a migração 0135: tudo DESLIGADO (falha fechada). */
export async function lerConfigAtendimento(): Promise<typeof CONFIG_ATENDIMENTO_PADRAO> {
  try {
    const [c] = await getDb().select().from(whatsappAtendimentoConfig).where(eq(whatsappAtendimentoConfig.id, 1)).limit(1);
    return c ?? CONFIG_ATENDIMENTO_PADRAO;
  } catch {
    return CONFIG_ATENDIMENTO_PADRAO;
  }
}

// ── Contadores, reentrega e silêncio ──

/** Soma 1 na chave se ainda estiver abaixo do teto; false quando já está no teto (atômico). */
export async function vagaNoContador(chave: string, teto: number): Promise<boolean> {
  const [r] = await getDb().insert(whatsappAtendimentoContagem).values({ chave: chave.slice(0, 80), total: 1 })
    .onConflictDoUpdate({ target: whatsappAtendimentoContagem.chave, set: { total: sql`${whatsappAtendimentoContagem.total} + 1`, ultimaEm: sql`now()` },
      setWhere: sql`${whatsappAtendimentoContagem.total} < ${teto}` })
    .returning({ total: whatsappAtendimentoContagem.total });
  return !!r;
}

/** A mensagem (instância + id) é roteada uma vez só: true só para quem gravou primeiro. */
export async function reivindicarRoteamento(instancia: string, externalId: string): Promise<boolean> {
  const r = await getDb().insert(whatsappRoteamentoVistos).values({ instancia, externalId: externalId.slice(0, 160) }).onConflictDoNothing()
    .returning({ id: whatsappRoteamentoVistos.externalId });
  return r.length === 1;
}

/** EPIC-026 C6: a tabela da migração 0138 ainda não existe (publicação antes da migração) → sem assunção, regra de sempre. */
const semTabelaDoModo = (e: unknown) => {
  const c = e as { code?: unknown; cause?: { code?: unknown } } | null;
  return c?.code === "42P01" || c?.cause?.code === "42P01";
};

/** EPIC-026 C6: a hora do último "Devolver para a Dolores" desta conversa (qualquer instância), ou null. Falha ao ler → lança. */
async function devolvidaEm(chave: string): Promise<Date | null> {
  try {
    const [r] = await getDb().select({ em: sql<Date | null>`max(${whatsappAtendimentoModo.alteradoEm})`.mapWith(v => (v ? new Date(v) : null)) })
      .from(whatsappAtendimentoModo).where(and(eq(whatsappAtendimentoModo.chaveNumero, chave), eq(whatsappAtendimentoModo.modo, "dolores")));
    return r?.em ?? null;
  } catch (e) {
    if (semTabelaDoModo(e)) return null;
    throw e;
  }
}

/**
 * A equipe respondeu: a Dolores fica calada nesta conversa até `desde + horas`. Nunca encurta um silêncio maior já gravado.
 * EPIC-026 C6: mensagem da equipe ANTERIOR ao último "Devolver para a Dolores" (eco atrasado) não cala de novo; a enviada depois
 * dele cala pelo prazo normal. Falha ao ler o "Devolver" → cala (falha fechada).
 */
export async function silenciarConversa(numero: string, horas: number, desde: Date = deps.agora()): Promise<void> {
  const chave = chaveDoNumero(numero);
  if (!chave) return;
  const devolvida = await devolvidaEm(chave).catch(() => null);
  if (!silencioValeDepoisDeDevolver(desde, devolvida)) return;
  const ate = new Date(desde.getTime() + Math.max(1, horas) * 60 * 60_000);
  await getDb().insert(whatsappSilencio).values({ chaveNumero: chave, ate })
    .onConflictDoUpdate({ target: whatsappSilencio.chaveNumero, set: { ate, atualizadoEm: sql`now()` }, setWhere: sql`${whatsappSilencio.ate} < ${ate}` });
}

/**
 * EPIC-026 C6 — quem atende a conversa agora: "assumida" (a equipe assumiu pelo botão, sem prazo) > "silencio" (a equipe respondeu
 * há menos de N horas; `ate` = até quando) > "dolores". A assunção conta em QUALQUER instância (QA-SEG C6 B3); `_instancia` fica
 * na assinatura só por compatibilidade. Falha ao ler → "silencio" sem prazo (calada).
 */
export async function situacaoDoSilencio(numero: string, agora: Date = deps.agora(), _instancia?: string | null): Promise<{ estado: EstadoDoAtendimento; ate: Date | null }> {
  const chave = chaveDoNumero(numero);
  if (!chave) return { estado: "silencio", ate: null };
  const db = getDb();
  let modo: "humano" | "dolores" | null = null;
  try {
    // QA-SEG C6 B3: "humano" vale em QUALQUER instância (na dúvida, Dolores calada); "dolores" só tira a assunção se não houver
    // nenhuma linha "humano" para este número
    const linhas = await db.select({ modo: whatsappAtendimentoModo.modo }).from(whatsappAtendimentoModo).where(eq(whatsappAtendimentoModo.chaveNumero, chave));
    modo = linhas.some(l => l.modo === "humano") ? "humano" : linhas.length ? "dolores" : null;
  } catch (e) {
    if (!semTabelaDoModo(e)) return { estado: "silencio", ate: null };
  }
  try {
    const [r] = await db.select({ ate: whatsappSilencio.ate }).from(whatsappSilencio).where(eq(whatsappSilencio.chaveNumero, chave)).limit(1);
    const estado = estadoDoAtendimento({ modo, silencioAte: r?.ate ?? null, agora });
    return { estado, ate: estado === "silencio" ? r!.ate : null };
  } catch {
    return { estado: "silencio", ate: null };
  }
}

/** A Dolores está calada nesta conversa (assumida pela equipe ou silêncio automático)? Falha ao ler → calada (falha fechada). */
export async function conversaEmSilencio(numero: string, agora: Date = deps.agora(), instancia?: string | null): Promise<boolean> {
  return (await situacaoDoSilencio(numero, agora, instancia)).estado !== "dolores";
}

// ── Quem é o remetente ──

const casa = (remetente: string, telefone: string | null | undefined) => {
  const n = normalizarNumeroDono(telefone);
  return !!n && ehNumeroDoDono(remetente, n);
};

/** `candidatos`: os leads (inclusive excluídos) com os mesmos 8 finais — reaproveitados ao gravar na Central (sem consultar de novo). */
export type Remetente = { categoria: Categoria; leadId: number | null; cadastros: number; candidatos?: LeadCandidato[] };

/**
 * Identifica, POR CÓDIGO, quem escreveu: o número (só dígitos, com 55, vindo do endereço do WhatsApp) contra os telefones de
 * usuário ativo do sistema e dos cadastros de cliente — CRM (obra, incorporação e jurídico se ligam ao lead), financiamento,
 * regularização, avaliação e projetos. Cada cadastro conta como o lead a que está ligado; sem lead, conta como cadastro próprio.
 * - usuário ativo do sistema → "usuario" (Central; nada automático);
 * - exatamente UM lead → "cliente" (Dolores pode responder);
 * - um só cadastro, mas sem lead do CRM → "cadastro" (Central; as leituras fechadas são do CRM, então a equipe responde);
 * - mais de um cliente/cadastro distinto → "varios" (equipe; nunca adivinha);
 * - nenhum → "desconhecido" (Central + saudação).
 */
export async function identificarRemetente(numero: string): Promise<Remetente> {
  const db = getDb();
  const d = numero.replace(/\D/g, "");
  // QA-SEG E9 achado 4: cada cadastro é filtrado NO BANCO pelos 8 dígitos finais (expressão dos índices da 0135), sem limite que
  // corte candidatos; a conferência estrita (`casa`) continua em memória, só sobre esses.
  const final = d.slice(-8);
  if (final.length < 8) return { categoria: "desconhecido", leadId: null, cadastros: 0, candidatos: [] };
  const mesmoFinal = (coluna: Parameters<typeof finalDoTelefone>[0]) => sql`${finalDoTelefone(coluna)} = ${final}`;
  const [us, todosLeads, fins, regs, avs, projs] = await Promise.all([
    db.select({ id: users.id, phone: users.phone }).from(users).where(and(eq(users.active, true), mesmoFinal(users.phone))),
    db.select({ id: leads.id, nome: leads.name, phone: leads.phone, excluido: leads.deletedAt }).from(leads).where(mesmoFinal(leads.phone)),
    db.select({ id: financiamentos.id, leadId: financiamentos.leadId, tel: financiamentos.clienteTel }).from(financiamentos).where(mesmoFinal(financiamentos.clienteTel)),
    db.select({ id: regularizacoes.id, leadId: regularizacoes.leadId, tel: regularizacoes.clientPhone }).from(regularizacoes).where(mesmoFinal(regularizacoes.clientPhone)),
    db.select({ id: avaliacoes.id, leadId: avaliacoes.leadId, tel: avaliacoes.clienteTel }).from(avaliacoes).where(mesmoFinal(avaliacoes.clienteTel)),
    db.select({ id: operationalProjects.id, leadId: operationalProjects.leadId, tel: operationalProjects.clientPhone }).from(operationalProjects).where(mesmoFinal(operationalProjects.clientPhone)),
  ]);
  const candidatos: LeadCandidato[] = todosLeads.map(l => ({ id: l.id, nome: l.nome, phone: l.phone }));
  const ls = todosLeads.filter(l => !l.excluido);
  const r = (x: Omit<Remetente, "candidatos">): Remetente => ({ ...x, candidatos });
  if (us.some(u => casa(d, u.phone))) return r({ categoria: "usuario", leadId: null, cadastros: 0 });
  const identidades = new Set<string>();
  for (const l of ls) if (casa(d, l.phone)) identidades.add(`lead:${l.id}`);
  const ligados: Array<[string, Array<{ id: number; leadId: number | null; tel: string | null }>]> = [["fin", fins], ["reg", regs], ["aval", avs], ["proj", projs]];
  for (const [prefixo, linhas] of ligados) for (const x of linhas) if (casa(d, x.tel)) identidades.add(x.leadId ? `lead:${x.leadId}` : `${prefixo}:${x.id}`);
  if (identidades.size === 0) return r({ categoria: "desconhecido", leadId: null, cadastros: 0 });
  if (identidades.size > 1) return r({ categoria: "varios", leadId: null, cadastros: identidades.size });
  const [unica] = Array.from(identidades);
  if (!unica.startsWith("lead:")) return r({ categoria: "cadastro", leadId: null, cadastros: 1 });
  const leadId = Number(unica.slice(5));
  // o lead ligado precisa estar ativo no CRM (financiamento ligado a lead excluído não vira cliente atendido). O lead ligado a um
  // cadastro pode ter OUTRO telefone (fora dos candidatos): confere no banco.
  const ativo = ls.some(l => l.id === leadId)
    || (await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, leadId), isNull(leads.deletedAt))).limit(1)).length > 0;
  return ativo ? r({ categoria: "cliente", leadId, cadastros: 1 }) : r({ categoria: "cadastro", leadId: null, cadastros: 1 });
}

// ── Central ──

/**
 * Mensagem recebida de terceiro gravada na Central (conexão da empresa). Nunca a do dono nem de grupo (quem chama decide).
 * EPIC-026 C2: `numero` é o número conferido pelo roteamento — obrigatório quando o endereço é "@lid" (antes a mensagem com "@lid" e
 * número no `remoteJidAlt`/`senderPn` era reivindicada e depois NÃO entrava na Central, porque a gravação só aceitava
 * "@s.whatsapp.net"). `semNumero` grava a conversa de número não identificado (chave = o "@lid").
 */
export async function gravarEntradaNaCentral(conn: ConexaoDaEmpresa, item: unknown, o: { mensagem?: string | null; leadsCandidatos?: LeadCandidato[]; numero?: string | null; semNumero?: string | null } = {}) {
  return gravarItemNaCentral(conn, item, { centralVendas: false, baixarMidia: false, mensagem: o.mensagem ?? null, leadsCandidatos: o.leadsCandidatos, numero: o.numero ?? null, semNumero: o.semNumero ?? null });
}

// ── EPIC-026 C2: o número real dos endereços "@lid" ──

/**
 * O par já conhecido deste "@lid" nesta instância, ou null. `origem`: "aviso" = o número veio no ENDEREÇO de uma mensagem (confirmado);
 * "evolution" = só a consulta de contatos da Evolution o informou (QA-SEG C2 achado 2: provável, não confirmado — a conversa continua
 * "não identificada" para envio e vínculo). Falha ao ler → null.
 */
export type ParDoLid = { numero: string; origem: "aviso" | "evolution" };
export async function numeroConhecidoDoLid(instancia: string, lid: string): Promise<ParDoLid | null> {
  try {
    const [r] = await getDb().select({ numero: whatsappLidNumeros.numero, origem: whatsappLidNumeros.origem }).from(whatsappLidNumeros)
      .where(and(eq(whatsappLidNumeros.instancia, instancia), eq(whatsappLidNumeros.lid, lid.slice(0, 40)))).limit(1);
    if (!r || !/^\d{10,15}$/.test(r.numero) || (r.origem !== "aviso" && r.origem !== "evolution")) return null;
    return { numero: r.numero, origem: r.origem };
  } catch { return null; }
}

/**
 * Guarda o número de um "@lid" (só quando é novo ou mudou). Nunca lança.
 * - origem "aviso" (o número veio no endereço da mensagem): vence qualquer par anterior; se mudou (número ou origem), as linhas da
 *   Central gravadas com o "@lid" ganham o número (se for o do dono ou o da empresa, a conversa some da Central pelo filtro de sempre).
 * - origem "evolution" (só a consulta de contatos): QA-SEG C2 achado 2 — nunca sobrescreve um par confirmado por aviso e NUNCA troca
 *   as linhas da Central: a conversa continua "não identificada" (o admin vê o número só como "provável", mascarado).
 */
export async function lembrarNumeroDoLid(p: { instancia: string; lid: string; numero: string; origem: "aviso" | "evolution"; connectionId: number | null }): Promise<boolean> {
  const numero = p.numero.replace(/\D/g, "").slice(0, 20);
  if (!/^\d{10,15}$/.test(numero) || !/^\d{1,25}@lid$/.test(p.lid)) return false;
  try {
    const db = getDb();
    const t = whatsappLidNumeros;
    const quando = p.origem === "aviso"
      ? sql`(${t.numero} <> ${numero} OR ${t.origem} <> 'aviso')`
      : sql`(${t.origem} <> 'aviso' AND (${t.numero} <> ${numero} OR ${t.origem} <> 'evolution'))`;
    const r = await db.insert(t).values({ instancia: p.instancia, lid: p.lid, numero, origem: p.origem })
      .onConflictDoUpdate({ target: [t.instancia, t.lid], set: { numero, origem: p.origem, atualizadoEm: sql`now()` }, setWhere: quando })
      .returning({ lid: t.lid });
    if (!r.length) return false;
    if (p.origem === "aviso" && p.connectionId !== null) {
      await db.update(whatsappMessages).set({ destinatario: numero, updatedAt: new Date() })
        .where(and(eq(whatsappMessages.connectionId, p.connectionId), eq(whatsappMessages.destinatario, p.lid)));
    }
    return true;
  } catch (e) {
    console.error("[dolores/roteamento] falha ao guardar o número do @lid", erroParaLog(e));
    return false;
  }
}

/** QA-SEG C2 achado 4: por quanto tempo um "@lid" que a Evolution não soube resolver não é consultado de novo. */
export const CACHE_LID_NAO_RESOLVIDO_MS = 10 * 60_000;

/** O "@lid" foi consultado sem resultado há menos de 10 min (nesta instância)? Falha ao ler → não (a consulta segue limitada por aviso). */
export async function lidNaoResolvidoHaPouco(instancia: string, lid: string): Promise<boolean> {
  try {
    const [r] = await getDb().select({ em: whatsappLidNumeros.atualizadoEm }).from(whatsappLidNumeros)
      .where(and(eq(whatsappLidNumeros.instancia, instancia), eq(whatsappLidNumeros.lid, lid.slice(0, 40)), eq(whatsappLidNumeros.origem, "nao_resolvido"))).limit(1);
    return !!r && deps.agora().getTime() - new Date(r.em).getTime() < CACHE_LID_NAO_RESOLVIDO_MS;
  } catch { return false; }
}

/** Guarda "não resolvido" (número vazio) para o "@lid"; nunca sobrescreve um par com número. Nunca lança. */
export async function lembrarLidNaoResolvido(instancia: string, lid: string): Promise<void> {
  if (!/^\d{1,25}@lid$/.test(lid)) return;
  const t = whatsappLidNumeros;
  const agora = deps.agora();
  await getDb().insert(t).values({ instancia, lid, numero: "", origem: "nao_resolvido", atualizadoEm: agora })
    .onConflictDoUpdate({ target: [t.instancia, t.lid], set: { atualizadoEm: agora }, setWhere: sql`${t.origem} = 'nao_resolvido'` })
    .catch(e => console.error("[dolores/roteamento] falha ao guardar o @lid não resolvido", erroParaLog(e)));
}

/** QA-SEG C2 achado 2: os números PROVÁVEIS (só da consulta à Evolution, não confirmados) dos "@lid" desta instância. Falha → vazio. */
export async function numerosProvaveisDosLids(instancia: string, lids: string[]): Promise<Map<string, string>> {
  if (!lids.length) return new Map();
  try {
    const rows = await getDb().select({ lid: whatsappLidNumeros.lid, numero: whatsappLidNumeros.numero }).from(whatsappLidNumeros)
      .where(and(eq(whatsappLidNumeros.instancia, instancia), eq(whatsappLidNumeros.origem, "evolution"), inArray(whatsappLidNumeros.lid, lids.slice(0, 500))));
    return new Map(rows.filter(r => /^\d{10,15}$/.test(r.numero)).map(r => [r.lid, r.numero]));
  } catch { return new Map(); }
}

/** Consulta o número de um "@lid" na Evolution (dependência substituível nos testes). Falha → null. */
export async function consultarNumeroDoLid(instancia: string, lid: string, prazoMs: number): Promise<string | null> {
  try { return await deps.resolverLid({ instancia, lid, prazoMs }); } catch { return null; }
}

/** Troca o texto de uma mensagem RECEBIDA que o próprio aviso acabou de gravar (o áudio transcrito). */
export async function textoDaEntrada(id: number, texto: string) {
  await getDb().update(whatsappMessages).set({ mensagem: texto.slice(0, 4000), updatedAt: new Date() })
    .where(and(eq(whatsappMessages.id, id), eq(whatsappMessages.direcao, "entrada"))).catch(e => console.error("[dolores/roteamento] falha ao gravar a transcrição", erroParaLog(e)));
}

/**
 * Mensagem que o número da EMPRESA enviou (fromMe) para alguém que não é o dono. Nunca é comando. Já gravada pelo sistema (resposta
 * automática ou resposta da equipe pela Central) → não duplica; automática pendente do mesmo número e texto (o eco chegou antes de
 * o envio gravar o id) → só completa o id. Senão é da EQUIPE pelo celular: entra na conversa e a Dolores fica calada nela.
 */
export async function tratarPropria(conn: ConexaoDaEmpresa, item: unknown, p: { numero: string; texto: string; externalId: string; enviadaEm: Date | null; silencioHoras: number }): Promise<string> {
  const db = getDb();
  const [ja] = await db.select({ id: whatsappMessages.id, automatica: whatsappMessages.automatica }).from(whatsappMessages)
    .where(and(eq(whatsappMessages.connectionId, conn.id), eq(whatsappMessages.externalId, p.externalId))).limit(1);
  if (ja) {
    if (!ja.automatica) await silenciarConversa(p.numero, p.silencioHoras, p.enviadaEm ?? deps.agora());
    return ja.automatica ? "propria-automatica" : "propria-equipe-central";
  }
  if (p.texto) {
    const limite = new Date(deps.agora().getTime() - 5 * 60_000);
    // QA-SEG C3 achado 1: o rótulo de mídia ("[imagem] …", "[áudio]") é genérico — a equipe manda áudio e foto pelo celular. Ele só
    // casa com uma mídia automática EM ANDAMENTO ("enviando"), criada há pouco (relógio do banco). Fora disso, é da EQUIPE (cala a
    // Dolores): na dúvida, erra para o lado humano.
    const ehRotuloDeMidia = /^\[(imagem|áudio)\]/.test(p.texto);
    const janela = ehRotuloDeMidia
      ? and(eq(whatsappMessages.status, "enviando"), sql`${whatsappMessages.createdAt} > now() - make_interval(secs => ${JANELA_ECO_MIDIA_MS / 1000})`)
      : gt(whatsappMessages.createdAt, limite);
    const pendentes = await db.select({ id: whatsappMessages.id, destinatario: whatsappMessages.destinatario }).from(whatsappMessages)
      .where(and(eq(whatsappMessages.connectionId, conn.id), eq(whatsappMessages.automatica, true), isNull(whatsappMessages.externalId),
        eq(whatsappMessages.mensagem, p.texto.slice(0, 4000)), janela)).limit(5);
    const pendente = pendentes.find(x => ehNumeroDoDono(x.destinatario, p.numero) || formaCanonicaDoNumero(x.destinatario) === formaCanonicaDoNumero(p.numero));
    if (pendente) {
      const casou = await db.update(whatsappMessages).set({ externalId: p.externalId, updatedAt: new Date() })
        .where(and(eq(whatsappMessages.id, pendente.id), isNull(whatsappMessages.externalId), ...(ehRotuloDeMidia ? [eq(whatsappMessages.status, "enviando")] : [])))
        .returning({ id: whatsappMessages.id });
      if (casou.length || !ehRotuloDeMidia) return "propria-automatica";
    }
    // EPIC-027 C7.1: em coexistência, o envio de CAMPANHA pela API oficial volta pela Evolution como "da empresa". Por código
    // (mesmo número, envio aceito há no máximo 10 min, texto É a mensagem enviada — C7.3: corpo preenchido com cabeçalho/rodapé do
    // modelo, nunca "contém"; corpo + acréscimo da equipe é da equipe): não é resposta da equipe — não cala a Dolores nem entra como
    // atendimento humano (a campanha já registrou a mensagem na Central como automática). Na dúvida, segue humano.
    if (!ehRotuloDeMidia && await ehEcoDeCampanhaOficial(p.numero, p.texto, deps.agora())) return "propria-campanha-oficial";
  }
  // EPIC-026 C2: o número conferido vai junto (o endereço pode ser "@lid", que a gravação sozinha não aceitava)
  await gravarItemNaCentral(conn, item, { centralVendas: false, baixarMidia: false, numero: p.numero });
  await silenciarConversa(p.numero, p.silencioHoras, p.enviadaEm ?? deps.agora());
  return "propria-equipe";
}

// ── O único envio a um contato (conversa direta, que não é o dono) ──

export type TipoAutomatica = "saudacao" | "aviso_ligacao" | "aviso_audio" | "resposta_cliente";

/**
 * O ÚNICO ponto que escreve a um contato que não é o dono. Confere de novo: o destino não é o dono (comparação estrita), é número
 * (nunca grupo), a conexão da empresa está conectada e a Dolores não está pausada (pausa geral ou conta desativada). Texto pelos
 * filtros: links fora da lista permitida viram "[link removido]", dados pessoais SEMPRE mascarados (canal "cliente"), segredos
 * fora, tamanho curto. A mensagem entra na Central marcada como AUTOMÁTICA antes do envio (o eco não vira "da equipe").
 */
type PedidoAoContato = { cfg: DoloresWhatsappConfig; conn: ConexaoDaEmpresa; numero: string; texto: string; tipo: TipoAutomatica; prazoFinal: number;
  autor: number | null; leadId?: number | null; pedidoId: string; nome?: string | null; midia?: MidiaParaEnvio | null };
export async function enviarAoContato(p: PedidoAoContato): Promise<boolean> {
  return (await enviarAoContatoComResultado(p)) === "ok";
}

/**
 * EPIC-026 C3 (QA-SEG achado 5): o resultado em três: "ok" (a Evolution aceitou), "falhou" (não saiu: recusado aqui ou a Evolution
 * RESPONDEU com erro) e "sem_confirmacao" (o pedido estourou o prazo ou caiu no meio — pode ter chegado). Quem chama não deve
 * mandar de novo o mesmo conteúdo no caso "sem_confirmacao" (evita mensagem em dobro para o cliente).
 */
export type ResultadoAoContato = "ok" | "falhou" | "sem_confirmacao";
export async function enviarAoContatoComResultado(p: PedidoAoContato): Promise<ResultadoAoContato> {
  const midia = p.midia ?? null;
  const auditar = (resultado: "ok" | "recusada" | "erro", motivo: string | null, extra: Record<string, unknown> = {}) =>
    registrarAcao({ funcao: "whatsapp_automatica", resultado, motivo, autorUserId: p.autor, canal: "whatsapp", pedidoId: p.pedidoId,
      resumo: { tipo: p.tipo, destino: mascararNumero(p.numero), ...(midia ? { midia: midia.tipo } : {}), ...extra } });
  const destino = p.numero.replace(/\D/g, "");
  // EPIC-026 C2: "@lid" (número não identificado) nunca vira destino — os dígitos dele não são telefone
  if (/@/.test(p.numero) || !/^\d{10,15}$/.test(destino)) { await auditar("recusada", "destino não é um número de conversa direta; nada foi enviado"); return "falhou"; }
  if (ehNumeroDoDono(destino, p.cfg.numeroDono) || ehNumeroDoDono(destino, p.cfg.numeroDolores)) { await auditar("recusada", "destino é o dono ou o próprio número; nada foi enviado"); return "falhou"; }
  if (!p.cfg.instancia || p.cfg.statusConexao !== "conectado" || p.conn.instancia !== p.cfg.instancia) { await auditar("recusada", "conexão da empresa desconectada; nada foi enviado"); return "falhou"; }
  if (!(await podeFalarNoGrupo())) { await auditar("recusada", "Dolores pausada (pausa geral ou conta desativada); nada foi enviado"); return "falhou"; }
  // EPIC-026 C3: o áudio vai sem texto; a imagem leva o texto (já filtrado) como legenda
  const final = midia?.tipo === "audio" ? "" : cortarResposta(sanitizarTexto(tratarLinksDaResposta(p.texto, urlDoSistemaParaLinks()), filtroDaSaida("cliente")), MAX_CARACTERES_CONTATO).trim();
  if (!final && midia?.tipo !== "audio") { await auditar("recusada", "texto vazio depois dos filtros; nada foi enviado"); return "falhou"; }
  // na Central, no mesmo formato das mídias recebidas ("[imagem] legenda", "[áudio]"); o eco do envio é reconhecido por esse texto
  const naCentral = midia ? rotuloDaMidiaNaCentral(midia.tipo, final) : final;
  const restante = p.prazoFinal - deps.ms();
  if (restante < MINIMO_PARA_ENVIAR_CONTATO_MS) { await auditar("erro", "sem tempo para enviar dentro do prazo do aviso"); return "falhou"; }
  const db = getDb();
  const [linha] = await db.insert(whatsappMessages).values({
    connectionId: p.conn.id, leadId: p.leadId ?? null, destinatario: destino, nomeDestinatario: p.nome ?? null, mensagem: naCentral,
    status: "enviando", direcao: "saida", lida: true, automatica: true,
  }).returning({ id: whatsappMessages.id });
  const inicio = deps.ms();
  let externalId: string | null = null;
  let motivo: string | null = null;
  let semConfirmacao = false;
  try {
    externalId = midia
      ? await deps.enviarMidia({ instancia: p.cfg.instancia, numero: destino, midia, legenda: final, prazoMs: Math.min(PRAZO_ENVIO_MIDIA_MS, restante) })
      : await deps.enviar({ instancia: p.cfg.instancia, numero: destino, texto: final, prazoMs: Math.min(PRAZO_ENVIO_MS, restante) });
    if (!externalId) motivo = "a Evolution não aceitou a mensagem (ou o servidor não está configurado)";
  } catch (e) { motivo = `sem confirmação do envio (tempo esgotado ou conexão caiu): ${erroParaLog(e)}`; semConfirmacao = true; }
  if (linha) {
    // QA-SEG C3 R2-1/R3-1: durante o envio, um eco com o rótulo da mídia pode ter casado com esta linha e gravado o id dele. O update
    // final é ATÔMICO e condicional: só pega a linha se ela continua sem id ou já está com o id REAL devolvido pela Evolution. Se não
    // pegar, o eco gravado NÃO era nosso: na dúvida é da EQUIPE — vira mensagem própria (não automática) com aquele id, a Dolores
    // fica calada na conversa e a linha automática fica com o id real (ou nenhum, se não saiu).
    try {
      const resultado = externalId
        ? { status: "enviada", externalId, updatedAt: new Date() }
        : { status: "falhou", erroMsg: semConfirmacao ? "Sem confirmação do envio (pode ter chegado)" : "Erro ao enviar", updatedAt: new Date() };
      const pegou = await db.update(whatsappMessages).set(resultado)
        .where(and(eq(whatsappMessages.id, linha.id), externalId
          ? sql`(${whatsappMessages.externalId} IS NULL OR ${whatsappMessages.externalId} = ${externalId})`
          : isNull(whatsappMessages.externalId)))
        .returning({ id: whatsappMessages.id });
      if (!pegou.length) {
        const [atual] = await db.select({ externalId: whatsappMessages.externalId }).from(whatsappMessages).where(eq(whatsappMessages.id, linha.id)).limit(1);
        await db.update(whatsappMessages).set({ ...resultado, externalId: externalId ?? null }).where(eq(whatsappMessages.id, linha.id));
        if (atual?.externalId) await mensagemDaEquipeNoEnvio(p, { connectionId: p.conn.id, destino, mensagem: naCentral, externalId: atual.externalId });
      }
      // R3-1: o eco VERDADEIRO pode ter chegado depois do da equipe e entrado como "da equipe" com o id real — é a própria saudação:
      // sai a duplicata (a mensagem da equipe, com o id dela, fica), e a saudação aparece uma vez só, como automática
      if (externalId) await db.delete(whatsappMessages).where(and(eq(whatsappMessages.connectionId, p.conn.id), eq(whatsappMessages.externalId, externalId),
        eq(whatsappMessages.automatica, false), ne(whatsappMessages.id, linha.id), eq(whatsappMessages.direcao, "saida")));
    } catch (e) { console.error("[dolores/roteamento] falha ao atualizar a mensagem automática", erroParaLog(e)); }
  }
  await auditar(externalId ? "ok" : "erro", motivo, { caracteres: final.length, duracaoMs: deps.ms() - inicio, ...(semConfirmacao ? { semConfirmacao: true } : {}) });
  return externalId ? "ok" : semConfirmacao ? "sem_confirmacao" : "falhou";
}

/** QA-SEG C3 R2-1: a mensagem da equipe que casou por engano com um envio automático em andamento: grava como da equipe e cala a Dolores. */
async function mensagemDaEquipeNoEnvio(p: PedidoAoContato, m: { connectionId: number; destino: string; mensagem: string; externalId: string }) {
  const db = getDb();
  const [ja] = await db.select({ id: whatsappMessages.id }).from(whatsappMessages)
    .where(and(eq(whatsappMessages.connectionId, m.connectionId), eq(whatsappMessages.externalId, m.externalId))).limit(1);
  if (!ja) await db.insert(whatsappMessages).values({
    connectionId: m.connectionId, leadId: p.leadId ?? null, destinatario: m.destino, nomeDestinatario: p.nome ?? null, mensagem: m.mensagem,
    status: "enviada", externalId: m.externalId, direcao: "saida", lida: true, automatica: false,
  });
  const config = await lerConfigAtendimento();
  await silenciarConversa(p.numero, config.silencioHoras);
}

/** EPIC-026 C3: o texto da mídia automática na Central — igual ao das mídias recebidas (textoDaMensagem da Evolution). */
export function rotuloDaMidiaNaCentral(tipo: "imagem" | "audio", legenda: string): string {
  return tipo === "audio" ? "[áudio]" : legenda ? `[imagem] ${legenda}` : "[imagem]";
}

// ── Saudação de campanha ──

/** A campanha ativa (no máximo uma, garantido no banco), ou null. */
export async function campanhaAtiva() {
  const [c] = await getDb().select().from(whatsappCampanhas).where(eq(whatsappCampanhas.ativa, true)).limit(1);
  return c ?? null;
}

/**
 * Saudação a número DESCONHECIDO (quem chama já decidiu: não é cliente, nem usuário, nem o dono; conversa direta; mensagem nova).
 * Sem campanha ativa, nada sai. UMA vez por número por campanha (reivindicação no banco); teto diário global (protege o número contra
 * bloqueio); texto fixo, sem IA, sem variáveis, pelos filtros de saída.
 */
export async function enviarSaudacao(p: { cfg: DoloresWhatsappConfig; conn: ConexaoDaEmpresa; numero: string; prazoFinal: number; autor: number | null; config: typeof CONFIG_ATENDIMENTO_PADRAO }): Promise<string> {
  const campanha = await campanhaAtiva().catch(() => null);
  if (!campanha) return "saudacao-sem-campanha";
  if (textoFixoInvalido(campanha.texto, 1000)) return "saudacao-texto-invalido";
  const chave = chaveDoNumero(p.numero);
  if (!chave) return "saudacao-sem-chave";
  const db = getDb();
  const [reivindicada] = await db.insert(whatsappSaudacoes).values({ campanhaId: campanha.id, chaveNumero: chave, remetente: mascararNumero(p.numero) })
    .onConflictDoNothing().returning({ id: whatsappSaudacoes.id });
  if (!reivindicada) return "saudacao-ja-enviada";
  if (!(await vagaNoContador(`saudacao:${diaDeImperatriz(deps.agora())}`, p.config.saudacaoTetoDia))) {
    // fora do teto: solta a vaga (ela pode receber num outro dia)
    await db.delete(whatsappSaudacoes).where(eq(whatsappSaudacoes.id, reivindicada.id)).catch(() => undefined);
    await registrarAcao({ funcao: "whatsapp_automatica", resultado: "recusada", motivo: `teto de ${p.config.saudacaoTetoDia} saudações por dia; nada foi enviado`, autorUserId: p.autor, canal: "whatsapp",
      pedidoId: `saudacao:${campanha.id}`, resumo: { tipo: "saudacao", destino: mascararNumero(p.numero) } });
    return "saudacao-teto";
  }
  // EPIC-026 C3: imagem com o texto como legenda (uma mensagem só); se a Evolution RESPONDER com erro na imagem, o texto puro; depois
  // o áudio como mensagem de voz — só se o texto saiu. Cada parte UMA vez: a reivindicação acima já impede qualquer nova tentativa da
  // saudação deste número nesta campanha, e o que saiu fica registrado (texto_saiu, imagem_saiu, audio_saiu).
  // QA-SEG achado 5: imagem SEM CONFIRMAÇÃO (prazo estourado: pode ter chegado com a legenda) → o texto NÃO vai de novo e o áudio
  // também não (nada em dobro para o cliente); registra imagem_saiu = null, texto_saiu = false e sem_confirmacao = true.
  // Orçamento: imagem até 15 s + texto até 8 s (só se a imagem falhou de fato) + áudio até 15 s = 38 s, dentro dos 45 s do aviso; cada
  // envio também para no prazo final, e mídia só é tentada com pelo menos 6 s pela frente.
  const midias = await midiasParaEnvio(campanha.id).catch(() => ({ imagem: null, audio: null }));
  const base = { cfg: p.cfg, conn: p.conn, numero: p.numero, texto: campanha.texto, tipo: "saudacao" as const, prazoFinal: p.prazoFinal, autor: p.autor, pedidoId: `saudacao:${campanha.id}` };
  const tentar = (midia: MidiaParaEnvio | null): Promise<ResultadoAoContato> => enviarAoContatoComResultado({ ...base, midia })
    .catch(e => { console.error("[dolores/roteamento] falha no envio da saudação", erroParaLog(e)); return "falhou" as const; });
  const haTempoParaMidia = () => p.prazoFinal - deps.ms() >= MINIMO_PARA_ENVIAR_MIDIA_MS;
  let semConfirmacao = false;
  let imagemSaiu: boolean | null = null;
  let textoSaiu = false;
  if (midias.imagem && haTempoParaMidia()) {
    const r = await tentar(midias.imagem);
    if (r === "ok") { imagemSaiu = true; textoSaiu = true; }
    else if (r === "sem_confirmacao") semConfirmacao = true; // imagemSaiu fica null (desconhecido); o texto não vai de novo
    else imagemSaiu = false;
  } else if (midias.imagem) imagemSaiu = false; // sem tempo para a imagem: vai o texto puro
  if (!textoSaiu && !semConfirmacao) textoSaiu = (await tentar(null)) === "ok";
  let audioSaiu: boolean | null = null;
  if (midias.audio) {
    if (!textoSaiu || !haTempoParaMidia()) audioSaiu = false;
    else {
      const r = await tentar(midias.audio);
      audioSaiu = r === "ok" ? true : r === "sem_confirmacao" ? null : false;
      if (r === "sem_confirmacao") semConfirmacao = true;
    }
  }
  await db.update(whatsappSaudacoes).set({ situacao: textoSaiu ? "enviada" : "erro", enviadaEm: textoSaiu ? deps.agora() : null, textoSaiu, imagemSaiu, audioSaiu, semConfirmacao })
    .where(eq(whatsappSaudacoes.id, reivindicada.id)).catch(() => undefined);
  if (!textoSaiu) return semConfirmacao ? "saudacao-sem-confirmacao" : "saudacao-erro";
  return (imagemSaiu === false || (midias.audio !== null && audioSaiu !== true)) ? "saudacao-enviada-parcial" : "saudacao-enviada";
}

// ── Avisos de ligação e de áudio ──

/** Reivindica o aviso: true se o último deste tipo para o número foi há mais de `horas` (ou nunca). Atômico. */
export async function vagaDoAviso(numero: string, tipo: "ligacao" | "audio", horas: number): Promise<boolean> {
  const chave = chaveDoNumero(numero);
  if (!chave) return false;
  const agora = deps.agora();
  const limite = new Date(agora.getTime() - Math.max(1, horas) * 60 * 60_000);
  const r = await getDb().insert(whatsappAvisosNumero).values({ chaveNumero: chave, tipo, ultimoEm: agora })
    .onConflictDoUpdate({ target: [whatsappAvisosNumero.chaveNumero, whatsappAvisosNumero.tipo], set: { ultimoEm: agora, total: sql`${whatsappAvisosNumero.total} + 1` },
      setWhere: lt(whatsappAvisosNumero.ultimoEm, limite) })
    .returning({ total: whatsappAvisosNumero.total });
  return r.length === 1;
}

/**
 * Aviso fixo (ligação ou áudio que não deu para ouvir), no máximo 1 a cada N horas por número. Texto editável em Templates.
 * QA-SEG E9 achado 3: interruptor próprio ("avisos de ligação e áudio") e teto GLOBAL por dia (somando ligação e áudio), conferidos
 * antes do envio — muitos números diferentes ligando não fazem o número da empresa disparar sem limite.
 */
export async function enviarAviso(p: { tipo: "ligacao" | "audio"; cfg: DoloresWhatsappConfig; conn: ConexaoDaEmpresa; numero: string; prazoFinal: number; autor: number | null; config: typeof CONFIG_ATENDIMENTO_PADRAO; leadId?: number | null }): Promise<string> {
  if (!p.config.avisosLigados) return `aviso-${p.tipo}-desligado`;
  if (!(await vagaDoAviso(p.numero, p.tipo, p.config.avisoIntervaloHoras))) return `aviso-${p.tipo}-recente`;
  if (!(await vagaNoContador(`aviso-global:${diaDeImperatriz(deps.agora())}`, p.config.avisoTetoGlobalDia))) {
    await registrarAcao({ funcao: "whatsapp_automatica", resultado: "recusada", motivo: `teto de ${p.config.avisoTetoGlobalDia} avisos de ligação/áudio por dia; nada foi enviado`,
      autorUserId: p.autor, canal: "whatsapp", pedidoId: `aviso:${p.tipo}`, resumo: { tipo: p.tipo === "ligacao" ? "aviso_ligacao" : "aviso_audio", destino: mascararNumero(p.numero) } });
    return `aviso-${p.tipo}-teto`;
  }
  const texto = p.tipo === "ligacao" ? p.config.avisoLigacao : p.config.avisoAudio;
  const ok = await enviarAoContato({ cfg: p.cfg, conn: p.conn, numero: p.numero, texto, tipo: p.tipo === "ligacao" ? "aviso_ligacao" : "aviso_audio", prazoFinal: p.prazoFinal,
    autor: p.autor, leadId: p.leadId ?? null, pedidoId: `aviso:${p.tipo}` });
  return ok ? `aviso-${p.tipo}-enviado` : `aviso-${p.tipo}-erro`;
}

/**
 * Evento de LIGAÇÃO da Evolution (`call`, assinado na instância por "Reativar recebimento"). Só a oferta (`status: "offer"`) de uma
 * ligação de conversa direta conta; ligação de grupo → silêncio; do dono → nada (ele sabe que ela não atende). O número vem do
 * endereço (`from`/`chatId`, nunca de texto). A ligação não é atendida (a Evolution não atende); o aviso sai por texto.
 */
export function lerLigacao(data: unknown): { numero: string | null; grupo: boolean; oferta: boolean; id: string | null } {
  const lista = Array.isArray(data) ? data : [data];
  const c = (lista[0] ?? {}) as Record<string, unknown>;
  const status = typeof c.status === "string" ? c.status.toLowerCase() : "";
  const jids = [c.from, c.chatId, c.peerJid].filter((v): v is string => typeof v === "string");
  const grupo = c.isGroup === true || jids.some(j => j.endsWith("@g.us")) || typeof c.groupJid === "string";
  const numero = jids.map(j => /^(\d{10,15})(?::\d+)?@s\.whatsapp\.net$/.exec(j)?.[1]).find(Boolean) ?? null;
  return { numero, grupo, oferta: status === "offer" || status === "ringing", id: typeof c.id === "string" ? c.id.slice(0, 160) : null };
}
