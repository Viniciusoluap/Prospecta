// EPIC-029 S-2 (22/11/2026) — rotas do fiscal, todas dentro da aba "Contabilidade" do BPO (decisão do dono k).
// Ver: admin e colaborador ATIVO com o módulo BPO (mapa `fiscal: "bpo"` em server/_core/trpc.ts).
// Decidir, editar, configurar e "Atualizar" (gerar rascunhos): só ADMIN por papel. Emitir: sempre recusado (S-4).
// Nada sai do sistema: nenhuma rota chama a rede.
import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { fiscalConfig, fiscalEmissores, fiscalTiposServico } from "../../drizzle/schema-fiscal.js";
import { MOTIVOS_SEM_NOTA } from "../../shared/fiscal/motivos.js";
import { ORIGENS_NOTA } from "../../shared/fiscal/origens.js";
import { STATUS_NOTA } from "../../shared/fiscal/status.js";
import { adminProcedure, router } from "../_core/trpc.js";
import { getDb } from "../db.js";
import { ensureTaxSchema } from "../tax-router.js";
import { carregarConfigFiscal, gerarRascunhos } from "./gerador.js";
import {
  adiar, carregarNota, cnpjLimpo, contarADecidir, editar, emissoresComPerfil, emitir, historicoDaNota, listarNotas, naoEmitir, reabrir,
} from "./notas.js";
import { gerarPreviaPdf } from "./previa-pdf.js";
import { relatorioEmCsv, relatorioMensal } from "./relatorio-mensal.js";

/** adminProcedure confere o MÓDULO (colaborador com BPO vê); decidir é do PAPEL admin. */
const adminPorPapel = adminProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Só o administrador decide sobre as notas fiscais." });
  }
  return next();
});

const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");
const uf = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "UF inválida.");
const textoOpcional = (max: number) => z.string().trim().max(max).nullable().optional();
const ORIGEM_DO_MAPA = new RegExp(`^(${ORIGENS_NOTA.join("|")}):([a-z0-9_]{1,40}|\\*)$`);

export const fiscalRouter = router({
  resumo: adminProcedure.input(z.object({ emissorId: id.nullable().optional() }).optional()).query(async ({ input, ctx }) => {
    const db = getDb();
    const config = await carregarConfigFiscal(db);
    return {
      aDecidir: await contarADecidir(db, input?.emissorId ?? null),
      config: { ligado: config.ligado, inicioEm: config.inicioEm, ultimaVarreduraEm: config.ultimaVarreduraEm },
      podeDecidir: ctx.user.role === "admin",
    };
  }),

  config: router({
    salvar: adminPorPapel
      .input(z.object({ ligado: z.boolean(), inicioEm: data }))
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        await carregarConfigFiscal(db);
        const [salva] = await db.update(fiscalConfig)
          .set({ ligado: input.ligado, inicioEm: input.inicioEm, atualizadoPor: ctx.user.id, atualizadoEm: new Date() })
          .where(eq(fiscalConfig.id, true)).returning();
        return salva;
      }),
  }),

  emissores: router({
    /** Um item por CNPJ de perfil tributário, com o complemento fiscal (se já cadastrado). Razão social e regime: do perfil. */
    listar: adminProcedure.query(async () => {
      await ensureTaxSchema();
      const db = getDb();
      const perfis = ((await db.execute(sql`
        SELECT DISTINCT ON (upper(regexp_replace(cnpj, '[^0-9A-Za-z]', '', 'g')))
          upper(regexp_replace(cnpj, '[^0-9A-Za-z]', '', 'g')) AS cnpj, id, company_name, regime, is_active
        FROM tax_profiles WHERE coalesce(cnpj, '') <> ''
        ORDER BY upper(regexp_replace(cnpj, '[^0-9A-Za-z]', '', 'g')), is_active DESC, effective_from DESC, id DESC`)) as { rows?: Record<string, unknown>[] }).rows ?? [];
      const complementos = await db.select().from(fiscalEmissores);
      return perfis.map(p => {
        const e = complementos.find(c => c.cnpj === p.cnpj) ?? null;
        return { cnpj: String(p.cnpj), perfilId: Number(p.id), razaoSocial: String(p.company_name), regime: String(p.regime), perfilAtivo: Boolean(p.is_active), emissor: e };
      });
    }),
    salvar: adminPorPapel
      .input(z.object({
        cnpj: z.string().trim().min(14).max(20),
        municipioNome: z.string().trim().min(2).max(100),
        municipioUf: uf,
        municipioIbge: z.string().trim().regex(/^\d{7}$/, "Código IBGE tem 7 números.").nullable().optional(),
        inscricaoMunicipal: textoOpcional(30),
        serieDps: z.string().trim().regex(/^\d{1,5}$/, "Série: até 5 números.").nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        await ensureTaxSchema();
        const db = getDb();
        const cnpj = cnpjLimpo(input.cnpj);
        // O emissor só nasce de um perfil tributário que JÁ existe (nunca com CNPJ digitado de novo).
        const existe = ((await db.execute(sql`
          SELECT 1 FROM tax_profiles WHERE upper(regexp_replace(coalesce(cnpj, ''), '[^0-9A-Za-z]', '', 'g')) = ${cnpj} LIMIT 1`)) as { rows?: unknown[] }).rows ?? [];
        if (!existe.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Cadastre primeiro o perfil tributário com este CNPJ." });
        const valores = {
          municipioNome: input.municipioNome, municipioUf: input.municipioUf, municipioIbge: input.municipioIbge ?? null,
          inscricaoMunicipal: input.inscricaoMunicipal || null, serieDps: input.serieDps ?? null, atualizadoPor: ctx.user.id, atualizadoEm: new Date(),
        };
        // Ambiente fica "desligado" até a homologação (S-4): esta etapa não aceita outro valor.
        const [salvo] = await db.insert(fiscalEmissores).values({ cnpj, ambiente: "desligado", criadoPor: ctx.user.id, ...valores })
          .onConflictDoUpdate({ target: fiscalEmissores.cnpj, set: valores }).returning();
        return salvo;
      }),
  }),

  tipos: router({
    listar: adminProcedure.query(() => getDb().select().from(fiscalTiposServico).orderBy(fiscalTiposServico.id)),
    salvar: adminPorPapel
      .input(z.object({
        id: id.optional(),
        nome: z.string().trim().min(2).max(120),
        emissorId: id.nullable().optional(),
        codigoTributacaoNacional: z.string().trim().regex(/^\d{6}$/, "Código de tributação nacional: 6 números.").nullable().optional(),
        codigoNbs: z.string().trim().regex(/^\d{9}$/, "Código NBS: 9 números.").nullable().optional(),
        itemLc116: z.string().trim().regex(/^\d{1,2}\.\d{2}$/, "Item da LC 116 no formato 7.02.").nullable().optional(),
        descricaoPadrao: textoOpcional(2000),
        aliquotaIss: z.number().min(0).max(100).nullable().optional(),
        // Decisão h: só "sempre perguntar" ou "nunca gerar". "Automático" não existe nesta etapa.
        regra: z.enum(["sempre_perguntar", "nunca_gerar"]),
        origens: z.array(z.string().regex(ORIGEM_DO_MAPA, "Origem do mapa inválida.")).max(30),
        ativo: z.boolean().default(true),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        const valores = {
          nome: input.nome, emissorId: input.emissorId ?? null,
          codigoTributacaoNacional: input.codigoTributacaoNacional || null, codigoNbs: input.codigoNbs || null, itemLc116: input.itemLc116 || null,
          descricaoPadrao: input.descricaoPadrao || null, aliquotaIss: input.aliquotaIss == null ? null : String(input.aliquotaIss),
          regra: input.regra, origens: Array.from(new Set(input.origens)), ativo: input.ativo, atualizadoPor: ctx.user.id, atualizadoEm: new Date(),
        };
        if (input.id) {
          const [salvo] = await db.update(fiscalTiposServico).set(valores).where(eq(fiscalTiposServico.id, input.id)).returning();
          if (!salvo) throw new TRPCError({ code: "NOT_FOUND", message: "Tipo de serviço não encontrado." });
          return salvo;
        }
        const [criado] = await db.insert(fiscalTiposServico).values(valores).returning();
        return criado;
      }),
  }),

  notas: router({
    listar: adminProcedure
      .input(z.object({
        emissorId: id.nullable().optional(),
        status: z.array(z.enum(STATUS_NOTA)).max(7).optional(),
        bpoClientId: id.optional(),
        leadId: id.optional(),
        obraId: id.optional(),
        municipio: z.string().trim().max(100).optional(),
        de: data.optional(),
        ate: data.optional(),
      }).optional())
      .query(({ input }) => listarNotas(getDb(), input ?? {})),
    ver: adminProcedure.input(z.object({ id })).query(({ input }) => carregarNota(getDb(), input.id)),
    historico: adminProcedure.input(z.object({ id })).query(({ input }) => historicoDaNota(getDb(), input.id)),
    /** PDF da prévia em base64 (marca d'água "RASCUNHO — SEM VALOR FISCAL" em todas as páginas). */
    previa: adminProcedure.input(z.object({ id })).query(async ({ input }) => {
      const nota = await carregarNota(getDb(), input.id);
      return { nomeArquivo: `previa-nota-${nota.id}.pdf`, base64: Buffer.from(gerarPreviaPdf(nota)).toString("base64") };
    }),
    /** Botão "Atualizar": roda a varredura agora (mesma função do cron, idempotente). */
    atualizar: adminPorPapel.mutation(async () => gerarRascunhos(getDb(), { origem: "botao" })),
    naoEmitir: adminPorPapel
      .input(z.object({ id, versao: z.number().int().positive(), motivo: z.enum(MOTIVOS_SEM_NOTA), texto: z.string().max(500).nullable().optional() }))
      .mutation(({ input, ctx }) => naoEmitir(getDb(), { ...input, usuarioId: ctx.user.id, via: "tela" })),
    adiar: adminPorPapel
      .input(z.object({ id, versao: z.number().int().positive(), ate: data.nullable().optional() }))
      .mutation(({ input, ctx }) => adiar(getDb(), { ...input, usuarioId: ctx.user.id, via: "tela" })),
    reabrir: adminPorPapel
      .input(z.object({ id, versao: z.number().int().positive() }))
      .mutation(({ input, ctx }) => reabrir(getDb(), { ...input, usuarioId: ctx.user.id, via: "tela" })),
    editar: adminPorPapel
      .input(z.object({
        id,
        versao: z.number().int().positive(),
        valorCentavos: z.number().int().positive().max(100_000_000_000).nullable().optional(),
        descricao: textoOpcional(2000),
        municipioNome: textoOpcional(100),
        municipioUf: z.string().trim().max(2).nullable().optional(),
        emissorId: id.nullable().optional(),
        tipoServicoId: id.nullable().optional(),
      }))
      .mutation(({ input, ctx }) => editar(getDb(), { ...input, usuarioId: ctx.user.id, via: "tela" })),
    /** Emitir: recusado no servidor até a homologação (S-4). */
    emitir: adminPorPapel.input(z.object({ id, versao: z.number().int().positive() })).mutation(() => emitir()),
  }),

  relatorio: router({
    mensal: adminProcedure
      .input(z.object({ competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), emissorId: id.nullable().optional() }))
      .query(({ input }) => relatorioMensal(getDb(), input.competencia, input.emissorId ?? null)),
    csv: adminProcedure
      .input(z.object({ competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), emissorId: id.nullable().optional() }))
      .query(async ({ input }) => ({
        nomeArquivo: `notas-x-receita-${input.competencia}.csv`,
        csv: relatorioEmCsv(await relatorioMensal(getDb(), input.competencia, input.emissorId ?? null)),
      })),
  }),

  emissoresComPerfil: adminProcedure.query(() => emissoresComPerfil(getDb())),
});
