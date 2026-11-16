// EPIC-025 (Dolores, etapa 2) — configuração do WhatsApp da Dolores (tRPC `dolores.*`), SÓ do administrador (papel):
// o router fica fora do mapa de módulos do adminProcedure (colaborador e corretor já são recusados lá) e cada
// procedimento confere o papel de novo. Nada aqui devolve chave, segredo do webhook ou número completo; o QR code sai
// só na hora de conectar, para a tela, e não é guardado.
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { whatsappConnections } from "../../drizzle/schema.js";
import { doloresWhatsappConfig } from "../../drizzle/schema-dolores-whatsapp.js";
import {
  INSTANCIA_DOLORES, bloqueioDoLimite, mascararNumero, mesFortaleza, normalizarNumeroDono, pareceMesmoTelefone,
} from "../../shared/dolores/whatsapp.js";
import { existeChaveAnthropicPainel, modelosAnthropicPainel } from "../_core/anthropic-painel.js";
import { estadoInstancia, gerarQrCode, numeroConectado, registrarWebhookEvolution, removerInstancia } from "../_core/evolution.js";
import { adminProcedure, router } from "../_core/trpc.js";
import { getDb } from "../db.js";
import { lerConfigWhatsapp, lerPausa, usoDoMes } from "./consumo.js";
import { URL_WEBHOOK_DOLORES, segredoWebhookDolores } from "./whatsapp.js";

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
  return c;
}
const gravar = (dados: Partial<typeof doloresWhatsappConfig.$inferInsert>, userId: number) =>
  getDb().update(doloresWhatsappConfig).set({ ...dados, atualizadoEm: new Date(), atualizadoPor: userId }).where(eq(doloresWhatsappConfig.id, 1));

/** O número conectado não pode ser o de uma conexão da empresa ou de corretor (a Dolores tem número próprio). */
async function numeroDeOutraConexao(numero: string): Promise<boolean> {
  const conns = await getDb().select({ numero: whatsappConnections.numero }).from(whatsappConnections);
  return conns.some(c => pareceMesmoTelefone(c.numero, numero));
}

/** O que falta para a Dolores responder pela IA (a tela mostra a lista). */
function pendencias(p: { conectado: boolean; numeroDono: boolean; chave: boolean; modelo: boolean; limites: boolean; iaLigada: boolean; pausada: boolean }) {
  const r: string[] = [];
  if (!p.conectado) r.push("Conectar o número da Dolores (QR code).");
  if (!p.numeroDono) r.push("Cadastrar o número do dono (o único que comanda).");
  if (!p.chave) r.push("Cadastrar a chave da Anthropic em Integrações › Anthropic.");
  if (!p.modelo) r.push("Escolher o modelo (preferencial em Integrações › Anthropic ou o da Dolores aqui).");
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
  const modeloEmUso = c.modelo?.trim() || painel?.modelo?.trim() || null;
  const limites = { entrada: c.limiteMensalTokensEntrada, saida: c.limiteMensalTokensSaida };
  return {
    instancia: c.instancia, statusConexao: c.statusConexao, numeroDolores: mascararNumero(c.numeroDolores), numeroDono: mascararNumero(c.numeroDono),
    iaLigada: c.iaLigada, pausada: pausa?.pausada ?? null, chaveAnthropic: Boolean(painel), modeloPainel: painel?.modelo ?? null, modelo: c.modelo,
    modeloEmUso, limites, mes, uso, bloqueioDoLimite: bloqueioDoLimite(uso, limites), webhookUrl: URL_WEBHOOK_DOLORES(),
    pendencias: pendencias({ conectado: c.statusConexao === "conectado", numeroDono: Boolean(c.numeroDono), chave: Boolean(painel), modelo: Boolean(modeloEmUso),
      limites: limites.entrada > 0 && limites.saida > 0, iaLigada: c.iaLigada, pausada: Boolean(pausa?.pausada) }),
  };
}

export const doloresRouter = router({
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
    if (await numeroDeOutraConexao(numero)) {
      await removerInstancia(evo, c.instancia);
      await gravar({ statusConexao: "desconectado", numeroDolores: null }, ctx.user.id);
      throw new TRPCError({ code: "BAD_REQUEST", message: "Esse número já é usado por uma conexão da empresa ou de um corretor. Conecte o número próprio da Dolores." });
    }
    if (c.numeroDono && pareceMesmoTelefone(numero, c.numeroDono)) {
      await removerInstancia(evo, c.instancia);
      await gravar({ statusConexao: "desconectado", numeroDolores: null }, ctx.user.id);
      throw new TRPCError({ code: "BAD_REQUEST", message: "Esse é o número do dono. A Dolores precisa de um número próprio (o dono escreve para ela)." });
    }
    if (c.statusConexao !== "conectado" || numero !== c.numeroDolores) {
      try { await registrarWebhookEvolution(evo, c.instancia, URL_WEBHOOK_DOLORES(), segredoWebhookDolores()); }
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
    if ((await numeroDeOutraConexao(numero)) || (c.numeroDono && pareceMesmoTelefone(numero, c.numeroDono)))
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: `O número conectado é de uma conexão da empresa ou o do dono; ${conferir}` });
    try { await registrarWebhookEvolution(evo, c.instancia, URL_WEBHOOK_DOLORES(), segredoWebhookDolores()); }
    catch (e) { throw erro(e, "A Evolution não aceitou o aviso de mensagens da Dolores."); }
    return { ok: true, mensagem: "Recebimento de mensagens da Dolores ativo." };
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

  /** Número do dono, limites mensais e modelo próprio (vazio = o preferencial do painel). */
  salvar: soAdmin
    .input(z.object({
      numeroDono: z.string().trim().max(30).optional(),
      limiteEntrada: z.number().int().min(0).max(2_000_000_000).optional(),
      limiteSaida: z.number().int().min(0).max(2_000_000_000).optional(),
      modelo: z.string().trim().max(120).nullable().optional(),
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
      if (input.modelo !== undefined) {
        if (!input.modelo) dados.modelo = null;
        else {
          let modelos;
          try { modelos = await modelosAnthropicPainel(); } catch (e) { throw erro(e, "Não foi possível listar os modelos da chave."); }
          if (!modelos.some(m => m.id === input.modelo)) throw new TRPCError({ code: "BAD_REQUEST", message: "Esse modelo não está disponível para a chave salva em Integrações › Anthropic." });
          dados.modelo = input.modelo;
        }
      }
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
