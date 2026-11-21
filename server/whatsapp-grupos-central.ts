// EPIC-027 C2 — grupos do WhatsApp na Central (rotas `whatsappGrupos.*`). Decisão do dono de 20/11/2026 (noite): "Aqui nas
// mensagens do WhatsApp também deve aparecer as mensagens do grupo para que o humano possa intervir"; quem vê: "Somente o Admin e
// os colaboradores que tiverem esse campo selecionado lá na hora do cadastro dele"; quais grupos: "Todos"; intervir: "Pode
// escrever, exatamente igual faz na conversa".
// Regras fixas deste arquivo:
// - Quem: admin ativo; colaborador ativo com o módulo WhatsApp E a permissão "Grupos do WhatsApp" (`podeVerGruposNaCentral`),
//   conferido no SERVIDOR em TODA rota (procedimento próprio, fora do `adminProcedure`, que só confere módulo e deixa o corretor
//   entrar no router "whatsapp"). Corretor, cliente, empreiteiro, inativo e anônimo: nada.
// - Quais: os grupos da instância da EMPRESA em dolores_grupos, ativos. Recusado nunca aparece (nem por id). "Aguardando o dono"
//   só para o admin, marcado. Grupo fora disso responde igual a grupo inexistente (sem oráculo).
// - Escrever: só texto, pelo número da empresa (Evolution), sem citação nem menção (`enviarTextoDaEquipeAoGrupoEvolution`), com os
//   tetos do envio manual da empresa (10/min, 200/dia), registrado com QUEM enviou (whatsapp_grupo_envios) e auditado (dolores_acoes,
//   sem o texto). NÃO é comando para a Dolores e não a faz responder: o eco chega como mensagem da própria conta (fromMe), que o
//   registro de grupo e a marcação ignoram (shared/dolores/grupos.ts e shared/dolores/marcacao.ts); a leitura ainda descarta, por
//   id, qualquer eco que um dia venha a ser registrado. Grupo cujo autor da adição não foi provado (espera o dono aceitar): só leitura.
// - "Assumir (humano)" / "Devolver para a Dolores" por grupo (whatsapp_grupo_atendimento): assumir só CALA (ela não responde nem
//   quando marcada); devolver tira a trava da equipe e volta a valer o interruptor do grupo e o geral — nunca liga nada.
// - Classificar o grupo NÃO é feito aqui: a tela usa a rota já existente `dolores.grupos.definirTipo`, com as travas do EPIC-027 C3.
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNotNull, lt, ne } from "drizzle-orm";
import { z } from "zod";
import { constructionProjects, leads, users } from "../drizzle/schema.js";
import { doloresGrupoMensagens, doloresGrupos, type DoloresGrupo } from "../drizzle/schema-dolores-grupos.js";
import { doloresMarcacoes } from "../drizzle/schema-dolores-marcacoes.js";
import { whatsappGrupoAtendimento, whatsappGrupoEnvios } from "../drizzle/schema-whatsapp-grupos.js";
import { textoDeDado } from "../shared/dolores/fila.js";
import { ROTULO_TIPO_GRUPO, semProvaDoDono, tipoEfetivo } from "../shared/dolores/grupos-tipo.js";
import {
  AUTOR_DOLORES, LIMITE_MENSAGENS_GRUPO, TEXTO_GRUPOS, autorDaEquipe, grupoVisivelNaCentral, podeVerGruposNaCentral, textoDaMensagemDeGrupo,
} from "../shared/whatsapp/grupos-central.js";
import { enviarTextoDaEquipeAoGrupoEvolution } from "./_core/evolution.js";
import { protectedProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";
import { registrarAcao } from "./dolores/auditoria.js";
import { reservarEnvioManualDaEmpresa } from "./whatsapp-canais.js";
import { conexaoDaEmpresa } from "./whatsapp-conexao-empresa.js";

export const SEM_PERMISSAO_GRUPOS = "Sem permissão para ver os grupos do WhatsApp (peça ao administrador a permissão \"Grupos do WhatsApp\").";
export const GRUPO_NAO_ENCONTRADO = "Grupo não encontrado na Central.";

/** Toda rota daqui: usuário logado E `podeVerGruposNaCentral` (papel + módulo WhatsApp + permissão "Grupos do WhatsApp"). */
const gruposProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!podeVerGruposNaCentral(ctx.user)) throw new TRPCError({ code: "FORBIDDEN", message: SEM_PERMISSAO_GRUPOS });
  return next();
});

const id32 = z.number().int().positive().max(2_147_483_647);

/** Instância da conexão da empresa (a mesma da Central e da Dolores). Sem ela, não há grupo nenhum. */
async function instanciaDaEmpresa() {
  const conn = await conexaoDaEmpresa();
  return { conn, instancia: conn?.instancia ?? null };
}

/** O grupo, se este usuário pode vê-lo; senão, a MESMA recusa de grupo inexistente. */
async function grupoDaCentral(role: string, grupoId: number): Promise<{ g: DoloresGrupo; conn: Awaited<ReturnType<typeof conexaoDaEmpresa>> }> {
  const { conn, instancia } = await instanciaDaEmpresa();
  const [g] = instancia
    ? await getDb().select().from(doloresGrupos).where(and(eq(doloresGrupos.id, grupoId), eq(doloresGrupos.instancia, instancia))).limit(1)
    : [];
  if (!g || !grupoVisivelNaCentral(g, role)) throw new TRPCError({ code: "NOT_FOUND", message: GRUPO_NAO_ENCONTRADO });
  return { g, conn };
}

const nomeDoGrupo = (g: { nomeWhatsapp: string | null; nome: string }) => textoDeDado(g.nomeWhatsapp ?? g.nome, 120);

/** Autor de uma mensagem de participante: o nome no WhatsApp (gravado a partir do C2) ou o número mascarado. */
function autorDoParticipante(m: { nomeRemetente: string | null; remetente: string | null; doDono: boolean }) {
  const base = m.nomeRemetente ? textoDeDado(m.nomeRemetente, 80) : m.remetente ?? "participante";
  return m.doDono ? `${base} (dono)` : base;
}

type ItemDoGrupo = {
  chave: string; origem: "participante" | "equipe" | "dolores"; autor: string; texto: string; quando: Date;
  /** Ordem/cursor: a hora em que o sistema registrou. */
  ordem: Date; situacao: string | null;
};

async function estadoDoAtendimento(grupoId: number) {
  const [l] = await getDb().select({ modo: whatsappGrupoAtendimento.modo, em: whatsappGrupoAtendimento.alteradoEm, nome: users.name })
    .from(whatsappGrupoAtendimento).leftJoin(users, eq(users.id, whatsappGrupoAtendimento.alteradoPor))
    .where(eq(whatsappGrupoAtendimento.grupoId, grupoId)).limit(1);
  return { estado: l?.modo === "humano" ? "assumida" as const : "dolores" as const, alteradoEm: l?.em ?? null, alteradoPor: l?.nome ?? null };
}

export const whatsappGruposRouter = router({
  /** Os grupos da empresa que este usuário pode ver, com a última mensagem. */
  listar: gruposProcedure.query(async ({ ctx }) => {
    const { conn, instancia } = await instanciaDaEmpresa();
    if (!instancia) return { conectada: false, grupos: [] };
    const db = getDb();
    const linhas = await db.select({
      id: doloresGrupos.id, nome: doloresGrupos.nome, nomeWhatsapp: doloresGrupos.nomeWhatsapp, tipo: doloresGrupos.tipo, leadId: doloresGrupos.leadId,
      obraId: doloresGrupos.obraId, ativo: doloresGrupos.ativo, situacaoConfirmacao: doloresGrupos.situacaoConfirmacao, origem: doloresGrupos.origem,
      adicionadoPor: doloresGrupos.adicionadoPor, provaAdicao: doloresGrupos.provaAdicao, codigo: doloresGrupos.codigo,
      cliente: leads.name, obra: constructionProjects.title,
    }).from(doloresGrupos).leftJoin(leads, eq(leads.id, doloresGrupos.leadId)).leftJoin(constructionProjects, eq(constructionProjects.id, doloresGrupos.obraId))
      .where(and(eq(doloresGrupos.instancia, instancia), eq(doloresGrupos.ativo, true), ne(doloresGrupos.situacaoConfirmacao, "recusado"),
        ctx.user.role === "admin" ? undefined : ne(doloresGrupos.situacaoConfirmacao, "aguardando_dono")))
      .limit(300);
    const visiveis = linhas.filter(g => grupoVisivelNaCentral(g, ctx.user.role));
    const ids = visiveis.map(g => g.id);
    const [entradas, envios, respostas] = ids.length ? await Promise.all([
      db.selectDistinctOn([doloresGrupoMensagens.grupoId], {
        grupoId: doloresGrupoMensagens.grupoId, tipo: doloresGrupoMensagens.tipo, texto: doloresGrupoMensagens.texto, midiaNome: doloresGrupoMensagens.midiaNome,
        criadoEm: doloresGrupoMensagens.criadoEm, enviadaEm: doloresGrupoMensagens.enviadaEm,
      }).from(doloresGrupoMensagens).where(inArray(doloresGrupoMensagens.grupoId, ids)).orderBy(doloresGrupoMensagens.grupoId, desc(doloresGrupoMensagens.criadoEm)),
      db.selectDistinctOn([whatsappGrupoEnvios.grupoId], { grupoId: whatsappGrupoEnvios.grupoId, texto: whatsappGrupoEnvios.texto, criadoEm: whatsappGrupoEnvios.criadoEm })
        .from(whatsappGrupoEnvios).where(inArray(whatsappGrupoEnvios.grupoId, ids)).orderBy(whatsappGrupoEnvios.grupoId, desc(whatsappGrupoEnvios.criadoEm)),
      db.selectDistinctOn([doloresMarcacoes.grupoId], { grupoId: doloresMarcacoes.grupoId, texto: doloresMarcacoes.resposta, criadoEm: doloresMarcacoes.respondidaEm })
        .from(doloresMarcacoes).where(and(inArray(doloresMarcacoes.grupoId, ids), eq(doloresMarcacoes.situacao, "respondida"), isNotNull(doloresMarcacoes.respondidaEm), isNotNull(doloresMarcacoes.resposta)))
        .orderBy(doloresMarcacoes.grupoId, desc(doloresMarcacoes.respondidaEm)),
    ]) : [[], [], []];
    const conectada = conn?.status === "conectado";
    const grupos = visiveis.map(g => {
      const candidatas = [
        ...entradas.filter(m => m.grupoId === g.id).map(m => ({ texto: textoDaMensagemDeGrupo(m), quando: m.enviadaEm ?? m.criadoEm, ordem: m.criadoEm })),
        ...envios.filter(m => m.grupoId === g.id).map(m => ({ texto: `Equipe: ${m.texto}`, quando: m.criadoEm, ordem: m.criadoEm })),
        ...respostas.filter(m => m.grupoId === g.id && m.criadoEm).map(m => ({ texto: `${AUTOR_DOLORES}: ${m.texto ?? ""}`, quando: m.criadoEm!, ordem: m.criadoEm! })),
      ].sort((a, b) => b.ordem.getTime() - a.ordem.getTime());
      const ultima = candidatas[0] ?? null;
      const tipo = tipoEfetivo(g);
      // recusado (nunca chega aqui) ou sem prova de quem colocou a empresa no grupo: só o dono aceita; por aqui só se lê
      const semProva = semProvaDoDono(g);
      return {
        id: g.id, nome: nomeDoGrupo(g), tipo, rotuloTipo: ROTULO_TIPO_GRUPO[tipo] ?? tipo,
        leadId: g.leadId, cliente: g.cliente ? textoDeDado(g.cliente, 120) : null, obraId: g.obraId, obra: g.obra ? textoDeDado(g.obra, 120) : null,
        aguardandoDono: g.situacaoConfirmacao === "aguardando_dono", semProvaDoDono: semProva,
        // o código do comando do dono só para o admin (o colaborador não usa)
        codigo: ctx.user.role === "admin" ? g.codigo : null,
        podeEscrever: conectada && !semProva,
        ultima: ultima ? { texto: textoDeDado(ultima.texto, 160), quando: ultima.quando } : null,
      };
    }).sort((a, b) => (b.ultima?.quando.getTime() ?? 0) - (a.ultima?.quando.getTime() ?? 0) || a.nome.localeCompare(b.nome, "pt-BR"));
    return { conectada, grupos };
  }),

  /**
   * Mensagens de um grupo, da mais antiga para a mais nova: participantes (nome no WhatsApp, ou número mascarado), respostas da
   * Dolores e o que a equipe escreveu pela Central ("equipe — Fulano"). No máximo 60 por vez; `antes` pagina para trás.
   */
  mensagens: gruposProcedure.input(z.object({ grupoId: id32, antes: z.date().optional() }).strict()).query(async ({ ctx, input }) => {
    const { g } = await grupoDaCentral(ctx.user.role, input.grupoId);
    const db = getDb();
    const lim = LIMITE_MENSAGENS_GRUPO + 1;
    const [entradas, envios, respostas] = await Promise.all([
      db.select().from(doloresGrupoMensagens)
        .where(and(eq(doloresGrupoMensagens.grupoId, g.id), input.antes ? lt(doloresGrupoMensagens.criadoEm, input.antes) : undefined))
        .orderBy(desc(doloresGrupoMensagens.criadoEm), desc(doloresGrupoMensagens.id)).limit(lim),
      db.select().from(whatsappGrupoEnvios)
        .where(and(eq(whatsappGrupoEnvios.grupoId, g.id), input.antes ? lt(whatsappGrupoEnvios.criadoEm, input.antes) : undefined))
        .orderBy(desc(whatsappGrupoEnvios.criadoEm), desc(whatsappGrupoEnvios.id)).limit(lim),
      db.select({ id: doloresMarcacoes.id, resposta: doloresMarcacoes.resposta, respondidaEm: doloresMarcacoes.respondidaEm }).from(doloresMarcacoes)
        .where(and(eq(doloresMarcacoes.grupoId, g.id), eq(doloresMarcacoes.situacao, "respondida"), isNotNull(doloresMarcacoes.respondidaEm), isNotNull(doloresMarcacoes.resposta),
          input.antes ? lt(doloresMarcacoes.respondidaEm, input.antes) : undefined))
        .orderBy(desc(doloresMarcacoes.respondidaEm)).limit(lim),
    ]);
    // o eco de um envio da equipe nunca aparece duas vezes (hoje ele nem é registrado: é mensagem da própria conta)
    const ecos = new Set(envios.map(e => e.externalId).filter((x): x is string => !!x));
    const itens: ItemDoGrupo[] = [
      ...entradas.filter(m => !ecos.has(m.externalId)).map(m => ({
        chave: `m${m.id}`, origem: "participante" as const, autor: autorDoParticipante(m), texto: textoDaMensagemDeGrupo(m),
        quando: m.enviadaEm ?? m.criadoEm, ordem: m.criadoEm, situacao: null,
      })),
      ...envios.map(e => ({
        chave: `e${e.id}`, origem: "equipe" as const, autor: autorDaEquipe(e.enviadoPorNome), texto: e.texto, quando: e.criadoEm, ordem: e.criadoEm, situacao: e.situacao,
      })),
      ...respostas.map(r => ({
        chave: `d${r.id}`, origem: "dolores" as const, autor: AUTOR_DOLORES, texto: r.resposta ?? "", quando: r.respondidaEm!, ordem: r.respondidaEm!, situacao: null,
      })),
    ].sort((a, b) => b.ordem.getTime() - a.ordem.getTime());
    const pagina = itens.slice(0, LIMITE_MENSAGENS_GRUPO);
    return {
      temMais: itens.length > LIMITE_MENSAGENS_GRUPO,
      // cursor da próxima página: a mais antiga desta
      maisAntiga: pagina.length ? pagina[pagina.length - 1].ordem : null,
      mensagens: pagina.reverse().map(({ ordem: _o, ...m }) => m),
    };
  }),

  /**
   * Escreve no grupo pelo número da empresa, "exatamente igual faz na conversa" (só texto). Tetos do envio manual da empresa; quem
   * enviou fica registrado. Nunca é comando para a Dolores.
   */
  enviar: gruposProcedure.input(z.object({ grupoId: id32, texto: z.string().trim().min(1).max(4096) }).strict()).mutation(async ({ ctx, input }) => {
    const { g, conn } = await grupoDaCentral(ctx.user.role, input.grupoId);
    if (semProvaDoDono(g)) throw new TRPCError({ code: "FORBIDDEN", message: TEXTO_GRUPOS.semEscrita });
    if (!conn?.instancia || conn.status !== "conectado") throw new TRPCError({ code: "BAD_REQUEST", message: "WhatsApp da empresa não está conectado (Configurações › Integrações)." });
    const { configEvolution } = await import("./whatsapp-router.js");
    const configurada = await configEvolution();
    if (!configurada) throw new TRPCError({ code: "BAD_REQUEST", message: "Servidor do WhatsApp não configurado: Configurações › Integrações." });
    // QA-SEG E9 achado 5: o mesmo ritmo do número da empresa (por minuto e por dia), no servidor, antes do envio
    const teto = await reservarEnvioManualDaEmpresa();
    if (teto) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: teto });
    const db = getDb();
    // o nome de quem enviou vem do cadastro, não da sessão
    const [quem] = await db.select({ nome: users.name }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
    const nome = quem?.nome ? textoDeDado(quem.nome, 120) : null;
    let r: { ok: boolean; id: string | null };
    try { r = await enviarTextoDaEquipeAoGrupoEvolution({ ...configurada, semRedirecionamento: true }, conn.instancia, g.grupoJid, input.texto); }
    catch { r = { ok: false, id: null }; }
    const [linha] = await db.insert(whatsappGrupoEnvios).values({
      grupoId: g.id, instancia: g.instancia, externalId: r.ok ? r.id : null, texto: input.texto, situacao: r.ok ? "enviada" : "falhou",
      enviadoPor: ctx.user.id, enviadoPorNome: nome,
    }).returning({ id: whatsappGrupoEnvios.id });
    // auditoria sem o texto (dolores_acoes.autor_user_id é só da Dolores: quem enviou vai no resumo)
    await registrarAcao({
      funcao: "grupo_central_envio", resultado: r.ok ? "ok" : "erro", motivo: r.ok ? "a equipe escreveu no grupo pela Central" : "o WhatsApp não aceitou a mensagem",
      autorUserId: null, canal: "tela", pedidoId: `central:grupo:${g.id}:envio:${linha.id}`,
      resumo: { grupoId: g.id, envioId: linha.id, porUserId: ctx.user.id, papel: ctx.user.role, tamanho: input.texto.length },
    });
    if (!r.ok) throw new TRPCError({ code: "BAD_REQUEST", message: "O WhatsApp não aceitou a mensagem. Confira a conexão." });
    return { ok: true, id: linha.id };
  }),

  /** Quem atende o grupo: a Dolores (pelas regras de sempre) ou a equipe ("Assumir (humano)"). */
  atendimento: gruposProcedure.input(z.object({ grupoId: id32 }).strict()).query(async ({ ctx, input }) => {
    const { g } = await grupoDaCentral(ctx.user.role, input.grupoId);
    return estadoDoAtendimento(g.id);
  }),

  /**
   * "Assumir (humano)": a Dolores não responde neste grupo nem quando é marcada, até alguém devolver. "Devolver para a Dolores":
   * tira a trava da equipe (volta a valer o interruptor do grupo e o geral). Nunca liga interruptor, nunca envia nada.
   */
  mudarAtendimento: gruposProcedure.input(z.object({ grupoId: id32, acao: z.enum(["assumir", "devolver"]) }).strict()).mutation(async ({ ctx, input }) => {
    const { g } = await grupoDaCentral(ctx.user.role, input.grupoId);
    const modo = input.acao === "assumir" ? "humano" as const : "dolores" as const;
    const agora = new Date();
    await getDb().insert(whatsappGrupoAtendimento).values({ grupoId: g.id, modo, alteradoEm: agora, alteradoPor: ctx.user.id })
      .onConflictDoUpdate({ target: whatsappGrupoAtendimento.grupoId, set: { modo, alteradoEm: agora, alteradoPor: ctx.user.id } });
    await registrarAcao({
      funcao: "grupo_central_atendimento", resultado: "ok", autorUserId: null, canal: "tela", pedidoId: `central:grupo:${g.id}:atendimento`,
      motivo: input.acao === "assumir" ? "grupo assumido pela equipe (Dolores calada nele até devolverem)" : "grupo devolvido para a Dolores (valem os interruptores de sempre)",
      resumo: { grupoId: g.id, acao: input.acao, porUserId: ctx.user.id, papel: ctx.user.role },
    });
    return estadoDoAtendimento(g.id);
  }),
});
