// EPIC-025 E10 — a Dolores cobra o colaborador e pede documentos ao cliente, SOZINHA (decisão do dono de 23/11/2026). Regras fixas:
// - Quem decide é CÓDIGO: a coleta reaproveita as leituras da Dolores (mesmos critérios das telas, rondas e avisos), numa transação
//   SOMENTE LEITURA com tempo-limite; o texto é montado pelo sistema (shared/dolores/cobrancas.ts e o textoDaCobranca do
//   preparar_cobranca). Nenhuma IA, nenhuma ferramenta, nada na fila, nenhuma gravação em módulo além do histórico do cliente.
// - Envio SÓ pela porta única a contato (roteamento.ts#enviarAoContatoComResultado): destino conferido (nunca o dono nem o próprio
//   número, nunca grupo), conexão da empresa, pausa geral, filtros de saída (dados pessoais mascarados, links), grava na Central.
// - Horário comercial (segunda a sexta, 08h–18h de Fortaleza); interruptores próprios DESLIGADOS por padrão; tetos diários globais;
//   vagas únicas no banco (uma cobrança por colaborador por dia; um pedido por cliente a cada N ≥ 3 dias): dois crons juntos nunca
//   duplicam. Envio sem confirmação não é repetido.
// - Pedido de documentos só a cliente com consentimento LGPD no cadastro, card ativo, telefone ligado a UM único cadastro (a mesma
//   identificação da E9) e documentos realmente pendentes; conversa assumida/silenciada pela equipe → não envia.
// - A resposta do colaborador é DADO: registrada e encaminhada ao dono, nunca comando, e o texto não entra na memória da conversa.
// - Auditoria só com ids, contagens e números mascarados.
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, notInArray, sql } from "drizzle-orm";
import { avaliacoes, leadActivities, leadServices, leads, tasks, users } from "../../drizzle/schema.js";
import {
  doloresCobrancasColaborador, doloresCobrancasConfig, doloresCobrancasRespostas, doloresCobrancasResumos, doloresPedidosDocumentos,
  doloresPedidosDocumentosVaga, type DoloresCobrancasConfig,
} from "../../drizzle/schema-dolores-cobrancas.js";
import type { DoloresWhatsappConfig } from "../../drizzle/schema-dolores-whatsapp.js";
import {
  DIAS_RESPOSTA, LINHA_DA_RESPOSTA_NA_MEMORIA, dentroDoHorarioComercial, diaDaCobranca, horaDoResumo, montarCobrancaColaborador, montarResumoDoDia,
  textoDaResposta, textoDoPedidoDeDocumentos, type ItemCobranca,
} from "../../shared/dolores/cobrancas.js";
import { diaDoPrazo, diaFortaleza, diasEntre, truncar } from "../../shared/dolores/formato.js";
import { nomeComparavel } from "../../shared/dolores/grupos.js";
import { DIAS_PARADO_PADRAO, responsavelDaTarefa } from "../../shared/dolores/regras.js";
import { sanitizarTexto } from "../../shared/dolores/sanitizar.js";
import { ehNumeroDoDono, mascararNumero, normalizarNumeroDono } from "../../shared/dolores/whatsapp.js";
import { LEAD_FINALIZED_STAGE } from "../../shared/lead-pipeline.js";
import { LEAD_SERVICE_LABELS, type LeadServiceType } from "../../shared/lead-services.js";
import { tarefaAtrasada } from "../../shared/tarefas-filtro.js";
import { getDb } from "../db.js";
import { conexaoDaEmpresa, type ConexaoDaEmpresa } from "../whatsapp-conexao-empresa.js";
import { situacaoDoCliente } from "./acoes/cobrancas.js";
import { MARCA_DOLORES } from "./acoes/comum.js";
import { registrarAcao } from "./auditoria.js";
import { lerConfigWhatsapp } from "./consumo.js";
import { FILTRO_DO_REGISTRO } from "./dados-pessoais.js";
import { erroParaLog } from "./erro-seguro.js";
import { listarDocumentos } from "./leitura/documentos.js";
import { carregarFinanciamentos } from "./leitura/financeiro.js";
import { carregarObras } from "./leitura/obras.js";
import { carregarProcessos } from "./leitura/regularizacoes.js";
import { bloqueioDaOperacao } from "./operacao.js";
import { idDaDoloresSemCriar } from "./perfil.js";
import { conversaEmSilencio, enviarAoContatoComResultado, identificarRemetente, vagaNoContador } from "./roteamento.js";
import { bancoDaLeitura, emTransacaoSomenteLeitura } from "./somente-leitura.js";

/** Cada envio só começa com pelo menos isto até o fim do prazo da chamada (o envio a contato leva até 8 s). */
export const MINIMO_POR_ENVIO_MS = 10_000;
/** Teto do tempo da coleta (SET LOCAL statement_timeout). */
const TEMPO_DA_COLETA_MS = 12_000;
const registro = (s: string, max: number) => sanitizarTexto(s, FILTRO_DO_REGISTRO).slice(0, max);

export type ConfigCobrancas = Omit<DoloresCobrancasConfig, "id" | "atualizadoPor">;
/** A configuração (linha única da 0169). Sem a migração ou sem a linha → null (quem chama trata como DESLIGADO). */
export async function lerConfigCobrancas(): Promise<ConfigCobrancas | null> {
  try {
    const [c] = await getDb().select().from(doloresCobrancasConfig).where(eq(doloresCobrancasConfig.id, 1)).limit(1);
    if (!c) return null;
    const { id: _i, atualizadoPor: _a, ...resto } = c;
    return { ...resto, documentosIntervaloDias: Math.max(3, resto.documentosIntervaloDias) };
  } catch { return null; }
}

// ── Coleta: os itens atrasados de cada colaborador ──

type Colaborador = { id: number; name: string | null; phone: string | null };
export type CobrancaDoColaborador = { colaborador: Colaborador; itens: ItemCobranca[] };
/** Item cujo nome de responsável bate com MAIS DE UM usuário do sistema: não vai para ninguém; só a fonte e o nome gravado (sem cliente). */
export type ItemAmbiguo = { fonte: ItemCobranca["fonte"]; chave: string; responsavel: string };

/**
 * TODOS os itens atrasados (ou parados) de cada colaborador ativo (papel "colaborador"). Responsável = o nome gravado no registro
 * (tarefa, regularização, avaliação), conferido contra TODOS os usuários (qualquer papel, ativos e inativos):
 * - bate com UM usuário que é colaborador ativo → é dele;
 * - bate com UM usuário que não é colaborador ativo (corretor, admin, inativo) → é dessa pessoa: ninguém é cobrado;
 * - bate com MAIS DE UM usuário → ambíguo: ninguém é cobrado e o item vai ao resumo do dono (sem o nome do cliente);
 * - vazio ou não bate com ninguém → o responsável do card do cliente no CRM, quando é colaborador ativo.
 */
export async function coletarCobrancas(agora: Date): Promise<{ porColaborador: CobrancaDoColaborador[]; ambiguos: ItemAmbiguo[] }> {
  return emTransacaoSomenteLeitura(async () => {
    const db = bancoDaLeitura();
    const todos = await db.select({ id: users.id, name: users.name, phone: users.phone, role: users.role, active: users.active }).from(users).orderBy(asc(users.id));
    const colabs = todos.filter(u => u.active === true && u.role === "colaborador").map(({ id, name, phone }) => ({ id, name, phone }));
    if (!colabs.length) return { porColaborador: [], ambiguos: [] };
    const ids = new Set(colabs.map(c => c.id));
    const porNome = new Map<string, number[]>();
    for (const u of todos) {
      const k = nomeComparavel(u.name);
      if (k) porNome.set(k, [...(porNome.get(k) ?? []), u.id]);
    }
    type DoNome = { tipo: "nenhum" } | { tipo: "usuario"; id: number } | { tipo: "ambiguo"; nome: string };
    const doNome = (nome: string | null | undefined): DoNome => {
      const r = responsavelDaTarefa(nome);
      const k = nomeComparavel(r);
      const achados = k ? porNome.get(k) ?? [] : [];
      if (!achados.length) return { tipo: "nenhum" };
      if (achados.length > 1) return { tipo: "ambiguo", nome: String(r ?? "") };
      return { tipo: "usuario", id: achados[0] };
    };
    const ambiguos: ItemAmbiguo[] = [];
    const hoje = diaFortaleza(agora)!;
    const [tarefas, regs, obras, fins, cards, servicos, avals] = await Promise.all([
      db.select({ id: tasks.id, title: tasks.title, status: tasks.status, assignedTo: tasks.assignedTo, dueAt: tasks.dueAt, relatedType: tasks.relatedType, relatedId: tasks.relatedId })
        .from(tasks).where(and(inArray(tasks.status, ["pending", "in_progress"]), isNotNull(tasks.dueAt), lt(tasks.dueAt, agora))).limit(2000),
      carregarProcessos(null, agora, "ponte", DIAS_PARADO_PADRAO),
      carregarObras(agora, DIAS_PARADO_PADRAO),
      carregarFinanciamentos(agora, "ponte", DIAS_PARADO_PADRAO),
      db.select({ id: leads.id, name: leads.name, cardDueDate: leads.cardDueDate, responsibleUserId: leads.responsibleUserId }).from(leads)
        .where(and(isNull(leads.deletedAt), ne(leads.stage, LEAD_FINALIZED_STAGE), isNotNull(leads.cardDueDate), lt(leads.cardDueDate, hoje))).limit(2000),
      db.select({ id: leadServices.id, title: leadServices.title, serviceType: leadServices.serviceType, dueAt: leadServices.dueAt, cliente: leads.name, responsibleUserId: leads.responsibleUserId })
        .from(leadServices).innerJoin(leads, and(eq(leads.id, leadServices.leadId), isNull(leads.deletedAt), ne(leads.stage, LEAD_FINALIZED_STAGE)))
        .where(and(notInArray(leadServices.status, ["completed", "cancelled"]), isNotNull(leadServices.dueAt), lt(leadServices.dueAt, agora))).limit(2000),
      db.select({ id: avaliacoes.id, tipo: avaliacoes.tipo, cliente: avaliacoes.clienteNome, avaliador: avaliacoes.avaliador, prazo: avaliacoes.prazoEntrega, leadId: avaliacoes.leadId })
        .from(avaliacoes).where(and(notInArray(avaliacoes.status, ["entregue", "cancelada"]), isNotNull(avaliacoes.prazoEntrega), lt(avaliacoes.prazoEntrega, agora))).limit(2000),
    ]);
    // os leads citados: nome (tarefa) e responsável do card (fallback), só os ativos no CRM
    const leadIds = Array.from(new Set([
      ...tarefas.filter(t => t.relatedType === "lead" && t.relatedId).map(t => t.relatedId!),
      ...regs.map(r => r.leadId), ...obras.map(o => o.leadId), ...fins.map(f => f.leadId), ...avals.map(a => a.leadId),
    ].filter((x): x is number => typeof x === "number")));
    const leadsAtivos = leadIds.length
      ? new Map((await db.select({ id: leads.id, name: leads.name, responsibleUserId: leads.responsibleUserId }).from(leads)
        .where(and(inArray(leads.id, leadIds), isNull(leads.deletedAt)))).map(l => [l.id, l]))
      : new Map<number, { id: number; name: string; responsibleUserId: number | null }>();
    const doLead = (leadId: number | null | undefined) => (leadId ? leadsAtivos.get(leadId)?.responsibleUserId ?? null : null);

    const porUsuario = new Map<number, Map<string, ItemCobranca>>();
    const pôr = (userId: number | null, item: ItemCobranca) => {
      if (!userId || !ids.has(userId)) return;
      const m = porUsuario.get(userId) ?? new Map<string, ItemCobranca>();
      m.set(item.chave, item);
      porUsuario.set(userId, m);
    };
    /** Pelo nome gravado; sem nome (ou nome de ninguém) → o responsável do card. Ambíguo ou de outra pessoa → ninguém. */
    const porNomeOuLead = (nome: string | null | undefined, leadId: number | null | undefined, item: ItemCobranca) => {
      const d = doNome(nome);
      if (d.tipo === "ambiguo") { ambiguos.push({ fonte: item.fonte, chave: item.chave, responsavel: d.nome }); return; }
      pôr(d.tipo === "usuario" ? d.id : doLead(leadId), item);
    };
    for (const t of tarefas) {
      if (!tarefaAtrasada(t, agora)) continue;
      const cliente = t.relatedType === "lead" && t.relatedId ? leadsAtivos.get(t.relatedId)?.name ?? null : null;
      porNomeOuLead(t.assignedTo, t.relatedType === "lead" ? t.relatedId : null, { fonte: "tarefa", chave: `tarefa:${t.id}`, descricao: t.title, cliente, desde: diaFortaleza(t.dueAt), dias: diasEntre(t.dueAt, agora), parado: false });
    }
    for (const p of regs) {
      if (p.encerrado || p.clienteExcluidoDoCrm || !(p.atrasado || p.parado)) continue;
      porNomeOuLead(p.responsavel, p.leadId, { fonte: "regularizacao", chave: `regularizacao:${p.id}`, descricao: p.servico, cliente: p.cliente,
        desde: p.atrasado ? p.prazo : null, dias: p.atrasado ? p.diasDeAtraso : p.diasSemMovimentacao, parado: !p.atrasado });
    }
    for (const o of obras) {
      if (o.encerrada || !(o.atrasada || o.parada) || (o.leadId && !leadsAtivos.has(o.leadId))) continue;
      pôr(doLead(o.leadId), { fonte: "obra", chave: `obra:${o.id}`, descricao: o.obra, cliente: o.cliente,
        desde: o.atrasada ? o.previsaoDeTermino : null, dias: o.atrasada ? o.diasDeAtraso : o.diasSemMovimentacao, parado: !o.atrasada });
    }
    for (const f of fins) {
      if (f.encerrado || !f.parado || (f.leadId && !leadsAtivos.has(f.leadId))) continue;
      pôr(doLead(f.leadId), { fonte: "financiamento", chave: `financiamento:${f.id}`, descricao: f.situacao, cliente: f.cliente, desde: null, dias: f.diasSemMovimentacao, parado: true });
    }
    for (const c of cards) {
      pôr(c.responsibleUserId, { fonte: "crm_card", chave: `card:${c.id}`, descricao: null, cliente: c.name, desde: c.cardDueDate, dias: diasEntre(c.cardDueDate, hoje), parado: false });
    }
    for (const s of servicos) {
      const dia = diaDoPrazo(s.dueAt);
      if (!dia || dia >= hoje) continue;
      pôr(s.responsibleUserId, { fonte: "crm_servico", chave: `servico:${s.id}`, descricao: truncar(s.title, 120) ?? LEAD_SERVICE_LABELS[s.serviceType as LeadServiceType] ?? s.serviceType,
        cliente: s.cliente, desde: dia, dias: diasEntre(dia, hoje), parado: false });
    }
    for (const a of avals) {
      if (a.leadId && !leadsAtivos.has(a.leadId)) continue;
      porNomeOuLead(a.avaliador, a.leadId, { fonte: "avaliacao", chave: `avaliacao:${a.id}`, descricao: a.tipo, cliente: a.cliente, desde: diaFortaleza(a.prazo), dias: diasEntre(a.prazo, agora), parado: false });
    }
    return { porColaborador: colabs.filter(c => porUsuario.has(c.id)).map(c => ({ colaborador: c, itens: Array.from(porUsuario.get(c.id)!.values()) })), ambiguos };
  }, { tempoLimiteMs: TEMPO_DA_COLETA_MS });
}
/** Só os itens de cada colaborador (ver {@link coletarCobrancas}). */
export async function coletarItensPorColaborador(agora: Date): Promise<CobrancaDoColaborador[]> {
  return (await coletarCobrancas(agora)).porColaborador;
}

// ── Envio ──

type Contexto = { agora: Date; prazoFinal: number; ms: () => number; autor: number | null; cfg: DoloresWhatsappConfig; conn: ConexaoDaEmpresa | null; config: ConfigCobrancas };
const comTempo = (c: Contexto) => c.prazoFinal - c.ms() >= MINIMO_POR_ENVIO_MS;
const conectado = (c: Contexto): c is Contexto & { conn: ConexaoDaEmpresa } => !!c.conn && !!c.cfg.instancia && c.cfg.statusConexao === "conectado";
const situacaoDoEnvio = (r: "ok" | "falhou" | "sem_confirmacao") => (r === "ok" ? "enviada" as const : r === "sem_confirmacao" ? "sem_confirmacao" as const : "falhou" as const);

/** O telefone do colaborador serve de destino? (número brasileiro completo; nunca o do dono nem o da própria empresa) */
export function destinoDoColaborador(phone: string | null | undefined, cfg: Pick<DoloresWhatsappConfig, "numeroDono" | "numeroDolores">): string | null {
  const n = normalizarNumeroDono(phone);
  if (!n || ehNumeroDoDono(n, cfg.numeroDono) || ehNumeroDoDono(n, cfg.numeroDolores)) return null;
  return n;
}

/** Cobrança do dia para cada colaborador com itens: uma vaga única (dia + usuário), teto global, envio, registro. */
async function cobrarColaboradores(c: Contexto): Promise<{ enviadas: number; semTelefone: number; falhas: number; parouPor: string | null }> {
  const r = { enviadas: 0, semTelefone: 0, falhas: 0, parouPor: null as string | null };
  const dia = diaDaCobranca(c.agora);
  const lista = (await coletarCobrancas(c.agora)).porColaborador;
  const db = getDb();
  for (const { colaborador, itens } of lista) {
    if (!comTempo(c)) { r.parouPor = "sem-tempo"; break; }
    const [ja] = await db.select({ id: doloresCobrancasColaborador.id }).from(doloresCobrancasColaborador)
      .where(and(eq(doloresCobrancasColaborador.dia, dia), eq(doloresCobrancasColaborador.userId, colaborador.id))).limit(1);
    if (ja) continue;
    const destino = destinoDoColaborador(colaborador.phone, c.cfg);
    const { texto, listados } = montarCobrancaColaborador({ nome: colaborador.name, itens, maxItens: c.config.maxItens });
    if (destino && !conectado(c)) { r.parouPor = "sem-conexao"; break; }
    const [linha] = await db.insert(doloresCobrancasColaborador).values({
      dia, userId: colaborador.id, situacao: destino ? "enviando" : "sem_telefone", itens: itens.length, listados, texto: registro(texto, 2000),
      ...(destino ? {} : { motivo: "sem telefone válido no cadastro do usuário", terminadoEm: c.agora }),
    }).onConflictDoNothing().returning({ id: doloresCobrancasColaborador.id });
    if (!linha) continue; // outra chamada pegou a vaga
    const auditar = (resultado: "ok" | "recusada" | "erro", motivo: string, extra: Record<string, unknown> = {}) =>
      registrarAcao({ funcao: "cobranca_colaborador", resultado, motivo, autorUserId: c.autor, canal: "cron", pedidoId: `cobranca:${linha.id}`,
        resumo: { userId: colaborador.id, itens: itens.length, listados, ...extra } });
    if (!destino) { r.semTelefone++; await auditar("recusada", "sem telefone válido no cadastro: vai ao resumo do dono"); continue; }
    if (!(await vagaNoContador(`cobranca-colaborador:${dia}`, c.config.colaboradorTetoDia))) {
      await db.delete(doloresCobrancasColaborador).where(eq(doloresCobrancasColaborador.id, linha.id)).catch(() => undefined);
      await auditar("recusada", `teto de ${c.config.colaboradorTetoDia} cobranças por dia; nada foi enviado`);
      r.parouPor = "teto"; break;
    }
    const resultado = await enviarAoContatoComResultado({ cfg: c.cfg, conn: c.conn!, numero: destino, texto, tipo: "cobranca_colaborador", prazoFinal: c.prazoFinal,
      autor: c.autor, leadId: null, pedidoId: `cobranca:${linha.id}`, nome: colaborador.name }).catch(e => { console.error("[dolores/cobrancas] falha no envio ao colaborador", erroParaLog(e)); return "falhou" as const; });
    const situacao = situacaoDoEnvio(resultado);
    await db.update(doloresCobrancasColaborador).set({ situacao, terminadoEm: new Date(), motivo: situacao === "falhou" ? "o envio não saiu (ver auditoria)" : situacao === "sem_confirmacao" ? "sem confirmação do envio (não é repetido)" : null })
      .where(eq(doloresCobrancasColaborador.id, linha.id)).catch(() => undefined);
    if (situacao === "falhou") r.falhas++; else r.enviadas++;
    await auditar(situacao === "falhou" ? "erro" : "ok", situacao === "enviada" ? "cobrança enviada ao colaborador" : situacao === "sem_confirmacao" ? "sem confirmação do envio" : "o envio não saiu",
      { destino: mascararNumero(destino) });
  }
  return r;
}

/** Reivindica a vaga do cliente: true se o último pedido foi há N dias ou mais (ou nunca). Atômico. */
async function vagaDoPedido(leadId: number, agora: Date, dias: number): Promise<boolean> {
  const limite = new Date(agora.getTime() - Math.max(3, dias) * 86_400_000);
  const r = await getDb().insert(doloresPedidosDocumentosVaga).values({ leadId, ultimoEm: agora })
    .onConflictDoUpdate({ target: doloresPedidosDocumentosVaga.leadId, set: { ultimoEm: agora, total: sql`${doloresPedidosDocumentosVaga.total} + 1` },
      setWhere: sql`${doloresPedidosDocumentosVaga.ultimoEm} <= ${limite}` })
    .returning({ total: doloresPedidosDocumentosVaga.total });
  return r.length === 1;
}

/** Os clientes (ids) com algum documento pendente, pela MESMA leitura de listar_documentos (agrupada por cliente). */
async function clientesComPendencia(): Promise<number[]> {
  const ids: number[] = [];
  for (let pagina = 1; pagina <= 20; pagina++) {
    const r = await emTransacaoSomenteLeitura(() => listarDocumentos({ situacao: "pendentes", pagina, limite: 50 }), { tempoLimiteMs: TEMPO_DA_COLETA_MS });
    const d = r.dados as { itens: Array<{ leadId: number | null }>; temMais?: boolean };
    for (const i of d.itens) if (i.leadId) ids.push(i.leadId);
    if (!d.temMais) break;
  }
  return Array.from(new Set(ids)).sort((a, b) => a - b);
}

export type MotivoSemPedido = "numero_reservado" | "sem_consentimento" | "card_inativo" | "sem_telefone" | "telefone_de_varios" | "nada_pendente" | "conversa_com_a_equipe";
/** Este cliente pode receber o pedido agora? Devolve o número e os documentos, ou o motivo (código). */
export async function elegivelAoPedido(leadId: number, agora: Date, cfg: Pick<DoloresWhatsappConfig, "numeroDono" | "numeroDolores">): Promise<{ ok: true; numero: string; nome: string; documentos: string[] } | { ok: false; motivo: MotivoSemPedido }> {
  const [l] = await getDb().select({ id: leads.id, name: leads.name, phone: leads.phone, lgpdConsent: leads.lgpdConsent, stage: leads.stage, deletedAt: leads.deletedAt })
    .from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!l || l.deletedAt || l.stage === LEAD_FINALIZED_STAGE) return { ok: false, motivo: "card_inativo" };
  if (l.lgpdConsent !== true) return { ok: false, motivo: "sem_consentimento" };
  const numero = normalizarNumeroDono(l.phone);
  if (!numero) return { ok: false, motivo: "sem_telefone" };
  // o número do dono ou o da própria empresa num cadastro de cliente: nunca é destino
  if (ehNumeroDoDono(numero, cfg.numeroDono) || ehNumeroDoDono(numero, cfg.numeroDolores)) return { ok: false, motivo: "numero_reservado" };
  // a MESMA identificação da E9: o número precisa levar a UM cliente do CRM, e a este (nem usuário, nem vários cadastros)
  const quem = await identificarRemetente(numero);
  if (quem.categoria !== "cliente" || quem.leadId !== leadId) return { ok: false, motivo: "telefone_de_varios" };
  const s = await emTransacaoSomenteLeitura(() => situacaoDoCliente(leadId, agora));
  if (!s || !s.documentos.length) return { ok: false, motivo: "nada_pendente" };
  if (await conversaEmSilencio(numero, agora)) return { ok: false, motivo: "conversa_com_a_equipe" };
  return { ok: true, numero, nome: s.lead.name, documentos: s.documentos };
}

/** Pedido de documentos aos clientes elegíveis: vaga de N dias, teto global, envio, histórico do cliente e registro. */
async function pedirDocumentos(c: Contexto): Promise<{ enviados: number; falhas: number; parouPor: string | null }> {
  const r = { enviados: 0, falhas: 0, parouPor: null as string | null };
  if (!conectado(c)) return { ...r, parouPor: "sem-conexao" };
  const dia = diaDaCobranca(c.agora);
  const db = getDb();
  const limite = new Date(c.agora.getTime() - c.config.documentosIntervaloDias * 86_400_000);
  for (const leadId of await clientesComPendencia()) {
    if (!comTempo(c)) { r.parouPor = "sem-tempo"; break; }
    // já pedido dentro do intervalo: nem confere de novo (a vaga atômica abaixo é a garantia)
    const [recente] = await db.select({ em: doloresPedidosDocumentosVaga.ultimoEm }).from(doloresPedidosDocumentosVaga)
      .where(and(eq(doloresPedidosDocumentosVaga.leadId, leadId), gte(doloresPedidosDocumentosVaga.ultimoEm, new Date(limite.getTime() + 1)))).limit(1);
    if (recente) continue;
    const e = await elegivelAoPedido(leadId, c.agora, c.cfg).catch(err => { console.error("[dolores/cobrancas] falha ao conferir o cliente", erroParaLog(err)); return null; });
    if (!e || !e.ok) continue;
    if (!(await vagaDoPedido(leadId, c.agora, c.config.documentosIntervaloDias))) continue;
    const texto = textoDoPedidoDeDocumentos({ nome: e.nome, documentos: e.documentos });
    const [linha] = await db.insert(doloresPedidosDocumentos).values({ dia, leadId, documentos: e.documentos.length, texto: registro(texto, 2000) })
      .onConflictDoNothing().returning({ id: doloresPedidosDocumentos.id });
    if (!linha) {
      // já há registro de hoje (uma tentativa anterior que não saiu soltou a vaga): hoje não tenta de novo, mas também não prende
      // a vaga por N dias — solta de novo, e amanhã ele volta a ser elegível.
      await db.delete(doloresPedidosDocumentosVaga).where(eq(doloresPedidosDocumentosVaga.leadId, leadId)).catch(() => undefined);
      continue;
    }
    const auditar = (resultado: "ok" | "recusada" | "erro", motivo: string, extra: Record<string, unknown> = {}) =>
      registrarAcao({ funcao: "pedido_documentos", resultado, motivo, autorUserId: c.autor, canal: "cron", pedidoId: `pedido-documentos:${linha.id}`,
        resumo: { leadId, documentos: e.documentos.length, ...extra } });
    if (!(await vagaNoContador(`pedido-documentos:${dia}`, c.config.documentosTetoDia))) {
      // fora do teto: solta a vaga do cliente e o registro (ele pode receber outro dia)
      await db.delete(doloresPedidosDocumentos).where(eq(doloresPedidosDocumentos.id, linha.id)).catch(() => undefined);
      await db.delete(doloresPedidosDocumentosVaga).where(eq(doloresPedidosDocumentosVaga.leadId, leadId)).catch(() => undefined);
      await auditar("recusada", `teto de ${c.config.documentosTetoDia} pedidos de documentos por dia; nada foi enviado`);
      r.parouPor = "teto"; break;
    }
    const resultado = await enviarAoContatoComResultado({ cfg: c.cfg, conn: c.conn!, numero: e.numero, texto, tipo: "pedido_documentos", prazoFinal: c.prazoFinal,
      autor: c.autor, leadId, pedidoId: `pedido-documentos:${linha.id}`, nome: e.nome }).catch(err => { console.error("[dolores/cobrancas] falha no envio ao cliente", erroParaLog(err)); return "falhou" as const; });
    const situacao = situacaoDoEnvio(resultado);
    await db.update(doloresPedidosDocumentos).set({ situacao, terminadoEm: new Date(), motivo: situacao === "falhou" ? "o envio não saiu (ver auditoria)" : situacao === "sem_confirmacao" ? "sem confirmação do envio (não é repetido)" : null })
      .where(eq(doloresPedidosDocumentos.id, linha.id)).catch(() => undefined);
    // não saiu de fato: solta a vaga do cliente (amanhã tenta de novo; hoje o registro do dia segura)
    if (situacao === "falhou") await db.delete(doloresPedidosDocumentosVaga).where(eq(doloresPedidosDocumentosVaga.leadId, leadId)).catch(() => undefined);
    if (situacao !== "falhou") {
      r.enviados++;
      await db.insert(leadActivities).values({ leadId, type: "message", performedBy: MARCA_DOLORES,
        description: registro(`Pedido de documentos enviado pela Dolores no WhatsApp (automático${situacao === "sem_confirmacao" ? ", sem confirmação do envio" : ""}). Pendentes: ${e.documentos.slice(0, 30).join(", ")}.`, 2000) })
        .catch(err => console.error("[dolores/cobrancas] falha ao gravar o histórico do cliente", erroParaLog(err)));
    } else r.falhas++;
    await auditar(situacao === "falhou" ? "erro" : "ok", situacao === "enviada" ? "pedido de documentos enviado ao cliente" : situacao === "sem_confirmacao" ? "sem confirmação do envio" : "o envio não saiu",
      { destino: mascararNumero(e.numero) });
  }
  return r;
}

/** O resumo do dia ao dono (uma vez por dia; dia único em dolores_cobrancas_resumos). Sem nada no dia, nada sai. */
async function enviarResumoDoDia(c: Contexto): Promise<string> {
  const dia = diaDaCobranca(c.agora);
  const db = getDb();
  const [ja] = await db.select({ id: doloresCobrancasResumos.id }).from(doloresCobrancasResumos).where(eq(doloresCobrancasResumos.dia, dia)).limit(1);
  if (ja) return "resumo-ja-enviado";
  const cobrancas = await db.select({ nome: users.name, itens: doloresCobrancasColaborador.itens, situacao: doloresCobrancasColaborador.situacao })
    .from(doloresCobrancasColaborador).innerJoin(users, eq(users.id, doloresCobrancasColaborador.userId)).where(eq(doloresCobrancasColaborador.dia, dia)).orderBy(asc(doloresCobrancasColaborador.id));
  const pedidos = await db.select({ nome: leads.name, leadId: doloresPedidosDocumentos.leadId, documentos: doloresPedidosDocumentos.documentos, situacao: doloresPedidosDocumentos.situacao })
    .from(doloresPedidosDocumentos).innerJoin(leads, eq(leads.id, doloresPedidosDocumentos.leadId)).where(eq(doloresPedidosDocumentos.dia, dia)).orderBy(asc(doloresPedidosDocumentos.id));
  // itens com responsável ambíguo (nome de mais de um usuário): ninguém foi cobrado; vão ao dono, sem o nome do cliente
  const ambiguos = c.config.colaboradorLigado
    ? await coletarCobrancas(c.agora).then(r => r.ambiguos).catch(err => { console.error("[dolores/cobrancas] falha ao conferir os responsáveis ambíguos", erroParaLog(err)); return []; })
    : [];
  const texto = montarResumoDoDia({ dia, cobrancas, pedidos, ambiguos });
  if (!texto) return "resumo-vazio";
  if (c.prazoFinal - c.ms() < 6_000) return "resumo-sem-tempo";
  const [linha] = await db.insert(doloresCobrancasResumos).values({ dia, texto: registro(texto, 4000) }).onConflictDoNothing().returning({ id: doloresCobrancasResumos.id });
  if (!linha) return "resumo-ja-enviado";
  const { enviarAvisoAoDono } = await import("./whatsapp.js");
  const r = await enviarAvisoAoDono(texto, { funcao: "cobrancas_resumo", pedidoId: `cobrancas-resumo:${linha.id}`, autor: c.autor, prazoFinal: c.prazoFinal, canal: "cron",
    resumo: { cobrancas: cobrancas.length, pedidos: pedidos.length, ambiguos: ambiguos.length } });
  await db.update(doloresCobrancasResumos).set({ situacao: r.ok ? "enviado" : "falhou" }).where(eq(doloresCobrancasResumos.id, linha.id)).catch(() => undefined);
  return r.ok ? "resumo-enviado" : "resumo-falhou";
}

/**
 * A rotina do cron (no fim das duas chamadas que já existem): pausa → interruptores → horário comercial → cobranças → pedidos →
 * resumo (17h–20h). Nunca lança; devolve só um código para a resposta do cron.
 */
export async function executarCobrancas(p: { agora: Date; prazoFinal: number; ms: () => number }): Promise<string> {
  try {
    const config = await lerConfigCobrancas();
    if (!config) return "sem-configuracao";
    if (!config.colaboradorLigado && !config.documentosLigado) return "desligadas";
    if (await bloqueioDaOperacao()) return "pausada";
    const cfg = await lerConfigWhatsapp().catch(() => null);
    if (!cfg) return "sem-whatsapp";
    const conn = await conexaoDaEmpresa().catch(() => null);
    const autor = await idDaDoloresSemCriar().catch(() => null);
    const c: Contexto = { ...p, autor, cfg, conn, config };
    const partes: string[] = [];
    if (dentroDoHorarioComercial(p.agora)) {
      if (config.colaboradorLigado) {
        const r = await cobrarColaboradores(c);
        partes.push(`colaboradores:${r.enviadas}/${r.semTelefone}/${r.falhas}${r.parouPor ? `:${r.parouPor}` : ""}`);
      }
      if (config.documentosLigado && comTempo(c)) {
        const r = await pedirDocumentos(c);
        partes.push(`documentos:${r.enviados}/${r.falhas}${r.parouPor ? `:${r.parouPor}` : ""}`);
      }
    } else partes.push("fora-do-horario");
    if (horaDoResumo(p.agora)) partes.push(await enviarResumoDoDia(c));
    return partes.join(" ");
  } catch (e) {
    console.error("[dolores/cobrancas] falha na rotina", erroParaLog(e));
    await registrarAcao({ funcao: "cobrancas_rotina", resultado: "erro", motivo: "falha na rotina de cobranças (ver log)", autorUserId: null, canal: "cron" }).catch(() => false);
    return "erro";
  }
}

// ── Resposta do colaborador ──

/**
 * Mensagem direta de um USUÁRIO ativo ao número da empresa (o roteamento já a pôs na Central). Se é um colaborador que recebeu
 * cobrança nos últimos {@link DIAS_RESPOSTA} dias: registra e encaminha ao dono (teto por dia). NUNCA é comando: nada é executado,
 * nada entra na fila, e o texto não entra na memória da conversa do dono. Nunca lança.
 */
export async function tratarRespostaDoColaborador(p: { numero: string; texto: string; externalId: string; prazoFinal: number; autor: number | null; agora: Date }): Promise<string> {
  try {
    if (!p.texto.trim()) return "colaborador-sem-texto";
    const config = await lerConfigCobrancas();
    if (!config?.colaboradorLigado) return "colaborador-desligado";
    const db = getDb();
    const final = p.numero.replace(/\D/g, "").slice(-8);
    if (final.length < 8) return "colaborador-sem-numero";
    const candidatos = await db.select({ id: users.id, name: users.name, phone: users.phone }).from(users)
      .where(and(eq(users.active, true), eq(users.role, "colaborador"), sql`right(regexp_replace(coalesce(${users.phone}, ''), '[^0-9]', '', 'g'), 8) = ${final}`));
    const meus = candidatos.filter(u => { const n = normalizarNumeroDono(u.phone); return !!n && ehNumeroDoDono(p.numero.replace(/\D/g, ""), n); });
    if (meus.length !== 1) return "colaborador-nao-identificado";
    const u = meus[0];
    const desde = new Date(p.agora.getTime() - DIAS_RESPOSTA * 86_400_000);
    const [cobranca] = await db.select({ id: doloresCobrancasColaborador.id }).from(doloresCobrancasColaborador)
      .where(and(eq(doloresCobrancasColaborador.userId, u.id), inArray(doloresCobrancasColaborador.situacao, ["enviada", "sem_confirmacao"]), gte(doloresCobrancasColaborador.criadoEm, desde)))
      .orderBy(desc(doloresCobrancasColaborador.id)).limit(1);
    if (!cobranca) return "colaborador-sem-cobranca";
    const dia = diaDaCobranca(p.agora);
    const [linha] = await db.insert(doloresCobrancasRespostas).values({ cobrancaId: cobranca.id, userId: u.id, dia, externalId: p.externalId.slice(0, 160), texto: registro(p.texto, 1000) })
      .onConflictDoNothing().returning({ id: doloresCobrancasRespostas.id });
    if (!linha) return "colaborador-repetida";
    if (!(await vagaNoContador(`cobranca-resposta:${u.id}:${dia}`, config.respostasTetoDia))) {
      await db.update(doloresCobrancasRespostas).set({ motivo: `teto de ${config.respostasTetoDia} respostas encaminhadas por dia` }).where(eq(doloresCobrancasRespostas.id, linha.id)).catch(() => undefined);
      return "colaborador-teto";
    }
    const { enviarAvisoAoDono } = await import("./whatsapp.js");
    const r = await enviarAvisoAoDono(textoDaResposta({ nome: u.name, texto: p.texto }), { funcao: "cobranca_resposta", pedidoId: `cobranca-resposta:${linha.id}`, autor: p.autor,
      prazoFinal: p.prazoFinal, canal: "whatsapp", resumo: { userId: u.id, cobrancaId: cobranca.id }, textoNaMemoria: LINHA_DA_RESPOSTA_NA_MEMORIA });
    await db.update(doloresCobrancasRespostas).set({ encaminhada: r.ok, motivo: r.ok ? null : (r.motivo ?? "não encaminhada").slice(0, 200) }).where(eq(doloresCobrancasRespostas.id, linha.id)).catch(() => undefined);
    return r.ok ? "colaborador-encaminhada" : "colaborador-nao-encaminhada";
  } catch (e) {
    console.error("[dolores/cobrancas] falha ao tratar a resposta do colaborador", erroParaLog(e));
    return "colaborador-erro";
  }
}

// ── Tela ──

/** Para a tela: configuração e os últimos envios (texto do registro, já filtrado). Sem a migração → null. */
export async function situacaoDasCobrancas(limite = 10) {
  const config = await lerConfigCobrancas();
  if (!config) return null;
  const db = getDb();
  const [cobrancas, pedidos, respostas] = await Promise.all([
    db.select({ id: doloresCobrancasColaborador.id, dia: doloresCobrancasColaborador.dia, nome: users.name, situacao: doloresCobrancasColaborador.situacao,
      itens: doloresCobrancasColaborador.itens, listados: doloresCobrancasColaborador.listados, texto: doloresCobrancasColaborador.texto, criadoEm: doloresCobrancasColaborador.criadoEm })
      .from(doloresCobrancasColaborador).innerJoin(users, eq(users.id, doloresCobrancasColaborador.userId)).orderBy(desc(doloresCobrancasColaborador.id)).limit(limite),
    db.select({ id: doloresPedidosDocumentos.id, dia: doloresPedidosDocumentos.dia, nome: leads.name, leadId: doloresPedidosDocumentos.leadId, situacao: doloresPedidosDocumentos.situacao,
      documentos: doloresPedidosDocumentos.documentos, texto: doloresPedidosDocumentos.texto, criadoEm: doloresPedidosDocumentos.criadoEm })
      .from(doloresPedidosDocumentos).innerJoin(leads, eq(leads.id, doloresPedidosDocumentos.leadId)).orderBy(desc(doloresPedidosDocumentos.id)).limit(limite),
    db.select({ id: doloresCobrancasRespostas.id, nome: users.name, encaminhada: doloresCobrancasRespostas.encaminhada, criadoEm: doloresCobrancasRespostas.criadoEm })
      .from(doloresCobrancasRespostas).innerJoin(users, eq(users.id, doloresCobrancasRespostas.userId)).orderBy(desc(doloresCobrancasRespostas.id)).limit(limite),
  ]);
  const iso = <T extends { criadoEm: Date }>(x: T) => ({ ...x, criadoEm: x.criadoEm.toISOString() });
  return { config, cobrancas: cobrancas.map(iso), pedidos: pedidos.map(iso), respostas: respostas.map(iso) };
}
