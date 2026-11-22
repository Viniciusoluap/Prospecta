// EPIC-027 C5-E4 — rotas `dolores.operacao.avisos.*`: a seção "Avisos automáticos" do cartão de operação da Dolores. SÓ o
// administrador (PAPEL), conferido em cada procedimento. Ligar/desligar, IA no texto, teto diário, limites N de cada regra, silenciar e
// religar um tipo, e os últimos avisos enviados (texto do REGISTRO, com dados pessoais mascarados). Nada aqui envia mensagem nem chama a IA.
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { doloresAvisosConfig } from "../../drizzle/schema-dolores-avisos.js";
import {
  FAIXA_DOS_LIMITES, HORA_FIM_AVISOS, HORA_INICIO_AVISOS, LIMITES_PADRAO, MAX_AVISOS_DIA, REGRA_TIPO_AVISO, ROTULO_TIPO_AVISO, TIPOS_AVISO, erroDosLimites,
} from "../../shared/dolores/avisos.js";
import { CRON_AVISOS_AGENDAS, CRON_DOLORES_AGENDAS } from "../../shared/dolores/operacao.js";
import { adminProcedure, router } from "../_core/trpc.js";
import { getDb } from "../db.js";
import { registrarAcao } from "./auditoria.js";
import { definirSilencio, situacaoDosAvisos } from "./avisos.js";
import { lerConfigWhatsapp } from "./consumo.js";

const soAdmin = adminProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Só o administrador vê e controla os avisos da Dolores." });
  return next();
});
const SEM_MIGRACAO = "Avisos automáticos indisponíveis: a migração 0150 ainda não foi aplicada.";

async function situacao() {
  const s = await situacaoDosAvisos().catch(() => null);
  if (!s) return { disponivel: false as const };
  const horas = [...CRON_DOLORES_AGENDAS, ...CRON_AVISOS_AGENDAS].map(a => a.horaBrasilia).filter(h => h >= HORA_INICIO_AVISOS && h < HORA_FIM_AVISOS);
  return {
    disponivel: true as const,
    config: { ligado: s.config.ligado, iaNoTexto: s.config.iaNoTexto, maxPorDia: s.config.maxPorDia, intervaloMinutos: s.config.intervaloMinutos, reavisoDias: s.config.reavisoDias,
      limites: s.config.limites },
    padrao: { ...LIMITES_PADRAO }, faixas: FAIXA_DOS_LIMITES, maxAvisosDia: MAX_AVISOS_DIA,
    tipos: TIPOS_AVISO.map(t => ({ tipo: t, rotulo: ROTULO_TIPO_AVISO[t], regra: REGRA_TIPO_AVISO[t], silenciado: s.silenciados.includes(t), abertos: s.abertosPorTipo[t] ?? 0 })),
    janela: { inicio: HORA_INICIO_AVISOS, fim: HORA_FIM_AVISOS, dias: "segunda a sábado", horasDoCron: Array.from(new Set(horas)).sort((a, b) => a - b) },
    envios: s.envios,
  };
}

const inteiro = (k: keyof typeof FAIXA_DOS_LIMITES) => z.number().int().min(FAIXA_DOS_LIMITES[k][0]).max(FAIXA_DOS_LIMITES[k][1]).optional();

export const avisosRouter = router({
  situacao: soAdmin.query(() => situacao()),

  /** Interruptor, IA no texto, teto do dia, reaviso e os limites N de cada regra (o banco confere de novo, CHECK da 0150). */
  salvar: soAdmin.input(z.object({
    ligado: z.boolean().optional(), iaNoTexto: z.boolean().optional(),
    maxPorDia: z.number().int().min(1).max(MAX_AVISOS_DIA).optional(), reavisoDias: z.number().int().min(0).max(30).optional(),
    intervaloMinutos: z.number().int().min(30).max(240).optional(),
    obraAtrasoDias: inteiro("obraAtrasoDias"), tarefaVencidaDias: inteiro("tarefaVencidaDias"), documentoPendenteDias: inteiro("documentoPendenteDias"),
    notaConfirmacaoDias: inteiro("notaConfirmacaoDias"), regularizacaoParadaDias: inteiro("regularizacaoParadaDias"), grupoAguardandoHoras: inteiro("grupoAguardandoHoras"),
  }).strict().superRefine((v, c) => {
    const { ligado: _l, iaNoTexto: _i, intervaloMinutos: _m, ...numeros } = v;
    const e = erroDosLimites(numeros);
    if (e) c.addIssue({ code: z.ZodIssueCode.custom, message: e });
  })).mutation(async ({ ctx, input }) => {
    if (input.ligado === true) {
      const wa = await lerConfigWhatsapp().catch(() => null);
      if (!wa?.numeroDono) throw new TRPCError({ code: "BAD_REQUEST", message: "Cadastre o número do dono antes de ligar os avisos (eles só vão para esse número)." });
    }
    const dados = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    if (Object.keys(dados).length) {
      const r = await getDb().update(doloresAvisosConfig).set({ ...dados, atualizadoEm: new Date(), atualizadoPor: ctx.user.id }).where(eq(doloresAvisosConfig.id, 1))
        .returning({ id: doloresAvisosConfig.id }).catch(() => []);
      if (!r.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: SEM_MIGRACAO });
      await registrarAcao({ funcao: "avisos_config", resultado: "ok", motivo: "configuração dos avisos automáticos alterada pela tela", autorUserId: null, canal: "tela",
        resumo: { ...Object.fromEntries(Object.keys(dados).map(k => [k, true])), ...(input.ligado !== undefined ? { ligado: input.ligado } : {}), porUserId: ctx.user.id } });
    }
    return situacao();
  }),

  /** Silencia ou religa um tipo (o mesmo que o dono faz pela conversa, com o "pode"). */
  silenciar: soAdmin.input(z.object({ tipo: z.enum(TIPOS_AVISO), silenciado: z.boolean() }).strict()).mutation(async ({ ctx, input }) => {
    try {
      await definirSilencio({ tipo: input.tipo, silenciado: input.silenciado, porUserId: ctx.user.id, via: "tela" });
    } catch {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: SEM_MIGRACAO });
    }
    await registrarAcao({ funcao: "aviso_silencio", resultado: "ok", motivo: input.silenciado ? "tipo de aviso silenciado pela tela" : "tipo de aviso religado pela tela", autorUserId: null,
      canal: "tela", resumo: { tipo: input.tipo, silenciado: input.silenciado, porUserId: ctx.user.id } });
    return situacao();
  }),
});
