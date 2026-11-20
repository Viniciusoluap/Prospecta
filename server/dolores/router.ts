// EPIC-025 (Dolores, etapa 2) — configuração do WhatsApp da Dolores (tRPC `dolores.*`), SÓ do administrador (papel):
// o router fica fora do mapa de módulos do adminProcedure (colaborador e corretor já são recusados lá) e cada
// procedimento confere o papel de novo. Nada aqui devolve chave, segredo do webhook ou número completo; o QR code sai
// só na hora de conectar, para a tela, e não é guardado.
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { users, whatsappConnections } from "../../drizzle/schema.js";
import { doloresWhatsappConfig } from "../../drizzle/schema-dolores-whatsapp.js";
import {
  INSTANCIA_DOLORES, bloqueioDoLimite, mascararNumero, mesFortaleza, normalizarNumeroDono, pareceMesmoTelefone,
} from "../../shared/dolores/whatsapp.js";
import { existeChaveAnthropicPainel } from "../_core/anthropic-painel.js";
import { modeloDaFuncao } from "../_core/modelo-por-funcao.js";
import { EVENTOS_WEBHOOK_DOLORES, estadoInstancia, gerarQrCode, numeroConectado, registrarWebhookEvolution, rejeitarLigacoesEvolution, removerInstancia, removerInstanciaConfirmada } from "../_core/evolution.js";
import { adminProcedure, router } from "../_core/trpc.js";
import { getDb } from "../db.js";
import { lerConfigWhatsapp, lerPausa, usoDoMes } from "./consumo.js";
import { registrarAcao } from "./auditoria.js";
import { URL_WEBHOOK_DOLORES, segredoWebhookDolores } from "./whatsapp.js";
import { doloresFilaConfig } from "../../drizzle/schema-dolores-fila.js";
import { VALIDADE_MAXIMA_HORAS, VALIDADE_MINIMA_HORAS, codigoValido } from "../../shared/dolores/fila.js";
import { decidir, decisorDaTela, lerValidadeHoras, listarFila, situacoesValidas } from "./aprovacoes.js";
import { gruposRouter } from "./grupos-router.js";
import { notasRouter } from "./notas-router.js";
import { operacaoRouter } from "./operacao-router.js";
import { atendimentoRouter } from "./atendimento-router.js";
import { resumoDoRecebimento } from "../whatsapp-recebimento.js";
import { agoraDoRoteamento } from "./roteamento.js";

/** adminProcedure confere o módulo; aqui vale o PAPEL: só admin. */
const soAdmin = adminProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Só o administrador configura a Dolores." });
  return next();
});

const erro = (e: unknown, padrao: string) =>
  e instanceof TRPCError ? e : new TRPCError({ code: "BAD_REQUEST", message: (e instanceof Error && e.message ? e.message : padrao).replace(/sk-ant-[\w-]*/g, "sk-ant-…").slice(0, 300) });

async function exigirConfig() {
  const c = await lerConfigWhatsapp().catch(() => null);
  if (!c) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Configuração da Dolores ausente: a migração 0124 ainda não foi aplicada." });
  return c;
}
async function exigirEvolution() {
  const { configEvolution } = await import("../whatsapp-router.js");
  const c = await configEvolution();
  if (!c) throw new TRPCError({ code: "BAD_REQUEST", message: "Servidor do WhatsApp (Evolution) não configurado: Integrações › WhatsApp." });
  // QA E4 r2 N4: a chave da Evolution nunca segue redirecionamento para outro host
  return { ...c, semRedirecionamento: true };
}
const gravar = (dados: Partial<typeof doloresWhatsappConfig.$inferInsert>, userId: number) =>
  getDb().update(doloresWhatsappConfig).set({ ...dados, atualizadoEm: new Date(), atualizadoPor: userId }).where(eq(doloresWhatsappConfig.id, 1));

/**
 * QA-SEG E9 achado 2: as linhas de admin/colaborador em whatsapp_connections que ainda guardam uma instância — a conexão da Central
 * de ANTES da conexão única (QR feito pela aba "Minha conexão"). A instância da empresa nunca entra (nem pelo nome padrão, nem pela
 * da configuração). O aviso dessas instâncias já não grava nada (whatsapp-evolution-webhook.ts); a remoção é só pelo botão do admin.
 */
async function conexoesAntigasDaCentral(instanciaDaEmpresa: string | null) {
  const linhas = await getDb().select({ id: whatsappConnections.id, instancia: whatsappConnections.instancia, numero: whatsappConnections.numero, status: whatsappConnections.status })
    .from(whatsappConnections).innerJoin(users, eq(users.id, whatsappConnections.userId))
    .where(and(inArray(users.role, ["admin", "colaborador"]), isNotNull(whatsappConnections.instancia)));
  return linhas.filter((l): l is typeof l & { instancia: string } => !!l.instancia && l.instancia !== INSTANCIA_DOLORES && l.instancia !== instanciaDaEmpresa);
}

/**
 * O número conectado não pode ser o de uma conexão de CORRETOR na Central ("corretor") nem o da instância ANTIGA da Central do
 * admin/colaborador enquanto ela existir ("antiga") — o mesmo número em duas instâncias. Etapa 9: a linha do admin SEM instância
 * (só o `connectionId` da Central da empresa) não conta.
 */
async function numeroDeOutraConexao(numero: string, instanciaDaEmpresa: string | null): Promise<"corretor" | "antiga" | null> {
  const conns = await getDb().select({ numero: whatsappConnections.numero }).from(whatsappConnections)
    .innerJoin(users, eq(users.id, whatsappConnections.userId)).where(eq(users.role, "corretor"));
  if (conns.some(c => pareceMesmoTelefone(c.numero, numero))) return "corretor";
  const antigas = await conexoesAntigasDaCentral(instanciaDaEmpresa);
  return antigas.some(c => pareceMesmoTelefone(c.numero, numero)) ? "antiga" : null;
}
const MENSAGEM_CONEXAO_ANTIGA = "Esse número ainda está na conexão antiga da Central. Use \"Remover a conexão antiga da Central\" no cartão do WhatsApp da empresa e confira de novo; nada foi ativado.";

/** O que falta para a Dolores responder pela IA (a tela mostra a lista). */
function pendencias(p: { conectado: boolean; numeroDono: boolean; chave: boolean; modelo: boolean; limites: boolean; iaLigada: boolean; pausada: boolean }) {
  const r: string[] = [];
  if (!p.conectado) r.push("Conectar o número da Dolores (QR code).");
  if (!p.numeroDono) r.push("Cadastrar o número do dono (o único que comanda).");
  if (!p.chave) r.push("Cadastrar a chave da Anthropic em Integrações › Anthropic.");
  if (!p.modelo) r.push("Escolher o modelo da Dolores (ou o preferencial) em Integrações › Anthropic › Modelo por função.");
  if (!p.limites) r.push("Definir os limites mensais de tokens (entrada e saída).");
  if (!p.iaLigada) r.push("Ligar o interruptor da IA da Dolores (desligado por padrão).");
  if (p.pausada) r.push("A Dolores está pausada (dolores_config.pausada).");
  return r;
}

async function situacao() {
  const c = await exigirConfig();
  // QA achado 9: a tela só precisa saber SE há chave — a chave em si nunca passa por aqui.
  const [pausa, chave] = await Promise.all([lerPausa().catch(() => null), existeChaveAnthropicPainel().catch(() => null)]);
  const painel = chave?.existe ? { modelo: chave.modelo } : null;
  const mes = mesFortaleza(new Date());
  const uso = await usoDoMes(mes);
  // EPIC-024 S-11: a fonte é Integrações › Anthropic (modelo da função; sem escolha, o campo antigo; depois o preferencial).
  const resolvido = await modeloDaFuncao("dolores_whatsapp", { anterior: c.modelo, preferencial: painel?.modelo ?? null });
  const modeloEmUso = resolvido.modelo;
  const limites = { entrada: c.limiteMensalTokensEntrada, saida: c.limiteMensalTokensSaida };
  return {
    instancia: c.instancia, statusConexao: c.statusConexao, numeroDolores: mascararNumero(c.numeroDolores), numeroDono: mascararNumero(c.numeroDono),
    iaLigada: c.iaLigada, pausada: pausa?.pausada ?? null, chaveAnthropic: Boolean(painel), modeloPainel: painel?.modelo ?? null, modelo: c.modelo,
    modeloEmUso, origemModelo: resolvido.origem, limites, mes, uso, bloqueioDoLimite: bloqueioDoLimite(uso, limites), webhookUrl: URL_WEBHOOK_DOLORES(),
    pendencias: pendencias({ conectado: c.statusConexao === "conectado", numeroDono: Boolean(c.numeroDono), chave: Boolean(painel), modelo: Boolean(modeloEmUso),
      limites: limites.entrada > 0 && limites.saida > 0, iaLigada: c.iaLigada, pausada: Boolean(pausa?.pausada) }),
  };
}

/**
 * Etapa 3 — fila de aprovação na tela (só admin por PAPEL). Aprovar aqui executa pela mesma regra do WhatsApp:
 * reivindicação atômica, revalidação e execução única; a decisão fica com o id de quem decidiu.
 */
const codigoEntrada = z.string().trim().toUpperCase().refine(codigoValido, "Código inválido.");
const filaRouter = router({
  listar: soAdmin.input(z.object({ situacao: z.enum([...situacoesValidas, "todas"]).default("todas"), limite: z.number().int().min(1).max(200).default(50) }).strict().optional())
    .query(async ({ input }) => ({ validadeHoras: await lerValidadeHoras(), itens: await listarFila({ situacao: input?.situacao ?? "todas", limite: input?.limite ?? 50 }, new Date()) })),
  aprovar: soAdmin.input(z.object({ codigo: codigoEntrada }).strict()).mutation(async ({ ctx, input }) => {
    // QA R2 M3: a tela aprova com o mesmo orçamento de tempo do WhatsApp (mínimo por função, Drive no que sobra)
    const [r] = await decidir([input.codigo], "aprovar", decisorDaTela(ctx.user.id));
    return r;
  }),
  recusar: soAdmin.input(z.object({ codigo: codigoEntrada, motivo: z.string().trim().max(300).optional() }).strict()).mutation(async ({ ctx, input }) => {
    const [r] = await decidir([input.codigo], "recusar", { via: "tela", userId: ctx.user.id, agora: new Date(), motivo: input.motivo ?? null });
    return r;
  }),
  salvarValidade: soAdmin.input(z.object({ horas: z.number().int().min(VALIDADE_MINIMA_HORAS).max(VALIDADE_MAXIMA_HORAS) }).strict()).mutation(async ({ ctx, input }) => {
    const r = await getDb().update(doloresFilaConfig).set({ validadeHoras: input.horas, atualizadoEm: new Date(), atualizadoPor: ctx.user.id })
      .where(eq(doloresFilaConfig.id, 1)).returning({ h: doloresFilaConfig.validadeHoras }).catch(() => []);
    if (!r.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Configuração da fila ausente: a migração 0125 ainda não foi aplicada." });
    return { validadeHoras: r[0].h };
  }),
});

export const doloresRouter = router({
  fila: filaRouter,
  grupos: gruposRouter,
  notas: notasRouter,
  operacao: operacaoRouter,
  atendimento: atendimentoRouter,
  status: soAdmin.query(() => situacao()),

  /** Cria a instância própria da Dolores (se não existir) e devolve o QR code para escanear com o celular DELA. */
  conectar: soAdmin.mutation(async ({ ctx }) => {
    await exigirConfig();
    const evo = await exigirEvolution();
    try {
      const r = await gerarQrCode(evo, INSTANCIA_DOLORES);
      await gravar({ instancia: INSTANCIA_DOLORES, statusConexao: r.estado === "open" ? "conectado" : "aguardando_qr" }, ctx.user.id);
      return { qrCode: r.qrCode, status: r.estado === "open" ? "conectado" : "aguardando_qr" };
    } catch (e) { throw erro(e, "A Evolution não gerou o QR code."); }
  }),

  /**
   * Consultado enquanto o QR está na tela. QA achado 8: CONSULTA PURA — só lê a situação na Evolution e devolve; não grava,
   * não remove instância e não registra aviso (uma query é GET e pode ser repetida/pré-carregada). Quando a Evolution diz
   * "conectado" e o sistema ainda não confirmou, `precisaConfirmar` = true e a tela chama `confirmarConexao`.
   */
  statusConexao: soAdmin.query(async () => {
    const c = await exigirConfig();
    const base = { numeroDolores: mascararNumero(c.numeroDolores) };
    if (!c.instancia) return { ...base, status: c.statusConexao, precisaConfirmar: false };
    const evo = await exigirEvolution();
    const estado = await estadoInstancia(evo, c.instancia).catch(() => null);
    if (!estado) return { ...base, status: c.statusConexao, precisaConfirmar: false };
    const status = estado === "open" ? "conectado" : estado === "connecting" ? "aguardando_qr" : "desconectado";
    return { ...base, status, precisaConfirmar: status === "conectado" && c.statusConexao !== "conectado" };
  }),

  /**
   * Efeitos da conexão, em mutação explícita (só admin por papel): grava a situação; conectado, confere que o número é
   * próprio (não é de conexão da empresa/corretor nem o do dono — senão remove a instância) e liga o aviso de mensagens.
   * Número conectado que não se consegue ler: FALHA FECHADA (não registra aviso nem marca conectado).
   */
  confirmarConexao: soAdmin.mutation(async ({ ctx }) => {
    const c = await exigirConfig();
    if (!c.instancia) throw new TRPCError({ code: "BAD_REQUEST", message: "Conecte o número da Dolores primeiro." });
    const evo = await exigirEvolution();
    const estado = await estadoInstancia(evo, c.instancia).catch(() => null);
    if (!estado) throw new TRPCError({ code: "BAD_REQUEST", message: "A Evolution não informou a situação da conexão. Tente de novo em instantes." });
    const status = estado === "open" ? "conectado" : estado === "connecting" ? "aguardando_qr" : "desconectado";
    if (status !== "conectado") {
      if (status !== c.statusConexao) await gravar({ statusConexao: status }, ctx.user.id);
      return { status, numeroDolores: mascararNumero(c.numeroDolores) };
    }
    const lido = await numeroConectado(evo, c.instancia).catch(() => null);
    const numero = lido ? lido.replace(/\D/g, "").slice(0, 20) : "";
    if (!numero) {
      if (c.statusConexao === "conectado") await gravar({ statusConexao: "aguardando_qr" }, ctx.user.id);
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Não consegui ler o número conectado na Evolution; nada foi ativado. Desconecte e conecte de novo." });
    }
    const outra = await numeroDeOutraConexao(numero, c.instancia);
    // a instância da EMPRESA não é removida por causa da antiga (seria derrubar a conexão que funciona): recusa e manda remover a antiga
    if (outra === "antiga") throw new TRPCError({ code: "PRECONDITION_FAILED", message: MENSAGEM_CONEXAO_ANTIGA });
    if (outra === "corretor") {
      await removerInstancia(evo, c.instancia);
      await gravar({ statusConexao: "desconectado", numeroDolores: null }, ctx.user.id);
      throw new TRPCError({ code: "BAD_REQUEST", message: "Esse número já é usado por uma conexão de corretor na Central. Conecte o número da empresa." });
    }
    if (c.numeroDono && pareceMesmoTelefone(numero, c.numeroDono)) {
      await removerInstancia(evo, c.instancia);
      await gravar({ statusConexao: "desconectado", numeroDolores: null }, ctx.user.id);
      throw new TRPCError({ code: "BAD_REQUEST", message: "Esse é o número do dono. Conecte o número da empresa (o dono escreve para ele)." });
    }
    if (c.statusConexao !== "conectado" || numero !== c.numeroDolores) {
      try { await registrarWebhookEvolution(evo, c.instancia, URL_WEBHOOK_DOLORES(), segredoWebhookDolores(), fetch, EVENTOS_WEBHOOK_DOLORES); }
      catch (e) { throw erro(e, "A Evolution não aceitou o aviso de mensagens da Dolores."); }
      await gravar({ statusConexao: "conectado", numeroDolores: numero }, ctx.user.id);
    }
    return { status, numeroDolores: mascararNumero(numero) };
  }),

  /**
   * Registra de novo o aviso de mensagens da instância da Dolores (idempotente). QA r2 N5: as MESMAS conferências de
   * confirmarConexao, com falha fechada — só com a conexão confirmada (status "conectado" e número da Dolores guardado),
   * a Evolution dizendo "open", o número lido igual ao confirmado, que não é de conexão da empresa/corretor nem o do dono.
   * Qualquer divergência: não registra nada e manda conferir a conexão (quem limpa/desconecta é o confirmarConexao).
   */
  ativarAvisos: soAdmin.mutation(async () => {
    const c = await exigirConfig();
    if (!c.instancia) throw new TRPCError({ code: "BAD_REQUEST", message: "Conecte o número da Dolores primeiro." });
    const conferir = "nada foi ativado. Use \"Conferir conexão\" primeiro.";
    if (c.statusConexao !== "conectado" || !c.numeroDolores) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `A conexão da Dolores ainda não foi confirmada; ${conferir}` });
    const evo = await exigirEvolution();
    const estado = await estadoInstancia(evo, c.instancia).catch(() => null);
    if (estado !== "open") throw new TRPCError({ code: "PRECONDITION_FAILED", message: `A Evolution não confirma o número da Dolores conectado agora; ${conferir}` });
    const lido = await numeroConectado(evo, c.instancia).catch(() => null);
    const numero = lido ? lido.replace(/\D/g, "").slice(0, 20) : "";
    if (!numero || numero !== c.numeroDolores) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `O número conectado não é o que foi confirmado; ${conferir}` });
    const outra = await numeroDeOutraConexao(numero, c.instancia);
    if (outra === "antiga") throw new TRPCError({ code: "PRECONDITION_FAILED", message: MENSAGEM_CONEXAO_ANTIGA });
    if (outra || (c.numeroDono && pareceMesmoTelefone(numero, c.numeroDono)))
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: `O número conectado é de uma conexão da empresa ou o do dono; ${conferir}` });
    try { await registrarWebhookEvolution(evo, c.instancia, URL_WEBHOOK_DOLORES(), segredoWebhookDolores(), fetch, EVENTOS_WEBHOOK_DOLORES); }
    catch (e) { throw erro(e, "A Evolution não aceitou o aviso de mensagens da Dolores."); }
    // Etapa 9: ligações recusadas na hora (o aviso por texto é do sistema). Falha aqui não desfaz o recebimento.
    const rejeita = await rejeitarLigacoesEvolution(evo, c.instancia).catch(() => false);
    return { ok: true, mensagem: `Recebimento de mensagens, grupos e ligações do WhatsApp da empresa ativo.${rejeita ? " Ligações são recusadas automaticamente." : " (A Evolution não confirmou a recusa automática de ligações; o aviso por texto vale do mesmo jeito.)"}` };
  }),

  /** QA-SEG E9 achado 2: a conexão antiga da Central (admin/colaborador) ainda existe? Só a situação e o número mascarado. */
  /**
   * EPIC-026 C2 — "Recebimento nas últimas 24 h" (só ADMIN por papel): quantos avisos/mensagens chegaram ao webhook da empresa e o
   * que foi feito com eles (Central, Dolores, grupos, ignoradas e por quê). Só contagens, sem conteúdo nem número.
   */
  recebimento: soAdmin.query(() => resumoDoRecebimento(agoraDoRoteamento(), 24)),

  conexaoAntiga: soAdmin.query(async () => {
    const c = await lerConfigWhatsapp().catch(() => null);
    const antigas = await conexoesAntigasDaCentral(c?.instancia ?? null);
    return { existe: antigas.length > 0, conexoes: antigas.map(a => ({ id: a.id, status: a.status, numero: mascararNumero(a.numero) })) };
  }),

  /**
   * QA-SEG E9 achado 2 — botão do ADMIN (papel) "Remover a conexão antiga da Central": desliga e apaga na Evolution a instância antiga
   * de cada linha de admin/colaborador (sem seguir redirecionamento) e LIMPA na linha só `instancia` e `status` (a linha continua: ela é
   * o `connectionId` do histórico da Central). A instância da empresa nunca é tocada. Só grava quando o admin clica — não é migração.
   */
  removerConexaoAntiga: soAdmin.mutation(async ({ ctx }) => {
    const c = await exigirConfig();
    const antigas = await conexoesAntigasDaCentral(c.instancia);
    if (!antigas.length) return { ok: true, removidas: 0 };
    const evo = await exigirEvolution();
    // QA-SEG E9 r2 (achado 1): só limpa a linha quando a Evolution CONFIRMA a remoção; senão a linha continua e o botão também.
    const removidas: number[] = [];
    const falharam: number[] = [];
    for (const a of antigas) {
      if (!(await removerInstanciaConfirmada(evo, a.instancia))) { falharam.push(a.id); continue; }
      await getDb().update(whatsappConnections).set({ instancia: null, status: "desconectado", updatedAt: new Date() })
        .where(and(eq(whatsappConnections.id, a.id), eq(whatsappConnections.instancia, a.instancia)));
      removidas.push(a.id);
    }
    await registrarAcao({ funcao: "remover_conexao_antiga_central", resultado: falharam.length ? "erro" : "ok",
      motivo: falharam.length ? "a Evolution não confirmou a remoção de parte das conexões antigas; elas continuam registradas"
        : "instância antiga da Central (admin/colaborador) removida pelo administrador",
      autorUserId: ctx.user.id, canal: "tela", resumo: { removidas, falharam } });
    if (falharam.length) {
      throw new TRPCError({ code: "BAD_GATEWAY", message: "A Evolution não confirmou a remoção da conexão antiga. Nada foi apagado dessa conexão; tente de novo em alguns minutos." });
    }
    return { ok: true, removidas: removidas.length };
  }),

  desconectar: soAdmin.mutation(async ({ ctx }) => {
    const c = await exigirConfig();
    if (c.instancia) {
      const evo = await exigirEvolution();
      await removerInstancia(evo, c.instancia);
    }
    await gravar({ statusConexao: "desconectado", numeroDolores: null }, ctx.user.id);
    return { ok: true };
  }),

  /** Número do dono e limites mensais. O modelo da Dolores é escolhido em Integrações › Anthropic (EPIC-024 S-11). */
  salvar: soAdmin
    .input(z.object({
      numeroDono: z.string().trim().max(30).optional(),
      limiteEntrada: z.number().int().min(0).max(2_000_000_000).optional(),
      limiteSaida: z.number().int().min(0).max(2_000_000_000).optional(),
    }).strict())
    .mutation(async ({ ctx, input }) => {
      const c = await exigirConfig();
      const dados: Partial<typeof doloresWhatsappConfig.$inferInsert> = {};
      if (input.numeroDono !== undefined) {
        const n = normalizarNumeroDono(input.numeroDono);
        if (!n) throw new TRPCError({ code: "BAD_REQUEST", message: "Número do dono inválido: use DDD + número (ex.: 99 99123-4567)." });
        if (c.numeroDolores && pareceMesmoTelefone(n, c.numeroDolores)) throw new TRPCError({ code: "BAD_REQUEST", message: "O número do dono não pode ser o próprio número da Dolores." });
        dados.numeroDono = n;
      }
      if (input.limiteEntrada !== undefined) dados.limiteMensalTokensEntrada = input.limiteEntrada;
      if (input.limiteSaida !== undefined) dados.limiteMensalTokensSaida = input.limiteSaida;
      if (Object.keys(dados).length) await gravar(dados, ctx.user.id);
      return situacao();
    }),

  /**
   * Interruptor da IA da Dolores (desligado por padrão). Ligar exige número do dono, chave e modelo e limites mensais;
   * desligar vale sempre e na hora.
   */
  ligarIa: soAdmin.input(z.object({ ligada: z.boolean() }).strict()).mutation(async ({ ctx, input }) => {
    if (input.ligada) {
      const s = await situacao();
      const faltam = s.pendencias.filter(p => !/^Ligar o interruptor|^Conectar o número|pausada/.test(p));
      if (faltam.length) throw new TRPCError({ code: "BAD_REQUEST", message: `Antes de ligar: ${faltam.join(" ")}` });
    } else await exigirConfig();
    await gravar({ iaLigada: input.ligada }, ctx.user.id);
    return situacao();
  }),
});
