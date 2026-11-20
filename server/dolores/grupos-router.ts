// EPIC-025 (Dolores, etapa 4) — rotas `dolores.grupos.*`: cadastro dos grupos de clientes, configuração da classificação e
// pendências de classificação. SÓ o administrador (PAPEL), conferido de novo em cada procedimento (o adminProcedure só confere
// o MÓDULO). Regras:
// - só grupos cadastrados e ATIVOS são lidos; nada é excluído (desativa-se); o id do grupo e a instância não mudam;
// - nada aqui envia, responde ou reage em grupo: da Evolution só se LÊ a lista de grupos e os participantes (para conferir o
//   @lid da Dolores). A única fala em grupo é a do webhook quando ela é marcada (marcacao.ts), com os interruptores daqui;
// - o nome do grupo no WhatsApp é texto de terceiro: aparece sanitizado, só para o administrador escolher;
// - classificar pela tela passa pelas MESMAS travas do webhook (interruptores, tetos, limite com folga do dono).
// - Etapa 7 (regra do dono de 19/11/2026): os grupos entram SOZINHOS (webhook ou "Atualizar grupos"); a tela serve para VER e
//   CORRIGIR o tipo/vínculo (decisão do dono, gravada com `decidido_em` — o gatilho da 0133 só aceita assim) e desativar.
import { TRPCError } from "@trpc/server";
import { randomInt } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { constructionProjects, leads } from "../../drizzle/schema.js";
import { doloresGrupos, doloresGruposConfig } from "../../drizzle/schema-dolores-grupos.js";
import { jidDeGrupoValido } from "../../shared/dolores/grupos.js";
import { LIMITES_ENTRADA, gerarCodigoDeGrupo, ligadoPorPadrao, precisaDoAceiteDoDono, type TipoGrupo } from "../../shared/dolores/grupos-tipo.js";
import { entrarNoGrupo } from "./grupos-entrada.js";
import { decidirGrupo } from "./grupos-decisao.js";
import { textoDeDado, umaLinha } from "../../shared/dolores/fila.js";
import { INSTANCIA_DOLORES } from "../../shared/dolores/whatsapp.js";
import { listarGruposEvolution } from "../_core/evolution.js";
import { doloresMarcacoesConfig, doloresMarcacoesGrupo } from "../../drizzle/schema-dolores-marcacoes.js";
import { LIMITES_MARCACOES } from "../../shared/dolores/marcacao.js";
import { CONFIG_MARCACOES_PADRAO, conferirLidDaDolores, desligamentoDaMarcacaoPorFalha, lerConfigMarcacoes, limparPausaDaMarcacao, marcacoesRecentes } from "./marcacao.js";
import { adminProcedure, router } from "../_core/trpc.js";
import { getDb } from "../db.js";
import { registrarAcao } from "./auditoria.js";
import { classificarPendentes, desligamentoPorFalha, limparPausaPorFalhaNoConsumo } from "./classificacao.js";
import { lerConfigWhatsapp } from "./consumo.js";
import { desfechosDasMarcacoes } from "../whatsapp-recebimento.js";
import { agoraDoRoteamento } from "./roteamento.js";
import { CONFIG_GRUPOS_PADRAO, lerConfigGrupos, listarGruposParaTela, pendenciasDeClassificacao } from "./grupos.js";
import { credencialDaClassificacao, enviarAvisoAoDono } from "./whatsapp.js";

/** adminProcedure confere o módulo; aqui vale o PAPEL: só admin. */
const soAdmin = adminProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Só o administrador cadastra os grupos da Dolores." });
  return next();
});

/**
 * EPIC-027 C3 — classificar grupo (tipo e vínculo): admin, ou colaborador com o módulo WhatsApp (o adminProcedure confere o módulo
 * pelo mapa de procedimentos; aqui, o PAPEL). Corretor e os demais: barrados. Aceitar grupo recusado/sem prova nunca passa pela tela.
 */
const podeClassificar = adminProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin" && ctx.user.role !== "colaborador") throw new TRPCError({ code: "FORBIDDEN", message: "Só o administrador ou colaborador com o módulo WhatsApp classifica os grupos da Dolores." });
  return next();
});

const SEM_MIGRACAO = "Grupos da Dolores indisponíveis: a migração 0126 ainda não foi aplicada.";
const SEM_MIGRACAO_0129 = "Resposta quando marcada indisponível: a migração 0129 ainda não foi aplicada.";
const semMigracao0129 = (e: unknown): never => {
  if (e instanceof TRPCError) throw e;
  throw new TRPCError({ code: "PRECONDITION_FAILED", message: SEM_MIGRACAO_0129 });
};
const limite = (k: keyof typeof LIMITES_MARCACOES) => z.number().int().min(LIMITES_MARCACOES[k].min).max(LIMITES_MARCACOES[k].max);

/** Etapa 4b — confere o @lid da Dolores por um grupo (EPIC-027 C4: a mesma conferência do webhook, em marcacao.ts). */
const conferirLid = (grupoId: number, userId: number) => conferirLidDaDolores(grupoId, { userId, origem: "tela" });
const semMigracao = (e: unknown): never => {
  if (e instanceof TRPCError) throw e;
  throw new TRPCError({ code: "PRECONDITION_FAILED", message: SEM_MIGRACAO });
};

/** Rótulo do administrador: uma linha, sem invisíveis nem colchetes. */
const rotulo = z.string().trim().min(2).max(120).transform(s => textoDeDado(umaLinha(s, 120), 120))
  .refine(s => s.length >= 2, "Rótulo vazio depois de limpar caracteres inválidos.");
const id32 = z.number().int().positive().max(2_147_483_647);
const vinculo = { leadId: id32.nullable().optional(), obraId: id32.nullable().optional() };

async function conferirVinculo(leadId: number | null | undefined, obraId: number | null | undefined) {
  if (leadId && obraId) throw new TRPCError({ code: "BAD_REQUEST", message: "Ligue o grupo a um cliente OU a uma obra, não aos dois." });
  const db = getDb();
  if (leadId) {
    const [l] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, leadId), isNull(leads.deletedAt))).limit(1);
    if (!l) throw new TRPCError({ code: "BAD_REQUEST", message: `Cliente #${leadId} não encontrado no CRM.` });
  }
  if (obraId) {
    const [o] = await db.select({ id: constructionProjects.id }).from(constructionProjects).where(eq(constructionProjects.id, obraId)).limit(1);
    if (!o) throw new TRPCError({ code: "BAD_REQUEST", message: `Obra #${obraId} não encontrada.` });
  }
}

async function instanciaDaDolores(): Promise<string> {
  const c = await lerConfigWhatsapp().catch(() => null);
  return c?.instancia || INSTANCIA_DOLORES;
}

// QA E4 (achado 1, FKs): "dolores_acoes.autor_user_id" é RESTRICT (só a usuária Dolores é autora). Gravar ali o admin da tela
// impediria excluir esse usuário depois (Configurações › Usuários). O admin vai no resumo (sem FK); a autora fica vazia.
const auditar = (userId: number, funcao: string, grupoId: number | null, resumo: Record<string, unknown>) =>
  registrarAcao({ funcao, resultado: "ok", motivo: null, autorUserId: null, canal: "tela", pedidoId: `tela:grupos:${grupoId ?? "novo"}`, resumo: { grupoId, porUserId: userId, ...resumo } });

export const gruposRouter = router({
  /** Grupos cadastrados (com contagens), configuração e pendências de classificação. Sem texto de mensagem. */
  listar: soAdmin.query(async () => {
    try {
      const [grupos, config, pendencias] = await Promise.all([listarGruposParaTela(), lerConfigGrupos(), pendenciasDeClassificacao(50)]);
      // QA r3 N7: se a classificação foi desligada sozinha (uso não registrado), a tela mostra quando e por quê
      const desligada = await desligamentoPorFalha().catch(() => null);
      return {
        desligamentoPorFalha: desligada ? { ...desligada, em: desligada.em ? new Date(desligada.em).toISOString() : null } : null,
        grupos, pendencias: pendencias.map(p => ({ ...p, nome: p.nome ? textoDeDado(p.nome, 120) : null, confianca: p.confianca != null ? Number(p.confianca) : null })),
        config: { ...CONFIG_GRUPOS_PADRAO, ...config },
      };
    } catch (e) { return semMigracao(e); }
  }),

  /** Grupos em que o número da Dolores está, pela Evolution (só leitura), marcando os já cadastrados. */
  gruposDoWhatsapp: soAdmin.query(async () => {
    const { configEvolution } = await import("../whatsapp-router.js");
    const configurada = await configEvolution();
    // QA E4 r2 N4: a chave da Evolution nunca segue redirecionamento para outro host
    const evo = configurada ? { ...configurada, semRedirecionamento: true } : null;
    if (!evo) throw new TRPCError({ code: "BAD_REQUEST", message: "Servidor do WhatsApp (Evolution) não configurado: Integrações › WhatsApp." });
    const instancia = await instanciaDaDolores();
    let lista: Awaited<ReturnType<typeof listarGruposEvolution>>;
    try { lista = await listarGruposEvolution(evo, instancia); }
    catch { throw new TRPCError({ code: "BAD_REQUEST", message: "A Evolution não listou os grupos agora. Confira a conexão da Dolores ou digite o id do grupo." }); }
    const cadastrados = await getDb().select({ jid: doloresGrupos.grupoJid }).from(doloresGrupos).where(eq(doloresGrupos.instancia, instancia)).catch(() => []);
    const ja = new Set(cadastrados.map(c => c.jid));
    return lista.filter(g => jidDeGrupoValido(g.id)).map(g => ({
      grupoJid: g.id, nomeNoWhatsapp: g.nome ? textoDeDado(g.nome, 80) : null, participantes: g.participantes, cadastrado: ja.has(g.id),
    }));
  }),

  cadastrar: soAdmin.input(z.object({ grupoJid: z.string().trim().max(80), nome: rotulo, ...vinculo }).strict()).mutation(async ({ ctx, input }) => {
    if (!jidDeGrupoValido(input.grupoJid)) throw new TRPCError({ code: "BAD_REQUEST", message: "Id de grupo inválido: deve terminar em @g.us (ex.: 120363000000000000@g.us)." });
    await conferirVinculo(input.leadId, input.obraId);
    const instancia = await instanciaDaDolores();
    let linha: { id: number } | undefined;
    try {
      // Etapa 7: o cadastro manual (raro, agora que os grupos entram sozinhos) já nasce com o tipo pelo vínculo e decidido pelo admin
      [linha] = await getDb().insert(doloresGrupos).values({
        instancia, grupoJid: input.grupoJid, nome: input.nome, leadId: input.leadId ?? null, obraId: input.obraId ?? null,
        // sem vínculo: como na etapa 4, grupo de cliente "sem card ainda" (tipo vazio; o card vem pela fila)
        tipo: input.leadId ? "cliente" : input.obraId ? "engenharia" : null, situacaoConfirmacao: "confirmado",
        codigo: gerarCodigoDeGrupo(() => randomInt(0, 1_000_000) / 1_000_000), decididoEm: new Date(), decididoPor: `tela:${ctx.user.id}`,
        criadoPorUserId: ctx.user.id, atualizadoPorUserId: ctx.user.id,
      }).onConflictDoNothing().returning({ id: doloresGrupos.id });
    } catch (e) { return semMigracao(e); }
    if (!linha) throw new TRPCError({ code: "CONFLICT", message: "Esse grupo já está cadastrado (reative-o na lista, se estiver desativado)." });
    await auditar(ctx.user.id, "cadastrar_grupo", linha.id, { leadId: input.leadId ?? null, obraId: input.obraId ?? null });
    return { id: linha.id };
  }),

  /** Rótulo, vínculo e ativo/inativo. Nunca exclui; o id do grupo e a instância não mudam (gatilho da 0126). */
  atualizar: soAdmin.input(z.object({ id: id32, nome: rotulo.optional(), ativo: z.boolean().optional(), ...vinculo }).strict()).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const [g] = await db.select().from(doloresGrupos).where(eq(doloresGrupos.id, input.id)).limit(1).catch(semMigracao);
    if (!g) throw new TRPCError({ code: "NOT_FOUND", message: `Grupo ${input.id} não cadastrado.` });
    const leadId = input.leadId !== undefined ? input.leadId : g.leadId;
    const obraId = input.obraId !== undefined ? input.obraId : g.obraId;
    const mudaVinculo = (input.leadId !== undefined && input.leadId !== g.leadId) || (input.obraId !== undefined && input.obraId !== g.obraId);
    // QA-SEG E7 (6c): grupo recusado ou sem prova de quem colocou a Dolores só o DONO aceita, no WhatsApp — trocar o vínculo
    // pela tela seria aceitar. Desativar/reativar e o rótulo continuam (reativar não faz falar: a situação não muda).
    if (mudaVinculo && precisaDoAceiteDoDono(g)) throw new TRPCError({ code: "FORBIDDEN", message: `Só o dono aceita este grupo, pelo WhatsApp: "grupo ${g.codigo ?? "CÓDIGO"} aceitar". Pela tela dá para ver e desativar.` });
    if (mudaVinculo) await conferirVinculo(leadId, obraId);
    // Etapa 7: mudar o vínculo é decisão do admin/dono — o tipo acompanha o vínculo (gatilho e CHECK da 0133)
    const tipoAtual = g.tipo;
    const tipo: TipoGrupo | null | undefined = !mudaVinculo ? undefined : leadId ? (tipoAtual === "pos_atendimento" ? "pos_atendimento" : "cliente") : obraId ? "engenharia"
      // tirou o vínculo de um grupo de cliente/obra: volta a ser grupo de cliente "sem card ainda" (como na etapa 4)
      : (tipoAtual === null || tipoAtual === "cliente" || tipoAtual === "pos_atendimento" || (tipoAtual === "engenharia" && g.obraId)) ? null : tipoAtual;
    const agora = new Date();
    await db.update(doloresGrupos).set({
      ...(input.nome !== undefined ? { nome: input.nome } : {}), ...(input.ativo !== undefined ? { ativo: input.ativo } : {}),
      ...(mudaVinculo ? { leadId, obraId, tipo, situacaoConfirmacao: "confirmado" as const, decididoEm: agora, decididoPor: `tela:${ctx.user.id}` } : {}),
      atualizadoEm: agora, atualizadoPorUserId: ctx.user.id,
    }).where(eq(doloresGrupos.id, g.id));
    await auditar(ctx.user.id, "atualizar_grupo", g.id, { ativo: input.ativo ?? g.ativo, leadId, obraId, rotuloMudou: input.nome !== undefined });
    return { ok: true };
  }),

  /** Configuração da classificação e dos tetos (a classificação nasce DESLIGADA). */
  salvarConfig: soAdmin.input(z.object({
    classificacaoLigada: z.boolean().optional(),
    tetoClassificacoesDia: z.number().int().min(0).max(1000).optional(),
    tetoClassificacoesGrupoDia: z.number().int().min(0).max(200).optional(),
    maxMensagensGrupoDia: z.number().int().min(1).max(5000).optional(),
    tamanhoMaximoMb: z.number().int().min(1).max(20).optional(),
    retencaoDias: z.number().int().min(1).max(365).optional(),
    // QA E4 r2, N0.3: orçamento próprio da classificação (% do limite mensal)
    orcamentoClassificacaoPct: z.number().int().min(1).max(50).optional(),
    // Etapa 7: entrada automática de grupos e os tetos diários dela
    entradaAutomaticaLigada: z.boolean().optional(),
    tetoGruposNovosDia: z.number().int().min(LIMITES_ENTRADA.tetoGruposNovosDia.min).max(LIMITES_ENTRADA.tetoGruposNovosDia.max).optional(),
    tetoAvisosGruposDia: z.number().int().min(LIMITES_ENTRADA.tetoAvisosGruposDia.min).max(LIMITES_ENTRADA.tetoAvisosGruposDia.max).optional(),
  }).strict()).mutation(async ({ ctx, input }) => {
    const { tamanhoMaximoMb, ...resto } = input;
    const dados = { ...resto, ...(tamanhoMaximoMb !== undefined ? { tamanhoMaximoBytes: tamanhoMaximoMb * 1_048_576 } : {}) };
    const r = await getDb().update(doloresGruposConfig).set({ ...dados, atualizadoEm: new Date(), atualizadoPor: ctx.user.id })
      .where(eq(doloresGruposConfig.id, 1)).returning({ id: doloresGruposConfig.id }).catch(semMigracao);
    if (!r.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: SEM_MIGRACAO });
    await auditar(ctx.user.id, "configurar_grupos", null, dados);
    // QA r3 N7: o admin religou depois de conferir — some a pausa em memória desta instância (se houve)
    if (input.classificacaoLigada === true) limparPausaPorFalhaNoConsumo();
    return lerConfigGrupos();
  }),

  /**
   * Etapa 7 — corrige/define o tipo e o vínculo de um grupo (decisão do dono pela tela, a mesma do comando "grupo CÓDIGO tipo [nº]"
   * no WhatsApp). "ignorar" desativa. Nunca apaga; não mexe no CRM.
   */
  definirTipo: podeClassificar.input(z.object({
    grupoId: id32,
    tipo: z.enum(["cliente", "pos_atendimento", "juridico", "administrativo", "parceiros", "engenharia", "ignorar", "aceitar"]),
    numero: id32.nullable().optional(),
  }).strict()).mutation(async ({ ctx, input }) => {
    const tipo = input.tipo;
    // colaborador classifica; desativar ("ignorar") e o resto da configuração continuam do admin
    if (ctx.user.role !== "admin" && (tipo === "ignorar" || tipo === "aceitar")) throw new TRPCError({ code: "FORBIDDEN", message: "Só o administrador desativa grupo da Dolores." });
    if ((tipo === "cliente" || tipo === "pos_atendimento") && !input.numero) throw new TRPCError({ code: "BAD_REQUEST", message: "Informe o nº do cliente no CRM." });
    if (tipo !== "cliente" && tipo !== "pos_atendimento" && tipo !== "engenharia" && input.numero) throw new TRPCError({ code: "BAD_REQUEST", message: "Esse tipo de grupo não leva número." });
    const r = await decidirGrupo({ grupoId: input.grupoId }, tipo === "ignorar" || tipo === "aceitar" ? { tipo, numero: null } : { tipo, numero: input.numero ?? null }, { via: "tela", userId: ctx.user.id });
    if (!r.ok) throw new TRPCError({ code: r.grupoId ? "BAD_REQUEST" : "NOT_FOUND", message: r.texto.replace(/^Dolores: /, "") });
    return { ok: true, texto: r.texto.replace(/^Dolores: /, "") };
  }),

  /**
   * Etapa 7 — "Atualizar grupos": lê da Evolution (só leitura) os grupos em que o número da Dolores está e faz entrar o que ainda
   * não está na lista (o mesmo caminho da primeira mensagem: tipo pelo nome, teto diário, aviso ao dono). Sem o aviso de quem a
   * colocou, nenhum é aceito sozinho: ficam "aguardando você: não sei quem me colocou" até o dono responder "grupo <código> aceitar". Também dá código
   * aos grupos antigos que ainda não têm (para o comando do dono). Nada fala no grupo.
   */
  atualizarGrupos: soAdmin.mutation(async ({ ctx }) => {
    const { configEvolution } = await import("../whatsapp-router.js");
    const configurada = await configEvolution();
    const evo = configurada ? { ...configurada, semRedirecionamento: true } : null;
    if (!evo) throw new TRPCError({ code: "BAD_REQUEST", message: "Servidor do WhatsApp (Evolution) não configurado: Integrações › WhatsApp." });
    const instancia = await instanciaDaDolores();
    let lista: Awaited<ReturnType<typeof listarGruposEvolution>>;
    try { lista = await listarGruposEvolution(evo, instancia); }
    catch { throw new TRPCError({ code: "BAD_REQUEST", message: "A Evolution não listou os grupos agora. Confira a conexão da Dolores." }); }
    const db = getDb();
    const sem = await db.select({ id: doloresGrupos.id }).from(doloresGrupos).where(isNull(doloresGrupos.codigo)).limit(500).catch(semMigracao);
    for (const g of sem) {
      for (let i = 0; i < 6; i++) {
        const r = await db.update(doloresGrupos).set({ codigo: gerarCodigoDeGrupo(() => randomInt(0, 1_000_000) / 1_000_000) })
          .where(and(eq(doloresGrupos.id, g.id), isNull(doloresGrupos.codigo))).returning({ id: doloresGrupos.id }).catch(() => null);
        if (r) break; // colisão do código (índice único): sorteia de novo
      }
    }
    const prazoFinal = Date.now() + 45_000;
    const numeroDono = (await lerConfigWhatsapp().catch(() => null))?.numeroDono ?? null;
    const contagem: Record<string, number> = {};
    for (const g of lista.filter(x => jidDeGrupoValido(x.id))) {
      if (Date.now() > prazoFinal - 5_000) { contagem["sem-tempo"] = (contagem["sem-tempo"] ?? 0) + 1; continue; }
      // sem aviso de quem a adicionou: no máximo "aguardando o dono" (não sei quem me colocou) — QA-SEG E7, achado 1b
      const r = await entrarNoGrupo({ instancia, grupoJid: g.id, nomeNoWhatsapp: g.nome, agora: new Date(), autor: null, prazoFinal, canal: "tela", avisar: enviarAvisoAoDono, numeroDono });
      contagem[r.resultado] = (contagem[r.resultado] ?? 0) + 1;
    }
    await auditar(ctx.user.id, "atualizar_grupos", null, { naEvolution: lista.length, ...contagem, codigosNovos: sem.length });
    return { naEvolution: lista.length, novos: contagem.criado ?? 0, jaNaLista: contagem.existente ?? 0, foraPeloTeto: contagem["entrada-teto"] ?? 0,
      entradaDesligada: (contagem["entrada-desligada"] ?? 0) > 0, erros: (contagem["entrada-erro"] ?? 0) + (contagem["sem-tempo"] ?? 0) };
  }),

  /**
   * Etapa 4b — responder quando marcada: configuração (interruptor geral, tetos, janela), o interruptor de cada grupo e as
   * últimas marcações (pergunta filtrada, resposta, fora de escopo). O que ela escreve no grupo é lido por todos os participantes.
   */
  marcacoes: soAdmin.input(z.object({ grupoId: id32.optional() }).strict().optional()).query(async ({ input }) => {
    try {
      const [config, porGrupo, lista, todos] = await Promise.all([
        lerConfigMarcacoes(), getDb().select().from(doloresMarcacoesGrupo), marcacoesRecentes(input?.grupoId ?? null, 50), getDb().select().from(doloresGrupos),
      ]);
      // EPIC-027 C4: grupo sem linha mostra o padrão (nasce ligado o aceito de tipo conhecido) — o mesmo que o webhook usa
      const comLinha = new Set(porGrupo.map(g => g.grupoId));
      const padrao = todos.filter(g => !comLinha.has(g.id) && ligadoPorPadrao(g)).map(g => ({ grupoId: g.id, ligado: true }));
      const desfechos = await desfechosDasMarcacoes(agoraDoRoteamento(), 24).catch(() => []);
      const numero = (await lerConfigWhatsapp().catch(() => null))?.numeroDolores ?? null;
      // desligada sozinha (uso de uma resposta não registrado no consumo), inclusive a pausa só em memória: a tela mostra
      const desligada = await desligamentoDaMarcacaoPorFalha().catch(() => null);
      return {
        desligamentoPorFalha: desligada ? { ...desligada, em: desligada.em ? new Date(desligada.em).toISOString() : null } : null,
        config: {
          responderLigado: config.responderLigado, tetoGrupoDia: config.tetoGrupoDia, tetoRemetenteHora: config.tetoRemetenteHora,
          janelaFrescorSegundos: config.janelaFrescorSegundos,
          // o @lid não é telefone, mas só o fim aparece na tela
          lid: config.lidDolores && config.lidDoNumero === numero ? { final: config.lidDolores.replace(/@lid$/, "").slice(-4), conferidoEm: config.lidConferidoEm } : null,
        },
        grupos: [...porGrupo.map(g => ({ grupoId: g.grupoId, ligado: g.responderLigado })), ...padrao],
        // EPIC-027 C4: o que aconteceu com cada marcação nas últimas 24 h (sem texto nem telefone), inclusive as não registradas
        desfechos,
        marcacoes: lista.map(m => ({ ...m, grupo: textoDeDado(m.grupo, 120) })),
      };
    } catch (e) { return semMigracao0129(e); }
  }),

  /** Interruptor geral e tetos (o interruptor nasce DESLIGADO). */
  salvarMarcacoes: soAdmin.input(z.object({
    responderLigado: z.boolean().optional(), tetoGrupoDia: limite("tetoGrupoDia").optional(), tetoRemetenteHora: limite("tetoRemetenteHora").optional(),
    janelaFrescorSegundos: limite("janelaFrescorSegundos").optional(),
  }).strict()).mutation(async ({ ctx, input }) => {
    const r = await getDb().update(doloresMarcacoesConfig).set({ ...input, atualizadoEm: new Date(), atualizadoPor: ctx.user.id })
      .where(eq(doloresMarcacoesConfig.id, 1)).returning({ id: doloresMarcacoesConfig.id }).catch(semMigracao0129);
    if (!r.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: SEM_MIGRACAO_0129 });
    // religado pelo admin: solta a pausa em memória da falha no registro do consumo (E4b, QA E4 r3 N7)
    if (input.responderLigado === true) limparPausaDaMarcacao();
    await auditar(ctx.user.id, "configurar_marcacoes", null, input);
    const c = await lerConfigMarcacoes();
    return { ...CONFIG_MARCACOES_PADRAO, ...c, lidDolores: undefined, lidDoNumero: undefined };
  }),

  /** Interruptor de UM grupo cadastrado. Ao ligar, tenta conferir o @lid da Dolores por esse grupo (só leitura na Evolution). */
  ligarMarcacaoGrupo: soAdmin.input(z.object({ grupoId: id32, ligado: z.boolean() }).strict()).mutation(async ({ ctx, input }) => {
    const [g] = await getDb().select().from(doloresGrupos).where(eq(doloresGrupos.id, input.grupoId)).limit(1).catch(semMigracao);
    if (!g) throw new TRPCError({ code: "NOT_FOUND", message: `Grupo ${input.grupoId} não cadastrado.` });
    if (input.ligado && !g.ativo) throw new TRPCError({ code: "BAD_REQUEST", message: "Reative o grupo antes de ligar a resposta quando marcada." });
    // QA-SEG E7 (6c): grupo recusado ou esperando o dono dizer quem colocou a Dolores fica com o interruptor desligado
    if (input.ligado && precisaDoAceiteDoDono(g)) throw new TRPCError({ code: "BAD_REQUEST", message: `Este grupo espera o dono pelo WhatsApp ("grupo ${g.codigo ?? "CÓDIGO"} aceitar" ou "grupo ${g.codigo ?? "CÓDIGO"} <tipo>"); até lá ela só observa.` });
    await getDb().insert(doloresMarcacoesGrupo).values({ grupoId: g.id, responderLigado: input.ligado, atualizadoPor: ctx.user.id })
      .onConflictDoUpdate({ target: doloresMarcacoesGrupo.grupoId, set: { responderLigado: input.ligado, atualizadoEm: new Date(), atualizadoPor: ctx.user.id } })
      .catch(semMigracao0129);
    await auditar(ctx.user.id, "ligar_marcacao_grupo", g.id, { ligado: input.ligado });
    const lid = input.ligado ? await conferirLid(g.id, ctx.user.id).catch(() => ({ conferido: false, motivo: "não consegui conferir o @lid agora" })) : null;
    return { ok: true, lid };
  }),

  /** Confere de novo o @lid da Dolores por um grupo cadastrado (só leitura na Evolution). */
  conferirLidDolores: soAdmin.input(z.object({ grupoId: id32 }).strict()).mutation(async ({ ctx, input }) => {
    const r = await conferirLid(input.grupoId, ctx.user.id).catch(semMigracao0129);
    await auditar(ctx.user.id, "conferir_lid_dolores", input.grupoId, { conferido: r.conferido });
    return r;
  }),

  /**
   * Classifica agora até 5 documentos pendentes, pelas MESMAS travas do webhook (classificação ligada, pausa, interruptor da
   * IA, chave, modelo da função, teto do dia, limite mensal com folga). Não envia nada a ninguém.
   */
  classificarPendentes: soAdmin.input(z.object({ maximo: z.number().int().min(1).max(5).default(3) }).strict().optional()).mutation(async ({ input }) => {
    const contagem = await classificarPendentes({ maximo: input?.maximo ?? 3, prazoFinal: Date.now() + 45_000, obterCredencial: credencialDaClassificacao, canal: "tela" })
      .catch(semMigracao);
    return { contagem };
  }),
});
