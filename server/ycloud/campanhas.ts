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
import { ycloudCampanhas, ycloudEnvios, ycloudOptout, type YcloudConfig } from "../../drizzle/schema-ycloud.js";
import { ehNumeroDoDono, normalizarNumeroDono } from "../../shared/dolores/whatsapp.js";
import {
  INTERVALO_MINIMO_ENVIO_MS, LOTE_ENVIO_YCLOUD, MAX_DESTINATARIOS_CAMPANHA, ORCAMENTO_LOTE_MS, RESERVA_EXPIRADA_MS, preencherPosicionais,
  problemaDoParametro, statusNaCentral, telefoneMascarado, telefoneE164, type FonteVariavel,
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
  const [r] = await getDb().select({ n: sql<number>`count(distinct ${ycloudEnvios.telefone})`.mapWith(Number) }).from(ycloudEnvios)
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

type Destino = { leadId: number; nome: string | null; telefone: string; cabecalho: string[]; corpo: string[]; texto: string };
export type Preparo = {
  modelo: ModeloNaTela;
  destinos: Destino[];
  contagem: {
    selecionados: number; aEnviar: number; optout: number; invalidos: number; duplicados: number; reservados: number;
    semNome: number; parametroInvalido: number; acimaDoLimite: number;
  };
  vagas: { limiteDiario: number | null; tetoDia: number; usados24h: number; restante: number; tetoCampanha: number };
  custo: { precoUnitario: number | null; estimado: number | null; moeda: string; base: "media_registrada" | "configurado" | null };
};

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

function valorDaVariavel(f: FonteVariavel | undefined, nome: string | null): string | null {
  if (!f) return null;
  if (f.fonte === "fixo") return f.texto;
  const n = (nome ?? "").trim();
  if (!n) return null;
  return f.fonte === "primeiro_nome" ? n.split(/\s+/)[0] : n;
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
  const comTelefone = cadastro.map(l => ({ ...l, e164: telefoneE164(l.telefone) }));
  const telefones = comTelefone.map(l => l.e164).filter((x): x is string => !!x);
  const bloqueados = new Set(telefones.length
    ? (await getDb().select({ t: ycloudOptout.telefone }).from(ycloudOptout).where(inArray(ycloudOptout.telefone, telefones))).map(r => r.t) : []);

  const contagem = { selecionados: ids.length, aEnviar: 0, optout: 0, invalidos: ids.length - cadastro.length, duplicados: 0, reservados: 0, semNome: 0, parametroInvalido: 0, acimaDoLimite: 0 };
  const vistos = new Set<string>();
  const validos: Destino[] = [];
  for (const l of comTelefone.sort((a, b) => a.id - b.id)) {
    if (!l.e164) { contagem.invalidos++; continue; }
    const dig = l.e164.slice(1);
    if (reservados.some(r => ehNumeroDoDono(dig, r))) { contagem.reservados++; continue; }
    if (vistos.has(l.e164)) { contagem.duplicados++; continue; }
    vistos.add(l.e164);
    if (bloqueados.has(l.e164)) { contagem.optout++; continue; }
    const cabecalho: string[] = [], corpo: string[] = [];
    const valores: Record<string, Record<number, string>> = { cabecalho: {}, corpo: {} };
    let falta: "nome" | "param" | null = null;
    for (const c of modelo.analise.campos) {
      const v = valorDaVariavel(entrada.variaveis[c.chave], l.nome);
      if (v === null) { falta = "nome"; break; }
      if (problemaDoParametro(v, c.limite)) { falta = "param"; break; }
      (c.local === "corpo" ? corpo : cabecalho)[c.indice - 1] = v;
      valores[c.local][c.indice] = v;
    }
    if (falta === "nome") { contagem.semNome++; continue; }
    if (falta === "param") { contagem.parametroInvalido++; continue; }
    const texto = [modelo.analise.cabecalho ? preencherPosicionais(modelo.analise.cabecalho, valores.cabecalho) : null, preencherPosicionais(modelo.analise.corpo, valores.corpo)]
      .filter(Boolean).join("\n");
    validos.push({ leadId: l.id, nome: l.nome ?? null, telefone: l.e164, cabecalho, corpo, texto: texto.slice(0, 4000) });
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
    modelo, destinos, contagem, custo,
    vagas: { limiteDiario: Number.isFinite(limiteDiario) ? limiteDiario : null, tetoDia: vagas.tetoDia, usados24h: vagas.usados24h, restante: vagas.restante, tetoCampanha: situacao.cfg.tetoCampanha },
  };
}

/** O que a tela recebe da prévia: contagens, custo e até 5 exemplos (nome + texto). Telefones não saem. */
export function previaParaTela(p: Preparo) {
  return {
    modelo: { nome: p.modelo.nome, idioma: p.modelo.idioma, categoria: p.modelo.categoria },
    contagem: p.contagem, vagas: p.vagas, custo: p.custo,
    exemplos: p.destinos.slice(0, 5).map(x => ({ nome: x.nome, texto: x.texto })),
  };
}

// ── Criação (confirmada pela contagem) ──

export async function criarCampanha(entrada: EntradaCampanha, confirmarQuantidade: number, userId: number) {
  const situacao = await situacaoParaDisparo();
  if (!situacao.ok) throw new RecusaYcloud(situacao.motivo ?? "Disparo indisponível.");
  const p = await prepararCampanha(entrada, situacao);
  if (p.contagem.aEnviar === 0) throw new RecusaYcloud("Nenhum destinatário pode receber agora (confira opt-out, telefones e o limite do dia).");
  if (p.contagem.aEnviar !== confirmarQuantidade) {
    throw new RecusaYcloud(`A contagem mudou: agora são ${p.contagem.aEnviar} destinatário(s), não ${confirmarQuantidade}. Revise a prévia e confirme de novo.`);
  }
  const d = depsYcloud();
  const db = getDb();
  const [camp] = await db.insert(ycloudCampanhas).values({
    nome: entrada.nome.trim().slice(0, 120), modeloNome: p.modelo.nome, modeloIdioma: p.modelo.idioma, modeloCategoria: p.modelo.categoria,
    corpo: p.modelo.analise.corpo, variaveis: entrada.variaveis, status: "enviando", total: p.destinos.length,
    custoEstimado: p.custo.estimado !== null ? p.custo.estimado.toFixed(4) : null, moeda: p.custo.moeda, criadaPor: userId,
    criadaEm: d.agora(), atualizadoEm: d.agora(),
  }).returning({ id: ycloudCampanhas.id });
  const linhas = p.destinos.map((x, i) => ({
    campanhaId: camp.id, leadId: x.leadId, telefone: x.telefone, nome: x.nome?.slice(0, 255) ?? null,
    parametros: { cabecalho: x.cabecalho, corpo: x.corpo }, texto: x.texto,
    externalId: `prospecta-c${camp.id}-${i + 1}`, status: "na_fila" as const, criadoEm: d.agora(), atualizadoEm: d.agora(),
  }));
  for (let i = 0; i < linhas.length; i += 500) await db.insert(ycloudEnvios).values(linhas.slice(i, i + 500)).onConflictDoNothing();
  await auditarYcloud({ acao: "campanha_criada", usuarioId: userId, campanhaId: camp.id, modelo: `${p.modelo.nome} (${p.modelo.idioma})`, quantidade: linhas.length });
  return { campanhaId: camp.id, total: linhas.length };
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

export async function enviarLote(campanhaId: number, userId: number): Promise<ResultadoLote> {
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

  // opt-out conferido de novo na hora do envio (pode ter chegado depois da criação)
  const bloqueados = new Set(reservados.length
    ? (await db.select({ t: ycloudOptout.telefone }).from(ycloudOptout).where(inArray(ycloudOptout.telefone, reservados.map(r => r.telefone)))).map(r => r.t) : []);
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
    if (bloqueados.has(e.telefone)) {
      await db.update(ycloudEnvios).set({ status: "falhou", erroCodigo: "OPTOUT", motivo: "Não enviada: a pessoa pediu para não receber.", falhouEm: d.agora(), atualizadoEm: d.agora() })
        .where(eq(ycloudEnvios.id, e.id));
      res.falhas++;
      continue;
    }
    const espera = ultimoEnvio + INTERVALO_MINIMO_ENVIO_MS - relogio();
    if (espera > 0) await d.esperar(espera);
    ultimoEnvio = relogio();
    const params = (e.parametros ?? {}) as { cabecalho?: string[]; corpo?: string[] };
    try {
      const r = await enfileirarModeloYcloud({ apiKey: situacao.apiKey, fetchImpl: d.fetch }, {
        from: origem, to: e.telefone, externalId: e.externalId, nome: camp.modeloNome, idioma: camp.modeloIdioma,
        cabecalho: (params.cabecalho ?? []).map(text => ({ type: "text" as const, text })),
        corpo: (params.corpo ?? []).map(text => ({ type: "text" as const, text })),
      });
      falhasSeguidas = 0;
      const falhouNaHora = r?.status === "failed";
      const centralId = falhouNaHora ? null : await registrarNaCentral(conexaoId, e);
      await db.update(ycloudEnvios).set({
        status: falhouNaHora ? "falhou" : "aceita", ycloudId: typeof r?.id === "string" ? r.id.slice(0, 80) : null,
        wamid: typeof r?.wamid === "string" ? r.wamid.slice(0, 255) : null,
        preco: typeof r?.totalPrice === "number" && Number.isFinite(r.totalPrice) ? String(r.totalPrice) : null,
        moeda: typeof r?.currency === "string" ? r.currency.slice(0, 3) : null,
        aceitoEm: d.agora(), ...(falhouNaHora ? { falhouEm: d.agora(), motivo: "A YCloud recusou na hora." } : {}),
        mensagemCentralId: centralId, atualizadoEm: d.agora(),
      }).where(eq(ycloudEnvios.id, e.id));
      if (falhouNaHora) res.falhas++; else res.enviadas++;
    } catch (err) {
      const x = err instanceof ErroYcloud ? err : new ErroYcloud("Falha inesperada no envio.", 0, null);
      if (x.ambiguo) {
        await db.update(ycloudEnvios).set({ status: "incerto", motivo: "Sem resposta da YCloud (o envio pode ter saído). Não é reenviado automaticamente.", atualizadoEm: d.agora() })
          .where(eq(ycloudEnvios.id, e.id));
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
      if ((x.status ?? 0) >= 500 && e.tentativas < 3) {
        // erro temporário da YCloud: volta para a fila (a tentativa fica contada; na 3ª vira falha)
        await db.update(ycloudEnvios).set({ status: "na_fila", reservadoEm: null, atualizadoEm: d.agora() }).where(and(eq(ycloudEnvios.id, e.id), eq(ycloudEnvios.status, "enviando")));
        falhasSeguidas++;
      } else {
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
  await getDb().insert(ycloudOptout).values({ telefone, origem, leadId, registradoPor: userId, criadoEm: depsYcloud().agora() }).onConflictDoNothing();
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
    .where(and(eq(ycloudEnvios.telefone, telefone), eq(ycloudEnvios.status, "na_fila")));
  const apiKey = await chaveYcloud().catch(() => null);
  if (apiKey) await criarDescadastroYcloud({ apiKey, fetchImpl: depsYcloud().fetch }, telefone).catch(() => undefined); // melhor esforço
  await auditarYcloud({ acao: "optout_registrado", usuarioId: userId, quantidade: 1 });
  return { ok: true as const };
}

export async function totalOptout() {
  const [r] = await getDb().select({ n: sql<number>`count(*)`.mapWith(Number) }).from(ycloudOptout);
  return Number(r?.n ?? 0);
}
