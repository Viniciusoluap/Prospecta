// EPIC-029 S-2 (22/11/2026) — rotas do fiscal, todas dentro da aba "Contabilidade" do BPO (decisão do dono k).
// Ver: admin e colaborador ATIVO com o módulo BPO (mapa `fiscal: "bpo"` em server/_core/trpc.ts).
// Decidir, editar, configurar e "Atualizar" (gerar rascunhos): só ADMIN por papel. Emitir: sempre recusado (S-4).
// Nada sai do sistema: nenhuma rota chama a rede.
import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { fiscalConfig, fiscalDadosSimples, fiscalEmissores, fiscalTiposServico } from "../../drizzle/schema-fiscal.js";
import { MOTIVOS_SEM_NOTA } from "../../shared/fiscal/motivos.js";
import { ORIGENS_NOTA } from "../../shared/fiscal/origens.js";
import { STATUS_NOTA } from "../../shared/fiscal/status.js";
import { CODIGOS_ATIVIDADE_SIMPLES } from "../../shared/fiscal/dps-campos.js";
import { adminProcedure, router } from "../_core/trpc.js";
import { getDb } from "../db.js";
import { ensureTaxSchema } from "../tax-router.js";
import { carregarConfigFiscal, gerarRascunhos } from "./gerador.js";
import {
  adiar, carregarNota, cnpjLimpo, contarADecidir, editar, emissoresComPerfil, emitir, historicoDaNota, listarNotas, naoEmitir, opcoesDosFiltros, reabrir, CURSOR_NOTAS,
} from "./notas.js";
import { gerarPreviaPdf } from "./previa-pdf.js";
import { relatorioEmCsv, relatorioMensal } from "./relatorio-mensal.js";
import { aliquotaSimplesDaNota, dadosSimplesPorRaiz, raizDoCnpj, semValorDaFolha } from "./simples.js";
import { apurarLimites } from "./teto.js";

/**
 * QA S-2 (B6): erro inesperado (ex.: CHECK/gatilho do banco) nunca chega ao cliente com o SQL nem com o texto do banco —
 * vira uma frase genérica; o log leva só o tipo do erro (nada de dado pessoal).
 */
const fiscalProcedure = adminProcedure.use(async ({ next, path }) => {
  const r = await next();
  if (!r.ok && r.error.code === "INTERNAL_SERVER_ERROR") {
    console.error("[fiscal]", path, r.error.cause instanceof Error ? r.error.cause.name : "falha");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível concluir agora. Tente de novo em instantes." });
  }
  return r;
});

/** fiscalProcedure confere o MÓDULO (colaborador com BPO vê); decidir é do PAPEL admin. */
const adminPorPapel = fiscalProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Só o administrador decide sobre as notas fiscais." });
  }
  return next();
});

const id = z.number().int().positive();
// QA S-2 (B6): data que existe no calendário (2026-02-31 é recusada) e UF da lista das 27.
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.").refine(d => {
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}, "Data inválida.");
export const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ",
  "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"] as const;
const uf = z.string().trim().toUpperCase().refine(v => (UFS as readonly string[]).includes(v), "UF inválida.");

/** QA S-2 (B8): CPF do tomador só aparece inteiro para o admin; colaborador vê mascarado. CNPJ (empresa) fica inteiro. */
export function mascararCpf(doc: string | null): string | null {
  const d = (doc ?? "").replace(/\D/g, "");
  if (doc == null || d.length !== 11 || /[A-Za-z]/.test(doc)) return doc;
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}
function paraQuemVe<T extends { tomador: { documento: string | null } }>(nota: T, papel: string): T {
  return papel === "admin" ? nota : { ...nota, tomador: { ...nota.tomador, documento: mascararCpf(nota.tomador.documento) } };
}
const textoOpcional = (max: number) => z.string().trim().max(max).nullable().optional();
const ORIGEM_DO_MAPA = new RegExp(`^(${ORIGENS_NOTA.join("|")}):([a-z0-9_]{1,40}|\\*)$`);

/** QA S-8 (M2): o valor da folha da empresa só vai para o admin; os outros veem só se está informada e até quando. */
function soAdminVeFolha<T extends { folha12mCentavos: number | null }>(d: T | null, papel: string): (T & { folhaOculta?: boolean }) | null {
  if (!d || papel === "admin") return d;
  return { ...d, folha12mCentavos: null, folhaOculta: d.folha12mCentavos != null };
}

export const fiscalRouter = router({
  resumo: fiscalProcedure.input(z.object({ emissorId: id.nullable().optional() }).optional()).query(async ({ input, ctx }) => {
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
    listar: fiscalProcedure.query(async ({ ctx }) => {
      await ensureTaxSchema();
      const db = getDb();
      const perfis = ((await db.execute(sql`
        SELECT DISTINCT ON (upper(regexp_replace(cnpj, '[^0-9A-Za-z]', '', 'g')))
          upper(regexp_replace(cnpj, '[^0-9A-Za-z]', '', 'g')) AS cnpj, id, company_name, regime, is_active
        FROM tax_profiles WHERE coalesce(cnpj, '') <> ''
        ORDER BY upper(regexp_replace(cnpj, '[^0-9A-Za-z]', '', 'g')), is_active DESC, effective_from DESC, id DESC`)) as { rows?: Record<string, unknown>[] }).rows ?? [];
      const complementos = await db.select().from(fiscalEmissores);
      // S-8: folha dos 12 meses e início de atividade, por empresa (raiz do CNPJ) — null sem a migração 0168 ou sem a linha.
      const simples = await dadosSimplesPorRaiz(db);
      const lista = perfis.map(p => {
        const e = complementos.find(c => c.cnpj === p.cnpj) ?? null;
        return { cnpj: String(p.cnpj), perfilId: Number(p.id), razaoSocial: String(p.company_name), regime: String(p.regime), perfilAtivo: Boolean(p.is_active), emissor: e,
          simples: soAdminVeFolha(simples.get(raizDoCnpj(String(p.cnpj))) ?? null, ctx.user.role) };
      });
      // EPIC-029 S-6: filial (estabelecimento da mesma raiz de CNPJ) com complemento fiscal próprio aparece com o nome e o regime da empresa
      for (const e of complementos) {
        if (lista.some(x => x.cnpj === e.cnpj)) continue;
        const empresa = lista.find(x => x.cnpj.slice(0, 8) === e.cnpj.slice(0, 8));
        if (empresa) lista.push({ ...empresa, cnpj: e.cnpj, emissor: e });
      }
      return lista;
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
        // O emissor só nasce de um perfil tributário que JÁ existe (nunca com CNPJ digitado de novo). EPIC-029 S-6: a FILIAL (mesma raiz
        // do CNPJ) usa o perfil da empresa — o regime é da empresa; inscrição municipal e município são do estabelecimento.
        const existe = ((await db.execute(sql`
          SELECT 1 FROM tax_profiles WHERE substr(upper(regexp_replace(coalesce(cnpj, ''), '[^0-9A-Za-z]', '', 'g')), 1, 8) = ${cnpj.slice(0, 8)} LIMIT 1`)) as { rows?: unknown[] }).rows ?? [];
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
    /**
     * S-8: dados da EMPRESA para a alíquota do Simples (raiz do CNPJ: vale para matriz e filiais) — folha dos 12 meses
     * (Fator R) e o último mês que ela inclui, e a data de início de atividade (RBT12 proporcional). Só admin por papel.
     */
    salvarSimples: adminPorPapel
      .input(z.object({
        cnpj: z.string().trim().min(14).max(20),
        folha12mCentavos: z.number().int().min(0).max(100_000_000_000).nullable(),
        folhaAte: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês da folha no formato AAAA-MM.").nullable(),
        inicioAtividade: data.nullable(),
      }).refine(v => (v.folha12mCentavos == null) === (v.folhaAte == null), { message: "Informe a folha junto com o último mês que ela inclui." }))
      .mutation(async ({ input, ctx }) => {
        await ensureTaxSchema();
        const db = getDb();
        const cnpj = cnpjLimpo(input.cnpj);
        const raiz = raizDoCnpj(cnpj);
        const existe = ((await db.execute(sql`
          SELECT 1 FROM tax_profiles WHERE left(upper(regexp_replace(coalesce(cnpj, ''), '[^0-9A-Za-z]', '', 'g')), 8) = ${raiz} LIMIT 1`)) as { rows?: unknown[] }).rows ?? [];
        if (!existe.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Cadastre primeiro o perfil tributário com este CNPJ." });
        const tabela = ((await db.execute(sql`SELECT to_regclass('fiscal_dados_simples') IS NOT NULL AS ok`)) as { rows?: { ok: boolean }[] }).rows?.[0];
        if (!tabela?.ok) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A folha do Fator R ainda não pode ser salva: falta aplicar a migração 0168 no banco." });
        const valores = { folha12mCentavos: input.folha12mCentavos, folhaAte: input.folhaAte, inicioAtividade: input.inicioAtividade, atualizadoPor: ctx.user.id, atualizadoEm: new Date() };
        const [salvo] = await db.insert(fiscalDadosSimples).values({ raiz, ...valores })
          .onConflictDoUpdate({ target: fiscalDadosSimples.raiz, set: valores }).returning();
        return salvo;
      }),
  }),

  tipos: router({
    listar: fiscalProcedure.query(() => getDb().select().from(fiscalTiposServico).orderBy(fiscalTiposServico.id)),
    salvar: adminPorPapel
      .input(z.object({
        id: id.optional(),
        nome: z.string().trim().min(2).max(120),
        emissorId: id.nullable().optional(),
        codigoTributacaoNacional: z.string().trim().regex(/^\d{6}$/, "Código de tributação nacional: 6 números.").nullable().optional(),
        codigoNbs: z.string().trim().regex(/^\d{9}$/, "Código NBS: 9 números.").nullable().optional(),
        itemLc116: z.string().trim().regex(/^\d{1,2}\.\d{2}$/, "Item da LC 116 no formato 7.02.").nullable().optional(),
        // S-4: cAtvSN (Anexo VIII) — obrigatório na DPS de optante do Simples.
        codigoAtividadeSimples: z.enum(CODIGOS_ATIVIDADE_SIMPLES).nullable().optional(),
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
          ...(input.codigoAtividadeSimples !== undefined ? { codigoAtividadeSimples: input.codigoAtividadeSimples } : {}),
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
    listar: fiscalProcedure
      .input(z.object({
        emissorId: id.nullable().optional(),
        status: z.array(z.enum(STATUS_NOTA)).max(7).optional(),
        bpoClientId: id.optional(),
        leadId: id.optional(),
        obraId: id.optional(),
        municipio: z.string().trim().max(100).optional(),
        de: data.optional(),
        ate: data.optional(),
        // Revisão do PR #302 (1): paginação por cursor ("carregar mais").
        cursor: z.string().regex(CURSOR_NOTAS, "Página inválida.").optional(),
        limite: z.number().int().min(1).max(200).optional(),
      }).optional())
      .query(async ({ input, ctx }) => {
        const r = await listarNotas(getDb(), input ?? {});
        return { itens: r.itens.map(n => paraQuemVe(n, ctx.user.role)), proximoCursor: r.proximoCursor };
      }),
    /** Opções dos filtros Cliente e Obra sobre TODOS os rascunhos (não só a página carregada). */
    opcoesFiltro: fiscalProcedure
      .input(z.object({ emissorId: id.nullable().optional() }).optional())
      .query(({ input }) => opcoesDosFiltros(getDb(), input?.emissorId ?? null)),
    ver: fiscalProcedure.input(z.object({ id })).query(async ({ input, ctx }) => paraQuemVe(await carregarNota(getDb(), input.id), ctx.user.role)),
    historico: fiscalProcedure.input(z.object({ id })).query(({ input }) => historicoDaNota(getDb(), input.id)),
    /** S-8: alíquota do Simples da nota e "como foi calculada" (RBT12, anexo, faixa, Fator R, fontes). Só valores da empresa. */
    aliquotaSimples: fiscalProcedure.input(z.object({ id })).query(async ({ input, ctx }) => {
      const db = getDb();
      const r = await aliquotaSimplesDaNota(db, await carregarNota(db, input.id));
      // QA S-8 (M2): o valor da folha (e o r, que com o RBT12 a revelaria) só para o admin.
      return ctx.user.role === "admin" ? r : semValorDaFolha(r);
    }),
    /** PDF da prévia em base64 (marca d'água "RASCUNHO — SEM VALOR FISCAL" em todas as páginas). */
    previa: fiscalProcedure.input(z.object({ id })).query(async ({ input, ctx }) => {
      const nota = paraQuemVe(await carregarNota(getDb(), input.id), ctx.user.role);
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
        municipioUf: uf.nullable().optional(),
        emissorId: id.nullable().optional(),
        tipoServicoId: id.nullable().optional(),
      }))
      .mutation(({ input, ctx }) => editar(getDb(), { ...input, usuarioId: ctx.user.id, via: "tela" })),
    /** Emitir: recusado no servidor até a homologação (S-4). */
    emitir: adminPorPapel.input(z.object({ id, versao: z.number().int().positive() })).mutation(() => emitir()),
  }),

  relatorio: router({
    mensal: fiscalProcedure
      .input(z.object({ competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), emissorId: id.nullable().optional() }))
      .query(({ input }) => relatorioMensal(getDb(), input.competencia, input.emissorId ?? null)),
    csv: fiscalProcedure
      .input(z.object({ competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), emissorId: id.nullable().optional() }))
      .query(async ({ input }) => ({
        nomeArquivo: `notas-x-receita-${input.competencia}.csv`,
        csv: relatorioEmCsv(await relatorioMensal(getDb(), input.competencia, input.emissorId ?? null)),
      })),
  }),

  emissoresComPerfil: fiscalProcedure.query(() => emissoresComPerfil(getDb())),

  /**
   * EPIC-029 S-6: por empresa (perfil tributário por CNPJ), o regime vigente hoje, as contas vinculadas, a receita registrada no ano e o
   * limite do regime (Simples, Presumido; Real sem limite; "a confirmar" sem conta). Ver: admin e colaborador com BPO (só leitura).
   */
  limitesReceita: fiscalProcedure.query(async () => {
    await ensureTaxSchema();
    return apurarLimites(getDb());
  }),
});
