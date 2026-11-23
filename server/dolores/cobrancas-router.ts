// EPIC-025 E10 — rotas `dolores.operacao.cobrancas.*`: a seção "Cobranças automáticas" do cartão de operação da Dolores. SÓ o
// administrador (PAPEL), conferido em cada procedimento. Ligar/desligar cada função, os tetos e os últimos envios (texto do REGISTRO,
// com dados pessoais mascarados). Nada aqui envia mensagem nem chama a IA.
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { doloresCobrancasConfig } from "../../drizzle/schema-dolores-cobrancas.js";
import { DIAS_RESPOSTA, FAIXAS_COBRANCAS, HORA_FIM_COMERCIAL, HORA_INICIO_COMERCIAL, HORA_RESUMO } from "../../shared/dolores/cobrancas.js";
import { adminProcedure, router } from "../_core/trpc.js";
import { getDb } from "../db.js";
import { registrarAcao } from "./auditoria.js";
import { situacaoDasCobrancas } from "./cobrancas-automaticas.js";
import { lerConfigWhatsapp } from "./consumo.js";

const soAdmin = adminProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Só o administrador vê e controla as cobranças da Dolores." });
  return next();
});
const SEM_MIGRACAO = "Cobranças automáticas indisponíveis: a migração 0169 ainda não foi aplicada.";

async function situacao() {
  const s = await situacaoDasCobrancas().catch(() => null);
  if (!s) return { disponivel: false as const };
  return {
    disponivel: true as const,
    config: { colaboradorLigado: s.config.colaboradorLigado, documentosLigado: s.config.documentosLigado, colaboradorTetoDia: s.config.colaboradorTetoDia,
      documentosTetoDia: s.config.documentosTetoDia, maxItens: s.config.maxItens, documentosIntervaloDias: s.config.documentosIntervaloDias, respostasTetoDia: s.config.respostasTetoDia },
    faixas: FAIXAS_COBRANCAS,
    janela: { inicio: HORA_INICIO_COMERCIAL, fim: HORA_FIM_COMERCIAL, dias: "segunda a sexta", resumo: HORA_RESUMO, diasResposta: DIAS_RESPOSTA },
    cobrancas: s.cobrancas, pedidos: s.pedidos, respostas: s.respostas,
  };
}

const faixa = (k: keyof typeof FAIXAS_COBRANCAS) => z.number().int().min(FAIXAS_COBRANCAS[k][0]).max(FAIXAS_COBRANCAS[k][1]).optional();

export const cobrancasRouter = router({
  situacao: soAdmin.query(() => situacao()),

  salvar: soAdmin.input(z.object({
    colaboradorLigado: z.boolean().optional(), documentosLigado: z.boolean().optional(),
    colaboradorTetoDia: faixa("colaboradorTetoDia"), documentosTetoDia: faixa("documentosTetoDia"), maxItens: faixa("maxItens"),
    documentosIntervaloDias: faixa("documentosIntervaloDias"), respostasTetoDia: faixa("respostasTetoDia"),
  }).strict()).mutation(async ({ ctx, input }) => {
    if (input.colaboradorLigado === true || input.documentosLigado === true) {
      const wa = await lerConfigWhatsapp().catch(() => null);
      if (!wa?.numeroDono) throw new TRPCError({ code: "BAD_REQUEST", message: "Cadastre o número do dono antes de ligar as cobranças (o resumo e as respostas vão para esse número)." });
    }
    const dados = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    if (Object.keys(dados).length) {
      const r = await getDb().update(doloresCobrancasConfig).set({ ...dados, atualizadoEm: new Date(), atualizadoPor: ctx.user.id }).where(eq(doloresCobrancasConfig.id, 1))
        .returning({ id: doloresCobrancasConfig.id }).catch(() => []);
      if (!r.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: SEM_MIGRACAO });
      await registrarAcao({ funcao: "cobrancas_config", resultado: "ok", motivo: "configuração das cobranças automáticas alterada pela tela", autorUserId: null, canal: "tela",
        resumo: { ...Object.fromEntries(Object.keys(dados).map(k => [k, true])),
          ...(input.colaboradorLigado !== undefined ? { colaboradorLigado: input.colaboradorLigado } : {}),
          ...(input.documentosLigado !== undefined ? { documentosLigado: input.documentosLigado } : {}), porUserId: ctx.user.id } });
    }
    return situacao();
  }),
});
